/**
 * Design doc §11 - serialization.
 *
 * "Because the sim is deterministic, a save is just the state vector, the
 * facilities, some meta, and a timestamp. No event log."
 *
 * TWO RULES, both from §11's design notes:
 *
 * 1. STORE ONLY THE STATE. Never `T`, `P`, `progress`, `phase` as computed
 *    values, never a visual channel. They are recomputed on load, so a tuning
 *    change applies retroactively to old saves instead of baking in stale
 *    numbers. The one apparent exception is `phase`, which §11 does store -
 *    but that is the LATCHED high-water mark, which is state (a milestone,
 *    once reached, stays reached) rather than the instantaneous evaluation.
 *
 * 2. A SAVE IS UNTRUSTED INPUT. It has been through JSON, disk, possibly a
 *    hand edit and certainly an older version of this code. Everything is
 *    validated on the way in, with a message that names the offending field:
 *    a corrupt save is a user-facing failure and "undefined is not a number"
 *    three ticks later is not a diagnosis.
 *
 * This file is pure. It never reads a clock - the caller passes the timestamp,
 * which is what keeps `src/sim/` free of `Date.now()` and keeps offline
 * catch-up reproducible.
 */

import { clamp01 } from "./math.js";
import { wrapLongitude } from "./micro/space.js";
import { capacities, housing, newSettlement } from "./micro/settlement.js";
import { roadKey, roadTile, roadsToConnect } from "./micro/network.js";
import { BUILDING_DEFS } from "./micro/buildings.js";
import { footprintTiles } from "./micro/space.js";
import { unlockedFor } from "./tech.js";
import { DEFAULT_TUNING } from "./tuning.js";
import { startingEconomy } from "./economy.js";
import type { Tuning } from "./tuning.js";
import type {
  EconomyState,
  Facility,
  FacilityType,
  Ledger,
  MutableLedger,
  MutableReservoirs,
  Phase,
  Reservoirs,
  SimState,
  Settlement,
  BuildingType,
  PlacedBuilding,
} from "./types.js";
import { BUILDING_TYPES, FACILITY_TYPES, LEDGER_KEYS, MICRO_RESOURCES, PHASE_ORDER, RESERVOIR_KEYS } from "./types.js";

/**
 * Current save shape.
 *
 * v1 is the shape §11 documents, and it is genuinely older than the engine:
 * it predates the nitrate reservoir (§3.6 described a trickle with no source),
 * the conservation ledger, the `seeded` flag, the facility deployment ramp and
 * the integer substep counter. Every one of those arrived in Batches 1 and 2,
 * so v1 -> v2 is a real migration with real decisions in it, not a placeholder.
 */
export const SAVE_SCHEMA_VERSION = 7;

export interface SavedFacility {
  readonly type: string;
  readonly count: number;
  readonly level: number;
  readonly enabled: boolean;
  /** Added in v2. Absent in v1, where capacity was instantaneous. */
  readonly deployed?: number;
}

export interface SaveFile {
  readonly schema_version: number;
  readonly planet_id: string;
  readonly seed: number;
  /**
   * Authoritative elapsed time, as an INTEGER substep count.
   *
   * `sim_year` beside it is a convenience for humans and is ignored on load
   * when this is present. Storing the integer is what keeps a reloaded save on
   * the same substep grid it was saved on - deriving it back from a rounded
   * float would let the grid drift by a substep per save/load cycle.
   */
  readonly steps: number;
  /** Derived, written for legibility, ignored on read when `steps` is present. */
  readonly sim_year: number;
  readonly last_saved_real: string;
  readonly phase: number;
  readonly reservoirs: Record<string, number>;
  /** Added in v2. Without it, conservation cannot be checked across a save. */
  readonly ledger?: Record<string, number>;
  /** Added in v2. §3.5's "life cannot grow from nothing", as persisted state. */
  readonly seeded?: boolean;
  readonly facilities: readonly SavedFacility[];
  readonly shield_strength: number;
  readonly tech_unlocked: readonly string[];
  readonly economy: EconomyState;
  /** Added in v4 (Batch 17): the micro layer's settlement registry. */
  readonly settlements?: readonly SavedSettlement[];
}

export interface SavedSettlement {
  readonly id: string;
  readonly kind: string;
  readonly lat: number;
  readonly lon: number;
  /**
   * Added in v5 (Batch 19). Only true state: people, the five stores, and what
   * is built where. Micro doc section 10's example also stores `capacities`
   * and a grid size; both are DERIVED - from the buildings and the tuning -
   * and storing them would bake a stale number into every save, which the
   * doc's own note forbids. They are recomputed on load.
   */
  readonly population?: number;
  readonly stores?: Record<string, number>;
  readonly buildings?: readonly { readonly type: string; readonly tx: number; readonly ty: number; readonly level: number }[];
  /**
   * Added in v6 (Batch 24): null while the settlement stands, or the sea
   * level it was lost at. True state - detail §4.7 keeps the record.
   */
  readonly lost_at_sea_level_m?: number | null;
  /**
   * Added in v7 (roads, at the user's request): the road tiles, as sorted
   * keys `ty * 1024 + tx`. Null only in a save carried forward from v6 - its
   * roads are laid on load, see `migrateV6toV7`.
   */
  readonly roads?: readonly number[] | null;
}

/**
 * Where saves live, as a contract rather than an implementation.
 *
 * The simulation owns the save SHAPE, so it owns this interface; hosts own the
 * storage. The browser implements it over IndexedDB, tests implement it in
 * memory, and a future server would implement it over a row - §11 notes the
 * shape is the same either way. Nothing here performs I/O; it is a type.
 */
export interface SaveStore {
  /** The raw stored value, or null if the slot is empty. Unvalidated on purpose - `fromSave` validates. */
  load(slot: string): Promise<unknown | null>;
  save(slot: string, data: SaveFile): Promise<void>;
  clear(slot: string): Promise<void>;
  /** False when persistence is unavailable, so the UI can say so rather than silently losing progress. */
  readonly durable: boolean;
}

export class SaveError extends Error {
  constructor(message: string) {
    super(`corrupt save: ${message}`);
    this.name = "SaveError";
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Serialize a state.
 *
 * `savedAtIso` is passed in rather than read from a clock, because `src/sim/`
 * has no clock by design (invariant #1) - the whole determinism guarantee
 * rests on it.
 */
export function toSave(state: SimState, t: Tuning, savedAtIso: string): SaveFile {
  assertFiniteState(state, "toSave");

  const reservoirs: Record<string, number> = {};
  for (const key of RESERVOIR_KEYS) reservoirs[key] = state.reservoirs[key];

  const ledger: Record<string, number> = {};
  for (const key of LEDGER_KEYS) ledger[key] = state.ledger[key];

  return {
    schema_version: SAVE_SCHEMA_VERSION,
    planet_id: state.planetId,
    seed: state.seed,
    steps: state.steps,
    sim_year: state.steps * t.SUBSTEP_YEARS,
    last_saved_real: savedAtIso,
    phase: state.phaseReached,
    reservoirs,
    ledger,
    seeded: state.seeded,
    facilities: state.facilities.map((f) => ({
      type: f.type,
      count: f.count,
      level: f.level,
      enabled: f.enabled,
      deployed: f.deployed,
    })),
    shield_strength: state.shieldStrength,
    tech_unlocked: [...state.techUnlocked],
    economy: { ...state.economy },
    settlements: state.settlements.map((s) => ({
      id: s.id,
      kind: s.kind,
      lat: s.lat,
      lon: s.lon,
      population: s.population,
      stores: { ...s.stores },
      buildings: s.buildings.map((b) => ({ type: b.type, tx: b.tx, ty: b.ty, level: b.level })),
      lost_at_sea_level_m: s.lostAtSeaLevelM,
      roads: [...s.roads],
    })),
  };
}

export function serialize(state: SimState, t: Tuning, savedAtIso: string): string {
  return JSON.stringify(toSave(state, t, savedAtIso));
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function deserialize(json: string, t: Tuning): SimState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new SaveError(`not valid JSON (${(error as Error).message})`);
  }
  return fromSave(parsed, t);
}

/**
 * Validate, migrate and load.
 *
 * Migration runs BEFORE validation of the current shape, so a v1 save is
 * brought forward and then held to exactly the same standard as one written
 * today.
 */
export function fromSave(raw: unknown, t: Tuning): SimState {
  const save = migrate(asRecord(raw, "save"), t);

  const steps = readSteps(save, t);
  const reservoirs = readReservoirs(save);
  const ledger = readLedger(save);

  const state: SimState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    planetId: readString(save, "planet_id"),
    seed: readFinite(save, "seed"),
    steps,
    reservoirs,
    ledger,
    shieldStrength: clamp01(readFinite(save, "shield_strength")),
    seeded: readBoolean(save, "seeded", reservoirs.biomass > 0),
    phaseReached: readPhase(save),
    facilities: readFacilities(save, t),
    techUnlocked: readStringArray(save, "tech_unlocked"),
    economy: readEconomy(save),
    settlements: readSettlements(save, t),
  };

  assertFiniteState(state, "fromSave");
  return state;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

function migrate(save: Record<string, unknown>, t: Tuning): Record<string, unknown> {
  const version = save["schema_version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new SaveError(`schema_version must be a positive integer, got ${JSON.stringify(version)}`);
  }
  if (version > SAVE_SCHEMA_VERSION) {
    throw new SaveError(
      `written by a newer version (schema_version ${version}, this build understands ${SAVE_SCHEMA_VERSION})`,
    );
  }

  let current = save;
  if (version < 2) current = migrateV1toV2(current);
  if (version < 3) current = migrateV2toV3(current);
  if (version < 4) current = migrateV3toV4(current);
  if (version < 5) current = migrateV4toV5(current, t);
  if (version < 6) current = migrateV5toV6(current);
  if (version < 7) current = migrateV6toV7(current);
  return current;
}

/**
 * v6 -> v7: roads. A v6 settlement had none, and needed none - every
 * building was on the network. Marked null here and, once its buildings are
 * read, given the roads that connect what it had (`roadsToConnect`), free: a
 * player who built a working city must not load it to find a new rule has
 * switched it off. Where the ground makes a join impossible, that part stays
 * unconnected, as it would for a player.
 */
function migrateV6toV7(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 7 };
  const settlements = list.map((raw) => (typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>), roads: null } : raw));
  return { ...save, schema_version: 7, settlements };
}

/** v3 -> v4 (Batch 17): no settlement existed before the micro layer, so the registry starts empty. */
/**
 * v4 -> v5 (Batch 19): v4 saved where each settlement is and what kind, and
 * nothing else, so each one comes forward exactly as it loaded before - newly
 * founded, with the founding stock.
 */
/** v5 -> v6: every settlement stood - nothing could be lost to a sea that did not flood yet. */
function migrateV5toV6(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 6 };
  const settlements = list.map((raw) => (typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>), lost_at_sea_level_m: null } : raw));
  return { ...save, schema_version: 6, settlements };
}

function migrateV4toV5(save: Record<string, unknown>, t: Tuning): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 5 };
  const settlements = list.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const s = raw as Record<string, unknown>;
    const founded = newSettlement("", "city", 0, 0, t);
    return { ...s, population: founded.population, stores: { ...founded.stores }, buildings: [] };
  });
  return { ...save, schema_version: 5, settlements };
}

function migrateV3toV4(save: Record<string, unknown>): Record<string, unknown> {
  return { ...save, schema_version: 4, settlements: [] };
}

/**
 * v1 -> v2.
 *
 * Four fields arrived after §11 was written, and each needs a decision rather
 * than a default:
 *
 * - `n2_reg` becomes 0, not the Mars start value of 20. A v1 world was played
 *   without a nitrate reservoir, and handing it 20 mbar on load would
 *   materialise nitrogen that world never had.
 * - `ledger` becomes zero across the board. The accounts cannot be
 *   reconstructed - a v1 save has no record of how much carbon the biosphere
 *   fixed - and zeroing them is harmless, because conservation is checked as
 *   drift from the loaded baseline rather than against an absolute constant.
 * - `seeded` is inferred from biomass: if a v1 world has a biosphere, it was
 *   seeded, because §3.5 is the only way to get one.
 * - facility `deployed` becomes `count * level`, fully online. v1 predates the
 *   deployment ramp, so its capacity was instantaneous; starting it at 0 would
 *   silently switch off a loaded player's whole industry.
 */
function migrateV1toV2(save: Record<string, unknown>): Record<string, unknown> {
  const reservoirs = { ...asRecord(save["reservoirs"], "reservoirs") };
  if (reservoirs["n2_reg"] === undefined) reservoirs["n2_reg"] = 0;

  const facilities = asArray(save["facilities"] ?? [], "facilities").map((entry, i) => {
    const f = asRecord(entry, `facilities[${i}]`);
    const count = numberAt(f, "count", `facilities[${i}].count`);
    const level = numberAt(f, "level", `facilities[${i}].level`);
    return { ...f, deployed: f["deployed"] ?? count * level };
  });

  const zeroLedger: Record<string, number> = {};
  for (const key of LEDGER_KEYS) zeroLedger[key] = 0;

  return {
    ...save,
    schema_version: 2,
    reservoirs,
    facilities,
    ledger: save["ledger"] ?? zeroLedger,
    seeded: save["seeded"] ?? Number(reservoirs["biomass"] ?? 0) > 0,
  };
}


/**
 * v2 -> v3: the `economy` placeholder becomes real state.
 *
 * v2 wrote `economy: null`, because §11 left it "TBD". A v2 world was played
 * without costs, so it is loaded with the STARTING balance rather than zero -
 * arriving in a priced world with no credits would strand a player who had
 * done nothing wrong, and there is no honest way to reconstruct what they
 * would have banked.
 *
 * `tech_unlocked` is rebuilt from the latched phase for the same reason: v2
 * never wrote one, and an empty list would make a late-game save unable to
 * build anything it already owns.
 */
function migrateV2toV3(save: Record<string, unknown>): Record<string, unknown> {
  const existing = save["economy"];
  const economy =
    existing !== null && typeof existing === "object" ? existing : { ...startingEconomy(DEFAULT_TUNING) };

  const phase = Number(save["phase"] ?? 0);
  const unlocked = asArray(save["tech_unlocked"] ?? [], "tech_unlocked").map(String);
  const rebuilt = unlocked.length > 0 ? unlocked : [...unlockedFor(clampPhase(phase), [])];

  return { ...save, schema_version: 3, economy, tech_unlocked: rebuilt };
}

/** Phase numbers from a save are untrusted; `readPhase` validates later, this only has to be safe. */
function clampPhase(value: number): Phase {
  const i = Number.isFinite(value) ? Math.floor(value) : 0;
  return (i < 0 ? 0 : i > 6 ? 6 : i) as Phase;
}

function readEconomy(save: Record<string, unknown>): EconomyState {
  const raw = save["economy"];
  if (raw === null || typeof raw !== "object") return { ...startingEconomy(DEFAULT_TUNING) };
  const e = raw as Record<string, unknown>;
  const num = (key: string): number => {
    const v = e[key];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  };
  return { credits: num("credits"), earned: num("earned"), spent: num("spent") };
}

// ---------------------------------------------------------------------------
// Field readers - each names the field it rejected
// ---------------------------------------------------------------------------

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SaveError(`${what} must be an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new SaveError(`${what} must be an array, got ${describe(value)}`);
  return value;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

function numberAt(source: Record<string, unknown>, key: string, what: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SaveError(`${what} must be a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function readFinite(save: Record<string, unknown>, key: string): number {
  return numberAt(save, key, key);
}

function readString(save: Record<string, unknown>, key: string): string {
  const value = save[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new SaveError(`${key} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function readBoolean(save: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = save[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new SaveError(`${key} must be a boolean, got ${describe(value)}`);
  return value;
}

function readStringArray(save: Record<string, unknown>, key: string): readonly string[] {
  const value = save[key];
  if (value === undefined) return [];
  return asArray(value, key).map((entry, i) => {
    if (typeof entry !== "string") throw new SaveError(`${key}[${i}] must be a string, got ${describe(entry)}`);
    return entry;
  });
}

/**
 * Elapsed time, preferring the integer substep count.
 *
 * `sim_year` is only used when `steps` is absent, which is the v1 case and the
 * hand-written case. Rounding is explicit so the state lands back on the
 * substep grid rather than a fraction of the way between two steps.
 */
function readSteps(save: Record<string, unknown>, t: Tuning): number {
  const steps = save["steps"];
  if (typeof steps === "number") {
    if (!Number.isFinite(steps) || steps < 0) {
      throw new SaveError(`steps must be a non-negative finite number, got ${steps}`);
    }
    return Math.round(steps);
  }
  const years = save["sim_year"];
  if (typeof years !== "number" || !Number.isFinite(years) || years < 0) {
    throw new SaveError(`neither steps nor sim_year is a usable number (sim_year: ${JSON.stringify(years)})`);
  }
  return Math.round(years / t.SUBSTEP_YEARS);
}

function readReservoirs(save: Record<string, unknown>): Reservoirs {
  const source = asRecord(save["reservoirs"], "reservoirs");
  const out = {} as MutableReservoirs;
  for (const key of RESERVOIR_KEYS) {
    const value = numberAt(source, key, `reservoirs.${key}`);
    if (value < 0) throw new SaveError(`reservoirs.${key} is negative (${value})`);
    out[key] = value;
  }
  // biomass is an index, not a mass, and nothing downstream expects it above 1.
  out.biomass = clamp01(out.biomass);
  return out;
}

function readLedger(save: Record<string, unknown>): Ledger {
  const source = save["ledger"] === undefined ? {} : asRecord(save["ledger"], "ledger");
  const out = {} as MutableLedger;
  for (const key of LEDGER_KEYS) {
    const value = source[key];
    if (value === undefined) {
      out[key] = 0;
      continue;
    }
    out[key] = numberAt(source, key, `ledger.${key}`);
  }
  return out;
}

function readPhase(save: Record<string, unknown>): Phase {
  const value = save["phase"];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SaveError(`phase must be an integer, got ${JSON.stringify(value)}`);
  }
  const match = PHASE_ORDER.find((p) => p === value);
  if (match === undefined) {
    throw new SaveError(`phase ${value} is outside 0..${PHASE_ORDER.length - 1}`);
  }
  return match;
}

const FACILITY_TYPE_SET = new Set<string>(FACILITY_TYPES);

/**
 * The settlement registry, held to the same standard as every other field:
 * reject what cannot be meant, repair only what has one honest reading.
 *
 * A longitude outside (-pi, pi] still names a real place, so it is wrapped. A
 * latitude past a pole names nothing, so it is rejected - as are duplicate
 * ids (two settlements the save cannot tell apart) and unknown kinds.
 */
function readSettlements(save: Record<string, unknown>, t: Tuning): readonly Settlement[] {
  const seen = new Set<string>();
  return asArray(save["settlements"], "settlements").map((raw, i) => {
    const s = asRecord(raw, `settlements[${i}]`);
    const id = s["id"];
    if (typeof id !== "string" || id.length === 0) throw new SaveError(`settlements[${i}].id must be a non-empty string`);
    if (seen.has(id)) throw new SaveError(`settlements[${i}].id "${id}" appears more than once`);
    seen.add(id);
    const kind = s["kind"];
    if (kind !== "city" && kind !== "outpost" && kind !== "metropolis") {
      throw new SaveError(`settlements[${i}].kind must be "city", "outpost" or "metropolis", got ${describe(kind)}`);
    }
    const lat = numberAt(s, "lat", `settlements[${i}].lat`);
    if (Math.abs(lat) > Math.PI / 2) throw new SaveError(`settlements[${i}].lat ${lat} is past a pole`);
    const lon = wrapLongitude(numberAt(s, "lon", `settlements[${i}].lon`));
    const where = `settlements[${i}]`;
    const buildings = readBuildings(s, where);

    // Everything below is held to Batch 14's lesson: a save is read under the
    // tuning of the build that LOADS it, so anything a retune could change is
    // clamped or kept, never rejected. Rejecting would hand the player a
    // fresh Mars in place of a legitimate save.
    const base = newSettlement(id, kind, lat, lon, t);
    const draft: Settlement = { ...base, buildings };
    const cap = capacities(draft, t);
    const storesRaw = asRecord(s["stores"], `${where}.stores`);
    const stores = { ...base.stores };
    for (const r of MICRO_RESOURCES) {
      const v = numberAt(storesRaw, r, `${where}.stores.${r}`);
      if (v < 0) throw new SaveError(`${where}.stores.${r} is negative (${v})`);
      // Above today's capacity is legal after a retune shrank it: clamp.
      stores[r] = Math.min(v, cap[r]);
    }
    const population = numberAt(s, "population", `${where}.population`);
    if (population < 0) throw new SaveError(`${where}.population is negative (${population})`);
    // Above today's housing is legal after a retune shrank the domes: clamp.
    // v6: a settlement lost to the sea. A ruin that still has buildings or
    // people is not a state the game can produce, and no retune makes it one.
    const lostRaw = s["lost_at_sea_level_m"];
    let lostAtSeaLevelM: number | null = null;
    if (lostRaw !== null) {
      lostAtSeaLevelM = numberAt(s, "lost_at_sea_level_m", `${where}.lost_at_sea_level_m`);
      if (buildings.length > 0 || population > 0) {
        throw new SaveError(`${where} was lost to the sea but still has ${buildings.length > 0 ? "buildings" : "people"}`);
      }
    }
    const standing: Settlement = { ...draft, stores, population: Math.min(population, housing(draft, t)), lostAtSeaLevelM };
    // v7: roads; null only for a settlement carried forward from v6.
    if (s["roads"] === null) return { ...standing, roads: [...roadsToConnect(standing, t)] };
    return { ...standing, roads: readRoads(s, where, buildings) };
  });
}

/**
 * A settlement's roads. Rejects what cannot be meant: a key that is not a
 * whole tile, the same road twice, or a road under a building. A road off a
 * grid a retune has shrunk is KEPT, like a building: it is drawn and joins
 * nothing, and dropping it would destroy what the player built.
 */
function readRoads(s: Record<string, unknown>, where: string, buildings: readonly PlacedBuilding[]): readonly number[] {
  const under = new Set<number>();
  for (const b of buildings) {
    const size = BUILDING_DEFS[b.type].footprint;
    for (const [x, y] of footprintTiles({ tx: b.tx, ty: b.ty, w: size, h: size })) under.add(roadKey(x, y));
  }
  const seen = new Set<number>();
  asArray(s["roads"], `${where}.roads`).forEach((raw, j) => {
    const at = `${where}.roads[${j}]`;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) throw new SaveError(`${at} must be a road key (a whole number from 0), got ${describe(raw)}`);
    const { tx, ty } = roadTile(raw);
    if (seen.has(raw)) throw new SaveError(`${at} repeats the road at tile ${tx},${ty}`);
    if (under.has(raw)) throw new SaveError(`${at} lies under a building at tile ${tx},${ty}`);
    seen.add(raw);
  });
  return [...seen].sort((a, b) => a - b);
}

/**
 * A settlement's buildings. Rejects only what cannot be meant: an unknown
 * type, a tile or level that is not a whole number, or two buildings on the
 * same ground. A building off a grid a retune has shrunk, or in a kind of
 * settlement a later build forbids it in, is KEPT - the simulation does not
 * care where a building stands, and dropping it would destroy what the player
 * built.
 */
function readBuildings(s: Record<string, unknown>, where: string): readonly PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  const taken = new Map<string, number>();
  asArray(s["buildings"], `${where}.buildings`).forEach((raw, j) => {
    const at = `${where}.buildings[${j}]`;
    const b = asRecord(raw, at);
    const type = b["type"];
    if (typeof type !== "string" || !(BUILDING_TYPES as readonly string[]).includes(type)) {
      throw new SaveError(`${at}.type ${typeof type === "string" ? JSON.stringify(type) : describe(type)} is not a known building`);
    }
    const tx = numberAt(b, "tx", `${at}.tx`);
    const ty = numberAt(b, "ty", `${at}.ty`);
    const level = numberAt(b, "level", `${at}.level`);
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) throw new SaveError(`${at} is not on a whole tile (${tx}, ${ty})`);
    if (!Number.isInteger(level) || level < 1) throw new SaveError(`${at}.level must be a whole number from 1, got ${level}`);
    const size = BUILDING_DEFS[type as BuildingType].footprint;
    for (const [x, y] of footprintTiles({ tx, ty, w: size, h: size })) {
      const key = `${x},${y}`;
      const other = taken.get(key);
      if (other !== undefined) throw new SaveError(`${at} overlaps ${where}.buildings[${other}] at tile ${key}`);
      taken.set(key, j);
    }
    out.push({ type: type as BuildingType, tx, ty, level });
  });
  return out;
}

function readFacilities(save: Record<string, unknown>, t: Tuning): readonly Facility[] {
  const entries = save["facilities"] === undefined ? [] : asArray(save["facilities"], "facilities");
  const seen = new Set<string>();

  return entries.map((entry, i) => {
    const f = asRecord(entry, `facilities[${i}]`);
    const type = f["type"];
    if (typeof type !== "string" || !FACILITY_TYPE_SET.has(type)) {
      throw new SaveError(`facilities[${i}].type is not a known lever: ${JSON.stringify(type)}`);
    }
    // Duplicate entries would make `orderedUnits` and `deployedUnitsOf`
    // disagree, since one reads a single entry and the other sums them all.
    if (seen.has(type)) throw new SaveError(`facilities has more than one entry for ${type}`);
    seen.add(type);

    const count = Math.max(0, Math.round(numberAt(f, "count", `facilities[${i}].count`)));
    const level = Math.max(1, Math.round(numberAt(f, "level", `facilities[${i}].level`)));
    const enabled = f["enabled"];
    if (typeof enabled !== "boolean") {
      throw new SaveError(`facilities[${i}].enabled must be a boolean, got ${describe(enabled)}`);
    }
    const deployedRaw = f["deployed"];
    const deployed =
      deployedRaw === undefined ? count * level : numberAt(f, "deployed", `facilities[${i}].deployed`);
    if (deployed < 0) throw new SaveError(`facilities[${i}].deployed is negative (${deployed})`);
    // CLAMPED to the facility cap, not rejected. Batch 13 rejected it, but a
    // save is read under the tuning of the build that loads it: any retune
    // that lowered a cap turned a legitimate 250-unit array into a SaveError,
    // which boot answers with a fresh Mars - and the autosaver then writes
    // over the slot (Batch 14). Above count*level stays legitimate: a
    // dismantled lever ramps DOWN through it.
    const maxUnits = t.FACILITY_MAX_COUNT * t.FACILITY_MAX_LEVEL;
    return { type: type as FacilityType, count, level, enabled, deployed: Math.min(deployed, maxUnits) };
  });
}

/**
 * Finiteness on the way OUT as well as in.
 *
 * A NaN reaching `JSON.stringify` becomes `null`, which then fails validation
 * on load with a message pointing at the reader rather than at whatever
 * produced the NaN hours earlier. Catching it at write time puts the error
 * where the bug is.
 */
function assertFiniteState(state: SimState, where: string): void {
  for (const key of RESERVOIR_KEYS) {
    const value = state.reservoirs[key];
    if (!Number.isFinite(value)) throw new SaveError(`${where}: reservoirs.${key} is ${value}`);
  }
  for (const key of LEDGER_KEYS) {
    const value = state.ledger[key];
    if (!Number.isFinite(value)) throw new SaveError(`${where}: ledger.${key} is ${value}`);
  }
  if (!Number.isFinite(state.steps)) throw new SaveError(`${where}: steps is ${state.steps}`);
  if (!Number.isFinite(state.shieldStrength)) {
    throw new SaveError(`${where}: shieldStrength is ${state.shieldStrength}`);
  }
}
