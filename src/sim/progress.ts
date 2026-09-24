/**
 * Design doc section 8.1 - the composite progress metric.
 *
 * A weighted geometric mean, so a zero on any axis tanks the whole score: a
 * warm planet with no water is not habitable, and the player should not be
 * able to ignore an axis.
 *
 * TWO CHANGES TO THE DOCUMENTED FORM:
 *
 * 1. Computed in LOG SPACE. The literal product of five powers underflows to
 *    zero and `Math.pow(1, Infinity)` is NaN rather than an error anyone
 *    notices.
 *
 * 2. Each axis gets an affine floor BEFORE the product. Without it the bar
 *    reads exactly 0.00000 for the first half of the run - through the entire
 *    runaway, the most dramatic stretch of the game - because oxygen, water
 *    and biomass are all identically zero and one zero factor kills a product.
 *    That directly violates section 8.2's "the bar should never sit still".
 *    The floor moves it monotonically from 0.026 to 1.0, while a state with
 *    one dead axis still caps at 0.457, so the design intent survives.
 *
 * `progressRaw` keeps the unfloored value and is the honest victory gate.
 */

import { clamp01, logDescent } from "./math.js";
import { TARGETS } from "./targets.js";
import type { Tuning } from "./tuning.js";
import type { Derived, ProgressAxes, Reservoirs } from "./types.js";

export function progressAxes(r: Reservoirs, d: Derived, t: Tuning): ProgressAxes {
  return {
    nT: clamp01((d.T - TARGETS.T.progLo) / (TARGETS.T.target - TARGETS.T.progLo)),
    nP: clamp01(d.P / TARGETS.P.target),
    nO2: clamp01(r.o2 / TARGETS.o2.target),
    nWater: clamp01(d.oceanFrac / TARGETS.ocean.target),
    nBio: clamp01(r.biomass / TARGETS.biomass.target),
    // The CO2 axis measures COMPOSITION, not the absolute amount: the partial
    // pressure CO2 would have if the atmosphere were brought to the 1 bar
    // target. An absolute axis is perverse here - it reads 0.69 on a dead
    // 6 mbar Mars, and it falls through the entire runaway, because thickening
    // the air with CO2 is progress on the pressure axis and regress on this
    // one. The two cancelled and the bar went flat across the most dramatic
    // stretch of the game. Scaled by pressure it improves monotonically: CO2
    // is diluted by the nitrogen buffer and the oxygen the biosphere makes,
    // then drawn down outright.
    nCO2: logDescent(
      Math.max(0, r.co2_atm) * (TARGETS.P.target / Math.max(d.P, t.P_EPS)),
      TARGETS.co2_atm.target,
      t.CO2_PROG_HI,
    ),
  };
}

export interface ProgressResult {
  readonly progress: number;
  readonly progressRaw: number;
  readonly axes: ProgressAxes;
}

function weightedGeometricMean(
  axes: ProgressAxes,
  t: Tuning,
  floor: number,
): number {
  const g = (n: number): number => floor + (1 - floor) * clamp01(n);
  const terms: readonly (readonly [number, number])[] = [
    [t.W_T, g(axes.nT)],
    [t.W_P, g(axes.nP)],
    [t.W_O2, g(axes.nO2)],
    [t.W_WATER, g(axes.nWater)],
    [t.W_BIO, g(axes.nBio)],
    [t.W_CO2, g(axes.nCO2)],
  ];

  let sumW = 0;
  for (const [w] of terms) sumW += w;
  if (!(sumW > 0)) {
    throw new RangeError("progress weights must sum to a positive number");
  }

  let acc = 0;
  for (const [w, value] of terms) {
    if (value <= 0) return 0;
    acc += w * Math.log(value);
  }
  return clamp01(Math.exp(acc / sumW));
}

export function computeProgress(r: Reservoirs, d: Derived, t: Tuning): ProgressResult {
  const axes = progressAxes(r, d, t);
  return {
    axes,
    progress: weightedGeometricMean(axes, t, t.PROGRESS_FLOOR),
    progressRaw: weightedGeometricMean(axes, t, 0),
  };
}
