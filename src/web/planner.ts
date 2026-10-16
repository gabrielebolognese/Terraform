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

/** The overlay's colours: the reach, homes reached, homes not reached, a provider. */
export const COVERAGE_COLOURS = { reach: [120, 230, 140], reached: [80, 200, 110], gap: [232, 72, 60], provider: [255, 255, 255] } as const;

/** A need's coverage, from what the view says runs. */
export function coverageOf(s: Settlement, view: CityView, id: NeedId, t: Tuning): CoverageOverlay {
  return needCoverage(s, id, view.buildings.map((b) => b.operable), t);
}

/** What each building reads as on the map, by what it does. */
export const MAP_COLOURS: Readonly<Record<"home" | "green" | "power" | "industry" | "civic" | "commerce" | "port" | "hq", readonly [number, number, number]>> = {
  home: [92, 156, 230],
  green: [86, 186, 96],
  commerce: [226, 96, 90],
  power: [236, 200, 64],
  industry: [214, 124, 60],
  civic: [176, 110, 214],
  port: [80, 196, 186],
  hq: [245, 245, 245],
};

export function mapKind(type: BuildingType): keyof typeof MAP_COLOURS {
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
export function plannerPixels(view: CityView, s: Settlement, coverage: CoverageOverlay | null = null): Uint8ClampedArray<ArrayBuffer> {
  const n = view.tiles;
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
    const c = hex(z.colour);
    for (const k of z.tiles) {
      const i = at(k);
      if (i >= 0) set(i, c, 0.45);
    }
  }
  for (let i = 0; i < n * n; i += 1) {
    const corridor = view.corridors[i] === true;
    const cable = view.cables[i] === true;
    if (corridor && cable) set(i, [238, 226, 170]);
    else if (corridor) set(i, [226, 228, 232]);
    else if (cable) set(i, [246, 206, 60]);
    if (view.rails?.[i] === true) set(i, [120, 84, 60]);
  }
  for (const q of s.levelQueue) {
    const i = at(q.tile);
    if (i >= 0) set(i, [90, 220, 230], 0.55);
  }
  for (const p of s.planned) {
    const i = at(p.tile);
    if (i >= 0) set(i, p.layer === "cables" ? [255, 160, 40] : p.layer === "rails" ? [200, 120, 90] : [255, 110, 200], 0.7);
  }
  for (const b of view.buildings) {
    const c = MAP_COLOURS[mapKind(b.type)];
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
    for (const q of coverage.squares) {
      if (!q.running) continue;
      for (let y = Math.max(0, Math.ceil(q.y0)); y < Math.min(n, Math.ceil(q.y1)); y += 1) for (let x = Math.max(0, Math.ceil(q.x0)); x < Math.min(n, Math.ceil(q.x1)); x += 1) set(y * n + x, COVERAGE_COLOURS.reach, 0.3);
    }
    const paint = (index: number, c: readonly [number, number, number]): void => {
      const b = view.buildings[index];
      if (b === undefined) return;
      const d = b.depth ?? b.size;
      for (let y = b.ty; y < b.ty + d; y += 1) for (let x = b.tx; x < b.tx + b.size; x += 1) if (x >= 0 && y >= 0 && x < n && y < n) set(y * n + x, c);
    };
    for (const h of coverage.homes) paint(h.index, h.reached ? COVERAGE_COLOURS.reached : COVERAGE_COLOURS.gap);
    for (const q of coverage.squares) paint(q.index, COVERAGE_COLOURS.provider);
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

    const legend = el("div", "planner-legend");
    for (const [label, c] of [["Homes and life support", MAP_COLOURS.home], ["Parks and biospheres", MAP_COLOURS.green], ["Power", MAP_COLOURS.power], ["Industry and stores", MAP_COLOURS.industry], ["Research", MAP_COLOURS.civic], ["Commerce", MAP_COLOURS.commerce], ["Port and stations", MAP_COLOURS.port], ["Headquarters", MAP_COLOURS.hq]] as const) {
      const item = el("span", "planner-legend-item", label);
      const sw = el("span", "planner-swatch");
      sw.style.background = `rgb(${c.join(",")})`;
      item.prepend(sw);
      legend.append(item);
    }
    this.root.append(top, tools, this.coverageBar, stage, this.hint, legend, side);
    host.append(this.root);
    this.showTab("zones");
    this.setTool("pan");
    this.showCoverage(null);
    this.bindInput();
  }

  get openId(): string | null {
    return this.id;
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
    if (this.pixels === null || this.image === null || this.image.width !== n) {
      const coverage = this.coverage !== null && (view.needs ?? null) !== null ? coverageOf(s, view, this.coverage, this.tuning) : null;
      this.pixels = plannerPixels(view, s, coverage);
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
      if (d === null) return;
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
