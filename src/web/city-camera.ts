/**
 * Micro §3.2's camera: "Pan (drag), zoom (clamped range), no rotation."
 *
 * The camera is the iso-pixel point at the centre of the view, and a zoom.
 * Pure functions, so the clamps are testable without a browser.
 */

import type { CityQuality } from "../render/city.js";
import { sceneBounds } from "../render/city.js";
import { TILE_H, TILE_W, Z_PX, isoProject, isoToGround } from "../render/iso.js";

export interface CityCamera {
  /** Iso-pixel point at the centre of the view. */
  readonly cx: number;
  readonly cy: number;
  /** Screen pixels per iso pixel. */
  readonly zoom: number;
}

/**
 * At the bottom a city's whole world - its grid and the open world round it,
 * 128 tiles across - fits a laptop screen; one tile fills a fifth of it at
 * the top.
 */
export const CITY_ZOOM_MIN = 0.15;
export const CITY_ZOOM_MAX = 3;

/**
 * How far out the camera may go for a world `tiles` + 2 `margin` across (at
 * the user's request: "allow to zoom out even more, so I can look at all the
 * city from above"): CITY_ZOOM_MIN while that shows the whole world on a
 * 1,440-pixel screen, as it does an ordinary city's; for a bigger world - a
 * metropolis's 1,000 tiles - as far as it takes to fit it on one.
 */
export function minZoomFor(tiles: number, margin = 0): number {
  const across = (tiles + 2 * margin) * TILE_W;
  return Math.min(CITY_ZOOM_MIN, WHOLE_WORLD_PX / across);
}

/** The screen width a whole world must fit, zoomed all the way out. */
const WHOLE_WORLD_PX = 1440;

export function clampZoom(zoom: number, tiles = 0, margin = 0): number {
  return Math.min(CITY_ZOOM_MAX, Math.max(minZoomFor(tiles, margin), zoom));
}

/**
 * The level of detail for what is on screen (requested by the user: a
 * zoomed-out metropolis lagged). It follows how many tiles the view shows,
 * not the zoom alone, so a window's size counts and an ordinary city - whose
 * whole grid is 1,024 tiles - keeps full detail at every zoom.
 *
 * Measured on the example's largest metropolis (758 buildings) at 1600 x 900:
 * zoom 1 shows ~1,400 tiles, 58,900 shapes at high; zoom 0.5 shows ~5,600,
 * 162,600 at high but 25,900 at medium; zoom 0.3 shows all 9,216, 226,400 at
 * high, 38,600 at medium, 14,300 at low.
 */
// Doubled at the user's request ("the lower quality feature lowers the
// quality too soon, keep the full quality double the time"), medium with it.
export const QUALITY_HIGH_TILES = 3000;
export const QUALITY_MEDIUM_TILES = 12000;

export function qualityFor(cam: CityCamera, viewW: number, viewH: number, tiles: number): CityQuality {
  const onScreen = Math.min(tiles * tiles, (viewW / cam.zoom) * (viewH / cam.zoom) / ((TILE_W * TILE_H) / 2));
  if (onScreen <= QUALITY_HIGH_TILES) return "high";
  if (onScreen <= QUALITY_MEDIUM_TILES) return "medium";
  return "low";
}

/**
 * The centre may not leave the world's box - the grid and `margin` tiles of
 * open world round it - so the city can be explored but never lost off-screen.
 */
export function clampCamera(cam: CityCamera, tiles: number, margin = 0): CityCamera {
  const b = sceneBounds(tiles, 0, margin);
  return {
    cx: Math.min(b.maxX, Math.max(b.minX, cam.cx)),
    cy: Math.min(b.maxY, Math.max(b.minY, cam.cy)),
    zoom: clampZoom(cam.zoom, tiles, margin),
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
export function pan(cam: CityCamera, dxPx: number, dyPx: number, tiles: number, margin = 0): CityCamera {
  return clampCamera({ ...cam, cx: cam.cx - dxPx / cam.zoom, cy: cam.cy - dyPx / cam.zoom }, tiles, margin);
}

/** Zoom by `factor`, keeping the ground under (px, py) where it is - until a clamp says otherwise. */
export function zoomAt(cam: CityCamera, factor: number, px: number, py: number, viewW: number, viewH: number, tiles: number, margin = 0): CityCamera {
  const zoom = clampZoom(cam.zoom * factor, tiles, margin);
  const before = screenToIso(cam, viewW, viewH, px, py);
  const next = { cx: before.sx - (px - viewW / 2) / zoom, cy: before.sy - (py - viewH / 2) / zoom, zoom };
  return clampCamera(next, tiles, margin);
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
export function footprintOrigin(tx: number, ty: number, size: number, depth = size): { tx: number; ty: number } {
  return { tx: tx - Math.floor((size - 1) / 2), ty: ty - Math.floor((depth - 1) / 2) };
}

export { TILE_H, TILE_W };
