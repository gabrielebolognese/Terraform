/**
 * Design doc section 3.6 - the inert buffer.
 *
 * Section 3.6 is mostly about the player's import megaproject, which belongs
 * to Batch 2, but it also mentions "a slow trickle from regolith nitrate
 * processing" with no reservoir to draw from. This is that reservoir and that
 * trickle. At 20 mbar-eq it is flavour rather than a substitute for the
 * import: the ~790 mbar the pressure target needs still has to be shipped in.
 */

import { avail, ramp } from "../math.js";
import type { Tuning } from "../tuning.js";
import type { Derived, Flow, Reservoirs } from "../types.js";

export function nitrateRelease(d: Derived, r: Reservoirs, t: Tuning): number {
  return t.R_N2 * ramp(d.T, t.T_NITRATE, t.W_N2, t.SIG_CUT) * avail(r.n2_reg, t.CO2_DEPLETE_SCALE);
}

export function nitrogenFlows(r: Reservoirs, d: Derived, t: Tuning): readonly Flow[] {
  return [
    {
      id: "n2.nitrate_release",
      from: "n2_reg",
      to: "n2",
      rate: nitrateRelease(d, r, t),
      conversion: 1,
    },
  ];
}
