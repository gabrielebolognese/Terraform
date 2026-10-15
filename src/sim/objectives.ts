/**
 * The first hour (Batch 30): the guided first steps, and the objectives.
 *
 * "A new player is taught by doing, and every player always has a next goal
 * worth reaching and a reward for reaching it."
 *
 * DRIVEN BY THE STATE. A guided step is done when the world shows it done -
 * a city stands, a dome and a power plant share a cable - never when a
 * button was pressed, so the guide cannot fall out of step with the game: a
 * city founded by any route counts, and a step the player has not really
 * done does not. What is kept is a latch (`goals.guide`), set in `advance`
 * like the phase, because a step's condition can stop holding (a building
 * removed) and the guide must not walk backwards.
 *
 * An objective's progress is never stored either. Only the claims are: a
 * claim pays its reward once, and opens the next goal of its chain. Both
 * features are tuning (GUIDE_ENABLED, OBJECTIVES_ENABLED), off by default and
 * in every world made before them, so the golden run, the Batch 3 score and
 * the golden frames never see them.
 *
 * Pure: no clock, no randomness, nothing read from outside the state.
 */

import { derive, totalPressure } from "./derive.js";
import { eventEnv } from "./events.js";
import { effectiveEnv } from "./facilities/index.js";
import { BUILDING_DEFS } from "./micro/buildings.js";
import { networkOf, withRails } from "./micro/network.js";
import { capacities, housing } from "./micro/settlement.js";
import { frameOf } from "./micro/space.js";
import { MARS_START_RESERVOIRS } from "./planets/mars.js";
import { unlocked } from "./sandbox.js";
import type { Tuning } from "./tuning.js";
import type { Settlement, SimState } from "./types.js";
import { NEUTRAL_ENV, Phase, isCityKind } from "./types.js";

// ---------------------------------------------------------------------------
// The guided first steps
// ---------------------------------------------------------------------------

export type GuideStepId = "found" | "power" | "dome" | "connect" | "upgrade" | "claim" | "rail";

export interface GuideStep {
  readonly id: GuideStepId;
  /** The step's name, as the guide shows it. */
  readonly title: string;
  /** True when the world shows the step done. Asked only once every step before it is done. */
  readonly done: (s: SimState, t: Tuning) => boolean;
}

/** The player's standing cities (a city or a metropolis not lost to the sea), in founding order. */
function cities(s: SimState): readonly Settlement[] {
  return s.settlements.filter((c) => isCityKind(c.kind) && c.lostAtSeaLevelM === null);
}

function makesPower(type: Settlement["buildings"][number]["type"], t: Tuning): boolean {
  const def = BUILDING_DEFS[type];
  return def.buildable && (def.produces(t).power ?? 0) > 0;
}

/** A dome and a power plant on one cable network (any network, with the networks off: every building shares it). */
function domePowered(c: Settlement, t: Tuning): boolean {
  const domes: number[] = [];
  const plants: number[] = [];
  c.buildings.forEach((b, i) => {
    if (b.type === "habitat_dome") domes.push(i);
    else if (makesPower(b.type, t)) plants.push(i);
  });
  if (domes.length === 0 || plants.length === 0) return false;
  if (!t.NETWORK_ENABLED) return true;
  const n = frameOf(c, t).n;
  // The networks the city itself runs on (`settlementStep`): kept per list, so asking again is cheap.
  const net = withRails(networkOf(c.buildings, c.cables, n), c.buildings, c.rails, n);
  const powered = new Set(plants.map((i) => net.of[i]));
  return domes.some((i) => powered.has(net.of[i]));
}

/** Raised a level, or a rover out or waiting to raise one: the player has done it. */
function upgraded(c: Settlement): boolean {
  return c.buildings.some((b) => b.level > 1) || c.jobs.some((j) => j.kind === "build" && j.upgrade) || c.buildQueue.some((q) => q.upgrade);
}

/** The seven steps, in order (GAME_PLAN Batch 30). */
export const GUIDE_STEPS: readonly GuideStep[] = Object.freeze([
  { id: "found", title: "Found a city", done: (s) => cities(s).length > 0 },
  { id: "power", title: "Place power", done: (s, t) => cities(s).some((c) => c.buildings.some((b) => makesPower(b.type, t))) },
  { id: "dome", title: "Place a dome", done: (s) => cities(s).some((c) => c.buildings.some((b) => b.type === "habitat_dome")) },
  { id: "connect", title: "Connect them", done: (s, t) => cities(s).some((c) => domePowered(c, t)) },
  { id: "upgrade", title: "Raise a building a level", done: (s) => cities(s).some(upgraded) },
  { id: "claim", title: "Claim land", done: (s) => cities(s).some((c) => c.claims.length > 0) },
  { id: "rail", title: "Lay a railway to a second settlement", done: (s) => s.routes.length > 0 },
] satisfies GuideStep[]);

/**
 * How many guided steps are done: the latch, carried forward through every
 * step the state now shows done, in order. A step done out of turn waits for
 * the ones before it, then counts at once.
 */
export function guideReached(s: SimState, t: Tuning): number {
  let k = s.goals.guide;
  while (k < GUIDE_STEPS.length && GUIDE_STEPS[k]!.done(s, t)) k += 1;
  return k;
}

/** True while the guide has something to show: on in this world, not skipped, not finished. */
export function guideActive(s: SimState, t: Tuning): boolean {
  return t.GUIDE_ENABLED > 0 && !s.goals.guideSkipped && guideReached(s, t) < GUIDE_STEPS.length;
}

/**
 * The latch, once a substep from `advance`. Returns the same state when
 * nothing moved, so a world with the guide off or finished allocates nothing.
 */
export function latchGuide(s: SimState, t: Tuning): SimState {
  if (!t.GUIDE_ENABLED || s.goals.guideSkipped || s.goals.guide >= GUIDE_STEPS.length) return s;
  const k = guideReached(s, t);
  return k === s.goals.guide ? s : { ...s, goals: { ...s.goals, guide: k } };
}

/** The player's "Skip the guide": it is never shown again in this world. */
export function skipGuide(s: SimState): SimState {
  return s.goals.guideSkipped ? s : { ...s, goals: { ...s.goals, guideSkipped: true } };
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

export type ObjectiveChain = "city" | "planet" | "network";
export const OBJECTIVE_CHAINS: readonly ObjectiveChain[] = ["city", "planet", "network"];

/** Something a claim unlocks: founding a metropolis (a city with three times the ground each way). */
export type Unlock = "metropolis";
/** Something a claim changes only the look of: every city's marker, on the planet and the world map, in gold. */
export type Cosmetic = "gold_markers";

export interface Reward {
  /** Materials into the player's largest city, as much as its stores hold. */
  readonly materials: number;
  /** Settlers from Earth into the player's largest city, as many as it has homes for. */
  readonly people: number;
  /** Rovers landed at the largest city's headquarters, for good: more builds at once. */
  readonly rovers: number;
  readonly credits: number;
  readonly unlock: Unlock | null;
  readonly cosmetic: Cosmetic | null;
}

export interface Progress {
  /** How far along, in the objective's own unit (people, years, mbar, kelvin, railways, cities). */
  readonly now: number;
  /**
   * Where the bar starts, in the same unit: 0 for a count, and for a
   * temperature the planet's as the world began. Kelvin from absolute zero
   * would show a new world's first phase goal 98.7% done (213.2 of 216 K).
   */
  readonly from: number;
  readonly target: number;
  readonly done: boolean;
}

export interface ObjectiveDef {
  readonly id: string;
  readonly chain: ObjectiveChain;
  readonly title: string;
  /** Exactly what counts, in words. */
  readonly counts: (t: Tuning) => string;
  /** The unit `now` and `target` are in, for the panel: "people", "mbar". */
  readonly unit: string;
  readonly progress: (s: SimState, t: Tuning) => Progress;
  readonly reward: (t: Tuning) => Reward;
}

const NOTHING: Reward = Object.freeze({ materials: 0, people: 0, rovers: 0, credits: 0, unlock: null, cosmetic: null });

function most(s: SimState, of: (c: Settlement) => number): number {
  let best = 0;
  for (const c of cities(s)) best = Math.max(best, of(c));
  return best;
}

function atLeast(now: number, target: number): Progress {
  return { now, from: 0, target, done: now >= target };
}

/** Years in a row, to the city's latest, with at least `people` living there and nothing running short. */
export function steadyYears(c: Settlement, people: number): number {
  const samples = c.history.samples;
  let k = 0;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const x = samples[i]!;
    if (x.population < people || x.short.some((v) => v > 0)) break;
    k += 1;
  }
  return k;
}

/**
 * The most cities in one rail network: settlements joined by railways, any
 * settlement (an outpost too) carrying the line, only cities counted.
 */
export function citiesJoined(s: SimState): number {
  const standing = new Map(s.settlements.filter((c) => c.lostAtSeaLevelM === null).map((c) => [c.id, c] as const));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const id of standing.keys()) parent.set(id, id);
  for (const r of s.routes) {
    if (!standing.has(r.a) || !standing.has(r.b)) continue;
    const a = find(r.a);
    const b = find(r.b);
    if (a !== b) parent.set(a, b);
  }
  const count = new Map<string, number>();
  for (const c of standing.values()) {
    if (!isCityKind(c.kind)) continue;
    const root = find(c.id);
    count.set(root, (count.get(root) ?? 0) + 1);
  }
  let best = 0;
  // Joined means at least two: a city on its own is not a network.
  for (const n of count.values()) if (n >= 2) best = Math.max(best, n);
  return best;
}

/** The planet's temperature now, K, as the phases judge it (the weather included). */
function temperature(s: SimState, t: Tuning): number {
  const env = effectiveEnv(eventEnv(NEUTRAL_ENV, s.seed, s.steps * t.SUBSTEP_YEARS, t), s.facilities, t);
  return derive(s.reservoirs, env, t).T;
}

const START_T = new WeakMap<Tuning, number>();

/**
 * The planet's temperature as the world began, K: Mars's start, nothing
 * built, no weather. Objectives are on only in a Standard world, and every
 * one starts there (`marsStart`).
 */
export function startTemperature(t: Tuning): number {
  let k = START_T.get(t);
  if (k === undefined) {
    k = derive(MARS_START_RESERVOIRS, NEUTRAL_ENV, t).T;
    START_T.set(t, k);
  }
  return k;
}

/** A phase goal: the temperature, from the world's start to the phase's, done once the latched phase is reached. */
function warmedTo(s: SimState, t: Tuning, phase: Phase, target: number): Progress {
  const from = Math.min(startTemperature(t), target);
  const done = s.phaseReached >= phase;
  return { now: done ? target : Math.min(target, temperature(s, t)), from, target, done };
}

/**
 * The objectives, chain by chain, each chain in order: an objective opens
 * when the one before it in its chain is claimed. The first of each is open
 * from the start, and none is done in a new world's first minute.
 */
export const OBJECTIVES: readonly ObjectiveDef[] = Object.freeze([
  // ---- the city: people, then a city that keeps them --------------------
  {
    id: "city_first",
    chain: "city",
    title: "A hundred people",
    counts: (t) => `${t.GOAL_FIRST_PEOPLE} people living in one city.`,
    unit: "people",
    progress: (s, t) => atLeast(Math.floor(most(s, (c) => c.population)), t.GOAL_FIRST_PEOPLE),
    reward: (t) => ({ ...NOTHING, people: t.REWARD_FIRST_PEOPLE }),
  },
  {
    id: "city_steady",
    chain: "city",
    title: "Steady supply",
    counts: (t) => `${t.GOAL_STEADY_YEARS} years in a row in one city of at least ${t.GOAL_STEADY_PEOPLE} people with nothing running short - no blackout, thirst, hunger or thin air. A shortage starts the count again.`,
    unit: "years",
    progress: (s, t) => atLeast(most(s, (c) => steadyYears(c, t.GOAL_STEADY_PEOPLE)), t.GOAL_STEADY_YEARS),
    reward: (t) => ({ ...NOTHING, people: t.REWARD_STEADY_PEOPLE }),
  },
  {
    id: "city_town",
    chain: "city",
    title: "A town of 500",
    counts: (t) => `${t.GOAL_TOWN_PEOPLE} people living in one city.`,
    unit: "people",
    progress: (s, t) => atLeast(Math.floor(most(s, (c) => c.population)), t.GOAL_TOWN_PEOPLE),
    reward: (t) => ({ ...NOTHING, rovers: t.REWARD_TOWN_ROVERS }),
  },
  {
    id: "city_thousand",
    chain: "city",
    title: "A city of 1,000",
    counts: (t) => `${t.GOAL_CITY_PEOPLE} people living in one city.`,
    unit: "people",
    progress: (s, t) => atLeast(Math.floor(most(s, (c) => c.population)), t.GOAL_CITY_PEOPLE),
    reward: (t) => ({ ...NOTHING, credits: t.REWARD_CITY_CREDITS, unlock: "metropolis" }),
  },
  // ---- the planet: section 7's own milestones, and the air between them ----
  {
    id: "planet_runaway",
    chain: "planet",
    title: "The caps let go",
    counts: (t) => `The planet reaches Phase 2, runaway thickening: above ${t.T_SUBL_CAP} K the polar caps start to boil off into the air.`,
    unit: "K",
    progress: (s, t) => warmedTo(s, t, Phase.RunawayThickening, t.T_SUBL_CAP),
    reward: (t) => ({ ...NOTHING, credits: t.REWARD_RUNAWAY_CREDITS }),
  },
  {
    id: "planet_pressure",
    chain: "planet",
    title: "Thicker air",
    counts: (t) => `The air reaches ${t.GOAL_PRESSURE_MBAR} mbar at the surface.`,
    unit: "mbar",
    progress: (s, t) => atLeast(totalPressure(s.reservoirs), t.GOAL_PRESSURE_MBAR),
    reward: (t) => ({ ...NOTHING, credits: t.REWARD_PRESSURE_CREDITS }),
  },
  {
    id: "planet_water",
    chain: "planet",
    title: "First water",
    counts: (t) => `The planet reaches Phase 3, first water: liquid water at the surface, above ${t.T_FREEZE} K with more than ${t.PHASE3_P_MIN} mbar of air.`,
    unit: "K",
    progress: (s, t) => warmedTo(s, t, Phase.FirstWater, t.T_FREEZE),
    reward: (t) => ({ ...NOTHING, credits: t.REWARD_WATER_CREDITS }),
  },
  // ---- the network: settlements joined by rail --------------------------
  {
    id: "network_rail",
    chain: "network",
    title: "Joined by rail",
    counts: () => "A railway between two of your settlements.",
    unit: "railways",
    progress: (s) => atLeast(Math.min(1, s.routes.length), 1),
    reward: (t) => ({ ...NOTHING, materials: t.REWARD_RAIL_MATERIALS }),
  },
  {
    id: "network_three",
    chain: "network",
    title: "Three cities joined",
    counts: (t) => `${t.GOAL_CITIES_JOINED} cities on one rail network. Outposts may carry the line; only cities count.`,
    unit: "cities",
    progress: (s, t) => atLeast(citiesJoined(s), t.GOAL_CITIES_JOINED),
    reward: (t) => ({ ...NOTHING, credits: t.REWARD_JOINED_CREDITS, cosmetic: "gold_markers" }),
  },
] satisfies ObjectiveDef[]);

const BY_ID: ReadonlyMap<string, ObjectiveDef> = new Map(OBJECTIVES.map((o) => [o.id, o]));

export function objectiveById(id: string): ObjectiveDef | undefined {
  return BY_ID.get(id);
}

/** The objective before this one in its chain, or null for a chain's first. */
export function before(def: ObjectiveDef): ObjectiveDef | null {
  const chain = OBJECTIVES.filter((o) => o.chain === def.chain);
  const i = chain.indexOf(def);
  return i > 0 ? chain[i - 1]! : null;
}

export interface ObjectiveStatus {
  readonly def: ObjectiveDef;
  /** Open: the one before it in its chain is claimed (or it is the chain's first). */
  readonly open: boolean;
  readonly claimed: boolean;
  readonly progress: Progress;
}

/** Every objective, as the state stands. Empty with objectives off. */
export function objectiveStatus(s: SimState, t: Tuning): readonly ObjectiveStatus[] {
  if (!t.OBJECTIVES_ENABLED) return [];
  const claimed = new Set(s.goals.claimed);
  return OBJECTIVES.map((def) => {
    const prior = before(def);
    const open = prior === null || claimed.has(prior.id);
    return { def, open, claimed: claimed.has(def.id), progress: def.progress(s, t) };
  });
}

/** The player's largest standing city, by people (the first founded on a tie), or null. */
export function largestCity(s: SimState): Settlement | null {
  let best: Settlement | null = null;
  for (const c of cities(s)) if (best === null || c.population > best.population) best = c;
  return best;
}

export interface ClaimOutcome {
  readonly state: SimState;
  readonly ok: boolean;
  readonly reason: string | null;
  /** What the claim paid: materials and people landed (as much as the city had room for), and credits. */
  readonly materials: number;
  readonly people: number;
  readonly rovers: number;
  readonly credits: number;
}

/**
 * Take an objective's reward. Refused, changing nothing, with objectives off,
 * for one already claimed, not yet open, or not done - and says why.
 */
export function claimObjective(s: SimState, id: string, t: Tuning): ClaimOutcome {
  const refuse = (reason: string): ClaimOutcome => ({ state: s, ok: false, reason, materials: 0, people: 0, rovers: 0, credits: 0 });
  if (!t.OBJECTIVES_ENABLED) return refuse("objectives are not part of this world");
  const def = objectiveById(id);
  if (def === undefined) return refuse(`there is no objective "${id}"`);
  if (s.goals.claimed.includes(id)) return refuse(`"${def.title}" is claimed already`);
  const prior = before(def);
  if (prior !== null && !s.goals.claimed.includes(prior.id)) return refuse(`"${def.title}" opens once "${prior.title}" is claimed`);
  const p = def.progress(s, t);
  if (!p.done) return refuse(`"${def.title}" is not done yet: ${formatAmount(p.now)} of ${formatAmount(p.target)} ${def.unit}`);
  const reward = def.reward(t);
  let settlements = s.settlements;
  let materials = 0;
  let people = 0;
  const city = largestCity(s);
  if (city !== null) {
    materials = Math.min(Math.max(0, capacities(city, t).materials - city.stores.materials), reward.materials);
    people = Math.min(Math.max(0, housing(city, t) - city.population), reward.people);
    if (materials > 0 || people > 0 || reward.rovers > 0) {
      const landed: Settlement = { ...city, population: city.population + people, stores: { ...city.stores, materials: city.stores.materials + materials }, extraRovers: city.extraRovers + reward.rovers };
      settlements = s.settlements.map((c) => (c.id === city.id ? landed : c));
    }
  }
  const credits = reward.credits;
  const economy = credits > 0 ? { ...s.economy, credits: s.economy.credits + credits, earned: s.economy.earned + credits } : s.economy;
  return {
    state: { ...s, settlements, economy, goals: { ...s.goals, claimed: [...s.goals.claimed, id] } },
    ok: true,
    reason: null,
    materials,
    people,
    rovers: city === null ? 0 : reward.rovers,
    credits,
  };
}

function formatAmount(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString("en") : v.toFixed(1);
}

/** True once a claimed objective has unlocked it. */
export function hasUnlock(s: SimState, unlock: Unlock, t: Tuning): boolean {
  return t.OBJECTIVES_ENABLED > 0 && s.goals.claimed.some((id) => objectiveById(id)?.reward(t).unlock === unlock);
}

export function hasCosmetic(s: SimState, cosmetic: Cosmetic, t: Tuning): boolean {
  return t.OBJECTIVES_ENABLED > 0 && s.goals.claimed.some((id) => objectiveById(id)?.reward(t).cosmetic === cosmetic);
}

/**
 * Whether a metropolis may be founded. With objectives on, it is the reward
 * of "A city of 1,000"; a sandbox has everything; a world with objectives off
 * keeps the rule it was made with (the simulation never refused one).
 */
export function metropolisAllowed(s: SimState, t: Tuning): boolean {
  return !t.OBJECTIVES_ENABLED || unlocked(t) || hasUnlock(s, "metropolis", t);
}
