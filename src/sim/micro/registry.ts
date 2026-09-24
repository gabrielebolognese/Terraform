/**
 * Micro doc §9.1 and §2.3 step 1 - the settlement registry, and founding.
 *
 * "From orbit, the player picks a site (lat, lon) and founds a city or an
 * outpost. This is the one macro-initiated action, and it builds nothing: it
 * drops an empty settlement." So founding appends one record and changes
 * nothing else about the world - no reservoir, no facility, no money. The
 * coupling to the planet is Batch 18; until then a settlement is inert, and
 * the tests hold it to that.
 */

import type { Tuning } from "../tuning.js";
import { DEFAULT_TUNING } from "../tuning.js";
import type { Settlement, SettlementKind, SimState } from "../types.js";
import { newSettlement } from "./settlement.js";
import { wrapLongitude } from "./space.js";

export interface FoundOutcome {
  readonly state: SimState;
  readonly ok: boolean;
  readonly settlement: Settlement | null;
  /** Why it was refused, in the player's words. */
  readonly reason: string | null;
}

/**
 * Deterministic ids - `settlement-1`, `settlement-2`, ... - one past the
 * highest already used, so an id is never reused even if registry order
 * changes. Never random and never from the clock: invariant #1.
 */
function nextId(settlements: readonly Settlement[]): string {
  let highest = 0;
  for (const s of settlements) {
    const match = /^settlement-(\d+)$/.exec(s.id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return `settlement-${highest + 1}`;
}

export function foundSettlement(
  state: SimState,
  kind: SettlementKind,
  lat: number,
  lon: number,
  t: Tuning = DEFAULT_TUNING,
): FoundOutcome {
  const refuse = (reason: string): FoundOutcome => ({ state, ok: false, settlement: null, reason });
  if (kind !== "city" && kind !== "outpost" && kind !== "metropolis") return refuse(`"${String(kind)}" is not a kind of settlement.`);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return refuse("That is not a place on the planet.");
  if (Math.abs(lat) > Math.PI / 2) return refuse("That latitude is past a pole.");

  // Founding builds nothing, but it does land the section 2.3 step 2 stock.
  const settlement: Settlement = newSettlement(nextId(state.settlements), kind, lat, wrapLongitude(lon), t);
  return {
    state: { ...state, settlements: [...state.settlements, settlement] },
    ok: true,
    settlement,
    reason: null,
  };
}
