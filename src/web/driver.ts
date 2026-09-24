/**
 * The part of the browser's frame loop that moves the world forward.
 *
 * Out of `main.ts` for one reason: Batch 21's gate is that the world advances
 * identically whether the player is in orbit or in any city, and that can only
 * be tested if the code that advances it can be driven with fixed timestamps.
 * Everything the loop does to the WORLD happens here - the fixed-step clock,
 * and latching the milestone high-water mark - and nothing here knows which
 * view is showing. Views read `state`; they never write it except through the
 * player's own actions.
 */

import type { Phase, SimState, Tuning } from "../sim/index.js";
import { latchPhase } from "../sim/index.js";
import type { SimClock } from "./loop.js";
import type { Readout } from "./readout.js";
import { readWorld } from "./readout.js";

export interface DriverFrame {
  readonly world: Readout;
  /** The latched milestone after this frame. */
  readonly reached: Phase;
  readonly droppedYears: number;
  readonly stepsRun: number;
}

export class WorldDriver {
  constructor(
    public state: SimState,
    private readonly clock: SimClock,
    private readonly tuning: Tuning,
  ) {}

  frame(timestamp: number): DriverFrame {
    const outcome = this.clock.frame(this.state, timestamp);
    this.state = outcome.state;
    const world = readWorld(this.state, this.tuning);
    const reached = latchPhase(this.state.phaseReached, world.phase);
    if (reached !== this.state.phaseReached) this.state = { ...this.state, phaseReached: reached };
    return { world, reached, droppedYears: outcome.droppedYears, stepsRun: outcome.stepsRun };
  }
}
