/**
 * Batch 29's scripted days: a city and a metropolis with their vehicles out,
 * for the exit gate ("no vehicle inside a building") and for measuring.
 *
 *   - The reference city: the scripted player's city (`pacing.ts`), played
 *     for a stretch of real time with its rovers going out to build, every
 *     substep kept - and at the end a railway laid round what it built.
 *   - A metropolis: the example's (`metropolis.ts`), with a rover out to
 *     raise a level of buildings all over it, and its own railways.
 *
 * Built under the tuning a test passes in - a new world's, with routes on.
 */

import type { HabitatChannels } from "../sim/habitat.js";
import type { CityView, Settlement, SimState, Tuning } from "../sim/index.js";
import {
  BUILDING_DEFS,
  DEFAULT_TUNING,
  NEUTRAL_ENV,
  cityView,
  derive,
  foundSettlement,
  habitat,
  liquidWaterRate,
  nextSubstepFlows,
  placeLink,
  roverCount,
  upgradeBuilding,
  worldEnv,
} from "../sim/index.js";
import { terraformedMars } from "./example.js";
import { buildMetropolis } from "./metropolis.js";
import { playPacing } from "./pacing.js";

export interface CityDay {
  readonly t: Tuning;
  /** The city as it was after each substep. */
  readonly days: readonly Settlement[];
  readonly env: HabitatChannels;
  /** The city at the end, with a railway laid round it. */
  readonly railed: Settlement;
}

function envOf(state: SimState, t: Tuning): HabitatChannels {
  return habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t), t, liquidWaterRate(nextSubstepFlows(state, { tuning: t, env: NEUTRAL_ENV, forcing: null })));
}

/** The scripted player's city, `seconds` of real time at 1x, every substep kept; then a railway round it. */
export function cityDay(t: Tuning, seconds: number): CityDay {
  const days: Settlement[] = [];
  const run = playPacing(t, seconds, false, (state) => {
    days.push(state.settlements[0]!);
  });
  let state = run.state;
  const s = state.settlements[0]!;
  // A railway round what it built, a tile out (where the ground lets it be laid): bends beside buildings, and dead
  // ends where it cannot go on.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of s.buildings) {
    const def = BUILDING_DEFS[b.type];
    x0 = Math.min(x0, b.tx);
    y0 = Math.min(y0, b.ty);
    x1 = Math.max(x1, b.tx + def.footprint);
    y1 = Math.max(y1, b.ty + def.depth);
  }
  state = { ...state, settlements: state.settlements.map((c, i) => (i === 0 ? { ...c, stores: { ...c.stores, materials: 1e6 } } : c)) };
  const ring: [number, number][] = [];
  for (let x = x0 - 1; x <= x1; x += 1) ring.push([x, y0 - 1], [x, y1]);
  for (let y = y0; y < y1; y += 1) ring.push([x0 - 1, y], [x1, y]);
  // And a line across the middle, between the buildings where it can.
  const my = Math.floor((y0 + y1) / 2);
  for (let x = x0; x < x1; x += 1) ring.push([x, my]);
  for (const [x, y] of ring) {
    const o = placeLink(state, s.id, "rails", x, y, t);
    if (o.ok) state = o.state;
  }
  return { t, days, env: envOf(run.state, t), railed: state.settlements[0]! };
}

export interface MetropolisScene {
  readonly t: Tuning;
  readonly state: SimState;
  readonly id: string;
  readonly env: HabitatChannels;
  /** Buildings a rover was sent to, and how many no rover could get to. */
  readonly sent: number;
  readonly unreachable: number;
}

/** A metropolis with every rover out raising a level of buildings spread over it, and its railways. */
export function metropolisScene(t: Tuning): MetropolisScene {
  let state: SimState = terraformedMars(DEFAULT_TUNING);
  const env = envOf(state, t);
  state = foundSettlement(state, "metropolis", 0.4, -1.0, t, "Olympus").state;
  const id = state.settlements[state.settlements.length - 1]!.id;
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  state = buildMetropolis(state, id, env, t, rnd, ["h"]);
  const city = (): Settlement => state.settlements.find((c) => c.id === id)!;
  state = { ...state, settlements: state.settlements.map((c) => (c.id === id ? { ...c, stores: { ...c.stores, materials: 1e9 }, jobs: c.jobs.filter((j) => j.kind === "rocket") } : c)) };
  const rovers = roverCount(city(), t);
  let sent = 0;
  let unreachable = 0;
  const all = city().buildings;
  const step = Math.max(1, Math.floor(all.length / 211));
  for (let k = 1; k < all.length && sent < rovers; k += step) {
    const b = all[k]!;
    if (!BUILDING_DEFS[b.type].buildable) continue;
    const o = upgradeBuilding(state, id, b.tx, b.ty, t);
    if (o.ok) {
      state = o.state;
      sent += 1;
    } else if (o.reason !== null && /no rover can get there/.test(o.reason)) unreachable += 1;
  }
  return { t, state, id, env, sent, unreachable };
}

/** A settlement's view, as the browser draws it. */
export function viewOf(s: Settlement, env: HabitatChannels, t: Tuning): CityView {
  return cityView(s, env, t);
}
