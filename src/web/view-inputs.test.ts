// @vitest-environment happy-dom

/**
 * Batch 40: the city screen derives its view when the city or the planet has
 * changed, not five times a second regardless. A metropolis's view is 70-145 ms
 * (measured, `budget.ts`): derived every 200 ms it was a hitch every 200 ms
 * while panning, 149 of the 203 frames over 33 ms in 30 s. Counted here at
 * the screen, `cityView` wrapped, the planet's channels made afresh every
 * frame as the game loop makes them.
 */

import { describe, expect, it, vi } from "vitest";

import type { HabitatChannels, Settlement, SimState } from "../sim/index.js";
import { NEUTRAL_ENV, derive, foundSettlement, habitat, makeTuning, marsStart, placeBuilding, worldEnv } from "../sim/index.js";
import type { CityHooks } from "./city.js";
import { CityScreen } from "./city.js";
import type { PlannerHooks } from "./planner.js";
import { PlannerScreen } from "./planner.js";
import { sameChannels } from "./view-inputs.js";

const derived = vi.hoisted(() => ({ count: 0 }));
vi.mock("../sim/index.js", async (original) => {
  const sim = await original<typeof import("../sim/index.js")>();
  return {
    ...sim,
    cityView: (...args: Parameters<typeof sim.cityView>) => {
      derived.count += 1;
      return sim.cityView(...args);
    },
  };
});

const t = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });

function city(): { state: SimState; settlement: () => Settlement; env: () => HabitatChannels } {
  const founded = foundSettlement(marsStart(), "city", 0.31, -1.2, t).state;
  const state = { ...founded, settlements: founded.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1000 } })) };
  // The planet's channels as the game loop makes them: a new object every frame.
  const env = (): HabitatChannels => habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t), t, 0);
  return { state, settlement: () => state.settlements[0]!, env };
}

function mount(): { screen: CityScreen; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.append(host);
  const refuse = () => ({ state: null, ok: false, reason: "not in this test", laid: 0 });
  const hooks = new Proxy({}, { get: () => refuse }) as unknown as CityHooks;
  return { screen: new CityScreen(host, hooks, t), host };
}

describe("the city screen's view", () => {
  it("is derived once while nothing changes, however many frames and however often the channels are made", () => {
    const { settlement, env } = city();
    const { screen } = mount();
    const s = settlement();
    screen.open(s.id);
    derived.count = 0;
    // Five seconds of frames at 60 a second, the same city (between substeps), the channels new each frame.
    for (let k = 0; k < 300; k += 1) screen.frame(s, env(), k * 16.7);
    // Before Batch 40: 25 (once, then every 200 ms), measured by putting the old rule back.
    expect(derived.count).toBe(1);
  });

  it("is derived again after a substep - the city made anew - no sooner than 200 ms after the last", () => {
    const { settlement, env } = city();
    const { screen } = mount();
    const s = settlement();
    screen.open(s.id);
    derived.count = 0;
    screen.frame(s, env(), 0);
    expect(derived.count).toBe(1);
    // A substep: the same city as a new object (its numbers moved on), 100 ms later - and then held.
    const next = { ...s, population: s.population + 1 };
    screen.frame(next, env(), 100);
    expect(derived.count, "not before 200 ms").toBe(1);
    screen.frame(next, env(), 216);
    expect(derived.count, "the substep's city, at 200 ms").toBe(2);
    for (let k = 1; k < 60; k += 1) screen.frame(next, env(), 216 + k * 16.7);
    expect(derived.count, "and then held").toBe(2);
  });

  it("is derived again when the planet's channels change, the city the same", () => {
    const { settlement, env } = city();
    const { screen } = mount();
    const s = settlement();
    screen.open(s.id);
    derived.count = 0;
    screen.frame(s, env(), 0);
    screen.frame(s, { ...env(), temperature: env().temperature + 1 }, 300);
    expect(derived.count).toBe(2);
  });

  it("is derived at once when a click changes the buildings - the player never waits for their click", () => {
    const { state, settlement, env } = city();
    const { screen } = mount();
    const s = settlement();
    screen.open(s.id);
    derived.count = 0;
    screen.frame(s, env(), 0);
    let placed: Settlement | null = null;
    for (let i = 0; i < 64 * 64 && placed === null; i += 1) {
      const o = placeBuilding(state, s.id, "solar_array", i % 64, Math.floor(i / 64), t);
      if (o.ok) placed = o.state.settlements[0]!;
    }
    expect(placed, "vacuity: a building placed").not.toBeNull();
    screen.frame(placed!, env(), 17);
    expect(derived.count).toBe(2);
  });
});

describe("the planner's view", () => {
  it("is derived once while nothing changes, and again after a substep no sooner than a second after the last", () => {
    const { settlement, env } = city();
    const host = document.createElement("div");
    document.body.append(host);
    const refuse = () => ({ state: null, ok: false, reason: "not in this test", laid: 0, planned: 0, queued: 0 });
    const planner = new PlannerScreen(host, new Proxy({}, { get: () => refuse }) as unknown as PlannerHooks, t);
    const s = settlement();
    planner.open(s.id);
    derived.count = 0;
    for (let k = 0; k < 300; k += 1) planner.frame(s, env(), k * 16.7);
    // Before Batch 40: once a second whatever changed.
    expect(derived.count).toBe(1);
    const next = { ...s, population: s.population + 1 };
    planner.frame(next, env(), 5100);
    expect(derived.count).toBe(2);
  });
});

describe("the planet's channels compared", () => {
  it("by value: made afresh they are the same, one number moved they are not", () => {
    const { env } = city();
    expect(sameChannels(env(), env())).toBe(true);
    expect(sameChannels(env(), { ...env(), pressure: env().pressure * 1.0000001 })).toBe(false);
    expect(sameChannels(env(), null)).toBe(false);
  });
});
