/**
 * Design doc section 3.3 - the runaway engine.
 *
 * CO2 moves from the frozen reservoirs into the atmosphere at a rate that
 * ramps up once temperature crosses a sublimation threshold. Because
 * `co2_atm` feeds P feeds dT_gh feeds T feeds the release, this closes the
 * loop that produces the S-curve's accelerating middle.
 */

import { avail, ramp } from "../math.js";
import type { Tuning } from "../tuning.js";
import type { Derived, Flow, Reservoirs } from "../types.js";

/**
 * Sublimation of the polar caps, mbar/yr.
 *
 * Uses the renormalised ramp rather than section 3.3's bare sigmoid. A bare
 * sigmoid is 0.5 at the threshold and never reaches zero below it, so with the
 * section 10 constants the caps release 0.30 mbar/yr - 38% of maximum - on
 * turn one, and an untouched Mars empties its caps in ~130 sim-years. The
 * player would never have to do anything.
 */
export function capRelease(d: Derived, r: Reservoirs, t: Tuning): number {
  return t.R_CAP * ramp(d.T, t.T_SUBL_CAP, t.W_CAP, t.SIG_CUT) * avail(r.co2_cap, t.CO2_DEPLETE_SCALE);
}

/** Desorption of CO2 from the regolith, mbar/yr. Higher threshold, larger reservoir. */
export function regolithRelease(d: Derived, r: Reservoirs, t: Tuning): number {
  return t.R_REG * ramp(d.T, t.T_SUBL_REG, t.W_REG, t.SIG_CUT) * avail(r.co2_reg, t.CO2_DEPLETE_SCALE);
}

export function co2Flows(r: Reservoirs, d: Derived, t: Tuning): readonly Flow[] {
  return [
    {
      id: "co2.cap_sublimation",
      from: "co2_cap",
      to: "co2_atm",
      rate: capRelease(d, r, t),
      conversion: 1,
    },
    {
      id: "co2.regolith_desorption",
      from: "co2_reg",
      to: "co2_atm",
      rate: regolithRelease(d, r, t),
      conversion: 1,
    },
  ];
}
