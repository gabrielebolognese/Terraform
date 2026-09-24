/**
 * One-shot state edits that are not rates.
 *
 * Section 5's design rule is that a lever moves a RATE, so the planet still
 * changes over time. Ecopoiesis is the documented exception: seeding is a
 * discrete event that sets biomass to a small positive value, because section
 * 3.5's logistic growth cannot start from zero.
 */

import { derive } from "./derive.js";
import { suitability } from "./rates/biomass.js";
import { orderCost, purchase } from "./economy.js";
import { techGate } from "./tech.js";
import { DEFAULT_TUNING } from "./tuning.js";
import type { Tuning } from "./tuning.js";
import type { Env, Facility, FacilityType, SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

export interface SeedOutcome {
  readonly state: SimState;
  readonly seeded: boolean;
  /** Why the attempt failed, when it did. */
  readonly reason: string | null;
}

/**
 * Attempt ecopoiesis.
 *
 * Section 5: "cannot run below the temp/water gates". Seeding a frozen,
 * airless world should fail visibly rather than quietly plant a biomass value
 * that dies off over the next few ticks with no explanation.
 */
export function seedBiosphere(state: SimState, t: Tuning, env: Env = NEUTRAL_ENV): SeedOutcome {
  if (state.seeded) {
    return { state, seeded: true, reason: null };
  }

  /**
   * The tech gate applies HERE too.
   *
   * `TECH` lists `ecopoiesis` as unlocking `biosphere_seeding` and `techGate`
   * duly reported `allowed: false` - but seeding has its own entry point, and
   * this function never asked. The tree advertised a gate it did not enforce,
   * and a world at phase 0 could seed a biosphere.
   *
   * The registry test that "every facility sits behind exactly one tech"
   * passed throughout, because it checks the TREE's completeness and not the
   * GATE's enforcement. Same shape as an assertion that only lives in `tick`.
   */
  const gate = techGate(state, "biosphere_seeding", t);
  if (!gate.allowed) {
    return { state, seeded: false, reason: gate.reason ?? "not unlocked yet" };
  }

  const d = derive(state.reservoirs, env, t);
  const s = suitability(state.reservoirs, d, t);

  if (s.gWater <= 0) {
    return { state, seeded: false, reason: "no liquid water: seeding needs surface water to spread from" };
  }
  if (s.gTemp <= 0) {
    return {
      state,
      seeded: false,
      reason: `too cold or too hot: ${d.T.toFixed(1)} K is outside the ${t.T_LIFE_LO}-${t.T_LIFE_HI} K band`,
    };
  }
  if (s.gPress <= 0) {
    return {
      state,
      seeded: false,
      reason: `pressure too low: ${d.P.toFixed(1)} mbar is below the ${t.P_LIFE_MIN} mbar minimum`,
    };
  }

  return {
    state: {
      ...state,
      seeded: true,
      reservoirs: { ...state.reservoirs, biomass: Math.max(state.reservoirs.biomass, t.SEED_AMOUNT) },
    },
    seeded: true,
    reason: null,
  };
}

/**
 * Move the orbital magnetic shield directly.
 *
 * Shield strength FOLLOWS the deployed `magnetic_shield` facilities: every
 * substep it moves toward what the hardware supports. So a value set here with
 * no hardware behind it decays straight back to zero, at SHIELD_BUILD_RATE.
 *
 * That makes this a save-loading and test affordance, not a lever. To actually
 * raise the shield, build the facility.
 */
export function setShieldStrength(state: SimState, strength: number): SimState {
  const clamped = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  return { ...state, shieldStrength: clamped };
}

// ---------------------------------------------------------------------------
// Facility orders (section 5)
// ---------------------------------------------------------------------------

export function facilityOf(state: SimState, type: FacilityType): Facility | undefined {
  return state.facilities.find((f) => f.type === type);
}

/**
 * Order capacity of a lever.
 *
 * This sets what has been ORDERED. What is online follows over the next
 * several sim-years - see `Facility.deployed` and section 5's design rule.
 * Counts and levels are clamped rather than rejected: a UI that lets the
 * player hold down a button should saturate, not throw.
 */
export interface OrderOutcome {
  readonly state: SimState;
  /** False when the order was refused. The state comes back untouched. */
  readonly ok: boolean;
  /** Credits actually charged. */
  readonly cost: number;
  /** Why it was refused, in the player's words. */
  readonly reason: string | null;
}

/**
 * Place or change an order, paying for it and checking the tech gate.
 *
 * `buildFacility` keeps the old signature and throws the outcome away, so
 * every call site written before Batch 9 behaves exactly as it did - which
 * matters, because the reference policy and a dozen tests drive it and the
 * economy ships off.
 *
 * REFUSALS ARE ALL-OR-NOTHING. An order that cannot be afforded is not
 * partially filled: a player who asks for six mirrors and can afford four
 * wants to know that, not to discover it by counting. The UI reads `reason`.
 */
export function orderFacility(
  state: SimState,
  type: FacilityType,
  count: number,
  level = 1,
  t: Tuning = DEFAULT_TUNING,
): OrderOutcome {
  // NaN has no meaning as a quantity, so it is refused rather than mapped to
  // anything. Batch 13: it used to clamp to the LOWER bound, which dismantled
  // every unit of a paid lever and reported ok - and a NaN level silently
  // downgraded level 2 to level 1, costing 1,898 credits to buy back.
  if (Number.isNaN(count) || Number.isNaN(level)) {
    return { state, ok: false, cost: 0, reason: "That order is not a number." };
  }
  // A level below 1 means nothing - there is no level-zero lever - and it
  // used to clamp UP to 1, silently downgrading a paid level-2 array: the same
  // harm as a NaN level (Batch 14). A negative COUNT is different and stays a
  // clamp to 0: Batch 2 made "order fewer than none" mean dismantle, on purpose.
  if (level < 1) {
    return { state, ok: false, cost: 0, reason: "A lever's level starts at 1." };
  }
  const safeCount = clampInt(count, 0, t.FACILITY_MAX_COUNT);
  const safeLevel = clampInt(level, 1, t.FACILITY_MAX_LEVEL);
  const existing = facilityOf(state, type);

  const currentCount = existing?.count ?? 0;
  const currentLevel = existing?.level ?? safeLevel;
  if (currentCount === safeCount && currentLevel === safeLevel) {
    return { state, ok: true, cost: 0, reason: null };
  }

  // Scaling DOWN is always allowed and always free. Only growth is gated -
  // a player must be able to retire a lever they can no longer afford to run.
  const growing = safeCount > currentCount || safeLevel > currentLevel;

  if (growing) {
    const gate = techGate(state, type, t);
    if (!gate.allowed) return { state, ok: false, cost: 0, reason: gate.reason };
  }

  const cost = growing ? orderCost(type, currentCount, safeCount, safeLevel, t, currentLevel) : 0;
  const paid = purchase(state.economy, cost, t);
  if (!paid.ok) return { state, ok: false, cost, reason: paid.reason };

  const facilities =
    existing === undefined
      ? safeCount === 0
        ? state.facilities
        : [...state.facilities, { type, count: safeCount, level: safeLevel, enabled: true, deployed: 0 } as Facility]
      : state.facilities.map((f) => (f.type === type ? { ...f, count: safeCount, level: safeLevel } : f));

  return { state: { ...state, facilities, economy: paid.economy }, ok: true, cost, reason: null };
}

/** The pre-Batch-9 signature, kept so existing callers are untouched. */
export function buildFacility(
  state: SimState,
  type: FacilityType,
  count: number,
  level = 1,
  t: Tuning = DEFAULT_TUNING,
): SimState {
  return orderFacility(state, type, count, level, t).state;
}

/** Switch a lever off without dismantling it. Deployment still ramps down. */
export function setFacilityEnabled(state: SimState, type: FacilityType, enabled: boolean): SimState {
  const existing = facilityOf(state, type);
  if (existing === undefined || existing.enabled === enabled) return state;
  return {
    ...state,
    facilities: state.facilities.map((f) => (f.type === type ? { ...f, enabled } : f)),
  };
}

/** Saturating, including at the infinities: +Infinity is an oversized order, not an empty one. */
function clampInt(value: number, lo: number, hi: number): number {
  if (value === Infinity) return hi;
  if (value === -Infinity) return lo;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}
