/**
 * What a click lands on, over the heightmap (Batch 22). `rayHit` intersects
 * the line of sight with every solid exactly; the oracle here is a different
 * algorithm - walking down the line a thousandth of a tile at a time - so the
 * two can only agree by both being right.
 */

import { describe, expect, it } from "vitest";

import { referenceCity } from "../harness/city-frames.js";
import { buildingTop, rayHit } from "./city.js";
import { isoProject, isoToGround } from "./iso.js";

describe("picking over the heightmap", () => {
  const { view } = referenceCity();
  const n = view.tiles;
  const lo = Math.min(...view.groundZ) - 0.5;
  const hi = Math.max(...view.groundZ, ...view.buildings.map((b) => b.baseZ + buildingTop(b.type)));

  function march(sx: number, sy: number): string {
    const g = isoToGround(sx, sy);
    for (let s = hi + 0.001; s >= lo; s -= 0.001) {
      const tx = Math.floor(g.x + s);
      const ty = Math.floor(g.y + s);
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      const b = view.buildings.find((c) => tx >= c.tx && ty >= c.ty && tx < c.tx + c.size && ty < c.ty + c.size);
      if (b !== undefined) {
        if (s <= b.baseZ + buildingTop(b.type)) return `building ${b.index}`;
        continue;
      }
      if (s <= (view.groundZ[ty * n + tx] ?? 0)) return `ground ${tx},${ty}`;
    }
    return "nothing";
  }

  const label = (sx: number, sy: number): string => {
    const h = rayHit(view, sx, sy);
    return h === null ? "nothing" : h.kind === "building" ? `building ${h.index}` : `ground ${h.tx},${h.ty}`;
  };

  // A coarse lattice over the whole scene: every 23 iso pixels.
  const samples: [number, number][] = [];
  const top = isoProject(0, 0, 3).sy;
  const bottom = isoProject(n, n, 0).sy + 20;
  for (let sy = top; sy <= bottom; sy += 23) {
    for (let sx = isoProject(0, n).sx; sx <= isoProject(n, 0).sx; sx += 23) samples.push([sx, sy]);
  }

  it("lands on what the line of sight meets first, as a fine march finds it", () => {
    // Measured on an 11.3-pixel lattice: 18,380 of 18,382 agree (99.989%).
    // The two misses are the march clipping a column's corner between its
    // steps, one tile off. The first, 0.02-step march agreed on 99.15%.
    let same = 0;
    for (const [sx, sy] of samples) if (label(sx, sy) === march(sx, sy)) same += 1;
    expect(same / samples.length).toBeGreaterThan(0.999);
  });

  it("met buildings, flat ground and hills alike - the comparison is not vacuous", () => {
    const hits = samples.map(([sx, sy]) => rayHit(view, sx, sy));
    expect(hits.some((h) => h?.kind === "building")).toBe(true);
    const ground = hits.filter((h): h is { kind: "ground"; tx: number; ty: number } => h?.kind === "ground");
    expect(ground.some((h) => (view.groundZ[h.ty * n + h.tx] ?? 0) > 0.5)).toBe(true);
    expect(ground.some((h) => (view.groundZ[h.ty * n + h.tx] ?? 0) === 0)).toBe(true);
  });

  it("finds a hill tile by its drawn top, not the flat ground beneath the pointer", () => {
    // The highest tile: clicking the middle of its top face must land on it.
    let k = 0;
    view.groundZ.forEach((z, i) => {
      if (z > (view.groundZ[k] ?? 0)) k = i;
    });
    const tx = k % n;
    const ty = Math.floor(k / n);
    const p = isoProject(tx + 0.5, ty + 0.5, view.groundZ[k]!);
    expect(rayHit(view, p.sx, p.sy)).toEqual({ kind: "ground", tx, ty });
    // Flat-ground picking would have named a tile farther back, under the hill's image.
    const flat = isoToGround(p.sx, p.sy);
    expect([Math.floor(flat.x), Math.floor(flat.y)]).not.toEqual([tx, ty]);
  });
});
