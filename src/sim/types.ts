/**
 * The complete type surface of the macro simulation.
 *
 * Design doc: docs/design/macro-world.md sections 2, 6, 7.
 *
 * This file is deliberately wider than Batch 1 needs: `Env`, `Facility`,
 * `Flow`, the ledger and `TickResult.flows` are the hooks Batches 2 (levers),
 * 5 (visual contract) and 8 (seeded events) plug into. Adding them later would
 * be a cross-cutting refactor; adding them now costs a few lines.
 */

// ---------------------------------------------------------------------------
// Reservoirs (section 2.1) - the only authoritative state
// ---------------------------------------------------------------------------

/**
 * Every conserved quantity in the world.
 *
 * Gas reservoirs are in mbar of *pressure-equivalent*: the pressure the gas
 * would exert at the surface if it were entirely in the atmosphere. Because
 * surface pressure is column weight (P = Mg/A), an mbar is proportional to
 * MASS, which is what makes the photosynthesis stoichiometry in rates/biomass
 * a mass ratio and not a mole ratio.
 *
 * Water is in metres of sea-level-equivalent, except `h2o_vap` which is in
 * mbar like the other gases. `src/sim/units.ts` owns that bridge.
 */
export type ReservoirKey =
  | "co2_atm"
  | "co2_cap"
  | "co2_reg"
  | "n2"
  | "n2_reg"
  | "o2"
  | "h2o_ice"
  | "h2o_liq"
  | "h2o_vap"
  | "ghg"
  | "biomass";

export type Reservoirs = Readonly<Record<ReservoirKey, number>>;
export type MutableReservoirs = Record<ReservoirKey, number>;

export const RESERVOIR_KEYS = [
  "co2_atm",
  "co2_cap",
  "co2_reg",
  "n2",
  "n2_reg",
  "o2",
  "h2o_ice",
  "h2o_liq",
  "h2o_vap",
  "ghg",
  "biomass",
] as const satisfies readonly ReservoirKey[];

type MissingReservoirKeys = Exclude<ReservoirKey, (typeof RESERVOIR_KEYS)[number]>;

/**
 * Compile-time exhaustiveness sentinel: if a key is added to `ReservoirKey`
 * and not to `RESERVOIR_KEYS`, this assignment stops compiling. The tuple wrap
 * stops the conditional distributing over the union (which would collapse to
 * `never` and silently pass).
 */
export const RESERVOIR_KEYS_ARE_COMPLETE: [MissingReservoirKeys] extends [never]
  ? true
  : MissingReservoirKeys = true;

/** The subset of reservoirs that sit in the atmosphere and can be stripped by solar wind. */
export const GAS_KEYS = ["co2_atm", "n2", "o2", "h2o_vap", "ghg"] as const satisfies readonly ReservoirKey[];
export type GasKey = (typeof GAS_KEYS)[number];

// ---------------------------------------------------------------------------
// Ledger - where mass goes when it leaves the reservoir set
// ---------------------------------------------------------------------------

/**
 * Conservation in this model is a LEDGER IDENTITY, not an equality between
 * reservoirs. Photosynthesis and atmospheric escape both legitimately remove
 * carbon from the three CO2 reservoirs; if conservation were stated as
 * "the three CO2 reservoirs sum to a constant" it would be false on tick one.
 *
 * Every path out of the reservoir set terminates in one of these accounts, so
 * `co2_atm + co2_cap + co2_reg + c_fixed + c_lost + c_sequestered - c_imported`
 * is invariant. See `src/sim/conserve.ts`.
 */
export type LedgerKey =
  | "c_fixed"
  | "c_lost"
  | "c_sequestered"
  | "c_imported"
  | "h2o_lost"
  | "h2o_imported"
  | "n2_lost"
  | "n2_imported"
  | "o2_lost"
  | "ghg_lost";

export type Ledger = Readonly<Record<LedgerKey, number>>;
export type MutableLedger = Record<LedgerKey, number>;

export const LEDGER_KEYS = [
  "c_fixed",
  "c_lost",
  "c_sequestered",
  "c_imported",
  "h2o_lost",
  "h2o_imported",
  "n2_lost",
  "n2_imported",
  "o2_lost",
  "ghg_lost",
] as const satisfies readonly LedgerKey[];

type MissingLedgerKeys = Exclude<LedgerKey, (typeof LEDGER_KEYS)[number]>;
export const LEDGER_KEYS_ARE_COMPLETE: [MissingLedgerKeys] extends [never] ? true : MissingLedgerKeys = true;

/** Any account a flow can move mass between. */
export type AccountKey = ReservoirKey | LedgerKey;
export type Accounts = Record<AccountKey, number>;

// ---------------------------------------------------------------------------
// Flows (the rate representation)
// ---------------------------------------------------------------------------

/**
 * Rate contributions are composed as FLOWS between two accounts, never as
 * per-reservoir net rates.
 *
 * This is what makes conservation structural rather than something a later
 * clamp has to be careful not to break: a transfer is one object naming both
 * ends, so mass-limiting the source automatically limits the destination.
 * A per-key net-rate design cannot do this - clipping one half of a paired
 * transfer mints or destroys mass.
 */
export type FlowId =
  | "co2.cap_sublimation"
  | "co2.regolith_desorption"
  | "h2o.melt"
  | "h2o.freeze"
  | "h2o.evaporate"
  | "h2o.condense"
  | "h2o.snow"
  | "h2o.sublimate"
  | "bio.photosynthesis"
  | "bio.o2_release"
  | "bio.decay_carbon"
  | "bio.decay_o2"
  | "n2.nitrate_release"
  | "ghg.photolysis"
  | "loss.co2_atm"
  | "loss.n2"
  | "loss.o2"
  | "loss.h2o_vap"
  | "loss.ghg"
  | "forcing.ghg_import"
  | "forcing.n2_import"
  | "forcing.h2o_import"
  | "forcing.co2_vent"
  | "forcing.co2_scrub"
  | "micro.moxie_carbon"
  | "micro.moxie_o2"
  | "event.comet_water";

export interface Flow {
  readonly id: FlowId;
  /** Source account, or null for an import from outside the planet. */
  readonly from: AccountKey | null;
  /** Destination account, or null when the mass is accounted for elsewhere. */
  readonly to: AccountKey | null;
  /** Always >= 0, per sim-year, in the SOURCE account's unit. */
  readonly rate: number;
  /** Multiplier applied when the flow crosses a unit boundary (metres <-> mbar). 1 otherwise. */
  readonly conversion: number;
  /**
   * The account whose rationing factor governs this flow. Defaults to `from`.
   *
   * Set it when a flow is one leg of a stoichiometric pair whose limiting
   * reagent sits somewhere else - in particular when `from` is null, since a
   * flow with no source is exempt from rationing by construction and would
   * otherwise keep running at full rate while its partner was scaled down.
   */
  readonly scaleWith?: AccountKey;
}

/** A per-reservoir view of the flows. For display and tests only - never integrated from. */
export type Rates = Readonly<Record<ReservoirKey, number>>;

// ---------------------------------------------------------------------------
// Environment (what the outside world is doing to the planet)
// ---------------------------------------------------------------------------

/**
 * Forcings that are not reservoirs. Batch 1 always passes the identity
 * environment; Batch 2's mirrors and shades write `sMultiplier`, and Batch 8's
 * dust storms write `albedoDelta`.
 */
export interface Env {
  /** Multiplier on baseline solar flux. 1 = unmodified. Mirrors > 1, shades < 1. */
  readonly sMultiplier: number;
  /** Additive perturbation to albedo, e.g. a dust storm brightening the disc. */
  readonly albedoDelta: number;
}

export const NEUTRAL_ENV: Env = Object.freeze({ sMultiplier: 1, albedoDelta: 0 });

// ---------------------------------------------------------------------------
// Derived quantities (section 2.2) - recomputed every substep, never stored
// ---------------------------------------------------------------------------

export interface Derived {
  /** Total surface pressure, mbar. */
  readonly P: number;
  /** Pressure as seen by the greenhouse term (N2 weighted by N2_GREENHOUSE_WEIGHT). */
  readonly pGreenhouse: number;
  readonly iceFrac: number;
  readonly oceanFrac: number;
  readonly vegFrac: number;
  readonly bareFrac: number;
  readonly landFrac: number;
  readonly cloudFrac: number;
  /** Cover-weighted ground reflectivity, before clouds. */
  readonly surfaceAlbedo: number;
  /** Cloud-composited, clamped planetary albedo - the one that feeds T_eq. */
  readonly albedo: number;
  /** Effective solar flux after mirrors/shades, W/m^2. */
  readonly sEff: number;
  /** Airless radiative equilibrium temperature, K. */
  readonly tEq: number;
  /** Greenhouse warming added on top, K. */
  readonly dTgh: number;
  /** Global mean surface temperature, K. */
  readonly T: number;
}

// ---------------------------------------------------------------------------
// Phases (section 7)
// ---------------------------------------------------------------------------

/**
 * A const object rather than a TS enum: `isolatedModules` bans `const enum`,
 * a plain enum cannot be carried by `import type`, and section 11 serialises
 * the phase as a bare number, which this round-trips for free.
 */
export const Phase = {
  Barren: 0,
  Warming: 1,
  RunawayThickening: 2,
  FirstWater: 3,
  Ecopoiesis: 4,
  Oxygenation: 5,
  LivingWorld: 6,
} as const;

export type Phase = (typeof Phase)[keyof typeof Phase];

export const PHASE_ORDER = [0, 1, 2, 3, 4, 5, 6] as const satisfies readonly Phase[];

// ---------------------------------------------------------------------------
// Facilities (section 5)
// ---------------------------------------------------------------------------

/** The nine levers of section 5. A union, so a typo is a compile error. */
export type FacilityType =
  | "orbital_mirror"
  | "solar_shade"
  | "ghg_factory"
  | "atmo_processor"
  | "comet_redirect"
  | "nitrogen_import"
  | "biosphere_seeding"
  | "carbon_scrubber"
  | "magnetic_shield";

export const FACILITY_TYPES = [
  "orbital_mirror",
  "solar_shade",
  "ghg_factory",
  "atmo_processor",
  "comet_redirect",
  "nitrogen_import",
  "biosphere_seeding",
  "carbon_scrubber",
  "magnetic_shield",
] as const satisfies readonly FacilityType[];

type MissingFacilityTypes = Exclude<FacilityType, (typeof FACILITY_TYPES)[number]>;
export const FACILITY_TYPES_ARE_COMPLETE: [MissingFacilityTypes] extends [never]
  ? true
  : MissingFacilityTypes = true;

export interface Facility {
  readonly type: FacilityType;
  readonly count: number;
  readonly level: number;
  readonly enabled: boolean;
  /**
   * Effective units currently ONLINE, as distinct from `count * level`, which
   * is what has been ordered.
   *
   * Section 5's design rule is that no lever may trivialise an axis instantly:
   * "each moves a rate, so the planet still changes over time". The flow-type
   * levers satisfy that for free, because a flow IS a rate. The orbital mirror
   * does not - it moves effective solar flux, which moves temperature with no
   * lag at all, so a fully-funded array would cross the Phase 2 boundary on
   * the very first tick and delete the moment section 0 calls the core of the
   * game. Deployment ramps toward the ordered amount instead: a fleet is not
   * assembled overnight, and neither is it dismantled overnight.
   */
  readonly deployed: number;
}

// ---------------------------------------------------------------------------
// Simulation state (section 11)
// ---------------------------------------------------------------------------

/** §11's `economy` placeholder, filled in Batch 9. */
export interface EconomyState {
  readonly credits: number;
  /** Lifetime income. Kept for the UI and for "where did it all go" questions. */
  readonly earned: number;
  /** Lifetime outgoings, purchases and upkeep together. */
  readonly spent: number;
}

export interface SimState {
  /** Matches `SAVE_SCHEMA_VERSION`. The shape changed three times after §11 was written. */
  readonly schemaVersion: 9;
  readonly planetId: string;
  readonly seed: number;
  /**
   * INTEGER count of substeps elapsed. `simYear` is derived as
   * `steps * SUBSTEP_YEARS` and never accumulated, which is what makes
   * "any decomposition of the same elapsed time gives the identical result"
   * a theorem rather than a tolerance.
   */
  readonly steps: number;
  readonly reservoirs: Reservoirs;
  readonly ledger: Ledger;
  /** 0..1. Cancels atmospheric loss (section 3.7). */
  readonly shieldStrength: number;
  /** Has ecopoiesis been triggered? Section 3.5's "life cannot grow from nothing", made structural. */
  readonly seeded: boolean;
  /** The latched high-water mark. Serialises to section 11's `"phase": 3`. */
  readonly phaseReached: Phase;
  readonly facilities: readonly Facility[];
  readonly techUnlocked: readonly string[];
  /** §11's economy, no longer a placeholder. */
  readonly economy: EconomyState;
  /**
   * The micro layer's settlement registry (micro doc §9.1), since Batch 17.
   * Only what cannot be recomputed: where each one is and what kind it is.
   * Inert until Batch 18 couples it to the planet.
   */
  readonly settlements: readonly Settlement[];
}

/** Micro doc §4: a populated city, or a small specialised outpost. */
/**
 * A metropolis (added at the user's request) is a city with 3 x 3 the ground:
 * everything a city may build, on a grid three times as wide.
 */
export type SettlementKind = "city" | "outpost" | "metropolis";

/** Kinds that house people and may build everything a city may. */
export function isCityKind(kind: SettlementKind): boolean {
  return kind === "city" || kind === "metropolis";
}

export interface Settlement {
  /** Deterministic: `settlement-<n>`, never random - invariant #1. */
  readonly id: string;
  readonly kind: SettlementKind;
  /** Radians. Planet space: y is the pole, lat in [-pi/2, pi/2], lon in (-pi, pi]. */
  readonly lat: number;
  readonly lon: number;
  /**
   * Batch 18 - micro §6 and §7. The only settlement state that cannot be
   * recomputed: people, stored resources, and what is built where. Whether a
   * building is operable, its efficiency and every production total are
   * derived each substep and never stored (micro §10).
   */
  readonly population: number;
  readonly stores: Readonly<Record<MicroResource, number>>;
  readonly buildings: readonly PlacedBuilding[];
  /**
   * Detail doc §4.7 (Batch 24): null while the settlement stands; once the
   * sea declares it flooded, the sea level it fell at, for the record. True
   * state - the flood that caused it may recede, the loss does not.
   */
  readonly lostAtSeaLevelM: number | null;
  /**
   * The settlement's networks (at the user's request; micro §6 made real),
   * each as sorted tile keys (`ty * 1024 + tx`). True state - the player lays
   * them; which buildings they join is derived.
   *   corridors: pressurised walkways - water, oxygen, food and materials;
   *   cables:    power lines - power.
   */
  readonly corridors: readonly number[];
  readonly cables: readonly number[];
  /** Rock tiles a rover has broken (tile keys, sorted). A broken crag leaves buildable ground. */
  readonly cleared: readonly number[];
  /** Rovers and rockets under way. Each counts down in sim-years, one substep at a time. */
  readonly jobs: readonly SettlementJob[];
  /**
   * The founding square's edge, tiles, as it was founded. True state: a
   * retune of the grid sizes must not move the ground under a city, and
   * claimed land is counted from it.
   */
  readonly base: number;
  /** Land claimed beyond the founding square: sorted chunk keys (`chunkKey`, site coordinates). */
  readonly claims: readonly number[];
}

/**
 * Work under way (at the user's request). Counted down by `settlementStep`,
 * substep by substep, so it is as chunk-independent as everything else, and
 * it finishes offline exactly as it would have live.
 */
export type SettlementJob =
  /** A rover out from the headquarters to break the rock on `tile`, bringing back `materials`. */
  /** `work` is the part of `total` spent breaking the rock; the rest is the drive out and back. */
  | { readonly kind: "rover"; readonly tile: number; readonly materials: number; readonly work: number; readonly total: number; readonly remaining: number }
  /** A rocket off the spaceport whose corner is `tile`, to come back with materials. */
  | { readonly kind: "rocket"; readonly tile: number; readonly total: number; readonly remaining: number };

/** Micro §6. Networked: power, water, oxygen. Stored: food, materials. Population is separate. */
export const MICRO_RESOURCES = ["power", "water", "oxygen", "food", "materials"] as const;
export type MicroResource = (typeof MICRO_RESOURCES)[number];

/** Micro §5's ten buildings, and the headquarters every settlement is founded around. */
export const BUILDING_TYPES = [
  "habitat_dome",
  "solar_array",
  "geothermal_plant",
  "reactor",
  "water_extractor",
  "atmosphere_processor",
  "greenhouse",
  "regolith_mine",
  "storage_depot",
  "spaceport",
  "headquarters",
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

/** A building on a settlement's grid: its type and the tile of its footprint's corner. */
export interface PlacedBuilding {
  readonly type: BuildingType;
  readonly tx: number;
  readonly ty: number;
  /** Micro §10 keeps a level "so the schema does not churn later". Always 1 for now. */
  readonly level: number;
}

// ---------------------------------------------------------------------------
// Tick output
// ---------------------------------------------------------------------------

/** The five normalised progress axes (section 8.1), exposed so the harness can see which one binds. */
export interface ProgressAxes {
  readonly nT: number;
  readonly nP: number;
  readonly nO2: number;
  readonly nWater: number;
  readonly nBio: number;
  /** Carbon dioxide drawn down toward breathable, on a log scale. */
  readonly nCO2: number;
}

export interface TickResult {
  readonly state: SimState;
  readonly derived: Derived;
  /** The flows of the FINAL substep - the rate attribution Batch 5's dust-storm channel reads. */
  readonly flows: readonly Flow[];
  /** Tick-mean (after - before) / dt, per reservoir. */
  readonly rates: Rates;
  /** Tick-mean temperature change, K per sim-year. Drives "and rising" style conditions. */
  readonly dTdt: number;
  /** Instantaneous threshold evaluation, which can go down. */
  readonly phase: Phase;
  /** The latched value, which cannot. Mirrors `state.phaseReached`. */
  readonly phaseReached: Phase;
  /** Section 8.1 with the per-axis floor applied - the display value. */
  readonly progress: number;
  /** Section 8.1 unfloored - the honest victory gate. */
  readonly progressRaw: number;
  readonly axes: ProgressAxes;
  /** How many substeps actually ran. 0 if dt was below half a substep. */
  readonly stepsRun: number;
}
