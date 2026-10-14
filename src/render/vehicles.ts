/**
 * Batch 29: vehicles that use the city ("the trains, the rovers: they skin
 * through buildings"). Where every rover and every train car is at a moment,
 * as footprints on the ground - drawn by `city.ts`, checked by the tests.
 *
 * Rovers follow the way the view gives each job (`CityJobView.path`): out of
 * the garage door, round the city on the right of the way, at the site with
 * the arm working, and home again on the other side - each facing where it
 * drives, and one behind another where two share a stretch.
 *
 * Trains run the loops of `trainLinesOf` (the junction rule of before): each
 * car rides the curve of the line on its own two bogies, each way of a line
 * on its own track, slowing for the bends, stopping at the platforms beside a
 * station and at the end of a line - where it waits and runs back, the last
 * car leading. A line past a station carries maglevs; one past none, freight.
 *
 * Drawn, not simulated: everything here comes from the view and the render
 * clock, as the planet renderer's comes from `VisualChannels`.
 */

import type { CityView } from "../sim/index.js";

/** A job as the view gives it (a rover's, or a rocket's). */
type CityJobView = CityView["jobs"][number];

/** A vehicle's body on the ground, tiles: a rectangle about (x, y), turned `angle` radians, half `halfL` long and `halfW` wide. */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly halfL: number;
  readonly halfW: number;
}

export interface Rover extends Footprint {
  readonly z: number;
  readonly hue: number;
  /** At the site, working: how far through, 0..1; null while driving. */
  readonly working: number | null;
  /** Its job's index in the view. */
  readonly job: number;
}

export interface TrainCar extends Footprint {
  readonly z: number;
  /** The front car carries the nose (a maglev) or the cab (freight). */
  readonly lead: boolean;
  readonly freight: boolean;
  /** Which car of its train, from the front. */
  readonly car: number;
  /** Its train, for colours that stay with it: the loop and the train on it. */
  readonly train: number;
}

// ---------------------------------------------------------------------------
// Rovers
// ---------------------------------------------------------------------------

/** A rover's half length and half width, tiles. */
export const ROVER_HALF_L = 0.19;
export const ROVER_HALF_W = 0.11;
/**
 * How far right of the way a rover drives, tiles, so two pass each other: at
 * least 0.28, clear of a corridor's walls (0.17 from its middle, and the
 * rover is 0.11 to its side); at most 0.288, so where a diagonal stretch
 * turns square its nose (0.212 out, across the corner) stays on its tile
 * (0.3 put it 0.012 into a building beside the corner: 2 of 8,610 frames of
 * the scripted day, measured).
 */
export const ROVER_LANE = 0.285;
/** A turn sharper than this (1 + the cosine between the two sides' normals) is cut across, not mitred: a mitre that long leaves the tile. */
const MITRE_LIMIT = 0.6;
/** The gap a rover keeps behind another, tiles. */
const ROVER_GAP = 0.06;
/** The headquarters' half side (its 5 x 5 footprint): inside it a rover is in its garage, not drawn. */
const HQ_HALF = 2.5;

/** How far through each job is, 0..1, at this moment. */
export function jobProgress(total: number, remaining: number, since: number): number {
  return Math.min(1, Math.max(0, (total - remaining + since) / total));
}

interface Lane {
  /** The offset points, and the arc length to each. */
  readonly pts: readonly { readonly x: number; readonly y: number }[];
  readonly len: readonly number[];
  /** Each point's share of the drive (the job's `at`, or its mirror on the way home). */
  readonly at: readonly number[];
  /** Heading of each segment, radians. */
  readonly heading: readonly number[];
}

/** A way, offset `ROVER_LANE` to its right, the corners mitred so the lane stays parallel to it. */
function laneOf(path: readonly { x: number; y: number }[], at: readonly number[]): Lane {
  // Drop repeated points: a zero-length segment has no direction.
  const p: { x: number; y: number }[] = [];
  const a: number[] = [];
  path.forEach((q, i) => {
    const last = p[p.length - 1];
    if (last !== undefined && Math.hypot(q.x - last.x, q.y - last.y) < 1e-9) {
      a[a.length - 1] = at[i]!;
      return;
    }
    p.push(q);
    a.push(at[i]!);
  });
  if (p.length < 2) return { pts: p, len: p.map(() => 0), at: a, heading: [0] };
  const dirs = p.slice(1).map((q, i) => {
    const l = Math.hypot(q.x - p[i]!.x, q.y - p[i]!.y);
    return { x: (q.x - p[i]!.x) / l, y: (q.y - p[i]!.y) / l };
  });
  // The right of a heading (x east, y south): (-dy, dx).
  const right = dirs.map((d) => ({ x: -d.y, y: d.x }));
  const pts: { x: number; y: number }[] = [];
  const shares: number[] = [];
  const heading: number[] = [];
  p.forEach((q, i) => {
    const r0 = right[Math.max(0, i - 1)]!;
    const r1 = right[Math.min(right.length - 1, i)]!;
    const k = 1 + r0.x * r1.x + r0.y * r1.y;
    if (i === 0 || i === p.length - 1 || k >= MITRE_LIMIT) {
      // The ends, offset square to their stretch; a corner, mitred so the lane stays parallel to both sides.
      const m = i === 0 ? r1 : i === p.length - 1 ? r0 : { x: (r0.x + r1.x) / k, y: (r0.y + r1.y) / k };
      pts.push({ x: q.x + m.x * ROVER_LANE, y: q.y + m.y * ROVER_LANE });
      shares.push(a[i]!);
    } else {
      // A sharp turn: across from one side's lane to the other's.
      pts.push({ x: q.x + r0.x * ROVER_LANE, y: q.y + r0.y * ROVER_LANE }, { x: q.x + r1.x * ROVER_LANE, y: q.y + r1.y * ROVER_LANE });
      shares.push(a[i]!, a[i]!);
      // The stretch across, then the side out.
      heading.push(Math.atan2(r1.y - r0.y, r1.x - r0.x), Math.atan2(dirs[i]!.y, dirs[i]!.x));
      return;
    }
    // The stretch out of this point (one heading a stretch: one fewer than the points).
    if (i < dirs.length) heading.push(Math.atan2(dirs[i]!.y, dirs[i]!.x));
  });
  const len = [0];
  for (let i = 1; i < pts.length; i += 1) len.push(len[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  return { pts, len, at: shares, heading };
}

/** Lanes are kept per path: a path keeps its identity while its job is under way. */
const lanes = new WeakMap<readonly { x: number; y: number }[], { out: Lane; home: Lane }>();

function lanesOf(job: CityJobView, garage: { x: number; y: number }): { out: Lane; home: Lane } {
  const path = job.path ?? straightPath(job, garage);
  const kept = lanes.get(path);
  if (kept !== undefined) return kept;
  const at = job.at ?? path.map((_, i) => i / Math.max(1, path.length - 1));
  const made = { out: laneOf(path, at), home: laneOf([...path].reverse(), [...at].reverse().map((v) => 1 - v)) };
  lanes.set(path, made);
  return made;
}

/** A hand-made view's job, with no path: the straight line of Batches 21-28, stopping short of the rock. */
function straightPath(job: CityJobView, g: { x: number; y: number }): { x: number; y: number }[] {
  const tx = job.tx + 0.5;
  const ty = job.ty + 0.5;
  const len = Math.hypot(tx - g.x, ty - g.y) || 1;
  const stop = Math.max(0, len - 0.45);
  return [{ x: g.x, y: g.y }, { x: g.x + ((tx - g.x) / len) * stop, y: g.y + ((ty - g.y) / len) * stop }];
}

/** The point and heading `s` tiles along a lane. */
function alongLane(l: Lane, s: number): { x: number; y: number; angle: number } {
  const n = l.pts.length;
  if (n === 1) return { x: l.pts[0]!.x, y: l.pts[0]!.y, angle: 0 };
  const total = l.len[n - 1]!;
  const d = Math.min(total, Math.max(0, s));
  let i = 0;
  while (i < n - 2 && l.len[i + 1]! < d) i += 1;
  const seg = l.len[i + 1]! - l.len[i]!;
  const f = seg > 0 ? (d - l.len[i]!) / seg : 0;
  const a = l.pts[i]!;
  const b = l.pts[i + 1]!;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: l.heading[i]! };
}

/** The distance along a lane at which a share `f` of the drive is done: the lane's points are each a share of it. */
function shareToLength(l: Lane, f: number): number {
  const n = l.at.length;
  if (n === 1) return 0;
  if (f <= l.at[0]!) return 0;
  for (let i = 1; i < n; i += 1) {
    if (f <= l.at[i]!) {
      const span = l.at[i]! - l.at[i - 1]!;
      const g = span > 0 ? (f - l.at[i - 1]!) / span : 1;
      return l.len[i - 1]! + (l.len[i]! - l.len[i - 1]!) * g;
    }
  }
  return l.len[n - 1]!;
}

/** Whether two footprints overlap, by more than `gap` short of touching (separating axes). */
export function footprintsOverlap(a: Footprint, b: Footprint, gap = 0): boolean {
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  for (const th of axes) {
    const ux = Math.cos(th);
    const uy = Math.sin(th);
    const reach = (f: Footprint): number => {
      const c = Math.cos(f.angle - th);
      const s = Math.sin(f.angle - th);
      return Math.abs(c) * f.halfL + Math.abs(s) * f.halfW;
    };
    const dist = Math.abs((b.x - a.x) * ux + (b.y - a.y) * uy);
    if (dist >= reach(a) + reach(b) + gap) return false;
  }
  return true;
}

/** The corners of a footprint. */
export function cornersOf(f: Footprint): [number, number][] {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  return [
    [f.halfL, f.halfW],
    [f.halfL, -f.halfW],
    [-f.halfL, -f.halfW],
    [-f.halfL, f.halfW],
  ].map(([u, v]) => [f.x + u! * c - v! * s, f.y + u! * s + v! * c]);
}

/**
 * The tile a vehicle is drawn with: of the tiles its body is over, the one
 * nearest the viewer (largest x + y, then x). Drawn after that tile's ground,
 * it is after the ground of every tile under it, and still before anything
 * standing in front of it - so a building it passes behind hides it.
 */
export function drawTile(f: Footprint, n: number): number {
  let best = -1;
  let bx = 0;
  let by = 0;
  const shrink = 1e-6;
  const pts = cornersOf({ ...f, halfL: Math.max(0, f.halfL - shrink), halfW: Math.max(0, f.halfW - shrink) });
  pts.push([f.x, f.y]);
  for (const [px, py] of pts) {
    const x = Math.min(n - 1, Math.max(0, Math.floor(px)));
    const y = Math.min(n - 1, Math.max(0, Math.floor(py)));
    if (best < 0 || x + y > bx + by || (x + y === bx + by && x > bx)) {
      best = y * n + x;
      bx = x;
      by = y;
    }
  }
  return best;
}

/** The headquarters' middle, when the view has one: a rover inside its square is in the garage. */
function hqOf(view: CityView): { x: number; y: number } | null {
  const hq = view.buildings.find((b) => b.type === "headquarters");
  return hq === undefined ? null : { x: hq.tx + hq.size / 2, y: hq.ty + (hq.depth ?? hq.size) / 2 };
}

/**
 * Every rover out on a job at this moment, in job order, with where it is
 * drawn (`drawTile`). In the garage - still inside the headquarters - none.
 */
export function roversOf(view: CityView, since: number): Rover[] {
  const g = view.garage;
  if (g === null) return [];
  const hq = hqOf(view) ?? g;
  const inGarage = (x: number, y: number): boolean => Math.abs(x - hq.x) < HQ_HALF + ROVER_HALF_L + 0.01 && Math.abs(y - hq.y) < HQ_HALF + ROVER_HALF_L + 0.01;
  const placed: (Rover & { lane: Lane; s: number })[] = [];
  view.jobs.forEach((job, k) => {
    if (job.kind !== "rover") return;
    const { out, home } = lanesOf(job, g);
    const elapsed = jobProgress(job.total, job.remaining, since) * job.total;
    const drive = Math.max(1e-9, (job.total - job.work) / 2);
    let lane = out;
    let s: number;
    let working: number | null = null;
    if (elapsed < drive) s = shareToLength(out, elapsed / drive);
    else if (elapsed < drive + job.work) {
      s = out.len[out.len.length - 1]!;
      working = (elapsed - drive) / Math.max(1e-9, job.work);
    } else {
      lane = home;
      s = shareToLength(home, Math.min(1, (elapsed - drive - job.work) / drive));
    }
    const hue = (((k * 0.37) % 1) + 1) % 1;
    const at = (d: number): Rover & { lane: Lane; s: number } => {
      const p = alongLane(lane, d);
      return { x: p.x, y: p.y, angle: p.angle, halfL: ROVER_HALF_L, halfW: ROVER_HALF_W, z: 0, hue, working, job: k, lane, s: d };
    };
    let r = at(s);
    // Two on one stretch keep apart: the later one waits behind (driving only - one at work stays where it works).
    if (working === null) {
      for (let tries = 0; tries < 60 && placed.some((o) => o.working === null && footprintsOverlap(o, r, ROVER_GAP)); tries += 1) r = at(r.s - 0.05);
    }
    if (inGarage(r.x, r.y)) return;
    placed.push(r);
  });
  const n = view.tiles;
  return placed.map(({ lane: _l, s: _s, ...r }) => {
    const tile = Math.min(n - 1, Math.max(0, Math.floor(r.y))) * n + Math.min(n - 1, Math.max(0, Math.floor(r.x)));
    return { ...r, z: view.groundZ[tile] ?? 0 };
  });
}

/** The last frame's rovers: a frame drawn chunk by chunk asks for them once a chunk. */
let lastRovers: { view: CityView; since: number; out: Map<number, Rover[]> } | null = null;

/** Every rover, by the tile it is drawn with. */
export function roversAt(view: CityView, since: number): Map<number, Rover[]> {
  if (lastRovers !== null && lastRovers.view === view && lastRovers.since === since) return lastRovers.out;
  const out = new Map<number, Rover[]>();
  lastRovers = { view, since, out };
  for (const r of roversOf(view, since)) {
    const tile = drawTile(r, view.tiles);
    const list = out.get(tile);
    if (list === undefined) out.set(tile, [r]);
    else list.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trains
// ---------------------------------------------------------------------------

/** How far apart the trains on a line are, tiles of it; cars a train. */
export const TRAIN_SPACING = 56;
export const TRAIN_CARS = 5;
/** Top speed, and through a bend and into a stop, tiles a second. */
export const TRAIN_SPEED = 2.2;
export const TRAIN_SLOW = 1.1;
/** Seconds a train stands at a platform, or at the end of a line before it runs back. */
export const TRAIN_DWELL_S = 4;
/** Tiles before a stop a train is slowing for it. */
const BRAKE_TILES = 1.5;
/**
 * A car: half its length and width, tiles; car to car, front to front; the
 * bogies' distance in from each end. And how far right of the line's middle
 * each way's track runs, so a train each way passes another.
 *
 * Found by trying every car against every other passing it, each on its own
 * track, over every shape a line of tiles takes - a bend, an S of two, a
 * staircase, a U: the longest that keep two passing cars apart and every car
 * on its tiles. The first cars (0.88 long, tracks 0.15 out) touched on every
 * bend two trains passed on; 0.64 long, on every S (both measured).
 */
export const CAR_HALF_L = 0.28;
export const CAR_HALF_W = 0.11;
const CAR_PITCH = 0.68;
const BOGIE_IN = 0.1;
export const TRAIN_LANE = 0.22;
/** A loop shorter than this, tiles, is a stub a few tiles long: line, but no train goes round it. */
const SHORTEST_LOOP = 12;
/** Over how many tiles the two tracks come together at the end of a line, where a train runs back on the other. */
const TAPER_TILES = 1.5;
/** A train's length, nose to tail. */
const TRAIN_LENGTH = (TRAIN_CARS - 1) * CAR_PITCH + 2 * CAR_HALF_L;

/** A loop a train runs round: the tiles in order. */
export interface TrainLine {
  readonly tiles: readonly number[];
}

const trainLines = new WeakMap<readonly boolean[], TrainLine[]>();

/**
 * The lines trains run on, from the rails alone: a train goes straight on
 * where two lines cross, keeps right where it meets a junction of three, follows
 * the line round a bend, and turns back at a dead end (a station's platform,
 * or the end of a spur). That rule sends exactly one way out for each way in,
 * so every stretch of line, each way, lies on one loop, and a train comes
 * round it back to where it began. (Straight on at every junction, the first
 * version, never turned into a branch met side-on: 38% of a metropolis's
 * railway saw no train, measured.) Loops shorter than a train's run are left
 * empty.
 */
export function trainLinesOf(view: CityView): TrainLine[] {
  const rails = view.rails;
  if (rails === undefined) return [];
  const kept = trainLines.get(rails);
  if (kept !== undefined) return kept;
  const n = view.tiles;
  const at = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && rails[y * n + x] === true;
  // Directions: 0 east, 1 south, 2 west, 3 north; turning right is one step on.
  const next = (tile: number, dir: number): number => {
    const x = tile % n;
    const y = (tile - x) / n;
    const open = (d: number): boolean => at(x + DX[d]!, y + DY[d]!);
    const right = (dir + 1) % 4;
    const left = (dir + 3) % 4;
    const ways = [0, 1, 2, 3].filter(open).length;
    if (ways === 4) return dir;
    for (const d of ways === 3 ? [right, dir, left] : [dir, right, left]) if (open(d)) return d;
    return (dir + 2) % 4;
  };
  const lines: TrainLine[] = [];
  const done = new Uint8Array(n * n * 4);
  for (let start = 0; start < n * n; start += 1) {
    if (!rails[start]) continue;
    const x = start % n;
    const y = (start - x) / n;
    for (let first = 0; first < 4; first += 1) {
      if (!at(x + DX[first]!, y + DY[first]!) || done[start * 4 + first]) continue;
      // Leave the tile that way: the loop is every (tile, heading-out) until it comes round again.
      const path: number[] = [];
      let tile = start;
      let out = first;
      while (!done[tile * 4 + out]) {
        done[tile * 4 + out] = 1;
        path.push(tile);
        tile += DX[out]! + DY[out]! * n;
        out = next(tile, out);
      }
      lines.push({ tiles: path });
    }
  }
  trainLines.set(rails, lines);
  return lines;
}

/** East, south, west, north. */
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

/** One tile of a loop: how its middle line runs across the tile. */
interface Piece {
  /** Where along the loop it starts, and how long it is (tiles of the middle line). */
  readonly s0: number;
  readonly len: number;
  readonly tile: number;
  /** The way in and out: 0 east, 1 south, 2 west, 3 north. The same way out as in, back, on a dead end. */
  readonly din: number;
  readonly dout: number;
  /** The bed's height at the edge in, the middle and the edge out. */
  readonly zIn: number;
  readonly zMid: number;
  readonly zOut: number;
  readonly platform: boolean;
}

interface Profile {
  readonly pieces: readonly Piece[];
  readonly length: number;
  /** Where the loop turns back, along it: the middle of each dead end. */
  readonly ends: readonly number[];
  /** Seconds a lap takes, and the stretches it is made of. */
  readonly lap: number;
  readonly legs: readonly { readonly t0: number; readonly h0: number; readonly v: number; readonly dur: number }[];
  readonly freight: boolean;
}

/** The bed's height at a tile's middle: its ground and its deck (`railDeck`), passed in from the drawing. */
export type RailHeight = (tx: number, ty: number) => number;

const profiles = new WeakMap<TrainLine, { stations: ReadonlySet<number>; profile: Profile }>();

/** The tiles beside a station's footprint, across one of its sides: where a train standing on the line is at its platform. */
function platformTiles(view: CityView): ReadonlySet<number> {
  const n = view.tiles;
  const out = new Set<number>();
  for (const b of view.buildings) {
    if (b.type !== "station") continue;
    const d = b.depth ?? b.size;
    for (let x = b.tx; x < b.tx + b.size; x += 1) for (const y of [b.ty - 1, b.ty + d]) if (x >= 0 && y >= 0 && x < n && y < n) out.add(y * n + x);
    for (let y = b.ty; y < b.ty + d; y += 1) for (const x of [b.tx - 1, b.tx + b.size]) if (x >= 0 && y >= 0 && x < n && y < n) out.add(y * n + x);
  }
  return out;
}

const platformSets = new WeakMap<readonly unknown[], ReadonlySet<number>>();

function platformsOf(view: CityView): ReadonlySet<number> {
  let set = platformSets.get(view.buildings);
  if (set === undefined) {
    set = platformTiles(view);
    platformSets.set(view.buildings, set);
  }
  return set;
}

function dirBetween(a: number, b: number, n: number): number {
  const dx = (b % n) - (a % n);
  const dy = Math.floor(b / n) - Math.floor(a / n);
  return dx === 1 ? 0 : dy === 1 ? 1 : dx === -1 ? 2 : 3;
}

/** The loop's pieces, stops and timetable: what a train on it does, second by second. */
function profileOf(view: CityView, line: TrainLine, height: RailHeight): Profile {
  const stations = platformsOf(view);
  const kept = profiles.get(line);
  if (kept !== undefined && kept.stations === stations) return kept.profile;
  const n = view.tiles;
  const tiles = line.tiles;
  const m = tiles.length;
  const zc = (tile: number): number => height(tile % n, Math.floor(tile / n));
  const pieces: Piece[] = [];
  const ends: number[] = [];
  let s = 0;
  for (let k = 0; k < m; k += 1) {
    const tile = tiles[k]!;
    const prev = tiles[(k - 1 + m) % m]!;
    const next = tiles[(k + 1) % m]!;
    const din = dirBetween(prev, tile, n);
    const dout = dirBetween(tile, next, n);
    const turn = (dout - din + 4) % 4;
    const len = turn === 0 ? 1 : turn === 2 ? 1 : Math.PI / 4;
    const mid = zc(tile);
    if (turn === 2) ends.push(s + 0.5);
    pieces.push({ s0: s, len, tile, din, dout, zIn: (zc(prev) + mid) / 2, zMid: mid, zOut: (mid + zc(next)) / 2, platform: stations.has(tile) });
    s += len;
  }
  const length = s;
  const freight = !pieces.some((p) => p.platform);
  // Stops: the end of each line (a train stands there, then runs back), and the far end of every run of
  // platform tiles a train runs straight through.
  const stops: { h: number; jump: number }[] = ends.map((e) => ({ h: e, jump: e + TRAIN_LENGTH }));
  for (let k = 0; k < m; k += 1) {
    const p = pieces[k]!;
    const after = pieces[(k + 1) % m]!;
    if (!p.platform || after.platform) continue;
    // A run that ends at the end of the line stops there already.
    let j = k;
    let terminus = false;
    for (let c = 0; c < m && pieces[j]!.platform; c += 1, j = (j - 1 + m) % m) if ((pieces[j]!.dout - pieces[j]!.din + 4) % 4 === 2) terminus = true;
    if (terminus) continue;
    const h = p.s0 + p.len;
    if (ends.some((e) => h > e && h < e + TRAIN_LENGTH)) continue;
    stops.push({ h, jump: h });
  }
  // Slow from a tile before a bend until the last car is round it, and into every stop.
  const slow: [number, number][] = [];
  for (const p of pieces) if ((p.dout - p.din + 4) % 4 % 2 === 1) slow.push([p.s0 - 1, p.s0 + p.len + TRAIN_LENGTH]);
  for (const st of stops) slow.push([st.h - BRAKE_TILES, st.h], [st.jump, st.jump + 1]);
  const slowAt = (h: number): boolean => slow.some(([a, b]) => {
    const x = ((h - a) % length + length) % length;
    return x < b - a;
  });
  // From just after the first end (or the loop's start), once round.
  const startH = ends.length > 0 ? ends[0]! + TRAIN_LENGTH : 0;
  const unwrap = (h: number): number => {
    let x = h;
    while (x <= startH + 1e-9) x += length;
    while (x > startH + length + 1e-9) x -= length;
    return x;
  };
  const marks = new Set<number>();
  for (const [a, b] of slow) {
    marks.add(unwrap(a));
    marks.add(unwrap(b));
  }
  const stopAt = new Map<number, number>();
  for (const st of stops) {
    const h = unwrap(st.h);
    marks.add(h);
    stopAt.set(h, st.jump - st.h);
  }
  marks.add(startH + length);
  const sorted = [...marks].sort((a, b) => a - b);
  const legs: { t0: number; h0: number; v: number; dur: number }[] = [];
  let t = 0;
  let h = startH;
  for (const e of sorted) {
    if (e <= h + 1e-9) continue;
    const v = slowAt((h + e) / 2) ? TRAIN_SLOW : TRAIN_SPEED;
    legs.push({ t0: t, h0: h, v, dur: (e - h) / v });
    t += (e - h) / v;
    h = e;
    const skip = stopAt.get(e);
    if (skip !== undefined) {
      legs.push({ t0: t, h0: h, v: 0, dur: TRAIN_DWELL_S });
      t += TRAIN_DWELL_S;
      h = e + skip;
    }
  }
  const profile: Profile = { pieces, length, ends, lap: t, legs, freight };
  profiles.set(line, { stations, profile });
  return profile;
}

/** Where along the loop a train's nose is, `tau` seconds into its lap. */
function headAt(p: Profile, tau: number): number {
  const legs = p.legs;
  let lo = 0;
  let hi = legs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (legs[mid]!.t0 <= tau) lo = mid;
    else hi = mid - 1;
  }
  const leg = legs[lo]!;
  return leg.h0 + leg.v * Math.min(leg.dur, Math.max(0, tau - leg.t0));
}

/** The lane's point `s` along a loop, its height, and which way the loop runs there. */
function pointOn(p: Profile, s: number, n: number): { x: number; y: number; z: number } {
  const L = p.length;
  const u = ((s % L) + L) % L;
  let lo = 0;
  let hi = p.pieces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.pieces[mid]!.s0 <= u) lo = mid;
    else hi = mid - 1;
  }
  const q = p.pieces[lo]!;
  const local = Math.min(q.len, Math.max(0, u - q.s0)) / q.len;
  const cx = (q.tile % n) + 0.5;
  const cy = Math.floor(q.tile / n) + 0.5;
  const turn = (q.dout - q.din + 4) % 4;
  let x: number;
  let y: number;
  let tx: number;
  let ty: number;
  if (turn === 1 || turn === 3) {
    // A quarter circle about the corner the line turns round, half a tile out.
    const ox = cx - 0.5 * DX[q.din]! + 0.5 * DX[q.dout]!;
    const oy = cy - 0.5 * DY[q.din]! + 0.5 * DY[q.dout]!;
    const a0 = Math.atan2(cy - 0.5 * DY[q.din]! - oy, cx - 0.5 * DX[q.din]! - ox);
    let a1 = Math.atan2(cy + 0.5 * DY[q.dout]! - oy, cx + 0.5 * DX[q.dout]! - ox);
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
    const a = a0 + (a1 - a0) * local;
    x = ox + 0.5 * Math.cos(a);
    y = oy + 0.5 * Math.sin(a);
    const sign = Math.sign(a1 - a0);
    tx = -Math.sin(a) * sign;
    ty = Math.cos(a) * sign;
  } else if (turn === 2) {
    // The end of the line: in to the middle, and out again the way it came.
    const d = local < 0.5 ? q.din : q.dout;
    const f = local < 0.5 ? local * 2 : (local - 0.5) * 2;
    const ex = cx - 0.5 * DX[q.din]!;
    const ey = cy - 0.5 * DY[q.din]!;
    x = local < 0.5 ? ex + (cx - ex) * f : cx + (ex - cx) * f;
    y = local < 0.5 ? ey + (cy - ey) * f : cy + (ey - cy) * f;
    tx = DX[d]!;
    ty = DY[d]!;
  } else {
    x = cx - 0.5 * DX[q.din]! + DX[q.din]! * local;
    y = cy - 0.5 * DY[q.din]! + DY[q.din]! * local;
    tx = DX[q.din]!;
    ty = DY[q.din]!;
  }
  // Each way on its own track, right of the middle; the two come together at the end of a line.
  let lane = TRAIN_LANE;
  for (const e of p.ends) {
    const dist = Math.min(Math.abs(u - e), L - Math.abs(u - e));
    lane = Math.min(lane, (TRAIN_LANE * dist) / TAPER_TILES);
  }
  const z = local < 0.5 ? q.zIn + (q.zMid - q.zIn) * local * 2 : q.zMid + (q.zOut - q.zMid) * (local - 0.5) * 2;
  return { x: x - ty * lane, y: y + tx * lane, z };
}

/** Seconds a lap of each loop takes, in `trainLinesOf` order (0 for a loop with no train): a train is where it was a lap later. */
export function trainLaps(view: CityView, height: RailHeight): number[] {
  return trainLinesOf(view).map((line) => (line.tiles.length < SHORTEST_LOOP ? 0 : profileOf(view, line, height).lap));
}

/** The last frame's cars: a frame drawn chunk by chunk asks for them once a chunk. */
let lastTrains: { view: CityView; time: number; cars: TrainCar[] } | null = null;

/** Every train car at this moment. */
export function trainCarsOf(view: CityView, time: number, height: RailHeight): TrainCar[] {
  if (lastTrains !== null && lastTrains.view === view && lastTrains.time === time) return lastTrains.cars;
  const n = view.tiles;
  const out: TrainCar[] = [];
  trainLinesOf(view).forEach((line, li) => {
    // A loop shorter than a train's run (a stub a few tiles long) is line, but no train goes round it.
    if (line.tiles.length < SHORTEST_LOOP) return;
    const p = profileOf(view, line, height);
    const trains = Math.max(1, Math.floor(p.length / TRAIN_SPACING));
    for (let k = 0; k < trains; k += 1) {
      const tau = ((((time + (li * 7.3) / TRAIN_SPEED + (k * p.lap) / trains) % p.lap) + p.lap) % p.lap);
      const head = headAt(p, tau);
      for (let c = 0; c < TRAIN_CARS; c += 1) {
        // Each car on its own two bogies, a little in from its ends: it rides the bend car by car.
        const front = head - c * CAR_PITCH;
        const a = pointOn(p, front - BOGIE_IN, n);
        const b = pointOn(p, front - 2 * CAR_HALF_L + BOGIE_IN, n);
        const angle = Math.atan2(a.y - b.y, a.x - b.x);
        out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, angle, halfL: CAR_HALF_L, halfW: CAR_HALF_W, lead: c === 0, freight: p.freight, car: c, train: li * 64 + k });
      }
    }
  });
  lastTrains = { view, time, cars: out };
  return out;
}

const lastByTile = new WeakMap<TrainCar[], Map<number, TrainCar[]>>();

/** Every train car at this moment, by the tile it is drawn with (`drawTile`). */
export function trainsAt(view: CityView, time: number, height: RailHeight): Map<number, TrainCar[]> {
  const cars = trainCarsOf(view, time, height);
  const kept = lastByTile.get(cars);
  if (kept !== undefined) return kept;
  const out = new Map<number, TrainCar[]>();
  for (const car of cars) {
    const tile = drawTile(car, view.tiles);
    const list = out.get(tile);
    if (list === undefined) out.set(tile, [car]);
    else list.push(car);
  }
  lastByTile.set(cars, out);
  return out;
}
