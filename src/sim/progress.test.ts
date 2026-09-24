import { describe, expect, it } from "vitest";

import { derive } from "./derive.js";
import { advance } from "./integrate.js";
import { marsStart } from "./planets/mars.js";
import { computeProgress, progressAxes } from "./progress.js";
import { TARGETS } from "./targets.js";
import { defaultConfig } from "./tick.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { Reservoirs } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

const t = DEFAULT_TUNING;

/**
 * A finished world: every one of the six axes at or past its section 2.3
 * target.
 *
 * Taken from the end state of the balance batch's reference playthrough rather
 * than assembled by hand, with the water raised to close the one axis that run
 * leaves short (ocean 0.365 against a 0.4 target - a comet redirect away). A
 * hand-built fixture goes stale every time the tuning moves; this one is a
 * state the game actually produces.
 */
const WON: Reservoirs = {
  ...marsStart().reservoirs,
  co2_atm: 0.238,
  co2_cap: 0,
  co2_reg: 0,
  n2: 770.24,
  n2_reg: 0,
  o2: 232.41,
  h2o_ice: 0,
  h2o_liq: 50,
  h2o_vap: 1.67,
  ghg: 1.17,
  biomass: 0.853,
};

/** A mid-run world, with every axis strictly below target so nothing is clamped. */
const PARTIAL: Reservoirs = { ...WON, o2: 105, biomass: 0.4, h2o_liq: 12, n2: 300 };

function progressOf(r: Reservoirs): number {
  return computeProgress(r, derive(r, NEUTRAL_ENV, t), t).progress;
}

describe("the bar moves from the very first tick", () => {
  /**
   * Section 8.1's geometric mean is exactly 0.00000 at the Mars start and
   * stays there through Phase 3 - half the run, including the entire runaway,
   * the most dramatic stretch of the game - because oxygen, water and biomass
   * are all identically zero and one zero factor kills a product. Section 8.2
   * says the bar should never sit still for more than a few minutes.
   */
  it("is strictly positive at the Mars start, where the raw metric is zero", () => {
    const r = marsStart().reservoirs;
    const result = computeProgress(r, derive(r, NEUTRAL_ENV, t), t);
    expect(result.progressRaw).toBe(0);
    expect(result.progress).toBeGreaterThan(t.PROGRESS_FLOOR);
    expect(result.progress).toBeLessThan(0.15);
  });

  it("rises measurably during the runaway, while the raw metric is still zero", () => {
    const start = marsStart();
    const hot = advance(start, 4000, { ...defaultConfig(), env: { sMultiplier: 1.3, albedoDelta: 0 } });
    expect(progressOf(hot.reservoirs)).toBeGreaterThan(progressOf(start.reservoirs));
  });

  it("still punishes a dead axis - though the floor and the sixth axis both soften it", () => {
    /**
     * Five axes maxed and one at zero reads 0.67, not the 0.46 of Batch 1.
     * Two changes pushed it up and both were deliberate:
     *
     *   - the floor went 0.02 -> 0.10, because the bar was frozen early;
     *   - a sixth axis dilutes any single axis's share of the geometric mean
     *     (0.02^(1/6) = 0.52 against 0.02^(1/5) = 0.46).
     *
     * §8.1 wants a zero axis to tank the score and §8.2 wants the bar to keep
     * moving; this number is where the balance batch put the trade. It is
     * pinned here so a future retune has to argue with it rather than drift
     * past it.
     */
    const lopsided = { ...WON, biomass: 0 };
    expect(progressOf(lopsided)).toBeLessThan(0.7);
    expect(progressOf(lopsided)).toBeGreaterThan(0.6);
    // Still a long way short of the finished world it is otherwise identical to.
    expect(progressOf(lopsided)).toBeLessThan(progressOf(WON) - 0.3);
  });
});

describe("bounds and monotonicity", () => {
  it("stays within [0, 1] for every axis combination", () => {
    for (const o2 of [0, 1, 210, 1e6]) {
      for (const biomass of [0, 0.4, 1]) {
        for (const h2o_liq of [0, 30, 1e4]) {
          const value = progressOf({ ...WON, o2, biomass, h2o_liq });
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it("increases when any single axis improves", () => {
    const partial = { ...WON, o2: 50, biomass: 0.3 };
    expect(progressOf({ ...partial, o2: 100 })).toBeGreaterThan(progressOf(partial));
    expect(progressOf({ ...partial, biomass: 0.6 })).toBeGreaterThan(progressOf(partial));
  });

  it("reaches 1 on a finished world and the raw metric agrees", () => {
    // Not exactly 1: pressure lands at 1005.7 against a 1013 target, so the
    // axis reads 0.993 and the sixth root of that is 0.9989. Asserting exact
    // equality would just be asserting that the reference run overshoots.
    const result = computeProgress(WON, derive(WON, NEUTRAL_ENV, t), t);
    expect(result.progress).toBeGreaterThan(0.99);
    expect(result.progressRaw).toBeGreaterThan(0.99);
  });

  it("cannot overshoot past the targets", () => {
    const overshot = { ...WON, o2: 1e5, biomass: 1, h2o_liq: 1e5 };
    expect(progressOf(overshot)).toBeLessThanOrEqual(1);
  });
});

describe("axes read from the targets table, not from hardcoded endpoints", () => {
  it("normalises each axis against its section 2.3 target", () => {
    // Uses the sub-target world, so the assertion sees the ratio itself
    // rather than the clamp that caps a finished axis at 1.
    const axes = progressAxes(PARTIAL, derive(PARTIAL, NEUTRAL_ENV, t), t);
    expect(axes.nO2).toBeCloseTo(PARTIAL.o2 / TARGETS.o2.target, 6);
    expect(axes.nBio).toBeCloseTo(PARTIAL.biomass / TARGETS.biomass.target, 6);
    expect(axes.nP).toBeCloseTo(derive(PARTIAL, NEUTRAL_ENV, t).P / TARGETS.P.target, 6);
  });

  it("clamps an axis that has overshot its target", () => {
    const axes = progressAxes(WON, derive(WON, NEUTRAL_ENV, t), t);
    expect(WON.biomass / TARGETS.biomass.target).toBeGreaterThan(1);
    expect(axes.nBio).toBe(1);
  });

  it("the carbon dioxide axis measures composition, not the absolute amount", () => {
    /**
     * An ABSOLUTE axis reads 0.69 on a dead 6 mbar Mars - a bare planet
     * scoring high on breathability - and then falls through the entire
     * runaway, because thickening the air with CO2 is progress on the pressure
     * axis and regress on the carbon one. The two cancelled and the bar went
     * flat across the most dramatic stretch of the game.
     *
     * Scaled by pressure the axis asks "what would the CO2 partial pressure be
     * at 1 bar", which is what section 2.3's toxicity row is about.
     *
     * It is NOT monotone in co2_atm alone: adding carbon to a thin atmosphere
     * makes its composition marginally worse, which is correct. What redeems
     * the runaway in a real playthrough is that the nitrogen buffer and the
     * biosphere's oxygen arrive alongside the carbon - and the reference
     * trajectory does improve monotonically, which src/harness/golden.test.ts
     * asserts on the real run.
     */
    const axisOf = (over: Partial<Reservoirs>): number => {
      const r = { ...marsStart().reservoirs, ...over };
      return progressAxes(r, derive(r, NEUTRAL_ENV, t), t).nCO2;
    };

    // A dead Mars is almost pure CO2, so it reads near zero however thin it is.
    expect(axisOf({})).toBeLessThan(0.05);

    // Diluting the same carbon with an inert buffer improves it...
    expect(axisOf({ co2_atm: 60, n2: 600 })).toBeGreaterThan(axisOf({ co2_atm: 60, n2: 20 }));
    // ...and so does removing the carbon outright.
    expect(axisOf({ co2_atm: 1, n2: 900 })).toBeGreaterThan(axisOf({ co2_atm: 60, n2: 900 }));
    // A breathable end state reads full marks.
    expect(axisOf({ co2_atm: 0.5, n2: 800, o2: 210 })).toBe(1);
  });

  it("the temperature axis starts at the Mars baseline, not at absolute zero", () => {
    const cold = { ...marsStart().reservoirs };
    const axes = progressAxes(cold, derive(cold, NEUTRAL_ENV, t), t);
    expect(axes.nT).toBeGreaterThan(0);
    expect(axes.nT).toBeLessThan(0.1);
  });
});

describe("degenerate weights", () => {
  it("throws rather than silently returning NaN when the weights sum to zero", () => {
    const zeroed = makeTuning({ W_T: 0, W_P: 0, W_O2: 0, W_WATER: 0, W_BIO: 0, W_CO2: 0 });
    expect(() => computeProgress(WON, derive(WON, NEUTRAL_ENV, t), zeroed)).toThrow(RangeError);
  });

  it("honours an uneven weighting", () => {
    const oxygenHeavy = makeTuning({ W_O2: 10 });
    const partial = { ...WON, o2: 20 };
    const d = derive(partial, NEUTRAL_ENV, t);
    expect(computeProgress(partial, d, oxygenHeavy).progress).toBeLessThan(computeProgress(partial, d, t).progress);
  });
});
