/**
 * Sandbox (Batch 27): a mode of a world, never of the game.
 *
 * "Unlimited materials and credits, everything unlocked, no losses." Each
 * rule reads `SANDBOX_ENABLED` where the cost or the gate is decided, so with
 * it at 0 - the default, and every world but a sandbox - nothing here changes
 * a single number.
 */

import type { Tuning } from "./tuning.js";

/** What a cost actually takes: nothing in a sandbox. */
export function charged(cost: number, t: Pick<Tuning, "SANDBOX_ENABLED">): number {
  return t.SANDBOX_ENABLED ? 0 : cost;
}

/** True when the world's gates - people, unlocks, tech - stand open. */
export function unlocked(t: Pick<Tuning, "SANDBOX_ENABLED">): boolean {
  return t.SANDBOX_ENABLED > 0;
}
