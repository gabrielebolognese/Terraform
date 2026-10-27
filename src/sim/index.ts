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
  keyChunk,
  claimTest,
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
export type { History, HistorySample, PlannedLink, QueuedBuild, Route, Settlement, SettlementJob, SettlementKind, Zone } from "./types.js";
export { ROUTE_RESOURCES, connectSettlements, crossingLine, disconnectSettlements, flowRoutes, routeAxis, routeCost, routeKm } from "./micro/routes.js";
export type { Axis, RouteOutcome } from "./micro/routes.js";
export { sizeClass } from "./micro/registry.js";
export { dikeHeightM, floodAlert, floodForecast, floodReading, submerged } from "./micro/flood.js";
export { evacuateSettlement, terraceBuilding, terracePlan, threatened } from "./micro/defences.js";
export { throttleForecast } from "./throttle.js";
export type { ThrottleReading } from "./throttle.js";
export type { EvacuationOutcome, TerracePlan } from "./micro/defences.js";
export type { FloodForecast, FloodReading, FloodState } from "./micro/flood.js";
export type { SizeClass } from "./micro/registry.js";
export { BUILD_TIER, BUILDING_DEFS, buildGrowth, buildSeconds, buildYears, citySecondsPerYear, levelFactor, maxLevel } from "./micro/buildings.js";
export type { BuildingDef } from "./micro/buildings.js";
export {
  capacities,
  claimLand,
  claimableChunks,
  editZone,
  deleteZone,
  levelZone,
  planLinks,
  cancelPlans,
  renameSettlement,
  linkRefusal,
  NAME_MAX,
  ZONE_COLOURS,
  connectTwice,
  constructionOf,
  upgradeBuilding,
  moveQueuedBuild,
  cancelQueuedBuild,
  claimsAllowed,
  connectAll,
  foundingBuildings,
  headquartersOrigin,
  housing,
  launchRocket,
  levelGround,
  newSettlement,
  placeBuilding,
  checkPlacement,
  placeLink,
  removeBuilding,
  removeLink,
  sendRover,
  settlementStep,
} from "./micro/settlement.js";
export { LAYERS, layerOf, linksForRedundancy, linksToConnect, networkOf, withRails } from "./micro/network.js";
export type { Layer, LinkLayer, Network, NetworkIssue } from "./micro/network.js";
export { garage, levelFor, roverCount, rocksOf, siteGround } from "./micro/rocks.js";
export { DOOR_KEPT_CLEAR, NO_ROUTE, ROVER_PASSING, buildingSite, drive, expandRoute, garageApron, garageDoor, garageLeg, reachable, roverRoute, roverYears, tileSite, tilesDriven, wallsIn } from "./micro/drive.js";
export type { RoverRoute, Site } from "./micro/drive.js";
export type { Rock } from "./micro/rocks.js";
export type { PlaceOutcome, SettlementStep } from "./micro/settlement.js";
export { NEEDS, NEED_BY_ID, happinessOf, needAskedFrom, needCoverage, peopleReached, reachSide, readNeeds, walkNetwork } from "./micro/needs.js";
export type { NeedDef, NeedId, NeedReading, NeedsReading, NeedTier } from "./micro/needs.js";
export { microStep } from "./micro/coupling.js";
export type { MicroContribution } from "./micro/coupling.js";
export { groundOf, isSteep, slopeAt, terrainReady, worldOf } from "./micro/terrain.js";
export { DEPOSIT_BOOSTS, DEPOSIT_KINDS, depositAt, depositBonus, depositFor, depositOfCode, depositsOf, sitingOf, sitingPreview } from "./micro/deposits.js";
export type { DepositKind, Siting } from "./micro/deposits.js";
export { elevationAtRank, siteElevation } from "./hypsometry.js";
export { liquidWaterRate, seaLevel } from "./sea-level.js";
export { nextSubstepFlows } from "./integrate.js";
export type { SeaLevel } from "./sea-level.js";
export type { Ground } from "./micro/terrain.js";
export { cityView, prepareCity } from "./micro/view.js";
export type { CityBuildingView, CityJobView, CityView } from "./micro/view.js";
export { BUILDING_TYPES, MICRO_RESOURCES } from "./types.js";
export type { BuildingType, MicroResource, PlacedBuilding } from "./types.js";

// ---- the first hour, Batch 30 -----------------------------------------------
export {
  GUIDE_STEPS,
  OBJECTIVES,
  OBJECTIVE_CHAINS,
  citiesJoined,
  claimObjective,
  guideActive,
  guideReached,
  hasCosmetic,
  hasUnlock,
  largestCity,
  latchGuide,
  metropolisAllowed,
  objectiveById,
  objectiveStatus,
  skipGuide,
  steadyYears,
} from "./objectives.js";
export type { ClaimOutcome, Cosmetic, GuideStep, GuideStepId, ObjectiveChain, ObjectiveDef, ObjectiveStatus, Progress, Reward, Unlock } from "./objectives.js";
export { NO_GOALS } from "./planets/mars.js";
export type { Goals } from "./types.js";
export type { PlanetHistory, PlanetSample } from "./types.js";
export { emptyPlanetHistory, planetSample, recordPlanet, samplesAt } from "./history.js";

// ---- events that ask for decisions, Batch 33 --------------------------------
export {
  CHOICE_TITLES,
  DECISION_KINDS,
  cardAt,
  cardDealtAt,
  cardFor,
  chooseDecision,
  cityYearsFor,
  dealCard,
  decisionChoices,
  decisionText,
  decisionTitle,
  deckSlots,
  defaultWords,
  outbreakAtRisk,
  repairCost,
  resolveDecision,
  secondsFor,
  stepDecisions,
  substepsFor,
} from "./decisions.js";
export type { ChooseOutcome, DecisionChoice } from "./decisions.js";
export { NO_DECISIONS } from "./planets/mars.js";
export type { DecisionKind, DecisionOutcome, DecisionRecord, DecisionVariant, Decisions, OpenDecision, SettlementEffect } from "./types.js";

// ---- Earth: shipments, contracts and the market, Batch 34 -------------------
export {
  CONTRACT_KINDS,
  NO_GOODS,
  SELLABLE,
  acceptContract,
  basePrice,
  buyCost,
  cancelEarthOrder,
  contractFor,
  contractPay,
  dealOffer,
  divertResearch,
  earthPrices,
  emptyEarth,
  exportable,
  goodUnlocked,
  goodWords,
  hasSpaceport,
  orderFromEarth,
  researchRate,
  rocketPort,
  saleEstimate,
  stepEarth,
  supplyOf,
  tripCityYears,
  tripSubsteps,
  windowAt,
  windowIndex,
  windowStep,
  windowCityYears,
  windowYear,
} from "./earth.js";
export type { EarthOutcome } from "./earth.js";
export { EARTH_GOODS } from "./types.js";
export type { ContractKind, EarthContract, EarthFlight, EarthGood, EarthGoods, EarthOrder, EarthRecord, EarthState } from "./types.js";
