/**
 * Design doc §8.2 - offline progression.
 *
 * "Because the sim is a deterministic pure function, offline progression is
 * free: on load, compute elapsed = now - last_saved, convert to sim-years, and
 * advance the sim by that much before showing the planet."
 *
 * Free, but not unlimited. §8.2 read literally hands the whole game to someone
 * who does not play it: at TIME_SCALE 0.03 a 48-hour absence is worth 5184
 * sim-years against a full playthrough of 1710, so one weekend away would
 * finish the game three times over. That directly contradicts design goal #2,
 * "growth must be long, steady, and visible".
 *
 * So there are TWO caps, and they are not the same thing:
 *
 * - the WORK cap (`CATCHUP_MAX_SIM_YEARS`, already in `catchUp`) bounds how
 *   long the load screen can take. It is about milliseconds.
 * - the DESIGN cap here bounds how much of the GAME an absence is worth. It is
 *   about whether there is still a game to come back to.
 *
 * Everything in this file is pure: the current time is a parameter, never a
 * reading. That is what keeps offline catch-up reproducible, which is the one
 * property §8.2's whole design rests on.
 */

import { derive } from "./derive.js";
import { worldEnv } from "./integrate.js";
import { computeProgress } from "./progress.js";
import type { SaveFile } from "./save.js";
import { fromSave } from "./save.js";
import type { SimConfig } from "./integrate.js";
import { catchUp } from "./tick.js";
import type { Tuning } from "./tuning.js";
import type { Phase, SimState } from "./types.js";
import { NEUTRAL_ENV, PHASE_ORDER } from "./types.js";
import { PHASE_INFO } from "./phase.js";

export type GrantLimit = "none" | "absence-cap" | "work-cap";

export interface OfflineGrant {
  /** What actually elapsed on the wall clock, clamped at zero. */
  readonly elapsedRealSeconds: number;
  /** What the absence is worth in sim-years, after both caps. */
  readonly grantedSimYears: number;
  /** What the absence would have been worth at the live rate, for the UI to be honest about. */
  readonly uncappedSimYears: number;
  readonly limitedBy: GrantLimit;
}

/**
 * How much of the game an absence buys.
 *
 * Two knobs, both deliberate:
 *
 * - `OFFLINE_CAP_HOURS` - only the first stretch of an absence counts at all.
 *   Being away for a week is worth no more than being away overnight.
 * - `OFFLINE_RATE_FACTOR` - the sim runs slower while nobody is watching, so
 *   playing is strictly better than not playing.
 *
 * A negative elapsed time is clamped rather than rejected. Clocks go backwards
 * - daylight saving, an NTP correction, a user changing the system date - and
 * none of those should brick a save.
 */
export function offlineGrant(elapsedRealSeconds: number, t: Tuning): OfflineGrant {
  const elapsed = Number.isFinite(elapsedRealSeconds) ? Math.max(0, elapsedRealSeconds) : 0;
  const uncapped = elapsed * t.TIME_SCALE;

  const capSeconds = Math.max(0, t.OFFLINE_CAP_HOURS) * 3600;
  const counted = Math.min(elapsed, capSeconds);
  let granted = counted * t.TIME_SCALE * Math.max(0, t.OFFLINE_RATE_FACTOR);

  let limitedBy: GrantLimit = elapsed > capSeconds ? "absence-cap" : "none";
  if (granted > t.CATCHUP_MAX_SIM_YEARS) {
    granted = t.CATCHUP_MAX_SIM_YEARS;
    limitedBy = "work-cap";
  }

  return { elapsedRealSeconds: elapsed, grantedSimYears: granted, uncappedSimYears: uncapped, limitedBy };
}

// ---------------------------------------------------------------------------
// "While you were away"
// ---------------------------------------------------------------------------

export interface AwayDeltas {
  readonly T: number;
  readonly P: number;
  readonly o2: number;
  readonly biomass: number;
  readonly oceanFrac: number;
  readonly progress: number;
  /** Batch 24: settlements the sea declared lost while the player was away, by id. */
  readonly settlementsLost: readonly string[];
  /** Buildings the water took from settlements still standing. */
  readonly buildingsLost: number;
}

export interface AwaySummary {
  readonly simYears: number;
  /** Milestones crossed while away, in order. Usually empty; that is fine. */
  readonly phasesGained: readonly Phase[];
  readonly deltas: AwayDeltas;
  /** One line for the player, picking whatever actually changed most. */
  readonly headline: string;
}

/**
 * Describe what changed across an absence.
 *
 * Both states are re-derived rather than compared on stored values, because
 * §11 stores no derived values at all - which is the point of storing none.
 */
export function summariseAway(before: SimState, after: SimState, t: Tuning): AwaySummary {
  const look = (s: SimState) => {
    // The world's own environment, weather included - the one `advance` used.
    const d = derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t);
    return { d, progress: computeProgress(s.reservoirs, d, t).progress };
  };
  const a = look(before);
  const b = look(after);

  const phasesGained = PHASE_ORDER.filter((p) => p > before.phaseReached && p <= after.phaseReached);
  const simYears = (after.steps - before.steps) * t.SUBSTEP_YEARS;

  const deltas: AwayDeltas = {
    T: b.d.T - a.d.T,
    P: b.d.P - a.d.P,
    o2: after.reservoirs.o2 - before.reservoirs.o2,
    biomass: after.reservoirs.biomass - before.reservoirs.biomass,
    oceanFrac: b.d.oceanFrac - a.d.oceanFrac,
    progress: b.progress - a.progress,
    settlementsLost: after.settlements
      .filter((s) => s.lostAtSeaLevelM !== null && before.settlements.find((x) => x.id === s.id)?.lostAtSeaLevelM === null)
      .map((s) => s.id),
    // Nothing but the water removes a building while the player is away.
    buildingsLost: after.settlements
      .filter((s) => s.lostAtSeaLevelM === null)
      .reduce((n, s) => n + Math.max(0, (before.settlements.find((x) => x.id === s.id)?.buildings.length ?? 0) - s.buildings.length), 0),
  };

  return { simYears, phasesGained, deltas, headline: headlineFor(simYears, phasesGained, deltas) };
}

function headlineFor(simYears: number, phasesGained: readonly Phase[], d: AwayDeltas): string {
  const years = `${simYears.toFixed(0)} sim-year${simYears === 1 ? "" : "s"} passed`;

  // Detail §4.7: "The 'while you were away' summary should call this out
  // prominently." A loss outranks even a milestone.
  if (d.settlementsLost.length > 0) {
    const n = d.settlementsLost.length;
    return `${years}. The sea rose over ${n === 1 ? "a settlement" : `${n} settlements`} - lost.`;
  }
  if (d.buildingsLost > 0) {
    return `${years}. Rising water took ${d.buildingsLost} building${d.buildingsLost === 1 ? "" : "s"}.`;
  }
  // A milestone always wins otherwise: it is the thing the player came back for.
  const latest = phasesGained[phasesGained.length - 1];
  if (latest !== undefined) {
    return `${years}. The world reached ${PHASE_INFO[latest].name}.`;
  }
  if (Math.abs(d.T) >= 1) {
    return `${years}. The planet ${d.T > 0 ? "warmed" : "cooled"} by ${Math.abs(d.T).toFixed(1)} K.`;
  }
  if (Math.abs(d.o2) >= 1) {
    return `${years}. Oxygen ${d.o2 > 0 ? "rose" : "fell"} by ${Math.abs(d.o2).toFixed(1)} mbar.`;
  }
  if (Math.abs(d.P) >= 1) {
    return `${years}. The atmosphere ${d.P > 0 ? "thickened" : "thinned"} by ${Math.abs(d.P).toFixed(1)} mbar.`;
  }
  if (simYears <= 0) return "No time passed.";
  return `${years}. Little changed.`;
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export interface ResumeResult {
  readonly state: SimState;
  readonly grant: OfflineGrant;
  readonly summary: AwaySummary;
}

/**
 * Load a save and advance it by whatever the absence was worth.
 *
 * `nowEpochMs` is a parameter, not a reading, so this is testable with an
 * injected clock - which the exit gate for this batch asks for and which is
 * the only version that can run in CI.
 */
export function resume(raw: unknown, nowEpochMs: number, cfg: SimConfig): ResumeResult {
  const t = cfg.tuning;
  const loaded = fromSave(raw, t);
  const savedAt = savedAtEpochMs(raw);

  const elapsedSeconds = savedAt === null ? 0 : (nowEpochMs - savedAt) / 1000;
  const grant = offlineGrant(elapsedSeconds, t);
  const advanced = catchUp(loaded, grant.grantedSimYears, cfg);

  return { state: advanced, grant, summary: summariseAway(loaded, advanced, t) };
}

/**
 * When the save says it was written, as epoch milliseconds.
 *
 * `Date.parse` on an ISO-8601 string is a pure, well-specified function of its
 * input - it reads no clock, so it does not break the determinism the rest of
 * this file exists to protect. An unparseable timestamp yields no elapsed time
 * rather than an error: a save with a mangled date is still a playable save.
 */
function savedAtEpochMs(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = (raw as Partial<SaveFile>).last_saved_real;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
