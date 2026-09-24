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
import { groundOf } from "./terrain.js";

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
  /** Row-major (`ty * tiles + tx`): rough ground (section 3.3's blocked terrain). */
  readonly rough: readonly boolean[];
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
}

const POWER_PLANTS: ReadonlySet<BuildingType> = new Set<BuildingType>(["solar_array", "geothermal_plant", "reactor"]);

export function cityView(s: Settlement, env: HabitatChannels, t: Tuning): CityView {
  const step = settlementStep(s, env, t, t.SUBSTEP_YEARS);
  const home = housing(s, t);
  const powerLoad = step.production.power > 0 ? Math.min(1, step.consumption.power / step.production.power) : 0;
  const occupancy = home > 0 ? Math.min(1, s.population / home) : 0;
  const net = {} as Record<MicroResource, number>;
  for (const r of MICRO_RESOURCES) net[r] = step.production[r] - step.consumption[r];
  const ground = groundOf(s, t);
  return {
    id: s.id,
    kind: s.kind,
    tiles: ground.tiles,
    rough: ground.rough,
    buildings: s.buildings.map((b, index) => {
      const operable = step.operable[index] === true;
      const activity = !operable
        ? 0
        : POWER_PLANTS.has(b.type)
          ? powerLoad
          : b.type === "habitat_dome"
            ? occupancy
            : 1;
      return { index, type: b.type, tx: b.tx, ty: b.ty, size: BUILDING_DEFS[b.type].footprint, operable, activity };
    }),
    population: s.population,
    housing: home,
    supported: step.supported,
    stores: s.stores,
    capacities: capacities(s, t),
    net,
    shortages: step.shortages,
  };
}
