/**
 * Micro doc §5 - the ten buildings, as data.
 *
 * Each says what it costs, its footprint, what it draws and makes per sim-year,
 * what it pushes into the planet (only the Atmosphere Processor, section 2.2),
 * and how the planet gates and scales it (section 2.1: `canOperate` and
 * `efficiency`). The planet is seen ONLY through `HabitatChannels` - the city
 * layer's wall since Batch 9.
 *
 * Every number comes from the tuning, so invariant #4 holds and a balance
 * sweep can reach any of them.
 */

import type { HabitatChannels } from "../habitat.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, MicroResource, SettlementKind } from "../types.js";

export type ResourceRates = Partial<Record<MicroResource, number>>;

export interface BuildingDef {
  readonly type: BuildingType;
  readonly name: string;
  /** What it is, in the player's words. */
  readonly summary: string;
  readonly footprint: 1 | 2 | 3 | 5;
  /** Whether a player may place it. The headquarters is founded, never built. */
  readonly buildable: boolean;
  /** Which kinds of settlement may build it. Outposts carry no population (section 4.2). */
  readonly kinds: readonly SettlementKind[];
  readonly cost: (t: Tuning) => number;
  /** Drawn per year while operable, before `efficiency`. */
  readonly consumes: (t: Tuning, env: HabitatChannels) => ResourceRates;
  /** Made per year while operable, before `efficiency`. */
  readonly produces: (t: Tuning) => ResourceRates;
  /** People housed. Counts whether or not the dome is operable: a browned-out home is still a home. */
  readonly housing: (t: Tuning) => number;
  /** Extra store capacity. */
  readonly capacity: (t: Tuning) => ResourceRates;
  /** Planetary CO2 drawn per year while operable (section 2.2), mbar. */
  readonly planetaryCo2: (t: Tuning) => number;
  /** Section 2.1 gating. */
  readonly canOperate: (env: HabitatChannels, t: Tuning) => boolean;
  /** Section 2.1 scaling of production (and of the planetary output). */
  readonly efficiency: (env: HabitatChannels) => number;
}

/** What level `level` multiplies a building's output by: 1.1 per level above the first, compounding. */
export function levelFactor(level: number, t: Tuning): number {
  return (1 + t.LEVEL_BONUS) ** Math.max(0, level - 1);
}

/** The highest level a type goes to. */
export function maxLevel(type: BuildingType, t: Tuning): number {
  return type === "habitat_dome" ? t.MAX_LEVEL_HABITAT_DOME : type === "regolith_mine" ? t.MAX_LEVEL_REGOLITH_MINE : t.MAX_LEVEL_OTHER;
}

/** How long a rover takes to build (or raise a level of) a type at its site, sim-years. */
export function buildYears(type: BuildingType, t: Tuning): number {
  const years: Readonly<Record<BuildingType, number>> = {
    habitat_dome: t.BUILD_YEARS_HABITAT_DOME,
    solar_array: t.BUILD_YEARS_SOLAR_ARRAY,
    geothermal_plant: t.BUILD_YEARS_GEOTHERMAL_PLANT,
    reactor: t.BUILD_YEARS_REACTOR,
    water_extractor: t.BUILD_YEARS_WATER_EXTRACTOR,
    atmosphere_processor: t.BUILD_YEARS_ATMOSPHERE_PROCESSOR,
    greenhouse: t.BUILD_YEARS_GREENHOUSE,
    regolith_mine: t.BUILD_YEARS_REGOLITH_MINE,
    storage_depot: t.BUILD_YEARS_STORAGE_DEPOT,
    spaceport: t.BUILD_YEARS_SPACEPORT,
    rover_post: t.BUILD_YEARS_ROVER_POST,
    headquarters: t.BUILD_YEARS_SPACEPORT,
  };
  return years[type];
}

const NONE = (): ResourceRates => ({});
const ZERO = (): number => 0;
const ALWAYS = (): boolean => true;
const ONE = (): number => 1;
const BOTH: readonly SettlementKind[] = ["city", "outpost", "metropolis"];
const CITY: readonly SettlementKind[] = ["city", "metropolis"];

export const BUILDING_DEFS: Readonly<Record<BuildingType, BuildingDef>> = Object.freeze({
  habitat_dome: {
    type: "habitat_dome",
    name: "Habitat Dome",
    summary: "Pressurised, regolith-shielded housing. Its life support falls away once the air outside is breathable.",
    footprint: 3,
    buildable: true,
    kinds: CITY,
    cost: (t) => t.COST_HABITAT_DOME,
    consumes: (t, env) => {
      // Section 5: "Late (P, o2 high): needs far less life support, can open."
      const k = 1 - t.DOME_OPEN_RELIEF * env.openAirFraction;
      return { power: t.DOME_POWER, water: t.DOME_WATER * k, oxygen: t.DOME_OXYGEN * k, food: t.DOME_FOOD };
    },
    produces: NONE,
    housing: (t) => t.DOME_HOUSING,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  solar_array: {
    type: "solar_array",
    name: "Solar Array",
    summary: "Cheap power that scales with sunlight - orbital mirrors raise it, shades cut it.",
    footprint: 2,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_SOLAR_ARRAY,
    consumes: NONE,
    produces: (t) => ({ power: t.SOLAR_POWER }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: (env) => Math.max(0, env.insolation),
  },
  geothermal_plant: {
    type: "geothermal_plant",
    name: "Geothermal Plant",
    summary: "Steady baseload power from borehole heat, day or night.",
    footprint: 2,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_GEOTHERMAL_PLANT,
    consumes: NONE,
    produces: (t) => ({ power: t.GEOTHERMAL_POWER }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  reactor: {
    type: "reactor",
    name: "Reactor",
    summary: "Fission surface power: large and steady. The heavy backbone.",
    footprint: 2,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_REACTOR,
    consumes: NONE,
    produces: (t) => ({ power: t.REACTOR_POWER }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  water_extractor: {
    type: "water_extractor",
    name: "Water Extractor",
    summary: "Mines subsurface ice. Twice as productive once liquid water is in reach.",
    footprint: 2,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_WATER_EXTRACTOR,
    consumes: (t) => ({ power: t.EXTRACTOR_POWER }),
    produces: (t) => ({ water: t.EXTRACTOR_WATER }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: (env) => 1 + env.waterAccess,
  },
  atmosphere_processor: {
    type: "atmosphere_processor",
    name: "Atmosphere Processor",
    summary: "Splits the air's CO2 into oxygen (MOXIE-style): breathable air for the city, and less CO2 on the planet.",
    footprint: 2,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_ATMOSPHERE_PROCESSOR,
    consumes: (t) => ({ power: t.PROCESSOR_POWER }),
    produces: (t) => ({ oxygen: t.PROCESSOR_OXYGEN }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: (t) => t.PROCESSOR_CO2_DRAW,
    canOperate: (env, t) => env.carbonDioxide > t.PROCESSOR_MIN_CO2,
    efficiency: ONE,
  },
  greenhouse: {
    type: "greenhouse",
    name: "Greenhouse",
    summary: "Enclosed hydroponics: power and water into food.",
    footprint: 2,
    buildable: true,
    kinds: CITY,
    cost: (t) => t.COST_GREENHOUSE,
    consumes: (t) => ({ power: t.GREENHOUSE_POWER, water: t.GREENHOUSE_WATER }),
    produces: (t) => ({ food: t.GREENHOUSE_FOOD }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  regolith_mine: {
    type: "regolith_mine",
    name: "Regolith Mine",
    summary: "Digs and processes regolith into construction materials.",
    footprint: 2,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_REGOLITH_MINE,
    consumes: (t) => ({ power: t.MINE_POWER }),
    produces: (t) => ({ materials: t.MINE_MATERIALS }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  storage_depot: {
    type: "storage_depot",
    name: "Storage Depot",
    summary: "Tanks and bunkers: more room for every stored resource.",
    footprint: 1,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_STORAGE_DEPOT,
    consumes: NONE,
    produces: NONE,
    housing: ZERO,
    capacity: (t) => ({
      power: t.DEPOT_POWER,
      water: t.DEPOT_WATER,
      oxygen: t.DEPOT_OXYGEN,
      food: t.DEPOT_FOOD,
      materials: t.DEPOT_MATERIALS,
    }),
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  spaceport: {
    type: "spaceport",
    name: "Spaceport",
    summary: "The Earth link: imports materials and life-support stock while the settlement cannot yet feed itself.",
    footprint: 3,
    buildable: true,
    kinds: BOTH,
    cost: (t) => t.COST_SPACEPORT,
    consumes: (t) => ({ power: t.SPACEPORT_POWER }),
    produces: (t) => ({
      materials: t.SPACEPORT_MATERIALS,
      water: t.SPACEPORT_LIFE_SUPPORT,
      oxygen: t.SPACEPORT_LIFE_SUPPORT,
      food: t.SPACEPORT_LIFE_SUPPORT,
    }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  rover_post: {
    type: "rover_post",
    name: "Rover Post",
    summary: "A rover garage out on the land: one more rover for the city. A city runs one post for every 100 people.",
    footprint: 5,
    buildable: true,
    kinds: CITY,
    cost: (t) => t.COST_ROVER_POST,
    consumes: NONE,
    produces: NONE,
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
  headquarters: {
    type: "headquarters",
    name: "Headquarters",
    summary: "The heart of the settlement, landed with it: command, the rover garage, and life support of its own. It cannot be built or moved.",
    footprint: 5,
    buildable: false,
    kinds: ["city", "outpost", "metropolis"],
    cost: ZERO,
    consumes: NONE,
    produces: (t) => ({ oxygen: t.HQ_OXYGEN, water: t.HQ_WATER }),
    housing: ZERO,
    capacity: NONE,
    planetaryCo2: ZERO,
    canOperate: ALWAYS,
    efficiency: ONE,
  },
});
