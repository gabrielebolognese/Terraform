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
 * Nor is it what tells one line from another (Batch 36): in a chart of more
 * than one, each line has its own pattern, drawn again in its key and named
 * there, and each share of the year its own strip with its name on it.
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

/**
 * A line's pattern by its place in its chart: the first solid, then dashed,
 * dotted, dash-dot and long dashes - the five resources, the most a chart has.
 * Lengths in canvas pixels, the line 1.5 px wide.
 */
const PATTERNS: readonly { readonly name: string; readonly dash: readonly number[] }[] = [
  { name: "solid", dash: [] },
  { name: "dashed", dash: [6, 4] },
  { name: "dotted", dash: [1.5, 3] },
  { name: "dash-dot", dash: [8, 3, 1.5, 3] },
  { name: "long dashes", dash: [16, 4] },
];
/** The pattern of line `k` in a chart of `n`: one line alone is solid. */
const patternOf = (k: number, n: number): (typeof PATTERNS)[number] => (n > 1 ? PATTERNS[k % PATTERNS.length]! : PATTERNS[0]!);

export const fmt = (v: number): string => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en") : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG = "http://www.w3.org/2000/svg";

/** A key's sample of its line: a short stroke in the line's colour and pattern. */
function lineSwatch(colour: string, dash: readonly number[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "planner-chart-swatch");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "8");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(SVG, "line");
  for (const [k, v] of [["x1", "0"], ["y1", "4"], ["x2", "24"], ["y2", "4"], ["stroke", colour], ["stroke-width", "2"]]) line.setAttribute(k!, v!);
  if (dash.length > 0) line.setAttribute("stroke-dasharray", dash.join(" "));
  svg.append(line);
  return svg;
}

/**
 * A chart on the page: its title and unit, the canvas, and a key with each
 * line's latest value - and, in a chart of more than one line, a sample of
 * each line's pattern and its name.
 */
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
  const lines = c.bars !== true && c.series.length > 1;
  c.series.forEach((x, i) => {
    const pattern = patternOf(i, c.series.length);
    const k = el("span", "planner-chart-key", `${x.label}${lines ? ` (${pattern.name})` : ""}: ${fmt(x.values[x.values.length - 1] ?? 0)}`);
    if (c.bars === true) {
      const sw = el("span", "planner-swatch");
      sw.style.background = x.colour;
      k.prepend(sw);
    } else k.prepend(lineSwatch(x.colour, pattern.dash));
    keys.append(k);
  });
  fig.append(cap, canvas, keys);
  return fig;
}

/**
 * A small line chart into a canvas: every series on one scale, from zero
 * unless `fromLowest`, each line in its pattern. Or bars, for shares of the
 * year: each series in a strip of its own, top to bottom in the key's order,
 * its name on it - side by side, four to a year, each bar would be under a
 * pixel wide and told from the others by its colour alone.
 */
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
  if (bars) {
    drawStrips(ctx, series, count, w, h);
    return;
  }
  const x = (i: number): number => 4 + ((w - 8) * i) / Math.max(1, count - 1);
  const y = (v: number): number => h - 4 - ((h - 8) * (v - lo)) / (hi - lo);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(0, y(fromLowest ? lo : 0));
  ctx.lineTo(w, y(fromLowest ? lo : 0));
  ctx.stroke();
  series.forEach((s, k) => {
    ctx.strokeStyle = s.colour;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([...patternOf(k, series.length).dash]);
    ctx.beginPath();
    s.values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

/** Shares of the year, 0 to 1: a strip for each series, its baseline, its bars a year each, its name in its top corner. */
function drawStrips(ctx: CanvasRenderingContext2D, series: readonly Series[], count: number, w: number, h: number): void {
  const band = (h - 4) / Math.max(1, series.length);
  const slot = (w - 8) / Math.max(1, count);
  series.forEach((s, k) => {
    const top = 2 + k * band;
    const base = top + band - 2;
    const tall = band - 4;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.lineTo(w, base);
    ctx.stroke();
    ctx.fillStyle = s.colour;
    s.values.forEach((v, i) => {
      if (v <= 0) return;
      const t = Math.min(1, v) * tall;
      ctx.fillRect(4 + slot * i, base - t, Math.max(1, slot - 0.5), t);
    });
    // The name over its bars, outlined in the chart's ground so a full year does not hide it.
    ctx.font = "9px sans-serif";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#121317";
    ctx.strokeText(s.label, 6, top + 1);
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(s.label, 6, top + 1);
  });
}
