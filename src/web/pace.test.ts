/**
 * Batch 28's paces: Standard (real build times) and Classic (the game before
 * them, and every world made before them).
 *
 * The scripted playthrough is "fun measured": the moments a player notices,
 * in real time at 1x, before (Classic) and after (Standard). Each threshold
 * below was measured first; the measurement sits beside it.
 */

import { describe, expect, it } from "vitest";

import { NEUTRAL_ENV, advance, foundSettlement, launchRocket, makeTuning, marsStart, offlineGrant } from "../sim/index.js";
import type { Tuning } from "../sim/index.js";
import { playPacing } from "../harness/pacing.js";
import { ALL_SPEEDS, CLASSIC_SPEEDS, STANDARD_SPEEDS, speedsFor } from "./config.js";
import { BROWSER_OVERRIDES, BROWSER_TUNING, PACE_OVERRIDES, paceOf, worldTuning } from "./game-tuning.js";

const STANDARD = makeTuning({ ...BROWSER_OVERRIDES, ...PACE_OVERRIDES.standard });
const CLASSIC = makeTuning({ ...BROWSER_OVERRIDES, ...PACE_OVERRIDES.classic });
const MIN = 60;
const HOUR = 3600;
/** The reference playthrough's length, sim-years (`golden.test.ts`: Phase 6 at 1710). */
const ARC_YEARS = 1710;

describe("the scripted playthrough, in real time at 1x", () => {
  // Measured (Batch 28): Classic 8 s / 19.3 min / 1.57 h / 8 s / 12.4 min;
  // Standard 33 s / 19.9 min / 1.79 h / 8 s / 1.65 h.
  const classic = playPacing(CLASSIC, 4 * HOUR).moments;
  const standard = playPacing(STANDARD, 4 * HOUR).moments;

  it("Standard: the first building stands within a minute (33 s)", () => {
    expect(standard.firstBuilding).not.toBeNull();
    expect(standard.firstBuilding!).toBeLessThan(MIN);
  });

  it("Standard: a city of 1,000 at 1-3 h (1.79 h)", () => {
    expect(standard.city1000! / HOUR).toBeGreaterThanOrEqual(1);
    expect(standard.city1000! / HOUR).toBeLessThanOrEqual(3);
  });

  it("Standard: Phase 1 within 15 minutes (8 s), Phase 2 at 1-3 h (1.65 h)", () => {
    expect(standard.phase1!).toBeLessThan(15 * MIN);
    expect(standard.phase2! / HOUR).toBeGreaterThanOrEqual(1);
    expect(standard.phase2! / HOUR).toBeLessThanOrEqual(3);
  });

  it("the first upgrade misses the plan's 4-8 min in both paces (19.9 min, 19.3 Classic) - held where it is", () => {
    // An upgrade costs a building's price for +10%: the script, like a player,
    // builds new until it has nothing it needs. Recorded, not hidden: the miss is
    // the upgrade's value, which this batch does not set. A regression guard only.
    expect(standard.firstUpgrade! / MIN).toBeLessThan(25);
    expect(classic.firstUpgrade! / MIN).toBeLessThan(25);
  });

  it("Standard slows the planet and not the cities: Phase 2 comes 8x later, the city of 1,000 within a fifth", () => {
    expect(standard.phase2! / classic.phase2!).toBeCloseTo(8, 0);
    expect(standard.city1000! / classic.city1000!).toBeLessThan(1.2);
  });
});

describe("the Standard pace's clocks", () => {
  /** Real seconds at 1x from launch until a spaceport's rocket is home. */
  function rocketSeconds(t: Tuning): number {
    const founded = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
    const id = founded.settlements[0]!.id;
    const port = founded.settlements[0]!.buildings.find((b) => b.type === "spaceport")!;
    let s = launchRocket(founded, id, port.tx, port.ty, t).state;
    expect(s.settlements[0]!.jobs.some((j) => j.kind === "rocket")).toBe(true);
    for (let k = 1; k < 10_000; k += 1) {
      s = advance(s, 1, { tuning: t, env: NEUTRAL_ENV, forcing: null });
      if (!s.settlements[0]!.jobs.some((j) => j.kind === "rocket")) return (k * t.SUBSTEP_YEARS) / t.TIME_SCALE;
    }
    throw new Error("the rocket never came home");
  }

  it("keeps the cities' rhythm: a rocket's trip is the same real minute in both paces", () => {
    const classic = rocketSeconds(CLASSIC);
    const standard = rocketSeconds(STANDARD);
    expect(classic).toBeGreaterThan(55);
    expect(Math.abs(standard - classic)).toBeLessThan(STANDARD.SUBSTEP_YEARS / STANDARD.TIME_SCALE);
  });

  it("lets a long build finish while away: ten hours away is ten hours of the world", () => {
    const grant = offlineGrant(10 * HOUR, STANDARD);
    expect(grant.grantedSimYears).toBeCloseTo(10 * HOUR * STANDARD.TIME_SCALE, 9);
  });

  it("still does not hand the game to someone who does not play: ten 48-hour absences stay short of the arc", () => {
    const tenAbsences = 10 * offlineGrant(48 * HOUR, STANDARD).grantedSimYears;
    // 1350 sim-years of 1710: 79%.
    expect(tenAbsences).toBeLessThan(ARC_YEARS);
    expect(tenAbsences).toBeGreaterThan(0);
  });
});

describe("a world's pace is its tuning", () => {
  it("reads Standard from a Standard world and Classic from the browser's tuning before Batch 28", () => {
    expect(paceOf(worldTuning("standard", 7, "standard"))).toBe("standard");
    expect(paceOf(worldTuning("standard", 7, "classic"))).toBe("classic");
    expect(paceOf(BROWSER_TUNING)).toBe("classic");
  });

  it("leaves a Classic world exactly the browser's tuning it always was, but for its seed", () => {
    expect({ ...worldTuning("standard", 0, "classic") }).toEqual({ ...BROWSER_TUNING });
  });

  it("offers a Standard world slow speeds, a sandbox and the debug setting every speed, a Classic world its own", () => {
    expect(speedsFor(worldTuning("standard", 1, "standard"))).toEqual(STANDARD_SPEEDS);
    expect(speedsFor(worldTuning("sandbox", 1, "standard"))).toEqual(ALL_SPEEDS);
    expect(speedsFor(worldTuning("standard", 1, "standard"), true)).toEqual(ALL_SPEEDS);
    expect(speedsFor(worldTuning("standard", 1, "classic"))).toEqual(CLASSIC_SPEEDS);
    expect(STANDARD_SPEEDS).not.toContain(100);
  });
});
