/**
 * How a settlement is named and located on screen - one place, so the marker
 * on the globe and the row in the HUD always say the same thing.
 */

import type { Settlement } from "../sim/index.js";

/** "City 1", "Outpost 2" - the number is the one in the settlement's id. */
export function settlementLabel(s: Settlement): string {
  const n = /(\d+)$/.exec(s.id)?.[1] ?? "?";
  return `${s.kind === "city" ? "City" : "Outpost"} ${n}`;
}

/** "12.3°N 45.6°E" - north for positive latitude, east for positive longitude (see tangentFrame). */
export function formatLatLon(lat: number, lon: number): string {
  const deg = (r: number): string => (Math.abs(r) * (180 / Math.PI)).toFixed(1);
  return `${deg(lat)}°${lat >= 0 ? "N" : "S"} ${deg(lon)}°${lon >= 0 ? "E" : "W"}`;
}
