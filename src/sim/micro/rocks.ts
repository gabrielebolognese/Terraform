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
import { frameOf, keyTile, tileKey } from "./space.js";
import type { Ground, Rock } from "./terrain.js";
import { groundOf, natureRock, placeSeed } from "./terrain.js";

export type { Rock } from "./terrain.js";

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
 * Nature's rocks on each tile of a ground, before anyone built or broke
 * anything - the same for as long as the ground is, so kept with it: a view
 * derives the rocks five times a second, and a metropolis has 83,000 tiles.
 * (A ground is cached per site, frame and tuning, so one ground object means
 * one answer.)
 */
const natural = new WeakMap<Ground, readonly Rock[]>();

function naturalRocks(s: Settlement, ground: Ground, t: Tuning): readonly Rock[] {
  const kept = natural.get(ground);
  if (kept !== undefined) return kept;
  const n = ground.tiles;
  const { base, x0, y0 } = frameOf(s, t);
  const seed = placeSeed(s.lat, s.lon);
  const out: Rock[] = new Array<Rock>(n * n);
  for (let ty = 0; ty < n; ty += 1) {
    for (let tx = 0; tx < n; tx += 1) {
      const i = ty * n + tx;
      // Nature's rocks lie in site coordinates: a claim does not move them.
      out[i] = natureRock(seed, base, tx + x0, ty + y0, ground.steep[i] === true, t);
    }
  }
  natural.set(ground, out);
  return out;
}

/**
 * Row-major: the rock on each tile, as a player can see and select it. None
 * under a building, a corridor or a cable (they were cleared to build), none
 * where a rover has been.
 */
export function rocksOf(s: Settlement, t: Tuning): Rock[] {
  const ground = groundOf(s, t);
  const n = ground.tiles;
  const covered = new Set<number>([...s.cleared, ...s.corridors, ...s.cables]);
  for (const b of s.buildings) {
    const size = BUILDING_DEFS[b.type].footprint;
    for (let y = b.ty; y < b.ty + size; y += 1) for (let x = b.tx; x < b.tx + size; x += 1) covered.add(tileKey(x, y));
  }
  const out = [...naturalRocks(s, ground, t)];
  for (const key of covered) {
    const { tx, ty } = keyTile(key);
    if (tx < n && ty < n) out[ty * n + tx] = "none";
  }
  return out;
}

/**
 * The rock on one tile, as `rocksOf` would say - for the placement rules,
 * which ask about a handful of tiles many times a second (the preview).
 */
export function rockAt(s: Settlement, tx: number, ty: number, t: Tuning): Rock {
  const ground = groundOf(s, t);
  const n = ground.tiles;
  if (tx < 0 || ty < 0 || tx >= n || ty >= n) return "none";
  const key = tileKey(tx, ty);
  if (s.cleared.includes(key) || s.corridors.includes(key) || s.cables.includes(key)) return "none";
  for (const b of s.buildings) {
    const size = BUILDING_DEFS[b.type].footprint;
    if (tx >= b.tx && ty >= b.ty && tx < b.tx + size && ty < b.ty + size) return "none";
  }
  const { base, x0, y0 } = frameOf(s, t);
  return natureRock(placeSeed(s.lat, s.lon), base, tx + x0, ty + y0, ground.steep[ty * n + tx] === true, t);
}

/** Where the rovers set out from and come back to: the headquarters' middle, or null without one. */
export function garage(s: Settlement): { x: number; y: number } | null {
  const hq = s.buildings.find((b) => b.type === "headquarters");
  if (hq === undefined) return null;
  const half = BUILDING_DEFS.headquarters.footprint / 2;
  return { x: hq.tx + half, y: hq.ty + half };
}

/**
 * How many rovers the settlement keeps: `ROVERS_PER_HQ` at the headquarters,
 * and one more for every Rover Post. None without a headquarters to send
 * them out from.
 */
export function roverCount(s: Settlement, t: Tuning): number {
  if (garage(s) === null) return 0;
  return t.ROVERS_PER_HQ + s.buildings.filter((b) => b.type === "rover_post").length;
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
