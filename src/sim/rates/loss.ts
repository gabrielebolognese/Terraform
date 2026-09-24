/**
 * Design doc section 3.7 - solar-wind stripping, and the reason the orbital
 * magnetic shield exists.
 *
 * Each gas decays by the EXACT exponential over the substep rather than the
 * linearised rate. The two agree to O(h) for small steps, but the exact form
 * cannot overshoot into a negative reservoir at any step size, which matters
 * precisely during the coarse-step offline catch-up of section 8.2.
 *
 * Engineered greenhouse gases additionally decay photolytically, which the
 * doc does not model - without it a single PFC investment warms the planet
 * forever and the section 5 factory has no ongoing cost.
 */

import { clamp01, expDecay } from "../math.js";
import { vapourToMetresFactor } from "../units.js";
import type { Tuning } from "../tuning.js";
import type { Flow, GasKey, LedgerKey, Reservoirs } from "../types.js";
import { GAS_KEYS } from "../types.js";

const LOSS_FLOW_ID = {
  co2_atm: "loss.co2_atm",
  n2: "loss.n2",
  o2: "loss.o2",
  h2o_vap: "loss.h2o_vap",
  ghg: "loss.ghg",
} as const satisfies Record<GasKey, string>;

const LOSS_LEDGER: Record<GasKey, LedgerKey> = {
  co2_atm: "c_lost",
  n2: "n2_lost",
  o2: "o2_lost",
  h2o_vap: "h2o_lost",
  ghg: "ghg_lost",
};

export function lossFlows(
  r: Reservoirs,
  shieldStrength: number,
  t: Tuning,
  h: number,
): readonly Flow[] {
  const flows: Flow[] = [];
  const step = h > 0 ? h : t.SUBSTEP_YEARS;
  const lambda = t.LOSS_LAMBDA * (1 - clamp01(shieldStrength));
  const remaining = expDecay(lambda, step);
  const fractionLost = 1 - remaining;

  if (fractionLost > 0) {
    for (const key of GAS_KEYS) {
      const amount = Math.max(0, r[key]) * fractionLost;
      if (amount <= 0) continue;
      flows.push({
        id: LOSS_FLOW_ID[key],
        from: key,
        to: LOSS_LEDGER[key],
        rate: amount / step,
        // Water leaves the planet in metres so the water ledger stays in one unit.
        conversion: key === "h2o_vap" ? vapourToMetresFactor(t) : 1,
      });
    }
  }

  // Photolysis of engineered greenhouse gases.
  const ghgDecayed = Math.max(0, r.ghg) * (1 - expDecay(t.GHG_DECAY, step));
  if (ghgDecayed > 0) {
    flows.push({
      id: "ghg.photolysis",
      from: "ghg",
      to: "ghg_lost",
      rate: ghgDecayed / step,
      conversion: 1,
    });
  }

  return flows;
}
