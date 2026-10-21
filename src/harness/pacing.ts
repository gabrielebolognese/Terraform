/**
 * A scripted player, for pacing in real time (Batch 28).
 *
 * "Fun is measured too": every batch that changes pacing states its targets
 * in real minutes at 1x and measures them on a playthrough. This is that
 * playthrough. It plays the way the browser lets a player play - a city
 * founded at once, built and grown by need, the planet bought with what the
 * bank holds - and records when the moments a player notices arrive:
 * the first building standing, the first upgrade done, a city of 1,000
 * people, and the first two phases.
 *
 * Its choices are greedy and simple on purpose. It is an instrument: the
 * same script before and after a retune says whether the retune moved the
 * game, not whether a clever player could beat it.
 */

import type { HabitatChannels } from "../sim/habitat.js";
import type { BuildingType, MicroResource, Settlement, SimState, Tuning } from "../sim/index.js";
import {
  BUILDING_DEFS,
  NEUTRAL_ENV,
  advance,
  connectAll,
  derive,
  foundSettlement,
  habitat,
  housing,
  marsStart,
  maxLevel,
  placeBuilding,
  settlementStep,
  upgradeBuilding,
  worldEnv,
} from "../sim/index.js";
import { garage, roverCount, roversOut } from "../sim/micro/rocks.js";
import { claimLand, claimableChunks, claimsAllowed, constructionOf } from "../sim/micro/settlement.js";
import { connectSettlements } from "../sim/micro/routes.js";
import { GUIDE_STEPS, OBJECTIVES, claimObjective, guideReached, objectiveStatus } from "../sim/objectives.js";
import { gridTiles, tileKey } from "../sim/micro/space.js";
import { spendDown } from "./policy.js";

/** Where the scripted city is founded: open ground on the original planet (also `build.test.ts`'s). */
export const PACING_SITE = { lat: 0.31, lon: -1.2 } as const;

/** Where the guided player founds its second settlement (Batch 30): an outpost 65 km east, a railway both can pay for. */
export const PACING_OUTPOST = { lat: 0.31, lon: -1.18 } as const;
/** And, once the guide is done, two more cities to join to the first (65 km west and 68 km north): "Three cities joined". */
export const PACING_CITIES = [
  { lat: 0.31, lon: -1.22 },
  { lat: 0.33, lon: -1.2 },
] as const;

/** Real seconds at 1x between the player's looks at the city: a player clicks every few seconds, not every frame. */
export const DECIDE_EVERY_S = 5;

export interface PacingMoments {
  /** Real seconds at 1x from the start; null if it never came within the run. */
  readonly firstBuilding: number | null;
  readonly firstUpgrade: number | null;
  readonly city1000: number | null;
  readonly phase1: number | null;
  readonly phase2: number | null;
}

/**
 * How the scripted player plays beyond the base script (Batch 30): `guided`
 * follows the guided first steps as a new player would - raises a building a
 * level once the guide asks, claims land once it may, founds an outpost and
 * lays a railway to it; `claim` takes each objective's reward the moment it
 * is done. Neither is a better player, only a taught one.
 */
export interface PacingScript {
  readonly guided?: boolean;
  readonly claim?: boolean;
  /** With `claim`, the one objective never claimed: what its reward is worth, by its absence. */
  readonly withhold?: string;
}

/** When the first hour's moments came (Batch 30), real seconds at 1x; null if not within the run. */
export interface GoalMoments {
  /** Each guided step's latch, in order. */
  readonly guide: readonly (number | null)[];
  /** Each objective, by id: when it was first done (whether or not it was claimed). */
  readonly done: Readonly<Record<string, number | null>>;
  /** Each objective, by id: when the script claimed it. */
  readonly claimed: Readonly<Record<string, number | null>>;
}

export interface PacingRun {
  readonly moments: PacingMoments;
  readonly goals: GoalMoments;
  readonly state: SimState;
  /** Real seconds played (at 1x). */
  readonly seconds: number;
  /** What the script did, in order, for reading a run back. */
  readonly log: readonly string[];
}

const PRODUCER: Readonly<Record<MicroResource, BuildingType>> = {
  power: "solar_array",
  water: "water_extractor",
  oxygen: "atmosphere_processor",
  food: "greenhouse",
  materials: "regolith_mine",
};

function envOf(s: SimState, t: Tuning): HabitatChannels {
  return habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t, 0);
}

/** Tiles outward from the headquarters, nearest first: where a player puts the next building. */
function spiral(s: Settlement, tiles: number): readonly (readonly [number, number])[] {
  const g = garage(s);
  const cx = Math.round(g?.x ?? tiles / 2);
  const cy = Math.round(g?.y ?? tiles / 2);
  const out: [number, number][] = [];
  for (let y = 0; y < tiles; y += 1) for (let x = 0; x < tiles; x += 1) out.push([x, y]);
  return out.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy) || a[1] - b[1] || a[0] - b[0]);
}

/**
 * Play `seconds` of real time at 1x under `t`. Deterministic: the same tuning
 * gives the same run, the moments to the substep. `onStep`, if given, is
 * shown the state after every substep.
 */
export function playPacing(t: Tuning, seconds: number, stopWhenDone = true, onStep?: (state: SimState, step: number) => void, script: PacingScript = {}): PacingRun {
  const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };
  const founded = foundSettlement(marsStart(undefined, t), "city", PACING_SITE.lat, PACING_SITE.lon, t, "Pacing");
  if (!founded.ok) throw new Error(`the pacing city could not be founded: ${founded.reason}`);
  let state = founded.state;
  const id = founded.settlement!.id;
  const tiles = gridTiles("city", t);
  const order = spiral(state.settlements[0]!, tiles);
  const log: string[] = [];

  const stepsPerLook = Math.max(1, Math.round((DECIDE_EVERY_S * t.TIME_SCALE) / t.SUBSTEP_YEARS));
  const realPerStep = t.SUBSTEP_YEARS / t.TIME_SCALE;
  const totalSteps = Math.ceil(seconds / realPerStep);

  const m: { firstBuilding: number | null; firstUpgrade: number | null; city1000: number | null; phase1: number | null; phase2: number | null } = {
    firstBuilding: null,
    firstUpgrade: null,
    city1000: null,
    phase1: null,
    phase2: null,
  };
  const guide: (number | null)[] = GUIDE_STEPS.map(() => null);
  const done: Record<string, number | null> = Object.fromEntries(OBJECTIVES.map((o) => [o.id, null]));
  const claimed: Record<string, number | null> = Object.fromEntries(OBJECTIVES.map((o) => [o.id, null]));
  const founding = state.settlements[0]!.buildings.length;
  let placedAny = false;
  let upgradedAny = false;

  const city = (): Settlement => state.settlements.find((c) => c.id === id)!;
  /** Short of materials at the last try: what a player answers with a mine. */
  let wanting = false;
  const place = (type: BuildingType): boolean => {
    for (const [tx, ty] of order) {
      const o = placeBuilding(state, id, type, tx, ty, t);
      if (!o.ok) {
        // Out of materials: no tile will do.
        if (o.reason !== null && /materials/.test(o.reason)) {
          wanting = true;
          return false;
        }
        if (o.reason !== null && /needs a city|terraformed|too thin/.test(o.reason)) return false;
        continue;
      }
      state = o.state;
      const linked = connectAll(state, id, t);
      if (linked.ok) state = linked.state;
      log.push(`${(stepOf() * realPerStep).toFixed(0)} s: ${type} at ${tx},${ty}`);
      return true;
    }
    return false;
  };
  let step = 0;
  const stepOf = (): number => step;

  /** The guided step the player is on: what a taught player does about it, if anything (true when it acted). */
  const followGuide = (): boolean => {
    const at = GUIDE_STEPS[guideReached(state, t)]?.id;
    const c = city();
    if (at === "upgrade") {
      // The cheapest standing building the guide's Upgrade button would raise.
      const built = constructionOf(c);
      const pick = c.buildings
        .filter((b) => BUILDING_DEFS[b.type].buildable && !built.has(tileKey(b.tx, b.ty)) && b.level < maxLevel(b.type, t))
        .sort((a, b) => BUILDING_DEFS[a.type].cost(t) - BUILDING_DEFS[b.type].cost(t) || a.ty - b.ty || a.tx - b.tx)[0];
      if (pick === undefined) return false;
      const o = upgradeBuilding(state, id, pick.tx, pick.ty, t);
      if (!o.ok) return false;
      state = o.state;
      upgradedAny = true;
      log.push(`${(step * realPerStep).toFixed(0)} s: guided upgrade ${pick.type} at ${pick.tx},${pick.ty}`);
      return true;
    }
    if (at === "claim" && claimsAllowed(c.population, t) > c.claims.length) {
      const chunk = claimableChunks(c, t)[0];
      if (chunk === undefined) return false;
      const o = claimLand(state, id, chunk.i, chunk.j, t);
      if (!o.ok) return false;
      state = o.state;
      log.push(`${(step * realPerStep).toFixed(0)} s: claimed ${chunk.i},${chunk.j}`);
      return true;
    }
    if (at === "rail") {
      let outpost = state.settlements.find((x) => x.kind === "outpost");
      if (outpost === undefined) {
        const f = foundSettlement(state, "outpost", PACING_OUTPOST.lat, PACING_OUTPOST.lon, t, "Pacing outpost");
        if (!f.ok) return false;
        state = f.state;
        outpost = f.settlement!;
        log.push(`${(step * realPerStep).toFixed(0)} s: founded an outpost`);
      }
      const o = connectSettlements(state, id, outpost.id, t);
      if (!o.ok) return false;
      state = o.state;
      log.push(`${(step * realPerStep).toFixed(0)} s: railway to the outpost`);
      return true;
    }
    if (at === undefined) {
      // The guide done: the network's next objective, two more cities on the first's line.
      for (const site of PACING_CITIES) {
        let other = state.settlements.find((x) => x.id !== id && x.lat === site.lat && x.lon === site.lon);
        if (other === undefined) {
          const f = foundSettlement(state, "city", site.lat, site.lon, t);
          if (!f.ok) return false;
          state = f.state;
          other = f.settlement!;
          log.push(`${(step * realPerStep).toFixed(0)} s: founded ${other.id}`);
        }
        if (state.routes.some((r) => (r.a === id && r.b === other.id) || (r.b === id && r.a === other.id))) continue;
        const o = connectSettlements(state, id, other.id, t);
        if (!o.ok) return false;
        state = o.state;
        log.push(`${(step * realPerStep).toFixed(0)} s: railway to ${other.id}`);
        return true;
      }
    }
    return false;
  };

  const look = (): void => {
    state = spendDown(state, step * t.SUBSTEP_YEARS, t);
    if (script.claim) {
      for (const o of objectiveStatus(state, t)) {
        if (!o.open || o.claimed || !o.progress.done || o.def.id === script.withhold) continue;
        const outcome = claimObjective(state, o.def.id, t);
        if (!outcome.ok) continue;
        state = outcome.state;
        claimed[o.def.id] = step * realPerStep;
        log.push(`${(step * realPerStep).toFixed(0)} s: claimed "${o.def.title}" (${outcome.people.toFixed(0)} people, ${outcome.materials.toFixed(0)} materials, ${outcome.credits} credits)`);
      }
    }
    if (script.guided && followGuide()) return;
    const c = city();
    // Every rover busy: a player waits rather than stacking a queue.
    if (roversOut(c) >= roverCount(c, t) || c.buildQueue.length > 0) return;
    // Waiting on materials: one more mine, while mines are under a third of the city.
    if (wanting) {
      wanting = false;
      const mines = c.buildings.filter((b) => b.type === "regolith_mine").length;
      if (mines * 3 < c.buildings.length && place("regolith_mine")) {
        placedAny = true;
        return;
      }
    }
    const probe = settlementStep(c, envOf(state, t), t, t.SUBSTEP_YEARS);
    // A need first: whatever runs short or does not pay its way.
    const need = (Object.keys(PRODUCER) as MicroResource[]).find((r) => probe.shortages.includes(r) || probe.production[r] - probe.consumption[r] <= 0);
    if (need !== undefined) {
      if (place(PRODUCER[need])) placedAny = true;
      return;
    }
    // Room for people next.
    if (c.population >= 0.8 * housing(c, t)) {
      if (place("habitat_dome")) placedAny = true;
      return;
    }
    // Otherwise raise the lowest building a level.
    const candidates = c.buildings
      .filter((b) => BUILDING_DEFS[b.type].buildable && b.level < maxLevel(b.type, t) && !c.jobs.some((j) => j.kind === "build" && j.tile === tileKey(b.tx, b.ty)))
      .sort((a, b) => a.level - b.level || a.ty - b.ty || a.tx - b.tx);
    for (const b of candidates) {
      const o = upgradeBuilding(state, id, b.tx, b.ty, t);
      if (!o.ok && o.reason !== null && /materials/.test(o.reason)) wanting = true;
      if (o.ok) {
        state = o.state;
        upgradedAny = true;
        log.push(`${(step * realPerStep).toFixed(0)} s: upgrade ${b.type} at ${b.tx},${b.ty} to ${b.level + 1}`);
        return;
      }
    }
  };

  for (; step < totalSteps; step += 1) {
    if (step % stepsPerLook === 0) look();
    state = advance(state, 1, cfg);
    // An observer (Batch 29's scripted day): it sees each substep's state and changes nothing.
    onStep?.(state, step);
    const after = city();
    const now = (step + 1) * realPerStep;
    // A building stands once it is no longer a worksite.
    if (m.firstBuilding === null && placedAny && after.buildings.length - constructionOf(after).size > founding) m.firstBuilding = now;
    if (m.firstUpgrade === null && upgradedAny && after.buildings.some((b) => b.level > 1)) m.firstUpgrade = now;
    if (m.city1000 === null && after.population >= 1000) m.city1000 = now;
    if (m.phase1 === null && state.phaseReached >= 1) m.phase1 = now;
    if (m.phase2 === null && state.phaseReached >= 2) m.phase2 = now;
    for (let k = 0; k < state.goals.guide; k += 1) if (guide[k] === null) guide[k] = now;
    // Every objective's progress, open or not, claimed or not: when it was first done.
    if (t.OBJECTIVES_ENABLED) for (const o of OBJECTIVES) if (done[o.id] === null && o.progress(state, t).done) done[o.id] = now;
    if (stopWhenDone && Object.values(m).every((v) => v !== null)) {
      step += 1;
      break;
    }
  }
  return { moments: m, goals: { guide, done, claimed }, state, seconds: step * realPerStep, log };
}

/** Real seconds as a player reads them. */
export function clock(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 90) return `${seconds.toFixed(0)} s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} h`;
}

/**
 * The planet alone, played for `seconds` of real time at 1x (Batch 30): the
 * bank spent down the reference priorities every few seconds, and - with
 * `script.claim` - each planet objective's reward taken the moment it is
 * done. No city: nothing the cities do reaches the planet's goals but their
 * processors' trickle of CO2, and a planet with no city to step runs a day of
 * play in a second. Stops once every planet objective is done.
 */
export function playPlanet(t: Tuning, seconds: number, script: PacingScript = {}): { readonly done: Readonly<Record<string, number | null>>; readonly state: SimState } {
  const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };
  const planet = OBJECTIVES.filter((o) => o.chain === "planet");
  const done: Record<string, number | null> = Object.fromEntries(planet.map((o) => [o.id, null]));
  const realPerStep = t.SUBSTEP_YEARS / t.TIME_SCALE;
  const stepsPerLook = Math.max(1, Math.round((DECIDE_EVERY_S * t.TIME_SCALE) / t.SUBSTEP_YEARS));
  let state = marsStart(undefined, t);
  for (let step = 0; step < Math.ceil(seconds / realPerStep); step += 1) {
    if (step % stepsPerLook === 0) {
      state = spendDown(state, step * t.SUBSTEP_YEARS, t);
      if (script.claim) {
        for (const o of objectiveStatus(state, t)) {
          if (o.def.chain !== "planet" || !o.open || o.claimed || !o.progress.done || o.def.id === script.withhold) continue;
          const outcome = claimObjective(state, o.def.id, t);
          if (outcome.ok) state = outcome.state;
        }
      }
    }
    state = advance(state, 1, cfg);
    for (const o of planet) if (done[o.id] === null && o.progress(state, t).done) done[o.id] = (step + 1) * realPerStep;
    if (planet.every((o) => done[o.id] !== null)) break;
  }
  return { done, state };
}
