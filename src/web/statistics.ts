/**
 * The statistics (Batch 31): "per city and per planet, over time:
 * population, each resource's production and use, power balance, credits,
 * the planet's axes".
 *
 * A screen over the world, from any view: the planet's record, or any
 * city's, chosen from a list. The charts are the planner's (`charts.ts`);
 * the records are the simulation's, kept in the save. It owns no state but
 * which record is showing.
 */

import type { SimState, Tuning } from "../sim/index.js";
import { chartFigure, cityCharts, planetCharts, planetSpan } from "./charts.js";
import { settlementLabel } from "./settlement-label.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const PLANET = "planet";

export class StatisticsScreen {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  private readonly picker: HTMLSelectElement;
  private readonly span: HTMLElement;
  private readonly body: HTMLElement;
  private subject = PLANET;
  private key = "";
  private pickerKey = "";
  private state: SimState | null = null;

  constructor(host: HTMLElement, private readonly tuning: Tuning, private readonly onOpen: () => void = () => {}) {
    this.toggle = el("button", "statistics-toggle", "Statistics");
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.addEventListener("click", () => this.setOpen(this.panel.hidden));
    this.panel = el("section", "statistics-panel");
    this.panel.setAttribute("aria-label", "Statistics");
    this.panel.hidden = true;
    const head = el("div", "statistics-head");
    this.picker = el("select", "statistics-picker");
    this.picker.setAttribute("aria-label", "Whose record");
    this.picker.addEventListener("change", () => this.show(this.picker.value));
    const close = el("button", "statistics-close", "Close");
    close.type = "button";
    close.addEventListener("click", () => this.setOpen(false));
    head.append(el("h2", "", "Statistics"), this.picker, close);
    this.span = el("p", "statistics-span");
    this.body = el("div", "statistics-charts");
    this.panel.append(head, this.span, this.body);
    host.append(this.toggle, this.panel);
  }

  setOpen(open: boolean, subject?: string): void {
    if (subject !== undefined) this.subject = subject;
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      this.onOpen();
      this.key = "";
      if (this.state !== null) this.render(this.state);
    }
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** Whose record is showing: PLANET, or a settlement's id. */
  get showing(): string {
    return this.subject;
  }

  /** Show this record (PLANET or a settlement's id). */
  show(subject: string): void {
    this.subject = subject;
    this.key = "";
    if (this.state !== null && this.isOpen) this.render(this.state);
  }

  update(state: SimState): void {
    this.state = state;
    if (this.isOpen) this.render(state);
  }

  private render(state: SimState): void {
    const standing = state.settlements.filter((s) => s.lostAtSeaLevelM === null);
    const pickerKey = standing.map((s) => `${s.id}:${settlementLabel(s)}`).join("|");
    if (pickerKey !== this.pickerKey) {
      this.pickerKey = pickerKey;
      this.picker.replaceChildren(
        Object.assign(document.createElement("option"), { value: PLANET, textContent: "The planet" }),
        ...standing.map((s) => Object.assign(document.createElement("option"), { value: s.id, textContent: settlementLabel(s) })),
      );
    }
    const city = standing.find((s) => s.id === this.subject);
    if (city === undefined) this.subject = PLANET;
    this.picker.value = this.subject;

    if (city === undefined) {
      const samples = state.history.samples;
      const key = `planet:${samples.length}:${samples[samples.length - 1]?.steps ?? -1}`;
      if (key === this.key) return;
      this.key = key;
      if (samples.length < 2) {
        this.span.textContent = "";
        this.body.replaceChildren(el("p", "statistics-empty", "The planet's record fills in as the game goes on."));
        return;
      }
      this.span.textContent = `${planetSpan(samples, this.tuning)} The planet as the instruments showed it.`;
      this.body.replaceChildren(...planetCharts(samples).map(chartFigure));
      return;
    }
    const samples = city.history.samples;
    const key = `${city.id}:${city.history.taken}`;
    if (key === this.key) return;
    this.key = key;
    if (samples.length < 2) {
      this.span.textContent = "";
      this.body.replaceChildren(el("p", "statistics-empty", "The record fills in as the years pass: a sample every year the city stands."));
      return;
    }
    this.span.textContent = `${settlementLabel(city)}: the last ${samples.length} years.`;
    this.body.replaceChildren(...cityCharts(samples).map(chartFigure));
  }
}
