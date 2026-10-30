/**
 * Batch 40's review: a world's terrain is turned by a rotation drawn from its
 * seed. A sign slipped in that matrix stretches the world instead of turning
 * it - at the elevation tests' seed by only 1.5%, inside their tolerance, so
 * they passed. A rotation is checked as a rotation here, for many seeds.
 */

import { describe, expect, it } from "vitest";

import { terrainRotation } from "./planet-terrain.js";

describe("a world's terrain rotation", () => {
  it("is a rotation for every seed: its rows of unit length, square to each other, turning the right way", () => {
    let worst = 0;
    for (let seed = 1; seed <= 500; seed += 1) {
      const r = terrainRotation(seed);
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const dot = r[3 * i]! * r[3 * j]! + r[3 * i + 1]! * r[3 * j + 1]! + r[3 * i + 2]! * r[3 * j + 2]!;
          worst = Math.max(worst, Math.abs(dot - (i === j ? 1 : 0)));
        }
      }
      const det = r[0]! * (r[4]! * r[8]! - r[5]! * r[7]!) - r[1]! * (r[3]! * r[8]! - r[5]! * r[6]!) + r[2]! * (r[3]! * r[7]! - r[4]! * r[6]!);
      expect(det, `seed ${seed}`).toBeCloseTo(1, 12);
    }
    // Measured: 1.3e-15 at worst over the 500, rounding; with a sign slipped in the matrix, seed 1's determinant
    // was 1.00026.
    expect(worst).toBeLessThan(1e-12);
  });

  it("is not the same for every seed (vacuity)", () => {
    expect(terrainRotation(1)).not.toEqual(terrainRotation(2));
  });
});
