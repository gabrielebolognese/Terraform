/**
 * The example planet's metropolises (at the user's request): "3x bigger; a
 * little more order, in quarters; after the zones, suburbs - 8 domes, or
 * smaller clusters; the city full besides some parts, very very wide, with
 * ALL structures, including a railway station, rovers going back and forth,
 * an alive city; connected with many corridors; the zones very busy".
 */

import { describe, expect, it } from "vitest";

import type { Settlement } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, DEFAULT_TUNING, frameOf, makeTuning, networkOf, withRails } from "../sim/index.js";
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

/** Row-major: which tiles are under a building. */
function under(s: Settlement, n: number): Uint8Array {
  const g = new Uint8Array(n * n);
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    for (let y = b.ty; y < b.ty + def.depth; y += 1) for (let x = b.tx; x < b.tx + def.footprint; x += 1) g[y * n + x] = 1;
  }
  return g;
}

/** Share of the frame's tiles under a building, in four rings from the middle out. */
function cover(s: Settlement, n: number): number[] {
  const u = under(s, n);
  const ring = [0, 0, 0, 0];
  const area = [0, 0, 0, 0];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const k = Math.min(3, Math.floor((Math.max(Math.abs(x + 0.5 - n / 2), Math.abs(y + 0.5 - n / 2)) / (n / 2)) * 4));
      area[k]! += 1;
      ring[k]! += u[y * n + x]!;
    }
  }
  return ring.map((c, k) => c / area[k]!);
}

describe("the example's metropolises", () => {
  it("are three, each with thousands of buildings on land claimed wide round the founding square", () => {
    // Measured: 3,685 to 3,734 buildings (were 648 to 1,068); 352 tiles a side on a 288-tile founding square.
    expect(metropolises).toHaveLength(3);
    for (const s of metropolises) {
      expect(s.buildings.length, s.id).toBeGreaterThan(3 * 1068);
      expect(frameOf(s, game).n, s.id).toBeGreaterThanOrEqual(s.base + 64);
    }
  });

  it("have every structure a metropolis may build", () => {
    for (const s of metropolises) {
      const types = new Set(s.buildings.map((b) => b.type));
      expect(BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].kinds.includes("metropolis") && !types.has(t)), s.id).toEqual([]);
    }
  });

  it("stand in quarters: straight streets the whole way across, with no building on them", () => {
    // Groups of whole rows (and columns) inside the city's bounds with nothing built on them: the boulevards.
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const u = under(s, n);
      const lines = (across: boolean): number => {
        let groups = 0;
        let inGroup = false;
        for (let a = n / 8; a < (7 * n) / 8; a += 1) {
          let empty = true;
          for (let b = n / 8; b < (7 * n) / 8 && empty; b += 1) if (u[across ? a * n + b : b * n + a]) empty = false;
          if (empty && !inGroup) groups += 1;
          inGroup = empty;
        }
        return groups;
      };
      expect(lines(true), `${s.id} rows`).toBeGreaterThanOrEqual(5);
      expect(lines(false), `${s.id} columns`).toBeGreaterThanOrEqual(5);
    }
  });

  it("are busy within, and give way to suburbs - clusters of domes with open ground between - at the edge", () => {
    // Measured: 21-23% of every inner ring's tiles under a building (streets
    // two deep round each take most of the rest); 10% of the outer ring.
    for (const s of metropolises) {
      const c = cover(s, frameOf(s, game).n);
      for (const inner of c.slice(0, 3)) expect(inner, s.id).toBeGreaterThan(0.18);
      expect(c[3]!, s.id).toBeGreaterThan(0.04);
      expect(c[3]!, s.id).toBeLessThan(c[1]! * 0.6);
    }
  });

  it("run railways: every station on one line", () => {
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const stations = s.buildings.map((b, i) => (b.type === "station" ? i : -1)).filter((i) => i >= 0);
      expect(stations.length, s.id).toBeGreaterThanOrEqual(4);
      const net = withRails(networkOf(s.buildings, [], n), s.buildings, s.rails, n);
      expect(new Set(stations.map((i) => net.of[i])).size, s.id).toBe(1);
    }
  });

  it("are alive: rovers out, rockets away", () => {
    for (const s of metropolises) {
      expect(s.jobs.filter((j) => j.kind === "rover").length, s.id).toBeGreaterThanOrEqual(5);
      expect(s.jobs.filter((j) => j.kind === "rocket").length, s.id).toBeGreaterThanOrEqual(3);
    }
  });

  it("are laid out like a motherboard: blocks wall to wall, a trace down each boulevard and to each block - not a street everywhere", () => {
    // The user: "far, far too many corridors ... think of it like a huge
    // motherboard, there aren't roads everywhere". Measured: 0.19 tiles of
    // corridor for each tile under a building (the layout before, a street two
    // deep round every building: 2.97); every building wall to wall with
    // another (before: none).
    for (const s of metropolises) {
      const n = frameOf(s, game).n;
      const u = under(s, n);
      let covered = 0;
      for (const v of u) covered += v;
      expect(s.corridors.length / covered, s.id).toBeLessThan(0.4);
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
      expect(touching / s.buildings.length, s.id).toBeGreaterThan(0.9);
      // And still one network of each: every building on the city's corridors and cables.
      expect(networkOf(s.buildings, s.corridors, n).count, s.id).toBe(1);
      expect(networkOf(s.buildings, s.cables, n).count, s.id).toBe(1);
    }
  });
});
