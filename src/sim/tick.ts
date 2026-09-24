/**
 * The public entry point: `(state, dt) -> state`.
 *
 * Design doc section 6, in the documented order, with the two corrections
 * noted in integrate.ts. Derived values are recomputed AFTER integration, so
 * the phase and the progress bar describe the world the player is now looking
 * at rather than the one from the start of the tick.
 */

import { invariant } from "./dev.js";
import { derive } from "./derive.js";
import { advance, simYear, worldEnv } from "./integrate.js";
import type { SimConfig } from "./integrate.js";
import { evaluatePhase, latchPhase } from "./phase.js";
import { unlockedFor } from "./tech.js";
import { computeProgress } from "./progress.js";
import { computeRates, computeStep } from "./rates/index.js";
import { DEFAULT_TUNING } from "./tuning.js";
import type { Tuning } from "./tuning.js";
import type { MutableReservoirs, Rates, SimState, TickResult } from "./types.js";
import { NEUTRAL_ENV, RESERVOIR_KEYS } from "./types.js";

export function defaultConfig(tuning: Tuning = DEFAULT_TUNING): SimConfig {
  return { tuning, env: NEUTRAL_ENV, forcing: null };
}

function zeroRates(): Rates {
  const out = {} as MutableReservoirs;
  for (const key of RESERVOIR_KEYS) out[key] = 0;
  return out;
}

function meanRates(before: SimState, after: SimState, dt: number): Rates {
  if (!(dt > 0)) return zeroRates();
  const out = {} as MutableReservoirs;
  for (const key of RESERVOIR_KEYS) {
    out[key] = (after.reservoirs[key] - before.reservoirs[key]) / dt;
  }
  return out;
}

/**
 * Advance the world by `dt` sim-years.
 *
 * `dt` is quantised to whole substeps. A `dt` below half a substep runs zero
 * steps and returns the state unchanged with `stepsRun: 0` - reported rather
 * than silently swallowed, because a caller that keeps passing 0.01 would
 * otherwise see a frozen planet and no explanation. The browser loop uses a
 * fixed-step accumulator and calls `advance` directly for exactly this reason.
 */
export function tick(state: SimState, dt: number, cfg: SimConfig = defaultConfig()): TickResult {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new RangeError(`tick: dt must be a non-negative finite number, got ${dt}`);
  }

  const t = cfg.tuning;
  const requested = Math.round(dt / t.SUBSTEP_YEARS);
  const stepsRun = Math.min(requested, t.MAX_SUBSTEPS_PER_TICK);

  const before = state;
  const beforeDerived = derive(
    before.reservoirs,
    worldEnv(before, cfg.env, t),
    t,
  );
  const advanced = advance(before, stepsRun, cfg);
  const elapsed = stepsRun * t.SUBSTEP_YEARS;

  // The ledger identities are asserted inside advance(), which is the only
  // path every driver shares - see the note there.

  // Phase 1's condition is "the player has built something", which it reads
  // off the environment - so this has to be the facility-inclusive env, not
  // the bare external one.
  /**
   * The env INCLUDING the weather, which is what `advance` integrated against.
   *
   * This read `cfg.env` and so left §12.2's events out, meaning `tick` reported
   * a temperature, phase and flow set from a calm planet while the simulation
   * inside it had just run through a dust storm - several kelvin apart at the
   * peak. Two paths, one world, two answers.
   */
  const env = worldEnv(advanced, cfg.env, t);
  const d = derive(advanced.reservoirs, env, t);
  for (const key of RESERVOIR_KEYS) {
    const value = advanced.reservoirs[key];
    invariant(Number.isFinite(value), () => `reservoir ${key} is not finite after tick: ${value}`);
  }
  invariant(Number.isFinite(d.T), () => `temperature is not finite after tick: ${d.T}`);

  const phase = evaluatePhase(advanced.reservoirs, d, env, t);
  const phaseReached = latchPhase(advanced.phaseReached, phase);
  const progress = computeProgress(advanced.reservoirs, d, t);

  // The final substep's flows, recomputed against the settled state: the rate
  // attribution Batch 5's dust-storm channel and the inspector read.
  const flows = computeStep(advanced, d, t, t.SUBSTEP_YEARS, cfg.forcing).flows;

  /**
   * Tech unlocks follow the LATCHED phase, so they never reverse.
   *
   * A dust storm dropping the temperature must not confiscate a technology,
   * which is exactly what gating on the instantaneous `phase` would do.
   */
  const techUnlocked = unlockedFor(phaseReached, advanced.techUnlocked);
  const next: SimState = { ...advanced, phaseReached, techUnlocked };

  return {
    state: next,
    derived: d,
    flows,
    rates: meanRates(before, next, elapsed),
    dTdt: elapsed > 0 ? (d.T - beforeDerived.T) / elapsed : 0,
    phase,
    phaseReached,
    progress: progress.progress,
    progressRaw: progress.progressRaw,
    axes: progress.axes,
    stepsRun,
  };
}

/**
 * Section 8.2's offline catch-up.
 *
 * Elapsed time is clamped to a work cap and then run in bounded chunks, so a
 * long absence cannot block the load screen. `onChunk` lets a caller drive a
 * progress indicator or collect the "while you were away" summary.
 *
 * Note this is the WORK cap only - it bounds how long the load screen takes.
 * The DESIGN cap, which bounds how much of the GAME an absence is worth, lives
 * in `offline.ts`: at the live rate a 48-hour absence is worth 5184 sim-years
 * against a 1710 sim-year playthrough, so without one a weekend away finishes
 * the game three times over.
 */
export function catchUp(
  state: SimState,
  elapsedSimYears: number,
  cfg: SimConfig = defaultConfig(),
  onChunk?: (state: SimState, done: number, total: number) => void,
): SimState {
  if (!Number.isFinite(elapsedSimYears) || elapsedSimYears < 0) {
    throw new RangeError(`catchUp: elapsed must be a non-negative finite number, got ${elapsedSimYears}`);
  }

  const t = cfg.tuning;
  const capped = Math.min(elapsedSimYears, t.CATCHUP_MAX_SIM_YEARS);
  const totalSteps = Math.round(capped / t.SUBSTEP_YEARS);

  let current = state;
  let done = 0;
  while (done < totalSteps) {
    const chunk = Math.min(t.MAX_SUBSTEPS_PER_TICK, totalSteps - done);
    current = advance(current, chunk, cfg);
    done += chunk;
    onChunk?.(current, done, totalSteps);
  }
  return current;
}

export { advance, computeRates, derive, simYear };
