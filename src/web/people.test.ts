// @vitest-environment happy-dom

/**
 * People in the game (Batch 32), through the real components: the city's
 * People section and the inspector's reach, the planner's coverage overlay,
 * the crowd drawn at a station, and the towers' lights by how full they are.
 * All of it with needs on; none of it with them off.
 */

import { describe, expect, it } from "vitest";

import type { ActionOutcome } from "./city.js";
import type { PlacedBuilding, SimState, Tuning } from "../sim/index.js";
import { NEUTRAL_ENV, cityView, derive, foundSettlement, habitat, makeTuning, marsStart, worldEnv } from "../sim/index.js";
import { cityScene } from "../render/city.js";
import { figuresAt } from "../render/people.js";
import { CityScreen } from "./city.js";
import { COVERAGE_COLOURS, PlannerScreen, coverageOf, plannerPixels } from "./planner.js";
import { happinessWords, needLines } from "./needs-words.js";

const DEEP = { MICRO_CAP_POWER: 1e9, MICRO_CAP_WATER: 1e9, MICRO_CAP_OXYGEN: 1e9, MICRO_CAP_FOOD: 1e9, MICRO_CAP_MATERIALS: 1e9 } as const;
const BASE = { SETTLEMENTS_ENABLED: 1, CITY_GRID_TILES: 64, ...DEEP } as const;
const ON = makeTuning({ ...BASE, NEEDS_ENABLED: 1 });
const OFF = makeTuning(BASE);

/** 40 towers (homes for 6,400) in the north-west, 6,000 people, and a station just south of them that reaches every one. */
function town(station: { tx: number; ty: number } = { tx: 8, ty: 9 }, t: Tuning = ON): SimState {
  const towers: PlacedBuilding[] = [];
  for (let j = 0; j < 4; j += 1) for (let i = 0; i < 10; i += 1) towers.push({ type: "skyscraper", tx: 2 * i, ty: 2 * j, level: 1 });
  const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
  const full = { power: 1e8, water: 1e8, oxygen: 1e8, food: 1e8, materials: 1e8 };
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: [...towers, { type: "station", tx: station.tx, ty: station.ty, level: 1 }], population: 6000, stores: full })) };
}
const envOf = (s: SimState, t: Tuning) => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t, 0);
const STATION = 40;

function mountCity(state: SimState, t: Tuning) {
  const host = document.createElement("div");
  document.body.append(host);
  const no = (): ActionOutcome => ({ ok: false, reason: "not in this test" });
  const screen = new CityScreen(
    host,
    {
      onPlace: no,
      canPlace: no,
      onRemove: no,
      onLink: no,
      canLink: no,
      onUnlink: no,
      onSendRover: no,
      onLaunch: no,
      onConnect: () => ({ ...no(), laid: 0 }),
      onLevel: no,
      canLevel: no,
      onUpgrade: no,
      onConnectTwice: () => ({ ...no(), laid: 0 }),
      onClaim: no,
      onBack: () => undefined,
    },
    t,
  );
  screen.open(state.settlements[0]!.id);
  let now = 0;
  const frame = (): void => {
    now += 1000;
    screen.frame(state.settlements[0]!, envOf(state, t), now);
  };
  frame();
  return { host, screen, frame };
}

describe("the city's People section", () => {
  it("says how happy the people are and how each need is met, with needs on", () => {
    const { host } = mountCity(town(), ON);
    const section = host.querySelector<HTMLElement>(".city-people")!;
    expect(section.hidden).toBe(false);
    // Asked of 6,000 people: green space, food variety, medical care, research (all unmet) and transport (met).
    // The mood is -0.15 - 0.1 - 0.2 - 0.15 + 0.2 = -0.4, a happiness of 30%: growth -20%, buildings make 4% less.
    expect(host.querySelector(".city-happiness")!.textContent).toBe("Happiness 30%: growth -20%, buildings make -4%.");
    const row = (need: string) => host.querySelector<HTMLElement>(`.city-need[data-need="${need}"]`)!;
    expect(row("transport").dataset["state"]).toBe("met");
    expect(row("transport").textContent).toContain("100% of homes in reach");
    expect(row("medical").dataset["state"]).toBe("unmet");
    expect(row("medical").textContent).toContain("wants a Medical Center in reach of the homes");
    expect(row("variety").textContent).toContain("no food grown here");
    expect(row("shops").dataset["state"]).toBe("later");
    expect(row("shops").textContent).toContain("asked from 10,000 people");
  });

  it("is not shown with needs off", () => {
    const { host } = mountCity(town(undefined, OFF), OFF);
    expect(host.querySelector<HTMLElement>(".city-people")!.hidden).toBe(true);
  });

  it("tells, for a station, the people it reaches and the crowd there now", () => {
    const { host, screen, frame } = mountCity(town(), ON);
    screen.select(STATION);
    frame();
    const flows = host.querySelector(".city-inspector-flows")!.textContent ?? "";
    expect(flows).toContain("Reaches the homes of 6,000 people.");
    expect(flows).toContain("About 120 people here now.");
    // A station out of reach of every home reaches no one, and no crowd waits there.
    const far = mountCity(town({ tx: 50, ty: 50 }), ON);
    far.screen.select(STATION);
    far.frame();
    const words = far.host.querySelector(".city-inspector-flows")!.textContent ?? "";
    expect(words).toContain("Reaches the homes of 0 people.");
    expect(words).not.toContain("people here now");
  });
});

describe("a service that is not running", () => {
  /** The town with no power at all: the station (and the towers) dark. */
  const dark = (): SimState => {
    const s = town();
    return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, power: 0 } })) };
  };

  it("reaches no one: the inspector says so, no crowd waits, and the planner shows every home a gap", () => {
    const state = dark();
    const s = state.settlements[0]!;
    const view = cityView(s, envOf(state, ON), ON);
    expect(view.shortages).toContain("power");
    expect(view.buildings[STATION]!.operable).toBe(false);
    expect(view.buildings[STATION]!.reaches).toBe(0);
    expect(figuresAt(view.buildings[STATION]!)).toBe(0);
    const { host, screen, frame } = mountCity(state, ON);
    screen.select(STATION);
    frame();
    expect(host.querySelector(".city-inspector-flows")!.textContent).toContain("Reaches no one while it is not running.");
    const n = view.tiles;
    const px = plannerPixels(view, s, coverageOf(s, view, "transport", ON));
    expect([...px.slice((1 * n + 1) * 4, (1 * n + 1) * 4 + 3)]).toEqual([...COVERAGE_COLOURS.gap]);
  });
});

describe("the words", () => {
  it("calls a city too small to ask for anything content, and says what growth and work gain", () => {
    const content = { needs: [], mood: 0, growth: 1, output: 1 };
    expect(happinessWords({ ...content, needs: [{ id: "green", asked: false, met: 0 }] })).toBe("Happiness 50%: content - a settlement this small asks only for life support.");
    expect(happinessWords({ needs: [{ id: "green", asked: true, met: 1 }], mood: 0.2, growth: 1.1, output: 1.02 })).toBe("Happiness 60%: growth +10%, buildings make +2%.");
    const lines = needLines({ needs: [{ id: "variety", asked: true, met: 0.5 }], mood: 0, growth: 1, output: 1 }, ON);
    expect(lines[0]!.text).toBe("food grown one way - wants Greenhouses, a Biosphere, a Mega Mall");
  });
});

describe("the planner's coverage", () => {
  it("paints the homes a running station reaches green, and the gaps red", () => {
    const near = town();
    const s = near.settlements[0]!;
    const view = cityView(s, envOf(near, ON), ON);
    const n = view.tiles;
    const rgb = (px: Uint8ClampedArray, tx: number, ty: number): number[] => [...px.slice((ty * n + tx) * 4, (ty * n + tx) * 4 + 3)];
    const reached = plannerPixels(view, s, coverageOf(s, view, "transport", ON));
    expect(rgb(reached, 1, 1)).toEqual([...COVERAGE_COLOURS.reached]);
    // The station itself, white.
    expect(rgb(reached, 9, 10)).toEqual([...COVERAGE_COLOURS.provider]);
    const far = town({ tx: 50, ty: 50 });
    const fs = far.settlements[0]!;
    const fview = cityView(fs, envOf(far, ON), ON);
    expect(rgb(plannerPixels(fview, fs, coverageOf(fs, fview, "transport", ON)), 1, 1)).toEqual([...COVERAGE_COLOURS.gap]);
    // Without the overlay, the tower is a home as ever.
    expect(rgb(plannerPixels(view, s), 1, 1)).not.toEqual([...COVERAGE_COLOURS.reached]);
  });

  it("offers the coverage with needs on, a service at a time, and not with them off", () => {
    for (const [t, shown] of [[ON, true], [OFF, false]] as const) {
      const state = town(undefined, t);
      const host = document.createElement("div");
      document.body.append(host);
      const refuse = () => ({ ok: false, reason: "no", zone: null, queued: 0, planned: 0 });
      const screen = new PlannerScreen(host, { onRename: refuse, onZone: refuse, onDeleteZone: refuse, onLevelZone: refuse, onPlan: refuse, onCancelPlans: refuse, onCityView: () => undefined }, t);
      screen.open(state.settlements[0]!.id);
      screen.frame(state.settlements[0]!, envOf(state, t), 1000);
      const bar = host.querySelector<HTMLElement>(".planner-coverage")!;
      expect(bar.hidden).toBe(!shown);
      if (!shown) continue;
      const button = [...host.querySelectorAll<HTMLButtonElement>(".planner-coverage-button")].find((b) => b.textContent === "Transport")!;
      button.click();
      expect(screen.coverage).toBe("transport");
      expect(button.getAttribute("aria-pressed")).toBe("true");
      host.querySelector<HTMLButtonElement>('.planner-coverage-button[data-need="none"]')!.click();
      expect(screen.coverage).toBeNull();
    }
  });
});

describe("people in the view", () => {
  it("draws the crowd at a station, a figure for every few people, and none with needs off", () => {
    const on = cityView(town().settlements[0]!, envOf(town(), ON), ON);
    const off = cityView(town(undefined, OFF).settlements[0]!, envOf(town(undefined, OFF), OFF), OFF);
    const station = on.buildings[STATION]!;
    expect(station.reaches).toBe(6000);
    expect(figuresAt(station)).toBe(16);
    expect(off.buildings[STATION]!.reaches).toBeUndefined();
    // The same scene but for the crowd: two parts a figure (a body and a head).
    const options = { time: 1, selected: null, ghost: null } as const;
    const crowded = cityScene(on, options).length;
    const empty = cityScene({ ...on, buildings: on.buildings.map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== "reaches")) as unknown as typeof b) }, options).length;
    expect(crowded - empty).toBeGreaterThanOrEqual(16);
  });

  it("lights a tower's windows by how full the homes are, with needs on", () => {
    const half = (t: Tuning) => {
      const s = town(undefined, t);
      return cityView({ ...s.settlements[0]!, population: 3200 }, envOf(s, t), t).buildings[0]!.activity;
    };
    expect(half(ON)).toBeCloseTo(0.5, 9);
    expect(half(OFF)).toBe(1);
  });
});
