/**
 * The city view's contract (Batch 20): everything the 2.5D renderer may know
 * about a settlement, and nothing else - the city's `VisualChannels`.
 *
 * Micro §8: "Aliveness is render-time, driven by state ... All read from the
 * settlement state; none of it is stored or simulated." So what is here is
 * derived, on demand, from the stored settlement plus the planet as the city
 * sees it (`HabitatChannels`). Which buildings run, and how hard, comes from
 * the SAME `settlementStep` the simulation takes next, so the picture can never
 * show a building running that the sim has browned out.
 */

import type { HabitatChannels } from "../habitat.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, Grade, MicroResource, Settlement, SettlementKind } from "../types.js";
import { MICRO_RESOURCES } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { capacities, claimableChunks, claimsAllowed, constructionOf, housing, nextClaimAt, settlementStep } from "./settlement.js";
import { siteElevation } from "../hypsometry.js";
import type { FloodState } from "./flood.js";
import { submerged } from "./flood.js";
import type { NetworkIssue } from "./network.js";
import { linkGrid } from "./network.js";
import type { Rock } from "./rocks.js";
import { garage, prepareRocks, rocksOf, siteGround } from "./rocks.js";
import { claimTest, frameOf, keyTile, tileKey } from "./space.js";
import type { World } from "./terrain.js";
import { worldOf } from "./terrain.js";

export interface CityBuildingView {
  /** Index into the settlement's `buildings`. */
  readonly index: number;
  readonly type: BuildingType;
  readonly tx: number;
  readonly ty: number;
  /** Footprint along x, tiles. */
  readonly size: number;
  /** Footprint along y, tiles, where it differs from `size` (a station is 4 x 6). */
  readonly depth?: number;
  /** Running this substep (section 7.1 and 7.2). */
  readonly operable: boolean;
  /** Height the building stands at, in tiles: the highest ground under its footprint (Batch 22). */
  readonly baseZ: number;
  /** Batch 24: water over some tile of its footprint - offline for that reason. */
  readonly submerged: boolean;
  /** Why the network keeps it from running (not connected to what it needs), or null. */
  readonly network: NetworkIssue | null;
  /** Its level, 1 up (at the user's request). */
  readonly level?: number;
  /** Still going up: how far its rover's work is, 0..1; absent or null once built. */
  readonly construction?: number | null;
  /**
   * How hard it is working, 0..1, for the aliveness layer. A power plant's is
   * the share of the settlement's power being drawn ("reactor core brightness
   * = load"); a dome's is how full it is; anything else running is 1. Zero
   * when not operable.
   */
  readonly activity: number;
}

export interface CityView {
  readonly id: string;
  readonly kind: SettlementKind;
  /** Grid edge, tiles: the frame round the founding square and every claim. */
  readonly tiles: number;
  /**
   * Where the grid's tile (0, 0) lies from the founding square's corner. A
   * claim west or north moves it - and every tile index with it - so a host
   * keeping a camera on the ground moves the camera by the change.
   */
  readonly origin: { readonly x: number; readonly y: number };
  /** Row-major: the tiles the city holds - its founding square and its claims - where it may build. */
  readonly claimed: readonly boolean[];
  /** Claiming land (at the user's request). */
  readonly claims: CityClaimsView;
  /**
   * Row-major (`ty * tiles + tx`): each tile's ground height in TILES (metres
   * over `TILE_METRES`), the unit the renderer draws height in. Batch 22.
   */
  readonly groundZ: readonly number[];
  /**
   * Row-major (`y * (tiles + 1) + x`): the height at every tile CORNER, in
   * tiles - what the ground is drawn through, so it is smooth, not steps.
   */
  readonly corners: readonly number[];
  /**
   * The open world round the grid (at the user's request): `margin` tiles of
   * it on every side, its corner heights in tiles (corner (0, 0) is the
   * grid's (-margin, -margin)), and the mouths of its caves in grid tiles.
   */
  readonly world: {
    readonly margin: number;
    readonly size: number;
    readonly corners: readonly number[];
    readonly caves: readonly { readonly x: number; readonly y: number; readonly dx: number; readonly dy: number }[];
    /** The world's heights every half tile, in tiles: (2 * size + 1) a side. Absent, the ground is drawn through `corners` alone. */
    readonly fine?: readonly number[];
    /** Rocks on the world's tiles outside the grid, in grid tiles. */
    readonly rocks: readonly { readonly x: number; readonly y: number; readonly kind: "loose" | "crag" }[];
  };
  /** 0..1: how green the planet's land is - the ground greens with it. */
  readonly greenery: number;
  /** Row-major: the same heights in metres, relative to `baseElevationM` - for the words. */
  readonly heightM: readonly number[];
  /** Row-major: too steep to build on (section 3.3's blocked terrain, detail §1.3). */
  readonly steep: readonly boolean[];
  /** The settlement's elevation on the planet, metres against the areoid (detail §1.1). */
  readonly baseElevationM: number;
  readonly buildings: readonly CityBuildingView[];
  readonly population: number;
  readonly housing: number;
  /** Every life-support need met this substep (section 7.3). */
  readonly supported: boolean;
  readonly stores: Readonly<Record<MicroResource, number>>;
  readonly capacities: Readonly<Record<MicroResource, number>>;
  /** Production minus consumption, per sim-year, this substep. */
  readonly net: Readonly<Record<MicroResource, number>>;
  /** The resources that ran short this substep - why a building browned out. */
  readonly shortages: readonly MicroResource[];
  /** Batch 24: row-major, the tiles under water this substep. All false with flooding off or no sea. */
  readonly wet: readonly boolean[];
  /** Detail §4.3's state: dry, warning, partial or flooded. */
  readonly floodState: FloodState;
  /** The sea above (+) or below (-) the settlement's base, metres, or null with no sea. */
  readonly floodDepthM: number | null;
  /** Null while it stands; the sea level it was lost at. */
  readonly lostAtSeaLevelM: number | null;
  /** Row-major: the tiles that carry a corridor (water, oxygen, food, materials). */
  readonly corridors: readonly boolean[];
  /** Row-major: the tiles that carry a power cable. */
  readonly cables: readonly boolean[];
  /** Row-major: the tiles that carry a railway. */
  readonly rails?: readonly boolean[];
  /** Row-major: the rock on each tile that a rover could break. */
  readonly rocks: readonly Rock[];
  /** Where rovers set out from: the headquarters' middle, in tiles, or null without one. */
  readonly garage: { readonly x: number; readonly y: number } | null;
  /** Rovers and rockets under way: where to, and how far through, in sim-years. */
  readonly jobs: readonly CityJobView[];
}

export interface CityClaimsView {
  /** A chunk's edge, tiles. */
  readonly chunk: number;
  /** Chunks claimed beyond the founding square. */
  readonly held: number;
  /** Chunks its people allow it to have claimed. */
  readonly allowed: number;
  /** The people the next claim waits for; null for a settlement that cannot claim (an outpost). */
  readonly nextAt: number | null;
  /** The chunks beside its land it could claim, each as the grid tile of its corner (may lie off the grid, in the world). */
  readonly open: readonly { readonly i: number; readonly j: number; readonly tx: number; readonly ty: number }[];
}

export interface CityJobView {
  readonly kind: "rover" | "rocket";
  /** The rock a rover is breaking, or the spaceport's corner. */
  readonly tx: number;
  readonly ty: number;
  readonly total: number;
  readonly remaining: number;
  /** A rover's time at the rock, within `total`; 0 for a rocket. */
  readonly work: number;
}

const POWER_PLANTS: ReadonlySet<BuildingType> = new Set<BuildingType>(["solar_array", "geothermal_plant", "reactor"]);

/**
 * The world in tiles, kept with the world it was made from: a view is
 * derived five times a second, and a metropolis's world has 590,000 fine
 * samples to convert.
 */
const worldsInTiles = new WeakMap<World, CityView["world"]>();

/**
 * The world with the settlement's levelled tiles set to their level: its
 * corners, and the half-tile samples the ground is drawn through up close
 * (the grid's own corners come from `siteGround`). Kept per world and grade
 * list.
 */
const gradedWorlds = new WeakMap<CityView["world"], { grades: readonly Grade[]; out: CityView["world"] }>();

function withGrades(w: CityView["world"], grades: readonly Grade[], t: Tuning): CityView["world"] {
  if (grades.length === 0) return w;
  const kept = gradedWorlds.get(w);
  if (kept !== undefined && kept.grades === grades) return kept.out;
  const corners = [...w.corners];
  const fine = w.fine === undefined ? undefined : [...w.fine];
  const m = w.size + 1;
  const f = 2 * w.size + 1;
  for (const g of grades) {
    const { tx, ty } = keyTile(g.tile);
    const x = tx + w.margin;
    const y = ty + w.margin;
    if (x >= w.size || y >= w.size) continue;
    const h = g.heightM / t.TILE_METRES;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) corners[(y + dy) * m + x + dx] = h;
    if (fine !== undefined) for (let j = 0; j <= 2; j += 1) for (let i = 0; i <= 2; i += 1) fine[(2 * y + j) * f + 2 * x + i] = h;
  }
  const out = { ...w, corners, ...(fine === undefined ? {} : { fine }) };
  gradedWorlds.set(w, { grades, out });
  return out;
}

function worldInTiles(world: World, t: Tuning): CityView["world"] {
  const kept = worldsInTiles.get(world);
  if (kept !== undefined && kept.corners.length === world.cornersM.length) return kept;
  const made = { margin: world.margin, size: world.size, corners: world.cornersM.map((h) => h / t.TILE_METRES), fine: world.fineM.map((h) => h / t.TILE_METRES), caves: world.caves, rocks: world.rocks };
  worldsInTiles.set(world, made);
  return made;
}

/**
 * The per-tile lists a view carries, kept per what they are made from (all
 * immutable): rebuilt for every view, a metropolis's million tiles cost
 * 0.42 s a view, several times a second (measured). The same lists also let
 * the renderer see nothing has changed.
 */
const perTile = new WeakMap<object, { n: number; t: Tuning; also: unknown; value: unknown }>();
function kept<T>(from: object, n: number, t: Tuning, also: unknown, make: () => T): T {
  const hit = perTile.get(from);
  if (hit !== undefined && hit.n === n && hit.t === t && hit.also === also) return hit.value as T;
  const value = make();
  perTile.set(from, { n, t, also, value });
  return value;
}
const dry = new Map<number, readonly boolean[]>();

/**
 * Everything slow a city's first view needs, made a little at a time,
 * yielding how far through it is, 0 to 1 - its ground and world a row of
 * heights at a time, its rocks a row of tiles at a time, then the lists the
 * view carries - kept where `cityView` looks for them. (Made in one go, a
 * metropolis's froze the browser for seconds as it opened, measured.)
 */
export function* prepareCity(s: Settlement, t: Tuning): Generator<number, void> {
  for (const f of prepareRocks(s, t)) yield 0.75 * f;
  const world = worldOf(s, t);
  const had = worldsInTiles.get(world);
  if (had === undefined || had.corners.length !== world.cornersM.length) {
    const corners = world.cornersM.map((h) => h / t.TILE_METRES);
    yield 0.77;
    const fine = new Array<number>(world.fineM.length);
    const f = 2 * world.size + 1;
    for (let y = 0; y < f; y += 1) {
      for (let x = 0; x < f; x += 1) fine[y * f + x] = world.fineM[y * f + x]! / t.TILE_METRES;
      if (y % 64 === 63) yield 0.77 + (0.1 * y) / f;
    }
    worldsInTiles.set(world, { margin: world.margin, size: world.size, corners, fine, caves: world.caves, rocks: world.rocks });
  }
  const ground = siteGround(s, t);
  const n = ground.tiles;
  const hit = perTile.get(ground);
  if (hit === undefined || hit.n !== n || hit.t !== t || hit.also !== s.claims) {
    const ours = claimTest(s, t);
    const out = new Array<boolean>(n * n);
    for (let ty = 0; ty < n; ty += 1) {
      for (let tx = 0; tx < n; tx += 1) out[ty * n + tx] = ours(tx, ty);
      if (ty % 64 === 63) yield 0.87 + (0.08 * ty) / n;
    }
    perTile.set(ground, { n, t, also: s.claims, value: out });
  }
  for (const list of [s.corridors, s.cables, s.rails]) {
    kept(list, n, t, null, () => Array.from(linkGrid(list, n), (r) => r === 1));
    yield 0.96;
  }
  kept(ground.heightM, n, t, null, () => ground.heightM.map((h) => h / t.TILE_METRES));
  kept(ground.cornersM, n, t, null, () => ground.cornersM.map((h) => h / t.TILE_METRES));
  yield 1;
}

export function cityView(s: Settlement, env: HabitatChannels, t: Tuning): CityView {
  const step = settlementStep(s, env, t, t.SUBSTEP_YEARS);
  const home = housing(s, t);
  const powerLoad = step.production.power > 0 ? Math.min(1, step.consumption.power / step.production.power) : 0;
  const occupancy = home > 0 ? Math.min(1, s.population / home) : 0;
  const net = {} as Record<MicroResource, number>;
  for (const r of MICRO_RESOURCES) net[r] = step.production[r] - step.consumption[r];
  // The ground as the rovers have left it: a broken crag is buildable ground.
  const ground = siteGround(s, t);
  const groundZ = kept(ground.heightM, ground.tiles, t, null, () => ground.heightM.map((h) => h / t.TILE_METRES));
  const world = worldOf(s, t);
  const n = ground.tiles;
  const frame = frameOf(s, t);
  const ours = claimTest(s, t);
  const claimed = kept(ground, n, t, s.claims, () => {
    const out = new Array<boolean>(n * n);
    for (let ty = 0; ty < n; ty += 1) for (let tx = 0; tx < n; tx += 1) out[ty * n + tx] = ours(tx, ty);
    return out;
  });
  const grid = (list: readonly number[]): boolean[] => kept(list, n, t, null, () => Array.from(linkGrid(list, n), (r) => r === 1));
  let wet = dry.get(n);
  if (wet === undefined) {
    wet = new Array<boolean>(n * n).fill(false);
    dry.set(n, wet);
  }
  const chunk = t.CLAIM_CHUNK_TILES;
  const building = constructionOf(s);
  // Where each building stands: the highest corner under it - kept per building list and ground.
  const bases = kept(s.buildings, n, t, ground, () =>
    s.buildings.map((b) => {
      let baseZ = -Infinity;
      for (let y = b.ty; y <= b.ty + BUILDING_DEFS[b.type].depth; y += 1) {
        for (let x = b.tx; x <= b.tx + BUILDING_DEFS[b.type].footprint; x += 1) {
          // A building kept from an old save may stand partly off a shrunk grid.
          if (x >= 0 && y >= 0 && x <= n && y <= n) baseZ = Math.max(baseZ, (ground.cornersM[y * (n + 1) + x] ?? 0) / t.TILE_METRES);
        }
      }
      return baseZ;
    }),
  );
  return {
    id: s.id,
    kind: s.kind,
    tiles: n,
    origin: { x: frame.x0, y: frame.y0 },
    claimed,
    claims: {
      chunk,
      held: s.claims.length,
      allowed: claimsAllowed(s.population, t),
      nextAt: nextClaimAt(s, t),
      open: claimableChunks(s, t).map(({ i, j }) => ({ i, j, tx: i * chunk - frame.x0, ty: j * chunk - frame.y0 })),
    },
    groundZ,
    corners: kept(ground.cornersM, n, t, null, () => ground.cornersM.map((h) => h / t.TILE_METRES)),
    world: withGrades(worldInTiles(world, t), s.grades, t),
    greenery: env.greenery,
    heightM: ground.heightM,
    steep: ground.steep,
    baseElevationM: siteElevation(s.lat, s.lon, t),
    buildings: s.buildings.map((b, index) => {
      const operable = step.operable[index] === true;
      const activity = !operable
        ? 0
        : POWER_PLANTS.has(b.type)
          ? powerLoad
          : b.type === "habitat_dome"
            ? occupancy
            : 1;
      const size = BUILDING_DEFS[b.type].footprint;
      const depth = BUILDING_DEFS[b.type].depth;
      // It stands at the highest corner under it; on a slope, a foundation
      // fills down to the ground (the user: "building on a slope builds
      // concrete foundations under it").
      const baseZ = bases[index]!;
      const drowned = step.flood !== null && submerged(b, step.flood);
      return { index, type: b.type, tx: b.tx, ty: b.ty, size, ...(depth === size ? {} : { depth }), operable, activity, baseZ: Number.isFinite(baseZ) ? baseZ : 0, submerged: drowned, network: step.network[index] ?? null, level: b.level, construction: building.get(tileKey(b.tx, b.ty)) ?? null };
    }),
    population: s.population,
    housing: home,
    supported: step.supported,
    stores: s.stores,
    capacities: capacities(s, t),
    net,
    shortages: step.shortages,
    wet: step.flood?.wet ?? wet,
    floodState: s.lostAtSeaLevelM !== null ? "flooded" : step.flood?.state ?? "dry",
    floodDepthM: step.flood?.depthM ?? null,
    lostAtSeaLevelM: s.lostAtSeaLevelM,
    corridors: grid(s.corridors),
    cables: grid(s.cables),
    rails: grid(s.rails),
    rocks: rocksOf(s, t),
    garage: garage(s),
    // A rover building is drawn as any rover at work: out, at the site, and back.
    jobs: s.jobs.map((j) => ({ kind: j.kind === "rocket" ? ("rocket" as const) : ("rover" as const), ...keyTile(j.tile), total: j.total, remaining: j.remaining, work: j.kind === "rocket" ? 0 : j.work })),
  };
}
