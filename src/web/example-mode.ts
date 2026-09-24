/**
 * "See example planet" (requested by the user): swap in a fully terraformed,
 * settled Mars to look at, and put the player's own world back afterwards,
 * exactly as it was.
 *
 * The one rule that matters: while the example is showing, NOTHING is saved.
 * The player's save on disk is their planet; an example that autosaved over
 * it would destroy their game. `main.ts` routes every save through
 * `mayPersist`.
 */

import type { SimState } from "../sim/index.js";

export class ExampleMode {
  private kept: SimState | null = null;

  /** Is the example planet showing? */
  get active(): boolean {
    return this.kept !== null;
  }

  /** Saving is allowed only while the player's own planet is showing. */
  get mayPersist(): boolean {
    return this.kept === null;
  }

  /**
   * Show the example. The player's world is set aside - the first time only,
   * so asking twice never swaps the example in as "theirs".
   */
  enter(current: SimState, build: () => SimState): SimState {
    if (this.kept === null) this.kept = current;
    return build();
  }

  /** Put the player's own world back, exactly as it was. Null if no example was showing. */
  leave(): SimState | null {
    const mine = this.kept;
    this.kept = null;
    return mine;
  }
}
