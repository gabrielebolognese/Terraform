/**
 * Dependency-free sparklines on a canvas.
 *
 * Axes are FIXED, not autoscaled: an autoscaled sparkline of a quantity that
 * climbs three orders of magnitude looks like a flat line the whole way, which
 * is the opposite of what the "growth must be visible" goal needs. The bounds
 * are the same ones the headless ASCII plot uses, so the two views agree.
 */

import { MAX_DPR, SPARK_H, SPARK_W } from "./config.js";
import type { Ring } from "./ring.js";

export interface SparkSpec {
  readonly lo: number;
  readonly hi: number;
  readonly log: boolean;
  readonly colour: string;
}

export class Sparkline {
  private readonly ctx: CanvasRenderingContext2D | null;
  private pixelW = 0;
  private pixelH = 0;

  constructor(public readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
    canvas.style.width = `${SPARK_W}px`;
    canvas.style.height = `${SPARK_H}px`;
  }

  private resizeIfNeeded(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(SPARK_W * dpr);
    const h = Math.round(SPARK_H * dpr);
    if (w === this.pixelW && h === this.pixelH) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.pixelW = w;
    this.pixelH = h;
  }

  private norm(value: number, spec: SparkSpec): number {
    if (!Number.isFinite(value)) return 0;
    if (spec.log) {
      const lo = Math.log10(Math.max(spec.lo, Number.MIN_VALUE));
      const hi = Math.log10(Math.max(spec.hi, Number.MIN_VALUE));
      if (!(hi > lo)) return 0;
      return (Math.log10(Math.max(value, spec.lo)) - lo) / (hi - lo);
    }
    if (!(spec.hi > spec.lo)) return 0;
    return (value - spec.lo) / (spec.hi - spec.lo);
  }

  draw(ring: Ring, spec: SparkSpec): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    this.resizeIfNeeded();

    const w = this.pixelW;
    const h = this.pixelH;
    ctx.clearRect(0, 0, w, h);

    const n = ring.length;
    if (n < 2) return;

    ctx.strokeStyle = spec.colour;
    ctx.lineWidth = Math.max(1, Math.round(h / 22));
    ctx.lineJoin = "round";
    ctx.beginPath();

    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * (w - 1);
      const y = (1 - Math.min(1, Math.max(0, this.norm(ring.at(i), spec)))) * (h - 1);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
