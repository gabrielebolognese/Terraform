/**
 * Shared test utilities.
 *
 * Deliberately not in `src/sim/tuning.ts`: these are tolerances for assertions
 * about the engine, not knobs that change what the engine does.
 */

import type { Reservoirs, SimState, Tuning } from "../sim/index.js";
import { DEFAULT_TUNING, RESERVOIR_KEYS, marsStart } from "../sim/index.js";

/**
 * Flow-paired transfers are exact to ~1e-16 per operation and accumulate to
 * ~1e-13 over a long run, so this leaves three orders of magnitude of headroom
 * while still failing on any real leak.
 */
export const CONSERVATION_REL_TOL = 1e-9;

/** Same engine and same substep grid is EXACT; this is for cross-engine comparisons. */
export const DETERMINISM_REL_TOL = 1e-6;

/** Perturbation size for the feedback-loop sign tests. */
export const LOOP_TEST_EPS = 1e-4;

/**
 * Freeze a state deeply, so a mutation THROWS at the point of the bug rather
 * than being detected afterwards by a deep-equality check that cannot say
 * which line did it. ES modules are always strict mode, so writing to a frozen
 * object is a TypeError rather than a silent no-op.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** A Mars with specific reservoirs overridden, for isolating one term. */
export function stateWith(overrides: Partial<Reservoirs>, base: SimState = marsStart()): SimState {
  return { ...base, reservoirs: { ...base.reservoirs, ...overrides } };
}

/** Assert every reservoir is finite and non-negative. */
export function assertPhysical(state: SimState): void {
  for (const key of RESERVOIR_KEYS) {
    const value = state.reservoirs[key];
    if (!Number.isFinite(value)) throw new Error(`reservoir ${key} is not finite: ${value}`);
    if (value < 0) throw new Error(`reservoir ${key} is negative: ${value}`);
  }
}

export function relDiff(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / scale;
}

export const TEST_TUNING: Tuning = DEFAULT_TUNING;
