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
import { BUILDING_DEFS, constructionOf, eventsBeginningIn, frameOf, objectiveStatus, settlementStep, simYear, submerged, tileKey } from "../sim/index.js";
import { formatDuration } from "./build-time.js";
import { ALERT_QUIET_MS, STORM_WARN_SECONDS } from "./config.js";
import { floodWarnings } from "./flood-warning.js";
import { MADE_BY, RESOURCE_NAMES, offlineWords } from "./offline-words.js";
import { settlementLabel } from "./settlement-label.js";

export type AlertKind = "blackout" | "shortage" | "offline" | "flood" | "storm" | "built" | "upgraded" | "objective";

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
  | { readonly kind: "objectives" };

export interface Alert {
  /** Its identity: a condition is the same alert for as long as it holds; a happening's says where it happened. */
  readonly key: string;
  readonly kind: AlertKind;
  readonly priority: AlertPriority;
  readonly title: string;
  readonly text: string;
  /** How many it stands for: buildings offline, finished, raised. */
  readonly count: number;
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

/** A standing settlement's conditions: a blackout, each shortage, and its buildings offline, grouped by type and reason. */
export function settlementAlerts(s: Settlement, env: HabitatChannels, t: Tuning): Alert[] {
  if (s.lostAtSeaLevelM !== null) return [];
  const step = stepOf(s, env, t);
  const label = settlementLabel(s);
  const going = constructionOf(s);
  const out: Alert[] = [];
  const draws = new Map<BuildingType, Partial<Record<MicroResource, number>>>();
  const drawsOf = (type: BuildingType) => {
    let d = draws.get(type);
    if (d === undefined) {
      d = BUILDING_DEFS[type].consumes(t, env);
      draws.set(type, d);
    }
    return d;
  };
  const at = (i: number) => {
    const b = s.buildings[i]!;
    return groundAt(s, b.tx, b.ty, t);
  };
  /** Buildings dark for a shortage: off, not going up, not under water, connected - and drawing it. */
  const darkFor = (r: MicroResource): number[] => {
    const list: number[] = [];
    s.buildings.forEach((b, i) => {
      if (step.operable[i] === true || going.has(tileKey(b.tx, b.ty))) return;
      if (step.network[i] !== null && step.network[i] !== undefined) return;
      if ((drawsOf(b.type)[r] ?? 0) > 0) list.push(i);
    });
    return list;
  };

  for (const r of step.shortages) {
    const dark = darkFor(r);
    const target = { kind: "city", id: s.id, at: dark.length > 0 ? at(dark[0]!) : null } as const;
    const off = dark.length === 0 ? "" : ` ${plural(dark.length, "building is", "buildings are")} off for it.`;
    if (r === "power") {
      out.push({ key: `blackout:${s.id}`, kind: "blackout", priority: "urgent", title: `Blackout in ${label}`, text: `Power is short.${off} Build ${MADE_BY.power}, or lay a power cable to one.`, count: Math.max(1, dark.length), target });
    } else {
      const name = RESOURCE_NAMES[r].toLowerCase();
      const people = LIFE.has(r) ? " Its people go without." : "";
      out.push({ key: `short:${s.id}:${r}`, kind: "shortage", priority: LIFE.has(r) ? "urgent" : "notice", title: `${label} is short of ${name}`, text: `${RESOURCE_NAMES[r]} is running short.${people}${off} Build ${MADE_BY[r]}, or lay a corridor to one.`, count: Math.max(1, dark.length), target });
    }
  }

  // Offline for a reason of its own: not connected, under water, or the planet does not allow it yet.
  // (Off for a shortage is the shortage's alert, above; going up is a build, not a fault.)
  const groups = new Map<string, { type: BuildingType; words: string; first: number; n: number }>();
  s.buildings.forEach((b, i) => {
    if (step.operable[i] === true || going.has(tileKey(b.tx, b.ty))) return;
    const network = step.network[i] ?? null;
    const wet = step.flood !== null && submerged(b, step.flood);
    const allowed = BUILDING_DEFS[b.type].canOperate(env, t);
    if (network === null && !wet && allowed) return;
    const words = offlineWords({ type: b.type, operable: false, submerged: wet, network, construction: null }, s.kind, step.shortages, env, t);
    if (words === null) return;
    const key = `${b.type}|${words}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { type: b.type, words, first: i, n: 1 });
    else g.n += 1;
  });
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
export function conditions(state: SimState, env: HabitatChannels, liquidRatePerYear: number, t: Tuning, speed = 1): Alert[] {
  const out: Alert[] = [];
  for (const s of state.settlements) out.push(...settlementAlerts(s, env, t));
  const byId = new Map(state.settlements.map((s) => [s.id, s] as const));
  for (const [id, words] of floodWarnings(state, env, liquidRatePerYear, t)) {
    const s = byId.get(id);
    if (s === undefined || s.lostAtSeaLevelM !== null) continue;
    out.push({ key: `flood:${id}`, kind: "flood", priority: "urgent", title: `Flood warning: ${settlementLabel(s)}`, text: words, count: 1, target: { kind: "city", id, at: null } });
  }
  const storm = stormAlert(state, t, speed);
  if (storm !== null) out.push(storm);
  return out.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
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
}

export class AlertWatch {
  private first = true;
  private active = new Map<string, Alert>();
  private endedAt = new Map<string, number>();
  /** By settlement: what was going up (new builds), by ground corner. */
  private going = new Map<string, Set<string>>();
  /** By settlement: each building's type and level, by ground corner. */
  private levels = new Map<string, Map<string, { type: BuildingType; level: number }>>();
  private ready = new Set<string>();

  observe(input: AlertInput): AlertLook {
    const { state, tuning: t } = input;
    const first = this.first;
    this.first = false;
    const now = conditions(state, input.env, input.liquidRatePerYear, t, input.speed ?? 1);
    const fresh: Alert[] = [];

    const holding = new Map(now.map((a) => [a.key, a] as const));
    for (const [key] of this.active) if (!holding.has(key)) this.endedAt.set(key, input.now);
    for (const a of now) {
      if (this.active.has(a.key) || first) continue;
      const ended = this.endedAt.get(a.key);
      if (ended !== undefined && input.now - ended < ALERT_QUIET_MS) continue;
      fresh.push(a);
    }
    this.active = holding;

    for (const s of state.settlements) {
      if (s.lostAtSeaLevelM !== null) {
        this.going.delete(s.id);
        this.levels.delete(s.id);
        continue;
      }
      const corner = (tx: number, ty: number): string => {
        const g = groundAt(s, tx, ty, t);
        return `${g.x},${g.y}`;
      };
      const byCorner = new Map(s.buildings.map((b) => [corner(b.tx, b.ty), b] as const));
      const going = new Set<string>();
      for (const tile of constructionOf(s).keys()) {
        const b = s.buildings.find((x) => tileKey(x.tx, x.ty) === tile);
        if (b !== undefined) going.add(corner(b.tx, b.ty));
      }
      const levels = new Map<string, { type: BuildingType; level: number }>();
      for (const [k, b] of byCorner) levels.set(k, { type: b.type, level: b.level });
      const label = settlementLabel(s);

      const wasGoing = this.going.get(s.id);
      if (!first && wasGoing !== undefined) {
        const done = [...wasGoing].filter((k) => !going.has(k) && byCorner.has(k));
        if (done.length > 0) {
          const types = new Map<BuildingType, number>();
          for (const k of done) types.set(byCorner.get(k)!.type, (types.get(byCorner.get(k)!.type) ?? 0) + 1);
          const b = byCorner.get(done[0]!)!;
          const title = done.length === 1 ? `${nameOf(b.type)} finished in ${label}` : `${plural(done.length, "building")} finished in ${label}`;
          const text = done.length === 1 ? "Built, and running if it has what it needs." : `${[...types].map(([type, n]) => pluralName(type, n)).join(", ")}.`;
          fresh.push({ key: `built:${s.id}`, kind: "built", priority: "record", title, text, count: done.length, target: { kind: "city", id: s.id, at: groundAt(s, b.tx, b.ty, t) } });
        }
      }
      const was = this.levels.get(s.id);
      if (!first && was !== undefined) {
        const raised: { k: string; level: number }[] = [];
        for (const [k, now2] of levels) {
          const before = was.get(k);
          if (before !== undefined && before.type === now2.type && now2.level > before.level) raised.push({ k, level: now2.level });
        }
        if (raised.length > 0) {
          const b = byCorner.get(raised[0]!.k)!;
          const title = raised.length === 1 ? `${nameOf(b.type)} raised to level ${raised[0]!.level} in ${label}` : `${plural(raised.length, "building")} raised a level in ${label}`;
          fresh.push({ key: `upgraded:${s.id}`, kind: "upgraded", priority: "record", title, text: raised.length === 1 ? "The upgrade is done." : "Their upgrades are done.", count: raised.length, target: { kind: "city", id: s.id, at: groundAt(s, b.tx, b.ty, t) } });
        }
      }
      this.going.set(s.id, going);
      this.levels.set(s.id, levels);
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
    this.ready.clear();
  }
}
