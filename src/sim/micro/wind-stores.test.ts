/**
 * Wind, the mall, the stores, parks and the biosphere (at the user's
 * request): "wind turbines, that unlock only when pressure is enough on the
 * planet; mega-malls, a big 8x6 structure that unlocks at 10k people, provides
 * tons of food but consumes a ton of power; storage buildings - water tank,
 * battery for power, freezers for food, depots for materials; since the world
 * there is terraformed, you can also create parks; a biosphere: a 6x4 mega
 * greenhouse, that gives food and also oxygen, and consumes power and water".
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import type { HabitatChannels } from "../habitat.js";
import { worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { BuildingType, MicroResource, SimState } from "../types.js";
import { MICRO_RESOURCES, NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { capacities, placeBuilding, settlementStep } from "./settlement.js";

const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, CITY_GRID_TILES: 96 });

function city(people = 0): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: people, stores: { ...c.stores, materials: 1e6, power: 1e4, water: 1e4 } })) };
}
const start = city();
/** The planet as a new game finds it: 6 mbar, no open air. */
const bare: HabitatChannels = habitat(start.reservoirs, derive(start.reservoirs, worldEnv(start, NEUTRAL_ENV, T), T), T, 0);
/** A terraformed planet, as the example's (1,044 mbar and open air, measured). */
const done: HabitatChannels = { ...bare, pressure: 1044, openAirFraction: 0.998 };

const place = (s: SimState, type: BuildingType, env: HabitatChannels, x = 20, y = 20): SimState => {
  const o = placeBuilding(s, s.settlements[0]!.id, type, x, y, T, env);
  expect(o.ok, `${type}: ${o.reason}`).toBe(true);
  return o.state;
};
/** What one building of `type` adds to the city's making and drawing, per year, on `env`. */
function adds(type: BuildingType, env: HabitatChannels, people = 0): { made: Record<MicroResource, number>; drawn: Record<MicroResource, number>; runs: boolean } {
  const before = city(people);
  const after = place(before, type, done);
  const a = settlementStep(before.settlements[0]!, env, T, T.SUBSTEP_YEARS);
  const b = settlementStep(after.settlements[0]!, env, T, T.SUBSTEP_YEARS);
  const diff = (x: Record<MicroResource, number>, y: Record<MicroResource, number>) => Object.fromEntries(MICRO_RESOURCES.map((r) => [r, y[r] - x[r]])) as Record<MicroResource, number>;
  return { made: diff(a.production, b.production), drawn: diff(a.consumption, b.consumption), runs: b.operable[b.operable.length - 1] === true };
}

describe("wind turbines", () => {
  it("wait for air thick enough to turn them, and say so", () => {
    expect(bare.pressure, "vacuity: a new planet's air is thin").toBeLessThan(T.WIND_MIN_PRESSURE);
    const refused = placeBuilding(start, start.settlements[0]!.id, "wind_turbine", 20, 20, T, bare);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/too thin to turn a turbine - 6 mbar, it needs 300/);
    // Without a planet given, the one the reservoirs make: the same thin air.
    expect(placeBuilding(start, start.settlements[0]!.id, "wind_turbine", 20, 20, T).ok).toBe(false);
    expect(placeBuilding(start, start.settlements[0]!.id, "wind_turbine", 20, 20, T, { ...bare, pressure: 300 }).ok).toBe(true);
  });

  it("turn out power with the air's pressure - none below the threshold, half as much again at most", () => {
    const at = (pressure: number) => adds("wind_turbine", { ...done, pressure });
    expect(at(1000).made.power).toBeCloseTo(T.WIND_POWER, 9);
    expect(at(500).made.power).toBeCloseTo(T.WIND_POWER / 2, 9);
    expect(at(3000).made.power).toBeCloseTo(T.WIND_POWER * 1.5, 9);
    expect(at(299).runs).toBe(false);
    expect(at(299).made.power).toBe(0);
  });
});

describe("parks", () => {
  it("wait for a terraformed world", () => {
    expect(placeBuilding(start, start.settlements[0]!.id, "park", 20, 20, T, bare).reason).toMatch(/a park needs a terraformed world - open air over 50% of the planet, it is 0%/);
    expect(placeBuilding(start, start.settlements[0]!.id, "park", 20, 20, T, { ...bare, openAirFraction: 0.5 }).ok).toBe(true);
  });

  it("breathe out a little oxygen for a little water - and stand idle if the open air goes", () => {
    const p = adds("park", done);
    expect(p.made.oxygen).toBeCloseTo(T.PARK_OXYGEN, 9);
    expect(p.drawn.water).toBeCloseTo(T.PARK_WATER, 9);
    expect(adds("park", { ...done, openAirFraction: 0.2 }).runs).toBe(false);
  });
});

describe("the mega mall", () => {
  it("is for a city of ten thousand, 8 x 6", () => {
    expect(placeBuilding(city(9999), "settlement-1", "mega_mall", 20, 20, T, done).reason).toMatch(/needs a city of 10000 people/);
    const s = place(city(10000), "mega_mall", done);
    const b = s.settlements[0]!.buildings.at(-1)!;
    // Its footprint: another building one tile past its eighth column, or its sixth row, fits; inside, not.
    expect(placeBuilding(s, "settlement-1", "storage_depot", b.tx + 7, b.ty + 5, T, done).reason).toMatch(/overlap/);
    expect(placeBuilding(s, "settlement-1", "storage_depot", b.tx + 8, b.ty, T, done).ok).toBe(true);
    expect(placeBuilding(s, "settlement-1", "storage_depot", b.tx, b.ty + 6, T, done).ok).toBe(true);
  });

  it("gives a ton of food for a ton of power", () => {
    const m = adds("mega_mall", done, 10000);
    expect(m.made.food).toBeCloseTo(T.MALL_FOOD, 9);
    expect(m.drawn.power).toBeCloseTo(T.MALL_POWER, 9);
    // Tons: more food than twenty greenhouses, more power drawn than eight geothermal plants make.
    expect(m.made.food).toBeGreaterThan(20 * T.GREENHOUSE_FOOD);
    expect(m.drawn.power).toBeGreaterThan(8 * T.GEOTHERMAL_POWER);
  });
});

describe("stores of every kind", () => {
  it("each makes room for its own resource, and only that", () => {
    const base = capacities(start.settlements[0]!, T);
    for (const [type, resource, room] of [
      ["water_tank", "water", T.TANK_WATER],
      ["battery_bank", "power", T.BATTERY_POWER],
      ["freezer", "food", T.FREEZER_FOOD],
      ["materials_depot", "materials", T.MATERIALS_DEPOT_MATERIALS],
    ] as const) {
      const cap = capacities(place(start, type, done).settlements[0]!, T);
      for (const r of MICRO_RESOURCES) expect(cap[r] - base[r], `${type}: ${r}`).toBeCloseTo(r === resource ? room : 0, 9);
      // More room than the all-purpose depot gives that resource.
      const depot = capacities(place(start, "storage_depot", done).settlements[0]!, T);
      expect(cap[resource] - base[resource], type).toBeGreaterThan(depot[resource] - base[resource]);
    }
    // A freezer keeps cold with a little power.
    expect(adds("freezer", done).drawn.power).toBeCloseTo(T.FREEZER_POWER, 9);
  });
});

describe("the biosphere", () => {
  it("is 6 x 4, and gives food and oxygen for power and water", () => {
    const b = adds("biosphere", done);
    expect(b.made.food).toBeCloseTo(T.BIOSPHERE_FOOD, 9);
    expect(b.made.oxygen).toBeCloseTo(T.BIOSPHERE_OXYGEN, 9);
    expect(b.drawn.power).toBeCloseTo(T.BIOSPHERE_POWER, 9);
    expect(b.drawn.water).toBeCloseTo(T.BIOSPHERE_WATER, 9);
    const s = place(start, "biosphere", done);
    const at = s.settlements[0]!.buildings.at(-1)!;
    expect(placeBuilding(s, "settlement-1", "storage_depot", at.tx + 5, at.ty + 3, T, done).reason).toMatch(/overlap/);
    expect(placeBuilding(s, "settlement-1", "storage_depot", at.tx + 6, at.ty + 3, T, done).ok).toBe(true);
    expect(placeBuilding(s, "settlement-1", "storage_depot", at.tx, at.ty + 4, T, done).ok).toBe(true);
  });
});

it("every new building survives the save", () => {
  let s = city(10000);
  const types: BuildingType[] = ["wind_turbine", "mega_mall", "water_tank", "battery_bank", "freezer", "materials_depot", "park", "biosphere"];
  types.forEach((type, k) => (s = place(s, type, done, 4 + 10 * (k % 4), 30 + 10 * Math.floor(k / 4))));
  const back = deserialize(serialize(s, T, "2026-09-25T00:00:00.000Z"), T);
  expect(back.settlements[0]!.buildings.map((b) => b.type).slice(-types.length)).toEqual(types);
});
