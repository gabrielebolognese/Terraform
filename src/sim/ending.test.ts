/**
 * The ending (Batch 39): the victory's hold, the tallies the score counts,
 * and how they are saved. The exit gate's own runs are in
 * `harness/ending.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { REFERENCE_POLICY } from "../harness/policy.js";
import { SEA_TUNING, buildTowns, playEvacuation, playToVictory, playWalled } from "../harness/ending.js";
import type { SimState } from "./index.js";
import { NEUTRAL_ENV, NO_ENDING, SaveError, advance, fromSave, holdSteps, makeTuning, marsStart, seaNow, siteElevation, stepEnding, toSave, worldScore } from "./index.js";

const ON = makeTuning({ ENDING_ENABLED: 1 });
const OFF = makeTuning({});
const cfg = (t = ON) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });
const at = (s: SimState, steps: number): SimState => ({ ...s, steps });

describe("the victory's hold", () => {
  it("wins on the substep the band has held VICTORY_HOLD_YEARS, and a substep out of it starts the count again", () => {
    const hold = holdSteps(ON);
    expect(hold).toBe(40);
    let s = marsStart(undefined, ON);
    // 39 substeps in the band, one out, then the band again.
    const living = [...Array<boolean>(hold - 1).fill(true), false, ...Array<boolean>(hold).fill(true)];
    let wonAt: number | null = null;
    living.forEach((inBand, i) => {
      s = stepEnding(s, at(s, i + 1), inBand, ON);
      if (wonAt === null && s.ending.victory !== null) wonAt = i + 1;
    });
    expect(wonAt).toBe(2 * hold);
    expect(s.ending.victory).toBe(2 * hold);
  });

  it("stays won once won, whatever the band does after", () => {
    let s = marsStart(undefined, ON);
    for (let i = 0; i < holdSteps(ON); i += 1) s = stepEnding(s, at(s, i + 1), true, ON);
    const won = s.ending.victory;
    expect(won).not.toBeNull();
    for (let i = 0; i < 10; i += 1) s = stepEnding(s, at(s, s.steps + 1), false, ON);
    expect(s.ending.victory).toBe(won);
    expect(s.ending.livingSteps).toBe(0);
  });

  it("is the same however the time is split, across the victory", () => {
    // The reference world 1,700 years in, twenty years from its victory at 1,720.
    const before = playToVictory(REFERENCE_POLICY, ON, 1700).state;
    const whole = advance(before, 120, cfg());
    let pieces = before;
    for (let i = 0; i < 120; i += 1) pieces = advance(pieces, 1, cfg());
    expect(whole.ending.victory).not.toBeNull();
    expect(whole.ending).toEqual(pieces.ending);
  });
});

describe("the ending off", () => {
  it("keeps nothing, and the planet is the same to the bit with it on or off", () => {
    const mirrors = (s: SimState): SimState => ({ ...s, facilities: [{ type: "orbital_mirror", count: 30, level: 1, enabled: true, deployed: 0 }] });
    const on = advance(mirrors(marsStart(undefined, ON)), 2000, cfg(ON));
    const off = advance(mirrors(marsStart(undefined, OFF)), 2000, cfg(OFF));
    expect(off.ending).toBe(NO_ENDING);
    expect(on.ending.machineYears).toBeGreaterThan(0);
    expect(on.reservoirs).toEqual(off.reservoirs);
    expect(on.phaseReached).toBe(off.phaseReached);
  });
});

describe("the tallies", () => {
  it("counts the machines online for every year they run", () => {
    // Thirty mirrors all deployed, for ten years: 300 machine-years.
    const s: SimState = { ...marsStart(undefined, ON), facilities: [{ type: "orbital_mirror", count: 30, level: 1, enabled: true, deployed: 30 }] };
    const later = advance(s, Math.round(10 / ON.SUBSTEP_YEARS), cfg());
    expect(later.ending.machineYears).toBeCloseTo(300, 9);
  });

  it("counts as lost everyone living in a city when the sea reaches it, if nobody moves them", () => {
    // The evacuation run's low city, nobody moved: its people on the substep the sea first stood over its ground.
    let reached: number | null = null;
    const run = playToVictory(REFERENCE_POLICY, SEA_TUNING, 500, {
      found: [{ lat: 0.31, lon: -1.2 }, { lat: -1.0493, lon: -2.8899 }],
      act: (s) => {
        if (s.steps === 0) return buildTowns(s);
        const low = s.settlements[1]!;
        const sea = seaNow(s, SEA_TUNING);
        if (reached === null && sea !== null && sea > siteElevation(low.lat, low.lon, SEA_TUNING)) reached = low.population;
        return s;
      },
    });
    expect(run.state.settlements[1]!.lostAtSeaLevelM).not.toBeNull();
    expect(reached).toBeGreaterThan(30);
    // 35.68 people when the water reached its lowest ground (it had held 37.72 at its most, earlier); every one of
    // them lost, to within what the substeps its domes stood dry above the water could add.
    expect(run.state.ending.peopleLost).toBeGreaterThanOrEqual(reached! - 1e-9);
    expect(run.state.ending.peopleLost).toBeLessThan(reached! + 1);
    expect(run.state.ending.peakPeople).toBeGreaterThan(run.state.ending.peopleLost);
  });

  it("counts the people moved to safety", () => {
    const run = playEvacuation();
    expect(run.moved).toBeGreaterThan(30);
    expect(run.state.ending.peopleEvacuated).toBe(run.moved);
    // Moved, not lost: the city fell empty.
    expect(run.state.settlements[1]!.lostAtSeaLevelM).not.toBeNull();
    expect(run.state.ending.peopleLost).toBeLessThan(1);
  });
});

describe("the ending in a save", () => {
  const won = playWalled().state;

  it("is kept whole", () => {
    const loaded = fromSave(JSON.parse(JSON.stringify(toSave(won, SEA_TUNING, "2026-10-30T00:00:00Z"))), SEA_TUNING);
    expect(won.ending.victory).not.toBeNull();
    expect(won.ending.achievements.length).toBeGreaterThan(10);
    expect(loaded.ending).toEqual(won.ending);
    expect(worldScore(loaded, SEA_TUNING)).toEqual(worldScore(won, SEA_TUNING));
  });

  it("loads a v20 save, made before the ending, with nothing of it", () => {
    const v21 = toSave(won, SEA_TUNING, "2026-10-30T00:00:00Z") as unknown as Record<string, unknown>;
    const { ending: _gone, ...rest } = v21;
    void _gone;
    const loaded = fromSave({ ...rest, schema_version: 20 }, SEA_TUNING);
    expect(loaded.schemaVersion).toBe(21);
    expect(loaded.ending).toEqual(NO_ENDING);
    expect(loaded.reservoirs).toEqual(won.reservoirs);
  });

  it("refuses an ending that cannot be", () => {
    const save = toSave(won, SEA_TUNING, "2026-10-30T00:00:00Z") as unknown as Record<string, unknown>;
    const ending = save["ending"] as Record<string, unknown>;
    const bad = (patch: Record<string, unknown>) => () => fromSave({ ...save, ending: { ...ending, ...patch } }, SEA_TUNING);
    expect(bad({ victory: won.steps + 1 })).toThrow(SaveError);
    expect(bad({ peak_people: -1 })).toThrow(/peak_people/);
    expect(bad({ achievements: [{ id: "caps", step: 1 }, { id: "caps", step: 2 }] })).toThrow(/twice/);
    expect(bad({ living_steps: 1.5 })).toThrow(/living_steps/);
  });
});
