/**
 * The charts (Batch 31: "charts from the planner's existing ones, unified").
 *
 * One set of charts for every record the game keeps: a city's, which the
 * planner's Charts tab and the statistics both show, and the planet's, which
 * the statistics show. Each chart is built from the samples alone and drawn
 * the same way wherever it appears, so a city's population reads the same in
 * the planner as in the statistics.
 *
 * Every chart carries its numbers in words (the latest value of each line, in
 * its key and its canvas's label): colour is never the only signal (Batch 7).
 */

import type { HistorySample, PlanetSample, Tuning } from "../sim/index.js";
import { MICRO_RESOURCES } from "../sim/index.js";

/** A chart's line from a record: one value a sample. */
export interface Series {
  readonly label: string;
  readonly colour: string;
  readonly values: readonly number[];
}

export interface Chart {
  readonly title: string;
  readonly unit: string;
  readonly series: readonly Series[];
  /** Bars, for shares of the year. */
  readonly bars?: boolean;
  /** Its scale from the lowest value, not from zero: a temperature from 0 K is a flat line. */
  readonly fromLowest?: boolean;
}

/** The five resources, in `MICRO_RESOURCES` order: their names and colours, the same on every chart. */
export const RESOURCE_COLOURS: readonly string[] = ["#f2c94c", "#56a8f5", "#9be3f0", "#e38b4f", "#b8a48c"];
const NAMES = MICRO_RESOURCES.map((r) => r[0]!.toUpperCase() + r.slice(1));

/**
 * A city's charts, from its record: the planner's five, then what each
 * resource made and what was drawn of it - the power balance first. A record
 * from before made and drawn were kept charts them from the first sample that
 * has them, and leaves them out if none has.
 */
export function cityCharts(samples: readonly HistorySample[]): Chart[] {
  const pick = (f: (x: HistorySample) => number): number[] => samples.map(f);
  const out: Chart[] = [
    { title: "Population", unit: "people", series: [
      { label: "People", colour: "#7cc4ff", values: pick((x) => x.population) },
      { label: "Homes", colour: "#8a8f98", values: pick((x) => x.housing) },
    ] },
    { title: "Growth and deaths", unit: "people a year", series: [
      { label: "Born", colour: "#6fd08c", values: pick((x) => x.births) },
      { label: "Lost", colour: "#ef6b6b", values: pick((x) => x.deaths) },
    ] },
    { title: "Shortages - blackouts, hunger, thirst, suffocation", unit: "share of the year", bars: true, series: [
      { label: "Blackout (power)", colour: "#f2c94c", values: pick((x) => x.short[0] ?? 0) },
      { label: "Water", colour: "#56a8f5", values: pick((x) => x.short[1] ?? 0) },
      { label: "Oxygen", colour: "#9be3f0", values: pick((x) => x.short[2] ?? 0) },
      { label: "Food", colour: "#e38b4f", values: pick((x) => x.short[3] ?? 0) },
    ] },
    { title: "Stores", unit: "units", series: MICRO_RESOURCES.map((_r, i) => ({ label: NAMES[i]!, colour: RESOURCE_COLOURS[i]!, values: pick((x) => x.stores[i] ?? 0) })) },
    { title: "Made less drawn", unit: "a year", series: MICRO_RESOURCES.map((_r, i) => ({ label: NAMES[i]!, colour: RESOURCE_COLOURS[i]!, values: pick((x) => x.net[i] ?? 0) })) },
  ];
  const kept = samples.filter((x) => x.made !== undefined && x.drawn !== undefined);
  if (kept.length === 0) return out;
  MICRO_RESOURCES.forEach((_r, i) => {
    out.push({
      title: i === 0 ? "Power made and used - the power balance" : `${NAMES[i]} made and used`,
      unit: "a year",
      series: [
        { label: "Made", colour: RESOURCE_COLOURS[i]!, values: kept.map((x) => x.made![i] ?? 0) },
        { label: "Used", colour: "#ef6b6b", values: kept.map((x) => x.drawn![i] ?? 0) },
      ],
    });
  });
  return out;
}

/** The planet's charts, from its record: the six axes the HUD shows, progress, the bank and the people. */
export function planetCharts(samples: readonly PlanetSample[]): Chart[] {
  const pick = (f: (x: PlanetSample) => number): number[] => samples.map(f);
  const one = (title: string, unit: string, label: string, colour: string, f: (x: PlanetSample) => number, fromLowest = false): Chart => ({
    title,
    unit,
    series: [{ label, colour, values: pick(f) }],
    ...(fromLowest ? { fromLowest } : {}),
  });
  return [
    one("Temperature", "K", "Temperature", "#ef9a5a", (x) => x.T, true),
    one("Pressure", "mbar", "Pressure", "#c9b6ff", (x) => x.P),
    one("Oxygen", "mbar", "Oxygen", "#9be3f0", (x) => x.o2),
    one("Ocean", "% of the surface", "Ocean", "#56a8f5", (x) => x.ocean * 100),
    one("Biomass", "units", "Biomass", "#6fd08c", (x) => x.biomass),
    one("Carbon dioxide", "mbar", "Carbon dioxide", "#b8a48c", (x) => x.co2),
    one("Progress", "%", "Progress", "#7cc4ff", (x) => x.progress * 100),
    one("Credits", "credits", "Credits", "#f2c94c", (x) => x.credits),
    one("People", "in every settlement", "People", "#e6e6e6", (x) => x.people),
  ];
}

/** "From year 12 to year 340" - the span a planet's record covers, in the years the HUD counts. */
export function planetSpan(samples: readonly PlanetSample[], t: Tuning): string {
  if (samples.length === 0) return "";
  const year = (x: PlanetSample): string => Math.floor(x.steps * t.SUBSTEP_YEARS).toLocaleString("en");
  return `From year ${year(samples[0]!)} to year ${year(samples[samples.length - 1]!)}.`;
}

export const fmt = (v: number): string => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en") : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A chart on the page: its title and unit, the canvas, and a key with each line's latest value. */
export function chartFigure(c: Chart): HTMLElement {
  const fig = el("figure", "planner-chart");
  const canvas = el("canvas", "planner-chart-canvas");
  canvas.width = 340;
  canvas.height = 120;
  canvas.setAttribute("role", "img");
  const last = c.series.map((x) => `${x.label} ${fmt(x.values[x.values.length - 1] ?? 0)}`).join(", ");
  canvas.setAttribute("aria-label", `${c.title}: now ${last}`);
  drawChart(canvas, c.series, c.bars === true, c.fromLowest === true);
  const cap = el("figcaption", "planner-chart-title", `${c.title} (${c.unit})`);
  const keys = el("div", "planner-chart-keys");
  for (const x of c.series) {
    const k = el("span", "planner-chart-key", `${x.label}: ${fmt(x.values[x.values.length - 1] ?? 0)}`);
    const sw = el("span", "planner-swatch");
    sw.style.background = x.colour;
    k.prepend(sw);
    keys.append(k);
  }
  fig.append(cap, canvas, keys);
  return fig;
}

/** A small line chart (or bars, for shares of the year) into a canvas: every series on one scale, from zero unless `fromLowest`. */
export function drawChart(canvas: HTMLCanvasElement, series: readonly Series[], bars: boolean, fromLowest = false): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  let lo = fromLowest ? Infinity : 0;
  let hi = bars ? 1 : fromLowest ? -Infinity : 0;
  for (const s of series) for (const v of s.values) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
  if (hi - lo < 1e-9) hi = lo + 1;
  const count = Math.max(...series.map((s) => s.values.length));
  const x = (i: number): number => 4 + ((w - 8) * i) / Math.max(1, count - 1);
  const y = (v: number): number => h - 4 - ((h - 8) * (v - lo)) / (hi - lo);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(0, y(fromLowest ? lo : 0));
  ctx.lineTo(w, y(fromLowest ? lo : 0));
  ctx.stroke();
  if (bars) {
    const bw = (w - 8) / Math.max(1, count) / Math.max(1, series.length);
    series.forEach((s, k) => {
      ctx.fillStyle = s.colour;
      s.values.forEach((v, i) => {
        if (v <= 0) return;
        ctx.fillRect(4 + ((w - 8) * i) / count + k * bw, y(v), Math.max(1, bw - 0.5), y(0) - y(v));
      });
    });
    return;
  }
  for (const s of series) {
    ctx.strokeStyle = s.colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    s.values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
  }
}
