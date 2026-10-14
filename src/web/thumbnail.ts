/**
 * A world's look, for the title screen's planet and the worlds list's
 * thumbnails (Batch 27).
 *
 * Both read the world; neither writes it. The thumbnail is the software
 * renderer's planet - the one the golden frames pin - at list size, turned to
 * where the player left the globe, on the world's own terrain.
 */

import type { SimState, Tuning, VisualChannels } from "../sim/index.js";
import { computeStep, deriveVisuals, simYear, stormIntensity } from "../sim/index.js";
import { createScene, renderScene } from "../render/planet.js";
import type { TerrainRotation } from "../shared/planet-terrain.js";
import { readWorld } from "./readout.js";

/** The planet's visual channels as they stand: what the globe draws for this world. */
export function planetLook(state: SimState, t: Tuning): VisualChannels {
  const d = readWorld(state, t).derived;
  const flows = computeStep(state, d, t, t.SUBSTEP_YEARS, null).flows;
  return deriveVisuals(state.reservoirs, d, flows, t, stormIntensity(state.seed, simYear(state, t), t));
}

/** Side of a thumbnail, pixels. */
export const THUMBNAIL_SIZE = 96;

/**
 * The globe as last seen, as a PNG data URL - or null where the page cannot
 * draw one (no 2D canvas), which the list shows as a blank disc.
 */
export function drawThumbnail(channels: VisualChannels, terrain: TerrainRotation, yaw: number): string | null {
  if (typeof document === "undefined") return null;
  const size = THUMBNAIL_SIZE;
  // The software renderer spins by +spin; the globe's convention is -yaw (see `Globe.drawFallback`).
  const frame = renderScene(createScene({ width: size, height: size, spin: -yaw / (2 * Math.PI), terrain, discScale: 0.46 }), channels);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return null;
  }
  if (ctx === null || typeof ImageData === "undefined") return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0);
  const url = canvas.toDataURL("image/png");
  return url.startsWith("data:image/png") ? url : null;
}
