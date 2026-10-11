/**
 * Batch 26's exit gate, first line - detail §2: "The same `(type, seed,
 * level)` always gives the same instance list, and nothing about the geometry
 * is saved" - with the rest of what §2 asks of the generator: each building
 * its own within its archetype, and complexity that grows with level.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { BuildingType, SimState } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, NEUTRAL_ENV, claimLand, cityView, derive, deserialize, foundSettlement, habitat, makeTuning, marsStart, placeBuilding, serialize, worldEnv } from "../sim/index.js";
import { maxLevel } from "../sim/micro/buildings.js";
import { buildingStructure, cityScene, structureOf } from "./city.js";
import { greebleBudget } from "./structures.js";

const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 64 });
const of = (type: BuildingType, seed: number, level: number) => structureOf(type, seed, level, BUILDING_DEFS[type].footprint, BUILDING_DEFS[type].depth);

const random = Math.random;
afterEach(() => {
  Math.random = random;
});

describe("the generator", () => {
  it("gives every type the same structure for the same seed and level - and never asks Math.random", () => {
    const first = BUILDING_TYPES.map((type) => [of(type, 7, 1), of(type, 7, maxLevel(type, T))]);
    // Poisoned: a generator that drew from Math.random would throw, or differ.
    Math.random = () => {
      throw new Error("Math.random in the structure generator");
    };
    const again = BUILDING_TYPES.map((type) => [of(type, 7, 1), of(type, 7, maxLevel(type, T))]);
    expect(again).toEqual(first);
    expect(first.flat().reduce((n, s) => n + s.instances.length, 0), "vacuity: greebles made").toBeGreaterThan(300);
  });

  it("makes each building its own: the seed moves the signature within its archetype, and the greebles", () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i * 7919 + 13);
    const reactors = seeds.map((s) => of("reactor", s, 1));
    // Measured over 60 seeds: one tower and two both occur; tower heights span 1.10 to 1.42 tiles.
    expect(new Set(reactors.map((r) => r.variant.towers))).toEqual(new Set([1, 2]));
    const heights = reactors.map((r) => r.variant.towerZ);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.2);
    const wells = seeds.map((s) => of("water_extractor", s, 1));
    expect(new Set(wells.map((w) => w.variant.tanks))).toEqual(new Set([1, 2]));
    const domes = seeds.map((s) => of("habitat_dome", s, 1));
    expect(new Set(domes.map((d) => d.variant.ribs)).size).toBe(3);
    // No two of the sixty geothermal plants carry the same greebles.
    const kits = seeds.map((s) => JSON.stringify(of("geothermal_plant", s, 1).instances));
    expect(new Set(kits).size).toBe(seeds.length);
  });

  it("grows more complex with every level: more greebles, and the signature's extra towers, tanks and annexes", () => {
    for (const type of BUILDING_TYPES) {
      if (greebleBudget(type, 1) === 0) continue;
      const counts = [1, maxLevel(type, T)].map((level) => {
        let n = 0;
        for (let seed = 1; seed <= 20; seed += 1) n += of(type, seed, level).instances.length;
        return n / 20;
      });
      // Measured: every type carries 2.29 (a 1 x 1 depot, whose roof fills up) to 7.2 times (a dome) more at its top level.
      expect(counts[1]!, `${type}: level ${maxLevel(type, T)} against 1`).toBeGreaterThan(counts[0]! * 2);
    }
    for (let seed = 1; seed <= 30; seed += 1) {
      expect(of("reactor", seed, 3).variant.towers, "a reactor at level 3 has both towers").toBe(2);
      expect(of("water_extractor", seed, 4).variant.tanks, "a well at level 4 has both tanks").toBe(2);
      expect(of("habitat_dome", seed, 5).variant.annexes).toBe(2);
      expect(of("habitat_dome", seed, 1).variant.annexes).toBe(0);
    }
  });
});

describe("nothing about the geometry is saved", () => {
  function city(): SimState {
    let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 400, stores: { ...c.stores, materials: 5000 } })) };
    // Each at the first free ground from the grid's corner.
    for (const type of ["reactor", "geothermal_plant", "water_extractor"] as const) {
      let placed = false;
      for (let ty = 2; ty < 60 && !placed; ty += 3) {
        for (let tx = 2; tx < 60 && !placed; tx += 3) {
          const o = placeBuilding(s, s.settlements[0]!.id, type, tx, ty, T);
          if (o.ok) {
            s = o.state;
            placed = true;
          }
        }
      }
      expect(placed, `vacuity: a ${type} placed`).toBe(true);
    }
    return s;
  }
  const viewOf = (s: SimState) => cityView(s.settlements[0]!, habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0), T);

  it("draws a city loaded from its save exactly as before it was saved", () => {
    const s = city();
    const before = cityScene(viewOf(s), { time: 1, selected: null, ghost: null, quality: "high" });
    const loaded = deserialize(serialize(s, T, "2026-09-26T12:00:00.000Z"), T);
    const after = cityScene(viewOf(loaded), { time: 1, selected: null, ghost: null, quality: "high" });
    expect(after).toEqual(before);
    // What the save holds of a building: where, what and its level - no geometry.
    const saved = JSON.parse(serialize(s, T, "2026-09-26T12:00:00.000Z")) as { settlements: { buildings: object[] }[] };
    for (const b of saved.settlements[0]!.buildings) expect(Object.keys(b).sort()).toEqual(["level", "tx", "ty", "type"]);
  });

  it("redraws a building raised a level, though the frame before was kept", () => {
    const view = viewOf(city());
    const at = { time: 1, selected: null, ghost: null, quality: "high" as const };
    const before = cityScene(view, at);
    // The same building - index, type, place - one level up: only the level tells the kept shapes apart.
    const raised = { ...view, buildings: view.buildings.map((b, i) => (i === view.buildings.length - 1 ? { ...b, level: 6 } : b)) };
    const after = cityScene(raised, at);
    expect(after.length, "a level-6 building carries more greebles").toBeGreaterThan(before.length);
  });

  it("keeps each building's structure when the city claims land to the west, which moves every tile index", () => {
    const s = city();
    const view = viewOf(s);
    const o = claimLand(s, s.settlements[0]!.id, -1, 0, T);
    expect(o.ok, o.reason ?? "").toBe(true);
    const wider = viewOf(o.state);
    expect(wider.origin.x, "vacuity: the grid moved").not.toBe(view.origin.x);
    for (const b of view.buildings) {
      const moved = wider.buildings.find((w) => w.index === b.index)!;
      expect(moved.tx, "vacuity: its tile index moved").not.toBe(b.tx);
      expect(buildingStructure(wider, moved)).toEqual(buildingStructure(view, b));
    }
  });
});
