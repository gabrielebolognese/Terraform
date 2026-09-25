/**
 * The example planet's metropolises (at the user's request): first "3x
 * bigger; a little more order, in quarters; the city full besides some parts,
 * very very wide, with ALL structures, including a railway station, rovers
 * going back and forth"; then "the metropolis has an 8x8 grid - far too
 * small, do it 24x24; clear of all the stones; the center 8x8 remains as it
 * is, with stations and railways; in the outer parts 2x2, 3x3 and 4x4
 * clusters, at least one or two big land claims, spaced, where in the spaces
 * there are many corridors; one zone for solar panels; wind turbines,
 * mega-malls, storage; deep city planning zones with different colours and
 * purposes; giant railways that interconnect the extremes of the city".
 */

import { describe, expect, it } from "vitest";

import type { Settlement } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, DEFAULT_TUNING, chunkKey, frameOf, makeTuning, networkOf, rocksOf, withRails } from "../sim/index.js";
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

/** Row-major: which tiles are under a building. */
function under(s: Settlement, n: number): Uint8Array {
  const g = new Uint8Array(n * n);
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    for (let y = b.ty; y < b.ty + def.depth; y += 1) for (let x = b.tx; x < b.tx + def.footprint; x += 1) g[y * n + x] = 1;
  }
  return g;
}

/** The quarters: the founding square and its ring, eleven chunks a side, in the middle of the frame. */
function quarters(s: Settlement): { lo: number; hi: number } {
  const n = frameOf(s, game).n;
  const side = s.base + 2 * C;
  return { lo: (n - side) / 2, hi: (n + side) / 2 };
}

/** Each chunk of the frame outside the quarters: claimed or wild, and how much of it is built on and laid with corridor. */
function outerChunks(s: Settlement): { u: number; v: number; claimed: boolean; built: number; corridor: number }[] {
  const f = frameOf(s, game);
  const n = f.n;
  const u8 = under(s, n);
  const corr = new Uint8Array(n * n);
  for (const k of s.corridors) corr[(k >> 10) * n + (k & 1023)] = 1;
  const claims = new Set(s.claims);
  const { lo, hi } = quarters(s);
  const out: { u: number; v: number; claimed: boolean; built: number; corridor: number }[] = [];
  for (let v = 0; v < n / C; v += 1) {
    for (let u = 0; u < n / C; u += 1) {
      if (u * C >= lo && u * C < hi && v * C >= lo && v * C < hi) continue;
      let built = 0;
      let corridor = 0;
      for (let y = v * C; y < (v + 1) * C; y += 1) for (let x = u * C; x < (u + 1) * C; x += 1) {
        built += u8[y * n + x]!;
        corridor += corr[y * n + x]!;
      }
      out.push({ u, v, claimed: claims.has(chunkKey(u + f.x0 / C, v + f.y0 / C)), built: built / (C * C), corridor: corridor / (C * C) });
    }
  }
  return out;
}

describe("the example's metropolises", () => {
  it("are three, 992 tiles a side - the quarters' eleven chunks in the middle, ten more each side - with tens of thousands of buildings", () => {
    // Measured: 992 tiles (31 chunks) a side, 21,029 to 21,236 buildings (were 352 tiles and ~6,400).
    // A side of 24 of the old 44-tile quarters, 1,056 tiles, would not fit a frame: tile keys stop at 1,024.
    expect(metropolises).toHaveLength(3);
    for (const s of metropolises) {
      expect(frameOf(s, game).n, s.id).toBe(31 * C);
      expect(s.buildings.length, s.id).toBeGreaterThan(18_000);
    }
  });

  it("have every structure a metropolis may build", () => {
    for (const s of metropolises) {
      const types = new Set(s.buildings.map((b) => b.type));
      expect(BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].kinds.includes("metropolis") && !types.has(t)), s.id).toEqual([]);
    }
  });

  it("keep their quarters in the middle: straight streets the whole way across, with no building on them", () => {
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const u = under(s, n);
      const { lo, hi } = quarters(s);
      const side = hi - lo;
      const lines = (across: boolean): number => {
        let groups = 0;
        let inGroup = false;
        for (let a = lo + side / 8; a < lo + (7 * side) / 8; a += 1) {
          let empty = true;
          for (let b = lo + side / 8; b < lo + (7 * side) / 8 && empty; b += 1) if (u[across ? a * n + b : b * n + a]) empty = false;
          if (empty && !inGroup) groups += 1;
          inGroup = empty;
        }
        return groups;
      };
      expect(lines(true), `${s.id} rows`).toBeGreaterThanOrEqual(5);
      expect(lines(false), `${s.id} columns`).toBeGreaterThanOrEqual(5);
    }
  });

  it("keep their quarters busy, and laid out like a motherboard: blocks wall to wall, a trace to each block", () => {
    // Measured in the quarters: 23% of the ground built on; 0.19 tiles of corridor
    // for each tile under a building (a street two deep round each, as once: 2.97).
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const u = under(s, n);
      const { lo, hi } = quarters(s);
      let covered = 0;
      for (let y = lo; y < hi; y += 1) for (let x = lo; x < hi; x += 1) covered += u[y * n + x]!;
      expect(covered / (hi - lo) ** 2, s.id).toBeGreaterThan(0.18);
      const inside = s.corridors.filter((k) => (k & 1023) >= lo && (k & 1023) < hi && k >> 10 >= lo && k >> 10 < hi).length;
      expect(inside / covered, s.id).toBeLessThan(0.4);
      let touching = 0;
      const own = new Int32Array(n * n).fill(-1);
      s.buildings.forEach((b, i) => {
        const d = BUILDING_DEFS[b.type];
        for (let y = b.ty; y < b.ty + d.depth; y += 1) for (let x = b.tx; x < b.tx + d.footprint; x += 1) own[y * n + x] = i;
      });
      s.buildings.forEach((b, i) => {
        const d = BUILDING_DEFS[b.type];
        const edge: [number, number][] = [];
        for (let x = b.tx; x < b.tx + d.footprint; x += 1) edge.push([x, b.ty - 1], [x, b.ty + d.depth]);
        for (let y = b.ty; y < b.ty + d.depth; y += 1) edge.push([b.tx - 1, y], [b.tx + d.footprint, y]);
        if (edge.some(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && own[y * n + x]! >= 0 && own[y * n + x] !== i)) touching += 1;
      });
      // Measured 0.95: the wind farm's turbines stand apart.
      expect(touching / s.buildings.length, s.id).toBeGreaterThan(0.9);
      // And one network of each over the whole city: every building on its corridors and cables.
      expect(networkOf(s.buildings, s.corridors, n).count, s.id).toBe(1);
      expect(networkOf(s.buildings, s.cables, n).count, s.id).toBe(1);
    }
  });

  it("spread beyond the quarters in districts of 2, 3 and 4 chunks a side and big claims, with wild land between them", () => {
    // Districts: claimed chunks with anything built on them - a fiftieth of their ground or more (a wind farm's
    // turbines stand apart, and cover 5-15% of its chunks) - grouped where they touch. The land between has nothing.
    for (const s of metropolises) {
      const chunks = outerChunks(s);
      const at = new Map(chunks.map((c) => [`${c.u},${c.v}`, c]));
      const seen = new Set<string>();
      const sizes: number[] = [];
      for (const c of chunks) {
        const key = `${c.u},${c.v}`;
        if (!c.claimed || c.built < 0.02 || seen.has(key)) continue;
        let size = 0;
        const stack = [c];
        seen.add(key);
        while (stack.length > 0) {
          const d = stack.pop()!;
          size += 1;
          for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const e = at.get(`${d.u + du},${d.v + dv}`);
            const k = `${d.u + du},${d.v + dv}`;
            if (e === undefined || !e.claimed || e.built < 0.02 || seen.has(k)) continue;
            seen.add(k);
            stack.push(e);
          }
        }
        sizes.push(size);
      }
      // Measured: 26 to 29 districts - 8 to 11 of 2 x 2, 6 or 7 of 3 x 3, 6 or 7 of 4 x 4, and one or two of 6 x 6
      // (a district with a chunk of steep ground, left unbuilt, counts a chunk short).
      for (const want of [4, 9, 16]) expect(sizes.filter((z) => z === want).length, `${s.id}: districts of ${want} chunks`).toBeGreaterThanOrEqual(4);
      expect(sizes.filter((z) => z >= 36).length, `${s.id}: big claims`).toBeGreaterThanOrEqual(1);
      // Measured: 272 of the 840 chunks outside the quarters left wild.
      expect(chunks.filter((c) => !c.claimed).length, `${s.id}: wild chunks`).toBeGreaterThan(200);
    }
  });

  it("lay many corridors in the spaces between the districts", () => {
    // The claimed land between the districts (built on under a fiftieth) carries corridor on 15% of its
    // ground, measured; the districts themselves 2.2%.
    for (const s of metropolises) {
      const chunks = outerChunks(s).filter((c) => c.claimed);
      const spaces = chunks.filter((c) => c.built < 0.02);
      const districts = chunks.filter((c) => c.built >= 0.02);
      expect(spaces.length, `${s.id}: vacuity, spaces`).toBeGreaterThan(100);
      const mean = (list: typeof chunks): number => list.reduce((a, c) => a + c.corridor, 0) / list.length;
      expect(mean(spaces), s.id).toBeGreaterThan(4 * mean(districts));
    }
  });

  it("are clear of every stone", () => {
    for (const s of metropolises) expect(rocksOf(s, game).filter((r) => r !== "none").length, s.id).toBe(0);
    // Vacuity: the planet's other settlements still have their rocks.
    expect(state.settlements.filter((s) => s.kind === "city").some((s) => rocksOf(s, game).some((r) => r !== "none"))).toBe(true);
  });

  it("run giant railways: every station on one line, to all four edges of the city, bridged over the corridors", () => {
    // Measured: 15-16 stations; 1,553 to 2,288 rail tiles within a chunk of each edge; 1,734 to 1,766 bridges.
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const stations = s.buildings.map((b, i) => (b.type === "station" ? i : -1)).filter((i) => i >= 0);
      expect(stations.length, s.id).toBeGreaterThanOrEqual(8);
      const net = withRails(networkOf(s.buildings, [], n), s.buildings, s.rails, n);
      expect(new Set(stations.map((i) => net.of[i])).size, s.id).toBe(1);
      const near = (test: (x: number, y: number) => boolean): number => s.rails.filter((k) => test(k & 1023, k >> 10)).length;
      for (const [edge, test] of [
        ["west", (x: number) => x < C],
        ["east", (x: number) => x >= n - C],
        ["north", (_: number, y: number) => y < C],
        ["south", (_: number, y: number) => y >= n - C],
      ] as const) expect(near(test), `${s.id} ${edge}`).toBeGreaterThan(500);
      const corridors = new Set(s.corridors);
      expect(s.rails.filter((k) => corridors.has(k)).length, `${s.id}: bridges`).toBeGreaterThan(500);
    }
  });

  it("give over one district to solar panels, and one to wind turbines", () => {
    // Measured: 1,398 to 1,507 solar arrays in the solar farm (and three battery banks); 908 to 943 turbines.
    for (const s of metropolises) {
      const count = (zone: string, type: string): number => {
        const z = s.zones.find((x) => x.name === zone);
        expect(z, `${s.id}: ${zone}`).toBeDefined();
        const tiles = new Set(z!.tiles);
        return s.buildings.filter((b) => tiles.has(b.ty * 1024 + b.tx) && b.type === type).length;
      };
      expect(count("Solar farm", "solar_array"), s.id).toBeGreaterThan(1000);
      expect(count("Wind farm", "wind_turbine"), s.id).toBeGreaterThan(500);
    }
  });

  it("are planned in zones of many colours: every quarter, district and the avenues", () => {
    // Measured: 94 zones in 13 colours; every building but those on the avenues in one.
    for (const s of metropolises) {
      expect(s.zones.length, s.id).toBeGreaterThan(80);
      expect(new Set(s.zones.map((z) => z.colour)).size, s.id).toBeGreaterThanOrEqual(10);
      const zoned = new Set(s.zones.flatMap((z) => z.tiles));
      expect(s.buildings.filter((b) => zoned.has(b.ty * 1024 + b.tx)).length / s.buildings.length, s.id).toBeGreaterThan(0.95);
    }
  });

  it("are alive: rovers out, rockets away", () => {
    for (const s of metropolises) {
      expect(s.jobs.filter((j) => j.kind === "rover").length, s.id).toBeGreaterThanOrEqual(5);
      expect(s.jobs.filter((j) => j.kind === "rocket").length, s.id).toBeGreaterThanOrEqual(3);
    }
  });
});
