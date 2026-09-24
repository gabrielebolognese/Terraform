/**
 * A pure-ASCII plot, so the S-curve is visible without leaving the terminal.
 *
 * Design doc build-order step 2 wants `T`, `P` and `progress` plotted over
 * time before any pixels exist; this is that plot. The grid is a write-only
 * byte array read back in one pass, which sidesteps `noUncheckedIndexedAccess`
 * entirely rather than sprinkling `?? 0` through the drawing code.
 */

import { PLOT_H, PLOT_W, P_PLOT_HI, P_PLOT_LO, T_PLOT_HI, T_PLOT_LO } from "./config.js";

const SPACE = 32;

export interface Series {
  readonly label: string;
  readonly glyph: string;
  readonly values: readonly number[];
  readonly lo: number;
  readonly hi: number;
  readonly log: boolean;
}

function normalise(value: number, lo: number, hi: number, log: boolean): number | null {
  if (!Number.isFinite(value)) return null;
  if (log) {
    const v = Math.log10(Math.max(value, lo));
    const a = Math.log10(lo);
    const b = Math.log10(hi);
    if (!(b > a)) return null;
    return (v - a) / (b - a);
  }
  if (!(hi > lo)) return null;
  return (value - lo) / (hi - lo);
}

/**
 * Render the series into a labelled grid.
 *
 * Draw order is last-writer-wins, so callers pass the headline curve last and
 * it always wins a contested cell.
 */
export function plot(series: readonly Series[], xMax: number): string {
  const grid = new Uint8Array(PLOT_W * PLOT_H).fill(SPACE);

  for (const s of series) {
    const glyph = s.glyph.charCodeAt(0);
    const n = s.values.length;
    if (n === 0) continue;
    for (let col = 0; col < PLOT_W; col += 1) {
      const idx = n === 1 ? 0 : Math.round((col / (PLOT_W - 1)) * (n - 1));
      const value = s.values[idx];
      if (value === undefined) continue;
      const norm = normalise(value, s.lo, s.hi, s.log);
      if (norm === null) continue;
      const row = PLOT_H - 1 - Math.round(Math.min(1, Math.max(0, norm)) * (PLOT_H - 1));
      grid[row * PLOT_W + col] = glyph;
    }
  }

  const lines: string[] = [];
  // The midpoint row: `frac === 0.5` never held exactly, because at an even
  // PLOT_H the midpoint falls between two rows and (PLOT_H-1-row)/(PLOT_H-1)
  // is never 0.5 for any integer row. Pick the nearest row instead.
  const midRow = Math.round((PLOT_H - 1) / 2);
  for (let row = 0; row < PLOT_H; row += 1) {
    const gutter = row === 0 ? "  1.00 |" : row === PLOT_H - 1 ? "  0.00 |" : row === midRow ? "  0.50 |" : "       |";
    lines.push(gutter + String.fromCharCode(...grid.subarray(row * PLOT_W, (row + 1) * PLOT_W)));
  }
  lines.push(`       +${"-".repeat(PLOT_W)}`);
  lines.push(`       0${" ".repeat(Math.max(0, PLOT_W - 12))}${xMax.toFixed(0).padStart(11)} yr`);
  lines.push(
    `       legend: ${series.map((s) => `${s.glyph} ${s.label}`).join("   ")}`,
  );
  return lines.join("\n");
}

export function progressSeries(values: readonly number[]): Series {
  return { label: "progress 0-1", glyph: "*", values, lo: 0, hi: 1, log: false };
}

export function tempSeries(values: readonly number[]): Series {
  return { label: `T ${T_PLOT_LO}-${T_PLOT_HI}K`, glyph: "T", values, lo: T_PLOT_LO, hi: T_PLOT_HI, log: false };
}

/** A 0..1 visual channel, for the section 9 contract plot. */
export function channelSeries(label: string, glyph: string, values: readonly number[]): Series {
  return { label, glyph, values, lo: 0, hi: 1, log: false };
}

export function pressureSeries(values: readonly number[]): Series {
  return { label: `P ${P_PLOT_LO}-${P_PLOT_HI}mbar log`, glyph: "P", values, lo: P_PLOT_LO, hi: P_PLOT_HI, log: true };
}
