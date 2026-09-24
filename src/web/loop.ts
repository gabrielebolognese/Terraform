/**
 * The fixed-step accumulator that drives the simulation from the browser.
 *
 * The sim NEVER receives a frame-derived dt. It receives a whole number of
 * fixed substeps, and the leftover time stays in the accumulator. That is what
 * keeps the browser run bit-identical to the headless run and to the offline
 * catch-up - a variable dt would make the planet's history depend on the
 * player's frame rate.
 *
 * Three guards, all of which matter in practice:
 *   1. A frame delta longer than MAX_FRAME_DELTA_MS is clipped, so alt-tabbing
 *      does not fast-forward the world.
 *   2. Returning to a hidden tab resets the accumulator rather than cashing in
 *      the elapsed time - requestAnimationFrame stops while hidden, and the
 *      first frame back would otherwise carry minutes of delta.
 *   3. Work per frame is hard-bounded, and any time that could not be
 *      simulated is REPORTED as dropped rather than silently swallowed.
 */

import type { SimConfig, SimState } from "../sim/index.js";
import { advance } from "../sim/index.js";
import { MAX_FRAME_DELTA_MS, MAX_SUBSTEPS_PER_FRAME } from "./config.js";
import type { Speed } from "./config.js";

export interface FrameOutcome {
  readonly state: SimState;
  readonly stepsRun: number;
  /** Sim-years the frame budget could not cover. Shown in the UI, never hidden. */
  readonly droppedYears: number;
}

export class SimClock {
  private accumulator = 0;
  private lastTimestamp: number | null = null;

  constructor(
    private readonly cfg: () => SimConfig,
    public speed: Speed = 1,
  ) {}

  /**
   * Sim-years banked toward the next substep: how far the world has got
   * between steps. Read by the picture only, so rovers and rockets move
   * smoothly; the simulation never sees it.
   */
  get pendingYears(): number {
    return this.accumulator;
  }

  /** Call when the tab becomes visible again, or after any deliberate pause. */
  resync(): void {
    this.lastTimestamp = null;
    this.accumulator = 0;
  }

  /**
   * Advance the world to match one animation frame.
   *
   * `timestamp` is the value requestAnimationFrame passes, not
   * `performance.now()` - the two can disagree by a frame, and using the
   * argument keeps the accumulator honest.
   */
  frame(state: SimState, timestamp: number): FrameOutcome {
    const cfg = this.cfg();
    const substep = cfg.tuning.SUBSTEP_YEARS;

    if (this.speed === 0) {
      this.lastTimestamp = timestamp;
      return { state, stepsRun: 0, droppedYears: 0 };
    }

    const previous = this.lastTimestamp;
    this.lastTimestamp = timestamp;
    if (previous === null) {
      return { state, stepsRun: 0, droppedYears: 0 };
    }

    const deltaMs = Math.min(Math.max(0, timestamp - previous), MAX_FRAME_DELTA_MS);
    this.accumulator += (deltaMs / 1000) * cfg.tuning.TIME_SCALE * this.speed;

    const wanted = Math.floor(this.accumulator / substep);
    const steps = Math.min(wanted, MAX_SUBSTEPS_PER_FRAME);
    const dropped = (wanted - steps) * substep;

    if (steps <= 0) {
      return { state, stepsRun: 0, droppedYears: 0 };
    }

    this.accumulator -= wanted * substep;
    return { state: advance(state, steps, cfg), stepsRun: steps, droppedYears: dropped };
  }
}
