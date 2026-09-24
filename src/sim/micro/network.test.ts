/**
 * Roads and the settlement network (at the user's request: "I need to connect
 * the power plant to the mines to activate them, or connect the greenhouses
 * to the habitable zones"). Micro §7.1: "A building is operable this tick
 * only if it is connected to the network (section 6)".
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { SaveError, deserialize, fromSave, serialize, toSave } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { networkOf, roadKey, roadTile, roadsToConnect } from "./network.js";
import { foundSettlement } from "./registry.js";
import { connectAll, placeBuilding, placeRoad, removeRoad, settlementStep } from "./settlement.js";
import { gridTiles } from "./space.js";
import { groundOf, isSteep } from "./terrain.js";

const OFF = makeTuning({ SETTLEMENTS_ENABLED: 1 });
const ON = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1 });

function step(s: SimState, t: Tuning) {
  const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t, 0);
  return settlementStep(s.settlements[0]!, env, t, t.SUBSTEP_YEARS);
}

function found(kind: "city" | "outpost", t: Tuning = ON): SimState {
  const s = foundSettlement(marsStart(), kind, 0.3, 1.0, t).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 2000 } })) };
}

function build(s: SimState, plan: readonly (readonly [BuildingType, number, number])[], t: Tuning = ON): SimState {
  let out = s;
  for (const [type, tx, ty] of plan) {
    const o = placeBuilding(out, s.settlements[0]!.id, type, tx, ty, t);
    expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
    out = o.state;
  }
  return out;
}

function roads(s: SimState, tiles: readonly (readonly [number, number])[], t: Tuning = ON): SimState {
  let out = s;
  for (const [tx, ty] of tiles) {
    const o = placeRoad(out, s.settlements[0]!.id, tx, ty, t);
    expect(o.ok, `road at ${tx},${ty}: ${o.reason}`).toBe(true);
    out = o.state;
  }
  return out;
}

/** The user's first example: a reactor at 0,0 and a mine four tiles along, with open ground between. */
const mineAndReactor = (): SimState => build(found("outpost"), [["reactor", 0, 0], ["regolith_mine", 6, 0]]);
const between: [number, number][] = [[2, 0], [3, 0], [4, 0], [5, 0]];

describe("connecting a power plant to a mine", () => {
  it("leaves the mine idle, and says why, until a road joins them", () => {
    // One world, stepped before and after its roads - as in play. (Built
    // fresh each time, this test passed with the network kept per buildings
    // alone, ignoring the roads.)
    const world = mineAndReactor();
    const apart = step(world, ON);
    expect(apart.operable).toEqual([true, false]);
    expect(apart.network[1]).toEqual({ kind: "unsupplied", resources: ["power"] });
    expect(apart.production.materials).toBe(0);

    const joined = step(roads(world, between), ON);
    expect(joined.operable).toEqual([true, true]);
    expect(joined.network).toEqual([null, null]);
    expect(joined.production.materials).toBeGreaterThan(0);
  });

  it("cuts it off again when a road is taken up", () => {
    const joined = roads(mineAndReactor(), between);
    const cut = removeRoad(joined, joined.settlements[0]!.id, 4, 0);
    expect(cut.ok).toBe(true);
    expect(step(cut.state, ON).operable).toEqual([true, false]);
  });

  it("needs no road where two buildings share a wall", () => {
    const touching = build(found("outpost"), [["reactor", 0, 0], ["regolith_mine", 2, 0]]);
    expect(step(touching, ON).operable).toEqual([true, true]);
  });

  it("changes nothing with the network off: the rule is the switch's to make", () => {
    // Vacuity guard for everything above: the same apart layout runs when the network is off.
    expect(step(mineAndReactor(), OFF).operable).toEqual([true, true]);
  });
});

describe("connecting greenhouses to the homes", () => {
  // A dome on a network with power, water and oxygen, sharing walls; the
  // greenhouse is across open ground. Two geothermal plants: 16 power for
  // the 12 the dome, extractor, processor and greenhouse draw (with one, the
  // first version of this test browned them all out - a shortage, not the
  // network).
  const plan: [BuildingType, number, number][] = [
    ["habitat_dome", 2, 6],
    ["geothermal_plant", 5, 6],
    ["water_extractor", 5, 8],
    ["atmosphere_processor", 2, 9],
    ["geothermal_plant", 5, 10],
    ["greenhouse", 10, 6],
  ];
  const city = (): SimState => build(found("city"), plan);

  it("keeps the dome dark for want of food alone, while the greenhouse is apart", () => {
    const apart = step(city(), ON);
    // Power, water and oxygen were all on its network: food alone was missing.
    expect(apart.network[0]).toEqual({ kind: "unsupplied", resources: ["food"] });
    // Everything else on the dome's network is supplied and runs...
    expect(apart.network.slice(1, 5)).toEqual([null, null, null, null]);
    expect(apart.operable.slice(1, 5).every(Boolean)).toBe(true);
    // ...and the greenhouse, alone across the ground, has no power or water of its own.
    expect(apart.network[5]).toEqual({ kind: "unsupplied", resources: ["power", "water"] });
  });

  it("brings it on when a road reaches the greenhouse", () => {
    const joined = step(roads(city(), [[7, 6], [8, 6], [9, 6]]), ON);
    expect(joined.shortages).toEqual([]);
    expect(joined.network).toEqual([null, null, null, null, null, null]);
    expect(joined.operable.every(Boolean)).toBe(true);
  });
});

describe("what a network needs", () => {
  it("is a producer of each thing drawn: a dome with no oxygen on its network lists exactly what it lacks", () => {
    // A lone dome draws power, water, oxygen and food, and nothing makes any.
    const alone = step(build(found("city"), [["habitat_dome", 2, 6]]), ON);
    expect(alone.network[0]).toEqual({ kind: "unsupplied", resources: ["power", "water", "oxygen", "food"] });
  });

  it("is a RUNNING producer: a power plant the planet will not run supplies no one", () => {
    // An Atmosphere Processor draws power and makes oxygen; it cannot run on
    // a world with no CO2 to process - then a dome beside it has no oxygen.
    const plan: [BuildingType, number, number][] = [["habitat_dome", 2, 6], ["atmosphere_processor", 5, 6], ["geothermal_plant", 5, 8], ["water_extractor", 2, 9], ["greenhouse", 7, 6]];
    const s = build(found("city"), plan);
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, ON), ON), ON, 0);
    const noCo2 = { ...env, carbonDioxide: 0 };
    const withAir = settlementStep(s.settlements[0]!, env, ON, ON.SUBSTEP_YEARS);
    const without = settlementStep(s.settlements[0]!, noCo2, ON, ON.SUBSTEP_YEARS);
    expect(withAir.network[0]).toBeNull();
    expect(without.operable[1]).toBe(false);
    expect(without.network[0]).toEqual({ kind: "unsupplied", resources: ["oxygen"] });
  });
});

describe("laying roads", () => {
  const s = (): SimState => mineAndReactor();
  const id = (x: SimState): string => x.settlements[0]!.id;

  it("costs materials, and refuses what the ground or the layout forbids, changing nothing", () => {
    const before = s();
    const laid = placeRoad(before, id(before), 3, 0, ON);
    expect(laid.ok).toBe(true);
    expect(laid.state.settlements[0]!.stores.materials).toBe(before.settlements[0]!.stores.materials - ON.COST_ROAD);
    const refusals: [number, number, RegExp][] = [
      [0, 0, /a building stands there/],
      [3, 0, /a road there already/],
      [-1, 0, /on the grid/],
      [gridTiles("outpost", ON), 0, /on the grid/],
    ];
    for (const [tx, ty, reason] of refusals) {
      const o = placeRoad(laid.state, id(laid.state), tx, ty, ON);
      expect(o.ok, `${tx},${ty}`).toBe(false);
      expect(o.reason).toMatch(reason);
      expect(o.state).toBe(laid.state);
    }
    const broke = { ...before, settlements: before.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 0 } })) };
    expect(placeRoad(broke, id(broke), 3, 0, ON).reason).toMatch(/needs 1 materials, 0 available/);
  });

  it("refuses steep ground", () => {
    const hilly = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    const x = found("city", hilly);
    const ground = groundOf(x.settlements[0]!, hilly);
    const n = gridTiles("city", hilly);
    let steep: [number, number] | null = null;
    for (let i = 0; i < n * n && steep === null; i += 1) if (isSteep(ground, i % n, Math.floor(i / n))) steep = [i % n, Math.floor(i / n)];
    expect(steep, "this site must have steep ground, or the test tests nothing").not.toBeNull();
    expect(placeRoad(x, id(x), steep![0], steep![1], hilly).reason).toMatch(/too steep for a road/);
  });

  it("keeps buildings off roads", () => {
    const x = roads(found("outpost"), [[4, 4]]);
    expect(placeBuilding(x, id(x), "storage_depot", 4, 4, ON).reason).toMatch(/would stand on a road/);
    expect(placeBuilding(x, id(x), "reactor", 3, 3, ON).reason).toMatch(/would stand on a road/);
  });
});

describe("connect everything", () => {
  // Batch 18's supply city: seven buildings, none touching.
  const plan: [BuildingType, number, number][] = [
    ["spaceport", 2, 2],
    ["geothermal_plant", 6, 2],
    ["geothermal_plant", 9, 2],
    ["habitat_dome", 2, 6],
    ["greenhouse", 6, 6],
    ["water_extractor", 9, 6],
    ["atmosphere_processor", 12, 2],
  ];
  const hilly = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
  // A site where the whole plan fits on buildable ground, with hills on the
  // grid for the roads to go round (searched, deterministically).
  const site = ((): { lat: number; lon: number } => {
    for (let k = 0; k < 400; k += 1) {
      const at = { lat: -0.6 + 0.003 * k, lon: 0.1 + 0.017 * k };
      const s = foundSettlement(marsStart(), "city", at.lat, at.lon, hilly).state;
      const ground = groundOf(s.settlements[0]!, hilly);
      if (!ground.steep.some(Boolean)) continue;
      let out: SimState = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 2000 } })) };
      let ok = true;
      for (const [type, tx, ty] of plan) {
        const o = placeBuilding(out, out.settlements[0]!.id, type, tx, ty, hilly);
        if (!o.ok) {
          ok = false;
          break;
        }
        out = o.state;
      }
      if (ok) return at;
    }
    throw new Error("no site fits the plan");
  })();
  const city = (): SimState => {
    const s = foundSettlement(marsStart(), "city", site.lat, site.lon, hilly).state;
    return build({ ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 2000 } })) }, plan, hilly);
  };

  it("joins every building into one network, and they run as they would with no network at all", () => {
    const before = city();
    const n = gridTiles("city", hilly);
    expect(networkOf(before.settlements[0]!.buildings, [], n).count).toBe(plan.length);
    const out = connectAll(before, before.settlements[0]!.id, hilly);
    expect(out.ok, out.reason ?? "").toBe(true);
    const s = out.state.settlements[0]!;
    expect(networkOf(s.buildings, s.roads, n).count).toBe(1);
    const off = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    expect(step(out.state, hilly).operable).toEqual(step(before, off).operable);
    expect(s.stores.materials).toBe(before.settlements[0]!.stores.materials - out.laid * hilly.COST_ROAD);
  });

  it("lays only roads a player could lay: each one, replayed through placeRoad, is accepted", () => {
    // Independent of the search: the game's own rule for a road, tile by tile.
    const before = city();
    let replay = before;
    for (const key of roadsToConnect(before.settlements[0]!, hilly)) {
      const { tx, ty } = roadTile(key);
      const o = placeRoad(replay, replay.settlements[0]!.id, tx, ty, hilly);
      expect(o.ok, `${tx},${ty}: ${o.reason}`).toBe(true);
      replay = o.state;
    }
  });

  it("says so when there is nothing to do, or not enough materials, and changes nothing", () => {
    const done = connectAll(city(), city().settlements[0]!.id, hilly).state;
    expect(connectAll(done, done.settlements[0]!.id, hilly).reason).toMatch(/already is/);
    const poor = city();
    const broke = { ...poor, settlements: poor.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1 } })) };
    const o = connectAll(broke, broke.settlements[0]!.id, hilly);
    expect(o.ok).toBe(false);
    expect(o.reason).toMatch(/roads need \d+ materials, 1 available/);
    expect(o.state).toBe(broke);
  });
});

describe("the network in time and in the save", () => {
  const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
  const joined = (): SimState => roads(mineAndReactor(), between);

  it("is chunk-independent: advance(s, 40) is ten advance(s, 4)", () => {
    let chunked = joined();
    for (let i = 0; i < 10; i += 1) chunked = advance(chunked, 4, cfg);
    expect(chunked).toEqual(advance(joined(), 40, cfg));
  });

  it("keeps its roads through the save, exactly", () => {
    const s = advance(joined(), 12, cfg);
    expect(s.settlements[0]!.roads).toEqual(between.map(([x, y]) => roadKey(x, y)));
    expect(deserialize(serialize(s, ON, "2026-09-24T12:00:00.000Z"), ON)).toEqual(s);
  });

  it("gives a settlement from before roads the roads that connect what it had", () => {
    // A v6 save: the same outpost, apart, and no roads field at all.
    const v7 = toSave(mineAndReactor(), ON, "2026-09-24T12:00:00.000Z") as unknown as Record<string, unknown>;
    const list = (v7["settlements"] as Record<string, unknown>[]).map((c) => {
      const { roads: _none, ...rest } = c;
      return rest;
    });
    const loaded = fromSave({ ...v7, schema_version: 6, settlements: list }, ON);
    expect(loaded.settlements[0]!.roads.length).toBeGreaterThan(0);
    expect(step(loaded, ON).operable).toEqual([true, true]);
  });

  it("refuses roads that cannot be meant, naming them", () => {
    const save = toSave(joined(), ON, "2026-09-24T12:00:00.000Z") as unknown as Record<string, unknown>;
    const withRoads = (r: unknown): unknown => ({ ...save, settlements: (save["settlements"] as Record<string, unknown>[]).map((c) => ({ ...c, roads: r })) });
    expect(() => fromSave(withRoads([2, 2]), ON)).toThrow(/settlements\[0\]\.roads\[1\] repeats the road at tile 2,0/);
    expect(() => fromSave(withRoads([roadKey(0, 0)]), ON)).toThrow(/lies under a building at tile 0,0/);
    expect(() => fromSave(withRoads([1.5]), ON)).toThrow(SaveError);
    expect(() => fromSave(withRoads("roads"), ON)).toThrow(/settlements\[0\]\.roads/);
  });
});
