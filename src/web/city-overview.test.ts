// @vitest-environment happy-dom

/**
 * Batch 31's city overview: "on the world map and the HUD: people,
 * shortages, builds in progress" - each read off a real Standard city.
 */

import { describe, expect, it } from "vitest";

import type { BuildingType, HabitatChannels, SimState } from "../sim/index.js";
import { NEUTRAL_ENV, advance, constructionOf, derive, foundSettlement, habitat, marsStart, placeBuilding, upgradeBuilding, worldEnv } from "../sim/index.js";
import { cityOverview, overviewWords } from "./city-overview.js";
import { worldTuning } from "./game-tuning.js";
import { WorldMapScreen } from "./world-map.js";

const T = worldTuning("standard", 0, "standard");
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const envOf = (s: SimState): HabitatChannels => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);

function founded(): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
}
function place(s: SimState, type: BuildingType, near: readonly [number, number] = [46, 46]): SimState {
  for (let r = 4; r < 30; r += 1) {
    for (let k = 0; k < 8 * r; k += 1) {
      const a = (k / (8 * r)) * 2 * Math.PI;
      const o = placeBuilding(s, "settlement-1", type, Math.round(near[0] + r * Math.cos(a)), Math.round(near[1] + r * Math.sin(a)), T);
      if (o.ok) return o.state;
    }
  }
  throw new Error(`nowhere for a ${type}`);
}
function settle(s: SimState): SimState {
  let out = s;
  for (let i = 0; i < 600 && (constructionOf(out.settlements[0]!).size > 0 || out.settlements[0]!.jobs.length > 0); i += 1) out = advance(out, 1, cfg);
  return out;
}
const words = (s: SimState): string => overviewWords(cityOverview(s.settlements[0]!, envOf(s), T), s.settlements[0]!);

describe("a city at a glance", () => {
  it("counts what is going up and what waits: four placed with the headquarters' three rovers", () => {
    let s = founded();
    for (let k = 0; k < 4; k += 1) s = place(s, "solar_array");
    const o = cityOverview(s.settlements[0]!, envOf(s), T);
    expect([o.building, o.waiting, o.upgrading]).toEqual([3, 1, 0]);
    expect(words(s)).toBe("0 of 0 people - nothing short - 3 going up, 1 waiting for a rover");
    // Built: nothing being built.
    s = settle(s);
    expect(words(s)).toMatch(/ - nothing being built$/);
    // An upgrade under way is counted as one, not as a building going up.
    const array = s.settlements[0]!.buildings.find((b) => b.type === "solar_array")!;
    s = upgradeBuilding(s, "settlement-1", array.tx, array.ty, T).state;
    expect(words(s)).toMatch(/ - 1 upgrading$/);
  });

  it("says what is short, and how many live there against the homes", () => {
    let s = settle(place(place(place(founded(), "solar_array"), "solar_array"), "habitat_dome"));
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 30, stores: { ...c.stores, food: 0 } })) };
    expect(words(s)).toBe("30 of 40 people - short of food - nothing being built");
    const fed = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, food: 30 } })) };
    expect(words(fed)).toMatch(/^30 of 40 people - nothing short - /);
  });

  it("is on the world map's panel for the city chosen", () => {
    const s = settle(place(founded(), "solar_array"));
    const host = document.createElement("div");
    document.body.append(host);
    const screen = new WorldMapScreen(host, { onOpen: () => {}, onConnect: () => ({ ok: false, reason: "no", state: s }) as never, onClose: () => {} }, T, () => 0);
    screen.open();
    let now = 0;
    for (let i = 0; i < 500 && /Drawing the map|^$/.test(host.querySelector(".worldmap-hint")!.textContent ?? ""); i += 1) screen.frame(s, envOf(s), (now += 16));
    const at = screen.screenOf(s.settlements[0]!);
    screen.click(at.px, at.py);
    screen.frame(s, envOf(s), (now += 16));
    expect(host.querySelector(".worldmap-name")!.textContent).toBe("Ares");
    expect(host.querySelector(".worldmap-overview")!.textContent).toBe(words(s));
    expect(words(s)).toMatch(/^0 of 0 people - nothing short - nothing being built$/);
    host.remove();
  });
});
