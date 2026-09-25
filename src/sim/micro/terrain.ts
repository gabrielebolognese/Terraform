/**
 * Detail doc §1 - a settlement's local terrain (Batch 22), rebuilt as an open
 * world at the user's request: "make it open world, but with building
 * boundaries; different scales, so high mountains, canyons, rock pits,
 * caves ... and the tiles shouldn't show as steps: smoothed out, so the
 * different level is visible but it doesn't look fake."
 *
 * One continuous height function per site, in metres against the
 * settlement's base elevation, sampled at tile CORNERS. The rules read the
 * buildable grid (`groundOf`: a tile's height is the mean of its corners,
 * its slope the steepest rise along its edges); the picture reads the whole
 * world round it (`worldOf`: the grid plus `TERRAIN_WORLD_MARGIN` tiles on
 * every side). The same function feeds both, so what is drawn is what the
 * rules judge.
 *
 * DERIVED, never stored: seeded by the place, so the same coordinate always
 * gives the same world and the save needs none of it.
 *
 * Scales, all multiples of `TERRAIN_RELIEF_M` (0 by default - flat, as the
 * fixtures were written for; the browser uses 12 m):
 *   - rolling ground, relief either side of the base;
 *   - ridged mountains, up to TERRAIN_MOUNTAIN_SCALE x relief (96 m);
 *   - canyons winding along a noise contour, TERRAIN_CANYON_SCALE x relief deep (42 m);
 *   - rock pits: craters with raised rims, up to TERRAIN_PIT_SCALE x relief deep (30 m);
 *   - caves: mouths in the steepest faces (a feature list, not height).
 * The big features stand back from the buildable grid - they rise over its
 * last tiles and beyond - and none reaches the landing zone at the centre,
 * which stays flat at the base elevation.
 */

import type { Tuning } from "../tuning.js";
import type { SettlementKind } from "../types.js";
import { gridTiles } from "./space.js";

/** 32-bit integer hash of three integers (a murmur-style finaliser). Pure. */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Lattice value in [0, 1). */
function lattice(seed: number, x: number, y: number): number {
  return hash3(seed, x, y) / 4294967296;
}

function fade(u: number): number {
  return u * u * (3 - 2 * u);
}

function smoothstep(lo: number, hi: number, x: number): number {
  const u = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
}

/** Smooth value noise in [0, 1), `scale` tiles per lattice cell. */
function valueNoise(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const u = fade(fx - x0);
  const v = fade(fy - y0);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

/**
 * Gradient noise in [0, 1), `scale` tiles per cell, on a plane turned by
 * `angle` radians. Value noise alone left straight creases and square-edged
 * mesas along its lattice lines once mountains stood 90 m high on it; a
 * gradient between random directions has no such bias, and turning each
 * layer's lattice away from the tile axes hides what is left of the grid.
 */
function gradNoise(seed: number, x: number, y: number, scale: number, angle: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const fx = (c * x - s * y) / scale;
  const fy = (s * x + c * y) / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const dot = (ix: number, iy: number): number => {
    const a = lattice(seed, ix, iy) * 2 * Math.PI;
    return Math.cos(a) * (fx - ix) + Math.sin(a) * (fy - iy);
  };
  const quintic = (u: number): number => u * u * u * (u * (u * 6 - 15) + 10);
  const u = quintic(fx - x0);
  const v = quintic(fy - y0);
  const top = dot(x0, y0) + (dot(x0 + 1, y0) - dot(x0, y0)) * u;
  const bottom = dot(x0, y0 + 1) + (dot(x0 + 1, y0 + 1) - dot(x0, y0 + 1)) * u;
  // A 2D gradient noise stays within about +-0.7; map it to 0..1.
  return Math.min(1, Math.max(0, 0.5 + (top + (bottom - top) * v) * 0.72));
}

/** The seed for a place: its coordinate to a few millimetres on the planet (1e-9 rad). */
export function placeSeed(lat: number, lon: number): number {
  return hash3(Math.round(lat * 1e9), Math.round(lon * 1e9), 0x5eed);
}

/**
 * Tiles over which the ground rises out of the landing zone. The ramp adds at
 * most relief * 1.5 / EASE_TILES of height per tile (a smoothstep's steepest
 * gradient is 1.5): 2.25 m at the browser's 12 m of relief, against the
 * 1.5 m a 10 m tile may rise.
 */
const EASE_TILES = 8;

/** Chebyshev distance, in tiles, from the point (x, y) to the landing zone's square (0 inside). */
function outsideLandingZone(x: number, y: number, tiles: number, t: Tuning): number {
  const lo = tiles / 2 - t.TERRAIN_CLEAR_TILES;
  const hi = tiles / 2 + t.TERRAIN_CLEAR_TILES;
  const dx = x < lo ? lo - x : x > hi ? x - hi : 0;
  const dy = y < lo ? lo - y : y > hi ? y - hi : 0;
  return Math.max(dx, dy);
}

/**
 * The height of the ground at the point (x, y) of a site's world, metres
 * against the base elevation. (x, y) are tile units from the buildable
 * grid's corner: 0..tiles is the grid, and the world runs past it both ways.
 */
export function terrainHeight(seed: number, tiles: number, x: number, y: number, t: Tuning): number {
  const relief = Math.max(0, t.TERRAIN_RELIEF_M);
  if (relief === 0) return 0;
  // Rolling ground: two octaves, as Batch 22 had it, mapped to -1..1.
  const scale = Math.max(1, t.TERRAIN_FEATURE_TILES);
  const rolling = ((2 / 3) * valueNoise(seed, x, y, scale) + (1 / 3) * valueNoise(seed ^ 0x9e37, x, y, scale / 2)) * 2 - 1;
  // Out of the landing zone, over EASE_TILES: exactly flat inside it.
  const out = outsideLandingZone(x, y, tiles, t);
  const ease = fade(Math.min(1, out / EASE_TILES));
  if (ease === 0) return 0;
  // How far toward the wild the point is, by its distance from the centre -
  // round, not square: a square measure (the largest of four distances)
  // creased the world along straight lines. The big features come in over
  // the grid's outer tiles and are at full strength beyond its corners.
  const r = Math.hypot(x - tiles / 2, y - tiles / 2);
  const wild = smoothstep(tiles * 0.4, tiles * 0.75 + 8, r);
  // Inside the grid a tenth of their strength: hills and gullies, not walls.
  const reach = 0.1 + 0.9 * wild;

  // Mountains: ridged noise, where a broad mask says there is a range.
  const range = smoothstep(0.52, 0.72, gradNoise(seed ^ 0x51a7, x, y, 48, 0.4));
  const ridge = 1 - Math.abs(2 * gradNoise(seed ^ 0x2c1b, x, y, 22, 1.1) - 1);
  const ridgeFine = 1 - Math.abs(2 * gradNoise(seed ^ 0x7f4a, x, y, 9, 2.3) - 1);
  const mountains = t.TERRAIN_MOUNTAIN_SCALE * relief * range * (ridge * ridge * 0.88 + ridgeFine * ridgeFine * 0.12);

  // Canyons: a channel along a contour of a slow noise field, steep-walled.
  // Its width wanders, and only some stretches of the contour are cut at all.
  const course = gradNoise(seed ^ 0x3ca9, x, y, 40, 0.8);
  const width = 0.025 + 0.05 * gradNoise(seed ^ 0x19e2, x, y, 18, 1.7);
  const cut = smoothstep(0.35, 0.6, gradNoise(seed ^ 0x0ddc, x, y, 60, 2.9));
  const canyon = t.TERRAIN_CANYON_SCALE * relief * cut * smoothstep(width * 2.5, width * 0.5, Math.abs(course - 0.5));

  // Rock pits: one crater at most per 26-tile cell, rim and bowl, of every size.
  let pits = 0;
  const cell = 26;
  const cx0 = Math.floor(x / cell);
  const cy0 = Math.floor(y / cell);
  for (let cy = cy0 - 1; cy <= cy0 + 1; cy += 1) {
    for (let cx = cx0 - 1; cx <= cx0 + 1; cx += 1) {
      if (lattice(seed ^ 0x6b2d, cx, cy) > 0.28) continue;
      const px = (cx + 0.2 + 0.6 * lattice(seed ^ 0x11f1, cx, cy)) * cell;
      const py = (cy + 0.2 + 0.6 * lattice(seed ^ 0x22e2, cx, cy)) * cell;
      const radius = 2 + 10 * lattice(seed ^ 0x33d3, cx, cy) ** 2;
      const depth = t.TERRAIN_PIT_SCALE * relief * (0.5 + 0.5 * lattice(seed ^ 0x44c4, cx, cy));
      const r = Math.hypot(x - px, y - py) / radius;
      if (r > 1.8) continue;
      const bowl = r < 1 ? -depth * (1 - r * r) : 0;
      const rim = 0.22 * depth * Math.exp(-(((r - 1) / 0.28) ** 2));
      pits += bowl + rim;
    }
  }

  return ease * (rolling * relief + reach * (mountains - canyon + pits));
}

export interface Ground {
  /** Edge of the grid, in tiles. */
  readonly tiles: number;
  /** Row-major (`ty * tiles + tx`): height in metres relative to the settlement's base elevation - the mean of the tile's corners. */
  readonly heightM: readonly number[];
  /** Row-major (`y * (tiles + 1) + x`): the height at each tile corner, metres. What the ground is drawn through. */
  readonly cornersM: readonly number[];
  /** Row-major: the steepest rise over run along the tile's edges. */
  readonly slope: readonly number[];
  /** Row-major: too steep to build on (`slope > TERRAIN_MAX_SLOPE`). */
  readonly steep: readonly boolean[];
}

/** A cave's mouth: where, and which way it faces (downhill). */
export interface Cave {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
}

export interface World {
  /** Tiles of world on every side of the buildable grid. */
  readonly margin: number;
  /** Edge of the whole world, tiles: the grid plus a margin each side. */
  readonly size: number;
  /** Row-major (`y * (size + 1) + x`), corner heights in metres; corner (0, 0) is the grid's (-margin, -margin). */
  readonly cornersM: readonly number[];
  /** Cave mouths, in grid tile coordinates (the world's corner is at -margin). */
  readonly caves: readonly Cave[];
}

type Place = { readonly kind: SettlementKind; readonly lat: number; readonly lon: number };

/** Recently built grounds and worlds: every placement check, view and connect asks again for the same site. */
const kept = new Map<string, Ground | World>();
const KEEP = 24;

function remember<T extends Ground | World>(key: string, make: () => T): T {
  const hit = kept.get(key);
  if (hit !== undefined) {
    kept.delete(key);
    kept.set(key, hit);
    return hit as T;
  }
  const made = make();
  kept.set(key, made);
  if (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
  return made;
}

function terrainKey(kind: string, place: Place, t: Tuning): string {
  return [
    kind,
    place.kind,
    place.lat,
    place.lon,
    gridTiles(place.kind, t),
    t.TERRAIN_RELIEF_M,
    t.TERRAIN_FEATURE_TILES,
    t.TERRAIN_CLEAR_TILES,
    t.TERRAIN_MAX_SLOPE,
    t.TILE_METRES,
    t.TERRAIN_MOUNTAIN_SCALE,
    t.TERRAIN_CANYON_SCALE,
    t.TERRAIN_PIT_SCALE,
    t.TERRAIN_WORLD_MARGIN,
  ].join("|");
}

/** The ground of a settlement's buildable grid. */
export function groundOf(place: Place, t: Tuning): Ground {
  return remember(terrainKey("ground", place, t), () => {
    const tiles = gridTiles(place.kind, t);
    const seed = placeSeed(place.lat, place.lon);
    const m = tiles + 1;
    const cornersM = new Array<number>(m * m);
    for (let y = 0; y < m; y += 1) for (let x = 0; x < m; x += 1) cornersM[y * m + x] = clean(terrainHeight(seed, tiles, x, y, t));
    const heightM = new Array<number>(tiles * tiles);
    const slope = new Array<number>(tiles * tiles);
    const steep = new Array<boolean>(tiles * tiles);
    for (let ty = 0; ty < tiles; ty += 1) {
      for (let tx = 0; tx < tiles; tx += 1) {
        const a = cornersM[ty * m + tx]!;
        const b = cornersM[ty * m + tx + 1]!;
        const c = cornersM[(ty + 1) * m + tx]!;
        const d = cornersM[(ty + 1) * m + tx + 1]!;
        const i = ty * tiles + tx;
        heightM[i] = clean((a + b + c + d) / 4);
        const rise = Math.max(Math.abs(a - b), Math.abs(c - d), Math.abs(a - c), Math.abs(b - d));
        slope[i] = rise / t.TILE_METRES;
        steep[i] = slope[i]! > t.TERRAIN_MAX_SLOPE;
      }
    }
    return { tiles, heightM, cornersM, slope, steep };
  });
}

/** Exactly 0, not -0 (a negative hill times a zero weight gives -0, and saves compare it). */
function clean(v: number): number {
  return v === 0 ? 0 : v;
}

/** The world round a settlement: its grid and `TERRAIN_WORLD_MARGIN` tiles beyond, for the picture. */
export function worldOf(place: Place, t: Tuning): World {
  return remember(terrainKey("world", place, t), () => {
    const tiles = gridTiles(place.kind, t);
    const margin = Math.max(0, Math.round(t.TERRAIN_WORLD_MARGIN));
    const size = tiles + 2 * margin;
    const seed = placeSeed(place.lat, place.lon);
    const m = size + 1;
    const cornersM = new Array<number>(m * m);
    for (let y = 0; y < m; y += 1) for (let x = 0; x < m; x += 1) cornersM[y * m + x] = clean(terrainHeight(seed, tiles, x - margin, y - margin, t));
    // Caves: at most one per 16-tile cell, in its steepest face, if that face is steep enough.
    const caves: Cave[] = [];
    const cell = 16;
    for (let cy = 0; cy < size; cy += cell) {
      for (let cx = 0; cx < size; cx += cell) {
        if (lattice(seed ^ 0x5cae, cx, cy) > 0.3) continue;
        let best = 0;
        let at: Cave | null = null;
        for (let y = cy; y < Math.min(size, cy + cell); y += 1) {
          for (let x = cx; x < Math.min(size, cx + cell); x += 1) {
            const h = cornersM[y * m + x]!;
            const gx = cornersM[y * m + x + 1]! - h;
            const gy = cornersM[(y + 1) * m + x]! - h;
            const g = Math.hypot(gx, gy);
            if (g > best) {
              best = g;
              // Facing downhill: into the face from the low side.
              at = { x: x - margin + 0.5, y: y - margin + 0.5, dx: -gx / (g || 1), dy: -gy / (g || 1) };
            }
          }
        }
        // A cave needs a real rock face: 6 m of rise across a 10 m tile.
        if (at !== null && best / t.TILE_METRES > 0.6) caves.push(at);
      }
    }
    return { margin, size, cornersM, caves };
  });
}

export function isSteep(ground: Ground, tx: number, ty: number): boolean {
  return ground.steep[ty * ground.tiles + tx] === true;
}

export function slopeAt(ground: Ground, tx: number, ty: number): number {
  return ground.slope[ty * ground.tiles + tx] ?? 0;
}
