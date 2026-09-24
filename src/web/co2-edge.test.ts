// @vitest-environment happy-dom

/**
 * Every voice in the shell agrees with the win gate about the CO2 ceiling
 * (Batch 13).
 *
 * Phase 6 needs CO2 strictly BELOW 10 mbar. The HUD's CO2 row, the event feed
 * and the guidance all used `<=`, so at exactly 10 the living-world line said
 * "still short on carbon dioxide" while the row said "safe", the feed
 * announced "below the 10 mbar toxicity limit" and the advice said "already
 * under" it. Each voice is compared with the SIMULATION's own answer, not with
 * a restated `<`.
 */

import { describe, expect, it } from "vitest";

import type { Derived, SimState } from "../sim/index.js";
import { DEFAULT_TUNING, NEUTRAL_ENV, TARGETS, computeProgress, derive, livingWorldShortfall, marsStart } from "../sim/index.js";
import { EventLog } from "./events.js";
import { advise } from "./guidance.js";
import { Hud } from "./hud.js";

const t = DEFAULT_TUNING;
const EDGE = TARGETS.co2_atm.toxMax;

/** Every row but CO2 comfortably in band, so CO2 is the only question. */
function world(co2: number): { state: SimState; derived: Derived } {
  const base = marsStart();
  const state: SimState = {
    ...base,
    seeded: true,
    // Oxygen and biomass near target so CO2 is the lowest progress axis and the
    // guidance actually reaches its CO2 branch.
    reservoirs: { ...base.reservoirs, co2_atm: co2, o2: 200, biomass: 0.85, n2: 700 },
  };
  const derived: Derived = { ...derive(state.reservoirs, NEUTRAL_ENV, t), T: 285, P: 900, oceanFrac: 0.4 };
  return { state, derived };
}

function simSaysSafe(co2: number): boolean {
  const { state, derived } = world(co2);
  return !livingWorldShortfall(state.reservoirs, derived).includes("carbon dioxide");
}

function hudSaysSafe(co2: number): boolean {
  const { state, derived } = world(co2);
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const hooks = { onSpeed: () => undefined, onOrder: () => undefined, onSeed: () => undefined, onFocusLever: () => undefined, onToggleLever: () => undefined, onFound: () => undefined, onCancelFound: () => undefined, onOpenSettlement: () => undefined };
  const hud = new Hud(root, hooks, t);
  const progress = computeProgress(state.reservoirs, derived, t);
  hud.update({
    simYear: 1000,
    phase: 5,
    phaseReached: 5,
    progress: progress.progress,
    axes: progress.axes,
    derived,
    reservoirs: state.reservoirs,
    advice: { bottleneck: "nCO2", title: "", problem: "", action: "", lever: null, waiting: true, because: null },
    events: [],
    fresh: [],
    speed: 1,
    canSeed: false,
    canOrder: false,
    economy: null,
    notice: null,
    build: [],
    settlements: [],
    founding: null,
    seeded: false,
  });
  const row = [...root.querySelectorAll(".hud-metric")].find(
    (r) => r.querySelector(".hud-row-label")?.textContent === "Carbon dioxide",
  );
  const word = row?.querySelector(".hud-metric-status")?.textContent;
  if (word === undefined || word === null) throw new Error("no CO2 row in the HUD");
  return word === "safe" || word === "at target";
}

function feedSaysSafe(co2: number): boolean {
  const { state, derived } = world(co2);
  const log = new EventLog();
  const fresh = log.observe({ year: 1000, state, reservoirs: state.reservoirs, derived, phaseReached: 5, tuning: t });
  return fresh.some((e) => e.text.startsWith("Carbon dioxide is below"));
}

function adviceSaysSafe(co2: number): boolean {
  const { state, derived } = world(co2);
  const axes = computeProgress(state.reservoirs, derived, t).axes;
  const advice = advise({ state, reservoirs: state.reservoirs, derived, axes, tuning: t, dTdt: 0 });
  // Either the CO2 branch calls it safe, or the whole world is in band and the
  // guidance has moved on to "A living world" - which is also a verdict of safe.
  return advice.problem.includes("already under") || advice.title === "A living world";
}

describe("the CO2 ceiling, at the ceiling", () => {
  it("is a real edge for the simulation: exactly 10 fails the win, just under passes", () => {
    expect(simSaysSafe(EDGE)).toBe(false);
    expect(simSaysSafe(EDGE - 1e-9)).toBe(true);
  });

  it("reaches the CO2 branch of the guidance at all, or the advice check proves nothing", () => {
    const { state, derived } = world(EDGE);
    const axes = computeProgress(state.reservoirs, derived, t).axes;
    expect(advise({ state, reservoirs: state.reservoirs, derived, axes, tuning: t, dTdt: 0 }).bottleneck).toBe("nCO2");
  });

  for (const co2 of [EDGE, EDGE - 1e-9]) {
    it(`says the same thing everywhere at ${co2} mbar`, () => {
      const sim = simSaysSafe(co2);
      expect({ hud: hudSaysSafe(co2), feed: feedSaysSafe(co2), advice: adviceSaysSafe(co2) }).toEqual({
        hud: sim,
        feed: sim,
        advice: sim,
      });
    });
  }
});
