/**
 * The example planet (at the user's request): Mars at the end of the
 * reference playthrough - fully habitable, the best the simulation's own
 * playthrough ever gets - with a thriving civilisation on it.
 *
 *   27 cities, 3 of them metropolises (3 x 3 a city's ground), and 15
 *   outposts, of every size from a handful of buildings to hundreds.
 *
 * Deterministic: the same planet every time, from the same code the game
 * runs. The world comes from `advance`, not from numbers typed in; the
 * settlements are placed by the same rules `placeBuilding` enforces (on the
 * grid, off steep ground, never overlapping, only what the kind may build),
 * checked in `example.test.ts`. Pure - no Node, no DOM - so the browser can
 * build it too.
 */

import type { BuildingType, HabitatChannels, PlacedBuilding, Settlement, SettlementKind, SimState, Tuning } from "../sim/index.js";
import {
  BUILDING_DEFS,
  NEUTRAL_ENV,
  advance,
  capacities,
  derive,
  evaluatePhase,
  foundSettlement,
  groundOf,
  habitat,
  housing,
  latchPhase,
  liquidWaterRate,
  marsStart,
  nextSubstepFlows,
  seedBiosphere,
  siteElevation,
  worldEnv,
} from "../sim/index.js";
import { REFERENCE_POLICY, applyOrdersDue } from "./policy.js";

/** Where the reference playthrough has plateaued: progress 98.6%, Phase 6 (measured). */
export const EXAMPLE_YEARS = 2800;

export const EXAMPLE_COUNTS = { cities: 24, metropolises: 3, outposts: 15 } as const;

/** Mars run through the reference playthrough, as the harness runs it. */
export function terraformedMars(physics: Tuning, years = EXAMPLE_YEARS): SimState {
  let state = marsStart();
  const applied = new Set<number>();
  const cfg = { tuning: physics, env: NEUTRAL_ENV, forcing: null };
  const chunk = 8;
  for (let year = 0; year < years; year += chunk * physics.SUBSTEP_YEARS) {
    state = applyOrdersDue(state, REFERENCE_POLICY, year, applied, physics);
    const env = worldEnv(state, NEUTRAL_ENV, physics);
    if (REFERENCE_POLICY.seedAt >= 0 && !state.seeded && year >= REFERENCE_POLICY.seedAt) {
      state = seedBiosphere(state, physics, env).state;
    }
    state = advance(state, chunk, cfg);
    const d = derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, physics), physics);
    state = { ...state, phaseReached: latchPhase(state.phaseReached, evaluatePhase(state.reservoirs, d, worldEnv(state, NEUTRAL_ENV, physics), physics)) };
  }
  return state;
}

/** A small deterministic generator (the simulation may not use Math.random, and neither does this). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function angularDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const c = Math.sin(a.lat) * Math.sin(b.lat) + Math.cos(a.lat) * Math.cos(b.lat) * Math.cos(a.lon - b.lon);
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/**
 * A settlement laid out by the rules: buildings tried at positions spiralling
 * out from the centre, each placed only where its whole footprint is on the
 * grid, on buildable ground and clear of every other building. `wants` is
 * the order to try; what does not fit is left out.
 */
function layOut(s: Settlement, wants: readonly BuildingType[], t: Tuning): PlacedBuilding[] {
  const ground = groundOf(s, t);
  const n = ground.tiles;
  const taken = new Uint8Array(n * n);
  const placed: PlacedBuilding[] = [];
  // Every tile, nearest the centre first (ties by angle, so the city grows round).
  const order: [number, number][] = [];
  for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) order.push([x, y]);
  const c = n / 2;
  order.sort((p, q) => Math.max(Math.abs(p[0] + 0.5 - c), Math.abs(p[1] + 0.5 - c)) - Math.max(Math.abs(q[0] + 0.5 - c), Math.abs(q[1] + 0.5 - c)) || Math.atan2(p[1] - c, p[0] - c) - Math.atan2(q[1] - c, q[0] - c));
  const fits = (tx: number, ty: number, size: number): boolean => {
    if (tx < 0 || ty < 0 || tx + size > n || ty + size > n) return false;
    for (let y = ty; y < ty + size; y += 1) for (let x = tx; x < tx + size; x += 1) if (taken[y * n + x] || ground.steep[y * n + x]) return false;
    return true;
  };
  let cursor = 0;
  for (const type of wants) {
    const size = BUILDING_DEFS[type].footprint;
    // Leave a one-tile street round each building, so the city reads as streets and blocks.
    for (let k = cursor; k < order.length; k += 1) {
      const [x, y] = order[k]!;
      if (x % (size + 1) !== 0 || y % (size + 1) !== 0) continue;
      if (!fits(x, y, size)) continue;
      for (let yy = y; yy < y + size; yy += 1) for (let xx = x; xx < x + size; xx += 1) taken[yy * n + xx] = 1;
      placed.push({ type, tx: x, ty: y, level: 1 });
      cursor = Math.max(0, k - 4 * n);
      break;
    }
  }
  return placed;
}

/** Everything a settlement of `homes` domes needs, in the order to place it. */
function wishList(kind: SettlementKind, homes: number): BuildingType[] {
  if (kind === "outpost") {
    const out: BuildingType[] = [];
    // Outposts work the land: power, a mine, extractors, depots - no people.
    for (let i = 0; i < homes; i += 1) out.push(i % 3 === 0 ? "reactor" : "geothermal_plant", "regolith_mine", "water_extractor", "storage_depot", "solar_array");
    return out;
  }
  const out: BuildingType[] = ["spaceport"];
  for (let i = 0; i < homes; i += 1) {
    out.push("habitat_dome", "greenhouse", "geothermal_plant", "water_extractor", "solar_array");
    if (i % 2 === 1) out.push("reactor", "storage_depot");
    // No Atmosphere Processors: on a finished planet the air holds 0.24 mbar
    // of CO2, below the 1 mbar they need, and all 144 of them stood idle
    // (measured). Their job is done; a finished city builds food and storage.
    if (i % 3 === 2) out.push("greenhouse", "storage_depot", "regolith_mine");
    if (kind === "metropolis" && i % 10 === 9) out.push("spaceport");
  }
  return out;
}

export interface ExamplePlanet {
  readonly state: SimState;
  /** The size (in domes, or work sets for an outpost) each settlement was laid out for, by id. */
  readonly sizes: Readonly<Record<string, number>>;
}

/**
 * The example planet. `physics` runs the playthrough (the calibrated default);
 * `game` is the tuning the settlements are built under (the browser's).
 */
export function examplePlanet(physics: Tuning, game: Tuning): ExamplePlanet {
  let state = terraformedMars(physics);
  const d = derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game);
  const env: HabitatChannels = habitat(state.reservoirs, d, game, liquidWaterRate(nextSubstepFlows(state, { tuning: game, env: NEUTRAL_ENV, forcing: null })));
  const rnd = lcg(20260924);

  // Sizes from very small to very large, then the three metropolises.
  const citySizes = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 12, 14, 16, 18, 22, 26];
  const outpostSizes = [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 5, 6];
  const plan: { kind: SettlementKind; size: number }[] = [
    { kind: "metropolis", size: 90 },
    { kind: "metropolis", size: 120 },
    { kind: "metropolis", size: 150 },
    ...citySizes.map((size) => ({ kind: "city" as const, size })),
    ...outpostSizes.map((size) => ({ kind: "outpost" as const, size })),
  ];

  // Sites: high above the sea (nothing floods), and spread over the planet.
  const sites: { lat: number; lon: number }[] = [];
  for (const { kind } of plan) {
    const spacing = kind === "metropolis" ? 0.55 : 0.3;
    for (let tries = 0; tries < 20000; tries += 1) {
      const site = { lat: Math.asin((2 * rnd() - 1) * 0.92), lon: (2 * rnd() - 1) * Math.PI };
      if (siteElevation(site.lat, site.lon, game) < env.seaLevelM + 300) continue;
      if (sites.some((o) => angularDistance(o, site) < spacing)) continue;
      sites.push(site);
      break;
    }
  }

  const sizes: Record<string, number> = {};
  plan.forEach(({ kind, size }, i) => {
    const site = sites[i];
    if (site === undefined) return;
    state = foundSettlement(state, kind, site.lat, site.lon, game).state;
    const founded = state.settlements[state.settlements.length - 1]!;
    const buildings = layOut(founded, wishList(kind, size), game);
    const built: Settlement = { ...founded, buildings };
    // A thriving settlement: full stores, nine in ten homes taken.
    const cap = capacities(built, game);
    const settled: Settlement = { ...built, stores: { ...cap }, population: Math.floor(housing(built, game) * 0.9) };
    state = { ...state, settlements: state.settlements.map((s) => (s.id === founded.id ? settled : s)) };
    sizes[founded.id] = size;
  });
  void env;
  return { state, sizes };
}
