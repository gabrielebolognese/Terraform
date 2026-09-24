// @vitest-environment happy-dom

/**
 * The two panels on one page.
 *
 * This file exists because of a bug that every other test in the project
 * missed: `Inspector` clears the element it is handed, and `main.ts` mounted
 * the HUD into that same element first. The inspector deleted the entire game
 * shell on construction. `hud.test.ts` passed, `inspector`'s own behaviour was
 * fine, and the page was broken - because each unit test mounts its component
 * alone, and the collision only exists when both are assembled.
 *
 * So the unit under test here is the ASSEMBLY, not either component. Anything
 * that only goes wrong when two things are put together needs a test that puts
 * them together.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { Hud } from "./hud.js";
import type { HudHooks } from "./hud.js";
import { Globe } from "./globe.js";
import { Inspector } from "./inspector.js";
import type { InspectorHooks } from "./inspector.js";
import { DEFAULT_TUNING } from "../sim/index.js";

const t = DEFAULT_TUNING;

const HUD_HOOKS: HudHooks = {
  onSpeed: () => undefined,
  onOrder: () => undefined,
  onSeed: () => undefined,
  onFocusLever: () => undefined,
  onToggleLever: () => undefined,
  onFound: () => undefined,
  onCancelFound: () => undefined,
  onOpenSettlement: () => undefined,
};

const INSPECTOR_HOOKS: InspectorHooks = {
  onSpeed: () => undefined,
  onOrder: () => undefined,
  onToggleLever: () => undefined,
  onSeed: () => undefined,
  onReset: () => undefined,
  onExample: () => undefined,
};

/** Exactly what `main.ts` builds: one #app, two containers, two components. */
function mountPage(): HTMLElement {
  const app = document.createElement("div");
  app.id = "app";
  document.body.append(app);

  const hudRoot = document.createElement("div");
  hudRoot.className = "shell-hud";
  const inspectorRoot = document.createElement("div");
  inspectorRoot.className = "shell-instruments";
  const stage = document.createElement("div");
  stage.className = "stage";
  const globe = new Globe(stage);
  app.append(stage, hudRoot, inspectorRoot);

  new Hud(hudRoot, HUD_HOOKS, t);
  new Inspector(inspectorRoot, INSPECTOR_HOOKS, t, globe);
  return app;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the assembled page", () => {
  it("keeps the shell after the instruments are mounted", () => {
    const app = mountPage();
    expect(app.querySelectorAll(".hud").length, "the inspector wiped the HUD").toBe(1);
    expect(app.querySelectorAll(".app").length, "the inspector did not mount").toBe(1);
  });

  it("puts the shell above the instruments", () => {
    const app = mountPage();
    const hud = app.querySelector(".hud");
    const instruments = app.querySelector(".app");
    expect(hud).not.toBeNull();
    expect(instruments).not.toBeNull();
    // A player should meet "what next" before a reservoir table.
    expect(hud!.compareDocumentPosition(instruments!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("mounts both in either order without either destroying the other", () => {
    const app = document.createElement("div");
    document.body.append(app);
    const a = document.createElement("div");
    const b = document.createElement("div");
    app.append(a, b);

    new Inspector(a, INSPECTOR_HOOKS, t);
    new Hud(b, HUD_HOOKS, t);
    expect(app.querySelectorAll(".app").length).toBe(1);
    expect(app.querySelectorAll(".hud").length).toBe(1);
  });

  it("keeps the planet on the stage and the scrubber in the instruments", () => {
    const app = mountPage();
    expect(app.querySelector(".stage .globe-canvas"), "the planet was lost in assembly").not.toBeNull();
    expect(app.querySelector(".shell-instruments .scrub-toggle"), "the arc scrubber was lost in assembly").not.toBeNull();
  });

  it("puts the planet behind the panels, not between them", () => {
    // The stage has to come first: the panels float over the planet.
    const app = mountPage();
    expect(app.firstElementChild?.classList.contains("stage")).toBe(true);
  });

  it("gives the page exactly one of each control, not two", () => {
    const app = mountPage();
    // The HUD and the inspector both own speed buttons; they must be
    // distinguishable, or a click goes to whichever the selector found first.
    expect(app.querySelectorAll(".hud-speed").length).toBe(5);
    expect(app.querySelectorAll(".hud-advice-button").length).toBe(1);
    expect(app.querySelectorAll(".hud-feed").length).toBe(1);
  });
});

describe("focusLever", () => {
  it("finds the row for a real lever and does not throw on an unknown one", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const inspector = new Inspector(host, INSPECTOR_HOOKS, t);

    // happy-dom has no layout, so scrollIntoView is a no-op; what matters is
    // that the row is found and marked.
    inspector.focusLever("orbital_mirror");
    expect(host.querySelectorAll(".lever-flash").length).toBe(1);

    // biosphere_seeding is an action, not a lever row - it has no row to focus.
    expect(() => inspector.focusLever("biosphere_seeding")).not.toThrow();
  });
});

describe("the planet is fed by the instruments (the globe has no other source)", () => {
  it("hands every live update's channels to the planet", async () => {
    const { NEUTRAL_ENV, derive, computeProgress, deriveVisuals, computeStep, marsStart } = await import("../sim/index.js");
    const { Ring } = await import("./ring.js");
    const received: unknown[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const inspector = new Inspector(host, INSPECTOR_HOOKS, t, { update: (c) => received.push(c) });

    const state = marsStart();
    const d = derive(state.reservoirs, NEUTRAL_ENV, t);
    const p = computeProgress(state.reservoirs, d, t);
    const visuals = deriveVisuals(state.reservoirs, d, computeStep(state, d, t, t.SUBSTEP_YEARS, null).flows, t);
    inspector.update(
      {
        simYear: 0, state, derived: d, progress: p.progress, progressRaw: p.progressRaw, axes: p.axes,
        phase: 0, phaseReached: 0, dTdt: 0, droppedYears: 0, env: NEUTRAL_ENV, levers: [], shieldStrength: 0,
        speed: 1, seedMessage: null, awayMessage: null, storageWarning: null, visuals, seaLevel: { m: -8200, ratePerYear: 0 },
      },
      { T: new Ring(8), P: new Ring(8), progress: new Ring(8) },
    );
    expect(received).toEqual([visuals]);
  });

  it("reads out the sea level and its rate - and says so plainly before there is a sea (Batch 23)", async () => {
    const { NEUTRAL_ENV, derive, computeProgress, deriveVisuals, computeStep, marsStart } = await import("../sim/index.js");
    const { Ring } = await import("./ring.js");
    const host = document.createElement("div");
    document.body.append(host);
    const inspector = new Inspector(host, INSPECTOR_HOOKS, t);
    const show = (liquid: number, sea: { m: number; ratePerYear: number }): string => {
      const base = marsStart();
      const state = { ...base, reservoirs: { ...base.reservoirs, h2o_liq: liquid } };
      const d = derive(state.reservoirs, NEUTRAL_ENV, t);
      const p = computeProgress(state.reservoirs, d, t);
      const visuals = deriveVisuals(state.reservoirs, d, computeStep(state, d, t, t.SUBSTEP_YEARS, null).flows, t);
      inspector.update(
        {
          simYear: 0, state, derived: d, progress: p.progress, progressRaw: p.progressRaw, axes: p.axes,
          phase: 0, phaseReached: 0, dTdt: 0, droppedYears: 0, env: NEUTRAL_ENV, levers: [], shieldStrength: 0,
          speed: 1, seedMessage: null, awayMessage: null, storageWarning: null, visuals, seaLevel: sea,
        },
        { T: new Ring(8), P: new Ring(8), progress: new Ring(8) },
      );
      const cell = [...host.querySelectorAll(".stat")].find((c) => c.querySelector(".stat-label")?.textContent === "sea level");
      return cell?.querySelector(".stat-value")?.textContent ?? "missing";
    };
    expect(show(0, { m: -8200, ratePerYear: 0 })).toBe("no sea yet");
    expect(show(20, { m: -3097.4, ratePerYear: 0.4 })).toBe("−3,097 m (+0.40 m/yr)");
    expect(show(20, { m: -3097.4, ratePerYear: -1.25 })).toBe("−3,097 m (−1.25 m/yr)");
  });
});
