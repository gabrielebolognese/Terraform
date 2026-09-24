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

/** Planet-space direction of (lat, lon): the same formula as micro §1.1 and the renderer. */
function direction(lat: number, lon: number): [number, number, number] {
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
}

/**
 * The share of the planet's surface lower than (lat, lon), 0..1. The globe
 * draws a point as sea when this is below the ocean fraction (before its
 * coastline jitter, `COAST_DETAIL`).
 */
export function elevationRank(lat: number, lon: number): number {
  const [x, y, z] = direction(lat, lon);
  return lookupCdf(elevationCdf(), elevationField(x, y, z));
}
