/**
 * The golden run.
 *
 * A fixed policy against the shipped tuning must reproduce a recorded
 * trajectory. The point is not that these particular numbers are sacred - they
 * are the balance batch's output and a later batch may well move them - but
 * that moving them has to be a DECISION. Without this, a tuning change that
 * quietly shifts the whole curve looks exactly like a tuning change that does
 * what it says.
 *
 * When this test fails, read the diff before touching the expectation: if the
 * phase years moved, the pacing moved, and that is the thing to argue about.
 * Re-record with `npm run sim:sweep -- --candidates` and the report in
 * docs/balance/batch3-balance.md.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_TUNING, NEUTRAL_ENV, Phase, computeProgress, derive } from "../sim/index.js";
import { NULL_POLICY, REFERENCE_POLICY } from "./policy.js";
import { runTrajectory } from "./run.js";
import { MAX_STALL_MINUTES, score } from "./score.js";

const t = DEFAULT_TUNING;

/** Shorter than the 4000-year sweep window: long enough to pass Phase 6, quick enough for CI. */
const GOLDEN_YEARS = 2400;
const GOLDEN_EVERY = 2;

const reference = runTrajectory(REFERENCE_POLICY, GOLDEN_YEARS, GOLDEN_EVERY, t);
const nullRun = runTrajectory(NULL_POLICY, GOLDEN_YEARS, GOLDEN_EVERY, t);

describe("the golden run", () => {
  it("reaches every phase on the recorded sim-year", () => {
    // Exact, not approximate. Phase entry is a threshold crossing on a fixed
    // substep grid, so it either lands on the same year or the pacing changed.
    expect(reference.phaseTimes).toEqual([0, 2, 18, 274, 362, 610, 1710]);
  });

  it("ends in the recorded state", () => {
    const r = reference.finalState.reservoirs;
    const d = derive(r, NEUTRAL_ENV, t);

    expect(d.T).toBeCloseTo(288.387, 2);
    expect(d.P).toBeCloseTo(935.955, 2);
    expect(d.oceanFrac).toBeCloseTo(0.3646, 4);
    expect(r.o2).toBeCloseTo(232.581, 2);
    expect(r.biomass).toBeCloseTo(0.853, 3);
    expect(r.co2_atm).toBeCloseTo(0.238, 3);
    expect(computeProgress(r, d, t).progress).toBeCloseTo(0.97469, 4);
  });

  it("passes through the recorded checkpoints", () => {
    const checkpoints: readonly (readonly [number, number, number, number])[] = [
      [250, 270.483, 182.212, 0.1663],
      [500, 285.077, 368.997, 0.4691],
      [1000, 289.437, 504.935, 0.65808],
      [1500, 290.626, 641.189, 0.80705],
      [2000, 292.21, 796.76, 0.95183],
    ];
    for (const [year, T, P, progress] of checkpoints) {
      const sample = reference.samples.find((s) => s.year === year);
      expect(sample, `no sample at year ${year}`).toBeDefined();
      expect(sample?.T, `T at year ${year}`).toBeCloseTo(T, 2);
      expect(sample?.P, `P at year ${year}`).toBeCloseTo(P, 2);
      expect(sample?.progress, `progress at year ${year}`).toBeCloseTo(progress, 4);
    }
  });
});

describe("the pacing the balance batch signed off on", () => {
  const scored = score(reference, nullRun, t);

  it("clears every hard gate", () => {
    expect(scored.failures).toEqual([]);
  });

  it("scores at or above what was accepted", () => {
    // A floor, not a target. Raising it is welcome; dropping below it means a
    // retune made the game measurably worse on the section 0 pacing goals.
    expect(scored.total).toBeGreaterThan(0.95);
  });

  it("keeps the S-curve shape section 0 asks for", () => {
    const m = scored.metrics;
    expect(m.openingShare, "the start should be slow and legible").toBeLessThan(0.25);
    expect(m.middleShare, "the middle should be where it accelerates").toBeGreaterThan(m.openingShare);
    expect(m.worstPhaseShare, "no climb phase should swallow the run").toBeLessThan(0.35);
  });

  it("lands the playthrough in the tens-of-hours window section 8.2 asks for", () => {
    expect(scored.metrics.realHoursToPhase6).toBeGreaterThan(12);
    expect(scored.metrics.realHoursToPhase6).toBeLessThan(60);
  });

  it("records the stall that is still above the section 8.2 limit", () => {
    /**
     * Pinned honestly rather than passed. §8.2 asks for no stall longer than
     * "a few minutes" and the run's worst is about nine, in the stretch after
     * the polar caps finish dumping. It came down from 679 minutes over the
     * course of the batch and the remaining gap is recorded in the balance
     * report rather than papered over. If it grows, that is a regression.
     */
    expect(scored.metrics.longestStallMinutes).toBeGreaterThan(MAX_STALL_MINUTES);
    expect(scored.metrics.longestStallMinutes).toBeLessThan(11);
  });
});

describe("the control that stops a retune handing the game back to the planet", () => {
  it("leaves an untouched Mars dead", () => {
    const last = nullRun.samples[nullRun.samples.length - 1];
    expect(last?.phase).toBe(Phase.Barren);
    expect(last?.co2_cap).toBeCloseTo(40, 3);
    expect(last?.biomass).toBe(0);
  });
});

describe("the progress bar over the real trajectory", () => {
  it("never goes backwards", () => {
    let previous = -1;
    for (const s of reference.samples) {
      expect(s.progress, `progress fell at year ${s.year}`).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = s.progress;
    }
  });

  it("improves the carbon dioxide axis monotonically, which it does not do in isolation", () => {
    // The axis is composition, not absolute amount, and adding CO2 alone makes
    // composition marginally worse. On the real run the nitrogen buffer and
    // the biosphere's oxygen arrive alongside the carbon, so it only improves.
    let previous = -1;
    let worstDrop = 0;
    for (const s of reference.samples) {
      const r = {
        ...reference.finalState.reservoirs,
        co2_atm: s.co2_atm,
        co2_cap: s.co2_cap,
        co2_reg: s.co2_reg,
        n2: s.n2,
        o2: s.o2,
        h2o_ice: s.h2o_ice,
        h2o_liq: s.h2o_liq,
        h2o_vap: s.h2o_vap,
        ghg: s.ghg,
        biomass: s.biomass,
      };
      const axis = computeProgress(r, derive(r, NEUTRAL_ENV, t), t).axes.nCO2;
      if (previous >= 0) worstDrop = Math.max(worstDrop, previous - axis);
      previous = axis;
    }
    expect(worstDrop).toBeLessThan(1e-3);
  });
});
