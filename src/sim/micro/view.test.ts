/**
 * The city view's contract (Batch 20): derived on demand, never stored, and
 * agreeing with what the simulation does next.
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import type { HabitatChannels } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { makeTuning } from "../tuning.js";
import type { BuildingType, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { placeBuilding } from "./settlement.js";
import { cityView } from "./view.js";

const t = makeTuning({ SETTLEMENTS_ENABLED: 1 });
const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };

function city(plan: readonly (readonly [BuildingType, number, number])[], stores: Partial<Record<string, number>> = {}): SimState {
  let s = foundSettlement(marsStart(), "city", 0.3, 1.0, t).state;
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 2000 } })) };
  for (const [type, tx, ty] of plan) s = placeBuilding(s, "settlement-1", type, tx, ty, t).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, ...stores } })) };
}

function envOf(s: SimState): HabitatChannels {
  return habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t);
}

describe("the city view", () => {
  it("shows a building running exactly when the next substep runs it", () => {
    // No water and nothing making it: the dome and greenhouse brown out; the
    // power plant, depot and spaceport do not. The oracle is the stores after
    // one real substep - a browned-out greenhouse makes no food.
    const s = city(
      [
        ["geothermal_plant", 2, 2],
        ["habitat_dome", 5, 2],
        ["greenhouse", 9, 2],
        ["storage_depot", 12, 2],
      ],
      { water: 0 },
    );
    const view = cityView(s.settlements[0]!, envOf(s), t);
    expect(view.buildings.map((b) => [b.type, b.operable])).toEqual([
      ["geothermal_plant", true],
      ["habitat_dome", false],
      ["greenhouse", false],
      ["storage_depot", true],
    ]);
    expect(view.shortages).toEqual(["water"]);
    const after = advance(s, 1, cfg).settlements[0]!;
    expect(after.stores.food).toBe(s.settlements[0]!.stores.food);
  });

  it("is reachable both ways: the same greenhouse runs once there is water", () => {
    const s = city(
      [
        ["geothermal_plant", 2, 2],
        ["habitat_dome", 5, 2],
        ["greenhouse", 9, 2],
      ],
      { water: 30 },
    );
    const view = cityView(s.settlements[0]!, envOf(s), t);
    expect(view.buildings.every((b) => b.operable)).toBe(true);
    expect(view.shortages).toEqual([]);
    const after = advance(s, 1, cfg).settlements[0]!;
    // Greenhouse 4/yr against the dome's 2/yr: food rises by 0.5 in a substep.
    expect(after.stores.food).toBeGreaterThan(s.settlements[0]!.stores.food);
  });

  it("gives a power plant's activity as the share of its power being drawn", () => {
    // One geothermal plant (`GEOTHERMAL_POWER`, 8/yr) feeding one spaceport
    // (`SPACEPORT_POWER`, 2/yr): load 0.25 - the reactor-core-brightness rule.
    const s = city([
      ["geothermal_plant", 2, 2],
      ["spaceport", 5, 2],
    ]);
    const view = cityView(s.settlements[0]!, envOf(s), t);
    expect(view.buildings[0]!.activity).toBeCloseTo(t.SPACEPORT_POWER / t.GEOTHERMAL_POWER, 12);
    expect(view.buildings[1]!.activity).toBe(1);
  });

  it("is derived: the settlement it was read from is left exactly as it was", () => {
    const s = city([["geothermal_plant", 2, 2]]);
    const before = JSON.stringify(s.settlements[0]);
    cityView(s.settlements[0]!, envOf(s), t);
    expect(JSON.stringify(s.settlements[0])).toBe(before);
  });
});
