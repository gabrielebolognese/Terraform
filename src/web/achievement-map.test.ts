// @vitest-environment happy-dom
/**
 * The achievements map (at the user's request): every achievement a box on its
 * group's lane, in order, joined left to right from the start; a box shows its
 * icon and title only, and its details - what earns it, earned or not, where
 * first - wait inside it for the pointer or the keyboard. Earned is said by a
 * tick and the word, not by the green alone.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, GROUP_NAMES } from "../sim/index.js";
import { achievementMap } from "./achievement-map.js";
import { worldTuning } from "./game-tuning.js";
import type { PlayerRecord } from "./profile.js";

const T = worldTuning("standard", 0);
const at = (name: string): { world: string; name: string; at: number } => ({ world: "w-1", name, at: 1 });
/** A player who has earned two on the planet's lane, one in the cities, and a rare one. */
const RECORD: PlayerRecord = { victories: [], achievements: { caps: at("Ares"), first_water: at("Ares"), people_few: at("Tharsis"), self_reliant: at("Ares") } };

afterEach(() => document.body.replaceChildren());

function mapOf(record: PlayerRecord): HTMLElement {
  const map = achievementMap(record, T);
  document.body.append(map);
  return map;
}

const text = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the achievements map", () => {
  it("has a lane for each group, in order, and every achievement once, on its own lane, in the game's order", () => {
    const map = mapOf(RECORD);
    const lanes = [...map.querySelectorAll<HTMLElement>(".ach-lane")];
    expect(lanes.map((l) => l.dataset["group"])).toEqual([...ACHIEVEMENT_GROUPS]);
    for (const lane of lanes) {
      const group = lane.dataset["group"] as (typeof ACHIEVEMENT_GROUPS)[number];
      const want = ACHIEVEMENTS.filter((a) => a.group === group).map((a) => a.id);
      const got = [...lane.querySelectorAll<HTMLElement>(".ach-list > .ach-node")].map((n) => n.dataset["achievement"]);
      expect(got, group).toEqual(want);
      expect(text(lane.querySelector(".ach-lane-name")), group).toMatch(new RegExp(`^${GROUP_NAMES[group]}`));
    }
    expect(map.querySelectorAll(".ach-node")).toHaveLength(ACHIEVEMENTS.length);
    // One start, before the lanes: the root every lane branches from.
    const board = map.querySelector(".ach-board")!;
    expect([...board.children].map((c) => c.className)).toEqual(["ach-start", "ach-lanes"]);
  });

  it("shows each box's icon and title only; its details hold what earns it", () => {
    const map = mapOf(RECORD);
    for (const a of ACHIEVEMENTS) {
      const node = map.querySelector<HTMLElement>(`[data-achievement="${a.id}"]`)!;
      const face = node.querySelector(".ach-face")!;
      expect(text(face), a.id).toBe(a.title);
      expect(face.querySelector(".ach-icon svg rect"), `${a.id}'s icon`).not.toBeNull();
      expect(text(node.querySelector(".ach-detail .ach-counts")), a.id).toBe(a.counts(T));
      // The keyboard can open it as the pointer does.
      expect(node.querySelector<HTMLElement>(".ach-card")!.tabIndex, a.id).toBe(0);
    }
  });

  it("marks what is earned with a tick and the word, where it was first earned, and the rest with a lock", () => {
    const map = mapOf(RECORD);
    const earned = [...map.querySelectorAll<HTMLElement>(".ach-node.earned")].map((n) => n.dataset["achievement"]);
    expect(earned.sort()).toEqual(Object.keys(RECORD.achievements).sort());
    const caps = map.querySelector<HTMLElement>('[data-achievement="caps"]')!;
    expect(caps.querySelector(".ach-badge")!.getAttribute("aria-label")).toBe("Earned");
    expect(text(caps.querySelector(".ach-state"))).toBe("Earned");
    expect(text(caps.querySelector(".achievement-where"))).toBe("First in Ares");
    const swift = map.querySelector<HTMLElement>('[data-achievement="swift"]')!;
    expect(swift.classList.contains("earned")).toBe(false);
    expect(swift.querySelector(".ach-badge")!.getAttribute("aria-label")).toBe("Not earned yet");
    expect(text(swift.querySelector(".ach-state"))).toBe("Not earned yet");
    expect(swift.querySelector(".achievement-where")).toBeNull();
    // The tick and the lock are different pictures, not one picture in two colours.
    const tick = caps.querySelector(".ach-badge svg")!.innerHTML;
    const lock = swift.querySelector(".ach-badge svg")!.innerHTML;
    expect(tick).not.toBe(lock);
    // The rare ones say so.
    expect(text(swift.querySelector(".ach-rare"))).toMatch(/^Rare/);
    expect(map.querySelector('[data-achievement="caps"] .ach-rare')).toBeNull();
    // Each lane counts what is earned on it.
    expect(text(map.querySelector('.ach-lane[data-group="planet"] .ach-lane-count'))).toBe(`2/${ACHIEVEMENTS.filter((a) => a.group === "planet").length}`);
  });

  it("with nothing earned, every box is locked; with everything, every one ticked", () => {
    const none = mapOf({ victories: [], achievements: {} });
    expect(none.querySelectorAll(".ach-node.earned")).toHaveLength(0);
    expect([...none.querySelectorAll(".ach-badge")].every((b) => b.getAttribute("aria-label") === "Not earned yet")).toBe(true);
    document.body.replaceChildren();
    const all = mapOf({ victories: [], achievements: Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, at("Home")])) });
    expect(all.querySelectorAll(".ach-node.earned")).toHaveLength(ACHIEVEMENTS.length);
  });

  it("is laid out by the stylesheet: a box opens wider when held, the link into an earned box lit", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/web/style.css", "utf8");
    document.head.append(style);
    try {
      const map = mapOf(RECORD);
      const card = map.querySelector<HTMLElement>('[data-achievement="caps"] .ach-card')!;
      expect(getComputedStyle(card).width).toBe("184px");
      expect(getComputedStyle(map.querySelector(".ach-list")!).display).toBe("flex");
      // The details are closed until the box is held: none of the row they open into.
      expect(getComputedStyle(card).gridTemplateRows).toBe("auto 0fr");
    } finally {
      style.remove();
    }
  });
});
