/**
 * Batch 38 - detail §4.5's defences and the guard for old saves, proved
 * through a real `advance` on Batch 24's drowning fixture (the reference world
 * 1,200 years in; the sea climbs 0.706 m a substep under the import; the low
 * city's base 15.15 m above it, its fall at substep 37 undefended).
 *
 * The exit gate:
 *   - each defence measurably buys time: the crossing with the defence minus
 *     without, through a real `advance`;
 *   - a city can be saved by good play and lost by neglect, both by test;
 *   - loading a pre-flooding save with a city 10 m under the sea never loses
 *     it before its grace period ends.
 */

import { describe, expect, it } from "vitest";

import { siteElevation } from "../hypsometry.js";
import { advance, nextSubstepFlows } from "../integrate.js";
import { resume } from "../offline.js";
import { fromSave, serialize, toSave } from "../save.js";
import { liquidWaterRate } from "../sea-level.js";
import { makeTuning } from "../tuning.js";
import type { PlacedBuilding, Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { evacuateSettlement, terraceBuilding, terracePlan, threatened } from "./defences.js";
import { dikeHeightM, floodAlert, floodForecast, floodReading } from "./flood.js";
import { foundSettlement } from "./registry.js";
import { siteGround } from "./rocks.js";
import { checkPlacement, housing, placeBuilding, upgradeBuilding } from "./settlement.js";
import { tileKey } from "./space.js";
import { LOW, channels, fixture, rising, t } from "../../testkit/flood.js";

const START = fixture();
const BASE = siteElevation(LOW.lat, LOW.lon, t);
const LOW_ID = "settlement-1";
const HIGH_ID = "settlement-2";
/** The sea's climb a substep under the import, measured (Batch 24). */
const RISE_PER_SUBSTEP = 0.706;
/**
 * The wall's place: buildable ground at -0.5 m on the low city's first row. Low on purpose - on its first place
 * (+6 to +8 m) the water reached the wall's ground only as the city fell, and a wall the water took passed every test.
 */
const WALL = { tx: 10, ty: 0 } as const;
const still = { tuning: t, env: NEUTRAL_ENV, forcing: null };

function low(s: SimState): Settlement {
  return s.settlements.find((c) => c.id === LOW_ID)!;
}

/** The substep the low city falls at, raising the sea from `s` (-1 if it stands through `limit`). */
function fallAt(s0: SimState, limit = 120): number {
  let s = s0;
  for (let i = 0; i < limit; i += 1) {
    if (low(s).lostAtSeaLevelM !== null) return i;
    s = advance(s, 1, rising);
  }
  return -1;
}

/** The substep the low city's building at `key` is lost at. */
function lostAt(s0: SimState, key: string, limit = 80): number {
  let s = s0;
  for (let i = 0; i < limit; i += 1) {
    if (!low(s).buildings.some((b) => `${b.tx},${b.ty}` === key)) return i;
    s = advance(s, 1, rising);
  }
  return -1;
}

function withWall(level: number, s0 = START): SimState {
  let s = placeBuilding(s0, LOW_ID, "seawall", WALL.tx, WALL.ty, t).state;
  for (let l = 1; l < level; l += 1) s = upgradeBuilding(s, LOW_ID, WALL.tx, WALL.ty, t).state;
  return s;
}

function edit(s: SimState, id: string, f: (c: Settlement) => Settlement): SimState {
  return { ...s, settlements: s.settlements.map((c) => (c.id === id ? f(c) : c)) };
}

/** A headquarters for the low city's rovers, on open ground at (20, 19) (found by searching). */
function withGarage(s: SimState): SimState {
  return edit(s, LOW_ID, (c) => ({ ...c, buildings: [...c.buildings, { type: "headquarters", tx: 20, ty: 19, level: 1 } satisfies PlacedBuilding] }));
}

describe("the Seawall raises the city's datum (detail §4.2, §4.5)", () => {
  it("holds the city's fall back by the height each level adds, through a real advance", () => {
    expect(low(START).buildings.length).toBeGreaterThan(0);
    const none = fallAt(START);
    // Measured: 37 undefended; 43, 49 and 60 with the wall at levels 1, 2 and 4 - DIKE_M_PER_LEVEL (4 m) a
    // level is 5.67 substeps of the import's 0.706 m.
    expect(none).toBe(37);
    for (const level of [1, 2, 4]) {
      const s = withWall(level);
      expect(dikeHeightM(low(s), t)).toBe(level * t.DIKE_M_PER_LEVEL);
      const bought = fallAt(s) - none;
      expect(Math.abs(bought - (level * t.DIKE_M_PER_LEVEL) / RISE_PER_SUBSTEP), `level ${level} bought ${bought} substeps`).toBeLessThanOrEqual(1);
    }
    // Recorded at the sea it fell to: the threshold over the effective base, not the bare one.
    let s = withWall(2);
    for (let i = 0; i < 60 && low(s).lostAtSeaLevelM === null; i += 1) s = advance(s, 1, rising);
    expect(low(s).lostAtSeaLevelM! - BASE).toBeGreaterThanOrEqual(2 * t.DIKE_M_PER_LEVEL + t.FLOOD_THRESHOLD_M);
  });

  it("keeps the tiles below the wall's height dry, and the states read from the effective base", () => {
    // 26 substeps up the sea stands 3.3 m over the base: undefended the city is in partial flood, walled 8 m it is warned.
    let s = START;
    for (let i = 0; i < 26; i += 1) s = advance(s, 1, rising);
    const walled = withWall(2, s);
    const bare = floodReading(low(s), channels(s), t);
    const held = floodReading(low(walled), channels(walled), t);
    const heights = siteGround(low(s), t).heightM;
    const wet = (r: typeof bare): number => (r.wet ?? []).filter(Boolean).length;
    expect(wet(bare)).toBeGreaterThan(100);
    expect(wet(held)).toBeLessThan(wet(bare));
    // Exactly the tiles more than the wall's 8 m below the sea are wet behind it.
    heights.forEach((h, i) => expect(held.wet?.[i] ?? false, `tile ${i} at ${h.toFixed(2)} m`).toBe(bare.seaM! - 8 > BASE + h));
    expect(held.depthM).toBeCloseTo(bare.depthM! - 8, 9);
    expect(bare.state).toBe("partial");
    expect(held.state).toBe("warning");
  });

  it("moves the forecast by the wall's height: walled, the crossings come as much later as the fall does", () => {
    const rate = liquidWaterRate(nextSubstepFlows(START, rising));
    const bare = floodForecast(low(START), START.reservoirs, rate, t)!;
    const walled = withWall(2);
    const held = floodForecast(low(walled), walled.reservoirs, rate, t)!;
    // The wall's 8 m is 11.3 substeps of the import; the fall came 12 later (above). Forecast to a quarter-substep.
    const shift = (held.yearsToDestroy! - bare.yearsToDestroy!) / t.SUBSTEP_YEARS;
    expect(shift).toBeGreaterThan(10.5);
    expect(Math.abs(shift - (fallAt(walled) - fallAt(START)))).toBeLessThanOrEqual(1);
    expect((held.yearsToBase! - bare.yearsToBase!) / t.SUBSTEP_YEARS).toBeCloseTo(shift, 0);
  });

  it("counts only once built: a worksite holds nothing back, an upgrade on its way keeps the level it has", () => {
    const s = withWall(1);
    const key = tileKey(WALL.tx, WALL.ty);
    const rising_ = edit(s, LOW_ID, (c) => ({ ...c, jobs: [...c.jobs, { kind: "build", tile: key, work: 1, total: 2, remaining: 2, upgrade: false }] }));
    expect(dikeHeightM(low(rising_), t)).toBe(0);
    const queued = edit(s, LOW_ID, (c) => ({ ...c, buildQueue: [{ tile: key, upgrade: false, paid: 200 }] }));
    expect(dikeHeightM(low(queued), t)).toBe(0);
    const upgrading = edit(s, LOW_ID, (c) => ({ ...c, jobs: [...c.jobs, { kind: "build", tile: key, work: 1, total: 2, remaining: 2, upgrade: true }] }));
    expect(dikeHeightM(low(upgrading), t)).toBe(t.DIKE_M_PER_LEVEL);
  });

  it("is one a city - a second is refused, and the first raised instead", () => {
    const s = withWall(1);
    const spot = [...Array(30 * 30).keys()].map((k) => ({ tx: k % 30, ty: Math.floor(k / 30) })).find(({ tx, ty }) => checkPlacement(s, LOW_ID, "storage_depot", tx, ty, t).ok && checkPlacement(s, LOW_ID, "storage_depot", tx + 2, ty, t).ok && tx > 6);
    expect(spot).toBeDefined();
    const second = placeBuilding(s, LOW_ID, "seawall", spot!.tx, spot!.ty, t);
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/a city has one Seawall - upgrade it/);
    // Reachable at all: the high city, which has none, may build one.
    expect(placeBuilding(s, HIGH_ID, "seawall", 2, 0, t).ok || placeBuilding(s, HIGH_ID, "seawall", spot!.tx, spot!.ty, t).ok).toBe(true);
  });

  it("stands while its own ground is under water: the city falls with it, not before", () => {
    // The wall's highest tile is about -0.4 m: at level 1 the water stands 2 m over it from the sea at +5.6 m, and
    // the city holds until +14 m. Were the wall taken by the water over its ground, the dike would go with it.
    const heights = siteGround(low(START), t).heightM;
    const top = Math.max(...[0, 1, 2].map((k) => heights[WALL.ty * 32 + WALL.tx + k]!));
    expect(top).toBeLessThan(0);
    let s = withWall(1);
    let wetUnderWall = 0;
    for (let i = 0; i < 80 && low(s).lostAtSeaLevelM === null; i += 1) {
      const r = floodReading(low(s), channels(s), t);
      const sea = r.seaM!;
      if (sea - t.DIKE_M_PER_LEVEL > BASE + top + t.FLOOD_BUILDING_LOSS_M) {
        wetUnderWall += 1;
        expect(low(s).buildings.some((b) => b.type === "seawall"), `substep ${i}`).toBe(true);
      }
      s = advance(s, 1, rising);
    }
    expect(wetUnderWall, "the water stood over the wall's ground before the city fell").toBeGreaterThan(0);
  });
});

describe("terracing raises a building's ground (detail §1.3, §4.5)", () => {
  const S = withGarage(START);

  it("raises the whole footprint TERRACE_STEP_M over its highest corner, paid by the metre, when the rover is home", () => {
    const plan = terracePlan(low(S), 0, 15, t)!;
    const ground = siteGround(low(S), t);
    const m = ground.tiles + 1;
    const top = Math.max(ground.cornersM[15 * m]!, ground.cornersM[15 * m + 1]!, ground.cornersM[16 * m]!, ground.cornersM[16 * m + 1]!);
    expect(plan.levelM).toBeCloseTo(Math.ceil((top + t.TERRACE_STEP_M) * 10) / 10, 9);
    expect(plan.materials).toBe(Math.ceil((plan.levelM - ground.heightM[15 * ground.tiles]!) * t.TERRACE_MATERIALS_PER_M));
    const o = terraceBuilding(S, LOW_ID, 0, 15, t);
    expect(o.ok, o.reason ?? "").toBe(true);
    expect(low(o.state).stores.materials).toBe(low(S).stores.materials - plan.materials);
    // Not yet: the rover is out.
    expect(siteGround(low(o.state), t).heightM[15 * ground.tiles]).toBe(ground.heightM[15 * ground.tiles]);
    let s = o.state;
    for (let i = 0; i < 8; i += 1) s = advance(s, 1, still);
    expect(low(s).jobs).toEqual([]);
    expect(siteGround(low(s), t).heightM[15 * ground.tiles]).toBeCloseTo(plan.levelM, 9);
    // A 3 x 3 footprint: every tile of it, one height.
    const big = terraceBuilding(S, LOW_ID, 14, 14, t);
    expect(big.ok, big.reason ?? "").toBe(true);
    let b = big.state;
    for (let i = 0; i < 20; i += 1) b = advance(b, 1, still);
    const g = siteGround(low(b), t);
    const target = terracePlan(low(S), 14, 14, t)!.levelM;
    const plant = low(S).buildings.find((x) => x.tx <= 14 && x.ty <= 14 && 14 < x.tx + BUILDING_DEFS[x.type].footprint && 14 < x.ty + BUILDING_DEFS[x.type].depth)!;
    const def = BUILDING_DEFS[plant.type];
    expect(def.footprint * def.depth).toBeGreaterThan(1);
    for (let y = plant.ty; y < plant.ty + def.depth; y += 1) for (let x = plant.tx; x < plant.tx + def.footprint; x += 1) expect(g.heightM[y * g.tiles + x], `${x},${y}`).toBeCloseTo(target, 9);
  });

  it("buys the building time: it is lost later by the height it was raised, through a real advance", () => {
    const plan = terracePlan(low(S), 0, 15, t)!;
    const before = lostAt(S, "0,15");
    const after = lostAt(terraceBuilding(S, LOW_ID, 0, 15, t).state, "0,15");
    // Measured: lost at substep 11, terraced at 14 - it was raised 2.27 m, 3.2 substeps of the import.
    expect(before).toBe(11);
    expect(Math.abs(after - before - plan.raisedM / RISE_PER_SUBSTEP)).toBeLessThanOrEqual(1);
  });

  it("is refused without a rover, for a building still going up, twice at once, or short of materials", () => {
    expect(terraceBuilding(START, LOW_ID, 0, 15, t).reason).toMatch(/no headquarters/);
    expect(terraceBuilding(S, LOW_ID, 1, 2, t).reason).toMatch(/no building there/);
    const once = terraceBuilding(S, LOW_ID, 0, 15, t).state;
    expect(terraceBuilding(once, LOW_ID, 0, 15, t).reason).toMatch(/already raising/);
    const poor = edit(S, LOW_ID, (c) => ({ ...c, stores: { ...c.stores, materials: 1 } }));
    expect(terraceBuilding(poor, LOW_ID, 0, 15, t).reason).toMatch(/needs \d+ materials, 1 available/);
    const site = edit(S, LOW_ID, (c) => ({ ...c, jobs: [...c.jobs, { kind: "build", tile: tileKey(0, 15), work: 1, total: 2, remaining: 2, upgrade: false }] }));
    expect(terraceBuilding(site, LOW_ID, 0, 15, t).reason).toMatch(/still being built/);
  });
});

/**
 * Homes in both cities: two domes each, the low city's full and on its high ground (its highest tile 6 m or more,
 * so a wall two levels high keeps them through the sea at +15 m), the high city's empty.
 */
function peopled(): SimState {
  let s = START;
  const heights = siteGround(low(START), t).heightM;
  const highest = (tx: number, ty: number): number => Math.max(...[0, 1, 2].flatMap((dy) => [0, 1, 2].map((dx) => heights[(ty + dy) * 32 + tx + dx] ?? -99)));
  for (const id of [LOW_ID, HIGH_ID]) {
    let placed = 0;
    for (let k = 0; k < 32 * 32 && placed < 2; k += 1) {
      const tx = k % 32;
      const ty = Math.floor(k / 32);
      // Clear of the wall's place along the low city's first row.
      if ((id === LOW_ID && (highest(tx, ty) < 6 || ty < 1)) || !checkPlacement(s, id, "habitat_dome", tx, ty, t).ok) continue;
      s = placeBuilding(s, id, "habitat_dome", tx, ty, t).state;
      placed += 1;
    }
    expect(placed).toBe(2);
  }
  return edit(s, LOW_ID, (c) => ({ ...c, population: housing(c, t) }));
}

describe("evacuation moves the people to safety (detail §4.5, conflict 8)", () => {
  const rate = liquidWaterRate(nextSubstepFlows(START, rising));

  it("sends them to the nearest city the sea does not threaten, as many as it has homes for; the rest stay", () => {
    const s = peopled();
    const people = low(s).population;
    const room = housing(s.settlements[1]!, t) - s.settlements[1]!.population;
    expect(people).toBeGreaterThan(0);
    expect(threatened(s, low(s), rate, t)).toBe(true);
    const crowded = edit(s, HIGH_ID, (c) => ({ ...c, population: housing(c, t) - people / 2 }));
    const o = evacuateSettlement(crowded, LOW_ID, rate, t);
    expect(o.ok, o.reason ?? "").toBe(true);
    expect(o.moved).toBeCloseTo(people / 2, 9);
    expect(o.to).toEqual([{ id: HIGH_ID, people: people / 2 }]);
    expect(low(o.state).population).toBeCloseTo(people / 2, 9);
    expect(o.state.settlements[1]!.population).toBeCloseTo(housing(s.settlements[1]!, t), 9);
    expect(low(o.state).evacuated).toBe(true);
    // All of them, with room for all.
    const all = evacuateSettlement(s, LOW_ID, rate, t);
    expect(all.moved).toBe(people);
    expect(room).toBeGreaterThanOrEqual(people);
  });

  it("leaves the city to the sea: no settlers come and it does not grow again", () => {
    const o = evacuateSettlement(peopled(), LOW_ID, rate, t);
    let s = o.state;
    for (let i = 0; i < 16; i += 1) {
      s = advance(s, 1, still);
      expect(low(s).population, `substep ${i}`).toBe(0);
    }
    // Reachable: the same city not evacuated takes settlers on its empty homes.
    let open = edit(peopled(), LOW_ID, (c) => ({ ...c, population: 0 }));
    for (let i = 0; i < 16; i += 1) open = advance(open, 1, still);
    expect(low(open).population).toBeGreaterThan(0);
  });

  it("is refused for a city the sea does not threaten, and with nowhere to go", () => {
    const s = peopled();
    const high = edit(s, HIGH_ID, (c) => ({ ...c, population: 20 }));
    expect(threatened(high, high.settlements[1]!, rate, t)).toBe(false);
    expect(evacuateSettlement(high, HIGH_ID, rate, t).reason).toMatch(/does not threaten it/);
    const full = edit(s, HIGH_ID, (c) => ({ ...c, population: housing(c, t) }));
    expect(evacuateSettlement(full, LOW_ID, rate, t).reason).toMatch(/no city out of the sea's way has homes/);
    // A city with room that the sea threatens too (held by its grace) is no refuge.
    const doomed = edit(s, HIGH_ID, (c) => ({ ...c, floodGraceYears: 5 }));
    expect(threatened(doomed, doomed.settlements[1]!, rate, t)).toBe(true);
    expect(evacuateSettlement(doomed, LOW_ID, rate, t).reason).toMatch(/no city out of the sea's way has homes/);
    const off = makeTuning({ ...t, FLOODING_ENABLED: 0 });
    expect(evacuateSettlement(s, LOW_ID, rate, off).reason).toMatch(/floods nothing/);
  });
});

describe("a city saved by good play and lost by neglect", () => {
  /**
   * People here die only by the sea: neither city makes life support (Batch 24's fixture never needed it), so
   * with the decline on, the people of every city - saved or not - were gone within 40 years. Off, what the
   * sea takes is all that is lost.
   */
  const calm = makeTuning({ ...t, MICRO_DECLINE_RATE: 0 });
  /** The import until the sea stands 15 m over the low city's base, then the sea still - and on to 200 substeps. */
  function flood(s0: SimState, act: (s: SimState) => SimState = (s) => s): SimState {
    let s = act(s0);
    for (let i = 0; i < 200; i += 1) s = advance(s, 1, channels(s).seaLevelM < BASE + 15 ? { ...rising, tuning: calm } : { ...still, tuning: calm });
    return s;
  }

  it("neglected, the city falls with its people", () => {
    const end = flood(peopled());
    expect(channels(end).seaLevelM - BASE).toBeGreaterThanOrEqual(15);
    expect(low(end).lostAtSeaLevelM).not.toBeNull();
    expect(low(end).population).toBe(0);
  });

  it("walled two levels high in time, it stands with its people; evacuated, it falls but its people live on", () => {
    const people = low(peopled()).population;
    const walled = flood(peopled(), (s) => {
      const w = withWall(2, s);
      expect(dikeHeightM(low(w), t)).toBe(8);
      return w;
    });
    expect(channels(walled).seaLevelM - BASE).toBeGreaterThanOrEqual(15);
    expect(low(walled).lostAtSeaLevelM).toBeNull();
    expect(low(walled).population).toBe(people);
    const rate = liquidWaterRate(nextSubstepFlows(START, rising));
    const gone = flood(peopled(), (s) => evacuateSettlement(s, LOW_ID, rate, t).state);
    expect(low(gone).lostAtSeaLevelM).not.toBeNull();
    expect(gone.settlements[1]!.population).toBe(people);
  });
});

/** The low city under the sea by `metres` - raised with flooding off, so it was never lost - saved as v19. */
function preFloodingSave(metres: number): { save: Record<string, unknown>; sea: number } {
  const off = makeTuning({ ...t, FLOODING_ENABLED: 0 });
  let s = START;
  while (channels(s).seaLevelM < BASE + metres) s = advance(s, 1, { ...rising, tuning: off });
  const v20 = toSave(s, off, "2026-10-16T09:00:00.000Z") as unknown as Record<string, unknown>;
  const settlements = (v20["settlements"] as Record<string, unknown>[]).map(({ flood_grace_years: _g, evacuated: _e, ...rest }) => rest);
  return { save: { ...v20, schema_version: 19, settlements }, sea: channels(s).seaLevelM };
}

describe("a city found under the sea on loading is given a grace period (GAME_PLAN Batch 38's exit gate)", () => {
  const { save, sea } = preFloodingSave(10);
  const graceSteps = Math.round(t.FLOOD_GRACE_YEARS / t.SUBSTEP_YEARS);

  it("never loses it before its grace ends: 10 m under, it stands every substep of the grace, warned, and falls after", () => {
    expect(sea - BASE).toBeGreaterThanOrEqual(10);
    const loaded = fromSave(save, t);
    expect(low(loaded).floodGraceYears).toBe(t.FLOOD_GRACE_YEARS);
    expect(low(loaded).buildings.length).toBeGreaterThan(0);
    const rate = liquidWaterRate(nextSubstepFlows(loaded, still));
    let s = loaded;
    for (let i = 0; i < graceSteps; i += 1) {
      expect(low(s).lostAtSeaLevelM, `substep ${i}`).toBeNull();
      expect(low(s).buildings.length, `substep ${i}`).toBe(low(loaded).buildings.length);
      const forecast = floodForecast(low(s), s.reservoirs, rate, t);
      expect(floodAlert(forecast, floodReading(low(s), channels(s), t), t), `warned at substep ${i}`).toBe(true);
      expect(forecast!.graceYears).toBeCloseTo((t.FLOOD_GRACE_YEARS - i * t.SUBSTEP_YEARS) / t.CITY_CLOCK, 9);
      s = advance(s, 1, still);
    }
    // Spent: the next substep the sea takes it.
    expect(low(s).floodGraceYears).toBe(0);
    expect(low(s).lostAtSeaLevelM).toBeNull();
    s = advance(s, 1, still);
    expect(low(s).lostAtSeaLevelM).not.toBeNull();
  });

  it("is what saves it: the same city with no grace (a save made since) falls on its first substep", () => {
    const loaded = fromSave(save, t);
    const bare = edit(loaded, LOW_ID, (c) => ({ ...c, floodGraceYears: 0 }));
    expect(low(advance(bare, 1, still)).lostAtSeaLevelM).not.toBeNull();
  });

  it("counts down the same in one call, a substep at a time, and offline", () => {
    // A shorter grace, so it ends inside the two hours away the offline cap grants (130 substeps).
    const short = makeTuning({ ...t, FLOOD_GRACE_YEARS: 20 });
    const still = { tuning: short, env: NEUTRAL_ENV, forcing: null };
    const graceSteps = Math.round(short.FLOOD_GRACE_YEARS / short.SUBSTEP_YEARS);
    const loaded = fromSave(save, short);
    expect(low(loaded).floodGraceYears).toBe(20);
    const n = graceSteps + 3;
    let stepped = loaded;
    for (let i = 0; i < n; i += 1) stepped = advance(stepped, 1, still);
    expect(advance(loaded, n, still)).toEqual(stepped);
    const at = Date.parse("2026-10-16T09:00:00.000Z");
    const back = resume(JSON.parse(serialize(loaded, short, "2026-10-16T09:00:00.000Z")) as unknown, at + 2 * 3600_000, still);
    const steps = Math.round(back.grant.grantedSimYears / t.SUBSTEP_YEARS);
    expect(steps).toBeGreaterThan(graceSteps);
    expect(back.state).toEqual(advance(loaded, steps, still));
    expect(low(back.state).lostAtSeaLevelM, "lost while away, after its grace").not.toBeNull();
  });

  it("keeps an evacuated city evacuated through a save", () => {
    const loaded = fromSave(save, t);
    const evacuated = edit(loaded, LOW_ID, (c) => ({ ...c, evacuated: true }));
    expect(low(fromSave(JSON.parse(serialize(evacuated, t, "2026-10-16T09:00:00.000Z")) as unknown, t)).evacuated).toBe(true);
    expect(low(fromSave(JSON.parse(serialize(loaded, t, "2026-10-16T09:00:00.000Z")) as unknown, t)).evacuated).toBe(false);
  });

  it("gives a ruin none, and a save made since keeps what it had", () => {
    const loaded = fromSave(save, t);
    const fell = advance(loaded, graceSteps + 1, still);
    expect(low(fell).lostAtSeaLevelM).not.toBeNull();
    const again = fromSave(JSON.parse(serialize(fell, t, "2026-10-16T09:00:00.000Z")) as unknown, t);
    expect(low(again).floodGraceYears).toBe(0);
    const mid = advance(loaded, 10, still);
    expect(low(fromSave(JSON.parse(serialize(mid, t, "2026-10-16T09:00:00.000Z")) as unknown, t)).floodGraceYears).toBeCloseTo(t.FLOOD_GRACE_YEARS - 10 * t.SUBSTEP_YEARS, 9);
  });
});

describe("founding where the sea floods (Batch 38)", () => {
  it("refuses a city under the sea, and founds one above it", () => {
    // 1,200 years in, the sea stands at -3,091 m. A site under it, found by stepping south of the low city.
    const sea = channels(START).seaLevelM;
    let under: { lat: number; lon: number } | null = null;
    for (let k = 1; k < 400 && under === null; k += 1) {
      const site = { lat: LOW.lat - k * 0.002, lon: LOW.lon };
      if (siteElevation(site.lat, site.lon, t) < sea) under = site;
    }
    expect(under).not.toBeNull();
    const o = foundSettlement(START, "city", under!.lat, under!.lon, t);
    expect(o.ok).toBe(false);
    expect(o.reason).toMatch(/The sea covers that place/);
    expect(foundSettlement(START, "city", LOW.lat, LOW.lon, t).ok).toBe(true);
    // Where the sea floods nothing, the old rule: founded.
    expect(foundSettlement(START, "city", under!.lat, under!.lon, makeTuning({ ...t, FLOODING_ENABLED: 0 })).ok).toBe(true);
  });
});

describe("the Seawall as data", () => {
  it("is a 3 x 1 wall any settlement may build, locked where the sea floods nothing", () => {
    const def = BUILDING_DEFS.seawall;
    expect([def.footprint, def.depth]).toEqual([3, 1]);
    expect(def.kinds).toEqual(["city", "outpost", "metropolis"]);
    expect(def.locked(channels(START), t)).toBeNull();
    expect(def.locked(channels(START), makeTuning({ ...t, FLOODING_ENABLED: 0 }))).toMatch(/floods nothing/);
  });
});
