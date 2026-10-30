/**
 * Achievements (Batch 39): "about thirty, each with an exact condition and
 * checked from state. The rare ones reward a style of play, not a grind."
 *
 * CHECKED FROM THE STATE. Each is a condition on the world - the phase
 * latched, the people living, what stands, what Earth has seen, what the sea
 * has done - asked once a substep in `advance` until it holds, then latched
 * with the substep it was earned at (`ending.achievements`). Never earned by
 * a button, and never lost: a city that falls later does not unmake the
 * three that stood.
 *
 * THE RARE ONES are asked at the victory: how the world was won - with
 * nobody lost to the sea, with a light touch on the planet, swiftly, without
 * buying from Earth, and a city held behind its wall. Each reads a count that
 * only grows (the machine-years, the people lost, the years) or a fixed
 * substep (the victory), so a condition that fails at the victory can never
 * hold later: the latch asks it on the victory's own substep first.
 *
 * None can be earned in a new world's first minute: each waits on something
 * a minute cannot bring (measured in the scripted runs of `ending.test.ts`).
 *
 * ENDING_ENABLED's, like the rest of the ending. Pure: no clock, no
 * randomness.
 */

import { surfaceCover, totalPressure } from "./derive.js";
import { citiesJoined } from "./objectives.js";
import { BUILDING_DEFS, BUILD_TIER } from "./micro/buildings.js";
import { dikeHeightM } from "./micro/flood.js";
import { constructionOf } from "./micro/settlement.js";
import { tileKey } from "./micro/space.js";
import { groundOf, heldBySeawall, peopleOn, seaNow } from "./ending.js";
import { TARGETS } from "./targets.js";
import type { Tuning } from "./tuning.js";
import type { EarnedAchievement, Settlement, SimState } from "./types.js";
import { EARTH_GOODS, Phase, isCityKind } from "./types.js";

export type AchievementGroup = "planet" | "cities" | "earth" | "events" | "sea" | "style";
export const ACHIEVEMENT_GROUPS: readonly AchievementGroup[] = ["planet", "cities", "earth", "events", "sea", "style"];
export const GROUP_NAMES: Readonly<Record<AchievementGroup, string>> = {
  planet: "The planet",
  cities: "Cities",
  earth: "Earth and the bank",
  events: "Events",
  sea: "The sea",
  style: "How it was won",
};

export interface AchievementDef {
  readonly id: string;
  readonly group: AchievementGroup;
  readonly title: string;
  /** Exactly what earns it, in words. */
  readonly counts: (t: Tuning) => string;
  /** A rare one: a style of play, asked at the victory or of the sea. */
  readonly rare: boolean;
  /** True once the world shows it done. Asked a substep at a time until it holds, then never again. */
  readonly earned: (s: SimState, t: Tuning) => boolean;
}

function standingCities(s: SimState): readonly Settlement[] {
  return s.settlements.filter((c) => isCityKind(c.kind) && c.lostAtSeaLevelM === null);
}

/**
 * A great structure that asks for a city of ACH_PEOPLE_MANY or more, standing
 * (not going up). The great structures that ask for no one - the
 * headquarters and spaceport a city lands with, the Seawall, the biosphere -
 * could stand within a minute at the Classic pace, where a build takes
 * seconds.
 */
function greatStanding(s: SimState, t: Tuning): boolean {
  for (const c of s.settlements) {
    if (c.lostAtSeaLevelM !== null) continue;
    let going: ReadonlyMap<number, number> | null = null;
    for (const b of c.buildings) {
      if (BUILD_TIER[b.type] !== "great" || BUILDING_DEFS[b.type].minPopulation(t) < t.ACH_PEOPLE_MANY) continue;
      going ??= constructionOf(c);
      if (!going.has(tileKey(b.tx, b.ty))) return true;
    }
  }
  return false;
}

const won = (s: SimState): boolean => s.ending.victory !== null;

/**
 * The achievements, group by group. Each waits on something a minute of play
 * cannot bring: the planet's years, people (who come at a city's growth), a
 * great structure's population, Earth's launch windows (the first a player
 * can meet is 2.135 planet-years in: 70 s at the Classic pace), the first
 * event (half an hour in), the sea, or the victory.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = Object.freeze([
  // ---- the planet: section 7's milestones, the air, the sea, and the win ----
  { id: "caps", group: "planet", title: "The caps let go", rare: false, counts: () => "The planet reaches Phase 2, runaway thickening.", earned: (s) => s.phaseReached >= Phase.RunawayThickening },
  { id: "first_water", group: "planet", title: "Open water", rare: false, counts: () => "The planet reaches Phase 3: liquid water at the surface.", earned: (s) => s.phaseReached >= Phase.FirstWater },
  { id: "green", group: "planet", title: "Green at the water's edge", rare: false, counts: () => "The planet reaches Phase 4, ecopoiesis: life takes hold.", earned: (s) => s.phaseReached >= Phase.Ecopoiesis },
  { id: "blue_sky", group: "planet", title: "Blue sky", rare: false, counts: () => "The planet reaches Phase 5, oxygenation and buffer.", earned: (s) => s.phaseReached >= Phase.Oxygenation },
  { id: "half_bar", group: "planet", title: "Half an atmosphere", rare: false, counts: (t) => `The air reaches ${t.ACH_PRESSURE_MBAR} mbar at the surface.`, earned: (s, t) => totalPressure(s.reservoirs) >= t.ACH_PRESSURE_MBAR },
  { id: "breathable", group: "planet", title: "A breath of air", rare: false, counts: () => `Oxygen reaches ${TARGETS.o2.min} mbar: enough to breathe.`, earned: (s) => s.reservoirs.o2 >= TARGETS.o2.min },
  { id: "ocean", group: "planet", title: "An ocean", rare: false, counts: () => `The sea covers ${Math.round(TARGETS.ocean.bandLo * 100)}% of the planet.`, earned: (s, t) => surfaceCover(s.reservoirs, t).oceanFrac >= TARGETS.ocean.bandLo },
  { id: "living", group: "planet", title: "A living world", rare: false, counts: () => "The planet reaches Phase 6: every one of the six minimums met at once.", earned: (s) => s.phaseReached >= Phase.LivingWorld },
  { id: "victory", group: "planet", title: "Home", rare: false, counts: (t) => `Win: the planet holds all six minimums for ${t.VICTORY_HOLD_YEARS} years in a row.`, earned: won },
  // ---- cities: each waits on people, who take time to come ---------------
  { id: "people_few", group: "cities", title: "A hundred people", rare: false, counts: (t) => `${t.ACH_PEOPLE_FEW.toLocaleString("en")} people living on the planet.`, earned: (s, t) => peopleOn(s) >= t.ACH_PEOPLE_FEW },
  { id: "people_many", group: "cities", title: "A thousand people", rare: false, counts: (t) => `${t.ACH_PEOPLE_MANY.toLocaleString("en")} people living on the planet.`, earned: (s, t) => peopleOn(s) >= t.ACH_PEOPLE_MANY },
  { id: "people_most", group: "cities", title: "A people", rare: false, counts: (t) => `${t.ACH_PEOPLE_MOST.toLocaleString("en")} people living on the planet.`, earned: (s, t) => peopleOn(s) >= t.ACH_PEOPLE_MOST },
  {
    id: "great",
    group: "cities",
    title: "A great structure",
    rare: false,
    counts: (t) => `A great structure that asks for a city of ${t.ACH_PEOPLE_MANY.toLocaleString("en")} people or more stands finished: a skyscraper, Medical Center, observatory, station or mega mall.`,
    earned: greatStanding,
  },
  { id: "claim", group: "cities", title: "Room to grow", rare: false, counts: () => "Land claimed beyond a city's founding ground.", earned: (s) => standingCities(s).some((c) => c.claims.length > 0) },
  {
    id: "network",
    group: "cities",
    title: "A network",
    rare: false,
    counts: (t) => `${t.ACH_CITIES} cities on one rail network, with a city of ${t.ACH_TOWN_PEOPLE.toLocaleString("en")} people.`,
    earned: (s, t) => standingCities(s).some((c) => c.population >= t.ACH_TOWN_PEOPLE) && citiesJoined(s) >= t.ACH_CITIES,
  },
  { id: "metropolis", group: "cities", title: "A metropolis", rare: false, counts: () => "A metropolis founded.", earned: (s) => s.settlements.some((c) => c.kind === "metropolis") },
  { id: "millennium", group: "cities", title: "A thousand years", rare: false, counts: (t) => `A city still standing in the year ${t.ACH_YEAR.toLocaleString("en")}.`, earned: (s, t) => s.steps * t.SUBSTEP_YEARS >= t.ACH_YEAR && standingCities(s).length > 0 },
  // ---- Earth and the bank ---------------------------------------------------
  { id: "fortune", group: "earth", title: "A fortune", rare: false, counts: (t) => `${t.ACH_CREDITS_EARNED.toLocaleString("en")} credits taken in, all told.`, earned: (s, t) => s.economy.earned >= t.ACH_CREDITS_EARNED },
  { id: "rocket", group: "earth", title: "Lift-off", rare: false, counts: () => "A rocket lifts off for Earth.", earned: (s) => s.earth.flights.length > 0 || s.earth.log.some((r) => r.kind === "launched") },
  { id: "contract", group: "earth", title: "Delivered", rare: false, counts: () => "An Earth contract met.", earned: (s) => s.earth.fulfilled >= 1 },
  { id: "trusted", group: "earth", title: "Trusted by Earth", rare: false, counts: (t) => `Earth's regard reaches ${t.ACH_REPUTATION}.`, earned: (s, t) => s.earth.reputation >= t.ACH_REPUTATION },
  // ---- events ---------------------------------------------------------
  { id: "answered", group: "events", title: "Decisive", rare: false, counts: () => "An event answered before its time ran out.", earned: (s) => s.ending.eventsAnswered >= 1 },
  { id: "steady_hands", group: "events", title: "Steady hands", rare: false, counts: (t) => `${t.ACH_EVENTS_ANSWERED} events answered before their time ran out.`, earned: (s, t) => s.ending.eventsAnswered >= t.ACH_EVENTS_ANSWERED },
  // ---- the sea --------------------------------------------------------
  {
    id: "seawall",
    group: "sea",
    title: "Against the sea",
    rare: false,
    counts: (t) => `A Seawall standing in a city as the sea comes within ${t.FLOOD_WARN_MARGIN_M} m of its ground.`,
    earned: (s, t) => {
      const sea = seaNow(s, t);
      return sea !== null && standingCities(s).some((c) => sea >= groundOf(c, t) - t.FLOOD_WARN_MARGIN_M && dikeHeightM(c, t) > 0);
    },
  },
  { id: "evacuated", group: "sea", title: "Everyone out", rare: false, counts: () => "People moved to safety from a city the sea threatens.", earned: (s) => s.ending.peopleEvacuated >= 1 },
  {
    id: "held",
    group: "sea",
    title: "Held the line",
    rare: true,
    counts: (t) => `A city standing with the sea ${t.FLOOD_THRESHOLD_M} m or more over its ground - where it would be lost - behind its Seawall.`,
    earned: (s, t) => {
      const sea = seaNow(s, t);
      return sea !== null && s.settlements.some((c) => heldBySeawall(c, sea, t));
    },
  },
  // ---- how it was won: asked at the victory ----------------------------
  {
    id: "nobody_lost",
    group: "style",
    title: "Nobody lost to the sea",
    rare: true,
    counts: (t) => `Win with at least ${t.ACH_STANDING_CITIES} cities standing, no settlement and no one lost to the sea.`,
    earned: (s, t) => won(s) && standingCities(s).length >= t.ACH_STANDING_CITIES && s.ending.peopleLost === 0 && s.settlements.every((c) => c.lostAtSeaLevelM === null),
  },
  {
    id: "light_touch",
    group: "style",
    title: "A light touch",
    rare: true,
    counts: (t) => `Win with fewer than ${t.ACH_LIGHT_MACHINE_YEARS.toLocaleString("en")} machine-years: every machine of the planet's, for every year it ran.`,
    earned: (s, t) => won(s) && s.ending.machineYears < t.ACH_LIGHT_MACHINE_YEARS,
  },
  { id: "swift", group: "style", title: "Swift", rare: true, counts: (t) => `Win within ${t.ACH_SWIFT_YEARS.toLocaleString("en")} years.`, earned: (s, t) => won(s) && s.ending.victory! * t.SUBSTEP_YEARS <= t.ACH_SWIFT_YEARS },
  { id: "self_reliant", group: "style", title: "Self-reliant", rare: true, counts: () => "Win without buying anything from Earth.", earned: (s) => won(s) && EARTH_GOODS.every((g) => s.earth.bought[g] === 0) },
] satisfies AchievementDef[]);

const BY_ID: ReadonlyMap<string, AchievementDef> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function achievementById(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

/**
 * The latch, once a substep from `advance`: every achievement not yet earned
 * whose condition the state now shows, recorded with this substep. Returns
 * the same state when nothing is new.
 */
export function latchAchievements(s: SimState, t: Tuning): SimState {
  if (!t.ENDING_ENABLED) return s;
  const have = s.ending.achievements;
  if (have.length >= ACHIEVEMENTS.length) return s;
  const earned = earnedOf(have);
  let fresh: { id: string; step: number }[] | null = null;
  for (const a of ACHIEVEMENTS) {
    if (earned.has(a.id) || !a.earned(s, t)) continue;
    (fresh ??= []).push({ id: a.id, step: s.steps });
  }
  return fresh === null ? s : { ...s, ending: { ...s.ending, achievements: [...have, ...fresh] } };
}

const EARNED = new WeakMap<readonly EarnedAchievement[], ReadonlySet<string>>();

/** The ids in a list of earned achievements, kept per list: the latch asks every substep, and the list rarely changes. */
function earnedOf(have: readonly EarnedAchievement[]): ReadonlySet<string> {
  let ids = EARNED.get(have);
  if (ids === undefined) {
    ids = new Set(have.map((a) => a.id));
    EARNED.set(have, ids);
  }
  return ids;
}

/** The achievements earned in this world, by id. */
export function earnedIds(s: SimState): ReadonlySet<string> {
  return earnedOf(s.ending.achievements);
}
