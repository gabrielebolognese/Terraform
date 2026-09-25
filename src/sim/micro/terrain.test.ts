/**
 * Detail §1: a settlement's terrain (Batch 22), rebuilt as an open world at
 * the user's request - "high mountains, canyons, rock pits, caves ... and
 * smoothed out, so the different level is visible but it doesn't look fake".
 * Every number here was measured first.
 */

import { describe, expect, it } from "vitest";

import { makeTuning } from "../tuning.js";
import { groundOf, isSteep, worldOf } from "./terrain.js";

/** The browser's setting. */
const HILLS = makeTuning({ TERRAIN_RELIEF_M: 12 });
const HERE = { kind: "city" as const, lat: 0.31, lon: -1.2 };

const steepCount = (g: { steep: readonly boolean[] }): number => g.steep.filter(Boolean).length;

describe("the local heightmap", () => {
  it("is flat by default: every tile and every corner of the world at the base elevation", () => {
    const flat = makeTuning({});
    const g = groundOf(HERE, flat);
    expect(g.heightM.every((h) => h === 0)).toBe(true);
    expect(g.cornersM.every((h) => h === 0)).toBe(true);
    expect(steepCount(g)).toBe(0);
    expect(worldOf(HERE, flat).cornersM.every((h) => h === 0)).toBe(true);
  });

  it("is the same ground every time for the same place, and different ground elsewhere", () => {
    expect(groundOf(HERE, HILLS)).toEqual(groundOf({ ...HERE }, HILLS));
    const there = groundOf({ ...HERE, lon: -1.1 }, HILLS).heightM;
    const here = groundOf(HERE, HILLS).heightM;
    expect(here.filter((h, i) => Math.abs(h - (there[i] ?? 0)) > 0.1).length).toBeGreaterThan(500);
  });

  it("keeps the landing zone flat at the base, and the ground round it buildable", () => {
    const g = groundOf(HERE, HILLS);
    for (let ty = 11; ty <= 20; ty += 1) {
      for (let tx = 11; tx <= 20; tx += 1) {
        if (tx >= 12 && tx < 20 && ty >= 12 && ty < 20) expect(g.heightM[ty * 32 + tx], `${tx},${ty}`).toBe(0);
        // The ring just outside it too: Batch 22's first version met the hills
        // with a cliff here, and the reference city's spaceport was refused.
        expect(isSteep(g, tx, ty), `${tx},${ty}`).toBe(false);
      }
    }
  });

  it("is a tile's corners: its height their mean, its slope the steepest rise along its edges", () => {
    // Independent of how the corners were made: the relation the rules rely on.
    const g = groundOf(HERE, HILLS);
    for (const [tx, ty] of [[3, 4], [20, 27], [30, 1]] as const) {
      const c = (x: number, y: number): number => g.cornersM[y * 33 + x]!;
      const [a, b, cc, d] = [c(tx, ty), c(tx + 1, ty), c(tx, ty + 1), c(tx + 1, ty + 1)];
      expect(g.heightM[ty * 32 + tx]).toBeCloseTo((a + b + cc + d) / 4, 12);
      expect(g.slope[ty * 32 + tx]).toBeCloseTo(Math.max(Math.abs(a - b), Math.abs(cc - d), Math.abs(a - cc), Math.abs(b - d)) / HILLS.TILE_METRES, 12);
    }
  });

  it("has steep ground to refuse, at the browser's relief - and room to build", () => {
    // Measured: 88 of 1,024 tiles here; 5.2% on average over 100 sites (Batch 22's hills: 16.1%).
    const n = steepCount(groundOf(HERE, HILLS));
    expect(n).toBeGreaterThan(40);
    expect(n).toBeLessThan(250);
  });
});

describe("the open world round it", () => {
  const w = worldOf(HERE, HILLS);

  it("is the grid's own ground where the two meet: what is drawn is what the rules judge", () => {
    const g = groundOf(HERE, HILLS);
    for (let y = 0; y <= 32; y += 1) {
      for (let x = 0; x <= 32; x += 1) {
        expect(w.cornersM[(y + w.margin) * (w.size + 1) + x + w.margin], `${x},${y}`).toBe(g.cornersM[y * 33 + x]);
      }
    }
  });

  it("reaches TERRAIN_WORLD_MARGIN tiles past the grid on every side", () => {
    expect(w.margin).toBe(HILLS.TERRAIN_WORLD_MARGIN);
    expect(w.size).toBe(32 + 2 * HILLS.TERRAIN_WORLD_MARGIN);
    expect(w.cornersM).toHaveLength((w.size + 1) ** 2);
  });

  it("has mountains, and canyons and pits, far beyond the buildable ground's relief", () => {
    // Measured here: from -48.7 m to +102.1 m; the grid itself -20.3 to +11.2.
    // Over 100 sites the world spans -56 to +98 m on average.
    expect(Math.max(...w.cornersM)).toBeGreaterThan(5 * HILLS.TERRAIN_RELIEF_M);
    expect(Math.min(...w.cornersM)).toBeLessThan(-2.5 * HILLS.TERRAIN_RELIEF_M);
    const g = groundOf(HERE, HILLS);
    expect(Math.max(...g.heightM.map(Math.abs))).toBeLessThan(3 * HILLS.TERRAIN_RELIEF_M);
  });

  it("has caves, each in a real rock face", () => {
    // Measured: 13 here, 15.3 on average over 100 sites.
    expect(w.caves.length).toBeGreaterThan(5);
    for (const c of w.caves) {
      // The face it opens in: the corner at the cave against the next corner along its facing.
      const x = Math.floor(c.x + w.margin);
      const y = Math.floor(c.y + w.margin);
      const m = w.size + 1;
      const rise = Math.hypot(w.cornersM[y * m + x + 1]! - w.cornersM[y * m + x]!, w.cornersM[(y + 1) * m + x]! - w.cornersM[y * m + x]!);
      expect(rise / HILLS.TILE_METRES, `cave at ${c.x},${c.y}`).toBeGreaterThan(0.6);
    }
  });
});
