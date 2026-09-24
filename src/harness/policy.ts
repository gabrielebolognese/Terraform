/**
 * Build orders - a scripted player, expressed as the facilities of section 5.
 *
 * Batch 1's harness used a hand-rolled forcing function because there were no
 * facilities to drive. There are now, so the reference run exercises the real
 * levers: whatever the harness measures is what a player would actually get.
 *
 * A policy is a schedule, not a controller. It never reads the state back, so
 * two runs of the same policy are identical and the balance batch can compare
 * tuning variants without the policy quietly adapting to them.
 */

import type { FacilityType, SimState, Tuning } from "../sim/index.js";
import { buildFacility, orderFacility } from "../sim/index.js";

export interface BuildOrder {
  /** Sim-year the order is placed. Capacity then comes online over the following years. */
  readonly atYear: number;
  readonly type: FacilityType;
  /** Units ordered. Zero dismantles - deployment ramps back down rather than snapping off. */
  readonly count: number;
  readonly level?: number;
}

export interface Policy {
  readonly name: string;
  readonly orders: readonly BuildOrder[];
  /** Sim-year to attempt ecopoiesis. Negative = never. */
  readonly seedAt: number;
}

export const NULL_POLICY: Policy = Object.freeze({
  name: "null policy",
  orders: [],
  seedAt: -1,
});

/**
 * A plausible playthrough, in the order the science demands (section 7): warm,
 * thicken, melt, seed, oxygenate, buffer, then hold.
 *
 * These numbers are a PLAYTHROUGH, not a balance. The balance batch owns them.
 */
const REFERENCE_ORDERS: readonly BuildOrder[] = [
  // Warm it. Mirrors reach the cap threshold; the greenhouse factory holds
  // the warming while the caps ignite.
  { atYear: 0, type: "orbital_mirror", count: 30 },
  { atYear: 0, type: "ghg_factory", count: 10 },
  // Thicken it faster than the regolith would on its own.
  { atYear: 300, type: "atmo_processor", count: 8 },
  // Stop heating once the runaway carries itself, or the endgame cooks.
  { atYear: 900, type: "ghg_factory", count: 0 },
  // Buffer it toward a breathable bar, then STOP. Nitrogen also raises total
  // pressure, which raises the greenhouse; left running it sails past 1 bar.
  //
  // Batch 12 tried to speed this up and deliberately did NOT. At 10 importers
  // the buffer lags the oxygen: from year ~1300 o2 passes O2_FIRE_FRAC (30% of
  // the air), the fire gate throttles the biosphere, and the win waits on the
  // nitrogen. 16-24 importers keep the gate open, win at 1534 instead of 1710
  // and cut the planet's worst visible stall from 31.1 to 22.2 real minutes -
  // but they fill the pressure axis BEFORE the win, so the last 6% of the bar
  // is the CO2 axis's final log-decade (10 -> 1 mbar), which no look can show:
  // golden-frame step 10->11 fell to 0.0073, under VISIBLE_STEP, at every
  // variant tried. Slowing the import after the oxygen race fixed that bar
  // and brought the stall back to 30-48 minutes. The whole search is in the
  // Batch 12 note; do not re-run it without changing the CO2 axis first.
  { atYear: 400, type: "nitrogen_import", count: 10 },
  { atYear: 2700, type: "nitrogen_import", count: 0 },
  // Stop the bleed, so the buffer does not have to be imported forever.
  { atYear: 1500, type: "magnetic_shield", count: 50, level: 5 },
  // Draw the CO2 down to something breathable - in a WINDOW, not forever.
  // Run to exhaustion it takes co2_atm to zero, and the biosphere starves:
  // the section 2.3 target of ~1 mbar sits barely above CO2_FOR_LIFE, so
  // "breathable" and "habitable" are only a fraction of an mbar apart.
  { atYear: 2000, type: "carbon_scrubber", count: 6 },
  { atYear: 2150, type: "carbon_scrubber", count: 0 },
  // Correct the overshoot the nitrogen buffer causes.
  { atYear: 2200, type: "solar_shade", count: 12 },
];

export const REFERENCE_POLICY: Policy = Object.freeze({
  name: "reference playthrough",
  orders: REFERENCE_ORDERS,
  // Seeded as soon as there is liquid water to seed into. Waiting leaves the
  // player with nothing to do between first water and ecopoiesis, which showed
  // up in the pacing score as a stall right after Phase 3.
  seedAt: 360,
});

/**
 * Apply every order due at or before `year` that has not been applied yet.
 *
 * Returns the state unchanged when nothing is due, so the caller can call it
 * every sample without allocating.
 */
export function applyOrdersDue(
  state: SimState,
  policy: Policy,
  year: number,
  applied: Set<number>,
  t: Tuning,
): SimState {
  let next = state;
  policy.orders.forEach((order, index) => {
    if (applied.has(index) || year < order.atYear) return;
    applied.add(index);
    next = buildFacility(next, order.type, order.count, order.level ?? 1, t);
  });
  return next;
}

/**
 * A player who has to pay, for Batch 9.
 *
 * `REFERENCE_POLICY` is a fixed schedule of orders by year, which is the right
 * instrument for balancing physics and the wrong one for balancing an economy:
 * it buys thirty mirrors on day one, which is exactly what costs are meant to
 * prevent. This one has a priority list and a bank balance, and it SAVES - it
 * will sit on credits rather than spend them on the cheapest thing available,
 * because a player who always buys the cheapest thing is not a player, it is a
 * leak.
 */
export interface EconomyPlan {
  readonly type: FacilityType;
  /** Stop buying at this many units. */
  readonly upTo: number;
  /** Do not start before this sim-year, whatever the bank says. */
  readonly notBefore: number;
  readonly level?: number;
}

export const ECONOMY_PLAN: readonly EconomyPlan[] = Object.freeze([
  { type: "orbital_mirror", upTo: 30, notBefore: 0 },
  { type: "ghg_factory", upTo: 10, notBefore: 0 },
  { type: "atmo_processor", upTo: 8, notBefore: 300 },
  { type: "nitrogen_import", upTo: 10, notBefore: 400 },
  { type: "magnetic_shield", upTo: 50, notBefore: 1500, level: 5 },
]);

/**
 * Spend what is affordable, in priority order, saving for the next item.
 *
 * Returns the state unchanged when nothing is affordable, which is the point:
 * the gaps where a player is waiting for money are the economy's pacing, and
 * an instrument that ignored them would measure a game nobody plays.
 */
export function spendDown(state: SimState, year: number, t: Tuning): SimState {
  let working = state;
  for (const item of ECONOMY_PLAN) {
    if (year < item.notBefore) continue;
    const have = working.facilities.find((f) => f.type === item.type)?.count ?? 0;
    if (have >= item.upTo) continue;

    // One unit at a time, so a cheap item never starves a dearer one of the
    // whole balance in a single step.
    const outcome = orderFacility(working, item.type, have + 1, item.level ?? 1, t);
    if (!outcome.ok) {
      // Refused: either unaffordable or not yet unlocked. Either way this is
      // the highest priority left, so stop rather than skipping to something
      // cheaper - that is what "saving" means.
      break;
    }
    working = outcome.state;
  }
  return working;
}
