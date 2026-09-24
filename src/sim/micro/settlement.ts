/**
 * Micro doc §7 - one settlement, simulating itself. And §3.3's placement
 * rules, which are simulation rules even though Batch 20 draws them.
 *
 * "Mirror the macro tick discipline: derive, sum rates, integrate, clamp. One
 * settlement per call; deterministic; serializable." It runs once per SUBSTEP
 * inside `advance` (via computeStep), never once per call, so a settlement is
 * as chunk-independent as the planet.
 *
 * Stored: population, the five stores, the buildings. Derived every substep
 * and never stored (micro §10): which buildings are operable, efficiencies,
 * production and consumption totals, capacities, housing.
 */

import type { HabitatChannels } from "../habitat.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, MicroResource, PlacedBuilding, Settlement, SettlementKind, SimState } from "../types.js";
import { MICRO_RESOURCES } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { footprintFits, footprintTiles, gridTiles } from "./space.js";
import { groundOf, isRough } from "./terrain.js";

/** Section 7.2: the resources whose shortage is a life-support emergency. */
const LIFE_SUPPORT: readonly MicroResource[] = ["power", "water", "oxygen", "food"];

/** A new, empty settlement: founding stock, no buildings, no people (section 2.3 steps 1 and 2). */
export function newSettlement(id: string, kind: SettlementKind, lat: number, lon: number, t: Tuning): Settlement {
  const life = t.FOUND_LIFE_SUPPORT;
  return {
    id,
    kind,
    lat,
    lon,
    population: 0,
    stores: { power: 0, water: life, oxygen: life, food: life, materials: t.FOUND_MATERIALS },
    buildings: [],
  };
}

export function capacities(s: Settlement, t: Tuning): Readonly<Record<MicroResource, number>> {
  const cap: Record<MicroResource, number> = {
    power: t.MICRO_CAP_POWER,
    water: t.MICRO_CAP_WATER,
    oxygen: t.MICRO_CAP_OXYGEN,
    food: t.MICRO_CAP_FOOD,
    materials: t.MICRO_CAP_MATERIALS,
  };
  for (const b of s.buildings) {
    const extra = BUILDING_DEFS[b.type].capacity(t);
    for (const r of MICRO_RESOURCES) cap[r] += extra[r] ?? 0;
  }
  return cap;
}

export function housing(s: Settlement, t: Tuning): number {
  let total = 0;
  for (const b of s.buildings) total += BUILDING_DEFS[b.type].housing(t);
  return total;
}

// ---------------------------------------------------------------------------
// Placement (section 3.3)
// ---------------------------------------------------------------------------

export interface PlaceOutcome {
  readonly state: SimState;
  readonly ok: boolean;
  readonly reason: string | null;
}

function occupied(s: Settlement): Set<string> {
  const taken = new Set<string>();
  for (const b of s.buildings) {
    const size = BUILDING_DEFS[b.type].footprint;
    for (const [x, y] of footprintTiles({ tx: b.tx, ty: b.ty, w: size, h: size })) taken.add(`${x},${y}`);
  }
  return taken;
}

function withSettlement(state: SimState, id: string, next: Settlement): SimState {
  return { ...state, settlements: state.settlements.map((s) => (s.id === id ? next : s)) };
}

/**
 * Place a building, paying for it in materials. All-or-nothing, like
 * `orderFacility`: a refused placement changes nothing and says why.
 */
export function placeBuilding(
  state: SimState,
  settlementId: string,
  type: BuildingType,
  tx: number,
  ty: number,
  t: Tuning,
): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  const def = BUILDING_DEFS[type];
  if (def === undefined) return refuse(`"${String(type)}" is not a building`);
  if (!def.kinds.includes(s.kind)) return refuse(`${def.name} cannot be built in an ${s.kind}`);
  const f = { tx, ty, w: def.footprint, h: def.footprint };
  if (!footprintFits(f, gridTiles(s.kind, t))) return refuse(`${def.name} does not fit there - it runs off the grid`);
  const ground = groundOf(s, t);
  if (footprintTiles(f).some(([x, y]) => isRough(ground, x, y))) return refuse(`${def.name} would stand on rough ground`);
  const taken = occupied(s);
  if (footprintTiles(f).some(([x, y]) => taken.has(`${x},${y}`))) return refuse(`${def.name} would overlap another building`);
  const cost = def.cost(t);
  if (s.stores.materials < cost) {
    return refuse(`${def.name} needs ${cost} materials, ${Math.floor(s.stores.materials)} available`);
  }
  const building: PlacedBuilding = { type, tx, ty, level: 1 };
  const next: Settlement = {
    ...s,
    stores: { ...s.stores, materials: s.stores.materials - cost },
    buildings: [...s.buildings, building],
  };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null };
}

/** Remove the building whose footprint covers (tx, ty). Frees its tiles; no refund (none is specified). */
export function removeBuilding(state: SimState, settlementId: string, tx: number, ty: number): PlaceOutcome {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}` };
  const index = s.buildings.findIndex((b) => {
    const size = BUILDING_DEFS[b.type].footprint;
    return tx >= b.tx && ty >= b.ty && tx < b.tx + size && ty < b.ty + size;
  });
  if (index < 0) return { state, ok: false, reason: "there is no building there" };
  const next: Settlement = { ...s, buildings: s.buildings.filter((_, i) => i !== index) };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// The tick (section 7)
// ---------------------------------------------------------------------------

export interface SettlementStep {
  readonly next: Settlement;
  /** Parallel to `buildings`: which ran this substep. Derived, never stored. */
  readonly operable: readonly boolean[];
  /** Section 7.3 support: no life-support resource ran short this substep, and every life-support store holds something. */
  readonly supported: boolean;
  /** Section 2.2: planetary CO2 this settlement asks to draw, mbar per year. */
  readonly planetaryCo2: number;
  /** What the operable buildings made and drew this substep, per year. Derived, never stored. */
  readonly production: Readonly<Record<MicroResource, number>>;
  readonly consumption: Readonly<Record<MicroResource, number>>;
  /** Every resource that ran short this substep, in `MICRO_RESOURCES` order: why buildings browned out. */
  readonly shortages: readonly MicroResource[];
}

/**
 * Advance one settlement by one substep of `h` years against the planet as
 * seen through `env`.
 *
 * Operability (7.1, 7.2) is a fixed point found from above: start with every
 * building the planet allows, and switch off every building that draws on a
 * resource this substep cannot supply - which can starve more, so repeat. It
 * only ever switches buildings OFF, so it settles in at most one pass per
 * resource and never depends on building order.
 */
export function settlementStep(s: Settlement, env: HabitatChannels, t: Tuning, h: number): SettlementStep {
  const defs = s.buildings.map((b) => BUILDING_DEFS[b.type]);
  // Section 6: in the basic version every building on the grid is on the network.
  const operable = defs.map((def) => def.canOperate(env, t));

  const totals = (): { prod: Record<MicroResource, number>; cons: Record<MicroResource, number> } => {
    const prod = { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 };
    const cons = { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 };
    defs.forEach((def, i) => {
      if (!operable[i]) return;
      const eff = def.efficiency(env);
      const p = def.produces(t);
      const c = def.consumes(t, env);
      for (const r of MICRO_RESOURCES) {
        prod[r] += (p[r] ?? 0) * eff;
        cons[r] += c[r] ?? 0;
      }
    });
    return { prod, cons };
  };

  // Which life-support resources ran short at any point this substep. Their
  // consumers browned out - including the domes - so the stores may never
  // actually reach zero, which is why section 7.2's stress is tracked here and
  // not read off the stores alone (see `supported` below).
  const shortLife = new Set<MicroResource>();
  const shortAny = new Set<MicroResource>();
  for (let pass = 0; pass <= MICRO_RESOURCES.length; pass += 1) {
    const { prod, cons } = totals();
    const short = MICRO_RESOURCES.filter((r) => s.stores[r] + (prod[r] - cons[r]) * h < 0);
    if (short.length === 0) break;
    for (const r of short) {
      shortAny.add(r);
      if (LIFE_SUPPORT.includes(r)) shortLife.add(r);
    }
    let changed = false;
    defs.forEach((def, i) => {
      if (!operable[i]) return;
      const c = def.consumes(t, env);
      if (short.some((r) => (c[r] ?? 0) > 0)) {
        operable[i] = false;
        changed = true;
      }
    });
    if (!changed) break;
  }

  const { prod, cons } = totals();
  const cap = capacities(s, t);
  const stores = { ...s.stores };
  for (const r of MICRO_RESOURCES) stores[r] = Math.min(cap[r], Math.max(0, s.stores[r] + (prod[r] - cons[r]) * h));

  /**
   * Section 7.3's support, with section 7.2's stress folded in.
   *
   * Read literally, 7.3 counts a need as unmet only when its store is EMPTY.
   * But 7.2's brownout switches off every consumer of a short resource - the
   * domes included - so the store stops draining and never empties: a city
   * with every power plant removed stayed "supported" for ever and its
   * population never fell (Batch 18, measured). 7.2 is explicit that a
   * life-support shortage "harms population", so a shortage this substep
   * counts as unsupported whatever the store says.
   */
  const supported = shortLife.size === 0 && LIFE_SUPPORT.every((r) => stores[r] > 0);

  let population = s.population;
  if (s.kind === "city") {
    const home = housing(s, t);
    // The first settlers arrive once there is somewhere to live and every need is met.
    if (supported && home > 0) population = Math.max(population, Math.min(home, t.MICRO_SEED_POPULATION));
    const growth = home > 0 ? t.MICRO_GROWTH_RATE * population * (1 - population / home) * (supported ? 1 : 0) : 0;
    const decline = t.MICRO_DECLINE_RATE * population * (supported ? 0 : 1);
    population = Math.min(home, Math.max(0, population + (growth - decline) * h));
  }

  let planetaryCo2 = 0;
  defs.forEach((def, i) => {
    if (operable[i]) planetaryCo2 += def.planetaryCo2(t) * def.efficiency(env);
  });

  return { next: { ...s, stores, population }, operable, supported, planetaryCo2, production: prod, consumption: cons, shortages: MICRO_RESOURCES.filter((r) => shortAny.has(r)) };
}
