/**
 * Batch 7's exit gate, as assertions.
 *
 * The gate is "a new player can tell, without documentation, what the planet
 * needs next". That is a claim about every moment of a playthrough, not about
 * a screenshot - so this walks the reference run and holds the advice to being
 * correct at all 1201 samples of it.
 *
 * The properties that matter are the ones where WRONG advice is worse than no
 * advice at all: never send the player to a lever that is gated shut, never
 * send them to one that would undo their own progress, never point at an axis
 * that is already finished.
 */

import { describe, expect, it } from "vitest";

import type { Advice, GuidanceInput } from "./guidance.js";
import { advise, bottleneckAxis, withAffordability } from "./guidance.js";
import type { ProgressAxes, SimState } from "../sim/index.js";
import {
  DEFAULT_TUNING,
  NEUTRAL_ENV,
  TARGETS,
  advance,
  computeProgress,
  derive,
  effectiveEnv,
  marsStart,
  progressAxes,
  seedBiosphere,
  simYear,
} from "../sim/index.js";
import { REFERENCE_POLICY, applyOrdersDue } from "../harness/policy.js";
import { ARC_SAMPLE_YEARS, ARC_YEARS } from "./config.js";

const t = DEFAULT_TUNING;

interface Moment {
  readonly year: number;
  readonly state: SimState;
  readonly advice: Advice;
  readonly input: GuidanceInput;
}

/**
 * The reference playthrough, with the advice the shell would have shown at
 * every sample.
 *
 * `dTdt` is reconstructed the same way `main.ts` does it - over the gap
 * between samples rather than per substep - so the advice under test is the
 * advice a player would actually have seen.
 */
function playthrough(): readonly Moment[] {
  let state: SimState = marsStart();
  let year = 0;
  let previousT: number | null = null;
  let previousYear = 0;
  const ordersApplied = new Set<number>();
  const moments: Moment[] = [];

  const stepsPerSample = Math.max(1, Math.round(ARC_SAMPLE_YEARS / t.SUBSTEP_YEARS));
  const totalSamples = Math.round(ARC_YEARS / ARC_SAMPLE_YEARS);

  const record = (): void => {
    const env = effectiveEnv(NEUTRAL_ENV, state.facilities, t);
    const d = derive(state.reservoirs, env, t);
    const dTdt = previousT !== null && year > previousYear ? (d.T - previousT) / (year - previousYear) : 0;
    previousT = d.T;
    previousYear = year;

    const input: GuidanceInput = {
      state,
      reservoirs: state.reservoirs,
      derived: d,
      axes: progressAxes(state.reservoirs, d, t),
      tuning: t,
      dTdt,
    };
    moments.push({ year, state, advice: advise(input), input });
  };

  record();
  for (let i = 0; i < totalSamples; i += 1) {
    state = applyOrdersDue(state, REFERENCE_POLICY, year, ordersApplied, t);
    const env = effectiveEnv(NEUTRAL_ENV, state.facilities, t);
    if (REFERENCE_POLICY.seedAt >= 0 && !state.seeded && year >= REFERENCE_POLICY.seedAt) {
      state = seedBiosphere(state, t, env).state;
    }
    state = advance(state, stepsPerSample, { tuning: t, env: NEUTRAL_ENV, forcing: null });
    year = simYear(state, t);
    record();
  }
  return moments;
}

const RUN = playthrough();

function axesOf(overrides: Partial<ProgressAxes>): ProgressAxes {
  return { nT: 0.5, nP: 0.5, nO2: 0.5, nWater: 0.5, nBio: 0.5, nCO2: 0.5, ...overrides };
}

describe("bottleneckAxis", () => {
  it("picks the lowest axis when the weights are equal", () => {
    expect(bottleneckAxis(axesOf({ nWater: 0.1 }), t)).toBe("nWater");
    expect(bottleneckAxis(axesOf({ nCO2: 0.02 }), t)).toBe("nCO2");
  });

  it("picks a zero axis over a merely low one", () => {
    expect(bottleneckAxis(axesOf({ nBio: 0, nT: 0.05 }), t)).toBe("nBio");
  });

  it("is stable when nothing is limiting", () => {
    expect(bottleneckAxis(axesOf({}), t)).toBe("nT");
  });

  /** §8.1's whole point: an axis at zero tanks the score, so it outranks everything. */
  it("ranks by marginal gain, not by raw value, when weights differ", () => {
    const weighted = { ...t, W_WATER: 10 };
    // Water at 0.3 with ten times the weight beats temperature at 0.2.
    expect(bottleneckAxis(axesOf({ nWater: 0.3, nT: 0.2 }), weighted)).toBe("nWater");
    expect(bottleneckAxis(axesOf({ nWater: 0.3, nT: 0.2 }), t)).toBe("nT");
  });
});

describe("advice across the reference playthrough", () => {
  it("always says something concrete", () => {
    for (const m of RUN) {
      expect(m.advice.title.length, `empty title at year ${m.year}`).toBeGreaterThan(0);
      expect(m.advice.problem.length, `empty problem at year ${m.year}`).toBeGreaterThan(0);
      expect(m.advice.action.length, `empty action at year ${m.year}`).toBeGreaterThan(0);
    }
  });

  /**
   * The single worst failure available to this feature: telling a player to
   * seed when the sim will refuse them. They click, nothing happens, and the
   * shell has taught them it cannot be trusted.
   */
  it("never recommends seeding when seeding would be refused", () => {
    const bad = RUN.filter((m) => m.advice.lever === "biosphere_seeding").filter((m) => {
      const env = effectiveEnv(NEUTRAL_ENV, m.state.facilities, t);
      return !seedBiosphere(m.state, t, env).seeded;
    });
    expect(
      bad.map((m) => `year ${m.year}: ${m.advice.action}`),
      "advice sent the player to a refused action",
    ).toEqual([]);
  });

  /**
   * The scrubber is the trap this project already found once: drawing CO2 out
   * while CO2 *is* the atmosphere just thins the air back out.
   *
   * The criterion is the buffer that would survive the scrubbing, deliberately
   * NOT the total pressure. The first version of this test asked about the
   * total - the same mistake the implementation was making - so it passed
   * while the shell was advising 1346 sim-years of self-harm. A test that
   * restates the code's own reasoning cannot check it.
   */
  it("never recommends the carbon scrubber before a buffer can hold the pressure up", () => {
    const bad = RUN.filter((m) => m.advice.lever === "carbon_scrubber").filter(
      (m) => m.input.derived.P - m.state.reservoirs.co2_atm < TARGETS.P.min,
    );
    expect(
      bad.map(
        (m) =>
          `year ${m.year}: buffer=${(m.input.derived.P - m.state.reservoirs.co2_atm).toFixed(0)} mbar ` +
          `of ${m.input.derived.P.toFixed(0)}`,
      ),
      "advice pointed at the scrubber trap",
    ).toEqual([]);
  });

  /** And the scrubber must actually be recommended eventually, or the test above is vacuous. */
  it("does eventually recommend the scrubber, once the buffer is there", () => {
    const scrub = RUN.filter((m) => m.advice.lever === "carbon_scrubber");
    expect(scrub.length, "the scrubber was never recommended at all").toBeGreaterThan(0);
    for (const m of scrub) {
      expect(m.input.derived.P - m.state.reservoirs.co2_atm).toBeGreaterThanOrEqual(TARGETS.P.min);
    }
  });

  /**
   * §0 asks for a long tail. The reference run wins at year 1710 having never
   * built a scrubber - photosynthesis takes CO2 from 291 mbar to 6 on its own -
   * so through that whole stretch the shell must present the scrubber as an
   * optional accelerator, not as the task.
   */
  it("does not invent homework during the biosphere's long drawdown", () => {
    const nagging = RUN.filter(
      (m) => m.advice.lever === "carbon_scrubber" && !m.advice.waiting && m.state.reservoirs.biomass >= 0.2,
    );
    expect(
      nagging.map((m) => `year ${m.year}: biomass ${m.state.reservoirs.biomass.toFixed(2)}`),
      "the shell demanded scrubbers while the biosphere was already doing the work",
    ).toEqual([]);
  });

  it("spends a real part of the run saying there is nothing to do", () => {
    const waiting = RUN.filter((m) => m.advice.waiting).length;
    const share = waiting / RUN.length;
    // A shell that always has a job for the player is not modelling a planet
    // that mostly changes on its own.
    expect(share, `only ${(share * 100).toFixed(0)}% of the run was "nothing to do"`).toBeGreaterThan(0.4);
    // ...but it must not be the answer to everything either.
    expect(share).toBeLessThan(0.95);
  });

  it("never asks for more warming once the planet is at temperature", () => {
    const bad = RUN.filter((m) => m.advice.lever === "orbital_mirror" || m.advice.lever === "ghg_factory").filter(
      (m) => m.input.derived.T >= TARGETS.T.target,
    );
    expect(bad.map((m) => `year ${m.year}: T=${m.input.derived.T.toFixed(0)} K`), "advice overshoots").toEqual([]);
  });

  it("never asks for cooling while the planet is below freezing", () => {
    const bad = RUN.filter((m) => m.advice.lever === "solar_shade").filter((m) => m.input.derived.T < TARGETS.T.min);
    expect(bad.map((m) => `year ${m.year}: T=${m.input.derived.T.toFixed(0)} K`)).toEqual([]);
  });

  it("tells the player to seed, in the window where seeding is possible", () => {
    const seedAdvice = RUN.filter((m) => m.advice.lever === "biosphere_seeding");
    expect(seedAdvice.length, "the shell never once suggested seeding").toBeGreaterThan(0);
    // And it does so before the reference schedule seeds, not after - the
    // advice has to lead the player, not report on them.
    const first = seedAdvice[0];
    expect(first).toBeDefined();
    expect(first!.year).toBeLessThanOrEqual(REFERENCE_POLICY.seedAt);
  });

  it("stops asking for anything once the world is finished", () => {
    const last = RUN[RUN.length - 1];
    expect(last).toBeDefined();
    expect(last!.advice.title).toBe("A living world");
    expect(last!.advice.lever).toBeNull();
    expect(last!.advice.waiting).toBe(true);
  });

  /**
   * A shell stuck on one message for 2400 years has not been tracking the
   * game; one that changes every sample is noise. Neither is guidance.
   */
  it("tracks the run rather than repeating itself or thrashing", () => {
    const titles = RUN.map((m) => m.advice.title);
    expect(new Set(titles).size, "the advice barely changed over a whole playthrough").toBeGreaterThanOrEqual(4);

    let changes = 0;
    for (let i = 1; i < titles.length; i += 1) if (titles[i] !== titles[i - 1]) changes += 1;
    expect(changes, `the advice changed ${changes} times in ${titles.length} samples`).toBeLessThan(40);
  });

  it("explains itself when it points somewhere other than the limiting axis", () => {
    const chained = RUN.filter((m) => m.advice.because !== null);
    expect(chained.length, "the prerequisite chain never fired in a whole run").toBeGreaterThan(0);
    for (const m of chained) {
      expect(m.advice.because, `empty reason at year ${m.year}`).toMatch(/holding progress back/);
    }
  });

  it("recommends a real lever or none at all", () => {
    const known = new Set([
      "orbital_mirror",
      "solar_shade",
      "ghg_factory",
      "atmo_processor",
      "comet_redirect",
      "nitrogen_import",
      "biosphere_seeding",
      "carbon_scrubber",
      "magnetic_shield",
    ]);
    for (const m of RUN) {
      if (m.advice.lever === null) continue;
      expect(known.has(m.advice.lever), `unknown lever ${m.advice.lever} at year ${m.year}`).toBe(true);
    }
  });
});

describe("advice on a planet nobody has touched", () => {
  it("opens by telling the player to warm it up", () => {
    const state = marsStart();
    const d = derive(state.reservoirs, NEUTRAL_ENV, t);
    const advice = advise({
      state,
      reservoirs: state.reservoirs,
      derived: d,
      axes: progressAxes(state.reservoirs, d, t),
      tuning: t,
      dTdt: 0,
    });
    // Day one on Mars: the limiting axis is biology, but the answer is mirrors.
    expect(advice.title).toBe("Temperature");
    expect(advice.lever).toBe("orbital_mirror");
    expect(advice.because).not.toBeNull();
  });

  it("agrees with the progress metric about what is worst", () => {
    const state = marsStart();
    const d = derive(state.reservoirs, NEUTRAL_ENV, t);
    const axes = progressAxes(state.reservoirs, d, t);
    const advice = advise({ state, reservoirs: state.reservoirs, derived: d, axes, tuning: t, dTdt: 0 });
    expect(advice.bottleneck).toBe(bottleneckAxis(axes, t));
    // And the composite really is being held down by it.
    expect(computeProgress(state.reservoirs, d, t).progressRaw).toBeLessThan(0.05);
  });
});

/**
 * Money, from the Batch 10 review.
 *
 * FOUND: the guidance predates the economy, so it happily told a player to
 * "Import nitrogen first" with 563 credits against a 900 credit price, and the
 * shell put an "Order one" button under it. That is the same failure this file
 * already calls "the single worst failure available to this feature" for
 * seeding, wearing a different hat - the player clicks, nothing happens, and
 * the shell has taught them it cannot be trusted.
 */
describe("advice the player can actually act on", () => {
  const base: Advice = {
    bottleneck: "nP",
    title: "Atmospheric pressure",
    problem: "301 mbar.",
    action: "Import nitrogen first.",
    lever: "nitrogen_import",
    waiting: false,
    because: null,
  };

  it("says to save up when the lever is unaffordable, and stops calling for action", () => {
    const out = withAffordability(base, { cost: 900, credits: 563 });
    expect(out.waiting, "still demanding an order the player cannot place").toBe(true);
    expect(out.action).toMatch(/900/);
    expect(out.action).toMatch(/563/);
    // The diagnosis does not change - the planet still needs nitrogen.
    expect(out.title).toBe(base.title);
    expect(out.lever).toBe(base.lever);
  });

  it("leaves affordable advice exactly alone", () => {
    expect(withAffordability(base, { cost: 900, credits: 2000 })).toBe(base);
    expect(withAffordability(base, { cost: 0, credits: 0 })).toBe(base);
  });

  it("does nothing at all when there is no economy", () => {
    expect(withAffordability(base, null)).toBe(base);
  });

  it("does not second-guess advice that was already waiting", () => {
    const waiting: Advice = { ...base, waiting: true };
    expect(withAffordability(waiting, { cost: 900, credits: 1 })).toBe(waiting);
  });

  it("has nothing to say about advice with no lever", () => {
    const none: Advice = { ...base, lever: null };
    expect(withAffordability(none, { cost: 900, credits: 1 })).toBe(none);
  });
});
