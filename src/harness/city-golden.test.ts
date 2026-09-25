/**
 * Batch 20's exit gate: "A deterministic reference render of a fixed city,
 * committed and compared per pixel like Batch 6's golden frames, with a
 * tolerance that is measured."
 *
 * When a diff is intended: run `npm run sim:city`, LOOK at
 * docs/frames/city-preview.png, and commit the new frames with the reason.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { frameDifference } from "../render/planet.js";
import { CITY_GOLDEN, CITY_GOLDEN_WHOLE, referenceCity, renderCity } from "./city-frames.js";
import { FRAMES_DIR } from "./frames.js";
import { decodePng } from "./png.js";

/**
 * Mean absolute per-channel difference, as a fraction of full scale.
 *
 * NOT the planet frames' 0.2%. Measured against this city (Batch 20), the
 * changes a player would notice are far smaller than that (the first line
 * re-measured after the detailed buildings - it was 0.0052%, then 0.0044%
 * once the ground gained height):
 *
 *   reactor load halved (core glow dimmer)        0.0046%
 *   one rock removed                              0.0439%
 *   render time +0.5 s (animation phase)          0.0668%
 *   solar array switched off (badge, panels)      0.1064%
 *   one depot moved by one tile                   0.2107%
 *
 * At 0.2% the first four would all pass. An unmodified render reproduces the
 * committed PNG exactly - 0.0000% - so the tolerance only has to absorb a
 * trig call's last bit flipping a pixel whose centre sits on an edge; one
 * full-contrast pixel at 384 x 240 is about 0.001%. 0.003% allows three such
 * pixels and still catches the smallest change measured.
 */
const TOLERANCE = 0.00003;

/**
 * The whole-grid terrain frame (Batch 22). The close-up above frames the flat
 * landing zone, where lowering a hill tile by a metre, marking a steep tile
 * buildable, or leaving the hilltop solar array unlifted all changed it by
 * 0.0000%. Measured on this frame instead:
 *
 *   reactor load halved (small at this scale)     0.0004%
 *   tile 26,25 (z -0.04) one metre lower          0.0015%
 *   tile 6,4 (z 0.44) one metre lower             0.0029%
 *   steep tile 2,0 drawn as buildable             0.0036%
 *   solar array at 19,12 switched off             0.0073%
 *   hilltop solar array not lifted onto its hill  0.0539%
 *   tile 10,28 (z -0.91) one metre lower          0.0990%
 *
 * (Re-measured after the detailed buildings; the terrain rows did not move.)
 *   unmodified render                             0.0000%
 *
 * 0.001% is about one full-contrast pixel at 384 x 240: every single-tile
 * change measured exceeds it. The buildings are the close-up's job.
 */
const TOLERANCE_TERRAIN = 0.00001;

describe("the reference city render", () => {
  const path = join(FRAMES_DIR, CITY_GOLDEN.name);

  it("is committed", () => {
    expect(existsSync(path), `${CITY_GOLDEN.name} is missing - run npm run sim:city`).toBe(true);
  });

  it("matches the committed frame, pixel for pixel within the measured tolerance", () => {
    const golden = decodePng(readFileSync(path));
    const { view, options } = referenceCity();
    const rendered = renderCity(view, options, CITY_GOLDEN.width, CITY_GOLDEN.height);
    expect(frameDifference(golden, rendered)).toBeLessThanOrEqual(TOLERANCE);
  });

  it("would notice the smallest change measured, the reactor's load halved - the tolerance is not vacuous", () => {
    const golden = decodePng(readFileSync(path));
    const { view, options } = referenceCity();
    const dimmer = { ...view, buildings: view.buildings.map((b) => (b.type === "reactor" ? { ...b, activity: b.activity * 0.5 } : b)) };
    expect(frameDifference(golden, renderCity(dimmer, options, CITY_GOLDEN.width, CITY_GOLDEN.height))).toBeGreaterThan(TOLERANCE);
  });

  it("the terrain frame matches too, within its own measured tolerance", () => {
    const golden = decodePng(readFileSync(join(FRAMES_DIR, CITY_GOLDEN_WHOLE.name)));
    const { view, options } = referenceCity();
    const rendered = renderCity(view, options, CITY_GOLDEN_WHOLE.width, CITY_GOLDEN_WHOLE.height, false);
    expect(frameDifference(golden, rendered)).toBeLessThanOrEqual(TOLERANCE_TERRAIN);
  });

  it("would notice one tile of ground a metre lower - the terrain tolerance is not vacuous", () => {
    const golden = decodePng(readFileSync(join(FRAMES_DIR, CITY_GOLDEN_WHOLE.name)));
    const { view, options } = referenceCity();
    // Tile 26,25 a metre (0.1 tile) lower: its four corners, and the nine
    // half-tile samples the ground is drawn through up close. Measured at
    // 26,25 / 10,28 / 5,5 / 20,8: 0.00152%, 0.00125%, 0.00150%, 0.00143% -
    // over the tolerance everywhere. (One corner alone, in the corner array
    // only, changed nothing drawn once the ground was drawn through the
    // half-tile samples; before that, a metre at one corner was under one
    // full-contrast pixel.)
    const f = 2 * view.world.size + 1;
    const samples = new Set<number>();
    for (let j = 0; j <= 2; j += 1) for (let i = 0; i <= 2; i += 1) samples.add((2 * (25 + view.world.margin) + j) * f + 2 * (26 + view.world.margin) + i);
    const corners = new Set([25 * 33 + 26, 25 * 33 + 27, 26 * 33 + 26, 26 * 33 + 27]);
    const lower = {
      ...view,
      corners: view.corners.map((z, i) => (corners.has(i) ? z - 0.1 : z)),
      world: { ...view.world, fine: (view.world.fine ?? []).map((z, i) => (samples.has(i) ? z - 0.1 : z)) },
    };
    expect(frameDifference(golden, renderCity(lower, options, CITY_GOLDEN_WHOLE.width, CITY_GOLDEN_WHOLE.height, false))).toBeGreaterThan(TOLERANCE_TERRAIN);
  });

  it("shows what it is meant to: nine of the ten building types, hills and steep ground, a browned-out building", () => {
    const { view } = referenceCity();
    const types = new Set(view.buildings.map((b) => b.type));
    // The extractor is left out on purpose - a dry city is what browns the domes out.
    expect(types.size).toBe(9);
    expect(types.has("water_extractor")).toBe(false);
    expect(view.steep.some(Boolean)).toBe(true);
    expect(Math.max(...view.groundZ) - Math.min(...view.groundZ)).toBeGreaterThan(1);
    expect(view.buildings.some((b) => !b.operable)).toBe(true);
    expect(view.buildings.some((b) => b.operable)).toBe(true);
  });
});
