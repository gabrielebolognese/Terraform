/**
 * Batch 6's exit gate: twelve committed PNGs, compared per pixel.
 *
 * This is the only test in the project that asserts on how the game LOOKS, and
 * it does it the only way a test can - by pinning the picture and shouting when
 * it moves. It cannot tell a good planet from a bad one. What it can do is make
 * every change to the look deliberate: nobody adjusts a cloud threshold and
 * finds out three batches later that the early game turned grey.
 *
 * It spans both halves of the §9 contract on purpose. The frames come from the
 * reference playthrough, so a BALANCE change that alters the arc churns them
 * too - which is correct and is the point. A tuning change that moves what the
 * planet looks like at 40% done is exactly the kind of change that should have
 * to be looked at before it lands.
 *
 * When a diff is intended: run `npm run sim:frames`, LOOK at
 * docs/frames/contact-sheet.png, and commit the new frames with the reason.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { frameDifference } from "../render/planet.js";
import { DEFAULT_TUNING } from "../sim/index.js";
import { FRAMES_DIR, GOLDEN_PROGRESS, planetStall, referenceFrames, renderReference } from "./frames.js";
import { REFERENCE_POLICY } from "./policy.js";
import { runTrajectory } from "./run.js";
import { MAX_STALL_MINUTES } from "./score.js";
import { decodePng } from "./png.js";

/**
 * Mean absolute per-channel difference, as a fraction of full scale.
 *
 * The build plan named 2%. That number was written before anything had been
 * measured, and it is useless as a gate - three deliberate regressions were
 * injected to check, and ALL THREE passed at 2%:
 *
 *   rock colour 3% redder          0.068%
 *   ocean threshold moved by 0.02  0.077%
 *   cloud edge softened 0.26->0.30 0.356%
 *
 * The real scale is set by the fact that an unmodified render reproduces the
 * committed PNGs EXACTLY - 0.0000%, not approximately. So the only thing the
 * tolerance has to absorb is a platform difference in the last ulp of a trig
 * call, which can flip a pixel that sits precisely on a smoothstep edge; at
 * 128x128 a few dozen such pixels come to about 0.0004%.
 *
 * 0.2% sits ~500x above that noise floor and still catches the smallest
 * change that is actually visible. It deliberately lets the two sub-0.1%
 * tweaks through: at a mean of well under one 255-level per pixel, those are
 * below what a screen can show.
 */
const TOLERANCE = 0.002;

/**
 * The change one sampled step of the arc - about 8% of the progress bar - has
 * to produce. A mean of 1% of full scale across every pixel is a low bar; it
 * is roughly "a tenth of the planet shifted by a tenth of its brightness".
 */
const VISIBLE_STEP = 0.01;

/**
 * There used to be a KNOWN_FLAT quarantine here: steps 7->8, 8->9 and 9->10
 * (sim-years 944 to 1756) measured 0.0094, 0.0083 and 0.0042 and were
 * excused as "a PACING finding, not a renderer one: the channels themselves
 * are flat there". That diagnosis was wrong. Across that stretch `skyColour`
 * travels from grey (0.75, 0.75, 0.75) to blue (0.43, 0.60, 0.85) - most of
 * the palette - and the renderer drew it only in a `(1 - z)^2` limb glow.
 * Batch 11 added disc-wide haze and reshaped the sky curve; the three steps
 * are now 0.0182, 0.0120 and 0.0110, and the quarantine is gone. Every step
 * is held to VISIBLE_STEP below with no exceptions.
 */

const frames = referenceFrames();

describe("golden frames", () => {
  it("has a committed PNG for every sampled point on the arc", () => {
    const missing = frames.filter((frame) => !existsSync(join(FRAMES_DIR, frame.name))).map((frame) => frame.name);
    expect(missing, `run \`npm run sim:frames\` to generate: ${missing.join(", ")}`).toEqual([]);
  });

  it.each(frames.map((frame) => [frame.name, frame] as const))("%s matches its golden", (_name, frame) => {
    const path = join(FRAMES_DIR, frame.name);
    if (!existsSync(path)) return; // reported by the test above

    const golden = decodePng(readFileSync(path));
    const rendered = renderReference(frame);

    expect(golden.width).toBe(rendered.width);
    expect(golden.height).toBe(rendered.height);

    const difference = frameDifference(golden, rendered);
    expect(
      difference,
      `${frame.name} differs by ${(difference * 100).toFixed(2)}% - if that is intended, ` +
        `run \`npm run sim:frames\` and check docs/frames/contact-sheet.png`,
    ).toBeLessThanOrEqual(TOLERANCE);
  });

  it("round-trips through the PNG encoder without losing a byte", () => {
    // If this fails, every comparison above is measuring the codec.
    const rendered = renderReference(frames[0]!);
    const golden = decodePng(readFileSync(join(FRAMES_DIR, frames[0]!.name)));
    expect(frameDifference(golden, rendered)).toBeLessThan(TOLERANCE);
    expect(golden.pixels.length).toBe(rendered.pixels.length);
  });
});

/**
 * The frames exist to show the planet changing. A set of twelve that all look
 * the same would pass every comparison above and mean nothing.
 */
describe("the arc actually moves", () => {
  it("samples twelve distinct points", () => {
    expect(frames).toHaveLength(GOLDEN_PROGRESS.length);
    expect(new Set(frames.map((frame) => frame.year)).size).toBe(frames.length);
  });

  it("changes visibly between every consecutive pair", () => {
    const rendered = frames.map((frame) => renderReference(frame));
    const stalled: string[] = [];
    for (let i = 1; i < rendered.length; i += 1) {
      const delta = frameDifference(rendered[i - 1]!, rendered[i]!);
      if (delta < VISIBLE_STEP) stalled.push(`${frames[i - 1]!.name} -> ${frames[i]!.name}: ${delta.toFixed(4)}`);
    }
    expect(stalled, `consecutive frames too similar: ${stalled.join("; ")}`).toEqual([]);
  });

  it("ends somewhere completely different from where it started", () => {
    const first = renderReference(frames[0]!);
    const last = renderReference(frames[frames.length - 1]!);
    expect(frameDifference(first, last)).toBeGreaterThan(0.15);
  });
});

/**
 * §8.2's planet-side requirement: "a visible change to the planet at least
 * every few real minutes at 1x". Batch 11 is the first time it was measured.
 */
describe("the planet keeps visibly changing (§8.2)", () => {
  const stall = planetStall(runTrajectory(REFERENCE_POLICY, 2400, 2, DEFAULT_TUNING), DEFAULT_TUNING.TIME_SCALE);

  it("measures the whole playthrough, not a truncated window of it", () => {
    expect(stall.reachedWin).toBe(true);
  });

  it("has an instrument that actually sees the planet change", () => {
    // Measured 113. A renderer that drew nothing, or an instrument comparing a
    // frame with itself, would report one enormous stall and no changes.
    expect(stall.changes).toBeGreaterThan(50);
  });

  it("records the stall that is still above the section 8.2 limit", () => {
    /**
     * Pinned honestly rather than passed, like the progress bar's in
     * golden.test.ts. Measured 55.6 real minutes before Batch 11 (years
     * 1584-1684) and 31.1 after (years 1386-1442): the oxygen tail changes the
     * atmosphere's composition over centuries, and at TIME_SCALE 0.03 even a
     * planet that shows all of it moves by the visible threshold only about
     * every half hour. What is left is a pacing problem, not a drawing one.
     * The bound is the measurement plus two sampling steps; if it grows, the
     * look regressed.
     */
    expect(stall.minutes).toBeGreaterThan(MAX_STALL_MINUTES);
    expect(stall.minutes, `planet frozen from year ${stall.fromYear} to ${stall.toYear}`).toBeLessThan(33.5);
  });
});
