/**
 * Roads and the settlement network (micro §6, made real at the user's
 * request: "I need to connect the power plant to the mines to activate them,
 * or connect the greenhouses to the habitable zones").
 *
 * Micro §6 foresaw it: "a simple 'connected to the settlement network'
 * boolean per building is enough for the foundation. Pipe/cable routing can
 * be added later without touching the sim." §7.1: "A building is operable
 * this tick only if it is connected to the network (section 6)".
 *
 * The rule (behind `NETWORK_ENABLED`):
 *   - Buildings join one network by touching, edge to edge, or by touching a
 *     road; roads join by touching each other. A road is a tile.
 *   - A building that draws a resource runs only if its network holds a
 *     running producer of it: a mine needs a power plant on its network, a
 *     dome a greenhouse.
 *
 * The stores stay one pool per settlement, as §6 has them, so what a
 * producer makes reaches the pool wherever it stands, and two networks share
 * a surplus through it; each must still hold its own producer of everything
 * it draws. A first version also idled any power, water or oxygen producer
 * with nothing on its network drawing its output - and every outpost's water
 * extractors went dark, with no one to drink and tanks to fill. Stores per
 * network are the real answer; recorded as an open item.
 *
 * Roads are the only new stored state. Which buildings share a network is
 * derived every substep and never stored (micro §10).
 */

import type { Tuning } from "../tuning.js";
import type { MicroResource, PlacedBuilding, Settlement } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { gridTiles } from "./space.js";
import { groundOf, isSteep } from "./terrain.js";

/**
 * A road's key: `ty * ROAD_STRIDE + tx`. Fixed, not the grid's edge, so a key
 * means the same tile whatever the grid's size is tuned to.
 */
export const ROAD_STRIDE = 1024;

export function roadKey(tx: number, ty: number): number {
  return ty * ROAD_STRIDE + tx;
}

export function roadTile(key: number): { tx: number; ty: number } {
  return { tx: key % ROAD_STRIDE, ty: Math.floor(key / ROAD_STRIDE) };
}

/** Row-major over an `n`-tile grid: which building stands on each tile, or -1. */
export function ownerGrid(buildings: readonly PlacedBuilding[], n: number): Int32Array {
  const owner = new Int32Array(n * n).fill(-1);
  buildings.forEach((b, i) => {
    const size = BUILDING_DEFS[b.type].footprint;
    for (let y = b.ty; y < b.ty + size; y += 1) {
      for (let x = b.tx; x < b.tx + size; x += 1) if (x >= 0 && y >= 0 && x < n && y < n) owner[y * n + x] = i;
    }
  });
  return owner;
}

/** Row-major over an `n`-tile grid: 1 where a road is. Roads off the grid are ignored. */
export function roadGrid(roads: readonly number[], n: number): Uint8Array {
  const grid = new Uint8Array(n * n);
  for (const key of roads) {
    const { tx, ty } = roadTile(key);
    if (tx < n && ty < n) grid[ty * n + tx] = 1;
  }
  return grid;
}

function find(parent: Int32Array, i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r]!;
  // Path compression.
  let j = i;
  while (parent[j] !== r) {
    const next = parent[j]!;
    parent[j] = r;
    j = next;
  }
  return r;
}

function union(parent: Int32Array, a: number, b: number): void {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
}

export interface Network {
  /** Per building: the id of its network (the same number means connected). */
  readonly of: readonly number[];
  /** How many networks there are (a building on its own is a network of one). */
  readonly count: number;
}

const cache = new WeakMap<readonly PlacedBuilding[], WeakMap<readonly number[], Map<number, Network>>>();

/**
 * Which buildings share a network. Pure; kept per (buildings, roads, grid) -
 * both lists are immutable, so the same lists always give the same answer,
 * and every substep of a settlement that has not changed reuses it.
 */
export function networkOf(buildings: readonly PlacedBuilding[], roads: readonly number[], n: number): Network {
  let byRoads = cache.get(buildings);
  if (byRoads === undefined) {
    byRoads = new WeakMap();
    cache.set(buildings, byRoads);
  }
  let byGrid = byRoads.get(roads);
  if (byGrid === undefined) {
    byGrid = new Map();
    byRoads.set(roads, byGrid);
  }
  const kept = byGrid.get(n);
  if (kept !== undefined) return kept;

  const owner = ownerGrid(buildings, n);
  const road = roadGrid(roads, n);
  // Nodes: buildings first, then every tile (only road tiles take part).
  const B = buildings.length;
  const parent = new Int32Array(B + n * n);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  const node = (tile: number): number => {
    const o = owner[tile]!;
    return o >= 0 ? o : road[tile] ? B + tile : -1;
  };
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const here = node(y * n + x);
      if (here < 0) continue;
      // Each edge once: east and south.
      if (x + 1 < n) {
        const east = node(y * n + x + 1);
        if (east >= 0) union(parent, here, east);
      }
      if (y + 1 < n) {
        const south = node((y + 1) * n + x);
        if (south >= 0) union(parent, here, south);
      }
    }
  }
  const ids = new Map<number, number>();
  const of = buildings.map((_, i) => {
    const r = find(parent, i);
    let id = ids.get(r);
    if (id === undefined) {
      id = ids.size;
      ids.set(r, id);
    }
    return id;
  });
  const network: Network = { of, count: ids.size };
  byGrid.set(n, network);
  return network;
}

/** Why the network kept a building from running: it draws these, and no running building on its network makes them. */
export interface NetworkIssue {
  readonly kind: "unsupplied";
  readonly resources: readonly MicroResource[];
}

/**
 * One pass of the network rule over `operable`, switching OFF what the rule
 * forbids. Only ever switches off, like §7.2's brownout, so the caller's
 * fixed point stays one found from above. Returns whether anything changed.
 */
export function applyNetwork(
  network: Network,
  consumes: readonly Partial<Record<MicroResource, number>>[],
  produces: readonly Partial<Record<MicroResource, number>>[],
  operable: boolean[],
  issues: (NetworkIssue | null)[],
): boolean {
  const makes = new Map<number, Set<MicroResource>>();
  operable.forEach((on, i) => {
    if (!on) return;
    const id = network.of[i]!;
    let set = makes.get(id);
    if (set === undefined) {
      set = new Set();
      makes.set(id, set);
    }
    for (const [r, v] of Object.entries(produces[i]!) as [MicroResource, number][]) if (v > 0) set.add(r);
  });
  let changed = false;
  operable.forEach((on, i) => {
    if (!on) return;
    const id = network.of[i]!;
    const missing = (Object.entries(consumes[i]!) as [MicroResource, number][]).filter(([r, v]) => v > 0 && makes.get(id)?.has(r) !== true).map(([r]) => r);
    if (missing.length === 0) return;
    operable[i] = false;
    issues[i] = { kind: "unsupplied", resources: missing };
    changed = true;
  });
  return changed;
}

/**
 * Roads that join every building into one network, where the ground allows:
 * each separate network is reached from the first building's by the shortest
 * path over open, buildable ground, and a road is laid along it. Returns the
 * roads to ADD (the settlement's own are kept). Deterministic: ties go to the
 * tile found first in a fixed order.
 *
 * Used to carry saves from before roads existed into a game that needs them,
 * for the example planet, and by the player's "connect everything".
 */
export function roadsToConnect(s: Settlement, t: Tuning): number[] {
  const n = gridTiles(s.kind, t);
  if (s.buildings.length < 2) return [];
  const ground = groundOf(s, t);
  const owner = ownerGrid(s.buildings, n);
  const laid = new Set(s.roads);
  const added: number[] = [];
  const passable = (x: number, y: number): boolean => owner[y * n + x]! < 0 && !isSteep(ground, x, y);
  // A road already there counts as crossable even on a slope: it was laid.
  const STEPS = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  // Each round joins one more network to the first building's; at most one round per building.
  for (let round = 0; round < s.buildings.length; round += 1) {
    const roads = [...laid];
    const net = networkOf(s.buildings, roads, n);
    if (net.count <= 1) break;
    const home = net.of[0]!;
    const road = roadGrid(roads, n);
    // A tile's network: its building's, or (for a road) any building's it reaches - found by flooding from home.
    const inHome = new Uint8Array(n * n);
    const from = new Int32Array(n * n).fill(-2);
    const queue: number[] = [];
    // Home's tiles: its buildings' footprints and every road joined to them.
    const seed = new Uint8Array(n * n);
    for (let tile = 0; tile < n * n; tile += 1) {
      const o = owner[tile]!;
      if (o >= 0 && net.of[o] === home) seed[tile] = 1;
    }
    // Roads joined to home: flood along roads from home's footprints.
    const walk: number[] = [];
    for (let tile = 0; tile < n * n; tile += 1) if (seed[tile]) walk.push(tile);
    while (walk.length > 0) {
      const tile = walk.pop()!;
      if (inHome[tile]) continue;
      inHome[tile] = 1;
      const x = tile % n;
      const y = (tile - x) / n;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const nt = ny * n + nx;
        if (!inHome[nt] && (road[nt] || seed[nt])) walk.push(nt);
      }
    }
    for (let tile = 0; tile < n * n; tile += 1) {
      if (inHome[tile]) {
        from[tile] = -1;
        queue.push(tile);
      }
    }
    // Breadth first over open ground and existing roads, until a tile touches
    // another network's building. (A stray road that joins nothing is only
    // ground to cross, never a goal.)
    let target = -1;
    for (let head = 0; head < queue.length && target < 0; head += 1) {
      const tile = queue[head]!;
      const x = tile % n;
      const y = (tile - x) / n;
      for (const [dx, dy] of STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const nt = ny * n + nx;
        const o = owner[nt]!;
        if (o >= 0) {
          if (net.of[o] !== home) {
            target = tile;
            break;
          }
          continue;
        }
        if (from[nt] !== -2) continue;
        if (!road[nt] && !passable(nx, ny)) continue;
        from[nt] = tile;
        queue.push(nt);
      }
    }
    if (target < 0) break; // What is left cannot be reached over buildable ground.
    // Lay the path back to home's tiles.
    for (let tile = target; tile >= 0 && from[tile] !== -1; tile = from[tile]!) {
      const x = tile % n;
      const key = roadKey(x, (tile - x) / n);
      if (!laid.has(key)) {
        laid.add(key);
        added.push(key);
      }
    }
  }
  return added.sort((a, b) => a - b);
}
