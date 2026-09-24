// @vitest-environment happy-dom

/**
 * The shell, and specifically the accessibility requirement.
 *
 * Batch 7 asks for a game "readable without relying on colour alone, since
 * colour *is* the progress signal here". That is not a style preference in
 * this project: §9's entire contract is a palette, the planet's whole arc is
 * rust to blue, and a player who cannot separate those needs every state the
 * UI knows to be available as words and numbers too.
 *
 * So the central test below strips nothing and mocks nothing - it renders the
 * HUD at three very different worlds and asserts that the TEXT alone
 * distinguishes them. A stylesheet cannot make that pass and cannot make it
 * fail.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { HudHooks, HudView } from "./hud.js";
import { Hud } from "./hud.js";
import type { Advice } from "./guidance.js";
import type { SimState } from "../sim/index.js";
import { DEFAULT_TUNING, NEUTRAL_ENV, computeProgress, derive, effectiveEnv, marsStart } from "../sim/index.js";
import { REFERENCE_POLICY } from "../harness/policy.js";
import { runTrajectory } from "../harness/run.js";

const t = DEFAULT_TUNING;

const NO_HOOKS: HudHooks = {
  onSpeed: () => undefined,
  onOrder: () => undefined,
  onSeed: () => undefined,
  onFocusLever: () => undefined,
  onToggleLever: () => undefined,
  onFound: () => undefined,
  onCancelFound: () => undefined,
  onOpenSettlement: () => undefined,
};

const ADVICE: Advice = {
  bottleneck: "nT",
  title: "Temperature",
  problem: "213 K, and not warming. Liquid water needs 273 K.",
  action: "Order orbital mirrors - the main early warming lever.",
  lever: "orbital_mirror",
  waiting: false,
  because: null,
};

/** A dead Mars, an in-between world and a finished one. */
function worldView(kind: "barren" | "middle" | "finished", overrides: Partial<HudView> = {}): HudView {
  const base = marsStart();
  const r =
    kind === "barren"
      ? base.reservoirs
      : kind === "middle"
        ? { ...base.reservoirs, o2: 40, biomass: 0.5, co2_atm: 250 }
        : { ...base.reservoirs, o2: 215, biomass: 0.9, co2_atm: 0.8 };
  const d0 = derive(base.reservoirs, NEUTRAL_ENV, t);
  const d =
    kind === "barren"
      ? d0
      : kind === "middle"
        ? { ...d0, T: 280, P: 400, oceanFrac: 0.2 }
        : { ...d0, T: 288, P: 1013, oceanFrac: 0.4 };

  return {
    simYear: 100,
    phase: 0,
    phaseReached: kind === "finished" ? 6 : kind === "middle" ? 3 : 0,
    progress: kind === "finished" ? 0.98 : kind === "middle" ? 0.45 : 0.1,
    axes: { nT: 0.1, nP: 0.1, nO2: 0, nWater: 0, nBio: 0, nCO2: 0.1 },
    derived: d,
    reservoirs: r,
    advice: ADVICE,
    events: [],
    fresh: [],
    speed: 1,
    canSeed: false,
    canOrder: true,
    economy: null,
    notice: null,
    build: [],
    settlements: [],
    founding: null,
    seeded: false,
    ...overrides,
  };
}

function mount(): { root: HTMLElement; hud: Hud } {
  const root = document.createElement("div");
  document.body.append(root);
  return { root, hud: new Hud(root, NO_HOOKS, t) };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("readable without colour", () => {
  /**
   * The load-bearing one. Render three worlds, take only the text, and
   * require them to differ. If state ever moves into colour alone, the three
   * renders converge and this fails.
   */
  it("says something different, in words, for three different worlds", () => {
    const texts = (["barren", "middle", "finished"] as const).map((kind) => {
      document.body.replaceChildren();
      const { root, hud } = mount();
      hud.update(worldView(kind));
      return root.textContent ?? "";
    });

    expect(new Set(texts).size, "different worlds rendered identical text").toBe(3);
    for (const text of texts) expect(text.length).toBeGreaterThan(50);
  });

  it("gives every metric a number and a status word, not a bar alone", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle"));

    const rows = root.querySelectorAll(".hud-metric");
    expect(rows.length).toBe(6);
    for (const row of rows) {
      const label = row.querySelector(".hud-row-label")?.textContent ?? "";
      const value = row.querySelector(".hud-row-value")?.textContent ?? "";
      const status = row.querySelector(".hud-metric-status")?.textContent ?? "";
      expect(label.length, "a metric row has no label").toBeGreaterThan(0);
      expect(value, `${label} has no printed value`).toMatch(/\d/);
      expect(status.length, `${label} has no status word`).toBeGreaterThan(0);
      expect(status, `${label}'s status is a placeholder`).not.toBe("-");
    }
  });

  /**
   * Anything that carries a `data-state` is styled by that state. Each one
   * must also SAY its state, or the styling is the only channel.
   */
  it("never lets data-state be the only carrier of meaning", () => {
    const seen = new Map<string, Set<string>>();
    for (const kind of ["barren", "middle", "finished"] as const) {
      document.body.replaceChildren();
      const { root, hud } = mount();
      hud.update(worldView(kind));
      for (const node of root.querySelectorAll("[data-state]")) {
        const state = node.getAttribute("data-state") ?? "";
        const text = (node.textContent ?? "").trim();
        expect(text.length, `an element in state "${state}" renders no text`).toBeGreaterThan(0);
        const bucket = seen.get(state) ?? new Set<string>();
        bucket.add(text);
        seen.set(state, bucket);
      }
    }
    expect(seen.size, "no stateful elements were rendered at all").toBeGreaterThan(1);

    // Two different states must not print the same words.
    const byText = new Map<string, string>();
    for (const [state, texts] of seen) {
      for (const text of texts) {
        const already = byText.get(text);
        expect(already === undefined || already === state, `states "${already}" and "${state}" both render "${text}"`).toBe(
          true,
        );
        byText.set(text, state);
      }
    }

    /**
     * And the words must actually vary with the world.
     *
     * Without this the check above is satisfied by printing one constant
     * word everywhere: one state, one text, no collision, and a colourblind
     * player learns nothing. Verified by injecting exactly that - a
     * `statusWord` that returns a fixed string - which passed the collision
     * check and is caught here.
     */
    expect(byText.size, "every state rendered the same words, so only colour separates them").toBeGreaterThanOrEqual(4);
  });

  it("puts every bar in the accessibility tree with a spoken value", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle"));

    const meters = root.querySelectorAll('[role="meter"]');
    expect(meters.length).toBe(7); // six metrics plus the composite
    for (const meter of meters) {
      expect(meter.getAttribute("aria-valuenow"), "meter without a value").toMatch(/[\d.]/);
      expect(meter.getAttribute("aria-valuemin")).not.toBeNull();
      expect(meter.getAttribute("aria-valuemax")).not.toBeNull();
      const spoken = meter.getAttribute("aria-valuetext") ?? "";
      expect(spoken.length, "meter without spoken text").toBeGreaterThan(0);
    }
  });

  it("marks the selected speed in the accessibility tree, not just visually", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle", { speed: 10 }));
    const pressed = [...root.querySelectorAll(".hud-speed")].filter(
      (b) => b.getAttribute("aria-pressed") === "true",
    );
    expect(pressed.length).toBe(1);
    expect(pressed[0]?.textContent).toBe("10x");
  });

  /**
   * Found by rendering the feed to text and reading it: the year and the
   * message were separated by a flex `gap`, which is invisible to anything
   * that consumes textContent. It looked right and read as "year 280Mean
   * temperature has passed".
   */
  it("separates feed fields with real text, not a CSS gap", () => {
    const { root, hud } = mount();
    hud.update(
      worldView("middle", {
        events: [{ year: 280, text: "Mean temperature has passed 273 K.", tone: "milestone", headline: false }],
      }),
    );
    const text = root.querySelector(".hud-feed-item")?.textContent ?? "";
    expect(text).toMatch(/year 280\s+Mean temperature/);
  });

  it("prints the word 'warning' on a warning, rather than only colouring it", () => {
    const { root, hud } = mount();
    hud.update(
      worldView("middle", {
        events: [{ year: 900, text: "Oceans cover 80% - past the top of the band.", tone: "warning", headline: false }],
      }),
    );
    const item = root.querySelector('.hud-feed-item[data-tone="warning"]');
    expect(item).not.toBeNull();
    expect(item?.textContent ?? "").toMatch(/warning/i);
  });
});

describe("the shell tells the player where they are", () => {
  it("names the phase and describes it", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle"));
    expect(root.querySelector(".hud-phase-index")?.textContent).toBe("Phase 3");
    expect(root.querySelector(".hud-phase-name")?.textContent).toBe("First water");
    expect((root.querySelector(".hud-phase-caption")?.textContent ?? "").length).toBeGreaterThan(20);
  });

  it("shows the advice with its state and its action", () => {
    const { root, hud } = mount();
    hud.update(worldView("barren"));
    expect(root.querySelector(".hud-advice-title")?.textContent).toBe("Temperature");
    expect(root.querySelector(".hud-advice-action")?.textContent).toMatch(/orbital mirrors/);
    expect(root.querySelector(".hud-advice-state")?.textContent).toBe("needs you");
  });

  it("says 'in progress' rather than inventing a task when there is nothing to do", () => {
    const { root, hud } = mount();
    hud.update(
      worldView("middle", {
        advice: { ...ADVICE, waiting: true, lever: null, action: "The biosphere is fixing it." },
      }),
    );
    expect(root.querySelector(".hud-advice-state")?.textContent).toBe("in progress");
    expect((root.querySelector(".hud-advice-button") as HTMLButtonElement | null)?.hidden).toBe(true);
  });

  /** The shell must never offer a button the simulation would refuse. */
  it("hides the seed button until the simulation would accept it", () => {
    const seedAdvice: Advice = { ...ADVICE, lever: "biosphere_seeding", title: "Seed the biosphere" };
    const { root, hud } = mount();

    hud.update(worldView("middle", { advice: seedAdvice, canSeed: false }));
    expect((root.querySelector(".hud-advice-button") as HTMLButtonElement).hidden).toBe(true);

    hud.update(worldView("middle", { advice: seedAdvice, canSeed: true }));
    const button = root.querySelector(".hud-advice-button") as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe("Seed the biosphere");
  });

  it("raises a banner for a headline event and not for an ordinary one", () => {
    const { root, hud } = mount();
    const banner = () => root.querySelector(".hud-banner") as HTMLElement;

    hud.update(worldView("middle"));
    expect(banner().hidden).toBe(true);

    hud.update(
      worldView("middle", {
        fresh: [{ year: 300, text: "Phase 2: Runaway thickening.", tone: "milestone", headline: true }],
      }),
    );
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toMatch(/Runaway thickening/);
  });

  it("appends to the log without redrawing it, newest first", () => {
    const { root, hud } = mount();
    const a = { year: 10, text: "first", tone: "note" as const, headline: false };
    const b = { year: 20, text: "second", tone: "note" as const, headline: false };

    hud.update(worldView("middle", { events: [a] }));
    const firstNode = root.querySelector(".hud-feed-item");

    hud.update(worldView("middle", { events: [b, a] }));
    const items = [...root.querySelectorAll(".hud-feed-item")];
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toMatch(/second/);
    // The original node is still the same object - the list was appended to,
    // not rebuilt, which is what keeps this cheap at READOUT_HZ.
    expect(items[1]).toBe(firstNode);
  });

  it("empties the log on clear, for a reset planet", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle", { events: [{ year: 5, text: "x", tone: "note", headline: false }] }));
    expect(root.querySelectorAll(".hud-feed-item").length).toBe(1);
    hud.clear();
    expect(root.querySelectorAll(".hud-feed-item").length).toBe(0);
  });
});

describe("the target bands match section 2.3", () => {
  it("reads CO2 backwards, because lower is better there", () => {
    const { root, hud } = mount();
    hud.update(worldView("finished"));
    const rows = [...root.querySelectorAll(".hud-metric")];
    const co2 = rows.find((r) => r.querySelector(".hud-row-label")?.textContent === "Carbon dioxide");
    expect(co2).toBeDefined();
    // 0.8 mbar is *good*. A naive bar would call a near-empty row a failure.
    expect(co2?.querySelector(".hud-metric-status")?.textContent).toBe("at target");
  });

  it("calls a dead Mars what it is on every axis", () => {
    const { root, hud } = mount();
    hud.update(worldView("barren"));
    const statuses = [...root.querySelectorAll(".hud-metric-status")].map((n) => n.textContent);
    expect(statuses.filter((s) => s === "below minimum").length).toBeGreaterThanOrEqual(4);
  });

  it("calls a finished world finished", () => {
    const { root, hud } = mount();
    hud.update(worldView("finished"));
    const statuses = [...root.querySelectorAll(".hud-metric-status")].map((n) => n.textContent);
    expect(statuses.every((s) => s === "at target" || s === "habitable" || s === "safe")).toBe(true);
  });
});

/**
 * Batch 11: the bar and the win disagree, and the shell has to say so.
 *
 * Built from REAL states off the reference playthrough, not a fixture. The
 * old "finished" fixture above reads 0.98 - a number the real game never shows
 * on the day it is won, which is how the 87% problem sat unnoticed in the
 * shell's own tests for four batches.
 */
describe("the shell does not contradict itself at victory (Batch 11)", () => {
  function viewOf(state: SimState, year: number): HudView {
    const d = derive(state.reservoirs, effectiveEnv(NEUTRAL_ENV, state.facilities, t), t);
    const progress = computeProgress(state.reservoirs, d, t);
    return worldView("finished", {
      simYear: year,
      phaseReached: state.phaseReached,
      progress: progress.progress,
      axes: progress.axes,
      derived: d,
      reservoirs: state.reservoirs,
    });
  }
  // Read off the run, not hardcoded. Batch 11 wrote 1710 and 1600 in here, and
  // Batch 12's rebalance experiment moved the win to 1534 - at which point
  // both tests were asserting about a world the run no longer passes through.
  const winYear = runTrajectory(REFERENCE_POLICY, 2400, 2, t).phaseTimes[6];
  if (winYear === null || winYear === undefined) throw new Error("the reference run never wins");
  /** About a century short of the win, where CO2 is the last row still out of band. */
  const nearlyYear = winYear - 110;
  const won = runTrajectory(REFERENCE_POLICY, winYear, 2, t).finalState;
  const nearly = runTrajectory(REFERENCE_POLICY, nearlyYear, 2, t).finalState;

  it("is testing the situation it claims to: the bar really is well short of full on the winning year", () => {
    const view = viewOf(won, winYear);
    expect(view.phaseReached).toBe(6);
    expect(view.progress).toBeLessThan(0.9);
  });

  it("says the world is won, and does not call the bar 'terraformed'", () => {
    const { root, hud } = mount();
    hud.update(viewOf(won, winYear));
    const living = root.querySelector(".hud-living")?.textContent ?? "";
    expect(living).toMatch(/Living world reached/);
    expect(living).toMatch(/all 6 minimums met/);
    const meter = root.querySelector(".hud-progress [role=meter]");
    expect(meter?.getAttribute("aria-valuetext")).toMatch(/Earth-like/);
    expect(meter?.getAttribute("aria-valuetext")).not.toMatch(/terraformed/);
  });

  it("names exactly what is still missing before the win", () => {
    const { root, hud } = mount();
    const view = viewOf(nearly, nearlyYear);
    expect(view.phaseReached).toBeLessThan(6);
    hud.update(view);
    // A century short of the win the reference world has 26 mbar of CO2 against a 10 mbar
    // toxicity ceiling, and every other row is already in band.
    expect(nearly.reservoirs.co2_atm).toBeGreaterThan(10);
    expect(root.querySelector(".hud-living")?.textContent).toBe(
      "Living world: 5 of 6 minimums met - still short on carbon dioxide.",
    );
  });
});

describe("the economy in the shell (Batch 9)", () => {
  it("shows nothing at all when the economy is off", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle", { economy: null }));
    expect((root.querySelector(".hud-bank") as HTMLElement).hidden).toBe(true);
  });

  it("shows the balance and the net rate when it is on", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle", { economy: { credits: 12345.7, income: 200, upkeep: 60 } }));
    const bank = root.querySelector(".hud-bank") as HTMLElement;
    expect(bank.hidden).toBe(false);
    expect(bank.textContent).toMatch(/12,?345/);
    expect(bank.textContent).toMatch(/\+140/);
  });

  /**
   * The same rule as everything else in this shell: colour reinforces, it
   * never carries. A player who cannot see the red must still read the minus.
   */
  it("puts the sign in the text, not only in the colour", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle", { economy: { credits: 500, income: 20, upkeep: 90 } }));
    const bank = root.querySelector(".hud-bank") as HTMLElement;
    expect(bank.textContent).toMatch(/-70/);
    expect(bank.dataset["state"]).toBe("losing");
  });

  it("reports a refused order instead of silently doing nothing", () => {
    const { root, hud } = mount();
    const notice = () => root.querySelector(".hud-notice") as HTMLElement;

    hud.update(worldView("middle"));
    expect(notice().hidden).toBe(true);

    hud.update(worldView("middle", { notice: "Cannot order: needs 900 credits, 120 available" }));
    expect(notice().hidden).toBe(false);
    expect(notice().textContent).toMatch(/900 credits/);
  });
});

describe("the shell never offers a button the sim would refuse (Batch 10)", () => {
  const orderAdvice: Advice = { ...ADVICE, lever: "nitrogen_import", title: "Atmospheric pressure" };

  it("hides the order button when the order would be refused", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle", { advice: orderAdvice, canOrder: false }));
    expect((root.querySelector(".hud-advice-button") as HTMLButtonElement).hidden).toBe(true);
  });

  it("shows it when the order would succeed", () => {
    const { root, hud } = mount();
    hud.update(worldView("middle", { advice: orderAdvice, canOrder: true }));
    const button = root.querySelector(".hud-advice-button") as HTMLButtonElement;
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe("Order one");
  });

  /**
   * `canSeed` and `canOrder` are separate questions and must not be crossed:
   * seeding has its own gate, and for a whole batch `canSeed` was the only one
   * the shell asked - so once costs existed it offered "Order one" for a lever
   * there was no money for.
   */
  it("keeps the seed gate and the order gate independent", () => {
    const seedAdvice: Advice = { ...ADVICE, lever: "biosphere_seeding", title: "Seed the biosphere" };
    const { root, hud } = mount();

    hud.update(worldView("middle", { advice: seedAdvice, canSeed: true, canOrder: false }));
    expect((root.querySelector(".hud-advice-button") as HTMLButtonElement).hidden).toBe(false);

    hud.update(worldView("middle", { advice: seedAdvice, canSeed: false, canOrder: true }));
    expect((root.querySelector(".hud-advice-button") as HTMLButtonElement).hidden).toBe(true);
  });
});
