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
import { DEFAULT_TUNING, TUNING_SCALAR_KEYS, makeTuning, validateTuning } from "../sim/index.js";

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

/**
 * What every world made since gets, whatever its mode and pace: the features
 * from Batch 29 on that change the balance. A world made before one keeps
 * playing as it did - its recorded tuning has it off - so these never go in
 * `BROWSER_OVERRIDES`, the tuning of the worlds before worlds.
 */
export const NEW_WORLD_OVERRIDES: TuningOverrides = {
  // Rovers drive round the city, not through it, and the way they drive sets their trips (Batch 29).
  ROVER_ROUTES_ENABLED: 1,
};

/**
 * What a mode adds besides a sandbox's rules. The first hour (Batch 30) - the
 * guided first steps and the objectives - is Standard's: a sandbox has
 * neither (no losses, nothing to earn), and a Terraformed start begins with
 * every objective already met.
 */
export const MODE_OVERRIDES: Readonly<Record<WorldMode, TuningOverrides>> = {
  standard: { GUIDE_ENABLED: 1, OBJECTIVES_ENABLED: 1 },
  sandbox: {},
  terraformed: {},
};

/** "Standard", today's game; "Sandbox"; "Terraformed start", the example planet as a start that saves. */
export type WorldMode = "standard" | "sandbox" | "terraformed";
export const WORLD_MODES: readonly WorldMode[] = ["standard", "sandbox", "terraformed"];
export const MODE_NAMES: Readonly<Record<WorldMode, string>> = {
  standard: "Standard",
  sandbox: "Sandbox",
  terraformed: "Terraformed start",
};

/**
 * How fast a world runs (Batch 28), recorded in it as tuning like its mode.
 *
 * "Standard" is real build times: the planet runs eight times slower than it
 * did - a sim-year is 4.4 real minutes at 1x, the arc about five days of 1x
 * play - while the cities keep the rhythm they had (CITY_CLOCK 8: a rocket's
 * trip is still a real minute) and buildings take the curve's real time.
 * Offline, the world runs at the live rate for up to OFFLINE_CAP_HOURS, so a
 * long build finishes while the player is away.
 *
 * "Classic" is the game before Batch 28, and every world made before it.
 */
export type WorldPace = "standard" | "classic";
export const WORLD_PACES: readonly WorldPace[] = ["standard", "classic"];
export const PACE_NAMES: Readonly<Record<WorldPace, string>> = {
  standard: "Standard - real build times",
  classic: "Classic - the fast game before real build times",
};

/** The planet's slowdown in the Standard pace; the cities' clock makes it up. */
export const STANDARD_SLOWDOWN = 8;

export const PACE_OVERRIDES: Readonly<Record<WorldPace, TuningOverrides>> = {
  standard: {
    TIME_SCALE: DEFAULT_TUNING.TIME_SCALE / STANDARD_SLOWDOWN,
    // One substep is the same real time as before (8.3 s at 1x) and a city's step the same quarter of its year.
    SUBSTEP_YEARS: DEFAULT_TUNING.SUBSTEP_YEARS / STANDARD_SLOWDOWN,
    CITY_CLOCK: STANDARD_SLOWDOWN,
    BUILD_CURVE_ENABLED: 1,
    OFFLINE_RATE_FACTOR: 1,
    OFFLINE_CAP_HOURS: 10,
  },
  classic: {},
};

/** A world's pace, read from its tuning: the curve is what makes a pace Standard. */
export function paceOf(t: Tuning): WorldPace {
  return t.BUILD_CURVE_ENABLED ? "standard" : "classic";
}

/**
 * A new world's tuning: the browser's, its terrain turned by the seed, and
 * the mode's own rules. A mode is a tuning, recorded in the world - never a
 * flag the game reads, so a sandbox cannot leak into a standard world.
 */
export function worldTuning(mode: WorldMode, seed: number, pace: WorldPace = "standard"): Tuning {
  const sandbox: TuningOverrides = mode === "sandbox" ? { SANDBOX_ENABLED: 1, TECH_GATE_ENABLED: 0, FLOODING_ENABLED: 0 } : {};
  const t = makeTuning({ ...BROWSER_OVERRIDES, ...NEW_WORLD_OVERRIDES, ...PACE_OVERRIDES[pace], TERRAIN_SEED: seed, ...MODE_OVERRIDES[mode], ...sandbox });
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
