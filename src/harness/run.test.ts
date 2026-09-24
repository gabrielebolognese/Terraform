import { describe, expect, it } from "vitest";

import { Phase } from "../sim/index.js";
import { NULL_POLICY, REFERENCE_POLICY } from "./policy.js";
import { runTrajectory } from "./run.js";

describe("the null-policy control", () => {
  /**
   * The single most important assertion in the harness.
   *
   * Section 0 calls the moment the player pushes the planet past its own
   * tipping point "the emotional core of the macro game". With the design
   * doc's bare sigmoid, an untouched Mars releases at 38% of maximum on turn
   * one and empties its polar caps in about 130 sim-years entirely on its own.
   * If this ever fails, the balance is broken no matter how good the reference
   * run looks.
   */
  it("leaves an untouched Mars dead after 3000 sim-years", () => {
    const run = runTrajectory(NULL_POLICY, 3000, 100);
    const last = run.samples[run.samples.length - 1];
    expect(last?.phase).toBe(Phase.Barren);
    expect(last?.co2_cap).toBeCloseTo(40, 3);
    expect(last?.T).toBeLessThan(215);
    expect(last?.biomass).toBe(0);
  });
});

describe("the reference trajectory", () => {
  it("reaches a living world", () => {
    const run = runTrajectory(REFERENCE_POLICY, 3000, 50);
    const last = run.samples[run.samples.length - 1];
    expect(last?.phase).toBe(Phase.LivingWorld);
    expect(last?.oceanFrac ?? 0).toBeGreaterThan(0.3);
    expect(last?.o2 ?? 0).toBeGreaterThan(100);
  });

  it("climbs the phases in order, with no phase skipped in the record", () => {
    /**
     * `phaseTimes` recorded only the slot the latch happened to land on, so a
     * phase crossed between two samples stayed null - which the field
     * documents as "never reached". At --every 50 the reference run reported
     * Phase 1 as never reached despite passing through it, and the balance
     * batch's pacing score is specified in terms of time-to-each-phase.
     */
    for (const every of [10, 50, 200]) {
      const { phaseTimes } = runTrajectory(REFERENCE_POLICY, 3000, every);
      expect(phaseTimes.every((v) => v !== null), `--every ${every} left a phase unrecorded`).toBe(true);

      const times = phaseTimes as readonly number[];
      for (let i = 1; i < times.length; i += 1) {
        expect((times[i] ?? 0) >= (times[i - 1] ?? 0), `--every ${every} recorded phase ${i} before ${i - 1}`).toBe(true);
      }
    }
  });

  it("samples at the requested interval", () => {
    const run = runTrajectory(REFERENCE_POLICY, 1000, 10);
    expect(run.samples.length).toBe(101);
    expect(run.samples[0]?.year).toBe(0);
    expect(run.samples[run.samples.length - 1]?.year).toBeCloseTo(1000, 6);
  });

  it("produces a finite, physical trajectory throughout", () => {
    for (const sample of runTrajectory(REFERENCE_POLICY, 3000, 50).samples) {
      for (const [key, value] of Object.entries(sample)) {
        expect(Number.isFinite(value), `${key} is not finite at year ${sample.year}`).toBe(true);
      }
      expect(sample.progress).toBeGreaterThanOrEqual(0);
      expect(sample.progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("the scripted policy", () => {
  it("the null policy builds nothing at all", () => {
    expect(NULL_POLICY.orders).toHaveLength(0);
    expect(runTrajectory(NULL_POLICY, 500, 100).finalState.facilities).toHaveLength(0);
  });

  it("the reference policy brings its levers online gradually, not at once", () => {
    // Section 5's design rule, visible in the trajectory: an order placed at
    // year 0 is not fully online at year 0.
    const early = runTrajectory(REFERENCE_POLICY, 10, 10).finalState;
    const later = runTrajectory(REFERENCE_POLICY, 200, 10).finalState;
    const mirrorsAt = (s: typeof early): number =>
      s.facilities.find((f) => f.type === "orbital_mirror")?.deployed ?? 0;
    expect(mirrorsAt(early)).toBeGreaterThan(0);
    expect(mirrorsAt(early)).toBeLessThan(30);
    expect(mirrorsAt(later)).toBe(30);
  });

  it("brings the shield up late, and it actually engages", () => {
    const end = runTrajectory(REFERENCE_POLICY, 3000, 50).finalState;
    expect(end.shieldStrength).toBeGreaterThan(0.9);
  });
});
