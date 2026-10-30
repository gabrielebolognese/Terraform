/**
 * Scripted runs to the end (Batch 39).
 *
 * The exit gate asks three things of the ending, and each is measured on a
 * run, not reasoned about:
 *
 * - the reference policy, scripted to the end, reaches victory at a measured
 *   real time under Batch 28's pacing (`playToVictory` with the Standard
 *   pace);
 * - the score is derived, and the same live or offline;
 * - every achievement is earned in some scripted run, and none in the first
 *   minute (`ENDING_RUNS`, each a run with the time every achievement came).
 *
 * A run to victory plays the planet by a fixed schedule (`policy.ts`), as the
 * golden run does, and may found settlements and act on them as it goes. It
 * never reads the ending back to steer: the achievements are what the play
 * happened to earn.
 */

import type { BuildingType, SimState, Tuning } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  advance,
  connectAll,
  evacuateSettlement,
  foundSettlement,
  gridTiles,
  liquidWaterRate,
  makeTuning,
  marsStart,
  nextSubstepFlows,
  placeBuilding,
  seedBiosphere,
  threatened,
  worldEnv,
} from "../sim/index.js";
import { tuningRecord, worldTuning } from "../web/game-tuning.js";
import type { BuildOrder, Policy } from "./policy.js";
import { REFERENCE_POLICY, applyOrdersDue } from "./policy.js";

export interface Site {
  readonly lat: number;
  readonly lon: number;
  readonly kind?: "city" | "outpost";
}

export interface VictoryRun {
  readonly state: SimState;
  /** Real seconds at 1x from the start to the victory (the substep it came on), or null if it did not come. */
  readonly victorySeconds: number | null;
  /** Each achievement earned, by id: real seconds at 1x from the start. */
  readonly earned: Readonly<Record<string, number>>;
}

export interface VictoryScript {
  /** Settlements founded on the first substep, in order (`settlement-1`, `settlement-2`, ...). */
  readonly found?: readonly Site[];
  /** Called before every substep with the state and the sim-year: what the player does then. */
  readonly act?: (s: SimState, year: number) => SimState;
  /** Sim-years to run past the victory (0: stop on it). */
  readonly after?: number;
}

/** Real seconds at 1x of a substep count. */
export function secondsOf(steps: number, t: Tuning): number {
  return (steps * t.SUBSTEP_YEARS) / t.TIME_SCALE;
}

/** The achievements a state has earned, by id, in real seconds at 1x. */
export function earnedSeconds(s: SimState, t: Tuning): Record<string, number> {
  return Object.fromEntries(s.ending.achievements.map((a) => [a.id, secondsOf(a.step, t)]));
}

/**
 * Play `policy` for at most `years` sim-years, stopping `script.after` years
 * past the victory. Orders and the seeding are applied on the substep their
 * year comes, the way the run harness places them.
 */
export function playToVictory(policy: Policy, t: Tuning, years: number, script: VictoryScript = {}): VictoryRun {
  const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };
  let s = marsStart(undefined, t);
  for (const site of script.found ?? []) {
    const o = foundSettlement(s, site.kind ?? "city", site.lat, site.lon, t);
    if (!o.ok) throw new Error(`could not found a settlement at ${site.lat}, ${site.lon}: ${o.reason}`);
    s = o.state;
  }
  const applied = new Set<number>();
  const total = Math.round(years / t.SUBSTEP_YEARS);
  let stopAt = total;
  for (let i = 0; i < stopAt; i += 1) {
    const year = s.steps * t.SUBSTEP_YEARS;
    s = applyOrdersDue(s, policy, year, applied, t);
    if (policy.seedAt >= 0 && !s.seeded && year >= policy.seedAt) s = seedBiosphere(s, t, worldEnv(s, NEUTRAL_ENV, t)).state;
    if (script.act !== undefined) s = script.act(s, year);
    const before = s.ending.victory;
    s = advance(s, 1, cfg);
    if (before === null && s.ending.victory !== null) stopAt = Math.min(total, i + 1 + Math.round((script.after ?? 0) / t.SUBSTEP_YEARS));
  }
  return { state: s, victorySeconds: s.ending.victory === null ? null : secondsOf(s.ending.victory, t), earned: earnedSeconds(s, t) };
}

// ---------------------------------------------------------------------------
// The scripted runs that earn the achievements
// ---------------------------------------------------------------------------

/** The reference schedule with more nitrogen (Batch 12's search: 16 importers keep the fire gate open and win sooner). */
export const SWIFT_POLICY: Policy = Object.freeze({
  ...REFERENCE_POLICY,
  name: "swift playthrough",
  orders: REFERENCE_POLICY.orders.map((o) => (o.type === "nitrogen_import" && o.count === 10 ? { ...o, count: 16 } : o)),
});

/** The reference schedule with a lighter hand: no magnetic shield, and the mirrors taken down once the runaway carries itself. */
export const LEAN_POLICY: Policy = Object.freeze({
  ...REFERENCE_POLICY,
  name: "lean playthrough",
  orders: [...REFERENCE_POLICY.orders.filter((o) => o.type !== "magnetic_shield"), { atYear: 1000, type: "orbital_mirror", count: 0 } satisfies BuildOrder],
});

/**
 * A new Standard world at the Classic pace (seed 7) - rovers that build in
 * their time, networks, the rising sea, the ending - with the planet as
 * calibrated: nothing that pays and no tech gate, so the reference schedule
 * is placed as it is in the golden run. No Earth, events or first hour: the
 * sea's runs are about the sea.
 */
export const SEA_TUNING: Tuning = makeTuning({
  ...tuningRecord(worldTuning("standard", 7, "classic")),
  ECONOMY_ENABLED: 0,
  TECH_GATE_ENABLED: 0,
  EARTH_ENABLED: 0,
  DECISIONS_ENABLED: 0,
  GUIDE_ENABLED: 0,
  OBJECTIVES_ENABLED: 0,
});

/** Three sites high above any sea (the pacing city's and its neighbours', 107, -26 and -66 m). */
export const HIGH_SITES: readonly Site[] = [{ lat: 0.31, lon: -1.2 }, { lat: 0.31, lon: -1.22 }, { lat: 0.33, lon: -1.2 }];
/** Bare ground at -3,031.8 m: 11.3 m under the sea at the victory (-3,020.5 m in this world). A Seawall's first level (4 m) keeps it standing. */
export const WALLED_SITE: Site = { lat: 0.444, lon: 0.7773 };
/** Bare ground at -5,013 m: the sea comes for it soon after year 300. */
export const DOOMED_SITE: Site = { lat: -1.0493, lon: -2.8899 };

/** Place a building on the first tile it fits, outward from the middle of the founding ground. */
export function placeFirst(s: SimState, id: string, type: BuildingType, t: Tuning): SimState {
  const c = s.settlements.find((x) => x.id === id)!;
  const n = gridTiles(c.kind, t);
  const tiles: [number, number][] = [];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) tiles.push([x, y]);
  tiles.sort((a, b) => Math.hypot(a[0] - n / 2, a[1] - n / 2) - Math.hypot(b[0] - n / 2, b[1] - n / 2) || a[1] - b[1] || a[0] - b[0]);
  for (const [tx, ty] of tiles) {
    const o = placeBuilding(s, id, type, tx, ty, t);
    if (!o.ok) continue;
    // Joined to what stands, as a player's Connect would: a building on no network runs on nothing.
    const linked = connectAll(o.state, id, t);
    return linked.ok ? linked.state : o.state;
  }
  throw new Error(`no tile in ${id} takes a ${type}`);
}

/** What a city needs to keep people: a dome, and power, water, air and food for it. */
const LIFE: readonly BuildingType[] = ["habitat_dome", "solar_array", "solar_array", "water_extractor", "atmosphere_processor", "greenhouse"];

/**
 * The cities' story to the end: three cities high above the sea, and one
 * founded 12 m under the sea's last level with a Seawall from its first day.
 * None is lost.
 */
export function playWalled(t: Tuning = SEA_TUNING): VictoryRun {
  return playToVictory(REFERENCE_POLICY, t, 2600, {
    found: [...HIGH_SITES, WALLED_SITE],
    act: (s) => (s.steps === 0 ? placeFirst(s, "settlement-4", "seawall", t) : s),
  });
}

/** The evacuation run's first day: an empty dome in the haven (settlement-1), and a city built to keep people in the low one (settlement-2). */
export function buildTowns(s: SimState, t: Tuning = SEA_TUNING): SimState {
  let next = placeFirst(s, "settlement-1", "habitat_dome", t);
  for (const type of LIFE) next = placeFirst(next, "settlement-2", type, t);
  return next;
}

/**
 * The flood's story: a city built to keep people 5,013 m down, a haven high
 * above with a dome standing empty, and the player moving the people out the
 * moment the sea threatens their city. Runs until the low city falls.
 */
export function playEvacuation(t: Tuning = SEA_TUNING, years = 500): VictoryRun & { readonly moved: number } {
  const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };
  let moved = 0;
  const run = playToVictory(REFERENCE_POLICY, t, years, {
    found: [HIGH_SITES[0]!, DOOMED_SITE],
    act: (s) => {
      if (s.steps === 0) return buildTowns(s, t);
      const low = s.settlements[1]!;
      if (low.lostAtSeaLevelM !== null || !(low.population >= 1)) return s;
      const rate = liquidWaterRate(nextSubstepFlows(s, cfg));
      if (!threatened(s, low, rate, t)) return s;
      const o = evacuateSettlement(s, low.id, rate, t);
      if (o.ok) moved += o.moved;
      return o.ok ? o.state : s;
    },
  });
  return { ...run, moved };
}
