/**
 * Batch 19's exit gate - micro doc §12 step 3: "Wire the save schema (section
 * 10) and prove offline progression on a settlement."
 *
 *   - a world with settlements round-trips through the save exactly;
 *   - offline catch-up equals live play over the same sim-time, exactly;
 *   - the offline design cap still bounds what an absence is worth.
 */

import { describe, expect, it } from "vitest";

import { advance } from "../integrate.js";
import { offlineGrant, resume } from "../offline.js";
import { marsStart } from "../planets/mars.js";
import { SaveError, deserialize, fromSave, serialize, toSave } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { BuildingType, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { placeBuilding } from "./settlement.js";

const ON = makeTuning({ SETTLEMENTS_ENABLED: 1 });
const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
const AT = "2026-09-23T10:00:00.000Z";
const AT_MS = Date.parse(AT);

function build(s: SimState, id: string, plan: readonly (readonly [BuildingType, number, number])[]): SimState {
  let out = s;
  for (const [type, tx, ty] of plan) {
    const o = placeBuilding(out, id, type, tx, ty, ON);
    expect(o.ok, `${type}: ${o.reason}`).toBe(true);
    out = o.state;
  }
  return out;
}

/** A city and an outpost, both running; the city still growing after `years`. */
function world(years: number): SimState {
  let s = foundSettlement(marsStart(), "city", 0.3, 1.0, ON).state;
  s = foundSettlement(s, "outpost", -0.5, 2.0, ON).state;
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1000 } })) };
  const [city, outpost] = s.settlements.map((c) => c.id) as [string, string];
  s = build(s, city, [
    ["spaceport", 2, 2],
    ["geothermal_plant", 6, 2],
    ["geothermal_plant", 9, 2],
    ["habitat_dome", 2, 6],
    ["greenhouse", 6, 6],
    ["water_extractor", 9, 6],
    ["atmosphere_processor", 12, 2],
    ["storage_depot", 14, 6],
  ]);
  s = build(s, outpost, [["reactor", 0, 0], ["regolith_mine", 3, 0]]);
  return advance(s, years * 4, cfg);
}

describe("a world with settlements round-trips through the save exactly", () => {
  const s = world(12);

  it("is a real, non-trivial settlement to save", () => {
    const city = s.settlements[0]!;
    expect(city.population).toBeGreaterThan(5);
    expect(city.buildings.length).toBe(8);
  });

  it("comes back identical", () => {
    expect(deserialize(serialize(s, ON, AT), ON)).toEqual(s);
  });

  it("and carries on exactly as if it had never been saved", () => {
    const reloaded = deserialize(serialize(s, ON, AT), ON);
    expect(advance(reloaded, 200, cfg)).toEqual(advance(s, 200, cfg));
  });

  it("stores only true state - no capacities, no grid size, nothing derived", () => {
    const saved = toSave(s, ON, AT).settlements?.[0] as unknown as Record<string, unknown>;
    // Batch 24 added `lost_at_sea_level_m`: true state, the record of a loss.
    expect(Object.keys(saved).sort()).toEqual(["buildings", "id", "kind", "lat", "lon", "lost_at_sea_level_m", "population", "stores"]);
  });
});

describe("a settlement lost to the sea (v6, Batch 24)", () => {
  const ruin = (): SimState => {
    const s = world(2);
    return { ...s, settlements: s.settlements.map((c, i) => (i === 0 ? { ...c, population: 0, buildings: [], stores: { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 }, lostAtSeaLevelM: -3065.77 } : c)) };
  };

  it("keeps the record through the save, exactly", () => {
    const s = ruin();
    expect(deserialize(serialize(s, ON, AT), ON)).toEqual(s);
  });

  it("brings a v5 settlement forward as standing", () => {
    const v6 = toSave(world(2), ON, AT) as unknown as Record<string, unknown>;
    const list = (v6["settlements"] as Record<string, unknown>[]).map((c) => {
      const { lost_at_sea_level_m: _gone, ...rest } = c;
      return rest;
    });
    const loaded = fromSave({ ...v6, schema_version: 5, settlements: list }, ON);
    expect(loaded.settlements.map((c) => c.lostAtSeaLevelM)).toEqual([null, null]);
  });

  it("refuses a ruin that still has buildings or people, and a loss that is not a number", () => {
    const save = toSave(ruin(), ON, AT) as unknown as Record<string, unknown>;
    const withCity = (mutate: (c: Record<string, unknown>) => void): unknown => {
      const list = JSON.parse(JSON.stringify(save["settlements"])) as Record<string, unknown>[];
      mutate(list[0]!);
      return { ...save, settlements: list };
    };
    expect(() => fromSave(withCity((c) => (c["population"] = 5)), ON)).toThrow(/settlements\[0\] was lost to the sea but still has people/);
    expect(() => fromSave(withCity((c) => (c["buildings"] = [{ type: "reactor", tx: 2, ty: 2, level: 1 }])), ON)).toThrow(/settlements\[0\] was lost to the sea but still has buildings/);
    expect(() => fromSave(withCity((c) => (c["lost_at_sea_level_m"] = "deep")), ON)).toThrow(/settlements\[0\]\.lost_at_sea_level_m/);
  });
});

describe("older saves", () => {
  it("bring a v4 settlement forward exactly as v4 loaded it: newly founded", () => {
    const founded = foundSettlement(marsStart(), "city", 0.3, 1.0, ON).state;
    const v4 = toSave(founded, ON, AT) as unknown as Record<string, unknown>;
    const legacy = {
      ...v4,
      schema_version: 4,
      settlements: [{ id: "settlement-1", kind: "city", lat: 0.3, lon: 1.0 }],
    };
    expect(fromSave(legacy, ON).settlements).toEqual(founded.settlements);
  });
});

describe("a hostile save is refused with the field named", () => {
  const good = (): Record<string, unknown> => toSave(world(2), ON, AT) as unknown as Record<string, unknown>;
  const withCity = (mutate: (city: Record<string, unknown>) => void): unknown => {
    const save = good();
    const list = (save["settlements"] as Record<string, unknown>[]).map((x) => JSON.parse(JSON.stringify(x)) as Record<string, unknown>);
    mutate(list[0]!);
    return { ...save, settlements: list };
  };
  const bs = (c: Record<string, unknown>) => c["buildings"] as Record<string, unknown>[];

  it("refuses what cannot be meant", () => {
    const cases: [(c: Record<string, unknown>) => void, RegExp][] = [
      [(c) => (bs(c)[0]!["type"] = "castle"), /settlements\[0\]\.buildings\[0\]\.type "castle" is not a known building/],
      [(c) => (bs(c)[0]!["tx"] = 1.5), /settlements\[0\]\.buildings\[0\] is not on a whole tile/],
      [(c) => (bs(c)[0]!["level"] = 0), /settlements\[0\]\.buildings\[0\]\.level/],
      [(c) => (bs(c)[1]!["tx"] = bs(c)[0]!["tx"]), /settlements\[0\]\.buildings\[1\] overlaps settlements\[0\]\.buildings\[0\]/],
      [(c) => ((c["stores"] as Record<string, unknown>)["water"] = -1), /settlements\[0\]\.stores\.water is negative/],
      [(c) => (c["population"] = null), /settlements\[0\]\.population/],
      [(c) => delete c["stores"], /settlements\[0\]\.stores/],
    ];
    for (const [mutate, message] of cases) expect(() => fromSave(withCity(mutate), ON)).toThrow(message);
    expect(() => fromSave(withCity((c) => (c["population"] = -3)), ON)).toThrow(SaveError);
  });
});

describe("a legitimate save survives a retune (Batch 14's lesson)", () => {
  // Written under today's tuning, loaded by a build that shrank the domes,
  // the stores and the grid. Rejecting any of it would wipe a real game.
  const s = world(40);
  const tighter = makeTuning({ SETTLEMENTS_ENABLED: 1, DOME_HOUSING: 10, MICRO_CAP_WATER: 5, DEPOT_WATER: 0, CITY_GRID_TILES: 8 });

  it("is reachable: this save really is over the tighter limits", () => {
    const city = s.settlements[0]!;
    expect(city.population).toBeGreaterThan(10);
    expect(city.stores.water).toBeGreaterThan(5);
    expect(city.buildings.some((b) => b.tx + 2 > 8)).toBe(true);
  });

  it("loads, clamping what a retune shrank and keeping every building", () => {
    const loaded = deserialize(serialize(s, ON, AT), tighter);
    const city = loaded.settlements[0]!;
    expect(city.population).toBe(10);
    expect(city.stores.water).toBe(5);
    expect(city.buildings).toEqual(s.settlements[0]!.buildings);
  });

  it("keeps a building in a kind of settlement that a later build would forbid", () => {
    const save = toSave(world(2), ON, AT) as unknown as Record<string, unknown>;
    const list = JSON.parse(JSON.stringify(save["settlements"])) as Record<string, unknown>[];
    (list[1]!["buildings"] as unknown[]).push({ type: "habitat_dome", tx: 10, ty: 10, level: 1 });
    const loaded = fromSave({ ...save, settlements: list }, ON);
    expect(loaded.settlements[1]!.buildings.some((b) => b.type === "habitat_dome")).toBe(true);
  });
});

describe("offline progression on a settlement (section 9.4)", () => {
  const young = world(8);
  const raw = JSON.parse(serialize(young, ON, AT)) as unknown;

  it("equals live play over the same sim-time, exactly", () => {
    const back = resume(raw, AT_MS + 2 * 3600_000, cfg);
    const steps = Math.round(back.grant.grantedSimYears / ON.SUBSTEP_YEARS);
    expect(steps, "the absence must be worth something, or this proves nothing").toBeGreaterThan(40);
    expect(back.state).toEqual(advance(young, steps, cfg));
    // And the settlements really moved while the player was away.
    expect(back.state.settlements[0]!.population).toBeGreaterThan(young.settlements[0]!.population + 1);
  });

  it("is bounded by the design cap: a two-day absence is worth exactly what eight hours is", () => {
    const eight = resume(raw, AT_MS + 8 * 3600_000, cfg);
    const fortyEight = resume(raw, AT_MS + 48 * 3600_000, cfg);
    expect(offlineGrant(48 * 3600, ON).grantedSimYears).toBe(offlineGrant(8 * 3600, ON).grantedSimYears);
    expect(fortyEight.state).toEqual(eight.state);
  });
});
