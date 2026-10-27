// @vitest-environment happy-dom

/**
 * Batch 38 on screen, through the real components: the flood warning's words
 * with a city's grace and with what throttling the planet would buy; the city
 * view's panel for the sea - the warning, and Evacuate - and the inspector's
 * Raise its ground; the Seawall's card where the sea floods and not where it
 * does not; and the assembled game, saying what switching the planet's
 * facilities off would buy a city in the burst.
 */

import { afterEach, describe, expect, it } from "vitest";

import { terraformedMars } from "../harness/example.js";
import type { SimState, Tuning } from "../sim/index.js";
import {
  DEFAULT_TUNING,
  NEUTRAL_ENV,
  checkPlacement,
  evacuateSettlement,
  floodForecast,
  floodReading,
  foundSettlement,
  housing,
  liquidWaterRate,
  makeTuning,
  marsStart,
  nextSubstepFlows,
  placeBuilding,
  siteElevation,
  terraceBuilding,
  terracePlan,
  threatened,
  upgradeBuilding,
} from "../sim/index.js";
import { channels, fixture, rising, t } from "../testkit/flood.js";
import { CityScreen } from "./city.js";
import { floodWarning, floodWarnings, throttleWords } from "./flood-warning.js";
import { startGame } from "./game.js";
import type { GameHandle } from "./game.js";
import { Frames } from "./test-frames.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("the flood warning's words (Batch 38)", () => {
  const START = fixture();
  const low = START.settlements[0]!;
  const rate = liquidWaterRate(nextSubstepFlows(START, rising));
  const reading = floodReading(low, channels(START), t);
  const forecast = floodForecast(low, START.reservoirs, rate, t)!;

  it("say how long a grace holds the sea off, in the HUD's years", () => {
    const words = floodWarning({ ...forecast, graceYears: 12.4 }, reading, true);
    expect(words).toMatch(/^Flood warning: submersion begins in ~\d+ yr, total loss in ~\d+ yr at current rate\. Nothing is lost to the sea for ~12 yr\.$/);
    // Under the sea, held by its grace (a city found there on loading).
    expect(floodWarning({ ...forecast, graceYears: 0.5 }, { ...reading, state: "flooded" }, true)).toBe("Under the sea: the water stands over the city. Nothing is lost to the sea for under a year.");
    // No grace, the Batch 25 words as they were.
    expect(floodWarning(forecast, reading, true)).toMatch(/^Flood warning: submersion begins in ~\d+ yr, total loss in ~\d+ yr at current rate\.$/);
  });

  it("say what switching the planet's facilities off would buy, from the projection", () => {
    expect(throttleWords({ asIsYears: 17.25, throttledYears: 25 })).toBe(" Switching off the planet's machines would buy ~8 yr.");
    expect(throttleWords({ asIsYears: 38.5, throttledYears: null })).toBe(" Switching off the planet's machines would keep the sea from it for the century ahead.");
    expect(throttleWords({ asIsYears: null, throttledYears: null })).toBe("");
    expect(throttleWords(null)).toBe("");
    expect(floodWarning(forecast, reading, true, { asIsYears: 17.25, throttledYears: 25 })).toMatch(/at current rate\. Switching off the planet's machines would buy ~8 yr\.$/);
  });

  it("ask the projection for the warned cities only, and only when one is warned", () => {
    const asked: string[][] = [];
    const words = floodWarnings(START, channels(START), rate, t, (ids) => {
      asked.push([...ids]);
      return new Map([[ids[0]!, { asIsYears: 2, throttledYears: 5 }]]);
    });
    expect(asked).toEqual([["settlement-1"]]);
    expect(words.get("settlement-1")).toMatch(/would buy ~3 yr\.$/);
    // The high city, 473 m up, is warned of nothing - and nothing is asked when none is.
    const high = { ...START, settlements: [START.settlements[1]!] };
    floodWarnings(high, channels(high), rate, t, (ids) => {
      asked.push([...ids]);
      return new Map();
    });
    expect(asked.length).toBe(1);
  });
});

/** The drowning city with homes on its high ground, full; the high city with homes to spare. */
function peopled(): SimState {
  let s = fixture();
  for (const id of ["settlement-1", "settlement-2"]) {
    let placed = 0;
    for (let k = 0; k < 32 * 32 && placed < 1; k += 1) {
      const tx = k % 32;
      const ty = Math.floor(k / 32);
      if (ty < 20 || !checkPlacement(s, id, "habitat_dome", tx, ty, t).ok) continue;
      s = placeBuilding(s, id, "habitat_dome", tx, ty, t).state;
      placed += 1;
    }
  }
  return { ...s, settlements: s.settlements.map((c, i) => (i === 0 ? { ...c, population: housing(c, t) } : c)) };
}

/** The city view over a world, with the game's own hooks for the sea (as `game.ts` writes them). */
function mount(start: SimState, tuning: Tuning = t, id = "settlement-1") {
  let state = start;
  const calls: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const rate = (): number => liquidWaterRate(nextSubstepFlows(state, { ...rising, tuning }));
  const refuse = { ok: false, reason: "not in this test" };
  const screen = new CityScreen(
    host,
    {
      onPlace: (sid, type, tx, ty) => {
        const o = placeBuilding(state, sid, type, tx, ty, tuning);
        state = o.state;
        return o;
      },
      canPlace: (sid, type, tx, ty) => checkPlacement(state, sid, type, tx, ty, tuning),
      onRemove: () => refuse,
      onLink: () => refuse,
      canLink: () => refuse,
      onUnlink: () => refuse,
      onSendRover: () => refuse,
      onLaunch: () => refuse,
      onConnect: () => ({ ...refuse, laid: 0 }),
      onLevel: () => refuse,
      canLevel: () => refuse,
      onUpgrade: (sid, tx, ty) => {
        const o = upgradeBuilding(state, sid, tx, ty, tuning);
        state = o.state;
        return o;
      },
      onConnectTwice: () => ({ ...refuse, laid: 0 }),
      onClaim: () => refuse,
      onBack: () => {},
      onTerrace: (sid, tx, ty) => {
        calls.push(`terrace@${tx},${ty}`);
        const o = terraceBuilding(state, sid, tx, ty, tuning);
        state = o.state;
        return o;
      },
      onEvacuate: (sid) => {
        calls.push("evacuate");
        const o = evacuateSettlement(state, sid, rate(), tuning);
        state = o.state;
        return { ok: o.ok, reason: o.reason, words: o.ok ? `${Math.floor(o.moved)} people moved to safety.` : null };
      },
      floodNote: (sid) => {
        const s = state.settlements.find((c) => c.id === sid)!;
        return { words: floodWarnings(state, channels(state), rate(), tuning).get(sid) ?? null, evacuate: !s.evacuated && s.population >= 1 && threatened(state, s, rate(), tuning), evacuated: s.evacuated };
      },
    },
    tuning,
  );
  const canvas = host.querySelector("canvas")!;
  canvas.width = 800;
  canvas.height = 600;
  let now = 0;
  const frame = (): void => {
    now += 1000;
    screen.frame(state.settlements.find((c) => c.id === id)!, channels(state), now);
  };
  screen.open(id);
  frame();
  const q = (sel: string): HTMLElement => host.querySelector<HTMLElement>(sel)!;
  return { host, screen, calls, frame, q, state: () => state };
}

describe("the city view's sea (Batch 38)", () => {
  it("shows the warning in the HUD's words, and Evacuate moves the people through the simulation", () => {
    const page = mount(peopled());
    expect(page.q(".city-flood").hidden).toBe(false);
    expect(page.q(".city-flood-text").textContent).toMatch(/^Flood warning: submersion begins in ~\d+ yr, total loss in ~\d+ yr at current rate\.$/);
    const evacuate = page.q(".city-evacuate") as HTMLButtonElement;
    expect(evacuate.hidden).toBe(false);
    const people = page.state().settlements[0]!.population;
    evacuate.click();
    page.frame();
    expect(page.calls).toEqual(["evacuate"]);
    expect(page.state().settlements[0]!.population).toBe(0);
    expect(page.state().settlements[1]!.population).toBe(people);
    expect(page.q(".city-hint").textContent).toBe(`${Math.floor(people)} people moved to safety.`);
    expect(page.q(".city-flood-text").textContent).toMatch(/Evacuated: its people were moved to safety, and no one settles here again\.$/);
    expect(evacuate.hidden).toBe(true);
  });

  it("is not there for a city the sea does not threaten", () => {
    const page = mount(peopled(), t, "settlement-2");
    expect(page.q(".city-flood").hidden).toBe(true);
    expect((page.q(".city-evacuate") as HTMLButtonElement).hidden).toBe(true);
  });

  it("offers Raise its ground on a selected building, at the simulation's price, and sends the rover", () => {
    const withHq: SimState = (() => {
      const s = peopled();
      return { ...s, settlements: s.settlements.map((c, i) => (i === 0 ? { ...c, buildings: [...c.buildings, { type: "headquarters" as const, tx: 20, ty: 19, level: 1 }] } : c)) };
    })();
    const page = mount(withHq);
    const depot = page.state().settlements[0]!.buildings.findIndex((b) => b.tx === 0 && b.ty === 15);
    page.screen.select(depot);
    page.frame();
    const raise = page.q(".city-terrace") as HTMLButtonElement;
    expect(raise.hidden).toBe(false);
    const plan = terracePlan(page.state().settlements[0]!, 0, 15, t)!;
    expect(raise.textContent).toBe(`Raise its ground 2 m (${plan.materials} materials)`);
    raise.click();
    expect(page.calls).toEqual(["terrace@0,15"]);
    expect(page.state().settlements[0]!.jobs).toEqual([expect.objectContaining({ kind: "rover", levelM: plan.levelM, area: { w: 1, d: 1 } })]);
    page.frame();
    expect(page.q(".city-hint").textContent).toBe("A rover is on its way to raise the Storage Depot's ground.");
  });

  it("puts the Seawall on the bar where the sea floods, says what each level holds back, and leaves it off where it does not", () => {
    const page = mount(peopled());
    const card = page.q('.city-card[data-type="seawall"]');
    expect(card).not.toBeNull();
    expect(page.screen.tipText("seawall").lines).toContain("Each level holds the sea back 4 m more: 32 m at level 8. It stands until the city falls.");
    expect(page.screen.tipText("seawall").lines.join(" ")).not.toMatch(/\+10% on the last/);
    document.body.replaceChildren();
    const dry = makeTuning({ ...t, FLOODING_ENABLED: 0 });
    const plain = mount(foundSettlement(marsStart(), "city", 0.31, -1.2, dry).state, dry);
    expect(plain.host.querySelector('.city-card[data-type="seawall"]')).toBeNull();
    expect(plain.host.querySelector('.city-card[data-type="habitat_dome"]')).not.toBeNull();
    expect((plain.q(".city-terrace") as HTMLButtonElement).hidden).toBe(true);
  });

  it("says in the inspector what the Seawall holds back", () => {
    const page = mount(peopled());
    let s = placeBuilding(page.state(), "settlement-1", "seawall", 10, 0, t).state;
    s = upgradeBuilding(s, "settlement-1", 10, 0, t).state;
    const index = s.settlements[0]!.buildings.findIndex((b) => b.type === "seawall");
    document.body.replaceChildren();
    const walled = mount(s);
    walled.screen.select(index);
    walled.frame();
    expect(walled.q(".city-inspector-flows").textContent).toMatch(/Holds the sea back 8 m - 4 m a level\./);
    // The wall the water is held against is not raised.
    expect((walled.q(".city-terrace") as HTMLButtonElement).hidden).toBe(true);
  });
});

describe("the throttle link in the assembled game (Batch 38)", () => {
  const T = makeTuning({ ...DEFAULT_TUNING, SETTLEMENTS_ENABLED: 1, FLOODING_ENABLED: 1, TERRAIN_RELIEF_M: 12 });

  /** The site nearest a height, from a fixed spiral of the planet (as throttle.test.ts finds them). */
  const siteAt = (want: number): { lat: number; lon: number } => {
    let best: { lat: number; lon: number; m: number } | null = null;
    for (let i = 0; i < 4000; i += 1) {
      const lat = Math.asin(((i * 0.618034) % 1) * 1.8 - 0.9);
      const lon = ((i * 0.754877) % 1) * 2 * Math.PI - Math.PI;
      const m = siteElevation(lat, lon, T);
      if (best === null || Math.abs(m - want) < Math.abs(best.m - want)) best = { lat, lon, m };
    }
    return best!;
  };
  /** A city's first open place for a dome, and the dome. */
  const home = (s: SimState, id: string): SimState => {
    for (let k = 0; k < 32 * 32; k += 1) {
      const o = placeBuilding(s, id, "habitat_dome", k % 32, Math.floor(k / 32), T);
      if (o.ok) return o.state;
    }
    throw new Error("no room for a dome");
  };

  it("says in the HUD what switching the planet's facilities off would buy a city in the burst", () => {
    // The reference arc at year 290 and a city at -6,000 m: the projection gives it 7.75 years more (throttle.test.ts).
    let state = terraformedMars(DEFAULT_TUNING, 290);
    const low = siteAt(-6000);
    state = foundSettlement(state, "city", low.lat, low.lon, T, "Low").state;
    const frames = new Frames();
    frames.install();
    const root = document.createElement("div");
    document.body.append(root);
    const handle: GameHandle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T) }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
    try {
      let words = "";
      for (let i = 0; i < 120 && !/Switching off/.test(words); i += 1) {
        frames.step(1, 100);
        words = root.querySelector(".hud-settlement-flood")?.textContent ?? "";
      }
      expect(words).toMatch(/^Flood warning: submersion begins in ~\d+ yr, total loss in ~\d+ yr at current rate\. Switching off the planet's machines would buy ~8 yr\.$/);
      expect(handle.state.settlements[0]!.lostAtSeaLevelM).toBeNull();
    } finally {
      handle.stop();
    }
  });

  it("down in the threatened city: the sea's panel in the HUD's words, and Evacuate sends its people to the safe city", () => {
    let state = terraformedMars(DEFAULT_TUNING, 290);
    const low = siteAt(-6000);
    const high = siteAt(1000);
    state = foundSettlement(state, "city", low.lat, low.lon, T, "Low").state;
    state = foundSettlement(state, "city", high.lat, high.lon, T, "High").state;
    state = { ...state, settlements: state.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1000 } })) };
    state = home(home(state, "settlement-1"), "settlement-2");
    state = { ...state, settlements: state.settlements.map((c, i) => (i === 0 ? { ...c, population: 30 } : c)) };
    const frames = new Frames();
    frames.install();
    const root = document.createElement("div");
    document.body.append(root);
    const handle: GameHandle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T) }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
    try {
      frames.step(3, 100);
      root.querySelector<HTMLButtonElement>(".hud-settlement-open")!.click();
      for (let i = 0; i < 300 && handle.views.city.root.hidden; i += 1) frames.step();
      expect(handle.views.city.root.hidden, "down in the city").toBe(false);
      const canvas = root.querySelector<HTMLCanvasElement>(".city canvas")!;
      canvas.width = 800;
      canvas.height = 600;
      let text = "";
      for (let i = 0; i < 60 && !/Switching off/.test(text); i += 1) {
        frames.step(1, 300);
        text = root.querySelector(".city-flood-text")?.textContent ?? "";
      }
      expect(root.querySelector<HTMLElement>(".city-flood")!.hidden).toBe(false);
      expect(text).toMatch(/^Flood warning: .* Switching off the planet's machines would buy ~8 yr\.$/);
      const evacuate = root.querySelector<HTMLButtonElement>(".city-evacuate")!;
      expect(evacuate.hidden).toBe(false);
      evacuate.click();
      expect(handle.state.settlements[0]!.population).toBe(0);
      expect(handle.state.settlements[1]!.population).toBe(30);
      frames.step(4, 300);
      expect(root.querySelector(".city-hint")!.textContent).toBe("30 people moved to safety: High (30).");
    } finally {
      handle.stop();
    }
  });
});

describe("worlds made from now (Batch 38)", () => {
  it("flood: Standard and Terraformed worlds have the sea on, a sandbox has it off", async () => {
    const { worldTuning } = await import("./game-tuning.js");
    expect(worldTuning("standard", 1).FLOODING_ENABLED).toBe(1);
    expect(worldTuning("terraformed", 1).FLOODING_ENABLED).toBe(1);
    expect(worldTuning("standard", 1, "classic").FLOODING_ENABLED).toBe(1);
    expect(worldTuning("sandbox", 1).FLOODING_ENABLED).toBe(0);
    // The worlds before worlds keep what they were played with: no sea.
    const { BROWSER_TUNING } = await import("./game-tuning.js");
    expect(BROWSER_TUNING.FLOODING_ENABLED).toBe(0);
  });
});
