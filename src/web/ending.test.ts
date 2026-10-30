// @vitest-environment happy-dom

/**
 * Batch 39, the page half: the victory's sequence in the assembled game, the
 * worlds list's score, the title's Achievements, and new game plus - driven
 * through the real `startGame` and the real `App`, the way a player meets them.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { SimState } from "../sim/index.js";
import { marsStart, summariseAway, toSave } from "../sim/index.js";
import { SEA_TUNING, playToVictory, playWalled } from "../harness/ending.js";
import { REFERENCE_POLICY } from "../harness/policy.js";
import { App } from "./app.js";
import type { GameHandle } from "./game.js";
import { startGame } from "./game.js";
import { BROWSER_TUNING } from "./game-tuning.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { MilestoneWatch } from "./milestones.js";
import { MemorySaveStore } from "./storage.js";
import { Frames } from "./test-frames.js";
import { CARD_AFTER_MS, SWING_MS, SWING_RAD } from "./victory.js";

/** Three high cities and a walled one, won in year 1,720.5 (`harness/ending.ts`). */
const won: SimState = playWalled().state;
const T = SEA_TUNING;

let mounted: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted) m.remove();
  mounted = [];
});

function game(state: SimState, extra: { victorySeen?: boolean; reduced?: boolean } = {}): { handle: GameHandle; root: HTMLElement; frames: Frames; seen: () => number } {
  const frames = new Frames();
  frames.install();
  const root = document.createElement("div");
  document.body.append(root);
  mounted.push(root);
  let seen = 0;
  const settings = { current: extra.reduced ? { ...DEFAULT_SETTINGS, ui: { ...DEFAULT_SETTINGS.ui, motion: "reduced" as const } } : DEFAULT_SETTINGS };
  const handle = startGame(
    root,
    { state, tuning: T, fresh: () => marsStart(undefined, T), settings, newGamePlus: () => true, ...(extra.victorySeen === undefined ? {} : { victorySeen: extra.victorySeen }) },
    { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {}, onVictory: () => (seen += 1) },
  );
  return { handle, root, frames, seen: () => seen };
}

describe("the victory in the assembled game", () => {
  it("plays once over the planet: the camera swings round it, then the world's story and its score, and Keep playing hands the world back", () => {
    const g = game(won);
    try {
      const yaw0 = g.handle.views.globe.currentPose().yaw;
      g.frames.step(3, 100);
      const overlay = g.root.querySelector<HTMLElement>(".victory")!;
      expect(overlay.hidden, "the sequence begins at the first look").toBe(false);
      expect(g.root.querySelector(".victory-title")!.textContent).toBe("A living world");
      expect(g.root.classList.contains("victory-on") || g.root.querySelector(".game.victory-on") !== null, "the panels step aside").toBe(true);
      expect(g.seen()).toBe(1);
      const card = g.root.querySelector<HTMLElement>(".victory-card")!;
      expect(card.hidden, "the title has its moment first").toBe(true);
      g.frames.step(Math.ceil(CARD_AFTER_MS / 100), 100);
      expect(card.hidden).toBe(false);
      const text = card.textContent ?? "";
      expect(text).toContain("Won in");
      expect(text).toContain("year 1,721");
      expect(text).toContain("4 founded, 4 standing");
      expect(text).toContain("1 city behind its Seawall");
      expect(text).toContain("Score");
      expect(text).toContain("New game plus is open");
      // The swing: a turn and a quarter round the planet over SWING_MS.
      g.frames.step(Math.ceil(SWING_MS / 100), 100);
      expect(g.handle.views.globe.currentPose().yaw - yaw0).toBeCloseTo(SWING_RAD, 3);
      [...card.querySelectorAll("button")].find((b) => b.textContent === "Keep playing")!.click();
      expect(overlay.hidden).toBe(true);
      expect(g.root.querySelector(".game.victory-on")).toBeNull();
      g.frames.step(30, 100);
      expect(overlay.hidden, "once").toBe(true);
      expect(g.seen()).toBe(1);
    } finally {
      g.handle.stop();
    }
  });

  it("with reduced motion: no swing, the card at once", () => {
    const g = game(won, { reduced: true });
    try {
      const yaw0 = g.handle.views.globe.currentPose().yaw;
      g.frames.step(3, 100);
      expect(g.root.querySelector<HTMLElement>(".victory-card")!.hidden).toBe(false);
      g.frames.step(50, 100);
      expect(Math.abs(g.handle.views.globe.currentPose().yaw - yaw0)).toBeLessThan(0.05);
    } finally {
      g.handle.stop();
    }
  });

  it("is not played again in a world it was shown in, nor in a world not won", () => {
    const seenBefore = game(won, { victorySeen: true });
    try {
      seenBefore.frames.step(60, 100);
      expect(seenBefore.root.querySelector<HTMLElement>(".victory")!.hidden).toBe(true);
      expect(seenBefore.seen()).toBe(0);
    } finally {
      seenBefore.handle.stop();
    }
    const nearly = game(playToVictory(REFERENCE_POLICY, T, 1700).state);
    try {
      nearly.frames.step(60, 100);
      expect(nearly.root.querySelector<HTMLElement>(".victory")!.hidden).toBe(true);
    } finally {
      nearly.handle.stop();
    }
  });
});

describe("the title: scores, achievements and new game plus", () => {
  function page(store: MemorySaveStore): { app: App; root: HTMLElement } {
    const root = document.createElement("div");
    document.body.append(root);
    mounted.push(root);
    let at = Date.parse("2026-10-30T12:00:00Z");
    const app = new App({
      root,
      store,
      now: () => (at += 1000),
      randomSeed: () => 4242,
      launch: startGame,
      buildExample: () => ({ state: marsStart(7, BROWSER_TUNING), tuning: BROWSER_TUNING }),
      download: () => {},
      titleGlobe: false,
    });
    return { app, root };
  }
  const button = (root: ParentNode, text: string): HTMLButtonElement => {
    const b = [...root.querySelectorAll("button")].find((x) => x.textContent === text);
    if (b === undefined) throw new Error(`no button "${text}"`);
    return b;
  };

  it("keeps a won world's score on the list, its achievements in the player's record, and opens a bonus for the next world", async () => {
    const frames = new Frames();
    frames.install();
    const store = new MemorySaveStore(true);
    const { app, root } = page(store);
    await app.start();
    // Before any victory there is no bonus to choose.
    button(root, "New world").click();
    expect(root.querySelector<HTMLElement>(".new-world-bonus")!.hidden).toBe(true);
    button(root, "Back").click();

    // A Standard world whose save is the won one.
    const meta = await app.library.create({ name: "Won", seed: 7, mode: "standard", pace: "classic" });
    await store.save(meta.slot, toSave(won, T, new Date(Date.parse("2026-10-30T12:00:00Z")).toISOString()));
    await app.play(meta.id);
    frames.step(5, 100);
    expect(root.querySelector<HTMLElement>(".victory")!.hidden).toBe(false);
    await app.settled();
    expect(app.library.find(meta.id)!.victorySeen).toBe(true);
    await app.quitToTitle();

    button(root, "Worlds").click();
    const row = [...root.querySelectorAll<HTMLElement>(".world-row")].find((r) => r.querySelector(".world-name")?.textContent === "Won")!;
    expect(row.querySelector(".world-score")!.textContent).toMatch(/^Score [\d,]+ - won in year 1,721 - \d+ achievements$/);

    // Deleted, the world's achievements stay the player's.
    await app.library.remove(meta.id);
    button(root, "Back").click();
    button(root, "Achievements").click();
    const held = root.querySelector<HTMLElement>('[data-achievement="nobody_lost"]')!;
    expect(held.classList.contains("earned")).toBe(true);
    expect(held.querySelector(".achievement-where")!.textContent).toBe("First in Won");
    expect(root.querySelector<HTMLElement>('[data-achievement="swift"]')!.classList.contains("earned")).toBe(false);
    expect(root.querySelector(".achievements-total")!.textContent).toMatch(/^\d+ of 30 earned - a world won\./);

    // New game plus: the bonus chosen is the new world's tuning.
    button(root, "Back").click();
    button(root, "New world").click();
    const bonus = root.querySelector<HTMLElement>(".new-world-bonus")!;
    expect(bonus.hidden).toBe(false);
    root.querySelector<HTMLInputElement>('input[name="bonus"][value="2"]')!.checked = true;
    root.querySelector<HTMLFormElement>("form.new-world")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && app.currentView !== "game"; i += 1) await new Promise((r) => setTimeout(r, 20));
    await app.settled();
    const made = app.library.worlds.find((w) => w.name !== "Won")!;
    expect(made.bonus).toBe(2);
    expect(made.tuning["ROVERS_PER_HQ"]).toBe(5);
    expect(made.tuning["NEW_GAME_PLUS_BONUS"]).toBe(2);
    await app.quitToTitle();
    button(root, "Worlds").click();
    expect(root.querySelector(".world-bonus")!.textContent).toBe("New game plus: A bigger garage");
  });
});

describe("an achievement earned while playing", () => {
  it("gets its card, and nothing earned before the first look is announced", () => {
    const watch = new MilestoneWatch();
    // The won world as it was one achievement earlier: the list only grows, in the order earned.
    const last = won.ending.achievements.at(-1)!;
    expect(last.id).toBe("self_reliant");
    const before = { ...won, ending: { ...won.ending, achievements: won.ending.achievements.slice(0, -1) } };
    expect(watch.observe(before, T).filter((m) => m.kind === "achievement")).toEqual([]);
    const cards = watch.observe(won, T).filter((m) => m.kind === "achievement");
    expect(cards.map((m) => m.title)).toEqual(["Achievement: Self-reliant"]);
    expect(cards[0]!.text).toBe("Win without buying anything from Earth.");
    expect(cards[0]!.grand, "a rare one").toBe(true);
  });
});

describe("coming back to a world won while away", () => {
  it("says so, and how many achievements came", () => {
    const nearly = playToVictory(REFERENCE_POLICY, T, 1715).state;
    const summary = summariseAway(nearly, won, T);
    expect(summary.ending.won).toBe(true);
    expect(summary.ending.achievements).toContain("victory");
    expect(summary.headline).toContain("The planet held its living world: you have won.");
    expect(summary.headline).toMatch(/\d+ achievements earned - see Achievements on the title screen\./);
  });
});
