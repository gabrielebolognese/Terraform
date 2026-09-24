/**
 * Between the planet and the screen, for the globe - Batch 17.
 *
 * Where on screen a surface point is drawn (to place a settlement marker),
 * and which surface point is under a screen position (to pick a founding
 * site). Both go through the SAME rotation the shader uses, mirrored in
 * TypeScript as `toPlanetJs` / `toViewJs`, so a marker sits on the terrain
 * the GPU drew there.
 *
 * Screen coordinates are CSS pixels, y down, like pointer events.
 */

import { toPlanetJs, toViewJs } from "../render/globe-shader.js";
import type { Vec3 } from "../sim/index.js";

export interface GlobeCamera {
  /** Disc centre, CSS pixels from the canvas's top-left. */
  readonly cx: number;
  readonly cy: number;
  /** Disc radius, CSS pixels. */
  readonly radius: number;
  readonly yaw: number;
  readonly pitch: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** View-space depth: > 0 faces the viewer, < 0 is round the back. */
  readonly depth: number;
  readonly visible: boolean;
}

/** Where a planet-space point on the unit sphere is drawn. */
export function projectToScreen(p: Vec3, cam: GlobeCamera): ScreenPoint {
  const v = toViewJs(p, cam.yaw, cam.pitch);
  return { x: cam.cx + v[0] * cam.radius, y: cam.cy - v[1] * cam.radius, depth: v[2], visible: v[2] > 0 };
}

/** The planet-space surface point under a screen position, or null off the disc. */
export function pickPlanet(x: number, y: number, cam: GlobeCamera): Vec3 | null {
  const dx = (x - cam.cx) / cam.radius;
  const dy = (cam.cy - y) / cam.radius;
  const r2 = dx * dx + dy * dy;
  if (!(r2 <= 1)) return null;
  return toPlanetJs([dx, dy, Math.sqrt(1 - r2)], cam.yaw, cam.pitch);
}
