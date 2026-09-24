/**
 * Micro §3.2's camera: "Pan (drag), zoom (clamped range), no rotation."
 *
 * The camera is the iso-pixel point at the centre of the view, and a zoom.
 * Pure functions, so the clamps are testable without a browser.
 */

import { sceneBounds } from "../render/city.js";
import { TILE_H, TILE_W, Z_PX, isoProject, isoToGround } from "../render/iso.js";

export interface CityCamera {
  /** Iso-pixel point at the centre of the view. */
  readonly cx: number;
  readonly cy: number;
  /** Screen pixels per iso pixel. */
  readonly zoom: number;
}

/** A whole 32-tile city fits a laptop screen at the bottom; one tile fills a fifth of it at the top. */
export const CITY_ZOOM_MIN = 0.3;
export const CITY_ZOOM_MAX = 3;

export function clampZoom(zoom: number): number {
  return Math.min(CITY_ZOOM_MAX, Math.max(CITY_ZOOM_MIN, zoom));
}

/** The centre may not leave the grid's own box, so the city can never be panned off-screen. */
export function clampCamera(cam: CityCamera, tiles: number): CityCamera {
  const b = sceneBounds(tiles);
  return {
    cx: Math.min(b.maxX, Math.max(b.minX, cam.cx)),
    cy: Math.min(b.maxY, Math.max(b.minY, cam.cy)),
    zoom: clampZoom(cam.zoom),
  };
}

/** Frame the settlement's centre, showing about `span` tiles across. */
export function centreCamera(tiles: number, viewW: number, span = 14): CityCamera {
  const centre = isoProject(tiles / 2, tiles / 2);
  return clampCamera({ cx: centre.sx, cy: centre.sy, zoom: viewW / (span * TILE_W) }, tiles);
}

export function screenToIso(cam: CityCamera, viewW: number, viewH: number, px: number, py: number): { sx: number; sy: number } {
  return { sx: cam.cx + (px - viewW / 2) / cam.zoom, sy: cam.cy + (py - viewH / 2) / cam.zoom };
}

export function isoToScreen(cam: CityCamera, viewW: number, viewH: number, sx: number, sy: number): { px: number; py: number } {
  return { px: viewW / 2 + (sx - cam.cx) * cam.zoom, py: viewH / 2 + (sy - cam.cy) * cam.zoom };
}

/** Drag by a screen delta: the ground follows the pointer. */
export function pan(cam: CityCamera, dxPx: number, dyPx: number, tiles: number): CityCamera {
  return clampCamera({ ...cam, cx: cam.cx - dxPx / cam.zoom, cy: cam.cy - dyPx / cam.zoom }, tiles);
}

/** Zoom by `factor`, keeping the ground under (px, py) where it is - until a clamp says otherwise. */
export function zoomAt(cam: CityCamera, factor: number, px: number, py: number, viewW: number, viewH: number, tiles: number): CityCamera {
  const zoom = clampZoom(cam.zoom * factor);
  const before = screenToIso(cam, viewW, viewH, px, py);
  const next = { cx: before.sx - (px - viewW / 2) / zoom, cy: before.sy - (py - viewH / 2) / zoom, zoom };
  return clampCamera(next, tiles);
}

/** The ground tile under a screen point, or null off the grid. */
export function tileAt(cam: CityCamera, viewW: number, viewH: number, px: number, py: number, tiles: number, z = 0): { tx: number; ty: number } | null {
  const iso = screenToIso(cam, viewW, viewH, px, py);
  // A point drawn at height z sits z * Z_PX higher on screen than the ground beneath it.
  const g = isoToGround(iso.sx, iso.sy + z * Z_PX);
  const tx = Math.floor(g.x);
  const ty = Math.floor(g.y);
  return tx >= 0 && ty >= 0 && tx < tiles && ty < tiles ? { tx, ty } : null;
}

/** Where a footprint of `size` starts when the pointer is over (tx, ty): centred on it. */
export function footprintOrigin(tx: number, ty: number, size: number): { tx: number; ty: number } {
  const back = Math.floor((size - 1) / 2);
  return { tx: tx - back, ty: ty - back };
}

export { TILE_H, TILE_W };
