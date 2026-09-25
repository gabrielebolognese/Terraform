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
import type { Layer } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, MICRO_RESOURCES, cityView, layerOf, roverYears, tileKey } from "../sim/index.js";
import type { CityCamera } from "./city-camera.js";
import { centreCamera, footprintOrigin, pan, qualityFor, screenToIso, zoomAt } from "./city-camera.js";
import type { CardKind } from "./city-cards.js";
import { makePreviews } from "./city-cards.js";
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
  /** Lay a corridor or a cable on one tile; the sim decides. */
  readonly onLink: (settlementId: string, layer: Layer, tx: number, ty: number) => ActionOutcome;
  /** The same call as a dry run, for the preview. Must not change the world. */
  readonly canLink: (settlementId: string, layer: Layer, tx: number, ty: number) => ActionOutcome;
  readonly onUnlink: (settlementId: string, layer: Layer, tx: number, ty: number) => ActionOutcome;
  /** Send a rover from the headquarters to break the rock on a tile. */
  readonly onSendRover: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  /** Launch the rocket of the spaceport covering a tile. */
  readonly onLaunch: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  /** Lay (and pay for) the corridors and cables that join every building into one network of each. */
  readonly onConnect: (settlementId: string) => ActionOutcome & { readonly laid: number };
  readonly onBack: () => void;
}

/** What makes each resource, for the words: where a corridor or cable should lead. */
const MADE_BY: Readonly<Record<MicroResource, string>> = {
  power: "a power plant",
  water: "a Water Extractor",
  oxygen: "an Atmosphere Processor",
  food: "a Greenhouse",
  materials: "a Regolith Mine",
};

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

/** Sim-years as the real seconds they take at 1x, in words. */
function seconds(years: number, t: Tuning): string {
  const s = Math.max(1, Math.round(years / t.TIME_SCALE));
  return s >= 90 ? `about ${Math.round(s / 60)} min at 1x` : `about ${s} s at 1x`;
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
  if (b.network !== null) {
    const lacks = b.network.resources;
    // Power comes by cable; everything else by corridor - say which to lay, to what.
    const how = (layer: Layer): string[] =>
      lacks.filter((r) => layerOf(r) === layer).map((r) => `${layer === "cables" ? "a power cable" : "a corridor"} to ${MADE_BY[r]}`);
    const lay = [...how("cables"), ...how("corridors")];
    return `Not connected: nothing on its network makes ${lacks.map((r) => RESOURCE_NAMES[r].toLowerCase()).join(" or ")}. Lay ${lay.join(", and ")}.`;
  }
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
  /** The build bar along the bottom (at the user's request, as in Clash of Clans). */
  private readonly dock: HTMLElement;
  /** One tooltip for every card, outside the scrolling row so it is never clipped. */
  private readonly tip: HTMLElement;
  private tipFor: CardKind | null = null;
  private readonly previews: Map<CardKind, HTMLCanvasElement>;
  private readonly inspector: HTMLElement;
  private readonly inspectorName: HTMLElement;
  private readonly inspectorStatus: HTMLElement;
  private readonly inspectorSummary: HTMLElement;
  private readonly inspectorFlows: HTMLElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly roverButton: HTMLButtonElement;
  private readonly launchButton: HTMLButtonElement;

  private settlementId: string | null = null;
  private camera: CityCamera | null = null;
  private placing: BuildingType | null = null;
  /** The corridor or cable tool, when one is armed. */
  private paving: Layer | null = null;
  /** A selected tile of ground: a rock a rover could break. */
  private selectedTile: { tx: number; ty: number } | null = null;
  /** Sim-years into the current substep, for smooth rovers and rockets. */
  private sinceYears = 0;
  /** While a drag lays ("lay") or takes up ("clear"), and the last tile it touched. */
  private painting: { mode: "lay" | "clear"; last: number } | null = null;
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
  private viewLinks: readonly unknown[] = [];

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

    // The build bar: a row of cards along the bottom, with the hint above it.
    this.dock = el("section", "city-dock");
    this.dock.setAttribute("aria-label", "Build");
    this.palette = el("div", "city-cards");
    this.palette.setAttribute("role", "toolbar");
    this.hint = el("p", "city-hint", "");
    this.hint.setAttribute("role", "status");
    this.dock.append(this.hint, this.palette);
    this.tip = el("div", "city-tip");
    this.tip.id = "city-tip";
    this.tip.setAttribute("role", "tooltip");
    this.tip.hidden = true;
    this.previews = makePreviews();

    this.inspector = el("section", "city-inspector");
    this.inspector.hidden = true;
    this.inspectorName = el("h3", "city-inspector-name", "");
    this.inspectorStatus = el("p", "city-inspector-status", "");
    this.inspectorSummary = el("p", "city-inspector-summary", "");
    this.inspectorFlows = el("p", "city-inspector-flows", "");
    const actions = el("div", "city-inspector-actions");
    this.removeButton = button("city-remove", "Remove", () => this.removeSelected());
    this.roverButton = button("city-send-rover", "Send rover", () => this.sendRover());
    this.launchButton = button("city-launch", "Launch rocket", () => this.launch());
    actions.append(
      this.roverButton,
      this.launchButton,
      this.removeButton,
      button("city-deselect", "Close", () => {
        this.select(null);
        this.selectedTile = null;
      }),
    );
    this.inspector.append(this.inspectorName, this.inspectorStatus, this.inspectorSummary, this.inspectorFlows, actions);

    panel.append(head, this.status, stores, this.inspector);
    this.root.append(this.canvas, panel, this.dock, this.tip);
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
    this.paving = null;
    this.selectedTile = null;
    this.painting = null;
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
    if (type !== null) this.paving = null;
    this.notice = null;
    if (type !== null) this.select(null);
    this.renderPalette(true);
    this.lastPanel = -Infinity;
  }

  /** Arm the corridor or cable tool, or put it down with null. */
  armLink(layer: Layer | null): void {
    this.paving = layer;
    if (layer !== null) {
      this.placing = null;
      this.select(null);
    }
    this.notice = null;
    this.renderPalette(true);
    this.lastPanel = -Infinity;
  }

  /** "Connect everything": the sim finds and prices the corridors and cables; this says what happened. */
  connect(): void {
    const id = this.settlementId;
    if (id === null) return;
    const outcome = this.hooks.onConnect(id);
    this.notice = outcome.ok ? `Laid ${outcome.laid} tile${outcome.laid === 1 ? "" : "s"} of corridor and cable.` : `Cannot connect: ${outcome.reason ?? "refused"}.`;
    this.lastPanel = -Infinity;
  }

  select(index: number | null): void {
    this.selected = index;
    if (index !== null) this.selectedTile = null;
    this.lastPanel = -Infinity;
  }

  /** One frame: derive the view, draw it, and (at PANEL_HZ) rewrite the panel. */
  frame(settlement: Settlement, env: HabitatChannels, now: number, sinceYears = 0): void {
    if (this.settlementId !== settlement.id) return;
    this.sinceYears = sinceYears;
    this.settlement = settlement;
    this.env = env;
    // The view is re-derived a few times a second, not every frame: for a
    // metropolis it costs ~15 ms. A change of buildings, corridors, cables,
    // rocks or jobs - anything a click does - refreshes it at once, so the
    // player never waits for their click.
    let view = this.view;
    const links = [settlement.corridors, settlement.cables, settlement.cleared, settlement.jobs.length];
    const changed = settlement.buildings !== this.viewBuildings || links.some((l, i) => l !== this.viewLinks[i]);
    if (view === null || view.id !== settlement.id || changed || now - this.viewAt >= VIEW_MS) {
      view = cityView(settlement, env, this.tuning);
      this.view = view;
      this.viewAt = now;
      this.viewBuildings = settlement.buildings;
      this.viewLinks = links;
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
    return { time: now / 1000, selected: this.selected, ghost: this.ghost(), selectedTile: this.selectedTile, sinceYears: this.sinceYears };
  }

  private ghost(): CitySceneOptions["ghost"] {
    if (this.paving !== null && this.hover !== null && this.settlementId !== null && this.view !== null) {
      // On a tile of it the tool takes it up, which is always allowed; elsewhere, ask the sim.
      const onLink = this.view[this.paving][this.hover.ty * this.view.tiles + this.hover.tx] === true;
      const ok = onLink || this.hooks.canLink(this.settlementId, this.paving, this.hover.tx, this.hover.ty).ok;
      return { tx: this.hover.tx, ty: this.hover.ty, size: 1, valid: ok };
    }
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
    fillShapes(ctx, cityScene(view, { ...this.sceneOptions(now), viewport, quality: qualityFor(cam, size.w, size.h, view.world.size) }));
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
      this.paving === "corridors"
        ? this.notice ?? `Click or drag to lay corridor (${this.tuning.COST_CORRIDOR} material a tile): it carries water, oxygen, food and materials. Start on a corridor to take it up. Esc finishes.`
        : this.paving === "cables"
          ? this.notice ?? `Click or drag to lay power cable (${this.tuning.COST_CABLE} material a tile): it carries power. Start on a cable to take it up. Esc finishes.`
          : this.placing === null
        ? this.notice ?? "Choose a structure, then click the ground to place it - or click a rock to send a rover to break it."
        : this.notice ?? `Click the ground to place a ${BUILDING_DEFS[this.placing].name}. Esc cancels.${here}`;

    const index = this.selected;
    const b = index === null ? undefined : view.buildings[index];
    this.inspector.hidden = b === undefined && this.selectedTile === null;
    this.removeButton.hidden = b === undefined || !BUILDING_DEFS[b.type].buildable;
    this.roverButton.hidden = !(b === undefined && this.selectedTile !== null);
    this.launchButton.hidden = b?.type !== "spaceport";
    if (b === undefined && this.selectedTile !== null) this.renderRock(view, s, this.selectedTile);
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
      if (b.type === "spaceport") {
        const job = s.jobs.find((j) => j.kind === "rocket" && j.tile === tileKey(b.tx, b.ty));
        this.inspectorSummary.textContent =
          job === undefined
            ? `${def.summary} Launch a supply rocket: back in ${seconds(this.tuning.ROCKET_TRIP_YEARS, this.tuning)} with ${this.tuning.ROCKET_MATERIALS} materials, or as many as the stores have room for.`
            : `Its rocket is away: back in ${seconds(job.remaining, this.tuning)}.`;
      }
    }
  }

  /** The inspector for a rock: what it is, what breaking it brings, and how long a rover takes. */
  private renderRock(view: CityView, s: Settlement, tile: { tx: number; ty: number }): void {
    const rock = view.rocks[tile.ty * view.tiles + tile.tx] ?? "none";
    const job = s.jobs.find((j) => j.kind === "rover" && j.tile === tileKey(tile.tx, tile.ty));
    this.inspectorName.textContent = rock === "crag" ? "Crag" : rock === "loose" ? "Loose rocks" : "Open ground";
    this.inspectorStatus.dataset["state"] = "ok";
    if (job !== undefined) {
      this.inspectorStatus.textContent = `A rover is on its way: back in ${seconds(job.remaining, this.tuning)}.`;
    } else if (rock === "none") {
      this.inspectorStatus.textContent = "Nothing here to break.";
    } else if (view.garage === null) {
      this.inspectorStatus.textContent = "There is no headquarters to send a rover from.";
    } else {
      const out = s.jobs.filter((j) => j.kind === "rover").length;
      this.inspectorStatus.textContent = `A rover would take ${seconds(roverYears(s, tile.tx, tile.ty, rock, this.tuning), this.tuning)} there and back. ${this.tuning.ROVERS_PER_HQ - out} of ${this.tuning.ROVERS_PER_HQ} rovers at the headquarters.`;
    }
    this.inspectorSummary.textContent =
      rock === "crag"
        ? `Rock too steep to build on. Breaking it brings back ${this.tuning.ROCK_CRAG_MATERIALS} materials and leaves ground that can be built on.`
        : rock === "loose"
          ? `Scattered rock. Breaking it brings back ${this.tuning.ROCK_LOOSE_MATERIALS} material.`
          : "";
    this.inspectorFlows.textContent = "";
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
    const key = `${s.kind}|${this.placing ?? ""}|${this.paving}|${Math.floor(s.stores.materials)}`;
    if (!force && key === this.paletteKind) return;
    this.paletteKind = key;
    const cards = BUILDING_TYPES.filter((type) => BUILDING_DEFS[type].buildable && BUILDING_DEFS[type].kinds.includes(s.kind)).map((type) => {
      const cost = BUILDING_DEFS[type].cost(this.tuning);
      const c = this.card(type, BUILDING_DEFS[type].name, `${cost}`, s.stores.materials < cost, this.placing === type, () => this.arm(this.placing === type ? null : type));
      c.dataset["type"] = type;
      return c;
    });
    const t = this.tuning;
    const corridor = this.card("corridor", "Corridor", `${t.COST_CORRIDOR} / tile`, s.stores.materials < t.COST_CORRIDOR, this.paving === "corridors", () => this.armLink(this.paving === "corridors" ? null : "corridors"));
    corridor.classList.add("city-corridor");
    const cable = this.card("cable", "Power cable", `${t.COST_CABLE} / tile`, s.stores.materials < t.COST_CABLE, this.paving === "cables", () => this.armLink(this.paving === "cables" ? null : "cables"));
    cable.classList.add("city-cable");
    const connect = this.card("connect", "Connect all", `${Math.min(t.COST_CORRIDOR, t.COST_CABLE)}+ / tile`, false, null, () => this.connect());
    connect.classList.add("city-connect");
    this.palette.replaceChildren(...cards, corridor, cable, connect);
    // A card rebuilt under the pointer keeps its tooltip.
    if (this.tipFor !== null) {
      const again = [...this.palette.children].find((c) => (c as HTMLElement).dataset["card"] === this.tipFor) as HTMLElement | undefined;
      if (again !== undefined) this.showTip(this.tipFor, again);
      else this.hideTip();
    }
  }

  /**
   * One card: the picture, the name, the price - and, when it cannot be
   * afforded, a mark that says so in words. `pressed` is null for a card that
   * acts at once rather than arming a tool.
   */
  private card(kind: CardKind, name: string, cost: string, short: boolean, pressed: boolean | null, onClick: () => void): HTMLButtonElement {
    const c = button("city-card", "", onClick);
    c.dataset["card"] = kind;
    if (pressed !== null) c.setAttribute("aria-pressed", String(pressed));
    if (short) c.dataset["short"] = "true";
    c.setAttribute("aria-describedby", "city-tip");
    const picture = el("canvas", "city-card-preview");
    const drawn = this.previews.get(kind);
    if (drawn !== undefined) {
      picture.width = drawn.width;
      picture.height = drawn.height;
      picture.getContext("2d")?.drawImage(drawn, 0, 0);
    }
    picture.setAttribute("aria-hidden", "true");
    const price = el("span", "city-card-cost");
    price.append(el("span", "city-card-material", ""), document.createTextNode(cost));
    c.append(picture, el("span", "city-card-name", name), price);
    if (short) c.append(el("span", "city-card-short", "not enough materials"));
    const show = (): void => this.showTip(kind, c);
    c.addEventListener("pointerenter", show);
    c.addEventListener("focus", show);
    c.addEventListener("pointerleave", () => this.hideTip());
    c.addEventListener("blur", () => this.hideTip());
    return c;
  }

  /** What a card's structure does, in words: shown above the card while it is hovered or focused. */
  tipText(kind: CardKind): { title: string; lines: string[] } {
    const t = this.tuning;
    if (kind === "corridor") {
      return {
        title: "Corridor",
        lines: [
          "A pressurised walkway for people and goods: it carries water, oxygen, food and materials. A dome needs a corridor to a greenhouse.",
          "Buildings that share a wall are joined without one.",
          `Costs ${t.COST_CORRIDOR} material a tile. Click or drag to lay it; start a drag on a corridor to take it up.`,
        ],
      };
    }
    if (kind === "cable") {
      return {
        title: "Power cable",
        lines: [
          "Carries power, and only power: a mine needs a cable to a power plant.",
          "Buildings that share a wall are joined without one.",
          `Costs ${t.COST_CABLE} material a tile. Click or drag to lay it; start a drag on a cable to take it up.`,
        ],
      };
    }
    if (kind === "connect") {
      return {
        title: "Connect everything",
        lines: ["Lays the shortest corridors and cables that join every building into one network of each, round the hills.", `Costs ${t.COST_CORRIDOR} material a tile of corridor, ${t.COST_CABLE} a tile of cable.`],
      };
    }
    const def = BUILDING_DEFS[kind];
    const lines = [def.summary];
    if (this.env !== null) {
      lines.push(`Uses ${rateList(def.consumes(t, this.env))}.`, `Makes ${rateList(def.produces(t))}.`);
    }
    if (def.housing(t) > 0) lines.push(`Houses ${def.housing(t)}.`);
    const cap = MICRO_RESOURCES.filter((r) => (def.capacity(t)[r] ?? 0) > 0);
    if (cap.length > 0) lines.push(`Stores more ${cap.map((r) => RESOURCE_NAMES[r].toLowerCase()).join(", ")}.`);
    lines.push(`${def.footprint} x ${def.footprint} tiles. Costs ${def.cost(t)} materials.`);
    return { title: def.name, lines };
  }

  private showTip(kind: CardKind, card: HTMLElement): void {
    const { title, lines } = this.tipText(kind);
    this.tip.replaceChildren(el("strong", "city-tip-title", title), ...lines.map((line) => el("p", "city-tip-line", line)));
    this.tip.hidden = false;
    this.tipFor = kind;
    // Above the card, centred on it, kept inside the window.
    const r = card.getBoundingClientRect();
    const width = this.tip.offsetWidth || 280;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, (globalThis.innerWidth || 1024) - width - 8));
    this.tip.style.left = `${left}px`;
    this.tip.style.bottom = `${(globalThis.innerHeight || 768) - r.top + 10}px`;
  }

  private hideTip(): void {
    this.tip.hidden = true;
    this.tipFor = null;
  }

  // ---- input -----------------------------------------------------------------

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture?.(e.pointerId);
      // With a corridor or cable armed, the main button paints; any other still pans.
      if (this.paving !== null && e.button === 0) {
        this.startPainting(this.local(e));
        return;
      }
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    c.addEventListener("pointermove", (e) => {
      const local = this.local(e);
      if (this.painting !== null) this.paint(local);
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
      this.camera = pan(this.camera, dx, dy, this.view.tiles, this.view.world.margin);
      d.x = e.clientX;
      d.y = e.clientY;
    });
    c.addEventListener("pointerup", (e) => {
      if (this.painting !== null) {
        this.painting = null;
        return;
      }
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
        this.camera = zoomAt(this.camera, Math.exp(-e.deltaY * 0.0015), local.x, local.y, size.w, size.h, this.view.tiles, this.view.world.margin);
      },
      { passive: false },
    );
    globalThis.addEventListener?.("keydown", (e: KeyboardEvent) => {
      if (this.settlementId === null || e.key !== "Escape") return;
      if (this.paving !== null) this.armLink(null);
      else if (this.placing !== null) this.arm(null);
      else this.select(null);
    });
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** A click that was not a drag: place what is armed, or select what is there - a building, or a rock. */
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
    const picked = pickBuilding(view, cam, size.w, size.h, at.x, at.y);
    this.select(picked);
    if (picked === null) {
      const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y);
      const rock = tile === null ? "none" : view.rocks[tile.ty * view.tiles + tile.tx] ?? "none";
      this.selectedTile = tile !== null && rock !== "none" ? tile : null;
      this.lastPanel = -Infinity;
    }
  }

  /** Send a rover to the selected rock. */
  private sendRover(): void {
    const id = this.settlementId;
    const tile = this.selectedTile;
    if (id === null || tile === null) return;
    const outcome = this.hooks.onSendRover(id, tile.tx, tile.ty);
    this.notice = outcome.ok ? "A rover is on its way." : `Cannot send a rover: ${outcome.reason ?? "refused"}.`;
    this.lastPanel = -Infinity;
  }

  /** Launch the selected spaceport's rocket. */
  private launch(): void {
    const id = this.settlementId;
    const b = this.selected === null ? undefined : this.view?.buildings[this.selected];
    if (id === null || b === undefined) return;
    const outcome = this.hooks.onLaunch(id, b.tx, b.ty);
    this.notice = outcome.ok ? "The rocket is away." : `Cannot launch: ${outcome.reason ?? "refused"}.`;
    this.lastPanel = -Infinity;
  }

  /** A drag with the corridor or cable tool begins: it lays, or - begun on a tile of it - takes up. */
  private startPainting(at: { x: number; y: number }): void {
    const view = this.view;
    const cam = this.camera;
    if (view === null || cam === null) return;
    const size = this.viewSize();
    const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y);
    if (tile === null || this.paving === null) return;
    const mode = view[this.paving][tile.ty * view.tiles + tile.tx] === true ? "clear" : "lay";
    this.painting = { mode, last: -1 };
    this.paint(at);
  }

  /** Lay or take up on the tile under the pointer, once per tile the drag crosses. */
  paint(at: { x: number; y: number }): void {
    const view = this.view;
    const cam = this.camera;
    const id = this.settlementId;
    const p = this.painting;
    const layer = this.paving;
    if (view === null || cam === null || id === null || p === null || layer === null) return;
    const size = this.viewSize();
    const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y);
    if (tile === null) return;
    const key = tile.ty * view.tiles + tile.tx;
    if (key === p.last) return;
    p.last = key;
    const has = this.settlement?.[layer].includes(tileKey(tile.tx, tile.ty)) === true;
    if (p.mode === "lay" && !has) {
      const outcome = this.hooks.onLink(id, layer, tile.tx, tile.ty);
      this.notice = outcome.ok ? null : `Cannot lay ${layer === "cables" ? "cable" : "corridor"}: ${outcome.reason ?? "refused"}.`;
    } else if (p.mode === "clear" && has) {
      this.hooks.onUnlink(id, layer, tile.tx, tile.ty);
      this.notice = null;
    }
    this.lastPanel = -Infinity;
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
