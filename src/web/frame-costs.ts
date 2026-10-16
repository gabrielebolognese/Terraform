/**
 * What a city frame costs on this machine (Batch 36: "the detail level ...
 * shown with the frame time they cost").
 *
 * An unattended build cannot time a browser, and a number measured on one
 * machine says little about another, so the game times itself: each city
 * frame's drawing, kept per level of detail and per effects on or off, as an
 * average that follows the latest frames. The settings show what has been
 * measured this session, and say so when a level has not been drawn yet.
 */

import type { CityQuality } from "../render/city.js";

export type CostKey = `${CityQuality}${"" | "-still"}`;

/** How much a new frame moves the average: about the last 30 frames count. */
const FOLLOW = 1 / 30;

export class FrameCosts {
  private readonly mean = new Map<CostKey, { ms: number; frames: number }>();

  /** One frame drawn at `quality`, with or without its moving details, in `ms`. */
  record(quality: CityQuality, effects: boolean, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const key: CostKey = effects ? quality : `${quality}-still`;
    const m = this.mean.get(key);
    if (m === undefined) this.mean.set(key, { ms, frames: 1 });
    else this.mean.set(key, { ms: m.ms + (ms - m.ms) * Math.max(FOLLOW, 1 / (m.frames + 1)), frames: m.frames + 1 });
  }

  /** The average at that level, or null if none has been drawn this session. */
  of(quality: CityQuality, effects = true): number | null {
    return this.mean.get(effects ? quality : `${quality}-still`)?.ms ?? null;
  }

  /** Frames measured at that level. */
  frames(quality: CityQuality, effects = true): number {
    return this.mean.get(effects ? quality : `${quality}-still`)?.frames ?? 0;
  }
}

/** A cost as the settings say it. */
export function costWords(ms: number | null): string {
  if (ms === null) return "not measured yet - open a city";
  return `about ${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms a frame here`;
}
