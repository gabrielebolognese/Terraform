/**
 * What is kept between substeps and placements so a city of 40,000
 * buildings stays quick (at the user's request: "double the number of
 * structures in each city"): kept, it must still give the answers made afresh.
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { makeTuning } from "../tuning.js";
import type { Settlement } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { foundSettlement } from "./registry.js";
import { rockAt, rocksOf } from "./rocks.js";
import { placeBuilding, settlementStep } from "./settlement.js";

const ON = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1 });

describe("kept between substeps", () => {
  it("a list of buildings stepped under another tuning gives what a fresh list gives", () => {
    let state = foundSettlement(marsStart(undefined, ON), "city", 0.31, -1.2, ON).state;
    state = { ...state, settlements: state.settlements.map((c) => ({ ...c, population: 300, stores: { ...c.stores, materials: 1e5 } })) };
    let placed = false;
    for (let y = 2; y < 28 && !placed; y += 1) {
      for (let x = 2; x < 28 && !placed; x += 1) {
        const o = placeBuilding(state, "settlement-1", "solar_array", x, y, ON);
        if (o.ok) {
          state = o.state;
          placed = true;
        }
      }
    }
    expect(placed, "vacuity: a solar array stands").toBe(true);
    // At level 3, so the level bonus counts.
    const s: Settlement = { ...state.settlements[0]!, buildings: state.settlements[0]!.buildings.map((b) => (b.type === "solar_array" ? { ...b, level: 3 } : b)) };
    const more = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, LEVEL_BONUS: ON.LEVEL_BONUS * 3 });
    const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, ON), ON), ON, 0);
    const first = settlementStep(s, env, ON, ON.SUBSTEP_YEARS).production.power;
    const kept = settlementStep(s, env, more, more.SUBSTEP_YEARS).production.power;
    const fresh = settlementStep({ ...s, buildings: [...s.buildings] }, env, more, more.SUBSTEP_YEARS).production.power;
    expect(kept).toBe(fresh);
    expect(kept, "vacuity: the bonus changes what it makes").toBeGreaterThan(first);
  });

  it("a crag is a crag, and none once a building stands over it", () => {
    const t = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 96, ROCK_CLUSTER_CHANCE: 0.9 });
    const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state.settlements[0]!;
    const n = s.base;
    const i = rocksOf(s, t).findIndex((r) => r === "crag");
    expect(i, "vacuity: a crag in the city").toBeGreaterThanOrEqual(0);
    const [tx, ty] = [i % n, Math.floor(i / n)];
    expect(rockAt(s, tx, ty, t)).toBe("crag");
    // A building set down over it (not placed by the rules, which refuse a crag): the rock is under it, none to see.
    const size = BUILDING_DEFS.storage_depot.footprint;
    const over: Settlement = { ...s, buildings: [...s.buildings, { type: "storage_depot", tx: Math.max(0, tx - size + 1), ty, level: 1 }] };
    expect(rockAt(over, tx, ty, t)).toBe("none");
  });
});
