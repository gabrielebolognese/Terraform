/**
 * How a settlement is named and located on screen - one place, so the marker
 * on the globe and the row in the HUD always say the same thing.
 */

import type { Settlement } from "../sim/index.js";

/** "City 1", "Outpost 2" - the number is the one in the settlement's id. */
export function settlementLabel(s: Settlement): string {
  // Named at founding or in the planner (at the user's request), the name is the label.
  if (s.name !== "") return s.name;
  const n = /(\d+)$/.exec(s.id)?.[1] ?? "?";
  return `${s.kind === "city" ? "City" : s.kind === "metropolis" ? "Metropolis" : "Outpost"} ${n}`;
}

/** "12.3°N 45.6°E" - north for positive latitude, east for positive longitude (see tangentFrame). */
export function formatLatLon(lat: number, lon: number): string {
  const deg = (r: number): string => (Math.abs(r) * (180 / Math.PI)).toFixed(1);
  return `${deg(lat)}°${lat >= 0 ? "N" : "S"} ${deg(lon)}°${lon >= 0 ? "E" : "W"}`;
}

/**
 * Metres for the player: whole metres with thousands grouped (-3,120 m), or
 * one decimal and an explicit sign for a local height (+3.2 m). Written out
 * rather than `toLocaleString`, so it reads the same on every machine.
 */
export function formatMetres(m: number, local = false): string {
  if (local) {
    const tenths = Math.round(m * 10) / 10;
    const sign = tenths < 0 ? "\u2212" : tenths > 0 ? "+" : "";
    return `${sign}${Math.abs(tenths).toFixed(1)} m`;
  }
  const sign = m < 0 ? "\u2212" : "";
  const whole = String(Math.round(Math.abs(m))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${Math.round(m) === 0 ? "" : sign}${whole} m`;
}
