/**
 * The GPU globe's coverage honesty rests on this table.
 *
 * The property is behavioural: a coverage channel `c` must colour `c` of the
 * planet's surface. Measured on an INDEPENDENT random point set, not the
 * lattice the table was built from, so the test cannot pass by construction.
 */

import { describe, expect, it } from "vitest";

import { cloudFieldAt, cloudFieldHighAt, elevationField } from "./planet.js";
import { lookupCdf, sphereCdf } from "./sphere-cdf.js";

/** Uniform random points on the sphere, from a seeded LCG. */
function randomSphere(count: number, seed: number): number[][] {
  let s = seed >>> 0;
  const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const out: number[][] = [];
  for (let i = 0; i < count; i += 1) {
    const z = 2 * rnd() - 1;
    const a = 2 * Math.PI * rnd();
    const r = Math.sqrt(1 - z * z);
    out.push([r * Math.cos(a), z, r * Math.sin(a)]);
  }
  return out;
}

const POINTS = randomSphere(40000, 12345);

function coverage(field: (x: number, y: number, z: number) => number, map: (v: number) => number, c: number): number {
  let under = 0;
  for (const p of POINTS) if (map(field(p[0]!, p[1]!, p[2]!)) < c) under += 1;
  return under / POINTS.length;
}

describe("the sphere CDF makes a coverage channel mean what it says", () => {
  for (const [name, field] of [
    ["elevation", elevationField],
    ["cloud", cloudFieldAt],
    ["cloud (globe)", cloudFieldHighAt],
  ] as const) {
    const cdf = sphereCdf(field);

    it(`${name}: is a CDF - non-decreasing, ending at 1`, () => {
      for (let k = 1; k < cdf.length; k += 1) expect(cdf[k]!).toBeGreaterThanOrEqual(cdf[k - 1]!);
      expect(cdf[cdf.length - 1]).toBe(1);
    });

    it(`${name}: thresholding the ranked field at c covers c of the sphere`, () => {
      // Measured worst error 0.0031 (elevation), 0.0035 (cloud) over these
      // points; 0.01 is a third of a percent of margin above sampling noise.
      for (const c of [0.1, 0.25, 0.36, 0.5, 0.75, 0.9]) {
        expect(Math.abs(coverage(field, (v) => lookupCdf(cdf, v), c) - c), `c = ${c}`).toBeLessThan(0.01);
      }
    });

    it(`${name}: needs the table - the raw field is nowhere near uniform`, () => {
      // Measured worst 0.28 / 0.24: fractal noise piles up around 0.5, which
      // is exactly why the software renderer ranks its fields too.
      const worst = Math.max(...[0.1, 0.25, 0.5, 0.75].map((c) => Math.abs(coverage(field, (v) => v, c) - c)));
      expect(worst).toBeGreaterThan(0.1);
    });
  }
});
