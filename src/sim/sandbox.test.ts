/**
 * Batch 27: the Sandbox mode - "unlimited materials and credits, everything
 * unlocked, no losses" - and that it is a mode of a world, never of the game.
 *
 * Every pair below runs one action twice on the same world, once in the
 * standard tuning and once with SANDBOX_ENABLED. The standard half is the
 * vacuity guard: it proves each gate is really closed on this world, so the
 * sandbox half opening it means something.
 */

import { describe, expect, it } from "vitest";

import type { SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";
import { derive } from "./derive.js";
import { habitat } from "./habitat.js";
import { worldEnv } from "./integrate.js";
import { marsStart } from "./planets/mars.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import { purchase } from "./economy.js";
import { techGate } from "./tech.js";
import { foundSettlement } from "./micro/registry.js";
import { capacities, placeBuilding, settlementStep } from "./micro/settlement.js";
import { MICRO_RESOURCES } from "./types.js";

const STANDARD = makeTuning({ SETTLEMENTS_ENABLED: 1, ECONOMY_ENABLED: 1, TECH_GATE_ENABLED: 1 });
const SANDBOX = makeTuning({ SETTLEMENTS_ENABLED: 1, ECONOMY_ENABLED: 1, TECH_GATE_ENABLED: 1, SANDBOX_ENABLED: 1 });

/** A fresh city on early Mars, its stores emptied of materials. */
function bareCity(): { state: SimState; id: string } {
  const founded = foundSettlement(marsStart(), "city", 0, 0, STANDARD).state;
  const state = { ...founded, settlements: founded.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 0 } })) };
  return { state, id: state.settlements[0]!.id };
}

describe("Sandbox", () => {
  it("is off by default: the game's own tuning is not a sandbox", () => {
    expect(DEFAULT_TUNING.SANDBOX_ENABLED).toBe(0);
  });

  it("builds with no materials, and takes none", () => {
    const { state, id } = bareCity();
    expect(placeBuilding(state, id, "reactor", 10, 10, STANDARD).reason).toMatch(/needs 150 materials, 0 available/);
    const built = placeBuilding(state, id, "reactor", 10, 10, SANDBOX);
    expect(built.reason).toBeNull();
    expect(built.state.settlements[0]!.stores.materials).toBe(0);
  });

  it("lifts the population gates and the planet's locks", () => {
    const { state, id } = bareCity();
    expect(placeBuilding(state, id, "skyscraper", 10, 10, STANDARD).reason).toMatch(/needs a city of/);
    expect(placeBuilding(state, id, "skyscraper", 10, 10, SANDBOX).reason).toBeNull();
    expect(placeBuilding(state, id, "park", 10, 10, STANDARD).reason).toMatch(/needs a terraformed world/);
    expect(placeBuilding(state, id, "park", 10, 10, SANDBOX).reason).toBeNull();
  });

  it("opens the tech tree and charges no credits", () => {
    const start = marsStart();
    expect(techGate(start, "magnetic_shield", STANDARD).allowed).toBe(false);
    expect(techGate(start, "magnetic_shield", SANDBOX).allowed).toBe(true);
    const empty = { credits: 0, earned: 0, spent: 0 };
    expect(purchase(empty, 500, STANDARD).ok).toBe(false);
    const free = purchase(empty, 500, SANDBOX);
    expect(free.ok).toBe(true);
    expect(free.economy).toEqual(empty);
  });

  it("runs short of nothing: the stores stand full", () => {
    const { state } = bareCity();
    const env = (t: typeof STANDARD) => habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t), t, 0);
    const city = state.settlements[0]!;
    const standard = settlementStep(city, env(STANDARD), STANDARD, STANDARD.SUBSTEP_YEARS).next;
    const sandbox = settlementStep(city, env(SANDBOX), SANDBOX, SANDBOX.SUBSTEP_YEARS).next;
    const cap = capacities(city, SANDBOX);
    expect(MICRO_RESOURCES.some((r) => standard.stores[r] < cap[r]), "the standard city is not already full").toBe(true);
    for (const r of MICRO_RESOURCES) expect(sandbox.stores[r], r).toBe(cap[r]);
  });
});
