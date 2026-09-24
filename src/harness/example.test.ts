/**
 * The example planet (requested by the user): "perfect stats, over 25 cities
 * and 15 outposts, of all shapes and sizes, from very small to very large",
 * with three metropolises - cities with 3 x 3 the ground.
 */

import { describe, expect, it } from "vitest";

import type { Settlement, SimState } from "../sim/index.js";
import {
  BUILDING_DEFS,
  DEFAULT_TUNING,
  NEUTRAL_ENV,
  computeProgress,
  derive,
  deserialize,
  gridTiles,
  habitat,
  makeTuning,
  placeBuilding,
  serialize,
  settlementStep,
  siteElevation,
  worldEnv,
} from "../sim/index.js";
import { examplePlanet } from "./example.js";

/** The browser's tuning: the example is built for the game as it is played. */
const game = makeTuning({ EVENTS_ENABLED: 1, ECONOMY_ENABLED: 1, TECH_GATE_ENABLED: 1, SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const { state } = examplePlanet(DEFAULT_TUNING, game);
const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game), game, 0);

const byKind = (kind: Settlement["kind"]): Settlement[] => state.settlements.filter((s) => s.kind === kind);

describe("the example planet", () => {
  it("has perfect stats: the reference playthrough's plateau, every milestone reached", () => {
    const d = derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game);
    // Measured: progress 0.9863 - where the reference playthrough levels off.
    expect(computeProgress(state.reservoirs, d, game).progress).toBeGreaterThan(0.98);
    expect(state.phaseReached).toBe(6);
  });

  it("has over 25 cities, 3 of them metropolises, and 15 outposts", () => {
    const cities = byKind("city").length + byKind("metropolis").length;
    expect(cities).toBeGreaterThan(25);
    expect(byKind("metropolis").length).toBe(3);
    expect(byKind("outpost").length).toBe(15);
  });

  it("has every size, from a handful of buildings to hundreds", () => {
    // Measured: 5 to 758 buildings; the metropolises 640, 734 and 758 (3,443 in all).
    const counts = state.settlements.map((s) => s.buildings.length);
    expect(Math.min(...counts)).toBeLessThanOrEqual(6);
    expect(Math.max(...counts)).toBeGreaterThan(500);
    for (const m of byKind("metropolis")) expect(m.buildings.length).toBeGreaterThan(Math.max(...byKind("city").map((c) => c.buildings.length)));
  });

  it("gives a metropolis 3 x 3 a city's ground, and builds right across it", () => {
    const m = byKind("metropolis")[0]!;
    expect(gridTiles("metropolis", game)).toBe(3 * gridTiles("city", game));
    // Buildings beyond where any city's grid would end.
    expect(m.buildings.some((b) => b.tx >= gridTiles("city", game) || b.ty >= gridTiles("city", game))).toBe(true);
  });

  it("keeps every city living: all needs met, people in nine homes in ten", () => {
    for (const s of state.settlements) {
      if (s.kind === "outpost") continue;
      const step = settlementStep(s, env, game, game.SUBSTEP_YEARS);
      expect(step.supported, `${s.id} short of ${step.shortages.join(", ")}`).toBe(true);
      expect(s.population).toBeGreaterThan(0);
    }
  });

  it("runs every building: nothing on a perfect planet stands idle", () => {
    // The first version built Atmosphere Processors; with 0.24 mbar of CO2 in
    // a finished atmosphere all 144 were offline, badged, on a "perfect" world.
    for (const s of state.settlements) {
      const step = settlementStep(s, env, game, game.SUBSTEP_YEARS);
      s.buildings.forEach((b, i) => expect(step.operable[i], `${s.id}: ${b.type} at ${b.tx},${b.ty}`).toBe(true));
    }
  });

  it("stands every settlement high above the sea", () => {
    for (const s of state.settlements) expect(siteElevation(s.lat, s.lon, game) - env.seaLevelM, s.id).toBeGreaterThan(300);
  });

  it("follows the placement rules, checked by placing every building again through the game's own API", () => {
    // Independent of the layout code: an empty copy of each settlement, and
    // `placeBuilding` - the call a player's click makes - for each building.
    let replay: SimState = { ...state, settlements: state.settlements.map((s) => ({ ...s, buildings: [], stores: { ...s.stores, materials: 1e9 } })) };
    for (const s of state.settlements) {
      for (const b of s.buildings) {
        const out = placeBuilding(replay, s.id, b.type, b.tx, b.ty, game);
        expect(out.ok, `${s.id}: ${b.type} at ${b.tx},${b.ty} - ${out.reason}`).toBe(true);
        replay = out.state;
      }
      expect(s.buildings.every((b) => BUILDING_DEFS[b.type].kinds.includes(s.kind))).toBe(true);
    }
  });

  it("is the same planet every time, and survives the save exactly", () => {
    expect(examplePlanet(DEFAULT_TUNING, game).state).toEqual(state);
    // Measured: a 178 kB save.
    expect(deserialize(serialize(state, game, "2026-09-24T12:00:00.000Z"), game)).toEqual(state);
  });
});
