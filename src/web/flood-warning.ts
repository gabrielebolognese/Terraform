/**
 * The flood's warning, in words (detail §4.4, Batch 25): "submersion begins
 * in ~14 yr, total loss in ~31 yr at current rate". Words, never colour alone,
 * so a warning reads the same to everyone.
 */

import type { FloodForecast, FloodReading, HabitatChannels, SimState, ThrottleReading, Tuning } from "../sim/index.js";
import { floodAlert, floodForecast, floodReading } from "../sim/index.js";

/** "~14 yr", or "under a year" - sim-years, as the HUD counts them. */
export function yearsWords(years: number): string {
  return years < 1 ? "under a year" : `~${Math.round(years).toLocaleString("en")} yr`;
}

/**
 * What the HUD says of a warned settlement, or null for one not warned. With
 * Batch 38, a city held by its grace says how long it is held; and with the
 * throttle forecast, what switching the planet's facilities off would buy it.
 */
export function floodWarning(forecast: FloodForecast | null, reading: FloodReading, warned: boolean, throttle: ThrottleReading | null = null): string | null {
  if (!warned || forecast === null) return null;
  const held = forecast.graceYears > 0 ? ` Nothing is lost to the sea for ${yearsWords(forecast.graceYears)}.` : "";
  const buys = throttleWords(throttle);
  // Under the sea and held there by its grace: a city found under the sea on loading (Batch 38).
  if (reading.state === "flooded") return `Under the sea: the water stands over the city.${held}${buys}`;
  const loss = forecast.yearsToDestroy === null ? null : `total loss in ${yearsWords(forecast.yearsToDestroy)} at current rate`;
  if (reading.state === "partial") return `Flooding: under water, ${loss ?? "the sea has stopped rising"}.${held}${buys}`;
  const under = forecast.yearsToBase === null ? "the sea has stopped rising" : `submersion begins in ${yearsWords(forecast.yearsToBase)}`;
  return `Flood warning: ${under}${loss === null ? "" : `, ${loss}`}.${held}${buys}`;
}

/**
 * The throttle link (Batch 38) in words: the years switching the planet's
 * facilities off would buy the city - from the projection, never this file's
 * arithmetic on a rate. Empty with no projection, or one the sea passes
 * neither way within its horizon.
 */
export function throttleWords(r: ThrottleReading | null): string {
  if (r === null || r.asIsYears === null) return "";
  if (r.throttledYears === null) return " Switching off the planet's facilities would keep the sea from it for the century ahead.";
  const bought = r.throttledYears - r.asIsYears;
  return bought <= 0 ? "" : ` Switching off the planet's facilities would buy ${yearsWords(bought)}.`;
}

/**
 * Every warned settlement's words, by id, as the HUD shows them - from the
 * simulation's own forecast and flood reading, never re-derived here.
 */
export function floodWarnings(
  state: SimState,
  env: HabitatChannels,
  liquidRatePerYear: number,
  t: Tuning,
  /** Batch 38: the throttle forecast for the cities warned, asked of the simulation; absent, none said. */
  throttle: ((ids: readonly string[]) => ReadonlyMap<string, ThrottleReading>) | null = null,
): Map<string, string> {
  const warned: { id: string; forecast: FloodForecast | null; reading: FloodReading }[] = [];
  for (const s of state.settlements) {
    const forecast = floodForecast(s, state.reservoirs, liquidRatePerYear, t);
    const reading = floodReading(s, env, t);
    if (floodAlert(forecast, reading, t)) warned.push({ id: s.id, forecast, reading });
  }
  const bought = throttle === null || warned.length === 0 ? null : throttle(warned.map((w) => w.id));
  const out = new Map<string, string>();
  for (const w of warned) {
    const words = floodWarning(w.forecast, w.reading, true, bought?.get(w.id) ?? null);
    if (words !== null) out.set(w.id, words);
  }
  return out;
}
