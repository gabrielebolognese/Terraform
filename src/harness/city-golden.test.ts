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
import { CITY_GOLDEN, referenceCity, renderCity } from "./city-frames.js";
import { FRAMES_DIR } from "./frames.js";
import { decodePng } from "./png.js";

/**
 * Mean absolute per-channel difference, as a fraction of full scale.
 *
 * NOT the planet frames' 0.2%. Measured against this city (Batch 20), the
 * changes a player would notice are far smaller than that:
 *
 *   reactor load halved (core glow dimmer)        0.0052%
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

  it("shows what it is meant to: nine of the ten building types, rough ground, a browned-out building", () => {
    const { view } = referenceCity();
    const types = new Set(view.buildings.map((b) => b.type));
    // The extractor is left out on purpose - a dry city is what browns the domes out.
    expect(types.size).toBe(9);
    expect(types.has("water_extractor")).toBe(false);
    expect(view.rough.some(Boolean)).toBe(true);
    expect(view.buildings.some((b) => !b.operable)).toBe(true);
    expect(view.buildings.some((b) => b.operable)).toBe(true);
  });
});
