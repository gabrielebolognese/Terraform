/**
 * Micro §3.3's blocked terrain, derived from the settlement's place (Batch 20).
 */

import { describe, expect, it } from "vitest";

import { makeTuning } from "../tuning.js";
import { groundOf, isRough } from "./terrain.js";

const ROUGH = makeTuning({ TERRAIN_ROUGH_FRACTION: 0.12 });
const HERE = { kind: "city" as const, lat: 0.31, lon: -1.2 };

function roughCount(g: { rough: readonly boolean[] }): number {
  return g.rough.filter(Boolean).length;
}

describe("rough ground", () => {
  it("is off by default: every tile is buildable", () => {
    expect(roughCount(groundOf(HERE, makeTuning({})))).toBe(0);
  });

  it("covers exactly the dialled share of the ground outside the landing zone", () => {
    // 32 x 32 = 1024 tiles, less the 8 x 8 landing zone = 960 candidates.
    expect(roughCount(groundOf(HERE, ROUGH))).toBe(Math.round(0.12 * 960));
    expect(roughCount(groundOf({ ...HERE, kind: "outpost" }, ROUGH))).toBe(Math.round(0.12 * (256 - 64)));
    expect(roughCount(groundOf(HERE, makeTuning({ TERRAIN_ROUGH_FRACTION: 0.3 })))).toBe(Math.round(0.3 * 960));
  });

  it("never covers the landing zone, however rough the dial", () => {
    const g = groundOf(HERE, makeTuning({ TERRAIN_ROUGH_FRACTION: 1 }));
    for (let ty = 12; ty < 20; ty += 1) for (let tx = 12; tx < 20; tx += 1) expect(isRough(g, tx, ty), `${tx},${ty}`).toBe(false);
    // And everything else is rough at the top of the dial - the zone is the only exemption.
    expect(roughCount(g)).toBe(960);
  });

  it("is the same ground every time for the same place, and different ground elsewhere", () => {
    expect(groundOf(HERE, ROUGH).rough).toEqual(groundOf({ ...HERE }, ROUGH).rough);
    const there = groundOf({ ...HERE, lon: -1.1 }, ROUGH).rough;
    const differing = there.filter((r, i) => r !== groundOf(HERE, ROUGH).rough[i]).length;
    // Measured: 210 of 1024 tiles differ between these two sites.
    expect(differing).toBeGreaterThan(50);
  });

  it("clumps into outcrops rather than scattering: most rough tiles touch another", () => {
    // Measured at this site: 113 of 115 rough tiles have a rough neighbour.
    // Scattered at random at 12% density, about 40% would (1 - 0.88^4).
    const g = groundOf(HERE, ROUGH);
    let rough = 0;
    let touching = 0;
    for (let ty = 0; ty < g.tiles; ty += 1) {
      for (let tx = 0; tx < g.tiles; tx += 1) {
        if (!isRough(g, tx, ty)) continue;
        rough += 1;
        const near = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => tx + dx! >= 0 && ty + dy! >= 0 && tx + dx! < g.tiles && ty + dy! < g.tiles && isRough(g, tx + dx!, ty + dy!));
        if (near) touching += 1;
      }
    }
    expect(touching / rough).toBeGreaterThan(0.8);
  });
});
