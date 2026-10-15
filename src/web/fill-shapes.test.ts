/**
 * The browser's fill (Batch 29): what is drawn again over a moving vehicle is
 * filled inside that vehicle's own outlines only - as the software rasteriser
 * fills a shape with `clipTo` - or its box, and everything else unclipped.
 */

import { describe, expect, it } from "vitest";

import type { ClipBox, Shape } from "../render/raster.js";
import { fillShapes } from "./city.js";

type Point = readonly [number, number];
/** A clip in force: closed paths and the rule that fills them. */
interface Clip {
  readonly paths: readonly (readonly Point[])[];
  readonly rule: "nonzero" | "evenodd";
}

/** Whether a point is inside a clip: the canvas's own rules, worked out here. */
function insideClip(c: Clip, [px, py]: Point): boolean {
  let winding = 0;
  let crossings = 0;
  for (const path of c.paths) {
    path.forEach((a, k) => {
      const b = path[(k + 1) % path.length]!;
      if ((a[1] <= py && py < b[1]) || (b[1] <= py && py < a[1])) {
        const x = a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        if (x > px) {
          crossings += 1;
          winding += b[1] > a[1] ? 1 : -1;
        }
      }
    });
  }
  return c.rule === "nonzero" ? winding !== 0 : crossings % 2 === 1;
}

/** A canvas that keeps, for each fill, its colour and the clips in force then (through save and restore). */
function recorder(): { ctx: CanvasRenderingContext2D; fills: { colour: string; clips: Clip[] }[]; saved: () => number } {
  const stack: Clip[][] = [[]];
  let paths: Point[][] = [];
  const fills: { colour: string; clips: Clip[] }[] = [];
  const ctx = {
    fillStyle: "",
    save(): void {
      stack.push([...stack[stack.length - 1]!]);
    },
    restore(): void {
      if (stack.length === 1) throw new Error("restore with nothing saved");
      stack.pop();
    },
    beginPath(): void {
      paths = [];
    },
    rect(x: number, y: number, w: number, h: number): void {
      paths.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    },
    moveTo(x: number, y: number): void {
      paths.push([[x, y]]);
    },
    lineTo(x: number, y: number): void {
      paths[paths.length - 1]!.push([x, y]);
    },
    closePath(): void {},
    clip(rule: "nonzero" | "evenodd" = "nonzero"): void {
      stack[stack.length - 1]!.push({ paths: paths.map((p) => [...p]), rule });
    },
    fill(): void {
      fills.push({ colour: ctx.fillStyle, clips: [...stack[stack.length - 1]!] });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, saved: () => stack.length - 1 };
}

const square = (k: number, clip?: ClipBox, clipTo?: readonly (readonly number[])[]): Shape => ({
  rings: [[k, 0, k + 4, 0, k + 4, 4, k, 4]],
  fill: { r: k / 10, g: 0, b: 0, a: 1 },
  ...(clip === undefined ? {} : { clip }),
  ...(clipTo === undefined ? {} : { clipTo }),
});

/** Whether a point is inside every clip in force for a fill. */
const allows = (f: { clips: Clip[] }, p: Point): boolean => f.clips.every((c) => insideClip(c, p));

describe("the browser's fill", () => {
  it("fills a shape with a clip box inside that box alone, and the rest unclipped", () => {
    const x: ClipBox = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
    const y: ClipBox = { minX: 40, maxX: 60, minY: 5, maxY: 25 };
    // Unclipped; a patch's run of two; the next patch's; unclipped again; the first patch once more.
    const shapes = [square(1), square(2, x), square(3, x), square(4, y), square(5), square(6, x)];
    const { ctx, fills, saved } = recorder();
    fillShapes(ctx, shapes);
    const inX: Point = [5, 5];
    const inY: Point = [50, 20];
    expect(fills.map((f) => [allows(f, inX), allows(f, inY), f.clips.length > 0])).toEqual([
      [true, true, false],
      [true, false, true],
      [true, false, true],
      [false, true, true],
      [true, true, false],
      [true, false, true],
    ]);
    // Each in its own colour, in order.
    expect(fills.map((f) => f.colour)).toEqual(shapes.map((s) => `rgba(${Math.round(s.fill.r * 255)}, 0, 0, 1)`));
    // And the canvas left as it was found.
    expect(saved()).toBe(0);
  });

  it("fills a shape with outlines inside any one of them, whichever way each runs, and nowhere else in its box", () => {
    const box: ClipBox = { minX: 0, maxX: 30, minY: 0, maxY: 30 };
    // Two overlapping squares, one traced each way round: with the canvas's non-zero rule as traced, their overlap
    // would be a hole.
    const a = [0, 0, 10, 0, 10, 10, 0, 10];
    const b = [5, 15, 15, 15, 15, 5, 5, 5];
    const shapes = [square(1, box, [a, b]), square(2)];
    const { ctx, fills, saved } = recorder();
    fillShapes(ctx, shapes);
    const [outlined, free] = fills;
    expect(allows(outlined!, [2, 2]), "inside one").toBe(true);
    expect(allows(outlined!, [13, 13]), "inside the other").toBe(true);
    expect(allows(outlined!, [7, 7]), "inside both").toBe(true);
    expect(allows(outlined!, [25, 25]), "in the box, outside both").toBe(false);
    expect(free!.clips).toEqual([]);
    expect(saved()).toBe(0);
  });

  it("leaves a list with no clip unclipped throughout (the still picture)", () => {
    const { ctx, fills, saved } = recorder();
    fillShapes(ctx, [square(1), square(2), square(3)]);
    expect(fills.map((f) => f.clips)).toEqual([[], [], []]);
    expect(saved()).toBe(0);
  });
});
