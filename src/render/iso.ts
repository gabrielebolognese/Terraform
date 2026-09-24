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
 *
 * Only pairs whose screen COLUMNS overlap can ever cover one another - a
 * footprint's image spans screen x from (tx - ty - h) to (tx + w - ty) half
 * tiles, whatever its height - so only those pairs get an edge. A sweep over
 * the columns finds them. The first version compared every pair, which for a
 * metropolis's ~9,000 tiles is 85 million comparisons; the order is the same,
 * because a constraint between footprints that never overlap on screen never
 * decided anything.
 */
export function depthOrder(items: readonly FootprintBox[]): number[] {
  const n = items.length;
  const left = items.map((b) => b.tx - b.ty - b.h);
  const right = items.map((b) => b.tx + b.w - b.ty);
  const byLeft = [...Array(n).keys()].sort((i, j) => left[i]! - left[j]! || i - j);
  const blockers = new Array<number>(n).fill(0);
  const after: number[][] = items.map(() => []);
  let active: number[] = [];
  for (const i of byLeft) {
    active = active.filter((j) => right[j]! > left[i]!);
    for (const j of active) {
      if (drawsBefore(items[i]!, items[j]!)) {
        after[i]!.push(j);
        blockers[j]! += 1;
      } else if (drawsBefore(items[j]!, items[i]!)) {
        after[j]!.push(i);
        blockers[i]! += 1;
      }
    }
    active.push(i);
  }
  const less = (i: number, j: number): boolean => {
    const a = items[i]!;
    const b = items[j]!;
    const ka = a.tx + a.ty;
    const kb = b.tx + b.ty;
    return ka !== kb ? ka < kb : a.tx !== b.tx ? a.tx < b.tx : i < j;
  };
  // A binary heap of the footprints with nothing left to wait for.
  const heap: number[] = [];
  const push = (v: number): void => {
    heap.push(v);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!less(heap[k]!, heap[p]!)) break;
      [heap[k], heap[p]] = [heap[p]!, heap[k]!];
      k = p;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m]!, heap[k]!];
        k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n; i += 1) if (blockers[i] === 0) push(i);
  const order: number[] = [];
  const placed = new Array<boolean>(n).fill(false);
  while (heap.length > 0) {
    const i = pop();
    placed[i] = true;
    order.push(i);
    for (const j of after[i]!) {
      blockers[j]! -= 1;
      if (blockers[j] === 0) push(j);
    }
  }
  if (order.length < n) {
    // Only reachable if footprints overlap, which placement forbids. Draw
    // the rest by the doc's key rather than dropping them.
    const rest = [...Array(n).keys()].filter((i) => !placed[i]).sort((i, j) => (less(i, j) ? -1 : 1));
    order.push(...rest);
  }
  return order;
}
