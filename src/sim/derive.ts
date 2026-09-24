/**
 * Design doc sections 2.2, 3.1 and 3.2: everything recomputed from the
 * reservoirs each substep, and never stored as truth.
 *
 * `derive` deliberately excludes phase, progress and anything visual. Those
 * are OUTPUTS of a tick, not inputs to any rate term - which is what stops the
 * phase evaluation (done once per tick) from feeding back into the rates (done
 * once per substep) and making the whole simulation tick-granularity
 * dependent.
 */

import { clamp, clamp01, log1p, quartRoot, safeDiv, saturating } from "./math.js";
import type { Tuning } from "./tuning.js";
import type { Derived, Env, Reservoirs } from "./types.js";

/** Total surface pressure, mbar (section 2.2). */
export function totalPressure(r: Reservoirs): number {
  return Math.max(0, r.co2_atm) + Math.max(0, r.n2) + Math.max(0, r.o2) + Math.max(0, r.h2o_vap) + Math.max(0, r.ghg);
}

/**
 * The pressure the greenhouse term sees.
 *
 * Identical to `totalPressure` at the Batch 1 default of
 * N2_GREENHOUSE_WEIGHT = 1.
 */
export function greenhousePressure(r: Reservoirs, t: Tuning): number {
  return (
    Math.max(0, r.co2_atm) +
    Math.max(0, r.n2) * t.N2_GREENHOUSE_WEIGHT +
    Math.max(0, r.o2) +
    Math.max(0, r.h2o_vap) +
    Math.max(0, r.ghg)
  );
}

/** Bright-ice cover from the water ice and CO2 frost inventories (build-plan gap 1). */
export function iceFracRaw(r: Reservoirs, t: Tuning): number {
  const x = Math.max(0, r.h2o_ice) / t.ICE_M_REF + Math.max(0, r.co2_cap) / t.CO2_CAP_REF;
  return saturating(x, t.ICE_FRAC_MAX, 1);
}

/** Ocean cover from liquid water depth - the hypsometric stand-in (build-plan gap 2). */
export function oceanFracRaw(r: Reservoirs, t: Tuning): number {
  return saturating(r.h2o_liq, t.OCEAN_FRAC_MAX, t.OCEAN_M_REF);
}

/** Cloud cover from the vapour column (build-plan gap 4).
 *
 * A pure function of `h2o_vap` alone. Section 2.2 lists cloud_frac as a
 * function of vapour AND temperature, but temperature depends on albedo which
 * depends on cloud cover - so a T-dependent cloud fraction is a circular
 * definition requiring either a two-pass derive or a lagged temperature.
 * Dropping the T argument breaks the cycle at no cost to the visuals, since
 * vapour is itself strongly temperature-driven.
 */
export function cloudFrac(r: Reservoirs, t: Tuning): number {
  return saturating(r.h2o_vap, t.CLOUD_FRAC_MAX, t.CLOUD_VAP_REF);
}

/** Greened fraction of the LAND, scaled into a whole-surface fraction (build-plan gap 3). */
export function vegFracRaw(r: Reservoirs, landFrac: number, t: Tuning): number {
  const b = clamp01(r.biomass);
  if (b <= 0) return 0;
  return landFrac * Math.pow(b, t.VEG_EXP);
}

export interface SurfaceCover {
  readonly iceFrac: number;
  readonly oceanFrac: number;
  readonly vegFrac: number;
  readonly bareFrac: number;
  readonly landFrac: number;
}

/**
 * Allocate surface cover by PRIORITY, so the four fractions are disjoint by
 * construction and sum to exactly 1.
 *
 * Section 3.2 computes each fraction independently and subtracts their sum
 * from 1 for the bare fraction. Nothing constrains that sum, so a well-watered
 * icy world produces a negative bare fraction, an albedo above 1, a negative
 * radiative base and `Math.pow(negative, 0.25)` = NaN - which no
 * non-negativity assertion catches, because every comparison against NaN is
 * false, and which `JSON.stringify` then writes into the save file as `null`.
 */
export function surfaceCover(r: Reservoirs, t: Tuning): SurfaceCover {
  const iceFrac = clamp01(iceFracRaw(r, t));
  const oceanFrac = clamp(oceanFracRaw(r, t), 0, 1 - iceFrac);
  const landFrac = Math.max(0, 1 - iceFrac - oceanFrac);
  const vegFrac = clamp(vegFracRaw(r, landFrac, t), 0, landFrac);
  const bareFrac = Math.max(0, landFrac - vegFrac);
  return { iceFrac, oceanFrac, vegFrac, bareFrac, landFrac };
}

/** Cover-weighted ground reflectivity, before clouds (section 3.2). */
export function surfaceAlbedo(cover: SurfaceCover, t: Tuning): number {
  return (
    t.A_ICE * cover.iceFrac + t.A_OCEAN * cover.oceanFrac + t.A_VEG * cover.vegFrac + t.A_BARE * cover.bareFrac
  );
}

/**
 * Planetary albedo: the ground composited under the cloud deck.
 *
 * Section 3.2 omits clouds entirely even though section 9 lists cloud cover as
 * a visual channel and section 4 names the water-vapour feedback as one of the
 * three positive loops. Without this line, clouds are painted on the render
 * and do nothing to the climate - and the cloud brake is most of what stops
 * the late game overshooting.
 */
export function planetaryAlbedo(cover: SurfaceCover, cloud: number, env: Env, t: Tuning): number {
  const ground = surfaceAlbedo(cover, t);
  const composited = (1 - cloud) * ground + cloud * t.A_CLOUD;
  return clamp(composited + env.albedoDelta, t.ALBEDO_MIN, t.ALBEDO_MAX);
}

/** Airless radiative equilibrium temperature, K (section 3.1). */
export function equilibriumTemp(sEff: number, albedo: number, t: Tuning): number {
  const absorbed = Math.max(1 - albedo, t.ALBEDO_ABSORB_MIN);
  return quartRoot((Math.max(sEff, t.S_EFF_MIN) * absorbed) / (4 * t.SIGMA));
}

/**
 * Greenhouse warming, K (section 3.1).
 *
 * The engineered-GHG term is additive in its own logarithm rather than
 * section 3.1's multiplier on the whole expression - see the C_GHG note in
 * tuning.ts. This also removes the last `ghg / P` division from the model,
 * and with it the `max(P, EPS)` patch section 6 needs only because the
 * original formula divides by a quantity that can be zero.
 */
export function greenhouseDelta(pGreenhouse: number, ghg: number, t: Tuning): number {
  const base = t.C_GH * log1p(pGreenhouse / t.P_REF);
  const engineered = t.C_GHG * log1p(Math.max(0, ghg) / t.GHG_REF);
  return base + engineered;
}

/** Fraction of the atmosphere that is engineered greenhouse gas. Display only. */
export function ghgFraction(r: Reservoirs, P: number, t: Tuning): number {
  return clamp01(safeDiv(Math.max(0, r.ghg), P, 0, t.P_EPS));
}

/**
 * The whole derived bundle, in one pass, in dependency order.
 */
export function derive(r: Reservoirs, env: Env, t: Tuning): Derived {
  const P = totalPressure(r);
  const pGreenhouse = greenhousePressure(r, t);
  const cover = surfaceCover(r, t);
  const cloud = clamp01(cloudFrac(r, t));
  const albedo = planetaryAlbedo(cover, cloud, env, t);
  const sEff = Math.max(t.S_MARS * env.sMultiplier, t.S_EFF_MIN);
  const tEq = equilibriumTemp(sEff, albedo, t);
  const dTgh = greenhouseDelta(pGreenhouse, r.ghg, t);
  const T = clamp(tEq + dTgh, t.T_FLOOR_K, t.T_CEIL_K);

  return {
    P,
    pGreenhouse,
    iceFrac: cover.iceFrac,
    oceanFrac: cover.oceanFrac,
    vegFrac: cover.vegFrac,
    bareFrac: cover.bareFrac,
    landFrac: cover.landFrac,
    cloudFrac: cloud,
    surfaceAlbedo: surfaceAlbedo(cover, t),
    albedo,
    sEff,
    tEq,
    dTgh,
    T,
  };
}
