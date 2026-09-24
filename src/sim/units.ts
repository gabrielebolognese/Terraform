/**
 * The water unit bridge, and the only file in `src/sim/` allowed to name
 * `H2O_MBAR_PER_M` (enforced by boundary.test.ts).
 *
 * THE UNIT CONTRACT: all four water fluxes are computed in metres of
 * sea-level-equivalent per year. The conversion to mbar happens exactly once,
 * on the vapour line, via a flow's `conversion` factor. Anywhere `h2o_vap` is
 * read in order to produce a flux, it converts back to metres first.
 *
 * Section 3.4 moves metres while section 2.1 stores `h2o_vap` in mbar and
 * leaves the direction of the conversion to the reader, which is how a factor
 * of 37 ends up applied once, twice, or not at all in three different terms.
 */

import type { Reservoirs } from "./types.js";
import type { Tuning } from "./tuning.js";

/** Metres of sea-level-equivalent water -> the mbar it exerts as vapour. */
export function vapourMbarFromMetres(metres: number, t: Tuning): number {
  return metres * t.H2O_MBAR_PER_M;
}

/** mbar of water vapour -> the metres of sea-level-equivalent it represents. */
export function metresFromVapourMbar(mbar: number, t: Tuning): number {
  return mbar / t.H2O_MBAR_PER_M;
}

/**
 * The `conversion` factor for a flow running metres -> mbar of vapour.
 *
 * Exported as a named factor so no rate module ever has to spell the constant
 * itself. That is enforced by boundary.test.ts, and it is the guard that would
 * have caught the doc's factor-of-371 error: section 3.4 spells the conversion
 * out in three separate terms, each free to apply it once, twice or not at all.
 */
export function metresToVapourFactor(t: Tuning): number {
  return t.H2O_MBAR_PER_M;
}

/** The `conversion` factor for a flow running mbar of vapour -> metres. */
export function vapourToMetresFactor(t: Tuning): number {
  return 1 / t.H2O_MBAR_PER_M;
}

/** Total water inventory in metres SLE, across all three phases. */
export function totalWaterMetres(r: Reservoirs, t: Tuning): number {
  return r.h2o_ice + r.h2o_liq + metresFromVapourMbar(r.h2o_vap, t);
}

/** Total carbon inventory currently held in the three CO2 reservoirs, mbar. */
export function totalCarbonMbar(r: Reservoirs): number {
  return r.co2_atm + r.co2_cap + r.co2_reg;
}

/** Total nitrogen inventory, mbar. */
export function totalNitrogenMbar(r: Reservoirs): number {
  return r.n2 + r.n2_reg;
}
