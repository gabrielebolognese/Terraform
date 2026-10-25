/**
 * Earth (Batch 34): "Earth is part of the game: it sends supplies, asks for
 * exports, and pays for them. The spaceport gets a job."
 *
 * LAUNCH WINDOWS COME BY THE ORBIT. Mars and Earth line up every
 * EARTH_SYNODIC_YEARS (2.135) of the planet's years; the k-th window opens at
 * the first substep on or after year k x 2.135 (`windowStep`). Worked out
 * from k every time, never accumulated, so the fiftieth window falls on its
 * date as the first does, however the time was split.
 *
 * AT A WINDOW each city's rocket - the first finished spaceport whose rocket
 * is home: the rocket the city view draws - lifts off with what goes to
 * Earth (the player's sales; a contract's materials or water, never taking a
 * store below EARTH_KEEP_SHARE of its room) and comes back EARTH_TRIP_SHARE
 * of a window later with what was ordered. Its flight is a rocket job on the
 * spaceport with `earth` set, so the view draws it, a supply run cannot take
 * it, and it brings no materials of its own. A city whose rocket is away, or
 * which has no finished spaceport, misses the window: its orders wait.
 *
 * THE MARKET is a function of the world: each good's base price, its supply
 * this window (drawn from the seed, as storms are), the trade the market
 * remembers (`bought`, `sold`; a share forgotten every window) and the
 * player's reputation. A purchase is paid when it is placed; a sale is paid
 * as it goes up, at the window's prices.
 *
 * CONTRACTS: each window Earth offers one, dealt from the seed and the world
 * as it stands (`dealOffer`). Accepted (an action), what is sent counts
 * toward it: materials and water on the rockets, research - the credits the
 * planet's laboratories earn - sent home instead of to the bank, a substep at
 * a time (`divertResearch`, from `advance`). Met, it pays and the player's
 * reputation rises; its window passed short, it fails and reputation falls.
 *
 * Everything that happens with time happens in `stepEarth`, from `advance`,
 * every substep. Off (EARTH_ENABLED 0) by default and in every world made
 * before it. Pure: no clock, no randomness beyond the seeded hash.
 */

import { BUILDING_DEFS, levelFactor } from "./micro/buildings.js";
import { capacities, constructionOf, housing } from "./micro/settlement.js";
import { tileKey } from "./micro/space.js";
import { rand01 } from "./rng.js";
import type { Tuning } from "./tuning.js";
import type {
  ContractKind,
  EarthContract,
  EarthFlight,
  EarthGood,
  EarthGoods,
  EarthOrder,
  EarthRecord,
  EarthState,
  MicroResource,
  PlacedBuilding,
  Settlement,
  SettlementJob,
  SimState,
} from "./types.js";
import { EARTH_GOODS, isCityKind } from "./types.js";

/** Salts: independent questions about one window get independent answers. Fixed: changing one changes every world's market. */
const SALT = {
  supply: 0x3401,
  kind: 0x3410,
  size: 0x3411,
} as const;

/** The goods Earth buys back: the four stores a rocket can carry off. */
export const SELLABLE: readonly EarthGood[] = ["materials", "water", "food", "oxygen"];
export const CONTRACT_KINDS: readonly ContractKind[] = ["materials", "water", "research"];

/** Nothing of any good. */
export const NO_GOODS: EarthGoods = Object.freeze({ materials: 0, water: 0, food: 0, oxygen: 0, settlers: 0, rovers: 0 });

/** Earth before any trade: the starting reputation, nothing ordered, offered or remembered. */
export function emptyEarth(t: Tuning): EarthState {
  return {
    reputation: t.EARTH_REP_START,
    fulfilled: 0,
    failed: 0,
    bought: NO_GOODS,
    sold: NO_GOODS,
    orders: [],
    flights: [],
    offer: null,
    contracts: [],
    log: [],
    spent: 0,
    earned: 0,
    rewards: 0,
    nextId: 1,
  };
}

// ---------------------------------------------------------------------------
// Launch windows
// ---------------------------------------------------------------------------

/** The orbit's date of window k, the planet's years: k synodic periods from the start. */
export function windowYear(k: number, t: Tuning): number {
  return k * t.EARTH_SYNODIC_YEARS;
}

/**
 * The substep window k (from 1) opens at: the first whose end is on or after
 * its date. From k alone, so it never drifts; the 1e-9 keeps a date that
 * falls on a substep's end on that substep, whatever the division rounds to.
 */
export function windowStep(k: number, t: Tuning): number {
  return Math.ceil(windowYear(k, t) / t.SUBSTEP_YEARS - 1e-9);
}

/** The window that opens at substep `step`, or null. */
export function windowAt(step: number, t: Tuning): number | null {
  const k = windowIndex(step, t);
  return k >= 1 && windowStep(k, t) === step ? k : null;
}

/** The latest window opened at or before substep `step`: 0 before the first. */
export function windowIndex(step: number, t: Tuning): number {
  let k = Math.max(0, Math.floor((step * t.SUBSTEP_YEARS) / t.EARTH_SYNODIC_YEARS));
  while (windowStep(k + 1, t) <= step) k += 1;
  while (k >= 1 && windowStep(k, t) > step) k -= 1;
  return k;
}

/** The rocket's trip to Earth and back, whole substeps: EARTH_TRIP_SHARE of a window, at least one. */
export function tripSubsteps(t: Tuning): number {
  return Math.max(1, Math.round((t.EARTH_TRIP_SHARE * t.EARTH_SYNODIC_YEARS) / t.SUBSTEP_YEARS));
}

/** The same trip in a city's years, what its rocket job counts down: exactly `tripSubsteps` of the city's substeps. */
export function tripCityYears(t: Tuning): number {
  return tripSubsteps(t) * t.SUBSTEP_YEARS * t.CITY_CLOCK;
}

// ---------------------------------------------------------------------------
// The market
// ---------------------------------------------------------------------------

/** What Earth asks for a unit of each good, before supply, trade and reputation. */
export function basePrice(good: EarthGood, t: Tuning): number {
  switch (good) {
    case "materials":
      return t.EARTH_PRICE_MATERIALS;
    case "water":
      return t.EARTH_PRICE_WATER;
    case "food":
      return t.EARTH_PRICE_FOOD;
    case "oxygen":
      return t.EARTH_PRICE_OXYGEN;
    case "settlers":
      return t.EARTH_PRICE_SETTLERS;
    case "rovers":
      return t.EARTH_PRICE_ROVERS;
  }
}

/** Earth's supply of a good in window k: 1 +- EARTH_SUPPLY_SWING, drawn from the seed. Dear goods are dear both ways. */
export function supplyOf(seed: number, k: number, good: EarthGood, t: Tuning): number {
  return 1 + t.EARTH_SUPPLY_SWING * (2 * rand01(seed, k, SALT.supply + EARTH_GOODS.indexOf(good)) - 1);
}

/** Reputation as -1 (none) to 1 (full): what moves the prices. */
function standing(reputation: number, t: Tuning): number {
  return (reputation - t.EARTH_REP_START) / Math.max(1, reputation >= t.EARTH_REP_START ? 100 - t.EARTH_REP_START : t.EARTH_REP_START);
}

/** Whether Earth sells this good yet: settlers and rovers wait for contracts met. */
export function goodUnlocked(s: SimState, good: EarthGood, t: Tuning): boolean {
  if (good === "settlers") return s.earth.fulfilled >= t.EARTH_UNLOCK_SETTLERS;
  if (good === "rovers") return s.earth.fulfilled >= t.EARTH_UNLOCK_ROVERS;
  return true;
}

/** A unit's price in window k, for a market remembering `pressure` credits' worth: Earth's asking (buy) and paying (sell). */
function unitPrice(seed: number, k: number, good: EarthGood, reputation: number, side: "buy" | "sell", pressure: number, t: Tuning): number {
  const base = basePrice(good, t) * supplyOf(seed, k, good, t);
  const rep = standing(reputation, t);
  if (side === "buy") return base * (1 - t.EARTH_REP_PRICE * rep) * (1 + pressure / t.EARTH_MARKET_DEPTH);
  return (base * t.EARTH_SELL_SHARE * (1 + t.EARTH_REP_PRICE * rep)) / (1 + pressure / t.EARTH_MARKET_DEPTH);
}

/** Each good's price now, a unit: what Earth asks, and what it pays (0 for what it does not buy). */
export function earthPrices(s: SimState, t: Tuning): Readonly<Record<EarthGood, { readonly buy: number; readonly sell: number }>> {
  const k = windowIndex(s.steps, t);
  const out = {} as Record<EarthGood, { buy: number; sell: number }>;
  for (const g of EARTH_GOODS) {
    out[g] = {
      buy: unitPrice(s.seed, k, g, s.earth.reputation, "buy", s.earth.bought[g], t),
      sell: SELLABLE.includes(g) ? unitPrice(s.seed, k, g, s.earth.reputation, "sell", s.earth.sold[g], t) : 0,
    };
  }
  return out;
}

/**
 * What `amount` of a good costs now, whole credits: priced at the middle of
 * the order, so buying it in one or in parts costs the same.
 */
export function buyCost(s: SimState, good: EarthGood, amount: number, t: Tuning): number {
  const k = windowIndex(s.steps, t);
  const middle = s.earth.bought[good] + (amount * basePrice(good, t)) / 2;
  return Math.ceil(amount * unitPrice(s.seed, k, good, s.earth.reputation, "buy", middle, t));
}

/** What Earth pays for `amount` of a good in window k, with `sold` credits' worth remembered: whole credits, at the middle of the sale. */
function saleValue(seed: number, k: number, good: EarthGood, reputation: number, sold: number, amount: number, t: Tuning): number {
  if (amount <= 0) return 0;
  const middle = sold + (amount * basePrice(good, t)) / 2;
  return Math.floor(amount * unitPrice(seed, k, good, reputation, "sell", middle, t));
}

/** What `amount` of a good would fetch at today's prices (the sale itself is at the window's). */
export function saleEstimate(s: SimState, good: EarthGood, amount: number, t: Tuning): number {
  if (!SELLABLE.includes(good)) return 0;
  return saleValue(s.seed, windowIndex(s.steps, t), good, s.earth.reputation, s.earth.sold[good], amount, t);
}

// ---------------------------------------------------------------------------
// The spaceport's rocket
// ---------------------------------------------------------------------------

/** Whether the settlement has a spaceport at all, finished or going up. */
export function hasSpaceport(c: Settlement): boolean {
  return c.buildings.some((b) => b.type === "spaceport");
}

/** The spaceport whose rocket would fly at a window: the first finished one whose rocket is home, or null. */
export function rocketPort(c: Settlement): PlacedBuilding | null {
  const going = constructionOf(c);
  for (const b of c.buildings) {
    if (b.type !== "spaceport") continue;
    const key = tileKey(b.tx, b.ty);
    if (going.has(key) || c.jobs.some((j) => j.kind === "rocket" && j.tile === key)) continue;
    return b;
  }
  return null;
}

/** Units of a store a rocket may take: what is above EARTH_KEEP_SHARE of its room, whole. */
function spare(stores: Readonly<Record<MicroResource, number>>, cap: Readonly<Record<MicroResource, number>>, r: MicroResource, t: Tuning): number {
  return Math.max(0, Math.floor(stores[r] - t.EARTH_KEEP_SHARE * cap[r]));
}

/** What a rocket could send of a store from this city now. */
export function exportable(c: Settlement, r: MicroResource, t: Tuning): number {
  return spare(c.stores, capacities(c, t), r, t);
}

// ---------------------------------------------------------------------------
// The player's actions: an order, cancelling one, accepting a contract
// ---------------------------------------------------------------------------

export interface EarthOutcome {
  readonly state: SimState;
  readonly ok: boolean;
  readonly reason: string | null;
}

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
const GOOD_NAMES: Readonly<Record<EarthGood, readonly [string, string]>> = {
  materials: ["material", "materials"],
  water: ["unit of water", "units of water"],
  food: ["unit of food", "units of food"],
  oxygen: ["unit of oxygen", "units of oxygen"],
  settlers: ["settler", "settlers"],
  rovers: ["rover", "rovers"],
};
/** An amount of a good in words: "120 materials", "1 settler". */
export function goodWords(good: EarthGood, n: number): string {
  const [one, many] = GOOD_NAMES[good];
  return count(n, one, many);
}

/**
 * An order for the next launch window. To buy: paid now, at Earth's price,
 * and the market remembers it. To sell: up to `amount`, paid as it goes up
 * at the window's price. Refused, changing nothing, with Earth off, for a
 * settlement gone or without a spaceport, an amount not a whole number of at
 * least one, a good Earth does not sell yet (or buy), or a price the bank
 * cannot meet - and says why.
 */
export function orderFromEarth(s: SimState, settlementId: string, good: EarthGood, side: "buy" | "sell", amount: number, t: Tuning): EarthOutcome {
  const refuse = (reason: string): EarthOutcome => ({ state: s, ok: false, reason });
  if (!t.EARTH_ENABLED) return refuse("trade with Earth is not part of this world");
  const c = s.settlements.find((x) => x.id === settlementId);
  if (c === undefined) return refuse(`there is no settlement ${settlementId}`);
  if (c.lostAtSeaLevelM !== null) return refuse("it was lost to the sea");
  if (!hasSpaceport(c)) return refuse("it has no spaceport for Earth's rockets");
  if (!(Number.isInteger(amount) && amount >= 1)) return refuse("an order is a whole number, at least 1");
  if (!EARTH_GOODS.includes(good)) return refuse(`Earth does not trade in ${String(good)}`);
  const id = s.earth.nextId;
  if (side === "sell") {
    if (!SELLABLE.includes(good)) return refuse(`Earth does not buy ${GOOD_NAMES[good][1]}`);
    const order: EarthOrder = { id, settlement: c.id, good, side, amount, paid: 0, placed: s.steps };
    return { state: { ...s, earth: { ...s.earth, orders: [...s.earth.orders, order], nextId: id + 1 } }, ok: true, reason: null };
  }
  if (!goodUnlocked(s, good, t)) {
    const need = good === "settlers" ? t.EARTH_UNLOCK_SETTLERS : t.EARTH_UNLOCK_ROVERS;
    return refuse(`Earth sends ${GOOD_NAMES[good][1]} once ${count(need, "contract is", "contracts are")} met`);
  }
  const cost = buyCost(s, good, amount, t);
  if (cost > s.economy.credits) return refuse(`it costs ${count(cost, "credit")}; the bank holds ${Math.floor(s.economy.credits).toLocaleString("en")}`);
  const order: EarthOrder = { id, settlement: c.id, good, side, amount, paid: cost, placed: s.steps };
  const bought = { ...s.earth.bought, [good]: s.earth.bought[good] + amount * basePrice(good, t) };
  return {
    state: {
      ...s,
      economy: { ...s.economy, credits: s.economy.credits - cost, spent: s.economy.spent + cost },
      earth: { ...s.earth, orders: [...s.earth.orders, order], bought, spent: s.earth.spent + cost, nextId: id + 1 },
    },
    ok: true,
    reason: null,
  };
}

/** Take back an order still waiting for its window: a purchase is refunded in full. */
export function cancelEarthOrder(s: SimState, orderId: number, t: Tuning): EarthOutcome {
  const refuse = (reason: string): EarthOutcome => ({ state: s, ok: false, reason });
  if (!t.EARTH_ENABLED) return refuse("trade with Earth is not part of this world");
  const order = s.earth.orders.find((o) => o.id === orderId);
  if (order === undefined) return refuse("that order has gone up already, or was never placed");
  const orders = s.earth.orders.filter((o) => o.id !== orderId);
  if (order.paid === 0) return { state: { ...s, earth: { ...s.earth, orders } }, ok: true, reason: null };
  const bought = { ...s.earth.bought, [order.good]: Math.max(0, s.earth.bought[order.good] - order.amount * basePrice(order.good, t)) };
  return {
    state: {
      ...s,
      economy: { ...s.economy, credits: s.economy.credits + order.paid, spent: s.economy.spent - order.paid },
      earth: { ...s.earth, orders, bought, spent: s.earth.spent - order.paid },
    },
    ok: true,
    reason: null,
  };
}

/** Take Earth's standing offer: from now on what is sent counts toward it. */
export function acceptContract(s: SimState, t: Tuning): EarthOutcome {
  const refuse = (reason: string): EarthOutcome => ({ state: s, ok: false, reason });
  if (!t.EARTH_ENABLED) return refuse("trade with Earth is not part of this world");
  const offer = s.earth.offer;
  if (offer === null) return refuse("Earth has nothing on offer: it offers a contract at each of the launch windows");
  return { state: { ...s, earth: { ...s.earth, offer: null, contracts: [...s.earth.contracts, { ...offer, accepted: true }] } }, ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** Standing cities with people: who Earth deals with. */
function cities(s: SimState): readonly Settlement[] {
  return s.settlements.filter((c) => isCityKind(c.kind) && c.lostAtSeaLevelM === null && c.population > 0);
}

/** The research every finished laboratory, observatory and forum earns at its level, credits a year: what a contract asks a share of. */
export function researchRate(s: SimState, t: Tuning): number {
  let rate = 0;
  for (const c of s.settlements) {
    if (c.lostAtSeaLevelM !== null) continue;
    const going = constructionOf(c);
    for (const b of c.buildings) {
      const r = BUILDING_DEFS[b.type].research(t);
      if (r > 0 && !going.has(tileKey(b.tx, b.ty))) rate += r * levelFactor(b.level, t);
    }
  }
  return rate;
}

const WEIGHT: Readonly<Record<ContractKind, (t: Tuning) => number>> = {
  materials: (t) => t.EARTH_WEIGHT_MATERIALS,
  water: (t) => t.EARTH_WEIGHT_WATER,
  research: (t) => t.EARTH_WEIGHT_RESEARCH,
};

/** Credits a contract pays a unit. */
export function contractPay(kind: ContractKind, t: Tuning): number {
  return kind === "materials" ? t.EARTH_CONTRACT_PAY_MATERIALS : kind === "water" ? t.EARTH_CONTRACT_PAY_WATER : t.EARTH_CONTRACT_PAY_RESEARCH;
}

const roundTen = (x: number): number => Math.max(10, Math.round(x / 10) * 10);

/**
 * A window's span in a city's years: what a city makes between two windows.
 * The cities' clock runs the same in real time at both paces, the planet's
 * eight times faster at Classic - so its windows are eight times as close,
 * and a contract asks for as much as a city makes in a window's span (Batch
 * 34: sized in materials alone, Classic's contracts failed 23 in an hour).
 */
export function windowCityYears(t: Tuning): number {
  return t.EARTH_SYNODIC_YEARS * t.CITY_CLOCK;
}

/** Contract `kind` as window k would offer it: its amount (x1 to x2, drawn from the seed), its pay and its window. */
export function contractFor(s: SimState, k: number, kind: ContractKind, t: Tuning): EarthContract {
  const size = 1 + rand01(s.seed, k, SALT.size);
  const span = windowCityYears(t);
  const amount =
    kind === "materials"
      ? roundTen(t.EARTH_CONTRACT_MATERIALS_YEAR * span * size)
      : kind === "water"
        ? roundTen(t.EARTH_CONTRACT_WATER_YEAR * span * size)
        : roundTen(researchRate(s, t) * t.EARTH_CONTRACT_RESEARCH_YEARS * size);
  return { id: k, kind, amount, delivered: 0, reward: Math.ceil(amount * contractPay(kind, t)), due: k + t.EARTH_CONTRACT_WINDOWS, accepted: false };
}

/** Earth's offer at window k, from the world as it stands: none with no city; research only once something earns it. */
export function dealOffer(s: SimState, k: number, t: Tuning): EarthContract | null {
  if (cities(s).length === 0) return null;
  const kinds = CONTRACT_KINDS.filter((kind) => WEIGHT[kind](t) > 0 && (kind !== "research" || researchRate(s, t) > 0));
  const total = kinds.reduce((a, kind) => a + WEIGHT[kind](t), 0);
  if (!(total > 0)) return null;
  let pick = rand01(s.seed, k, SALT.kind) * total;
  let kind = kinds[kinds.length - 1]!;
  for (const each of kinds) {
    pick -= WEIGHT[each](t);
    if (pick < 0) {
      kind = each;
      break;
    }
  }
  return contractFor(s, k, kind, t);
}

/**
 * This substep's research, credits: what goes to Earth for the research
 * contracts not yet met (in the order accepted), and what is left for the
 * bank. The same Earth back when there is none, so nothing is allocated.
 */
export function divertResearch(earth: EarthState, credits: number): { readonly earth: EarthState; readonly kept: number } {
  if (!earth.contracts.some((c) => c.kind === "research" && c.delivered < c.amount)) return { earth, kept: credits };
  let left = credits;
  const contracts = earth.contracts.map((c) => {
    if (c.kind !== "research" || c.delivered >= c.amount || left <= 0) return c;
    const give = Math.min(left, c.amount - c.delivered);
    left -= give;
    return { ...c, delivered: c.delivered + give };
  });
  return { earth: { ...earth, contracts }, kept: left };
}

// ---------------------------------------------------------------------------
// The step: inside `advance`, every substep
// ---------------------------------------------------------------------------

function record(earth: EarthState, r: Omit<EarthRecord, "id">, t: Tuning): EarthState {
  const log = [...earth.log, { id: earth.nextId, ...r }];
  return { ...earth, log: log.length > t.EARTH_LOG ? log.slice(log.length - t.EARTH_LOG) : log, nextId: earth.nextId + 1 };
}

function addGoods(a: EarthGoods, good: EarthGood, n: number): EarthGoods {
  return n === 0 ? a : { ...a, [good]: a[good] + n };
}

function withCity(s: SimState, c: Settlement): SimState {
  return { ...s, settlements: s.settlements.map((x) => (x.id === c.id ? c : x)) };
}

function paid(s: SimState, credits: number): SimState["economy"] {
  return credits === 0 ? s.economy : { ...s.economy, credits: s.economy.credits + credits, earned: s.economy.earned + credits };
}

/**
 * Rockets due home this substep land: each store takes what it has room for
 * and Earth buys back the rest at the window's price; settlers move into
 * homes and those with none are refunded; rovers join the city's.
 */
function landFlights(s: SimState, t: Tuning): SimState {
  let state = s;
  const k = windowIndex(s.steps, t);
  const staying: EarthFlight[] = [];
  for (const f of s.earth.flights) {
    if (f.arrives > state.steps) {
      staying.push(f);
      continue;
    }
    const c = state.settlements.find((x) => x.id === f.settlement);
    let earth: EarthState = state.earth;
    let landed: EarthGoods = NO_GOODS;
    let credits = 0;
    if (c !== undefined && c.lostAtSeaLevelM === null) {
      const cap = capacities(c, t);
      const stores = { ...c.stores };
      let sold = earth.sold;
      for (const g of SELLABLE) {
        const r = g as MicroResource;
        const fit = Math.max(0, Math.min(f.cargo[g], cap[r] - stores[r]));
        stores[r] += fit;
        landed = addGoods(landed, g, fit);
        const over = f.cargo[g] - fit;
        if (over > 0) {
          credits += saleValue(state.seed, k, g, earth.reputation, sold[g], over, t);
          sold = { ...sold, [g]: sold[g] + over * basePrice(g, t) };
        }
      }
      const room = Math.max(0, Math.floor(housing(c, t) - c.population));
      const settlers = Math.min(f.cargo.settlers, room);
      if (f.cargo.settlers > settlers) credits += Math.floor((f.paid.settlers * (f.cargo.settlers - settlers)) / f.cargo.settlers);
      landed = addGoods(addGoods(landed, "settlers", settlers), "rovers", f.cargo.rovers);
      state = withCity(state, { ...c, stores, population: c.population + settlers, extraRovers: c.extraRovers + f.cargo.rovers });
      earth = { ...earth, sold };
    }
    earth = record({ ...earth, earned: earth.earned + credits }, { kind: "landed", step: state.steps, settlement: f.settlement, contract: null, goods: landed, credits, reputation: 0 }, t);
    state = { ...state, economy: paid(state, credits), earth };
  }
  return { ...state, earth: { ...state.earth, flights: staying } };
}

/**
 * Window k opens: the market forgets a share of the trade it remembers; each
 * city's rocket, if it is home, lifts off with its sales and what the
 * contracts can take, to come back with its orders; a city whose rocket is
 * not there keeps its orders for the next. Orders for a settlement gone are
 * refunded.
 */
function openWindow(s: SimState, k: number, t: Tuning): SimState {
  const decay = (g: EarthGoods): EarthGoods => {
    const out = { ...g };
    for (const good of EARTH_GOODS) out[good] = g[good] * t.EARTH_MARKET_RECOVERY;
    return out;
  };
  let state: SimState = { ...s, earth: { ...s.earth, bought: decay(s.earth.bought), sold: decay(s.earth.sold) } };

  // Orders for a settlement no longer standing go back: a purchase refunded.
  const standing = new Set(state.settlements.filter((c) => c.lostAtSeaLevelM === null).map((c) => c.id));
  const gone = state.earth.orders.filter((o) => !standing.has(o.settlement));
  if (gone.length > 0) {
    const refund = gone.reduce((a, o) => a + o.paid, 0);
    state = {
      ...state,
      economy: { ...state.economy, credits: state.economy.credits + refund, spent: state.economy.spent - refund },
      earth: { ...state.earth, orders: state.earth.orders.filter((o) => standing.has(o.settlement)), spent: state.earth.spent - refund },
    };
  }

  const trip = tripSubsteps(t);
  const tripYears = tripCityYears(t);
  for (const c0 of s.settlements) {
    const c = state.settlements.find((x) => x.id === c0.id);
    if (c === undefined || c.lostAtSeaLevelM !== null) continue;
    const mine = state.earth.orders.filter((o) => o.settlement === c.id);
    const buys = mine.filter((o) => o.side === "buy");
    const sells = mine.filter((o) => o.side === "sell");
    const cap = capacities(c, t);
    const owed = state.earth.contracts.filter((x) => x.kind !== "research" && x.delivered < x.amount);
    const canSend = sells.length > 0 || owed.some((x) => spare(c.stores, cap, x.kind as MicroResource, t) > 0);
    if (buys.length === 0 && !canSend) continue;
    const port = rocketPort(c);
    if (port === null) {
      if (mine.length > 0) state = { ...state, earth: record(state.earth, { kind: "missed", step: state.steps, settlement: c.id, contract: null, goods: NO_GOODS, credits: 0, reputation: 0 }, t) };
      continue;
    }
    // Loaded: the player's sales first, then what the contracts can take.
    const stores = { ...c.stores };
    let sent: EarthGoods = NO_GOODS;
    let credits = 0;
    let earth = state.earth;
    let sold = earth.sold;
    const done = new Set<number>();
    for (const o of sells) {
      const r = o.good as MicroResource;
      const take = Math.min(o.amount, spare(stores, cap, r, t));
      if (take <= 0) continue;
      credits += saleValue(state.seed, k, o.good, earth.reputation, sold[o.good], take, t);
      sold = { ...sold, [o.good]: sold[o.good] + take * basePrice(o.good, t) };
      stores[r] -= take;
      sent = addGoods(sent, o.good, take);
      done.add(o.id);
    }
    const contracts = earth.contracts.map((x) => {
      if (x.kind === "research" || x.delivered >= x.amount) return x;
      const r = x.kind as MicroResource;
      const take = Math.min(x.amount - x.delivered, spare(stores, cap, r, t));
      if (take <= 0) return x;
      stores[r] -= take;
      sent = addGoods(sent, x.kind as EarthGood, take);
      return { ...x, delivered: x.delivered + take };
    });
    // A sale that found nothing to take waits for the next window, as an order does whose rocket is away.
    for (const o of buys) done.add(o.id);
    const flying = buys.length > 0 || EARTH_GOODS.some((g) => sent[g] > 0);
    if (!flying) continue;
    let cargo: EarthGoods = NO_GOODS;
    let cost: EarthGoods = NO_GOODS;
    for (const o of buys) {
      cargo = addGoods(cargo, o.good, o.amount);
      cost = addGoods(cost, o.good, o.paid);
    }
    const id = earth.nextId;
    const flight: EarthFlight = { id, settlement: c.id, tile: tileKey(port.tx, port.ty), launched: state.steps, arrives: state.steps + trip, cargo, paid: cost };
    const job: SettlementJob = { kind: "rocket", tile: flight.tile, total: tripYears, remaining: tripYears, earth: id };
    earth = {
      ...earth,
      sold,
      contracts,
      orders: earth.orders.filter((o) => !done.has(o.id)),
      flights: [...earth.flights, flight],
      earned: earth.earned + credits,
      nextId: id + 1,
    };
    earth = record(earth, { kind: "launched", step: state.steps, settlement: c.id, contract: null, goods: sent, credits, reputation: 0 }, t);
    state = { ...withCity(state, { ...c, stores, jobs: [...c.jobs, job] }), economy: paid(state, credits), earth };
  }
  return state;
}

/**
 * Accepted contracts: met ones pay and raise the player's reputation;
 * those whose window has come (`k`, at a window) and are still short fail
 * and lower it.
 */
function settleContracts(s: SimState, k: number | null, t: Tuning): SimState {
  if (!s.earth.contracts.some((x) => x.delivered >= x.amount || (k !== null && x.due <= k))) return s;
  let state = s;
  const waiting: EarthContract[] = [];
  for (const x of s.earth.contracts) {
    let earth = state.earth;
    if (x.delivered >= x.amount) {
      const reputation = Math.min(100, earth.reputation + t.EARTH_REP_FULFIL);
      earth = { ...earth, reputation, fulfilled: earth.fulfilled + 1, rewards: earth.rewards + x.reward };
      earth = record(earth, { kind: "fulfilled", step: state.steps, settlement: null, contract: x.kind, goods: NO_GOODS, credits: x.reward, reputation: reputation - state.earth.reputation }, t);
      state = { ...state, economy: paid(state, x.reward), earth };
    } else if (k !== null && x.due <= k) {
      const reputation = Math.max(0, earth.reputation - t.EARTH_REP_FAIL);
      earth = record({ ...earth, reputation, failed: earth.failed + 1 }, { kind: "failed", step: state.steps, settlement: null, contract: x.kind, goods: NO_GOODS, credits: 0, reputation: reputation - state.earth.reputation }, t);
      state = { ...state, earth };
    } else {
      waiting.push(x);
    }
  }
  return { ...state, earth: { ...state.earth, contracts: waiting } };
}

/**
 * Earth's work for one substep, from `advance` once the substep's state is
 * in (`state.steps` already counts it): rockets due home land; if a launch
 * window opens now, the rockets go up and Earth's offer is renewed; then the
 * contracts are settled - met ones paid, those due at this window and short
 * failed. Returns the same state when nothing happened, so a world with
 * Earth off - or between windows, with nothing in flight - allocates nothing.
 */
export function stepEarth(s: SimState, t: Tuning): SimState {
  if (!t.EARTH_ENABLED) return s;
  let state = s;
  if (state.earth.flights.some((f) => f.arrives <= state.steps)) state = landFlights(state, t);
  const k = windowAt(state.steps, t);
  if (k !== null) state = openWindow(state, k, t);
  state = settleContracts(state, k, t);
  if (k !== null) state = { ...state, earth: { ...state.earth, offer: dealOffer(state, k, t) } };
  return state;
}
