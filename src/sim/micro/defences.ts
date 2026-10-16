/**
 * Detail doc §4.5 - "Flooding must be survivable through good play, not
 * purely punitive" (Batch 38). Two of its levers are actions here:
 *
 *   - terracing: "Raising individual tiles (section 1.3) can lift key
 *     buildings above the early waterline, delaying their loss during
 *     partial flood" - a rover raises a building's whole footprint
 *     TERRACE_STEP_M over its highest tile, paid in materials by the metre;
 *   - evacuation: "evacuate population (preserve the people, abandon the
 *     structures)" - its people go to the nearest standing cities out of the
 *     sea's way, as many as each has homes for (conflict 8: population is one
 *     number a city, so a destination is the rule this needs).
 *
 * The third, the dike, is a building (the Seawall: `dikeHeightM` in
 * flood.ts); the fourth, throttling the planet, is the forecast's.
 */

import type { Tuning } from "../tuning.js";
import type { Settlement, SettlementJob, SimState } from "../types.js";
import { isCityKind } from "../types.js";
import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { NEUTRAL_ENV } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { NO_ROUTE, buildingSite, drive } from "./drive.js";
import { floodAlert, floodForecast, floodReading } from "./flood.js";
import { garage, roverCount, roversOut, siteGround } from "./rocks.js";
import { routeKm } from "./routes.js";
import type { PlaceOutcome } from "./settlement.js";
import { constructionOf, housing } from "./settlement.js";
import { tileKey } from "./space.js";
import { charged } from "../sandbox.js";

function withSettlement(state: SimState, id: string, next: Settlement): SimState {
  return { ...state, settlements: state.settlements.map((s) => (s.id === id ? next : s)) };
}

/** The building whose footprint covers (tx, ty), and its index, or null. */
function buildingAt(s: Settlement, tx: number, ty: number): number {
  return s.buildings.findIndex((b) => {
    const def = BUILDING_DEFS[b.type];
    return tx >= b.tx && ty >= b.ty && tx < b.tx + def.footprint && ty < b.ty + def.depth;
  });
}

/** What terracing the building would raise its ground to, metres against the base, and what it would cost. */
export interface TerracePlan {
  readonly levelM: number;
  readonly materials: number;
  /** The footprint's tiles, and how far each is raised in all. */
  readonly tiles: number;
  readonly raisedM: number;
}

/**
 * The terrace for the building covering (tx, ty): its footprint raised to
 * TERRACE_STEP_M over its highest corner, to the tenth of a metre, at
 * TERRACE_MATERIALS_PER_M for every metre each tile is raised. Null with no
 * building there.
 */
export function terracePlan(s: Settlement, tx: number, ty: number, t: Tuning): TerracePlan | null {
  const index = buildingAt(s, tx, ty);
  if (index < 0) return null;
  const b = s.buildings[index]!;
  const def = BUILDING_DEFS[b.type];
  const ground = siteGround(s, t);
  const n = ground.tiles;
  const m = n + 1;
  let top = -Infinity;
  for (let y = b.ty; y <= b.ty + def.depth; y += 1) for (let x = b.tx; x <= b.tx + def.footprint; x += 1) if (x >= 0 && y >= 0 && x <= n && y <= n) top = Math.max(top, ground.cornersM[y * m + x]!);
  if (!Number.isFinite(top)) return null;
  const levelM = Math.ceil((top + t.TERRACE_STEP_M) * 10) / 10;
  let raisedM = 0;
  let tiles = 0;
  for (let y = b.ty; y < b.ty + def.depth; y += 1) {
    for (let x = b.tx; x < b.tx + def.footprint; x += 1) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      tiles += 1;
      raisedM += Math.max(0, levelM - ground.heightM[y * n + x]!);
    }
  }
  return { levelM, materials: Math.ceil(raisedM * t.TERRACE_MATERIALS_PER_M), tiles, raisedM };
}

/**
 * Raise the ground under the building covering (tx, ty) (detail §1.3 and
 * §4.5): a rover drives out, raises its whole footprint to `terracePlan`'s
 * level - ROVER_WORK_YEARS_LEVEL a tile - and comes home; the ground is
 * raised then, recorded as grades like any levelling. The building runs
 * meanwhile, and stands on its new ground after: the water must climb that
 * much higher to take it.
 */
export function terraceBuilding(state: SimState, settlementId: string, tx: number, ty: number, t: Tuning): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  if (garage(s) === null) return refuse("there is no headquarters to send a rover from");
  const index = buildingAt(s, tx, ty);
  if (index < 0) return refuse("there is no building there");
  const b = s.buildings[index]!;
  const def = BUILDING_DEFS[b.type];
  const corner = tileKey(b.tx, b.ty);
  if (constructionOf(s).has(corner)) return refuse(`the ${def.name} is still being built`);
  if (s.jobs.some((j) => j.kind === "rover" && j.tile === corner && j.area !== undefined)) return refuse(`a rover is already raising the ${def.name}'s ground`);
  const plan = terracePlan(s, tx, ty, t)!;
  const cost = charged(plan.materials, t);
  if (s.stores.materials < cost) return refuse(`raising the ${def.name}'s ground needs ${cost} materials, ${Math.floor(s.stores.materials)} available`);
  const rovers = roverCount(s, t);
  if (roversOut(s) >= rovers) return refuse(`all ${rovers} rovers are out`);
  const way = drive(s, buildingSite(b), t);
  if (way === null) return refuse(NO_ROUTE);
  const work = t.ROVER_WORK_YEARS_LEVEL * plan.tiles;
  const total = 2 * way.years + work;
  const job: SettlementJob = {
    kind: "rover",
    tile: corner,
    materials: 0,
    work,
    total,
    remaining: total,
    levelM: plan.levelM,
    area: { w: def.footprint, d: def.depth },
    ...(way.route === undefined ? {} : { route: way.route }),
  };
  return { state: withSettlement(state, settlementId, { ...s, stores: { ...s.stores, materials: s.stores.materials - cost }, jobs: [...s.jobs, job] }), ok: true, reason: null };
}

/** The planet as a city sees it, from the reservoirs - as placement reads it when no view is given. */
function planetSeen(state: SimState, t: Tuning, liquidRatePerYear: number) {
  return habitat(state.reservoirs, derive(state.reservoirs, NEUTRAL_ENV, t), t, liquidRatePerYear);
}

/**
 * Whether the sea threatens a settlement: warned as the HUD warns it (inside
 * the margin, or forecast within FLOOD_ALERT_YEARS - `floodAlert`), or held
 * by its grace. `liquidRatePerYear` is the planet's net liquid-water rate the
 * forecast extrapolates.
 */
export function threatened(state: SimState, s: Settlement, liquidRatePerYear: number, t: Tuning): boolean {
  if (!t.FLOODING_ENABLED || s.lostAtSeaLevelM !== null) return false;
  if (s.floodGraceYears > 0) return true;
  const env = planetSeen(state, t, liquidRatePerYear);
  return floodAlert(floodForecast(s, state.reservoirs, liquidRatePerYear, t), floodReading(s, env, t), t);
}

export interface EvacuationOutcome extends PlaceOutcome {
  /** People moved, and to which settlements (id, people), nearest first. */
  readonly moved: number;
  readonly to: readonly { readonly id: string; readonly people: number }[];
}

/**
 * Evacuate a settlement the sea threatens (§4.5): its people go to the
 * nearest standing cities the sea does not threaten, nearest first, as many
 * as each has empty homes for; the rest stay. The city is left evacuated: no
 * settlers come and it does not grow again, and what is built runs until the
 * sea takes it. Refused for a city out of the sea's way - moving people is
 * the flood's lever, not a way to fill a new city.
 */
export function evacuateSettlement(state: SimState, settlementId: string, liquidRatePerYear: number, t: Tuning): EvacuationOutcome {
  const refuse = (reason: string): EvacuationOutcome => ({ state, ok: false, reason, moved: 0, to: [] });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  if (!t.FLOODING_ENABLED) return refuse("the sea floods nothing in this world");
  if (!(s.population >= 1)) return refuse("no one lives there to evacuate");
  if (!threatened(state, s, liquidRatePerYear, t)) return refuse("the sea does not threaten it - a city is evacuated once the flood warning names it");
  const havens = state.settlements
    .filter((o) => o.id !== s.id && o.lostAtSeaLevelM === null && isCityKind(o.kind) && !o.evacuated && !threatened(state, o, liquidRatePerYear, t))
    .map((o) => ({ o, km: routeKm(s, o), room: Math.max(0, housing(o, t) - o.population) }))
    .filter((x) => x.room > 0)
    .sort((a, b) => a.km - b.km || (a.o.id < b.o.id ? -1 : 1));
  if (havens.length === 0) return refuse("no city out of the sea's way has homes for them");
  let left = s.population;
  const to: { id: string; people: number }[] = [];
  const took = new Map<string, number>();
  for (const { o, room } of havens) {
    if (left <= 0) break;
    const people = Math.min(left, room);
    took.set(o.id, people);
    to.push({ id: o.id, people });
    left -= people;
  }
  const moved = s.population - left;
  const settlements = state.settlements.map((o) => {
    if (o.id === s.id) return { ...o, population: left, evacuated: true };
    const people = took.get(o.id);
    return people === undefined ? o : { ...o, population: o.population + people };
  });
  return { state: { ...state, settlements }, ok: true, reason: null, moved, to };
}
