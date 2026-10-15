/**
 * People, not a number (Batch 32): what a city's people need beyond life
 * support, and how happy they are for it.
 *
 * Needs come in tiers. Life support - power, water, oxygen, food - is the
 * first, and stays as section 7.3 has it: without it no one is born and
 * people die. Above it, a city asks for more as it grows:
 *   - comfort, from NEEDS_COMFORT_PEOPLE: green space (a Park or a Biosphere
 *     in reach of the homes) and food variety (kinds of food grown);
 *   - services, from NEEDS_SERVICES_PEOPLE: medical care, research,
 *     transport (a Station) and shops (a Mega Mall).
 * A need is never asked before its building may be built: transport waits
 * for a station's 5,000 people, shops for a mall's 10,000.
 *
 * A provider reaches the homes whose middle stands in the square about its
 * own (NEED_REACH_TILES a side, NEED_REACH_PER_LEVEL more a level, as the
 * Industrial Command Center's square) and, with the network on, on the same
 * corridors - people walk them; rails join stations' districts. A need is met
 * by the share of the city's homes, by the people they house, that a RUNNING
 * provider reaches. Food is hauled, not walked to: its variety is the city's.
 *
 * Happiness is the mood: each asked need adds its weight met, takes it away
 * unmet, and half met is neither - so it runs from -1 to 1, and a city too
 * small to ask for anything is at 0, neither better nor worse. Growth runs
 * x(1 + HAPPINESS_GROWTH x mood) and every building makes
 * x(1 + HAPPINESS_OUTPUT x mood).
 *
 * All derived every substep from the buildings, what runs and the people,
 * and never stored (micro §10). Behind NEEDS_ENABLED.
 */

import type { Tuning } from "../tuning.js";
import type { BuildingType, PlacedBuilding, Settlement } from "../types.js";
import { isCityKind } from "../types.js";
import { BUILDING_DEFS, levelFactor } from "./buildings.js";
import type { Network } from "./network.js";
import { networkOf, withRails } from "./network.js";
import { frameOf, tileKey } from "./space.js";

export type NeedId = "green" | "variety" | "medical" | "research" | "transport" | "shops";
export type NeedTier = "comfort" | "services";

export interface NeedDef {
  readonly id: NeedId;
  readonly tier: NeedTier;
  /** On the screen. */
  readonly name: string;
  /** What meets it, in the player's words. */
  readonly meets: string;
  /** The buildings that provide it. */
  readonly providers: readonly BuildingType[];
  /** True: a provider reaches the homes about it. False: the city's as a whole (food is hauled, not walked to). */
  readonly reach: boolean;
  readonly weight: (t: Tuning) => number;
}

export const NEEDS: readonly NeedDef[] = [
  { id: "green", tier: "comfort", name: "Green space", meets: "a Park or a Biosphere in reach of the homes", providers: ["park", "biosphere"], reach: true, weight: (t) => t.NEED_WEIGHT_GREEN },
  { id: "variety", tier: "comfort", name: "Food variety", meets: "food grown more than one way: Greenhouses, a Biosphere, a Mega Mall", providers: ["greenhouse", "biosphere", "mega_mall"], reach: false, weight: (t) => t.NEED_WEIGHT_VARIETY },
  { id: "medical", tier: "services", name: "Medical care", meets: "a Medical Center in reach of the homes", providers: ["medical_center"], reach: true, weight: (t) => t.NEED_WEIGHT_MEDICAL },
  { id: "research", tier: "services", name: "Research", meets: "a Laboratory, an Observatory or a Research Forum in reach of the homes", providers: ["laboratory", "observatory", "research_forum"], reach: true, weight: (t) => t.NEED_WEIGHT_RESEARCH },
  { id: "transport", tier: "services", name: "Transport", meets: "a Station in reach of the homes", providers: ["station"], reach: true, weight: (t) => t.NEED_WEIGHT_TRANSPORT },
  { id: "shops", tier: "services", name: "Shops", meets: "a Mega Mall in reach of the homes", providers: ["mega_mall"], reach: true, weight: (t) => t.NEED_WEIGHT_SHOPS },
];

export const NEED_BY_ID: Readonly<Record<NeedId, NeedDef>> = Object.fromEntries(NEEDS.map((n) => [n.id, n])) as Record<NeedId, NeedDef>;

/** The people a city must have before it asks for a need: its tier's, and never before one of its buildings may be built. */
export function needAskedFrom(need: NeedDef, t: Tuning): number {
  const tier = need.tier === "comfort" ? t.NEEDS_COMFORT_PEOPLE : t.NEEDS_SERVICES_PEOPLE;
  return Math.max(tier, Math.min(...need.providers.map((p) => BUILDING_DEFS[p].minPopulation(t))));
}

/** The side of a provider's square, tiles, at its level. */
export function reachSide(level: number, t: Tuning): number {
  return t.NEED_REACH_TILES + t.NEED_REACH_PER_LEVEL * (Math.max(1, level) - 1);
}

export interface NeedReading {
  readonly id: NeedId;
  /** The city is big enough to ask for it. */
  readonly asked: boolean;
  /** 0..1: the share of the city's homes, by the people they house, a running provider reaches; for food, how varied it is. */
  readonly met: number;
}

export interface NeedsReading {
  /** Every need, in `NEEDS` order, asked or not. */
  readonly needs: readonly NeedReading[];
  /** -1..1: each asked need's weight, added met and taken away unmet. 0 asks nothing. */
  readonly mood: number;
  /** What growth is multiplied by. */
  readonly growth: number;
  /** What every building's making is multiplied by. */
  readonly output: number;
}

/** A city's mood as a happiness for the player, 0..100%: half is content, no better and no worse. */
export function happinessOf(mood: number): number {
  return 0.5 + 0.5 * mood;
}

/** Which providers reach which homes: geometry and corridors, kept per building list. */
interface Reach {
  /** Indices of the homes in the building list. */
  readonly homes: Int32Array;
  /** Per reached need, in `NEEDS` order (food variety's empty): for each home, the providers reaching it, as `list[start[h]..start[h + 1]]`. */
  readonly by: readonly { readonly start: Int32Array; readonly list: Int32Array }[];
}

const reaches = new WeakMap<readonly PlacedBuilding[], { t: Tuning; network: Network | null; reach: Reach }>();

/** The corridors' network, rails joining stations' districts - the one people walk - or null with the network off. */
export function walkNetwork(s: Settlement, t: Tuning): Network | null {
  if (!t.NETWORK_ENABLED) return null;
  const n = frameOf(s, t).n;
  return withRails(networkOf(s.buildings, s.corridors, n), s.buildings, s.rails, n);
}

function reachOf(buildings: readonly PlacedBuilding[], network: Network | null, t: Tuning): Reach {
  const kept = reaches.get(buildings);
  if (kept !== undefined && kept.t === t && kept.network === network) return kept.reach;
  const centre = (b: PlacedBuilding): [number, number] => [b.tx + BUILDING_DEFS[b.type].footprint / 2, b.ty + BUILDING_DEFS[b.type].depth / 2];
  const homeList: number[] = [];
  buildings.forEach((b, i) => {
    if (BUILDING_DEFS[b.type].housing(t) > 0) homeList.push(i);
  });
  const homes = Int32Array.from(homeList);
  const by = NEEDS.map((need) => {
    const start = new Int32Array(homes.length + 1);
    if (!need.reach) return { start, list: new Int32Array(0) };
    const providers: number[] = [];
    buildings.forEach((b, i) => {
      if (need.providers.includes(b.type)) providers.push(i);
    });
    // The providers by square of the widest reach, so each home asks only those beside it (as the command centre's).
    const size = Math.max(1, ...providers.map((p) => reachSide(buildings[p]!.level, t)));
    const cells = new Map<number, number[]>();
    const cellOf = (x: number, y: number): number => (Math.floor(y / size) + 4096) * 8192 + Math.floor(x / size) + 4096;
    for (const p of providers) {
      const [cx, cy] = centre(buildings[p]!);
      const k = cellOf(cx, cy);
      const cell = cells.get(k);
      if (cell === undefined) cells.set(k, [p]);
      else cell.push(p);
    }
    const list: number[] = [];
    homes.forEach((h, k) => {
      start[k] = list.length;
      if (providers.length === 0) return;
      const [x, y] = centre(buildings[h]!);
      const found: number[] = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (const p of cells.get(cellOf(x + dx * size, y + dy * size)) ?? []) {
            const [cx, cy] = centre(buildings[p]!);
            const half = reachSide(buildings[p]!.level, t) / 2;
            if (Math.abs(x - cx) > half || Math.abs(y - cy) > half) continue;
            if (network !== null && network.of[p] !== network.of[h]) continue;
            found.push(p);
          }
        }
      }
      // In the order of the buildings, whatever the cells' order.
      found.sort((a, b) => a - b);
      for (const p of found) list.push(p);
    });
    start[homes.length] = list.length;
    return { start, list: Int32Array.from(list) };
  });
  const reach = { homes, by };
  reaches.set(buildings, { t, network, reach });
  return reach;
}

/**
 * The city's needs this substep: which it asks for at `population` people,
 * how far each is met by the providers `operable` says are running, and the
 * mood they make. `building` holds the corners (tile keys) of homes still
 * going up, which house no one yet. Null for a settlement that houses no one.
 */
export function readNeeds(
  s: Settlement,
  operable: readonly boolean[],
  building: ReadonlySet<number>,
  network: Network | null,
  t: Tuning,
): NeedsReading | null {
  if (!isCityKind(s.kind)) return null;
  const reach = reachOf(s.buildings, network, t);
  const weightOf = (h: number): number => {
    const b = s.buildings[h]!;
    return building.has(tileKey(b.tx, b.ty)) ? 0 : BUILDING_DEFS[b.type].housing(t) * levelFactor(b.level, t);
  };
  const weights = Array.from(reach.homes, weightOf);
  const all = weights.reduce((a, w) => a + w, 0);
  let mood = 0;
  const needs = NEEDS.map((need, k): NeedReading => {
    const asked = s.population >= needAskedFrom(need, t) && s.population > 0;
    let met: number;
    if (need.reach) {
      const { start, list } = reach.by[k]!;
      let covered = 0;
      weights.forEach((w, h) => {
        if (w <= 0) return;
        for (let j = start[h]!; j < start[h + 1]!; j += 1) {
          if (operable[list[j]!]) {
            covered += w;
            return;
          }
        }
      });
      met = all > 0 ? covered / all : 0;
    } else {
      const kinds = new Set<BuildingType>();
      s.buildings.forEach((b, i) => {
        if (operable[i] && need.providers.includes(b.type)) kinds.add(b.type);
      });
      met = Math.min(1, kinds.size / t.FOOD_VARIETY_KINDS);
    }
    if (asked) mood += need.weight(t) * (2 * met - 1);
    return { id: need.id, asked, met };
  });
  return { needs, mood, growth: Math.max(0, 1 + t.HAPPINESS_GROWTH * mood), output: 1 + t.HAPPINESS_OUTPUT * mood };
}

/**
 * Per building, the people in the homes it reaches while it runs - for a
 * provider of a need that reaches homes; 0 for anything else. People are
 * spread over the homes by what each houses. What the view draws as a
 * crowd at a station or a park, and the inspector says.
 */
export function peopleReached(s: Settlement, operable: readonly boolean[], building: ReadonlySet<number>, network: Network | null, t: Tuning): Float64Array {
  const out = new Float64Array(s.buildings.length);
  if (!isCityKind(s.kind)) return out;
  const reach = reachOf(s.buildings, network, t);
  const weights = Array.from(reach.homes, (h) => {
    const b = s.buildings[h]!;
    return building.has(tileKey(b.tx, b.ty)) ? 0 : BUILDING_DEFS[b.type].housing(t) * levelFactor(b.level, t);
  });
  const all = weights.reduce((a, w) => a + w, 0);
  if (!(all > 0)) return out;
  const perHome = s.population / all;
  NEEDS.forEach((need, k) => {
    if (!need.reach) return;
    const { start, list } = reach.by[k]!;
    weights.forEach((w, h) => {
      for (let j = start[h]!; j < start[h + 1]!; j += 1) {
        const p = list[j]!;
        if (operable[p]) out[p] = out[p]! + w * perHome;
      }
    });
  });
  return out;
}

/**
 * For the planner's overlay: each provider of a need, its square (in grid
 * tiles) and whether it runs; and each home, whether a running one reaches it.
 */
export function needCoverage(
  s: Settlement,
  id: NeedId,
  operable: readonly boolean[],
  t: Tuning,
): { readonly squares: readonly { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly running: boolean }[]; readonly homes: readonly { readonly index: number; readonly reached: boolean }[] } {
  const need = NEED_BY_ID[id];
  const k = NEEDS.indexOf(need);
  const squares = s.buildings.flatMap((b, i) => {
    if (!need.reach || !need.providers.includes(b.type)) return [];
    const cx = b.tx + BUILDING_DEFS[b.type].footprint / 2;
    const cy = b.ty + BUILDING_DEFS[b.type].depth / 2;
    const half = reachSide(b.level, t) / 2;
    return [{ x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half, running: operable[i] === true }];
  });
  if (!need.reach) return { squares, homes: [] };
  const reach = reachOf(s.buildings, walkNetwork(s, t), t);
  const { start, list } = reach.by[k]!;
  const homes = Array.from(reach.homes, (index, h) => {
    let reached = false;
    for (let j = start[h]!; j < start[h + 1]! && !reached; j += 1) reached = operable[list[j]!] === true;
    return { index, reached };
  });
  return { squares, homes };
}
