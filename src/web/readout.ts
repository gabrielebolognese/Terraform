/**
 * What the browser reads off the world at readout rate: its environment, the
 * derived state, progress, and the instantaneous phase.
 *
 * Its own module, rather than inline in `main.ts`, so the one rule it has to
 * keep is testable: it must describe the SAME planet `advance` integrated.
 * `main.ts` built this from the facilities alone, with no weather, while the
 * browser runs with §12.2's events on - so during a storm the HUD's living-
 * world line counted temperature as met at 273.0 K while the simulation was
 * integrating 269.2 K, and the browser latched Phase 3 1.5 sim-years before
 * the simulation did (Batch 13).
 */

import type { Derived, Env, Phase, ProgressResult, SimState, Tuning } from "../sim/index.js";
import { NEUTRAL_ENV, computeProgress, derive, evaluatePhase, worldEnv } from "../sim/index.js";

export interface Readout {
  readonly env: Env;
  readonly derived: Derived;
  readonly progress: ProgressResult;
  /** Instantaneous, not latched. `main.ts` latches it. */
  readonly phase: Phase;
}

export function readWorld(state: SimState, tuning: Tuning): Readout {
  const env = worldEnv(state, NEUTRAL_ENV, tuning);
  const derived = derive(state.reservoirs, env, tuning);
  return {
    env,
    derived,
    progress: computeProgress(state.reservoirs, derived, tuning),
    phase: evaluatePhase(state.reservoirs, derived, env, tuning),
  };
}
