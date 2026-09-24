/**
 * Detail §1: a settlement's heightmap and slope, derived from its place
 * (Batch 22). Replaces Batch 20's rough-ground tests.
 */

import { describe, expect, it } from "vitest";

import { makeTuning } from "../tuning.js";
import { groundOf, isSteep } from "./terrain.js";

/** The browser's setting. */
const HILLS = makeTuning({ TERRAIN_RELIEF_M: 12 });
const HERE = { kind: "city" as const, lat: 0.31, lon: -1.2 };

const steepCount = (g: { steep: readonly boolean[] }): number => g.steep.filter(Boolean).length;

describe("the local heightmap", () => {
  it("is flat by default: every tile at the base elevation, none too steep", () => {
    const g = groundOf(HERE, makeTuning({}));
    expect(g.heightM.every((h) => h === 0)).toBe(true);
    expect(steepCount(g)).toBe(0);
  });

  it("stays within the relief either side of the base", () => {
    // Measured here: -9.29 to +11.49 m at 12 m of relief.
    const g = groundOf(HERE, HILLS);
    expect(Math.max(...g.heightM.map(Math.abs))).toBeLessThanOrEqual(12);
    expect(Math.max(...g.heightM) - Math.min(...g.heightM)).toBeGreaterThan(12);
  });

  it("is the same ground every time for the same place, and different ground elsewhere", () => {
    expect(groundOf(HERE, HILLS)).toEqual(groundOf({ ...HERE }, HILLS));
    // Measured: 946 of 1024 tiles differ by more than 10 cm between these two sites.
    const there = groundOf({ ...HERE, lon: -1.1 }, HILLS).heightM;
    const here = groundOf(HERE, HILLS).heightM;
    expect(here.filter((h, i) => Math.abs(h - (there[i] ?? 0)) > 0.1).length).toBeGreaterThan(500);
  });

  it("keeps the landing zone flat at the base, and the ground round it buildable", () => {
    const g = groundOf(HERE, HILLS);
    for (let ty = 11; ty <= 20; ty += 1) {
      for (let tx = 11; tx <= 20; tx += 1) {
        if (tx >= 12 && tx < 20 && ty >= 12 && ty < 20) expect(g.heightM[ty * 32 + tx], `${tx},${ty}`).toBe(0);
        // The ring just outside it too: the first version met the hills with a
        // cliff here, and the reference city's spaceport was refused.
        expect(isSteep(g, tx, ty), `${tx},${ty}`).toBe(false);
      }
    }
  });

  it("has steep ground to refuse, at the browser's relief - the rule is not vacuous", () => {
    // Measured: 277 of 1024 tiles here (27%); over 100 sites the mean is 16.1%.
    expect(steepCount(groundOf(HERE, HILLS))).toBeGreaterThan(100);
  });
});
