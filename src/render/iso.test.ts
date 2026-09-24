/**
 * Micro §3.1's projection, and the drawing order that fixes its sort key.
 *
 * The order is checked against an independent oracle, not against its own
 * rule: cast the view ray through a screen point, see which box the viewer
 * actually meets first, and require the painter to have drawn that box LAST
 * among every box the ray passes through. That is what "nearer tiles draw
 * over farther ones" means, stated without reference to how the sort decides.
 */

import { describe, expect, it } from "vitest";

import type { FootprintBox } from "./iso.js";
import { Z_PX, depthOrder, drawsBefore, isoProject, isoToGround } from "./iso.js";

interface Solid extends FootprintBox {
  readonly height: number;
}

/** A small deterministic generator - tests may not use Math.random either, or a failure could not be replayed. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Up to `count` non-overlapping squares of side 1-3 on an n x n grid, each with a height. */
function layout(seed: number, n: number, count: number): Solid[] {
  const rand = lcg(seed);
  const taken = new Set<string>();
  const out: Solid[] = [];
  for (let attempt = 0; attempt < count * 20 && out.length < count; attempt += 1) {
    const size = 1 + Math.floor(rand() * 3);
    const tx = Math.floor(rand() * (n - size + 1));
    const ty = Math.floor(rand() * (n - size + 1));
    const tiles: string[] = [];
    for (let dy = 0; dy < size; dy += 1) for (let dx = 0; dx < size; dx += 1) tiles.push(`${tx + dx},${ty + dy}`);
    if (tiles.some((k) => taken.has(k))) continue;
    for (const k of tiles) taken.add(k);
    out.push({ tx, ty, w: size, h: size, height: 0.3 + rand() * 2.2 });
  }
  return out;
}

/**
 * The ray through a screen point, as ground point G plus s * (1, 1, 1): the
 * direction that projects to a single point, pointing at the viewer. Returns
 * the far end of the stretch of ray inside the box - the larger it is, the
 * nearer the viewer the box's visible surface - or null if the ray misses.
 */
function exitToward(box: Solid, gx: number, gy: number): number | null {
  const lo = Math.max(box.tx - gx, box.ty - gy, 0);
  const hi = Math.min(box.tx + box.w - gx, box.ty + box.h - gy, box.height);
  return lo < hi - 1e-9 ? hi : null;
}

interface Audit {
  readonly overlaps: number;
  readonly wrong: number;
}

/** Sample the screen; count points where two or more boxes overlap, and those the order draws wrong. */
function audit(solids: readonly Solid[], order: readonly number[], n: number): Audit {
  const rank = new Array<number>(solids.length);
  order.forEach((i, k) => (rank[i] = k));
  let overlaps = 0;
  let wrong = 0;
  const top = isoProject(0, 0, 3).sy;
  const bottom = isoProject(n, n, 0).sy;
  const left = isoProject(0, n, 0).sx;
  const right = isoProject(n, 0, 0).sx;
  for (let sy = top; sy <= bottom; sy += 3.7) {
    for (let sx = left; sx <= right; sx += 3.7) {
      const g = isoToGround(sx, sy);
      const hits: { i: number; exit: number }[] = [];
      solids.forEach((b, i) => {
        const exit = exitToward(b, g.x, g.y);
        if (exit !== null) hits.push({ i, exit });
      });
      if (hits.length < 2) continue;
      hits.sort((a, b) => b.exit - a.exit);
      // Two surfaces at the same depth (touching faces) have no right answer.
      if (hits[0]!.exit - hits[1]!.exit < 1e-6) continue;
      overlaps += 1;
      const seen = hits[0]!.i;
      const lastDrawn = hits.reduce((best, h) => (rank[h.i]! > rank[best.i]! ? h : best)).i;
      if (lastDrawn !== seen) wrong += 1;
    }
  }
  return { overlaps, wrong };
}

describe("the isometric projection (micro §3.1)", () => {
  it("is the doc's formula, and the ground inverse undoes it", () => {
    expect(isoProject(3, 1)).toEqual({ sx: 64, sy: 64 });
    for (const [x, y] of [
      [0, 0],
      [5.25, 2.5],
      [31, 0.5],
    ] as const) {
      const p = isoProject(x, y);
      const back = isoToGround(p.sx, p.sy);
      expect(back.x).toBeCloseTo(x, 12);
      expect(back.y).toBeCloseTo(y, 12);
    }
  });

  it("lifts height straight up the screen, so (1, 1, 1) is the line of sight", () => {
    const a = isoProject(2, 3, 0);
    const b = isoProject(3, 4, 1);
    expect(b.sx).toBeCloseTo(a.sx, 12);
    expect(b.sy).toBeCloseTo(a.sy, 12);
    expect(isoProject(2, 3, 1).sy).toBe(a.sy - Z_PX);
  });
});

describe("the drawing order", () => {
  const LAYOUTS = Array.from({ length: 40 }, (_, k) => layout(1000 + k, 10, 14));

  it("draws whatever the viewer sees first last, at every sampled point of 40 random cities", () => {
    let overlaps = 0;
    let wrong = 0;
    for (const solids of LAYOUTS) {
      const r = audit(solids, depthOrder(solids), 10);
      overlaps += r.overlaps;
      wrong += r.wrong;
    }
    expect(wrong).toBe(0);
    // Vacuity guard: the cities really do overlap on screen. Measured: 66,915 overlapping samples.
    expect(overlaps).toBeGreaterThan(10_000);
  });

  it("the doc's own key, tx + ty, draws some of those same points wrong", () => {
    // Why §3.1's sort was replaced. Measured: 3,820 wrong samples over the
    // same 40 cities - a building drawn under one standing behind it.
    let wrong = 0;
    for (const solids of LAYOUTS) {
      const docKey = solids
        .map((b, i) => ({ i, k: b.tx + b.ty }))
        .sort((a, b) => a.k - b.k || a.i - b.i)
        .map((e) => e.i);
      wrong += audit(solids, docKey, 10).wrong;
    }
    expect(wrong).toBeGreaterThan(0);
  });

  it("orders a footprint wholly behind on both axes before the one in front, as a rule of its own", () => {
    // Geometry, not the sort: every line of sight through both boxes meets
    // the one at larger x AND larger y first, whatever their heights. Today
    // the tie-break (smallest tx + ty first) happens to put such a pair right
    // anyway - 200,000 random layouts (2-5 footprints, 7x7 grid) found no picture that dropping this rule
    // changes - so it is pinned here directly, where a new tie-break cannot
    // quietly make it matter.
    const back = { tx: 0, ty: 0, w: 1, h: 1 };
    const front = { tx: 1, ty: 1, w: 3, h: 3 };
    expect(drawsBefore(back, front), "a footprint behind on both axes must be drawn before the one in front").toBe(true);
    expect(drawsBefore(front, back)).toBe(false);
    // Side by side on screen - behind on one axis, in front on the other - no order is owed either way.
    const left = { tx: 0, ty: 3, w: 1, h: 1 };
    const right = { tx: 3, ty: 0, w: 1, h: 1 };
    expect(drawsBefore(left, right)).toBe(false);
    expect(drawsBefore(right, left)).toBe(false);
  });

  it("returns every footprint exactly once", () => {
    for (const solids of LAYOUTS) expect([...depthOrder(solids)].sort((a, b) => a - b)).toEqual(solids.map((_, i) => i));
  });
});
