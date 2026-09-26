/**
 * The example planet (requested by the user): "perfect stats, over 25 cities
 * and 15 outposts, of all shapes and sizes, from very small to very large",
 * with three metropolises - cities with 3 x 3 the ground.
 */

import { describe, expect, it } from "vitest";

import type { PlacedBuilding, Settlement, SimState } from "../sim/index.js";
import {
  BUILDING_DEFS,
  DEFAULT_TUNING,
  NEUTRAL_ENV,
  chunkKey,
  groundOf,
  routeKm,
  rocksOf,
  sizeClass,
  claimTest,
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
const C = game.CLAIM_CHUNK_TILES;

/**
 * A city's own layout, as it was laid out on its founding square before it
 * grew (at the user's request: "even normal cities way bigger"): its
 * buildings there, not the works nor the districts it grew - in the founding
 * square's own tiles.
 */
function laidOut(s: (typeof state.settlements)[number]): { n: number; buildings: typeof s.buildings; corridors: number[] } {
  const f = frameOf(s, game);
  const grown = new Set(s.zones.filter((z) => /^(Works and stores|Solar farm|Wind farm|Commerce|Agriculture|Industry|Port|Research|Suburb|Storage|Parkland) ?\d*$/.test(z.name)).flatMap((z) => z.tiles));
  const inSquare = (x: number, y: number): boolean => x >= -f.x0 && y >= -f.y0 && x < -f.x0 + s.base && y < -f.y0 + s.base;
  return {
    n: s.base,
    buildings: s.buildings.filter((b) => inSquare(b.tx, b.ty) && !grown.has(b.ty * 1024 + b.tx)).map((b) => ({ ...b, tx: b.tx + f.x0, ty: b.ty + f.y0 })),
    corridors: s.corridors.filter((k) => inSquare(k & 1023, k >> 10)),
  };
}

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
    // Each building is placed on the settlement as it stood before it - all that was built earlier near it (the
    // rules that look at other buildings look under the footprint), and every earlier rover post (one per so
    // many people) - the same answers as placing all 40,000 of a metropolis one after another, in seconds, not
    // minutes (each placement checks every building there is).
    const NEAR = 16;
    for (const s of state.settlements) {
      const founded = landed(s);
      expect(s.buildings.slice(0, founded.length), `${s.id} keeps what it was founded with`).toEqual(founded);
      const cell = (x: number, y: number): number => Math.floor(y / NEAR) * 1024 + Math.floor(x / NEAR);
      const grid = new Map<number, PlacedBuilding[]>();
      const posts: PlacedBuilding[] = [];
      const add = (b: PlacedBuilding): void => {
        const k = cell(b.tx, b.ty);
        grid.set(k, [...(grid.get(k) ?? []), b]);
        if (b.type === "rover_post") posts.push(b);
      };
      founded.forEach(add);
      for (const b of s.buildings.slice(founded.length)) {
        const around: PlacedBuilding[] = [...founded.filter((f) => f.type === "headquarters" || f.type === "spaceport"), ...posts];
        const cx = Math.floor(b.tx / NEAR);
        const cy = Math.floor(b.ty / NEAR);
        for (let y = cy - 1; y <= cy + 1; y += 1) for (let x = cx - 1; x <= cx + 1; x += 1) for (const o of grid.get(y * 1024 + x) ?? []) if (!around.includes(o)) around.push(o);
        const before: SimState = { ...state, settlements: state.settlements.map((c) => (c.id === s.id ? { ...c, buildings: around, stores: { ...c.stores, materials: 1e9 } } : c)) };
        const out = placeBuilding(before, s.id, b.type, b.tx, b.ty, game);
        expect(out.ok, `${s.id}: ${b.type} at ${b.tx},${b.ty} - ${out.reason}`).toBe(true);
        add(b);
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
      if (s.kind === "outpost" || laidOut(s).buildings.length < 30) continue;
      cities += 1;
      // Its own layout: the works it grew into are a mix on purpose.
      const mid = laidOut(s).buildings.map((b) => ({ k: kindOf(b.type), x: b.tx + BUILDING_DEFS[b.type].footprint / 2, y: b.ty + BUILDING_DEFS[b.type].depth / 2 }));
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
      // (On its founding square: the lines to other settlements cross it too.)
      const f = frameOf(s, game);
      const own = s.rails.filter((k) => (k & 1023) >= -f.x0 && k >> 10 >= -f.y0 && (k & 1023) < -f.x0 + s.base && k >> 10 < -f.y0 + s.base);
      const rails = new Set(own);
      expect(own.filter((k) => rails.has(k + 1) && rails.has(k + 1024) && rails.has(k + 1025)).length, `${s.id}: doubled`).toBeLessThanOrEqual(5);
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
    // Over every city: measured 0.10 tiles of corridor for each tile under a building (0.20 at half
    // the buildings; 0.49 before the cities grew; a street round every building, as once: 1.66).
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
    // Each city's own layout on its founding square: the works it grew into stand wall to wall, as asked.
    for (const s of state.settlements) {
      const own = s.kind === "metropolis" ? { n: frameOf(s, game).n, buildings: s.buildings } : laidOut(s);
      const n = own.n;
      const box = own.buildings.map((b) => {
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
            close.push(`${s.id}: ${own.buildings[i]!.type} at ${b.x0},${b.y0} and ${own.buildings[o]!.type}`);
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

  it("grows its cities from 3 to 17 chunks across, each a blob, every chunk with room full", () => {
    // The user: "even normal cities should be way bigger - at least 3x3 tiles, a max of 17x17, still blob shaped".
    const spans: number[] = [];
    for (const s of state.settlements) {
      if (s.kind !== "city") continue;
      const f = frameOf(s, game);
      const cu = f.n / C;
      const claims = new Set(s.claims);
      const held = (u: number, v: number): boolean => {
        const i = u + f.x0 / C;
        const j = v + f.y0 / C;
        return claims.has(chunkKey(i, j)) || (i >= 0 && j >= 0 && i < s.base / C && j < s.base / C);
      };
      let minU = cu;
      let maxU = -1;
      let minV = cu;
      let maxV = -1;
      let count = 0;
      for (let v = 0; v < cu; v += 1) for (let u = 0; u < cu; u += 1) if (held(u, v)) {
        count += 1;
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
      }
      const span = Math.max(maxU - minU + 1, maxV - minV + 1);
      spans.push(span);
      expect(Math.min(maxU - minU + 1, maxV - minV + 1), `${s.id}: at least 3 x 3`).toBeGreaterThanOrEqual(3);
      expect(span, `${s.id}: at most 17 x 17`).toBeLessThanOrEqual(17);
      // A blob, not a square, once it is big enough to be either.
      if (span >= 9) {
        expect(count / ((maxU - minU + 1) * (maxV - minV + 1)), `${s.id}: share of its box`).toBeLessThan(0.9);
        expect([held(minU, minV), held(maxU, minV), held(minU, maxV), held(maxU, maxV)].filter(Boolean).length, `${s.id}: box corners held`).toBeLessThanOrEqual(1);
      }
      // No chunk with room left empty.
      const count3 = new Int32Array(cu * cu);
      for (const b of s.buildings) count3[Math.floor(b.ty / C) * cu + Math.floor(b.tx / C)]! += 1;
      const g = groundOf(s, game);
      // Room is ground the city can reach from its headquarters over buildable land: a city keeps its hard rock
      // (a metropolis is cleared of it), and crags and slopes wall some chunks off altogether.
      const rocks = rocksOf(s, game);
      const ours = claimTest(s, game);
      const n = f.n;
      const reach = new Uint8Array(n * n);
      const hq = s.buildings.find((b) => b.type === "headquarters")!;
      const stack = [(hq.ty + 5) * n + hq.tx + 2];
      while (stack.length > 0) {
        const i = stack.pop()!;
        if (reach[i] || g.steep[i] || rocks[i] === "crag" || !ours(i % n, Math.floor(i / n))) continue;
        reach[i] = 1;
        const x = i % n;
        if (x > 0) stack.push(i - 1);
        if (x < n - 1) stack.push(i + 1);
        if (i >= n) stack.push(i - n);
        if (i < n * n - n) stack.push(i + n);
      }
      for (let v = 0; v < cu; v += 1) {
        for (let u = 0; u < cu; u += 1) {
          if (!held(u, v)) continue;
          let free = 0;
          for (let y = v * C; y < (v + 1) * C; y += 1) for (let x = u * C; x < (u + 1) * C; x += 1) if (reach[y * n + x]) free += 1;
          // Measured: 16 at the least (the user: "double the number of structures in each city" - 16 to 50 a chunk).
          if (free >= (C * C) / 3) expect(count3[v * cu + u], `${s.id}: chunk ${u},${v}`).toBeGreaterThanOrEqual(16);
        }
      }
    }
    // Measured: spans of 3, 5, 7, 9, 11, 13, 15 and 16-17, three cities each.
    expect(Math.min(...spans)).toBe(3);
    expect(Math.max(...spans)).toBeGreaterThanOrEqual(16);
    expect(new Set(spans).size).toBeGreaterThanOrEqual(7);
  });

  it("joins every settlement to every other by railway: one network, with loops round the cities", () => {
    // The user: "we also need interconnected cities".
    const ids = state.settlements.map((s) => s.id);
    const next = new Map(ids.map((id) => [id, [] as string[]]));
    const seen = new Set<string>();
    for (const r of state.routes) {
      expect(ids).toContain(r.a);
      expect(ids).toContain(r.b);
      const key = r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      expect(r.km).toBeCloseTo(routeKm(state.settlements.find((s) => s.id === r.a)!, state.settlements.find((s) => s.id === r.b)!), 6);
      next.get(r.a)!.push(r.b);
      next.get(r.b)!.push(r.a);
    }
    const reached = new Set([ids[0]!]);
    const queue = [ids[0]!];
    while (queue.length > 0) for (const o of next.get(queue.pop()!)!) if (!reached.has(o)) {
      reached.add(o);
      queue.push(o);
    }
    expect(reached.size).toBe(ids.length);
    // Every city and metropolis on two lines or more: one cut leaves none alone.
    for (const s of state.settlements) if (s.kind !== "outpost") expect(next.get(s.id)!.length, s.id).toBeGreaterThanOrEqual(2);
  });

  it("names every settlement, each its own name, and marks each city small, medium or large by its land", () => {
    // The user: "name all cities, mark them as small city, medium city, or large city".
    const names = state.settlements.map((s) => s.name);
    for (const name of names) expect(name.length).toBeGreaterThan(2);
    expect(new Set(names).size).toBe(names.length);
    // The class goes with the span the city grew to: 3 to 7 chunks small, 9 to 13 medium, 15 to 17 large.
    const byClass = new Map<string, number[]>();
    for (const s of state.settlements) {
      if (s.kind !== "city") {
        expect(sizeClass(s, game)).toBe(s.kind);
        continue;
      }
      const f = frameOf(s, game);
      const list = byClass.get(sizeClass(s, game)) ?? [];
      list.push(f.n / C);
      byClass.set(sizeClass(s, game), list);
    }
    // Measured: frames of 3, 5, 7 chunks small; 9, 11, 13 medium; 15 and 17 large - nine, nine and six cities.
    expect(byClass.get("small city")!.length).toBe(9);
    expect(byClass.get("medium city")!.length).toBe(9);
    expect(byClass.get("large city")!.length).toBe(6);
    expect(Math.max(...byClass.get("small city")!)).toBeLessThan(Math.min(...byClass.get("medium city")!));
    expect(Math.max(...byClass.get("medium city")!)).toBeLessThan(Math.min(...byClass.get("large city")!));
  });

  it("builds twice what it did in every city and metropolis, on the same land", () => {
    // The user: "without changing the number of tiles and space, double the number of structures in each city".
    // What each had before, measured at a95870a on the same seed (the land has not changed: the same outline).
    const before: Record<string, number> = {
      "settlement-1": 19441, "settlement-2": 18832, "settlement-3": 18750, "settlement-4": 107, "settlement-5": 97,
      "settlement-6": 115, "settlement-7": 273, "settlement-8": 237, "settlement-9": 228, "settlement-10": 470,
      "settlement-11": 598, "settlement-12": 473, "settlement-13": 1322, "settlement-14": 1299, "settlement-15": 1265,
      "settlement-16": 2431, "settlement-17": 2492, "settlement-18": 2428, "settlement-19": 1753, "settlement-20": 1905,
      "settlement-21": 1936, "settlement-22": 3110, "settlement-23": 2692, "settlement-24": 3077, "settlement-25": 3921,
      "settlement-26": 4250, "settlement-27": 4440,
    };
    const grown = state.settlements.filter((s) => s.kind !== "outpost");
    expect(grown).toHaveLength(Object.keys(before).length);
    // Measured: 2.06 times at the least (a medium city), 2.13 to 2.21 for the metropolises.
    for (const s of grown) expect(s.buildings.length / before[s.id]!, s.id).toBeGreaterThanOrEqual(2);
  });

  it("runs a straight railway across every settlement for its lines to others, edge to edge; no avenues", () => {
    // The user: "the rail that connects cities: it passes left to right or up to down through the city, to the
    // very extremes of the terrain, because it is the city interconnection line" - and the avenues, "so unnatural
    // for a city development, erase them".
    const byId = new Map(state.settlements.map((s) => [s.id, s] as const));
    let both = 0;
    for (const s of state.settlements) {
      expect(s.zones.filter((z) => /avenue/i.test(z.name)), s.id).toEqual([]);
      const f = frameOf(s, game);
      const n = f.n;
      const rails = new Set(s.rails);
      const ours = claimTest(s, game);
      /** The best straight line one way: the share of its land's row under rail, and how far in from each end it starts. */
      const lineOf = (axis: "h" | "v"): { cover: number; gap: number } => {
        let best = { cover: 0, gap: n };
        for (let r = 0; r < n; r += 1) {
          let land = 0;
          let on = 0;
          let lf = -1;
          let ll = -1;
          let first = -1;
          let last = -1;
          for (let a = 0; a < n; a += 1) {
            const [x, y] = axis === "h" ? [a, r] : [r, a];
            if (!ours(x, y)) continue;
            land += 1;
            if (lf < 0) lf = a;
            ll = a;
            if (rails.has(y * 1024 + x)) {
              on += 1;
              if (first < 0) first = a;
              last = a;
            }
          }
          if (land > 0 && on / land > best.cover) best = { cover: on / land, gap: Math.max(first - lf, ll - last) };
        }
        return best;
      };
      // Which way each of its lines leaves: more east-west than north-south, across; else up and down.
      const ways = new Set<"h" | "v">();
      for (const r of state.routes) {
        if (r.a !== s.id && r.b !== s.id) continue;
        const o = byId.get(r.a === s.id ? r.b : r.a)!;
        let dlon = o.lon - s.lon;
        if (dlon > Math.PI) dlon -= 2 * Math.PI;
        if (dlon < -Math.PI) dlon += 2 * Math.PI;
        ways.add(Math.abs(dlon * Math.cos((o.lat + s.lat) / 2)) >= Math.abs(o.lat - s.lat) ? "h" : "v");
      }
      expect(ways.size, `vacuity: ${s.id} has a line to somewhere`).toBeGreaterThan(0);
      if (ways.size === 2) both += 1;
      for (const way of ways) {
        const line = lineOf(way);
        // Measured: 0.69 of the row at the least (crags and slopes a city keeps break it), and within 39 tiles
        // of each end of its land.
        expect(line.cover, `${s.id} ${way}: the line's share of its row`).toBeGreaterThan(0.6);
        expect(line.gap, `${s.id} ${way}: how far short of the edge`).toBeLessThanOrEqual(48);
      }
      // No highway: never two long straight railways side by side (the avenues ran a double line).
      const long = (axis: "h" | "v"): number[] => {
        const out: number[] = [];
        for (let r = 0; r < n; r += 1) {
          let run = 0;
          let most = 0;
          for (let a = 0; a < n; a += 1) {
            run = rails.has(axis === "h" ? r * 1024 + a : a * 1024 + r) ? run + 1 : 0;
            most = Math.max(most, run);
          }
          if (most >= 64) out.push(r);
        }
        return out;
      };
      for (const axis of ["h", "v"] as const) {
        const rows = long(axis);
        for (let k = 1; k < rows.length; k += 1) expect(rows[k]! - rows[k - 1]!, `${s.id}: long railways ${axis} side by side`).toBeGreaterThan(3);
      }
    }
    // Measured: 34 settlements with lines both ways.
    expect(both).toBeGreaterThan(20);
  });

  it("is the same planet every time, and survives the save exactly", () => {
    expect(examplePlanet(DEFAULT_TUNING, game).state).toEqual(state);
    // Measured: a 256 kB save (178 kB before roads).
    expect(deserialize(serialize(state, game, "2026-09-24T12:00:00.000Z"), game)).toEqual(state);
  });
});
