// @vitest-environment happy-dom

/**
 * The build panel (Batch 16), tested through the real HUD.
 *
 * The oracle is the WORLD, not the panel's own bookkeeping: a click goes
 * through the same `orderDelta` main.ts uses, and the test looks at what
 * happened to the planet's facilities. A panel that offered a button the
 * simulation then refused - Batch 10's first finding - or that sent the click
 * to the wrong lever, fails here.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { FacilityType, SimState, Tuning } from "../sim/index.js";
import {
  FACILITY_LIST,
  NEUTRAL_ENV,
  TECH,
  computeProgress,
  derive,
  facilityOf,
  makeTuning,
  marsStart,
  orderCost,
  setFacilityEnabled,
} from "../sim/index.js";
import { buildRows, orderDelta } from "./build.js";
import type { HudView } from "./hud.js";
import { Hud } from "./hud.js";

const BROWSER = makeTuning({ EVENTS_ENABLED: 1, ECONOMY_ENABLED: 1, TECH_GATE_ENABLED: 1 });
const OFF = makeTuning();

/** A HUD wired to a world the test owns, the way main.ts wires it to the game. */
function mount(start: SimState, tuning: Tuning) {
  let world = start;
  const focused: FacilityType[] = [];
  const root = document.createElement("div");
  document.body.append(root);
  const hud = new Hud(
    root,
    {
      onSpeed: () => undefined,
      onOrder: (type, delta) => {
        const outcome = orderDelta(world, type, delta, tuning);
        world = outcome.state;
      },
      onToggleLever: (type) => {
        const f = facilityOf(world, type);
        if (f !== undefined) world = setFacilityEnabled(world, type, !f.enabled);
      },
      onSeed: () => undefined,
      onFocusLever: (type) => focused.push(type),
      onFound: () => undefined,
      onCancelFound: () => undefined,
      onOpenSettlement: () => undefined,
    },
    tuning,
  );
  const render = (): void => {
    const d = derive(world.reservoirs, NEUTRAL_ENV, tuning);
    const p = computeProgress(world.reservoirs, d, tuning);
    const view: HudView = {
      simYear: 0,
      phase: world.phaseReached,
      phaseReached: world.phaseReached,
      progress: p.progress,
      axes: p.axes,
      derived: d,
      reservoirs: world.reservoirs,
      advice: { bottleneck: "nT", title: "", problem: "", action: "", lever: null, waiting: true, because: null },
      events: [],
      fresh: [],
      speed: 1,
      canSeed: false,
      canOrder: false,
      economy: tuning.ECONOMY_ENABLED ? { credits: world.economy.credits, income: 0, upkeep: 0 } : null,
      notice: null,
      build: buildRows(world, tuning),
      seeded: world.seeded,
      settlements: world.settlements,
      founding: null,
    };
    hud.update(view);
  };
  render();
  const row = (type: string): HTMLElement => {
    const r = root.querySelector<HTMLElement>(`.hud-lever[data-lever="${type}"]`);
    if (r === null) throw new Error(`no build row for ${type}`);
    return r;
  };
  const button = (type: string, cls: string): HTMLButtonElement => {
    const b = row(type).querySelector<HTMLButtonElement>(cls);
    if (b === null) throw new Error(`no ${cls} in ${type}`);
    return b;
  };
  return { root, hud, render, row, button, world: () => world, focused };
}

const LEVERS = FACILITY_LIST.filter((d) => d.kind !== "action").map((d) => d.type);

/** Four real situations: the opening, a world at the money margin, a rich one, and the economy off. */
function scenarios(): { name: string; start: SimState; tuning: Tuning; mixed: boolean }[] {
  const base = marsStart();
  const rich: SimState = {
    ...base,
    economy: { ...base.economy, credits: 1_000_000 },
    techUnlocked: TECH.map((tech) => tech.id),
  };
  // Exactly the price of one level-1 mirror and not a credit more: the margin
  // where a dry run priced even slightly wrong gives the wrong answer. Without
  // this scenario a dry run at the wrong LEVEL passed every test (Batch 16).
  const exact: SimState = {
    ...base,
    economy: { ...base.economy, credits: orderCost("orbital_mirror", 0, 1, 1, BROWSER) },
  };
  return [
    { name: "browser opening (economy and tech on)", start: base, tuning: BROWSER, mixed: true },
    { name: "exactly enough for one mirror", start: exact, tuning: BROWSER, mixed: true },
    { name: "rich, everything unlocked", start: rich, tuning: BROWSER, mixed: false },
    { name: "economy off", start: base, tuning: OFF, mixed: false },
  ];
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the build panel lists every lever", () => {
  it("has exactly one row per buildable lever, plus seeding", () => {
    const page = mount(marsStart(), BROWSER);
    const rows = [...page.root.querySelectorAll<HTMLElement>(".hud-lever")].map((r) => r.dataset["lever"]);
    expect(rows.sort()).toEqual([...LEVERS, "biosphere_seeding"].sort());
  });
});

describe("a +1 the panel offers is an order the simulation accepts", () => {
  for (const s of scenarios()) {
    it(`${s.name}: every enabled +1 grows that lever, every disabled one says why`, () => {
      let enabled = 0;
      let disabled = 0;
      for (const type of LEVERS) {
        const page = mount(s.start, s.tuning);
        const more = page.button(type, ".hud-lever-more");
        const before = facilityOf(page.world(), type)?.count ?? 0;
        if (!more.disabled) {
          enabled += 1;
          more.click();
          expect(facilityOf(page.world(), type)?.count, `${type}: the click did not order it`).toBe(before + 1);
        } else {
          disabled += 1;
          const reason = page.row(type).querySelector(".hud-lever-reason");
          expect(reason?.textContent ?? "", `${type} is refused without a reason`).toMatch(/^Cannot order: .+/);
          // And the simulation really would refuse it.
          expect(orderDelta(page.world(), type, 1, s.tuning).ok, `${type} was greyed out but would go through`).toBe(false);
        }
      }
      // Guard against a vacuous pass: the opening world must exercise both.
      expect(enabled, "no lever could be ordered").toBeGreaterThan(0);
      if (s.mixed) expect(disabled, "no lever was refused, so the refusal path was never checked").toBeGreaterThan(0);
      else expect(disabled).toBe(0);
    });
  }
});

describe("the rest of a row", () => {
  it("shows the price on the button when the economy is on, and none when it is off", () => {
    expect(mount(marsStart(), BROWSER).button("orbital_mirror", ".hud-lever-more").textContent).toMatch(/^\+1 - [\d,]+ cr$/);
    expect(mount(marsStart(), OFF).button("orbital_mirror", ".hud-lever-more").textContent).toBe("+1");
  });

  it("cannot dismantle or switch off what has not been ordered, and can once it has", () => {
    const page = mount(marsStart(), OFF);
    expect(page.button("orbital_mirror", ".hud-lever-less").disabled).toBe(true);
    expect(page.button("orbital_mirror", ".hud-lever-toggle").disabled).toBe(true);
    page.button("orbital_mirror", ".hud-lever-more").click();
    page.button("orbital_mirror", ".hud-lever-more").click();
    page.render();
    expect(page.button("orbital_mirror", ".hud-lever-less").disabled).toBe(false);
    page.button("orbital_mirror", ".hud-lever-less").click();
    expect(facilityOf(page.world(), "orbital_mirror")?.count).toBe(1);
  });

  it("switches a lever off and says so in words, not only in style", () => {
    const page = mount(marsStart(), OFF);
    page.button("solar_shade", ".hud-lever-more").click();
    page.render();
    page.button("solar_shade", ".hud-lever-toggle").click();
    page.render();
    expect(facilityOf(page.world(), "solar_shade")?.enabled).toBe(false);
    expect(page.row("solar_shade").querySelector(".hud-lever-status")?.textContent).toMatch(/^switched off/);
    const toggle = page.button("solar_shade", ".hud-lever-toggle");
    expect(toggle.textContent).toBe("Switch on");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("reports what is ordered and what is actually online, which differ while it ramps", () => {
    const page = mount(marsStart(), OFF);
    page.button("orbital_mirror", ".hud-lever-more").click();
    page.render();
    expect(page.row("orbital_mirror").querySelector(".hud-lever-status")?.textContent).toBe("0 of 1 units online");
  });

  it("brings the advised lever into view when the advice asks for it", () => {
    const page = mount(marsStart(), OFF);
    page.hud.focusLever("nitrogen_import");
    expect(page.row("nitrogen_import").classList.contains("focused")).toBe(true);
    expect(page.row("orbital_mirror").classList.contains("focused")).toBe(false);
  });
});
