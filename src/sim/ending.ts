/**
 * The ending (Batch 39): victory, the world's score and its story in numbers.
 *
 * "A game that can be won, and a reason to play again."
 *
 * VICTORY is the arc's last phase HELD: every §2.3 row inside its band - a
 * breathable, temperate, watered planet - for VICTORY_HOLD_YEARS sim-years in
 * a row. The phase latches the first touch of the band; the win asks that the
 * world stay living. The count runs a substep at a time in `advance`, from the
 * same reading the phase is latched from, so it is identical however the time
 * is split - live, chunked or offline - and once won, a world stays won.
 *
 * THE SCORE is derived, never stored: from the substep of the victory, the
 * people at the planet's most, the cities lost to the sea and those standing
 * only by their Seawall, and the machine-years - every machine of the
 * planet's online, for every year it ran: the pressure put on the planet.
 * The same state gives the same score, so the same world scores the same
 * live or offline.
 *
 * Only what cannot be derived is kept (`SimState.ending`): the hold's count,
 * the victory's substep, the most people, the people lost and moved to
 * safety, the machine-years and the achievements earned. Nothing here is read
 * back into the simulation. All of it is ENDING_ENABLED's: off - the default,
 * every world made before it, a sandbox, a Terraformed start - `advance`
 * keeps nothing of it.
 *
 * Pure: no clock, no randomness, nothing read from outside the state.
 */

import { surfaceCover } from "./derive.js";
import { siteElevation } from "./hypsometry.js";
import { dikeHeightM } from "./micro/flood.js";
import { seaLevel } from "./sea-level.js";
import type { Tuning } from "./tuning.js";
import type { Settlement, SimState } from "./types.js";
import { isCityKind } from "./types.js";

/** Substeps the band must hold to win: VICTORY_HOLD_YEARS on the substep grid (40 at Classic, 320 at Standard). */
export function holdSteps(t: Tuning): number {
  return Math.max(1, Math.ceil(t.VICTORY_HOLD_YEARS / t.SUBSTEP_YEARS - 1e-9));
}

/** People living in the settlements standing. */
export function peopleOn(s: SimState): number {
  let n = 0;
  for (const c of s.settlements) if (c.lostAtSeaLevelM === null) n += c.population;
  return n;
}

/** The machines of the planet online now: every facility's deployed units. */
function machinesOnline(s: SimState): number {
  let n = 0;
  for (const f of s.facilities) n += f.deployed;
  return n;
}

/**
 * People lost to the sea across one substep (`before` and `after` one
 * substep apart; settlements are never added inside one): everyone living in
 * a settlement it took, and everyone who left or died in one it stood in -
 * the water over its ground, its buildings going under - as the substep
 * began. Evacuation is the player's, between substeps: never counted here.
 */
function lostBetween(before: SimState, after: SimState, t: Tuning): number {
  if (before.settlements === after.settlements) return 0;
  const sea = seaNow(before, t);
  if (sea === null) return 0;
  let lost = 0;
  for (let i = 0; i < after.settlements.length; i += 1) {
    const a = after.settlements[i]!;
    const b = before.settlements[i]?.id === a.id ? before.settlements[i] : before.settlements.find((x) => x.id === a.id);
    if (b === undefined || b.lostAtSeaLevelM !== null) continue;
    if (a.lostAtSeaLevelM !== null) lost += b.population;
    else if (a.population < b.population && sea > groundOf(b, t) + dikeHeightM(b, t)) lost += b.population - a.population;
  }
  return lost;
}

/**
 * One substep of the ending, from `advance`. `before` is the state the
 * substep began from and `after` the state it left; `living` is whether every
 * §2.3 row stood inside its band as the substep began - the reading the phase
 * is latched from. The machines counted are those online through the substep.
 */
export function stepEnding(before: SimState, after: SimState, living: boolean, t: Tuning): SimState {
  if (!t.ENDING_ENABLED) return after;
  const e = after.ending;
  const livingSteps = living ? e.livingSteps + 1 : 0;
  const victory = e.victory ?? (livingSteps >= holdSteps(t) ? after.steps : null);
  const machineYears = e.machineYears + machinesOnline(before) * t.SUBSTEP_YEARS;
  const peopleLost = e.peopleLost + lostBetween(before, after, t);
  const peakPeople = Math.max(e.peakPeople, peopleOn(after));
  return { ...after, ending: { ...e, livingSteps, victory, machineYears, peopleLost, peakPeople } };
}

// ---------------------------------------------------------------------------
// The sea's tally: cities lost, and cities held by their walls
// ---------------------------------------------------------------------------

const ELEVATIONS = new WeakMap<Tuning, Map<string, number>>();

/** A settlement's bare ground on the planet, metres: a pure function of where it is, kept per tuning. */
export function groundOf(c: Settlement, t: Tuning): number {
  let kept = ELEVATIONS.get(t);
  if (kept === undefined) {
    kept = new Map();
    ELEVATIONS.set(t, kept);
  }
  const key = `${c.lat},${c.lon}`;
  let m = kept.get(key);
  if (m === undefined) {
    m = siteElevation(c.lat, c.lon, t);
    kept.set(key, m);
  }
  return m;
}

/** The waterline, metres, or null with no sea on the planet or flooding off (the flood's own rule: no ocean, no flooding). */
export function seaNow(s: SimState, t: Tuning): number | null {
  if (!t.FLOODING_ENABLED || !(surfaceCover(s.reservoirs, t).oceanFrac > 0)) return null;
  return seaLevel(s.reservoirs, t, 0).m;
}

/**
 * A city standing only by its Seawall: the sea stands FLOOD_THRESHOLD_M or
 * more over its bare ground - where a city with no wall is declared flooded
 * and lost - and it stands, behind a wall built.
 */
export function heldBySeawall(c: Settlement, seaM: number | null, t: Tuning): boolean {
  if (seaM === null || !isCityKind(c.kind) || c.lostAtSeaLevelM !== null) return false;
  return seaM - groundOf(c, t) >= t.FLOOD_THRESHOLD_M && dikeHeightM(c, t) > 0;
}

/** Cities (and metropolises) lost to the sea. */
export function citiesLost(s: SimState): number {
  return s.settlements.filter((c) => isCityKind(c.kind) && c.lostAtSeaLevelM !== null).length;
}

/** Cities standing only by their Seawall, as the sea stands now. */
export function citiesSaved(s: SimState, t: Tuning): number {
  const sea = seaNow(s, t);
  return sea === null ? 0 : s.settlements.filter((c) => heldBySeawall(c, sea, t)).length;
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

export interface WorldScore {
  /** Sim-years from the start to the victory, or null before it. */
  readonly yearsToVictory: number | null;
  /** Each part, in points: speed (0 before the victory), people, cities saved, cities lost (0 or less), pressure (0 or less). */
  readonly speed: number;
  readonly people: number;
  readonly saved: number;
  readonly lost: number;
  readonly pressure: number;
  /** The parts summed, never below 0. */
  readonly total: number;
  /** What the parts count. */
  readonly peakPeople: number;
  readonly citiesSaved: number;
  readonly citiesLost: number;
  readonly machineYears: number;
}

/**
 * The world's score, derived from the state: the same state, the same score.
 * Null in a world without the ending. Before the victory it is the score so
 * far, its speed 0.
 */
export function worldScore(s: SimState, t: Tuning): WorldScore | null {
  if (!t.ENDING_ENABLED) return null;
  const e = s.ending;
  const yearsToVictory = e.victory === null ? null : e.victory * t.SUBSTEP_YEARS;
  const saved = citiesSaved(s, t);
  const lostCities = citiesLost(s);
  const speed = yearsToVictory === null ? 0 : Math.round((t.SCORE_SPEED_POINTS * t.SCORE_SPEED_REF_YEARS) / yearsToVictory);
  const people = Math.round(e.peakPeople * t.SCORE_POINTS_PER_PERSON);
  const savedPoints = saved * t.SCORE_CITY_SAVED_POINTS;
  const lost = -lostCities * t.SCORE_CITY_LOST_POINTS;
  const pressure = -Math.round(e.machineYears * t.SCORE_POINTS_PER_MACHINE_YEAR);
  return {
    yearsToVictory,
    speed,
    people,
    saved: savedPoints,
    lost: lost === 0 ? 0 : lost,
    pressure: pressure === 0 ? 0 : pressure,
    total: Math.max(0, speed + people + savedPoints + lost + pressure),
    peakPeople: e.peakPeople,
    citiesSaved: saved,
    citiesLost: lostCities,
    machineYears: e.machineYears,
  };
}

// ---------------------------------------------------------------------------
// The world's story in numbers
// ---------------------------------------------------------------------------

export interface WorldStory {
  /** Sim-years now, and at the victory (null before it). */
  readonly year: number;
  readonly victoryYear: number | null;
  /** Cities (and metropolises) founded, standing, lost to the sea, and standing only by their Seawall; outposts founded. */
  readonly citiesFounded: number;
  readonly citiesStanding: number;
  readonly citiesLost: number;
  readonly citiesSaved: number;
  readonly outposts: number;
  /** People living now, at the planet's most, lost with their cities, and moved to safety from the sea. */
  readonly people: number;
  readonly peakPeople: number;
  readonly peopleLost: number;
  readonly peopleEvacuated: number;
  readonly machineYears: number;
  /** Credits the bank has taken in, all told; Earth's contracts met. */
  readonly creditsEarned: number;
  readonly contractsMet: number;
  readonly achievements: number;
  readonly score: WorldScore | null;
}

/** What the victory's card tells: the world's story in numbers, from the state. */
export function worldStory(s: SimState, t: Tuning): WorldStory {
  const cities = s.settlements.filter((c) => isCityKind(c.kind));
  return {
    year: s.steps * t.SUBSTEP_YEARS,
    victoryYear: s.ending.victory === null ? null : s.ending.victory * t.SUBSTEP_YEARS,
    citiesFounded: cities.length,
    citiesStanding: cities.filter((c) => c.lostAtSeaLevelM === null).length,
    citiesLost: citiesLost(s),
    citiesSaved: citiesSaved(s, t),
    outposts: s.settlements.filter((c) => c.kind === "outpost").length,
    people: peopleOn(s),
    peakPeople: s.ending.peakPeople,
    peopleLost: s.ending.peopleLost,
    peopleEvacuated: s.ending.peopleEvacuated,
    machineYears: s.ending.machineYears,
    creditsEarned: s.economy.earned,
    contractsMet: s.earth.fulfilled,
    achievements: s.ending.achievements.length,
    score: worldScore(s, t),
  };
}
