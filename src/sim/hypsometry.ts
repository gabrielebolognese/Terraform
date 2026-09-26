/**
 * Detail doc §1.1 and §4.1 - the planet's hypsometric curve: from the share
 * of the surface below a point (its rank in the shared elevation field) to
 * its elevation in metres against the areoid.
 *
 * One curve serves both ends of the flooding story: a settlement's
 * `base_elev_m` is the curve at its site's rank (Batch 22), and sea level is
 * the curve at the ocean fraction (Batch 23). Because the globe draws water
 * wherever a point's rank is below the ocean fraction, the three agree by
 * construction: a site is under the sea exactly when the globe draws it wet
 * (to within the globe's coastline jitter).
 *
 * Derived, never stored (detail §1.2): the planet's terrain does not change,
 * so neither does a settlement's base elevation.
 */

import { elevationRank } from "../shared/planet-terrain.js";
import type { Tuning } from "./tuning.js";

/** The curve's control points: HYPSO_ELEV_k is the elevation at rank k/8. */
function points(t: Tuning): readonly number[] {
  return [
    t.HYPSO_ELEV_0,
    t.HYPSO_ELEV_1,
    t.HYPSO_ELEV_2,
    t.HYPSO_ELEV_3,
    t.HYPSO_ELEV_4,
    t.HYPSO_ELEV_5,
    t.HYPSO_ELEV_6,
    t.HYPSO_ELEV_7,
    t.HYPSO_ELEV_8,
  ];
}

/** Elevation in metres of the point below which `rank` of the planet lies. Piecewise linear. */
export function elevationAtRank(rank: number, t: Tuning): number {
  const p = points(t);
  const segments = p.length - 1;
  const r = Math.min(1, Math.max(0, rank)) * segments;
  const k = Math.min(segments - 1, Math.floor(r));
  const f = r - k;
  const a = p[k] ?? 0;
  const b = p[k + 1] ?? a;
  return a + (b - a) * f;
}

/**
 * The inverse of `elevationAtRank`: the least rank at which the curve reaches
 * `m` metres (0 below the curve, 1 above it). The curve never falls, so this
 * is the share of the planet the sea must cover to stand at `m`.
 */
export function rankAtElevation(m: number, t: Tuning): number {
  const p = points(t);
  const segments = p.length - 1;
  if (!(m > (p[0] ?? 0))) return 0;
  for (let k = 0; k < segments; k += 1) {
    const a = p[k] ?? 0;
    const b = p[k + 1] ?? a;
    if (m <= b) return b > a ? (k + (m - a) / (b - a)) / segments : k / segments;
  }
  return 1;
}

/** A site's elevation in metres: detail §1.1's `base_elev_m`. */
export function siteElevation(lat: number, lon: number, t: Tuning): number {
  return elevationAtRank(elevationRank(lat, lon), t);
}
