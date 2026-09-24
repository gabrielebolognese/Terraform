/**
 * Harness presentation constants.
 *
 * These are NOT in src/sim/tuning.ts on purpose: they describe a terminal,
 * not a planet, and balance must never depend on how wide a console is.
 */

/** Plot body width. Plus an 8-column label gutter, that is 80 total. */
export const PLOT_W = 72;
export const PLOT_H = 20;

/**
 * Pressure spans 6 to 1013 mbar over a run, so it is plotted on a log axis;
 * on a linear one the entire early game is pinned to the bottom row.
 * The low end is 1 rather than P_TRIPLE so the axis labels are round numbers.
 */
export const P_PLOT_LO = 1;
export const P_PLOT_HI = 1013;

export const T_PLOT_LO = 200;
export const T_PLOT_HI = 300;
