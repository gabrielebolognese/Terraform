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
  foundingBuildings,
  makeTuning,
  networkOf,
  placeBuilding,
  keyTile,
  placeLink,
  serialize,
  settlementStep,
  siteElevation,
  worldEnv,
} from "../sim/index.js";
import { examplePlanet } from "./example.js";

/** The browser's tuning: the example is built for the game as it is played. */
const game = makeTuning({ EVENTS_ENABLED: 1, ECONOMY_ENABLED: 1, TECH_GATE_ENABLED: 1, SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12, NETWORK_ENABLED: 1, HEADQUARTERS_ENABLED: 1 });
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
    // Measured: 5 to 737 buildings; the metropolises 640, 732 and 737 (3,416 in all).
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
    // Independent of the layout code: a copy of each settlement as it was
    // founded (the headquarters and a city's spaceport are landed, never
    // built), and `placeBuilding` - the call a player's click makes - for
    // every building after those.
    let replay: SimState = { ...state, settlements: state.settlements.map((s) => ({ ...s, buildings: foundingBuildings(s.kind, game), stores: { ...s.stores, materials: 1e9 } })) };
    for (const s of state.settlements) {
      const founded = foundingBuildings(s.kind, game);
      expect(s.buildings.slice(0, founded.length), `${s.id} keeps what it was founded with`).toEqual(founded);
      for (const b of s.buildings.slice(founded.length)) {
        const out = placeBuilding(replay, s.id, b.type, b.tx, b.ty, game);
        expect(out.ok, `${s.id}: ${b.type} at ${b.tx},${b.ty} - ${out.reason}`).toBe(true);
        replay = out.state;
      }
      expect(s.buildings.every((b) => BUILDING_DEFS[b.type].kinds.includes(s.kind))).toBe(true);
    }
  });

  it("lays only corridors and cables a player could lay, and joins every settlement into one network of each", () => {
    // Independent of the street and join code: each road replayed through
    // `placeLink` - the call a player's click makes - on the settlement
    // as built, with materials to spare. 42 hilly grids.
    for (const s of state.settlements) {
      for (const layer of ["corridors", "cables"] as const) {
        let replay: SimState = { ...state, settlements: state.settlements.map((c) => (c.id === s.id ? { ...c, [layer]: [], stores: { ...c.stores, materials: 1e9 } } : c)) };
        for (const key of s[layer]) {
          const { tx, ty } = keyTile(key);
          const out = placeLink(replay, s.id, layer, tx, ty, game);
          expect(out.ok, `${s.id}: ${layer} at ${tx},${ty} - ${out.reason}`).toBe(true);
          replay = out.state;
        }
        expect(networkOf(s.buildings, s[layer], gridTiles(s.kind, game)).count, `${s.id} ${layer}`).toBe(1);
      }
    }
  });

  it("is the same planet every time, and survives the save exactly", () => {
    expect(examplePlanet(DEFAULT_TUNING, game).state).toEqual(state);
    // Measured: a 256 kB save (178 kB before roads).
    expect(deserialize(serialize(state, game, "2026-09-24T12:00:00.000Z"), game)).toEqual(state);
  });
});
