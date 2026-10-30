/**
 * Whether a city's view must be derived again (Batch 40).
 *
 * A view is a pure function of the settlement, the planet as the city sees it,
 * and the tuning. Between substeps - 8.3 s apart at 1x, 2.8 s at 3x - none of
 * them changes, yet the city screen re-derived it five times a second and the
 * planner once a second: 70 ms each in a metropolis of 40,000 buildings, a
 * hitch every 200 ms while panning (measured). The settlement is a new object
 * after every substep; the planet's channels are made afresh every frame, so
 * they are compared by value.
 */

import type { HabitatChannels, Settlement } from "../sim/index.js";

/** The same channels, number for number. */
export function sameChannels(a: HabitatChannels | null, b: HabitatChannels | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  for (const key of Object.keys(a) as (keyof HabitatChannels)[]) if (!Object.is(a[key], b[key])) return false;
  return Object.keys(a).length === Object.keys(b).length;
}

/** What a view was derived from: the settlement and the planet's channels. */
export class ViewInputs {
  private settlement: Settlement | null = null;
  private env: HabitatChannels | null = null;

  /** Whether either has changed since the view was last derived. */
  changed(settlement: Settlement, env: HabitatChannels): boolean {
    return settlement !== this.settlement || !sameChannels(env, this.env);
  }

  /** The view was derived from these. */
  took(settlement: Settlement, env: HabitatChannels): void {
    this.settlement = settlement;
    this.env = env;
  }
}
