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
import { EMPTY_HISTORY, NAME_MAX, capacities, housing, newSettlement, shiftContent } from "./micro/settlement.js";
import { LAYERS, linksToConnect } from "./micro/network.js";
import type { Layer } from "./micro/network.js";
import { headquartersOrigin } from "./micro/settlement.js";
import { chunkKey, frameOf, gridTiles, keyChunk, keyTile, tileKey } from "./micro/space.js";
import { BUILDING_DEFS } from "./micro/buildings.js";
import { footprintTiles } from "./micro/space.js";
import { unlockedFor } from "./tech.js";
import { DEFAULT_TUNING } from "./tuning.js";
import { startingEconomy } from "./economy.js";
import type { Tuning } from "./tuning.js";
import type {
  EconomyState,
  Grade,
  Facility,
  FacilityType,
  Ledger,
  MutableLedger,
  MutableReservoirs,
  Phase,
  Reservoirs,
  Route,
  SimState,
  Settlement,
  SettlementJob,
  BuildingType,
  DecisionKind,
  DecisionRecord,
  DecisionVariant,
  OpenDecision,
  PlacedBuilding,
  SettlementEffect,
  ContractKind,
  EarthContract,
  EarthFlight,
  EarthGood,
  EarthGoods,
  EarthOrder,
  EarthRecord,
  EarthState,
} from "./types.js";
import { BUILDING_TYPES, EARTH_GOODS, FACILITY_TYPES, LEDGER_KEYS, MICRO_RESOURCES, PHASE_ORDER, RESERVOIR_KEYS } from "./types.js";
import { NO_GOODS, SELLABLE, emptyEarth } from "./earth.js";

/**
 * Current save shape.
 *
 * v1 is the shape §11 documents, and it is genuinely older than the engine:
 * it predates the nitrate reservoir (§3.6 described a trickle with no source),
 * the conservation ledger, the `seeded` flag, the facility deployment ramp and
 * the integer substep counter. Every one of those arrived in Batches 1 and 2,
 * so v1 -> v2 is a real migration with real decisions in it, not a placeholder.
 */
export const SAVE_SCHEMA_VERSION = 19;

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
  /** Added in v13: railways between settlements. */
  readonly routes?: readonly { readonly a: string; readonly b: string; readonly km: number }[];
  /**
   * Added in v16 (Batch 30, the first hour): the guided steps done, whether
   * the guide was skipped, and the objectives claimed. Never any progress -
   * that is derived from the rest of the save on load.
   */
  readonly goals?: { readonly guide: number; readonly guide_skipped: boolean; readonly claimed: readonly string[] };
  /**
   * Added in v17 (Batch 31, statistics): the planet's record - a sample every
   * `every` substeps, oldest first. A world saved before it starts recording
   * on load.
   */
  readonly history?: { readonly every: number; readonly samples: readonly Record<string, number>[] };
  /**
   * Added in v18 (Batch 33, events that ask for decisions): the events open
   * now, with the player's choice if made, and the record of those resolved.
   * When a card is dealt is never kept: it is a function of the seed.
   */
  readonly decisions?: { readonly open: readonly Record<string, unknown>[]; readonly log: readonly Record<string, unknown>[] };
  /**
   * Added in v19 (Batch 34, Earth): the player's reputation, the market's
   * memory of their trade, the orders waiting for a window, the rockets away,
   * Earth's offer and the contracts taken, and the record. When a window
   * opens and what its market asks are never kept: they are the orbit's and
   * the seed's.
   */
  readonly earth?: Record<string, unknown>;
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
  /**
   * Added in v8 (corridors and cables, at the user's request, in place of
   * v7's roads): each network's tiles, as sorted keys. Null only in a save
   * carried forward from v6 - laid on load, see `migrateV7toV8`.
   */
  readonly corridors?: readonly number[] | null;
  readonly cables?: readonly number[] | null;
  /** Added in v8: the rock tiles rovers have broken, as sorted keys. */
  readonly cleared?: readonly number[];
  /**
   * Added in v8: rovers and rockets under way, counting down in sim-years.
   * v15 (Batch 29): a rover's job may carry its `route`, the tile keys where
   * it turns; one saved before routes has none, and keeps its time.
   */
  readonly jobs?: readonly Record<string, unknown>[];
  /** Added in v9 (claimed land, at the user's request): the founding square's edge, tiles. */
  readonly base?: number;
  /** Added in v9: the chunks claimed beyond it, as sorted chunk keys. */
  readonly claims?: readonly number[];
  /** Added in v10 (levelling, at the user's request): levelled tiles, in the order they were, each `{ tile, height_m }`. */
  readonly grades?: readonly { readonly tile: number; readonly height_m: number }[];
  /** Added in v11 (stations, at the user's request): railway tiles, as sorted keys. */
  readonly rails?: readonly number[];
  /** Added in v12 (the city planner, at the user's request): its name, zones, the rovers' queue, the plan, and its record. */
  readonly name?: string;
  readonly zones?: readonly { readonly id: number; readonly name: string; readonly colour: string; readonly tiles: readonly number[] }[];
  readonly level_queue?: readonly { readonly tile: number; readonly level_m: number }[];
  readonly planned?: readonly { readonly layer: string; readonly tile: number }[];
  readonly history?: Record<string, unknown>;
  /** Added in v14 (real build times): builds and upgrades waiting for a rover, `{ tile, upgrade, paid }`. */
  readonly build_queue?: readonly { readonly tile: number; readonly upgrade: boolean; readonly paid: number }[];
  /** Added in v16 (the first hour): rovers landed as an objective's reward. */
  readonly extra_rovers?: number;
  /** Added in v18 (Batch 33): what answered events leave on the city - sheltering, a quarantine, a fault. */
  readonly effects?: readonly { readonly kind: string; readonly tile: number | null; readonly factor: number; readonly remaining: number; readonly event: number }[];
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
      corridors: [...s.corridors],
      cables: [...s.cables],
      cleared: [...s.cleared],
      jobs: s.jobs.map((j) => ({ ...j })),
      base: s.base,
      claims: [...s.claims],
      grades: s.grades.map((g) => ({ tile: g.tile, height_m: g.heightM })),
      rails: [...s.rails],
      name: s.name,
      zones: s.zones.map((z) => ({ id: z.id, name: z.name, colour: z.colour, tiles: [...z.tiles] })),
      level_queue: s.levelQueue.map((q) => ({ tile: q.tile, level_m: q.levelM })),
      build_queue: s.buildQueue.map((q) => ({ tile: q.tile, upgrade: q.upgrade, paid: q.paid })),
      extra_rovers: s.extraRovers,
      effects: s.effects.map((e) => ({ kind: e.kind, tile: e.tile, factor: e.factor, remaining: e.remaining, event: e.event })),
      planned: s.planned.map((p) => ({ layer: p.layer, tile: p.tile })),
      history: {
        acc: {
          ...s.history.acc,
          short: [...s.history.acc.short],
          net: [...s.history.acc.net],
          made: s.history.acc.made === null ? null : [...s.history.acc.made],
          drawn: s.history.acc.drawn === null ? null : [...s.history.acc.drawn],
        },
        taken: s.history.taken,
        samples: s.history.samples.map((x) => ({
          ...x,
          short: [...x.short],
          stores: [...x.stores],
          net: [...x.net],
          ...(x.made === undefined ? {} : { made: [...x.made] }),
          ...(x.drawn === undefined ? {} : { drawn: [...x.drawn] }),
        })),
      },
    })),
    routes: state.routes.map((r) => ({ a: r.a, b: r.b, km: r.km })),
    goals: { guide: state.goals.guide, guide_skipped: state.goals.guideSkipped, claimed: [...state.goals.claimed] },
    history: { every: state.history.every, samples: state.history.samples.map((x) => ({ ...x })) },
    decisions: {
      open: state.decisions.open.map((e) => ({ ...e, at: e.at === null ? null : { ...e.at } })),
      log: state.decisions.log.map((r) => ({ ...r, outcome: { ...r.outcome } })),
    },
    earth: {
      reputation: state.earth.reputation,
      fulfilled: state.earth.fulfilled,
      failed: state.earth.failed,
      bought: { ...state.earth.bought },
      sold: { ...state.earth.sold },
      orders: state.earth.orders.map((o) => ({ ...o })),
      flights: state.earth.flights.map((f) => ({ ...f, cargo: { ...f.cargo }, paid: { ...f.paid } })),
      offer: state.earth.offer === null ? null : { ...state.earth.offer },
      contracts: state.earth.contracts.map((c) => ({ ...c })),
      log: state.earth.log.map((r) => ({ ...r, goods: { ...r.goods } })),
      spent: state.earth.spent,
      earned: state.earth.earned,
      rewards: state.earth.rewards,
      next_id: state.earth.nextId,
    },
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

  const settlements = readSettlements(save, t);
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
    settlements,
    routes: readRoutes(save, settlements),
    goals: readGoals(save),
    history: readPlanetHistory(save, steps),
    decisions: readDecisions(save, settlements, steps),
    earth: readEarth(save, settlements, steps),
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
  if (version < 8) current = migrateV7toV8(current);
  if (version < 9) current = migrateV8toV9(current);
  if (version < 10) current = migrateV9toV10(current);
  if (version < 11) current = migrateV10toV11(current);
  if (version < 12) current = migrateV11toV12(current);
  if (version < 13) current = { ...current, schema_version: 13, routes: [] };
  if (version < 14) current = migrateV13toV14(current);
  // v14 -> v15: a job may carry its route (Batch 29). Nothing to add: a job under way before routes keeps the
  // straight drive its time was set by (`readJobs` takes a job without one as that).
  if (version < 15) current = { ...current, schema_version: 15 };
  // v15 -> v16: the first hour (Batch 30). Nothing of it was done: a world made before it has the guide and the
  // objectives off in its recorded tuning, so this is what it keeps.
  if (version < 16) current = migrateV15toV16(current);
  // v16 -> v17: statistics (Batch 31). The planet's record starts empty, and a city's record keeps what it has.
  if (version < 17) current = migrateV16toV17(current, t);
  // v17 -> v18: events that ask for decisions (Batch 33). None was open and none had happened: a world made before them
  // has them off in its recorded tuning, so this is what it keeps; no city has anything left on it by one.
  if (version < 18) current = migrateV17toV18(current);
  // v18 -> v19: Earth (Batch 34). Nothing traded, nothing offered: a world made before it has Earth off in its
  // recorded tuning, so this is what it keeps.
  if (version < 19) current = migrateV18toV19(current, t);
  return current;
}

/** v18 -> v19: Earth as a world starts it - the starting reputation, nothing ordered, away, offered or recorded. */
function migrateV18toV19(save: Record<string, unknown>, t: Tuning): Record<string, unknown> {
  const e = emptyEarth(t);
  return {
    ...save,
    schema_version: 19,
    earth: { reputation: e.reputation, fulfilled: 0, failed: 0, bought: { ...NO_GOODS }, sold: { ...NO_GOODS }, orders: [], flights: [], offer: null, contracts: [], log: [], spent: 0, earned: 0, rewards: 0, next_id: e.nextId },
  };
}

const EARTH_GOOD_SET: ReadonlySet<string> = new Set<string>(EARTH_GOODS);
const CONTRACT_KIND_SET: ReadonlySet<string> = new Set<string>(["materials", "water", "research"]);
const EARTH_RECORD_SET: ReadonlySet<string> = new Set<string>(["launched", "landed", "missed", "fulfilled", "failed"]);

/** v19: an amount of each of Earth's goods, none negative. */
function readGoods(raw: unknown, at: string): EarthGoods {
  const x = asRecord(raw, at);
  const out = { ...NO_GOODS };
  for (const g of EARTH_GOODS) {
    const v = numberAt(x, g, `${at}.${g}`);
    if (!(v >= 0)) throw new SaveError(`${at}.${g} must be >= 0, got ${v}`);
    out[g] = v;
  }
  return out;
}

/** v19: a contract - a known kind, an amount, what is sent toward it, its pay and its window. */
function readContract(raw: unknown, at: string): EarthContract {
  const x = asRecord(raw, at);
  const kind = x["kind"];
  if (typeof kind !== "string" || !CONTRACT_KIND_SET.has(kind)) throw new SaveError(`${at}.kind must be "materials", "water" or "research", got ${describe(kind)}`);
  const amount = numberAt(x, "amount", `${at}.amount`);
  if (!(amount > 0)) throw new SaveError(`${at}.amount must be > 0, got ${amount}`);
  const delivered = numberAt(x, "delivered", `${at}.delivered`);
  if (!(delivered >= 0)) throw new SaveError(`${at}.delivered must be >= 0, got ${delivered}`);
  const reward = numberAt(x, "reward", `${at}.reward`);
  if (!(reward >= 0)) throw new SaveError(`${at}.reward must be >= 0, got ${reward}`);
  const id = wholeAt(x, "id", `${at}.id`, 1);
  const due = wholeAt(x, "due", `${at}.due`);
  if (due <= id) throw new SaveError(`${at}.due must come after the launch it was offered at`);
  const accepted = x["accepted"];
  if (typeof accepted !== "boolean") throw new SaveError(`${at}.accepted must be true or false`);
  return { id, kind: kind as ContractKind, amount, delivered, reward, due, accepted };
}

/**
 * v19: Earth - a reputation in [0, 100], the market's memory, orders and
 * flights for this world's settlements, the offer and the contracts, and the
 * record; nothing placed or launched after the world's own time, and every
 * order, flight and record a number of its own below the next one.
 */
function readEarth(save: Record<string, unknown>, settlements: readonly Settlement[], steps: number): EarthState {
  const raw = asRecord(save["earth"], "earth");
  const ids = new Set(settlements.map((s) => s.id));
  const reputation = numberAt(raw, "reputation", "earth.reputation");
  if (!(reputation >= 0 && reputation <= 100)) throw new SaveError(`earth.reputation must be in [0, 100], got ${reputation}`);
  const nextId = wholeAt(raw, "next_id", "earth.next_id", 1);
  const used = new Set<number>();
  const idOf = (x: Record<string, unknown>, at: string): number => {
    const id = wholeAt(x, "id", `${at}.id`, 1);
    if (id >= nextId) throw new SaveError(`${at}.id ${id} is not below earth.next_id ${nextId}`);
    if (used.has(id)) throw new SaveError(`${at}.id ${id} is used twice`);
    used.add(id);
    return id;
  };
  const place = (x: Record<string, unknown>, at: string): string => {
    const settlement = x["settlement"];
    if (typeof settlement !== "string" || !ids.has(settlement)) throw new SaveError(`${at}.settlement must be a settlement of this world, got ${describe(settlement)}`);
    return settlement;
  };
  const orders = asArray(raw["orders"], "earth.orders").map((item, i): EarthOrder => {
    const at = `earth.orders[${i}]`;
    const x = asRecord(item, at);
    const good = x["good"];
    if (typeof good !== "string" || !EARTH_GOOD_SET.has(good)) throw new SaveError(`${at}.good must be one of Earth's goods, got ${describe(good)}`);
    const side = x["side"];
    if (side !== "buy" && side !== "sell") throw new SaveError(`${at}.side must be "buy" or "sell", got ${describe(side)}`);
    // A sale is of a store a rocket can carry off: Earth buys no settlers or rovers.
    if (side === "sell" && !SELLABLE.includes(good as EarthGood)) throw new SaveError(`${at} sells ${good}, which Earth does not buy`);
    const paid = numberAt(x, "paid", `${at}.paid`);
    if (!(paid >= 0) || (side === "sell" && paid !== 0)) throw new SaveError(`${at}.paid must be >= 0, and 0 for a sale, got ${paid}`);
    const placed = wholeAt(x, "placed", `${at}.placed`);
    if (placed > steps) throw new SaveError(`${at} was placed after the world's own time`);
    return { id: idOf(x, at), settlement: place(x, at), good: good as EarthGood, side, amount: wholeAt(x, "amount", `${at}.amount`, 1), paid, placed };
  });
  const flights = asArray(raw["flights"], "earth.flights").map((item, i): EarthFlight => {
    const at = `earth.flights[${i}]`;
    const x = asRecord(item, at);
    const launched = wholeAt(x, "launched", `${at}.launched`);
    if (launched > steps) throw new SaveError(`${at} lifted off after the world's own time`);
    const arrives = wholeAt(x, "arrives", `${at}.arrives`);
    if (arrives <= launched) throw new SaveError(`${at}.arrives must come after it lifted off`);
    return { id: idOf(x, at), settlement: place(x, at), tile: wholeAt(x, "tile", `${at}.tile`), launched, arrives, cargo: readGoods(x["cargo"], `${at}.cargo`), paid: readGoods(x["paid"], `${at}.paid`) };
  });
  const offerRaw = raw["offer"];
  const offer = offerRaw === null ? null : readContract(offerRaw, "earth.offer");
  if (offer !== null && offer.accepted) throw new SaveError("earth.offer is accepted already: it belongs with the contracts");
  const contracts = asArray(raw["contracts"], "earth.contracts").map((item, i) => {
    const c = readContract(item, `earth.contracts[${i}]`);
    if (!c.accepted) throw new SaveError(`earth.contracts[${i}] was never accepted`);
    return c;
  });
  const log = asArray(raw["log"], "earth.log").map((item, i): EarthRecord => {
    const at = `earth.log[${i}]`;
    const x = asRecord(item, at);
    const kind = x["kind"];
    if (typeof kind !== "string" || !EARTH_RECORD_SET.has(kind)) throw new SaveError(`${at}.kind must be a record's kind, got ${describe(kind)}`);
    const step = wholeAt(x, "step", `${at}.step`);
    if (step > steps) throw new SaveError(`${at} happened after the world's own time`);
    const settlement = x["settlement"] === null ? null : place(x, at);
    const contract = x["contract"];
    if (contract !== null && (typeof contract !== "string" || !CONTRACT_KIND_SET.has(contract))) throw new SaveError(`${at}.contract must be a contract's kind or null, got ${describe(contract)}`);
    return {
      id: idOf(x, at),
      kind: kind as EarthRecord["kind"],
      step,
      settlement,
      contract: contract as ContractKind | null,
      goods: readGoods(x["goods"], `${at}.goods`),
      credits: numberAt(x, "credits", `${at}.credits`),
      reputation: numberAt(x, "reputation", `${at}.reputation`),
    };
  });
  const total = (key: string): number => {
    const v = numberAt(raw, key, `earth.${key}`);
    if (!(v >= 0)) throw new SaveError(`earth.${key} must be >= 0, got ${v}`);
    return v;
  };
  return {
    reputation,
    fulfilled: wholeAt(raw, "fulfilled", "earth.fulfilled"),
    failed: wholeAt(raw, "failed", "earth.failed"),
    bought: readGoods(raw["bought"], "earth.bought"),
    sold: readGoods(raw["sold"], "earth.sold"),
    orders,
    flights,
    offer,
    contracts,
    log,
    spent: total("spent"),
    earned: total("earned"),
    rewards: total("rewards"),
    nextId,
  };
}

/** v17 -> v18: no event open, none resolved, nothing left on any city by one. */
function migrateV17toV18(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  const settlements = Array.isArray(list) ? list.map((raw) => (typeof raw !== "object" || raw === null ? raw : { ...(raw as Record<string, unknown>), effects: [] })) : list;
  return { ...save, schema_version: 18, settlements, decisions: { open: [], log: [] } };
}

const DECISION_KIND_SET: ReadonlySet<string> = new Set<DecisionKind>(["meteor", "failure", "outbreak", "ship", "discovery"]);
const DECISION_VARIANT_SET: ReadonlySet<string> = new Set<DecisionVariant>(["early", "late", "lost", "ice", "meteorite", "traces"]);
const BUILDING_TYPE_SET: ReadonlySet<string> = new Set<string>(BUILDING_TYPES);

function wholeAt(source: Record<string, unknown>, key: string, what: string, min = 0): number {
  const v = numberAt(source, key, what);
  if (!Number.isInteger(v) || v < min) throw new SaveError(`${what} must be a whole number >= ${min}, got ${v}`);
  return v;
}

/** v18: an event's kind, variant, settlement and building - the parts an open event and a record share. */
function readDecisionHead(x: Record<string, unknown>, at: string, ids: ReadonlySet<string>): Pick<OpenDecision, "id" | "kind" | "variant" | "settlement" | "building" | "opened" | "chosen"> {
  const kind = x["kind"];
  if (typeof kind !== "string" || !DECISION_KIND_SET.has(kind)) throw new SaveError(`${at}.kind must be an event's kind, got ${describe(kind)}`);
  const variant = x["variant"];
  if (variant !== null && (typeof variant !== "string" || !DECISION_VARIANT_SET.has(variant))) throw new SaveError(`${at}.variant must be an event's variant or null, got ${describe(variant)}`);
  const settlement = x["settlement"];
  if (typeof settlement !== "string" || !ids.has(settlement)) throw new SaveError(`${at}.settlement must be a settlement of this world, got ${describe(settlement)}`);
  const building = x["building"];
  if (building !== null && (typeof building !== "string" || !BUILDING_TYPE_SET.has(building))) throw new SaveError(`${at}.building must be a building type or null, got ${describe(building)}`);
  const chosen = x["chosen"];
  if (chosen !== null && typeof chosen !== "string") throw new SaveError(`${at}.chosen must be a choice's id or null, got ${describe(chosen)}`);
  return {
    id: wholeAt(x, "id", `${at}.id`),
    kind: kind as DecisionKind,
    variant: variant as DecisionVariant | null,
    settlement,
    building: building as BuildingType | null,
    opened: wholeAt(x, "opened", `${at}.opened`),
    chosen,
  };
}

/** v18: the events open (each once, opened no later than the world's own time) and the record of those resolved. */
function readDecisions(save: Record<string, unknown>, settlements: readonly Settlement[], steps: number): SimState["decisions"] {
  const raw = asRecord(save["decisions"], "decisions");
  const ids = new Set(settlements.map((s) => s.id));
  const seen = new Set<number>();
  const open = asArray(raw["open"], "decisions.open").map((item, i): OpenDecision => {
    const at = `decisions.open[${i}]`;
    const x = asRecord(item, at);
    const head = readDecisionHead(x, at, ids);
    if (seen.has(head.id)) throw new SaveError(`${at}.id ${head.id} is open twice`);
    seen.add(head.id);
    if (head.opened > steps) throw new SaveError(`${at} opened after the world's own time`);
    const deadline = wholeAt(x, "deadline", `${at}.deadline`);
    if (deadline <= head.opened) throw new SaveError(`${at}.deadline must come after it opened`);
    const stake = numberAt(x, "stake", `${at}.stake`);
    if (!(stake >= 0)) throw new SaveError(`${at}.stake must be >= 0, got ${stake}`);
    const where = x["at"];
    let ground: OpenDecision["at"] = null;
    if (where !== null) {
      const g = asRecord(where, `${at}.at`);
      ground = { x: wholeAt(g, "x", `${at}.at.x`, -Infinity), y: wholeAt(g, "y", `${at}.at.y`, -Infinity) };
    }
    return { ...head, at: ground, deadline, stake };
  });
  const log = asArray(raw["log"], "decisions.log").map((item, i): DecisionRecord => {
    const at = `decisions.log[${i}]`;
    const x = asRecord(item, at);
    const head = readDecisionHead(x, at, ids);
    const resolved = wholeAt(x, "resolved", `${at}.resolved`);
    if (resolved < head.opened || resolved > steps) throw new SaveError(`${at}.resolved must fall between its opening and the world's own time`);
    const o = asRecord(x["outcome"], `${at}.outcome`);
    const outcome = {
      people: numberAt(o, "people", `${at}.outcome.people`),
      materials: numberAt(o, "materials", `${at}.outcome.materials`),
      credits: numberAt(o, "credits", `${at}.outcome.credits`),
      hit: wholeAt(o, "hit", `${at}.outcome.hit`),
      wrecked: wholeAt(o, "wrecked", `${at}.outcome.wrecked`),
    };
    return { id: head.id, kind: head.kind, variant: head.variant, settlement: head.settlement, building: head.building, opened: head.opened, resolved, chosen: head.chosen, outcome };
  });
  return { open, log };
}

/** v18: what answered events left on a city - each a known kind, a share in [0, 1], time still to run. */
function readEffects(s: Record<string, unknown>, where: string): readonly SettlementEffect[] {
  return asArray(s["effects"], `${where}.effects`).map((item, i) => {
    const at = `${where}.effects[${i}]`;
    const x = asRecord(item, at);
    const kind = x["kind"];
    if (kind !== "shelter" && kind !== "quarantine" && kind !== "fault") throw new SaveError(`${at}.kind must be "shelter", "quarantine" or "fault", got ${describe(kind)}`);
    const tileRaw = x["tile"];
    const tile = tileRaw === null ? null : wholeAt(x, "tile", `${at}.tile`);
    if (kind === "fault" && tile === null) throw new SaveError(`${at}: a fault must name its building's tile`);
    const factor = numberAt(x, "factor", `${at}.factor`);
    if (!(factor >= 0 && factor <= 1)) throw new SaveError(`${at}.factor must be in [0, 1], got ${factor}`);
    const remaining = numberAt(x, "remaining", `${at}.remaining`);
    if (!(remaining > 0)) throw new SaveError(`${at}.remaining must be > 0, got ${remaining}`);
    return { kind, tile, factor, remaining, event: wholeAt(x, "event", `${at}.event`) };
  });
}

/**
 * v16 -> v17: the planet had no record, so it starts one now. A city's
 * samples keep what they recorded and nothing is made up for them: made and
 * drawn are absent from them, and a sample already gathering goes without.
 */
function migrateV16toV17(save: Record<string, unknown>, t: Tuning): Record<string, unknown> {
  const list = save["settlements"];
  const settlements = Array.isArray(list)
    ? list.map((raw) => {
        if (typeof raw !== "object" || raw === null) return raw;
        const s = raw as Record<string, unknown>;
        const h = s["history"];
        if (typeof h !== "object" || h === null) return s;
        const acc = (h as Record<string, unknown>)["acc"];
        if (typeof acc !== "object" || acc === null) return s;
        const fresh = (acc as Record<string, unknown>)["substeps"] === 0;
        const kept = fresh ? [0, 0, 0, 0, 0] : null;
        return { ...s, history: { ...(h as Record<string, unknown>), acc: { ...(acc as Record<string, unknown>), made: kept, drawn: kept === null ? null : [...kept] } } };
      })
    : list;
  return { ...save, schema_version: 17, settlements, history: { every: Math.max(1, t.PLANET_HISTORY_EVERY), samples: [] } };
}

const PLANET_SAMPLE_KEYS = ["steps", "T", "P", "o2", "ocean", "biomass", "co2", "progress", "credits", "people"] as const;

/** v17: the planet's record - a whole-number gap, and samples in order, none from after the world's own time. */
function readPlanetHistory(save: Record<string, unknown>, steps: number): SimState["history"] {
  const raw = asRecord(save["history"], "history");
  const every = numberAt(raw, "every", "history.every");
  if (!Number.isInteger(every) || every < 1) throw new SaveError(`history.every must be a whole number >= 1, got ${every}`);
  let last = -1;
  const samples = asArray(raw["samples"], "history.samples").map((item, i) => {
    const at = `history.samples[${i}]`;
    const x = asRecord(item, at);
    const out = {} as Record<(typeof PLANET_SAMPLE_KEYS)[number], number>;
    for (const key of PLANET_SAMPLE_KEYS) out[key] = numberAt(x, key, `${at}.${key}`);
    if (!Number.isInteger(out.steps) || out.steps <= last || out.steps > steps) throw new SaveError(`${at}.steps must be a whole number after the sample before and not after the world's own time, got ${out.steps}`);
    last = out.steps;
    return out;
  });
  return { every, samples };
}

/** v15 -> v16: nothing of the first hour done - no guided step, no claim, no rover landed as a reward. */
function migrateV15toV16(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  const settlements = Array.isArray(list) ? list.map((raw) => (typeof raw !== "object" || raw === null ? raw : { ...(raw as Record<string, unknown>), extra_rovers: 0 })) : list;
  return { ...save, schema_version: 16, goals: { guide: 0, guide_skipped: false, claimed: [] }, settlements };
}

/** v16: the guided steps done (a whole number), skipped or not, and the objectives claimed (ids, each once). */
function readGoals(save: Record<string, unknown>): SimState["goals"] {
  const raw = asRecord(save["goals"], "goals");
  const guide = numberAt(raw, "guide", "goals.guide");
  if (!Number.isInteger(guide) || guide < 0) throw new SaveError(`goals.guide must be a whole number >= 0, got ${guide}`);
  const skipped = raw["guide_skipped"];
  if (typeof skipped !== "boolean") throw new SaveError(`goals.guide_skipped must be true or false, got ${describe(skipped)}`);
  const claimed = asArray(raw["claimed"], "goals.claimed").map((id, i) => {
    if (typeof id !== "string") throw new SaveError(`goals.claimed[${i}] must be an objective's id, got ${describe(id)}`);
    return id;
  });
  if (new Set(claimed).size !== claimed.length) throw new SaveError("goals.claimed names an objective twice");
  return { guide, guideSkipped: skipped, claimed };
}

/** v13 -> v14: the build queue (real build times). Nothing waited: a build with no rover free was refused. */
function migrateV13toV14(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 14 };
  const settlements = list.map((raw) => (typeof raw !== "object" || raw === null ? raw : { ...(raw as Record<string, unknown>), build_queue: [] }));
  return { ...save, schema_version: 14, settlements };
}

/** v13: railways between settlements - each between two settlements that exist, once, with a length. */
function readRoutes(save: Record<string, unknown>, settlements: readonly Settlement[]): Route[] {
  const ids = new Set(settlements.map((s) => s.id));
  const seen = new Set<string>();
  return asArray(save["routes"], "routes").map((raw, i) => {
    const at = `routes[${i}]`;
    const r = asRecord(raw, at);
    const a = r["a"];
    const b = r["b"];
    if (typeof a !== "string" || typeof b !== "string" || !ids.has(a) || !ids.has(b) || a === b) throw new SaveError(`${at} must join two different settlements of this world`);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) throw new SaveError(`${at} joins ${a} and ${b} a second time`);
    seen.add(key);
    const km = numberAt(r, "km", `${at}.km`);
    if (!(km >= 0)) throw new SaveError(`${at}.km must be a length, got ${km}`);
    return { a, b, km };
  });
}

/** v11 -> v12: the city planner. No names, zones, queue or plan yet, and no record kept. */
function migrateV11toV12(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 12 };
  const settlements = list.map((raw) =>
    typeof raw !== "object" || raw === null ? raw : { ...(raw as Record<string, unknown>), name: "", zones: [], level_queue: [], planned: [], history: null },
  );
  return { ...save, schema_version: 12, settlements };
}

/** v10 -> v11: railways. There were no stations to lay them for. */
function migrateV10toV11(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 11 };
  const settlements = list.map((raw) => (typeof raw !== "object" || raw === null ? raw : { ...(raw as Record<string, unknown>), rails: [] }));
  return { ...save, schema_version: 11, settlements };
}

/** v9 -> v10: levelled ground. Nothing had been levelled. */
function migrateV9toV10(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 10 };
  const settlements = list.map((raw) => (typeof raw !== "object" || raw === null ? raw : { ...(raw as Record<string, unknown>), grades: [] }));
  return { ...save, schema_version: 10, settlements };
}

/**
 * v8 -> v9: claimed land. Every settlement before v9 was laid out on the
 * grid sizes every build had until then - 32 a city, 16 an outpost, 96 a
 * metropolis - and had claimed nothing. (A build whose tuning founds larger
 * squares re-centres such a settlement in one on load: `readSettlements`.)
 */
function migrateV8toV9(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 9 };
  const V8_GRID: Readonly<Record<string, number>> = { city: 32, outpost: 16, metropolis: 96 };
  const settlements = list.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const s = raw as Record<string, unknown>;
    return { ...s, base: V8_GRID[String(s["kind"])] ?? 32, claims: [] };
  });
  return { ...save, schema_version: 9, settlements };
}

/**
 * v7 -> v8: v7's roads carried everything; v8 has corridors (water, oxygen,
 * food, materials) and cables (power). Each road becomes both, so nothing a
 * player connected comes apart. No rock had been broken, nothing was under way.
 */
function migrateV7toV8(save: Record<string, unknown>): Record<string, unknown> {
  const list = save["settlements"];
  if (!Array.isArray(list)) return { ...save, schema_version: 8 };
  const settlements = list.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const { roads, ...rest } = raw as Record<string, unknown>;
    return { ...rest, corridors: roads ?? null, cables: roads ?? null, cleared: [], jobs: [] };
  });
  return { ...save, schema_version: 8, settlements };
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
    const founded = numberAt(s, "base", `${where}.base`);
    if (!Number.isInteger(founded) || founded < 1) throw new SaveError(`${where}.base must be a whole number of tiles from 1, got ${founded}`);
    const claims = readClaims(s, where);
    const grades = readGrades(s, where);
    const draft: Settlement = { ...base, buildings, base: founded, claims, grades };
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
    const cleared = readKeys(s, "cleared", where, "rock", new Set());
    const jobs = readJobs(s, where);
    const under = underBuildings(buildings);
    const extraRovers = numberAt(s, "extra_rovers", `${where}.extra_rovers`);
    if (!Number.isInteger(extraRovers) || extraRovers < 0) throw new SaveError(`${where}.extra_rovers must be a whole number >= 0, got ${extraRovers}`);
    let settled: Settlement = { ...standing, cleared, jobs, rails: readKeys(s, "rails", where, "railway", under), ...readPlanner(s, where), extraRovers, effects: readEffects(s, where) };
    // v8: corridors and cables; null only for a settlement carried forward from v6.
    for (const layer of LAYERS) {
      settled = { ...settled, [layer]: s[layer] === null ? [] : readKeys(s, layer, where, LINK_WORDS[layer], under) };
    }
    // A build that founds larger squares than this settlement was founded on
    // (the user: "make the initial boundaries at least 3x bigger") gives it
    // one, centred on the old: what was built stays on the ground it stood
    // on relative to the founding site. Only before any claim - a claim is
    // counted from the square it was made against. A smaller square is kept:
    // land is never taken away.
    const grown = gridTiles(kind, t);
    if (claims.length === 0 && grown > founded) {
      const shift = Math.floor((grown - founded) / 2);
      settled = { ...shiftContent(settled, shift, shift), base: grown };
    }
    for (const layer of LAYERS) {
      if (s[layer] === null) settled = { ...settled, [layer]: [...linksToConnect(settled, layer, t)] };
    }
    return withHeadquarters(settled, t);
  });
}

const LINK_WORDS: Readonly<Record<Layer, string>> = { corridors: "corridor", cables: "cable" };

/** Levelled tiles: a whole tile key and a finite height each. Order kept: a later grade wins a shared corner. */
function readGrades(s: Record<string, unknown>, where: string): readonly Grade[] {
  return asArray(s["grades"], `${where}.grades`).map((raw, j) => {
    const at = `${where}.grades[${j}]`;
    const g = asRecord(raw, at);
    const tile = numberAt(g, "tile", `${at}.tile`);
    if (!Number.isInteger(tile) || tile < 0) throw new SaveError(`${at}.tile must be a tile key, got ${tile}`);
    return { tile, heightM: numberAt(g, "height_m", `${at}.height_m`) };
  });
}

/**
 * v12: the planner's part of a settlement. A name of any length is cut to
 * the longest allowed (a retune could shorten it); a zone's colour must be
 * one; the record's numbers must be finite. A record missing (from v11) is
 * an empty one.
 */
function readPlanner(s: Record<string, unknown>, where: string): Pick<Settlement, "name" | "zones" | "levelQueue" | "buildQueue" | "planned" | "history"> {
  const nameRaw = s["name"];
  if (typeof nameRaw !== "string") throw new SaveError(`${where}.name must be a string, got ${describe(nameRaw)}`);
  const zones = asArray(s["zones"], `${where}.zones`).map((raw, j) => {
    const at = `${where}.zones[${j}]`;
    const z = asRecord(raw, at);
    const id = numberAt(z, "id", `${at}.id`);
    if (!Number.isInteger(id) || id < 1) throw new SaveError(`${at}.id must be a whole number from 1, got ${id}`);
    const zname = z["name"];
    if (typeof zname !== "string" || zname.length === 0) throw new SaveError(`${at}.name must be a name`);
    const colour = z["colour"];
    if (typeof colour !== "string" || !/^#[0-9a-f]{6}$/i.test(colour)) throw new SaveError(`${at}.colour must be #rrggbb, got ${describe(colour)}`);
    return { id, name: zname.slice(0, NAME_MAX), colour: colour.toLowerCase(), tiles: readKeys(z, "tiles", at, "zone tile", new Set()) };
  });
  if (new Set(zones.map((z) => z.id)).size !== zones.length) throw new SaveError(`${where}.zones repeat an id`);
  const levelQueue = asArray(s["level_queue"], `${where}.level_queue`).map((raw, j) => {
    const at = `${where}.level_queue[${j}]`;
    const q = asRecord(raw, at);
    const tile = numberAt(q, "tile", `${at}.tile`);
    if (!Number.isInteger(tile) || tile < 0) throw new SaveError(`${at}.tile must be a tile key, got ${tile}`);
    return { tile, levelM: numberAt(q, "level_m", `${at}.level_m`) };
  });
  const buildQueue = asArray(s["build_queue"], `${where}.build_queue`).map((raw, j) => {
    const at = `${where}.build_queue[${j}]`;
    const q = asRecord(raw, at);
    const tile = numberAt(q, "tile", `${at}.tile`);
    if (!Number.isInteger(tile) || tile < 0) throw new SaveError(`${at}.tile must be a tile key, got ${tile}`);
    const upgrade = q["upgrade"];
    if (typeof upgrade !== "boolean") throw new SaveError(`${at}.upgrade must be true or false, got ${describe(upgrade)}`);
    const paid = numberAt(q, "paid", `${at}.paid`);
    if (!(paid >= 0)) throw new SaveError(`${at}.paid must be >= 0, got ${paid}`);
    return { tile, upgrade, paid };
  });
  const planned = asArray(s["planned"], `${where}.planned`).map((raw, j) => {
    const at = `${where}.planned[${j}]`;
    const p = asRecord(raw, at);
    const layer = p["layer"];
    if (layer !== "corridors" && layer !== "cables" && layer !== "rails") throw new SaveError(`${at}.layer must be "corridors", "cables" or "rails", got ${describe(layer)}`);
    const tile = numberAt(p, "tile", `${at}.tile`);
    if (!Number.isInteger(tile) || tile < 0) throw new SaveError(`${at}.tile must be a tile key, got ${tile}`);
    return { layer, tile } as const;
  });
  const historyRaw = s["history"];
  let history = EMPTY_HISTORY;
  if (historyRaw !== null && historyRaw !== undefined) {
    const h = asRecord(historyRaw, `${where}.history`);
    const five = (v: unknown, at: string): number[] => {
      const list = asArray(v, at);
      if (list.length !== 5 || !list.every((x) => typeof x === "number" && Number.isFinite(x))) throw new SaveError(`${at} must be five numbers`);
      return list as number[];
    };
    const acc = asRecord(h["acc"], `${where}.history.acc`);
    const taken = numberAt(h, "taken", `${where}.history.taken`);
    const samples = asArray(h["samples"], `${where}.history.samples`).map((raw, j) => {
      const at = `${where}.history.samples[${j}]`;
      const x = asRecord(raw, at);
      return {
        index: numberAt(x, "index", `${at}.index`),
        population: numberAt(x, "population", `${at}.population`),
        housing: numberAt(x, "housing", `${at}.housing`),
        births: numberAt(x, "births", `${at}.births`),
        deaths: numberAt(x, "deaths", `${at}.deaths`),
        short: five(x["short"], `${at}.short`),
        stores: five(x["stores"], `${at}.stores`),
        net: five(x["net"], `${at}.net`),
        // v17: absent from a sample taken before made and drawn were kept.
        ...(x["made"] === undefined ? {} : { made: five(x["made"], `${at}.made`) }),
        ...(x["drawn"] === undefined ? {} : { drawn: five(x["drawn"], `${at}.drawn`) }),
      };
    });
    // v17: made and drawn so far - five numbers, or null for a sample begun before they were kept.
    const fiveOrNull = (v: unknown, at: string): number[] | null => (v === null ? null : five(v, at));
    history = {
      acc: {
        substeps: numberAt(acc, "substeps", `${where}.history.acc.substeps`),
        births: numberAt(acc, "births", `${where}.history.acc.births`),
        deaths: numberAt(acc, "deaths", `${where}.history.acc.deaths`),
        short: five(acc["short"], `${where}.history.acc.short`),
        net: five(acc["net"], `${where}.history.acc.net`),
        made: fiveOrNull(acc["made"], `${where}.history.acc.made`),
        drawn: fiveOrNull(acc["drawn"], `${where}.history.acc.drawn`),
      },
      taken,
      samples,
    };
  }
  return { name: nameRaw.slice(0, NAME_MAX), zones, levelQueue, buildQueue, planned, history };
}

/** Claimed chunks: whole, distinct chunk keys. Whether they touch is not the save's to judge - a retune of the chunk size would break it. */
function readClaims(s: Record<string, unknown>, where: string): readonly number[] {
  const seen = new Set<number>();
  asArray(s["claims"], `${where}.claims`).forEach((raw, j) => {
    const at = `${where}.claims[${j}]`;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) throw new SaveError(`${at} must be a chunk key (a whole number from 0), got ${describe(raw)}`);
    const { i, j: jj } = keyChunk(raw);
    if (chunkKey(i, jj) !== raw) throw new SaveError(`${at} is not a chunk key`);
    if (seen.has(raw)) throw new SaveError(`${at} claims chunk ${i},${jj} twice`);
    seen.add(raw);
  });
  return [...seen].sort((a, b) => a - b);
}

function underBuildings(buildings: readonly PlacedBuilding[]): Set<number> {
  const under = new Set<number>();
  for (const b of buildings) {
    const size = BUILDING_DEFS[b.type].footprint;
    const depth = BUILDING_DEFS[b.type].depth;
    for (const [x, y] of footprintTiles({ tx: b.tx, ty: b.ty, w: size, h: depth })) under.add(tileKey(x, y));
  }
  return under;
}

/**
 * A list of tile keys - a network's tiles, or the broken rocks. Rejects what
 * cannot be meant: a key that is not a whole tile, the same tile twice, or a
 * link under a building. A tile off a grid a retune has shrunk is KEPT, like
 * a building: dropping it would destroy what the player built.
 */
function readKeys(s: Record<string, unknown>, field: string, where: string, noun: string, under: ReadonlySet<number>): readonly number[] {
  const seen = new Set<number>();
  asArray(s[field], `${where}.${field}`).forEach((raw, j) => {
    const at = `${where}.${field}[${j}]`;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) throw new SaveError(`${at} must be a tile key (a whole number from 0), got ${describe(raw)}`);
    const { tx, ty } = keyTile(raw);
    if (seen.has(raw)) throw new SaveError(`${at} repeats the ${noun} at tile ${tx},${ty}`);
    if (under.has(raw)) throw new SaveError(`${at} lies under a building at tile ${tx},${ty}`);
    seen.add(raw);
  });
  return [...seen].sort((a, b) => a - b);
}

/** Rovers and rockets under way. A job with no time left, or more left than it takes, is not one the game makes. */
function readJobs(s: Record<string, unknown>, where: string): readonly SettlementJob[] {
  return asArray(s["jobs"], `${where}.jobs`).map((raw, j) => {
    const at = `${where}.jobs[${j}]`;
    const job = asRecord(raw, at);
    const kind = job["kind"];
    const tile = numberAt(job, "tile", `${at}.tile`);
    const total = numberAt(job, "total", `${at}.total`);
    const remaining = numberAt(job, "remaining", `${at}.remaining`);
    if (!Number.isInteger(tile) || tile < 0) throw new SaveError(`${at}.tile must be a tile key, got ${tile}`);
    if (!(total > 0) || !(remaining > 0) || remaining > total) throw new SaveError(`${at} has ${remaining} of ${total} years left, which no job can`);
    if (kind === "rocket") {
      // v19: Earth's shipment it carries, by its flight's number.
      if (job["earth"] === undefined) return { kind, tile, total, remaining };
      return { kind, tile, total, remaining, earth: wholeAt(job, "earth", `${at}.earth`, 1) };
    }
    // v15: the way it drives, where it turns.
    const route = readRoute(job["route"], `${at}.route`);
    const routed = route === undefined ? {} : { route };
    if (kind === "build") {
      const work = numberAt(job, "work", `${at}.work`);
      if (work < 0 || work > total) throw new SaveError(`${at}.work ${work} is outside its ${total}-year trip`);
      const upgrade = job["upgrade"];
      if (typeof upgrade !== "boolean") throw new SaveError(`${at}.upgrade must be true or false`);
      return { kind, tile, total, remaining, work, upgrade, ...routed };
    }
    if (kind === "rover") {
      const materials = numberAt(job, "materials", `${at}.materials`);
      const work = numberAt(job, "work", `${at}.work`);
      if (materials < 0) throw new SaveError(`${at}.materials is negative (${materials})`);
      if (work < 0 || work > total) throw new SaveError(`${at}.work ${work} is outside its ${total}-year trip`);
      // v10: a rover levelling its tile carries the level.
      if (job["levelM"] !== undefined) return { kind, tile, total, remaining, materials, work, levelM: numberAt(job, "levelM", `${at}.levelM`), ...routed };
      return { kind, tile, total, remaining, materials, work, ...routed };
    }
    throw new SaveError(`${at}.kind must be "rover", "rocket" or "build", got ${describe(kind)}`);
  });
}

/**
 * A route as saved (v15): tile keys, each from the last by a straight run
 * along a row, a column or a diagonal - the only ways a route turns. Absent
 * for a job sent without one.
 */
function readRoute(raw: unknown, at: string): readonly number[] | undefined {
  if (raw === undefined) return undefined;
  const list = asArray(raw, at);
  if (list.length === 0) throw new SaveError(`${at} is empty - a route has at least the tile it starts from`);
  const keys = list.map((k, i) => {
    if (typeof k !== "number" || !Number.isInteger(k) || k < 0) throw new SaveError(`${at}[${i}] must be a tile key, got ${describe(k)}`);
    return k;
  });
  keys.forEach((k, i) => {
    if (i === 0) return;
    const { tx, ty } = keyTile(k);
    const { tx: px, ty: py } = keyTile(keys[i - 1]!);
    const dx = Math.abs(tx - px);
    const dy = Math.abs(ty - py);
    if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0 && dx !== dy)) throw new SaveError(`${at}[${i}] is not a straight run from the tile before it`);
  });
  return keys;
}

/**
 * With the headquarters on, every standing settlement has one: a settlement
 * from before them is given one at the centre, or - where the player built
 * there - on the nearest free 5 x 5 ground, clear of buildings, taking up
 * any corridor or cable under it. Where there is no room at all, none: its
 * rovers wait for one. Deterministic, like everything a load does.
 */
function withHeadquarters(s: Settlement, t: Tuning): Settlement {
  if (!t.HEADQUARTERS_ENABLED || s.lostAtSeaLevelM !== null || s.buildings.some((b) => b.type === "headquarters")) return s;
  const { n, base, x0, y0 } = frameOf(s, t);
  const under = underBuildings(s.buildings);
  // The founding square's centre, in the frame's tiles.
  const middle = headquartersOrigin(base);
  const centre = { tx: middle.tx - x0, ty: middle.ty - y0 };
  const free = (ox: number, oy: number): boolean => {
    if (ox < 0 || oy < 0 || ox + 5 > n || oy + 5 > n) return false;
    for (let y = oy; y < oy + 5; y += 1) for (let x = ox; x < ox + 5; x += 1) if (under.has(tileKey(x, y))) return false;
    return true;
  };
  // Rings out from the centre; within a ring, in reading order.
  for (let r = 0; r <= n; r += 1) {
    for (let oy = centre.ty - r; oy <= centre.ty + r; oy += 1) {
      for (let ox = centre.tx - r; ox <= centre.tx + r; ox += 1) {
        if (Math.max(Math.abs(ox - centre.tx), Math.abs(oy - centre.ty)) !== r || !free(ox, oy)) continue;
        const inside = (key: number): boolean => {
          const { tx, ty } = keyTile(key);
          return tx >= ox && ty >= oy && tx < ox + 5 && ty < oy + 5;
        };
        return {
          ...s,
          buildings: [{ type: "headquarters", tx: ox, ty: oy, level: 1 }, ...s.buildings],
          corridors: s.corridors.filter((k) => !inside(k)),
          cables: s.cables.filter((k) => !inside(k)),
        };
      }
    }
  }
  return s;
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
    const depth = BUILDING_DEFS[type as BuildingType].depth;
    for (const [x, y] of footprintTiles({ tx, ty, w: size, h: depth })) {
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
