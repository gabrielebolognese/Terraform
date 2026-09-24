/**
 * Design doc section 7 - the visible milestones.
 *
 * Phases are derived from thresholds, never scripted. They gate tech and UI;
 * the visuals move continuously underneath them (section 9).
 *
 * THREE DEPARTURES FROM THE SECTION 7 TABLE:
 *
 * 1. Phase 1's condition is "T > 200 K and rising". At the Mars start T is
 *    already 213 K, so the planet would enter Phase 1 - "Mirrors/GHG online" -
 *    before the player has built anything. The condition that matches the
 *    caption is that the player HAS built something.
 *
 * 2. Phase 6 is "T, P, o2, ocean_frac, biomass all in target band", which
 *    omits the CO2 toxicity ceiling from the section 2.3 table it points at.
 *    A world can hit every one of those five while holding 200 mbar of CO2,
 *    which is not a living world anyone can breathe on. All six rows are
 *    checked.
 *
 * 3. Phase 5's entry condition is "o2 > 50 mbar AND N2 import active". The
 *    buffer half is read as "the buffer EXISTS" rather than "a facility is
 *    switched on", because the phase is named "Oxygenation and buffer", an
 *    inert buffer is what section 3.6 says the phase is about, and a player
 *    who imported nitrogen and then switched the importer off has not
 *    un-buffered their atmosphere.
 *
 *    Keeping it a state-only condition also keeps the phase evaluation out of
 *    the facility graph, which matters: phase is evaluated per TICK while
 *    rates run per SUBSTEP, so coupling them would make tick granularity
 *    path-dependent and collapse every determinism guarantee in the engine.
 */

import { TARGETS } from "./targets.js";
import type { Tuning } from "./tuning.js";
import type { Derived, Env, Phase, Reservoirs } from "./types.js";
import { Phase as P } from "./types.js";

export interface PhaseInfo {
  readonly name: string;
  /** What the player is looking at, from the section 7 table. */
  readonly caption: string;
}

export const PHASE_INFO: Readonly<Record<Phase, PhaseInfo>> = Object.freeze({
  [P.Barren]: {
    name: "Barren",
    caption: "Butterscotch dusty sky, bright CO2 frost caps, red-ochre dead surface, no water.",
  },
  [P.Warming]: {
    name: "Warming",
    caption: "Mirrors and greenhouse factories online. The caps begin to shrink at the edges.",
  },
  [P.RunawayThickening]: {
    name: "Runaway thickening",
    caption: "The caps retreat fast, dust storms rise, the sky deepens as pressure climbs.",
  },
  [P.FirstWater]: {
    name: "First water",
    caption: "Liquid pools appear in the low basins. First thin lakes, first clouds above them.",
  },
  [P.Ecopoiesis]: {
    name: "Ecopoiesis",
    caption: "A green-brown tint spreads from the water's edge. Oxygen begins its slow climb.",
  },
  [P.Oxygenation]: {
    name: "Oxygenation and buffer",
    caption: "The sky shifts butterscotch to pale to blue. Oceans connect, green crosses the land.",
  },
  [P.LivingWorld]: {
    name: "Living world",
    caption: "Blue sky, white cloud, blue ocean, green continents. Weather. A world.",
  },
});

/** The six section 2.3 rows, by the name the shell shows them under. */
export const LIVING_WORLD_ROWS = ["temperature", "pressure", "oxygen", "carbon dioxide", "ocean", "biomass"] as const;
export type LivingWorldRow = (typeof LIVING_WORLD_ROWS)[number];

/**
 * The section 2.3 rows that are NOT yet inside their band - empty on a living
 * world.
 *
 * Exists for the shell. The progress bar measures the Earth-like TARGET column
 * of section 2.3 while Phase 6 needs only the minimum column, so the bar reads
 * about 87% on the year the player wins. A player told "87%" and "Living
 * world" at once needs to be able to see which of the two is the win, and what
 * is still missing from it.
 */
export function livingWorldShortfall(r: Reservoirs, d: Derived): readonly LivingWorldRow[] {
  const missing: LivingWorldRow[] = [];
  if (!(d.T >= TARGETS.T.min)) missing.push("temperature");
  if (!(d.P >= TARGETS.P.min)) missing.push("pressure");
  if (!(r.o2 >= TARGETS.o2.min)) missing.push("oxygen");
  if (!(r.co2_atm < TARGETS.co2_atm.toxMax)) missing.push("carbon dioxide");
  if (!(d.oceanFrac >= TARGETS.ocean.bandLo && d.oceanFrac <= TARGETS.ocean.bandHi)) missing.push("ocean");
  if (!(r.biomass >= TARGETS.biomass.min)) missing.push("biomass");
  return missing;
}

/** True when every one of the six section 2.3 rows is inside its band. */
export function inLivingWorldBand(r: Reservoirs, d: Derived): boolean {
  return livingWorldShortfall(r, d).length === 0;
}

/**
 * The instantaneous phase: the highest milestone whose condition currently
 * holds. This value can go DOWN, which is correct - an oxygen fire really does
 * un-make a biosphere. `latchPhase` is what stops the UI flickering backwards.
 */
export function evaluatePhase(r: Reservoirs, d: Derived, env: Env, t: Tuning): Phase {
  if (inLivingWorldBand(r, d)) return P.LivingWorld;
  if (r.o2 > t.PHASE5_O2 && r.n2 > t.PHASE5_N2) return P.Oxygenation;
  if (r.biomass > t.PHASE4_BIO) return P.Ecopoiesis;
  if (d.T > t.T_FREEZE && d.P > t.PHASE3_P_MIN) return P.FirstWater;
  if (d.T > t.T_SUBL_CAP) return P.RunawayThickening;
  if (env.sMultiplier > 1 || r.ghg > 0) return P.Warming;
  return P.Barren;
}

/** The persisted high-water mark. Milestones, once reached, stay reached. */
export function latchPhase(reached: Phase, now: Phase): Phase {
  return now > reached ? now : reached;
}
