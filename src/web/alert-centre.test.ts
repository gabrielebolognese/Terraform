// @vitest-environment happy-dom

/**
 * Batch 31 on screen, through the real components: the alert centre keeps
 * the record and counts what needs the player; the toasts interrupt by
 * priority; the statistics chart the records the simulation keeps. Last, the
 * exit gate's own words: "Through the real components: an alert clicked
 * opens the right city with the right building selected."
 */

import { afterEach, describe, expect, it } from "vitest";

import type { BuildingType, SimState } from "../sim/index.js";
import { NEUTRAL_ENV, advance, constructionOf, derive, foundSettlement, marsStart, placeBuilding, stormIntensity, simYear } from "../sim/index.js";
import type { Alert } from "./alerts.js";
import { AlertCentre, AlertToasts } from "./alert-centre.js";
import { TOASTS_SHOWN, TOAST_NOTICE_MS, TOAST_URGENT_MS } from "./config.js";
import { startGame } from "./game.js";
import type { GameHandle } from "./game.js";
import { worldTuning } from "./game-tuning.js";
import { readWorld } from "./readout.js";
import { PLANET, StatisticsScreen } from "./statistics.js";

const T = worldTuning("standard", 0, "standard");
const CLASSIC = worldTuning("standard", 0, "classic");
const cfg = (t = T) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });

afterEach(() => {
  document.body.replaceChildren();
});

const alert = (key: string, priority: Alert["priority"], title = key): Alert => ({ key, kind: priority === "record" ? "built" : "blackout", priority, title, text: `${title}.`, count: 1, target: { kind: "city", id: "settlement-1", at: { x: 1, y: 2 } } });

describe("the alert centre", () => {
  function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const went: unknown[] = [];
    const centre = new AlertCentre(host, (t) => went.push(t));
    return { host, centre, went };
  }

  it("counts what needs the player now, and says when something is urgent in words as well as colour", () => {
    const { centre } = mount();
    centre.update([], [], 0);
    expect(centre.toggle.textContent).toBe("Alerts");
    expect(centre.toggle.getAttribute("aria-label")).toBe("Alerts: nothing needs you");
    centre.update([alert("a", "urgent"), alert("b", "notice")], [], 3);
    expect(centre.toggle.textContent).toBe("Alerts (2, 1 urgent)");
    expect(centre.toggle.hasAttribute("data-urgent")).toBe(true);
    expect(centre.toggle.getAttribute("aria-label")).toBe("Alerts: 2 need you, 1 urgent");
    centre.update([alert("b", "notice")], [], 4);
    expect(centre.toggle.textContent).toBe("Alerts (1)");
    expect(centre.toggle.hasAttribute("data-urgent")).toBe(false);
  });

  it("lists what holds now and what happened, newest first; the same thing again in one place is one line counting up", () => {
    const { host, centre } = mount();
    centre.update([alert("now", "urgent", "Blackout in Ares")], [alert("built:1", "record", "Solar Array finished in Ares")], 9);
    centre.update([], [alert("built:1", "record", "Habitat Dome finished in Ares")], 10);
    centre.update([], [alert("built:1", "record", "Habitat Dome finished in Ares")], 11);
    centre.update([], [alert("built:2", "record", "Depot finished in Nix")], 12);
    centre.update([], [alert("built:2", "record", "Depot finished in Nix")], 13);
    centre.setOpen(true);
    const now = [...host.querySelectorAll(".alerts-now .alert-title")].map((n) => n.textContent);
    const log = [...host.querySelectorAll(".alerts-log .alert-title")].map((n) => n.textContent);
    // Nothing holds now at the last look.
    expect(now).toEqual([]);
    expect(host.querySelector(".alerts-now")!.textContent).toBe("Nothing needs you right now.");
    // A different building in the same city is a line of its own: the count is of the same thing.
    expect(log).toEqual(["Depot finished in Nix (2 times)", "Habitat Dome finished in Ares (2 times)", "Solar Array finished in Ares"]);
    expect(host.querySelector(".alerts-log .alert-text")!.textContent).toMatch(/^Year 13\. /);
  });

  it("goes where the line says, and closes", () => {
    const { host, centre, went } = mount();
    centre.update([alert("a", "urgent", "Blackout in Ares")], [], 0);
    centre.setOpen(true);
    host.querySelector<HTMLButtonElement>(".alerts-now .alert-go")!.click();
    expect(went).toEqual([{ kind: "city", id: "settlement-1", at: { x: 1, y: 2 } }]);
    expect(centre.isOpen).toBe(false);
  });
});

describe("the toasts", () => {
  function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const went: unknown[] = [];
    return { host, toasts: new AlertToasts(host, (t) => went.push(t)), went };
  }
  const keys = (t: AlertToasts) => t.showing.map((a) => a.key);

  it("interrupt for urgent and notice alerts only: a record never toasts", () => {
    const { toasts } = mount();
    toasts.push([alert("r", "record"), alert("n", "notice"), alert("u", "urgent")]);
    toasts.frame(0);
    expect(keys(toasts)).toEqual(["u", "n"]);
  });

  it("show a few at once, urgent first; an urgent one puts out a notice rather than waiting behind it", () => {
    const { toasts } = mount();
    toasts.push([alert("n1", "notice"), alert("n2", "notice"), alert("n3", "notice"), alert("n4", "notice")]);
    toasts.frame(0);
    expect(keys(toasts)).toHaveLength(TOASTS_SHOWN);
    toasts.push([alert("u", "urgent")]);
    toasts.frame(100);
    expect(keys(toasts)).toContain("u");
    expect(keys(toasts)).toHaveLength(TOASTS_SHOWN);
  });

  it("each stays its priority's time: a notice goes first, then the urgent one", () => {
    const { toasts } = mount();
    toasts.push([alert("u", "urgent"), alert("n", "notice")]);
    toasts.frame(0);
    toasts.frame(TOAST_NOTICE_MS - 1);
    expect(keys(toasts)).toEqual(["u", "n"]);
    toasts.frame(TOAST_NOTICE_MS);
    expect(keys(toasts)).toEqual(["u"]);
    toasts.frame(TOAST_URGENT_MS);
    expect(keys(toasts)).toEqual([]);
  });

  it("click through to where it happened, or are dismissed", () => {
    const { host, toasts, went } = mount();
    toasts.push([alert("u", "urgent"), alert("n", "notice")]);
    toasts.frame(0);
    host.querySelector<HTMLButtonElement>('.alert-toast[data-priority="notice"] .alert-toast-close')!.click();
    expect(keys(toasts)).toEqual(["u"]);
    host.querySelector<HTMLButtonElement>(".alert-toast-go")!.click();
    expect(went).toHaveLength(1);
    expect(keys(toasts)).toEqual([]);
    expect(host.querySelectorAll(".alert-toast")).toHaveLength(0);
  });
});

describe("the statistics", () => {
  it("chart the planet as the instruments showed it, weather included, at every sample", () => {
    // Classic pace, from a few years before the world's first dust storm until after it.
    let s = marsStart(undefined, CLASSIC);
    let storm = 0;
    let checked = 0;
    for (let i = 0; i < 1200; i += 1) {
      s = advance(s, 1, cfg(CLASSIC));
      const last = s.history.samples[s.history.samples.length - 1];
      if (last === undefined || last.steps !== s.steps) continue;
      const shown = readWorld(s, CLASSIC);
      expect(last.T).toBe(shown.derived.T);
      expect(last.P).toBe(shown.derived.P);
      expect(last.progress).toBe(shown.progress.progress);
      checked += 1;
      if (stormIntensity(s.seed, simYear(s, CLASSIC), CLASSIC) > 0.05) {
        storm += 1;
        // Where the weather matters, the record is not the planet without it.
        expect(last.T).not.toBe(derive(s.reservoirs, NEUTRAL_ENV, CLASSIC).T);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(storm, "vacuity: some samples taken under a storm").toBeGreaterThan(0);
  });

  it("show the planet's charts first, then any city's - the planner's charts, and what it made and used", () => {
    let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
    s = advance(s, 40, cfg());
    const host = document.createElement("div");
    document.body.append(host);
    const stats = new StatisticsScreen(host, T);
    stats.update(s);
    stats.toggle.click();
    expect(stats.isOpen).toBe(true);
    expect(stats.showing).toBe(PLANET);
    const titles = () => [...host.querySelectorAll(".planner-chart figcaption")].map((n) => n.textContent);
    expect(titles()).toEqual(["Temperature (K)", "Pressure (mbar)", "Oxygen (mbar)", "Ocean (% of the surface)", "Biomass (units)", "Carbon dioxide (mbar)", "Progress (%)", "Credits (credits)", "People (in every settlement)"]);
    expect(host.querySelector(".statistics-span")!.textContent).toMatch(/^From year 0 to year 1\. /);
    const picker = host.querySelector<HTMLSelectElement>(".statistics-picker")!;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["The planet", "Ares"]);
    picker.value = "settlement-1";
    picker.dispatchEvent(new Event("change"));
    expect(titles()).toContain("Population (people)");
    expect(titles()).toContain("Power made and used - the power balance (a year)");
    expect(titles()).toContain("Materials made and used (a year)");
    expect(host.querySelector(".statistics-span")!.textContent).toBe(`Ares: the last ${s.settlements[0]!.history.samples.length} years.`);
  });
});

describe("an alert clicked, in the assembled game", () => {
  function play(state: SimState): { root: HTMLElement; handle: GameHandle } {
    const root = document.createElement("div");
    document.body.append(root);
    const handle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T) }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
    return { root, handle };
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Ares, powered, with three greenhouses built on a network of their own far from the rest. */
  function greenhouses(): SimState {
    let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
    // Somewhere each may stand: the first of a ring of places round a point that takes it.
    const put = (type: BuildingType, near: readonly [number, number]) => {
      for (let r = 4; r < 30; r += 1) {
        for (let k = 0; k < 8 * r; k += 1) {
          const a = (k / (8 * r)) * 2 * Math.PI;
          const o = placeBuilding(s, "settlement-1", type, Math.round(near[0] + r * Math.cos(a)), Math.round(near[1] + r * Math.sin(a)), T);
          if (o.ok) {
            s = o.state;
            return;
          }
        }
      }
      throw new Error(`nowhere for a ${type}`);
    };
    put("solar_array", [46, 46]);
    for (let k = 0; k < 3; k += 1) put("greenhouse", [72, 72]);
    // A second fault of another kind, elsewhere: a click must find its own building, not any one offline.
    put("water_extractor", [20, 72]);
    for (let i = 0; i < 400 && (constructionOf(s.settlements[0]!).size > 0 || s.settlements[0]!.jobs.length > 0); i += 1) s = advance(s, 1, cfg());
    return s;
  }

  it("opens the right city with the right building selected", async () => {
    const s = greenhouses();
    const { root, handle } = play(s);
    const lineFor = (title: string): HTMLButtonElement => {
      const line = [...root.querySelectorAll<HTMLButtonElement>(".alerts-now .alert-go")].find((b) => b.textContent!.includes(title));
      expect(line, [...root.querySelectorAll(".alerts-now .alert-title")].map((n) => n.textContent).join(" | ")).toBeDefined();
      return line!;
    };
    const inspector = () => root.querySelector<HTMLElement>(".city-inspector")!;
    try {
      await wait(700);
      const toggle = root.querySelector<HTMLButtonElement>(".alerts-toggle")!;
      expect(toggle.textContent).toMatch(/^Alerts \(\d+\)$/);
      // From orbit: down to the city, the journey and the city's first frames, then its panel.
      toggle.click();
      lineFor("3 Greenhouses offline in Ares").click();
      await wait(3000);
      expect(root.querySelector<HTMLElement>(".city")!.hidden).toBe(false);
      expect(root.querySelector(".city-title")!.textContent).toBe("Ares");
      expect(inspector().hidden).toBe(false);
      expect(inspector().querySelector(".city-inspector-name")!.textContent).toBe("Greenhouse");
      expect(inspector().querySelector(".city-inspector-status")!.textContent).toMatch(/^Not connected: nothing on its network makes power/);
      // From in the city: the other fault's own building, at once.
      toggle.click();
      lineFor("Water Extractor offline in Ares").click();
      await wait(600);
      expect(inspector().querySelector(".city-inspector-name")!.textContent).toBe("Water Extractor");
    } finally {
      handle.stop();
    }
  }, 15_000);

  it("shows each city at a glance in the HUD: its people, what is short, what is being built", async () => {
    const s = greenhouses();
    const { root, handle } = play(s);
    try {
      await wait(700);
      const line = root.querySelector<HTMLElement>(".hud-settlement-overview")!;
      expect(line.hidden).toBe(false);
      expect(line.textContent).toMatch(/^\d+ of \d+ people - (nothing short|short of [a-z ]+) - nothing being built$/);
    } finally {
      handle.stop();
    }
  }, 15_000);
});
