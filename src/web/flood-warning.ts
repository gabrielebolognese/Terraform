/**
 * The flood's warning, in words (detail §4.4, Batch 25): "submersion begins
 * in ~14 yr, total loss in ~31 yr at current rate". Words, never colour alone,
 * so a warning reads the same to everyone.
 */

import type { FloodForecast, FloodReading, HabitatChannels, SimState, Tuning } from "../sim/index.js";
import { floodAlert, floodForecast, floodReading } from "../sim/index.js";

/** "~14 yr", or "under a year" - sim-years, as the HUD counts them. */
export function yearsWords(years: number): string {
  return years < 1 ? "under a year" : `~${Math.round(years).toLocaleString("en")} yr`;
}

/** What the HUD says of a warned settlement, or null for one not warned. */
export function floodWarning(forecast: FloodForecast | null, reading: FloodReading, warned: boolean): string | null {
  if (!warned || forecast === null) return null;
  const loss = forecast.yearsToDestroy === null ? null : `total loss in ${yearsWords(forecast.yearsToDestroy)} at current rate`;
  if (reading.state === "partial") return `Flooding: under water, ${loss ?? "the sea has stopped rising"}.`;
  const under = forecast.yearsToBase === null ? "the sea has stopped rising" : `submersion begins in ${yearsWords(forecast.yearsToBase)}`;
  return `Flood warning: ${under}${loss === null ? "" : `, ${loss}`}.`;
}

/**
 * Every warned settlement's words, by id, as the HUD shows them - from the
 * simulation's own forecast and flood reading, never re-derived here.
 */
export function floodWarnings(state: SimState, env: HabitatChannels, liquidRatePerYear: number, t: Tuning): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of state.settlements) {
    const forecast = floodForecast(s, state.reservoirs, liquidRatePerYear, t);
    const reading = floodReading(s, env, t);
    const words = floodWarning(forecast, reading, floodAlert(forecast, reading, t));
    if (words !== null) out.set(s.id, words);
  }
  return out;
}
