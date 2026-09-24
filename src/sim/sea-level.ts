/**
 * Detail doc §4.1 - sea level, from the macro simulation's ocean.
 *
 *   sea_level_m = seaLevelCurve(ocean_frac)
 *   d(sea_level_m)/dt = seaLevelCurve'(ocean_frac) * d(ocean_frac)/dt
 *
 * `seaLevelCurve` is the planet's hypsometric curve (`hypsometry.ts`, Batch
 * 22) - the same one that gives every settlement its base elevation - so a
 * settlement is below sea level exactly when the globe draws it under water
 * (up to the globe's coastline jitter).
 *
 * DERIVED, never stored (detail §4.7: "Flood state is derived every tick").
 * The rate comes from the flows the simulation is about to integrate, not
 * from differencing two states: invariant #8's flows are the only rates the
 * engine has.
 */

import { elevationAtRank } from "./hypsometry.js";
import { surfaceCover } from "./derive.js";
import type { Tuning } from "./tuning.js";
import type { Flow, Reservoirs } from "./types.js";

export interface SeaLevel {
  /** Elevation of the waterline against the areoid, metres. */
  readonly m: number;
  /** How fast it is moving, metres per sim-year (negative while the sea falls). */
  readonly ratePerYear: number;
}

/**
 * Net flow into liquid water, metres per sim-year, from a flow list: what a
 * substep of `advance` would add to `h2o_liq` before any rationing. Every
 * flow's destination amount is `rate * conversion`, in the destination's unit.
 */
export function liquidWaterRate(flows: readonly Flow[]): number {
  let net = 0;
  for (const f of flows) {
    if (!(f.rate > 0)) continue;
    if (f.to === "h2o_liq") net += f.rate * f.conversion;
    if (f.from === "h2o_liq") net -= f.rate;
  }
  return net;
}

/** The curve's slope at `rank`: metres of elevation per unit of surface fraction. */
function curveSlope(rank: number, t: Tuning): number {
  const p = [
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
  const segments = p.length - 1;
  // The segment the ocean is in (at a kink, the one it is rising into).
  const k = Math.min(segments - 1, Math.max(0, Math.floor(rank * segments)));
  return ((p[k + 1] ?? 0) - (p[k] ?? 0)) * segments;
}

/**
 * Sea level now, and how fast it is moving given the net flow into liquid
 * water (`liquidWaterRate` of this substep's flows).
 */
export function seaLevel(r: Reservoirs, t: Tuning, liquidRatePerYear: number): SeaLevel {
  const cover = surfaceCover(r, t);
  const oceanFrac = cover.oceanFrac;
  // ocean_frac = OCEAN_FRAC_MAX * (1 - exp(-max(0, h2o_liq) / OCEAN_M_REF)), so
  // its slope in h2o_liq is OCEAN_FRAC_MAX / OCEAN_M_REF * exp(-h2o_liq / OCEAN_M_REF).
  // At exactly no water the slope is one-sided: the first water raises the
  // sea at the full initial slope, and draining an empty sea moves nothing.
  // (A first version returned 0 whenever h2o_liq was 0, so the first
  // substep of water predicted no rise at all - Batch 23, measured.)
  const drained = r.h2o_liq <= 0 && liquidRatePerYear <= 0;
  const dOceanDLiquid = drained ? 0 : (t.OCEAN_FRAC_MAX / t.OCEAN_M_REF) * Math.exp(-Math.max(0, r.h2o_liq) / t.OCEAN_M_REF);
  // Exactly 0 when drained - not -0, which zero times a falling rate gives.
  const oceanRate = drained ? 0 : dOceanDLiquid * liquidRatePerYear;
  return { m: elevationAtRank(oceanFrac, t), ratePerYear: curveSlope(oceanFrac, t) * oceanRate };
}
