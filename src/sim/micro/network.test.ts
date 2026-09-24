/**
 * Corridors and cables (at the user's request: "connect the power plant to
 * the mines to activate them, or connect the greenhouses to the habitable
 * zones"; "roads are thin corridors ... connective ones for people,
 * greenhouses and space stations, and energy, thinner cables, yellow").
 * Micro §7.1: "A building is operable this tick only if it is connected to
 * the network (section 6)".
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
import type { Layer } from "./network.js";
import { linksToConnect, networkOf } from "./network.js";
import { foundSettlement } from "./registry.js";
import { connectAll, placeBuilding, placeLink, removeLink, settlementStep } from "./settlement.js";
import { gridTiles, keyTile, tileKey } from "./space.js";
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

function lay(s: SimState, layer: Layer, tiles: readonly (readonly [number, number])[], t: Tuning = ON): SimState {
  let out = s;
  for (const [tx, ty] of tiles) {
    const o = placeLink(out, s.settlements[0]!.id, layer, tx, ty, t);
    expect(o.ok, `${layer} at ${tx},${ty}: ${o.reason}`).toBe(true);
    out = o.state;
  }
  return out;
}

/** The user's first example: a reactor at 0,0 and a mine four tiles along, with open ground between. */
const mineAndReactor = (): SimState => build(found("outpost"), [["reactor", 0, 0], ["regolith_mine", 6, 0]]);
const between: [number, number][] = [[2, 0], [3, 0], [4, 0], [5, 0]];

describe("connecting a power plant to a mine: by cable", () => {
  it("leaves the mine idle, and says why, until a cable joins them", () => {
    // One world, stepped before and after its cable - as in play. (Built
    // fresh each time, a test passed with the network kept per buildings
    // alone, ignoring what was laid.)
    const world = mineAndReactor();
    const apart = step(world, ON);
    expect(apart.operable).toEqual([true, false]);
    expect(apart.network[1]).toEqual({ kind: "unsupplied", resources: ["power"] });
    expect(apart.production.materials).toBe(0);

    const joined = step(lay(world, "cables", between), ON);
    expect(joined.operable).toEqual([true, true]);
    expect(joined.network).toEqual([null, null]);
    expect(joined.production.materials).toBeGreaterThan(0);
  });

  it("does not power it through a corridor: corridors carry no power", () => {
    const corridor = step(lay(mineAndReactor(), "corridors", between), ON);
    expect(corridor.network[1]).toEqual({ kind: "unsupplied", resources: ["power"] });
  });

  it("cuts it off again when the cable is taken up", () => {
    const joined = lay(mineAndReactor(), "cables", between);
    const cut = removeLink(joined, joined.settlements[0]!.id, "cables", 4, 0);
    expect(cut.ok).toBe(true);
    expect(step(cut.state, ON).operable).toEqual([true, false]);
  });

  it("needs nothing laid where two buildings share a wall", () => {
    const touching = build(found("outpost"), [["reactor", 0, 0], ["regolith_mine", 2, 0]]);
    expect(step(touching, ON).operable).toEqual([true, true]);
  });

  it("changes nothing with the network off: the rule is the switch's to make", () => {
    // Vacuity guard for everything above: the same apart layout runs when the network is off.
    expect(step(mineAndReactor(), OFF).operable).toEqual([true, true]);
  });
});

describe("connecting greenhouses to the homes: by corridor", () => {
  // A dome on a network with power, water and oxygen, sharing walls; the
  // greenhouse is across open ground. Two geothermal plants: 16 power for
  // the 12 the dome, extractor, processor and greenhouse draw (with one, a
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
  const path: [number, number][] = [[7, 6], [8, 6], [9, 6]];

  it("keeps the dome dark for want of food alone, while the greenhouse is apart", () => {
    const apart = step(city(), ON);
    // Power, water and oxygen were all on its networks: food alone was missing.
    expect(apart.network[0]).toEqual({ kind: "unsupplied", resources: ["food"] });
    expect(apart.network.slice(1, 5)).toEqual([null, null, null, null]);
    // ...and the greenhouse, alone across the ground, has neither power nor water.
    expect(apart.network[5]).toEqual({ kind: "unsupplied", resources: ["power", "water"] });
  });

  it("brings it on when a corridor and a cable reach the greenhouse", () => {
    const joined = step(lay(lay(city(), "corridors", path), "cables", path), ON);
    expect(joined.shortages).toEqual([]);
    expect(joined.network).toEqual([null, null, null, null, null, null]);
  });

  it("feeds the dome with a corridor alone - but the greenhouse still needs its cable", () => {
    const corridorOnly = step(lay(city(), "corridors", path), ON);
    // The greenhouse has water by corridor, not power: it cannot grow, so the dome has no food.
    expect(corridorOnly.network[5]).toEqual({ kind: "unsupplied", resources: ["power"] });
    expect(corridorOnly.network[0]).toEqual({ kind: "unsupplied", resources: ["food"] });
  });
});

describe("what a network needs", () => {
  it("is a producer of each thing drawn: a lone dome lists exactly what it lacks", () => {
    const alone = step(build(found("city"), [["habitat_dome", 2, 6]]), ON);
    expect(alone.network[0]).toEqual({ kind: "unsupplied", resources: ["power", "water", "oxygen", "food"] });
  });

  it("is a RUNNING producer: a processor the planet will not run supplies no oxygen", () => {
    const plan: [BuildingType, number, number][] = [["habitat_dome", 2, 6], ["atmosphere_processor", 5, 6], ["geothermal_plant", 5, 8], ["water_extractor", 2, 9], ["greenhouse", 7, 6]];
    const s = build(found("city"), plan);
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, ON), ON), ON, 0);
    const withAir = settlementStep(s.settlements[0]!, env, ON, ON.SUBSTEP_YEARS);
    const without = settlementStep(s.settlements[0]!, { ...env, carbonDioxide: 0 }, ON, ON.SUBSTEP_YEARS);
    expect(withAir.network[0]).toBeNull();
    expect(without.operable[1]).toBe(false);
    expect(without.network[0]).toEqual({ kind: "unsupplied", resources: ["oxygen"] });
  });
});

describe("laying corridors and cables", () => {
  const id = (x: SimState): string => x.settlements[0]!.id;

  it("costs materials, and refuses what the ground or the layout forbids, changing nothing", () => {
    for (const layer of ["corridors", "cables"] as const) {
      const before = mineAndReactor();
      const laid = placeLink(before, id(before), layer, 3, 0, ON);
      expect(laid.ok).toBe(true);
      const cost = layer === "corridors" ? ON.COST_CORRIDOR : ON.COST_CABLE;
      expect(laid.state.settlements[0]!.stores.materials).toBe(before.settlements[0]!.stores.materials - cost);
      const refusals: [number, number, RegExp][] = [
        [0, 0, /a building stands there/],
        [3, 0, /there already/],
        [-1, 0, /on the grid/],
        [gridTiles("outpost", ON), 0, /on the grid/],
      ];
      for (const [tx, ty, reason] of refusals) {
        const o = placeLink(laid.state, id(laid.state), layer, tx, ty, ON);
        expect(o.ok, `${layer} at ${tx},${ty}`).toBe(false);
        expect(o.reason).toMatch(reason);
        expect(o.state).toBe(laid.state);
      }
    }
  });

  it("lets one tile carry both: a cable along a corridor", () => {
    const both = lay(lay(mineAndReactor(), "corridors", [[3, 0]]), "cables", [[3, 0]]);
    expect(both.settlements[0]!.corridors).toEqual([tileKey(3, 0)]);
    expect(both.settlements[0]!.cables).toEqual([tileKey(3, 0)]);
  });

  it("refuses steep ground", () => {
    const hilly = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    const x = found("city", hilly);
    const ground = groundOf(x.settlements[0]!, hilly);
    const n = gridTiles("city", hilly);
    const k = ground.steep.findIndex(Boolean);
    expect(k, "this site must have steep ground, or the test tests nothing").toBeGreaterThanOrEqual(0);
    expect(isSteep(ground, k % n, Math.floor(k / n))).toBe(true);
    expect(placeLink(x, id(x), "corridors", k % n, Math.floor(k / n), hilly).reason).toMatch(/too steep for a corridor/);
  });

  it("keeps buildings off them", () => {
    const x = lay(lay(found("outpost"), "corridors", [[4, 4]]), "cables", [[8, 8]]);
    expect(placeBuilding(x, id(x), "storage_depot", 4, 4, ON).reason).toMatch(/would stand on a corridor/);
    expect(placeBuilding(x, id(x), "reactor", 7, 7, ON).reason).toMatch(/would stand on a cable/);
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
  // A site where the whole plan fits on buildable ground, with hills on the grid (searched, deterministically).
  const site = ((): { lat: number; lon: number } => {
    for (let k = 0; k < 400; k += 1) {
      const at = { lat: -0.6 + 0.003 * k, lon: 0.1 + 0.017 * k };
      const s = foundSettlement(marsStart(), "city", at.lat, at.lon, hilly).state;
      if (!groundOf(s.settlements[0]!, hilly).steep.some(Boolean)) continue;
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

  it("joins every building into one network of each, and they run as they would with no network at all", () => {
    const before = city();
    const n = gridTiles("city", hilly);
    expect(networkOf(before.settlements[0]!.buildings, [], n).count).toBe(plan.length);
    const out = connectAll(before, before.settlements[0]!.id, hilly);
    expect(out.ok, out.reason ?? "").toBe(true);
    const s = out.state.settlements[0]!;
    expect(networkOf(s.buildings, s.corridors, n).count).toBe(1);
    expect(networkOf(s.buildings, s.cables, n).count).toBe(1);
    const off = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    expect(step(out.state, hilly).operable).toEqual(step(before, off).operable);
    const spent = s.corridors.length * hilly.COST_CORRIDOR + s.cables.length * hilly.COST_CABLE;
    expect(s.stores.materials).toBe(before.settlements[0]!.stores.materials - spent);
    expect(out.laid).toBe(s.corridors.length + s.cables.length);
  });

  it("lays only what a player could: each tile, replayed through placeLink, is accepted", () => {
    const before = city();
    for (const layer of ["corridors", "cables"] as const) {
      let replay = before;
      for (const key of linksToConnect(before.settlements[0]!, layer, hilly)) {
        const { tx, ty } = keyTile(key);
        const o = placeLink(replay, replay.settlements[0]!.id, layer, tx, ty, hilly);
        expect(o.ok, `${layer} ${tx},${ty}: ${o.reason}`).toBe(true);
        replay = o.state;
      }
    }
  });

  it("says so when there is nothing to do, or not enough materials, and changes nothing", () => {
    const done = connectAll(city(), city().settlements[0]!.id, hilly).state;
    expect(connectAll(done, done.settlements[0]!.id, hilly).reason).toMatch(/already is/);
    const poor = city();
    const broke = { ...poor, settlements: poor.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1 } })) };
    const o = connectAll(broke, broke.settlements[0]!.id, hilly);
    expect(o.ok).toBe(false);
    expect(o.reason).toMatch(/need \d+ materials, 1 available/);
    expect(o.state).toBe(broke);
  });
});

describe("the networks in time and in the save", () => {
  const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
  const joined = (): SimState => lay(mineAndReactor(), "cables", between);

  it("are chunk-independent: advance(s, 40) is ten advance(s, 4)", () => {
    let chunked = joined();
    for (let i = 0; i < 10; i += 1) chunked = advance(chunked, 4, cfg);
    expect(chunked).toEqual(advance(joined(), 40, cfg));
  });

  it("keep their tiles through the save, exactly", () => {
    const s = advance(lay(joined(), "corridors", [[3, 1]]), 12, cfg);
    expect(s.settlements[0]!.cables).toEqual(between.map(([x, y]) => tileKey(x, y)));
    expect(deserialize(serialize(s, ON, "2026-09-24T12:00:00.000Z"), ON)).toEqual(s);
  });

  it("bring v7's roads forward as both a corridor and a cable, so nothing comes apart", () => {
    const v8 = toSave(joined(), ON, "2026-09-24T12:00:00.000Z") as unknown as Record<string, unknown>;
    const list = (v8["settlements"] as Record<string, unknown>[]).map((c) => {
      const { corridors: _c, cables: roads, cleared: _r, jobs: _j, ...rest } = c;
      return { ...rest, roads };
    });
    const loaded = fromSave({ ...v8, schema_version: 7, settlements: list }, ON);
    const keys = between.map(([x, y]) => tileKey(x, y));
    expect(loaded.settlements[0]!.corridors).toEqual(keys);
    expect(loaded.settlements[0]!.cables).toEqual(keys);
    expect(step(loaded, ON).operable).toEqual([true, true]);
  });

  it("give a settlement from before roads the corridors and cables that connect what it had", () => {
    const v8 = toSave(mineAndReactor(), ON, "2026-09-24T12:00:00.000Z") as unknown as Record<string, unknown>;
    const list = (v8["settlements"] as Record<string, unknown>[]).map((c) => {
      const { corridors: _c, cables: _k, cleared: _r, jobs: _j, ...rest } = c;
      return rest;
    });
    const loaded = fromSave({ ...v8, schema_version: 6, settlements: list }, ON);
    expect(loaded.settlements[0]!.cables.length).toBeGreaterThan(0);
    expect(step(loaded, ON).operable).toEqual([true, true]);
  });

  it("refuse tiles that cannot be meant, naming them", () => {
    const save = toSave(joined(), ON, "2026-09-24T12:00:00.000Z") as unknown as Record<string, unknown>;
    const withCables = (r: unknown): unknown => ({ ...save, settlements: (save["settlements"] as Record<string, unknown>[]).map((c) => ({ ...c, cables: r })) });
    expect(() => fromSave(withCables([2, 2]), ON)).toThrow(/settlements\[0\]\.cables\[1\] repeats the cable at tile 2,0/);
    expect(() => fromSave(withCables([tileKey(0, 0)]), ON)).toThrow(/lies under a building at tile 0,0/);
    expect(() => fromSave(withCables([1.5]), ON)).toThrow(SaveError);
    expect(() => fromSave(withCables("cables"), ON)).toThrow(/settlements\[0\]\.cables/);
  });
});
