/**
 * Micro doc §3.3 - "Each tile has a type (buildable ground, blocked terrain,
 * reserved)." The doc never says where blocked terrain comes from, so it is
 * DERIVED here: rough outcrops grown from value noise seeded by the
 * settlement's place on the planet. The same coordinate always gives the same
 * ground, so the terrain needs no room in the save (section 10's "never store
 * derived values") and a settlement founded twice at one spot is the same
 * ground twice.
 *
 * Exactly `TERRAIN_ROUGH_FRACTION` of the tiles outside the landing zone are
 * rough - the roughest by the noise - so the dial means what it says. Off (0)
 * by default: tests and the calibrated fixtures place buildings on fixed tiles,
 * and ground appearing under them would refuse placements that were legal.
 * The browser opts in.
 *
 * "Reserved" tiles are not modelled: nothing in the doc reserves one yet.
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
  /** Row-major (`ty * tiles + tx`): true where the ground is too rough to build on. */
  readonly rough: readonly boolean[];
}

/** Is (tx, ty) inside the landing zone kept clear at the grid's centre? */
function inLandingZone(tx: number, ty: number, tiles: number, t: Tuning): boolean {
  const half = tiles / 2;
  const r = t.TERRAIN_CLEAR_TILES;
  return tx >= half - r && tx < half + r && ty >= half - r && ty < half + r;
}

/** The ground of a settlement at (lat, lon). */
export function groundOf(place: { readonly kind: SettlementKind; readonly lat: number; readonly lon: number }, t: Tuning): Ground {
  const tiles = gridTiles(place.kind, t);
  const rough: boolean[] = new Array<boolean>(tiles * tiles).fill(false);
  const fraction = Math.min(1, Math.max(0, t.TERRAIN_ROUGH_FRACTION));
  if (fraction === 0) return { tiles, rough };

  const seed = placeSeed(place.lat, place.lon);
  const scale = Math.max(1, t.TERRAIN_FEATURE_TILES);
  const candidates: { index: number; height: number }[] = [];
  for (let ty = 0; ty < tiles; ty += 1) {
    for (let tx = 0; tx < tiles; tx += 1) {
      if (inLandingZone(tx, ty, tiles, t)) continue;
      // Two octaves: outcrops with ragged edges rather than smooth blobs.
      const height = valueNoise(seed, tx, ty, scale) + 0.5 * valueNoise(seed ^ 0x9e37, tx, ty, scale / 2);
      candidates.push({ index: ty * tiles + tx, height });
    }
  }
  // The roughest tiles, exactly as many as the dial asks for. Ties break by
  // index so the order never depends on the sort's stability.
  candidates.sort((p, q) => q.height - p.height || p.index - q.index);
  const count = Math.round(fraction * candidates.length);
  for (let i = 0; i < count; i += 1) rough[candidates[i]!.index] = true;
  return { tiles, rough };
}

export function isRough(ground: Ground, tx: number, ty: number): boolean {
  return ground.rough[ty * ground.tiles + tx] === true;
}
