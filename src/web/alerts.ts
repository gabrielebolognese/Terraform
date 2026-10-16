/**
 * The alerts (Batch 31): "the player is told what needs them, when it needs
 * them, without hunting for it."
 *
 * Two sorts, both derived at the readout from the state, never stored:
 *
 * - **Conditions** - what is so now: a blackout, a shortage, buildings
 *   offline and why, a flood warning, a storm coming. Each is worked out from
 *   the settlement's own substep (the one the simulation takes next, which the
 *   city view draws from too) and lasts as long as it holds.
 * - **Happenings** - what just happened: a build finished, an upgrade
 *   finished, an objective done. Each is a crossing seen between two looks at
 *   the world, as the milestones are.
 *
 * The watch keeps only its bearings between looks - which conditions held,
 * what was going up and at what level - so a reloaded world starts a fresh
 * record rather than replaying a stale one. The first look only takes its
 * bearings: what was already so on opening a world is listed, not announced.
 *
 * Grouped: a hundred depots offline for one reason in one city are one line.
 *
 * Reads the state; never writes it.
 */

import type { BuildingType, HabitatChannels, MicroResource, Settlement, SettlementStep, SimState, Tuning } from "../sim/index.js";
import { BUILDING_DEFS, MICRO_RESOURCES, constructionOf, decisionText, eventsBeginningIn, frameOf, objectiveStatus, settlementStep, simYear, submerged, tileKey } from "../sim/index.js";
import { decisionHeadline, deadlineWords, outcomeWords } from "./decision-words.js";
import { recordWords } from "./earth-words.js";
import { formatDuration } from "./build-time.js";
import { ALERT_QUIET_MS, STORM_WARN_SECONDS } from "./config.js";
import { floodWarnings } from "./flood-warning.js";
import { MADE_BY, RESOURCE_NAMES, offlineWords } from "./offline-words.js";
import { settlementLabel } from "./settlement-label.js";

export type AlertKind = "blackout" | "shortage" | "offline" | "flood" | "storm" | "built" | "upgraded" | "objective" | "decision" | "resolved" | "earth";

/** Urgent and notice interrupt with a toast; a record only goes in the centre. */
export type AlertPriority = "urgent" | "notice" | "record";

/**
 * Where an alert clicks through to. A building is named by its corner on the
 * ground as founded (its tile plus the frame's corner), which a claim west or
 * north does not move - a tile index would.
 */
export type AlertTarget =
  | { readonly kind: "city"; readonly id: string; readonly at: { readonly x: number; readonly y: number } | null }
  | { readonly kind: "planet" }
  | { readonly kind: "objectives" }
  /** Batch 34: the Earth panel. */
  | { readonly kind: "earth" };

export interface Alert {
  /** Its identity: a condition is the same alert for as long as it holds; a happening's says where it happened. */
  readonly key: string;
  readonly kind: AlertKind;
  readonly priority: AlertPriority;
  readonly title: string;
  readonly text: string;
  /** How many it stands for: buildings offline, finished, raised. */
  readonly count: number;
  /** A blackout's or a shortage's resource. */
  readonly resource?: MicroResource;
  readonly target: AlertTarget;
}

export const PRIORITY_ORDER: Readonly<Record<AlertPriority, number>> = { urgent: 0, notice: 1, record: 2 };

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
const nameOf = (type: BuildingType): string => BUILDING_DEFS[type].name;
const pluralName = (type: BuildingType, n: number): string => (n === 1 ? nameOf(type) : `${n.toLocaleString("en")} ${nameOf(type).endsWith("s") ? nameOf(type) : `${nameOf(type)}s`}`);

// ---------------------------------------------------------------------------
// Each settlement's substep, once a step
// ---------------------------------------------------------------------------

/**
 * The settlement's next substep, as the city view derives it, kept per
 * settlement object: the state is immutable, so the same object under the
 * same planet is the same step. At 1x a Standard world takes a substep every
 * 8 s, and between them this costs nothing.
 */
const kept = new WeakMap<Settlement, { readonly env: HabitatChannels; readonly t: Tuning; readonly step: SettlementStep }>();

function sameEnv(a: HabitatChannels, b: HabitatChannels): boolean {
  if (a === b) return true;
  for (const k of Object.keys(a) as (keyof HabitatChannels)[]) if (a[k] !== b[k]) return false;
  return true;
}

export function stepOf(s: Settlement, env: HabitatChannels, t: Tuning): SettlementStep {
  const k = kept.get(s);
  if (k !== undefined && k.t === t && sameEnv(k.env, env)) return k.step;
  const step = settlementStep(s, env, t, t.SUBSTEP_YEARS * t.CITY_CLOCK);
  kept.set(s, { env, t, step });
  return step;
}

/** A building's corner on the ground as founded: what a claim does not move. */
export function groundAt(s: Settlement, tx: number, ty: number, t: Tuning): { x: number; y: number } {
  const f = frameOf(s, t);
  return { x: tx + f.x0, y: ty + f.y0 };
}

/** The index of the building whose corner is there now, or -1. */
export function buildingAt(s: Settlement, at: { readonly x: number; readonly y: number }, t: Tuning): number {
  const f = frameOf(s, t);
  return s.buildings.findIndex((b) => b.tx === at.x - f.x0 && b.ty === at.y - f.y0);
}

// ---------------------------------------------------------------------------
// Conditions: what is so now
// ---------------------------------------------------------------------------

const LIFE: ReadonlySet<MicroResource> = new Set<MicroResource>(["water", "oxygen", "food"]);

/**
 * A settlement's conditions, kept per settlement object and planet like its
 * step: a metropolis has 40,000 buildings to look through (37 ms over the
 * example planet's, measured), and between steps nothing about them changes.
 */
const conditionsKept = new WeakMap<Settlement, { readonly env: HabitatChannels; readonly t: Tuning; readonly alerts: readonly Alert[] }>();

/** The settlement's conditions if already worked out for this step and planet, or null. */
function keptAlerts(s: Settlement, env: HabitatChannels, t: Tuning): readonly Alert[] | null {
  if (s.lostAtSeaLevelM !== null) return [];
  const k = conditionsKept.get(s);
  return k !== undefined && k.t === t && sameEnv(k.env, env) ? k.alerts : null;
}

/** A standing settlement's conditions: a blackout, each shortage, and its buildings offline, grouped by type and reason. */
export function settlementAlerts(s: Settlement, env: HabitatChannels, t: Tuning): readonly Alert[] {
  if (s.lostAtSeaLevelM !== null) return [];
  const k = conditionsKept.get(s);
  if (k !== undefined && k.t === t && sameEnv(k.env, env)) return k.alerts;
  const alerts = deriveSettlementAlerts(s, env, t);
  conditionsKept.set(s, { env, t, alerts });
  return alerts;
}

function deriveSettlementAlerts(s: Settlement, env: HabitatChannels, t: Tuning): Alert[] {
  const step = stepOf(s, env, t);
  const label = settlementLabel(s);
  const going = constructionOf(s);
  const out: Alert[] = [];
  // Asked once a type, not once a building.
  const draws = new Map<BuildingType, Partial<Record<MicroResource, number>>>();
  const drawsOf = (type: BuildingType) => {
    let d = draws.get(type);
    if (d === undefined) {
      d = BUILDING_DEFS[type].consumes(t, env);
      draws.set(type, d);
    }
    return d;
  };
  const allowed = new Map<BuildingType, boolean>();
  const allowedOf = (type: BuildingType): boolean => {
    let a = allowed.get(type);
    if (a === undefined) {
      a = BUILDING_DEFS[type].canOperate(env, t);
      allowed.set(type, a);
    }
    return a;
  };
  const frame = frameOf(s, t);
  const at = (i: number) => {
    const b = s.buildings[i]!;
    return { x: b.tx + frame.x0, y: b.ty + frame.y0 };
  };
  // The buildings that are off and not going up: the only ones either kind of alert is about.
  const off: number[] = [];
  s.buildings.forEach((b, i) => {
    if (step.operable[i] !== true && !going.has(tileKey(b.tx, b.ty))) off.push(i);
  });
  /** Buildings dark for a shortage: off, not going up, connected - and drawing it. */
  const darkFor = (r: MicroResource): number[] => off.filter((i) => (step.network[i] ?? null) === null && (drawsOf(s.buildings[i]!.type)[r] ?? 0) > 0);

  for (const r of step.shortages) {
    const dark = darkFor(r);
    const target = { kind: "city", id: s.id, at: dark.length > 0 ? at(dark[0]!) : null } as const;
    const offFor = dark.length === 0 ? "" : ` ${plural(dark.length, "building is", "buildings are")} off for it.`;
    if (r === "power") {
      out.push({ key: `blackout:${s.id}`, kind: "blackout", resource: r, priority: "urgent", title: `Blackout in ${label}`, text: `Power is short.${offFor} Build ${MADE_BY.power}, or lay a power cable to one.`, count: Math.max(1, dark.length), target });
    } else {
      const name = RESOURCE_NAMES[r].toLowerCase();
      const people = LIFE.has(r) ? " Its people go without." : "";
      out.push({ key: `short:${s.id}:${r}`, kind: "shortage", resource: r, priority: LIFE.has(r) ? "urgent" : "notice", title: `${label} is short of ${name}`, text: `${RESOURCE_NAMES[r]} ${r === "materials" ? "are" : "is"} running short.${people}${offFor} Build ${MADE_BY[r]}, or lay a corridor to one.`, count: Math.max(1, dark.length), target });
    }
  }

  // Offline for a reason of its own: not connected, under water, or the planet does not allow it yet.
  // (Off for a shortage is the shortage's alert, above; going up is a build, not a fault.)
  const groups = new Map<string, { type: BuildingType; words: string; first: number; n: number }>();
  for (const i of off) {
    const b = s.buildings[i]!;
    const network = step.network[i] ?? null;
    const wet = step.flood !== null && submerged(b, step.flood);
    if (network === null && !wet && allowedOf(b.type)) continue;
    const words = offlineWords({ type: b.type, operable: false, submerged: wet, network, construction: null }, s.kind, step.shortages, env, t);
    if (words === null) continue;
    const key = `${b.type}|${words}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { type: b.type, words, first: i, n: 1 });
    else g.n += 1;
  }
  for (const [key, g] of groups) {
    out.push({ key: `offline:${s.id}:${key}`, kind: "offline", priority: "notice", title: `${pluralName(g.type, g.n)} offline in ${label}`, text: g.words, count: g.n, target: { kind: "city", id: s.id, at: at(g.first) } });
  }
  return out;
}

/** The next dust storm, if one rises within STORM_WARN_SECONDS of real time at this speed - the weather is seeded, so it is known ahead. */
export function stormAlert(state: SimState, t: Tuning, speed = 1): Alert | null {
  if (!t.EVENTS_ENABLED) return null;
  const year = simYear(state, t);
  const look = STORM_WARN_SECONDS * t.TIME_SCALE * Math.max(1, speed);
  let next: { start: number; duration: number; magnitude: number } | null = null;
  for (let y = Math.floor(year); y <= Math.floor(year + look); y += 1) {
    for (const e of eventsBeginningIn(state.seed, y, t)) {
      if (e.kind !== "dust_storm" || !(e.start > year) || e.start > year + look) continue;
      if (next === null || e.start < next.start) next = e;
    }
  }
  if (next === null) return null;
  const strength = next.magnitude < 0.34 ? "minor" : next.magnitude < 0.67 ? "moderate" : "major";
  const seconds = (next.start - year) / t.TIME_SCALE / Math.max(1, speed);
  return {
    key: `storm:${next.start.toFixed(4)}`,
    kind: "storm",
    priority: "notice",
    title: "A dust storm is coming",
    text: `A ${strength} dust storm rises in about ${formatDuration(seconds)} and runs for about ${Math.round(next.duration)} years. It cools the planet while it lasts.`,
    count: 1,
    target: { kind: "planet" },
  };
}

/** Everything that is so now, the most pressing first. */
export function conditions(state: SimState, env: HabitatChannels, liquidRatePerYear: number, t: Tuning, speed = 1, slice?: Slice): Alert[] {
  const out: Alert[] = [];
  const list = state.settlements;
  if (slice === undefined) {
    for (const s of list) out.push(...settlementAlerts(s, env, t));
  } else {
    // Round the settlements from where the last look stopped, each a new step's worth only while the time allows.
    const start = slice.clock();
    const n = list.length;
    const from = n === 0 ? 0 : slice.cursor % n;
    let next = from;
    // At least one a look, however short the time: a round that may work out none never reaches the rest.
    let worked = false;
    for (let k = 0; k < n; k += 1) {
      const s = list[(from + k) % n]!;
      const ready = keptAlerts(s, env, t);
      const late = slice.kept.get(s.id);
      let alerts: readonly Alert[];
      if (ready !== null) alerts = ready;
      else if (worked && slice.clock() - start >= slice.budgetMs) {
        // Its turn has not come: what it showed, or - never yet worked out, on opening a world - nothing yet.
        if (late === undefined) {
          slice.unseen.add(s.id);
          continue;
        }
        alerts = late;
      } else {
        alerts = settlementAlerts(s, env, t);
        worked = true;
        next = (from + k + 1) % n;
      }
      if (slice.unseen.delete(s.id)) slice.arrived.add(s.id);
      slice.kept.set(s.id, alerts);
      out.push(...alerts);
    }
    slice.cursor = next;
    for (const id of [...slice.kept.keys()]) if (!list.some((s) => s.id === id)) slice.kept.delete(id);
  }
  const byId = new Map(list.map((s) => [s.id, s] as const));
  for (const [id, words] of floodWarnings(state, env, liquidRatePerYear, t)) {
    const s = byId.get(id);
    if (s === undefined || s.lostAtSeaLevelM !== null) continue;
    out.push({ key: `flood:${id}`, kind: "flood", priority: "urgent", title: `Flood warning: ${settlementLabel(s)}`, text: words, count: 1, target: { kind: "city", id, at: null } });
  }
  const storm = stormAlert(state, t, speed);
  if (storm !== null) out.push(storm);
  return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

/**
 * A look's budget (the browser's): a settlement whose conditions are not yet
 * worked out for its new step is worked out only while the look has time,
 * the round starting where the last look stopped; the rest keep what they
 * showed until their turn. Every step on a planet of forty settlements costs
 * as much again as the simulation's own step (160 ms on the example planet,
 * measured), and spread over the looks it is a few milliseconds each.
 */
export interface Slice {
  readonly budgetMs: number;
  readonly clock: () => number;
  /** By settlement: what its conditions were when last worked out. */
  readonly kept: Map<string, readonly Alert[]>;
  /** Where the next look's round begins. */
  cursor: number;
  /** Settlements not yet worked out once (a world just opened): nothing of theirs is shown until their turn. */
  readonly unseen: Set<string>;
  /** Those worked out for the first time this look: what they show was already so, and is not announced. */
  readonly arrived: Set<string>;
}

/** The shortages each standing settlement's conditions name - the overview cards read these, never a step of their own. */
export function shortagesOf(now: readonly Alert[]): Map<string, MicroResource[]> {
  const out = new Map<string, MicroResource[]>();
  for (const a of now) {
    if ((a.kind !== "blackout" && a.kind !== "shortage") || a.resource === undefined || a.target.kind !== "city") continue;
    const list = out.get(a.target.id) ?? [];
    list.push(a.resource);
    out.set(a.target.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => MICRO_RESOURCES.indexOf(a) - MICRO_RESOURCES.indexOf(b));
  return out;
}

// ---------------------------------------------------------------------------
// The watch: conditions that began, and what happened, since the last look
// ---------------------------------------------------------------------------

export interface AlertLook {
  /** Every condition holding now, the most pressing first. */
  readonly now: readonly Alert[];
  /** What is new since the last look: conditions that began (after a quiet spell) and happenings. */
  readonly fresh: readonly Alert[];
}

export interface AlertInput {
  readonly state: SimState;
  readonly env: HabitatChannels;
  readonly liquidRatePerYear: number;
  readonly tuning: Tuning;
  /** Real milliseconds: a condition that comes back within ALERT_QUIET_MS of ending is not new. */
  readonly now: number;
  readonly speed?: number;
  /** The browser's: milliseconds a look may spend on settlements' new steps (see `Slice`). Absent, no limit. */
  readonly budgetMs?: number;
  /** What the budget is measured by; `performance.now` in the browser. */
  readonly clock?: () => number;
}

interface Levels {
  readonly buildings: Settlement["buildings"];
  readonly claims: Settlement["claims"];
  /** By ground corner: each building's type and level, and its corner. */
  readonly at: ReadonlyMap<string, { readonly type: BuildingType; readonly level: number; readonly at: { readonly x: number; readonly y: number } }>;
}

/** The buildings by their corner tile, kept per list: made once for a metropolis's 40,000, not once a look. */
const byTileKept = new WeakMap<Settlement["buildings"], ReadonlyMap<number, Settlement["buildings"][number]>>();
function buildingsByTile(list: Settlement["buildings"]): ReadonlyMap<number, Settlement["buildings"][number]> {
  let m = byTileKept.get(list);
  if (m === undefined) {
    m = new Map(list.map((b) => [tileKey(b.tx, b.ty), b] as const));
    byTileKept.set(list, m);
  }
  return m;
}

function levelsOf(list: Settlement["buildings"], frame: { readonly x0: number; readonly y0: number }): Levels["at"] {
  const out = new Map<string, { type: BuildingType; level: number; at: { x: number; y: number } }>();
  for (const b of list) {
    const x = b.tx + frame.x0;
    const y = b.ty + frame.y0;
    out.set(`${x},${y}`, { type: b.type, level: b.level, at: { x, y } });
  }
  return out;
}

export class AlertWatch {
  private first = true;
  private active = new Map<string, Alert>();
  private endedAt = new Map<string, number>();
  /** By settlement: what was going up (new builds), by ground corner. */
  private going = new Map<string, Set<string>>();
  /** By settlement: each building's type, level and corner, by ground corner, and the list they were read from. */
  private levels = new Map<string, Levels>();
  /** By settlement: what the last look read, so an unchanged settlement is passed over. */
  private seen = new Map<string, { buildings: Settlement["buildings"]; jobs: Settlement["jobs"]; queue: Settlement["buildQueue"]; claims: Settlement["claims"] }>();
  private ready = new Set<string>();
  /** Batch 33: the events whose resolution has been announced (or was already past on the first look). */
  private resolved = new Set<number>();
  /** Batch 34: Earth's records announced (or already past on the first look). */
  private earthSeen = new Set<number>();
  private slice: Slice = { budgetMs: Infinity, clock: () => 0, kept: new Map(), cursor: 0, unseen: new Set(), arrived: new Set() };

  observe(input: AlertInput): AlertLook {
    const { state, tuning: t } = input;
    const first = this.first;
    this.first = false;
    const slice = input.budgetMs === undefined ? undefined : Object.assign(this.slice, { budgetMs: input.budgetMs, clock: input.clock ?? (() => 0) });
    this.slice.arrived.clear();
    const now = [...decisionConditions(state, t, input.speed ?? 1), ...conditions(state, input.env, input.liquidRatePerYear, t, input.speed ?? 1, slice)];
    const fresh: Alert[] = [];
    // A settlement seen for the first time this look (its turn come at last, on a world just opened) takes its bearings.
    const arrived = (a: Alert): boolean => a.target.kind === "city" && this.slice.arrived.has(a.target.id);

    const holding = new Map(now.map((a) => [a.key, a] as const));
    for (const [key] of this.active) if (!holding.has(key)) this.endedAt.set(key, input.now);
    for (const a of now) {
      if (this.active.has(a.key) || first || arrived(a)) continue;
      const ended = this.endedAt.get(a.key);
      if (ended !== undefined && input.now - ended < ALERT_QUIET_MS) continue;
      fresh.push(a);
    }
    this.active = holding;

    for (const s of state.settlements) {
      if (s.lostAtSeaLevelM !== null) {
        this.going.delete(s.id);
        this.levels.delete(s.id);
        this.seen.delete(s.id);
        continue;
      }
      // Nothing is finished or raised unless the buildings, the rovers' jobs or the queue changed.
      const last = this.seen.get(s.id);
      if (!first && last !== undefined && last.buildings === s.buildings && last.jobs === s.jobs && last.queue === s.buildQueue && last.claims === s.claims) continue;
      this.seen.set(s.id, { buildings: s.buildings, jobs: s.jobs, queue: s.buildQueue, claims: s.claims });
      const frame = frameOf(s, t);
      const corner = (tx: number, ty: number): string => `${tx + frame.x0},${ty + frame.y0}`;
      const byTile = buildingsByTile(s.buildings);
      const going = new Set<string>();
      for (const tile of constructionOf(s).keys()) {
        const b = byTile.get(tile);
        if (b !== undefined) going.add(corner(b.tx, b.ty));
      }
      const label = settlementLabel(s);
      // Levels change only with the building list.
      const prior = this.levels.get(s.id);
      const levels = prior !== undefined && prior.buildings === s.buildings && prior.claims === s.claims ? prior : { buildings: s.buildings, claims: s.claims, at: levelsOf(s.buildings, frame) };
      const standing = (k: string) => levels.at.has(k);

      const wasGoing = this.going.get(s.id);
      if (!first && wasGoing !== undefined) {
        const done = [...wasGoing].filter((k) => !going.has(k) && standing(k));
        if (done.length > 0) {
          const types = new Map<BuildingType, number>();
          for (const k of done) types.set(levels.at.get(k)!.type, (types.get(levels.at.get(k)!.type) ?? 0) + 1);
          const b = levels.at.get(done[0]!)!;
          const title = done.length === 1 ? `${nameOf(b.type)} finished in ${label}` : `${plural(done.length, "building")} finished in ${label}`;
          const text = done.length === 1 ? "Built, and running if it has what it needs." : `${[...types].map(([type, n]) => pluralName(type, n)).join(", ")}.`;
          fresh.push({ key: `built:${s.id}`, kind: "built", priority: "record", title, text, count: done.length, target: { kind: "city", id: s.id, at: b.at } });
        }
      }
      if (!first && prior !== undefined && prior !== levels) {
        const raised: { k: string; level: number }[] = [];
        for (const [k, now2] of levels.at) {
          const before = prior.at.get(k);
          if (before !== undefined && before.type === now2.type && now2.level > before.level) raised.push({ k, level: now2.level });
        }
        if (raised.length > 0) {
          const b = levels.at.get(raised[0]!.k)!;
          const title = raised.length === 1 ? `${nameOf(b.type)} raised to level ${raised[0]!.level} in ${label}` : `${plural(raised.length, "building")} raised a level in ${label}`;
          fresh.push({ key: `upgraded:${s.id}`, kind: "upgraded", priority: "record", title, text: raised.length === 1 ? "The upgrade is done." : "Their upgrades are done.", count: raised.length, target: { kind: "city", id: s.id, at: b.at } });
        }
      }
      this.going.set(s.id, going);
      this.levels.set(s.id, levels);
    }

    // Batch 33: each event resolved since the last look - a record of what was chosen and what it did, a notice
    // when nothing was (the default, always the worst, came about). The first look takes its bearings.
    for (const r of state.decisions.log) {
      if (this.resolved.has(r.id)) continue;
      this.resolved.add(r.id);
      if (first) continue;
      const city = state.settlements.find((c) => c.id === r.settlement);
      const where = city === undefined ? "a city" : settlementLabel(city);
      fresh.push({ key: `resolved:${r.id}`, kind: "resolved", priority: r.chosen === null ? "notice" : "record", title: decisionHeadline(r, where), text: outcomeWords(r, t), count: 1, target: { kind: "city", id: r.settlement, at: null } });
    }
    if (this.resolved.size > 4 * t.DECISION_LOG) this.resolved = new Set(state.decisions.log.map((r) => r.id));

    // Batch 34: what passed between the planet and Earth since the last look - a rocket home, a window missed, a
    // contract met or failed. A rocket going up is only the Earth panel's record, and an offer (one comes every
    // window) is said by the Earth button, not here: a quiet city says nothing. Each opens the Earth panel; the
    // first look takes its bearings.
    if (t.EARTH_ENABLED) {
      for (const r of state.earth.log) {
        if (this.earthSeen.has(r.id)) continue;
        this.earthSeen.add(r.id);
        if (first || r.kind === "launched") continue;
        const words = recordWords(r, state);
        fresh.push({ key: `earth:${r.id}`, kind: "earth", priority: r.kind === "missed" || r.kind === "failed" ? "notice" : "record", title: words.title, text: words.text, count: 1, target: { kind: "earth" } });
      }
      if (this.earthSeen.size > 4 * t.EARTH_LOG) this.earthSeen = new Set(state.earth.log.map((r) => r.id));
    }

    for (const o of objectiveStatus(state, t)) {
      const ready = o.open && !o.claimed && o.progress.done;
      if (!ready) {
        this.ready.delete(o.def.id);
        continue;
      }
      if (this.ready.has(o.def.id)) continue;
      this.ready.add(o.def.id);
      if (!first) fresh.push({ key: `objective:${o.def.id}`, kind: "objective", priority: "record", title: `Objective done: ${o.def.title}`, text: "Its reward is waiting in Objectives.", count: 1, target: { kind: "objectives" } });
    }
    return { now, fresh };
  }

  /** A fresh start: a world opened, the example left, a reset. */
  reset(): void {
    this.first = true;
    this.active.clear();
    this.endedAt.clear();
    this.going.clear();
    this.levels.clear();
    this.seen.clear();
    this.ready.clear();
    this.resolved.clear();
    this.earthSeen.clear();
    this.slice = { budgetMs: Infinity, clock: () => 0, kept: new Map(), cursor: 0, unseen: new Set(), arrived: new Set() };
  }
}

/**
 * Batch 33: an event waiting on a decision is a condition - urgent, for as
 * long as nothing is chosen - so it interrupts once as it opens and stays in
 * the centre's "Now" until it is answered (or comes to its default).
 */
function decisionConditions(state: SimState, t: Tuning, speed: number): Alert[] {
  if (!t.DECISIONS_ENABLED) return [];
  const out: Alert[] = [];
  for (const e of state.decisions.open) {
    if (e.chosen !== null) continue;
    const city = state.settlements.find((c) => c.id === e.settlement);
    const where = city === undefined ? "a city" : settlementLabel(city);
    out.push({ key: `decision:${e.id}`, kind: "decision", priority: "urgent", title: decisionHeadline(e, where), text: `${decisionText(e, t)} Decide within ${deadlineWords(e, state.steps, t, speed)}.`, count: 1, target: { kind: "city", id: e.settlement, at: e.at } });
  }
  return out;
}
