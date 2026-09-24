/**
 * Credits, and what they buy. Design doc §11's `economy` placeholder, filled.
 *
 * WHERE THE MONEY COMES FROM, AND WHY IT MATTERS. Income is proportional to
 * `supportIndex` from the §12.3 habitat contract - the one number that says
 * how much of the planet can hold people. So the loop is:
 *
 *     terraform -> the planet supports more people -> more income
 *              -> more facilities -> terraform faster
 *
 * That is §4's feedback structure expressed economically, and it means the
 * macro -> micro bridge is LOAD-BEARING rather than decorative. A city layer
 * dropped in later replaces the stand-in population model here and the loop
 * keeps its shape, because both read the same contract.
 *
 * It also makes the early game genuinely slow and the late game genuinely
 * fast, which is the S-curve §0 asks for arriving from a second direction.
 *
 * OFF BY DEFAULT. Same reasoning as Batch 8's weather, and more so: costs
 * change what a player can build and when, so switching them on silently would
 * invalidate the Batch 3 balance, the golden frames and the reference
 * trajectory every other test is written against. The build plan says the
 * economy comes last precisely "because everything above must be balanced
 * without an economy first" - so it layers on top rather than replacing it.
 */

import type { EconomyState, Facility, FacilityType, SimState } from "./types.js";
import type { Tuning } from "./tuning.js";
import { FACILITY_DEFS } from "./facilities/registry.js";
import { liveUnits } from "./facilities/index.js";
import type { HabitatChannels } from "./habitat.js";

export const EMPTY_ECONOMY: EconomyState = Object.freeze({ credits: 0, earned: 0, spent: 0 });

/** Starting funds, so the first mirror is reachable without waiting. */
export function startingEconomy(t: Tuning): EconomyState {
  return { credits: t.ECON_STARTING_CREDITS, earned: t.ECON_STARTING_CREDITS, spent: 0 };
}

/** Credits per sim-year at this level of habitability. */
export function incomeRate(habitat: HabitatChannels, t: Tuning): number {
  if (!t.ECONOMY_ENABLED) return 0;
  return t.ECON_INCOME_PER_SUPPORT * habitat.supportIndex;
}

/** What a unit at `level` costs, before its position in the order book. */
function levelMultiplier(level: number, t: Tuning): number {
  return Math.pow(t.ECON_LEVEL_COST, Math.max(0, level - 1));
}

/**
 * What it costs to go from `fromCount` units at `fromLevel` to `toCount` at
 * `toLevel`.
 *
 * TWO charges, not one, and missing the second was an exploit that made the
 * whole economy optional: buy five mirrors at level 1 for 1353 credits, then
 * upgrade all five to level 5 for ZERO, because the cost loop ran over the
 * COUNT and returned early when the count had not changed. The level
 * multiplier was being applied to nothing. Optimal play became "buy one unit,
 * then max its level for free".
 *
 *  - NEW units are charged in full, at the target level.
 *  - UNITS ALREADY OWNED are charged the DIFFERENCE between what they cost at
 *    their old level and what they cost at the new one. Upgrading is dearer
 *    than doing nothing and cheaper than rebuying, which is what an upgrade
 *    should be.
 *
 * Prices escalate with position in the order book, not flat: a flat price
 * means the right play is always "buy the maximum of whatever is cheapest per
 * unit of effect", which is not a decision.
 *
 * Downgrades are free and refund nothing, like every other reduction here -
 * mirrors already under construction are not resaleable.
 */
export function orderCost(
  type: FacilityType,
  fromCount: number,
  toCount: number,
  toLevel: number,
  t: Tuning,
  fromLevel = toLevel,
): number {
  if (!t.ECONOMY_ENABLED) return 0;

  const def = FACILITY_DEFS[type];
  const base = def.baseCost(t);
  const target = levelMultiplier(toLevel, t);
  const current = levelMultiplier(fromLevel, t);
  const upgrade = Math.max(0, target - current);

  let total = 0;
  // The units already owned, upgraded in place.
  if (upgrade > 0) {
    for (let unit = 0; unit < Math.min(fromCount, toCount); unit += 1) {
      total += base * Math.pow(t.ECON_COST_GROWTH, unit) * upgrade;
    }
  }
  // The units being added, at the target level.
  for (let unit = fromCount; unit < toCount; unit += 1) {
    total += base * Math.pow(t.ECON_COST_GROWTH, unit) * target;
  }
  return total;
}

/** Upkeep per sim-year for everything currently deployed. */
export function upkeepRate(facilities: readonly Facility[], t: Tuning): number {
  if (!t.ECONOMY_ENABLED) return 0;
  let total = 0;
  for (const f of facilities) {
    // Deployed, not ordered: you pay for what is running, which is also what
    // makes a half-built array cheaper than a finished one.
    total += FACILITY_DEFS[f.type].baseCost(t) * liveUnits(f, t) * t.ECON_UPKEEP_FRACTION;
  }
  return total;
}

/**
 * Accrue a substep's income, net of upkeep.
 *
 * Credits can be driven to zero by upkeep but never below: going into debt
 * would need a debt mechanic, and a negative balance that silently blocks
 * every order is a worse experience than an upkeep that simply cannot be paid.
 */
export function accrue(economy: EconomyState, habitat: HabitatChannels, state: SimState, h: number, t: Tuning): EconomyState {
  if (!t.ECONOMY_ENABLED) return economy;

  const income = incomeRate(habitat, t) * h;
  const upkeep = upkeepRate(state.facilities, t) * h;
  const net = income - upkeep;
  const credits = Math.max(0, economy.credits + net);

  return {
    credits,
    earned: economy.earned + Math.max(0, income),
    // Upkeep actually paid, which is capped by what there was to pay it with.
    spent: economy.spent + Math.min(upkeep, economy.credits + income),
  };
}

export interface Purchase {
  readonly ok: boolean;
  readonly economy: EconomyState;
  readonly cost: number;
  readonly reason: string | null;
}

/** Try to pay for an order. Never partially succeeds. */
export function purchase(economy: EconomyState, cost: number, t: Tuning): Purchase {
  if (!t.ECONOMY_ENABLED || cost <= 0) {
    return { ok: true, economy, cost: 0, reason: null };
  }
  if (economy.credits < cost) {
    return {
      ok: false,
      economy,
      cost,
      reason: `needs ${Math.ceil(cost)} credits, ${Math.floor(economy.credits)} available`,
    };
  }
  return {
    ok: true,
    economy: { ...economy, credits: economy.credits - cost, spent: economy.spent + cost },
    cost,
    reason: null,
  };
}
