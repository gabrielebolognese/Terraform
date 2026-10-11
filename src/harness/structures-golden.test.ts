/**
 * Batch 26's exit gate, second line - detail §2.3: "Each of the ten types is
 * recognisable: a reference sheet of all ten, committed and compared per pixel
 * with a measured tolerance." All 28 types the game builds now, each at
 * level 1 and at its top level.
 *
 * When a diff is intended: run `npm run sim:city`, LOOK at
 * docs/frames/structures-sheet.png, and commit it with the reason.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { frameDifference } from "../render/planet.js";
import { BUILDING_TYPES } from "../sim/index.js";
import { STRUCTURES_GOLDEN, renderCity, structureSheet } from "./city-frames.js";
import { FRAMES_DIR } from "./frames.js";
import { decodePng } from "./png.js";

/**
 * Mean absolute per-channel difference, as a fraction of full scale. Measured on the sheet:
 *
 *   unmodified render                                   0.0000%
 *   a water tank's level 8 dropped to 7                 0.0000%  (no pixel changes at this scale)
 *   a depot's level 8 dropped to 7                      0.0001%
 *   the geothermal plant's level 8 dropped to 1         0.0012%
 *   the dome's level 5 dropped to 4 (an annex gone)     0.0016%
 *   render time +0.5 s (animation phase)                0.0457%
 *   every building re-seeded (another settlement)       0.1858%
 *
 * 0.0002% is about three full-contrast pixels at 1,600 x 1,000 - the city
 * frame's allowance - and sits under every change that alters more than a
 * pixel or two. A single level step on the smallest buildings does not: at
 * this scale it is a pixel, and the structure tests hold it instead.
 */
const TOLERANCE = 0.000002;

describe("the structures reference sheet", () => {
  const path = join(FRAMES_DIR, STRUCTURES_GOLDEN.name);
  const render = (view = structureSheet().view) => {
    const s = structureSheet();
    return renderCity(view, s.options, STRUCTURES_GOLDEN.width, STRUCTURES_GOLDEN.height, false, s.box);
  };

  it("is committed, and holds every type the game builds, at level 1 and at its top level", () => {
    expect(existsSync(path), `${STRUCTURES_GOLDEN.name} is missing - run npm run sim:city`).toBe(true);
    const { view } = structureSheet();
    for (const type of BUILDING_TYPES) {
      const levels = view.buildings.filter((b) => b.type === type).map((b) => b.level);
      expect(levels.length, type).toBe(2);
      expect(levels[0], type).toBe(1);
      expect(levels[1]!, type).toBeGreaterThan(1);
    }
  });

  it("matches the committed frame, pixel for pixel within the measured tolerance", () => {
    expect(frameDifference(decodePng(readFileSync(path)), render())).toBeLessThanOrEqual(TOLERANCE);
  });

  it("would notice a building one level less complex - the tolerance is not vacuous", () => {
    const { view } = structureSheet();
    const fewer = { ...view, buildings: view.buildings.map((b) => (b.type === "habitat_dome" && b.level === 5 ? { ...b, level: 4 } : b)) };
    expect(frameDifference(decodePng(readFileSync(path)), render(fewer))).toBeGreaterThan(TOLERANCE);
  });
});
