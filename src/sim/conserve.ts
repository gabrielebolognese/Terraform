/**
 * Conservation, stated as a LEDGER IDENTITY.
 *
 * Cross-batch invariant #6 originally read "total CO2 across the three CO2
 * reservoirs is conserved except through explicit player import or
 * sequestration". That is false on the first tick: photosynthesis and
 * atmospheric escape are both NATURAL terms that remove carbon, and escape
 * removes water too. Written that way the invariant fails immediately, and
 * the likely reaction is to weaken it - which would delete the only guard
 * against exactly the reservoir bugs it exists to catch.
 *
 * Stated as a ledger, it is exactly true and stays exactly true: mass never
 * disappears, it moves to a named account.
 */

import type { Tuning } from "./tuning.js";
import type { SimState } from "./types.js";
import { metresFromVapourMbar, totalCarbonMbar, totalWaterMetres } from "./units.js";

/**
 * Carbon in the reservoirs, plus everywhere carbon has gone, minus everywhere
 * carbon has come from. Invariant across every tick.
 */
export function carbonInvariant(state: SimState): number {
  const l = state.ledger;
  return totalCarbonMbar(state.reservoirs) + l.c_fixed + l.c_lost + l.c_sequestered - l.c_imported;
}

/** The same identity for water, in metres of sea-level-equivalent. */
export function waterInvariant(state: SimState, t: Tuning): number {
  const l = state.ledger;
  return totalWaterMetres(state.reservoirs, t) + l.h2o_lost - l.h2o_imported;
}

/** And for nitrogen. */
export function nitrogenInvariant(state: SimState): number {
  const l = state.ledger;
  return state.reservoirs.n2 + state.reservoirs.n2_reg + l.n2_lost - l.n2_imported;
}

export interface ConservationSnapshot {
  readonly carbon: number;
  readonly water: number;
  readonly nitrogen: number;
  /**
   * The GROSS size of each identity: the sum of the absolute values of its
   * terms. Rounding error scales with the terms, not with their net sum.
   */
  readonly carbonMagnitude: number;
  readonly waterMagnitude: number;
  readonly nitrogenMagnitude: number;
}

export function snapshotConservation(state: SimState, t: Tuning): ConservationSnapshot {
  const r = state.reservoirs;
  const l = state.ledger;
  const abs = Math.abs;
  return {
    carbon: carbonInvariant(state),
    water: waterInvariant(state, t),
    nitrogen: nitrogenInvariant(state),
    carbonMagnitude:
      abs(r.co2_atm) + abs(r.co2_cap) + abs(r.co2_reg) + abs(l.c_fixed) + abs(l.c_lost) + abs(l.c_sequestered) + abs(l.c_imported),
    waterMagnitude:
      abs(r.h2o_ice) + abs(r.h2o_liq) + abs(metresFromVapourMbar(r.h2o_vap, t)) + abs(l.h2o_lost) + abs(l.h2o_imported),
    nitrogenMagnitude: abs(r.n2) + abs(r.n2_reg) + abs(l.n2_lost) + abs(l.n2_imported),
  };
}

/**
 * Relative drift between two snapshots, for the per-tick assertion and the tests.
 *
 * `magnitude` is the gross size of the identity's terms. Batch 13 found the
 * scale used to be the identity's NET value alone: the nitrogen identity sits
 * at ~20 while `n2` and `n2_imported` grow without bound, so pure cancellation
 * error in an exactly double-entry ledger crossed 1e-9 after ~211,000 sim-years
 * of maxed imports - and an identity that is exactly 0 (a save with no
 * nitrogen) threw on its first substep at 3.5e-18. Both threw a
 * SimInvariantError in the shipped browser loop, which does not catch it.
 */
export function relativeDrift(before: number, after: number, magnitude = 0): number {
  const scale = Math.max(Math.abs(before), Math.abs(magnitude), 1e-12);
  return Math.abs(after - before) / scale;
}
