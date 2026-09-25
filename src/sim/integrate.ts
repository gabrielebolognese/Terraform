/**
 * Design doc section 6 - the update loop.
 *
 * TWO CORRECTIONS TO THE DOCUMENTED ALGORITHM, both load-bearing:
 *
 * 1. Section 6 computes the rates ONCE and then runs SUBSTEPS integration
 *    steps of dt/N with those frozen rates. That is an arithmetic no-op:
 *    sum of rate*(dt/N) over N steps is exactly rate*dt, so the advertised
 *    stiffness defence does nothing whatsoever. Rates are recomputed every
 *    substep here, which is what the doc's own prose ("sub-step the
 *    integration") means and what actually buys stability.
 *
 * 2. Section 6 integrates and then calls `clampReservoirs` to fix up
 *    negatives. That is a mass fountain: the CO2 release term is zeroth-order
 *    in the reservoir, so an overdrawn cap mints carbon out of nothing when
 *    clamped, and the total drifts. Measured drift at a 1000-year step
 *    exceeded 300%. Here flows are mass-limited BEFORE they are applied, and
 *    the post-hoc clamp degrades to a pure assertion.
 */

import { relativeDrift, snapshotConservation } from "./conserve.js";
import { devChecksEnabled, invariant } from "./dev.js";
import { accrue } from "./economy.js";
import { eventEnv, eventFlows } from "./events.js";
import { habitat } from "./habitat.js";
import { evaluatePhase, latchPhase } from "./phase.js";
import { unlockedFor } from "./tech.js";
import { derive } from "./derive.js";
import { effectiveEnv, stepFacilities, stepShield } from "./facilities/index.js";
import type { ForcingFn } from "./rates/index.js";
import { computeStep } from "./rates/index.js";
import { flowRoutes } from "./micro/routes.js";
import { liquidWaterRate } from "./sea-level.js";
import type { Tuning } from "./tuning.js";
import type {
  AccountKey,
  Accounts,
  Env,
  Flow,
  Ledger,
  MutableLedger,
  MutableReservoirs,
  Reservoirs,
  SimState,
} from "./types.js";
import { LEDGER_KEYS, RESERVOIR_KEYS } from "./types.js";

/**
 * Flows exempt from the dev tripwire below.
 *
 * These are either the closed-form integral of a decay or relaxation (which
 * cannot overshoot at any step size, and legitimately move a large fraction of
 * their source in one substep - the vapour column closes 63% of its gap to
 * equilibrium every substep by construction) or already mass-limited inside
 * their own rate module. The tripwire exists to catch a rate constant that is
 * far too large for the step size, and these cannot be that.
 */
const SELF_LIMITED_FLOWS: ReadonlySet<string> = new Set<string>([
  "h2o.evaporate",
  "h2o.condense",
  "h2o.snow",
  "loss.co2_atm",
  // Capped at PROCESSOR_MAX_DRAW_FRAC of the air's CO2 inside its own module.
  "micro.moxie_carbon",
  "loss.n2",
  "loss.o2",
  "loss.h2o_vap",
  "loss.ghg",
  "ghg.photolysis",
  "bio.photosynthesis",
  "bio.decay_o2",
  "bio.decay_carbon",
]);

export interface SimConfig {
  readonly tuning: Tuning;
  readonly env: Env;
  readonly forcing: ForcingFn | null;
}

/** Elapsed sim-years, derived from the integer substep counter - never accumulated. */
export function simYear(state: SimState, t: Tuning): number {
  return state.steps * t.SUBSTEP_YEARS;
}

/**
 * The environment this world is in RIGHT NOW: the external forcing, plus the
 * §12.2 weather at this moment, plus what the facilities do to it.
 *
 * The one definition. `advance` integrates against it every substep, so
 * anything that reports on the world - the browser readout, `tick`, the
 * "while you were away" summary, the harness - must derive against exactly
 * this or it describes a different planet. Batch 10 found `tick` leaving the
 * weather out; Batch 13 found the browser doing the same, where it latched
 * Phase 3 1.5 sim-years early during a storm and told the player temperature
 * was met at 273.0 K while the sim was integrating 269.2 K.
 */
export function worldEnv(state: SimState, base: Env, t: Tuning): Env {
  return effectiveEnv(eventEnv(base, state.seed, simYear(state, t), t), state.facilities, t);
}

function toAccounts(r: Reservoirs, l: Ledger): Accounts {
  const acc = {} as Accounts;
  for (const key of RESERVOIR_KEYS) acc[key] = r[key];
  for (const key of LEDGER_KEYS) acc[key] = l[key];
  return acc;
}

/**
 * Apply a set of flows over `h` years with proportional rationing.
 *
 * When several flows draw on the same reservoir and together want more than it
 * holds, every one of them is scaled by the same factor. Proportional
 * rationing is what makes the result independent of the order the flows happen
 * to appear in the array - the alternative, first-come-first-served, makes the
 * simulation depend on the order rate modules are listed in an import block.
 */
export function applyFluxes(
  reservoirs: Reservoirs,
  ledger: Ledger,
  flows: readonly Flow[],
  h: number,
  t: Tuning,
): { reservoirs: Reservoirs; ledger: Ledger; scale: ReadonlyMap<AccountKey, number> } {
  const acc = toAccounts(reservoirs, ledger);

  /**
   * Pass 0: every rate is a finite, non-negative number.
   *
   * Without this a NaN rate was SILENTLY DROPPED. All three passes below
   * filter on `!(flow.rate > 0)`, and `NaN > 0` is false, so a rate module
   * that produced NaN had its flow quietly skipped - no error, no effect, and
   * a planet that simply stopped responding to one of its own physics terms.
   *
   * That is exactly the behaviour Pass 4 below refuses on the other side of
   * the same function: "a bug in a rate module must be loud rather than
   * quietly repaired". A silent skip is a quiet repair.
   *
   * Zero is legitimate and common - a facility with no units emits zero - so
   * only NaN and negatives are errors.
   */
  if (devChecksEnabled()) {
    for (const flow of flows) {
      invariant(
        Number.isFinite(flow.rate) && flow.rate >= 0,
        () => `flow ${flow.id} has rate ${flow.rate}: a rate must be a finite, non-negative number`,
      );
      invariant(
        Number.isFinite(flow.conversion),
        () => `flow ${flow.id} has conversion ${flow.conversion}`,
      );
    }
  }

  // Pass 1: total requested outflow per source, measured against the
  // START-of-substep value.
  const requested = new Map<AccountKey, number>();
  const requestedChecked = new Map<AccountKey, number>();
  for (const flow of flows) {
    if (flow.from === null || !(flow.rate > 0)) continue;
    const amount = flow.rate * h;
    requested.set(flow.from, (requested.get(flow.from) ?? 0) + amount);
    if (!SELF_LIMITED_FLOWS.has(flow.id)) {
      requestedChecked.set(flow.from, (requestedChecked.get(flow.from) ?? 0) + amount);
    }
  }

  // Pass 2: one scale factor per source.
  const scale = new Map<AccountKey, number>();
  for (const [key, total] of requested) {
    const held = acc[key];
    if (total > held) {
      scale.set(key, held > 0 ? held / total : 0);
      invariant(
        held >= -t.RESERVOIR_ZERO_EPS,
        () => `account ${key} was already negative (${held}) before rationing`,
      );
    } else {
      scale.set(key, 1);
    }

    // Dev tripwire: a rate constant far too large for the step size. This is a
    // LOUD assertion, never a silent clip - a silent clip is the mass-creation
    // bug in a second costume.
    const checked = requestedChecked.get(key) ?? 0;
    invariant(
      !(checked > t.FLUX_ASSERT_MAX_FRAC * held) || held <= t.RESERVOIR_ZERO_EPS,
      () =>
        `flux from ${key} requested ${((checked / held) * 100).toFixed(1)}% of the reservoir in one substep ` +
        `(limit ${(t.FLUX_ASSERT_MAX_FRAC * 100).toFixed(0)}%) - check tuning or reduce SUBSTEP_YEARS`,
    );
  }

  // Pass 3: apply. Both ends of a transfer move by the same rationed amount,
  // so mass cannot be created or destroyed by the limiter.
  for (const flow of flows) {
    if (!(flow.rate > 0)) continue;
    // A tied flow follows its tie's rationing AND its own source's, whichever
    // cut deeper. Following only the tie (Batch 13's decay fix) let a
    // rationed source be overdrawn: with a second consumer on `c_fixed`, the
    // decay leg ran at o2's scale 1 while `c_fixed` was at 0.4, and the
    // account went to -0.0017 (Batch 14).
    const own = flow.from === null ? 1 : (scale.get(flow.from) ?? 1);
    const tie = flow.scaleWith === undefined ? 1 : (scale.get(flow.scaleWith) ?? 1);
    const factor = Math.min(own, tie);
    const amount = flow.rate * h * factor;
    if (!(amount > 0)) continue;
    if (flow.from !== null) acc[flow.from] -= amount;
    if (flow.to !== null) acc[flow.to] += amount * flow.conversion;
  }

  // Pass 4: float hygiene only. Anything below the noise floor snaps to zero;
  // anything above it means a flux escaped the limiter, which is a bug in a
  // rate module and must be loud rather than quietly repaired.
  const nextReservoirs = {} as MutableReservoirs;
  for (const key of RESERVOIR_KEYS) {
    const value = acc[key];
    invariant(
      value >= -t.RESERVOIR_ZERO_EPS,
      () => `reservoir ${key} went to ${value}: a flux was not mass-limited`,
    );
    nextReservoirs[key] = value < 0 ? 0 : value;
  }

  const nextLedger = {} as MutableLedger;
  for (const key of LEDGER_KEYS) {
    const value = acc[key];
    nextLedger[key] = value < 0 && value > -t.RESERVOIR_ZERO_EPS ? 0 : value;
  }

  return { reservoirs: nextReservoirs, ledger: nextLedger, scale };
}

/**
 * Run exactly `steps` substeps of the one true step size.
 *
 * The step SIZE is fixed and the COUNT is derived, never the other way round.
 * That is what makes any decomposition of the same elapsed time execute the
 * identical sequence of floating-point operations, so
 * `advance(s, 4000) === advance(advance(s, 2000), 2000)` exactly, not within a
 * tolerance that would hide a regression.
 */
/**
 * Fold the seeded event flows in with whatever forcing the caller supplied.
 *
 * Returns the caller's own function untouched when events are off, so the
 * default path allocates nothing and behaves exactly as it did before this
 * batch - which is what keeps every pre-existing exactness test meaningful.
 */
function composeForcing(base: ForcingFn | null, seed: number, year: number, t: Tuning): ForcingFn | null {
  if (!t.EVENTS_ENABLED) return base;
  return (r, d, tt, h) => {
    const own = base === null ? [] : base(r, d, tt, h);
    const events = eventFlows(seed, year, tt, r, d);
    return events.length === 0 ? own : [...own, ...events];
  };
}

export function advance(state: SimState, steps: number, cfg: SimConfig): SimState {
  if (!Number.isFinite(steps) || steps < 0) {
    throw new RangeError(`advance: steps must be a non-negative finite number, got ${steps}`);
  }
  const whole = Math.floor(steps);
  if (whole === 0) return state;

  const t = cfg.tuning;
  const h = t.SUBSTEP_YEARS;

  // Cross-batch invariant #6 is checked HERE, not only in tick().
  //
  // Both production drivers - the headless harness and the browser loop - call
  // advance() directly, so an assertion that lived only in tick() never ran on
  // any path that actually drives the simulation. Batch 2's facility work
  // explicitly relies on this firing when an import is not double-entry, and
  // it is precisely the mistake a new rate module makes first.
  //
  // One snapshot pair per call, not per substep, so a 2048-step chunk pays for
  // two ledger sums rather than 4096.
  const checking = devChecksEnabled();
  const before = checking ? snapshotConservation(state, t) : null;

  let reservoirs = state.reservoirs;
  let ledger = state.ledger;
  let working: SimState = state;

  for (let i = 0; i < whole; i += 1) {
    /**
     * Sim time for THIS substep, from the integer counter.
     *
     * `steps * SUBSTEP_YEARS`, never an accumulator - which is what lets the
     * seeded events of §12.2 be a pure function of time. An accumulated clock
     * would drift by a different amount depending on how the caller split the
     * work, and the same absence would produce different weather.
     */
    const year = working.steps * h;

    // The environment is derived from the facilities EVERY substep, not passed
    // in once: a deploying mirror array changes effective solar flux while the
    // chunk is running, and reading it once would make the result depend on
    // how the caller happened to split the time. The seeded events compose
    // underneath, for exactly the same reason.
    const env = worldEnv(working, cfg.env, t);
    const d = derive(reservoirs, env, t);
    const contribution = computeStep(working, d, t, h, composeForcing(cfg.forcing, working.seed, year, t));
    const applied = applyFluxes(reservoirs, ledger, contribution.flows, h, t);

    // Growth is paid for in carbon. When `applyFluxes` rationed `co2_atm` -
    // a scrubber and the biosphere over-requesting it together - the carbon
    // leg of photosynthesis was cut and the growth it paid for was not
    // (Batch 13 open item: carbon cut 0.83%, biomass grew in full). Scale the
    // growth by the same factor, the rule `biomassStep` already applies to
    // its own carbon limit.
    const carbonScale = applied.scale.get("co2_atm") ?? 1;
    const grown = contribution.biomassNext - reservoirs.biomass;
    const biomass = carbonScale < 1 && grown > 0 ? reservoirs.biomass + grown * carbonScale : contribution.biomassNext;
    reservoirs = { ...applied.reservoirs, biomass };
    ledger = applied.ledger;

    /**
     * Income accrues per SUBSTEP, from the §12.3 habitat contract.
     *
     * Per substep rather than per call, for the same reason the environment
     * is recomputed per substep: a planet that becomes more habitable halfway
     * through a chunk should earn more for the second half, and charging it
     * once per call would make the balance depend on how the caller split the
     * time. `advance(s, 4000)` must equal a thousand `advance(s, 4)` calls
     * exactly, and the economy is part of the state that has to match.
     *
     * Computed from the state BEFORE this substep's flows, so it uses the same
     * `d` the flows did rather than a half-updated world.
     */
    const accrued = t.ECONOMY_ENABLED ? accrue(working.economy, habitat(working.reservoirs, d, t, liquidWaterRate(contribution.flows)), working, h, t) : working.economy;
    // The cities' research is income too (laboratories, observatories, forums).
    const economy = t.ECONOMY_ENABLED && contribution.research > 0 ? { ...accrued, credits: accrued.credits + contribution.research * h, earned: accrued.earned + contribution.research * h } : accrued;

    /**
     * Phase latch and tech unlock, EVERY substep, on the `d` already computed.
     *
     * Both halves of that matter.
     *
     * "Every substep", because `evaluatePhase` is instantaneous and can go
     * DOWN - a dust storm cools the planet out of a phase - while the latch is
     * a high-water mark. Evaluating once per `advance` call instead made the
     * result depend on how the caller split the time: many small calls catch a
     * transient peak that one big call steps straight over. Batch 8's exit
     * gate caught exactly that, which is the second time that gate has earned
     * its keep.
     *
     * "In `advance`", because both production drivers call it directly, so an
     * unlock living only in `tick` never runs on any path that drives the
     * game - the mistake Batch 1 found with the ledger assertion. Before this,
     * an economy player banked 189,000 credits and still could not buy an
     * atmospheric processor.
     */
    const reached = latchPhase(working.phaseReached, evaluatePhase(working.reservoirs, d, env, t));
    const techUnlocked = unlockedFor(reached, working.techUnlocked);

    working = {
      ...working,
      reservoirs,
      ledger,
      economy,
      phaseReached: reached,
      techUnlocked,
      facilities: stepFacilities(working.facilities, t, h),
      shieldStrength: stepShield(working.shieldStrength, working.facilities, t, h),
      // The railways between settlements: stores along them, after the settlements' own substep.
      settlements: t.INTERCITY_ENABLED ? flowRoutes(contribution.settlementsNext, working.routes, t, h) : contribution.settlementsNext,
      steps: working.steps + 1,
    };
  }

  if (checking) {
    /**
     * The wallet, which nothing else checks.
     *
     * The reservoirs do NOT need this: `applyFluxes` already tests every one
     * of them against `>= -RESERVOIR_ZERO_EPS` each substep, and a NaN fails
     * that comparison, so it is caught there with a better message. Biomass is
     * assigned after that check but caught on the next substep's pass.
     *
     * `economy` is not a reservoir and goes through none of it, so a NaN in
     * credits propagated silently through both drivers and into the save. This
     * check exists for that one field; an earlier version of it duplicated the
     * reservoir scan, which was redundant and said so in a comment that was
     * wrong.
     */
    invariant(
      Number.isFinite(working.economy.credits),
      () => `credits are not finite after advance: ${working.economy.credits}`,
    );
    // Biomass is assigned AFTER `applyFluxes` scans the reservoirs, so a NaN
    // made on the last substep of a call left the call before any check saw
    // it (Batch 14: R_BIO = NaN returned NaN biomass from a 1-substep call).
    invariant(
      Number.isFinite(working.reservoirs.biomass),
      () => `biomass is not finite after advance: ${working.reservoirs.biomass}`,
    );
  }

  if (before !== null) {
    const after = snapshotConservation(working, t);
    assertConserved("carbon", before.carbon, after.carbon, Math.max(before.carbonMagnitude, after.carbonMagnitude), whole * h);
    assertConserved("water", before.water, after.water, Math.max(before.waterMagnitude, after.waterMagnitude), whole * h);
    assertConserved(
      "nitrogen",
      before.nitrogen,
      after.nitrogen,
      Math.max(before.nitrogenMagnitude, after.nitrogenMagnitude),
      whole * h,
    );
  }

  return working;
}

/**
 * Relative tolerance for the ledger identities, against the GROSS size of the
 * identity's terms.
 *
 * Measured (Batch 14), worst honest drift per call: 5e-16 for the browser's
 * 1-substep calls, 6.7e-14 for 2048-substep calls on the reference run with
 * events on, 6.2e-15 over 20,000 years of maxed imports. 1e-12 is ~15x the
 * worst. It was 1e-9, which with the gross scale Batch 13 introduced let an
 * undeclared water-escape leg (4.8e-10) and nitrogen leaks up to 17,000x
 * larger than before pass the browser's small calls indefinitely.
 */
/**
 * The flows the next substep of `advance` will integrate: the same
 * environment, the same weather, the same forcing, built the same way.
 *
 * For readers that need a RATE the way the engine sees it - the sea level's
 * (Batch 23) - rather than a finite difference. Before this existed the
 * browser rebuilt the flows with no forcing, which silently dropped the
 * seeded weather's flows from every rate it showed.
 */
export function nextSubstepFlows(state: SimState, cfg: SimConfig): readonly Flow[] {
  const t = cfg.tuning;
  const year = state.steps * t.SUBSTEP_YEARS;
  const d = derive(state.reservoirs, worldEnv(state, cfg.env, t), t);
  return computeStep(state, d, t, t.SUBSTEP_YEARS, composeForcing(cfg.forcing, state.seed, year, t)).flows;
}

export const CONSERVATION_REL_TOL = 1e-12;

function assertConserved(name: string, before: number, after: number, magnitude: number, years: number): void {
  invariant(
    relativeDrift(before, after, magnitude) < CONSERVATION_REL_TOL,
    () =>
      `${name} ledger drifted ${before} -> ${after} over ${years} sim-years. ` +
      `A flow either created mass or lost it without naming an account - check that every import ` +
      `is double-entry and every sink has a ledger destination.`,
  );
}
