/**
 * The Rover Post (at the user's request): "a structure called rover post,
 * that allows you to have an additional rover, costs 300 materials, occupies
 * a 5x5, max 1 per 100 people."
 */

import { describe, expect, it } from "vitest";

import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { SimState } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { foundSettlement } from "./registry.js";
import { rocksOf } from "./rocks.js";
import { placeBuilding, sendRover } from "./settlement.js";

// Flat ground, so where a post goes is never the question; loose rocks to send rovers to.
const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, CITY_GRID_TILES: 96 });

function city(people: number, materials = 2000, kind: "city" | "outpost" = "city"): SimState {
  const s = foundSettlement(marsStart(undefined, T), kind, 0.31, -1.2, T).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: people, stores: { ...c.stores, materials } })) };
}
const id = (s: SimState): string => s.settlements[0]!.id;

describe("the Rover Post", () => {
  it("is a 5 x 5 structure for 300 materials, built in a city", () => {
    const s = city(100);
    const o = placeBuilding(s, id(s), "rover_post", 10, 10, T);
    expect(o.ok, o.reason ?? "").toBe(true);
    const after = o.state.settlements[0]!;
    expect(after.stores.materials).toBe(2000 - 300);
    // It covers 5 x 5: a depot on its far corner is refused, one just past it is not.
    expect(placeBuilding(o.state, id(s), "storage_depot", 14, 14, T).reason).toMatch(/overlap/);
    expect(placeBuilding(o.state, id(s), "storage_depot", 15, 14, T).ok).toBe(true);
    expect(placeBuilding(city(100, 299), id(s), "rover_post", 10, 10, T).reason).toMatch(/needs 300 materials/);
    expect(placeBuilding(city(1000, 2000, "outpost"), id(s), "rover_post", 2, 2, T).ok).toBe(false);
  });

  it("is one for every 100 people", () => {
    let s = city(99);
    expect(placeBuilding(s, id(s), "rover_post", 10, 10, T).reason).toMatch(/needs 100 people/);
    s = city(250);
    s = placeBuilding(s, id(s), "rover_post", 10, 10, T).state;
    s = placeBuilding(s, id(s), "rover_post", 10, 20, T).state;
    expect(s.settlements[0]!.buildings.filter((b) => b.type === "rover_post")).toHaveLength(2);
    expect(placeBuilding(s, id(s), "rover_post", 10, 30, T).reason).toMatch(/needs 300 people/);
  });

  it("gives the city one more rover each", () => {
    const loose = (s: SimState): [number, number][] =>
      rocksOf(s.settlements[0]!, T)
        .map((r, i) => [r, i % 96, Math.floor(i / 96)] as const)
        .filter(([r]) => r === "loose")
        .map(([, x, y]) => [x, y]);
    const sendAll = (s: SimState): { state: SimState; sent: number; reason: string | null } => {
      let state = s;
      let sent = 0;
      let reason: string | null = null;
      for (const [x, y] of loose(s).slice(0, 10)) {
        const o = sendRover(state, id(state), x, y, T);
        if (!o.ok) {
          reason = o.reason;
          break;
        }
        state = o.state;
        sent += 1;
      }
      return { state, sent, reason };
    };
    const without = sendAll(city(200));
    expect(without.sent).toBe(T.ROVERS_PER_HQ);
    expect(without.reason).toMatch(new RegExp(`all ${T.ROVERS_PER_HQ} rovers are out`));
    let s = city(200);
    s = placeBuilding(s, id(s), "rover_post", 10, 10, T).state;
    s = placeBuilding(s, id(s), "rover_post", 10, 20, T).state;
    const two = sendAll(s);
    expect(two.sent).toBe(T.ROVERS_PER_HQ + 2);
  });

  it("is saved like any building", () => {
    let s = city(100, 1000);
    s = placeBuilding(s, id(s), "rover_post", 10, 10, T).state;
    const loaded = deserialize(serialize(s, T, "2026-09-25T00:00:00.000Z"), T);
    expect(loaded.settlements[0]!.buildings.some((b) => b.type === "rover_post")).toBe(true);
    expect(BUILDING_DEFS.rover_post.buildable).toBe(true);
  });
});
