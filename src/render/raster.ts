/**
 * A small software rasteriser for flat-filled polygons.
 *
 * The city view is a list of `Shape`s. The browser fills them with its 2D
 * drawing API; this fills the same list into a pixel buffer, in Node, exactly
 * the same on every machine - which is what lets a reference city render be
 * committed and compared per pixel, like Batch 6's golden planet frames. A GPU
 * render could not be: its last bits differ between drivers.
 *
 * Even-odd fill, sampled at pixel centres, no antialiasing, straight-alpha
 * "over" blending in double precision, quantised once at the end.
 */

import type { Frame } from "./planet.js";

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Coverage, 0..1. */
  readonly a: number;
}

/**
 * One filled polygon, possibly with holes: each ring is a flat list of
 * x, y pairs in iso pixel space (see `iso.ts`). Rings combine even-odd, so a
 * ring inside another cuts a hole.
 */
export interface Shape {
  readonly rings: readonly (readonly number[])[];
  readonly fill: Rgba;
}

/** screen = iso * scale + offset. */
export interface RasterTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export function rasterize(
  shapes: readonly Shape[],
  width: number,
  height: number,
  transform: RasterTransform,
  background: Rgba,
): Frame {
  const acc = new Float64Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    acc[i * 3] = background.r;
    acc[i * 3 + 1] = background.g;
    acc[i * 3 + 2] = background.b;
  }
  const { scale, offsetX, offsetY } = transform;
  const xs: number[] = [];

  for (const shape of shapes) {
    const a = Math.min(1, Math.max(0, shape.fill.a));
    if (a === 0) continue;
    const rings = shape.rings.map((ring) => {
      const out = new Float64Array(ring.length);
      for (let k = 0; k < ring.length; k += 2) {
        out[k] = ring[k]! * scale + offsetX;
        out[k + 1] = ring[k + 1]! * scale + offsetY;
      }
      return out;
    });
    let minY = Infinity;
    let maxY = -Infinity;
    for (const ring of rings) {
      for (let k = 1; k < ring.length; k += 2) {
        minY = Math.min(minY, ring[k]!);
        maxY = Math.max(maxY, ring[k]!);
      }
    }
    const rowFrom = Math.max(0, Math.floor(minY));
    const rowTo = Math.min(height - 1, Math.ceil(maxY));
    for (let row = rowFrom; row <= rowTo; row += 1) {
      const yc = row + 0.5;
      xs.length = 0;
      for (const ring of rings) {
        const count = ring.length / 2;
        for (let k = 0; k < count; k += 1) {
          const x0 = ring[2 * k]!;
          const y0 = ring[2 * k + 1]!;
          const next = (k + 1) % count;
          const x1 = ring[2 * next]!;
          const y1 = ring[2 * next + 1]!;
          // Half-open in y, so a vertex exactly on a scanline counts once.
          if ((y0 <= yc && yc < y1) || (y1 <= yc && yc < y0)) {
            xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
          }
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // Pixel centres in [xa, xb).
        const from = Math.max(0, Math.ceil(xs[k]! - 0.5));
        const to = Math.min(width - 1, Math.ceil(xs[k + 1]! - 0.5) - 1);
        for (let col = from; col <= to; col += 1) {
          const o = (row * width + col) * 3;
          acc[o] = shape.fill.r * a + acc[o]! * (1 - a);
          acc[o + 1] = shape.fill.g * a + acc[o + 1]! * (1 - a);
          acc[o + 2] = shape.fill.b * a + acc[o + 2]! * (1 - a);
        }
      }
    }
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = Math.round(Math.min(1, Math.max(0, acc[i * 3]!)) * 255);
    pixels[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, acc[i * 3 + 1]!)) * 255);
    pixels[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, acc[i * 3 + 2]!)) * 255);
    pixels[i * 4 + 3] = 255;
  }
  return { width, height, pixels };
}
