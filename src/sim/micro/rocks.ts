/**
 * Rocks, and the rovers that break them (at the user's request: "select
 * tiles with rocks, or tiles with mountains where I can't place things, and
 * send a rover to break the rocks; the normal rocks give 1 material, the big
 * ones 5; it takes time depending on how far the rover is from the city").
 *
 * Two kinds, both derived from the ground and never stored:
 *   - loose rocks, on a scattering of open, buildable tiles;
 *   - crags, on every tile too steep to build on - the "mountains".
 * What IS stored is which have been broken (`Settlement.cleared`). A broken
 * crag leaves ground a building may stand on: `siteGround` is the ground as
 * the settlement's work has left it, and every placement rule reads it.
 */

import type { Tuning } from "../tuning.js";
import type { Settlement } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { keyTile, tileKey } from "./space.js";
import type { Ground } from "./terrain.js";
import { groundOf, placeSeed } from "./terrain.js";

export type Rock = "none" | "loose" | "crag";

/** A deterministic hash of a tile at a site, 0..1. */
function tileHash(seed: number, tx: number, ty: number): number {
  let h = (seed ^ Math.imul(tx + 0x632b, 0x85ebca6b) ^ Math.imul(ty + 0x1f3d, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The ground as the settlement's rovers have left it: a broken crag is no longer steep. */
export function siteGround(s: Settlement, t: Tuning): Ground {
  const ground = groundOf(s, t);
  if (s.cleared.length === 0) return ground;
  const n = ground.tiles;
  const steep = [...ground.steep];
  for (const key of s.cleared) {
    const { tx, ty } = keyTile(key);
    if (tx < n && ty < n) steep[ty * n + tx] = false;
  }
  return { ...ground, steep };
}

/**
 * Row-major: the rock on each tile, as a player can see and select it. None
 * under a building, a corridor or a cable (they were cleared to build), none
 * where a rover has been.
 */
export function rocksOf(s: Settlement, t: Tuning): Rock[] {
  const ground = groundOf(s, t);
  const n = ground.tiles;
  const seed = placeSeed(s.lat, s.lon);
  const covered = new Set<number>([...s.cleared, ...s.corridors, ...s.cables]);
  for (const b of s.buildings) {
    const size = BUILDING_DEFS[b.type].footprint;
    for (let y = b.ty; y < b.ty + size; y += 1) for (let x = b.tx; x < b.tx + size; x += 1) covered.add(tileKey(x, y));
  }
  const out: Rock[] = new Array<Rock>(n * n).fill("none");
  for (let ty = 0; ty < n; ty += 1) {
    for (let tx = 0; tx < n; tx += 1) {
      if (covered.has(tileKey(tx, ty))) continue;
      const i = ty * n + tx;
      if (ground.steep[i]) out[i] = "crag";
      else if (tileHash(seed, tx, ty) < t.ROCK_LOOSE_SHARE) out[i] = "loose";
    }
  }
  return out;
}

/** Where the rovers set out from and come back to: the headquarters' middle, or null without one. */
export function garage(s: Settlement): { x: number; y: number } | null {
  const hq = s.buildings.find((b) => b.type === "headquarters");
  if (hq === undefined) return null;
  const half = BUILDING_DEFS.headquarters.footprint / 2;
  return { x: hq.tx + half, y: hq.ty + half };
}

/**
 * How long a rover takes to break the rock on (tx, ty), in sim-years: out
 * from the headquarters, the work, and back. Straight-line distance - rovers
 * cross open ground.
 */
export function roverYears(s: Settlement, tx: number, ty: number, rock: Rock, t: Tuning): number {
  const from = garage(s);
  if (from === null) return Infinity;
  const distance = Math.hypot(tx + 0.5 - from.x, ty + 0.5 - from.y);
  const work = rock === "crag" ? t.ROVER_WORK_YEARS_CRAG : t.ROVER_WORK_YEARS_LOOSE;
  return 2 * distance * t.ROVER_YEARS_PER_TILE + work;
}
