/**
 * Milestones (Batch 30): "a moment, a card and a sound when a phase is
 * reached, a city is founded, a great structure is finished" - and when an
 * objective is done, so the reward waiting is never missed.
 *
 * Derived, like the event feed: each is a crossing seen between two looks at
 * the world, never stored. The first look only takes its bearings, so opening
 * a world (or coming back from the example planet) announces nothing that
 * was already so; what happened while away is the away message's to say.
 *
 * Reads the state; never writes it.
 */

import type { BuildingType, Settlement, SimState, Tuning } from "../sim/index.js";
import { BUILDING_DEFS, BUILD_TIER, PHASE_INFO, constructionOf, objectiveStatus, tileKey } from "../sim/index.js";
import { settlementLabel } from "./settlement-label.js";

export type MilestoneKind = "phase" | "founded" | "great" | "objective";

export interface Milestone {
  readonly kind: MilestoneKind;
  /** The card's eyebrow and headline, and the line under it. */
  readonly title: string;
  readonly text: string;
  /** The big beats - a new phase - get the grander chime. */
  readonly grand: boolean;
}

/** A settlement's great structures standing (not going up), by type: what a finished one adds to. */
function greatStanding(s: Settlement): Map<BuildingType, number> {
  const out = new Map<BuildingType, number>();
  const going = constructionOf(s);
  for (const b of s.buildings) {
    if (BUILD_TIER[b.type] !== "great" || !BUILDING_DEFS[b.type].buildable) continue;
    if (going.has(tileKey(b.tx, b.ty))) continue;
    out.set(b.type, (out.get(b.type) ?? 0) + 1);
  }
  return out;
}

const isCity = (s: Settlement): boolean => s.kind === "city" || s.kind === "metropolis";

export class MilestoneWatch {
  private phase: number | null = null;
  private settlements = new Set<string>();
  private great = new Map<string, Map<BuildingType, number>>();
  private done = new Set<string>();

  /** What crossed since the last look. The first look after `reset` only takes its bearings. */
  observe(state: SimState, t: Tuning): readonly Milestone[] {
    const first = this.phase === null;
    const out: Milestone[] = [];

    if (!first && state.phaseReached > this.phase!) {
      for (let p = this.phase! + 1; p <= state.phaseReached; p += 1) {
        const info = PHASE_INFO[p as keyof typeof PHASE_INFO];
        out.push({ kind: "phase", title: `Phase ${p}: ${info.name}`, text: info.caption, grand: true });
      }
    }
    this.phase = state.phaseReached;

    for (const s of state.settlements) {
      if (s.lostAtSeaLevelM !== null) continue;
      const seen = this.settlements.has(s.id);
      if (!seen) {
        this.settlements.add(s.id);
        if (!first && isCity(s)) out.push({ kind: "founded", title: `${settlementLabel(s)} is founded`, text: s.kind === "metropolis" ? "A metropolis: three times a city's ground each way, and everything a city may build." : "Its headquarters and spaceport have landed. Power, a dome, and the first settlers can come.", grand: false });
      }
      const now = greatStanding(s);
      const before = this.great.get(s.id);
      if (seen && before !== undefined) {
        for (const [type, n] of now) {
          if (n > (before.get(type) ?? 0)) out.push({ kind: "great", title: `${BUILDING_DEFS[type].name} finished`, text: `A great structure stands in ${settlementLabel(s)}.`, grand: false });
        }
      }
      this.great.set(s.id, now);
    }

    for (const o of objectiveStatus(state, t)) {
      const ready = o.open && !o.claimed && o.progress.done;
      if (!ready) {
        this.done.delete(o.def.id);
        continue;
      }
      if (this.done.has(o.def.id)) continue;
      this.done.add(o.def.id);
      if (!first) out.push({ kind: "objective", title: `Objective done: ${o.def.title}`, text: "Its reward is waiting in Objectives.", grand: false });
    }
    return out;
  }

  /** A fresh start: a world opened, the example left, a reset. */
  reset(): void {
    this.phase = null;
    this.settlements.clear();
    this.great.clear();
    this.done.clear();
  }
}

/** How long a card stays, milliseconds. */
export const CARD_MS = 6500;

/**
 * The cards: one at a time, in the middle of the screen's upper part, with a
 * moment of light round the edge of the screen and the chime. Several at once
 * wait their turn.
 */
export class MilestoneCards {
  readonly root: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly queue: Milestone[] = [];
  private showingUntil = 0;

  /** `sound` is the card's chime (Batch 35: the sound engine's, through the director); none by default. */
  constructor(host: HTMLElement, private readonly sound: (milestone: Milestone) => void = () => undefined) {
    this.flash = document.createElement("div");
    this.flash.className = "milestone-flash";
    this.flash.setAttribute("aria-hidden", "true");
    this.root = document.createElement("div");
    this.root.className = "milestone-card";
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    this.root.hidden = true;
    this.eyebrow = document.createElement("div");
    this.eyebrow.className = "milestone-eyebrow";
    this.title = document.createElement("div");
    this.title.className = "milestone-title";
    this.text = document.createElement("div");
    this.text.className = "milestone-text";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "milestone-close";
    close.textContent = "OK";
    close.addEventListener("click", () => {
      this.showingUntil = 0;
      this.frame(0);
    });
    this.root.append(this.eyebrow, this.title, this.text, close);
    host.append(this.flash, this.root);
  }

  push(milestones: readonly Milestone[]): void {
    this.queue.push(...milestones);
  }

  /** Called every frame: the next card once the one showing has had its time. */
  frame(now: number): void {
    if (!this.root.hidden && now < this.showingUntil) return;
    const next = this.queue.shift();
    if (next === undefined) {
      this.root.hidden = true;
      return;
    }
    this.eyebrow.textContent = EYEBROW[next.kind];
    this.title.textContent = next.title;
    this.text.textContent = next.text;
    this.root.dataset["kind"] = next.kind;
    this.root.hidden = false;
    this.showingUntil = now + CARD_MS;
    // The moment: the card and the light round the screen play their animation again.
    for (const node of [this.root, this.flash]) {
      node.classList.remove("milestone-on");
      void node.offsetWidth;
      node.classList.add("milestone-on");
    }
    this.sound(next);
  }

  get showing(): string | null {
    return this.root.hidden ? null : this.title.textContent;
  }

  clear(): void {
    this.queue.length = 0;
    this.root.hidden = true;
  }
}

const EYEBROW: Readonly<Record<MilestoneKind, string>> = {
  phase: "The planet changes",
  founded: "A new city",
  great: "A great structure",
  objective: "Objective done",
};
