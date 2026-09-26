// @vitest-environment happy-dom

/**
 * The flood warning in the orbit HUD (Batch 25, detail §4.4): "submersion
 * begins in ~14 yr, total loss in ~31 yr at current rate" - in words, on the
 * threatened settlement's row, counting down as the sea comes.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { SimState } from "../sim/index.js";
import { NEUTRAL_ENV, advance, computeProgress, derive, liquidWaterRate, makeTuning, nextSubstepFlows } from "../sim/index.js";
import { channels, fixture, rising, t } from "../testkit/flood.js";
import { floodWarnings } from "./flood-warning.js";
import type { HudView } from "./hud.js";
import { Hud } from "./hud.js";

const START = fixture();
const warningsOf = (s: SimState, tuning = t): Map<string, string> =>
  floodWarnings(s, channels(s), liquidWaterRate(nextSubstepFlows(s, rising)), tuning);

function mount() {
  const root = document.createElement("div");
  document.body.append(root);
  const none = (): undefined => undefined;
  const hud = new Hud(
    root,
    { onSpeed: none, onOrder: none, onToggleLever: none, onSeed: none, onFocusLever: none, onFound: none, onCancelFound: none, onOpenSettlement: none, onWorldMap: none },
    t,
  );
  const show = (state: SimState, floodWarnings: ReadonlyMap<string, string>): void => {
    const d = derive(state.reservoirs, NEUTRAL_ENV, t);
    const p = computeProgress(state.reservoirs, d, t);
    const view: HudView = {
      simYear: 0,
      phase: 0,
      phaseReached: 0,
      progress: p.progress,
      axes: p.axes,
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
      floodWarnings,
      founding: null,
    };
    hud.update(view);
  };
  const rows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".hud-settlement")];
  const line = (i: number): HTMLElement => rows()[i]!.querySelector<HTMLElement>(".hud-settlement-flood")!;
  return { show, rows, line };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the flood warning, in words", () => {
  it("warns the low city when submersion begins and when it is lost, and says nothing of the high one", () => {
    // Measured (flood-forecast.test.ts): the low city's base goes under in 5.4 sim-years, and it is lost in 8.9;
    // the high city is 115 years off - past FLOOD_ALERT_YEARS.
    const w = warningsOf(START);
    expect(w.get("settlement-1")).toBe("Flood warning: submersion begins in ~5 yr, total loss in ~9 yr at current rate.");
    expect(w.has("settlement-2")).toBe(false);
    const m = mount();
    m.show(START, w);
    expect(m.line(0).hidden).toBe(false);
    expect(m.line(0).textContent).toBe(w.get("settlement-1"));
    expect(m.rows()[0]!.hasAttribute("data-flood")).toBe(true);
    expect(m.line(1).hidden).toBe(true);
    expect(m.rows()[1]!.hasAttribute("data-flood")).toBe(false);
  });

  it("counts down on the same row as the sea comes, then says the city is under water", () => {
    const m = mount();
    m.show(START, warningsOf(START));
    const row = m.rows()[0]!;
    let s = START;
    for (let i = 0; i < 12; i += 1) s = advance(s, 1, rising);
    m.show(s, warningsOf(s));
    // Three years on, the same row, not a new one (a rebuilt list loses a click in flight).
    expect(m.rows()[0]).toBe(row);
    expect(m.line(0).textContent).toBe("Flood warning: submersion begins in ~2 yr, total loss in ~6 yr at current rate.");
    for (let i = 0; i < 14; i += 1) s = advance(s, 1, rising);
    m.show(s, warningsOf(s));
    // Substep 26: the base under water, the city lost at substep 35.7 - 2.4 sim-years on.
    expect(m.line(0).textContent).toBe("Flooding: under water, total loss in ~2 yr at current rate.");
  });

  it("shows no warning with flooding off, whatever the sea does", () => {
    const off = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    expect(warningsOf(START, off).size).toBe(0);
    const m = mount();
    m.show(START, warningsOf(START, off));
    expect(m.rows().length, "vacuity: rows to warn on").toBe(2);
    for (let i = 0; i < 2; i += 1) expect(m.line(i).hidden).toBe(true);
  });
});
