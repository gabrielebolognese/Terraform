/**
 * Detail §1.1 / §4.1: the planet's hypsometric curve, rank to metres
 * (Batch 22).
 */

import { describe, expect, it } from "vitest";

import { elevationAtRank, siteElevation } from "./hypsometry.js";
import { DEFAULT_TUNING, TuningError, makeTuning, validateTuning } from "./tuning.js";

const t = DEFAULT_TUNING;
const POINTS = [
  t.HYPSO_ELEV_0,
  t.HYPSO_ELEV_1,
  t.HYPSO_ELEV_2,
  t.HYPSO_ELEV_3,
  t.HYPSO_ELEV_4,
  t.HYPSO_ELEV_5,
  t.HYPSO_ELEV_6,
  t.HYPSO_ELEV_7,
  t.HYPSO_ELEV_8,
];

describe("the hypsometric curve", () => {
  it("passes through its control points and rises everywhere between them", () => {
    POINTS.forEach((h, k) => expect(elevationAtRank(k / 8, t)).toBeCloseTo(h, 9));
    let last = -Infinity;
    for (let i = 0; i <= 1000; i += 1) {
      const h = elevationAtRank(i / 1000, t);
      expect(h, `rank ${i / 1000}`).toBeGreaterThan(last);
      last = h;
    }
  });

  it("describes the planet: a share k/8 of random sites lies below HYPSO_ELEV_k", () => {
    // Independent of how the rank is built: uniformly random places on the
    // sphere, from their own generator. Measured over 8,000 sites: at most
    // 0.0051 off (binomial sigma at the median is 0.0056). 0.02 is ~3.5 sigma.
    let s = 777;
    const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const elevations: number[] = [];
    for (let i = 0; i < 8000; i += 1) elevations.push(siteElevation(Math.asin(2 * rnd() - 1), (rnd() * 2 - 1) * Math.PI, t));
    for (let k = 1; k < 8; k += 1) {
      const below = elevations.filter((e) => e < POINTS[k]!).length / elevations.length;
      expect(Math.abs(below - k / 8), `below HYPSO_ELEV_${k}`).toBeLessThan(0.02);
    }
    // And the whole range is used: Hellas-deep basins to the highest ground.
    expect(Math.min(...elevations)).toBeLessThan(-7000);
    expect(Math.max(...elevations)).toBeGreaterThan(6000);
  });

  it("refuses a curve that ever falls, naming the point", () => {
    expect(() => validateTuning(makeTuning({ HYPSO_ELEV_5: -2000 }))).toThrow(TuningError);
    expect(() => validateTuning(makeTuning({ HYPSO_ELEV_5: -2000 }))).toThrow(/HYPSO_ELEV_5 must exceed HYPSO_ELEV_4/);
    expect(() => validateTuning(t)).not.toThrow();
  });
});
