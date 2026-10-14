/**
 * The planet's elevation field - ONE definition, shared by the simulation and
 * the renderer (Batch 22, detail doc conflict 1).
 *
 * Before Batch 22 this lived only in the renderer, which decides where the
 * globe draws its oceans: water wherever a point's elevation RANK - the share
 * of the planet's surface lower than it - is below the ocean fraction. A
 * settlement's `base_elev_m` must come from the same field, or a city the
 * globe draws under water could be dry in the simulation. So the field moved
 * here, where both can import it: it is pure geometry of the planet, not
 * simulation state, and it reads nothing.
 *
 * The rank is uniform over the sphere by construction (it is the field's own
 * cumulative distribution, measured by area), which is what lets a single
 * hypsometric curve turn it into metres (`src/sim/hypsometry.ts`).
 */

import { fbm } from "./noise.js";
import { lookupCdf, sphereCdf } from "./sphere-cdf.js";

/** Spatial frequency of the continents. The globe's look was tuned at this value in Batch 6. */
export const PLANET_ELEVATION_FREQ = 2.6;

/** How finely the elevation's distribution is measured: the globe's own table (Batch 15). */
export const ELEVATION_CDF_SAMPLES = 60000;
export const ELEVATION_CDF_BINS = 1024;

/** Raw elevation at a point on the unit sphere in planet space (y is the pole), 0..1. */
export function elevationField(x: number, y: number, z: number): number {
  return fbm(x * PLANET_ELEVATION_FREQ, y * PLANET_ELEVATION_FREQ, z * PLANET_ELEVATION_FREQ, 4);
}

let cdf: Float32Array | null = null;

/**
 * The elevation field's distribution over the sphere, by area. Built once:
 * it is a pure function of the field, so caching it changes nothing but cost.
 * The globe uploads this exact table to the GPU.
 */
export function elevationCdf(): Float32Array {
  if (cdf === null) cdf = sphereCdf(elevationField, ELEVATION_CDF_SAMPLES, ELEVATION_CDF_BINS);
  return cdf;
}

/**
 * A world's terrain orientation (Batch 27): a rotation, row-major, applied to
 * a planet-space point before the elevation field reads it. Turning the field
 * moves the continents without changing its distribution over the sphere, so
 * `elevationCdf` - and with it the hypsometric curve and the ocean fractions -
 * holds for every orientation.
 */
export type TerrainRotation = readonly [number, number, number, number, number, number, number, number, number];

export const TERRAIN_IDENTITY: TerrainRotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Three numbers in [0, 1) from a seed: a small integer hash (no `Math.random` - this is shared with the sim). */
function hash3(seed: number): [number, number, number] {
  let s = (Math.trunc(seed) ^ 0x2545f491) >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  return [next(), next(), next()];
}

/**
 * The orientation for a terrain seed: 0 is the original planet; any other
 * seed a rotation drawn uniformly over all orientations (Shoemake's uniform
 * quaternion), so no seed favours the poles.
 */
let lastRotation: { seed: number; r: TerrainRotation } | null = null;

export function terrainRotation(seed: number): TerrainRotation {
  if (seed === 0) return TERRAIN_IDENTITY;
  // Asked for on every substep of every settlement's flood reading: keep the last one.
  if (lastRotation !== null && lastRotation.seed === seed) return lastRotation.r;
  const r = turned(seed);
  lastRotation = { seed, r };
  return r;
}

function turned(seed: number): TerrainRotation {
  const [u1, u2, u3] = hash3(seed);
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const x = a * Math.sin(2 * Math.PI * u2);
  const y = a * Math.cos(2 * Math.PI * u2);
  const z = b * Math.sin(2 * Math.PI * u3);
  const w = b * Math.cos(2 * Math.PI * u3);
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/** The raw elevation at a planet-space point of a world turned by `r`. */
export function elevationTurned(x: number, y: number, z: number, r: TerrainRotation): number {
  if (r === TERRAIN_IDENTITY) return elevationField(x, y, z);
  return elevationField(r[0] * x + r[1] * y + r[2] * z, r[3] * x + r[4] * y + r[5] * z, r[6] * x + r[7] * y + r[8] * z);
}

/** Planet-space direction of (lat, lon): the same formula as micro §1.1 and the renderer. */
function direction(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
}

/**
 * The share of the planet's surface lower than (lat, lon), 0..1. The globe
 * draws a point as sea when this is below the ocean fraction (before its
 * coastline jitter, `COAST_DETAIL`).
 */
export function elevationRank(lat: number, lon: number, terrainSeed = 0): number {
  const [x, y, z] = direction(lat, lon);
  return lookupCdf(elevationCdf(), elevationTurned(x, y, z, terrainRotation(terrainSeed)));
}
