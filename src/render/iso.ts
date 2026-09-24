/**
 * Micro §3.1 - the 2:1 isometric projection, and the order to draw in.
 *
 * World space here is the settlement's tile grid: x along tx, y along ty, in
 * tiles, and z up, in tiles. The projection is the doc's, extended upward:
 *
 *     screenX = (x - y) * TILE_W / 2
 *     screenY = (x + y) * TILE_H / 2 - z * Z_PX
 *
 * with TILE_W = 2 * TILE_H. Tile (0, 0)'s far corner is the origin; larger
 * x + y is nearer the viewer. With Z_PX = TILE_H the direction that projects to
 * a single point is (1, 1, 1): the viewer looks down it, from +x +y +z.
 *
 * Pure: no host, no clock. Screen constants live here, not in the sim's
 * tuning, because nothing about them is balance - they are the camera.
 */

export const TILE_W = 64;
export const TILE_H = 32;
export const Z_PX = 32;

/** Unit vector toward the viewer, in world space. */
export const TOWARD_VIEWER: readonly [number, number, number] = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];

export function isoProject(x: number, y: number, z = 0): { sx: number; sy: number } {
  return { sx: ((x - y) * TILE_W) / 2, sy: ((x + y) * TILE_H) / 2 - z * Z_PX };
}

/** The inverse on the ground plane (z = 0): the world point under a screen point. */
export function isoToGround(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TILE_W / 2); // x - y
  const b = sy / (TILE_H / 2); // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** A footprint on the grid: `w` by `h` tiles from (tx, ty). */
export interface FootprintBox {
  readonly tx: number;
  readonly ty: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Must `a` be drawn before `b`?
 *
 * Micro §3.1 says to sort by `tx + ty`, which is right for single tiles and
 * wrong for anything bigger: a 3x3 dome sorted by its origin tile draws UNDER
 * a 1x1 depot that stands behind its far half. For footprints that do not
 * overlap, `a` is behind `b` when `a` lies wholly on the far side of `b` along
 * one axis while not lying wholly on the near side along the other. Two
 * footprints separated along both axes in opposite senses sit side by side on
 * screen and need no order at all.
 */
export function drawsBefore(a: FootprintBox, b: FootprintBox): boolean {
  const aFarX = a.tx + a.w <= b.tx;
  const aFarY = a.ty + a.h <= b.ty;
  const aNearX = b.tx + b.w <= a.tx;
  const aNearY = b.ty + b.h <= a.ty;
  return (aFarX && !aNearY) || (aFarY && !aNearX);
}

/**
 * A far-to-near drawing order for non-overlapping footprints: a topological
 * sort of `drawsBefore`, taking the ready footprint with the smallest
 * `tx + ty` (then `tx`, then index) first so ties are stable. Returns indices.
 */
export function depthOrder(items: readonly FootprintBox[]): number[] {
  const n = items.length;
  const blockers = new Array<number>(n).fill(0);
  const after: number[][] = items.map(() => []);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i !== j && drawsBefore(items[i]!, items[j]!)) {
        after[i]!.push(j);
        blockers[j]! += 1;
      }
    }
  }
  const key = (i: number): readonly [number, number, number] => [items[i]!.tx + items[i]!.ty, items[i]!.tx, i];
  const less = (i: number, j: number): boolean => {
    const a = key(i);
    const b = key(j);
    return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  };
  const ready: number[] = [];
  for (let i = 0; i < n; i += 1) if (blockers[i] === 0) ready.push(i);
  const order: number[] = [];
  const placed = new Array<boolean>(n).fill(false);
  while (order.length < n) {
    if (ready.length === 0) {
      // Only reachable if footprints overlap, which placement forbids. Draw
      // the rest by the doc's key rather than dropping them.
      const rest = [...Array(n).keys()].filter((i) => !placed[i]).sort((i, j) => (less(i, j) ? -1 : 1));
      for (const i of rest) {
        placed[i] = true;
        order.push(i);
      }
      break;
    }
    let best = 0;
    for (let k = 1; k < ready.length; k += 1) if (less(ready[k]!, ready[best]!)) best = k;
    const i = ready.splice(best, 1)[0]!;
    placed[i] = true;
    order.push(i);
    for (const j of after[i]!) {
      blockers[j]! -= 1;
      if (blockers[j] === 0) ready.push(j);
    }
  }
  return order;
}
