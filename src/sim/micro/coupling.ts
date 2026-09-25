/**
 * Micro doc §2 - the two-way coupling, as one function the planet's step calls.
 *
 * Macro to micro (§2.1): every settlement sees the planet through
 * `HabitatChannels` and nothing else - the city-layer wall since Batch 9.
 *
 * Micro to macro (§2.2): the planetary outputs, summed over every settlement,
 * become flows in the same list as the planet's own. Each one names both
 * ends, so the carbon ledger still closes (invariant #6): the CO2 an
 * Atmosphere Processor draws goes to `c_sequestered` as carbon monoxide, and
 * the oxygen it frees is tied to that carbon leg's rationing, the way
 * photosynthesis's oxygen is.
 *
 * Behind SETTLEMENTS_ENABLED, default 0: off, settlements neither tick nor
 * touch the planet, and every calibrated gate keeps its meaning.
 */

import type { HabitatChannels } from "../habitat.js";
import { avail, smoothstep } from "../math.js";
import type { Tuning } from "../tuning.js";
import type { Derived, Flow, Reservoirs, Settlement } from "../types.js";
import { settlementStep } from "./settlement.js";

export interface MicroContribution {
  readonly settlementsNext: readonly Settlement[];
  readonly flows: readonly Flow[];
  /** Summed planetary CO2 demand before the planet's own limits, mbar/yr. For tests and the UI. */
  readonly co2Demand: number;
  /** Credits a year the settlements' research earns (at the user's request): income, with the economy on. */
  readonly research: number;
}

export function microStep(
  settlements: readonly Settlement[],
  env: HabitatChannels,
  r: Reservoirs,
  d: Derived,
  t: Tuning,
  h: number,
): MicroContribution {
  if (!t.SETTLEMENTS_ENABLED || settlements.length === 0) {
    return { settlementsNext: settlements, flows: [], co2Demand: 0, research: 0 };
  }

  const steps = settlements.map((s) => settlementStep(s, env, t, h));
  let co2Demand = 0;
  let research = 0;
  for (const step of steps) {
    co2Demand += step.planetaryCo2;
    research += step.research;
  }

  const flows: Flow[] = [];
  if (co2Demand > 0) {
    // The scrubber's guards, for the same reason: removing gas must never pull
    // the planet under the triple point, and must ease off as CO2 runs out.
    const headroom = smoothstep(t.P_FLOOR, t.P_FLOOR + t.P_FLOOR_W, d.P);
    const wanted = co2Demand * headroom * avail(r.co2_atm, t.FACILITY_DEPLETE_SCALE);
    // However many processors are built, one substep takes at most this share
    // of the air's CO2. Self-limited, so the flux tripwire exempts it.
    const rate = Math.min(wanted, (t.PROCESSOR_MAX_DRAW_FRAC * Math.max(0, r.co2_atm)) / h);
    if (rate > 0) {
      flows.push({ id: "micro.moxie_carbon", from: "co2_atm", to: "c_sequestered", rate, conversion: 1 });
      flows.push({
        id: "micro.moxie_o2",
        from: null,
        to: "o2",
        rate: rate * t.MOXIE_O2_PER_CO2,
        conversion: 1,
        scaleWith: "co2_atm",
      });
    }
  }

  return { settlementsNext: steps.map((s) => s.next), flows, co2Demand, research };
}
