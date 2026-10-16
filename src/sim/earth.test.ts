/**
 * Batch 34, in the simulation alone: launch windows by the orbit; the
 * spaceport's rocket going up with what Earth is sent and coming back with
 * what was ordered; a window missed; the market's prices; contracts met and
 * failed; the same world however the time is split; and the save. (The exit
 * gate itself is measured on the browser's new worlds, in
 * `src/web/earth-gate.test.ts`.)
 */

import { describe, expect, it } from "vitest";

import { derive } from "./derive.js";
import {
  acceptContract,
  basePrice,
  buyCost,
  cancelEarthOrder,
  contractFor,
  dealOffer,
  earthPrices,
  emptyEarth,
  orderFromEarth,
  rocketPort,
  saleEstimate,
  supplyOf,
  tripCityYears,
  tripSubsteps,
  windowAt,
  windowIndex,
  windowStep,
} from "./earth.js";
import { habitat } from "./habitat.js";
import { advance } from "./integrate.js";
import { foundSettlement } from "./micro/registry.js";
import { capacities, housing, launchRocket, removeBuilding, settlementStep } from "./micro/settlement.js";
import { tileKey } from "./micro/space.js";
import { summariseAway } from "./offline.js";
import { marsStart } from "./planets/mars.js";
import { SaveError, deserialize, serialize, toSave } from "./save.js";
import { makeTuning, validateTuning } from "./tuning.js";
import type { EarthContract, EarthState, PlacedBuilding, Settlement, SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

/** A small Standard-paced world with cities, the economy and Earth on. */
const T = makeTuning({
  SETTLEMENTS_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  TIME_SCALE: 0.03 / 8,
  SUBSTEP_YEARS: 0.25 / 8,
  CITY_CLOCK: 8,
  CITY_GRID_TILES: 64,
  EARTH_ENABLED: 1,
});
validateTuning(T);
const OFF = makeTuning({ ...T, EARTH_ENABLED: 0 });
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const W1 = windowStep(1, T);
const W2 = windowStep(2, T);
const TRIP = tripSubsteps(T);

/** What keeps the town's 40 people housed and supplied: they stay, measured, at 40 to 44. */
const LIVING: readonly PlacedBuilding[] = [
  { type: "habitat_dome", tx: 4, ty: 4, level: 2 },
  { type: "solar_array", tx: 10, ty: 4, level: 3 },
  { type: "solar_array", tx: 14, ty: 4, level: 3 },
  { type: "greenhouse", tx: 18, ty: 4, level: 2 },
  { type: "water_extractor", tx: 22, ty: 4, level: 1 },
];

/** A small town with stores to spare, founded (as every city is) with its spaceport. */
function town(seed = 7, extra: PlacedBuilding[] = []): SimState {
  const s = foundSettlement(marsStart(seed, T), "city", 0.31, -1.2, T, "Ares").state;
  return {
    ...s,
    settlements: s.settlements.map((c) => ({
      ...c,
      population: 40,
      stores: { ...c.stores, materials: 300, water: 20, oxygen: 30, food: 30 },
      buildings: [...c.buildings, ...LIVING, ...extra],
    })),
  };
}
const city = (s: SimState): Settlement => s.settlements[0]!;
const port = (s: SimState): PlacedBuilding => city(s).buildings.find((b) => b.type === "spaceport")!;
const upTo = (s: SimState, step: number, t = T): SimState => advance(s, step - s.steps, { ...cfg, tuning: t });
const withEarth = (s: SimState, earth: Partial<EarthState>): SimState => ({ ...s, earth: { ...s.earth, ...earth } });
const withCity = (s: SimState, c: Partial<Settlement>): SimState => ({ ...s, settlements: s.settlements.map((x, i) => (i === 0 ? { ...x, ...c } : x)) });
const order = (s: SimState, good: Parameters<typeof orderFromEarth>[2], side: "buy" | "sell", amount: number): SimState => {
  const o = orderFromEarth(s, city(s).id, good, side, amount, T);
  expect(o.ok, o.reason ?? "").toBe(true);
  return o.state;
};
const accepted = (c: EarthContract): EarthContract => ({ ...c, accepted: true });

describe("launch windows come by the orbit (Batch 34)", () => {
  it("opens window k at the first substep on or after year k x 2.135, worked out from k alone", () => {
    for (const h of [0.25, 0.25 / 8]) {
      const t = makeTuning({ ...T, SUBSTEP_YEARS: h });
      let found = 0;
      let k = 0;
      for (let step = 0; step <= windowStep(200, t); step += 1) {
        const at = windowAt(step, t);
        if (at === null) {
          expect(windowIndex(step, t)).toBe(k);
          continue;
        }
        found += 1;
        k = at;
        expect(at).toBe(found);
        // On or after its date, and the substep before it is not.
        expect(step * h).toBeGreaterThanOrEqual(at * t.EARTH_SYNODIC_YEARS - 1e-9);
        expect((step - 1) * h).toBeLessThan(at * t.EARTH_SYNODIC_YEARS);
        expect(windowIndex(step, t)).toBe(at);
      }
      // Not vacuous: every window to the 200th was found, none twice, in order.
      expect(found).toBe(200);
    }
  });

  it("brings the rocket home before the next window, in whole substeps of the city's clock", () => {
    expect(TRIP).toBe(23);
    expect(W2 - W1).toBeGreaterThan(TRIP);
    expect(tripCityYears(T)).toBe(TRIP * T.SUBSTEP_YEARS * T.CITY_CLOCK);
  });
});

describe("the spaceport's rocket (Batch 34)", () => {
  it("lifts off at the window with the orders, as the spaceport's rocket, and lands them a trip later", () => {
    const base = town();
    const ordered = order(base, "water", "buy", 25);
    // Nothing goes before the window.
    const before = upTo(ordered, W1 - 1);
    expect(before.earth.flights).toEqual([]);
    expect(before.earth.orders.length).toBe(1);
    const up = upTo(before, W1);
    expect(up.earth.orders).toEqual([]);
    expect(up.earth.flights.length).toBe(1);
    const f = up.earth.flights[0]!;
    expect(f).toMatchObject({ settlement: city(up).id, tile: tileKey(port(up).tx, port(up).ty), launched: W1, arrives: W1 + TRIP });
    expect(f.cargo.water).toBe(25);
    // The rocket in the view: a rocket job on that spaceport carrying the shipment.
    expect(city(up).jobs).toContainEqual({ kind: "rocket", tile: f.tile, total: tripCityYears(T), remaining: tripCityYears(T), earth: f.id });
    expect(rocketPort(city(up))).toBeNull();
    // Still away a substep before it is due; home and unloaded when it is.
    const nearly = upTo(up, W1 + TRIP - 1);
    expect(nearly.earth.flights.length).toBe(1);
    // Drawn the whole way: the rocket is still away the substep before it lands.
    expect(city(nearly).jobs.filter((j) => j.kind === "rocket").length).toBe(1);
    const home = upTo(nearly, W1 + TRIP);
    expect(home.earth.flights).toEqual([]);
    expect(city(home).jobs.filter((j) => j.kind === "rocket")).toEqual([]);
    expect(home.earth.log.at(-1)).toMatchObject({ kind: "landed", step: W1 + TRIP, settlement: city(home).id });
    // Against the same world without the order, both with the water store emptied the substep before: exactly
    // the cargo, and no supply run's materials with it.
    const dry = (x: SimState) => withCity(x, { stores: { ...city(x).stores, water: 0 } });
    const landedHere = advance(dry(nearly), 1, cfg);
    const plain = advance(dry(upTo(base, W1 + TRIP - 1)), 1, cfg);
    expect(city(landedHere).stores.water - city(plain).stores.water).toBeCloseTo(25, 9);
    expect(city(landedHere).stores.materials).toBe(city(plain).stores.materials);
    expect(city(home).stores.materials).toBe(city(upTo(base, W1 + TRIP)).stores.materials);
  });

  it("sells back what does not fit as it lands, refunds the settlers with no home, and lands rovers in the city", () => {
    let s = withEarth(town(), { fulfilled: 3 });
    s = order(s, "water", "buy", 30);
    s = order(s, "settlers", "buy", 10);
    s = order(s, "rovers", "buy", 1);
    const paidWater = s.earth.orders.find((o) => o.good === "water")!.paid;
    const paidSettlers = s.earth.orders.find((o) => o.good === "settlers")!.paid;
    const nearly = upTo(s, W1 + TRIP - 1);
    // Water full and every home taken, the substep before it lands.
    const full = withCity(nearly, { stores: { ...city(nearly).stores, water: capacities(city(nearly), T).water }, population: housing(city(nearly), T) });
    const home = advance(full, 1, cfg);
    const landed = home.earth.log.find((r) => r.kind === "landed")!;
    expect(landed.goods.water).toBe(0);
    expect(landed.goods.settlers).toBe(0);
    expect(landed.goods.rovers).toBe(1);
    expect(city(home).extraRovers).toBe(city(s).extraRovers + 1);
    // Every settler refunded at what was paid; the water bought back at the window's price - less than Earth asked.
    const resale = landed.credits - paidSettlers;
    expect(resale).toBeGreaterThan(0);
    expect(resale).toBeLessThan(paidWater);
    expect(resale).toBe(saleEstimate({ ...full, earth: { ...full.earth, sold: { ...full.earth.sold, water: 0 } } }, "water", 30, T));
    // With homes to go to, the settlers land.
    const roomy = advance(withCity(nearly, { population: housing(city(nearly), T) - 20 }), 1, cfg);
    expect(roomy.earth.log.find((r) => r.kind === "landed")!.goods.settlers).toBe(10);
  });

  it("misses a window its rocket is away for: the orders wait, and go up at the next", () => {
    const p = (s: SimState) => port(s);
    let s = order(town(), "food", "buy", 10);
    // A supply run sent just before the window keeps the rocket away over it.
    s = upTo(s, W1 - 3);
    const sent = launchRocket(s, city(s).id, p(s).tx, p(s).ty, T);
    expect(sent.ok, sent.reason ?? "").toBe(true);
    s = upTo(sent.state, W1);
    expect(s.earth.log.at(-1)).toMatchObject({ kind: "missed", step: W1, settlement: city(s).id });
    expect(s.earth.orders.length).toBe(1);
    expect(s.earth.flights).toEqual([]);
    s = upTo(s, W2);
    expect(s.earth.orders).toEqual([]);
    expect(s.earth.flights[0]!.launched).toBe(W2);
  });

  it("does not fly from a spaceport still going up", () => {
    let s = order(town(), "food", "buy", 10);
    const p = port(s);
    s = removeBuilding(s, city(s).id, p.tx, p.ty).state;
    // A new spaceport its rover has years of work on yet: a worksite, not a launch pad.
    const site = { type: "spaceport" as const, tx: 40, ty: 40, level: 1 };
    const work = { kind: "build" as const, tile: tileKey(40, 40), work: 100, total: 120, remaining: 120, upgrade: false };
    s = withCity(s, { buildings: [...city(s).buildings, site], jobs: [...city(s).jobs, work] });
    expect(rocketPort(city(s))).toBeNull();
    s = upTo(s, W1);
    expect(s.earth.log.map((r) => r.kind)).toEqual(["missed"]);
    // Finished, it flies.
    expect(rocketPort(city(withCity(s, { jobs: [] })))).toEqual(site);
  });

  it("refunds the orders of a city lost to the sea at the next window", () => {
    let s = order(town(), "water", "buy", 10);
    const paid = s.earth.orders[0]!.paid;
    s = withCity(s, { lostAtSeaLevelM: 0 });
    const before = upTo(s, W1 - 1);
    const at = advance(before, 1, cfg);
    expect(at.earth.orders).toEqual([]);
    expect(at.earth.flights).toEqual([]);
    expect(at.economy.credits - advance(withEarth(before, { orders: [] }), 1, cfg).economy.credits).toBeCloseTo(paid, 9);
  });

  it("misses it too with no finished spaceport: the city's orders wait", () => {
    let s = order(town(), "food", "buy", 10);
    const p = port(s);
    s = removeBuilding(s, city(s).id, p.tx, p.ty).state;
    s = upTo(s, W1);
    expect(s.earth.log.map((r) => r.kind)).toEqual(["missed"]);
    expect(s.earth.orders.length).toBe(1);
  });
});

describe("orders and the market (Batch 34)", () => {
  it("charges a purchase when it is placed, at the market's price, and refunds it in full if cancelled", () => {
    const s = town();
    const cost = buyCost(s, "materials", 100, T);
    // About the price shown, a unit: the middle of the order is a little dearer than the first unit.
    expect(cost).toBeGreaterThanOrEqual(Math.floor(100 * earthPrices(s, T).materials.buy));
    const placed = order(s, "materials", "buy", 100);
    expect(placed.economy.credits).toBe(s.economy.credits - cost);
    expect(placed.earth.orders[0]).toMatchObject({ good: "materials", side: "buy", amount: 100, paid: cost, placed: s.steps });
    // The market remembers it: the next unit is dearer.
    expect(earthPrices(placed, T).materials.buy).toBeGreaterThan(earthPrices(s, T).materials.buy);
    const back = cancelEarthOrder(placed, placed.earth.orders[0]!.id, T);
    expect(back.ok).toBe(true);
    expect(back.state.economy.credits).toBe(s.economy.credits);
    expect(back.state.earth.orders).toEqual([]);
    expect(earthPrices(back.state, T).materials.buy).toBeCloseTo(earthPrices(s, T).materials.buy, 12);
  });

  it("costs the same bought in one order or in two, but for rounding up", () => {
    const s = town();
    const whole = buyCost(s, "oxygen", 300, T);
    const first = order(s, "oxygen", "buy", 120);
    const parts = buyCost(s, "oxygen", 120, T) + buyCost(first, "oxygen", 180, T);
    expect(parts - whole).toBeGreaterThanOrEqual(0);
    expect(parts - whole).toBeLessThanOrEqual(1);
  });

  it("refuses, changing nothing and saying why: Earth off, no spaceport, part of a unit, a locked good, an empty bank, a sale Earth does not take", () => {
    const s = town();
    const id = city(s).id;
    const noPort = withCity(s, { buildings: city(s).buildings.filter((b) => b.type !== "spaceport") });
    const poor = { ...s, economy: { ...s.economy, credits: 10 } };
    const cases: [SimState, Parameters<typeof orderFromEarth>, RegExp][] = [
      [s, [s, id, "water", "buy", 10, OFF], /not part of this world/],
      [noPort, [noPort, id, "water", "buy", 10, T], /no spaceport/],
      [s, [s, id, "water", "buy", 2.5, T], /whole number/],
      [s, [s, id, "water", "buy", 0, T], /whole number/],
      [s, [s, id, "settlers", "buy", 5, T], /once 1 contract is met/],
      [s, [s, id, "rovers", "buy", 1, T], /once 3 contracts are met/],
      [poor, [poor, id, "water", "buy", 10, T], /the bank holds 10/],
      [s, [s, id, "settlers", "sell", 5, T], /does not buy settlers/],
      [s, [s, "settlement-9", "water", "buy", 10, T], /no settlement/],
    ];
    for (const [state, args, why] of cases) {
      const o = orderFromEarth(...args);
      expect(o.ok).toBe(false);
      expect(o.state).toBe(state);
      expect(o.reason).toMatch(why);
    }
    // Settlers are for sale once a contract is met.
    expect(orderFromEarth(withEarth(s, { fulfilled: 1 }), id, "settlers", "buy", 5, T).ok).toBe(true);
  });

  it("moves each window with Earth's supply, drawn from the seed, and with the player's reputation", () => {
    const s = town();
    const a = earthPrices(upTo(s, W1), T).materials.buy;
    const b = earthPrices(upTo(s, W2), T).materials.buy;
    expect(a).toBeCloseTo(T.EARTH_PRICE_MATERIALS * supplyOf(s.seed, 1, "materials", T), 9);
    expect(b).toBeCloseTo(T.EARTH_PRICE_MATERIALS * supplyOf(s.seed, 2, "materials", T), 9);
    expect(a).not.toBe(b);
    // Another seed, another market; every window inside the swing.
    let differs = 0;
    for (let k = 1; k <= 50; k += 1) {
      const w = supplyOf(s.seed, k, "water", T);
      expect(Math.abs(w - 1)).toBeLessThanOrEqual(T.EARTH_SUPPLY_SWING);
      if (w !== supplyOf(s.seed + 1, k, "water", T)) differs += 1;
    }
    expect(differs).toBe(50);
    // At full reputation Earth asks EARTH_REP_PRICE less and pays as much more; at none, the other way.
    const now = earthPrices(s, T).water;
    const best = earthPrices(withEarth(s, { reputation: 100 }), T).water;
    const worst = earthPrices(withEarth(s, { reputation: 0 }), T).water;
    expect(best.buy / now.buy).toBeCloseTo(1 - T.EARTH_REP_PRICE, 12);
    expect(best.sell / now.sell).toBeCloseTo(1 + T.EARTH_REP_PRICE, 12);
    expect(worst.buy / now.buy).toBeCloseTo(1 + T.EARTH_REP_PRICE, 12);
    expect(worst.sell / now.sell).toBeCloseTo(1 - T.EARTH_REP_PRICE, 12);
  });

  it("never pays more than it asks: a tuning that would let buying and selling back make credits is refused", () => {
    // As tuned, Earth's best price for what it buys meets its cheapest asking exactly (0.6 of the base price).
    const best = (1 + T.EARTH_SUPPLY_SWING) * T.EARTH_SELL_SHARE * (1 + T.EARTH_REP_PRICE);
    const cheapest = (1 - T.EARTH_SUPPLY_SWING) * (1 - T.EARTH_REP_PRICE);
    expect(best).toBeCloseTo(cheapest, 12);
    expect(() => validateTuning(makeTuning({ ...T, EARTH_SELL_SHARE: 0.41 }))).toThrow(/pay more than it asks/);
    expect(() => validateTuning(makeTuning({ ...T, EARTH_SUPPLY_SWING: 0.21 }))).toThrow(/pay more than it asks/);
    // And, measured on the prices themselves: at full reputation, the dearest window's offer against the cheapest's asking.
    let at = withEarth(town(), { reputation: 100 });
    let dearest = 0;
    let cheapestAsk = Infinity;
    for (let k = 1; k <= 60; k += 1) {
      at = upTo(at, windowStep(k, T));
      const p = earthPrices(at, T).materials;
      dearest = Math.max(dearest, p.sell);
      cheapestAsk = Math.min(cheapestAsk, p.buy);
    }
    expect(dearest).toBeLessThanOrEqual(cheapestAsk);
  });

  it("forgets EARTH_MARKET_RECOVERY of the trade it remembers at each window", () => {
    const s = order(town(), "materials", "buy", 200);
    const remembered = s.earth.bought.materials;
    expect(remembered).toBe(200 * basePrice("materials", T));
    expect(upTo(s, W1 - 1).earth.bought.materials).toBe(remembered);
    expect(upTo(s, W1).earth.bought.materials).toBe(remembered * T.EARTH_MARKET_RECOVERY);
  });

  it("sends a sale up at the window - only what is above a quarter of the store's room - paid at the window's price", () => {
    const s = order(town(), "materials", "sell", 1000);
    const at = upTo(s, W1 - 1);
    const cap = capacities(city(at), T).materials;
    const spare = Math.floor(city(at).stores.materials - T.EARTH_KEEP_SHARE * cap);
    expect(spare).toBeGreaterThan(0);
    // The price at the window, from the world a substep before it, a step on.
    const up = upTo(at, W1);
    const launched = up.earth.log.at(-1)!;
    expect(launched).toMatchObject({ kind: "launched", step: W1 });
    // What was taken leaves a quarter of the room, to the unit.
    expect(launched.goods.materials).toBeGreaterThan(0);
    expect(city(up).stores.materials).toBeGreaterThanOrEqual(T.EARTH_KEEP_SHARE * cap);
    expect(city(up).stores.materials).toBeLessThan(T.EARTH_KEEP_SHARE * cap + 1);
    expect(launched.credits).toBe(saleEstimate({ ...up, earth: { ...up.earth, sold: { ...up.earth.sold, materials: 0 } } }, "materials", launched.goods.materials, T));
    expect(up.economy.credits - upTo(town(), W1).economy.credits).toBeCloseTo(launched.credits, 6);
    expect(up.earth.orders).toEqual([]);
    // Earth pays less for the next lot.
    expect(earthPrices(up, T).materials.sell).toBeLessThan(earthPrices(upTo(town(), W1), T).materials.sell);
  });

  it("keeps a sale with nothing to send waiting for the next window, though the rocket flies", () => {
    const before = upTo(order(town(), "food", "sell", 10), W1 - 1);
    const up = advance(withCity(before, { stores: { ...city(before).stores, food: 0 } }), 1, cfg);
    expect(up.earth.orders.length).toBe(1);
    expect(up.earth.flights).toEqual([]);
    // With a purchase going up on the same rocket, the sale that found nothing still waits.
    const both = order(withCity(before, { stores: { ...city(before).stores, food: 0 } }), "water", "buy", 5);
    const flown = advance(both, 1, cfg);
    expect(flown.earth.flights.length).toBe(1);
    expect(flown.earth.orders.map((o) => [o.good, o.side])).toEqual([["food", "sell"]]);
  });
});

describe("Earth's contracts (Batch 34)", () => {
  it("offers one at each window once a city has people, dealt from the seed and the world", () => {
    expect(upTo(town(), W1 - 1).earth.offer).toBeNull();
    const s = upTo(town(), W1);
    expect(s.earth.offer).toEqual(dealOffer(s, 1, T));
    expect(s.earth.offer).toMatchObject({ id: 1, due: 1 + T.EARTH_CONTRACT_WINDOWS, delivered: 0, accepted: false });
    // A city with no one in it gets none.
    const empty = withCity(town(), { population: 0, buildings: city(town()).buildings.filter((b) => b.type === "headquarters" || b.type === "spaceport") });
    expect(upTo(empty, W1).earth.offer).toBeNull();
    // Each kind comes up across seeds once research is earned; research never before.
    const lab = { type: "laboratory" as const, tx: 20, ty: 20, level: 1 };
    const kinds = new Set<string>();
    const without = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      kinds.add(dealOffer(town(seed, [lab]), 1, T)!.kind);
      without.add(dealOffer(town(seed), 1, T)!.kind);
    }
    expect([...kinds].sort()).toEqual(["materials", "research", "water"]);
    expect([...without].sort()).toEqual(["materials", "water"]);
  });

  it("lets an offer not taken lapse at the next window, and takes one accepted off the table", () => {
    const s = upTo(town(), W1);
    const first = s.earth.offer!;
    expect(upTo(s, W2).earth.offer!.id).toBe(2);
    const taken = acceptContract(s, T);
    expect(taken.ok).toBe(true);
    expect(taken.state.earth.offer).toBeNull();
    expect(taken.state.earth.contracts).toEqual([{ ...first, accepted: true }]);
    expect(acceptContract(taken.state, T).reason).toMatch(/nothing on offer/);
    expect(acceptContract(s, OFF).ok).toBe(false);
  });

  it("fills materials from what is above the keep at a window, pays when met, and raises the reputation", () => {
    const deal = accepted({ ...contractFor(town(), 1, "materials", T), amount: 120, reward: 777, due: 4 });
    const s = withEarth(town(), { contracts: [deal] });
    const up = upTo(s, W1);
    expect(up.earth.contracts).toEqual([]);
    expect(up.earth.reputation).toBe(T.EARTH_REP_START + T.EARTH_REP_FULFIL);
    expect(up.earth.fulfilled).toBe(1);
    expect(up.earth.rewards).toBe(777);
    expect(up.earth.log.map((r) => r.kind)).toEqual(["launched", "fulfilled"]);
    expect(up.earth.log[0]!.goods.materials).toBe(120);
    // Paid: against the same world without the contract, the reward, and 120 materials fewer.
    const plain = upTo(town(), W1);
    expect(up.economy.credits - plain.economy.credits).toBeCloseTo(777, 6);
    expect(city(plain).stores.materials - city(up).stores.materials).toBeCloseTo(120, 6);
    // And settlers are for sale now.
    expect(orderFromEarth(up, city(up).id, "settlers", "buy", 1, T).ok).toBe(true);
  });

  it("fills a contract over several windows when one cannot carry it all", () => {
    const deal = accepted({ ...contractFor(town(), 1, "materials", T), amount: 400, reward: 10, due: 4 });
    const s = withEarth(town(), { contracts: [deal] });
    const one = upTo(s, W1);
    const sent = one.earth.contracts[0]!.delivered;
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(400);
    // It took what was above a quarter of the room, and no more.
    const cap = capacities(city(one), T).materials;
    expect(city(one).stores.materials).toBeGreaterThanOrEqual(T.EARTH_KEEP_SHARE * cap);
    expect(city(one).stores.materials).toBeLessThan(T.EARTH_KEEP_SHARE * cap + 1);
    // The store made up again before the next window, which sends the rest.
    const refilled = withCity(upTo(one, W2 - 1), { stores: { ...city(one).stores, materials: 400 } });
    const two = advance(refilled, 1, cfg);
    expect(two.earth.contracts).toEqual([]);
    expect(two.earth.log.at(-1)).toMatchObject({ kind: "fulfilled", step: W2, contract: "materials" });
  });

  it("fails one still short at its window: no pay, and the reputation falls", () => {
    // More water than two windows can carry from a town that holds 40.
    const deal = accepted({ ...contractFor(town(), 1, "water", T), amount: 500, reward: 999, due: 2 });
    const at1 = upTo(withEarth(town(), { contracts: [deal] }), W1);
    expect(at1.earth.contracts.length).toBe(1);
    expect(at1.earth.contracts[0]!.delivered).toBeGreaterThan(0);
    const at2 = upTo(at1, W2);
    expect(at2.earth.contracts).toEqual([]);
    expect(at2.earth.reputation).toBe(T.EARTH_REP_START - T.EARTH_REP_FAIL);
    expect(at2.earth.failed).toBe(1);
    expect(at2.earth.rewards).toBe(0);
    expect(at2.earth.log.at(-1)).toMatchObject({ kind: "failed", step: W2, contract: "water", credits: 0, reputation: -T.EARTH_REP_FAIL });
  });

  it("sends the planet's research to Earth instead of the bank until a research contract is met, then pays", () => {
    const labs: PlacedBuilding[] = [
      { type: "solar_array", tx: 20, ty: 4, level: 3 },
      { type: "solar_array", tx: 24, ty: 4, level: 3 },
      { type: "laboratory", tx: 20, ty: 20, level: 1 },
    ];
    const s0 = town(7, labs);
    const env = habitat(s0.reservoirs, derive(s0.reservoirs, NEUTRAL_ENV, T), T, 0);
    const perYear = settlementStep(city(s0), env, T, T.SUBSTEP_YEARS * T.CITY_CLOCK).research;
    // Not vacuous: the laboratory earns.
    expect(perYear).toBeGreaterThan(0);
    const amount = perYear * T.SUBSTEP_YEARS * 10.5;
    const deal = accepted({ ...contractFor(s0, 1, "research", T), amount, reward: 500, due: 3 });
    const s = withEarth(s0, { contracts: [deal] });
    // Ten substeps in: all of it sent, none banked.
    const ten = advance(s, 10, cfg);
    const plain = advance(s0, 10, cfg);
    expect(ten.earth.contracts[0]!.delivered).toBeCloseTo(plain.economy.credits - ten.economy.credits, 9);
    expect(ten.earth.contracts[0]!.delivered).toBeCloseTo(perYear * T.SUBSTEP_YEARS * 10, 6);
    // The eleventh meets it: the rest of that substep's research is banked, and the reward paid.
    const met = advance(ten, 1, cfg);
    expect(met.earth.contracts).toEqual([]);
    expect(met.earth.log.at(-1)).toMatchObject({ kind: "fulfilled", contract: "research", credits: 500 });
    const plain11 = advance(s0, 11, cfg);
    expect(met.economy.credits - plain11.economy.credits).toBeCloseTo(500 - amount, 6);
  });
});

describe("Earth in time and in the save (Batch 34)", () => {
  /** A busy world: orders both ways, a contract of each kind under way, labs earning. */
  function busy(): SimState {
    const labs: PlacedBuilding[] = [
      { type: "solar_array", tx: 20, ty: 4, level: 3 },
      { type: "laboratory", tx: 20, ty: 20, level: 1 },
    ];
    let s = town(11, labs);
    s = order(s, "water", "buy", 15);
    s = order(s, "materials", "sell", 60);
    return withEarth(s, {
      contracts: [accepted({ ...contractFor(s, 1, "materials", T), amount: 300, due: 3 }), accepted({ ...contractFor(s, 1, "research", T), id: 2, amount: 30, due: 4 })],
    });
  }

  it("is the same world in one call and in ragged chunks, over windows, landings and contracts", () => {
    const s = busy();
    const n = W2 + TRIP + 5;
    const whole = advance(s, n, cfg);
    let chunked = s;
    for (const k of [1, 7, 68, 1, 3, 40, 22, 1]) chunked = advance(chunked, k, cfg);
    chunked = advance(chunked, n - chunked.steps, cfg);
    expect(chunked).toEqual(whole);
    // Not vacuous: two windows flew, something landed, a contract settled.
    expect(whole.earth.log.filter((r) => r.kind === "launched").length).toBe(2);
    expect(whole.earth.log.some((r) => r.kind === "landed")).toBe(true);
    expect(whole.earth.log.some((r) => r.kind === "fulfilled" || r.kind === "failed")).toBe(true);
  });

  it("changes nothing with Earth off, whatever is waiting", () => {
    const s = busy();
    const off = advance(s, W2 + TRIP, { ...cfg, tuning: OFF });
    expect(off.earth).toBe(s.earth);
    expect(city(off).jobs.some((j) => j.kind === "rocket")).toBe(false);
  });

  it("saves and loads every part of it, a rocket away included, and carries on the same", () => {
    // A purchase and a sale waiting for the next window, too.
    const s = order(order(upTo(acceptContract(upTo(busy(), W1), T).state, W1 + 3), "food", "buy", 4), "water", "sell", 2);
    expect(s.earth.flights.length).toBe(1);
    expect(s.earth.contracts.length).toBe(3);
    expect(s.earth.orders.length).toBe(2);
    const back = deserialize(serialize(s, T, "2026-10-16T00:00:00Z"), T);
    expect(back.earth).toEqual(s.earth);
    expect(city(back).jobs).toEqual(city(s).jobs);
    expect(advance(back, 60, cfg)).toEqual(advance(s, 60, cfg));
  });

  it("loads a v18 save with Earth as a world starts it", () => {
    const s = busy();
    const save = toSave(s, T, "2026-10-16T00:00:00Z") as unknown as Record<string, unknown>;
    const v18: Record<string, unknown> = { ...save, schema_version: 18 };
    delete v18["earth"];
    const back = deserialize(JSON.stringify(v18), T);
    expect(back.earth).toEqual(emptyEarth(T));
  });

  it("tells a player coming back how many contracts were met and failed while away", () => {
    const met = accepted({ ...contractFor(town(), 1, "materials", T), amount: 50, due: 3 });
    const lost = accepted({ ...contractFor(town(), 0, "water", T), amount: 5000, due: 1 });
    const before = withEarth(town(), { contracts: [met, lost] });
    const after = upTo(before, W1);
    const away = summariseAway(before, after, T);
    expect(away.contracts).toEqual({ fulfilled: 1, failed: 1 });
    expect(away.headline).toMatch(/ Earth: a contract met, a contract failed - see Earth\.$/);
    expect(summariseAway(after, after, T).headline).not.toMatch(/Earth/);
  });

  it("refuses a corrupt record, by name", () => {
    const s = upTo(busy(), W1 + 1);
    const good = toSave(s, T, "2026-10-16T00:00:00Z") as unknown as { earth: Record<string, unknown> };
    const bad = (earth: Record<string, unknown>) => () => deserialize(JSON.stringify({ ...good, earth: { ...good.earth, ...earth } }), T);
    const flights = good.earth["flights"] as Record<string, unknown>[];
    expect(bad({ reputation: 101 })).toThrow(/earth.reputation/);
    expect(bad({ orders: [{ id: 1, settlement: "nowhere", good: "water", side: "buy", amount: 1, paid: 1, placed: 0 }] })).toThrow(/earth.orders\[0\].settlement/);
    expect(bad({ flights: [{ ...flights[0]!, arrives: 0 }] })).toThrow(/earth.flights\[0\].arrives/);
    expect(bad({ offer: { id: 1, kind: "gold", amount: 1, delivered: 0, reward: 1, due: 2, accepted: false } })).toThrow(/earth.offer.kind/);
    expect(bad({ next_id: 1 })).toThrow(/not below earth.next_id/);
    expect(bad({ bought: { ...(good.earth["bought"] as object), water: -1 } })).toThrow(/earth.bought.water/);
    expect(bad({ orders: [{ id: 1, settlement: city(s).id, good: "settlers", side: "sell", amount: 1, paid: 0, placed: 0 }] })).toThrow(/sells settlers, which Earth does not buy/);
    expect(SaveError).toBeDefined();
  });
});
