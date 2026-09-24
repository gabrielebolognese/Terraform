// @vitest-environment happy-dom

/**
 * Founding from the HUD (Batch 17), through the real component: the buttons
 * start founding, the prompt tells the player what to do and how to back out,
 * and the list says in words where every settlement is.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { SettlementKind, SimState } from "../sim/index.js";
import { DEFAULT_TUNING, NEUTRAL_ENV, computeProgress, derive, foundSettlement, marsStart } from "../sim/index.js";
import type { HudView } from "./hud.js";
import { Hud } from "./hud.js";

const t = DEFAULT_TUNING;

function mount() {
  const calls: string[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const hud = new Hud(
    root,
    {
      onSpeed: () => undefined,
      onOrder: () => undefined,
      onToggleLever: () => undefined,
      onSeed: () => undefined,
      onFocusLever: () => undefined,
      onFound: (kind) => calls.push(`found:${kind}`),
      onCancelFound: () => calls.push("cancel"),
      onOpenSettlement: (id) => calls.push(`open:${id}`),
    },
    t,
  );
  const show = (state: SimState, founding: SettlementKind | null): void => {
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
      founding,
    };
    hud.update(view);
  };
  const q = <T extends Element>(sel: string): T => {
    const e = root.querySelector<T>(sel);
    if (e === null) throw new Error(`missing ${sel}`);
    return e;
  };
  return { root, hud, calls, show, q };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("founding a settlement from the HUD", () => {
  it("starts founding a city or an outpost from its button", () => {
    const page = mount();
    page.show(marsStart(), null);
    const [city, outpost] = [...page.root.querySelectorAll<HTMLButtonElement>(".hud-found")];
    city!.click();
    outpost!.click();
    expect(page.calls).toEqual(["found:city", "found:outpost"]);
  });

  it("tells the player what to do while choosing a site, and how to back out", () => {
    const page = mount();
    page.show(marsStart(), "outpost");
    const prompt = page.q<HTMLElement>(".hud-found-prompt");
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toMatch(/Click the planet where the new outpost should stand/);
    // No second founding can be started while one is being placed.
    for (const b of page.root.querySelectorAll<HTMLButtonElement>(".hud-found")) expect(b.disabled).toBe(true);
    page.q<HTMLButtonElement>(".hud-found-cancel").click();
    expect(page.calls).toEqual(["cancel"]);
  });

  it("hides the prompt when not founding", () => {
    const page = mount();
    page.show(marsStart(), null);
    expect(page.q<HTMLElement>(".hud-found-prompt").hidden).toBe(true);
  });

  it("lists every settlement by name and place, in words", () => {
    const page = mount();
    page.show(marsStart(), null);
    expect(page.q(".hud-settlement-list").textContent).toMatch(/None yet/);
    let s = foundSettlement(marsStart(), "city", -0.72, 1.31).state;
    s = foundSettlement(s, "outpost", 1.34, -0.1).state;
    page.show(s, null);
    const rows = [...page.root.querySelectorAll(".hud-settlement-text")].map((r) => r.textContent);
    expect(rows).toEqual(["City 141.3°S 75.1°E", "Outpost 276.8°N 5.7°W"]);
  });

  it("opens each settlement's own city view from its row (Batch 20)", () => {
    const page = mount();
    let s = foundSettlement(marsStart(), "city", -0.72, 1.31).state;
    s = foundSettlement(s, "outpost", 1.34, -0.1).state;
    page.show(s, null);
    const open = [...page.root.querySelectorAll<HTMLButtonElement>(".hud-settlement-open")];
    // Named for a screen reader, not just "Open" twice.
    expect(open.map((b) => b.getAttribute("aria-label"))).toEqual(["Open City 1", "Open Outpost 2"]);
    open[1]!.click();
    open[0]!.click();
    expect(page.calls).toEqual(["open:settlement-2", "open:settlement-1"]);
  });

  it("keeps the same Cancel button across readouts, so keyboard focus survives", () => {
    const page = mount();
    page.show(marsStart(), "city");
    const first = page.q(".hud-found-cancel");
    page.show(marsStart(), "city");
    expect(page.q(".hud-found-cancel")).toBe(first);
  });
});
