/**
 * Batch 30's exit gate, on scripted playthroughs of a new Standard world.
 *
 * - A scripted new player (the pacing script, plus the guided steps) finishes
 *   the guided steps in a measured time, and no step deadlocks.
 * - Every objective is reached by a scripted run, and none in the first minute.
 * - Every reward shortens the road to the next goal by a measured amount.
 * - Off in a sandbox (and in a Terraformed start, which begins with every goal met).
 *
 * Every threshold was measured first; the measurement sits beside it. The
 * scripted player is an instrument, not a good player: it shows whether a
 * change moved the first hour, not how fast it could be played.
 */

import { describe, expect, it } from "vitest";

import { GUIDE_STEPS, NEUTRAL_ENV, OBJECTIVES, advance, claimObjective, foundSettlement, guideActive, marsStart, objectiveStatus } from "../sim/index.js";
import { PACING_SITE, playPacing, playPlanet } from "../harness/pacing.js";
import { MODE_OVERRIDES, worldTuning } from "./game-tuning.js";

const T = worldTuning("standard", 0, "standard");
const MIN = 60;
const HOUR = 3600;
/** Long enough for the city's and the network's chains with every reward taken (a city of 1,000 at 1.67 h; 1.66 before Batch 32's needs). */
const RUN = 2.2 * HOUR;

const taught = playPacing(T, RUN, false, undefined, { guided: true, claim: true });
const withheld = (id: string) => playPacing(T, RUN, false, undefined, { guided: true, claim: true, withhold: id }).goals.done;

describe("the guided first steps, played by a scripted new player", () => {
  it("are finished at 42 minutes: the first five within a minute, then land waits for 200 people", () => {
    // Measured: found 8 s, power 8 s, dome 42 s, connect 42 s, upgrade 50 s, claim land 42.2 min, railway 42.4 min.
    // The plan proposed 10-20 minutes; claiming land waits for 200 people (CLAIM_FIRST_POPULATION), and a city
    // grows from 4 settlers at a tenth a year - 22 minutes of growth at the very least, before any shortage.
    const at = taught.goals.guide;
    expect(at.every((s) => s !== null), `steps reached: ${at.join(", ")}`).toBe(true);
    for (let k = 0; k < 5; k += 1) expect(at[k]!).toBeLessThan(MIN);
    expect(at[5]! / MIN).toBeGreaterThan(35);
    expect(at[6]! / MIN).toBeLessThan(45);
  });

  it("never deadlock: each step is reached, in order, from the state the one before left", () => {
    const at = taught.goals.guide as number[];
    for (let k = 1; k < at.length; k += 1) expect(at[k]!).toBeGreaterThanOrEqual(at[k - 1]!);
    expect(taught.state.goals.guide).toBe(GUIDE_STEPS.length);
    expect(guideActive(taught.state, T)).toBe(false);
  });

  it("are not done by the script without the guide's own steps (vacuity): the plain player never claims land or lays a railway", () => {
    const plain = playPacing(T, HOUR, false).goals.guide;
    expect(plain.slice(0, 5).every((s) => s !== null)).toBe(true);
    expect(plain[5]).toBeNull();
  });
});

describe("objectives on a scripted run", () => {
  it("are every one reached in Standard: the city's and the network's by the taught player, the planet's by the planet played alone", () => {
    // Measured: first 34.9 min, steady 52.8 min, town 69.4 min, a city of 1,000 1.67 h; a railway 42.4 min,
    // three cities joined 42.6 min. The planet: Phase 2 at 1.65 h, 100 mbar at 16.7 h, first water at 28.3 h.
    const done = taught.goals.done;
    for (const id of ["city_first", "city_steady", "city_town", "city_thousand", "network_rail", "network_three"]) expect(done[id], id).not.toBeNull();
    for (const id of ["city_first", "city_steady", "city_town", "city_thousand", "network_rail", "network_three"]) expect(taught.goals.claimed[id], id).not.toBeNull();
    const planet = playPlanet(T, 40 * HOUR, { claim: true }).done;
    expect(planet["planet_runaway"]! / HOUR).toBeCloseTo(1.65, 1);
    expect(planet["planet_pressure"]! / HOUR).toBeCloseTo(16.7, 0);
    expect(planet["planet_water"]! / HOUR).toBeCloseTo(28.3, 0);
    expect(Object.keys(done).sort()).toEqual(OBJECTIVES.map((o) => o.id).sort());
  });

  it("are none of them done in a new world's first minute, played or left alone", () => {
    // Played: the taught player's earliest is the first city goal at 34.9 minutes.
    for (const [id, at] of Object.entries(taught.goals.done)) if (at !== null) expect(at, id).toBeGreaterThan(MIN);
    // Left alone with a city founded, a minute of the world.
    const founded = foundSettlement(marsStart(undefined, T), "city", PACING_SITE.lat, PACING_SITE.lon, T).state;
    const minute = advance(founded, Math.ceil((MIN * T.TIME_SCALE) / T.SUBSTEP_YEARS), { tuning: T, env: NEUTRAL_ENV, forcing: null });
    expect(objectiveStatus(minute, T).filter((o) => o.progress.done).map((o) => o.def.id)).toEqual([]);
  });

  it("each reward shortens the road to the next goal, by the measured amount", () => {
    const all = taught.goals.done;
    // Fifty settlers at 100 people: the steady supply (20 clean years at 200 people) at 52.8 min, not 1.82 h.
    // (Batch 32: a new world's people need more past 500, and the city without the reward, growing slower from
    // there - 1,095 people at the end, not 1,205 - finds its 20 clean years at 1.82 h; with needs off, not within
    // the run at all, measured.)
    expect(withheld("city_first")["city_steady"]! - all["city_steady"]!).toBeGreaterThan(50 * MIN);
    expect(all["city_steady"]! / MIN).toBeLessThan(55);
    // 75 settlers: the town of 500 at 69.4 min, not 72.6.
    expect(withheld("city_steady")["city_town"]! - all["city_town"]!).toBeGreaterThan(3 * MIN);
    // Two rovers: the city of 1,000 at 1.67 h, 8.3 minutes sooner (about 10 before Batch 32's needs, which slow
    // both cities past 500 people alike).
    expect(withheld("city_town")["city_thousand"]! - all["city_thousand"]!).toBeGreaterThan(7 * MIN);
    // 200 materials for the first railway: three cities joined at 42.6 min, not 55.7.
    expect(withheld("network_rail")["network_three"]! - all["network_three"]!).toBeGreaterThan(12 * MIN);
    // 2,000 credits for three cities joined: the planet's Phase 2 at 78.5 min, not 1.65 h.
    expect(withheld("network_three")["planet_runaway"]! - all["planet_runaway"]!).toBeGreaterThan(20 * MIN);
    // The planet's: 1,000 credits at Phase 2 bring 100 mbar 70 min sooner; 2,000 at 100 mbar, first water 52 min.
    const planet = playPlanet(T, 40 * HOUR, { claim: true }).done;
    expect(playPlanet(T, 40 * HOUR, { claim: true, withhold: "planet_runaway" }).done["planet_pressure"]! - planet["planet_pressure"]!).toBeGreaterThan(60 * MIN);
    expect(playPlanet(T, 40 * HOUR, { claim: true, withhold: "planet_pressure" }).done["planet_water"]! - planet["planet_water"]!).toBeGreaterThan(45 * MIN);
  });
});

describe("the first hour by mode", () => {
  it("is Standard's alone: a sandbox and a Terraformed start have neither the guide nor objectives", () => {
    expect(MODE_OVERRIDES.standard).toEqual({ GUIDE_ENABLED: 1, OBJECTIVES_ENABLED: 1 });
    for (const mode of ["sandbox", "terraformed"] as const) {
      const t = worldTuning(mode, 0, "standard");
      expect(t.GUIDE_ENABLED + t.OBJECTIVES_ENABLED, mode).toBe(0);
      const s = foundSettlement(marsStart(undefined, t), "city", PACING_SITE.lat, PACING_SITE.lon, t).state;
      expect(objectiveStatus(s, t)).toEqual([]);
      expect(guideActive(s, t)).toBe(false);
      expect(claimObjective(s, "city_first", t).ok).toBe(false);
    }
  });
});
