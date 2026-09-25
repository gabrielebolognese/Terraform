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
  cityView,
  computeProgress,
  derive,
  deserialize,
  gridTiles,
  frameOf,
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
import { trainLinesOf } from "../render/city.js";
import { examplePlanet } from "./example.js";

/** The browser's tuning: the example is built for the game as it is played. */
const game = makeTuning({
  EVENTS_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  TECH_GATE_ENABLED: 1,
  SETTLEMENTS_ENABLED: 1,
  TERRAIN_RELIEF_M: 12,
  NETWORK_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  ROCK_CLUSTER_CHANCE: 0.65,
  CITY_GRID_TILES: 96,
  OUTPOST_GRID_TILES: 48,
  METROPOLIS_GRID_TILES: 288,
});
const { state, sizes } = examplePlanet(DEFAULT_TUNING, game);
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
    // Measured: 6 to 1,068 buildings; the metropolises 648, 858 and 1,068 (4,269 in all).
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

  it("makes what it draws: no settlement lives off its full stores", () => {
    // Full stores hide a deficit for decades - a metropolis whose water was not made good ran 5,000 a
    // year short and every need was still met, measured. Measured now: the least net anywhere is 0.
    for (const s of state.settlements) {
      const step = settlementStep(s, env, game, game.SUBSTEP_YEARS);
      for (const r of ["power", "water", "oxygen", "food"] as const) expect(step.production[r] - step.consumption[r], `${s.id}: ${r}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("runs every building: nothing on a perfect planet stands idle", () => {
    // The first version built Atmosphere Processors; with 0.24 mbar of CO2 in
    // a finished atmosphere all 144 were offline, badged, on a "perfect" world.
    for (const s of state.settlements) {
      const step = settlementStep(s, env, game, game.SUBSTEP_YEARS);
      // But the Atmosphere Processors, in a metropolis for its "ALL structures": on
      // a finished planet the air holds too little CO2 for them, and the
      // simulation stands them idle, as it should.
      s.buildings.forEach((b, i) => {
        if (b.type !== "atmosphere_processor") expect(step.operable[i], `${s.id}: ${b.type} at ${b.tx},${b.ty}`).toBe(true);
      });
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
    // What it was founded with, where it stands now: a claim west or north moved the frame's corner.
    const landed = (s: (typeof state.settlements)[number]) => {
      const f = frameOf(s, game);
      return foundingBuildings(s.kind, game).map((b) => ({ ...b, tx: b.tx - f.x0, ty: b.ty - f.y0 }));
    };
    let replay: SimState = { ...state, settlements: state.settlements.map((s) => ({ ...s, buildings: landed(s), stores: { ...s.stores, materials: 1e9 } })) };
    for (const s of state.settlements) {
      const founded = landed(s);
      expect(s.buildings.slice(0, founded.length), `${s.id} keeps what it was founded with`).toEqual(founded);
      for (const b of s.buildings.slice(founded.length)) {
        const out = placeBuilding(replay, s.id, b.type, b.tx, b.ty, game);
        expect(out.ok, `${s.id}: ${b.type} at ${b.tx},${b.ty} - ${out.reason}`).toBe(true);
        replay = out.state;
      }
      expect(s.buildings.every((b) => BUILDING_DEFS[b.type].kinds.includes(s.kind))).toBe(true);
    }
  });

  it("lays only corridors, cables and railways a player could lay, and joins every settlement into one network of each", () => {
    // Independent of the street and join code: each tile asked of `placeLink`
    // - the call a player's click makes - on the settlement as built, with
    // that layer taken up and materials to spare. (Replayed one by one onto
    // each other, a metropolis's 40,000 street tiles re-sorted a growing
    // list each: minutes.) 42 hilly grids.
    let checked = 0;
    for (const s of state.settlements) {
      for (const layer of ["corridors", "cables", "rails"] as const) {
        const bare: SimState = { ...state, settlements: state.settlements.map((c) => (c.id === s.id ? { ...c, [layer]: [], stores: { ...c.stores, materials: 1e9 } } : c)) };
        for (const key of s[layer]) {
          const { tx, ty } = keyTile(key);
          const out = placeLink(bare, s.id, layer, tx, ty, game);
          if (!out.ok) expect(out.ok, `${s.id}: ${layer} at ${tx},${ty} - ${out.reason}`).toBe(true);
          checked += 1;
        }
        if (layer !== "rails") expect(networkOf(s.buildings, s[layer], frameOf(s, game).n).count, `${s.id} ${layer}`).toBe(1);
      }
    }
    expect(checked, "vacuity: tiles to check").toBeGreaterThan(10_000);
    expect(state.settlements.some((s) => s.rails.length > 100), "vacuity: a railway").toBe(true);
  });

  it("lays its cities out in zones - habitat, power, industry, a port, mixed - not a jumble", () => {
    // The user: "add zoning: so mining zones, habitat zones, solar panel zones,
    // some mixed of any type, a port zone". Of each building's four nearest
    // neighbours, the share of its own kind: measured 0.74 to 0.85 over every
    // city of 30 buildings or more; a random mix of the same buildings would
    // give 0.30 (the sum of the squared shares of each kind).
    // The later kinds by what they are: a freezer and a biosphere feed homes, wind and batteries are power, a park is anyone's.
    const kindOf = (t: string): string =>
      ["habitat_dome", "greenhouse", "freezer", "biosphere"].includes(t) ? "home" : ["solar_array", "geothermal_plant", "reactor", "wind_turbine", "battery_bank"].includes(t) ? "power" : t === "spaceport" ? "port" : t === "headquarters" ? "hq" : t === "park" ? "park" : "industry";
    let cities = 0;
    for (const s of state.settlements) {
      if (s.kind === "outpost" || s.buildings.length < 30) continue;
      cities += 1;
      const mid = s.buildings.map((b) => ({ k: kindOf(b.type), x: b.tx + BUILDING_DEFS[b.type].footprint / 2, y: b.ty + BUILDING_DEFS[b.type].depth / 2 }));
      // Neighbours looked for in cells of 16 tiles, ring by ring (sorting the whole city for each building took 31 s a metropolis).
      const cells = new Map<string, typeof mid>();
      for (const m of mid) {
        const key = `${Math.floor(m.x / 16)},${Math.floor(m.y / 16)}`;
        cells.set(key, [...(cells.get(key) ?? []), m]);
      }
      let same = 0;
      let all = 0;
      for (const a of mid) {
        const cx = Math.floor(a.x / 16);
        const cy = Math.floor(a.y / 16);
        let pool: typeof mid = [];
        for (let r = 1; r < 40 && pool.length < 5; r += 1) {
          pool = [];
          for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) pool.push(...(cells.get(`${cx + dx},${cy + dy}`) ?? []));
        }
        const near = pool.filter((b) => b !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)).slice(0, 4);
        for (const b of near) {
          all += 1;
          if (b.k === a.k) same += 1;
        }
      }
      expect(same / all, s.id).toBeGreaterThan(0.65);
    }
    expect(cities, "vacuity: cities big enough to zone").toBeGreaterThan(15);
  });

  it("runs a railway round every city of four homes or more, with trains on all of it, and plans every city in zones of colours", () => {
    // The user: "the cities need more railways, and working trains ... the cities have a deep city planning,
    // zones with different colours, purposes". Measured: 16 cities of four homes or more, 86 to 343 tiles of
    // railway each, every tile of it on a train's loop; 4 to 9 zones a city, in 4 or 5 colours.
    let railed = 0;
    for (const s of state.settlements) {
      if (s.kind !== "city") continue;
      expect(s.zones.length, `${s.id}: zones`).toBeGreaterThanOrEqual(4);
      expect(new Set(s.zones.map((z) => z.colour)).size, `${s.id}: colours`).toBeGreaterThanOrEqual(4);
      // Its districts' buildings are in its zones.
      const zoned = new Set(s.zones.flatMap((z) => z.tiles));
      expect(s.buildings.filter((b) => b.type !== "headquarters" && !zoned.has(b.ty * 1024 + b.tx)), `${s.id}: unzoned`).toEqual([]);
      if ((sizes[s.id] ?? 0) < 4) continue;
      railed += 1;
      expect(s.rails.length, `${s.id}: railway`).toBeGreaterThan(60);
      const view = cityView(s, env, game);
      const on = new Set(trainLinesOf(view).flatMap((l) => l.tiles));
      expect(s.rails.filter((k) => !on.has((k >> 10) * view.tiles + (k & 1023))), `${s.id}: rails no train runs on`).toEqual([]);
      // One line, not doubled: a 2 x 2 square of rail is a stretch laid twice side by side. Measured: at most 4
      // a city, where legs meet at their stops (laid without keeping off the line before, up to 27).
      const rails = new Set(s.rails);
      expect(s.rails.filter((k) => rails.has(k + 1) && rails.has(k + 1024) && rails.has(k + 1025)).length, `${s.id}: doubled`).toBeLessThanOrEqual(5);
    }
    expect(railed, "vacuity: cities big enough for a railway").toBeGreaterThanOrEqual(15);
  });

  it("gives every city of four homes or more a port: four spaceports in a line, six in a metropolis", () => {
    for (const s of state.settlements) {
      if (s.kind === "outpost" || (sizes[s.id] ?? 0) < 4) continue;
      const rows = new Map<number, number[]>();
      for (const b of s.buildings) if (b.type === "spaceport") rows.set(b.ty, [...(rows.get(b.ty) ?? []), b.tx]);
      // The longest run of spaceports side by side along one row, a street apart.
      let longest = 0;
      for (const xs of rows.values()) {
        xs.sort((a, b) => a - b);
        let run = 1;
        longest = Math.max(longest, 1);
        for (let k = 1; k < xs.length; k += 1) {
          run = xs[k]! - xs[k - 1]! <= 3 + 3 ? run + 1 : 1;
          longest = Math.max(longest, run);
        }
      }
      expect(longest, s.id).toBeGreaterThanOrEqual(s.kind === "metropolis" ? 6 : 4);
    }
  });

  it("joins its cities by the shortest traces, not a street round every building", () => {
    // The user: "the metropolis and cities have far, far too many corridors".
    // Measured over every city: 0.49 tiles of corridor for each tile under a
    // building (a street round every building, as before: 1.66).
    let corridor = 0;
    let built = 0;
    for (const s of state.settlements) {
      if (s.kind !== "city") continue;
      corridor += s.corridors.length;
      for (const b of s.buildings) built += BUILDING_DEFS[b.type].footprint * BUILDING_DEFS[b.type].depth;
    }
    expect(built, "vacuity: cities").toBeGreaterThan(1000);
    expect(corridor / built).toBeLessThan(0.8);
  });

  it("spreads each city out - its centre and its corners - with room round every building", () => {
    // The user: "not cramped up. Things at the corners, and things at the
    // center, decentralized." Measured: every city of four homes or more has
    // buildings in its centre and in 3 or 4 of its corners (the outer thirds
    // both ways); no two buildings closer than 2 tiles, but the headquarters
    // and the spaceport it lands with, which share a wall.
    for (const s of state.settlements) {
      const n = frameOf(s, game).n;
      const box = s.buildings.map((b) => {
        const z = BUILDING_DEFS[b.type].footprint;
        const d = BUILDING_DEFS[b.type].depth;
        return { x0: b.tx, y0: b.ty, x1: b.tx + z, y1: b.ty + d, cx: b.tx + z / 2, cy: b.ty + d / 2 };
      });
      const founded = foundingBuildings(s.kind, game).length;
      // Two apart: no other building on any tile within two of a building's footprint.
      // By a grid of owners (every pair against every pair was 40 million checks a metropolis).
      const owner = new Int32Array(n * n).fill(-1);
      box.forEach((b, i) => {
        for (let y = b.y0; y < b.y1; y += 1) for (let x = b.x0; x < b.x1; x += 1) if (x >= 0 && y >= 0 && x < n && y < n) owner[y * n + x] = i;
      });
      const close: string[] = [];
      // (A metropolis builds in blocks, wall to wall - "some parts can also be aggregated together".)
      if (s.kind !== "metropolis") box.forEach((b, i) => {
        for (let y = b.y0 - 2; y <= b.y1 + 1; y += 1) {
          for (let x = b.x0 - 2; x <= b.x1 + 1; x += 1) {
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            const o = owner[y * n + x]!;
            if (o < 0 || o === i || (o < founded && i < founded)) continue;
            close.push(`${s.id}: ${s.buildings[i]!.type} at ${b.x0},${b.y0} and ${s.buildings[o]!.type}`);
          }
        }
      });
      expect(close.slice(0, 3)).toEqual([]);
      if (s.kind === "outpost" || (sizes[s.id] ?? 0) < 4) continue;
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].filter(([qx, qy]) => box.some((b) => (qx ? b.cx > (2 * n) / 3 : b.cx < n / 3) && (qy ? b.cy > (2 * n) / 3 : b.cy < n / 3))).length;
      expect(corners, s.id).toBeGreaterThanOrEqual(3);
      expect(box.some((b) => Math.abs(b.cx - n / 2) < n / 6 && Math.abs(b.cy - n / 2) < n / 6), s.id).toBe(true);
    }
  });

  it("is the same planet every time, and survives the save exactly", () => {
    expect(examplePlanet(DEFAULT_TUNING, game).state).toEqual(state);
    // Measured: a 256 kB save (178 kB before roads).
    expect(deserialize(serialize(state, game, "2026-09-24T12:00:00.000Z"), game)).toEqual(state);
  });
});
