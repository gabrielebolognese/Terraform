// @vitest-environment happy-dom

/**
 * Batch 30 on screen, through the real components: the guide's card follows
 * the world and points at controls that exist; the objectives panel shows
 * what the simulation derives and claims through it; milestones are seen as
 * they happen and never on opening a world. The assembled game is driven
 * last: the guide, Skip, the objectives' Claim and a milestone card on one page.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { BuildingType, Settlement, SimState, Tuning } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  advance,
  claimLand,
  claimObjective,
  claimableChunks,
  connectAll,
  connectSettlements,
  derive,
  foundSettlement,
  habitat,
  marsStart,
  objectiveStatus,
  placeBuilding,
  upgradeBuilding,
  worldEnv,
} from "../sim/index.js";
import { CityScreen } from "./city.js";
import type { CityHooks } from "./city.js";
import { startGame } from "./game.js";
import type { GameHandle } from "./game.js";
import { worldTuning } from "./game-tuning.js";
import { Hud } from "./hud.js";
import { MilestoneCards, MilestoneWatch } from "./milestones.js";
import { GUIDE_TARGET_CLASS, GuidePanel, ObjectivesPanel, guideHint } from "./onboarding.js";
import type { GuideContext } from "./onboarding.js";
import { PlannerScreen } from "./planner.js";
import { WorldMapScreen } from "./world-map.js";

const T = worldTuning("standard", 0, "standard");
const SITE = { lat: 0.31, lon: -1.2 } as const;

afterEach(() => {
  document.body.replaceChildren();
});

const first = (s: SimState): Settlement => s.settlements[0]!;
function place(s: SimState, type: BuildingType, tx: number, ty: number): SimState {
  const o = placeBuilding(s, first(s).id, type, tx, ty, T);
  expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
  return o.state;
}
function withCity(s: SimState, change: Partial<Settlement>): SimState {
  return { ...s, settlements: s.settlements.map((c, i) => (i === 0 ? { ...c, ...change } : c)) };
}
const hintAt = (state: SimState, context: GuideContext, more: { founding?: boolean; selected?: boolean } = {}) =>
  guideHint({ state, tuning: T, context, founding: more.founding ?? false, selected: more.selected ?? false });

/**
 * The guide's whole walk, as the world goes: each state, and the hint for it
 * in each place a player might be looking.
 */
function walk(): { state: SimState; hints: Record<GuideContext, ReturnType<typeof hintAt>> }[] {
  const out: { state: SimState; hints: Record<GuideContext, ReturnType<typeof hintAt>> }[] = [];
  const at = (state: SimState): void => {
    out.push({ state, hints: { orbit: hintAt(state, "orbit"), city: hintAt(state, "city"), map: hintAt(state, "map"), planner: hintAt(state, "planner") } });
  };
  let s = marsStart(undefined, T);
  at(s);
  s = foundSettlement(s, "city", SITE.lat, SITE.lon, T).state;
  s = withCity(s, { stores: { ...first(s).stores, materials: 400 } });
  at(s);
  const g = first(s).buildings.find((b) => b.type === "headquarters")!;
  s = place(s, "solar_array", g.tx - 4, g.ty);
  at(s);
  s = place(s, "habitat_dome", g.tx - 4, g.ty + 8);
  at(s);
  s = connectAll(s, first(s).id, T).state;
  at(s);
  // The solar array built (a rover's work) before it can be raised.
  s = advance(s, 40, { tuning: T, env: NEUTRAL_ENV, forcing: null });
  const solar = first(s).buildings.find((b) => b.type === "solar_array")!;
  const up = upgradeBuilding(s, first(s).id, solar.tx, solar.ty, T);
  expect(up.ok, up.reason ?? "").toBe(true);
  s = up.state;
  at(s);
  s = withCity(s, { population: 250 });
  at(s);
  const chunk = claimableChunks(first(s), T)[0]!;
  s = claimLand(s, first(s).id, chunk.i, chunk.j, T).state;
  at(s);
  const outpost = foundSettlement(s, "outpost", SITE.lat, SITE.lon + 0.02, T);
  s = outpost.state;
  at(s);
  s = connectSettlements(withCity(s, { stores: { ...first(s).stores, materials: 400 } }), first(s).id, outpost.settlement!.id, T).state;
  at(s);
  return out;
}

describe("the guide's hint", () => {
  it("follows the world, step by step, with what to do from where the player is", () => {
    const w = walk();
    const titles = w.map((x) => x.hints.orbit?.title ?? null);
    expect(titles).toEqual(["Found a city", "Place power", "Place a dome", "Connect them", "Raise a building a level", "Claim land", "Claim land", "Lay a railway to a second settlement", "Lay a railway to a second settlement", null]);
    expect(w.map((x) => x.hints.orbit?.progress ?? null).slice(0, 3)).toEqual(["Step 1 of 7", "Step 2 of 7", "Step 3 of 7"]);
    // Founding: the HUD's button from orbit, then nothing to press while choosing the site.
    expect(w[0]!.hints.orbit!.target).toBe('.hud-found[data-kind="city"]');
    expect(hintAt(w[0]!.state, "orbit", { founding: true })!.target).toBeNull();
    // A city step from orbit: into the city first; in it, the build bar's card.
    expect(w[1]!.hints.orbit!.target).toBe(".hud-settlement-open");
    expect(w[1]!.hints.city!.target).toBe('.city-card[data-card="solar_array"]');
    expect(w[1]!.hints.map!.target).toBe(".worldmap-open");
    expect(w[1]!.hints.planner!.target).toBe(".planner-city");
    expect(w[2]!.hints.city!.target).toBe('.city-card[data-card="habitat_dome"]');
    expect(w[3]!.hints.city!.target).toBe('.city-card[data-card="connect"]');
    // The upgrade: a building chosen first, then its Upgrade button.
    expect(w[4]!.hints.city!.target).toBeNull();
    expect(hintAt(w[4]!.state, "city", { selected: true })!.target).toBe(".city-upgrade");
    // Land: waiting for its people says how many; then the card.
    expect(w[5]!.hints.city!.how).toMatch(/opens at 200 people; the city has \d+\./);
    expect(w[6]!.hints.city!.how).toMatch(/Press Claim land/);
    // The railway: a second settlement first, then the world map's join.
    expect(w[7]!.hints.orbit!.target).toBe('.hud-found[data-kind="outpost"]');
    expect(w[7]!.hints.city!.target).toBe(".city-back");
    expect(w[8]!.hints.orbit!.target).toBe(".hud-world-map");
    expect(w[8]!.hints.city!.target).toBe(".city-world-map");
    expect(w[8]!.hints.map!.target).toBe(".worldmap-join");
  });

  it("is never shown in a world without the guide, skipped, or done", () => {
    const off = worldTuning("sandbox", 0, "standard");
    expect(guideHint({ state: marsStart(undefined, off), tuning: off, context: "orbit", founding: false, selected: false })).toBeNull();
    const skipped = { ...marsStart(undefined, T), goals: { guide: 0, guideSkipped: true, claimed: [] } };
    expect(hintAt(skipped, "orbit")).toBeNull();
    expect(walk().at(-1)!.hints.orbit).toBeNull();
  });

  it("names controls that exist in the real components, in every view", () => {
    const w = walk();
    const targets = new Map<GuideContext, Set<string>>([["orbit", new Set()], ["city", new Set()], ["map", new Set()], ["planner", new Set()]]);
    for (const x of w) for (const c of targets.keys()) if (x.hints[c]?.target) targets.get(c)!.add(x.hints[c]!.target!);
    targets.get("city")!.add(hintAt(w[4]!.state, "city", { selected: true })!.target!);
    // Vacuity: every view has something to point at.
    for (const [c, set] of targets) expect(set.size, c).toBeGreaterThan(0);

    // Orbit: the HUD, with a settlement listed.
    const hudHost = document.createElement("div");
    document.body.append(hudHost);
    const hud = new Hud(hudHost, { onSpeed: () => {}, onOrder: () => {}, onSeed: () => {}, onToggleLever: () => {}, onFound: () => {}, onCancelFound: () => {}, onOpenSettlement: () => {}, onWorldMap: () => {}, onFocusLever: () => {} }, T);
    hud.update(hudView(w[8]!.state, T));
    for (const sel of targets.get("orbit")!) expect(hudHost.querySelector(sel), `orbit: ${sel}`).not.toBeNull();

    // The city view, with a building selected.
    const city = mountCity(w[8]!.state);
    for (const sel of targets.get("city")!) expect(city.querySelector(sel), `city: ${sel}`).not.toBeNull();

    // The world map, a settlement chosen.
    const mapHost = document.createElement("div");
    document.body.append(mapHost);
    const map = new WorldMapScreen(mapHost, { onOpen: () => {}, onConnect: () => ({ ok: false, reason: null, cost: 0 }), onClose: () => {} }, T, () => 1000);
    map.open();
    const env = habitat(w[8]!.state.reservoirs, derive(w[8]!.state.reservoirs, NEUTRAL_ENV, T), T, 0);
    map.frame(w[8]!.state, env, 0);
    for (let k = 1; k < 600 && /Drawing the map/.test(mapHost.querySelector(".worldmap-hint")?.textContent ?? ""); k += 1) map.frame(w[8]!.state, env, k * 16);
    map.frame(w[8]!.state, env, 1e5);
    const on = map.screenOf(first(w[8]!.state));
    map.click(on.px, on.py);
    map.frame(w[8]!.state, env, 1e6);
    for (const sel of targets.get("map")!) expect(mapHost.querySelector(sel), `map: ${sel} in ${mapHost.textContent}`).not.toBeNull();

    // The planner.
    const plannerHost = document.createElement("div");
    document.body.append(plannerHost);
    new PlannerScreen(plannerHost, { onRename: () => ({ state: w[8]!.state, ok: true, reason: null }), onZone: () => ({ state: w[8]!.state, ok: true, reason: null, zone: null }), onDeleteZone: () => ({ state: w[8]!.state, ok: true, reason: null }), onLevelZone: () => ({ state: w[8]!.state, ok: true, reason: null, queued: 0 }), onPlan: () => ({ state: w[8]!.state, ok: true, reason: null, planned: 0 }), onCancelPlans: () => ({ state: w[8]!.state, ok: true, reason: null }), onCityView: () => {} }, T);
    for (const sel of targets.get("planner")!) expect(plannerHost.querySelector(sel), `planner: ${sel}`).not.toBeNull();
  });
});

/** The HUD's view of a world, as the game hands it over (only what the settlements list reads matters here). */
function hudView(state: SimState, t: Tuning): Parameters<Hud["update"]>[0] {
  const d = derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t);
  return {
    simYear: 0,
    phase: 0,
    phaseReached: 0,
    progress: 0,
    axes: { nT: 0, nP: 0, nO2: 0, nWater: 0, nBio: 0, nCO2: 0 },
    derived: d,
    reservoirs: state.reservoirs,
    advice: { bottleneck: "nT", title: "", problem: "", action: "", lever: null, waiting: true, because: null },
    events: [],
    fresh: [],
    speed: 1,
    canSeed: false,
    canOrder: false,
    economy: null,
    notice: null,
    build: [],
    seeded: false,
    settlements: state.settlements,
    founding: null,
  };
}

function mountCity(state: SimState): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const done = { state, ok: true, reason: null };
  const hooks: CityHooks = {
    onPlace: () => done,
    canPlace: () => done,
    onRemove: () => done,
    onLink: () => done,
    canLink: () => done,
    onUnlink: () => done,
    onSendRover: () => done,
    onLaunch: () => done,
    onConnect: () => ({ ...done, laid: 0 }),
    onLevel: () => done,
    canLevel: () => done,
    onUpgrade: () => done,
    onConnectTwice: () => ({ ...done, laid: 0 }),
    onClaim: () => done,
    onBack: () => {},
    onPlanner: () => {},
    onWorldMap: () => {},
  };
  const screen = new CityScreen(host, hooks, T);
  const canvas = host.querySelector("canvas")!;
  canvas.width = 800;
  canvas.height = 600;
  screen.open(first(state).id);
  const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, T), T), T, 0);
  for (let k = 1; k < 400; k += 1) screen.frame(first(state), env, k * 1000);
  screen.select(first(state).buildings.findIndex((b) => b.type === "solar_array"));
  screen.frame(first(state), env, 1e6);
  return host;
}

describe("the guide's card", () => {
  it("puts its glow on the control to press, moves it as the step moves, and takes it away when done", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const a = document.createElement("button");
    a.className = "one";
    const b = document.createElement("button");
    b.className = "two";
    host.append(a, b);
    let skipped = 0;
    const panel = new GuidePanel(host, host, () => (skipped += 1));
    panel.update({ progress: "Step 1 of 7", title: "Found a city", how: "Press it.", target: ".one" });
    expect(panel.root.hidden).toBe(false);
    expect(a.classList.contains(GUIDE_TARGET_CLASS)).toBe(true);
    panel.update({ progress: "Step 2 of 7", title: "Place power", how: "Press that.", target: ".two" });
    expect(a.classList.contains(GUIDE_TARGET_CLASS)).toBe(false);
    expect(b.classList.contains(GUIDE_TARGET_CLASS)).toBe(true);
    // A control rebuilt under the guide (the city's cards are) is marked again.
    b.remove();
    const b2 = document.createElement("button");
    b2.className = "two";
    host.append(b2);
    panel.update({ progress: "Step 2 of 7", title: "Place power", how: "Press that.", target: ".two" });
    expect(b2.classList.contains(GUIDE_TARGET_CLASS)).toBe(true);
    host.querySelector<HTMLButtonElement>(".guide-skip")!.click();
    expect(skipped).toBe(1);
    panel.update(null);
    expect(panel.root.hidden).toBe(true);
    expect(host.querySelectorAll(`.${GUIDE_TARGET_CLASS}`)).toHaveLength(0);
  });
});

describe("the objectives panel", () => {
  it("shows each chain's open goal, its progress and reward; Claim goes to the game; nothing at all with objectives off", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let s = withCity(foundSettlement(marsStart(undefined, T), "city", SITE.lat, SITE.lon, T).state, { population: 0 });
    const claims: string[] = [];
    const panel = new ObjectivesPanel(host, T, (id) => {
      claims.push(id);
      const o = claimObjective(s, id, T);
      s = o.state;
      return { ok: o.ok, reason: o.reason, words: "50 settlers from Earth" };
    });
    panel.update([]);
    expect(panel.toggle.hidden, "objectives off: no button").toBe(true);
    panel.update(objectiveStatus(s, T));
    expect(panel.toggle.hidden).toBe(false);
    expect(panel.toggle.textContent).toBe("Objectives");
    panel.toggle.click();
    panel.update(objectiveStatus(s, T));
    const text = panel.panel.textContent ?? "";
    expect(text).toContain("A hundred people");
    expect(text).toContain("0 of 100 people");
    expect(text).toContain("Reward: 50 settlers from Earth.");
    expect(text).toContain("Next: Steady supply");
    expect(text).toContain("The caps let go");
    expect(text).toContain("Joined by rail");
    expect(panel.panel.querySelector(".objective-claim"), "nothing done, nothing to claim").toBeNull();
    // A hundred people: the button says a reward waits, and Claim takes it through the game.
    s = withCity(s, { population: 100 });
    panel.update(objectiveStatus(s, T));
    expect(panel.toggle.textContent).toBe("Objectives (1 to claim)");
    panel.panel.querySelector<HTMLButtonElement>('.objective[data-id="city_first"] .objective-claim')!.click();
    expect(claims).toEqual(["city_first"]);
    expect(panel.panel.querySelector(".objectives-notice")!.textContent).toBe("Claimed: 50 settlers from Earth.");
    panel.update(objectiveStatus(s, T));
    expect(panel.panel.textContent).toContain("A hundred people - claimed");
    expect(panel.panel.textContent).toContain("Steady supply");
    expect(panel.toggle.textContent).toBe("Objectives");
  });
});

describe("milestones", () => {
  const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };

  it("announce nothing on the first look, whatever the world already holds", () => {
    let s = foundSettlement(marsStart(undefined, T), "city", SITE.lat, SITE.lon, T).state;
    s = { ...withCity(s, { population: 150 }), phaseReached: 2 };
    expect(new MilestoneWatch().observe(s, T)).toEqual([]);
  });

  it("see a phase reached, a city founded, a great structure finished and an objective done - once each", () => {
    const watch = new MilestoneWatch();
    let s = marsStart(undefined, T);
    expect(watch.observe(s, T)).toEqual([]);
    s = foundSettlement(s, "city", SITE.lat, SITE.lon, T, "Ares").state;
    expect(watch.observe(s, T).map((m) => [m.kind, m.title])).toEqual([["founded", "Ares is founded"]]);
    // An outpost is not a city.
    s = foundSettlement(s, "outpost", SITE.lat, SITE.lon + 0.03, T).state;
    expect(watch.observe(s, T)).toEqual([]);
    s = { ...s, phaseReached: 2 };
    const phases = watch.observe(s, T);
    // Phase 2 is also the planet's first objective done.
    expect(phases.map((m) => m.title)).toEqual(["Phase 1: Warming", "Phase 2: Runaway thickening", "Objective done: The caps let go"]);
    expect(phases.map((m) => m.grand)).toEqual([true, true, false]);
    // A great structure: a second spaceport, built by a rover - announced when it stands, not when it is begun.
    s = withCity(s, { stores: { ...first(s).stores, materials: 400 } });
    const g = first(s).buildings.find((b) => b.type === "headquarters")!;
    s = place(s, "spaceport", g.tx - 8, g.ty - 8);
    expect(watch.observe(s, T)).toEqual([]);
    let built: string[] = [];
    for (let k = 0; k < 600 && built.length === 0; k += 1) {
      s = advance(s, 1, cfg);
      built = watch.observe(s, T).map((m) => m.title);
    }
    expect(built).toEqual(["Spaceport finished"]);
    // An objective done: once, while it waits to be claimed.
    s = withCity(s, { population: 100 });
    expect(watch.observe(s, T).map((m) => m.title)).toEqual(["Objective done: A hundred people"]);
    expect(watch.observe(s, T)).toEqual([]);
    watch.reset();
    expect(watch.observe(s, T), "a fresh start only takes its bearings").toEqual([]);
  });

  it("show one card at a time with the chime, the grand one for a phase, the next when its time is up", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const sounds: boolean[] = [];
    const cards = new MilestoneCards(host, (grand) => sounds.push(grand));
    cards.push([
      { kind: "phase", title: "Phase 2: Runaway thickening", text: "", grand: true },
      { kind: "founded", title: "Ares is founded", text: "", grand: false },
    ]);
    cards.frame(0);
    expect(cards.showing).toBe("Phase 2: Runaway thickening");
    cards.frame(1000);
    expect(cards.showing).toBe("Phase 2: Runaway thickening");
    cards.frame(7000);
    expect(cards.showing).toBe("Ares is founded");
    expect(sounds).toEqual([true, false]);
    host.querySelector<HTMLButtonElement>(".milestone-close")!.click();
    expect(cards.showing).toBeNull();
  });
});

describe("the first hour in the assembled game", () => {
  function play(state: SimState): { root: HTMLElement; handle: GameHandle } {
    const root = document.createElement("div");
    document.body.append(root);
    const handle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T) }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
    return { root, handle };
  }
  const frames = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  it("shows the guide pointing at the control, and Skip puts it away for good", async () => {
    const founded = foundSettlement(marsStart(undefined, T), "city", SITE.lat, SITE.lon, T).state;
    const { root, handle } = play(founded);
    try {
      await frames();
      const card = root.querySelector<HTMLElement>(".guide-card")!;
      expect(card.hidden).toBe(false);
      expect(card.textContent).toContain("Step 2 of 7");
      expect(card.textContent).toContain("Place power");
      expect(root.querySelector(`.hud-settlement-open.${GUIDE_TARGET_CLASS}`), "the city's Open button glows").not.toBeNull();
      root.querySelector<HTMLButtonElement>(".guide-skip")!.click();
      expect(handle.state.goals.guideSkipped).toBe(true);
      await frames();
      expect(card.hidden).toBe(true);
      expect(root.querySelectorAll(`.${GUIDE_TARGET_CLASS}`)).toHaveLength(0);
    } finally {
      handle.stop();
    }
  });

  it("claims through the panel into the world, and the next goal done is a card and a moment", async () => {
    let s = foundSettlement(marsStart(undefined, T), "city", SITE.lat, SITE.lon, T).state;
    const g = first(s).buildings.find((b) => b.type === "headquarters")!;
    s = withCity(s, { stores: { ...first(s).stores, materials: 400 } });
    for (let k = 0; k < 3; k += 1) s = place(s, "habitat_dome", g.tx - 12 + 4 * k, g.ty - 10);
    s = advance(s, 200, { tuning: T, env: NEUTRAL_ENV, forcing: null });
    const homes = first(s).buildings.filter((b) => b.type === "habitat_dome").length * T.DOME_HOUSING;
    expect(homes).toBe(120);
    // A hundred people, and twenty clean years of 200 behind it on the record (the steady supply done, waiting
    // on the first claim to open).
    const sample = { index: 0, population: 210, housing: 240, births: 0, deaths: 0, short: [0, 0, 0, 0, 0], stores: [0, 0, 0, 0, 0], net: [0, 0, 0, 0, 0] };
    s = withCity(s, { population: 100, history: { ...first(s).history, samples: Array.from({ length: 20 }, () => sample) } });
    const { root, handle } = play(s);
    try {
      await frames();
      expect(root.querySelector<HTMLElement>(".milestone-card")!.hidden, "nothing announced on opening the world").toBe(true);
      const toggle = root.querySelector<HTMLButtonElement>(".objectives-toggle")!;
      expect(toggle.textContent).toBe("Objectives (1 to claim)");
      toggle.click();
      await frames();
      root.querySelector<HTMLButtonElement>('.objective[data-id="city_first"] .objective-claim')!.click();
      expect(handle.state.goals.claimed).toEqual(["city_first"]);
      expect(first(handle.state).population).toBeGreaterThan(100);
      await frames();
      const card = root.querySelector<HTMLElement>(".milestone-card")!;
      expect(card.hidden).toBe(false);
      expect(card.textContent).toContain("Objective done: Steady supply");
      expect(root.querySelector(".milestone-flash")!.classList.contains("milestone-on")).toBe(true);
    } finally {
      handle.stop();
    }
  });

  it("offers a metropolis once one is unlocked, and not before", async () => {
    const s = withCity(foundSettlement(marsStart(undefined, T), "city", SITE.lat, SITE.lon, T).state, {});
    const before = play(s);
    await frames();
    expect(before.root.querySelector<HTMLButtonElement>('.hud-found[data-kind="metropolis"]')!.hidden).toBe(true);
    before.handle.stop();
    const unlocked = { ...s, goals: { ...s.goals, claimed: ["city_first", "city_steady", "city_town", "city_thousand"] } };
    const after = play(unlocked);
    await frames();
    expect(after.root.querySelector<HTMLButtonElement>('.hud-found[data-kind="metropolis"]')!.hidden).toBe(false);
    after.handle.stop();
  });
});
