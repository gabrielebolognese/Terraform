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

export const SPEEDS = [0, 1, 10, 100, 1000] as const;
export type Speed = (typeof SPEEDS)[number];
