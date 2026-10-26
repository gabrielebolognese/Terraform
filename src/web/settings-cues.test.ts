// @vitest-environment happy-dom

/**
 * Batch 36's second gate: every colour-coded element has a second,
 * non-colour cue.
 *
 * The page. Every rule in the stylesheet that colours an element by its
 * state - an attribute that says "urgent", "short", "off" - is in a
 * register, with how its state is said without colour (a word, a sign, a
 * shape) or why it needs none. The register is checked both ways against
 * the stylesheet, so a new colour rule cannot slip in unregistered; then
 * the real components are put in each state, and every element each rule
 * colours must carry its cue - and each rule must colour at least one, or
 * its check proves nothing.
 *
 * The canvases. The planner's map tells its colours apart with patterns -
 * a power line dashed, a railway striped, a plan dotted, a home no service
 * reaches hatched, a zone outlined - in every palette, and names what is
 * under the pointer; the city's land not yet claimable has a dashed edge, a
 * refused placement a cross. And the colour-blind palettes keep their
 * meanings apart for the colour blindness each is for, measured.
 */

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EarthRecord, SimState } from "../sim/index.js";
import {
  BUILDING_DEFS,
  NEUTRAL_ENV,
  ZONE_COLOURS,
  advance,
  cardFor,
  cityView,
  contractFor,
  derive,
  editZone,
  foundSettlement,
  habitat,
  keyTile,
  marsStart,
  objectiveStatus,
  placeBuilding,
  planLinks,
  placeLink,
  setFacilityEnabled,
  tileKey,
  worldEnv,
} from "../sim/index.js";
import { cityScene } from "../render/city.js";
import { AlertCentre, AlertToasts } from "./alert-centre.js";
import type { Alert } from "./alerts.js";
import { buildRows, orderDelta } from "./build.js";
import { DecisionPanel } from "./decisions.js";
import { EarthPanel } from "./earth.js";
import { startGame } from "./game.js";
import type { GameHandle } from "./game.js";
import { worldTuning } from "./game-tuning.js";
import { Globe } from "./globe.js";
import { Hud } from "./hud.js";
import type { HudView } from "./hud.js";
import { ObjectivesPanel } from "./onboarding.js";
import { MAP_PALETTES, zoneColour } from "./palette.js";
import type { MapKind, Rgb8 } from "./palette.js";
import { PlannerScreen, coverageOf, plannerPixels } from "./planner.js";
import { DEFAULT_SETTINGS, PALETTES } from "./settings.js";
import type { Palette, Settings } from "./settings.js";
import { Frames, drawCities, restoreCanvases } from "./test-frames.js";
import { WorldMapScreen } from "./world-map.js";

const T = worldTuning("standard", 0, "standard");
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const CSS = readFileSync("src/web/style.css", "utf8");

let frames: Frames;
beforeEach(() => {
  frames = new Frames();
});
afterEach(() => {
  restoreCanvases();
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-test]").forEach((s) => s.remove());
});

// ---------------------------------------------------------------------------
// The page: the register
// ---------------------------------------------------------------------------

/** Each rule in the stylesheet that colours an element by an attribute it carries: its selectors, one by one. */
function colourRules(css: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let m = re.exec(clean); m !== null; m = re.exec(clean)) {
    const colours = m[2]!.split(";").some((d) => /^\s*(color|background|background-color|border|border-color|border-left|border-left-color|outline|outline-color|box-shadow)\s*:/.test(d));
    if (!colours) continue;
    for (const sel of m[1]!.split(",").map((x) => x.trim().replace(/\s+/g, " "))) {
      if (sel.startsWith(":root") || sel.startsWith("@")) continue;
      if (/\[data-[a-z-]+(=|\])/.test(sel)) out.push(sel);
    }
  }
  return [...new Set(out)];
}

/** What an element says on screen: its text. A label only a screen reader hears is no cue for a player who cannot tell the colours apart. */
const words = (el: Element | null): string => (el === null ? "" : (el.textContent ?? "").replace(/\s+/g, " ").trim());
const up = (el: Element, sel: string): Element => el.closest(sel) ?? el;

/** How each colour-coded element says its state without colour. */
const CUES: Readonly<Record<string, { readonly cue: string; readonly test: (el: Element) => boolean }>> = {
  '.hud-advice-state[data-state="action"]': { cue: 'the words "needs you"', test: (el) => /needs you/.test(words(el)) },
  '.hud-advice-state[data-state="waiting"]': { cue: 'the words "in progress"', test: (el) => /in progress/.test(words(el)) },
  ...Object.fromEntries(
    ["at-target", "habitable", "safe", "below-minimum", "too-high", "above-band"].map((state) => [
      `.hud-metric-status[data-state="${state}"]`,
      { cue: `the words "${state.replace(/-/g, " ")}"`, test: (el: Element) => words(el) === state.replace(/-/g, " ") },
    ]),
  ),
  '.hud-feed-item[data-tone="milestone"] .hud-feed-text': { cue: 'the word "milestone" before it', test: (el) => /\bmilestone\b/.test(words(up(el, ".hud-feed-item"))) },
  '.hud-bank[data-state="losing"]': { cue: "a minus sign on the rate", test: (el) => /\(-\d/.test(words(el)) },
  '.hud-lever[data-state="running"]': { cue: '"units online", never "switched off"', test: (el) => /units online/.test(words(el)) && !/switched off/.test(words(el)) },
  '.hud-lever[data-state="off"]': { cue: 'the words "switched off"', test: (el) => /switched off/.test(words(el)) },
  '.globe-marker[data-kind="outpost"] .globe-marker-pin': { cue: "a square pin, where a city's is round", test: (el) => getComputedStyle(el).borderRadius === "2px" },
  '.city-status[data-state="short"]': { cue: 'the word "short"', test: (el) => /short/i.test(words(el)) },
  '.city-happiness[data-mood="happy"]': { cue: "growth and output with a plus", test: (el) => /growth \+/.test(words(el)) },
  '.city-happiness[data-mood="unhappy"]': { cue: "growth and output with a minus", test: (el) => /growth -/.test(words(el)) },
  '.city-need[data-state="unmet"] .city-need-name': { cue: 'what it "wants"', test: (el) => /wants/.test(words(up(el, ".city-need"))) },
  '.city-need[data-state="later"]': { cue: 'the people it is "asked from"', test: (el) => /asked from/.test(words(el)) },
  '.city-need[data-state="later"] .city-need-name': { cue: 'the people it is "asked from"', test: (el) => /asked from/.test(words(up(el, ".city-need"))) },
  '.city-card[data-short="true"] .city-card-cost': { cue: 'the words "not enough materials"', test: (el) => /not enough materials/.test(words(up(el, ".city-card"))) },
  '.city-inspector-status[data-state="off"]': { cue: "why, in words - never \"Running\"", test: (el) => words(el).length > 10 && !/^Running/.test(words(el)) },
  '.city-build[data-kind="building"]': { cue: '"Building the ..." or "Upgrading the ...", where one waiting "waits for a rover"', test: (el) => /^(Building|Upgrading) the /.test(words(el.querySelector(".city-build-words"))) },
  ".objectives-toggle[data-ready]": { cue: 'the words "to claim"', test: (el) => /to claim/.test(words(el)) },
  ".objective[data-done]": { cue: "a Claim button", test: (el) => /Claim/.test(words(el)) },
  ".alerts-toggle[data-urgent]": { cue: 'the word "urgent"', test: (el) => /urgent/.test(words(el)) },
  '.alert-line[data-priority="urgent"] .alert-go': { cue: 'the tag "Urgent"', test: (el) => /^Urgent/.test(words(el)) },
  '.alert-toast[data-priority="urgent"] .alert-toast-go': { cue: 'the tag "Urgent"', test: (el) => /^Urgent/.test(words(el)) },
  '.alert-line[data-priority="notice"] .alert-go': { cue: 'the tag "Notice"', test: (el) => /^Notice/.test(words(el)) },
  '.alert-toast[data-priority="notice"] .alert-toast-go': { cue: 'the tag "Notice"', test: (el) => /^Notice/.test(words(el)) },
  '.alert-line[data-priority="record"] .alert-go': { cue: 'the tag "Done"', test: (el) => /^Done/.test(words(el)) },
  ".hud-settlement-overview[data-short]": { cue: 'the words "short of"', test: (el) => /short of/.test(words(el)) },
  ".worldmap-overview[data-short]": { cue: 'the words "short of"', test: (el) => /short of/.test(words(el)) },
  ".decision-card[data-waiting]": { cue: "the event and its choices, in words", test: (el) => /Decide|choose|within/i.test(words(el)) },
  ".earth-toggle[data-offer]": { cue: 'the words "an offer"', test: (el) => /an offer/.test(words(el)) },
  '.earth-notice[data-state="refused"]': { cue: "what was refused and why, in words", test: (el) => /^Cannot|refused|not /i.test(words(el)) },
  '.earth-record-line[data-kind="missed"] .earth-record-title': { cue: 'the word "missed"', test: (el) => /missed/.test(words(el)) },
  '.earth-record-line[data-kind="failed"] .earth-record-title': { cue: 'the word "failed"', test: (el) => /failed/.test(words(el)) },
  ".earth-contract[data-offer]": { cue: 'the words "Earth asks for"', test: (el) => /Earth asks for/.test(words(el)) },
};

/** Colours keyed to an attribute that carry no state to read. */
const EXEMPT: Readonly<Record<string, string>> = {
  '.city-cards-thumb[data-dragging="true"]': "the build bar's thumb lit while the player drags it: the drag itself, under their hand",
  '.globe-markers[data-gold] .globe-marker:not([data-kind="outpost"]) .globe-marker-pin': "the gold markers are a reward's look (Batch 30), the same pin as ever in another colour - no state",
};

describe("the page's colour-coded elements", () => {
  it("every rule in the stylesheet that colours by an attribute is registered, with its cue or why it needs none - and nothing registered is gone", () => {
    const rules = colourRules(CSS);
    expect(rules.length, "the stylesheet's colour rules were found").toBeGreaterThan(25);
    const registered = new Set([...Object.keys(CUES), ...Object.keys(EXEMPT)]);
    expect(rules.filter((r) => !registered.has(r)), "colour rules with no cue registered").toEqual([]);
    expect([...registered].filter((r) => !rules.includes(r)), "registered rules the stylesheet no longer has").toEqual([]);
  });

  it("each says its state without colour in the real components, and each is seen at least once", () => {
    const style = document.createElement("style");
    style.dataset["test"] = "";
    style.textContent = CSS;
    document.head.append(style);
    const host = document.createElement("div");
    document.body.append(host);
    showEveryState(host);
    const unseen: string[] = [];
    const failing: string[] = [];
    for (const [sel, { cue, test }] of Object.entries(CUES)) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length === 0) unseen.push(sel);
      for (const el of found) if (!test(el)) failing.push(`${sel}: wants ${cue}, says "${words(el).slice(0, 120)}"`);
    }
    expect(failing, "coloured with no cue").toEqual([]);
    expect(unseen, "rules no element was put in the state of").toEqual([]);
    // The shape cue is a difference: a city's pin is round.
    const city = document.querySelector('.globe-marker[data-kind="city"] .globe-marker-pin')!;
    expect(getComputedStyle(city).borderRadius).toBe("50%");
  });
});

// ---------------------------------------------------------------------------
// Putting the real components in every state
// ---------------------------------------------------------------------------

const alertOf = (key: string, priority: Alert["priority"], title: string): Alert => ({ key, kind: priority === "record" ? "built" : "blackout", priority, title, text: `${title}.`, count: 1, target: { kind: "city", id: "settlement-1", at: null } });

/** Ares: founded, people, a Solar Array standing. */
function ares(): SimState {
  let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
  s = { ...s, economy: { ...s.economy, credits: 3000 }, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 600 } })) };
  for (let r = 4; r < 30; r += 1) {
    const o = placeBuilding(s, "settlement-1", "solar_array", 40 + r, 40, T);
    if (o.ok) {
      s = o.state;
      break;
    }
  }
  for (let i = 0; i < 40 && s.settlements[0]!.jobs.length > 0; i += 1) s = advance(s, 1, cfg);
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 250 })) };
}

/** Every colour-coded state, put on the page by the components that show it. */
function showEveryState(host: HTMLElement): void {
  const base = ares();

  // The HUD: a dead world, an in-between one and a finished one; the advice waiting and not; credits running out; a lever on and one off; a milestone; a city short of something.
  let levers = orderDelta(base, "orbital_mirror", 1, T).state;
  levers = orderDelta(levers, "ghg_factory", 1, T).state;
  levers = setFacilityEnabled(levers, "ghg_factory", false);
  const env = derive(base.reservoirs, worldEnv(base, NEUTRAL_ENV, T), T);
  const hudHooks = { onSpeed: () => {}, onOrder: () => {}, onSeed: () => {}, onFocusLever: () => {}, onToggleLever: () => {}, onFound: () => {}, onCancelFound: () => {}, onOpenSettlement: () => {} };
  const view = (kind: "barren" | "middle" | "finished", waiting: boolean): HudView => {
    const r = base.reservoirs;
    const d = kind === "barren" ? env : kind === "middle" ? { ...env, T: 280, P: 400, oceanFrac: 0.2 } : { ...env, T: 288, P: 1013, oceanFrac: 0.4 };
    return {
      simYear: 100,
      phase: 0,
      phaseReached: kind === "finished" ? 6 : kind === "middle" ? 3 : 0,
      progress: kind === "finished" ? 0.98 : 0.3,
      axes: { nT: 0.1, nP: 0.1, nO2: 0, nWater: 0, nBio: 0, nCO2: 0.1 },
      derived: d,
      reservoirs: kind === "finished" ? { ...r, o2: 215, biomass: 0.9, co2_atm: 0.8 } : kind === "middle" ? { ...r, o2: 40, biomass: 0.5, co2_atm: 250 } : r,
      advice: { bottleneck: "nT", title: "Temperature", problem: "Cold.", action: "Order orbital mirrors.", lever: "orbital_mirror", waiting, because: null },
      events: [{ year: 280, text: "Mean temperature has passed 273 K.", tone: "milestone", headline: false }],
      fresh: [],
      speed: 1,
      canSeed: false,
      canOrder: true,
      economy: { credits: 500, income: 1, upkeep: 40 },
      notice: null,
      build: buildRows(levers, T),
      settlements: base.settlements,
      founding: null,
      seeded: false,
      overviews: new Map([["settlement-1", { words: "250 people, short of oxygen", short: true }]]),
    } as HudView;
  };
  for (const [kind, waiting] of [["barren", false], ["middle", true], ["finished", false]] as const) {
    const box = document.createElement("div");
    host.append(box);
    new Hud(box, hudHooks, T).update(view(kind, waiting));
  }
  // Oceans past the top of their band.
  const flooded = document.createElement("div");
  host.append(flooded);
  const wet = view("finished", false);
  new Hud(flooded, hudHooks, T).update({ ...wet, derived: { ...wet.derived, oceanFrac: 0.9 } });

  // The planet's markers: a city, and an outpost.
  const outpost = foundSettlement(base, "outpost", -0.4, 2.2, T, "Camp").state;
  const stage = document.createElement("div");
  stage.className = "stage";
  host.append(stage);
  new Globe(stage).setSettlements(outpost.settlements);

  // The alerts: one of each priority, in the centre and as toasts; the button with something urgent.
  const centre = new AlertCentre(host, () => {});
  centre.update([alertOf("a", "urgent", "Blackout in Ares"), alertOf("b", "notice", "Greenhouse offline in Ares")], [alertOf("c", "record", "Dome finished in Ares")], 3);
  centre.setOpen(true);
  const toasts = new AlertToasts(host, () => {});
  toasts.push([alertOf("a", "urgent", "Blackout in Ares"), alertOf("b", "notice", "Greenhouse offline in Ares")]);
  toasts.frame(0);

  // Objectives: one done, its reward waiting.
  const objectives = new ObjectivesPanel(host, T, () => ({ ok: true, reason: null, words: "" }));
  const status = objectiveStatus(base, T).map((o, i) => (i === 0 ? { ...o, open: true, claimed: false, progress: { ...o.progress, done: true } } : o));
  objectives.setOpen(true);
  objectives.update(status);

  // An event waiting for a decision.
  const card = cardFor(base, 3, "outbreak", null, base.settlements[0]!, base.steps, T);
  if (card === null) throw new Error("no outbreak in Ares");
  new DecisionPanel(host, T, () => ({ ok: true, reason: null }), () => {}).update({ ...base, decisions: { open: [card], log: [] } }, 1);

  // Earth: an offer, a refusal, a window missed and a contract failed.
  const record = (id: number, kind: EarthRecord["kind"]): EarthRecord => ({ id, kind, step: base.steps, settlement: "settlement-1", contract: kind === "failed" ? "water" : null, goods: base.earth.bought, credits: 0, reputation: kind === "failed" ? -20 : 0 });
  const earthState: SimState = { ...base, earth: { ...base.earth, offer: contractFor(base, 0, "materials", T), log: [record(1, "missed"), record(2, "failed")] } };
  const earth = new EarthPanel(host, T, { onOrder: () => ({ ok: false, reason: "Earth will not sell that much" }) as never, onCancel: () => ({ ok: true, reason: null }) as never, onAccept: () => ({ ok: true, reason: null }) as never, onGo: () => {} });
  earth.update(earthState, 1);
  earth.setOpen(true);
  const amount = host.querySelector<HTMLInputElement>(".earth-amount")!;
  amount.value = "999999";
  amount.dispatchEvent(new Event("input"));
  host.querySelector<HTMLButtonElement>(".earth-buy")!.click();
  // Ares has no spaceport, so its Buy is off: the panel's refusal, as it says one.
  (earth as unknown as { say(text: string, ok: boolean): void }).say("Not ordered: Earth will not sell that much.", false);

  // The world map, a city short of something selected.
  const map = new WorldMapScreen(host, { onOpen: () => {}, onConnect: () => ({ ok: false, reason: "no", cost: 0 }) as never, onClose: () => {} }, T);
  map.shortages = new Map([["settlement-1", ["oxygen"]]]);
  map.open();
  const hab = habitat(base.reservoirs, env, T, 0);
  map.frame(base, hab, 0);
  // Selected as a click on its mark would (happy-dom lays nothing out, so there is no mark to click).
  (map as unknown as { selected: string | null }).selected = "settlement-1";
  // The map's picture is made over a few frames first.
  for (let i = 0; i < 400 && host.querySelector(".worldmap-overview") === null; i += 1) map.frame(base, hab, 1000 + i);

  // The city: the real game, down in Ares - a build going up, one waiting, nothing to pay with, an offline building selected.
  showCity(host);
}

/** Ares in the game, down in the city: its panel with a build under way, a card it cannot pay for, a building offline selected, its people. */
function showCity(host: HTMLElement): void {
  drawCities();
  frames.install();
  let s = ares();
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
  const hq = s.settlements[0]!.buildings.find((b) => b.type === "headquarters")!;
  // A greenhouse out on its own: finished, it stands offline.
  /** Placed on the first free ground in rings round the headquarters, from `from` tiles out. */
  const somewhere = (type: "greenhouse" | "habitat_dome", from: number): void => {
    for (let r = from; r < 30; r += 1) {
      for (let k = 0; k < 8 * r; k += 1) {
        const a = (k / (8 * r)) * 2 * Math.PI;
        const o = placeBuilding(s, "settlement-1", type, Math.round(hq.tx + r * Math.cos(a)), Math.round(hq.ty + r * Math.sin(a)), T);
        if (o.ok) {
          s = o.state;
          return;
        }
      }
    }
    throw new Error(`nowhere to build a ${type}`);
  };
  somewhere("greenhouse", 8);
  for (let i = 0; i < 400 && s.settlements[0]!.jobs.length > 0; i += 1) s = advance(s, 1, cfg);
  // Two more placed: one going up, one waiting for a rover; and no materials left for a card.
  somewhere("habitat_dome", 4);
  somewhere("habitat_dome", 4);
  s = advance(s, 1, cfg);
  // Nothing left to build with, and more people than life support: short.
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 400, stores: { ...c.stores, materials: 0, oxygen: 0, food: 0, water: 0 } })) };
  s = advance(s, 1, cfg);
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 3000, stores: { ...c.stores, materials: 0, oxygen: 0, food: 0, water: 0 } })) };
  const root = document.createElement("div");
  host.append(root);
  const handle: GameHandle = startGame(root, { state: s, tuning: T, fresh: () => marsStart(undefined, T), settings: { current: DEFAULT_SETTINGS } }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
  frames.step(2);
  root.querySelector<HTMLButtonElement>(".hud-settlement-open")!.click();
  for (let i = 0; i < 200 && handle.views.city.root.hidden; i += 1) frames.step();
  frames.step(40);
  const city = handle.views.city;
  const index = handle.state.settlements[0]!.buildings.findIndex((b) => b.type === "greenhouse");
  expect(index, "a greenhouse stands").toBeGreaterThanOrEqual(0);

  city.show(index);
  frames.step(40);

  // The people: happy in one reading, unhappy in another, a need unmet and one asked later - the panel's own drawing of each.
  const people = city as unknown as { renderPeople(view: { needs: unknown }): void; needsKey: string };
  const view = cityView(handle.state.settlements[0]!, habitat(handle.state.reservoirs, derive(handle.state.reservoirs, worldEnv(handle.state, NEUTRAL_ENV, T), T), T, 0), T);
  const needs = view.needs;
  if (needs === undefined || needs === null) throw new Error("needs are off in this world");
  const extra = document.createElement("div");
  host.append(extra);
  for (const mood of [0.4, -0.4]) {
    people.needsKey = "";
    people.renderPeople({ needs: { ...needs, mood, growth: 1 + mood / 2, output: 1 + mood / 10, needs: needs.needs.map((n, i) => (i === 0 ? { ...n, asked: true, met: 0 } : i === needs.needs.length - 1 ? { ...n, asked: false } : n)) } });
    // Kept: the panel is rewritten next time, so its lines are copied out as they were drawn.
    extra.append(...[...city.root.querySelectorAll(".city-people > *")].map((n) => n.cloneNode(true)));
  }
  // Short of water: the panel's status, as it says it when the view finds a shortage.
  const settlement = handle.state.settlements[0]!;
  const env = habitat(handle.state.reservoirs, derive(handle.state.reservoirs, worldEnv(handle.state, NEUTRAL_ENV, T), T), T, 0);
  (city as unknown as { renderPanel(v: unknown, s: unknown, e: unknown): void }).renderPanel({ ...view, shortages: ["water"] }, settlement, env);
  extra.append(city.root.querySelector(".city-status")!.cloneNode(true));
  void handle;
}

// ---------------------------------------------------------------------------
// The canvases
// ---------------------------------------------------------------------------

/** A tile's colour in the planner's pixels. */
const pixel = (px: Uint8ClampedArray, n: number, tx: number, ty: number): [number, number, number] => [px[(ty * n + tx) * 4]!, px[(ty * n + tx) * 4 + 1]!, px[(ty * n + tx) * 4 + 2]!];
/** How light a colour is, 0 to 255: what a player who cannot tell hues apart still sees. */
const light = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

describe("the planner's map", () => {
  /** Ares with a zone, a corridor, a power line, a railway planned, and its homes - one reached by nothing. */
  function planned(): SimState {
    let s = ares();
    const id = "settlement-1";
    const hq = s.settlements[0]!.buildings.find((b) => b.type === "headquarters")!;
    s = editZone(s, id, { name: "Works", add: Array.from({ length: 36 }, (_, k) => tileKey(hq.tx - 14 + (k % 6), hq.ty - 14 + Math.floor(k / 6))) }, T).state;
    for (let x = hq.tx - 8; x < hq.tx - 2; x += 1) {
      s = placeLink(s, id, "corridors", x, hq.ty - 4, T).state;
      s = placeLink(s, id, "cables", x, hq.ty - 6, T).state;
    }
    s = planLinks(s, id, "rails", Array.from({ length: 6 }, (_, k) => tileKey(hq.tx + 4 + k, hq.ty - 8)), T).state;
    return s;
  }

  it("tells a power line, a railway, a plan, a gap and a zone's edge from their neighbours by pattern, in every palette - lightness alone", () => {
    const s = planned();
    const c = s.settlements[0]!;
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);
    const view = cityView(c, env, T);
    const n = view.tiles;
    const all = [...Array(n * n).keys()];
    const cables = all.filter((i) => view.cables[i] === true && view.corridors[i] !== true);
    const corridors = all.filter((i) => view.corridors[i] === true && view.cables[i] !== true);
    const at = (k: number): number => { const t = keyTile(k); return t.ty * n + t.tx; };
    const plans = c.planned.map((p) => p.tile);
    const zone = new Set(c.zones[0]!.tiles);
    const edge = [...zone].filter((k) => [tileKey(1, 0), tileKey(-1, 0), tileKey(0, 1), tileKey(0, -1)].some((d) => !zone.has(k + d)));
    const inside = [...zone].filter((k) => !edge.includes(k));
    expect(cables.length, "a power line was laid").toBeGreaterThan(3);
    expect(corridors.length, "a corridor was laid").toBeGreaterThan(3);
    expect(plans.length, "a railway was planned").toBeGreaterThan(3);
    expect(inside.length, "a zone with an inside").toBeGreaterThan(3);
    // Two homes: one a service misses, one it reaches.
    const homes = view.buildings.map((b, i) => ({ b, i })).filter((x) => x.b.size * (x.b.depth ?? x.b.size) >= 4).slice(0, 2);
    expect(homes, "two buildings to paint").toHaveLength(2);
    const overlay = { squares: [], homes: [{ index: homes[0]!.i, reached: false }, { index: homes[1]!.i, reached: true }] };
    const footprint = (b: (typeof homes)[number]["b"]): number[] => {
      const out: number[] = [];
      for (let y = b.ty; y < b.ty + (b.depth ?? b.size); y += 1) for (let x = b.tx; x < b.tx + b.size; x += 1) out.push(y * n + x);
      return out;
    };
    const bare = plannerPixels(view, { ...c, zones: [], planned: [] }, null);
    const px = (p: Uint8ClampedArray, i: number): [number, number, number] => [p[i * 4]!, p[i * 4 + 1]!, p[i * 4 + 2]!];
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (const palette of PALETTES) {
      const p = plannerPixels(view, c, null, palette);
      const lights = (tiles: readonly number[], q = p): Set<number> => new Set(tiles.map((i) => Math.round(light(px(q, i)))));
      // A corridor is one lightness along its length; a power line two - dashed.
      expect(lights(corridors).size, `${palette}: corridor solid`).toBe(1);
      expect(lights(cables).size, `${palette}: power line dashed`).toBe(2);
      // A plan, dotted: every other tile marked strongly, the rest faintly - by how far each moved from the ground.
      const moved = (i: number): number => Math.abs(light(px(p, i)) - light(px(bare, i)));
      const strong = plans.map(at).filter((i) => ((i % n) + Math.floor(i / n)) % 2 === 0).map(moved);
      const faint = plans.map(at).filter((i) => ((i % n) + Math.floor(i / n)) % 2 === 1).map(moved);
      expect(strong.length * faint.length, "plan tiles of both kinds").toBeGreaterThan(0);
      expect(mean(strong), `${palette}: plan dotted`).toBeGreaterThan(2 * mean(faint));
      // A zone outlined: its edge further from the bare ground than its inside, every tile.
      const zoneMoved = (k: number): number => apart(px(p, at(k)), px(bare, at(k)));
      expect(Math.min(...edge.map(zoneMoved)), `${palette}: zone edge`).toBeGreaterThan(Math.max(...inside.map(zoneMoved)));
      // A home no service reaches, hatched: two lightnesses across it; one reached, one.
      const cov = plannerPixels(view, c, overlay, palette);
      expect(lights(footprint(homes[0]!.b), cov).size, `${palette}: gap hatched`).toBe(2);
      expect(lights(footprint(homes[1]!.b), cov).size, `${palette}: reached solid`).toBe(1);
    }
  });

  it("names what is under the pointer: the building and what it does, the zone, the links, a plan", () => {
    const s = planned();
    const host = document.createElement("div");
    document.body.append(host);
    const planner = new PlannerScreen(host, { onRename: () => ({ ok: true, reason: null }), onZone: () => ({ ok: true, reason: null, zone: null }), onDeleteZone: () => ({ ok: true, reason: null }), onLevelZone: () => ({ ok: true, reason: null, queued: 0 }), onPlan: () => ({ ok: true, reason: null, planned: 0 }), onCancelPlans: () => ({ ok: true, reason: null }), onCityView: () => {} }, T);
    const c = s.settlements[0]!;
    planner.open(c.id);
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);
    planner.frame(c, env, 0);
    const view = cityView(c, env, T);
    const n = view.tiles;
    const hq = view.buildings.find((b) => b.type === "headquarters")!;
    expect(planner.describeTile(hq.tx, hq.ty)).toBe(`Here: ${BUILDING_DEFS.headquarters.name} (headquarters).`);
    const zoneTile = c.zones[0]!.tiles[7]!;
    expect(planner.describeTile(keyTile(zoneTile).tx, keyTile(zoneTile).ty)).toMatch(/zone "Works"/);
    const cable = [...Array(n * n).keys()].find((i) => view.cables[i] === true)!;
    expect(planner.describeTile(cable % n, Math.floor(cable / n))).toMatch(/power line/);
    const corridor = [...Array(n * n).keys()].find((i) => view.corridors[i] === true)!;
    expect(planner.describeTile(corridor % n, Math.floor(corridor / n))).toMatch(/corridor/);
    const plan = c.planned[0]!.tile;
    expect(planner.describeTile(keyTile(plan).tx, keyTile(plan).ty)).toMatch(/railway planned/);
    // The legend names each pattern.
    expect([...host.querySelectorAll(".planner-legend-item[data-pattern]")].map((x) => x.textContent)).toEqual(["Corridor (solid)", "Power line (dashed)", "Railway (striped)", "Planned (dotted)", "Home a service misses (hatched)", "Zone (outlined)"]);
  });
});

describe("the city's own marks", () => {
  it("land not yet claimable has a dashed edge, land ready a whole one; a refused placement is crossed", () => {
    const s = ares();
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);
    const view = cityView(s.settlements[0]!, env, T);
    const size = 8;
    const overlay = (ready: boolean, ghost: { valid: boolean } | null = null) =>
      cityScene(view, { time: 0, selected: null, ghost: ghost === null ? null : { tx: 10, ty: 10, size: 2, valid: ghost.valid }, layer: "overlay", claimable: ready === null ? [] : [{ tx: 0, ty: 0, size, ready, hover: false }] }).length;
    // Every edge tile drawn for land ready; every other one for land the city must grow into.
    expect(overlay(true) - overlay(false)).toBe(2 * size);
    expect(overlay(true, { valid: false }) - overlay(true, { valid: true }), "the cross: two strokes").toBe(2);
    // The palette's colour for land ready.
    const blue = MAP_PALETTES["red-green"].claimReady;
    const shapes = cityScene(view, { time: 0, selected: null, ghost: null, layer: "overlay", claimable: [{ tx: 0, ty: 0, size, ready: true, hover: false }], claimReady: blue });
    expect(shapes.some((sh) => sh.fill.r === blue.r && sh.fill.g === blue.g && sh.fill.b === blue.b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The palettes, measured
// ---------------------------------------------------------------------------

/** Machado, Oliveira and Fernandes (2009), full severity, on linear RGB. */
const SIMULATE: Readonly<Record<"protan" | "deutan" | "tritan", readonly (readonly number[])[]>> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const toLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number): number => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function seenBy(c: Rgb8, kind: keyof typeof SIMULATE): [number, number, number] {
  const lin = c.map(toLinear);
  const m = SIMULATE[kind];
  return m.map((row) => toSrgb(Math.min(1, Math.max(0, row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!)))) as [number, number, number];
}
const apart = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("the colour-blind palettes", () => {
  it("standard is the game's colours as they were: the zones' first colours are the simulation's", () => {
    expect(MAP_PALETTES.standard.zones).toEqual([...ZONE_COLOURS]);
    for (const p of PALETTES) expect(MAP_PALETTES[p].zones).toHaveLength(ZONE_COLOURS.length);
    expect(zoneColour(ZONE_COLOURS[2]!, "red-green")).toBe(MAP_PALETTES["red-green"].zones[2]);
    // A colour the player picked is theirs, in every palette.
    expect(zoneColour("#123456", "blue-yellow")).toBe("#123456");
  });
});

/** How far apart a palette's meanings stay for one kind of colour blindness: homes a service misses and reaches, the closest two kinds of building, the closest two zones. */
function spread(palette: Palette, kind: keyof typeof SIMULATE): { gap: number; kinds: number; zones: number } {
  const pal = MAP_PALETTES[palette];
  const closest = (cs: readonly Rgb8[]): number => {
    let min = Infinity;
    for (let i = 0; i < cs.length; i += 1) for (let j = i + 1; j < cs.length; j += 1) min = Math.min(min, apart(seenBy(cs[i]!, kind), seenBy(cs[j]!, kind)));
    return min;
  };
  const hex = (h: string): Rgb8 => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  return { gap: apart(seenBy(pal.coverage.gap, kind), seenBy(pal.coverage.reached, kind)), kinds: closest(Object.values(pal.kinds) as Rgb8[]), zones: closest(pal.zones.map(hex)) };
}

describe("the colour-blind palettes, measured", () => {
  /*
   * Distances in sRGB after Machado et al.'s simulation, measured:
   *                      gap/reached  closest kinds  closest zones
   *   standard,  deutan      74.7          19.0           9.8
   *   standard,  protan     122.2          44.1          19.9
   *   standard,  tritan     298.0          29.2          27.4
   *   red-green, deutan     226.0          51.5          51.5
   *   red-green, protan     238.0          51.5          51.5
   *   blue-yellow, tritan   351.6          76.7          76.7
   * Each bound below sits under its measurement, and above the standard palette's for the same eyes.
   */
  it("red-green keeps the meanings apart for deuteranopes and protanopes, further than the standard colours do", () => {
    for (const kind of ["deutan", "protan"] as const) {
      const rg = spread("red-green", kind);
      const std = spread("standard", kind);
      expect(rg.gap, `${kind}: gaps and homes reached`).toBeGreaterThan(200);
      expect(rg.kinds, `${kind}: kinds of building`).toBeGreaterThan(45);
      expect(rg.zones, `${kind}: zones`).toBeGreaterThan(45);
      expect(rg.gap).toBeGreaterThan(std.gap);
      expect(rg.kinds).toBeGreaterThan(std.kinds);
      expect(rg.zones).toBeGreaterThan(std.zones);
    }
  });

  it("blue-yellow keeps them apart for tritanopes, further than the standard colours do", () => {
    const by = spread("blue-yellow", "tritan");
    const std = spread("standard", "tritan");
    expect(by.gap).toBeGreaterThan(300);
    expect(by.kinds).toBeGreaterThan(70);
    expect(by.zones).toBeGreaterThan(70);
    expect(by.gap).toBeGreaterThan(std.gap);
    expect(by.kinds).toBeGreaterThan(std.kinds);
    expect(by.zones).toBeGreaterThan(std.zones);
  });

  it("the page's colours that mean something are swapped too: good, warning and bad, apart for those eyes", () => {
    // The page as the browser has it: the stylesheet on, the palette on the root, the colours read back.
    const style = document.createElement("style");
    style.dataset["test"] = "";
    style.textContent = CSS;
    document.head.append(style);
    const vars = (palette: Palette): Record<"good" | "warn" | "bad", Rgb8> => {
      document.documentElement.dataset["palette"] = palette;
      const get = (name: string): Rgb8 => {
        const hex = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
        expect(hex, `--${name} in ${palette}`).toMatch(/^#[0-9a-f]{6}$/);
        return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
      };
      return { good: get("good"), warn: get("warn"), bad: get("bad") };
    };
    const closest = (palette: Palette, kind: keyof typeof SIMULATE): number => {
      const v = vars(palette);
      const pairs: [Rgb8, Rgb8][] = [[v.good, v.warn], [v.good, v.bad], [v.warn, v.bad]];
      return Math.min(...pairs.map(([a, b]) => apart(seenBy(a, kind), seenBy(b, kind))));
    };
    /*
     * Each pair (good-warning, good-bad, warning-bad), measured:
     *   standard,    deutan   46.7  42.8  35.4     protan  51.8  75.4  50.8     tritan 143.5 174.0  50.5
     *   red-green,   deutan  203.9 181.3  93.1     protan 225.0 187.5 122.5
     *   blue-yellow, tritan  268.8 365.7 177.3
     * Every pair bounded under its palette's measurement and over the standard's for the same eyes.
     */
    const pairs = (palette: Palette, kind: keyof typeof SIMULATE): number[] => {
      const v = vars(palette);
      return [[v.good, v.warn], [v.good, v.bad], [v.warn, v.bad]].map(([a, b]) => apart(seenBy(a!, kind), seenBy(b!, kind)));
    };
    for (const kind of ["deutan", "protan"] as const) {
      for (const [i, d] of pairs("red-green", kind).entries()) expect(d, `red-green, ${kind}, pair ${i}`).toBeGreaterThan(80);
      expect(closest("red-green", kind), kind).toBeGreaterThan(closest("standard", kind));
    }
    for (const [i, d] of pairs("blue-yellow", "tritan").entries()) expect(d, `blue-yellow, pair ${i}`).toBeGreaterThan(150);
    expect(closest("blue-yellow", "tritan")).toBeGreaterThan(closest("standard", "tritan"));
    document.documentElement.removeAttribute("data-palette");
  });
});

void ({} as Settings);
void ({} as MapKind);
