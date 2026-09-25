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

import { CITY_BACKGROUND, CITY_TILE_PX, cityScene, groundPointAt, rayHit } from "../render/city.js";
import type { CitySceneOptions } from "../render/city.js";
import type { Shape } from "../render/raster.js";
import type { BuildingType, CityView, HabitatChannels, MicroResource, Settlement, Tuning } from "../sim/index.js";
import type { Layer, LinkLayer } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, MICRO_RESOURCES, buildYears, cityView, frameOf, layerOf, prepareCity, levelFactor, maxLevel, roverCount, roverYears, tileKey } from "../sim/index.js";
import type { CityCamera } from "./city-camera.js";
import { centreCamera, footprintOrigin, pan, qualityFor, screenToIso, zoomAt } from "./city-camera.js";
import type { CardKind } from "./city-cards.js";
import { makePreviews } from "./city-cards.js";
import { ChunkedCity } from "./city-chunks.js";
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
  readonly onLink: (settlementId: string, layer: LinkLayer, tx: number, ty: number) => ActionOutcome;
  /** The same call as a dry run, for the preview. Must not change the world. */
  readonly canLink: (settlementId: string, layer: LinkLayer, tx: number, ty: number) => ActionOutcome;
  readonly onUnlink: (settlementId: string, layer: LinkLayer, tx: number, ty: number) => ActionOutcome;
  /** Send a rover from the headquarters to break the rock on a tile. */
  readonly onSendRover: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  /** Launch the rocket of the spaceport covering a tile. */
  readonly onLaunch: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  /** Lay (and pay for) the corridors and cables that join every building into one network of each. */
  readonly onConnect: (settlementId: string) => ActionOutcome & { readonly laid: number };
  /** Send a rover to level a tile of ground to the level beside it; the sim decides. */
  readonly onLevel: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  /** The same call as a dry run, for the preview. Must not change the world. */
  readonly canLevel: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  /** Raise the building covering (tx, ty) a level; the sim decides. */
  readonly onUpgrade: (settlementId: string, tx: number, ty: number) => ActionOutcome;
  /** Lay the corridors and cables that give every building its own route to two others. */
  readonly onConnectTwice: (settlementId: string) => ActionOutcome & { readonly laid: number };
  /** Claim chunk (i, j) of land - chunk coordinates from the founding square; the sim decides. */
  readonly onClaim: (settlementId: string, i: number, j: number) => ActionOutcome;
  readonly onBack: () => void;
  /** The city planner, the second mode (at the user's request); absent, no button. */
  readonly onPlanner?: () => void;
}

/** Whether a tile of the view carries a link of this layer. */
function linkAt(view: CityView, layer: LinkLayer, i: number): boolean {
  return (layer === "rails" ? view.rails?.[i] : view[layer][i]) === true;
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
/** Milliseconds a frame for making a new city's ground, while it is made. */
const PREPARE_MS = 12;
/** A city wider than this is prepared over frames; a smaller one is made in the first frame, as ever (a 352-tile metropolis took under a second). */
const PREPARE_ABOVE_TILES = 400;

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
  if (b.construction !== undefined && b.construction !== null) return `Under construction: ${Math.round(b.construction * 100)}% built. A rover is at work on it.`;
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
export function pickAt(view: CityView, cam: CityCamera, viewW: number, viewH: number, px: number, py: number, groundOnly = false) {
  const iso = screenToIso(cam, viewW, viewH, px, py);
  return rayHit(view, iso.sx, iso.sy, groundOnly);
}

/** The building under a screen point, or null. */
export function pickBuilding(view: CityView, cam: CityCamera, viewW: number, viewH: number, px: number, py: number): number | null {
  const hit = pickAt(view, cam, viewW, viewH, px, py);
  return hit !== null && hit.kind === "building" ? hit.index : null;
}

/**
 * The tile under a screen point, whatever stands on it - where a placement
 * would go. `groundOnly` (building mode): buildings have no hitbox, so the
 * tile is the ground's under the pointer even behind a building.
 */
export function tileUnder(view: CityView, cam: CityCamera, viewW: number, viewH: number, px: number, py: number, groundOnly = false): { tx: number; ty: number } | null {
  const hit = pickAt(view, cam, viewW, viewH, px, py, groundOnly);
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
  /**
   * The build bar's own scrollbar (at the user's request: "scrolling left and
   * right has become very hard - 4x the height of the scrollbar, a grabbing
   * hand"). A browser's scrollbar takes no cursor of ours, so this is drawn:
   * a track under the cards, and a thumb to drag.
   */
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  private dragThumb: { x: number; scroll: number } | null = null;
  private readonly hint: HTMLElement;
  /** The build bar along the bottom (at the user's request, as in Clash of Clans). */
  private readonly dock: HTMLElement;
  /**
   * Corridors, cables, "connect all" and "claim land", top right (at the
   * user's request: "not in the main bar, so connective things are on top
   * and always available").
   */
  private readonly tools: HTMLElement;
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
  private readonly upgradeButton: HTMLButtonElement;
  /** The city's still parts, kept as pictures chunk by chunk; made with the first frame that has a canvas. */
  private chunks: ChunkedCity<HTMLCanvasElement> | null = null;
  private chunkCtx: CanvasRenderingContext2D | null = null;

  private settlementId: string | null = null;
  /**
   * The city's ground being made, a little each frame, when it is opened for
   * the first time: a metropolis's is seven million heights, and made in one
   * go it froze the browser for seconds (measured).
   */
  private preparing: Generator<number, void> | null = null;
  private camera: CityCamera | null = null;
  private placing: BuildingType | null = null;
  /** The corridor or cable tool, when one is armed. */
  private paving: LinkLayer | null = null;
  /** Claim mode: the land on offer is drawn, and a click claims the chunk under the pointer. */
  private claiming = false;
  /** The levelling tool: a click sends a rover to level the tile. */
  private levelling = false;
  private claimHover: { i: number; j: number } | null = null;
  /** The view's origin the camera was last placed against: a claim west or north moves every tile. */
  private origin: { x: number; y: number } | null = null;
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
    const modes = el("div", "city-modes");
    modes.append(button("city-back", "Back to orbit", () => this.hooks.onBack()));
    const onPlanner = this.hooks.onPlanner;
    if (onPlanner !== undefined) modes.append(button("city-planner", "City planner", () => onPlanner()));
    head.append(modes, this.title, this.where);

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
    this.track = el("div", "city-cards-track");
    this.thumb = el("div", "city-cards-thumb");
    this.thumb.setAttribute("role", "scrollbar");
    this.thumb.setAttribute("aria-orientation", "horizontal");
    this.thumb.setAttribute("aria-label", "Scroll the build bar");
    this.track.append(this.thumb);
    this.dock.append(this.hint, this.palette, this.track);
    this.bindScrollbar();
    this.tools = el("div", "city-tools");
    this.tools.setAttribute("role", "toolbar");
    this.tools.setAttribute("aria-label", "Connect and claim");
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
    this.upgradeButton = button("city-upgrade", "Upgrade", () => this.upgradeSelected());
    this.launchButton = button("city-launch", "Launch rocket", () => this.launch());
    actions.append(
      this.upgradeButton,
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
    this.root.append(this.canvas, panel, this.tools, this.dock, this.tip);
    host.append(this.root);
    this.bindInput();
  }

  get openId(): string | null {
    return this.settlementId;
  }

  open(settlementId: string): void {
    this.settlementId = settlementId;
    this.preparing = null;
    this.camera = null;
    this.chunks?.clear();
    this.placing = null;
    this.paving = null;
    this.claiming = false;
    this.levelling = false;
    this.claimHover = null;
    this.origin = null;
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
    if (type !== null) {
      this.paving = null;
      this.claiming = false;
      this.levelling = false;
    }
    this.notice = null;
    if (type !== null) this.select(null);
    this.renderPalette(true);
    this.lastPanel = -Infinity;
  }

  /** Arm the corridor or cable tool, or put it down with null. */
  armLink(layer: LinkLayer | null): void {
    this.paving = layer;
    if (layer !== null) {
      this.placing = null;
      this.claiming = false;
      this.levelling = false;
      this.select(null);
    }
    this.notice = null;
    this.renderPalette(true);
    this.lastPanel = -Infinity;
  }

  /** Claim mode on or off: the land on offer is shown, and a click claims. */
  armClaim(on: boolean): void {
    this.claiming = on;
    this.claimHover = null;
    if (on) {
      this.placing = null;
      this.paving = null;
      this.levelling = false;
      this.select(null);
      this.selectedTile = null;
    }
    this.notice = null;
    this.renderPalette(true);
    this.lastPanel = -Infinity;
  }

  /** The levelling tool on or off. */
  armLevel(on: boolean): void {
    this.levelling = on;
    if (on) {
      this.placing = null;
      this.paving = null;
      this.claiming = false;
      this.select(null);
      this.selectedTile = null;
    }
    this.notice = null;
    this.renderPalette(true);
    this.lastPanel = -Infinity;
  }

  /** The chunk of land under a screen point, in chunk coordinates. */
  chunkAt(px: number, py: number): { i: number; j: number } | null {
    const view = this.view;
    const cam = this.camera;
    if (view === null || cam === null) return null;
    const size = this.viewSize();
    const iso = screenToIso(cam, size.w, size.h, px, py);
    const p = groundPointAt(view, iso.sx, iso.sy);
    const c = view.claims.chunk;
    return { i: Math.floor((p.x + view.origin.x) / c), j: Math.floor((p.y + view.origin.y) / c) };
  }

  /** Claim the chunk under a screen point, and say what happened. */
  private claimAt(at: { x: number; y: number }): void {
    const id = this.settlementId;
    const chunk = this.chunkAt(at.x, at.y);
    if (id === null || chunk === null) return;
    const outcome = this.hooks.onClaim(id, chunk.i, chunk.j);
    this.notice = outcome.ok ? "Claimed. The city may build there now." : `Cannot claim: ${outcome.reason ?? "refused"}.`;
    this.lastPanel = -Infinity;
    this.renderPalette(true);
  }

  /** Building mode: a tool that works on the ground is armed - buildings see-through, with no hitbox. */
  private get building(): boolean {
    return this.placing !== null || this.paving !== null || this.levelling;
  }

  /** "Connect twice": every building its own route to two others. */
  connectTwice(): void {
    const id = this.settlementId;
    if (id === null) return;
    const outcome = this.hooks.onConnectTwice(id);
    this.notice = outcome.ok ? `Laid ${outcome.laid} tile${outcome.laid === 1 ? "" : "s"} of corridor and cable: every building has two routes where it can.` : `Cannot connect twice: ${outcome.reason ?? "refused"}.`;
    this.lastPanel = -Infinity;
  }

  private upgradeSelected(): void {
    const id = this.settlementId;
    const b = this.selected === null ? undefined : this.view?.buildings[this.selected];
    if (id === null || b === undefined) return;
    const outcome = this.hooks.onUpgrade(id, b.tx, b.ty);
    this.notice = outcome.ok ? (this.tuning.BUILD_TIME_ENABLED > 0 ? "A rover is on its way to upgrade it." : "Upgraded.") : `Cannot upgrade: ${outcome.reason ?? "refused"}.`;
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
    if (this.view === null && frameOf(settlement, this.tuning).n > PREPARE_ABOVE_TILES) {
      // Made once, a frame's worth at a time; on a city already made, this is done at the first step.
      this.preparing ??= prepareCity(settlement, this.tuning);
      // As much as fits in a frame, then show how far it is.
      const until = performance.now() + PREPARE_MS;
      let step = this.preparing.next();
      while (step.done !== true && performance.now() < until) step = this.preparing.next();
      if (step.done !== true) {
        this.drawPreparing(step.value);
        return;
      }
      this.preparing = null;
    }
    // The view is re-derived a few times a second, not every frame: for a
    // metropolis it costs ~15 ms. A change of buildings, corridors, cables,
    // rocks or jobs - anything a click does - refreshes it at once, so the
    // player never waits for their click.
    let view = this.view;
    const links = [settlement.corridors, settlement.cables, settlement.cleared, settlement.jobs.length, settlement.claims];
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
    // A claim west or north moved the frame's corner, and every tile index with
    // it: move the camera by as much, so the ground stays where it was on screen.
    const o = this.origin;
    if (o !== null && (o.x !== view.origin.x || o.y !== view.origin.y)) {
      const dx = o.x - view.origin.x;
      const dy = o.y - view.origin.y;
      this.camera = { ...this.camera, cx: this.camera.cx + ((dx - dy) * CITY_TILE_PX.w) / 2, cy: this.camera.cy + ((dx + dy) * CITY_TILE_PX.h) / 2 };
      this.hover = null;
    }
    this.origin = view.origin;
    this.draw(view, now, size);
    if (now - this.lastPanel >= 1000 / PANEL_HZ) {
      this.lastPanel = now;
      this.renderPanel(view, settlement, env);
    }
  }

  // ---- drawing ---------------------------------------------------------------

  /** While the ground is made: the city's name, and how far along. */
  private drawPreparing(fraction: number): void {
    const ctx = this.canvas.getContext("2d");
    const size = this.viewSize();
    this.status.textContent = `Surveying the ground: ${Math.round(fraction * 100)}%`;
    this.status.dataset["state"] = "ok";
    if (ctx === null) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const pw = Math.round(size.w * dpr);
    const ph = Math.round(size.h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = CITY_BACKGROUND;
    ctx.fillStyle = `rgb(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)})`;
    ctx.fillRect(0, 0, size.w, size.h);
    const w = Math.min(360, size.w * 0.6);
    const x = (size.w - w) / 2;
    const y = size.h / 2;
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = "rgb(130,180,255)";
    ctx.fillRect(x, y, w * fraction, 6);
    ctx.fillStyle = "rgb(236,236,238)";
    ctx.font = "15px Lexend, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Surveying the ground - ${Math.round(fraction * 100)}%`, size.w / 2, y - 14);
  }

  private viewSize(): { w: number; h: number } {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return { w: rect.width, h: rect.height };
    return { w: this.canvas.width || 800, h: this.canvas.height || 600 };
  }

  sceneOptions(now: number): CitySceneOptions {
    const claimable = this.claimable();
    return { time: now / 1000, selected: this.selected, ghost: this.ghost(), selectedTile: this.selectedTile, sinceYears: this.sinceYears, seeThrough: this.building, ...(claimable === undefined ? {} : { claimable }) };
  }

  /** In claim mode, the land on offer: ready if the city has the people for another claim. */
  private claimable(): CitySceneOptions["claimable"] {
    const view = this.view;
    if (!this.claiming || view === null) return undefined;
    const ready = view.claims.allowed > view.claims.held;
    const h = this.claimHover;
    return view.claims.open.map((c) => ({ tx: c.tx, ty: c.ty, size: view.claims.chunk, ready, hover: h !== null && h.i === c.i && h.j === c.j }));
  }

  private ghost(): CitySceneOptions["ghost"] {
    if (this.levelling && this.hover !== null && this.settlementId !== null) {
      return { tx: this.hover.tx, ty: this.hover.ty, size: 1, valid: this.hooks.canLevel(this.settlementId, this.hover.tx, this.hover.ty).ok };
    }
    if (this.paving !== null && this.hover !== null && this.settlementId !== null && this.view !== null) {
      // On a tile of it the tool takes it up, which is always allowed; elsewhere, ask the sim.
      const onLink = linkAt(this.view, this.paving, this.hover.ty * this.view.tiles + this.hover.tx);
      const ok = onLink || this.hooks.canLink(this.settlementId, this.paving, this.hover.tx, this.hover.ty).ok;
      return { tx: this.hover.tx, ty: this.hover.ty, size: 1, valid: ok };
    }
    if (this.placing === null || this.hover === null || this.settlementId === null) return null;
    const size = BUILDING_DEFS[this.placing].footprint;
    const depth = BUILDING_DEFS[this.placing].depth;
    const at = footprintOrigin(this.hover.tx, this.hover.ty, size, depth);
    const dry = this.hooks.canPlace(this.settlementId, this.placing, at.tx, at.ty);
    return { tx: at.tx, ty: at.ty, size, depth, valid: dry.ok };
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
    // The still city as pictures, chunk by chunk; only what moves is filled every frame.
    this.chunkCtx = ctx;
    this.chunks ??= new ChunkedCity<HTMLCanvasElement>({
      make: (w, h) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        return c.getContext("2d") === null ? null : c;
      },
      paint: (picture, shapes, scale, ox, oy) => {
        const pc = picture.getContext("2d");
        if (pc === null) return;
        pc.setTransform(scale, 0, 0, scale, ox, oy);
        fillShapes(pc, shapes);
      },
      blit: (picture, x, y, w, h) => this.chunkCtx?.drawImage(picture, x, y, w, h),
      fill: (shapes) => {
        if (this.chunkCtx !== null) fillShapes(this.chunkCtx, shapes);
      },
      now: () => performance.now(),
    });
    this.chunks.draw(view, { ...this.sceneOptions(now), quality: qualityFor(cam, size.w, size.h, view.world.size) }, viewport, k);
  }

  // ---- panel -----------------------------------------------------------------

  private renderPanel(view: CityView, s: Settlement, env: HabitatChannels): void {
    this.title.textContent = settlementLabel(s);
    // Detail §1.3: "Elevation is shown at founding and at placement."
    this.where.textContent = `${s.kind === "city" ? "City" : s.kind === "metropolis" ? "Metropolis" : "Outpost"} - ${formatLatLon(s.lat, s.lon)} - ${formatMetres(view.baseElevationM)} on the planet`;
    const people =
      view.kind !== "outpost"
        ? `${Math.floor(view.population)} of ${view.housing} people housed. ${this.landWords(view)} `
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
    this.placeThumb();
    const here = this.placing !== null && this.hover !== null ? this.groundWords(view, this.hover.tx, this.hover.ty) : "";
    this.hint.textContent =
      this.levelling
        ? this.notice ?? `Click a tile of ground to send a rover to level it to the level beside it - for looks, and so a building needs no foundation there. It breaks any rock there too. Esc finishes.${this.hover !== null ? this.groundWords(view, this.hover.tx, this.hover.ty) : ""}`
        : this.claiming
        ? this.notice ?? this.claimHint(view)
        : this.paving === "rails"
          ? this.notice ?? `Click or drag to lay railway (${this.tuning.COST_RAIL} materials a tile). A line of rail between two stations joins the corridors and cables round each. Start on a rail to take it up. Esc finishes.`
          : this.paving === "corridors"
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
    const level = b?.level ?? 1;
    const up = b !== undefined && BUILDING_DEFS[b.type].buildable && level < maxLevel(b.type, this.tuning) && (b.construction ?? null) === null;
    this.upgradeButton.hidden = !up;
    if (up && b !== undefined) this.upgradeButton.textContent = `Upgrade to level ${level + 1} (${BUILDING_DEFS[b.type].cost(this.tuning)})`;
    this.roverButton.hidden = !(b === undefined && this.selectedTile !== null);
    this.launchButton.hidden = b?.type !== "spaceport";
    if (b === undefined && this.selectedTile !== null) this.renderRock(view, s, this.selectedTile);
    if (b !== undefined && index !== null) {
      const def = BUILDING_DEFS[b.type];
      this.inspectorName.textContent = def.name;
      this.inspectorStatus.textContent = offlineReason(view, index, env, this.tuning) ?? "Running.";
      this.inspectorStatus.dataset["state"] = b.operable ? "ok" : "off";
      this.inspectorSummary.textContent = def.buildable ? `Level ${level} of ${maxLevel(b.type, this.tuning)}. ${def.summary}` : def.summary;
      const extra: string[] = [];
      if (def.housing(this.tuning) > 0) extra.push(`Houses ${fmt(def.housing(this.tuning) * levelFactor(level, this.tuning))}.`);
      if (def.planetaryCo2(this.tuning) > 0) extra.push(`Draws ${def.planetaryCo2(this.tuning)} mbar/yr of CO2 from the planet.`);
      // What it makes at its level (x1.1 a level); what it draws does not grow.
      const k = levelFactor(level, this.tuning);
      const made = Object.fromEntries(Object.entries(def.produces(this.tuning)).map(([r, v]) => [r, (v ?? 0) * k]));
      if (level > 1) extra.push(`Level ${level}: x${k.toFixed(2)} output.`);
      this.inspectorFlows.textContent = `Uses ${rateList(def.consumes(this.tuning, env))}. Makes ${rateList(made)}. ${extra.join(" ")}`.trim();
      if (b.type === "spaceport") {
        const job = s.jobs.find((j) => j.kind === "rocket" && j.tile === tileKey(b.tx, b.ty));
        this.inspectorSummary.textContent =
          job === undefined
            ? `${def.summary} Launch a supply rocket: back in ${seconds(this.tuning.ROCKET_TRIP_YEARS, this.tuning)} with ${this.tuning.ROCKET_MATERIALS} materials, or as many as the stores have room for.`
            : `Its rocket is away: back in ${seconds(job.remaining, this.tuning)}.`;
      }
    }
  }

  /** The land the city holds, in words: its claims, and when the next opens. */
  private landWords(view: CityView): string {
    const c = view.claims;
    if (c.nextAt === null) return "";
    const held = c.held === 0 ? "Its founding land only" : `Its founding land and ${c.held} claim${c.held === 1 ? "" : "s"}`;
    return c.allowed > c.held ? `${held} - it can claim more land now.` : `${held}; more land at ${c.nextAt} people.`;
  }

  private claimHint(view: CityView): string {
    const c = view.claims;
    if (c.nextAt === null) return "Only a city can claim land. Esc finishes.";
    const now = c.allowed - c.held;
    return now > 0
      ? `Click a green square beside the city's land to claim it (${now} to claim now; each is ${c.chunk} x ${c.chunk} tiles). Esc finishes.`
      : `The city needs ${c.nextAt} people to claim more land - it has ${Math.floor(view.population)}. Each claim is ${c.chunk} x ${c.chunk} tiles beside its own. Esc finishes.`;
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
      const rovers = roverCount(s, this.tuning);
      this.inspectorStatus.textContent = `A rover would take ${seconds(roverYears(s, tile.tx, tile.ty, rock, this.tuning), this.tuning)} there and back. ${rovers - out} of ${rovers} rovers in.`;
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
    const view = this.view;
    const land = view === null ? "" : `${view.claims.held}/${view.claims.allowed}`;
    const env = this.env;
    const unlocked = BUILDING_TYPES.filter((type) => s.population >= BUILDING_DEFS[type].minPopulation(this.tuning) && (env === null || BUILDING_DEFS[type].locked(env, this.tuning) === null)).length;
    const key = `${s.kind}|${this.placing ?? ""}|${this.paving}|${Math.floor(s.stores.materials)}|${this.claiming}|${this.levelling}|${land}|${unlocked}`;
    if (!force && key === this.paletteKind) return;
    this.paletteKind = key;
    const cards = BUILDING_TYPES.filter((type) => BUILDING_DEFS[type].buildable && BUILDING_DEFS[type].kinds.includes(s.kind)).map((type) => {
      const cost = BUILDING_DEFS[type].cost(this.tuning);
      const c = this.card(type, BUILDING_DEFS[type].name, `${cost}`, s.stores.materials < cost, this.placing === type, () => this.arm(this.placing === type ? null : type));
      // A building the city is not yet big enough for says so on its card.
      const needs = BUILDING_DEFS[type].minPopulation(this.tuning);
      if (needs > 0 && s.population < needs) {
        c.dataset["locked"] = "true";
        c.append(el("span", "city-card-short", `at ${needs.toLocaleString("en")} people`));
      } else if (env !== null && BUILDING_DEFS[type].locked(env, this.tuning) !== null) {
        // One the planet is not ready for: the air too thin for wind, not yet open for a park.
        c.dataset["locked"] = "true";
        c.append(el("span", "city-card-short", type === "wind_turbine" ? `at ${this.tuning.WIND_MIN_PRESSURE} mbar` : "when terraformed"));
      }
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
    const twice = this.card("redundant", "Connect twice", `${Math.min(t.COST_CORRIDOR, t.COST_CABLE)}+ / tile`, false, null, () => this.connectTwice());
    twice.classList.add("city-connect-twice");
    // Claim land: always on the bar, as the others are; an outpost's says it cannot.
    const c = view?.claims;
    const price = c === undefined || c.nextAt === null ? "cities only" : c.allowed > c.held ? `${c.allowed - c.held} to claim` : `at ${c.nextAt} people`;
    const claim = this.card("claim", "Claim land", price, false, this.claiming, () => this.armClaim(!this.claiming));
    claim.classList.add("city-claim");
    const rail = this.card("rail", "Railway", `${t.COST_RAIL} / tile`, s.stores.materials < t.COST_RAIL, this.paving === "rails", () => this.armLink(this.paving === "rails" ? null : "rails"));
    rail.classList.add("city-rail");
    const level = this.card("level", "Level ground", "a rover", false, this.levelling, () => this.armLevel(!this.levelling));
    level.classList.add("city-level");
    this.palette.replaceChildren(...cards);
    this.tools.replaceChildren(corridor, cable, rail, connect, twice, claim, level);
    this.placeThumb();
    // A card rebuilt under the pointer keeps its tooltip.
    if (this.tipFor !== null) {
      const again = [...this.palette.children, ...this.tools.children].find((c) => (c as HTMLElement).dataset["card"] === this.tipFor) as HTMLElement | undefined;
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
    if (kind === "rail") {
      return {
        title: "Railway",
        lines: [
          "Track between stations: two stations on one line of rail join the corridors and cables round each - one city across its districts.",
          "Only stations board a line.",
          `Costs ${t.COST_RAIL} materials a tile. Click or drag to lay it; start a drag on a rail to take it up.`,
        ],
      };
    }
    if (kind === "redundant") {
      return {
        title: "Connect twice",
        lines: [
          "Gives every building its own route to its two nearest buildings - two different ones where it can reach two - by corridor and by cable.",
          "So one broken link leaves nothing cut off.",
          `Costs ${t.COST_CORRIDOR} material a tile of corridor, ${t.COST_CABLE} a tile of cable.`,
        ],
      };
    }
    if (kind === "level") {
      return {
        title: "Level ground",
        lines: [
          "Send a rover to level a tile to the level beside it: the nearest level ground within a few tiles, or the tile's own height.",
          "Level ground looks tidier, and a building on it needs no concrete foundation.",
          `Free; the rover takes a while, and any rock there is broken and brought back. One tile per rover (${this.tuning.ROVERS_PER_HQ} at the headquarters, one more per Rover Post).`,
        ],
      };
    }
    if (kind === "claim") {
      return {
        title: "Claim land",
        lines: [
          `A city claims land beside its own, ${t.CLAIM_CHUNK_TILES} x ${t.CLAIM_CHUNK_TILES} tiles at a time: the first at ${t.CLAIM_FIRST_POPULATION} people, and one more with every ${t.CLAIM_STEP_POPULATION} after.`,
          "The world reaches further in every direction the city grows.",
          "Free - land is earned by growing.",
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
    if (def.research(t) > 0) lines.push(`Research: ${def.research(t)} credits a year while it runs.`);
    if (def.minPopulation(t) > 0) lines.push(`Needs a city of ${def.minPopulation(t).toLocaleString("en")} people.`);
    const locked = this.env === null ? null : def.locked(this.env, t);
    if (locked !== null) lines.push(`Not yet: ${locked}.`);
    lines.push(`${def.footprint} x ${def.depth} tiles. Costs ${def.cost(t)} materials.`);
    if (t.BUILD_TIME_ENABLED > 0) lines.push(`A rover builds it in ${Math.round(buildYears(kind, t) * 10)} month${Math.round(buildYears(kind, t) * 10) === 1 ? "" : "s"} at the site (${seconds(buildYears(kind, t), t)}), plus the drive.`);
    lines.push(`Upgrades to level ${maxLevel(kind, t)}, each +${Math.round(t.LEVEL_BONUS * 100)}% on the last.`);
    return { title: def.name, lines };
  }

  private showTip(kind: CardKind, card: HTMLElement): void {
    const { title, lines } = this.tipText(kind);
    this.tip.replaceChildren(el("strong", "city-tip-title", title), ...lines.map((line) => el("p", "city-tip-line", line)));
    this.tip.hidden = false;
    this.tipFor = kind;
    // Centred on the card, kept inside the window: above a card of the build
    // bar, below one of the tools at the top.
    const r = card.getBoundingClientRect();
    const width = this.tip.offsetWidth || 280;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, (globalThis.innerWidth || 1024) - width - 8));
    this.tip.style.left = `${left}px`;
    if (this.tools.contains(card)) {
      this.tip.style.top = `${r.bottom + 10}px`;
      this.tip.style.bottom = "";
    } else {
      this.tip.style.top = "";
      this.tip.style.bottom = `${(globalThis.innerHeight || 768) - r.top + 10}px`;
    }
  }

  private hideTip(): void {
    this.tip.hidden = true;
    this.tipFor = null;
  }

  // ---- the build bar's scrollbar -------------------------------------------------

  /** The thumb as wide as the share of the cards in view, and where the view is along them. */
  placeThumb(): void {
    const view = this.palette.clientWidth;
    const all = this.palette.scrollWidth;
    const trackW = this.track.clientWidth;
    const overflow = all > view + 1;
    this.track.hidden = !overflow;
    if (!overflow || trackW <= 0) return;
    const width = Math.max(48, (view / all) * trackW);
    const range = all - view;
    const left = range > 0 ? (this.palette.scrollLeft / range) * (trackW - width) : 0;
    this.thumb.style.width = `${width}px`;
    this.thumb.style.transform = `translateX(${left}px)`;
  }

  private bindScrollbar(): void {
    this.palette.addEventListener("scroll", () => this.placeThumb());
    globalThis.addEventListener?.("resize", () => this.placeThumb());
    // The wheel scrolls the row sideways, as a row of cards should.
    this.palette.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        this.palette.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    this.thumb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.thumb.setPointerCapture?.(e.pointerId);
      this.dragThumb = { x: e.clientX, scroll: this.palette.scrollLeft };
      // Grabbing: the closed hand everywhere while held, and the thumb goes white.
      this.thumb.dataset["dragging"] = "true";
      this.root.dataset["grabbing"] = "true";
    });
    this.thumb.addEventListener("pointermove", (e) => {
      const d = this.dragThumb;
      if (d === null) return;
      const trackW = this.track.clientWidth;
      const width = this.thumb.offsetWidth;
      const range = this.palette.scrollWidth - this.palette.clientWidth;
      if (trackW - width <= 0) return;
      this.palette.scrollLeft = d.scroll + ((e.clientX - d.x) / (trackW - width)) * range;
      this.placeThumb();
    });
    const release = (): void => {
      this.dragThumb = null;
      delete this.thumb.dataset["dragging"];
      delete this.root.dataset["grabbing"];
    };
    this.thumb.addEventListener("pointerup", release);
    this.thumb.addEventListener("pointercancel", release);
    // A click on the track, off the thumb, jumps the view there.
    this.track.addEventListener("pointerdown", (e) => {
      if (e.target !== this.track) return;
      const r = this.track.getBoundingClientRect();
      const range = this.palette.scrollWidth - this.palette.clientWidth;
      const at = (e.clientX - r.left - this.thumb.offsetWidth / 2) / Math.max(1, this.track.clientWidth - this.thumb.offsetWidth);
      this.palette.scrollLeft = Math.min(1, Math.max(0, at)) * range;
      this.placeThumb();
    });
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
        this.hover = tileUnder(this.view, this.camera, size.w, size.h, local.x, local.y, this.building);
        if (this.claiming) this.claimHover = this.chunkAt(local.x, local.y);
        if (this.levelling && (before?.tx !== this.hover?.tx || before?.ty !== this.hover?.ty)) this.lastPanel = -Infinity;
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
      if (this.claiming) this.armClaim(false);
      else if (this.levelling) this.armLevel(false);
      else if (this.paving !== null) this.armLink(null);
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
    if (this.claiming) {
      this.claimAt(at);
      return;
    }
    if (this.levelling) {
      const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y, true);
      if (tile === null) return;
      const outcome = this.hooks.onLevel(id, tile.tx, tile.ty);
      this.notice = outcome.ok ? "A rover is on its way to level the ground." : `Cannot level: ${outcome.reason ?? "refused"}.`;
      this.lastPanel = -Infinity;
      return;
    }
    if (this.placing !== null) {
      const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y, true);
      if (tile === null) return;
      const origin = footprintOrigin(tile.tx, tile.ty, BUILDING_DEFS[this.placing].footprint, BUILDING_DEFS[this.placing].depth);
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
    const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y, true);
    if (tile === null || this.paving === null) return;
    const mode = linkAt(view, this.paving, tile.ty * view.tiles + tile.tx) ? "clear" : "lay";
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
    const tile = tileUnder(view, cam, size.w, size.h, at.x, at.y, true);
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
