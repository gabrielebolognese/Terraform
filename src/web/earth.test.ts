// @vitest-environment happy-dom

/**
 * Batch 34 on screen, through the real components: the Earth panel shows the
 * player's standing, the next launch window and Earth's prices; an order, a
 * cancel and an acceptance go through the simulation, and what the world
 * would refuse is shown disabled with the reason; the rockets away and the
 * contracts taken are listed; the alerts announce what passed between the
 * planet and Earth; and the assembled game puts Earth in the bar.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { EarthGood, SimState } from "../sim/index.js";
import { NEUTRAL_ENV, acceptContract, advance, buyCost, cancelEarthOrder, contractFor, derive, foundSettlement, habitat, marsStart, orderFromEarth, windowStep, worldEnv } from "../sim/index.js";
import { AlertWatch } from "./alerts.js";
import { EarthPanel } from "./earth.js";
import { recordWords } from "./earth-words.js";
import { startGame } from "./game.js";
import type { GameHandle } from "./game.js";
import { worldTuning } from "./game-tuning.js";

const T = worldTuning("standard", 0, "standard");
const SANDBOX = worldTuning("sandbox", 0, "standard");
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const W1 = windowStep(1, T);

afterEach(() => {
  document.body.replaceChildren();
});

/** Ares, founded with its spaceport, 40 people and stores to spare. */
function ares(): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 40, stores: { ...c.stores, materials: 300 } })) };
}

function mount(state: SimState, t = T) {
  const host = document.createElement("div");
  document.body.append(host);
  let current = state;
  const panel = new EarthPanel(host, t, {
    onOrder: (id, good, side, amount) => {
      const o = orderFromEarth(current, id, good, side, amount, t);
      current = o.state;
      return o;
    },
    onCancel: (id) => {
      const o = cancelEarthOrder(current, id, t);
      current = o.state;
      return o;
    },
    onAccept: () => {
      const o = acceptContract(current, t);
      current = o.state;
      return o;
    },
    onGo: () => {},
  });
  const show = (s?: SimState) => {
    if (s !== undefined) current = s;
    panel.update(current, 1);
  };
  return { host, panel, show, state: () => current };
}

const pick = (host: HTMLElement, good: EarthGood, amount: number) => {
  const select = host.querySelector<HTMLSelectElement>(".earth-good")!;
  select.value = good;
  select.dispatchEvent(new Event("input"));
  const input = host.querySelector<HTMLInputElement>(".earth-amount")!;
  input.value = String(amount);
  input.dispatchEvent(new Event("input"));
};

describe("the Earth panel", () => {
  it("is not there in a world without Earth", () => {
    const { host, show } = mount(ares(), SANDBOX);
    show();
    expect(host.querySelector<HTMLButtonElement>(".earth-toggle")!.hidden).toBe(true);
  });

  it("shows the standing, the next launch window and Earth's prices, settlers and rovers locked", () => {
    const { host, panel, show } = mount(ares());
    show();
    panel.setOpen(true);
    expect(host.querySelector(".earth-status")!.textContent).toMatch(/^Reputation 50 of 100: Neutral\. Next launch window in 9 min 3\d s\. A rocket's trip there and back takes 3 min 1\d s\.$/);
    const rows = [...host.querySelectorAll<HTMLElement>(".earth-price")].map((r) => [r.dataset["good"], ...[...r.querySelectorAll("td")].slice(1).map((d) => d.textContent)]);
    expect(rows.map((r) => r[0])).toEqual(["materials", "water", "food", "oxygen", "settlers", "rovers"]);
    expect(rows[4]).toEqual(["settlers", "After 1 contract met", "-"]);
    expect(rows[5]).toEqual(["rovers", "After 3 contracts met", "-"]);
    expect(Number(rows[0]![1])).toBeGreaterThan(0);
    expect(Number(rows[0]![2])).toBeLessThan(Number(rows[0]![1]));
  });

  it("places an order through the simulation at the price on the button, lists it, and cancels it for a refund", () => {
    const { host, panel, show, state } = mount(ares());
    show();
    panel.setOpen(true);
    pick(host, "water", 20);
    const cost = buyCost(state(), "water", 20, T);
    const buy = host.querySelector<HTMLButtonElement>(".earth-buy")!;
    expect(buy.textContent).toBe(`Buy for ${cost} credits`);
    const before = state().economy.credits;
    buy.click();
    expect(state().earth.orders).toEqual([expect.objectContaining({ good: "water", side: "buy", amount: 20, paid: cost })]);
    expect(state().economy.credits).toBe(before - cost);
    show();
    expect(host.querySelector(".earth-order-line .earth-line")!.textContent).toBe(`Buy 20 units of water for Ares: ${cost} credits paid`);
    host.querySelector<HTMLButtonElement>(".earth-cancel")!.click();
    expect(state().earth.orders).toEqual([]);
    expect(state().economy.credits).toBe(before);
  });

  it("disables what the world would refuse, with the reason", () => {
    const poor = { ...ares(), economy: { ...ares().economy, credits: 5 } };
    const { host, panel, show } = mount(poor);
    show();
    panel.setOpen(true);
    pick(host, "materials", 100);
    const buy = host.querySelector<HTMLButtonElement>(".earth-buy")!;
    expect(buy.disabled).toBe(true);
    expect(buy.title).toMatch(/the bank holds 5/);
    pick(host, "settlers", 10);
    expect(host.querySelector<HTMLButtonElement>(".earth-buy")!.title).toMatch(/once 1 contract is met/);
    expect(host.querySelector<HTMLButtonElement>(".earth-sell")!.disabled).toBe(true);
  });

  it("shows the rocket away and when it is home, then what it landed", () => {
    const { host, panel, show, state } = mount(ares());
    show();
    panel.setOpen(true);
    pick(host, "food", 10);
    host.querySelector<HTMLButtonElement>(".earth-buy")!.click();
    show(advance(state(), W1 - state().steps, cfg));
    expect(host.querySelector(".earth-flight")!.textContent).toMatch(/^Ares's rocket, bringing 10 units of food: home in 3 min 1\d s$/);
    show(advance(state(), 30, cfg));
    expect(host.querySelector(".earth-flight")).toBeNull();
    const lines = [...host.querySelectorAll(".earth-record-title")].map((n) => n.textContent);
    expect(lines).toEqual(["Rocket home in Ares", "Rocket up from Ares"]);
  });

  it("offers Earth's contract with what it pays, and shows it under way once accepted", () => {
    const s = ares();
    const { host, panel, show, state } = mount({ ...s, earth: { ...s.earth, offer: contractFor(s, 0, "materials", T) } });
    show();
    panel.setOpen(true);
    const offer = state().earth.offer!;
    expect(offer).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>(".earth-toggle")!.textContent).toBe("Earth (an offer)");
    expect(host.querySelector("[data-offer] .earth-contract-pay")!.textContent).toBe(`Pays ${offer.reward.toLocaleString("en")} credits and reputation +10. Failing costs reputation 20.`);
    host.querySelector<HTMLButtonElement>(".earth-accept")!.click();
    show();
    expect(state().earth.contracts.length).toBe(1);
    const meter = host.querySelector<HTMLElement>(".earth-contracts .earth-bar")!;
    expect(meter.getAttribute("aria-valuenow")).toBe("0");
    expect(meter.getAttribute("aria-valuemax")).toBe(String(offer.amount));
    expect(host.querySelector(".earth-contracts .earth-contract-when")!.textContent).toMatch(/^Due by the launch window in /);
  });
});

describe("Earth in the alerts", () => {
  const env = (s: SimState) => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);
  const look = (w: AlertWatch, s: SimState, now: number) => w.observe({ state: s, env: env(s), liquidRatePerYear: 0, tuning: T, now });

  it("announces a rocket home, a window missed, a contract met or failed, and a new offer - not a rocket going up", () => {
    let s = orderFromEarth(ares(), "settlement-1", "food", "buy", 5, T).state;
    const deal = { ...contractFor(s, 0, "water", T), amount: 10_000, due: 1, accepted: true };
    s = { ...s, earth: { ...s.earth, contracts: [deal] } };
    const w = new AlertWatch();
    look(w, s, 0);
    // The first window: the rocket goes up (no alert) and the water contract fails.
    s = advance(s, W1 - s.steps, cfg);
    const at1 = look(w, s, 1000).fresh.filter((a) => a.kind === "earth");
    expect(at1.map((a) => a.title)).toEqual(["Earth's water contract failed"]);
    expect(at1[0]!.priority).toBe("notice");
    expect(at1.every((a) => a.target.kind === "earth")).toBe(true);
    // Home: a record.
    s = advance(s, 30, cfg);
    const home = look(w, s, 2000).fresh.filter((a) => a.kind === "earth");
    expect(home.map((a) => [a.title, a.priority])).toEqual([["Rocket home in Ares", "record"]]);
    expect(home[0]!.text).toBe(recordWords(s.earth.log.at(-1)!, s).text);
    // Nothing new: nothing announced.
    expect(look(w, s, 3000).fresh.filter((a) => a.kind === "earth")).toEqual([]);
    // An offer (a city with no homes has no people, so it is set here): announced once.
    s = { ...s, earth: { ...s.earth, offer: contractFor(s, 1, "materials", T) } };
    expect(look(w, s, 4000).fresh.filter((a) => a.kind === "earth").map((a) => a.title)).toEqual([expect.stringMatching(/^Earth offers a contract: \d+ materials$/)]);
    expect(look(w, s, 5000).fresh.filter((a) => a.kind === "earth")).toEqual([]);
  });

  it("takes its bearings on opening a world: what already passed is not announced again", () => {
    let s = orderFromEarth(ares(), "settlement-1", "food", "buy", 5, T).state;
    s = advance(s, W1 + 30, cfg);
    expect(s.earth.log.length).toBe(2);
    const w = new AlertWatch();
    expect(look(w, s, 0).fresh.filter((a) => a.kind === "earth")).toEqual([]);
  });
});

describe("Earth in the assembled game", () => {
  function play(state: SimState): { root: HTMLElement; handle: GameHandle } {
    const root = document.createElement("div");
    document.body.append(root);
    const handle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T) }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
    return { root, handle };
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("puts Earth in the bar, opens it in place of the alerts, and takes an order into the world", async () => {
    const { root, handle } = play(ares());
    try {
      await wait(700);
      const toggle = root.querySelector<HTMLButtonElement>(".game-bar .earth-toggle")!;
      expect(toggle.hidden).toBe(false);
      root.querySelector<HTMLButtonElement>(".alerts-toggle")!.click();
      toggle.click();
      expect(root.querySelector<HTMLElement>(".earth-panel")!.hidden).toBe(false);
      expect(root.querySelector<HTMLElement>(".alerts-panel")!.hidden).toBe(true);
      const amount = root.querySelector<HTMLInputElement>(".earth-amount")!;
      amount.value = "12";
      amount.dispatchEvent(new Event("input"));
      root.querySelector<HTMLButtonElement>(".earth-buy")!.click();
      expect(handle.state.earth.orders).toEqual([expect.objectContaining({ good: "materials", amount: 12 })]);
    } finally {
      handle.stop();
    }
  });
});
