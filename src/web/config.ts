/**
 * Host-loop constants.
 *
 * These are NOT in `src/sim/tuning.ts` on purpose. They describe a browser -
 * frame budgets, canvas sizes, readout refresh rates - and putting them in the
 * tuning table would make the game's balance depend on the machine it is
 * rendered on, which breaks invariants #2 and #5 at once.
 */

/** Ignore frame deltas longer than this: an alt-tab must not fast-forward the planet. */
export const MAX_FRAME_DELTA_MS = 250;

/**
 * Hard ceiling on simulation work per frame, so a slow machine drops time
 * instead of locking up.
 *
 * At the current constants this cannot bind and the dropped-time path is
 * unreachable: MAX_FRAME_DELTA_MS clips a frame to 0.25 s, which at
 * TIME_SCALE 0.025 and the top speed of 1000x is 6.25 sim-years, or 25
 * substeps - a tenth of this limit. It is kept as the second line of defence
 * that becomes load-bearing the moment TIME_SCALE or the top speed rises,
 * and the inspector reports any drop rather than swallowing it.
 */
export const MAX_SUBSTEPS_PER_FRAME = 256;

/** DOM text updates per second. The sim runs at frame rate; the readout does not need to. */
export const READOUT_HZ = 10;

/**
 * The alerts (Batch 31). Worked out a couple of times a second, not at the
 * readout's 10: each city's substep is kept between steps, but a new step for
 * every settlement ten times a second at a high speed is a cost for nothing.
 * A condition that comes back within ALERT_QUIET_MS of ending is not
 * announced again - a store at its limit flickers short and back every few
 * substeps. A dust storm is announced STORM_WARN_SECONDS of real time before
 * it rises.
 */
export const ALERT_HZ = 2;
export const ALERT_QUIET_MS = 60_000;
export const STORM_WARN_SECONDS = 120;
/** How long a toast stays, by priority, ms; and how many show at once. */
export const TOAST_URGENT_MS = 12_000;
export const TOAST_NOTICE_MS = 6_000;
export const TOASTS_SHOWN = 3;
/** Lines the alert centre keeps of what happened, newest first. */
export const ALERT_LOG = 60;

/** Live sparkline sampling rate and window. 600 samples at 10 Hz is a 60-second window. */
export const SPARK_HZ = 10;
export const SPARK_CAPACITY = 600;

export const SPARK_W = 260;
export const SPARK_H = 44;

/**
 * How often the world is written to storage.
 *
 * Also written on tab-hide and page-hide, which is what actually catches a
 * closed tab - an interval alone loses up to this much on the way out.
 */
export const AUTOSAVE_INTERVAL_MS = 15_000;

/** Cap the backing store on high-DPI displays. */
export const MAX_DPR = 2;

/**
 * The span the arc scrubber records, and how finely.
 *
 * Both match `frames.ts` exactly, and that is not cosmetic. The build schedule
 * is applied on the sampling grid, so the grid decides which year an order
 * actually lands on: at every 4 years the reference schedule's scrubber
 * retirement at year 2150 would be applied at 2152 instead, and the scrubber
 * would be showing a subtly different playthrough from the one the golden
 * frames came from. `arc.test.ts` pins the two together.
 */
export const ARC_YEARS = 2400;
export const ARC_SAMPLE_YEARS = 2;

/** Fixed sparkline axes, matching the headless plot so the two are comparable. */
export const T_AXIS_LO = 200;
export const T_AXIS_HI = 300;
export const P_AXIS_LO = 1;
export const P_AXIS_HI = 1013;

/** Every speed the clock knows. Which a world offers is its pace's and its mode's (Batch 28). */
export type Speed = 0 | 1 | 2 | 3 | 10 | 100 | 1000;

/** The speeds before real build times: a Classic world keeps them. */
export const CLASSIC_SPEEDS: readonly Speed[] = [0, 1, 10, 100, 1000];
/** Real build times at 1x, with 2x and 3x for the planet's slow stretches (Batch 28). */
export const STANDARD_SPEEDS: readonly Speed[] = [0, 1, 2, 3];
/** A sandbox, and the debug setting: every speed. */
export const ALL_SPEEDS: readonly Speed[] = [0, 1, 2, 3, 10, 100, 1000];

/**
 * The speeds a world offers. The fast ones would make a mockery of real build
 * times, so a Standard world has pause, 1x, 2x and 3x; a sandbox (nothing to
 * wait for) and the debug setting have them all; a Classic world keeps its own.
 */
export function speedsFor(t: { readonly SANDBOX_ENABLED: number; readonly BUILD_CURVE_ENABLED: number }, debug = false): readonly Speed[] {
  if (debug || t.SANDBOX_ENABLED > 0) return ALL_SPEEDS;
  return t.BUILD_CURVE_ENABLED > 0 ? STANDARD_SPEEDS : CLASSIC_SPEEDS;
}

/**
 * Micro §1.4's camera move, each way (Batch 21). Presentation only: the
 * simulation advances identically during it, so this is not tuning.
 */
export const TRAVEL_MS = 1200;
/** How far in the globe zooms at the end of a descent - well past the player's own zoom limit. */
export const TRAVEL_ZOOM = 3.5;
