/**
 * The tuning the browser plays with, and what each world mode adds to it.
 *
 * The game runs WITH §12.2's seeded events; the default tuning does not.
 *
 * They are off by default so the golden frames, the balance sweep and a dozen
 * exactness tests are not at the mercy of the weather. The game is the one
 * place they belong, and enabling them is a tuning variant rather than a
 * config flag precisely so the balance sweep could measure their effect if it
 * ever needed to.
 *
 * Settlements tick and push the planet here (Batch 18's promise, kept in
 * Batch 20 now that there is a view to build them in), and their ground has
 * hills (Batch 22): 12 m either side of the base elevation. Measured over 100
 * sites, 16.1% of the ground is too steep to build on, and at least 439 of
 * the 900 places a 3 x 3 building could start are open.
 *
 * And roads (at the user's request): a building runs only when its network -
 * the buildings it touches and the roads it is on - holds a producer of what
 * it draws. Older saves are given the roads that connect what they had.
 *
 * Batch 27: a world records the whole tuning it was made with (`worlds.ts`),
 * so changing these later never silently changes an existing world.
 */

import type { Tuning, TuningOverrides } from "../sim/index.js";
import { TUNING_SCALAR_KEYS, makeTuning, validateTuning } from "../sim/index.js";

export const BROWSER_OVERRIDES: TuningOverrides = {
  EVENTS_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  TECH_GATE_ENABLED: 1,
  SETTLEMENTS_ENABLED: 1,
  TERRAIN_RELIEF_M: 12,
  NETWORK_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  ROCK_CLUSTER_CHANCE: 0.65,
  // Three times the founding ground (the user: "make the initial boundaries at
  // least 3x bigger"); a city claims more as it grows.
  // Buildings take a rover and time to build (at the user's request).
  BUILD_TIME_ENABLED: 1,
  INTERCITY_ENABLED: 1,
  CITY_GRID_TILES: 96,
  OUTPOST_GRID_TILES: 48,
  METROPOLIS_GRID_TILES: 288,
};

/** The browser's tuning before Batch 27 - the one every world made before worlds existed was played with. */
export const BROWSER_TUNING: Tuning = makeTuning(BROWSER_OVERRIDES);
validateTuning(BROWSER_TUNING);

/** "Standard", today's game; "Sandbox"; "Terraformed start", the example planet as a start that saves. */
export type WorldMode = "standard" | "sandbox" | "terraformed";
export const WORLD_MODES: readonly WorldMode[] = ["standard", "sandbox", "terraformed"];
export const MODE_NAMES: Readonly<Record<WorldMode, string>> = {
  standard: "Standard",
  sandbox: "Sandbox",
  terraformed: "Terraformed start",
};

/** Batch 28's presets arrive later; until then there is one pace. */
export type WorldPace = "standard";
export const WORLD_PACES: readonly WorldPace[] = ["standard"];

/**
 * A new world's tuning: the browser's, its terrain turned by the seed, and
 * the mode's own rules. A mode is a tuning, recorded in the world - never a
 * flag the game reads, so a sandbox cannot leak into a standard world.
 */
export function worldTuning(mode: WorldMode, seed: number): Tuning {
  const sandbox: TuningOverrides = mode === "sandbox" ? { SANDBOX_ENABLED: 1, TECH_GATE_ENABLED: 0, FLOODING_ENABLED: 0 } : {};
  const t = makeTuning({ ...BROWSER_OVERRIDES, TERRAIN_SEED: seed, ...sandbox });
  validateTuning(t);
  return t;
}

/** The whole tuning, as the plain record a world keeps. */
export function tuningRecord(t: Tuning): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of TUNING_SCALAR_KEYS) out[key] = t[key];
  return out;
}

/**
 * A kept record back to a tuning. A constant added since the world was made
 * takes its default - every new feature ships at 0 (off) - and one since
 * removed is dropped.
 */
export function fromRecord(record: Readonly<Record<string, unknown>>): Tuning {
  const overrides: Record<string, number> = {};
  for (const key of TUNING_SCALAR_KEYS) {
    const v = record[key];
    if (typeof v === "number" && Number.isFinite(v)) overrides[key] = v;
  }
  const t = makeTuning(overrides as TuningOverrides);
  validateTuning(t);
  return t;
}
