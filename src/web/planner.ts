/**
 * The city planner (at the user's request: "HUGE feature, the city planner:
 * I can see the planimetry of the city in 2D, I can assign zones and colour
 * zones, I can assign robots to flatten out an entire zone without me
 * manually clicking each, I can draw roads and power lines and they get
 * built. I need to be able to see population charts, blackouts, food
 * shortages, population growth and deaths, everything, in a professional city
 * planner - the second mode after the city view").
 *
 * A top-down map of the settlement, a tile a pixel scaled up: the ground by
 * its height, buildings by what they do, corridors, cables and rails, the
 * zones in their colours, what is planned and waiting. Tools draw zones and
 * links; the simulation builds and levels. Beside it, the zones, the charts
 * of the city's record, and an overview. It owns no state: like the city
 * view, each frame it is handed the settlement and asks the simulation, by
 * hooks, to change anything.
 */

import type { BuildingType, CityView, HabitatChannels, NeedId, PlannedLink, Settlement, Tuning } from "../sim/index.js";
import { BUILDING_DEFS, NAME_MAX, NEEDS, NEED_BY_ID, cityView, keyTile, needCoverage, roverCount, tileKey } from "../sim/index.js";
import { happinessWords, needLines } from "./needs-words.js";
import { settlementLabel } from "./settlement-label.js";
import { chartFigure, cityCharts, fmt } from "./charts.js";
import type { Settings } from "./settings.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { Pinch, wheelIntent } from "./gestures.js";
import type { Palette } from "./settings.js";
import type { MapKind } from "./palette.js";
import { MAP_PALETTES, zoneColour } from "./palette.js";

export interface PlannerHooks {
  readonly onRename: (id: string, name: string) => { ok: boolean; reason: string | null };
  readonly onZone: (id: string, edit: { id?: number; name?: string; colour?: string; add?: readonly number[]; remove?: readonly number[] }) => { ok: boolean; reason: string | null; zone: number | null };
  readonly onDeleteZone: (id: string, zone: number) => { ok: boolean; reason: string | null };
  readonly onLevelZone: (id: string, zone: number) => { ok: boolean; reason: string | null; queued: number };
  readonly onPlan: (id: string, layer: PlannedLink["layer"], tiles: readonly number[]) => { ok: boolean; reason: string | null; planned: number };
  readonly onCancelPlans: (id: string) => { ok: boolean; reason: string | null };
  /** Back to the 3D city view. */
  readonly onCityView: () => void;
}

export type PlannerTool = "pan" | "zone" | "erase" | "corridors" | "cables" | "rails";

/** Batch 32: the needs whose coverage the planner can show - those met in reach of homes. */
export const COVERAGE_NEEDS: readonly NeedId[] = NEEDS.filter((n) => n.reach).map((n) => n.id);

/** A coverage overlay: where a need's running providers reach, and which homes they reach. */
export interface CoverageOverlay {
  readonly squares: readonly { readonly index: number; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly running: boolean }[];
  readonly homes: readonly { readonly index: number; readonly reached: boolean }[];
}

/** The overlay's colours in the standard palette: the reach, homes reached, homes not reached, a provider (`palette.ts` has each palette's). */
export const COVERAGE_COLOURS = MAP_PALETTES.standard.coverage;

/** A need's coverage, from what the view says runs. */
export function coverageOf(s: Settlement, view: CityView, id: NeedId, t: Tuning): CoverageOverlay {
  return needCoverage(s, id, view.buildings.map((b) => b.operable), t);
}

/** What each building reads as on the map, by what it does, in the standard palette (`palette.ts` has each palette's). */
export const MAP_COLOURS = MAP_PALETTES.standard.kinds;

/** What each kind is called, in the legend and under the pointer. */
export const MAP_KIND_NAMES: Readonly<Record<MapKind, string>> = {
  home: "Homes and life support",
  green: "Parks and biospheres",
  power: "Power",
  industry: "Industry and stores",
  civic: "Research",
  commerce: "Commerce",
  port: "Port and stations",
  hq: "Headquarters",
};

/**
 * The patterns that tell the map's colours apart without colour (Batch 36),
 * a tile a pixel: a power line dashed, a railway striped (its tiles alternate
 * dark and light), a plan dotted (every other tile marked strongly), a home
 * no service reaches hatched, a zone outlined.
 */
const PLANNED_MIX = { strong: 0.85, faint: 0.3 } as const;
const ZONE_MIX = { inside: 0.45, edge: 0.85 } as const;
/** How dark the off tiles of a dash, a stripe or a hatch are drawn. */
const PATTERN_SHADE = 0.55;

const CORRIDOR_RGB = [226, 228, 232] as const;
const CABLE_RGB = [246, 206, 60] as const;
const BOTH_RGB = [238, 226, 170] as const;
const RAIL_RGB = [120, 84, 60] as const;
const RAIL_LIGHT_RGB = [196, 160, 128] as const;
const PLAN_RGB = { cables: [255, 160, 40], rails: [200, 120, 90], corridors: [255, 110, 200] } as const;
const LEVEL_RGB = [90, 220, 230] as const;

const shaded = (c: readonly [number, number, number] | readonly number[], k: number): [number, number, number] => [c[0]! * k, c[1]! * k, c[2]! * k];

export function mapKind(type: BuildingType): MapKind {
  if (type === "headquarters") return "hq";
  if (type === "park" || type === "biosphere") return "green";
  if (type === "mega_mall") return "commerce";
  if (type === "wind_turbine" || type === "battery_bank") return "power";
  if (type === "habitat_dome" || type === "skyscraper" || type === "greenhouse" || type === "algae_reactor" || type === "medical_center") return "home";
  if (type === "solar_array" || type === "geothermal_plant" || type === "reactor") return "power";
  if (type === "spaceport" || type === "station") return "port";
  if (type === "laboratory" || type === "observatory" || type === "research_forum") return "civic";
  return "industry";
}

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/**
 * The map, a tile a pixel, row-major RGBA over the frame: the ground (by
 * height; steep darker; land not the city's dimmed), then zones washed in
 * their colour, corridors, cables and rails, buildings on top, and what is
 * planned or waiting for a rover marked. Pure: tested without a canvas.
 */
export function plannerPixels(view: CityView, s: Settlement, coverage: CoverageOverlay | null = null, palette: Palette = "standard"): Uint8ClampedArray<ArrayBuffer> {
  const pal = MAP_PALETTES[palette];
  const n = view.tiles;
  /** The "off" tiles of a dash, a stripe, a dot or a hatch: every other tile, in a checker. */
  const odd = (i: number): boolean => ((i % n) + Math.floor(i / n)) % 2 === 1;
  const px = new Uint8ClampedArray(new ArrayBuffer(n * n * 4));
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of view.heightM) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const span = Math.max(1, hi - lo);
  const set = (i: number, c: readonly [number, number, number], mix = 1): void => {
    for (let k = 0; k < 3; k += 1) px[i * 4 + k] = px[i * 4 + k]! * (1 - mix) + c[k]! * mix;
    px[i * 4 + 3] = 255;
  };
  for (let i = 0; i < n * n; i += 1) {
    const f = ((view.heightM[i] ?? 0) - lo) / span;
    let c: [number, number, number] = [70 + 70 * f, 48 + 50 * f, 38 + 40 * f];
    if (view.steep[i]) c = [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];
    if (view.rocks[i] === "crag") c = [110, 104, 100];
    if (view.claimed[i] !== true) c = [c[0] * 0.45, c[1] * 0.45, c[2] * 0.5];
    set(i, c);
  }
  const at = (k: number): number => {
    const { tx, ty } = keyTile(k);
    return tx < n && ty < n ? ty * n + tx : -1;
  };
  for (const z of s.zones) {
    const c = hex(zoneColour(z.colour, palette));
    // Its edge drawn strongly: two zones side by side read as two without their colours.
    const mine = new Set(z.tiles);
    for (const k of z.tiles) {
      const i = at(k);
      if (i < 0) continue;
      const { tx, ty } = keyTile(k);
      const edge = !mine.has(tileKey(tx - 1, ty)) || !mine.has(tileKey(tx + 1, ty)) || !mine.has(tileKey(tx, ty - 1)) || !mine.has(tileKey(tx, ty + 1));
      set(i, c, edge ? ZONE_MIX.edge : ZONE_MIX.inside);
    }
  }
  for (let i = 0; i < n * n; i += 1) {
    const corridor = view.corridors[i] === true;
    const cable = view.cables[i] === true;
    // A corridor solid; a power line dashed, over a corridor or not; a railway striped.
    if (corridor && cable) set(i, odd(i) ? shaded(BOTH_RGB, PATTERN_SHADE) : BOTH_RGB);
    else if (corridor) set(i, CORRIDOR_RGB);
    else if (cable) set(i, odd(i) ? shaded(CABLE_RGB, PATTERN_SHADE) : CABLE_RGB);
    if (view.rails?.[i] === true) set(i, odd(i) ? RAIL_LIGHT_RGB : RAIL_RGB);
  }
  for (const q of s.levelQueue) {
    const i = at(q.tile);
    if (i >= 0) set(i, LEVEL_RGB, 0.55);
  }
  for (const p of s.planned) {
    const i = at(p.tile);
    // Dotted: what is planned, not laid.
    if (i >= 0) set(i, PLAN_RGB[p.layer], odd(i) ? PLANNED_MIX.faint : PLANNED_MIX.strong);
  }
  for (const b of view.buildings) {
    const c = pal.kinds[mapKind(b.type)];
    const d = b.depth ?? b.size;
    for (let y = b.ty; y < b.ty + d; y += 1) {
      for (let x = b.tx; x < b.tx + b.size; x += 1) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        // An outline a shade darker, so blocks wall to wall still read as buildings.
        const edge = x === b.tx || y === b.ty || x === b.tx + b.size - 1 || y === b.ty + d - 1;
        set(y * n + x, edge ? [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7] : c);
      }
    }
  }
  if (coverage !== null) {
    // Batch 32: the ground a running provider reaches washed green, its own footprint white; the homes over it,
    // green where one reaches them and red where none does - the gaps.
    const cov = pal.coverage;
    for (const q of coverage.squares) {
      if (!q.running) continue;
      for (let y = Math.max(0, Math.ceil(q.y0)); y < Math.min(n, Math.ceil(q.y1)); y += 1) for (let x = Math.max(0, Math.ceil(q.x0)); x < Math.min(n, Math.ceil(q.x1)); x += 1) set(y * n + x, cov.reach, 0.3);
    }
    const paint = (index: number, c: readonly [number, number, number], hatched = false): void => {
      const b = view.buildings[index];
      if (b === undefined) return;
      const d = b.depth ?? b.size;
      for (let y = b.ty; y < b.ty + d; y += 1) for (let x = b.tx; x < b.tx + b.size; x += 1) if (x >= 0 && y >= 0 && x < n && y < n) set(y * n + x, hatched && odd(y * n + x) ? shaded(c, PATTERN_SHADE) : c);
    };
    // A home no one reaches is hatched as well as coloured: the gaps read without colour.
    for (const h of coverage.homes) paint(h.index, h.reached ? cov.reached : cov.gap, !h.reached);
    for (const q of coverage.squares) paint(q.index, cov.provider);
  }
  return px;
}

/** The tiles of a rectangle between two corners, inclusive. */
export function rectTiles(a: { tx: number; ty: number }, b: { tx: number; ty: number }): number[] {
  const out: number[] = [];
  for (let y = Math.min(a.ty, b.ty); y <= Math.max(a.ty, b.ty); y += 1) for (let x = Math.min(a.tx, b.tx); x <= Math.max(a.tx, b.tx); x += 1) out.push(tileKey(x, y));
  return out;
}

/** A line drawn from one tile to another: along the longer way first, then the shorter - an L, tile by tile. */
export function lineTiles(a: { tx: number; ty: number }, b: { tx: number; ty: number }): number[] {
  const out: number[] = [];
  const alongX = Math.abs(b.tx - a.tx) >= Math.abs(b.ty - a.ty);
  const step = (from: number, to: number): number[] => {
    const d = Math.sign(to - from);
    const list: number[] = [];
    for (let v = from; ; v += d) {
      list.push(v);
      if (v === to || d === 0) break;
    }
    return list;
  };
  if (alongX) {
    for (const x of step(a.tx, b.tx)) out.push(tileKey(x, a.ty));
    for (const y of step(a.ty, b.ty).slice(1)) out.push(tileKey(b.tx, y));
  } else {
    for (const y of step(a.ty, b.ty)) out.push(tileKey(a.tx, y));
    for (const x of step(a.tx, b.tx).slice(1)) out.push(tileKey(x, b.ty));
  }
  return out;
}

/** The planner's charts are the statistics' (Batch 31): one set, `charts.ts`. */
export { cityCharts as charts } from "./charts.js";
export type { Series } from "./charts.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}


const TOOLS: readonly { tool: PlannerTool; label: string; hint: string }[] = [
  { tool: "pan", label: "Move", hint: "Drag to move the map; the wheel zooms." },
  { tool: "zone", label: "Paint zone", hint: "Drag a rectangle to add it to the selected zone (a new zone if none is selected)." },
  { tool: "erase", label: "Erase zone", hint: "Drag a rectangle to take it out of the selected zone." },
  { tool: "corridors", label: "Road (corridor)", hint: "Drag from one tile to another: a corridor along it is planned, and crews build it as materials allow." },
  { tool: "cables", label: "Power line", hint: "Drag from one tile to another: a power cable is planned and built." },
  { tool: "rails", label: "Railway", hint: "Drag from one tile to another: a railway is planned and built. Stations on one line join their districts." },
];

export class PlannerScreen {
  readonly root: HTMLElement;
  private readonly map: HTMLCanvasElement;
  private readonly nameInput: HTMLInputElement;
  private readonly where: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly toolButtons = new Map<PlannerTool, HTMLButtonElement>();
  private readonly zoneList: HTMLElement;
  private readonly chartBox: HTMLElement;
  private readonly overview: HTMLElement;
  private readonly tabs = new Map<string, { button: HTMLButtonElement; panel: HTMLElement }>();
  private id: string | null = null;
  private settlement: Settlement | null = null;
  private view: CityView | null = null;
  private viewAt = -Infinity;
  private viewKey: unknown[] = [];
  tool: PlannerTool = "pan";
  /** The zone the paint and erase tools work on. */
  selectedZone: number | null = null;
  private scale = 0;
  private ox = 0;
  private oy = 0;
  private drag: { x: number; y: number; from: { tx: number; ty: number } | null; to: { tx: number; ty: number } | null } | null = null;
  private notice: string | null = null;
  private panelAt = -Infinity;
  private zonesKey = "";
  private chartsKey = -1;
  private tab = "zones";
  /** Batch 32: the need whose coverage is shown over the map, or null for none. */
  coverage: NeedId | null = null;
  private readonly coverageBar: HTMLElement;
  private readonly coverageButtons = new Map<NeedId | "none", HTMLButtonElement>();

  /** The player's settings (Batch 36): the wheel's way, two fingers, the colours. Read as it is used. */
  prefs: () => Settings = () => DEFAULT_SETTINGS;
  /** Two fingers on the map: a pinch zooms. */
  private readonly pinch = new Pinch();
  private readonly legend: HTMLElement;
  private readonly under: HTMLElement;
  /** The palette the legend and the map's pixels were made in. */
  private legendPalette: Palette | null = null;
  private pixelsPalette: Palette = "standard";

  constructor(
    host: HTMLElement,
    private readonly hooks: PlannerHooks,
    private readonly tuning: Tuning,
  ) {
    this.root = el("div", "planner");
    this.root.hidden = true;
    const top = el("header", "planner-top");
    this.nameInput = el("input", "planner-name");
    this.nameInput.type = "text";
    this.nameInput.maxLength = NAME_MAX;
    this.nameInput.setAttribute("aria-label", "The settlement's name");
    this.nameInput.addEventListener("change", () => this.rename());
    this.where = el("span", "planner-where", "");
    top.append(button("planner-city", "City view", () => this.hooks.onCityView()), el("span", "planner-mode", "City planner"), this.nameInput, this.where);

    const tools = el("div", "planner-tools");
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", "Planner tools");
    for (const t of TOOLS) {
      const b = button("planner-tool", t.label, () => this.setTool(t.tool));
      b.dataset["tool"] = t.tool;
      b.title = t.hint;
      this.toolButtons.set(t.tool, b);
      tools.append(b);
    }
    tools.append(button("planner-cancel", "Cancel plans", () => this.cancelPlans()));

    // Batch 32: where each service reaches, and the gaps - shown with needs on.
    this.coverageBar = el("div", "planner-coverage");
    this.coverageBar.setAttribute("role", "toolbar");
    this.coverageBar.setAttribute("aria-label", "Coverage");
    this.coverageBar.hidden = true;
    this.coverageBar.append(el("span", "planner-coverage-label", "Coverage:"));
    for (const id of ["none", ...COVERAGE_NEEDS] as const) {
      const b = button("planner-coverage-button", id === "none" ? "Off" : NEED_BY_ID[id].name, () => this.showCoverage(id === "none" ? null : id));
      b.dataset["need"] = id;
      b.title = id === "none" ? "Hide the coverage." : `Where ${NEED_BY_ID[id].meets.replace(/ in reach of the homes$/, "")} reach${NEED_BY_ID[id].providers.length > 1 ? "" : "es"}: homes reached in green, homes no one reaches in red.`;
      this.coverageButtons.set(id, b);
      this.coverageBar.append(b);
    }

    const stage = el("div", "planner-stage");
    this.map = el("canvas", "planner-map");
    this.map.setAttribute("aria-label", "The settlement from above: its ground, buildings, corridors, cables, railways and zones.");
    stage.append(this.map);
    this.hint = el("p", "planner-hint", "");
    this.hint.setAttribute("role", "status");

    const side = el("aside", "planner-side");
    const tabRow = el("div", "planner-tabs");
    tabRow.setAttribute("role", "tablist");
    this.zoneList = el("div", "planner-zones");
    this.chartBox = el("div", "planner-charts");
    this.overview = el("div", "planner-overview");
    for (const [key, label, panel] of [["zones", "Zones", this.zoneList], ["charts", "Charts", this.chartBox], ["overview", "Overview", this.overview]] as const) {
      const b = button("planner-tab", label, () => this.showTab(key));
      b.setAttribute("role", "tab");
      b.dataset["tab"] = key;
      tabRow.append(b);
      panel.setAttribute("role", "tabpanel");
      this.tabs.set(key, { button: b, panel });
    }
    side.append(tabRow, this.zoneList, this.chartBox, this.overview);

    this.legend = el("div", "planner-legend");
    // Batch 36: what is under the pointer, in words - every colour on the map named.
    this.under = el("p", "planner-under", "");
    this.root.append(top, tools, this.coverageBar, stage, this.hint, this.under, this.legend, side);
    this.renderLegend("standard");
    host.append(this.root);
    this.showTab("zones");
    this.setTool("pan");
    this.showCoverage(null);
    this.bindInput();
  }

  get openId(): string | null {
    return this.id;
  }

  /**
   * The legend, in the player's palette: each kind of building with its
   * colour, and each pattern with what it means (Batch 36).
   */
  private renderLegend(palette: Palette): void {
    if (this.legendPalette === palette) return;
    this.legendPalette = palette;
    const kinds = MAP_PALETTES[palette].kinds;
    const cov = MAP_PALETTES[palette].coverage;
    const items: HTMLElement[] = [];
    for (const k of Object.keys(MAP_KIND_NAMES) as MapKind[]) {
      const item = el("span", "planner-legend-item", MAP_KIND_NAMES[k]);
      item.dataset["kind"] = k;
      const sw = el("span", "planner-swatch");
      sw.style.background = `rgb(${kinds[k].join(",")})`;
      item.prepend(sw);
      items.push(item);
    }
    const pattern = (label: string, key: string, a: readonly number[], b: readonly number[]): HTMLElement => {
      const item = el("span", "planner-legend-item", label);
      item.dataset["pattern"] = key;
      const sw = el("span", "planner-swatch planner-swatch-pattern");
      sw.style.background = `repeating-linear-gradient(90deg, rgb(${a.join(",")}) 0 4px, rgb(${b.map((v) => Math.round(v)).join(",")}) 4px 8px)`;
      item.prepend(sw);
      return item;
    };
    items.push(
      pattern("Corridor (solid)", "corridor", CORRIDOR_RGB, CORRIDOR_RGB),
      pattern("Power line (dashed)", "cable", CABLE_RGB, shaded(CABLE_RGB, PATTERN_SHADE)),
      pattern("Railway (striped)", "rail", RAIL_RGB, RAIL_LIGHT_RGB),
      pattern("Planned (dotted)", "planned", PLAN_RGB.corridors, [40, 40, 44]),
      pattern("Home a service misses (hatched)", "gap", cov.gap, shaded(cov.gap, PATTERN_SHADE)),
      pattern("Zone (outlined)", "zone", [230, 230, 230], [90, 90, 96]),
    );
    this.legend.replaceChildren(...items);
  }

  /**
   * What is on a tile, in words (Batch 36): the building and what it does,
   * the zone, the links laid and planned, levelling, and with the overlay on
   * whether a service reaches the home - every colour on the map, named.
   */
  describeTile(tx: number, ty: number): string {
    const view = this.view;
    const s = this.settlement;
    if (view === null || s === null) return "";
    const n = view.tiles;
    if (tx < 0 || ty < 0 || tx >= n || ty >= n) return "";
    const i = ty * n + tx;
    const k = tileKey(tx, ty);
    const parts: string[] = [];
    const bIndex = view.buildings.findIndex((b) => tx >= b.tx && ty >= b.ty && tx < b.tx + b.size && ty < b.ty + (b.depth ?? b.size));
    const b = bIndex >= 0 ? view.buildings[bIndex]! : null;
    if (b !== null) parts.push(`${BUILDING_DEFS[b.type].name} (${MAP_KIND_NAMES[mapKind(b.type)].toLowerCase()})`);
    const zone = s.zones.find((z) => z.tiles.includes(k));
    if (zone !== undefined) parts.push(`zone "${zone.name}"`);
    if (view.corridors[i] === true) parts.push("corridor");
    if (view.cables[i] === true) parts.push("power line");
    if (view.rails?.[i] === true) parts.push("railway");
    for (const p of s.planned) if (p.tile === k) parts.push(`${p.layer === "cables" ? "power line" : p.layer === "rails" ? "railway" : "corridor"} planned`);
    if (s.levelQueue.some((q) => q.tile === k)) parts.push("waiting to be levelled");
    if (this.coverage !== null && b !== null && (view.needs ?? null) !== null) {
      const cov = coverageOf(s, view, this.coverage, this.tuning);
      const name = NEED_BY_ID[this.coverage].name.toLowerCase();
      const home = cov.homes.find((h) => h.index === bIndex);
      if (home !== undefined) parts.push(home.reached ? `a home ${name} reaches` : `a home no ${name} reaches`);
      if (cov.squares.some((q) => q.index === bIndex)) parts.push(`gives ${name}`);
    }
    if (parts.length === 0) parts.push(view.claimed[i] !== true ? "land not the city's" : view.rocks[i] === "crag" ? "a crag" : view.steep[i] ? "steep ground" : "open ground");
    return `Here: ${parts.join(", ")}.`;
  }

  open(id: string): void {
    this.id = id;
    this.view = null;
    this.scale = 0;
    this.selectedZone = null;
    this.notice = null;
    this.zonesKey = "";
    this.chartsKey = -1;
    this.root.hidden = false;
  }

  close(): void {
    this.id = null;
    this.root.hidden = true;
    this.settlement = null;
    this.view = null;
  }

  setTool(tool: PlannerTool): void {
    this.tool = tool;
    for (const [t, b] of this.toolButtons) b.setAttribute("aria-pressed", String(t === tool));
    this.notice = null;
    this.hint.textContent = TOOLS.find((t) => t.tool === tool)?.hint ?? "";
  }

  /** Show a need's coverage over the map, or none. */
  showCoverage(id: NeedId | null): void {
    this.coverage = id;
    for (const [k, b] of this.coverageButtons) b.setAttribute("aria-pressed", String(k === (id ?? "none")));
    this.pixels = null;
  }

  /** Say what happened, at once - not at the panel's next refresh. */
  private say(text: string): void {
    this.notice = text;
    this.hint.textContent = text;
  }

  showTab(key: string): void {
    this.tab = key;
    for (const [k, { button: b, panel }] of this.tabs) {
      b.setAttribute("aria-selected", String(k === key));
      panel.hidden = k !== key;
    }
    this.chartsKey = -1;
    this.panelAt = -Infinity;
  }

  /** One frame: the map, and a few times a second the side panel. */
  frame(s: Settlement, env: HabitatChannels, now: number): void {
    if (this.id !== s.id) return;
    this.settlement = s;
    const key = [s.buildings, s.corridors, s.cables, s.rails, s.zones, s.planned, s.levelQueue, s.grades, s.cleared, s.claims];
    if (this.view === null || now - this.viewAt > 1000 || key.some((k, i) => k !== this.viewKey[i])) {
      this.view = cityView(s, env, this.tuning);
      this.viewAt = now;
      this.viewKey = key;
      this.pixels = null;
    }
    // The coverage bar with needs on (Batch 32); the overlay with it, remade with the view.
    this.coverageBar.hidden = (this.view.needs ?? null) === null;
    this.draw(this.view, s);
    if (now - this.panelAt > 250) {
      this.panelAt = now;
      this.renderPanel(this.view, s);
    }
  }

  private pixels: Uint8ClampedArray<ArrayBuffer> | null = null;
  private image: HTMLCanvasElement | null = null;

  private draw(view: CityView, s: Settlement): void {
    const rect = this.map.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || 800));
    const h = Math.max(1, Math.round(rect.height || 600));
    if (this.map.width !== w || this.map.height !== h) {
      this.map.width = w;
      this.map.height = h;
    }
    const n = view.tiles;
    if (this.scale === 0) {
      this.scale = Math.max(1, Math.min(w, h) / n);
      this.ox = (w - n * this.scale) / 2;
      this.oy = (h - n * this.scale) / 2;
    }
    const ctx = this.map.getContext("2d");
    if (ctx === null) return;
    const palette = this.prefs().ui.palette;
    this.renderLegend(palette);
    if (this.pixels === null || this.image === null || this.image.width !== n || this.pixelsPalette !== palette) {
      const coverage = this.coverage !== null && (view.needs ?? null) !== null ? coverageOf(s, view, this.coverage, this.tuning) : null;
      this.pixels = plannerPixels(view, s, coverage, palette);
      this.pixelsPalette = palette;
      this.image ??= document.createElement("canvas");
      this.image.width = n;
      this.image.height = n;
      const ic = this.image.getContext("2d");
      if (ic !== null) ic.putImageData(new ImageData(this.pixels, n, n), 0, 0);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#14161a";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.image, this.ox, this.oy, n * this.scale, n * this.scale);
    // Close in, a tile grid.
    if (this.scale >= 10) {
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= n; k += 1) {
        ctx.moveTo(this.ox + k * this.scale, this.oy);
        ctx.lineTo(this.ox + k * this.scale, this.oy + n * this.scale);
        ctx.moveTo(this.ox, this.oy + k * this.scale);
        ctx.lineTo(this.ox + n * this.scale, this.oy + k * this.scale);
      }
      ctx.stroke();
    }
    // What is being drawn, before it is let go.
    const d = this.drag;
    if (d !== null && d.from !== null && d.to !== null && this.tool !== "pan") {
      const tiles = this.tool === "zone" || this.tool === "erase" ? rectTiles(d.from, d.to) : lineTiles(d.from, d.to);
      ctx.fillStyle = this.tool === "erase" ? "rgba(255,80,80,0.45)" : this.tool === "zone" ? "rgba(255,255,255,0.35)" : "rgba(255,110,200,0.7)";
      for (const k of tiles) {
        const { tx, ty } = keyTile(k);
        ctx.fillRect(this.ox + tx * this.scale, this.oy + ty * this.scale, Math.max(1, this.scale), Math.max(1, this.scale));
      }
    }
  }

  /** The tile under a point of the map, or null off it. */
  tileAt(px: number, py: number): { tx: number; ty: number } | null {
    const n = this.view?.tiles ?? 0;
    if (this.scale <= 0) return null;
    const tx = Math.floor((px - this.ox) / this.scale);
    const ty = Math.floor((py - this.oy) / this.scale);
    return tx >= 0 && ty >= 0 && tx < n && ty < n ? { tx, ty } : null;
  }

  private bindInput(): void {
    const m = this.map;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = m.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    m.addEventListener("pointerdown", (e) => {
      m.setPointerCapture?.(e.pointerId);
      if (this.pinch.down(e)) {
        this.drag = null;
        return;
      }
      const p = local(e);
      const t = this.tileAt(p.x, p.y);
      this.drag = { x: p.x, y: p.y, from: t, to: t };
    });
    m.addEventListener("pointermove", (e) => {
      const two = this.pinch.move(e);
      if (two !== null) {
        const p = local({ clientX: two.x, clientY: two.y });
        this.zoomAbout(two.factor, p.x, p.y);
        this.ox += two.dx;
        this.oy += two.dy;
        return;
      }
      const d = this.drag;
      if (d === null) {
        const p = local(e);
        const t = this.tileAt(p.x, p.y);
        this.under.textContent = t === null ? "" : this.describeTile(t.tx, t.ty);
        return;
      }
      const p = local(e);
      if (this.tool === "pan" || e.buttons === 4) {
        this.ox += p.x - d.x;
        this.oy += p.y - d.y;
        d.x = p.x;
        d.y = p.y;
        return;
      }
      d.to = this.tileAt(p.x, p.y) ?? d.to;
    });
    m.addEventListener("pointercancel", (e) => {
      this.pinch.up(e);
      this.drag = null;
    });
    m.addEventListener("pointerup", (e) => {
      this.pinch.up(e);
      const d = this.drag;
      this.drag = null;
      if (d === null || d.from === null || d.to === null || this.tool === "pan") return;
      this.apply(d.from, d.to);
    });
    m.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = local(e);
        // Batch 36: the wheel's way, a trackpad's pinch, or two fingers moving the map.
        const intent = wheelIntent(e, this.prefs().controls);
        if ("pan" in intent) {
          this.ox += intent.pan.dx;
          this.oy += intent.pan.dy;
        } else this.zoomAbout(Math.exp(-intent.zoom * 0.0015), p.x, p.y);
      },
      { passive: false },
    );
  }

  /** Zoom by `factor`, keeping the point (px, py) of the map where it is. */
  private zoomAbout(factor: number, px: number, py: number): void {
    const next = Math.min(64, Math.max(0.5, this.scale * factor));
    this.ox = px - ((px - this.ox) * next) / this.scale;
    this.oy = py - ((py - this.oy) * next) / this.scale;
    this.scale = next;
  }

  /** The keys (Batch 36): move the map by screen pixels - positive is right and down - or zoom about its middle. */
  nudge(dx: number, dy: number): void {
    this.ox -= dx;
    this.oy -= dy;
  }

  zoomStep(factor: number): void {
    const r = this.map.getBoundingClientRect();
    this.zoomAbout(factor, r.width / 2, r.height / 2);
  }

  /** Where the map stands: its offset and scale, for a test to read. */
  get placement(): { readonly ox: number; readonly oy: number; readonly scale: number } {
    return { ox: this.ox, oy: this.oy, scale: this.scale };
  }

  /** A drag let go: the zone painted or erased, the link planned. */
  apply(from: { tx: number; ty: number }, to: { tx: number; ty: number }): void {
    const id = this.id;
    if (id === null) return;
    if (this.tool === "zone" || this.tool === "erase") {
      const tiles = rectTiles(from, to);
      if (this.tool === "erase") {
        if (this.selectedZone === null) {
          this.say("Select a zone to erase from.");
        } else this.hooks.onZone(id, { id: this.selectedZone, remove: tiles });
      } else {
        const o = this.hooks.onZone(id, this.selectedZone === null ? { add: tiles } : { id: this.selectedZone, add: tiles });
        if (o.ok) this.selectedZone = o.zone;
        else this.say(`Cannot paint: ${o.reason ?? "refused"}.`);
      }
    } else if (this.tool === "corridors" || this.tool === "cables" || this.tool === "rails") {
      const o = this.hooks.onPlan(id, this.tool, lineTiles(from, to));
      const noun = this.tool === "corridors" ? "corridor" : this.tool === "cables" ? "power line" : "railway";
      this.say(o.ok ? `Planned ${o.planned} tile${o.planned === 1 ? "" : "s"} of ${noun}: crews lay it as materials allow.` : `Nothing planned: ${o.reason ?? "refused"}.`);
    }
    this.zonesKey = "";
    this.panelAt = -Infinity;
  }

  private rename(): void {
    const id = this.id;
    if (id === null) return;
    const o = this.hooks.onRename(id, this.nameInput.value);
    if (!o.ok) this.say(`Cannot rename: ${o.reason ?? "refused"}.`);
  }

  private cancelPlans(): void {
    const id = this.id;
    if (id === null) return;
    this.hooks.onCancelPlans(id);
    this.say("Plans cancelled: what is not built yet will not be, and the rovers' queue is cleared.");
  }

  private renderPanel(view: CityView, s: Settlement): void {
    if (document.activeElement !== this.nameInput) {
      this.nameInput.value = s.name;
      this.nameInput.placeholder = settlementLabel({ ...s, name: "" });
    }
    this.where.textContent = `${view.tiles} x ${view.tiles} tiles, ${Math.floor(s.population).toLocaleString("en")} people`;
    if (this.notice !== null) this.hint.textContent = this.notice;
    if (this.tab === "zones") this.renderZones(s);
    if (this.tab === "charts") this.renderCharts(s);
    if (this.tab === "overview") this.renderOverview(view, s);
  }

  private renderZones(s: Settlement): void {
    const key = JSON.stringify([s.zones.map((z) => [z.id, z.name, z.colour, z.tiles.length]), this.selectedZone, s.levelQueue.length]);
    if (key === this.zonesKey) return;
    this.zonesKey = key;
    const id = this.id!;
    const rows = s.zones.map((z) => {
      const row = el("div", "planner-zone");
      row.dataset["zone"] = String(z.id);
      row.setAttribute("aria-selected", String(this.selectedZone === z.id));
      const colour = el("input", "planner-zone-colour");
      colour.type = "color";
      colour.value = z.colour;
      colour.setAttribute("aria-label", `${z.name}'s colour`);
      colour.addEventListener("change", () => this.hooks.onZone(id, { id: z.id, colour: colour.value }));
      const name = el("input", "planner-zone-name");
      name.type = "text";
      name.value = z.name;
      name.maxLength = NAME_MAX;
      name.setAttribute("aria-label", "Zone name");
      name.addEventListener("change", () => this.hooks.onZone(id, { id: z.id, name: name.value }));
      const select = button("planner-zone-select", this.selectedZone === z.id ? "Selected" : "Select", () => {
        this.selectedZone = z.id;
        this.zonesKey = "";
      });
      const level = button("planner-zone-level", "Level it", () => {
        const o = this.hooks.onLevelZone(id, z.id);
        this.say(o.ok ? `${o.queued} tile${o.queued === 1 ? "" : "s"} of ${z.name} queued for the rovers: one goes out whenever a rover is free.` : `Cannot level ${z.name}: ${o.reason ?? "refused"}.`);
      });
      const del = button("planner-zone-delete", "Delete", () => {
        this.hooks.onDeleteZone(id, z.id);
        if (this.selectedZone === z.id) this.selectedZone = null;
        this.zonesKey = "";
      });
      row.append(colour, name, el("span", "planner-zone-size", `${z.tiles.length} tiles`), select, level, del);
      return row;
    });
    const add = button("planner-zone-new", "New zone", () => {
      this.selectedZone = null;
      this.setTool("zone");
      this.say("Drag a rectangle on the map: it becomes a new zone.");
    });
    const queue = el("p", "planner-queue", s.levelQueue.length > 0 ? `${s.levelQueue.length} tiles waiting for a rover to level them.` : "No tiles waiting for the rovers.");
    this.zoneList.replaceChildren(...rows, add, queue);
  }

  private renderCharts(s: Settlement): void {
    if (s.history.taken === this.chartsKey) return;
    this.chartsKey = s.history.taken;
    const samples = s.history.samples;
    if (samples.length < 2) {
      this.chartBox.replaceChildren(el("p", "planner-empty", "The record fills in as the years pass: a sample every year the city stands."));
      return;
    }
    const figures = cityCharts(samples).map(chartFigure);
    this.chartBox.replaceChildren(el("p", "planner-chart-span", `The last ${samples.length} years.`), ...figures);
  }

  private renderOverview(view: CityView, s: Settlement): void {
    const counts = new Map<string, number>();
    for (const b of s.buildings) counts.set(BUILDING_DEFS[b.type].name, (counts.get(BUILDING_DEFS[b.type].name) ?? 0) + 1);
    const rovers = s.jobs.filter((j) => j.kind !== "rocket").length;
    const last = s.history.samples[s.history.samples.length - 1];
    const lines: [string, string][] = [
      ["People", `${Math.floor(s.population).toLocaleString("en")} of ${Math.round(view.housing).toLocaleString("en")} homes`],
      [(view.needs ?? null) !== null ? "Life support" : "Needs", view.shortages.length === 0 ? (view.needs ?? null) !== null ? "all of it met" : "every need met" : `short of ${view.shortages.join(", ")}`],
      ["Last year", last === undefined ? "no record yet" : `${fmt(last.births)} born, ${fmt(last.deaths)} lost; blackout ${Math.round((last.short[0] ?? 0) * 100)}% of the year, food short ${Math.round((last.short[3] ?? 0) * 100)}%`],
      ["Buildings", `${s.buildings.length.toLocaleString("en")}`],
      ["Corridors, cables, rails", `${s.corridors.length}, ${s.cables.length}, ${s.rails.length} tiles`],
      ["Planned, not yet built", `${s.planned.length} tiles`],
      ["Rovers out", `${rovers} of ${roverCount(s, this.tuning)}${s.levelQueue.length > 0 ? `, ${s.levelQueue.length} tiles queued to level` : ""}`],
      ["Zones", `${s.zones.length}`],
    ];
    // Batch 32: how happy, and each need, with needs on.
    const needs = view.needs ?? null;
    if (needs !== null) {
      lines.splice(1, 0, ["Happiness", happinessWords(needs).replace(/^Happiness /, "")]);
      for (const l of needLines(needs, this.tuning)) lines.splice(lines.length - 6, 0, [l.name, l.text]);
    }
    const table = el("dl", "planner-facts");
    for (const [k, v] of lines) table.append(el("dt", "", k), el("dd", "", v));
    const types = el("ul", "planner-types");
    for (const [name, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) types.append(el("li", "", `${name}: ${c}`));
    this.overview.replaceChildren(table, el("h3", "planner-subtitle", "By kind"), types);
  }
}
