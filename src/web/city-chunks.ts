/**
 * The city drawn in chunks (at the user's request: "in a huge metropolis
 * there are still heavy performance issues - without lowering the quality,
 * find a way to make sure the city works very very smooth").
 *
 * Every frame used to fill every shape in view - a whole metropolis is some
 * 200,000. Now the still part of each square of tiles (`CHUNK_TILES` a side:
 * its ground, its piece of the world, its buildings' still parts) is drawn
 * once into a picture of its own, at the zoom it is seen at, and kept. A
 * frame draws the pictures in view, back to front; over each, what moves in
 * it (lights, rockets in flight, rovers); then the overlays. A picture is
 * drawn again only when what is in it changes - its signature - or the zoom
 * moves to another half-octave; those redraws are spread over frames, a few
 * milliseconds at a time, the old picture standing in meanwhile.
 */

import type { CitySceneOptions } from "../render/city.js";
import { CHUNK_TILES_BY_QUALITY, chunkId, cityChunkRange, cityChunkReach, cityChunkSignature, cityLiveChunks, cityScene } from "../render/city.js";
import type { Shape } from "../render/raster.js";
import type { CityView } from "../sim/index.js";

/** Tiles a chunk's side up close; further out chunks are bigger (`CHUNK_TILES_BY_QUALITY`), and fewer. */
export const CHUNK_TILES = CHUNK_TILES_BY_QUALITY.high;

/** Where pictures are made and drawn: the browser's canvases, or a test's stand-in. */
export interface ChunkBackend<P> {
  /** A blank picture `w` by `h` pixels, or null if none can be made. */
  make(w: number, h: number): P | null;
  /** Fill shapes into a picture, scaled by `scale` and shifted by (`ox`, `oy`) pixels. */
  paint(picture: P, shapes: readonly Shape[], scale: number, ox: number, oy: number): void;
  /** Draw a picture into the frame at (x, y), `w` by `h` in the frame's units (iso pixels). */
  blit(picture: P, x: number, y: number, w: number, h: number): void;
  /** Fill shapes straight into the frame. */
  fill(shapes: readonly Shape[]): void;
  /** Milliseconds, for the redraw budget. */
  now(): number;
}

interface Kept<P> {
  sig: string;
  scale: number;
  picture: P | null;
  /** Picture pixels, for the memory budget. */
  area: number;
  minX: number;
  minY: number;
  w: number;
  h: number;
  used: number;
}

/** The half-octave at or above a scale: a picture made for it is only ever shrunk on screen, never blurred up. */
export function pictureScale(scale: number): number {
  return 2 ** (Math.ceil(Math.log2(Math.max(1e-6, scale)) * 2 - 1e-9) / 2);
}

export class ChunkedCity<P> {
  private readonly kept = new Map<string, Kept<P>>();
  private frame = 0;
  private pixels = 0;
  /** Pictures drawn so far: for tests, and to see the cache at work. */
  renders = 0;

  constructor(
    private readonly backend: ChunkBackend<P>,
    private readonly budgetMs = 8,
    // 24 million pixels, some 96 MB of pictures (48 million, with a metropolis's 18,000 chunks to fill, was
    // more than a browser tab could hold beside the city itself).
    private readonly maxPixels = 24_000_000,
    /** Milliseconds a frame for chunks never drawn: a whole metropolis is seconds of work, so it fills in rather than freezing. */
    private readonly firstBudgetMs = 40,
  ) {}

  /** Whether every chunk in view has a picture of what it holds now, at this zoom (a frame found nothing left to draw). */
  settled = true;

  /** Forget every picture (another settlement opened). */
  clear(): void {
    this.kept.clear();
    this.pixels = 0;
  }

  /**
   * One frame. `viewport` in iso pixels; `scale` the frame's pixels per iso
   * pixel (the zoom times the device's pixel ratio).
   */
  draw(view: CityView, options: CitySceneOptions, viewport: { minX: number; maxX: number; minY: number; maxY: number }, scale: number): void {
    this.frame += 1;
    const size = CHUNK_TILES_BY_QUALITY[options.quality ?? "high"];
    const key = (cx: number, cy: number): string => `${size}:${chunkId(cx, cy)}`;
    const want = pictureScale(scale);
    const r = cityChunkRange(view, size);
    const visible: [number, number][] = [];
    for (let cy = r.cy0; cy <= r.cy1; cy += 1) {
      for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
        const reach = cityChunkReach(view, size, cx, cy);
        if (reach.maxX < viewport.minX || reach.minX > viewport.maxX || reach.maxY < viewport.minY || reach.minY > viewport.maxY) continue;
        visible.push([cx, cy]);
      }
    }
    // Back to front, as the painter draws.
    visible.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
    const live = cityLiveChunks(view, options, size);
    // First the pictures to draw this frame: chunks never drawn, nearest the middle of the view first,
    // for `firstBudgetMs`; then stale ones for `budgetMs`. The rest keep their old picture, or wait.
    const cx0 = (viewport.minX + viewport.maxX) / 2;
    const cy0 = (viewport.minY + viewport.maxY) / 2;
    const sigs = new Map<string, string>();
    const missing: [number, number][] = [];
    const stale: [number, number][] = [];
    for (const [cx, cy] of visible) {
      const id = key(cx, cy);
      const sig = cityChunkSignature(view, options, size, cx, cy);
      sigs.set(id, sig);
      const k = this.kept.get(id);
      if (k === undefined) missing.push([cx, cy]);
      else if (k.sig !== sig || k.scale !== want) stale.push([cx, cy]);
    }
    const middle = (c: [number, number]): number => {
      const r = cityChunkReach(view, size, c[0], c[1]);
      return Math.hypot((r.minX + r.maxX) / 2 - cx0, (r.minY + r.maxY) / 2 - cy0);
    };
    missing.sort((a, b) => middle(a) - middle(b));
    const start = this.backend.now();
    for (const c of missing) {
      if (this.backend.now() - start >= this.firstBudgetMs) break;
      this.render(view, options, size, c[0], c[1], sigs.get(key(c[0], c[1]))!, want);
    }
    const again = this.backend.now();
    for (const c of stale) {
      if (this.backend.now() - again >= this.budgetMs) break;
      this.render(view, options, size, c[0], c[1], sigs.get(key(c[0], c[1]))!, want);
    }
    this.settled = missing.every((c) => this.kept.has(key(c[0], c[1]))) && stale.every((c) => this.kept.get(key(c[0], c[1]))!.sig === sigs.get(key(c[0], c[1])) && this.kept.get(key(c[0], c[1]))!.scale === want);
    for (const [cx, cy] of visible) {
      const id = key(cx, cy);
      const k = this.kept.get(id);
      if (k === undefined) continue;
      k.used = this.frame;
      if (k.picture !== null) this.backend.blit(k.picture, k.minX, k.minY, k.w, k.h);
      if (live.has(chunkId(cx, cy))) this.backend.fill(cityScene(view, { ...options, chunk: { x0: cx * size, y0: cy * size, size }, layer: "live" }));
    }
    this.backend.fill(cityScene(view, { ...options, layer: "overlay" }));
    this.evict();
  }

  private render(view: CityView, options: CitySceneOptions, size: number, cx: number, cy: number, sig: string, scale: number): Kept<P> {
    const id = `${size}:${chunkId(cx, cy)}`;
    const shapes = cityScene(view, { ...options, chunk: { x0: cx * size, y0: cy * size, size }, layer: "static" });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of shapes) {
      for (const ring of s.rings) {
        for (let k = 0; k < ring.length; k += 2) {
          const x = ring[k]!;
          const y = ring[k + 1]!;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const old = this.kept.get(id);
    if (old !== undefined) this.pixels -= old.area;
    this.renders += 1;
    const pad = 1;
    let picture: P | null = null;
    let w = 0;
    let h = 0;
    let area = 0;
    if (Number.isFinite(minX)) {
      // Never a picture past 4,096 pixels a side: its scale shrinks instead.
      const fit = Math.min(scale, 4096 / Math.max(1, maxX - minX), 4096 / Math.max(1, maxY - minY));
      const pw = Math.ceil((maxX - minX) * fit) + 2 * pad;
      const ph = Math.ceil((maxY - minY) * fit) + 2 * pad;
      picture = this.backend.make(pw, ph);
      if (picture !== null) this.backend.paint(picture, shapes, fit, pad - minX * fit, pad - minY * fit);
      w = pw / fit;
      h = ph / fit;
      minX -= pad / fit;
      minY -= pad / fit;
      area = pw * ph;
      this.pixels += area;
    }
    const k: Kept<P> = { sig, scale, picture, area, minX, minY, w, h, used: this.frame };
    this.kept.set(id, k);
    return k;
  }

  /** Over the pixel budget, drop the pictures longest unseen - never one drawn this frame. */
  private evict(): void {
    if (this.pixels <= this.maxPixels) return;
    const old = [...this.kept.entries()].filter(([, k]) => k.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [id, k] of old) {
      if (this.pixels <= this.maxPixels) break;
      this.kept.delete(id);
      this.pixels -= k.area;
    }
  }

  /** How many pictures are kept: for tests. */
  get size(): number {
    return this.kept.size;
  }
}
