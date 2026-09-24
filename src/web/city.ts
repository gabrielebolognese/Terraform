/**
 * The city view (micro §3 and §8, Batch 20): one settlement in 2.5D, a build
 * palette, and an inspector for the selected building.
 *
 * It owns no game state. Each frame the host hands it the settlement and the
 * planet as the city sees it; it derives the `CityView`, asks the renderer
 * for shapes, and fills them. Every action goes back through hooks to the
 * simulation's own rules - the placement preview is a dry run of the very
 * call a click makes, so the ghost can never promise a placement the sim
 * would refuse.
 *
 * Readable without colour, as the HUD must be (Batch 7): a browned-out
 * building wears a badge and the inspector says why in words; a refused
 * placement is crossed out and the reason is written under the palette.
 */

import { CITY_BACKGROUND, cityScene, rayHit } from "../render/city.js";
import type { CitySceneOptions } from "../render/city.js";
import type { Shape } from "../render/raster.js";
import type { BuildingType, CityView, HabitatChannels, MicroResource, Settlement, Tuning } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, MICRO_RESOURCES, cityView } from "../sim/index.js";
import type { CityCamera } from "./city-camera.js";
import { centreCamera, footprintOrigin, pan, screenToIso, zoomAt } from "./city-camera.js";
import { formatMetres } from "./settlement-label.js";
import { formatLatLon, settlementLabel } from "./settlement-label.js";

export interface ActionOutcome {
  readonly ok: boolean;
  readonly reason: string | null;
}

export interface CityHooks {
  /** Place a building; the sim decides. */
  readonly onPlace: (settlementId: string, type: BuildingType, tx: number, ty: number) => ActionOutcome;
  /** The same call as a dry run, for the preview. Must not change the world. */
  readonly canPlace: (settlementId: string, type: BuildingType, tx: number, ty: number) => ActionOutcome;
  readonly onRemove: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  readonly onBack: () => void;
}

const RESOURCE_NAMES: Readonly<Record<MicroResource, string>> = {
  power: "Power",
  water: "Water",
  oxygen: "Oxygen",
  food: "Food",
  materials: "Materials",
};

/** How often the panel's numbers are rewritten. The picture animates every frame; text need not. */
const PANEL_HZ = 4;
const DRAG_THRESHOLD_PX = 4;
/** How often the city view is re-derived from the settlement, ms. */
const VIEW_MS = 200;

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

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
}

function rateList(rates: Partial<Record<MicroResource, number>>): string {
  const parts = MICRO_RESOURCES.filter((r) => (rates[r] ?? 0) > 0).map((r) => `${RESOURCE_NAMES[r].toLowerCase()} ${fmt(rates[r] ?? 0)}/yr`);
  return parts.length === 0 ? "nothing" : parts.join(", ");
}

/**
 * Why a building is not running, in words. Reads the view the picture was
 * drawn from, so the words and the badge always agree.
 */
export function offlineReason(view: CityView, index: number, env: HabitatChannels, t: Tuning): string | null {
  const b = view.buildings[index];
  if (b === undefined || b.operable) return null;
  if (b.submerged) return "Offline: under water.";
  const def = BUILDING_DEFS[b.type];
  if (!def.canOperate(env, t)) return "Offline: the planet does not allow it here yet - the air needs more CO2.";
  const draws = def.consumes(t, env);
  const short = view.shortages.filter((r) => (draws[r] ?? 0) > 0);
  if (short.length === 0) return "Offline: browned out.";
  return `Offline: this ${view.kind} is short of ${short.map((r) => RESOURCE_NAMES[r].toLowerCase()).join(" and ")}.`;
}

/**
 * What a screen point lands on: the first building or tile of ground along the
 * line of sight, over the heightmap (Batch 22). Before the ground had height,
 * the tile under the pointer was the flat ground beneath it; on a hill that is
 * the wrong tile.
 */
export function pickAt(view: CityView, cam: CityCamera, viewW: number, viewH: number, px: number, py: number) {
  const iso = screenToIso(cam, viewW, viewH, px, py);
  return rayHit(view, iso.sx, iso.sy);
}

/** The building under a screen point, or null. */
export function pickBuilding(view: CityView, cam: CityCamera, viewW: number, viewH: number, px: number, py: number): number | null {
  const hit = pickAt(view, cam, viewW, viewH, px, py);
  return hit !== null && hit.kind === "building" ? hit.index : null;
}

/** The tile under a screen point, whatever stands on it - where a placement would go. */
export function tileUnder(view: CityView, cam: CityCamera, viewW: number, viewH: number, px: number, py: number): { tx: number; ty: number } | null {
  const hit = pickAt(view, cam, viewW, viewH, px, py);
  return hit === null ? null : { tx: hit.tx, ty: hit.ty };
}

export class CityScreen {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly title: HTMLElement;
  private readonly where: HTMLElement;
  private readonly status: HTMLElement;
  private readonly storeRows = new Map<MicroResource, { value: HTMLElement; rate: HTMLElement; bar: HTMLElement }>();
  private readonly palette: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly inspector: HTMLElement;
  private readonly inspectorName: HTMLElement;
  private readonly inspectorStatus: HTMLElement;
  private readonly inspectorSummary: HTMLElement;
  private readonly inspectorFlows: HTMLElement;

  private settlementId: string | null = null;
  private camera: CityCamera | null = null;
  private placing: BuildingType | null = null;
  private selected: number | null = null;
  private hover: { tx: number; ty: number } | null = null;
  private notice: string | null = null;
  private view: CityView | null = null;
  private env: HabitatChannels | null = null;
  private settlement: Settlement | null = null;
  private lastPanel = -Infinity;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private paletteKind: string | null = null;
  private viewAt = -Infinity;
  private viewBuildings: Settlement["buildings"] | null = null;

  constructor(
    host: HTMLElement,
    private readonly hooks: CityHooks,
    private readonly tuning: Tuning,
  ) {
    this.root = el("div", "city");
    this.root.hidden = true;
    this.canvas = el("canvas", "city-canvas");
    this.canvas.setAttribute("aria-label", "The settlement, seen from above. Drag to pan, scroll to zoom, click a building to inspect it.");

    const panel = el("aside", "city-panel");
    const head = el("header", "city-head");
    this.title = el("h2", "city-title", "");
    this.where = el("div", "city-where", "");
    head.append(button("city-back", "Back to orbit", () => this.hooks.onBack()), this.title, this.where);

    this.status = el("p", "city-status", "");
    this.status.setAttribute("role", "status");

    const stores = el("section", "city-stores");
    stores.append(el("h3", "city-section-title", "Stores"));
    const list = el("ul", "city-store-list");
    for (const r of MICRO_RESOURCES) {
      const row = el("li", "city-store");
      const value = el("span", "city-store-value", "");
      const rate = el("span", "city-store-rate", "");
      const track = el("span", "city-store-track");
      const bar = el("span", "city-store-bar");
      track.append(bar);
      row.append(el("span", "city-store-name", RESOURCE_NAMES[r]), value, rate, track);
      row.dataset["resource"] = r;
      list.append(row);
      this.storeRows.set(r, { value, rate, bar });
    }
    stores.append(list);

    const build = el("section", "city-build");
    build.append(el("h3", "city-section-title", "Build"));
    this.palette = el("div", "city-palette");
    this.hint = el("p", "city-hint", "");
    this.hint.setAttribute("role", "status");
    build.append(this.palette, this.hint);

    this.inspector = el("section", "city-inspector");
    this.inspector.hidden = true;
    this.inspectorName = el("h3", "city-inspector-name", "");
    this.inspectorStatus = el("p", "city-inspector-status", "");
    this.inspectorSummary = el("p", "city-inspector-summary", "");
    this.inspectorFlows = el("p", "city-inspector-flows", "");
    const actions = el("div", "city-inspector-actions");
    actions.append(
      button("city-remove", "Remove", () => this.removeSelected()),
      button("city-deselect", "Close", () => this.select(null)),
    );
    this.inspector.append(this.inspectorName, this.inspectorStatus, this.inspectorSummary, this.inspectorFlows, actions);

    panel.append(head, this.status, stores, build, this.inspector);
    this.root.append(this.canvas, panel);
    host.append(this.root);
    this.bindInput();
  }

  get openId(): string | null {
    return this.settlementId;
  }

  open(settlementId: string): void {
    this.settlementId = settlementId;
    this.camera = null;
    this.placing = null;
    this.selected = null;
    this.notice = null;
    this.paletteKind = null;
    this.lastPanel = -Infinity;
    this.root.hidden = false;
  }

  close(): void {
    this.settlementId = null;
    this.root.hidden = true;
    this.view = null;
    this.settlement = null;
  }

  /** Arm a building type for placement (or disarm with null). */
  arm(type: BuildingType | null): void {
    this.placing = type;
    this.notice = null;
    if (type !== null) this.select(null);
    this.renderPalette(true);
    this.lastPanel = -Infinity;
  }

  select(index: number | null): void {
    this.selected = index;
    this.lastPanel = -Infinity;
  }

  /** One frame: derive the view, draw it, and (at PANEL_HZ) rewrite the panel. */
  frame(settlement: Settlement, env: HabitatChannels, now: number): void {
    if (this.settlementId !== settlement.id) return;
    this.settlement = settlement;
    this.env = env;
    // The view is re-derived a few times a second, not every frame: for a
    // metropolis it costs ~15 ms. A change of buildings - a placement, a
    // removal - refreshes it at once, so the player never waits for their click.
    let view = this.view;
    if (view === null || view.id !== settlement.id || settlement.buildings !== this.viewBuildings || now - this.viewAt >= VIEW_MS) {
      view = cityView(settlement, env, this.tuning);
      this.view = view;
      this.viewAt = now;
      this.viewBuildings = settlement.buildings;
    }
    if (this.selected !== null && this.selected >= view.buildings.length) this.selected = null;
    const size = this.viewSize();
    if (this.camera === null) this.camera = centreCamera(view.tiles, size.w);
    this.draw(view, now, size);
    if (now - this.lastPanel >= 1000 / PANEL_HZ) {
      this.lastPanel = now;
      this.renderPanel(view, settlement, env);
    }
  }

  // ---- drawing ---------------------------------------------------------------

  private viewSize(): { w: number; h: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return { w: rect.width, h: rect.height };
    return { w: this.canvas.width || 800, h: this.canvas.height || 600 };
  }

  sceneOptions(now: number): CitySceneOptions {
    return { time: now / 1000, selected: this.selected, ghost: this.ghost() };
  }

  private ghost(): CitySceneOptions["ghost"] {
    if (this.placing === null || this.hover === null || this.settlementId === null) return null;
    const size = BUILDING_DEFS[this.placing].footprint;
    const at = footprintOrigin(this.hover.tx, this.hover.ty, size);
    const dry = this.hooks.canPlace(this.settlementId, this.placing, at.tx, at.ty);
    return { tx: at.tx, ty: at.ty, size, valid: dry.ok };
  }

  private draw(view: CityView, now: number, size: { w: number; h: number }): void {
    const ctx = this.canvas.getContext("2d");
    if (ctx === null || this.camera === null) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const pw = Math.round(size.w * dpr);
    const ph = Math.round(size.h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = CITY_BACKGROUND;
    ctx.fillStyle = `rgb(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)})`;
    ctx.fillRect(0, 0, pw, ph);
    const k = dpr * this.camera.zoom;
    ctx.setTransform(k, 0, 0, k, dpr * (size.w / 2 - this.camera.cx * this.camera.zoom), dpr * (size.h / 2 - this.camera.cy * this.camera.zoom));
    // Only what the camera can see: a metropolis draws a fraction of itself.
    const cam = this.camera;
    const halfW = size.w / 2 / cam.zoom;
    const halfH = size.h / 2 / cam.zoom;
    const viewport = { minX: cam.cx - halfW, maxX: cam.cx + halfW, minY: cam.cy - halfH, maxY: cam.cy + halfH };
    fillShapes(ctx, cityScene(view, { ...this.sceneOptions(now), viewport }));
  }

  // ---- panel -----------------------------------------------------------------

  private renderPanel(view: CityView, s: Settlement, env: HabitatChannels): void {
    this.title.textContent = settlementLabel(s);
    // Detail §1.3: "Elevation is shown at founding and at placement."
    this.where.textContent = `${s.kind === "city" ? "City" : s.kind === "metropolis" ? "Metropolis" : "Outpost"} - ${formatLatLon(s.lat, s.lon)} - ${formatMetres(view.baseElevationM)} on the planet`;
    const people =
      view.kind !== "outpost"
        ? `${Math.floor(view.population)} of ${view.housing} people housed. `
        : "An outpost: no residents. ";
    const need =
      view.shortages.length === 0
        ? "Every need is met."
        : `Short of ${view.shortages.map((r) => RESOURCE_NAMES[r].toLowerCase()).join(", ")} - buildings that use it are browned out.`;
    this.status.textContent = people + need;
    this.status.dataset["state"] = view.shortages.length === 0 ? "ok" : "short";

    for (const r of MICRO_RESOURCES) {
      const row = this.storeRows.get(r);
      if (row === undefined) continue;
      const have = view.stores[r];
      const cap = view.capacities[r];
      row.value.textContent = `${fmt(have)} / ${fmt(cap)}`;
      const net = view.net[r];
      row.rate.textContent = Math.abs(net) < 0.005 ? "steady" : `${net > 0 ? "+" : "-"}${fmt(Math.abs(net))}/yr`;
      row.bar.style.width = `${cap > 0 ? Math.min(100, (100 * have) / cap) : 0}%`;
    }

    this.renderPalette(false);
    const here = this.placing !== null && this.hover !== null ? this.groundWords(view, this.hover.tx, this.hover.ty) : "";
    this.hint.textContent =
      this.placing === null
        ? this.notice ?? "Choose a building, then click the ground to place it."
        : this.notice ?? `Click the ground to place a ${BUILDING_DEFS[this.placing].name}. Esc cancels.${here}`;

    const index = this.selected;
    const b = index === null ? undefined : view.buildings[index];
    this.inspector.hidden = b === undefined;
    if (b !== undefined && index !== null) {
      const def = BUILDING_DEFS[b.type];
      this.inspectorName.textContent = def.name;
      this.inspectorStatus.textContent = offlineReason(view, index, env, this.tuning) ?? "Running.";
      this.inspectorStatus.dataset["state"] = b.operable ? "ok" : "off";
      this.inspectorSummary.textContent = def.summary;
      const extra: string[] = [];
      if (def.housing(this.tuning) > 0) extra.push(`Houses ${def.housing(this.tuning)}.`);
      if (def.planetaryCo2(this.tuning) > 0) extra.push(`Draws ${def.planetaryCo2(this.tuning)} mbar/yr of CO2 from the planet.`);
      this.inspectorFlows.textContent = `Uses ${rateList(def.consumes(this.tuning, env))}. Makes ${rateList(def.produces(this.tuning))}. ${extra.join(" ")}`.trim();
    }
  }

  /** The ground under the pointer, in words: its height here, on the planet, and whether it is too steep. */
  private groundWords(view: CityView, tx: number, ty: number): string {
    const i = ty * view.tiles + tx;
    const local = view.heightM[i];
    if (local === undefined) return "";
    const steep = view.steep[i] === true ? " Too steep to build on." : "";
    return ` Ground here: ${formatMetres(local, true)} (${formatMetres(view.baseElevationM + local)} on the planet).${steep}`;
  }

  private renderPalette(force: boolean): void {
    const s = this.settlement;
    if (s === null) return;
    const key = `${s.kind}|${this.placing ?? ""}|${Math.floor(s.stores.materials)}`;
    if (!force && key === this.paletteKind) return;
    this.paletteKind = key;
    const buttons = BUILDING_TYPES.filter((type) => BUILDING_DEFS[type].kinds.includes(s.kind)).map((type) => {
      const def = BUILDING_DEFS[type];
      const cost = def.cost(this.tuning);
      const b = button("city-build-option", "", () => this.arm(this.placing === type ? null : type));
      b.dataset["type"] = type;
      b.setAttribute("aria-pressed", String(this.placing === type));
      b.title = def.summary;
      b.append(el("span", "city-build-name", def.name), el("span", "city-build-cost", `${cost} materials`));
      if (s.stores.materials < cost) b.append(el("span", "city-build-short", "not enough materials"));
      return b;
    });
    this.palette.replaceChildren(...buttons);
  }

  // ---- input -----------------------------------------------------------------

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      const local = this.local(e);
      if (this.view !== null && this.camera !== null) {
        const size = this.viewSize();
        const before = this.hover;
        this.hover = tileUnder(this.view, this.camera, size.w, size.h, local.x, local.y);
        // The hint names the ground under the pointer, so rewrite it when that changes.
        if (this.placing !== null && (before?.tx !== this.hover?.tx || before?.ty !== this.hover?.ty)) this.lastPanel = -Infinity;
      }
      const d = this.drag;
      if (d === null || this.camera === null || this.view === null) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      this.camera = pan(this.camera, dx, dy, this.view.tiles);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    c.addEventListener("pointerup", (e) => {
      const d = this.drag;
      this.drag = null;
      if (d !== null && !d.moved) this.click(this.local(e));
    });
    c.addEventListener("pointerleave", () => {
      this.hover = null;
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.camera === null || this.view === null) return;
        const size = this.viewSize();
        const local = this.local(e);
        this.camera = zoomAt(this.camera, Math.exp(-e.deltaY * 0.0015), local.x, local.y, size.w, size.h, this.view.tiles);
      },
      { passive: false },
    );
    globalThis.addEventListener?.("keydown", (e: KeyboardEvent) => {
      if (this.settlementId === null || e.key !== "Escape") return;
      if (this.placing !== null) this.arm(null);
      else this.select(null);
    });
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** A click that was not a drag: place what is armed, or select what is there. */
  click(at: { x: number; y: number }): void {
    const view = this.view;
    const cam = this.camera;
    const id = this.settlementId;
    if (view === null || cam === null || id === null) return;
    const size = this.viewSize();
    if (this.placing !== null) {
      const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y);
      if (tile === null) return;
      const origin = footprintOrigin(tile.tx, tile.ty, BUILDING_DEFS[this.placing].footprint);
      const outcome = this.hooks.onPlace(id, this.placing, origin.tx, origin.ty);
      // A refused placement must say so, in words, where the player is looking.
      this.notice = outcome.ok ? null : `Cannot build: ${outcome.reason ?? "refused"}.`;
      this.lastPanel = -Infinity;
      return;
    }
    this.select(pickBuilding(view, cam, size.w, size.h, at.x, at.y));
  }

  private removeSelected(): void {
    const view = this.view;
    const id = this.settlementId;
    if (view === null || id === null || this.selected === null) return;
    const b = view.buildings[this.selected];
    if (b === undefined) return;
    const outcome = this.hooks.onRemove(id, b.tx, b.ty);
    this.notice = outcome.ok ? null : `Cannot remove: ${outcome.reason ?? "refused"}.`;
    if (outcome.ok) this.select(null);
    this.lastPanel = -Infinity;
  }
}

/** Fill a shape list with the browser's 2D API: the same list the golden render rasterises. */
export function fillShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[]): void {
  for (const shape of shapes) {
    ctx.beginPath();
    for (const ring of shape.rings) {
      if (ring.length < 6) continue;
      ctx.moveTo(ring[0]!, ring[1]!);
      for (let k = 2; k < ring.length; k += 2) ctx.lineTo(ring[k]!, ring[k + 1]!);
      ctx.closePath();
    }
    const f = shape.fill;
    ctx.fillStyle = `rgba(${Math.round(f.r * 255)}, ${Math.round(f.g * 255)}, ${Math.round(f.b * 255)}, ${f.a})`;
    ctx.fill("evenodd");
  }
}
