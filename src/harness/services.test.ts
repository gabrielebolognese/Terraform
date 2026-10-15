/**
 * The example's services pass (Batch 32) on a small city of its own, quick
 * enough to break: the example planet itself takes minutes to build.
 */

import { describe, expect, it } from "vitest";

import type { PlacedBuilding, Settlement, SimState } from "../sim/index.js";
import { BUILDING_DEFS, NEUTRAL_ENV, derive, foundSettlement, frameOf, habitat, makeTuning, marsStart, networkOf, readNeeds, settlementStep, tileKey, worldEnv } from "../sim/index.js";
import { serveCity } from "./services.js";

/** Stores so deep nothing runs short: what is tested is where the services go. */
const DEEP = { MICRO_CAP_POWER: 1e9, MICRO_CAP_WATER: 1e9, MICRO_CAP_OXYGEN: 1e9, MICRO_CAP_FOOD: 1e9, MICRO_CAP_MATERIALS: 1e9 } as const;
const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, NETWORK_ENABLED: 1, METROPOLIS_GRID_TILES: 96, NEEDS_ENABLED: 1, ...DEEP });

/**
 * A metropolis of 4,000 people (homes for 6,240) round its headquarters, as
 * most of the example is (a city's own founding square keeps its streets,
 * which blocks wall to wall cannot): domes wall to wall in four blocks, a
 * row of geothermal plants, water extractors and greenhouses under each, a
 * corridor and a cable round each block.
 */
function town(): { state: SimState; city: Settlement } {
  const founded = foundSettlement(marsStart(undefined, T), "metropolis", 0.31, -1.2, T).state;
  const c = founded.settlements[0]!;
  const extra: PlacedBuilding[] = [];
  const links: number[] = [];
  for (const [bx, by] of [[6, 6], [60, 6], [6, 60], [60, 60]] as const) {
    // A block of 6 x 6 domes (18 x 18 tiles), then a row of plants, extractors and greenhouses under it.
    for (let j = 0; j < 6; j += 1) for (let i = 0; i < 6; i += 1) extra.push({ type: "habitat_dome", tx: bx + 3 * i, ty: by + 3 * j, level: 1 });
    for (let i = 0; i < 9; i += 1) extra.push({ type: i % 3 === 0 ? "geothermal_plant" : i % 3 === 1 ? "water_extractor" : "greenhouse", tx: bx + 2 * i, ty: by + 18, level: 1 });
    // A corridor ring round the block.
    for (let x = bx - 1; x <= bx + 18; x += 1) links.push(tileKey(x, by - 1), tileKey(x, by + 20));
    for (let y = by; y < by + 20; y += 1) links.push(tileKey(bx - 1, y), tileKey(bx + 18, y));
  }
  // Two rows of domes against the headquarters' south wall: a provider over the headquarters would lose no home.
  for (let j = 0; j < 2; j += 1) for (let i = 0; i < 6; i += 1) extra.push({ type: "habitat_dome", tx: 41 + 3 * i, ty: 51 + 3 * j, level: 1 });
  // Each block's ring joined to the headquarters by a corridor along row 40 and column 40.
  for (let x = 4; x <= 80; x += 1) links.push(tileKey(x, 40));
  for (let y = 4; y <= 80; y += 1) links.push(tileKey(40, y));
  const sorted = [...new Set(links)].filter((k) => !c.buildings.some((b) => b.tx <= (k & 1023) && (k & 1023) < b.tx + 5 && b.ty <= k >> 10 && k >> 10 < b.ty + 5)).sort((a, b) => a - b);
  const city: Settlement = { ...c, buildings: [...c.buildings, ...extra], corridors: sorted, cables: sorted, population: 4000, stores: { power: 1e8, water: 1e8, oxygen: 1e8, food: 1e8, materials: 400 } };
  return { state: { ...founded, settlements: [city] }, city };
}

describe("the services pass", () => {
  const { state, city } = town();
  const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, T), T), T, 0);
  const { settlement: served, report } = serveCity(city, env, T);
  const n = frameOf(served, T).n;

  it("keeps the headquarters and the spaceport, and every two buildings joined before joined still", () => {
    for (const type of ["headquarters", "spaceport"] as const) expect(served.buildings.filter((b) => b.type === type), type).toEqual(city.buildings.filter((b) => b.type === type));
    for (const layer of ["corridors", "cables"] as const) {
      const before = networkOf(city.buildings, city[layer], n);
      const after = networkOf(served.buildings, served[layer], n);
      const now = new Map(served.buildings.map((b, i) => [b, after.of[i]!]));
      // Each network of before: what is left of it stands on one network now.
      const left = new Map<number, Set<number>>();
      city.buildings.forEach((b, i) => {
        const at = now.get(b);
        if (at === undefined) return;
        left.set(before.of[i]!, (left.get(before.of[i]!) ?? new Set()).add(at));
      });
      expect([...left.values()].filter((v) => v.size > 1).length, layer).toBe(0);
      // And something was replaced, so the check had something to keep (vacuity).
      expect(served.buildings.filter((b) => !city.buildings.includes(b)).length).toBeGreaterThan(0);
    }
  });

  it("lays a corridor and a cable wherever a replaced building stood beyond what replaced it", () => {
    const under = new Set<number>();
    for (const b of served.buildings) {
      const d = BUILDING_DEFS[b.type];
      for (let y = b.ty; y < b.ty + d.depth; y += 1) for (let x = b.tx; x < b.tx + d.footprint; x += 1) under.add(tileKey(x, y));
    }
    const corridors = new Set(served.corridors);
    const cables = new Set(served.cables);
    const left: number[] = [];
    for (const b of city.buildings) {
      if (served.buildings.includes(b)) continue;
      const d = BUILDING_DEFS[b.type];
      for (let y = b.ty; y < b.ty + d.depth; y += 1) for (let x = b.tx; x < b.tx + d.footprint; x += 1) if (!under.has(tileKey(x, y))) left.push(tileKey(x, y));
    }
    // Measured: some ground is left beyond the providers (they cut buildings).
    expect(left.length).toBeGreaterThan(0);
    expect(left.filter((k) => !corridors.has(k) || !cables.has(k))).toEqual([]);
  });

  it("puts services among the homes: every need the town asks for met for every home - green space by a biosphere, parks not yet running", () => {
    expect(Object.values(report.placed).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(0);
    const step = settlementStep(served, env, T, T.SUBSTEP_YEARS);
    const needs = readNeeds(served, step.operable, new Set(), null, T)!;
    expect(needs.needs.filter((x) => x.asked).map((x) => x.id)).toEqual(["green", "variety", "medical", "research"]);
    for (const x of needs.needs) if (x.asked) expect(x.met, x.id).toBe(1);
    // And before, they were not (vacuity).
    const was = readNeeds(city, settlementStep(city, env, T, T.SUBSTEP_YEARS).operable, new Set(), null, T)!;
    expect(was.needs.filter((x) => x.asked && x.met < 1).length).toBeGreaterThan(2);
  });
});

describe("what a city keeps", () => {
  it("never takes the headquarters or a spaceport, even where no other ground has room", () => {
    // A row of domes under the headquarters and corridors on every other free tile: the only ground a 5 x 5
    // Medical Center could stand on is over the headquarters (with the domes under it).
    const founded = foundSettlement(marsStart(undefined, T), "metropolis", 0.31, -1.2, T).state;
    const c = founded.settlements[0]!;
    const hq = c.buildings.find((b) => b.type === "headquarters")!;
    const domes: PlacedBuilding[] = [0, 1, 2].map((i) => ({ type: "habitat_dome", tx: hq.tx - 1 + 3 * i, ty: hq.ty + 5, level: 1 }));
    const buildings = [...c.buildings, ...domes];
    const n = frameOf(c, T).n;
    const taken = new Set<number>();
    for (const b of buildings) {
      const d = BUILDING_DEFS[b.type];
      for (let y = b.ty; y < b.ty + d.depth; y += 1) for (let x = b.tx; x < b.tx + d.footprint; x += 1) taken.add(tileKey(x, y));
    }
    const links: number[] = [];
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (!taken.has(tileKey(x, y))) links.push(tileKey(x, y));
    const city: Settlement = { ...c, buildings, corridors: links, cables: links, population: 2500, stores: { power: 1e8, water: 1e8, oxygen: 1e8, food: 1e8, materials: 400 } };
    const state: SimState = { ...founded, settlements: [city] };
    const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, T), T), T, 0);
    const { settlement, report } = serveCity(city, env, T);
    for (const type of ["headquarters", "spaceport"] as const) expect(settlement.buildings.filter((b) => b.type === type), type).toEqual(city.buildings.filter((b) => b.type === type));
    // It was asked for, and found no room (vacuity: the headquarters' ground was the only place).
    expect(report.unserved.medical ?? 0).toBeGreaterThan(0);
  });
});
