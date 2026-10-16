/**
 * Events that ask for decisions (Batch 33): "the planet and the cities throw
 * problems the player must answer - choices with costs, not only weather
 * that happens."
 *
 * THE DECK IS SEEDED BY THE WORLD, AS STORMS ARE. When a card is dealt is a
 * pure function of the seed and the substep (`cardAt`): a slot every
 * DECISION_EVERY_SECONDS of real time at 1x, a card in it with chance
 * DECISION_CHANCE, at a moment in it drawn by hash - never a cursor, so it is
 * the same however the time was split. WHAT the card is depends on the world
 * as it stands at that substep (which cities stand, what they have built),
 * which `advance` reaches identically live, offline or chunked any way.
 *
 * UNLIKE A STORM, AN EVENT IS STATE. The player's choice cannot be derived
 * from anything else, so the open events and the record of resolved ones are
 * kept in the world (`decisions`, save v18). The rule for an event's life:
 *   - it opens at its substep, with its stake fixed (the people at risk, the
 *     repair's materials), so the figures the card states are the ones that land;
 *   - a choice is paid for when it is made (`chooseDecision`, an action, like
 *     claiming an objective) and cannot be taken back;
 *   - at its deadline, inside `advance`, the outcome lands: the choice's, or,
 *     with nothing chosen, the default's.
 *
 * THE DEFAULT IS THE WORST CHOICE MADE WORSE: twice the meteor's hits, the
 * failure broken down rather than degraded, the outbreak's whole toll and
 * the quarantine's stop, a quarter of a late ship's cargo where waiting
 * brings half. So a choice always beats doing nothing, by construction; the
 * tests measure it, event by event, through a real `advance`.
 *
 * WHAT LASTS goes on the settlement (`effects`) and is counted down in its
 * own substep, as a rover's job is - so the city view and the alerts, which
 * take that same substep, see a sheltering city or a faulty building as the
 * simulation does.
 *
 * Off (DECISIONS_ENABLED 0) by default and in every world made before it.
 * Pure: no clock, no randomness beyond the seeded hash.
 */

import { BUILDING_DEFS, levelFactor } from "./micro/buildings.js";
import { capacities, constructionOf, housing } from "./micro/settlement.js";
import { frameOf, tileKey } from "./micro/space.js";
import { hashInts, rand01 } from "./rng.js";
import type { Tuning } from "./tuning.js";
import type {
  BuildingType,
  DecisionKind,
  DecisionOutcome,
  DecisionRecord,
  DecisionVariant,
  OpenDecision,
  PlacedBuilding,
  Settlement,
  SettlementEffect,
  SimState,
} from "./types.js";
import { isCityKind } from "./types.js";

/** Salts: independent questions about one card get independent answers. Fixed: changing one reshuffles every world's deck. */
const SALT = {
  dealt: 0x3301,
  at: 0x3302,
  city: 0x3303,
  kind: 0x3304,
  variant: 0x3305,
  building: 0x3306,
  hit: 0x3307,
} as const;

export const DECISION_KINDS: readonly DecisionKind[] = ["meteor", "failure", "outbreak", "ship", "discovery"];

// ---------------------------------------------------------------------------
// Time: real seconds at 1x, as substeps and as city-years
// ---------------------------------------------------------------------------

/** Whole substeps nearest to `seconds` of real time at 1x (a substep is 8.3 s in both paces). */
export function substepsFor(seconds: number, t: Tuning): number {
  return Math.round((seconds * t.TIME_SCALE) / t.SUBSTEP_YEARS);
}

/** City-years in `seconds` of real time at 1x: what a city's effect counts down in. */
export function cityYearsFor(seconds: number, t: Tuning): number {
  return seconds * t.TIME_SCALE * t.CITY_CLOCK;
}

/** Real seconds at 1x a number of substeps takes. */
export function secondsFor(substeps: number, t: Tuning): number {
  return (substeps * t.SUBSTEP_YEARS) / t.TIME_SCALE;
}

// ---------------------------------------------------------------------------
// The deck
// ---------------------------------------------------------------------------

/** The deck's slots, in substeps: where the first begins, and how long each is. */
export function deckSlots(t: Tuning): { readonly first: number; readonly every: number } {
  return { first: Math.max(0, substepsFor(t.DECISION_FIRST_SECONDS, t)), every: Math.max(1, substepsFor(t.DECISION_EVERY_SECONDS, t)) };
}

/** The substep card `k` is dealt at, or null if its slot holds none. Pure in (seed, k). */
export function cardAt(seed: number, k: number, t: Tuning): number | null {
  if (rand01(seed, k, SALT.dealt) >= t.DECISION_CHANCE) return null;
  const { first, every } = deckSlots(t);
  return first + k * every + Math.floor(rand01(seed, k, SALT.at) * every);
}

/** The card dealt at substep `step`, by number, or null. */
export function cardDealtAt(seed: number, step: number, t: Tuning): number | null {
  const { first, every } = deckSlots(t);
  if (step < first) return null;
  const k = Math.floor((step - first) / every);
  return cardAt(seed, k, t) === step ? k : null;
}

/** The player's standing cities with people in them: where a card can fall. */
function cities(s: SimState): readonly Settlement[] {
  return s.settlements.filter((c) => isCityKind(c.kind) && c.lostAtSeaLevelM === null && c.population > 0);
}

/** Buildings a meteor can hit: built (not still going up), and not the headquarters. */
function hittable(c: Settlement): number[] {
  const going = constructionOf(c);
  const out: number[] = [];
  c.buildings.forEach((b, i) => {
    if (BUILDING_DEFS[b.type].buildable && !going.has(tileKey(b.tx, b.ty))) out.push(i);
  });
  return out;
}

const LIFE_SUPPORT = ["power", "water", "oxygen", "food"] as const;

/** Buildings that can fail: built life-support producers (power, water, oxygen, food), not the headquarters. */
function failable(c: Settlement, t: Tuning): number[] {
  const going = constructionOf(c);
  const out: number[] = [];
  c.buildings.forEach((b, i) => {
    const def = BUILDING_DEFS[b.type];
    if (!def.buildable || going.has(tileKey(b.tx, b.ty))) return;
    const makes = def.produces(t);
    if (LIFE_SUPPORT.some((r) => (makes[r] ?? 0) > 0)) out.push(i);
  });
  return out;
}

/** People the city's Medical Centers shelter (built ones, by level), as the shortage rule counts them. */
function medicalShelter(c: Settlement, t: Tuning): number {
  const going = constructionOf(c);
  let shelter = 0;
  for (const b of c.buildings) if (b.type === "medical_center" && !going.has(tileKey(b.tx, b.ty))) shelter += t.MEDICAL_SHELTER * levelFactor(b.level, t);
  return shelter;
}

/** An outbreak's people at risk: OUTBREAK_SHARE of those the Medical Centers cannot shelter. */
export function outbreakAtRisk(c: Settlement, t: Tuning): number {
  return Math.round(t.OUTBREAK_SHARE * Math.max(0, c.population - medicalShelter(c, t)));
}

/** A failing building's repair, materials: FAILURE_REPAIR_SHARE of its cost, times its level. */
export function repairCost(b: PlacedBuilding, t: Tuning): number {
  return Math.ceil(t.FAILURE_REPAIR_SHARE * BUILDING_DEFS[b.type].cost(t) * b.level);
}

const WEIGHT: Readonly<Record<DecisionKind, (t: Tuning) => number>> = {
  meteor: (t) => t.DECISION_WEIGHT_METEOR,
  failure: (t) => t.DECISION_WEIGHT_FAILURE,
  outbreak: (t) => t.DECISION_WEIGHT_OUTBREAK,
  ship: (t) => t.DECISION_WEIGHT_SHIP,
  discovery: (t) => t.DECISION_WEIGHT_DISCOVERY,
};

/** Whether a kind can happen in this city now. */
function canHappen(kind: DecisionKind, c: Settlement, t: Tuning): boolean {
  switch (kind) {
    case "meteor":
      return hittable(c).length > 0;
    case "failure":
      return failable(c, t).length > 0;
    case "outbreak":
      return c.population >= t.OUTBREAK_MIN_PEOPLE && outbreakAtRisk(c, t) >= 1;
    case "ship":
    case "discovery":
      return true;
  }
}

/**
 * What card `k` is, dealt to the world as it stands at substep `step`: a city
 * drawn from the standing ones, a kind drawn by weight from those that can
 * happen there, and its particulars. Null if it falls on no one (no city with
 * people, or nothing that can happen in the one drawn).
 */
export function dealCard(s: SimState, k: number, step: number, t: Tuning): OpenDecision | null {
  const list = cities(s);
  if (list.length === 0) return null;
  const c = list[Math.floor(rand01(s.seed, k, SALT.city) * list.length)]!;
  const kinds = DECISION_KINDS.filter((kind) => WEIGHT[kind](t) > 0 && canHappen(kind, c, t));
  const total = kinds.reduce((a, kind) => a + WEIGHT[kind](t), 0);
  if (!(total > 0)) return null;
  let pick = rand01(s.seed, k, SALT.kind) * total;
  let kind = kinds[kinds.length - 1]!;
  for (const each of kinds) {
    pick -= WEIGHT[each](t);
    if (pick < 0) {
      kind = each;
      break;
    }
  }
  const r = rand01(s.seed, k, SALT.variant);
  let variant: DecisionVariant | null = null;
  if (kind === "ship") variant = r < t.SHIP_EARLY_SHARE ? "early" : r < t.SHIP_EARLY_SHARE + t.SHIP_LATE_SHARE ? "late" : "lost";
  else if (kind === "discovery") variant = r < 1 / 3 ? "ice" : r < 2 / 3 ? "meteorite" : "traces";
  return cardFor(s, k, kind, variant, c, step, t);
}

/**
 * Card `k` as a given kind (and variant) in city `c`, opening at `step`: its
 * particulars - a failing building drawn from those that can fail, an
 * outbreak's people at risk - and its deadline. What `dealCard` makes once
 * it has drawn the city and the kind; null if the kind cannot happen there.
 */
export function cardFor(s: SimState, k: number, kind: DecisionKind, variant: DecisionVariant | null, c: Settlement, step: number, t: Tuning): OpenDecision | null {
  if (!canHappen(kind, c, t)) return null;
  let at: OpenDecision["at"] = null;
  let building: BuildingType | null = null;
  let stake = 0;
  if (kind === "failure") {
    const pool = failable(c, t);
    const b = c.buildings[pool[Math.floor(rand01(s.seed, k, SALT.building) * pool.length)]!]!;
    const f = frameOf(c, t);
    at = { x: b.tx + f.x0, y: b.ty + f.y0 };
    building = b.type;
    stake = repairCost(b, t);
  } else if (kind === "outbreak") {
    stake = outbreakAtRisk(c, t);
  }
  return { id: k, kind, variant, settlement: c.id, at, building, opened: step, deadline: step + Math.max(1, substepsFor(t.DECISION_DEADLINE_SECONDS, t)), stake, chosen: null };
}

// ---------------------------------------------------------------------------
// What each event says, and offers
// ---------------------------------------------------------------------------

export interface DecisionChoice {
  readonly id: string;
  readonly title: string;
  /** Paid when it is chosen: credits from the bank, materials from the city's stores. */
  readonly credits: number;
  readonly materials: number;
  /** What happens at the deadline, in words, with the event's own figures. */
  readonly words: string;
}

const minutes = (seconds: number): string => {
  const m = seconds / 60;
  return m >= 1 && Number.isInteger(Math.round(m * 10) / 10) ? `${Math.round(m)} min` : seconds < 60 ? `${Math.round(seconds)} s` : `${m.toFixed(1)} min`;
};
const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
const nameOf = (type: BuildingType | null): string => (type === null ? "building" : BUILDING_DEFS[type].name);

/** A share of the ship's cargo, as it would land if the city had room: materials and settlers, rounded down. */
function cargo(share: number, t: Tuning): { materials: number; settlers: number } {
  return { materials: Math.floor(t.SHIP_MATERIALS * share), settlers: Math.floor(t.SHIP_SETTLERS * share) };
}
function cargoWords(share: number, t: Tuning): string {
  const c = cargo(share, t);
  if (c.materials === 0 && c.settlers === 0) return "nothing lands";
  const parts = [c.materials > 0 ? count(c.materials, "material") : "", c.settlers > 0 ? count(c.settlers, "settler") : ""].filter((x) => x !== "");
  return `${parts.join(" and ")} land, as the city has room`;
}

/** The share of the cargo each choice lands, and the default's. */
function shipShare(variant: DecisionVariant | null, chosen: string | null, t: Tuning): number {
  if (variant === "early") return chosen === "pad" ? 1 : chosen === "rough" ? t.SHIP_ROUGH : t.SHIP_UNATTENDED_EARLY;
  if (variant === "late") return chosen === "rush" ? 1 : chosen === "wait" ? t.SHIP_WAIT : t.SHIP_UNATTENDED_LATE;
  return chosen === "search" ? t.SHIP_FOUND : 0;
}

/** The event's name, as the card heads it. */
export function decisionTitle(e: Pick<OpenDecision, "kind" | "variant" | "building">): string {
  switch (e.kind) {
    case "meteor":
      return "Meteor shower";
    case "failure":
      return `${nameOf(e.building)} failing`;
    case "outbreak":
      return "Outbreak";
    case "ship":
      return e.variant === "early" ? "Supply ship early" : e.variant === "late" ? "Supply ship late" : "Supply ship lost";
    case "discovery":
      return "A discovery";
  }
}

/** What has happened, in a sentence: the card's first line. */
export function decisionText(e: OpenDecision, t: Tuning): string {
  switch (e.kind) {
    case "meteor":
      return "A meteor shower is on its way. It reaches the city when the time runs out.";
    case "failure":
      return `A fault in a ${nameOf(e.building)}: it fails when the time runs out unless it is seen to.`;
    case "outbreak":
      return `A sickness is spreading. ${count(e.stake, "person", "people")} are at risk - the city's Medical Centers shelter the rest.`;
    case "ship": {
      const full = cargoWords(1, t).replace(", as the city has room", "");
      if (e.variant === "early") return `Earth's supply ship (${full.replace(" land", "")}) is early and the landing pad is not ready.`;
      if (e.variant === "late") return `Earth's supply ship (${full.replace(" land", "")}) is late, and its cargo will not keep for ever.`;
      return `Contact with Earth's supply ship (${full.replace(" land", "")}) is lost.`;
    }
    case "discovery":
      return e.variant === "ice"
        ? "The rovers have found a vein of ancient ice."
        : e.variant === "meteorite"
          ? "The rovers have found a meteorite."
          : "The rovers have found traces in the rock that might once have been alive.";
  }
}

/** The choices, in the order the card shows them, with what each costs and does. */
export function decisionChoices(e: OpenDecision, t: Tuning): readonly DecisionChoice[] {
  const free = { credits: 0, materials: 0 };
  switch (e.kind) {
    case "meteor":
      return [
        { id: "shelter", title: CHOICE_TITLES["shelter"]!, ...free, words: `Everyone under cover as it passes: no materials made and no research earned for ${minutes(t.METEOR_SHELTER_SECONDS)}. Nothing is hit.` },
        { id: "shields", title: CHOICE_TITLES["shields"]!, credits: t.METEOR_SHIELD_CREDITS, materials: 0, words: "Nothing is hit, and work goes on." },
        { id: "work", title: CHOICE_TITLES["work"]!, ...free, words: `${count(t.METEOR_HITS, "hit")}: each takes a building down a level, and wrecks one at level 1.` },
      ];
    case "failure":
      return [
        { id: "repair", title: CHOICE_TITLES["repair"]!, credits: 0, materials: e.stake, words: "It runs as before." },
        { id: "degraded", title: CHOICE_TITLES["degraded"]!, ...free, words: `It makes ${Math.round(t.FAILURE_DEGRADED * 100)}% of its output for ${minutes(t.FAILURE_SECONDS)}.` },
      ];
    case "outbreak":
      return [
        { id: "treat", title: CHOICE_TITLES["treat"]!, credits: Math.ceil(t.OUTBREAK_TREAT_CREDITS * e.stake), materials: 0, words: `${count(Math.round(e.stake * t.OUTBREAK_TREATED), "person", "people")} lost.` },
        { id: "quarantine", title: CHOICE_TITLES["quarantine"]!, ...free, words: `${count(Math.round(e.stake * t.OUTBREAK_QUARANTINED), "person", "people")} lost, and the city does not grow for ${minutes(t.OUTBREAK_QUARANTINE_SECONDS)}.` },
      ];
    case "ship":
      if (e.variant === "early") {
        return [
          { id: "rough", title: CHOICE_TITLES["rough"]!, ...free, words: `Part of the cargo is broken: ${cargoWords(t.SHIP_ROUGH, t)}.` },
          { id: "pad", title: CHOICE_TITLES["pad"]!, credits: 0, materials: t.SHIP_PAD_MATERIALS, words: `All of it: ${cargoWords(1, t)}.` },
        ];
      }
      if (e.variant === "late") {
        return [
          { id: "rush", title: CHOICE_TITLES["rush"]!, credits: t.SHIP_RUSH_CREDITS, materials: 0, words: `All of it: ${cargoWords(1, t)}.` },
          { id: "wait", title: CHOICE_TITLES["wait"]!, ...free, words: `The rest spoils: ${cargoWords(t.SHIP_WAIT, t)}.` },
        ];
      }
      return [
        { id: "search", title: CHOICE_TITLES["search"]!, credits: t.SHIP_SEARCH_CREDITS, materials: 0, words: `Part of it is found: ${cargoWords(t.SHIP_FOUND, t)}.` },
        { id: "writeoff", title: CHOICE_TITLES["writeoff"]!, ...free, words: `Earth's insurance pays ${count(t.SHIP_INSURANCE_CREDITS, "credit")}.` },
      ];
    case "discovery":
      return [
        { id: "study", title: CHOICE_TITLES["study"]!, credits: t.DISCOVERY_STUDY_CREDITS, materials: 0, words: `The research earns ${count(t.DISCOVERY_RESEARCH_CREDITS, "credit")}.` },
        { id: "sell", title: CHOICE_TITLES["sell"]!, ...free, words: `Earth pays ${count(t.DISCOVERY_SELL_CREDITS, "credit")}.` },
      ];
  }
}

/** What happens if nothing is chosen by the deadline: always the worst choice made worse. */
export function defaultWords(e: OpenDecision, t: Tuning): string {
  switch (e.kind) {
    case "meteor":
      return `The city is caught unprepared: ${count(2 * t.METEOR_HITS, "hit")}, the ${t.METEOR_HITS} of keeping working and as many more.`;
    case "failure":
      return `It breaks down: offline for ${minutes(t.FAILURE_SECONDS)}.`;
    case "outbreak":
      return `It runs its course: all ${count(e.stake, "person", "people")} at risk lost, and the city does not grow for ${minutes(t.OUTBREAK_QUARANTINE_SECONDS)}.`;
    case "ship":
      if (e.variant === "early") return `It comes down as it can: ${cargoWords(t.SHIP_UNATTENDED_EARLY, t)}.`;
      if (e.variant === "late") return `It is left in orbit too long: ${cargoWords(t.SHIP_UNATTENDED_LATE, t)}.`;
      return "Nothing is found and no claim is made.";
    case "discovery":
      return "The find is left where it lies.";
  }
}

// ---------------------------------------------------------------------------
// The player's choice
// ---------------------------------------------------------------------------

export interface ChooseOutcome {
  readonly state: SimState;
  readonly ok: boolean;
  readonly reason: string | null;
}

function withCity(s: SimState, c: Settlement): SimState {
  return { ...s, settlements: s.settlements.map((x) => (x.id === c.id ? c : x)) };
}

/**
 * The player's answer to an open event: paid for now, its outcome at the
 * deadline. Refused, changing nothing, with events off, for an event over or
 * already answered, a choice it does not offer, a city gone, or a cost the
 * bank or the city's stores cannot meet - and says why.
 */
export function chooseDecision(s: SimState, id: number, choiceId: string, t: Tuning): ChooseOutcome {
  const refuse = (reason: string): ChooseOutcome => ({ state: s, ok: false, reason });
  if (!t.DECISIONS_ENABLED) return refuse("events are not part of this world");
  const e = s.decisions.open.find((x) => x.id === id);
  if (e === undefined) return refuse("that event is over");
  if (e.chosen !== null) return refuse("that is decided already");
  const choice = decisionChoices(e, t).find((c) => c.id === choiceId);
  if (choice === undefined) return refuse(`"${decisionTitle(e)}" offers no "${choiceId}"`);
  const city = s.settlements.find((c) => c.id === e.settlement);
  if (city === undefined || city.lostAtSeaLevelM !== null) return refuse("the city is gone");
  if (choice.credits > s.economy.credits) return refuse(`it needs ${count(choice.credits, "credit")}; the bank holds ${Math.floor(s.economy.credits).toLocaleString("en")}`);
  if (choice.materials > city.stores.materials) return refuse(`it needs ${count(choice.materials, "material")}; the city holds ${Math.floor(city.stores.materials).toLocaleString("en")}`);
  let next: SimState = s;
  if (choice.materials > 0) next = withCity(next, { ...city, stores: { ...city.stores, materials: city.stores.materials - choice.materials } });
  if (choice.credits > 0) next = { ...next, economy: { ...next.economy, credits: next.economy.credits - choice.credits, spent: next.economy.spent + choice.credits } };
  const open = next.decisions.open.map((x) => (x.id === id ? { ...x, chosen: choiceId } : x));
  return { state: { ...next, decisions: { ...next.decisions, open } }, ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// The deadline: outcomes, inside `advance`
// ---------------------------------------------------------------------------

const NONE: DecisionOutcome = Object.freeze({ people: 0, materials: 0, credits: 0, hit: 0, wrecked: 0 });

function addEffect(c: Settlement, effect: SettlementEffect): Settlement {
  return { ...c, effects: [...c.effects, effect] };
}

/** `count` hits, drawn by hash over the buildings a meteor can hit; the first draws are the same whatever the count. */
function meteorHits(s: SimState, e: OpenDecision, c: Settlement, hits: number): { next: Settlement; hit: number; wrecked: number } {
  const pool = hittable(c);
  if (pool.length === 0) return { next: c, hit: 0, wrecked: 0 };
  const taken = new Map<number, number>();
  for (let k = 0; k < hits; k += 1) {
    const i = pool[hashInts(s.seed, e.id, k, SALT.hit) % pool.length]!;
    taken.set(i, (taken.get(i) ?? 0) + 1);
  }
  const wreckedCorners = new Set<number>();
  const buildings: PlacedBuilding[] = [];
  c.buildings.forEach((b, i) => {
    const n = taken.get(i) ?? 0;
    if (n === 0) buildings.push(b);
    else if (b.level - n >= 1) buildings.push({ ...b, level: b.level - n });
    else wreckedCorners.add(tileKey(b.tx, b.ty));
  });
  if (wreckedCorners.size === 0) return { next: { ...c, buildings }, hit: taken.size, wrecked: 0 };
  // A wrecked building goes as a removed one does: its rover comes home, what was paid for a build still waiting is refunded, and its fault with it.
  const refund = c.buildQueue.filter((q) => wreckedCorners.has(q.tile)).reduce((a, q) => a + q.paid, 0);
  const next: Settlement = {
    ...c,
    buildings,
    stores: refund > 0 ? { ...c.stores, materials: c.stores.materials + refund } : c.stores,
    jobs: c.jobs.filter((j) => !(j.kind === "build" && wreckedCorners.has(j.tile))),
    buildQueue: c.buildQueue.filter((q) => !wreckedCorners.has(q.tile)),
    effects: c.effects.filter((x) => x.tile === null || !wreckedCorners.has(x.tile)),
  };
  return { next, hit: taken.size, wrecked: wreckedCorners.size };
}

/** Materials and settlers landed in the city, as its stores and homes have room. */
function land(c: Settlement, materials: number, settlers: number, t: Tuning): { next: Settlement; materials: number; people: number } {
  const m = Math.max(0, Math.min(materials, capacities(c, t).materials - c.stores.materials));
  const p = Math.max(0, Math.min(settlers, housing(c, t) - c.population));
  if (m === 0 && p === 0) return { next: c, materials: 0, people: 0 };
  return { next: { ...c, population: c.population + p, stores: { ...c.stores, materials: c.stores.materials + m } }, materials: m, people: p };
}

/** The building an event is about, by its corner on the ground as founded, or -1 if it is gone. */
function buildingOf(c: Settlement, e: OpenDecision, t: Tuning): number {
  if (e.at === null) return -1;
  const f = frameOf(c, t);
  return c.buildings.findIndex((b) => b.tx + f.x0 === e.at!.x && b.ty + f.y0 === e.at!.y && b.type === e.building);
}

/**
 * An event's outcome, landed: the choice's, or with none chosen the
 * default's. Costs were paid when the choice was made; what lands here is
 * what the card said would. A city gone by then takes nothing.
 */
export function resolveDecision(s: SimState, e: OpenDecision, t: Tuning): { readonly state: SimState; readonly outcome: DecisionOutcome } {
  const c = s.settlements.find((x) => x.id === e.settlement);
  if (c === undefined || c.lostAtSeaLevelM !== null) return { state: s, outcome: NONE };
  const chosen = e.chosen;
  switch (e.kind) {
    case "meteor": {
      if (chosen === "shields") return { state: s, outcome: NONE };
      if (chosen === "shelter") return { state: withCity(s, addEffect(c, { kind: "shelter", tile: null, factor: 0, remaining: cityYearsFor(t.METEOR_SHELTER_SECONDS, t), event: e.id })), outcome: NONE };
      const hits = chosen === "work" ? t.METEOR_HITS : 2 * t.METEOR_HITS;
      const struck = meteorHits(s, e, c, hits);
      return { state: withCity(s, struck.next), outcome: { ...NONE, hit: struck.hit, wrecked: struck.wrecked } };
    }
    case "failure": {
      if (chosen === "repair") return { state: s, outcome: NONE };
      const i = buildingOf(c, e, t);
      if (i < 0) return { state: s, outcome: NONE };
      const b = c.buildings[i]!;
      const factor = chosen === "degraded" ? t.FAILURE_DEGRADED : 0;
      return { state: withCity(s, addEffect(c, { kind: "fault", tile: tileKey(b.tx, b.ty), factor, remaining: cityYearsFor(t.FAILURE_SECONDS, t), event: e.id })), outcome: NONE };
    }
    case "outbreak": {
      const share = chosen === "treat" ? t.OUTBREAK_TREATED : chosen === "quarantine" ? t.OUTBREAK_QUARANTINED : 1;
      const lost = Math.min(c.population, Math.round(e.stake * share));
      let next: Settlement = lost > 0 ? { ...c, population: c.population - lost } : c;
      if (chosen !== "treat") next = addEffect(next, { kind: "quarantine", tile: null, factor: 0, remaining: cityYearsFor(t.OUTBREAK_QUARANTINE_SECONDS, t), event: e.id });
      return { state: withCity(s, next), outcome: { ...NONE, people: -lost } };
    }
    case "ship": {
      const share = shipShare(e.variant, chosen, t);
      const want = cargo(share, t);
      const landed = land(c, want.materials, want.settlers, t);
      let next = withCity(s, landed.next);
      const credits = e.variant === "lost" && chosen === "writeoff" ? t.SHIP_INSURANCE_CREDITS : 0;
      if (credits > 0) next = { ...next, economy: { ...next.economy, credits: next.economy.credits + credits, earned: next.economy.earned + credits } };
      return { state: next, outcome: { ...NONE, people: landed.people, materials: landed.materials, credits } };
    }
    case "discovery": {
      const credits = chosen === "study" ? t.DISCOVERY_RESEARCH_CREDITS : chosen === "sell" ? t.DISCOVERY_SELL_CREDITS : 0;
      if (credits === 0) return { state: s, outcome: NONE };
      return { state: { ...s, economy: { ...s.economy, credits: s.economy.credits + credits, earned: s.economy.earned + credits } }, outcome: { ...NONE, credits } };
    }
  }
}

/**
 * The deck's work for one substep, from `advance` once the substep's state
 * is in (`state.steps` already counts it): every open event whose deadline
 * has come resolves, in the order they opened, then the card dealt at this
 * substep, if any, opens. Returns the same state when nothing happened, so
 * a world with events off - or between cards - allocates nothing.
 */
export function stepDecisions(s: SimState, t: Tuning): SimState {
  if (!t.DECISIONS_ENABLED) return s;
  let state = s;
  if (state.decisions.open.some((e) => e.deadline <= state.steps)) {
    const records: DecisionRecord[] = [];
    const waiting: OpenDecision[] = [];
    for (const e of state.decisions.open) {
      if (e.deadline > state.steps) {
        waiting.push(e);
        continue;
      }
      const done = resolveDecision(state, e, t);
      state = done.state;
      records.push({ id: e.id, kind: e.kind, variant: e.variant, settlement: e.settlement, building: e.building, opened: e.opened, resolved: state.steps, chosen: e.chosen, outcome: done.outcome });
    }
    const log = [...state.decisions.log, ...records];
    state = { ...state, decisions: { open: waiting, log: log.length > t.DECISION_LOG ? log.slice(log.length - t.DECISION_LOG) : log } };
  }
  const k = cardDealtAt(state.seed, state.steps, t);
  if (k !== null && !state.decisions.open.some((e) => e.id === k) && !state.decisions.log.some((r) => r.id === k)) {
    const card = dealCard(state, k, state.steps, t);
    if (card !== null) state = { ...state, decisions: { ...state.decisions, open: [...state.decisions.open, card] } };
  }
  return state;
}

/** Every choice's title, by its id (unique across the kinds). */
export const CHOICE_TITLES: Readonly<Record<string, string>> = {
  shelter: "Take shelter",
  shields: "Raise the shields",
  work: "Keep working",
  repair: "Repair it",
  degraded: "Run it degraded",
  treat: "Treat everyone",
  quarantine: "Quarantine",
  rough: "Land it rough",
  pad: "Clear the pad",
  rush: "Pay to rush it",
  wait: "Wait for it",
  search: "Search for it",
  writeoff: "Write it off",
  study: "Study it",
  sell: "Sell the samples to Earth",
};
