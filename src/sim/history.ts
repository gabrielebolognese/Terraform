/**
 * The planet's record (Batch 31): what the statistics chart over the game.
 *
 * A sample of the planet as the HUD shows it - its six axes, progress, the
 * bank and the people - every `every` substeps, taken in `advance` so a world
 * played, caught up offline or advanced in any chunks has the same record.
 *
 * Bounded by halving: once it holds PLANET_HISTORY_SAMPLES it keeps only the
 * samples on multiples of twice the gap, and samples half as often from then
 * on. So it always reaches back to where it began, a game of five days at
 * 1x fits in the same few kilobytes as an hour's, and which samples survive
 * depends only on the substep each was taken at - never on how the time was
 * split.
 *
 * A record, not the truth: nothing in the simulation reads it back
 * (invariant #3 - the reservoirs stay the only truth).
 */

import { computeProgress } from "./progress.js";
import type { Tuning } from "./tuning.js";
import type { Derived, PlanetHistory, PlanetSample, SimState } from "./types.js";

/** A record with nothing in it yet, sampling at the tuning's gap. */
export function emptyPlanetHistory(t: Tuning): PlanetHistory {
  return { every: Math.max(1, t.PLANET_HISTORY_EVERY), samples: [] };
}

/** The planet as it stands at the end of a substep, `d` derived from its reservoirs with the weather. */
export function planetSample(state: SimState, d: Derived, t: Tuning): PlanetSample {
  let people = 0;
  for (const s of state.settlements) if (s.lostAtSeaLevelM === null) people += s.population;
  return {
    steps: state.steps,
    T: d.T,
    P: d.P,
    o2: state.reservoirs.o2,
    ocean: d.oceanFrac,
    biomass: state.reservoirs.biomass,
    co2: state.reservoirs.co2_atm,
    progress: computeProgress(state.reservoirs, d, t).progress,
    credits: state.economy.credits,
    people,
  };
}

/** Whether the substep just taken is one the record samples. */
export function samplesAt(h: PlanetHistory, steps: number, t: Tuning): boolean {
  return t.PLANET_HISTORY_EVERY > 0 && h.every >= 1 && steps % h.every === 0;
}

/** The record with one more sample, halved first if that would overfill it. */
export function recordPlanet(h: PlanetHistory, sample: PlanetSample, t: Tuning): PlanetHistory {
  const samples = [...h.samples, sample];
  if (samples.length < t.PLANET_HISTORY_SAMPLES) return { every: h.every, samples };
  const every = h.every * 2;
  return { every, samples: samples.filter((x) => x.steps % every === 0) };
}
