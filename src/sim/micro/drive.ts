/**
 * Batch 29: rovers that use the city ("the trains, the rovers: they skin
 * through buildings"). A rover leaves the headquarters by its garage door
 * and drives to the job over corridors first, then open ground the city
 * holds - never under a building, never over hard rock, never up ground too
 * steep to build on - turning where the way turns, and works from the tile
 * beside its job.
 *
 * The route is found once, when the rover sets out, and kept with the job
 * (`SettlementJob.route`): its length sets the drive's time, so a trip takes
 * as long as the way it actually drives. Deterministic: an A* search over
 * the tiles with every tie broken by a fixed order.
 *
 * Behind ROVER_ROUTES_ENABLED (0 by default and in every world made before
 * this batch: their drive stays the straight line of Batches 21-28). The
 * view draws even those rovers along a route (`displayRoute`), so no rover
 * in any world is drawn through a building; only the time is the old one.
 */

import type { Tuning } from "../tuning.js";
import type { PlacedBuilding, Settlement, SettlementJob } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { garage, rocksOf, siteGround } from "./rocks.js";
import type { Rock } from "./rocks.js";
import { claimTest, keyTile, tileKey } from "./space.js";

/** What a rover works on: a rock's (or a levelled) tile, or a building's footprint. */
export interface Site {
  readonly tx: number;
  readonly ty: number;
  readonly w: number;
  readonly h: number;
}

/** A route: where it turns, as tile keys from the garage door to the tile the rover works from; and its drive one way, sim-years. */
export interface RoverRoute {
  readonly points: readonly number[];
  readonly years: number;
}

/** Why a job no route reaches is refused. */
export const NO_ROUTE = "no rover can get there from the garage - buildings, hard rock or ground too steep are in the way";

/** Why a building may not stand in front of the garage. */
export const DOOR_KEPT_CLEAR = "the ground in front of the headquarters' garage door is kept clear for its rovers";

/** Why a building may not go up where a rover is driving. */
export const ROVER_PASSING = "a rover is driving through there - wait for it to pass";

/** Where every route starts: the tile in front of the garage's middle bay (the front of the headquarters). */
export function garageDoor(s: Settlement): { tx: number; ty: number } | null {
  const hq = s.buildings.find((b) => b.type === "headquarters");
  if (hq === undefined) return null;
  const def = BUILDING_DEFS.headquarters;
  return { tx: hq.tx + Math.floor(def.footprint / 2), ty: hq.ty + def.depth };
}

/** The tiles a building may not cover while routes are on: the garage door and the tile in front of it. */
export function garageApron(s: Settlement): readonly { tx: number; ty: number }[] {
  const door = garageDoor(s);
  return door === null ? [] : [door, { tx: door.tx, ty: door.ty + 1 }];
}

/** Tiles from the garage, in the headquarters' middle, to the middle of the door tile: the drive inside the headquarters. */
export function garageLeg(s: Settlement): number {
  const from = garage(s);
  const door = garageDoor(s);
  if (from === null || door === null) return 0;
  return Math.hypot(door.tx + 0.5 - from.x, door.ty + 0.5 - from.y);
}

// ---------------------------------------------------------------------------
// The ground a rover may drive on
// ---------------------------------------------------------------------------

/** Cell values: no way through; open ground; a corridor. */
const BLOCKED = 0;
const OPEN = 1;
const CORRIDOR = 2;

interface DriveGrid {
  readonly n: number;
  readonly cell: Uint8Array;
  readonly corridors: boolean;
  /** Tiles reachable from the door (1), found the first time it is asked; null before. */
  reach: Uint8Array | null;
  readonly door: number;
  /** Routes already found on this ground, by site. */
  readonly found: Map<string, RoverRoute | null>;
  /** Row-major: the index of the building standing on each tile, or -1 - made when walling in is first asked about (4 bytes a tile: 3.4 MB a metropolis, kept). */
  owner: Int32Array | null;
  /** How many buildings a building on each site asked about would wall in. */
  readonly walls: Map<string, number>;
}

const grids = new WeakMap<readonly PlacedBuilding[], { t: Tuning; ground: object; rocks: readonly Rock[]; corridors: readonly number[]; claims: readonly number[]; grid: DriveGrid }>();

/**
 * Every tile, as a rover sees it: blocked, open ground or a corridor. Kept
 * per building list and the rest it is made from, so a settlement asked
 * again and again while nothing changes pays once.
 */
function gridOf(s: Settlement, t: Tuning): DriveGrid | null {
  const door = garageDoor(s);
  if (door === null) return null;
  const ground = siteGround(s, t);
  const rocks = rocksOf(s, t);
  const kept = grids.get(s.buildings);
  if (kept !== undefined && kept.t === t && kept.ground === ground && kept.rocks === rocks && kept.corridors === s.corridors && kept.claims === s.claims) return kept.grid;
  const n = ground.tiles;
  const cell = new Uint8Array(n * n);
  const ours = claimTest(s, t);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      cell[i] = ours(x, y) && ground.steep[i] !== true && rocks[i] !== "crag" ? OPEN : BLOCKED;
    }
  }
  let corridors = false;
  for (const key of s.corridors) {
    const { tx, ty } = keyTile(key);
    if (tx < n && ty < n && cell[ty * n + tx] === OPEN) {
      cell[ty * n + tx] = CORRIDOR;
      corridors = true;
    }
  }
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    for (let y = Math.max(0, b.ty); y < Math.min(n, b.ty + def.depth); y += 1) for (let x = Math.max(0, b.tx); x < Math.min(n, b.tx + def.footprint); x += 1) cell[y * n + x] = BLOCKED;
  }
  const grid: DriveGrid = { n, cell, corridors, reach: null, door: door.tx >= 0 && door.ty >= 0 && door.tx < n && door.ty < n ? door.ty * n + door.tx : -1, found: new Map(), owner: null, walls: new Map() };
  grids.set(s.buildings, { t, ground, rocks, corridors: s.corridors, claims: s.claims, grid });
  return grid;
}

/** The eight ways out of a tile: the four sides, then the four corners. */
const DX = [1, -1, 0, 0, 1, -1, 1, -1] as const;
const DY = [0, 0, 1, -1, 1, 1, -1, -1] as const;

/**
 * Whether a step from tile (x, y) the `d`th way is open: on the grid, onto
 * open ground, and - across a corner - past two open tiles, so nothing is
 * clipped. `walled`, a site counted as built on as well.
 */
function canStep(g: DriveGrid, x: number, y: number, d: number, walled: Site | null = null): boolean {
  const nx = x + DX[d]!;
  const ny = y + DY[d]!;
  const n = g.n;
  // No closures here: it is called for every step of every search.
  if (nx < 0 || ny < 0 || nx >= n || ny >= n || g.cell[ny * n + nx] === BLOCKED || (walled !== null && inSite(walled, nx, ny))) return false;
  if (d < 4) return true;
  if (g.cell[y * n + nx] === BLOCKED || g.cell[ny * n + x] === BLOCKED) return false;
  return walled === null || (!inSite(walled, nx, y) && !inSite(walled, x, ny));
}

function inSite(site: Site, x: number, y: number): boolean {
  return x >= site.tx && y >= site.ty && x < site.tx + site.w && y < site.ty + site.h;
}

let floodStack = new Int32Array(0);

/** The tiles a rover can get to from the door, every way it can step. */
function reachOf(g: DriveGrid): Uint8Array {
  if (g.reach !== null) return g.reach;
  const reach = new Uint8Array(g.n * g.n);
  g.reach = reach;
  if (g.door < 0 || g.cell[g.door] === BLOCKED) return reach;
  // A typed stack, kept between floods: each tile goes on it once, so it needs no more room than the tiles.
  if (floodStack.length < g.n * g.n) floodStack = new Int32Array(g.n * g.n);
  const stack = floodStack;
  let top = 0;
  stack[top++] = g.door;
  reach[g.door] = 1;
  while (top > 0) {
    const i = stack[--top]!;
    const x = i % g.n;
    const y = (i - x) / g.n;
    for (let d = 0; d < 8; d += 1) {
      if (!canStep(g, x, y, d)) continue;
      const j = (y + DY[d]!) * g.n + x + DX[d]!;
      if (reach[j]) continue;
      reach[j] = 1;
      stack[top++] = j;
    }
  }
  return reach;
}

/** Whether tile (x, y) is one a rover can work on `site` from: beside it, across one of its sides. */
function besideSite(site: Site, x: number, y: number): boolean {
  const alongX = x >= site.tx && x < site.tx + site.w;
  const alongY = y >= site.ty && y < site.ty + site.h;
  return (alongX && (y === site.ty - 1 || y === site.ty + site.h)) || (alongY && (x === site.tx - 1 || x === site.tx + site.w));
}

/** Search scratch, kept between searches: a metropolis is close to a million tiles. */
let scratch: { size: number; g: Float64Array; from: Int32Array; seen: Int32Array; stamp: number } | null = null;

/** A min-heap of tiles by (f, h, tile): every tie broken the same way, so the route is deterministic. */
class Heap {
  // Parallel typed arrays, grown by doubling, sifted with a hole: the first version swapped through destructured
  // arrays, and its swaps were most of a metropolis's route search (0.8 s for twelve routes, measured).
  private tiles = new Int32Array(1024);
  private f = new Float64Array(1024);
  private h = new Float64Array(1024);
  private n = 0;
  get size(): number {
    return this.n;
  }
  /** Empty, keeping its room: one heap serves every search (a new one each, grown by doubling, left megabytes behind a metropolis's search - and the collector stopped the next city's opening for half a second to clear them, measured). */
  clear(): this {
    this.n = 0;
    return this;
  }
  /** Whether (fa, ha, ta) comes before (fb, hb, tb). */
  private static before(fa: number, ha: number, ta: number, fb: number, hb: number, tb: number): boolean {
    return fa !== fb ? fa < fb : ha !== hb ? ha < hb : ta < tb;
  }
  push(tile: number, f: number, h: number): void {
    if (this.n === this.tiles.length) {
      const grow = <A extends Int32Array | Float64Array>(a: A, make: (n: number) => A): A => {
        const b = make(a.length * 2);
        b.set(a);
        return b;
      };
      this.tiles = grow(this.tiles, (k) => new Int32Array(k));
      this.f = grow(this.f, (k) => new Float64Array(k));
      this.h = grow(this.h, (k) => new Float64Array(k));
    }
    let k = this.n;
    this.n += 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!Heap.before(f, h, tile, this.f[p]!, this.h[p]!, this.tiles[p]!)) break;
      this.tiles[k] = this.tiles[p]!;
      this.f[k] = this.f[p]!;
      this.h[k] = this.h[p]!;
      k = p;
    }
    this.tiles[k] = tile;
    this.f[k] = f;
    this.h[k] = h;
  }
  pop(): number {
    const top = this.tiles[0]!;
    this.n -= 1;
    const n = this.n;
    if (n === 0) return top;
    const tile = this.tiles[n]!;
    const f = this.f[n]!;
    const h = this.h[n]!;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= n) break;
      const r = l + 1;
      const m = r < n && Heap.before(this.f[r]!, this.h[r]!, this.tiles[r]!, this.f[l]!, this.h[l]!, this.tiles[l]!) ? r : l;
      if (!Heap.before(this.f[m]!, this.h[m]!, this.tiles[m]!, f, h, tile)) break;
      this.tiles[k] = this.tiles[m]!;
      this.f[k] = this.f[m]!;
      this.h[k] = this.h[m]!;
      k = m;
    }
    this.tiles[k] = tile;
    this.f[k] = f;
    this.h[k] = h;
    return top;
  }
}

/** The heaps the searches use, kept: the route search's, and walling in's. */
const searchHeap = new Heap();
const doorHeap = new Heap();

/** The cost of a tile's ground, in open-ground tiles per tile: a corridor is ROVER_CORRIDOR_SPEEDUP times quicker. */
function costOf(cell: number, t: Tuning): number {
  return cell === CORRIDOR ? 1 / t.ROVER_CORRIDOR_SPEEDUP : 1;
}

/** A step between two tiles `len` apart: half on each tile's ground. */
function stepCost(a: number, b: number, len: number, t: Tuning): number {
  return (len * (costOf(a, t) + costOf(b, t))) / 2;
}

/**
 * The route from the garage door to the tile beside `site` that is quickest
 * to drive to, or null when none reaches it. Found on the ground as it is
 * now; kept per ground and site.
 */
export function roverRoute(s: Settlement, site: Site, t: Tuning): RoverRoute | null {
  const g = gridOf(s, t);
  if (g === null || g.door < 0 || g.cell[g.door] === BLOCKED) return null;
  const key = `${site.tx},${site.ty},${site.w},${site.h}`;
  const hit = g.found.get(key);
  if (hit !== undefined) return hit;
  const made = search(g, s, site, t);
  g.found.set(key, made);
  return made;
}

/** Whether some tile beside `site` is one a rover can get to from the door: a route exists, found or not. */
function reachableOn(g: DriveGrid, site: Site): boolean {
  const n = g.n;
  const reach = reachOf(g);
  for (let y = site.ty - 1; y <= site.ty + site.h; y += 1) {
    for (let x = site.tx - 1; x <= site.tx + site.w; x += 1) {
      if (x >= 0 && y >= 0 && x < n && y < n && besideSite(site, x, y) && reach[y * n + x] === 1) return true;
    }
  }
  return false;
}

/** Whether a rover could get to `site` - without searching out the route (`roverRoute` would find one exactly then). */
export function reachable(s: Settlement, site: Site, t: Tuning): boolean {
  const g = gridOf(s, t);
  return g !== null && g.door >= 0 && g.cell[g.door] !== BLOCKED && reachableOn(g, site);
}

function search(g: DriveGrid, s: Settlement, site: Site, t: Tuning): RoverRoute | null {
  const n = g.n;
  // Nothing reachable beside the site: refused without a search over the whole city.
  if (!reachableOn(g, site)) return null;
  if (scratch === null || scratch.size < n * n || scratch.stamp > 2e9) scratch = { size: n * n, g: new Float64Array(n * n), from: new Int32Array(n * n), seen: new Int32Array(n * n), stamp: 0 };
  const sc = scratch;
  sc.stamp += 1;
  const stamp = sc.stamp;
  // The straight line over the quickest ground: never more than the drive, so the first route found is the quickest.
  const floor = g.corridors ? 1 / t.ROVER_CORRIDOR_SPEEDUP : 1;
  const x0 = site.tx - 1;
  const y0 = site.ty - 1;
  const x1 = site.tx + site.w;
  const y1 = site.ty + site.h;
  const heuristic = (i: number): number => {
    const x = i % n;
    const y = (i - x) / n;
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    return floor * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
  };
  const heap = searchHeap.clear();
  sc.seen[g.door] = stamp;
  sc.g[g.door] = 0;
  sc.from[g.door] = -1;
  heap.push(g.door, heuristic(g.door), heuristic(g.door));
  // Closed tiles carry the stamp negated.
  while (heap.size > 0) {
    const i = heap.pop();
    if (sc.seen[i] === -stamp) continue;
    sc.seen[i] = -stamp;
    const x = i % n;
    const y = (i - x) / n;
    if (besideSite(site, x, y)) return routeFrom(g, s, i, sc.from, sc.g[i]!, t);
    const gi = sc.g[i]!;
    for (let d = 0; d < 8; d += 1) {
      if (!canStep(g, x, y, d)) continue;
      const j = (y + DY[d]!) * n + x + DX[d]!;
      if (sc.seen[j] === -stamp) continue;
      const cost = gi + stepCost(g.cell[i]!, g.cell[j]!, d < 4 ? 1 : Math.SQRT2, t);
      if (sc.seen[j] === stamp && cost >= sc.g[j]!) continue;
      sc.seen[j] = stamp;
      sc.g[j] = cost;
      sc.from[j] = i;
      const h = heuristic(j);
      heap.push(j, cost + h, h);
    }
  }
  return null;
}

/** The route back from `end`, kept where it turns, and its drive one way. */
function routeFrom(g: DriveGrid, s: Settlement, end: number, from: Int32Array, cost: number, t: Tuning): RoverRoute {
  const tiles: number[] = [];
  for (let i = end; i >= 0; i = from[i]!) tiles.push(i);
  tiles.reverse();
  const n = g.n;
  const points: number[] = [];
  tiles.forEach((i, k) => {
    const prev = tiles[k - 1];
    const next = tiles[k + 1];
    // The ends, and every tile where the way turns.
    if (prev !== undefined && next !== undefined && i - prev === next - i) return;
    points.push(tileKey(i % n, Math.floor(i / n)));
  });
  return { points, years: (garageLeg(s) + cost) * t.ROVER_YEARS_PER_TILE };
}

// ---------------------------------------------------------------------------
// Walling in (Batch 29, routes on)
// ---------------------------------------------------------------------------

/** Scratch for walling-in searches: a stamp per tile. */
let wallScratch: { size: number; seen: Int32Array; stamp: number } | null = null;

/** How far a first, local look spreads before the full answer is worked out, tiles. */
const LOCAL_LOOK = 4096;

/**
 * How many buildings a rover can get to now that a building on `site` would
 * leave it none (Batch 29): placing one that walls others in is refused, so
 * every building a player puts up stays one a rover can reach - to build it,
 * and to raise it a level. (Without this, the scripted player boxed in its own
 * garage door after 13 buildings, and was refused everything after: measured.)
 *
 * The building can only split the ground a rover reaches, never join it. It
 * splits nothing if the tiles round it still all reach each other without
 * crossing it - a look that stays near it, almost always. Only when they do
 * not is each piece worked out, and the buildings beside the pieces cut off
 * from the door checked for another way in.
 */
export function wallsIn(s: Settlement, site: Site, t: Tuning): number {
  const g = gridOf(s, t);
  if (g === null || g.door < 0) return 0;
  // Kept per ground and site: the preview under the pointer asks every frame.
  const key = `${site.tx},${site.ty},${site.w},${site.h}`;
  const kept = g.walls.get(key);
  if (kept !== undefined) return kept;
  const made = wallsInOn(g, s, site);
  g.walls.set(key, made);
  return made;
}

/** Which building stands on each tile (`DriveGrid.owner`), made the first time it is asked. */
function ownerOf(g: DriveGrid, s: Settlement): Int32Array {
  if (g.owner !== null) return g.owner;
  const n = g.n;
  const owner = new Int32Array(n * n).fill(-1);
  s.buildings.forEach((b, k) => {
    const def = BUILDING_DEFS[b.type];
    for (let y = Math.max(0, b.ty); y < Math.min(n, b.ty + def.depth); y += 1) for (let x = Math.max(0, b.tx); x < Math.min(n, b.tx + def.footprint); x += 1) owner[y * n + x] = k;
  });
  g.owner = owner;
  return owner;
}

function wallsInOn(g: DriveGrid, s: Settlement, site: Site): number {
  const n = g.n;
  // Over the door itself: every building is cut off.
  if (inSite(site, g.door % n, Math.floor(g.door / n))) return s.buildings.length;
  const reach = reachOf(g);
  // The tiles round it a rover reaches now.
  const ring: number[] = [];
  for (let y = site.ty - 1; y <= site.ty + site.h; y += 1) {
    for (let x = site.tx - 1; x <= site.tx + site.w; x += 1) {
      if (x < 0 || y < 0 || x >= n || y >= n || inSite(site, x, y)) continue;
      if (reach[y * n + x] === 1) ring.push(y * n + x);
    }
  }
  // The buildings it touches: one whose every way in was across the site is walled in by it alone.
  const suspects = new Set<number>();
  for (let y = site.ty - 1; y <= site.ty + site.h; y += 1) {
    for (let x = site.tx - 1; x <= site.tx + site.w; x += 1) {
      if (x < 0 || y < 0 || x >= n || y >= n || !besideSite(site, x, y)) continue;
      const o = ownerOf(g, s)[y * n + x]!;
      if (o >= 0) suspects.add(o);
    }
  }
  if (wallScratch === null || wallScratch.size < n * n || wallScratch.stamp > 2e9) wallScratch = { size: n * n, seen: new Int32Array(n * n), stamp: 0 };
  const sc = wallScratch;
  // A first look from one tile of the ring: does it get round to all the others? Then the site splits nothing.
  let split = false;
  if (ring.length > 1) {
    sc.stamp += 1;
    const local = sc.stamp;
    const wanted = new Set(ring);
    const queue = [ring[0]!];
    sc.seen[ring[0]!] = local;
    wanted.delete(ring[0]!);
    for (let k = 0; k < queue.length && wanted.size > 0 && queue.length < LOCAL_LOOK; k += 1) {
      const i = queue[k]!;
      const x = i % n;
      const y = (i - x) / n;
      for (let d = 0; d < 8; d += 1) {
        if (!canStep(g, x, y, d, site)) continue;
        const j = (y + DY[d]!) * n + x + DX[d]!;
        if (sc.seen[j] === local) continue;
        sc.seen[j] = local;
        wanted.delete(j);
        queue.push(j);
      }
    }
    split = wanted.size > 0;
  }
  if (!split && suspects.size === 0) return 0;
  // Each tile looked at from here is marked as reaching the door (`home`) or as in a piece cut off from it (`cut`).
  sc.stamp += 2;
  const home = sc.stamp - 1;
  const cut = sc.stamp;
  const doorX = g.door % n;
  const doorY = Math.floor(g.door / n);
  const cutTiles: number[] = [];
  /** From tile `from`, look for the door (or ground known to reach it), nearest the door first. A piece that never finds it is all looked at: marked cut. */
  const findDoor = (from: number): boolean => {
    if (!split || sc.seen[from] === home || from === g.door) return true;
    if (sc.seen[from] === cut) return false;
    sc.stamp += 1;
    const mine = sc.stamp;
    const visited: number[] = [from];
    const heap = doorHeap.clear();
    const dist = (i: number): number => Math.abs((i % n) - doorX) + Math.abs(Math.floor(i / n) - doorY);
    heap.push(from, dist(from), 0);
    sc.seen[from] = mine;
    let found = false;
    while (heap.size > 0 && !found) {
      const i = heap.pop();
      const x = i % n;
      const y = (i - x) / n;
      for (let d = 0; d < 8 && !found; d += 1) {
        if (!canStep(g, x, y, d, site)) continue;
        const j = (y + DY[d]!) * n + x + DX[d]!;
        if (sc.seen[j] === home || j === g.door) found = true;
        else if (sc.seen[j] !== mine) {
          sc.seen[j] = mine;
          visited.push(j);
          heap.push(j, dist(j), 0);
        }
      }
    }
    for (const i of visited) sc.seen[i] = found ? home : cut;
    if (!found) cutTiles.push(...visited);
    return found;
  };
  if (split) {
    for (const r of ring) findDoor(r);
    // And the buildings beside the ground cut off.
    for (const i of cutTiles) {
      const x = i % n;
      const y = (i - x) / n;
      for (let d = 0; d < 4; d += 1) {
        const nx = x + DX[d]!;
        const ny = y + DY[d]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const o = ownerOf(g, s)[ny * n + nx]!;
        if (o >= 0) suspects.add(o);
      }
    }
  }
  // Walled in: a building a rover could get to before (from a tile beside it it reached) and cannot after. The
  // headquarters is where rovers start from, not a place they go.
  let walled = 0;
  for (const k of suspects) {
    const placed = s.buildings[k]!;
    if (placed.type === "headquarters") continue;
    const b = buildingSite(placed);
    let before = false;
    let after = false;
    for (let y = b.ty - 1; y <= b.ty + b.h && !after; y += 1) {
      for (let x = b.tx - 1; x <= b.tx + b.w && !after; x += 1) {
        if (x < 0 || y < 0 || x >= n || y >= n || !besideSite(b, x, y) || reach[y * n + x] !== 1) continue;
        before = true;
        if (!inSite(site, x, y)) after = findDoor(y * n + x);
      }
    }
    if (before && !after) walled += 1;
  }
  return walled;
}

/** Why a building that would wall others in is refused. */
export function wallsInWords(count: number): string {
  return `it would wall in ${count === 1 ? "a building" : `${count} buildings`} no rover could get to then - leave a way through`;
}

// ---------------------------------------------------------------------------
// The drive, as the simulation times it
// ---------------------------------------------------------------------------

/** A rock's (or a levelled) tile, as a site. */
export function tileSite(tx: number, ty: number): Site {
  return { tx, ty, w: 1, h: 1 };
}

/** A building's footprint, as a site. */
export function buildingSite(b: Pick<PlacedBuilding, "type" | "tx" | "ty">): Site {
  const def = BUILDING_DEFS[b.type];
  return { tx: b.tx, ty: b.ty, w: def.footprint, h: def.depth };
}

/**
 * How a rover would drive to `site`: with routes on, its route (or null:
 * none reaches it); with them off, the straight line from the garage to the
 * site's middle, as every rover drove before Batch 29 (`route` absent).
 * Infinite years without a headquarters.
 */
export function drive(s: Settlement, site: Site, t: Tuning): { readonly years: number; readonly route?: readonly number[] } | null {
  const from = garage(s);
  if (from === null) return { years: Infinity };
  if (t.ROVER_ROUTES_ENABLED > 0) {
    const route = roverRoute(s, site, t);
    return route === null ? null : { years: route.years, route: route.points };
  }
  return { years: Math.hypot(site.tx + site.w / 2 - from.x, site.ty + site.h / 2 - from.y) * t.ROVER_YEARS_PER_TILE };
}

/**
 * How long a rover takes to break the rock on (tx, ty), in sim-years: out
 * from the headquarters, the work, and back. Infinite without a headquarters,
 * or (with routes on) with no way there.
 */
export function roverYears(s: Settlement, tx: number, ty: number, rock: Rock, t: Tuning): number {
  const way = drive(s, tileSite(tx, ty), t);
  if (way === null) return Infinity;
  const work = rock === "crag" ? t.ROVER_WORK_YEARS_CRAG : t.ROVER_WORK_YEARS_LOOSE;
  return 2 * way.years + work;
}

/**
 * Every tile a rover out on a route can be on: each tile it steps onto, and
 * past a corner both tiles beside it. A building may not go up on these
 * while the rover is out (`ROVER_PASSING`).
 */
export function tilesDriven(jobs: readonly SettlementJob[]): ReadonlySet<number> {
  const kept = driven.get(jobs);
  if (kept !== undefined) return kept;
  const out = new Set<number>();
  for (const job of jobs) {
    if (job.kind === "rocket" || job.route === undefined) continue;
    for (const key of expandRoute(job.route)) out.add(key);
  }
  driven.set(jobs, out);
  return out;
}

/** Kept per job list: the preview asks every frame. */
const driven = new WeakMap<readonly SettlementJob[], ReadonlySet<number>>();

/** A route's points, walked tile by tile (with the tiles beside each corner it cuts): tile keys, in order, each once. */
export function expandRoute(points: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (x: number, y: number): void => {
    const k = tileKey(x, y);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  points.forEach((key, k) => {
    const { tx, ty } = keyTile(key);
    if (k === 0) {
      add(tx, ty);
      return;
    }
    let { tx: x, ty: y } = keyTile(points[k - 1]!);
    const sx = Math.sign(tx - x);
    const sy = Math.sign(ty - y);
    while (x !== tx || y !== ty) {
      if (sx !== 0 && sy !== 0) {
        add(x + sx, y);
        add(x, y + sy);
      }
      x += sx;
      y += sy;
      add(x, y);
    }
  });
  return out;
}
