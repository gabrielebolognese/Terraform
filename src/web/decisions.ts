/**
 * The event card (Batch 33): every event waiting on the player, what it is,
 * how long is left, the choices with what each costs and does, and what
 * happens if nothing is chosen.
 *
 * A choice is the player's action, through the simulation like a claim
 * (`chooseDecision`): a button the world cannot pay for is shown, disabled,
 * with the reason. The card reads the state and never writes it.
 */

import type { AlertTarget } from "./alerts.js";
import type { OpenDecision, SimState, Tuning } from "../sim/index.js";
import { chooseDecision, decisionChoices, decisionText, defaultWords } from "../sim/index.js";
import { decisionHeadline, deadlineWords } from "./decision-words.js";
import { settlementLabel } from "./settlement-label.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** What a choice costs, in words: "150 credits", "10 materials", or "Free". */
function costWords(c: { readonly credits: number; readonly materials: number }): string {
  const parts = [c.credits > 0 ? `${c.credits.toLocaleString("en")} credits` : "", c.materials > 0 ? `${c.materials.toLocaleString("en")} materials` : ""].filter((x) => x !== "");
  return parts.length === 0 ? "Free" : parts.join(" and ");
}

export class DecisionPanel {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly count: HTMLElement;
  private readonly fold: HTMLButtonElement;
  private readonly list: HTMLElement;
  private folded = false;
  private key = "";
  /** The countdown's text node for each event shown, by id: updated every frame without rebuilding the buttons. */
  private clocks = new Map<number, HTMLElement>();
  private notice: { id: number; text: string } | null = null;

  constructor(
    host: HTMLElement,
    private readonly tuning: Tuning,
    private readonly onChoose: (id: number, choice: string) => { ok: boolean; reason: string | null },
    private readonly onGo: (target: AlertTarget) => void,
  ) {
    this.root = el("aside", "decision-card");
    this.root.setAttribute("aria-label", "Events waiting on you");
    this.root.hidden = true;
    this.head = el("div", "decision-head");
    this.count = el("span", "decision-count");
    this.fold = el("button", "decision-fold", "Hide");
    this.fold.type = "button";
    this.fold.setAttribute("aria-expanded", "true");
    this.fold.addEventListener("click", () => {
      this.folded = !this.folded;
      this.key = "";
    });
    this.head.append(this.count, this.fold);
    this.list = el("div", "decision-list");
    this.root.append(this.head, this.list);
    host.append(this.root);
  }

  /** The events open in this world, as the state stands; none (the example planet's) hides the card. */
  update(state: SimState | null, speed: number): void {
    const open = state === null || !this.tuning.DECISIONS_ENABLED ? [] : state.decisions.open;
    this.root.hidden = open.length === 0;
    if (state === null || open.length === 0) {
      this.key = "";
      return;
    }
    const waiting = open.filter((e) => e.chosen === null).length;
    this.count.textContent = waiting > 0 ? `${waiting === 1 ? "An event needs" : `${waiting} events need`} your decision` : `${open.length === 1 ? "An event" : `${open.length} events`} decided, waiting to happen`;
    this.root.toggleAttribute("data-waiting", waiting > 0);
    this.fold.textContent = this.folded ? "Show" : "Hide";
    this.fold.setAttribute("aria-expanded", String(!this.folded));
    this.list.hidden = this.folded;
    // Rebuilt only when what is offered changes: a button rebuilt under the pointer loses its click.
    const key = JSON.stringify([this.folded, this.notice, open.map((e) => [e.id, e.chosen, decisionChoices(e, this.tuning).map((c) => chooseDecision(state, e.id, c.id, this.tuning).ok)])]);
    if (key !== this.key) {
      this.key = key;
      this.clocks.clear();
      this.list.replaceChildren(...open.map((e) => this.card(state, e)));
    }
    for (const e of open) {
      const clock = this.clocks.get(e.id);
      if (clock !== undefined) clock.textContent = e.chosen === null ? `Decide within ${deadlineWords(e, state.steps, this.tuning, speed)}` : `Happens in ${deadlineWords(e, state.steps, this.tuning, speed)}`;
    }
  }

  private card(state: SimState, e: OpenDecision): HTMLElement {
    const t = this.tuning;
    const city = state.settlements.find((c) => c.id === e.settlement);
    const where = city === undefined ? "a city" : settlementLabel(city);
    const box = el("section", "decision");
    box.dataset["kind"] = e.kind;
    box.dataset["id"] = String(e.id);
    const title = el("h3", "decision-title", decisionHeadline(e, where));
    const clock = el("span", "decision-clock");
    clock.setAttribute("role", "timer");
    this.clocks.set(e.id, clock);
    const go = el("button", "decision-go", `Show ${where}`);
    go.type = "button";
    go.addEventListener("click", () => this.onGo({ kind: "city", id: e.settlement, at: e.at }));
    const top = el("div", "decision-top");
    top.append(title, go);
    box.append(top, el("p", "decision-text", decisionText(e, t)), clock);
    const choices = decisionChoices(e, t);
    if (e.chosen !== null) {
      const c = choices.find((x) => x.id === e.chosen);
      box.append(el("p", "decision-chosen", `Decided: ${c?.title ?? e.chosen}. ${c?.words ?? ""}`.trim()));
      return box;
    }
    const list = el("div", "decision-choices");
    for (const c of choices) {
      const dry = chooseDecision(state, e.id, c.id, t);
      const button = el("button", "decision-choice");
      button.type = "button";
      button.dataset["choice"] = c.id;
      button.disabled = !dry.ok;
      button.append(el("span", "decision-choice-title", c.title), el("span", "decision-choice-cost", costWords(c)), el("span", "decision-choice-words", c.words));
      if (!dry.ok && dry.reason !== null) {
        button.title = dry.reason;
        button.append(el("span", "decision-choice-why", `Cannot: ${dry.reason}.`));
      }
      button.addEventListener("click", () => {
        const out = this.onChoose(e.id, c.id);
        this.notice = out.ok ? null : { id: e.id, text: `Not chosen: ${out.reason ?? "refused"}.` };
        this.key = "";
      });
      list.append(button);
    }
    box.append(list, el("p", "decision-default", `If you do nothing: ${defaultWords(e, t)}`));
    if (this.notice !== null && this.notice.id === e.id) box.append(el("p", "decision-notice", this.notice.text));
    return box;
  }

  clear(): void {
    this.key = "";
    this.clocks.clear();
    this.notice = null;
    this.list.replaceChildren();
    this.root.hidden = true;
  }
}
