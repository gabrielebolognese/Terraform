/**
 * "What does the planet need next?" - Batch 7's exit gate, as code.
 *
 * The gate is that a new player can answer that question without
 * documentation. A tooltip cannot do it: the answer changes every few hundred
 * sim-years, and a wrong answer is worse than none. So it is DERIVED, and
 * `guidance.test.ts` holds it to being right across a whole playthrough.
 *
 * WHERE THE ANSWER COMES FROM. §8.1 makes progress a weighted geometric mean
 * of six normalised axes, precisely so "the player cannot ignore an axis (a
 * zero on any axis tanks the whole score)". That property is also the answer:
 * differentiate the mean and the marginal gain from lifting axis i is
 *
 *     d(ln G)/d(n_i) = (w_i / sum w) * (1 / n_i)
 *
 * so the axis worth the most attention is simply the largest `w_i / n_i`. The
 * bottleneck falls out of the design doc's own maths rather than being a
 * scripted tutorial that drifts from the balance the moment it is retuned.
 *
 * WHY IT THEN CHAINS. Naming the lowest axis is not yet advice: through most
 * of the early game the lowest axis is biomass, and "raise biomass" is useless
 * on a frozen airless rock. So the bottleneck is resolved through its
 * PREREQUISITES to the first thing the player can actually act on today -
 * biomass needs seeding, seeding needs liquid water, water needs warmth,
 * warmth needs mirrors. The player is told about the mirrors, and told why.
 *
 * This is a `src/web/` module and imports the simulation read-only, like the
 * rest of the shell. It is pure: same inputs, same advice.
 */

import type { Derived, FacilityType, ProgressAxes, Reservoirs, SimState, Tuning } from "../sim/index.js";
import { TARGETS, deployedUnitsOf, inLivingWorldBand, suitability } from "../sim/index.js";

export type AxisKey = "nT" | "nP" | "nO2" | "nWater" | "nBio" | "nCO2";

export interface Advice {
  /** The axis holding the composite back, before prerequisites are resolved. */
  readonly bottleneck: AxisKey;
  /** Plain language for the headline: "Temperature", "Liquid water". */
  readonly title: string;
  /** What is wrong, in one sentence. Always concrete, always with a number. */
  readonly problem: string;
  /** What to do about it, in one sentence. */
  readonly action: string;
  /** The lever this points at, for the UI to highlight. Null when there is nothing to build. */
  readonly lever: FacilityType | null;
  /**
   * True when the honest answer is "nothing - it is already happening".
   *
   * §0 calls for a long tail, and a shell that nags for a lever on every
   * frame of it would be lying about what the player controls.
   */
  readonly waiting: boolean;
  /** Set when the bottleneck was reached through a prerequisite rather than directly. */
  readonly because: string | null;
}

/**
 * Money, folded in after the fact.
 *
 * The guidance decides WHAT the planet needs; it has no business deciding
 * whether the player can afford it, and it predates the economy entirely. But
 * advice the player cannot act on is worse than no advice - `guidance.test.ts`
 * calls telling someone to seed when the sim will refuse them "the single
 * worst failure available to this feature", and recommending a lever there is
 * no money for is the same failure wearing a different hat. It was doing
 * exactly that: "Import nitrogen first" with 563 credits against a 900 credit
 * price.
 *
 * So the answer does not change - the planet still needs nitrogen - but the
 * ACTION becomes saving for it, and `waiting` becomes true, because waiting
 * for money is honestly what the player is doing.
 */
export interface Affordability {
  readonly cost: number;
  readonly credits: number;
}

export function withAffordability(advice: Advice, money: Affordability | null): Advice {
  if (money === null || advice.lever === null || advice.waiting) return advice;
  if (money.cost <= 0 || money.credits >= money.cost) return advice;

  return {
    ...advice,
    action:
      `${advice.action} You cannot afford it yet: ` +
      `${Math.ceil(money.cost)} credits needed, ${Math.floor(money.credits)} banked.`,
    waiting: true,
  };
}

const AXIS_TITLE: Readonly<Record<AxisKey, string>> = Object.freeze({
  nT: "Temperature",
  nP: "Atmospheric pressure",
  nO2: "Breathable oxygen",
  nWater: "Liquid water",
  nBio: "The biosphere",
  nCO2: "Carbon dioxide",
});

/**
 * The floor under an axis when ranking bottlenecks.
 *
 * Without it a zero axis gives an infinite score and the ranking stops being
 * able to distinguish "zero and unreachable" from "zero and one step away" -
 * which matters at the start, where biomass and oxygen are both exactly zero.
 */
const AXIS_FLOOR = 1e-3;

/** Weights, in the same order as the axes. Read from tuning so a retune moves both together. */
function weightOf(axis: AxisKey, t: Tuning): number {
  switch (axis) {
    case "nT":
      return t.W_T;
    case "nP":
      return t.W_P;
    case "nO2":
      return t.W_O2;
    case "nWater":
      return t.W_WATER;
    case "nBio":
      return t.W_BIO;
    case "nCO2":
      return t.W_CO2;
  }
}

const ALL_AXES: readonly AxisKey[] = ["nT", "nP", "nO2", "nWater", "nBio", "nCO2"];

/** The axis with the most marginal progress in it. §8.1's geometric mean, differentiated. */
export function bottleneckAxis(axes: ProgressAxes, t: Tuning): AxisKey {
  let best: AxisKey = "nT";
  let bestScore = -Infinity;
  for (const axis of ALL_AXES) {
    const score = weightOf(axis, t) / Math.max(axes[axis], AXIS_FLOOR);
    // Strictly greater, so ties resolve to the earlier axis and the advice
    // does not flicker between two equally-stuck axes frame to frame.
    if (score > bestScore) {
      bestScore = score;
      best = axis;
    }
  }
  return best;
}

export interface GuidanceInput {
  readonly state: SimState;
  readonly reservoirs: Reservoirs;
  readonly derived: Derived;
  readonly axes: ProgressAxes;
  readonly tuning: Tuning;
  /** K per sim-year, from the shell's trailing window. Distinguishes "cold" from "cold but warming". */
  readonly dTdt: number;
}

export function advise(input: GuidanceInput): Advice {
  const { reservoirs: r, derived: d, axes, tuning: t } = input;

  if (inLivingWorldBand(r, d)) {
    return {
      bottleneck: "nBio",
      title: "A living world",
      problem: "Every target band in section 2.3 is satisfied.",
      action: "Nothing. The planet is finished - hold it there.",
      lever: null,
      waiting: true,
      because: null,
    };
  }

  const bottleneck = bottleneckAxis(axes, t);
  return resolve(bottleneck, bottleneck, input, new Set());
}

/**
 * Walk from the limiting axis to the first thing the player can do today.
 *
 * `seen` breaks cycles: water needs warmth, and in an overshoot warmth can
 * point back at water. Without it a hot flooded planet hangs the shell.
 */
function resolve(axis: AxisKey, origin: AxisKey, input: GuidanceInput, seen: Set<AxisKey>): Advice {
  if (seen.has(axis)) return terminal(axis, origin);
  seen.add(axis);

  const { state, reservoirs: r, derived: d, tuning: t, dTdt } = input;
  const deployed = (type: FacilityType): number => deployedUnitsOf(state.facilities, type, t);
  const because = axis === origin ? null : chainReason(origin, axis);

  switch (axis) {
    case "nT": {
      if (d.T > TARGETS.T.target + 5) {
        return {
          bottleneck: origin,
          title: AXIS_TITLE.nT,
          problem: `${d.T.toFixed(0)} K is above the ${TARGETS.T.target} K target - the planet is running hot.`,
          action:
            deployed("solar_shade") > 0
              ? "Solar shades are deployed and cooling. Give them time, or order more."
              : "Order solar shades to cut the incoming flux back.",
          lever: "solar_shade",
          waiting: false,
          because,
        };
      }
      // Warming on its own is the normal case for most of the run, and
      // nagging through it would make the advice noise.
      if (dTdt > 0.002 && deployed("orbital_mirror") + deployed("ghg_factory") > 0) {
        return {
          bottleneck: origin,
          title: AXIS_TITLE.nT,
          problem: `${d.T.toFixed(0)} K, warming at ${(dTdt * 100).toFixed(2)} K per century.`,
          action: "Warming is under way. More mirrors or greenhouse factories would speed it up.",
          lever: "orbital_mirror",
          waiting: true,
          because,
        };
      }
      return {
        bottleneck: origin,
        title: AXIS_TITLE.nT,
        problem: `${d.T.toFixed(0)} K, and not warming. Liquid water needs ${TARGETS.T.min} K.`,
        action:
          deployed("orbital_mirror") === 0
            ? "Order orbital mirrors - the main early warming lever."
            : "Add greenhouse factories: tiny mass, large warming, and they reach the cap threshold.",
        lever: deployed("orbital_mirror") === 0 ? "orbital_mirror" : "ghg_factory",
        waiting: false,
        because,
      };
    }

    case "nP": {
      const regolithLeft = r.co2_reg > t.CO2_DEPLETE_SCALE;
      if (regolithLeft) {
        return {
          bottleneck: origin,
          title: AXIS_TITLE.nP,
          problem: `${d.P.toFixed(0)} mbar. A breathable world wants about ${TARGETS.P.target} mbar.`,
          action:
            deployed("atmo_processor") > 0
              ? "Processors are venting the regolith. More would thicken the air faster."
              : "Order atmospheric processors to vent CO2 out of the regolith.",
          lever: "atmo_processor",
          waiting: deployed("atmo_processor") > 0,
          because,
        };
      }
      return {
        bottleneck: origin,
        title: AXIS_TITLE.nP,
        problem: `${d.P.toFixed(0)} mbar, and the regolith is spent - there is no more CO2 to vent.`,
        action: "Import nitrogen. It is the inert buffer that carries the air to a full bar.",
        lever: "nitrogen_import",
        waiting: false,
        because,
      };
    }

    case "nWater": {
      if (d.T < TARGETS.T.min) return resolve("nT", origin, input, seen);
      if (r.h2o_ice <= 0 && d.oceanFrac < TARGETS.ocean.bandLo) {
        return {
          bottleneck: origin,
          title: AXIS_TITLE.nWater,
          problem: `Oceans cover ${(d.oceanFrac * 100).toFixed(0)}% and there is no ice left to melt.`,
          action: "Redirect comets to import volatiles.",
          lever: "comet_redirect",
          waiting: false,
          because,
        };
      }
      return {
        bottleneck: origin,
        title: AXIS_TITLE.nWater,
        problem: `Oceans cover ${(d.oceanFrac * 100).toFixed(0)}%; the target band starts at ${(
          TARGETS.ocean.bandLo * 100
        ).toFixed(0)}%.`,
        action: "The ice is melting as the planet warms. Keep the temperature climbing.",
        lever: null,
        waiting: true,
        because,
      };
    }

    case "nBio": {
      if (!state.seeded) {
        const s = suitability(r, d, t);
        if (s.gWater <= 0) return resolve("nWater", origin, input, seen);
        if (s.gTemp <= 0) return resolve("nT", origin, input, seen);
        if (s.gPress <= 0) return resolve("nP", origin, input, seen);
        return {
          bottleneck: origin,
          title: "Seed the biosphere",
          problem: "There is liquid water, the temperature is in band, and nothing is living in it.",
          action: "Seed cyanobacteria. This is the one-shot that starts oxygen.",
          lever: "biosphere_seeding",
          waiting: false,
          because,
        };
      }
      const s = suitability(r, d, t);
      if (s.g <= 0.05) {
        // Seeded but the world is hostile - say which gate is shut rather
        // than leaving the player watching a biomass number that never moves.
        if (s.gWater <= 0) return resolve("nWater", origin, input, seen);
        if (s.gTemp <= 0) return resolve("nT", origin, input, seen);
        if (s.gPress <= 0) return resolve("nP", origin, input, seen);
      }
      return {
        bottleneck: origin,
        title: AXIS_TITLE.nBio,
        problem: `Biomass is ${r.biomass.toFixed(2)} against a target of ${TARGETS.biomass.target}.`,
        action: "It grows on its own now. Keep the water and warmth where they are and let it spread.",
        lever: null,
        waiting: true,
        because,
      };
    }

    case "nO2": {
      // Nothing makes oxygen but the biosphere, so this axis is never
      // actionable in itself - it always resolves into the biology.
      if (r.biomass < TARGETS.biomass.min) return resolve("nBio", origin, input, seen);
      return {
        bottleneck: origin,
        title: AXIS_TITLE.nO2,
        problem: `Oxygen is at ${r.o2.toFixed(0)} mbar; breathing wants ${TARGETS.o2.min}.`,
        action: "The biosphere is making it. This is the slow part - let it run.",
        lever: null,
        waiting: true,
        because,
      };
    }

    case "nCO2": {
      if (r.co2_atm < TARGETS.co2_atm.toxMax) {
        return {
          bottleneck: origin,
          title: AXIS_TITLE.nCO2,
          problem: `CO2 is ${r.co2_atm.toFixed(1)} mbar, already under the ${TARGETS.co2_atm.toxMax} mbar toxicity limit.`,
          action: "Nothing needed here.",
          lever: null,
          waiting: true,
          because,
        };
      }
      /**
       * The scrubber is a trap until something else is holding the pressure
       * up, because scrubbing CO2 out of an atmosphere that IS CO2 is just
       * removing the atmosphere.
       *
       * The test is the buffer - what would be left standing once the carbon
       * is gone - not the total. Written against the total first, and it
       * cleared its own threshold at year 364 with 301 mbar of which 297 was
       * CO2: the shell spent the next 1346 sim-years, more than half the game,
       * telling the player to strip their own air.
       */
      const buffer = d.P - r.co2_atm;
      if (buffer < TARGETS.P.min) {
        return {
          bottleneck: origin,
          title: AXIS_TITLE.nCO2,
          problem: `CO2 is ${r.co2_atm.toFixed(0)} of the ${d.P.toFixed(0)} mbar of air. Take it away and ${buffer.toFixed(
            0,
          )} mbar is left.`,
          action:
            deployed("nitrogen_import") > 0
              ? "Nitrogen is arriving. Once it carries the pressure, the CO2 can come out."
              : "Import nitrogen first - an inert buffer to hold the pressure up when the carbon leaves.",
          lever: "nitrogen_import",
          waiting: deployed("nitrogen_import") > 0,
          because,
        };
      }
      /**
       * A grown biosphere takes the carbon down by itself, and that is what
       * actually happens: in the reference run photosynthesis carries CO2 from
       * 291 mbar at year 540 to 6 mbar at year 1740 with no scrubber ever
       * built. Telling the player to run scrubbers across those twelve
       * centuries would be selling them a lever they do not need - and this
       * one is a documented trap.
       *
       * So the scrubber is offered as an accelerator, not an instruction. This
       * stretch IS §0's long tail; the shell should say so rather than invent
       * homework for it.
       */
      if (r.biomass >= TARGETS.biomass.min) {
        return {
          bottleneck: origin,
          title: AXIS_TITLE.nCO2,
          problem: `CO2 is ${r.co2_atm.toFixed(0)} mbar and falling; breathable air wants under ${TARGETS.co2_atm.toxMax}.`,
          action: "The biosphere is fixing it. This is the long haul - carbon scrubbers would speed it up.",
          lever: "carbon_scrubber",
          waiting: true,
          because,
        };
      }

      return {
        bottleneck: origin,
        title: AXIS_TITLE.nCO2,
        problem: `CO2 is ${r.co2_atm.toFixed(0)} mbar; breathable air wants under ${TARGETS.co2_atm.toxMax}.`,
        action: "Run carbon scrubbers. They stop on their own at the pressure floor.",
        lever: "carbon_scrubber",
        waiting: false,
        because,
      };
    }
  }
}

/** Reached only when the prerequisite walk finds a cycle. */
function terminal(axis: AxisKey, origin: AxisKey): Advice {
  return {
    bottleneck: origin,
    title: AXIS_TITLE[axis],
    problem: "Several targets are blocking each other.",
    action: "Hold the planet steady and let the slow loops settle.",
    lever: null,
    waiting: true,
    because: null,
  };
}

/** Why the advice is about something other than the axis the player sees lowest. */
function chainReason(origin: AxisKey, reached: AxisKey): string {
  return `${AXIS_TITLE[origin]} is what is holding progress back, but it needs ${AXIS_TITLE[
    reached
  ].toLowerCase()} first.`;
}
