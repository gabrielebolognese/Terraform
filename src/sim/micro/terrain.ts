/**
 * Detail doc §1 - a settlement's local terrain: a heightmap, and the slope
 * that decides where a building may stand (Batch 22). It replaces Batch 20's
 * rough outcrops: steep ground is now micro §3.3's "blocked terrain".
 *
 * DERIVED, never stored (detail §1.2's "store only the true state"). The
 * heights come from value noise seeded by the settlement's place, so the same
 * coordinate always gives the same ground and the save needs none of it. The
 * doc seeds with `hash(planet_seed, lat, lon)`; the planet's own terrain is the
 * same in every game, so this seeds by the place alone and a site always looks
 * the same.
 *
 * Heights are LOCAL, metres relative to the settlement's base elevation
 * (`siteElevation` in hypsometry.ts): detail §1.1's two layers. The relief is
 * `TERRAIN_RELIEF_M` either side of it - 0 by default, which makes every tile
 * flat and buildable, as the fixtures were written for. The browser opts in.
 *
 * The square at the centre, where the settlement was founded, is flat at the
 * base elevation itself (height 0), and the hills rise out of it over
 * `EASE_TILES`. Scaling the hills toward the centre, rather than levelling the
 * square to their average height, is what keeps its edge buildable: a
 * levelled square met the hills with a step of up to a third of the relief -
 * a cliff round the landing site (Batch 22, found by the reference city).
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

/** The seed for a place: its coordinate to a few millimetres on the planet (1e-9 rad). */
function placeSeed(lat: number, lon: number): number {
  return hash3(Math.round(lat * 1e9), Math.round(lon * 1e9), 0x5eed);
}

export interface Ground {
  /** Edge of the grid, in tiles. */
  readonly tiles: number;
  /** Row-major (`ty * tiles + tx`): height in metres relative to the settlement's base elevation. */
  readonly heightM: readonly number[];
  /** Row-major: the steepest rise over run from this tile to a neighbouring one. */
  readonly slope: readonly number[];
  /** Row-major: too steep to build on (`slope > TERRAIN_MAX_SLOPE`). */
  readonly steep: readonly boolean[];
}

/** Chebyshev distance, in tiles, from (tx, ty) to the levelled square at the centre (0 inside it). */
function outsideLandingZone(tx: number, ty: number, tiles: number, t: Tuning): number {
  const lo = tiles / 2 - t.TERRAIN_CLEAR_TILES;
  const hi = tiles / 2 + t.TERRAIN_CLEAR_TILES - 1;
  const dx = tx < lo ? lo - tx : tx > hi ? tx - hi : 0;
  const dy = ty < lo ? lo - ty : ty > hi ? ty - hi : 0;
  return Math.max(dx, dy);
}

/**
 * Tiles over which the hills rise out of the landing zone. The ramp adds at
 * most relief * 1.5 / EASE_TILES of height per tile (a smoothstep's steepest
 * gradient is 1.5): 2.25 m at the browser's 12 m of relief, against the
 * 1.5 m a 10 m tile may rise. So the ramp alone never makes ground steep
 * unless the hill it rises into is already large there.
 */
const EASE_TILES = 8;

/** The ground of a settlement at (lat, lon). */
export function groundOf(place: { readonly kind: SettlementKind; readonly lat: number; readonly lon: number }, t: Tuning): Ground {
  const tiles = gridTiles(place.kind, t);
  const n = tiles * tiles;
  const heightM = new Array<number>(n).fill(0);
  const relief = Math.max(0, t.TERRAIN_RELIEF_M);
  if (relief > 0) {
    const seed = placeSeed(place.lat, place.lon);
    const scale = Math.max(1, t.TERRAIN_FEATURE_TILES);
    const raw = (tx: number, ty: number): number => {
      // Two octaves, weights summing to 1, mapped to -1..1: hills with rougher shoulders.
      const v = (2 / 3) * valueNoise(seed, tx, ty, scale) + (1 / 3) * valueNoise(seed ^ 0x9e37, tx, ty, scale / 2);
      return (2 * v - 1) * relief;
    };
    for (let ty = 0; ty < tiles; ty += 1) {
      for (let tx = 0; tx < tiles; tx += 1) {
        const u = Math.min(1, outsideLandingZone(tx, ty, tiles, t) / EASE_TILES);
        // Exactly 0 inside the zone - not -0, which a negative hill times a zero weight gives.
        heightM[ty * tiles + tx] = u === 0 ? 0 : raw(tx, ty) * u * u * (3 - 2 * u);
      }
    }
  }
  const slope = new Array<number>(n).fill(0);
  const steep = new Array<boolean>(n).fill(false);
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      const h = heightM[ty * tiles + tx]!;
      let worst = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const x = tx + dx;
        const y = ty + dy;
        if (x < 0 || y < 0 || x >= tiles || y >= tiles) continue;
        worst = Math.max(worst, Math.abs(heightM[y * tiles + x]! - h));
      }
      const s = worst / t.TILE_METRES;
      slope[ty * tiles + tx] = s;
      steep[ty * tiles + tx] = s > t.TERRAIN_MAX_SLOPE;
    }
  }
  return { tiles, heightM, slope, steep };
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function isSteep(ground: Ground, tx: number, ty: number): boolean {
  return ground.steep[ty * ground.tiles + tx] === true;
}

export function slopeAt(ground: Ground, tx: number, ty: number): number {
  return ground.slope[ty * ground.tiles + tx] ?? 0;
}
