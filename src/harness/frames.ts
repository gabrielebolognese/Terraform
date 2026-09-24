/**
 * The twelve reference frames.
 *
 * `npm run sim:frames` renders them from the reference playthrough and writes
 * them to docs/frames/, plus a contact sheet showing the whole arc at once.
 * `golden-frames.test.ts` then holds the renderer to them per pixel.
 *
 * They are sampled at fixed PROGRESS values rather than fixed sim-years, so
 * they stay comparable when the balance batch moves the pacing: the pictures
 * are meant to answer "what does 40% done look like", not "what does year 700
 * look like".
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { VisualChannels } from "../sim/index.js";
import { DEFAULT_TUNING } from "../sim/index.js";
import type { Frame } from "../render/planet.js";
import { createScene, frameDifference, renderPlanet, renderScene } from "../render/planet.js";
import { encodePng } from "./png.js";
import { REFERENCE_POLICY } from "./policy.js";
import { runTrajectory } from "./run.js";
import type { RunResult } from "./run.js";

/** Twelve points across the arc, weighted toward the ends where the look changes fastest. */
/**
 * Starts at 0.12, not 0: `PROGRESS_FLOOR` is 0.1, so the bar reads 0.107 on a
 * dead Mars and any target below that resolves to year 0. The first two frames
 * were identical because of it.
 */
export const GOLDEN_PROGRESS = [0.12, 0.18, 0.24, 0.31, 0.38, 0.46, 0.55, 0.64, 0.73, 0.82, 0.9, 0.96] as const;

/** Small on purpose: twelve committed PNGs, and a per-pixel comparison wants to stay quick. */
export const GOLDEN_SIZE = 128;

export const FRAMES_DIR = join(dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..", "..", "docs", "frames");

export interface ReferenceFrame {
  readonly index: number;
  readonly progress: number;
  readonly year: number;
  readonly channels: VisualChannels;
  readonly name: string;
}

/** Rebuild the contract object from the flattened columns the harness records. */
export function channelsOf(sample: RunResult["samples"][number]): VisualChannels {
  return {
    capRadius: sample.capRadius,
    oceanCoverage: sample.oceanFrac,
    surfaceGreen: sample.vegFrac,
    atmosphereThickness: sample.atmoThickness,
    skyColour: { r: sample.skyR, g: sample.skyG, b: sample.skyB },
    cloudCover: sample.cloudFrac,
    surfaceTint: { r: sample.tintR, g: sample.tintG, b: sample.tintB },
    dustIntensity: sample.dustIntensity,
    clearFraction: sample.clearFraction,
  };
}

/**
 * The reference frames, derived from the reference playthrough.
 *
 * Pure and deterministic - the same tuning gives the same twelve frames, which
 * is what lets them be committed and compared rather than eyeballed.
 */
export function referenceFrames(): readonly ReferenceFrame[] {
  const run = runTrajectory(REFERENCE_POLICY, 2400, 2, DEFAULT_TUNING);

  return GOLDEN_PROGRESS.map((target, index) => {
    // First sample at or past the target, so a frame is a real state the run
    // actually passed through rather than an interpolation between two.
    const sample = run.samples.find((s) => s.progress >= target) ?? run.samples[run.samples.length - 1];
    if (sample === undefined) throw new Error("the reference run produced no samples");
    return {
      index,
      progress: target,
      year: sample.year,
      channels: channelsOf(sample),
      name: `frame-${String(index).padStart(2, "0")}-p${String(Math.round(target * 100)).padStart(2, "0")}.png`,
    };
  });
}

export function renderReference(frame: ReferenceFrame, size = GOLDEN_SIZE): Frame {
  // Spin fixed at zero: every frame shows the same hemisphere, so a difference
  // between two of them is a difference in the CHANNELS and nothing else.
  return renderPlanet(frame.channels, { width: size, height: size, spin: 0 });
}

/**
 * The smallest change between two renders that counts as the planet visibly
 * changing: `golden-frames.test.ts`'s TOLERANCE, which that file measured as
 * "the smallest change that is actually visible".
 */
export const PLANET_VISIBLE_CHANGE = 0.002;

export interface PlanetStall {
  readonly minutes: number;
  readonly fromYear: number;
  readonly toYear: number;
  /** How many times the picture moved by PLANET_VISIBLE_CHANGE. Zero means the instrument saw nothing. */
  readonly changes: number;
  /**
   * Whether the run reached Phase 6. When it did not, the stall is measured
   * over a truncated window and understates the real one (Batch 13: a
   * 1000-year run read 17.8 min, inside the pin's bounds).
   */
  readonly reachedWin: boolean;
}

/**
 * §8.2's OTHER pacing requirement, measured: "a visible change to the planet at
 * least every few real minutes at 1x".
 *
 * `score.ts` measures stalls on the progress BAR. Until Batch 11 nothing
 * measured the PLANET, and the two are different: the bar's worst stall was
 * 8.9 real minutes while the planet sat unchanged for 55.6. From each anchor
 * this walks forward until the render differs from the anchor's by
 * PLANET_VISIBLE_CHANGE, and reports the longest such wait over [0, Phase 6].
 *
 * Measured against the anchor, not frame-to-frame: a planet creeping by
 * 0.0005 per sample is changing, and should count once the creep adds up.
 */
export function planetStall(run: RunResult, timeScale: number, size = GOLDEN_SIZE): PlanetStall {
  const scene = createScene({ width: size, height: size, spin: 0 });
  const end = run.phaseTimes[6] ?? Infinity;
  const samples = run.samples.filter((s) => s.year <= end);
  const first = samples[0];
  if (first === undefined) throw new RangeError("planetStall: the run produced no samples");

  let anchor = first;
  let anchorImage = renderScene(scene, channelsOf(first));
  let longest = 0;
  let fromYear = first.year;
  let toYear = first.year;
  let changes = 0;
  const note = (from: number, to: number): void => {
    if (to - from > longest) {
      longest = to - from;
      fromYear = from;
      toYear = to;
    }
  };
  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i]!;
    const image = renderScene(scene, channelsOf(sample));
    if (frameDifference(anchorImage, image) >= PLANET_VISIBLE_CHANGE) {
      note(anchor.year, sample.year);
      anchor = sample;
      anchorImage = image;
      changes += 1;
    }
  }
  // A planet that never moves again has been stalled since it last did.
  note(anchor.year, samples[samples.length - 1]!.year);
  return { minutes: longest / timeScale / 60, fromYear, toYear, changes, reachedWin: run.phaseTimes[6] != null };
}

/** Tile the frames into one image, so the whole arc can be taken in at a glance. */
export function contactSheet(frames: readonly Frame[], columns = 4): Frame {
  const first = frames[0];
  if (first === undefined) throw new Error("no frames to tile");
  const rows = Math.ceil(frames.length / columns);
  const width = first.width * columns;
  const height = first.height * rows;
  const pixels = new Uint8ClampedArray(width * height * 4);

  frames.forEach((frame, i) => {
    const ox = (i % columns) * first.width;
    const oy = Math.floor(i / columns) * first.height;
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const from = (y * frame.width + x) * 4;
        const to = ((oy + y) * width + ox + x) * 4;
        for (let c = 0; c < 4; c += 1) pixels[to + c] = frame.pixels[from + c] ?? 0;
      }
    }
  });

  return { width, height, pixels };
}

function main(): void {
  const frames = referenceFrames();
  mkdirSync(FRAMES_DIR, { recursive: true });

  const rendered = frames.map((frame) => renderReference(frame));
  frames.forEach((frame, i) => {
    const image = rendered[i];
    if (image === undefined) return;
    writeFileSync(join(FRAMES_DIR, frame.name), encodePng(image));
    console.log(
      `  ${frame.name}  progress ${frame.progress.toFixed(2)}  year ${frame.year.toFixed(0)}  ` +
        `cap ${frame.channels.capRadius.toFixed(2)} ocean ${frame.channels.oceanCoverage.toFixed(2)} ` +
        `green ${frame.channels.surfaceGreen.toFixed(2)} air ${frame.channels.atmosphereThickness.toFixed(2)}`,
    );
  });

  // The sheet is rendered larger, because it is the one a human looks at.
  const sheet = contactSheet(frames.map((frame) => renderReference(frame, 200)));
  writeFileSync(join(FRAMES_DIR, "contact-sheet.png"), encodePng(sheet));
  console.log(`\n  contact-sheet.png  ${sheet.width}x${sheet.height}`);
  console.log(`\nwrote ${frames.length + 1} files to ${FRAMES_DIR}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
