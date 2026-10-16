// @vitest-environment happy-dom

/**
 * Batch 33 on screen, through the real components: the event card shows
 * what is waiting, with each choice's cost and outcome and the default;
 * a choice is taken through the simulation and refused, with the reason,
 * when the world cannot pay; the alerts interrupt as an event opens and
 * record what it did; the alert centre keeps the world's event history;
 * the city says what an event left on it.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { OpenDecision, SimState } from "../sim/index.js";
import { BUILDING_DEFS, NEUTRAL_ENV, advance, cardFor, chooseDecision, cityYearsFor, foundSettlement, habitat, derive, marsStart, placeBuilding, worldEnv } from "../sim/index.js";
import { AlertWatch } from "./alerts.js";
import { AlertCentre } from "./alert-centre.js";
import { DecisionPanel } from "./decisions.js";
import { historyLines, outcomeWords } from "./decision-words.js";
import { startGame } from "./game.js";
import type { GameHandle } from "./game.js";
import { worldTuning } from "./game-tuning.js";
import { effectWords } from "./city.js";

const T = worldTuning("standard", 0, "standard");
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };

afterEach(() => {
  document.body.replaceChildren();
});

/** Ares, founded, with a Solar Array built and 300 credits in the bank. */
function ares(): SimState {
  let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
  s = { ...s, economy: { ...s.economy, credits: 300 }, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 300 } })) };
  for (let r = 4; r < 30; r += 1) {
    const o = placeBuilding(s, "settlement-1", "solar_array", 40 + r, 40, T);
    if (o.ok) {
      s = o.state;
      break;
    }
  }
  for (let i = 0; i < 40 && s.settlements[0]!.jobs.length > 0; i += 1) s = advance(s, 1, cfg);
  // People enough for an outbreak (the card is dealt on the city as it stands).
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 250 })) };
}

function withEvent(s: SimState, kind: OpenDecision["kind"], variant: OpenDecision["variant"] = null): { s: SimState; e: OpenDecision } {
  const e = cardFor(s, 3, kind, variant, s.settlements[0]!, s.steps, T);
  if (e === null) throw new Error(`no ${kind} in Ares`);
  return { s: { ...s, decisions: { open: [e], log: [] } }, e };
}

describe("the event card", () => {
  function mount(state: SimState) {
    const host = document.createElement("div");
    document.body.append(host);
    let current = state;
    const chosen: string[] = [];
    const went: unknown[] = [];
    const panel = new DecisionPanel(
      host,
      T,
      (id, choice) => {
        chosen.push(choice);
        const out = chooseDecision(current, id, choice, T);
        current = out.state;
        return { ok: out.ok, reason: out.reason };
      },
      (target) => went.push(target),
    );
    return { host, panel, chosen, went, now: () => current };
  }

  it("shows what is waiting: where, the countdown, each choice with its cost and outcome, and the default", () => {
    const { s } = withEvent(ares(), "meteor");
    const { host, panel } = mount(s);
    panel.update(s, 1);
    expect(panel.root.hidden).toBe(false);
    expect(host.querySelector(".decision-count")!.textContent).toBe("An event needs your decision");
    expect(host.querySelector(".decision-title")!.textContent).toBe("Meteor shower in Ares");
    // 22 substeps of 8.3 s: 183.3 s at 1x, rounded up; a third of it at 3x.
    expect(host.querySelector(".decision-clock")!.textContent).toBe("Decide within 3 min 4 s");
    panel.update(s, 3);
    expect(host.querySelector(".decision-clock")!.textContent).toBe("Decide within 1 min 2 s");
    const choices = [...host.querySelectorAll(".decision-choice")].map((b) => [b.querySelector(".decision-choice-title")!.textContent, b.querySelector(".decision-choice-cost")!.textContent]);
    expect(choices).toEqual([
      ["Take shelter", "Free"],
      ["Raise the shields", "150 credits"],
      ["Keep working", "Free"],
    ]);
    expect(host.querySelector(".decision-default")!.textContent).toBe("If you do nothing: The city is caught unprepared: 6 hits, the 3 of keeping working and as many more.");
  });

  it("takes a choice through the simulation, and shows it decided", () => {
    const { s } = withEvent(ares(), "meteor");
    const { host, panel, now } = mount(s);
    panel.update(s, 1);
    host.querySelector<HTMLButtonElement>('.decision-choice[data-choice="shields"]')!.click();
    expect(now().decisions.open[0]!.chosen).toBe("shields");
    expect(now().economy.credits).toBe(s.economy.credits - T.METEOR_SHIELD_CREDITS);
    panel.update(now(), 1);
    expect(host.querySelectorAll(".decision-choice").length).toBe(0);
    expect(host.querySelector(".decision-chosen")!.textContent).toBe("Decided: Raise the shields. Nothing is hit, and work goes on.");
    expect(host.querySelector(".decision-clock")!.textContent).toBe("Happens in 3 min 4 s");
    expect(host.querySelector(".decision-count")!.textContent).toBe("An event decided, waiting to happen");
  });

  it("shows a choice the world cannot pay for, disabled, with the reason", () => {
    const { s } = withEvent(ares(), "outbreak");
    const poor = { ...s, economy: { ...s.economy, credits: 10 } };
    const { host, panel, chosen } = mount(poor);
    panel.update(poor, 1);
    const treat = host.querySelector<HTMLButtonElement>('.decision-choice[data-choice="treat"]')!;
    expect(treat.disabled).toBe(true);
    expect(treat.querySelector(".decision-choice-why")!.textContent).toMatch(/^Cannot: it needs \d+ credits; the bank holds 10\.$/);
    expect(host.querySelector<HTMLButtonElement>('.decision-choice[data-choice="quarantine"]')!.disabled).toBe(false);
    treat.click();
    expect(chosen).toEqual([]);
  });

  it("goes to the city, and to the building an equipment failure is about", () => {
    const { s, e } = withEvent(ares(), "failure");
    const { host, panel, went } = mount(s);
    panel.update(s, 1);
    expect(host.querySelector(".decision-title")!.textContent).toBe(`${BUILDING_DEFS[e.building!].name} failing in Ares`);
    host.querySelector<HTMLButtonElement>(".decision-go")!.click();
    expect(went).toEqual([{ kind: "city", id: "settlement-1", at: e.at }]);
    expect(e.at).not.toBeNull();
  });

  it("hides with no event open, and folds away on request", () => {
    const { s } = withEvent(ares(), "discovery", "ice");
    const { host, panel } = mount(s);
    panel.update({ ...s, decisions: { open: [], log: [] } }, 1);
    expect(panel.root.hidden).toBe(true);
    panel.update(s, 1);
    host.querySelector<HTMLButtonElement>(".decision-fold")!.click();
    panel.update(s, 1);
    expect(host.querySelector<HTMLElement>(".decision-list")!.hidden).toBe(true);
    expect(host.querySelector(".decision-fold")!.textContent).toBe("Show");
  });
});

describe("the alerts and the history", () => {
  const env = (s: SimState) => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);
  const look = (w: AlertWatch, s: SimState, now: number) => w.observe({ state: s, env: env(s), liquidRatePerYear: 0, tuning: T, now });

  it("interrupts as an event opens, holds it in Now until it is answered, and records what it did", () => {
    const base = ares();
    const w = new AlertWatch();
    look(w, base, 0);
    const { s, e } = withEvent(base, "meteor");
    const opened = look(w, s, 1000);
    const fresh = opened.fresh.filter((a) => a.kind === "decision");
    expect(fresh.map((a) => [a.priority, a.title])).toEqual([["urgent", "Meteor shower in Ares"]]);
    expect(fresh[0]!.text).toMatch(/Decide within 3 min 4 s\.$/);
    expect(opened.now.some((a) => a.key === `decision:${e.id}`)).toBe(true);
    // Answered: no longer waiting on the player.
    const answered = chooseDecision(s, e.id, "work", T).state;
    expect(look(w, answered, 2000).now.some((a) => a.kind === "decision")).toBe(false);
    // Resolved at its deadline: the record says what was chosen and what it did.
    const done = advance(answered, e.deadline - e.opened, cfg);
    expect(done.decisions.log.length).toBe(1);
    const recorded = look(w, done, 3000).fresh.filter((a) => a.kind === "resolved");
    expect(recorded.map((a) => [a.priority, a.title])).toEqual([["record", "Meteor shower in Ares"]]);
    expect(recorded[0]!.text).toBe(outcomeWords(done.decisions.log[0]!, T));
    expect(recorded[0]!.text).toMatch(/^Kept working: \d+ buildings? hit/);
    // Once only.
    expect(look(w, done, 4000).fresh.filter((a) => a.kind === "resolved")).toEqual([]);
  });

  it("says, as a notice, when nothing was chosen", () => {
    const base = ares();
    const w = new AlertWatch();
    look(w, base, 0);
    const { s, e } = withEvent(base, "discovery", "meteorite");
    look(w, s, 1000);
    const done = advance(s, e.deadline - e.opened, cfg);
    const recorded = look(w, done, 2000).fresh.filter((a) => a.kind === "resolved");
    expect(recorded.map((a) => [a.priority, a.title, a.text])).toEqual([["notice", "A discovery in Ares", "Nothing was chosen: the find was left where it lay."]]);
  });

  it("lists the world's event history in the alert centre, newest first, kept in the world", () => {
    let s = ares();
    for (const [kind, choice] of [["discovery", "sell"], ["ship", null]] as const) {
      const e = cardFor(s, s.steps, kind, kind === "ship" ? "late" : "ice", s.settlements[0]!, s.steps, T)!;
      s = { ...s, decisions: { ...s.decisions, open: [e] } };
      if (choice !== null) s = chooseDecision(s, e.id, choice, T).state;
      s = advance(s, e.deadline - e.opened, cfg);
    }
    const host = document.createElement("div");
    document.body.append(host);
    const centre = new AlertCentre(host, () => {});
    centre.setHistory(historyLines(s, T));
    centre.setOpen(true);
    const lines = [...host.querySelectorAll(".alerts-history .alert-line")].map((n) => [n.querySelector(".alert-tag")!.textContent, n.querySelector(".alert-title")!.textContent]);
    expect(lines).toEqual([
      ["Missed", "Supply ship late in Ares"],
      ["Decided", "A discovery in Ares"],
    ]);
    expect(host.querySelectorAll(".alerts-history .alert-text")[1]!.textContent).toMatch(/^Year \d+\. Sold the samples: 150 credits\.$/);
  });
});

describe("events in the assembled game", () => {
  function play(state: SimState): { root: HTMLElement; handle: GameHandle } {
    const root = document.createElement("div");
    document.body.append(root);
    const handle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T) }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
    return { root, handle };
  }
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("shows the card over the planet, takes a choice into the world, and lists the history in the alert centre", async () => {
    let s = ares();
    // One event already resolved, for the history, and one waiting.
    const past = cardFor(s, 1, "discovery", "traces", s.settlements[0]!, s.steps, T)!;
    s = advance({ ...s, decisions: { open: [past], log: [] } }, past.deadline - past.opened, cfg);
    const waiting = cardFor(s, 2, "meteor", null, s.settlements[0]!, s.steps, T)!;
    s = { ...s, decisions: { ...s.decisions, open: [waiting] } };
    const { root, handle } = play(s);
    try {
      await wait(700);
      const card = root.querySelector<HTMLElement>(".decision-card")!;
      expect(card.hidden).toBe(false);
      expect(card.querySelector(".decision-title")!.textContent).toBe("Meteor shower in Ares");
      card.querySelector<HTMLButtonElement>('.decision-choice[data-choice="shelter"]')!.click();
      expect(handle.state.decisions.open[0]!.chosen).toBe("shelter");
      await wait(100);
      expect(card.querySelector(".decision-chosen")!.textContent).toMatch(/^Decided: Take shelter\./);
      root.querySelector<HTMLButtonElement>(".alerts-toggle")!.click();
      const history = [...root.querySelectorAll(".alerts-history .alert-title")].map((n) => n.textContent);
      expect(history).toEqual(["A discovery in Ares"]);
    } finally {
      handle.stop();
    }
  }, 15_000);
});

describe("what an event leaves on a city, in its words", () => {
  it("says a city is under cover, or in quarantine, and for how long", () => {
    const c = ares().settlements[0]!;
    expect(effectWords(c, T)).toBe("");
    const covered = { ...c, effects: [{ kind: "shelter" as const, tile: null, factor: 0, remaining: cityYearsFor(60, T), event: 1 }] };
    expect(effectWords(covered, T)).toBe(" Its people are under cover: no materials made or research earned for about 1 min at 1x.");
    const quarantined = { ...c, effects: [{ kind: "quarantine" as const, tile: null, factor: 0, remaining: cityYearsFor(300, T), event: 1 }] };
    expect(effectWords(quarantined, T)).toBe(" In quarantine: no growth for about 5 min at 1x.");
  });
});
