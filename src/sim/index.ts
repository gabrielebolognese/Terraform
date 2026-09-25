/**
 * The public surface of the macro simulation.
 *
 * Everything outside `src/sim/` - the harness, the inspector, and later the
 * renderer and the city layer - imports from here and from nowhere deeper.
 * The dependency is strictly one-way: nothing in `src/sim/` imports from a
 * host, and nothing visual ever writes back into the sim (invariant #2).
 */

export {
  buildFacility,
  facilityOf,
  orderFacility,
  seedBiosphere,
  setFacilityEnabled,
  setShieldStrength,
} from "./actions.js";
export type { OrderOutcome } from "./actions.js";
export type { SeedOutcome } from "./actions.js";

export {
  FACILITY_DEFS,
  FACILITY_LIST,
  deployedUnitsOf,
  effectiveEnv,
  facilityFlows,
  orderedUnits,
  scrubberThrottled,
  shieldTarget,
  stepFacilities,
  stepShield,
} from "./facilities/index.js";
export type { FacilityDef, FacilityKind } from "./facilities/index.js";

export { carbonInvariant, nitrogenInvariant, relativeDrift, snapshotConservation, waterInvariant } from "./conserve.js";
export {
  activeEvents,
  describeEvent,
  eventEnv,
  eventFlows,
  eventsBeginningIn,
  lookbackYears,
  solarVariability,
  stormIntensity,
} from "./events.js";
export type { ActiveEvent, EventKind, WorldEvent } from "./events.js";
export { hashInts, rand01, randBell, randRange } from "./rng.js";
export { habitat } from "./habitat.js";
export type { HabitatChannels } from "./habitat.js";
export {
  EMPTY_ECONOMY,
  accrue,
  incomeRate,
  orderCost,
  purchase,
  startingEconomy,
  upkeepRate,
} from "./economy.js";
export type { Purchase } from "./economy.js";
export {
  TECH,
  availableTech,
  gatingTech,
  techById,
  techGate,
  unlockedFor,
} from "./tech.js";
export type { TechDef, TechGate } from "./tech.js";
export type { ConservationSnapshot } from "./conserve.js";

export { devChecksEnabled, setDevChecks, SimInvariantError } from "./dev.js";

export {
  cloudFrac,
  derive,
  equilibriumTemp,
  greenhouseDelta,
  greenhousePressure,
  planetaryAlbedo,
  surfaceAlbedo,
  surfaceCover,
  totalPressure,
} from "./derive.js";
export type { SurfaceCover } from "./derive.js";

export { advance, applyFluxes, simYear, worldEnv } from "./integrate.js";
export type { SimConfig } from "./integrate.js";

export * from "./math.js";

export { evaluatePhase, inLivingWorldBand, latchPhase, LIVING_WORLD_ROWS, livingWorldShortfall, PHASE_INFO } from "./phase.js";
export type { LivingWorldRow } from "./phase.js";
export type { PhaseInfo } from "./phase.js";

export { marsStart, MARS_START_RESERVOIRS, G_MARS } from "./planets/mars.js";

export { computeProgress, progressAxes } from "./progress.js";
export type { ProgressResult } from "./progress.js";

export { biomassStep, computeRates, computeStep, suitability } from "./rates/index.js";
export type { ForcingFn, StepContribution, Suitability } from "./rates/index.js";

export { TARGETS } from "./targets.js";
export type { TargetBand } from "./targets.js";

export { catchUp, defaultConfig, tick } from "./tick.js";

export { SAVE_SCHEMA_VERSION, SaveError, deserialize, fromSave, serialize, toSave } from "./save.js";
export type { SaveFile, SavedFacility, SaveStore } from "./save.js";

export {
  PALETTE,
  SCALAR_CHANNELS,
  VISUAL_TUNING,
  capRadiusFrom,
  clearFractionOf,
  co2ReleaseRate,
  deriveVisuals,
  toHex,
} from "./visuals.js";
export type { EconomyState } from "./types.js";
export type { Rgb, ScalarChannel, VisualChannels } from "./visuals.js";

export { offlineGrant, resume, summariseAway } from "./offline.js";
export type { AwayDeltas, AwaySummary, GrantLimit, OfflineGrant, ResumeResult } from "./offline.js";

export { BASE_TUNING, DEFAULT_TUNING, makeTuning, TuningError, TUNING_SCALAR_KEYS, validateTuning } from "./tuning.js";
export type { Tuning, TuningOverrides, TuningScalarKey } from "./tuning.js";

export type {
  AccountKey,
  FacilityType,
  Derived,
  Env,
  Facility,
  Flow,
  FlowId,
  GasKey,
  Ledger,
  LedgerKey,
  ProgressAxes,
  Rates,
  Reservoirs,
  ReservoirKey,
  SimState,
  TickResult,
} from "./types.js";
export { FACILITY_TYPES, GAS_KEYS, LEDGER_KEYS, NEUTRAL_ENV, Phase, PHASE_ORDER, RESERVOIR_KEYS } from "./types.js";

export { metresFromVapourMbar, totalCarbonMbar, totalNitrogenMbar, totalWaterMetres, vapourMbarFromMetres } from "./units.js";

// ---- the micro (settlement) layer, Batch 17 ---------------------------------
export {
  footprintFits,
  footprintTiles,
  gridTiles,
  keyTile,
  latLonToVec,
  TILE_STRIDE,
  onGrid,
  planetToWorld,
  tangentFrame,
  tileKey,
  chunkKey,
  frameOf,
  tileToWorld,
  vecToLatLon,
  worldToPlanet,
  worldToTile,
  wrapLongitude,
} from "./micro/space.js";
export type { Footprint, Vec3 } from "./micro/space.js";
export { foundSettlement } from "./micro/registry.js";
export type { FoundOutcome } from "./micro/registry.js";
export { MARS_RADIUS_M } from "./planets/mars.js";
export type { Settlement, SettlementKind } from "./types.js";
export { BUILDING_DEFS, buildYears, levelFactor, maxLevel } from "./micro/buildings.js";
export type { BuildingDef } from "./micro/buildings.js";
export {
  capacities,
  claimLand,
  claimableChunks,
  connectTwice,
  constructionOf,
  upgradeBuilding,
  claimsAllowed,
  connectAll,
  foundingBuildings,
  headquartersOrigin,
  housing,
  launchRocket,
  levelGround,
  newSettlement,
  placeBuilding,
  placeLink,
  removeBuilding,
  removeLink,
  sendRover,
  settlementStep,
} from "./micro/settlement.js";
export { LAYERS, layerOf, linksForRedundancy, linksToConnect, networkOf } from "./micro/network.js";
export type { Layer, LinkLayer, Network, NetworkIssue } from "./micro/network.js";
export { garage, levelFor, roverCount, rocksOf, roverYears, siteGround } from "./micro/rocks.js";
export type { Rock } from "./micro/rocks.js";
export type { PlaceOutcome, SettlementStep } from "./micro/settlement.js";
export { microStep } from "./micro/coupling.js";
export type { MicroContribution } from "./micro/coupling.js";
export { groundOf, isSteep, slopeAt, worldOf } from "./micro/terrain.js";
export { elevationAtRank, siteElevation } from "./hypsometry.js";
export { liquidWaterRate, seaLevel } from "./sea-level.js";
export { nextSubstepFlows } from "./integrate.js";
export type { SeaLevel } from "./sea-level.js";
export type { Ground } from "./micro/terrain.js";
export { cityView } from "./micro/view.js";
export type { CityBuildingView, CityJobView, CityView } from "./micro/view.js";
export { BUILDING_TYPES, MICRO_RESOURCES } from "./types.js";
export type { BuildingType, MicroResource, PlacedBuilding } from "./types.js";
