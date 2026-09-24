/**
 * A recorded playthrough, for scrubbing.
 *
 * The planet changes over sim-millennia. Watching the whole arc at 1x is not a
 * review, it is a vigil - so this records the reference playthrough once and
 * hands back a track the scrubber can seek through in a few seconds.
 *
 * It RUNS the simulation rather than loading a captured file. A committed
 * recording would go stale the moment the tuning moved, and then the scrubber
 * would be showing a planet that no longer exists while looking authoritative.
 * The cost is about 160 ms for 1201 samples, paid once, lazily, on first use.
 *
 * This mirrors `runTrajectory` in the harness deliberately rather than
 * importing it: that module is a CLI and pulls in `node:fs`, which cannot be
 * bundled for a browser. Only the build schedule is shared - and a mirror is a
 * second implementation, which drifts, so `arc.test.ts` holds the two to being
 * EQUAL sample for sample rather than trusting this paragraph.
 *
 * The sampling grid is part of that agreement, not a free parameter: orders
 * are applied on it, so a coarser grid lands the reference schedule's year-2150
 * order on year 2152 and quietly produces a different playthrough.
 */

import type { SimConfig, SimState, Tuning, VisualChannels } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  advance,
  computeProgress,
  computeStep,
  derive,
  deriveVisuals,
  stormIntensity,
  worldEnv,
  marsStart,
  seedBiosphere,
  simYear,
} from "../sim/index.js";
import { REFERENCE_POLICY, applyOrdersDue } from "../harness/policy.js";
import { ARC_SAMPLE_YEARS, ARC_YEARS } from "./config.js";

export interface ArcSample {
  readonly year: number;
  readonly progress: number;
  readonly channels: VisualChannels;
}

/**
 * Record the reference playthrough.
 *
 * Synchronous and deterministic. It blocks the main thread for about 160 ms,
 * which is why the caller does it once, on demand, rather than at boot - long
 * enough to drop frames, short enough not to be worth a worker.
 */
export function recordArc(tuning: Tuning): readonly ArcSample[] {
  let state: SimState = marsStart();
  let year = 0;
  const samples: ArcSample[] = [];
  const ordersApplied = new Set<number>();

  const stepsPerSample = Math.max(1, Math.round(ARC_SAMPLE_YEARS / tuning.SUBSTEP_YEARS));
  const totalSamples = Math.max(1, Math.round(ARC_YEARS / ARC_SAMPLE_YEARS));

  const record = (): void => {
    // The same environment `advance` integrated against, weather included.
    const d = derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, tuning), tuning);
    // The dust channel reads the flows, not a net rate, so they have to be
    // recomputed here - the same reason `runTrajectory` does it.
    const flows = computeStep(state, d, tuning, tuning.SUBSTEP_YEARS, null).flows;
    samples.push({
      year,
      progress: computeProgress(state.reservoirs, d, tuning).progress,
      channels: deriveVisuals(state.reservoirs, d, flows, tuning, stormIntensity(state.seed, year, tuning)),
    });
  };

  record();

  for (let i = 0; i < totalSamples; i += 1) {
    state = applyOrdersDue(state, REFERENCE_POLICY, year, ordersApplied, tuning);
    const env = worldEnv(state, NEUTRAL_ENV, tuning);
    const cfg: SimConfig = { tuning, env: NEUTRAL_ENV, forcing: null };

    if (REFERENCE_POLICY.seedAt >= 0 && !state.seeded && year >= REFERENCE_POLICY.seedAt) {
      state = seedBiosphere(state, tuning, env).state;
    }

    state = advance(state, stepsPerSample, cfg);
    year = simYear(state, tuning);
    record();
  }

  return samples;
}
