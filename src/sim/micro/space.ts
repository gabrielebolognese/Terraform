/**
 * Micro doc §1 - the three nested coordinate spaces, and the transforms
 * between them.
 *
 *   planetary  (lat, lon) on the sphere, and its 3D point      §1.1
 *   world      metres east/north on a flat plane tangent at a
 *              settlement's coordinate                          §1.2
 *   tile       integer (tx, ty) on the settlement's grid         §1.3
 *
 * Planet space matches the renderer's: y is the pole. So a point from
 * `latLonToVec` is exactly the point the globe draws at that coordinate, and a
 * marker placed with it sits on the terrain the player sees there.
 *
 * Pure geometry: no state, no DOM, no I/O.
 */

import type { Tuning } from "../tuning.js";
import type { SettlementKind } from "../types.js";

export type Vec3 = readonly [number, number, number];

/** Longitude into (-pi, pi]. Every finite longitude is a real place. */
export function wrapLongitude(lon: number): number {
  // Already in range: return it EXACTLY. The modular arithmetic below moves
  // even an in-range value by an ulp (1.2 -> 1.2000000000000002), which made a
  // freshly founded settlement differ from the coordinate it was founded at,
  // and would have nudged every saved longitude on every load.
  if (lon > -Math.PI && lon <= Math.PI) return lon;
  const twoPi = 2 * Math.PI;
  let w = ((((lon + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
  if (w === -Math.PI) w = Math.PI;
  return w;
}

/**
 * §1.1: x = R cos(lat) cos(lon), y = R sin(lat), z = R cos(lat) sin(lon).
 * `radius` defaults to 1 - the renderer's unit sphere.
 */
export function latLonToVec(lat: number, lon: number, radius = 1): Vec3 {
  const c = Math.cos(lat);
  return [radius * c * Math.cos(lon), radius * Math.sin(lat), radius * c * Math.sin(lon)];
}

/** The inverse. At a pole every longitude is the same point; this returns 0 there. */
export function vecToLatLon(v: Vec3): { lat: number; lon: number } {
  const r = Math.hypot(v[0], v[1], v[2]);
  if (!(r > 0)) return { lat: 0, lon: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, v[1] / r)));
  const horizontal = Math.hypot(v[0], v[2]);
  const lon = horizontal > 0 ? Math.atan2(v[2], v[0]) : 0;
  return { lat, lon: wrapLongitude(lon) };
}

/**
 * The local frame at a coordinate: `up` out of the ground, `east` and `north`
 * along it: `north` points toward increasing latitude, `east` toward
 * increasing longitude. (In this y-up planet space that triple is
 * left-handed - north = east x up.) At a pole "east" is undefined; the frame
 * falls back to a fixed direction so it is still orthonormal.
 */
export function tangentFrame(lat: number, lon: number): { up: Vec3; east: Vec3; north: Vec3 } {
  const up = latLonToVec(lat, lon);
  // d/dlon of the unit vector, normalised: (-sin lon, 0, cos lon).
  let east: Vec3 = [-Math.sin(lon), 0, Math.cos(lon)];
  if (Math.abs(Math.cos(lat)) < 1e-12) east = [0, 0, 1];
  // north = east x up
  const north: Vec3 = [
    east[1] * up[2] - east[2] * up[1],
    east[2] * up[0] - east[0] * up[2],
    east[0] * up[1] - east[1] * up[0],
  ];
  return { up, east, north };
}

/**
 * §1.2: a settlement's flat local plane. `x` metres east, `y` metres north of
 * the settlement's coordinate, on the plane tangent there - the curvature over
 * a city is negligible, which is the doc's own simplification. Returns a
 * point in planet space scaled so the planet has radius `radiusM`.
 */
export function worldToPlanet(lat: number, lon: number, x: number, y: number, radiusM: number): Vec3 {
  const { up, east, north } = tangentFrame(lat, lon);
  return [
    up[0] * radiusM + east[0] * x + north[0] * y,
    up[1] * radiusM + east[1] * x + north[1] * y,
    up[2] * radiusM + east[2] * x + north[2] * y,
  ];
}

/** The inverse: project a planet-space point onto the settlement's plane. */
export function planetToWorld(lat: number, lon: number, p: Vec3, radiusM: number): { x: number; y: number } {
  const { up, east, north } = tangentFrame(lat, lon);
  const d: Vec3 = [p[0] - up[0] * radiusM, p[1] - up[1] * radiusM, p[2] - up[2] * radiusM];
  return {
    x: d[0] * east[0] + d[1] * east[1] + d[2] * east[2],
    y: d[0] * north[0] + d[1] * north[1] + d[2] * north[2],
  };
}

/** §3.3: a city starts on a 32 x 32 grid, an outpost on 16 x 16. */
export function gridTiles(kind: SettlementKind, t: Tuning): number {
  return kind === "metropolis" ? t.METROPOLIS_GRID_TILES : kind === "city" ? t.CITY_GRID_TILES : t.OUTPOST_GRID_TILES;
}

/**
 * §1.3 tile -> §1.2 world: the CENTRE of tile (tx, ty), in metres. The grid is
 * centred on the settlement's coordinate, so the settlement sits in the middle
 * of its ground.
 */
export function tileToWorld(tx: number, ty: number, tiles: number, t: Tuning): { x: number; y: number } {
  return {
    x: (tx + 0.5 - tiles / 2) * t.TILE_METRES,
    y: (ty + 0.5 - tiles / 2) * t.TILE_METRES,
  };
}

/** World -> the tile that contains the point. May be off the grid; `onGrid` says. */
export function worldToTile(x: number, y: number, tiles: number, t: Tuning): { tx: number; ty: number } {
  return {
    tx: Math.floor(x / t.TILE_METRES + tiles / 2),
    ty: Math.floor(y / t.TILE_METRES + tiles / 2),
  };
}

export function onGrid(tx: number, ty: number, tiles: number): boolean {
  return Number.isInteger(tx) && Number.isInteger(ty) && tx >= 0 && ty >= 0 && tx < tiles && ty < tiles;
}

/** §1.3: a building's rectangular footprint, 1x1 to 3x3. */
export interface Footprint {
  readonly tx: number;
  readonly ty: number;
  readonly w: 1 | 2 | 3 | 5;
  readonly h: 1 | 2 | 3 | 5;
}

/** Every tile a footprint covers, row by row. */
export function footprintTiles(f: Footprint): readonly (readonly [number, number])[] {
  const out: [number, number][] = [];
  for (let dy = 0; dy < f.h; dy += 1) for (let dx = 0; dx < f.w; dx += 1) out.push([f.tx + dx, f.ty + dy]);
  return out;
}

/** Does the whole footprint lie on the grid? (Occupancy and buildability are Batch 18/20.) */
export function footprintFits(f: Footprint, tiles: number): boolean {
  return footprintTiles(f).every(([x, y]) => onGrid(x, y, tiles));
}

/**
 * A tile's key: `ty * TILE_STRIDE + tx`. Fixed, not the grid's edge, so a key
 * means the same tile whatever the grid's size is tuned to. Corridors,
 * cables and broken rocks are stored as keys.
 */
export const TILE_STRIDE = 1024;

export function tileKey(tx: number, ty: number): number {
  return ty * TILE_STRIDE + tx;
}

export function keyTile(key: number): { tx: number; ty: number } {
  return { tx: key % TILE_STRIDE, ty: Math.floor(key / TILE_STRIDE) };
}

// ---------------------------------------------------------------------------
// Claimed land (at the user's request: "after a city reaches 200 habitats, I
// can claim new terrain, then at 300 I can claim new one, etc, indefinitely;
// the more I expand, the more terrain it generates in that direction")
// ---------------------------------------------------------------------------

/**
 * Three coordinates for one tile:
 *   site   the founding square is [0, base) on both axes, for ever: the
 *          terrain, its rocks and its clusters are functions of site
 *          coordinates, so claiming land never moves the ground;
 *   chunk  land is claimed a chunk of `CLAIM_CHUNK_TILES` at a time, chunk
 *          (i, j) covering site [i * C, (i + 1) * C) - signed;
 *   local  what everything stored and every array uses: the frame's tiles,
 *          0..n on both axes. local = site - (x0, y0).
 * The frame is the smallest SQUARE holding the founding square and every
 * claimed chunk - padded on its far sides - so every grid in the game stays
 * `n x n`. Tiles of the frame outside the claims are ground to look at, not
 * to build on.
 */
export interface Frame {
  /** The founding square's edge, tiles. */
  readonly base: number;
  /** Site coordinates of local tile (0, 0). */
  readonly x0: number;
  readonly y0: number;
  /** The frame's edge, tiles. */
  readonly n: number;
}

/** What a frame is made from: a settlement, or a place with none claimed. */
export interface FrameSource {
  readonly kind: SettlementKind;
  readonly base?: number;
  readonly claims?: readonly number[];
}

/** Chunk keys hold signed chunk coordinates: this many chunks each way of the founding square. */
export const CHUNK_OFFSET = 512;

export function chunkKey(i: number, j: number): number {
  return (j + CHUNK_OFFSET) * TILE_STRIDE + (i + CHUNK_OFFSET);
}

export function keyChunk(key: number): { i: number; j: number } {
  return { i: (key % TILE_STRIDE) - CHUNK_OFFSET, j: Math.floor(key / TILE_STRIDE) - CHUNK_OFFSET };
}

/** A settlement's founding square: as it was founded, or - for a bare place - as the tuning has it. */
export function baseOf(p: FrameSource, t: Tuning): number {
  return p.base ?? gridTiles(p.kind, t);
}

export function frameOf(p: FrameSource, t: Tuning): Frame {
  const base = baseOf(p, t);
  const c = t.CLAIM_CHUNK_TILES;
  let minX = 0;
  let minY = 0;
  let maxX = base;
  let maxY = base;
  for (const key of p.claims ?? []) {
    const { i, j } = keyChunk(key);
    minX = Math.min(minX, i * c);
    minY = Math.min(minY, j * c);
    maxX = Math.max(maxX, (i + 1) * c);
    maxY = Math.max(maxY, (j + 1) * c);
  }
  return { base, x0: minX, y0: minY, n: Math.max(maxX - minX, maxY - minY) };
}

/** Whether chunk (i, j) lies wholly in the founding square - claimed from the start. */
export function isBaseChunk(i: number, j: number, base: number, t: Tuning): boolean {
  const c = t.CLAIM_CHUNK_TILES;
  return i >= 0 && j >= 0 && (i + 1) * c <= base && (j + 1) * c <= base;
}

/** A test for "is this local tile the settlement's to build on": the founding square, or a claimed chunk. */
export function claimTest(p: FrameSource, t: Tuning): (tx: number, ty: number) => boolean {
  const f = frameOf(p, t);
  const c = t.CLAIM_CHUNK_TILES;
  const claims = new Set(p.claims ?? []);
  return (tx, ty) => {
    if (!onGrid(tx, ty, f.n)) return false;
    const sx = tx + f.x0;
    const sy = ty + f.y0;
    if (sx >= 0 && sy >= 0 && sx < f.base && sy < f.base) return true;
    return claims.size > 0 && claims.has(chunkKey(Math.floor(sx / c), Math.floor(sy / c)));
  };
}
