/**
 * The software rasteriser behind the reference city render. Its rules are
 * checked by counting pixels whose answer is known exactly.
 */

import { describe, expect, it } from "vitest";

import type { Shape } from "./raster.js";
import { rasterize } from "./raster.js";

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const ID = { scale: 1, offsetX: 0, offsetY: 0 };

function lit(frame: { pixels: Uint8ClampedArray }): number {
  let n = 0;
  for (let i = 0; i < frame.pixels.length; i += 4) if ((frame.pixels[i] ?? 0) > 0) n += 1;
  return n;
}

const square = (x0: number, y0: number, x1: number, y1: number): number[] => [x0, y0, x1, y0, x1, y1, x0, y1];

describe("the rasteriser", () => {
  it("fills exactly the pixels whose centres are inside", () => {
    const shape: Shape = { rings: [square(2, 3, 12, 8)], fill: { r: 1, g: 1, b: 1, a: 1 } };
    expect(lit(rasterize([shape], 20, 20, ID, BLACK))).toBe(10 * 5);
    // Half a pixel either way moves no centre across an edge at .0 -> .4 ...
    const nudged: Shape = { rings: [square(2.4, 3.4, 12.4, 8.4)], fill: shape.fill };
    expect(lit(rasterize([nudged], 20, 20, ID, BLACK))).toBe(10 * 5);
    // ... and one that crosses the centres at .5 moves a whole row and column.
    const past: Shape = { rings: [square(2.6, 3.6, 12.6, 8.6)], fill: shape.fill };
    const moved = rasterize([past], 20, 20, ID, BLACK);
    expect(lit(moved)).toBe(10 * 5);
    const at = (f: { pixels: Uint8ClampedArray }, x: number, y: number): number => f.pixels[(y * 20 + x) * 4] ?? -1;
    expect(at(rasterize([shape], 20, 20, ID, BLACK), 2, 3)).toBe(255);
    expect(at(moved, 2, 3)).toBe(0);
    expect(at(moved, 12, 8)).toBe(255);
  });

  it("shares an edge between two neighbours without a gap or a double hit", () => {
    const a: Shape = { rings: [[0, 0, 10, 0, 0, 10]], fill: { r: 0.5, g: 0, b: 0, a: 0.5 } };
    const b: Shape = { rings: [[10, 0, 10, 10, 0, 10]], fill: { r: 0.5, g: 0, b: 0, a: 0.5 } };
    const f = rasterize([a, b], 10, 10, ID, BLACK);
    // Every pixel covered exactly once: one 50% layer of 0.5 red = 0.25 -> 64.
    for (let i = 0; i < f.pixels.length; i += 4) expect(f.pixels[i]).toBe(64);
  });

  it("cuts holes even-odd", () => {
    const ring: Shape = { rings: [square(0, 0, 10, 10), square(3, 3, 7, 7)], fill: { r: 1, g: 1, b: 1, a: 1 } };
    expect(lit(rasterize([ring], 10, 10, ID, BLACK))).toBe(100 - 16);
  });

  it("blends straight alpha over what is below, in order", () => {
    const red: Shape = { rings: [square(0, 0, 1, 1)], fill: { r: 1, g: 0, b: 0, a: 1 } };
    const blueHalf: Shape = { rings: [square(0, 0, 1, 1)], fill: { r: 0, g: 0, b: 1, a: 0.5 } };
    const f = rasterize([red, blueHalf], 1, 1, ID, BLACK);
    expect([...f.pixels]).toEqual([128, 0, 128, 255]);
    const g = rasterize([blueHalf, red], 1, 1, ID, BLACK);
    expect([...g.pixels]).toEqual([255, 0, 0, 255]);
  });

  it("applies the transform: scale, then offset", () => {
    const shape: Shape = { rings: [square(0, 0, 2, 2)], fill: { r: 1, g: 1, b: 1, a: 1 } };
    const f = rasterize([shape], 20, 20, { scale: 3, offsetX: 5, offsetY: 1 }, BLACK);
    expect(lit(f)).toBe(36);
    expect(f.pixels[(1 * 20 + 5) * 4]).toBe(255);
    expect(f.pixels[(1 * 20 + 4) * 4]).toBe(0);
  });
});
