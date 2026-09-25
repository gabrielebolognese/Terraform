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

import type { BuildingType, CityView, HabitatChannels, HistorySample, PlannedLink, Settlement, Tuning } from "../sim/index.js";
import { BUILDING_DEFS, MICRO_RESOURCES, NAME_MAX, cityView, keyTile, roverCount, tileKey } from "../sim/index.js";
import { settlementLabel } from "./settlement-label.js";

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

/** What each building reads as on the map, by what it does. */
export const MAP_COLOURS: Readonly<Record<"home" | "power" | "industry" | "civic" | "port" | "hq", readonly [number, number, number]>> = {
  home: [92, 156, 230],
  power: [236, 200, 64],
  industry: [214, 124, 60],
  civic: [176, 110, 214],
  port: [80, 196, 186],
  hq: [245, 245, 245],
};

export function mapKind(type: BuildingType): keyof typeof MAP_COLOURS {
  if (type === "headquarters") return "hq";
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
export function plannerPixels(view: CityView, s: Settlement): Uint8ClampedArray<ArrayBuffer> {
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

/** A chart's lines from the record: one value a sample. */
export interface Series {
  readonly label: string;
  readonly colour: string;
  readonly values: readonly number[];
}

/** The charts the planner shows, from a settlement's record. */
export function charts(samples: readonly HistorySample[]): { title: string; unit: string; series: Series[]; bars?: boolean }[] {
  const pick = (f: (x: HistorySample) => number): number[] => samples.map(f);
  return [
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
    { title: "Stores", unit: "units", series: MICRO_RESOURCES.map((r, i) => ({ label: r[0]!.toUpperCase() + r.slice(1), colour: ["#f2c94c", "#56a8f5", "#9be3f0", "#e38b4f", "#b8a48c"][i]!, values: pick((x) => x.stores[i] ?? 0) })) },
    { title: "Made less drawn", unit: "a year", series: MICRO_RESOURCES.map((r, i) => ({ label: r[0]!.toUpperCase() + r.slice(1), colour: ["#f2c94c", "#56a8f5", "#9be3f0", "#e38b4f", "#b8a48c"][i]!, values: pick((x) => x.net[i] ?? 0) })) },
  ];
}

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

const fmt = (v: number): string => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en") : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));

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
    for (const [label, c] of [["Homes and life support", MAP_COLOURS.home], ["Power", MAP_COLOURS.power], ["Industry", MAP_COLOURS.industry], ["Research", MAP_COLOURS.civic], ["Port and stations", MAP_COLOURS.port], ["Headquarters", MAP_COLOURS.hq]] as const) {
      const item = el("span", "planner-legend-item", label);
      const sw = el("span", "planner-swatch");
      sw.style.background = `rgb(${c.join(",")})`;
      item.prepend(sw);
      legend.append(item);
    }
    this.root.append(top, tools, stage, this.hint, legend, side);
    host.append(this.root);
    this.showTab("zones");
    this.setTool("pan");
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
      this.pixels = plannerPixels(view, s);
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
      const p = local(e);
      const t = this.tileAt(p.x, p.y);
      this.drag = { x: p.x, y: p.y, from: t, to: t };
    });
    m.addEventListener("pointermove", (e) => {
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
    m.addEventListener("pointerup", () => {
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
        const k = Math.exp(-e.deltaY * 0.0015);
        const next = Math.min(64, Math.max(0.5, this.scale * k));
        this.ox = p.x - ((p.x - this.ox) * next) / this.scale;
        this.oy = p.y - ((p.y - this.oy) * next) / this.scale;
        this.scale = next;
      },
      { passive: false },
    );
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
    const figures = charts(samples).map((c) => {
      const fig = el("figure", "planner-chart");
      const canvas = el("canvas", "planner-chart-canvas");
      canvas.width = 340;
      canvas.height = 120;
      canvas.setAttribute("role", "img");
      const last = c.series.map((x) => `${x.label} ${fmt(x.values[x.values.length - 1] ?? 0)}`).join(", ");
      canvas.setAttribute("aria-label", `${c.title}: now ${last}`);
      drawChart(canvas, c.series, c.bars === true);
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
    });
    this.chartBox.replaceChildren(el("p", "planner-chart-span", `The last ${samples.length} years.`), ...figures);
  }

  private renderOverview(view: CityView, s: Settlement): void {
    const counts = new Map<string, number>();
    for (const b of s.buildings) counts.set(BUILDING_DEFS[b.type].name, (counts.get(BUILDING_DEFS[b.type].name) ?? 0) + 1);
    const rovers = s.jobs.filter((j) => j.kind !== "rocket").length;
    const last = s.history.samples[s.history.samples.length - 1];
    const lines: [string, string][] = [
      ["People", `${Math.floor(s.population).toLocaleString("en")} of ${Math.round(view.housing).toLocaleString("en")} homes`],
      ["Needs", view.shortages.length === 0 ? "every need met" : `short of ${view.shortages.join(", ")}`],
      ["Last year", last === undefined ? "no record yet" : `${fmt(last.births)} born, ${fmt(last.deaths)} lost; blackout ${Math.round((last.short[0] ?? 0) * 100)}% of the year, food short ${Math.round((last.short[3] ?? 0) * 100)}%`],
      ["Buildings", `${s.buildings.length.toLocaleString("en")}`],
      ["Corridors, cables, rails", `${s.corridors.length}, ${s.cables.length}, ${s.rails.length} tiles`],
      ["Planned, not yet built", `${s.planned.length} tiles`],
      ["Rovers out", `${rovers} of ${roverCount(s, this.tuning)}${s.levelQueue.length > 0 ? `, ${s.levelQueue.length} tiles queued to level` : ""}`],
      ["Zones", `${s.zones.length}`],
    ];
    const table = el("dl", "planner-facts");
    for (const [k, v] of lines) table.append(el("dt", "", k), el("dd", "", v));
    const types = el("ul", "planner-types");
    for (const [name, c] of [...counts.entries()].sort((a, b) => b[1] - a[1])) types.append(el("li", "", `${name}: ${c}`));
    this.overview.replaceChildren(table, el("h3", "planner-subtitle", "By kind"), types);
  }
}

/** A small line chart (or bars, for shares of the year) into a canvas: every series on one scale from zero. */
export function drawChart(canvas: HTMLCanvasElement, series: readonly Series[], bars: boolean): void {
  const ctx = canvas.getContext("2d");
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  let lo = 0;
  let hi = bars ? 1 : 0;
  for (const s of series) for (const v of s.values) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (hi - lo < 1e-9) hi = lo + 1;
  const count = Math.max(...series.map((s) => s.values.length));
  const x = (i: number): number => 4 + ((w - 8) * i) / Math.max(1, count - 1);
  const y = (v: number): number => h - 4 - ((h - 8) * (v - lo)) / (hi - lo);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(0, y(0));
  ctx.lineTo(w, y(0));
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
