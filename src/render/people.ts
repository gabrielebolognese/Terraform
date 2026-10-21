/**
 * People in the view (Batch 32): the crowd at a station or a park.
 *
 * A station or a park reaches the homes about it (the needs, in the
 * simulation); a share of the people in them are there at any moment, and
 * the city draws them a figure for every few. Display only: what the view
 * already carries (`reaches`), never the state.
 */

import type { CityBuildingView } from "../sim/index.js";

/** The share of the people a station or a park reaches who are there at a time. */
export const CROWD_SHARE = 0.02;
/** People one figure stands for. */
export const PEOPLE_PER_FIGURE = 5;
/** The most figures drawn at one place. */
export const MAX_FIGURES = 16;

/** The crowd at a running station or park, people; 0 anywhere else, and with needs off (no `reaches`). */
export function crowdAt(b: Pick<CityBuildingView, "type" | "operable" | "reaches">): number {
  if (!b.operable || b.reaches === undefined || (b.type !== "station" && b.type !== "park")) return 0;
  return Math.round(b.reaches * CROWD_SHARE);
}

/** How many figures the crowd is drawn as. */
export function figuresAt(b: Pick<CityBuildingView, "type" | "operable" | "reaches">): number {
  return Math.min(MAX_FIGURES, Math.ceil(crowdAt(b) / PEOPLE_PER_FIGURE));
}

/**
 * Where figure `i` of a crowd stands at `time`, in tiles from the building's
 * corner: along a station's two platforms, or a park's paths - each strolling
 * a little back and forth, from a place of its own.
 */
export function figureAt(type: "station" | "park", size: number, depth: number, i: number, time: number): { x: number; y: number } {
  // A seeded place of its own (a golden-ratio walk: spread out, never in a row).
  const u = (i * 0.618034 + 0.13) % 1;
  const sway = 0.15 * Math.sin(time * 0.6 + i * 1.7);
  if (type === "station") {
    // West platform, east platform, in turn; up and down the platform's length.
    const x = i % 2 === 0 ? 0.35 + 0.5 * ((i * 0.37) % 1) : size - 0.85 + 0.5 * ((i * 0.37) % 1);
    return { x, y: 0.5 + u * (depth - 2.2) + sway };
  }
  // A park: on its two crossing paths, strolling along them.
  const along = 0.3 + u * (size - 0.6) + sway;
  return i % 2 === 0 ? { x: along, y: size / 2 + 0.06 * ((i % 3) - 1) } : { x: size / 2 + 0.06 * ((i % 3) - 1), y: along };
}
