/**
 * The example planet's metropolises (at the user's request): first "3x
 * bigger; in quarters; very very wide, with ALL structures, a railway
 * station, rovers going back and forth"; then "24x24, clear of all the
 * stones; the centre as it is, with stations and railways; clusters of 2x2,
 * 3x3 and 4x4, big land claims; many corridors in the spaces; a solar zone,
 * wind, malls, storage; zones of colours and purposes; giant railways joining
 * the city's extremes"; then "no empty land - in each empty tile 3 to 25
 * structures, none of them homes, factories and standalone depots, so the
 * city feels full; less square - a blob, same space, a more natural shape";
 * then "erase the highways and corridors at the centre and the borders, so
 * unnatural; double the number of structures in each city".
 */

import { describe, expect, it } from "vitest";

import type { Settlement } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, DEFAULT_TUNING, chunkKey, frameOf, groundOf, makeTuning, networkOf, rocksOf, withRails } from "../sim/index.js";
import { examplePlanet } from "./example.js";

/** The browser's tuning, as the example is built for it. */
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
const { state } = examplePlanet(DEFAULT_TUNING, game);
const metropolises = state.settlements.filter((s) => s.kind === "metropolis");
const C = game.CLAIM_CHUNK_TILES;

/** Row-major: which building (index) is on each tile, or -1. */
function owners(s: Settlement, n: number): Int32Array {
  const g = new Int32Array(n * n).fill(-1);
  s.buildings.forEach((b, i) => {
    const def = BUILDING_DEFS[b.type];
    for (let y = b.ty; y < b.ty + def.depth; y += 1) for (let x = b.tx; x < b.tx + def.footprint; x += 1) g[y * n + x] = i;
  });
  return g;
}

/** The quarters: the founding square and its ring of claimed land, eleven chunks a side, wherever the frame puts them. */
function quarters(s: Settlement): { x0: number; y0: number; side: number } {
  const f = frameOf(s, game);
  return { x0: -f.x0 - C, y0: -f.y0 - C, side: s.base + 2 * C };
}

/** The city's chunks: which of the frame's are its own, and a tally of what stands on each (by its corner). */
function chunks(s: Settlement): { cu: number; held: (u: number, v: number) => boolean; count: Int32Array } {
  const f = frameOf(s, game);
  const cu = f.n / C;
  const claims = new Set(s.claims);
  const held = (u: number, v: number): boolean => {
    const i = u + f.x0 / C;
    const j = v + f.y0 / C;
    return claims.has(chunkKey(i, j)) || (i >= 0 && j >= 0 && i < s.base / C && j < s.base / C);
  };
  const count = new Int32Array(cu * cu);
  for (const b of s.buildings) count[Math.floor(b.ty / C) * cu + Math.floor(b.tx / C)]! += 1;
  return { cu, held, count };
}

const zone = (s: Settlement, name: RegExp) => s.zones.filter((z) => name.test(z.name));
const DISTRICT = /^(Commerce|Agriculture|Industry|Port|Research|Suburb|Storage|Parkland) \d/;

describe("the example's metropolises", () => {
  it("are three, some 620 chunks each - the old city's space - with tens of thousands of buildings", () => {
    // Measured: 619-620 chunks held (the square before held 689), 18,750 to 19,438 buildings, in a frame of 29 chunks.
    expect(metropolises).toHaveLength(3);
    for (const s of metropolises) {
      const { cu, held } = chunks(s);
      let count = 0;
      for (let v = 0; v < cu; v += 1) for (let u = 0; u < cu; u += 1) if (held(u, v)) count += 1;
      expect(count, s.id).toBeGreaterThan(560);
      expect(count, s.id).toBeLessThan(720);
      expect(frameOf(s, game).n, s.id).toBeLessThanOrEqual(31 * C);
      expect(s.buildings.length, s.id).toBeGreaterThan(16_000);
    }
  });

  it("are shaped as a town grows, not a square: a blob, its box's corners wild, every one its own", () => {
    // Measured: 76-82% of the box round them held (a square: 100%), none of its four corners, 13-16
    // different widths from row to row; no two the same shape.
    const shapes: string[] = [];
    for (const s of metropolises) {
      const { cu, held } = chunks(s);
      let minU = cu;
      let maxU = -1;
      let minV = cu;
      let maxV = -1;
      let count = 0;
      const widths = new Set<number>();
      for (let v = 0; v < cu; v += 1) {
        let w = 0;
        for (let u = 0; u < cu; u += 1) {
          if (!held(u, v)) continue;
          w += 1;
          count += 1;
          minU = Math.min(minU, u);
          maxU = Math.max(maxU, u);
          minV = Math.min(minV, v);
          maxV = Math.max(maxV, v);
        }
        if (w > 0) widths.add(w);
      }
      expect(count / ((maxU - minU + 1) * (maxV - minV + 1)), `${s.id}: share of its box`).toBeLessThan(0.88);
      for (const [u, v] of [[minU, minV], [maxU, minV], [minU, maxV], [maxU, maxV]] as const) expect(held(u, v), `${s.id}: corner ${u},${v}`).toBe(false);
      expect(widths.size, `${s.id}: widths`).toBeGreaterThanOrEqual(10);
      shapes.push(s.claims.join(","));
    }
    expect(new Set(shapes).size).toBe(3);
  });

  it("have every structure a metropolis may build", () => {
    for (const s of metropolises) {
      const types = new Set(s.buildings.map((b) => b.type));
      expect(BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].kinds.includes("metropolis") && !types.has(t)), s.id).toEqual([]);
    }
  });

  it("leave no land empty: every chunk with room holds sixteen buildings or more; the works filling them are no homes, 50 at most", () => {
    // The user: "in each empty tile there has to be between 3 and 25 structures, where none is habitative"; then
    // "double the number of structures in each city" - 16 to 50.
    // Measured: every chunk with a third of its ground reachable holds 16 or more; 8,547-9,149 works, 50 at most
    // in a chunk, no home among them.
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const { cu, held, count } = chunks(s);
      const g = groundOf(s, game);
      // Room is flat ground a corridor can reach from the headquarters (a pocket walled in by slopes is not).
      const reach = new Uint8Array(n * n);
      const hq = s.buildings.find((b) => b.type === "headquarters")!;
      const stack = [(hq.ty + 5) * n + hq.tx + 2];
      while (stack.length > 0) {
        const i = stack.pop()!;
        const x = i % n;
        if (reach[i] || g.steep[i] || !held(Math.floor(x / C), Math.floor(i / n / C))) continue;
        reach[i] = 1;
        if (x > 0) stack.push(i - 1);
        if (x < n - 1) stack.push(i + 1);
        if (i >= n) stack.push(i - n);
        if (i < n * n - n) stack.push(i + n);
      }
      let roomy = 0;
      for (let v = 0; v < cu; v += 1) {
        for (let u = 0; u < cu; u += 1) {
          if (!held(u, v)) continue;
          let free = 0;
          for (let y = v * C; y < (v + 1) * C; y += 1) for (let x = u * C; x < (u + 1) * C; x += 1) if (reach[y * n + x]) free += 1;
          if (free < (C * C) / 3) continue;
          roomy += 1;
          expect(count[v * cu + u], `${s.id}: chunk ${u},${v}`).toBeGreaterThanOrEqual(16);
        }
      }
      // Measured: 603-604 chunks with room.
      expect(roomy, `${s.id}: vacuity`).toBeGreaterThan(550);
      const works = new Set(zone(s, /^Works and stores$/).flatMap((z) => z.tiles));
      const inWorks = s.buildings.filter((b) => works.has(b.ty * 1024 + b.tx));
      expect(inWorks.length, `${s.id}: works`).toBeGreaterThan(7000);
      expect(inWorks.filter((b) => BUILDING_DEFS[b.type].housing(game) > 0), `${s.id}: homes among the works`).toEqual([]);
      const perChunk = new Map<number, number>();
      for (const b of inWorks) {
        const c = Math.floor(b.ty / C) * cu + Math.floor(b.tx / C);
        perChunk.set(c, (perChunk.get(c) ?? 0) + 1);
      }
      expect(Math.max(...perChunk.values()), `${s.id}: most works in a chunk`).toBeLessThanOrEqual(50);
      // Mostly factories and stores.
      const factories = ["regolith_mine", "storage_depot", "materials_depot", "water_tank", "battery_bank", "freezer", "water_extractor", "geothermal_plant", "reactor"];
      expect(inWorks.filter((b) => factories.includes(b.type)).length / inWorks.length, s.id).toBeGreaterThan(0.75);
    }
  });

  it("keep their quarters in the middle: straight streets the whole way across, with no building on them", () => {
    // Measured: 18-19 rows and 12-13 columns of boulevard across the quarters, the works among them notwithstanding.
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const own = owners(s, n);
      const q = quarters(s);
      const lines = (across: boolean): number => {
        let groups = 0;
        let inGroup = false;
        for (let a = q.side / 8; a < (7 * q.side) / 8; a += 1) {
          let empty = true;
          for (let b = q.side / 8; b < (7 * q.side) / 8 && empty; b += 1) if (own[across ? (q.y0 + a) * n + q.x0 + b : (q.y0 + b) * n + q.x0 + a]! >= 0) empty = false;
          if (empty && !inGroup) groups += 1;
          inGroup = empty;
        }
        return groups;
      };
      expect(lines(true), `${s.id} rows`).toBeGreaterThanOrEqual(5);
      expect(lines(false), `${s.id} columns`).toBeGreaterThanOrEqual(5);
    }
  });

  it("keep their quarters busy and laid out like a motherboard, and the whole city on one network of each", () => {
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const own = owners(s, n);
      const q = quarters(s);
      let covered = 0;
      for (let y = q.y0; y < q.y0 + q.side; y += 1) for (let x = q.x0; x < q.x0 + q.side; x += 1) if (own[y * n + x]! >= 0) covered += 1;
      expect(covered / q.side ** 2, s.id).toBeGreaterThan(0.18);
      const inside = s.corridors.filter((k) => (k & 1023) >= q.x0 && (k & 1023) < q.x0 + q.side && k >> 10 >= q.y0 && k >> 10 < q.y0 + q.side).length;
      expect(inside / covered, s.id).toBeLessThan(0.4);
      let touching = 0;
      s.buildings.forEach((b, i) => {
        const d = BUILDING_DEFS[b.type];
        const edge: [number, number][] = [];
        for (let x = b.tx; x < b.tx + d.footprint; x += 1) edge.push([x, b.ty - 1], [x, b.ty + d.depth]);
        for (let y = b.ty; y < b.ty + d.depth; y += 1) edge.push([b.tx - 1, y], [b.tx + d.footprint, y]);
        if (edge.some(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && own[y * n + x]! >= 0 && own[y * n + x] !== i)) touching += 1;
      });
      // Measured 0.95: the wind farm's turbines stand apart.
      expect(touching / s.buildings.length, s.id).toBeGreaterThan(0.9);
      expect(networkOf(s.buildings, s.corridors, n).count, s.id).toBe(1);
      expect(networkOf(s.buildings, s.cables, n).count, s.id).toBe(1);
    }
  });

  it("have districts of 2, 3 and 4 chunks a side, and two big claims: a solar farm and a wind farm", () => {
    // Measured: 14-18 districts - 4-7 of 2 x 2, 3-4 of 3 x 3, 7 of 4 x 4 - and both farms 6 x 6, with
    // 1,106-1,278 solar arrays and 686-753 turbines.
    for (const s of metropolises) {
      const sizes = zone(s, DISTRICT).map((z) => Math.round(z.tiles.length / (C * C)));
      for (const want of [4, 9, 16]) expect(sizes.filter((z) => z === want).length, `${s.id}: districts of ${want} chunks`).toBeGreaterThanOrEqual(3);
      const count = (name: string, type: string): number => {
        const z = s.zones.find((x) => x.name === name);
        expect(z, `${s.id}: ${name}`).toBeDefined();
        expect(z!.tiles.length, `${s.id}: ${name} is a big claim`).toBeGreaterThanOrEqual(25 * C * C);
        const tiles = new Set(z!.tiles);
        return s.buildings.filter((b) => tiles.has(b.ty * 1024 + b.tx) && b.type === type).length;
      };
      expect(count("Solar farm", "solar_array"), s.id).toBeGreaterThan(800);
      expect(count("Wind farm", "wind_turbine"), s.id).toBeGreaterThan(400);
    }
  });

  it("are clear of every stone", () => {
    for (const s of metropolises) expect(rocksOf(s, game).filter((r) => r !== "none").length, s.id).toBe(0);
    // Vacuity: the planet's other settlements still have their rocks.
    expect(state.settlements.filter((s) => s.kind === "city").some((s) => rocksOf(s, game).some((r) => r !== "none"))).toBe(true);
  });

  it("run giant railways: every station on one line, bridged over the corridors", () => {
    // Measured: 6-7 stations, the quarters' own (the districts keep none since the avenues went); 51-120 bridges.
    // The line to other settlements, edge to edge across the city: see example.test.ts.
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const stations = s.buildings.map((b, i) => (b.type === "station" ? i : -1)).filter((i) => i >= 0);
      expect(stations.length, s.id).toBeGreaterThanOrEqual(5);
      const net = withRails(networkOf(s.buildings, [], n), s.buildings, s.rails, n);
      expect(new Set(stations.map((i) => net.of[i])).size, s.id).toBe(1);
      const corridors = new Set(s.corridors);
      expect(s.rails.filter((k) => corridors.has(k)).length, `${s.id}: bridges`).toBeGreaterThan(30);
    }
  });

  it("are planned in zones of many colours: every quarter, district and the works", () => {
    // Measured: 82-86 zones in 14 colours; all but one building in a zone.
    for (const s of metropolises) {
      expect(s.zones.length, s.id).toBeGreaterThan(60);
      expect(new Set(s.zones.map((z) => z.colour)).size, s.id).toBeGreaterThanOrEqual(10);
      const zoned = new Set(s.zones.flatMap((z) => z.tiles));
      expect(s.buildings.filter((b) => zoned.has(b.ty * 1024 + b.tx)).length / s.buildings.length, s.id).toBeGreaterThan(0.98);
    }
  });

  it("are alive: rovers out, rockets away", () => {
    for (const s of metropolises) {
      expect(s.jobs.filter((j) => j.kind === "rover").length, s.id).toBeGreaterThanOrEqual(5);
      expect(s.jobs.filter((j) => j.kind === "rocket").length, s.id).toBeGreaterThanOrEqual(3);
    }
  });
});
