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
import type { BuildingType, MicroResource, Settlement, SettlementKind } from "../types.js";
import { MICRO_RESOURCES } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { capacities, housing, settlementStep } from "./settlement.js";
import { siteElevation } from "../hypsometry.js";
import type { FloodState } from "./flood.js";
import { submerged } from "./flood.js";
import type { NetworkIssue } from "./network.js";
import { linkGrid } from "./network.js";
import type { Rock } from "./rocks.js";
import { garage, rocksOf, siteGround } from "./rocks.js";
import { keyTile } from "./space.js";

export interface CityBuildingView {
  /** Index into the settlement's `buildings`. */
  readonly index: number;
  readonly type: BuildingType;
  readonly tx: number;
  readonly ty: number;
  /** Footprint edge, tiles. */
  readonly size: number;
  /** Running this substep (section 7.1 and 7.2). */
  readonly operable: boolean;
  /** Height the building stands at, in tiles: the highest ground under its footprint (Batch 22). */
  readonly baseZ: number;
  /** Batch 24: water over some tile of its footprint - offline for that reason. */
  readonly submerged: boolean;
  /** Why the network keeps it from running (not connected to what it needs), or null. */
  readonly network: NetworkIssue | null;
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
  /** Grid edge, tiles. */
  readonly tiles: number;
  /**
   * Row-major (`ty * tiles + tx`): each tile's ground height in TILES (metres
   * over `TILE_METRES`), the unit the renderer draws height in. Batch 22.
   */
  readonly groundZ: readonly number[];
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
  /** Row-major: the rock on each tile that a rover could break. */
  readonly rocks: readonly Rock[];
  /** Where rovers set out from: the headquarters' middle, in tiles, or null without one. */
  readonly garage: { readonly x: number; readonly y: number } | null;
  /** Rovers and rockets under way: where to, and how far through, in sim-years. */
  readonly jobs: readonly CityJobView[];
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

export function cityView(s: Settlement, env: HabitatChannels, t: Tuning): CityView {
  const step = settlementStep(s, env, t, t.SUBSTEP_YEARS);
  const home = housing(s, t);
  const powerLoad = step.production.power > 0 ? Math.min(1, step.consumption.power / step.production.power) : 0;
  const occupancy = home > 0 ? Math.min(1, s.population / home) : 0;
  const net = {} as Record<MicroResource, number>;
  for (const r of MICRO_RESOURCES) net[r] = step.production[r] - step.consumption[r];
  // The ground as the rovers have left it: a broken crag is buildable ground.
  const ground = siteGround(s, t);
  const groundZ = ground.heightM.map((h) => h / t.TILE_METRES);
  const n = ground.tiles;
  return {
    id: s.id,
    kind: s.kind,
    tiles: n,
    groundZ,
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
      let baseZ = -Infinity;
      for (let y = b.ty; y < b.ty + size; y += 1) {
        for (let x = b.tx; x < b.tx + size; x += 1) {
          // A building kept from an old save may stand partly off a shrunk grid.
          if (x >= 0 && y >= 0 && x < n && y < n) baseZ = Math.max(baseZ, groundZ[y * n + x] ?? 0);
        }
      }
      const drowned = step.flood !== null && submerged(b, step.flood);
      return { index, type: b.type, tx: b.tx, ty: b.ty, size, operable, activity, baseZ: Number.isFinite(baseZ) ? baseZ : 0, submerged: drowned, network: step.network[index] ?? null };
    }),
    population: s.population,
    housing: home,
    supported: step.supported,
    stores: s.stores,
    capacities: capacities(s, t),
    net,
    shortages: step.shortages,
    wet: step.flood?.wet ?? new Array<boolean>(n * n).fill(false),
    floodState: s.lostAtSeaLevelM !== null ? "flooded" : step.flood?.state ?? "dry",
    floodDepthM: step.flood?.depthM ?? null,
    lostAtSeaLevelM: s.lostAtSeaLevelM,
    corridors: Array.from(linkGrid(s.corridors, n), (r) => r === 1),
    cables: Array.from(linkGrid(s.cables, n), (r) => r === 1),
    rocks: rocksOf(s, t),
    garage: garage(s),
    jobs: s.jobs.map((j) => ({ kind: j.kind, ...keyTile(j.tile), total: j.total, remaining: j.remaining, work: j.kind === "rover" ? j.work : 0 })),
  };
}
