/**
 * Micro doc §7 - one settlement, simulating itself. And §3.3's placement
 * rules, which are simulation rules even though Batch 20 draws them.
 *
 * "Mirror the macro tick discipline: derive, sum rates, integrate, clamp. One
 * settlement per call; deterministic; serializable." It runs once per SUBSTEP
 * inside `advance` (via computeStep), never once per call, so a settlement is
 * as chunk-independent as the planet.
 *
 * Stored: population, the five stores, the buildings, the corridors and
 * cables, the broken rocks, the rovers and rockets under way. Derived every substep
 * and never stored (micro §10): which buildings are operable, efficiencies,
 * production and consumption totals, capacities, housing.
 */

import type { HabitatChannels } from "../habitat.js";
import { habitat } from "../habitat.js";
import { derive } from "../derive.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, History, MicroResource, PlacedBuilding, PlannedLink, Settlement, SettlementJob, SettlementKind, SimState, Zone } from "../types.js";
import { MICRO_RESOURCES, NEUTRAL_ENV, isCityKind } from "../types.js";
import { BUILDING_DEFS, UNLOCKED, buildYears, keySet, levelFactor, maxLevel, tilesUnder } from "./buildings.js";
import { baseOf, chunkKey, claimTest, footprintTiles, frameOf, gridTiles, isBaseChunk, keyChunk, keyTile, TILE_STRIDE, tileKey } from "./space.js";
import { isSteep, slopeAt } from "./terrain.js";
import type { Rock } from "./rocks.js";
import { garage, levelFor, rockAt, roverCount, roversOut, rocksOf, roverYears, siteGround } from "./rocks.js";
import type { FloodReading } from "./flood.js";
import { applyFlood, floodReading, submerged } from "./flood.js";
import type { Layer, LinkLayer, NetworkIssue } from "./network.js";
import { LAYERS, applyNetwork, linksForRedundancy, linksToConnect, networkOf, withRails } from "./network.js";

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
    lostAtSeaLevelM: null,
    corridors: [],
    cables: [],
    cleared: [],
    jobs: [],
    base: gridTiles(kind, t),
    claims: [],
    grades: [],
    rails: [],
    name: "",
    zones: [],
    levelQueue: [],
    planned: [],
    history: EMPTY_HISTORY,
  };
}

/** A settlement's record before anything has happened. */
export const EMPTY_HISTORY: History = Object.freeze({ acc: { substeps: 0, births: 0, deaths: 0, short: [0, 0, 0, 0, 0], net: [0, 0, 0, 0, 0] }, taken: 0, samples: [] });

/**
 * Where the headquarters stands on an `n`-tile grid: its 5 x 5 footprint
 * centred on the grid (at the user's request: "always at the center of the
 * city, 5x5").
 */
export function headquartersOrigin(n: number): { tx: number; ty: number } {
  const c = Math.floor(n / 2) - 2;
  return { tx: c, ty: c };
}

/**
 * What a settlement is founded with (behind `HEADQUARTERS_ENABLED`): the
 * headquarters at the centre, and - for a city or a metropolis - one
 * spaceport sharing its east wall. Landed, not built: no cost, and on the
 * levelled landing zone.
 */
export function foundingBuildings(kind: SettlementKind, t: Tuning): PlacedBuilding[] {
  if (!t.HEADQUARTERS_ENABLED) return [];
  const hq = headquartersOrigin(gridTiles(kind, t));
  const out: PlacedBuilding[] = [{ type: "headquarters", tx: hq.tx, ty: hq.ty, level: 1 }];
  if (kind !== "outpost") out.push({ type: "spaceport", tx: hq.tx + 5, ty: hq.ty + 1, level: 1 });
  return out;
}

/**
 * What every building adds to the stores' room and to housing, kept per
 * building list and tuning while none of them is going up (asked twice a
 * substep over a metropolis's 21,000 buildings, it was a fifth of the step).
 * Summed in the same order as the loops below, so the numbers are the same.
 */
const standingSums = new WeakMap<readonly PlacedBuilding[], { t: Tuning; cap: Readonly<Record<MicroResource, number>>; home: number }>();

function sumsOf(s: Settlement, t: Tuning): { cap: Readonly<Record<MicroResource, number>>; home: number } | null {
  if (constructing(s) !== EMPTY) return null;
  const kept = standingSums.get(s.buildings);
  if (kept !== undefined && kept.t === t) return kept;
  const made = { t, cap: capacitiesLoop(s, t), home: housingLoop(s, t) };
  standingSums.set(s.buildings, made);
  return made;
}

export function capacities(s: Settlement, t: Tuning): Readonly<Record<MicroResource, number>> {
  const kept = sumsOf(s, t);
  return kept !== null ? { ...kept.cap } : capacitiesLoop(s, t);
}

export function housing(s: Settlement, t: Tuning): number {
  return sumsOf(s, t)?.home ?? housingLoop(s, t);
}

function capacitiesLoop(s: Settlement, t: Tuning): Record<MicroResource, number> {
  const cap: Record<MicroResource, number> = {
    power: t.MICRO_CAP_POWER,
    water: t.MICRO_CAP_WATER,
    oxygen: t.MICRO_CAP_OXYGEN,
    food: t.MICRO_CAP_FOOD,
    materials: t.MICRO_CAP_MATERIALS,
  };
  const building = constructing(s);
  for (const b of s.buildings) {
    if (building.has(tileKey(b.tx, b.ty))) continue;
    const extra = BUILDING_DEFS[b.type].capacity(t);
    const k = levelFactor(b.level, t);
    for (const r of MICRO_RESOURCES) cap[r] += (extra[r] ?? 0) * k;
  }
  return cap;
}

function housingLoop(s: Settlement, t: Tuning): number {
  let total = 0;
  const building = constructing(s);
  for (const b of s.buildings) if (!building.has(tileKey(b.tx, b.ty))) total += BUILDING_DEFS[b.type].housing(t) * levelFactor(b.level, t);
  return total;
}

/**
 * The buildings still going up, by their corner's tile key, and how far the
 * work is, 0..1. A building is up once its rover has done the work and set
 * off home: the rest of the job is the drive back. Derived from the jobs.
 */
export function constructionOf(s: Settlement): Map<number, number> {
  const out = new Map<number, number>();
  for (const j of s.jobs) {
    if (j.kind !== "build" || j.upgrade) continue;
    const drive = (j.total - j.work) / 2;
    if (!(j.remaining > drive)) continue;
    const at = j.total - j.remaining - drive;
    out.set(j.tile, Math.min(1, Math.max(0, at / Math.max(1e-9, j.work))));
  }
  return out;
}

function constructing(s: Settlement): ReadonlySet<number> {
  return s.jobs.some((j) => j.kind === "build") ? new Set(constructionOf(s).keys()) : EMPTY;
}

const EMPTY: ReadonlySet<number> = new Set();

/** A rover to build (or upgrade) the building at (tx, ty): out from the headquarters, the work, and back. */
function buildJob(s: Settlement, type: BuildingType, tx: number, ty: number, upgrade: boolean, t: Tuning): SettlementJob {
  const size = BUILDING_DEFS[type].footprint;
  const depth = BUILDING_DEFS[type].depth;
  const from = garage(s)!;
  const distance = Math.hypot(tx + size / 2 - from.x, ty + depth / 2 - from.y);
  const work = buildYears(type, t);
  const total = 2 * distance * t.ROVER_YEARS_PER_TILE + work;
  return { kind: "build", tile: tileKey(tx, ty), work, total, remaining: total, upgrade };
}

// ---------------------------------------------------------------------------
// Placement (section 3.3)
// ---------------------------------------------------------------------------

export interface PlaceOutcome {
  readonly state: SimState;
  readonly ok: boolean;
  readonly reason: string | null;
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
  /** The planet as the city sees it, for what it unlocks (wind, parks); from the reservoirs when not given. */
  env?: HabitatChannels,
): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  const def = BUILDING_DEFS[type];
  if (def === undefined) return refuse(`"${String(type)}" is not a building`);
  if (!def.buildable) return refuse(`the ${def.name} is founded with the settlement, never built`);
  if (!def.kinds.includes(s.kind)) return refuse(`${def.name} cannot be built in an ${s.kind}`);
  const needs = def.minPopulation(t);
  if (needs > 0 && s.population < needs) return refuse(`a ${def.name} needs a city of ${needs} people - this one has ${Math.floor(s.population)}`);
  if (def.locked !== UNLOCKED) {
    const locked = def.locked(env ?? habitat(state.reservoirs, derive(state.reservoirs, NEUTRAL_ENV, t), t, 0), t);
    if (locked !== null) return refuse(locked);
  }
  if (type === "rover_post") {
    // One post for every ROVER_POST_PEOPLE people.
    const posts = s.buildings.filter((b) => b.type === "rover_post").length;
    const allowed = Math.floor(s.population / t.ROVER_POST_PEOPLE);
    if (posts >= allowed) return refuse(`a ${def.name} needs ${(posts + 1) * t.ROVER_POST_PEOPLE} people - one post for every ${t.ROVER_POST_PEOPLE}, and the city has ${Math.floor(s.population)}`);
  }
  const f = { tx, ty, w: def.footprint, h: def.depth };
  const ours = claimTest(s, t);
  if (!footprintTiles(f).every(([x, y]) => ours(x, y))) return refuse(`${def.name} does not fit there - it runs off the grid, the land the city holds (claim more as it grows)`);
  const ground = siteGround(s, t);
  // Detail §1.3: "A building footprint must fit on tiles whose slope is below a buildable maximum."
  const tooSteep = footprintTiles(f).filter(([x, y]) => isSteep(ground, x, y));
  if (tooSteep.length > 0) {
    const worst = Math.max(...tooSteep.map(([x, y]) => slopeAt(ground, x, y)));
    return refuse(`${def.name} would stand on ground too steep to build on (slope ${worst.toFixed(2)}, limit ${t.TERRAIN_MAX_SLOPE})`);
  }
  // Overlap by rectangles, not the set of every tile built on: that set is made again for each new list of
  // buildings, and replaying a 40,000-building city placement by placement took 27 ms a building (measured).
  const overlaps = s.buildings.some((b) => {
    const d = BUILDING_DEFS[b.type];
    return b.tx < tx + def.footprint && tx < b.tx + d.footprint && b.ty < ty + def.depth && ty < b.ty + d.depth;
  });
  if (overlaps) return refuse(`${def.name} would overlap another building`);
  // Hard rock: boulders stand in the way until a rover breaks them.
  if (footprintTiles(f).some(([x, y]) => rockAt(s, x, y, t) === "crag")) return refuse(`${def.name} would stand on hard rock - send a rover to break it first`);
  const corridors = keySet(s.corridors);
  if (footprintTiles(f).some(([x, y]) => corridors.has(tileKey(x, y)))) return refuse(`${def.name} would stand on a corridor - remove it first`);
  const cables = keySet(s.cables);
  if (footprintTiles(f).some(([x, y]) => cables.has(tileKey(x, y)))) return refuse(`${def.name} would stand on a cable - remove it first`);
  const rails = keySet(s.rails);
  if (footprintTiles(f).some(([x, y]) => rails.has(tileKey(x, y)))) return refuse(`${def.name} would stand on a railway - remove it first`);
  const cost = def.cost(t);
  if (s.stores.materials < cost) {
    return refuse(`${def.name} needs ${cost} materials, ${Math.floor(s.stores.materials)} available`);
  }
  // With build times, a rover goes out to build it.
  const byRover = t.BUILD_TIME_ENABLED > 0 && garage(s) !== null;
  if (byRover && roversOut(s) >= roverCount(s, t)) return refuse(`all ${roverCount(s, t)} rovers are out - a ${def.name} needs one to build it`);
  const building: PlacedBuilding = { type, tx, ty, level: 1 };
  const next: Settlement = {
    ...s,
    stores: { ...s.stores, materials: s.stores.materials - cost },
    buildings: [...s.buildings, building],
    jobs: byRover ? [...s.jobs, buildJob(s, type, tx, ty, false, t)] : s.jobs,
  };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null };
}

const LAYER_WORDS: Readonly<Record<LinkLayer, { one: string; cost: (t: Tuning) => number }>> = {
  rails: { one: "railway", cost: (t) => t.COST_RAIL },
  corridors: { one: "corridor", cost: (t) => t.COST_CORRIDOR },
  cables: { one: "cable", cost: (t) => t.COST_CABLE },
};

/**
 * Lay a corridor or a cable on one tile, paying for it. Refused, changing
 * nothing, off the grid, on ground too steep to build on, under a building,
 * where one already is, or without the materials. A tile may carry both.
 */
/** Why a link cannot go on (tx, ty) - the ground, a building, rock, one already there - or null. Not the materials. */
export function linkRefusal(s: Settlement, layer: LinkLayer, tx: number, ty: number, t: Tuning): string | null {
  const words = LAYER_WORDS[layer];
  if (!claimTest(s, t)(tx, ty)) return `a ${words.one} must be on the grid - the land the city holds`;
  const ground = siteGround(s, t);
  if (isSteep(ground, tx, ty)) return `the ground is too steep for a ${words.one} (slope ${slopeAt(ground, tx, ty).toFixed(2)}, limit ${t.TERRAIN_MAX_SLOPE}) - send a rover to break the crag`;
  if (tilesUnder(s.buildings).has(tileKey(tx, ty))) return "a building stands there";
  if (rockAt(s, tx, ty, t) === "crag") return `hard rock is in the way of a ${words.one} - send a rover to break it first`;
  if (keySet(s[layer]).has(tileKey(tx, ty))) return `there is a ${words.one} there already`;
  return null;
}

export function placeLink(state: SimState, settlementId: string, layer: LinkLayer, tx: number, ty: number, t: Tuning): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const words = LAYER_WORDS[layer];
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  if (!claimTest(s, t)(tx, ty)) return refuse(`a ${words.one} must be on the grid - the land the city holds`);
  const ground = siteGround(s, t);
  if (isSteep(ground, tx, ty)) return refuse(`the ground is too steep for a ${words.one} (slope ${slopeAt(ground, tx, ty).toFixed(2)}, limit ${t.TERRAIN_MAX_SLOPE}) - send a rover to break the crag`);
  if (tilesUnder(s.buildings).has(tileKey(tx, ty))) return refuse("a building stands there");
  if (rockAt(s, tx, ty, t) === "crag") return refuse(`hard rock is in the way of a ${words.one} - send a rover to break it first`);
  const key = tileKey(tx, ty);
  if (keySet(s[layer]).has(key)) return refuse(`there is a ${words.one} there already`);
  const cost = words.cost(t);
  if (s.stores.materials < cost) return refuse(`a ${words.one} needs ${cost} materials, ${Math.floor(s.stores.materials)} available`);
  const next: Settlement = { ...s, stores: { ...s.stores, materials: s.stores.materials - cost }, [layer]: [...s[layer], key].sort((a, b) => a - b) };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null };
}

/** Take up the corridor or cable on (tx, ty). No refund, as for buildings. */
export function removeLink(state: SimState, settlementId: string, layer: LinkLayer, tx: number, ty: number): PlaceOutcome {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}` };
  const key = tileKey(tx, ty);
  if (!keySet(s[layer]).has(key)) return { state, ok: false, reason: `there is no ${LAYER_WORDS[layer].one} there` };
  return { state: withSettlement(state, settlementId, { ...s, [layer]: s[layer].filter((k) => k !== key) }), ok: true, reason: null };
}

/**
 * "Connect everything": lay, and pay for, the corridors and cables
 * `linksToConnect` finds - the shortest that join every building into one
 * network of each, where the ground allows. All or nothing.
 */
export function connectAll(state: SimState, settlementId: string, t: Tuning): PlaceOutcome & { readonly laid: number } {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}`, laid: 0 };
  if (s.lostAtSeaLevelM !== null) return { state, ok: false, reason: `${settlementId} was lost to the sea`, laid: 0 };
  const corridors = linksToConnect(s, "corridors", t);
  const cables = linksToConnect(s, "cables", t);
  const laid = corridors.length + cables.length;
  if (laid === 0) return { state, ok: false, reason: "everything that can be connected already is", laid: 0 };
  const cost = corridors.length * t.COST_CORRIDOR + cables.length * t.COST_CABLE;
  if (s.stores.materials < cost) return { state, ok: false, reason: `${laid} tiles of corridor and cable need ${cost} materials, ${Math.floor(s.stores.materials)} available`, laid: 0 };
  const next: Settlement = {
    ...s,
    stores: { ...s.stores, materials: s.stores.materials - cost },
    corridors: [...s.corridors, ...corridors].sort((a, b) => a - b),
    cables: [...s.cables, ...cables].sort((a, b) => a - b),
  };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null, laid };
}

/**
 * "Connect twice" (at the user's request): lay, and pay for, the corridors
 * and cables that give every building its own route to its two nearest other
 * buildings - two different ones where it can reach two - so one broken
 * link leaves nothing cut off. All or nothing.
 */
export function connectTwice(state: SimState, settlementId: string, t: Tuning): PlaceOutcome & { readonly laid: number } {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}`, laid: 0 };
  if (s.lostAtSeaLevelM !== null) return { state, ok: false, reason: `${settlementId} was lost to the sea`, laid: 0 };
  const corridors = linksForRedundancy(s, "corridors", t);
  const cables = linksForRedundancy(s, "cables", t);
  const laid = corridors.length + cables.length;
  if (laid === 0) return { state, ok: false, reason: "every building already has its two routes", laid: 0 };
  const cost = corridors.length * t.COST_CORRIDOR + cables.length * t.COST_CABLE;
  if (s.stores.materials < cost) return { state, ok: false, reason: `${laid} tiles of corridor and cable need ${cost} materials, ${Math.floor(s.stores.materials)} available`, laid: 0 };
  const next: Settlement = {
    ...s,
    stores: { ...s.stores, materials: s.stores.materials - cost },
    corridors: [...s.corridors, ...corridors].sort((a, b) => a - b),
    cables: [...s.cables, ...cables].sort((a, b) => a - b),
  };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null, laid };
}

/**
 * Send a rover from the headquarters to break the rock on (tx, ty) (at the
 * user's request). It takes longer the further the rock is; it brings back
 * `ROCK_LOOSE_MATERIALS` for loose rocks, `ROCK_CRAG_MATERIALS` for a crag,
 * and a broken crag leaves ground that can be built on. The headquarters
 * keeps `ROVERS_PER_HQ` rovers.
 */
export function sendRover(state: SimState, settlementId: string, tx: number, ty: number, t: Tuning): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  if (garage(s) === null) return refuse("there is no headquarters to send a rover from");
  const n = frameOf(s, t).n;
  if (!claimTest(s, t)(tx, ty)) return refuse("that is off the grid - the land the city holds");
  const rock: Rock = rocksOf(s, t)[ty * n + tx] ?? "none";
  if (rock === "none") return refuse("there is no rock there to break");
  const key = tileKey(tx, ty);
  if (s.jobs.some((j) => j.kind === "rover" && j.tile === key)) return refuse("a rover is already on its way there");
  const out = roversOut(s);
  const rovers = roverCount(s, t);
  if (out >= rovers) return refuse(`all ${rovers} rovers are out`);
  const years = roverYears(s, tx, ty, rock, t);
  const work = rock === "crag" ? t.ROVER_WORK_YEARS_CRAG : t.ROVER_WORK_YEARS_LOOSE;
  const job: SettlementJob = { kind: "rover", tile: key, materials: rock === "crag" ? t.ROCK_CRAG_MATERIALS : t.ROCK_LOOSE_MATERIALS, work, total: years, remaining: years };
  return { state: withSettlement(state, settlementId, { ...s, jobs: [...s.jobs, job] }), ok: true, reason: null };
}

/**
 * Send a rover to level the ground of tile (tx, ty) to the level beside it
 * (at the user's request: "there has to be the possibility to send a rover
 * and flat out the terrain to the nearby level" - for looks, and so a
 * building can stand without a foundation). Open ground the city holds, not
 * under a building; what rock is there is broken too, and brought back.
 * The level is fixed when the rover sets out.
 */
export function levelGround(state: SimState, settlementId: string, tx: number, ty: number, t: Tuning): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  if (garage(s) === null) return refuse("there is no headquarters to send a rover from");
  if (!claimTest(s, t)(tx, ty)) return refuse("that is off the grid - the land the city holds");
  if (tilesUnder(s.buildings).has(tileKey(tx, ty))) return refuse("a building stands there");
  const key = tileKey(tx, ty);
  if (s.jobs.some((j) => j.kind === "rover" && j.tile === key)) return refuse("a rover is already on its way there");
  const ground = siteGround(s, t);
  const n = ground.tiles;
  const m = n + 1;
  const level = levelFor(s, tx, ty, t);
  const corners = [ground.cornersM[ty * m + tx]!, ground.cornersM[ty * m + tx + 1]!, ground.cornersM[(ty + 1) * m + tx]!, ground.cornersM[(ty + 1) * m + tx + 1]!];
  if (corners.every((c) => Math.abs(c - level) < 0.01)) return refuse("the ground is already level there");
  const out = roversOut(s);
  const rovers = roverCount(s, t);
  if (out >= rovers) return refuse(`all ${rovers} rovers are out`);
  const rock: Rock = rocksOf(s, t)[ty * n + tx] ?? "none";
  const breaking = rock === "none" ? 0 : rock === "crag" ? t.ROVER_WORK_YEARS_CRAG : t.ROVER_WORK_YEARS_LOOSE;
  const work = t.ROVER_WORK_YEARS_LEVEL + breaking;
  const years = roverYears(s, tx, ty, "none", t) - t.ROVER_WORK_YEARS_LOOSE + work;
  const materials = rock === "crag" ? t.ROCK_CRAG_MATERIALS : rock === "loose" ? t.ROCK_LOOSE_MATERIALS : 0;
  const job: SettlementJob = { kind: "rover", tile: key, materials, work, total: years, remaining: years, levelM: level };
  return { state: withSettlement(state, settlementId, { ...s, jobs: [...s.jobs, job] }), ok: true, reason: null };
}

/**
 * Launch a rocket from the spaceport covering (tx, ty) (at the user's
 * request): it flies off and comes back `ROCKET_TRIP_YEARS` later - one real
 * minute at 1x - with `ROCKET_MATERIALS`, or what the stores have room for.
 * One rocket per spaceport at a time. It carries its own fuel: an unpowered
 * spaceport can still launch.
 */
export function launchRocket(state: SimState, settlementId: string, tx: number, ty: number, t: Tuning): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  const port = s.buildings.find((b) => b.type === "spaceport" && tx >= b.tx && ty >= b.ty && tx < b.tx + 3 && ty < b.ty + 3);
  if (port === undefined) return refuse("there is no spaceport there");
  const key = tileKey(port.tx, port.ty);
  if (s.jobs.some((j) => j.kind === "rocket" && j.tile === key)) return refuse("its rocket is already away");
  if (s.stores.materials >= capacities(s, t).materials) return refuse("the stores are full of materials");
  const job: SettlementJob = { kind: "rocket", tile: key, total: t.ROCKET_TRIP_YEARS, remaining: t.ROCKET_TRIP_YEARS };
  return { state: withSettlement(state, settlementId, { ...s, jobs: [...s.jobs, job] }), ok: true, reason: null };
}

/**
 * Raise the building whose footprint covers (tx, ty) a level (at the user's
 * request): each level multiplies what it makes, houses and stores by
 * 1 + LEVEL_BONUS. It costs the building's price again; with build times, a
 * rover does the work and the level comes when the rover is home. The
 * building keeps running meanwhile.
 */
export function upgradeBuilding(state: SimState, settlementId: string, tx: number, ty: number, t: Tuning): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  const index = s.buildings.findIndex((b) => {
    const size = BUILDING_DEFS[b.type].footprint;
    const depth = BUILDING_DEFS[b.type].depth;
    return tx >= b.tx && ty >= b.ty && tx < b.tx + size && ty < b.ty + depth;
  });
  if (index < 0) return refuse("there is no building there");
  const b = s.buildings[index]!;
  const def = BUILDING_DEFS[b.type];
  if (!def.buildable) return refuse(`the ${def.name} cannot be upgraded`);
  const top = maxLevel(b.type, t);
  if (b.level >= top) return refuse(`the ${def.name} is at its highest level (${top})`);
  const corner = tileKey(b.tx, b.ty);
  if (s.jobs.some((j) => j.kind === "build" && j.tile === corner)) return refuse(`the ${def.name} is ${constructionOf(s).has(corner) ? "still being built" : "already being upgraded"}`);
  const cost = def.cost(t);
  if (s.stores.materials < cost) return refuse(`an upgrade needs ${cost} materials, ${Math.floor(s.stores.materials)} available`);
  const byRover = t.BUILD_TIME_ENABLED > 0 && garage(s) !== null;
  if (byRover && roversOut(s) >= roverCount(s, t)) return refuse(`all ${roverCount(s, t)} rovers are out - an upgrade needs one`);
  const next: Settlement = {
    ...s,
    stores: { ...s.stores, materials: s.stores.materials - cost },
    buildings: byRover ? s.buildings : s.buildings.map((x, i) => (i === index ? { ...x, level: x.level + 1 } : x)),
    jobs: byRover ? [...s.jobs, buildJob(s, b.type, b.tx, b.ty, true, t)] : s.jobs,
  };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null };
}

/** Remove the building whose footprint covers (tx, ty). Frees its tiles; no refund (none is specified). */
export function removeBuilding(state: SimState, settlementId: string, tx: number, ty: number): PlaceOutcome {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}` };
  const index = s.buildings.findIndex((b) => {
    const size = BUILDING_DEFS[b.type].footprint;
    const depth = BUILDING_DEFS[b.type].depth;
    return tx >= b.tx && ty >= b.ty && tx < b.tx + size && ty < b.ty + depth;
  });
  if (index < 0) return { state, ok: false, reason: "there is no building there" };
  if (!BUILDING_DEFS[s.buildings[index]!.type].buildable) return { state, ok: false, reason: `the ${BUILDING_DEFS[s.buildings[index]!.type].name} cannot be removed` };
  // A building still going up, or being upgraded, calls its rover home: the job goes with it.
  const corner = tileKey(s.buildings[index]!.tx, s.buildings[index]!.ty);
  const next: Settlement = { ...s, buildings: s.buildings.filter((_, i) => i !== index), jobs: s.jobs.filter((j) => !(j.kind === "build" && j.tile === corner)) };
  return { state: withSettlement(state, settlementId, next), ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Claiming land (at the user's request)
// ---------------------------------------------------------------------------

/** How many chunks a settlement of this many people may have claimed beyond its founding square. */
export function claimsAllowed(population: number, t: Tuning): number {
  if (!(population >= t.CLAIM_FIRST_POPULATION)) return 0;
  return 1 + Math.floor((population - t.CLAIM_FIRST_POPULATION) / t.CLAIM_STEP_POPULATION);
}

/** The people the next claim waits for, or null for a settlement that cannot claim at all. */
export function nextClaimAt(s: Settlement, t: Tuning): number | null {
  if (!isCityKind(s.kind) || s.base % t.CLAIM_CHUNK_TILES !== 0) return null;
  const k = s.claims.length;
  return k === 0 ? t.CLAIM_FIRST_POPULATION : t.CLAIM_FIRST_POPULATION + k * t.CLAIM_STEP_POPULATION;
}

/**
 * The chunks a settlement could claim next: every chunk beside its land
 * (sharing an edge) that it does not hold. Sorted by key. Empty for a
 * settlement that cannot claim.
 */
export function claimableChunks(s: Settlement, t: Tuning): { i: number; j: number }[] {
  if (nextClaimAt(s, t) === null || s.lostAtSeaLevelM !== null) return [];
  const base = baseOf(s, t);
  const held = new Set(s.claims);
  const holds = (i: number, j: number): boolean => isBaseChunk(i, j, base, t) || held.has(chunkKey(i, j));
  const per = base / t.CLAIM_CHUNK_TILES;
  const out = new Set<number>();
  const around = (i: number, j: number): void => {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (!holds(i + di, j + dj)) out.add(chunkKey(i + di, j + dj));
  };
  for (let j = 0; j < per; j += 1) for (let i = 0; i < per; i += 1) around(i, j);
  for (const key of s.claims) {
    const { i, j } = keyChunk(key);
    around(i, j);
  }
  return [...out].sort((a, b) => a - b).map(keyChunk);
}

/**
 * Claim chunk (i, j) - site chunk coordinates - for a city that has the
 * people for it. Free: land is earned by growing. When the claim reaches
 * west or north of the frame, the frame's corner moves and everything stored
 * in local tiles - buildings, corridors, cables, broken rocks, jobs - moves
 * with it, so it stays on the same ground.
 */
export function claimLand(state: SimState, settlementId: string, i: number, j: number, t: Tuning): PlaceOutcome {
  const refuse = (reason: string): PlaceOutcome => ({ state, ok: false, reason });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (s.lostAtSeaLevelM !== null) return refuse(`${settlementId} was lost to the sea`);
  const next = nextClaimAt(s, t);
  if (next === null) return refuse(isCityKind(s.kind) ? "this settlement's ground does not divide into chunks" : "an outpost cannot claim land - only a city grows");
  if (!Number.isInteger(i) || !Number.isInteger(j)) return refuse("a chunk is a whole number of chunks from the founding square");
  if (!claimableChunks(s, t).some((c) => c.i === i && c.j === j)) return refuse("that land is not beside the city's own, or is already its");
  if (claimsAllowed(s.population, t) <= s.claims.length) return refuse(`claiming more land needs ${next} people - the city has ${Math.floor(s.population)}`);
  const claims = [...s.claims, chunkKey(i, j)].sort((a, b) => a - b);
  const before = frameOf(s, t);
  const after = frameOf({ ...s, claims }, t);
  if (after.n > TILE_STRIDE || Math.abs(i) >= 500 || Math.abs(j) >= 500) return refuse("that is as far as a settlement can reach");
  const moved = shiftContent({ ...s, claims }, before.x0 - after.x0, before.y0 - after.y0);
  return { state: withSettlement(state, settlementId, moved), ok: true, reason: null };
}

/** Everything stored in local tiles, moved by (dx, dy): buildings, corridors, cables, broken rocks, jobs. */
export function shiftContent(s: Settlement, dx: number, dy: number): Settlement {
  if (dx === 0 && dy === 0) return s;
  const move = (key: number): number => {
    const { tx, ty } = keyTile(key);
    return tileKey(tx + dx, ty + dy);
  };
  return {
    ...s,
    buildings: s.buildings.map((b) => ({ ...b, tx: b.tx + dx, ty: b.ty + dy })),
    corridors: s.corridors.map(move),
    cables: s.cables.map(move),
    cleared: s.cleared.map(move),
    rails: s.rails.map(move),
    zones: s.zones.map((z) => ({ ...z, tiles: z.tiles.map(move) })),
    levelQueue: s.levelQueue.map((q) => ({ ...q, tile: move(q.tile) })),
    planned: s.planned.map((p) => ({ ...p, tile: move(p.tile) })),
    grades: s.grades.map((g) => ({ ...g, tile: move(g.tile) })),
    jobs: s.jobs.map((job) => ({ ...job, tile: move(job.tile) })),
  };
}

const covers = new WeakMap<readonly PlacedBuilding[], { t: Tuning; cover: (readonly number[] | undefined)[] }>();

/**
 * Per building, the Industrial Command Centers whose square it stands in (its
 * middle within half the square's side of theirs, the side growing with their
 * level) - or undefined for none, and for a command center itself. Kept per
 * building list: every substep asked it of every building for every center
 * (a quarter of a metropolis's substep).
 */
function commandCover(buildings: readonly PlacedBuilding[], t: Tuning): (readonly number[] | undefined)[] {
  const kept = covers.get(buildings);
  if (kept !== undefined && kept.t === t) return kept.cover;
  const centre = (b: PlacedBuilding): [number, number] => [b.tx + BUILDING_DEFS[b.type].footprint / 2, b.ty + BUILDING_DEFS[b.type].depth / 2];
  const commands = buildings.map((b, i) => (b.type === "industrial_command" ? i : -1)).filter((i) => i >= 0);
  const halfOf = (cb: PlacedBuilding): number => (t.COMMAND_SQUARE_TILES + t.COMMAND_SQUARE_PER_LEVEL * (cb.level - 1)) / 2;
  // The commands by square of the widest reach, so each building asks only those beside it (every building
  // against every command, a metropolis of 40,000 buildings and hundreds of commands took 190 ms, measured).
  const size = Math.max(1, ...commands.map((c) => 2 * halfOf(buildings[c]!)));
  const cells = new Map<number, number[]>();
  const cellOf = (x: number, y: number): number => (Math.floor(y / size) + 4096) * 8192 + Math.floor(x / size) + 4096;
  for (const c of commands) {
    const [cx, cy] = centre(buildings[c]!);
    const k = cellOf(cx, cy);
    cells.set(k, [...(cells.get(k) ?? []), c]);
  }
  const cover = buildings.map((b) => {
    if (commands.length === 0 || b.type === "industrial_command") return undefined;
    const [x, y] = centre(b);
    const list: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const c of cells.get(cellOf(x + dx * size, y + dy * size)) ?? []) {
          const [cx, cy] = centre(buildings[c]!);
          const half = halfOf(buildings[c]!);
          if (Math.abs(x - cx) <= half && Math.abs(y - cy) <= half) list.push(c);
        }
      }
    }
    // In the order of the buildings, as before.
    return list.length === 0 ? undefined : list.sort((a, b2) => a - b2);
  });
  covers.set(buildings, { t, cover });
  return cover;
}

// ---------------------------------------------------------------------------
// The city planner (at the user's request: "I can see the planimetry of the
// city in 2D, assign zones and colour zones, assign robots to flatten out an
// entire zone, draw roads and power lines and they get built, see population
// charts, blackouts, food shortages, population growth and deaths")
// ---------------------------------------------------------------------------

/** Name a settlement; an empty name gives it back its number ("City 3"). */
export function renameSettlement(state: SimState, settlementId: string, name: string): PlaceOutcome {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}` };
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean.length > NAME_MAX) return { state, ok: false, reason: `a name is at most ${NAME_MAX} letters` };
  return { state: withSettlement(state, settlementId, { ...s, name: clean }), ok: true, reason: null };
}

/** The longest name a settlement or zone may have. */
export const NAME_MAX = 40;

/**
 * Draw a zone, or change one: its name and colour, tiles added and taken
 * away. Without an id, a new zone. A tile belongs to one zone at most: added
 * to this one, it leaves any other. Tiles off the frame are left out.
 */
export function editZone(
  state: SimState,
  settlementId: string,
  edit: { readonly id?: number; readonly name?: string; readonly colour?: string; readonly add?: readonly number[]; readonly remove?: readonly number[] },
  t: Tuning,
): PlaceOutcome & { readonly zone: number | null } {
  const refuse = (reason: string) => ({ state, ok: false, reason, zone: null });
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (edit.colour !== undefined && !/^#[0-9a-f]{6}$/i.test(edit.colour)) return refuse(`"${edit.colour}" is not a colour (#rrggbb)`);
  const name = edit.name?.trim();
  if (name !== undefined && (name.length === 0 || name.length > NAME_MAX)) return refuse(`a zone's name is 1 to ${NAME_MAX} letters`);
  const existing = edit.id === undefined ? undefined : s.zones.find((z) => z.id === edit.id);
  if (edit.id !== undefined && existing === undefined) return refuse(`there is no zone ${edit.id}`);
  const n = frameOf(s, t).n;
  const onFrame = (k: number): boolean => {
    const { tx, ty } = keyTile(k);
    return tx < n && ty < n;
  };
  const id = existing?.id ?? s.zones.reduce((m, z) => Math.max(m, z.id), 0) + 1;
  const add = new Set((edit.add ?? []).filter(onFrame));
  const remove = new Set(edit.remove ?? []);
  const tiles = new Set(existing?.tiles ?? []);
  for (const k of add) tiles.add(k);
  for (const k of remove) tiles.delete(k);
  const zone: Zone = {
    id,
    name: name ?? existing?.name ?? `Zone ${id}`,
    colour: (edit.colour ?? existing?.colour ?? ZONE_COLOURS[(id - 1) % ZONE_COLOURS.length]!).toLowerCase(),
    tiles: [...tiles].sort((a, b) => a - b),
  };
  const others = s.zones.filter((z) => z.id !== id).map((z) => (add.size === 0 ? z : { ...z, tiles: z.tiles.filter((k) => !add.has(k)) }));
  const zones = [...others, zone].sort((a, b) => a.id - b.id);
  return { state: withSettlement(state, settlementId, { ...s, zones }), ok: true, reason: null, zone: id };
}

/** The colours new zones take in turn. */
export const ZONE_COLOURS: readonly string[] = ["#4f9dde", "#e0a33b", "#5fbf6a", "#c46ad6", "#e0605a", "#48c2b5", "#d6c24a", "#8a8fe8"];

export function deleteZone(state: SimState, settlementId: string, zoneId: number): PlaceOutcome {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}` };
  if (!s.zones.some((z) => z.id === zoneId)) return { state, ok: false, reason: `there is no zone ${zoneId}` };
  return { state: withSettlement(state, settlementId, { ...s, zones: s.zones.filter((z) => z.id !== zoneId) }), ok: true, reason: null };
}

/**
 * Level a whole zone (the user: "assign robots to flatten out an entire zone
 * without me manually clicking each"): every tile of it that is not level
 * and has no building joins the rovers' queue; a rover goes out to the next
 * whenever one is free. Returns how many tiles were queued.
 */
export function levelZone(state: SimState, settlementId: string, zoneId: number, t: Tuning): PlaceOutcome & { readonly queued: number } {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}`, queued: 0 };
  const zone = s.zones.find((z) => z.id === zoneId);
  if (zone === undefined) return { state, ok: false, reason: `there is no zone ${zoneId}`, queued: 0 };
  // One plane for the whole zone: its tiles' mean height, to ten centimetres.
  // (Tile by tile to the level beside each, three rovers out at once each took
  // a different level, and the zone came out stepped - 1.7 m, measured.)
  const ground = siteGround(s, t);
  const n = ground.tiles;
  const heights = zone.tiles.map((k) => ground.heightM[Math.floor(k / TILE_STRIDE) * n + (k % TILE_STRIDE)] ?? 0);
  const mean = heights.reduce((a, b) => a + b, 0) / Math.max(1, heights.length);
  const levelM = Math.round(mean * 10) / 10 || 0;
  const queued = new Set(s.levelQueue.map((q) => q.tile));
  const busy = new Set(s.jobs.filter((j) => j.kind === "rover").map((j) => j.tile));
  const add = zone.tiles.filter((k) => {
    if (queued.has(k) || busy.has(k)) return false;
    const { tx, ty } = keyTile(k);
    return levelJob(s, tx, ty, t, levelM).job !== null;
  });
  if (add.length === 0) return { state, ok: false, reason: "every tile of it is level, built on, or waiting already", queued: 0 };
  return { state: withSettlement(state, settlementId, { ...s, levelQueue: [...s.levelQueue, ...add.map((tile) => ({ tile, levelM }))] }), ok: true, reason: null, queued: add.length };
}

/**
 * Draw corridors, cables or rails in the planner (the user: "I can draw roads
 * and power lines, and they get built"): the tiles join the plan, in the
 * order drawn, and crews lay them as materials allow. Tiles that already
 * carry the layer, or are planned for it, are left out.
 */
export function planLinks(state: SimState, settlementId: string, layer: PlannedLink["layer"], tiles: readonly number[], t: Tuning): PlaceOutcome & { readonly planned: number } {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}`, planned: 0 };
  const has = keySet(s[layer]);
  const already = new Set(s.planned.filter((p) => p.layer === layer).map((p) => p.tile));
  const add: PlannedLink[] = [];
  for (const k of tiles) {
    if (has.has(k) || already.has(k)) continue;
    const { tx, ty } = keyTile(k);
    if (linkRefusal(s, layer, tx, ty, t) !== null) continue;
    already.add(k);
    add.push({ layer, tile: k });
  }
  if (add.length === 0) return { state, ok: false, reason: "nothing there can be laid", planned: 0 };
  return { state: withSettlement(state, settlementId, { ...s, planned: [...s.planned, ...add] }), ok: true, reason: null, planned: add.length };
}

/** Take up the plan: what is not yet built is not built. */
export function cancelPlans(state: SimState, settlementId: string): PlaceOutcome {
  const s = state.settlements.find((x) => x.id === settlementId);
  if (s === undefined) return { state, ok: false, reason: `there is no settlement ${settlementId}` };
  return { state: withSettlement(state, settlementId, { ...s, planned: [], levelQueue: [] }), ok: true, reason: null };
}

/**
 * The crews' substep: planned links laid in order, up to LINK_BUILD_PER_YEAR
 * a year, while materials last. One that can no longer be laid (a building
 * went up there) is dropped; one there are no materials for waits, and so do
 * those after it.
 */
function buildPlanned(s: Settlement, t: Tuning, h: number): Settlement {
  if (s.planned.length === 0) return s;
  const crews = Math.floor(t.LINK_BUILD_PER_YEAR * h);
  let materials = s.stores.materials;
  const lists: Record<PlannedLink["layer"], Set<number>> = { corridors: new Set(s.corridors), cables: new Set(s.cables), rails: new Set(s.rails) };
  let laid = 0;
  let k = 0;
  for (; k < s.planned.length && laid < crews; k += 1) {
    const p = s.planned[k]!;
    const { tx, ty } = keyTile(p.tile);
    if (lists[p.layer].has(p.tile) || linkRefusal(s, p.layer, tx, ty, t) !== null) continue;
    const cost = LAYER_WORDS[p.layer].cost(t);
    if (materials < cost) break;
    materials -= cost;
    lists[p.layer].add(p.tile);
    laid += 1;
  }
  const sorted = (set: Set<number>): number[] => [...set].sort((a, b) => a - b);
  return {
    ...s,
    stores: { ...s.stores, materials },
    corridors: lists.corridors.size === s.corridors.length ? s.corridors : sorted(lists.corridors),
    cables: lists.cables.size === s.cables.length ? s.cables : sorted(lists.cables),
    rails: lists.rails.size === s.rails.length ? s.rails : sorted(lists.rails),
    planned: s.planned.slice(k),
  };
}

/** The rover a queued tile would take: the job, or why none. */
function levelJob(s: Settlement, tx: number, ty: number, t: Tuning, to?: number): { job: SettlementJob | null; reason: string | null } {
  if (garage(s) === null) return { job: null, reason: "there is no headquarters to send a rover from" };
  if (!claimTest(s, t)(tx, ty)) return { job: null, reason: "that is off the grid - the land the city holds" };
  if (tilesUnder(s.buildings).has(tileKey(tx, ty))) return { job: null, reason: "a building stands there" };
  const key = tileKey(tx, ty);
  if (s.jobs.some((j) => j.kind === "rover" && j.tile === key)) return { job: null, reason: "a rover is already on its way there" };
  const ground = siteGround(s, t);
  const n = ground.tiles;
  const m = n + 1;
  const level = to ?? levelFor(s, tx, ty, t);
  const corners = [ground.cornersM[ty * m + tx]!, ground.cornersM[ty * m + tx + 1]!, ground.cornersM[(ty + 1) * m + tx]!, ground.cornersM[(ty + 1) * m + tx + 1]!];
  if (corners.every((c) => Math.abs(c - level) < 0.01)) return { job: null, reason: "the ground is already level there" };
  const rock: Rock = rocksOf(s, t)[ty * n + tx] ?? "none";
  const breaking = rock === "none" ? 0 : rock === "crag" ? t.ROVER_WORK_YEARS_CRAG : t.ROVER_WORK_YEARS_LOOSE;
  const work = t.ROVER_WORK_YEARS_LEVEL + breaking;
  const years = roverYears(s, tx, ty, "none", t) - t.ROVER_WORK_YEARS_LOOSE + work;
  const materials = rock === "crag" ? t.ROCK_CRAG_MATERIALS : rock === "loose" ? t.ROCK_LOOSE_MATERIALS : 0;
  return { job: { kind: "rover", tile: key, materials, work, total: years, remaining: years, levelM: level }, reason: null };
}

/** The level queue's substep: a rover out to the next tile whenever one is free. */
function sendLevellers(s: Settlement, t: Tuning): Settlement {
  if (s.levelQueue.length === 0) return s;
  let out = s;
  let k = 0;
  // A few tries a substep: a tile levelled meanwhile, or built on, is passed over.
  for (let tries = 0; k < s.levelQueue.length && tries < 64 && roversOut(out) < roverCount(out, t); tries += 1) {
    const q = s.levelQueue[k]!;
    const { tx, ty } = keyTile(q.tile);
    k += 1;
    const { job } = levelJob(out, tx, ty, t, q.levelM);
    if (job !== null) out = { ...out, jobs: [...out.jobs, job] };
  }
  return k === 0 ? s : { ...out, levelQueue: s.levelQueue.slice(k) };
}

/** A substep's worth of record: gathered, and every HISTORY_EVERY substeps a sample taken. */
function record(
  h: History,
  now: { births: number; deaths: number; short: readonly number[]; net: readonly number[]; stores: readonly number[]; population: number; housing: number },
  t: Tuning,
): History {
  const acc = {
    substeps: h.acc.substeps + 1,
    births: h.acc.births + now.births,
    deaths: h.acc.deaths + now.deaths,
    short: h.acc.short.map((v, i) => v + (now.short[i] ?? 0)),
    net: h.acc.net.map((v, i) => v + (now.net[i] ?? 0)),
  };
  if (acc.substeps < t.HISTORY_EVERY) return { ...h, acc };
  const k = acc.substeps;
  const sample = {
    index: h.taken,
    population: now.population,
    housing: now.housing,
    births: acc.births / k,
    deaths: acc.deaths / k,
    short: acc.short.map((v) => v / k),
    stores: [...now.stores],
    net: acc.net.map((v) => v / k),
  };
  const samples = [...h.samples, sample];
  return { acc: EMPTY_HISTORY.acc, taken: h.taken + 1, samples: samples.length > t.HISTORY_SAMPLES ? samples.slice(samples.length - t.HISTORY_SAMPLES) : samples };
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
  /** Credits a year its laboratories, observatories and forums earn this substep. */
  readonly research: number;
  /** Section 2.2: planetary CO2 this settlement asks to draw, mbar per year. */
  readonly planetaryCo2: number;
  /** What the operable buildings made and drew this substep, per year. Derived, never stored. */
  readonly production: Readonly<Record<MicroResource, number>>;
  readonly consumption: Readonly<Record<MicroResource, number>>;
  /** Every resource that ran short this substep, in `MICRO_RESOURCES` order: why buildings browned out. */
  readonly shortages: readonly MicroResource[];
  /** Batch 24: the flood as it stood this substep, or null with flooding off. Derived, never stored. */
  readonly flood: FloodReading | null;
  /** Parallel to `buildings`: why the network kept each from running, or null. All null with the network off. */
  readonly network: readonly (NetworkIssue | null)[];
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
/**
 * What a list of buildings is, building by building - each one's definition, level factor and type (as an index
 * into the types it has, in the order they first appear) - kept per list and tuning: the list only changes when
 * something is built, and made again every substep it was a third of a 40,000-building metropolis's step (measured).
 */
interface BuildingShape {
  readonly defs: readonly (typeof BUILDING_DEFS)[BuildingType][];
  readonly levels: readonly number[];
  readonly kindOf: Int32Array;
  readonly types: readonly BuildingType[];
}
const shapes = new WeakMap<readonly PlacedBuilding[], { t: Tuning; shape: BuildingShape }>();
function shapeOf(buildings: readonly PlacedBuilding[], t: Tuning): BuildingShape {
  const kept = shapes.get(buildings);
  if (kept !== undefined && kept.t === t) return kept.shape;
  const defs = buildings.map((b) => BUILDING_DEFS[b.type]);
  const levels = buildings.map((b) => levelFactor(b.level, t));
  const kinds = new Map<BuildingType, number>();
  const types: BuildingType[] = [];
  const kindOf = new Int32Array(defs.length);
  defs.forEach((def, i) => {
    let k = kinds.get(def.type);
    if (k === undefined) {
      k = types.length;
      kinds.set(def.type, k);
      types.push(def.type);
    }
    kindOf[i] = k;
  });
  const shape = { defs, levels, kindOf, types };
  shapes.set(buildings, { t, shape });
  return shape;
}

export function settlementStep(standing: Settlement, env: HabitatChannels, t: Tuning, h: number): SettlementStep {
  // Batch 24 - detail §4: the flood first. Its consequences are true state
  // (lost buildings, a lost settlement); whether a building stands in water
  // this substep is derived and only switches it off.
  const flood = t.FLOODING_ENABLED && standing.lostAtSeaLevelM === null ? floodReading(standing, env, t) : null;
  const s = flood === null ? standing : applyFlood(standing, flood, t);
  if (s.lostAtSeaLevelM !== null) {
    // A ruin: nothing runs, nothing grows, nothing reaches the planet.
    const none = { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 };
    return { next: s, operable: [], supported: false, planetaryCo2: 0, research: 0, production: none, consumption: none, shortages: [], flood, network: [] };
  }
  const { defs, levels, kindOf, types } = shapeOf(s.buildings, t);
  const building = constructing(s);
  // What a building of each type draws, makes, how well it runs and whether it may: asked once a type this
  // substep, not once a building (a metropolis has 40,000 buildings of 28 types).
  const kindDraw: Partial<Record<MicroResource, number>>[] = [];
  const kindMake: Partial<Record<MicroResource, number>>[] = [];
  const kindDrawRow: number[][] = [];
  const kindMakeRow: number[][] = [];
  const kindEff: number[] = [];
  const kindCan: boolean[] = [];
  for (const type of types) {
    const def = BUILDING_DEFS[type];
    const draw = def.consumes(t, env);
    const make = def.produces(t);
    kindDraw.push(draw);
    kindMake.push(make);
    kindDrawRow.push(MICRO_RESOURCES.map((r) => draw[r] ?? 0));
    kindMakeRow.push(MICRO_RESOURCES.map((r) => make[r] ?? 0));
    kindEff.push(def.efficiency(env, t));
    kindCan.push(def.canOperate(env, t));
  }
  // A building with water over any tile of its footprint is offline (detail §4.3); one still going up is not running yet.
  const operable = defs.map((_, i) => kindCan[kindOf[i]!]! && !(flood !== null && submerged(s.buildings[i]!, flood)) && !building.has(tileKey(s.buildings[i]!.tx, s.buildings[i]!.ty)));
  // Section 6's networks: with them off, every building on the grid is on them.
  const n = frameOf(s, t).n;
  // Railways join the districts round the stations they link.
  const network = t.NETWORK_ENABLED
    ? { corridors: withRails(networkOf(s.buildings, s.corridors, n), s.buildings, s.rails, n), cables: withRails(networkOf(s.buildings, s.cables, n), s.buildings, s.rails, n) }
    : null;
  const draws = defs.map((_, i) => kindDraw[kindOf[i]!]!);
  const makes = defs.map((_, i) => kindMake[kindOf[i]!]!);
  const issues: (NetworkIssue | null)[] = defs.map(() => null);
  const connect = (): void => {
    if (network !== null) while (applyNetwork(network, draws, makes, operable, issues));
  };

  // The Industrial Command Center: facilities in the square about a running one make COMMAND_BOOST more (not stacked).
  // Which command centers' squares each building stands in: geometry, kept per building list and tuning.
  const cover = commandCover(s.buildings, t);
  const commandBoost = (i: number): number => {
    const list = cover[i];
    if (list === undefined) return 1;
    for (const c of list) if (operable[c]) return 1 + t.COMMAND_BOOST;
    return 1;
  };

  const totals = (): { prod: Record<MicroResource, number>; cons: Record<MicroResource, number> } => {
    // From what each type draws and makes, found once this substep (asked afresh
    // for every building on every pass, it was a third of a metropolis's substep),
    // as rows in MICRO_RESOURCES order, summed in the same order as ever.
    let p0 = 0, p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    let c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0;
    for (let i = 0; i < defs.length; i += 1) {
      if (!operable[i]) continue;
      const k = kindOf[i]!;
      const eff = kindEff[k]! * levels[i]! * commandBoost(i);
      const p = kindMakeRow[k]!;
      const c = kindDrawRow[k]!;
      p0 += p[0]! * eff;
      p1 += p[1]! * eff;
      p2 += p[2]! * eff;
      p3 += p[3]! * eff;
      p4 += p[4]! * eff;
      c0 += c[0]!;
      c1 += c[1]!;
      c2 += c[2]!;
      c3 += c[3]!;
      c4 += c[4]!;
    }
    return { prod: { power: p0, water: p1, oxygen: p2, food: p3, materials: p4 }, cons: { power: c0, water: c1, oxygen: c2, food: c3, materials: c4 } };
  };

  // Which life-support resources ran short at any point this substep. Their
  // consumers browned out - including the domes - so the stores may never
  // actually reach zero, which is why section 7.2's stress is tracked here and
  // not read off the stores alone (see `supported` below).
  const shortLife = new Set<MicroResource>();
  const shortAny = new Set<MicroResource>();
  // Each pass switches at least one building off or ends the loop.
  // The totals of the last pass, while nothing has changed since (so they need not be summed again after it).
  let settled: ReturnType<typeof totals> | null = null;
  for (let pass = 0; pass <= MICRO_RESOURCES.length + defs.length; pass += 1) {
    connect();
    settled = totals();
    const { prod, cons } = settled;
    const short = MICRO_RESOURCES.filter((r) => s.stores[r] + (prod[r] - cons[r]) * h < 0);
    if (short.length === 0) break;
    for (const r of short) {
      shortAny.add(r);
      if (LIFE_SUPPORT.includes(r)) shortLife.add(r);
    }
    let changed = false;
    defs.forEach((def, i) => {
      if (!operable[i]) return;
      const c = draws[i]!;
      if (short.some((r) => (c[r] ?? 0) > 0)) {
        operable[i] = false;
        changed = true;
      }
    });
    if (!changed) break;
    settled = null;
  }

  const { prod, cons } = settled ?? totals();
  const cap = capacities(s, t);
  const stores = { ...s.stores };
  for (const r of MICRO_RESOURCES) stores[r] = Math.min(cap[r], Math.max(0, s.stores[r] + (prod[r] - cons[r]) * h));

  // Rovers and rockets: each counts down by this substep; what comes home
  // lands in the stores, up to their room (the user: "if there is 140/150,
  // there are just 10 to get").
  const jobs: SettlementJob[] = [];
  let cleared = s.cleared;
  let grades = s.grades;
  let built = s.buildings;
  for (const job of s.jobs) {
    const remaining = job.remaining - h;
    if (remaining > 1e-9) {
      jobs.push({ ...job, remaining });
      continue;
    }
    if (job.kind === "build") {
      // Home: a new building has stood since the work was done; an upgrade takes its level now.
      if (job.upgrade) built = built.map((b) => (tileKey(b.tx, b.ty) === job.tile ? { ...b, level: Math.min(maxLevel(b.type, t), b.level + 1) } : b));
      continue;
    }
    const brought = job.kind === "rover" ? job.materials : t.ROCKET_MATERIALS;
    stores.materials = Math.min(cap.materials, stores.materials + brought);
    if (job.kind === "rover" && !cleared.includes(job.tile)) cleared = [...cleared, job.tile].sort((a, b) => a - b);
    if (job.kind === "rover" && job.levelM !== undefined) grades = [...grades, { tile: job.tile, heightM: job.levelM }];
  }

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
  let birthsNow = 0;
  let deathsNow = 0;
  if (isCityKind(s.kind)) {
    const home = housing(s, t);
    // The first settlers arrive once there is somewhere to live and every need is met.
    if (supported && home > 0) population = Math.max(population, Math.min(home, t.MICRO_SEED_POPULATION));
    // A running Research Forum: people are drawn to the city.
    const forum = defs.some((def, i) => operable[i] && def.type === "research_forum") ? 1 + t.FORUM_GROWTH_BONUS : 1;
    const growth = home > 0 ? t.MICRO_GROWTH_RATE * forum * population * (1 - population / home) * (supported ? 1 : 0) : 0;
    // Medical Centers (at the user's request: "avoids that people die when
    // there is a scarcity of oxygen or food, as people find shelter here"):
    // while oxygen or food alone runs short, the people they shelter do not
    // decline. Short of power or water, the centers cannot save anyone.
    const onlyAir = shortLife.size > 0 && [...shortLife].every((r) => r === "oxygen" || r === "food");
    let shelter = 0;
    if (onlyAir) defs.forEach((def, i) => {
      if (operable[i] && def.type === "medical_center") shelter += t.MEDICAL_SHELTER * levels[i]!;
    });
    const decline = t.MICRO_DECLINE_RATE * Math.max(0, population - shelter) * (supported ? 0 : 1);
    birthsNow = growth;
    deathsNow = decline;
    population = Math.min(home, Math.max(0, population + (growth - decline) * h));
  }

  let planetaryCo2 = 0;
  let research = 0;
  // A type's own numbers, once a type (asked of every building, they were a sixth of the step).
  const kindCo2 = types.map((type) => BUILDING_DEFS[type].planetaryCo2(t));
  const kindResearch = types.map((type) => BUILDING_DEFS[type].research(t));
  for (let i = 0; i < defs.length; i += 1) {
    if (!operable[i]) continue;
    const k = kindOf[i]!;
    planetaryCo2 += kindCo2[k]! * kindEff[k]! * levels[i]!;
    research += kindResearch[k]! * levels[i]! * commandBoost(i);
  }

  // The planner's work: drawn links built, zones levelled - and the record kept.
  let next: Settlement = { ...s, stores, population, jobs, cleared, grades, buildings: built };
  next = buildPlanned(next, t, h);
  next = sendLevellers(next, t);
  next = { ...next, history: record(s.history, { births: birthsNow, deaths: deathsNow, short: MICRO_RESOURCES.map((r) => (shortAny.has(r) ? 1 : 0)), net: MICRO_RESOURCES.map((r) => prod[r] - cons[r]), stores: MICRO_RESOURCES.map((r) => next.stores[r]), population: next.population, housing: isCityKind(s.kind) ? housing(next, t) : 0 }, t) };
  return { next, research, operable, supported, planetaryCo2, production: prod, consumption: cons, shortages: MICRO_RESOURCES.filter((r) => shortAny.has(r)), flood, network: issues };
}
