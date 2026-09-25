/**
 * Assembles every rate term into the one list of flows a substep applies.
 *
 * Design doc section 6, step 2 and step 3. Player facilities (Batch 2) become
 * one more entry in this list and nothing else in the engine changes - which
 * is the whole point of section 5's "facilities are just extra terms in the
 * same difference equations".
 */

import { facilityFlows } from "../facilities/index.js";
import type { Tuning } from "../tuning.js";
import type { Derived, Flow, MutableReservoirs, Rates, Reservoirs, SimState } from "../types.js";
import { RESERVOIR_KEYS } from "../types.js";
import type { Suitability } from "./biomass.js";
import { biomassStep } from "./biomass.js";
import { co2Flows } from "./co2.js";
import { lossFlows } from "./loss.js";
import { nitrogenFlows } from "./nitrogen.js";
import { waterFlows } from "./water.js";
import { habitat } from "../habitat.js";
import { liquidWaterRate } from "../sea-level.js";
import { microStep } from "../micro/coupling.js";
import type { Settlement } from "../types.js";

/**
 * An external forcing: the harness's scripted policy in Batch 1, and the
 * player's facilities from Batch 2. It sees the same state every natural term
 * sees and returns flows in the same form, so nothing downstream can tell the
 * difference.
 */
export type ForcingFn = (r: Reservoirs, d: Derived, t: Tuning, h: number) => readonly Flow[];

export interface StepContribution {
  readonly flows: readonly Flow[];
  readonly biomassNext: number;
  readonly suitability: Suitability;
  /** Batch 18: every settlement one substep on. The same array, untouched, while SETTLEMENTS_ENABLED is 0. */
  readonly settlementsNext: readonly Settlement[];
  /** Credits a year the settlements' research earns; 0 with settlements off. */
  readonly research: number;
}

export function computeStep(
  state: SimState,
  d: Derived,
  t: Tuning,
  h: number,
  forcing: ForcingFn | null,
): StepContribution {
  const r = state.reservoirs;
  const bio = biomassStep(r, d, t, h, state.seeded, state.ledger.c_fixed);

  const flows: Flow[] = [
    ...co2Flows(r, d, t),
    ...waterFlows(r, d, t, h),
    ...nitrogenFlows(r, d, t),
    ...bio.flows,
    ...lossFlows(r, state.shieldStrength, t, h),
    // Section 5: "facilities are just extra terms in the same difference
    // equations". One more summand, and nothing downstream can tell a player's
    // greenhouse factory from the planet's own outgassing.
    ...facilityFlows(state, d, t),
  ];

  // Micro doc section 2: the settlements, seen through the city-layer wall and
  // summed into the same list. Skipped entirely - not even `habitat` is
  // computed - while settlements are off, so off is exactly the old world.
  // The forcing is computed here but appended after the settlements' flows,
  // exactly where it always was: moving it in the list would reorder the
  // sums `applyFluxes` makes, and the golden run would drift by ulps.
  const forced = forcing ? forcing(r, d, t, h) : [];

  let settlementsNext = state.settlements;
  let research = 0;
  if (t.SETTLEMENTS_ENABLED && state.settlements.length > 0) {
    // Batch 23: the sea level's rate, from every flow the settlements do not
    // themselves add (none of theirs touches water).
    const water = liquidWaterRate(flows) + liquidWaterRate(forced);
    const micro = microStep(state.settlements, habitat(r, d, t, water), r, d, t, h);
    flows.push(...micro.flows);
    settlementsNext = micro.settlementsNext;
    research = micro.research;
  }

  flows.push(...forced);

  return { flows, biomassNext: bio.next, suitability: bio.suitability, settlementsNext, research };
}

/**
 * A per-reservoir net-rate view of a flow list.
 *
 * For the inspector, the CSV and the feedback-loop sign tests only. The
 * integrator never reads this: integrating a net rate is exactly the design
 * that makes conservation impossible to guarantee.
 */
export function computeRates(flows: readonly Flow[]): Rates {
  const out = {} as MutableReservoirs;
  for (const key of RESERVOIR_KEYS) out[key] = 0;

  for (const flow of flows) {
    if (flow.rate <= 0) continue;
    if (flow.from !== null && isReservoirKey(flow.from)) out[flow.from] -= flow.rate;
    if (flow.to !== null && isReservoirKey(flow.to)) out[flow.to] += flow.rate * flow.conversion;
  }
  return out;
}

const RESERVOIR_KEY_SET = new Set<string>(RESERVOIR_KEYS);

export function isReservoirKey(key: string): key is (typeof RESERVOIR_KEYS)[number] {
  return RESERVOIR_KEY_SET.has(key);
}

export { biomassStep, suitability } from "./biomass.js";
export { capRelease, co2Flows, regolithRelease } from "./co2.js";
export { lossFlows } from "./loss.js";
export { nitrateRelease, nitrogenFlows } from "./nitrogen.js";
export { equilibriumVapour, pressureGate, sat, waterFlows } from "./water.js";
export type { Suitability };
