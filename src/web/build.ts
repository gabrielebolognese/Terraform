/**
 * The build panel's view of the levers - Batch 16.
 *
 * Every lever the player can build, with what it costs, how much of it is up,
 * and whether the next order would go through. Asked of the SIMULATION, not
 * re-derived here: `orderDelta` is the one definition of "order one more" (or
 * one fewer), and both the panel's dry run and the real click go through it.
 * Batch 10's first finding was a button the sim then refused; this is the
 * structure that keeps it from coming back.
 */

import type { FacilityKind, FacilityType, OrderOutcome, SimState, Tuning } from "../sim/index.js";
import { FACILITY_LIST, deployedUnitsOf, facilityOf, orderCost, orderFacility } from "../sim/index.js";

/** Order `delta` more (or fewer) units of a lever, at its current level. The only definition. */
export function orderDelta(state: SimState, type: FacilityType, delta: number, tuning: Tuning): OrderOutcome {
  const existing = facilityOf(state, type);
  const next = Math.max(0, (existing?.count ?? 0) + delta);
  return orderFacility(state, type, next, existing?.level ?? 1, tuning);
}

export interface BuildRow {
  readonly type: FacilityType;
  readonly name: string;
  readonly summary: string;
  readonly kind: FacilityKind;
  /** Units ordered, and the level they are ordered at. */
  readonly count: number;
  readonly level: number;
  /** Effective units working now, and the target they ramp toward. */
  readonly online: number;
  readonly target: number;
  /** Switched on. A lever switched off keeps its order and ramps down. */
  readonly running: boolean;
  /** Would "order one more" go through, what would it cost, and if not, why not - in the player's words. */
  readonly next: { readonly ok: boolean; readonly cost: number; readonly reason: string | null };
  /** There is something to dismantle. Dismantling is always free and always allowed. */
  readonly canDismantle: boolean;
}

export function buildRows(state: SimState, tuning: Tuning): readonly BuildRow[] {
  return FACILITY_LIST.filter((def) => def.kind !== "action").map((def) => {
    const built = facilityOf(state, def.type);
    const count = built?.count ?? 0;
    const level = built?.level ?? 1;
    const running = built?.enabled ?? true;
    const dry = orderDelta(state, def.type, 1, tuning);
    return {
      type: def.type,
      name: def.name,
      summary: def.summary,
      kind: def.kind,
      count,
      level,
      online: deployedUnitsOf(state.facilities, def.type, tuning),
      target: running ? count * level : 0,
      running,
      next: {
        ok: dry.ok,
        // The price even when refused, so "needs 312 credits" has a number beside it.
        cost: dry.ok ? dry.cost : orderCost(def.type, count, count + 1, level, tuning),
        reason: dry.ok ? null : dry.reason,
      },
      canDismantle: count > 0,
    };
  });
}
