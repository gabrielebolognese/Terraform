/**
 * The victory (Batch 39): "a victory sequence over the globe; the world's
 * story in numbers; the choice to keep playing."
 *
 * Once a world is won, the next look at it plays the sequence, once: the
 * panels step aside and the camera swings round the living planet while the
 * title comes up, then the card with the world's story in numbers and its
 * score, and two ways on - keep playing this world, or go back to the title.
 * With reduced motion the camera stays where it is and the card comes at once.
 *
 * Reads the state; never writes it. Whether it has been shown is the worlds
 * list's to keep (`WorldLibrary.markVictorySeen`), not the world's.
 */

import type { Tuning } from "../sim/index.js";
import { worldStory } from "../sim/index.js";
import type { SimState } from "../sim/index.js";
import { scoreLines, storyLines } from "./ending-words.js";
import type { Line } from "./ending-words.js";

export interface Pose {
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
}

export interface VictoryHost {
  /** Drive the planet's camera to a pose, or hand it back to the player with null. */
  pose(p: Pose | null): void;
  currentPose(): Pose;
  /** The player asked for less motion. */
  reducedMotion(): boolean;
  /** The planet is in view (not a city, the planner or the map): only then does the camera swing round it. */
  orbiting(): boolean;
  /** The two ways on. */
  keepPlaying(): void;
  leave(): void;
}

/** How long the camera swings round the planet, ms, and how far: one turn and a quarter. */
export const SWING_MS = 12_000;
export const SWING_RAD = 2.5 * Math.PI;
/** When the card comes, ms after the start: the title has had its moment. */
export const CARD_AFTER_MS = 4_000;

function dl(lines: readonly Line[], className: string): HTMLDListElement {
  const list = document.createElement("dl");
  list.className = className;
  for (const l of lines) {
    const dt = document.createElement("dt");
    dt.textContent = l.label;
    const dd = document.createElement("dd");
    dd.textContent = l.value;
    list.append(dt, dd);
  }
  return list;
}

export class VictorySequence {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private startedAt: number | null = null;
  private from: Pose | null = null;
  private swinging = false;

  constructor(
    host: HTMLElement,
    private readonly h: VictoryHost,
  ) {
    this.root = document.createElement("div");
    this.root.className = "victory";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Victory");
    this.root.hidden = true;
    this.card = document.createElement("div");
    this.card.className = "victory-card";
    host.append(this.root);
  }

  get active(): boolean {
    return this.startedAt !== null;
  }

  /** Play it: the title now, the camera swinging round the planet, the card once the title has had its moment. */
  start(now: number, state: SimState, t: Tuning, newGamePlus: boolean): void {
    const story = worldStory(state, t);
    const title = document.createElement("h2");
    title.className = "victory-title";
    title.textContent = "A living world";
    const sub = document.createElement("p");
    sub.className = "victory-sub";
    sub.textContent = `Mars has held every one of the six minimums - warmth, air, oxygen, little carbon dioxide, open water and life - for ${t.VICTORY_HOLD_YEARS} years. You have won.`;
    const story_ = document.createElement("section");
    story_.className = "victory-story";
    const h3 = document.createElement("h3");
    h3.textContent = "The world's story";
    story_.append(h3, dl(storyLines(story, t), "victory-lines"));
    const score = document.createElement("section");
    score.className = "victory-score";
    const h3b = document.createElement("h3");
    h3b.textContent = "Its score";
    score.append(h3b, dl(story.score === null ? [] : scoreLines(story.score), "victory-lines"));
    const plus = document.createElement("p");
    plus.className = "victory-plus";
    plus.textContent = newGamePlus ? "New game plus is open: a new Standard world can start with a bonus of your choice." : "";
    plus.hidden = !newGamePlus;
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "front-button primary victory-keep";
    keep.textContent = "Keep playing";
    keep.addEventListener("click", () => {
      this.close();
      this.h.keepPlaying();
    });
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "front-button victory-leave";
    leave.textContent = "Save and back to the title";
    leave.addEventListener("click", () => {
      this.close();
      this.h.leave();
    });
    const actions = document.createElement("div");
    actions.className = "victory-actions";
    actions.append(keep, leave);
    this.card.replaceChildren(story_, score, plus, actions);
    this.card.hidden = true;
    this.root.replaceChildren(title, sub, this.card);
    this.root.hidden = false;
    this.startedAt = now;
    this.swinging = !this.h.reducedMotion() && this.h.orbiting();
    this.from = this.swinging ? this.h.currentPose() : null;
    if (!this.swinging) this.showCard();
  }

  private showCard(): void {
    if (!this.card.hidden) return;
    this.card.hidden = false;
    (this.card.querySelector(".victory-keep") as HTMLButtonElement | null)?.focus();
  }

  /** Every frame: the camera's swing, eased in and out, and the card when its time comes. */
  frame(now: number): void {
    if (this.startedAt === null) return;
    const dt = now - this.startedAt;
    if (dt >= CARD_AFTER_MS) this.showCard();
    if (!this.swinging || this.from === null) return;
    const k = Math.min(1, dt / SWING_MS);
    const eased = k * k * (3 - 2 * k);
    this.h.pose({ yaw: this.from.yaw + SWING_RAD * eased, pitch: this.from.pitch * (1 - eased) + 0.25 * eased, zoom: this.from.zoom });
    if (k >= 1) this.swinging = false;
  }

  /** Put it away and hand the camera back. */
  close(): void {
    if (this.startedAt === null) return;
    this.startedAt = null;
    this.root.hidden = true;
    this.root.replaceChildren();
    if (this.from !== null) this.h.pose(null);
    this.from = null;
    this.swinging = false;
  }
}
