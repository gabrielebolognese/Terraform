/**
 * Railways between settlements (at the user's request: "we also need
 * interconnected cities"): a line from one settlement to another, laid for
 * materials by the kilometre, paid half by each end. Over it, every
 * substep, water, oxygen, food and materials flow from the fuller city to
 * the emptier - as full as each other, measured against their own stores'
 * room - up to what a line carries a year. Power stays where it is made.
 *
 * Behind INTERCITY_ENABLED (0 by default: it moves stores between cities,
 * so it would perturb the worlds the balance was calibrated on); the browser
 * turns it on.
 */

import { MARS_RADIUS_M } from "../planets/mars.js";
import type { Tuning } from "../tuning.js";
import type { MicroResource, Route, Settlement, SimState } from "../types.js";
import { tilesUnder } from "./buildings.js";
import { rockAt, siteGround } from "./rocks.js";
import { capacities } from "./settlement.js";
import { claimTest, frameOf, tileKey } from "./space.js";
import { isSteep } from "./terrain.js";

/** Which way a railway leaves a settlement for another: across it east to west, or north to south. */
export type Axis = "h" | "v";

/** The way from one settlement toward another, as it crosses the first: the more east-west, "h"; the more north-south, "v". */
export function routeAxis(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Axis {
  let dlon = to.lon - from.lon;
  while (dlon > Math.PI) dlon -= 2 * Math.PI;
  while (dlon < -Math.PI) dlon += 2 * Math.PI;
  return Math.abs(dlon * Math.cos((from.lat + to.lat) / 2)) >= Math.abs(to.lat - from.lat) ? "h" : "v";
}

/**
 * The line a railway between settlements takes across one of them (at the
 * user's request: "the rail that connects cities: it passes left to right or
 * up to down through the city, to the very extremes of its terrain, because it
 * is the city interconnection line"): a straight row (or column) of tiles
 * the whole width of the settlement's land, through its founding square - the
 * row there with the fewest buildings on it and the least railway alongside it
 * (a line laid beside another is a doubled track), nearest the middle. Returns the
 * row and the tiles of it a rail can go on (its land, not under a building,
 * not too steep, not hard rock).
 */
export function crossingLine(s: Settlement, axis: Axis, t: Tuning): { at: number; tiles: number[] } {
  const f = frameOf(s, t);
  const n = f.n;
  const under = tilesUnder(s.buildings);
  const rails = new Set(s.rails);
  const ours = claimTest(s, t);
  const ground = siteGround(s, t);
  const tile = (along: number, across: number): [number, number] => (axis === "h" ? [along, across] : [across, along]);
  // The founding square's own rows (or columns), in frame tiles.
  const from = axis === "h" ? -f.y0 : -f.x0;
  const middle = from + s.base / 2;
  let best = Math.floor(middle);
  let bestBlocked = Infinity;
  for (let r = from + 1; r < from + s.base - 1; r += 1) {
    let blocked = 0;
    for (let a = 0; a < n; a += 1) {
      const [x, y] = tile(a, r);
      if (under.has(tileKey(x, y))) blocked += 1;
      if (rails.has(tileKey(x, y))) continue;
      for (const side of [-1, 1]) {
        const [sx, sy] = tile(a, r + side);
        if (rails.has(tileKey(sx, sy))) blocked += 0.5;
      }
    }
    if (blocked < bestBlocked || (blocked === bestBlocked && Math.abs(r + 0.5 - middle) < Math.abs(best + 0.5 - middle))) {
      best = r;
      bestBlocked = blocked;
    }
  }
  const tiles: number[] = [];
  for (let a = 0; a < n; a += 1) {
    const [x, y] = tile(a, best);
    if (!ours(x, y) || under.has(tileKey(x, y)) || isSteep(ground, x, y) || rockAt(s, x, y, t) === "crag") continue;
    tiles.push(tileKey(x, y));
  }
  return { at: best, tiles };
}

/** A settlement with the crossing line of a railway laid across it, as far as its ground allows. */
function withCrossing(s: Settlement, axis: Axis, t: Tuning): Settlement {
  const rails = new Set(s.rails);
  for (const k of crossingLine(s, axis, t).tiles) rails.add(k);
  return rails.size === s.rails.length ? s : { ...s, rails: [...rails].sort((a, b) => a - b) };
}

/** What a line carries: all but power. */
export const ROUTE_RESOURCES: readonly MicroResource[] = ["water", "oxygen", "food", "materials"];

/** The great-circle distance between two settlements, kilometres. */
export function routeKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const c = Math.sin(a.lat) * Math.sin(b.lat) + Math.cos(a.lat) * Math.cos(b.lat) * Math.cos(a.lon - b.lon);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * MARS_RADIUS_M) / 1000;
}

/** What a line between two settlements costs, materials: by the kilometre, rounded up. */
export function routeCost(a: { lat: number; lon: number }, b: { lat: number; lon: number }, t: Tuning): number {
  return Math.ceil(routeKm(a, b) * t.INTERCITY_COST_PER_KM);
}

export interface RouteOutcome {
  readonly state: SimState;
  readonly ok: boolean;
  readonly reason: string | null;
  readonly cost: number;
}

/** Lay a railway between two settlements, each paying half. All or nothing, and says why not. */
export function connectSettlements(state: SimState, aId: string, bId: string, t: Tuning): RouteOutcome {
  const refuse = (reason: string, cost = 0): RouteOutcome => ({ state, ok: false, reason, cost });
  if (!t.INTERCITY_ENABLED) return refuse("railways between settlements are not part of this game");
  if (aId === bId) return refuse("a settlement is joined to itself already");
  const a = state.settlements.find((s) => s.id === aId);
  const b = state.settlements.find((s) => s.id === bId);
  if (a === undefined || b === undefined) return refuse(`there is no settlement ${a === undefined ? aId : bId}`);
  if (a.lostAtSeaLevelM !== null || b.lostAtSeaLevelM !== null) return refuse(`${a.lostAtSeaLevelM !== null ? a.id : b.id} was lost to the sea`);
  if (state.routes.some((r) => (r.a === aId && r.b === bId) || (r.a === bId && r.b === aId))) return refuse("they are joined already");
  const cost = routeCost(a, b, t);
  const half = cost / 2;
  for (const s of [a, b]) {
    if (s.stores.materials < half) return refuse(`${Math.round(routeKm(a, b)).toLocaleString("en")} km of railway needs ${cost.toLocaleString("en")} materials, half from each end - ${s.id} has ${Math.floor(s.stores.materials)}`, cost);
  }
  // Each end pays half, and the line crosses each end's land from side to side.
  const pay = (s: Settlement): Settlement => {
    if (s.id !== aId && s.id !== bId) return s;
    const paid = { ...s, stores: { ...s.stores, materials: s.stores.materials - half } };
    return withCrossing(paid, routeAxis(s, s.id === aId ? b : a), t);
  };
  const route: Route = { a: aId, b: bId, km: routeKm(a, b) };
  return { state: { ...state, settlements: state.settlements.map(pay), routes: [...state.routes, route] }, ok: true, reason: null, cost };
}

/** Take a railway up. No refund. */
export function disconnectSettlements(state: SimState, aId: string, bId: string): RouteOutcome {
  const kept = state.routes.filter((r) => !((r.a === aId && r.b === bId) || (r.a === bId && r.b === aId)));
  if (kept.length === state.routes.length) return { state, ok: false, reason: "they are not joined", cost: 0 };
  return { state: { ...state, routes: kept }, ok: true, reason: null, cost: 0 };
}

/**
 * A substep of the lines, in the order they were laid: along each, every
 * resource it carries moves toward the two ends being as full as each other
 * (each against its own room), up to INTERCITY_CARRY a year. Deterministic,
 * and the same however time is chunked: per substep, like everything else.
 */
export function flowRoutes(settlements: readonly Settlement[], routes: readonly Route[], t: Tuning, h: number): readonly Settlement[] {
  if (routes.length === 0) return settlements;
  const byId = new Map(settlements.map((s, i) => [s.id, i] as const));
  const out = [...settlements];
  const carry = t.INTERCITY_CARRY * h;
  for (const route of routes) {
    const ia = byId.get(route.a);
    const ib = byId.get(route.b);
    if (ia === undefined || ib === undefined) continue;
    const a = out[ia]!;
    const b = out[ib]!;
    if (a.lostAtSeaLevelM !== null || b.lostAtSeaLevelM !== null) continue;
    const capA = capacities(a, t);
    const capB = capacities(b, t);
    const storesA = { ...a.stores };
    const storesB = { ...b.stores };
    let moved = false;
    for (const r of ROUTE_RESOURCES) {
      const ca = capA[r];
      const cb = capB[r];
      if (!(ca > 0) || !(cb > 0)) continue;
      // What would make them as full as each other: (Sa - x)/Ca = (Sb + x)/Cb.
      const even = (storesA[r] * cb - storesB[r] * ca) / (ca + cb);
      const x = Math.max(-carry, Math.min(carry, even));
      if (x === 0) continue;
      storesA[r] -= x;
      storesB[r] += x;
      moved = true;
    }
    if (!moved) continue;
    out[ia] = { ...a, stores: storesA };
    out[ib] = { ...b, stores: storesB };
  }
  return out;
}
