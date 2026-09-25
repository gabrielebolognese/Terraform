/**
 * The world map (at the user's request: "we also need interconnected cities:
 * a middle game where the full map of the world is visible in 2D, with all
 * the cities extremely zoomed out; you decide how big in tiles the world
 * is").
 *
 * The planet flat, as a map: WORLD_TILES_X by WORLD_TILES_Y world tiles, a
 * world tile about 10 km at the equator (Mars is 21,300 km round). Its ground
 * by height and green, its sea where the water stands; every settlement at
 * its place - a mark and its name far out, the very chunks it holds up close
 * - and the railways between them with their trains. Choose a settlement to
 * open it, or to join it to another by rail.
 *
 * Like the other screens it owns no state: it is handed the world each
 * frame, and asks the simulation, by hooks, to change anything.
 */

import type { HabitatChannels, Route, Settlement, SimState, Tuning } from "../sim/index.js";
import { MARS_RADIUS_M, keyChunk, routeCost, routeKm, siteElevation } from "../sim/index.js";
import { settlementLabel } from "./settlement-label.js";

/** The world, in world tiles: 2,048 round, 1,024 pole to pole. */
export const WORLD_TILES_X = 2048;
export const WORLD_TILES_Y = 1024;
/** How far a world tile is, kilometres: round the equator, and pole to pole. */
export const WORLD_TILE_KM = (2 * Math.PI * MARS_RADIUS_M) / 1000 / WORLD_TILES_X;

/** The map's picture: a pixel for every two world tiles each way. */
export const MAP_W = 1024;
export const MAP_H = 512;

/** Where a place lies on the map, in world tiles: west to east from the dateline, north to south from the pole. */
export function worldPoint(lat: number, lon: number): { x: number; y: number } {
  const wrapped = ((((lon + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return { x: ((wrapped + Math.PI) / (2 * Math.PI)) * WORLD_TILES_X, y: ((Math.PI / 2 - lat) / Math.PI) * WORLD_TILES_Y };
}

/**
 * The map's picture, a row at a time, yielding how far through it is: under
 * the sea blue and deeper darker; above it the planet's rust, lighter the
 * higher, greening with the planet's green in the lowlands.
 */
export function* mapImage(
  elevation: (lat: number, lon: number) => number,
  seaLevelM: number,
  oceanFraction: number,
  greenery: number,
  w = MAP_W,
  h = MAP_H,
): Generator<number, Uint8ClampedArray<ArrayBuffer>> {
  const px = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const sea = oceanFraction > 0;
  for (let y = 0; y < h; y += 1) {
    const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x += 1) {
      const lon = ((x + 0.5) / w) * 2 * Math.PI - Math.PI;
      const z = elevation(lat, lon);
      const i = (y * w + x) * 4;
      if (sea && z < seaLevelM) {
        const deep = Math.min(1, (seaLevelM - z) / 4000);
        px[i] = 30 - 16 * deep;
        px[i + 1] = 70 - 34 * deep;
        px[i + 2] = 120 - 40 * deep;
      } else {
        const high = Math.min(1, Math.max(0, (z - seaLevelM + 2000) / 14000));
        const green = greenery * (1 - high) * 0.8;
        const rust = [150 + 60 * high, 88 + 60 * high, 62 + 54 * high];
        px[i] = rust[0]! * (1 - green) + 70 * green;
        px[i + 1] = rust[1]! * (1 - green) + 130 * green;
        px[i + 2] = rust[2]! * (1 - green) + 64 * green;
      }
      // The poles under ice.
      if (Math.abs(lat) > 1.42) {
        px[i] = 228;
        px[i + 1] = 232;
        px[i + 2] = 236;
      }
      px[i + 3] = 255;
    }
    if (y % 8 === 7) yield (y + 1) / h;
  }
  return px;
}

export interface WorldMapHooks {
  /** Open a settlement's city view. */
  readonly onOpen: (id: string) => void;
  /** Lay a railway between two settlements; the sim decides. */
  readonly onConnect: (a: string, b: string) => { ok: boolean; reason: string | null; cost: number };
  readonly onClose: () => void;
}

/** A camera on the map: the world tile at the middle of the view, and screen pixels a world tile. */
interface MapCamera {
  x: number;
  y: number;
  scale: number;
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

const KIND_COLOUR: Readonly<Record<Settlement["kind"], string>> = { metropolis: "#ffd36b", city: "#8fd3ff", outpost: "#c9c9cf" };

export class WorldMapScreen {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly panel: HTMLElement;
  private readonly hint: HTMLElement;
  private opened = false;
  private image: Uint8ClampedArray<ArrayBuffer> | null = null;
  private picture: HTMLCanvasElement | null = null;
  private making: Generator<number, Uint8ClampedArray<ArrayBuffer>> | null = null;
  private progress = 0;
  private cam: MapCamera | null = null;
  private state: SimState | null = null;
  /** The settlement chosen, and whether the next choice joins it by rail. */
  selected: string | null = null;
  joining = false;
  private notice: string | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private panelKey = "";

  constructor(
    host: HTMLElement,
    private readonly hooks: WorldMapHooks,
    private readonly tuning: Tuning,
    private readonly elevation: (lat: number, lon: number) => number = (lat, lon) => siteElevation(lat, lon, tuning),
  ) {
    this.root = el("div", "worldmap");
    this.root.hidden = true;
    this.canvas = el("canvas", "worldmap-canvas");
    this.canvas.setAttribute("aria-label", "The planet as a map: every settlement at its place, and the railways between them. Drag to move, scroll to zoom, click a settlement to choose it.");
    const top = el("header", "worldmap-top");
    top.append(button("worldmap-close", "Back to orbit", () => this.hooks.onClose()), el("span", "worldmap-title", "World map"), el("span", "worldmap-scale", `${WORLD_TILES_X.toLocaleString("en")} x ${WORLD_TILES_Y.toLocaleString("en")} world tiles, ${WORLD_TILE_KM.toFixed(1)} km each`));
    this.panel = el("aside", "worldmap-panel");
    this.hint = el("p", "worldmap-hint", "");
    this.hint.setAttribute("role", "status");
    this.root.append(this.canvas, top, this.panel, this.hint);
    host.append(this.root);
    this.bindInput();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(): void {
    this.opened = true;
    this.root.hidden = false;
    this.joining = false;
    this.notice = null;
    this.panelKey = "";
  }

  close(): void {
    this.opened = false;
    this.root.hidden = true;
  }

  /** One frame: the picture made a little more if it is not yet, then the map. */
  frame(state: SimState, env: HabitatChannels, now: number): void {
    if (!this.opened) return;
    this.state = state;
    if (this.image === null) {
      this.making ??= mapImage(this.elevation, env.seaLevelM, env.oceanFraction, env.greenery);
      const until = performance.now() + 12;
      let step = this.making.next();
      while (step.done !== true && performance.now() < until) step = this.making.next();
      if (step.done === true) {
        this.image = step.value;
        this.making = null;
      } else {
        this.progress = step.value;
        this.hint.textContent = `Drawing the map: ${Math.round(this.progress * 100)}%`;
        return;
      }
    }
    this.draw(state, now);
    this.renderPanel(state);
  }

  /** Map pixels from the view's size, and the camera, fitted to the whole world the first time. */
  private view(): { w: number; h: number; cam: MapCamera } {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || 1200));
    const h = Math.max(1, Math.round(rect.height || 700));
    this.cam ??= { x: WORLD_TILES_X / 2, y: WORLD_TILES_Y / 2, scale: this.minScale(w, h) };
    return { w, h, cam: this.cam };
  }

  /** The whole world on screen, and no further out. */
  private minScale(w: number, h: number): number {
    return Math.min(w / WORLD_TILES_X, h / WORLD_TILES_Y);
  }

  /** A settlement's place on screen. */
  screenOf(s: { lat: number; lon: number }): { px: number; py: number } {
    const { w, h, cam } = this.view();
    const p = worldPoint(s.lat, s.lon);
    return { px: w / 2 + (p.x - cam.x) * cam.scale, py: h / 2 + (p.y - cam.y) * cam.scale };
  }

  /** The settlement under a screen point, within a few pixels of its mark. */
  settlementAt(px: number, py: number): Settlement | null {
    const state = this.state;
    if (state === null) return null;
    let best: Settlement | null = null;
    let bestD = 14;
    for (const s of state.settlements) {
      const p = this.screenOf(s);
      const d = Math.hypot(p.px - px, p.py - py);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** A click on the map: choose a settlement - or, joining, lay the railway to it. */
  click(px: number, py: number): void {
    const hit = this.settlementAt(px, py);
    if (hit === null) {
      if (!this.joining) this.selected = null;
      this.panelKey = "";
      return;
    }
    if (this.joining && this.selected !== null && hit.id !== this.selected) {
      const o = this.hooks.onConnect(this.selected, hit.id);
      this.notice = o.ok ? `Railway laid to ${settlementLabel(hit)}: ${o.cost.toLocaleString("en")} materials, half from each end.` : `No railway: ${o.reason ?? "refused"}.`;
      this.hint.textContent = this.notice;
      this.joining = false;
      this.panelKey = "";
      return;
    }
    this.selected = hit.id;
    this.joining = false;
    this.notice = null;
    this.panelKey = "";
  }

  private bindInput(): void {
    const c = this.canvas;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    c.addEventListener("pointerdown", (e) => {
      const p = local(e);
      this.drag = { x: p.x, y: p.y, moved: false };
    });
    c.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (d === null || this.cam === null) return;
      const p = local(e);
      if (Math.hypot(p.x - d.x, p.y - d.y) > 3) d.moved = true;
      if (!d.moved) return;
      this.cam.x -= (p.x - d.x) / this.cam.scale;
      this.cam.y -= (p.y - d.y) / this.cam.scale;
      this.clampCam();
      d.x = p.x;
      d.y = p.y;
    });
    c.addEventListener("pointerup", (e) => {
      const d = this.drag;
      this.drag = null;
      if (d !== null && !d.moved) {
        const p = local(e);
        this.click(p.x, p.y);
      }
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = local(e);
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      },
      { passive: false },
    );
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.opened && this.joining) {
        this.joining = false;
        this.panelKey = "";
        this.hint.textContent = "";
      }
    });
  }

  /** Zoom by `factor` about a screen point: from the whole world to a city's chunks, 256 pixels a world tile. */
  zoomAt(factor: number, px: number, py: number): void {
    const { w, h, cam } = this.view();
    const before = { x: cam.x + (px - w / 2) / cam.scale, y: cam.y + (py - h / 2) / cam.scale };
    cam.scale = Math.min(256, Math.max(this.minScale(w, h), cam.scale * factor));
    cam.x = before.x - (px - w / 2) / cam.scale;
    cam.y = before.y - (py - h / 2) / cam.scale;
    this.clampCam();
  }

  /** The camera's middle stays on the world. */
  private clampCam(): void {
    const cam = this.cam;
    if (cam === null) return;
    cam.x = Math.min(WORLD_TILES_X, Math.max(0, cam.x));
    cam.y = Math.min(WORLD_TILES_Y, Math.max(0, cam.y));
  }

  get scale(): number {
    return this.view().cam.scale;
  }

  private draw(state: SimState, now: number): void {
    const { w, h, cam } = this.view();
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0e0f11";
    ctx.fillRect(0, 0, w, h);
    if (this.picture === null && this.image !== null) {
      this.picture = document.createElement("canvas");
      this.picture.width = MAP_W;
      this.picture.height = MAP_H;
      this.picture.getContext("2d")?.putImageData(new ImageData(this.image, MAP_W, MAP_H), 0, 0);
    }
    const sx = (x: number): number => w / 2 + (x - cam.x) * cam.scale;
    const sy = (y: number): number => h / 2 + (y - cam.y) * cam.scale;
    if (this.picture !== null) {
      ctx.imageSmoothingEnabled = cam.scale < 2;
      ctx.drawImage(this.picture, sx(0), sy(0), WORLD_TILES_X * cam.scale, WORLD_TILES_Y * cam.scale);
    }
    const byId = new Map(state.settlements.map((s) => [s.id, s] as const));
    // The railways, the short way round, and a train on each.
    ctx.lineWidth = Math.max(1.5, Math.min(4, cam.scale * 0.6));
    for (const [k, r] of state.routes.entries()) {
      const a = byId.get(r.a);
      const b = byId.get(r.b);
      if (a === undefined || b === undefined) continue;
      const pa = worldPoint(a.lat, a.lon);
      const pb = worldPoint(b.lat, b.lon);
      let bx = pb.x;
      if (bx - pa.x > WORLD_TILES_X / 2) bx -= WORLD_TILES_X;
      if (pa.x - bx > WORLD_TILES_X / 2) bx += WORLD_TILES_X;
      ctx.strokeStyle = "rgba(255, 214, 120, 0.85)";
      ctx.beginPath();
      ctx.moveTo(sx(pa.x), sy(pa.y));
      ctx.lineTo(sx(bx), sy(pb.y));
      ctx.stroke();
      // A train, there and back along the line, at 300 km an hour of the map's clock.
      const period = Math.max(4, r.km / 150);
      const f = (((now / 1000 + k * 1.7) / period) % 2 + 2) % 2;
      const along = f < 1 ? f : 2 - f;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(sx(pa.x + (bx - pa.x) * along), sy(pa.y + (pb.y - pa.y) * along), Math.max(2, Math.min(5, cam.scale)), 0, 2 * Math.PI);
      ctx.fill();
    }
    // The settlements: up close the chunks each holds, further out a mark; and names.
    const C = this.tuning.CLAIM_CHUNK_TILES;
    const chunkTiles = (C * this.tuning.TILE_METRES) / 1000 / WORLD_TILE_KM;
    for (const s of state.settlements) {
      const p = worldPoint(s.lat, s.lon);
      ctx.fillStyle = s.lostAtSeaLevelM !== null ? "#666" : KIND_COLOUR[s.kind];
      if (chunkTiles * cam.scale >= 1.5) {
        const per = s.base / C;
        const half = per / 2;
        const chunks: [number, number][] = [];
        for (let j = 0; j < per; j += 1) for (let i = 0; i < per; i += 1) chunks.push([i, j]);
        for (const key of s.claims) {
          const { i, j } = keyChunk(key);
          chunks.push([i, j]);
        }
        for (const [i, j] of chunks) {
          ctx.fillRect(sx(p.x + (i - half) * chunkTiles), sy(p.y + (j - half) * chunkTiles), Math.ceil(chunkTiles * cam.scale), Math.ceil(chunkTiles * cam.scale));
        }
      } else {
        const r = s.kind === "metropolis" ? 5 : s.kind === "city" ? 3.5 : 2.5;
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.y), r, 0, 2 * Math.PI);
        ctx.fill();
      }
      if (s.id === this.selected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.y), 10, 0, 2 * Math.PI);
        ctx.stroke();
      }
      if (s.kind !== "outpost" || cam.scale > 1.5) {
        ctx.fillStyle = "rgba(236,236,238,0.92)";
        ctx.font = `${s.kind === "metropolis" ? 13 : 11}px Lexend, Arial, sans-serif`;
        ctx.fillText(settlementLabel(s), sx(p.x) + 7, sy(p.y) - 6);
      }
    }
  }

  private renderPanel(state: SimState): void {
    const s = state.settlements.find((x) => x.id === this.selected) ?? null;
    const routes = s === null ? [] : state.routes.filter((r) => r.a === s.id || r.b === s.id);
    const key = JSON.stringify([s?.id, s === null ? 0 : Math.floor(s.population), routes.length, this.joining, state.routes.length, s === null ? 0 : Math.floor(s.stores.materials / 100)]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    if (this.notice === null) this.hint.textContent = this.joining ? "Click another settlement to lay a railway to it. Esc cancels." : s === null ? "Click a settlement to choose it." : "";
    if (s === null) {
      const people = state.settlements.reduce((a, x) => a + x.population, 0);
      const km = state.routes.reduce((a, r) => a + r.km, 0);
      this.panel.replaceChildren(
        el("h2", "worldmap-name", "The planet"),
        el("p", "worldmap-line", `${state.settlements.length} settlements, ${Math.floor(people).toLocaleString("en")} people.`),
        el("p", "worldmap-line", `${state.routes.length} railways between them, ${Math.round(km).toLocaleString("en")} km.`),
      );
      return;
    }
    const byId = new Map(state.settlements.map((x) => [x.id, x] as const));
    const list = el("ul", "worldmap-routes");
    for (const r of routes) {
      const other = byId.get(r.a === s.id ? r.b : r.a);
      if (other !== undefined) list.append(el("li", "", `${settlementLabel(other)} - ${Math.round(r.km).toLocaleString("en")} km`));
    }
    const kind = s.kind === "metropolis" ? "Metropolis" : s.kind === "city" ? "City" : "Outpost";
    this.panel.replaceChildren(
      el("h2", "worldmap-name", settlementLabel(s)),
      el("p", "worldmap-line", `${kind} - ${Math.floor(s.population).toLocaleString("en")} people - ${s.buildings.length.toLocaleString("en")} buildings`),
      el("p", "worldmap-line", routes.length === 0 ? "No railway to anywhere." : `Railways to ${routes.length} settlement${routes.length === 1 ? "" : "s"}:`),
      list,
      button("worldmap-open", "Open the city", () => this.hooks.onOpen(s.id)),
      button("worldmap-join", this.joining ? "Choose where..." : "Lay a railway to...", () => {
        this.joining = true;
        this.notice = null;
        this.panelKey = "";
      }),
      el("p", "worldmap-note", `A railway costs ${this.tuning.INTERCITY_COST_PER_KM} materials a km, half from each end, and carries up to ${this.tuning.INTERCITY_CARRY} of water, oxygen, food and materials a year each way.`),
    );
  }
}

/** For a railway not yet laid: how long, and what it would cost. */
export function railwayQuote(a: Settlement, b: Settlement, t: Tuning): { km: number; cost: number } {
  return { km: routeKm(a, b), cost: routeCost(a, b, t) };
}

export type { Route };
