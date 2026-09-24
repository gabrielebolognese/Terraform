/**
 * Pacing metrics and the score the balance sweep ranks on.
 *
 * Design doc §0 states the pacing target in prose: "an S-curve, not a straight
 * line and not a wall. Slow, legible start. An accelerating middle once
 * feedback loops ignite. A long tail as the world settles toward Earth-like.
 * At no point should the player stare at a frozen bar, and at no point should
 * the planet flip from dead to alive in one step."
 *
 * This file is that paragraph, as numbers. Everything here reads a completed
 * trajectory; nothing here changes the simulation.
 *
 * TWO TRAJECTORIES ARE SCORED, NOT ONE. The reference run must reach Phase 6
 * inside the target window, and the null-policy run must still be dead. The
 * second is the one that matters: without it, a retune can quietly hand the
 * game back to the planet and every headline number still looks good.
 */

import type { ProgressAxes, SimState, Tuning } from "../sim/index.js";
import { PHASE_ORDER, TARGETS, logDescent, totalCarbonMbar } from "../sim/index.js";
import type { RunResult } from "./run.js";

/** Progress change below this over a window counts as "the bar is not moving". */
export const STALL_EPSILON = 0.002;

/** §8.2: "the bar should never sit still for more than a few minutes". */
export const MAX_STALL_MINUTES = 5;

/** §8.2: "on the order of tens of real hours". */
export const TARGET_HOURS_LO = 12;
export const TARGET_HOURS_HI = 60;

/** Where the carbon ended up, which is what the endgame turns on. */
export interface CarbonBudget {
  readonly inReservoirs: number;
  readonly fixedInBiosphere: number;
  readonly lostToSpace: number;
  readonly sequestered: number;
  readonly total: number;
  /** mbar of carbon that reaching the §2.3 oxygen target costs, at the model's stoichiometry. */
  readonly costOfOxygenTarget: number;
}

export interface PacingMetrics {
  readonly reachedPhase6: boolean;
  readonly yearsToPhase6: number | null;
  readonly realHoursToPhase6: number | null;
  readonly phaseYears: readonly (number | null)[];
  /** Longest stretch with no visible progress movement, in real minutes at 1x. */
  readonly longestStallMinutes: number;
  /** Where that stall sits, in sim-years. Knowing WHICH stretch is frozen is the whole diagnosis. */
  readonly longestStallFrom: number;
  readonly longestStallTo: number;
  /** Share of the run taken by the single slowest phase. 1/7 is perfectly even. */
  readonly worstPhaseShare: number;
  /** Share of total progress gained in the first fifth of the run. Small = slow legible start. */
  readonly openingShare: number;
  /** Share gained in the middle two fifths. Largest = accelerating middle. */
  readonly middleShare: number;
  readonly peakT: number;
  readonly finalT: number;
  readonly finalProgress: number;
  readonly finalAxes: ProgressAxes;
  /** Progress change over the last tenth of the run. Near zero = settled. */
  readonly endDrift: number;
  /** Biomass change over the last tenth. Negative = the biosphere is dying at the end. */
  readonly endBiomassDrift: number;
  readonly carbon: CarbonBudget;
}

export interface ScorePart {
  readonly name: string;
  readonly value: number;
  readonly weight: number;
  readonly note: string;
}

export interface PacingScore {
  /** 0..1. Zero if any hard gate failed. */
  readonly total: number;
  readonly parts: readonly ScorePart[];
  /** Hard-gate violations. A variant with any of these is not shippable at any score. */
  readonly failures: readonly string[];
  readonly metrics: PacingMetrics;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** 1 inside [lo, hi], falling off linearly over `soft` either side. */
function band(x: number, lo: number, hi: number, soft: number): number {
  if (x >= lo && x <= hi) return 1;
  const distance = x < lo ? lo - x : x - hi;
  return clamp01(1 - distance / Math.max(soft, 1e-9));
}

export function carbonBudget(state: SimState): CarbonBudget {
  const l = state.ledger;
  const inReservoirs = totalCarbonMbar(state.reservoirs);
  const total = inReservoirs + l.c_fixed + l.c_lost + l.c_sequestered - l.c_imported;
  return {
    inReservoirs,
    fixedInBiosphere: l.c_fixed,
    lostToSpace: l.c_lost,
    sequestered: l.c_sequestered,
    total,
    // Photosynthesis is one mole of O2 per mole of CO2, and an mbar is
    // proportional to mass, so the carbon price of the oxygen target is fixed
    // by stoichiometry and cannot be tuned away.
    costOfOxygenTarget: TARGETS.o2.target * (44 / 32),
  };
}

export function measure(reference: RunResult, t: Tuning): PacingMetrics {
  const samples = reference.samples;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (first === undefined || last === undefined) {
    throw new RangeError("measure: the reference run produced no samples");
  }

  const yearsToPhase6 = reference.phaseTimes[6] ?? null;

  /**
   * The PLAYTHROUGH window, which is not the observation window.
   *
   * The harness runs past Phase 6 deliberately, to check the end state settles
   * rather than drifting. Measuring pacing over the whole observation window
   * counts that post-victory idle as a stall and squashes the S-curve shares
   * toward the front - which it did: the run reported a 679-minute "stall"
   * that was entirely years 2982-4000, after the game was already won.
   *
   * Pacing is about the player's experience while still playing, so it is
   * measured over [0, Phase 6]. Settling is measured over the tail instead.
   */
  const endYear = yearsToPhase6 ?? last.year;
  const played = samples.filter((s) => s.year <= endYear);
  const playedLast = played[played.length - 1] ?? last;
  const totalYears = Math.max(endYear - first.year, 1);

  // --- stalls: the longest window over which the bar does not visibly move.
  let longestStallYears = 0;
  let longestStallFrom = 0;
  let longestStallTo = 0;
  let windowStart = 0;
  const noteStall = (fromYear: number, toYear: number): void => {
    if (toYear - fromYear > longestStallYears) {
      longestStallYears = toYear - fromYear;
      longestStallFrom = fromYear;
      longestStallTo = toYear;
    }
  };
  for (let i = 1; i < played.length; i += 1) {
    const here = played[i];
    const anchor = played[windowStart];
    if (here === undefined || anchor === undefined) continue;
    if (Math.abs(here.progress - anchor.progress) >= STALL_EPSILON) {
      noteStall(anchor.year, here.year);
      windowStart = i;
    }
  }
  // A run that never finishes moving has been stalled since the last movement.
  noteStall(played[windowStart]?.year ?? 0, playedLast.year);
  const longestStallMinutes = longestStallYears / t.TIME_SCALE / 60;

  // --- phase spacing: no single phase of THE CLIMB should swallow the run.
  //
  // The final phase is excluded deliberately. §0 asks for "a long tail as the
  // world settles toward Earth-like", so penalising the settling phase for
  // being long would score against the stated design goal. Whether the tail is
  // BORING is a different question, and the stall metric already answers it.
  let worstPhaseShare = 0;
  for (let p = 1; p < PHASE_ORDER.length - 1; p += 1) {
    const entered = reference.phaseTimes[p];
    const previous = reference.phaseTimes[p - 1];
    if (entered === null || entered === undefined || previous === null || previous === undefined) continue;
    worstPhaseShare = Math.max(worstPhaseShare, (entered - previous) / Math.max(totalYears, 1));
  }

  // --- S-curve shape, as shares of the total progress gained.
  const gained = Math.max(playedLast.progress - first.progress, 1e-9);
  const at = (fraction: number): number => {
    const target = first.year + fraction * totalYears;
    let best = first;
    for (const s of played) {
      if (s.year <= target) best = s;
      else break;
    }
    return best.progress;
  };
  const openingShare = (at(0.2) - first.progress) / gained;
  const middleShare = (at(0.6) - at(0.2)) / gained;

  let peakT = -Infinity;
  for (const s of samples) peakT = Math.max(peakT, s.T);

  // Settling IS measured over the tail of the observation window: "does the
  // world hold together after you win" is exactly what the tail is for.

  const tenth = samples[Math.max(0, samples.length - 1 - Math.floor(samples.length / 10))] ?? first;

  return {
    reachedPhase6: yearsToPhase6 !== null,
    yearsToPhase6,
    realHoursToPhase6: yearsToPhase6 === null ? null : yearsToPhase6 / t.TIME_SCALE / 3600,
    phaseYears: reference.phaseTimes,
    longestStallMinutes,
    longestStallFrom,
    longestStallTo,
    worstPhaseShare,
    openingShare,
    middleShare,
    peakT,
    finalT: last.T,
    finalProgress: last.progress,
    finalAxes: {
      nT: clamp01((last.T - TARGETS.T.progLo) / (TARGETS.T.target - TARGETS.T.progLo)),
      nP: clamp01(last.P / TARGETS.P.target),
      nO2: clamp01(last.o2 / TARGETS.o2.target),
      nWater: clamp01(last.oceanFrac / TARGETS.ocean.target),
      nBio: clamp01(last.biomass / TARGETS.biomass.target),
      nCO2: logDescent(
        Math.max(0, last.co2_atm) * (TARGETS.P.target / Math.max(last.P, t.P_EPS)),
        TARGETS.co2_atm.target,
        t.CO2_PROG_HI,
      ),
    },
    endDrift: last.progress - tenth.progress,
    endBiomassDrift: last.biomass - tenth.biomass,
    carbon: carbonBudget(reference.finalState),
  };
}

/**
 * Score a tuning variant from its two trajectories.
 *
 * The hard gates are separate from the score on purpose. A variant that fails
 * one is not a low-scoring variant, it is a broken one, and averaging it into
 * a number invites a sweep to trade the control away for a prettier curve.
 */
export function score(reference: RunResult, nullRun: RunResult, t: Tuning): PacingScore {
  const m = measure(reference, t);
  const failures: string[] = [];

  // --- hard gate 1: an untouched Mars must stay dead.
  const nullLast = nullRun.samples[nullRun.samples.length - 1];
  const nullPhase = nullLast?.phase ?? 0;
  if (nullPhase > 1) {
    failures.push(`null-policy Mars reached Phase ${nullPhase} unaided - the planet is terraforming itself`);
  }

  // --- hard gate 2: the player must be able to finish.
  if (!m.reachedPhase6) failures.push("the reference playthrough never reaches Phase 6");

  // --- hard gate 3: no Venus, and no dead biosphere at the end.
  if (m.peakT > 340) failures.push(`runaway heating: peak T ${m.peakT.toFixed(1)} K`);
  if (m.finalAxes.nBio <= 0) failures.push("the biosphere is dead at the end of the run");

  const parts: ScorePart[] = [
    {
      name: "duration",
      value: m.realHoursToPhase6 === null ? 0 : band(m.realHoursToPhase6, TARGET_HOURS_LO, TARGET_HOURS_HI, 20),
      weight: 1,
      note: `${m.realHoursToPhase6?.toFixed(1) ?? "-"} real hours at 1x (target ${TARGET_HOURS_LO}-${TARGET_HOURS_HI})`,
    },
    {
      name: "no-stall",
      value: band(m.longestStallMinutes, 0, MAX_STALL_MINUTES, MAX_STALL_MINUTES * 4),
      weight: 1.5,
      note:
        `longest stall ${m.longestStallMinutes.toFixed(1)} real min (limit ${MAX_STALL_MINUTES}), ` +
        `years ${m.longestStallFrom.toFixed(0)}-${m.longestStallTo.toFixed(0)}`,
    },
    {
      name: "phase-spacing",
      value: band(m.worstPhaseShare, 0, 0.35, 0.4),
      weight: 1,
      note: `slowest climb phase takes ${(m.worstPhaseShare * 100).toFixed(0)}% of the playthrough`,
    },
    {
      name: "slow-start",
      value: band(m.openingShare, 0, 0.2, 0.3),
      weight: 0.75,
      note: `${(m.openingShare * 100).toFixed(0)}% of progress in the first fifth`,
    },
    {
      name: "accelerating-middle",
      value: clamp01((m.middleShare - m.openingShare) * 3),
      weight: 0.75,
      note: `middle two fifths gain ${(m.middleShare * 100).toFixed(0)}%`,
    },
    {
      name: "lands-in-band",
      value:
        (band(m.finalT, TARGETS.T.target - 3, TARGETS.T.target + 3, 12) +
          m.finalAxes.nO2 +
          m.finalAxes.nBio +
          m.finalAxes.nWater +
          m.finalAxes.nCO2) /
        5,
      weight: 2,
      note:
        `T ${m.finalT.toFixed(1)}K, o2 ${(m.finalAxes.nO2 * 100).toFixed(0)}%, ` +
        `bio ${(m.finalAxes.nBio * 100).toFixed(0)}%, co2 ${(m.finalAxes.nCO2 * 100).toFixed(0)}% of target`,
    },
    {
      name: "settles",
      value: band(m.endBiomassDrift, -0.01, 1, 0.1),
      weight: 1,
      note: `biomass drifts ${m.endBiomassDrift >= 0 ? "+" : ""}${m.endBiomassDrift.toFixed(3)} over the last tenth`,
    },
    {
      name: "final-progress",
      value: m.finalProgress,
      weight: 2,
      note: `progress ends at ${m.finalProgress.toFixed(3)}`,
    },
  ];

  let weighted = 0;
  let weights = 0;
  for (const p of parts) {
    weighted += p.value * p.weight;
    weights += p.weight;
  }

  return {
    total: failures.length > 0 ? 0 : clamp01(weighted / Math.max(weights, 1e-9)),
    parts,
    failures,
    metrics: m,
  };
}

export function formatScore(label: string, s: PacingScore): string {
  const lines = [`${label}  score ${s.total.toFixed(4)}`];
  for (const p of s.parts) {
    const bar = "#".repeat(Math.round(p.value * 20)).padEnd(20, ".");
    lines.push(`  ${p.name.padEnd(20)} ${bar} ${p.value.toFixed(2)}  ${p.note}`);
  }
  for (const f of s.failures) lines.push(`  FAIL: ${f}`);
  return lines.join("\n");
}
