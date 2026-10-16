/**
 * For tests in happy-dom (Batch 36): animation frames and `performance.now`
 * driven by hand, and a 2D context that draws nothing but counts its fills,
 * so a city's whole frame - its level of detail, its pictures - runs, and a
 * camera moved by a held key or the screen's edge moves a known distance.
 * Not used by the game.
 */

import { vi } from "vitest";

/** Animation frames and `performance.now` by hand: each step is `ms` of the page's time. */
export class Frames {
  t = 10_000;
  private readonly queue = new Map<number, FrameRequestCallback>();
  private next = 0;

  install(): void {
    vi.spyOn(performance, "now").mockImplementation(() => this.t);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      this.next += 1;
      this.queue.set(this.next, cb);
      return this.next;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      this.queue.delete(id);
    });
  }

  step(n = 1, ms = 16): void {
    for (let k = 0; k < n; k += 1) {
      this.t += ms;
      const due = [...this.queue.values()];
      this.queue.clear();
      for (const cb of due) cb(this.t);
    }
  }
}

/** A 2D context that draws nothing, counting the shapes it is asked to fill. */
export function nullContext(counted: { fills: number }): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "fill") return () => (counted.fills += 1);
      if (key === "measureText") return () => ({ width: 10 });
      if (key === "getImageData" || key === "createImageData") return (w = 1, h = 1) => ({ data: new Uint8ClampedArray(4 * Math.max(1, w) * Math.max(1, h)), width: w, height: h });
      return () => new Proxy({}, handler);
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

const realGetContext = HTMLCanvasElement.prototype.getContext;

/** The city's canvases get a context that draws nothing but counts its fills; the planet's none (it would draw in software). */
export function drawCities(): { fills: number } {
  const counted = { fills: 0 };
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== "2d" || this.classList.contains("globe-canvas")) return null;
    return nullContext(counted);
  } as typeof HTMLCanvasElement.prototype.getContext;
  return counted;
}

/** Canvases as happy-dom has them again. */
export function restoreCanvases(): void {
  HTMLCanvasElement.prototype.getContext = realGetContext;
}
