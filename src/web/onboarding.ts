/**
 * The first hour on screen (Batch 30): the guide's card, and the objectives
 * panel.
 *
 * The guide says the step the world has reached and where to press, and
 * marks that control with a glow. Which step it is comes from the simulation
 * (`guideReached`, the latch carried forward through what the state shows
 * done); this file only chooses the words and the control, by where the
 * player is looking - so it can never be a step ahead of, or behind, the
 * world. The objectives panel shows each objective's progress as the
 * simulation derives it, and its Claim button is the simulation's own claim.
 *
 * Neither writes the world: Skip and Claim go through the game's actions.
 */

import type { ObjectiveChain, ObjectiveStatus, Progress, Reward, SimState, Tuning } from "../sim/index.js";
import { GUIDE_STEPS, OBJECTIVE_CHAINS, guideActive, guideReached, largestCity } from "../sim/index.js";

/** Where the player is: the planet from orbit, a city, the world map, the city planner. */
export type GuideContext = "orbit" | "city" | "map" | "planner";

export interface GuideHint {
  /** "Step 3 of 7". */
  readonly progress: string;
  readonly title: string;
  /** What to do next, from where the player is, in words. */
  readonly how: string;
  /** The control to press, as a selector, or null when there is nothing to press (choosing a site, waiting). */
  readonly target: string | null;
}

export interface GuideSituation {
  readonly state: SimState;
  readonly tuning: Tuning;
  readonly context: GuideContext;
  /** Choosing a site on the planet, after Found a city or Found an outpost. */
  readonly founding: boolean;
  /** A building is selected in the city view, its panel open. */
  readonly selected: boolean;
}

const BACK: Readonly<Record<Exclude<GuideContext, "orbit" | "city">, { how: string; target: string }>> = {
  map: { how: "Go back to orbit to do it.", target: ".worldmap-close" },
  planner: { how: "Go back to the city view to do it.", target: ".planner-city" },
};

/** The hint for the step the world is on, or null when the guide has nothing to show. */
export function guideHint(g: GuideSituation): GuideHint | null {
  if (!guideActive(g.state, g.tuning)) return null;
  const k = guideReached(g.state, g.tuning);
  const step = GUIDE_STEPS[k]!;
  const progress = `Step ${k + 1} of ${GUIDE_STEPS.length}`;
  const hint = (how: string, target: string | null): GuideHint => ({ progress, title: step.title, how, target });
  const standing = g.state.settlements.filter((s) => s.lostAtSeaLevelM === null);
  const city = largestCity(g.state);
  const intoCity = (): GuideHint =>
    g.context === "orbit"
      ? hint("Open your city: press Open beside its name under Settlements.", ".hud-settlement-open")
      : g.context === "map"
        ? hint("Open your city: choose it on the map and press Open the city.", ".worldmap-open")
        : hint(BACK.planner.how, BACK.planner.target);

  switch (step.id) {
    case "found":
      if (g.founding) return hint("Click the planet where the city should stand. Lowland near the equator is warmest. Esc cancels.", null);
      if (g.context === "map" || g.context === "planner") return hint(BACK[g.context].how, BACK[g.context].target);
      if (g.context === "city") return hint("Go back to orbit to found a city.", ".city-back");
      return hint("Type a name if you like, press Found a city, then click the planet where it should stand.", '.hud-found[data-kind="city"]');
    case "power":
      if (g.context !== "city") return intoCity();
      return hint("Pick Solar array in the build bar along the bottom, then click open ground near the headquarters. A rover drives out to build it.", '.city-card[data-card="solar_array"]');
    case "dome":
      if (g.context !== "city") return intoCity();
      return hint("Pick Habitat dome, then click open ground. Domes are where your people live.", '.city-card[data-card="habitat_dome"]');
    case "connect":
      if (g.context !== "city") return intoCity();
      return hint("Press Connect all, top right: cables carry the power to the dome, corridors carry water, air and food. Buildings that touch are joined already.", '.city-card[data-card="connect"]');
    case "upgrade":
      if (g.context !== "city") return intoCity();
      if (!g.selected) return hint("Click a building - the solar array will do - to open its panel.", null);
      return hint("Press Upgrade. Each level makes the building better, and takes a rover longer than the last.", ".city-upgrade");
    case "claim": {
      if (g.context !== "city") return intoCity();
      const people = Math.floor(city?.population ?? 0);
      const at = g.tuning.CLAIM_FIRST_POPULATION;
      if (people < at) return hint(`New land opens at ${at.toLocaleString("en")} people; the city has ${people.toLocaleString("en")}. Keep everyone supplied - power, water, air and food - and build domes as they fill. The objectives pay settlers on the way.`, '.city-card[data-card="claim"]');
      return hint("Press Claim land, then click one of the squares on offer at the city's edge.", '.city-card[data-card="claim"]');
    }
    case "rail":
      if (standing.length < 2) {
        if (g.context === "orbit") {
          if (g.founding) return hint("Click the planet near your city: the nearer, the cheaper the railway.", null);
          return hint("Found a second settlement near your first: an outpost is enough. Press Found an outpost, then click the planet close by.", '.hud-found[data-kind="outpost"]');
        }
        if (g.context === "map" || g.context === "planner") return hint(BACK[g.context].how, BACK[g.context].target);
        return hint("Go back to orbit to found a second settlement nearby.", ".city-back");
      }
      if (g.context === "map") return hint("Choose your city on the map, press Lay a railway to..., then click the other settlement. Each end pays half, in materials.", ".worldmap-join");
      if (g.context === "city") return hint("Press World map, at the top of the city's panel, to join the two by rail.", ".city-world-map");
      if (g.context === "orbit") return hint("Open the World map to join your two settlements by rail.", ".hud-world-map");
      return hint(BACK.planner.how, BACK.planner.target);
  }
}

/** The class the guide puts on the control to press. */
export const GUIDE_TARGET_CLASS = "guide-target";

/**
 * The guide's card, top centre, in every view: the step, what to do, and Skip.
 * Each frame it moves its glow onto the control the hint names (cards are
 * rebuilt as the city changes, so the mark is put back every time).
 */
export class GuidePanel {
  readonly root: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly title: HTMLElement;
  private readonly how: HTMLElement;
  private marked: Element | null = null;

  constructor(
    host: HTMLElement,
    private readonly scope: HTMLElement,
    onSkip: () => void,
  ) {
    this.root = document.createElement("aside");
    this.root.className = "guide-card";
    this.root.setAttribute("aria-label", "Getting started");
    this.root.hidden = true;
    const head = document.createElement("div");
    head.className = "guide-head";
    this.progress = document.createElement("span");
    this.progress.className = "guide-progress";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "guide-skip";
    skip.textContent = "Skip the guide";
    skip.addEventListener("click", () => onSkip());
    head.append(this.progress, skip);
    this.title = document.createElement("div");
    this.title.className = "guide-title";
    this.how = document.createElement("p");
    this.how.className = "guide-how";
    this.how.setAttribute("aria-live", "polite");
    this.root.append(head, this.title, this.how);
    host.append(this.root);
  }

  update(hint: GuideHint | null): void {
    if (hint === null) {
      this.root.hidden = true;
      this.mark(null);
      return;
    }
    this.root.hidden = false;
    if (this.progress.textContent !== hint.progress) this.progress.textContent = hint.progress;
    if (this.title.textContent !== hint.title) this.title.textContent = hint.title;
    if (this.how.textContent !== hint.how) this.how.textContent = hint.how;
    this.mark(hint.target === null ? null : this.scope.querySelector(hint.target));
  }

  /** The control the guide is pointing at, if it is on the page. */
  get target(): Element | null {
    return this.marked;
  }

  private mark(el: Element | null): void {
    if (el === this.marked && el?.classList.contains(GUIDE_TARGET_CLASS)) return;
    this.marked?.classList.remove(GUIDE_TARGET_CLASS);
    this.marked = el;
    el?.classList.add(GUIDE_TARGET_CLASS);
  }

  dispose(): void {
    this.mark(null);
    this.root.remove();
  }
}

const CHAIN_NAMES: Readonly<Record<ObjectiveChain, string>> = {
  city: "Your city",
  planet: "The planet",
  network: "The network",
};

/** A reward, in words: "50 settlers", "2 rovers", "2,000 credits", "found a metropolis". */
export function rewardWords(r: Reward): string {
  const parts: string[] = [];
  if (r.people > 0) parts.push(`${r.people} settlers from Earth`);
  if (r.rovers > 0) parts.push(`${r.rovers} more rover${r.rovers === 1 ? "" : "s"} for good`);
  if (r.materials > 0) parts.push(`${r.materials.toLocaleString("en")} materials`);
  if (r.credits > 0) parts.push(`${r.credits.toLocaleString("en")} credits`);
  if (r.unlock === "metropolis") parts.push("the right to found a metropolis");
  if (r.cosmetic === "gold_markers") parts.push("gold markers for your cities");
  return parts.join(", ");
}

/**
 * Progress in words: "312 of 500 people", "6.4 of 100 mbar"; a goal measured
 * from where the world began says how far it has come since, and where it
 * stands: "0.6 of 2.8 K up from the start (213.8 now, 216 needed)".
 */
export function progressWords(o: ObjectiveStatus): string {
  const n = (v: number): string => (Number.isInteger(v) ? v.toLocaleString("en") : v.toFixed(1));
  const p = o.progress;
  if (p.from === 0) return `${n(p.now)} of ${n(p.target)} ${o.def.unit}`;
  return `${n(Math.max(0, p.now - p.from))} of ${n(p.target - p.from)} ${o.def.unit} up from the start (${n(p.now)} now, ${n(p.target)} needed)`;
}

/** How full an objective's bar is, 0..1: from where it starts to its target. */
export function barFraction(p: Progress): number {
  const span = p.target - p.from;
  if (!(span > 0)) return p.done ? 1 : 0;
  return Math.max(0, Math.min(1, (p.now - p.from) / span));
}

/**
 * The objectives: a button (with how many rewards wait) and a panel, chain by
 * chain - the open goal with its progress, what counts and what it pays, and
 * Claim once it is done; the goals claimed, and the one that opens next.
 */
export class ObjectivesPanel {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  private readonly list: HTMLElement;
  private readonly notice: HTMLElement;
  private key = "";

  constructor(
    host: HTMLElement,
    private readonly tuning: Tuning,
    private readonly onClaim: (id: string) => { ok: boolean; reason: string | null; words: string },
  ) {
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.className = "objectives-toggle";
    this.toggle.textContent = "Objectives";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.hidden = true;
    this.toggle.addEventListener("click", () => this.setOpen(this.panel.hidden));
    this.panel = document.createElement("section");
    this.panel.className = "objectives-panel";
    this.panel.setAttribute("aria-label", "Objectives");
    this.panel.hidden = true;
    const head = document.createElement("div");
    head.className = "objectives-head";
    const title = document.createElement("h2");
    title.textContent = "Objectives";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "objectives-close";
    close.textContent = "Close";
    close.addEventListener("click", () => this.setOpen(false));
    head.append(title, close);
    this.notice = document.createElement("p");
    this.notice.className = "objectives-notice";
    this.notice.setAttribute("role", "status");
    this.notice.hidden = true;
    this.list = document.createElement("div");
    this.list.className = "objectives-list";
    this.panel.append(head, this.notice, this.list);
    host.append(this.toggle, this.panel);
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  update(status: readonly ObjectiveStatus[]): void {
    const on = status.length > 0;
    this.toggle.hidden = !on;
    if (!on) {
      this.setOpen(false);
      return;
    }
    const ready = status.filter((o) => o.open && !o.claimed && o.progress.done).length;
    const label = ready > 0 ? `Objectives (${ready} to claim)` : "Objectives";
    if (this.toggle.textContent !== label) this.toggle.textContent = label;
    this.toggle.toggleAttribute("data-ready", ready > 0);
    if (this.panel.hidden) return;
    // Rebuilt only when something shown has changed: a button rebuilt under the pointer loses its click.
    const key = status.map((o) => `${o.def.id}:${o.open}:${o.claimed}:${o.progress.done}:${progressWords(o)}`).join("|");
    if (key === this.key) return;
    this.key = key;
    this.list.replaceChildren(...OBJECTIVE_CHAINS.map((chain) => this.chain(chain, status.filter((o) => o.def.chain === chain))));
  }

  private chain(chain: ObjectiveChain, goals: readonly ObjectiveStatus[]): HTMLElement {
    const box = document.createElement("section");
    box.className = "objectives-chain";
    box.dataset["chain"] = chain;
    const h = document.createElement("h3");
    h.textContent = CHAIN_NAMES[chain];
    box.append(h);
    for (const o of goals) {
      if (o.claimed) {
        const row = document.createElement("p");
        row.className = "objective-claimed";
        row.textContent = `${o.def.title} - claimed`;
        box.append(row);
        continue;
      }
      if (!o.open) {
        const row = document.createElement("p");
        row.className = "objective-next";
        row.textContent = `Next: ${o.def.title}`;
        box.append(row);
        break;
      }
      box.append(this.goal(o));
    }
    return box;
  }

  private goal(o: ObjectiveStatus): HTMLElement {
    const row = document.createElement("div");
    row.className = "objective";
    row.dataset["id"] = o.def.id;
    if (o.progress.done) row.dataset["done"] = "true";
    const title = document.createElement("div");
    title.className = "objective-title";
    title.textContent = o.def.title;
    const counts = document.createElement("p");
    counts.className = "objective-counts";
    counts.textContent = o.def.counts(this.tuning);
    const bar = document.createElement("div");
    bar.className = "objective-bar";
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-valuemin", String(o.progress.from));
    bar.setAttribute("aria-valuemax", String(o.progress.target));
    bar.setAttribute("aria-valuenow", String(Math.max(o.progress.from, Math.min(o.progress.now, o.progress.target))));
    bar.setAttribute("aria-valuetext", progressWords(o));
    const fill = document.createElement("div");
    fill.className = "objective-bar-fill";
    fill.style.width = `${barFraction(o.progress) * 100}%`;
    bar.append(fill);
    const how = document.createElement("p");
    how.className = "objective-progress";
    how.textContent = o.progress.done ? "Done." : progressWords(o);
    const reward = document.createElement("p");
    reward.className = "objective-reward";
    reward.textContent = `Reward: ${rewardWords(o.def.reward(this.tuning))}.`;
    row.append(title, counts, bar, how, reward);
    if (o.progress.done) {
      const claim = document.createElement("button");
      claim.type = "button";
      claim.className = "objective-claim";
      claim.textContent = "Claim";
      claim.addEventListener("click", () => {
        const outcome = this.onClaim(o.def.id);
        this.notice.hidden = false;
        this.notice.textContent = outcome.ok ? `Claimed: ${outcome.words}.` : `Cannot claim: ${outcome.reason ?? "refused"}`;
        this.key = "";
      });
      row.append(claim);
    }
    return row;
  }
}
