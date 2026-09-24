/**
 * Development-time assertion switch.
 *
 * The simulation's expensive invariant checks (ledger conservation every tick,
 * the fraction-of-source flux tripwire, whole-state finiteness) are on by
 * default and can be turned off for a long balance sweep.
 *
 * This is the one piece of module-level mutable state in `src/sim/`, and it is
 * deliberately incapable of changing a result: it only decides whether a
 * violation throws or goes unnoticed. It exists because the alternative -
 * `import.meta.env.DEV` - is Vite-only and breaks under tsx and vitest, and
 * `process.env` is absent in the browser.
 */

let devChecks = true;

export function setDevChecks(enabled: boolean): void {
  devChecks = enabled;
}

export function devChecksEnabled(): boolean {
  return devChecks;
}

export class SimInvariantError extends Error {}

export function invariant(condition: boolean, message: () => string): void {
  if (!devChecks) return;
  if (!condition) throw new SimInvariantError(message());
}
