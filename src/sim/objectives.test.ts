/**
 * Batch 30, the first hour: the guided first steps and the objectives, held
 * to what the exit gate asks of the simulation.
 *
 * - The guide is driven by the state: a step counts when the world shows it
 *   done, in order, and the latch never walks back.
 * - Objective progress is derived, never stored; only the claims are, and
 *   they survive the save exactly.
 * - Both are tuning, off by default: the golden run never sees them.
 *
 * The scripted playthroughs (the guided player, every objective reached,
 * nothing in the first minute, rewards that matter) are in
 * `src/web/first-hour.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { advance } from "./integrate.js";
import { NO_GOALS, marsStart } from "./planets/mars.js";
import { deserialize, fromSave, serialize, toSave } from "./save.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { BuildingType, Settlement, SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";
import { derive } from "./derive.js";
import { foundSettlement } from "./micro/registry.js";
import { roverCount } from "./micro/rocks.js";
import * as flood from "../testkit/flood.js";
import { capacities, claimLand, claimableChunks, connectAll, housing, placeBuilding, removeBuilding, upgradeBuilding } from "./micro/settlement.js";
import { connectSettlements } from "./micro/routes.js";
import {
  GUIDE_STEPS,
  OBJECTIVES,
  citiesJoined,
  claimObjective,
  guideActive,
  guideReached,
  hasCosmetic,
  hasUnlock,
  latchGuide,
  objectiveById,
  objectiveStatus,
  skipGuide,
  steadyYears,
} from "./objectives.js";

/** A Standard world's first hour on a small grid: the guide and the objectives on. */
const T = makeTuning({
  SETTLEMENTS_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  NETWORK_ENABLED: 1,
  BUILD_TIME_ENABLED: 1,
  INTERCITY_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  CITY_GRID_TILES: 64,
  GUIDE_ENABLED: 1,
  OBJECTIVES_ENABLED: 1,
});
/** The same world with both off: what every world before Batch 30 has. */
const OFF = makeTuning({ ...T, GUIDE_ENABLED: 0, OBJECTIVES_ENABLED: 0 });
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const AT = "2026-10-15T12:00:00.000Z";
const SITE = { lat: 0.31, lon: -1.2 } as const;

function founded(t = T): SimState {
  const o = foundSettlement(marsStart(undefined, t), "city", SITE.lat, SITE.lon, t);
  expect(o.ok, o.reason ?? "").toBe(true);
  return o.state;
}
const first = (s: SimState): Settlement => s.settlements[0]!;
const id = (s: SimState): string => first(s).id;

function place(s: SimState, type: BuildingType, tx: number, ty: number, t = T): SimState {
  const o = placeBuilding(s, id(s), type, tx, ty, t);
  expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
  return o.state;
}

/** The city with its people and stores set, as a test needs them. */
function withCity(s: SimState, change: Partial<Settlement>): SimState {
  return { ...s, settlements: s.settlements.map((c, i) => (i === 0 ? { ...c, ...change } : c)) };
}

describe("the guided first steps", () => {
  it("count each step only when the state shows it done, one substep after, in order", () => {
    let s = marsStart(undefined, T);
    const latched = (): number => (s = advance(s, 1, cfg)).goals.guide;
    expect(latched()).toBe(0);
    s = founded();
    expect(latched()).toBe(1);
    // A solar array, then a dome well away from it: two steps, but not yet the third (no cable between them).
    s = place(s, "solar_array", 10, 10);
    expect(latched()).toBe(2);
    s = place(s, "habitat_dome", 10, 40);
    expect(latched()).toBe(3);
    expect(latched()).toBe(3);
    const linked = connectAll(s, id(s), T);
    expect(linked.ok, linked.reason ?? "").toBe(true);
    s = linked.state;
    expect(latched()).toBe(4);
    // Land claimed out of turn (the people are set for it) does not count until the upgrade before it is done.
    s = withCity(s, { population: 400, stores: { ...first(s).stores, materials: 400 } });
    const chunk = claimableChunks(first(s), T)[0]!;
    s = claimLand(s, id(s), chunk.i, chunk.j, T).state;
    expect(latched()).toBe(4);
    const up = upgradeBuilding(s, id(s), first(s).buildings.find((b) => b.type === "solar_array")!.tx, first(s).buildings.find((b) => b.type === "solar_array")!.ty, T);
    expect(up.ok, up.reason ?? "").toBe(true);
    s = up.state;
    // The upgrade on its way counts, and the claim made before it now counts at once.
    expect(latched()).toBe(6);
    const outpost = foundSettlement(s, "outpost", SITE.lat, SITE.lon + 0.02, T);
    s = outpost.state;
    expect(latched()).toBe(6);
    const rail = connectSettlements(s, id(s), outpost.settlement!.id, T);
    expect(rail.ok, rail.reason ?? "").toBe(true);
    s = rail.state;
    expect(latched()).toBe(GUIDE_STEPS.length);
    expect(guideActive(s, T)).toBe(false);
  });

  it("never walks back when a step's condition stops holding", () => {
    let s = place(place(founded(), "solar_array", 10, 10), "habitat_dome", 13, 10);
    s = advance(s, 1, cfg);
    expect(s.goals.guide).toBeGreaterThanOrEqual(3);
    const kept = s.goals.guide;
    s = removeBuilding(s, id(s), 13, 10).state;
    // Not vacuous: the derived condition no longer holds.
    expect(GUIDE_STEPS[2]!.done(s, T)).toBe(false);
    s = advance(s, 4, cfg);
    expect(s.goals.guide).toBe(kept);
    expect(guideReached(s, T)).toBe(kept);
  });

  it("is never shown again once skipped, and the latch stops with it", () => {
    let s = skipGuide(founded());
    expect(guideActive(s, T)).toBe(false);
    s = advance(place(s, "solar_array", 10, 10), 2, cfg);
    expect(s.goals.guide).toBe(0);
    expect(s.goals.guideSkipped).toBe(true);
    // Not vacuous: unskipped, the same world shows and latches it.
    const shown = advance(place(founded(), "solar_array", 10, 10), 2, cfg);
    expect(guideActive(shown, T)).toBe(true);
    expect(shown.goals.guide).toBe(2);
  });

  it("is off by default and in every world made before it: advance leaves the goals as they were", () => {
    const t = makeTuning({ ...OFF });
    let s = place(founded(t), "solar_array", 10, 10, t);
    const before = s.goals;
    s = advance(s, 8, { tuning: t, env: NEUTRAL_ENV, forcing: null });
    expect(s.goals).toBe(before);
    expect(DEFAULT_TUNING.GUIDE_ENABLED + DEFAULT_TUNING.OBJECTIVES_ENABLED).toBe(0);
    expect(guideActive(s, t)).toBe(false);
    expect(latchGuide(s, t)).toBe(s);
  });

  it("is latched every substep, not once a call: a city lost to the sea within one call has its steps counted", () => {
    // Batch 24's drowning city alone (its high neighbour left out), with a geothermal plant: two steps done the
    // moment it is seen, and lost to the rising sea 37 substeps later (measured). Judged only at the end of the
    // call, there would be no city to count.
    const g = makeTuning({ ...flood.t, GUIDE_ENABLED: 1 });
    const fx = flood.fixture(g);
    const s = { ...fx, settlements: fx.settlements.filter((c) => c.id === "settlement-1") };
    expect(s.goals.guide).toBe(0);
    const whole = advance(s, 40, { ...flood.rising, tuning: g });
    expect(first(whole).lostAtSeaLevelM, "vacuity: the city is lost within the call").not.toBeNull();
    expect(GUIDE_STEPS[0]!.done(whole, g), "and no city stands at its end").toBe(false);
    expect(whole.goals.guide).toBe(2);
  });

  it("is chunk-independent: one call over a step's latch equals a call a substep", () => {
    const s = place(place(founded(), "solar_array", 10, 10), "habitat_dome", 13, 10);
    let stepped = s;
    for (let k = 0; k < 12; k += 1) stepped = advance(stepped, 1, cfg);
    const whole = advance(s, 12, cfg);
    expect(whole.goals.guide).toBeGreaterThan(0);
    expect(whole).toEqual(stepped);
  });
});

describe("objectives", () => {
  it("open one at a time down each chain, the first of each from the start", () => {
    const status = objectiveStatus(founded(), T);
    expect(status.map((o) => o.def.id)).toEqual(OBJECTIVES.map((o) => o.id));
    expect(status.filter((o) => o.open).map((o) => o.def.id)).toEqual(["city_first", "planet_runaway", "network_rail"]);
    expect(status.some((o) => o.claimed || o.progress.done)).toBe(false);
  });

  it("derive their progress from the state, exactly what each counts", () => {
    let s = withCity(founded(), { population: 63.7 });
    const of = (x: SimState, oid: string) => objectiveStatus(x, T).find((o) => o.def.id === oid)!.progress;
    expect(of(s, "city_first")).toEqual({ now: 63, from: 0, target: T.GOAL_FIRST_PEOPLE, done: false });
    s = withCity(s, { population: 100 });
    expect(of(s, "city_first").done).toBe(true);
    // The air, in mbar: Mars starts at about 6.
    expect(of(s, "planet_pressure").now).toBeGreaterThan(5);
    expect(of(s, "planet_pressure").now).toBeLessThan(T.GOAL_PRESSURE_MBAR);
    // A phase goal: the temperature against the phase's, done once the latched phase is reached.
    expect(of(s, "planet_runaway").target).toBe(T.T_SUBL_CAP);
    expect(of({ ...s, phaseReached: 2 }, "planet_runaway")).toMatchObject({ now: T.T_SUBL_CAP, target: T.T_SUBL_CAP, done: true });
    // Measured from the planet as the world began, not from absolute zero: a new world (no weather here) has come none of the way.
    const began = derive(marsStart(undefined, T).reservoirs, NEUTRAL_ENV, T).T;
    for (const oid of ["planet_runaway", "planet_water"]) {
      expect(of(s, oid).from, oid).toBe(began);
      expect(of(s, oid).now, oid).toBe(began);
    }
    expect(of(s, "planet_pressure").from).toBe(0);
  });

  it("refuse a claim with objectives off, unknown, not open, not done or claimed already - changing nothing", () => {
    const s = withCity(founded(), { population: 150 });
    const refused = (x: SimState, oid: string, t = T): string => {
      const o = claimObjective(x, oid, t);
      expect(o.ok).toBe(false);
      expect(o.state).toBe(x);
      return o.reason!;
    };
    expect(refused(s, "city_first", OFF)).toMatch(/not part of this world/);
    expect(refused(s, "city_nope")).toMatch(/no objective/);
    expect(refused(s, "city_town")).toMatch(/opens once "Steady supply" is claimed/);
    expect(refused(s, "network_rail")).toMatch(/not done yet: 0 of 1 railways/);
    const claimed = claimObjective(s, "city_first", T);
    expect(claimed.ok).toBe(true);
    expect(refused(claimed.state, "city_first")).toMatch(/claimed already/);
  });

  it("pay once: settlers as many as there are homes, materials as much as there is room, credits to the bank", () => {
    let s = place(place(founded(), "habitat_dome", 10, 10), "habitat_dome", 14, 10);
    s = advance(s, 400, cfg);
    const homes = housing(first(s), T);
    expect(homes).toBe(2 * T.DOME_HOUSING);
    // 100 people would be more than two domes hold; set them in a city with 30 homes free.
    s = withCity(s, { population: homes - 30 });
    const t = makeTuning({ ...T, GOAL_FIRST_PEOPLE: 50 });
    const o = claimObjective(s, "city_first", t);
    expect(o.ok, o.reason ?? "").toBe(true);
    expect(o.people).toBe(30);
    expect(first(o.state).population).toBe(homes);
    expect(o.state.goals.claimed).toEqual(["city_first"]);
    // Credits: the planet's first goal, with its phase reached.
    const p = claimObjective({ ...o.state, phaseReached: 2 }, "planet_runaway", t);
    expect(p.credits).toBe(T.REWARD_RUNAWAY_CREDITS);
    expect(p.state.economy.credits - o.state.economy.credits).toBe(T.REWARD_RUNAWAY_CREDITS);
    expect(p.state.economy.earned - o.state.economy.earned).toBe(T.REWARD_RUNAWAY_CREDITS);
    // Materials, no more than the stores hold: a railway laid, then the city's stores set 25 short of full.
    const outpost = foundSettlement(withCity(p.state, { stores: { ...first(p.state).stores, materials: 400 } }), "outpost", SITE.lat, SITE.lon + 0.02, t);
    const rail = connectSettlements(outpost.state, id(p.state), outpost.settlement!.id, t);
    expect(rail.ok, rail.reason ?? "").toBe(true);
    const full = capacities(first(rail.state), t).materials;
    const near = withCity(rail.state, { stores: { ...first(rail.state).stores, materials: full - 25 } });
    const cap = claimObjective(near, "network_rail", t);
    expect(cap.ok, cap.reason ?? "").toBe(true);
    expect(cap.materials).toBe(25);
    expect(first(cap.state).stores.materials).toBe(full);
  });

  it("land rovers for good at the largest city's headquarters: more builds at once", () => {
    const s = { ...withCity(founded(), { population: 500 }), goals: { ...NO_GOALS, claimed: ["city_first", "city_steady"] } };
    const before = roverCount(first(s), T);
    const o = claimObjective(s, "city_town", T);
    expect(o.ok, o.reason ?? "").toBe(true);
    expect(o.rovers).toBe(T.REWARD_TOWN_ROVERS);
    expect(T.REWARD_TOWN_ROVERS).toBe(2);
    expect(roverCount(first(o.state), T)).toBe(before + 2);
  });

  it("unlock the metropolis with a city of 1,000, and gold markers with three cities joined", () => {
    let s = withCity(founded(), { population: 1000 });
    const refusedMetro = foundSettlement(s, "metropolis", -0.3, 0.5, T);
    expect(refusedMetro.ok).toBe(false);
    expect(refusedMetro.reason).toMatch(/A city of 1,000/);
    // Before objectives, and in a world without them, the simulation never refused one.
    expect(foundSettlement(s, "metropolis", -0.3, 0.5, OFF).ok).toBe(true);
    s = { ...s, goals: { ...s.goals, claimed: ["city_first", "city_steady", "city_town"] } };
    const c = claimObjective(s, "city_thousand", T);
    expect(c.ok, c.reason ?? "").toBe(true);
    expect(hasUnlock(c.state, "metropolis", T)).toBe(true);
    expect(foundSettlement(c.state, "metropolis", -0.3, 0.5, T).ok).toBe(true);
    expect(hasCosmetic(c.state, "gold_markers", T)).toBe(false);
    expect(objectiveById("network_three")!.reward(T).cosmetic).toBe("gold_markers");
  });

  it("count cities on one line, outposts carrying it, a lone city as no network", () => {
    let s = founded();
    expect(citiesJoined(s)).toBe(0);
    const outpost = foundSettlement(s, "outpost", SITE.lat, SITE.lon + 0.02, T);
    const b = foundSettlement(outpost.state, "city", SITE.lat, SITE.lon + 0.04, T);
    s = { ...b.state, settlements: b.state.settlements.map((x) => ({ ...x, stores: { ...x.stores, materials: 2000 } })) };
    const [a, o, c] = s.settlements.map((x) => x.id) as [string, string, string];
    s = connectSettlements(s, a, o, T).state;
    expect(citiesJoined(s)).toBe(0);
    s = connectSettlements(s, o, c, T).state;
    expect(citiesJoined(s)).toBe(2);
    // A city lost to the sea is not a city on the line.
    expect(citiesJoined({ ...s, settlements: s.settlements.map((x) => (x.id === c ? { ...x, lostAtSeaLevelM: 0 } : x)) })).toBe(0);
  });

  it("count steady years back from the latest, broken by any shortage or too few people", () => {
    const sample = (population: number, short: number[]) => ({ index: 0, population, housing: 400, births: 0, deaths: 0, short, stores: [0, 0, 0, 0, 0], net: [0, 0, 0, 0, 0] });
    const ok = [0, 0, 0, 0, 0];
    const c = { ...first(founded()), history: { acc: first(founded()).history.acc, taken: 5, samples: [sample(300, ok), sample(300, [0, 0, 0, 0.25, 0]), sample(300, ok), sample(150, ok), sample(300, ok), sample(300, ok)] } };
    expect(steadyYears(c, 200)).toBe(2);
    expect(steadyYears(c, 100)).toBe(4);
  });

  it("are off in a world without them: no status, every claim refused", () => {
    const s = withCity(founded(OFF), { population: 5000 });
    expect(objectiveStatus(s, OFF)).toEqual([]);
    for (const o of OBJECTIVES) expect(claimObjective(s, o.id, OFF).ok).toBe(false);
  });
});

describe("the first hour in the save", () => {
  it("survives the save exactly: the guide's latch, a skip, the claims - and nothing derived", () => {
    let s = advance(place(founded(), "solar_array", 10, 10), 2, cfg);
    s = skipGuide({ ...withCity(s, { extraRovers: 2 }), goals: { ...s.goals, claimed: ["city_first"] } });
    const saved = toSave(s, T, AT);
    expect(saved.goals).toEqual({ guide: s.goals.guide, guide_skipped: true, claimed: ["city_first"] });
    const back = deserialize(serialize(s, T, AT), T);
    expect(back).toEqual(s);
    expect(objectiveStatus(back, T)).toEqual(objectiveStatus(s, T));
  });

  it("loads a save from before it (v15) with nothing of the first hour done", () => {
    const s = place(founded(), "solar_array", 10, 10);
    const v16 = toSave(s, T, AT) as unknown as Record<string, unknown>;
    // As v15 wrote it: no record of the first hour, no rovers landed as a reward.
    const v15: Record<string, unknown> = {
      ...v16,
      schema_version: 15,
      settlements: (v16["settlements"] as Record<string, unknown>[]).map((raw) => {
        const { extra_rovers: _r, ...rest } = raw;
        void _r;
        return rest;
      }),
    };
    delete v15["goals"];
    const loaded = fromSave(v15, T);
    expect(loaded.goals).toEqual(NO_GOALS);
    expect(first(loaded).extraRovers).toBe(0);
    // Each city held from the sea for its grace on the way (v20, Batch 38): it was made before flooding.
    expect(loaded.settlements).toEqual(s.settlements.map((c) => ({ ...c, floodGraceYears: T.FLOOD_GRACE_YEARS })));
  });

  it("refuses a save whose record of the first hour is corrupt, naming the field", () => {
    const good = toSave(founded(), T, AT) as unknown as Record<string, unknown>;
    const bad = (goals: unknown): string => {
      try {
        fromSave({ ...good, goals }, T);
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error("loaded");
    };
    expect(bad({ guide: 1.5, guide_skipped: false, claimed: [] })).toMatch(/goals.guide/);
    expect(bad({ guide: 1, guide_skipped: "no", claimed: [] })).toMatch(/goals.guide_skipped/);
    expect(bad({ guide: 1, guide_skipped: false, claimed: ["a", "a"] })).toMatch(/twice/);
    expect(bad(null)).toMatch(/goals must be an object/);
  });
});
