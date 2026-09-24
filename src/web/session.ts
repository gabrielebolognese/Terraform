/**
 * Boot, autosave, and coming back after an absence.
 *
 * This is the one place a clock is read, and it is read through an injected
 * `now()` so the whole thing is testable without waiting a day. Everything it
 * calls into - `resume`, `toSave`, `offlineGrant` - is pure and takes the time
 * as a parameter, which is what keeps offline catch-up reproducible.
 */

import type { AwaySummary, OfflineGrant, SaveFile, SaveStore, SimConfig, SimState } from "../sim/index.js";
import { SaveError, marsStart, resume, toSave } from "../sim/index.js";

/** Epoch milliseconds. Injected so tests can move time without waiting. */
export type Clock = () => number;

export const DEFAULT_SLOT = "mars";

export interface BootResult {
  readonly state: SimState;
  /** Absent on a fresh start. */
  readonly grant: OfflineGrant | null;
  readonly summary: AwaySummary | null;
  /** What happened, for the UI to report honestly. */
  readonly origin: "fresh" | "resumed" | "recovered";
  /** Set when a save existed but could not be loaded. */
  readonly problem: string | null;
}

/**
 * Load a save if there is one, advance it by whatever the absence was worth,
 * and hand back what to show the player.
 *
 * A corrupt save starts a fresh world rather than throwing. Losing a save is
 * bad; refusing to start the game because of one is worse, and the `problem`
 * field means the player is told rather than quietly reset.
 */
export async function boot(
  store: SaveStore,
  cfg: SimConfig,
  now: Clock,
  slot = DEFAULT_SLOT,
): Promise<BootResult> {
  let raw: unknown = null;
  try {
    raw = await store.load(slot);
  } catch (error) {
    return fresh(`could not read the save (${message(error)})`, "recovered");
  }

  if (raw === null || raw === undefined) return fresh(null, "fresh");

  try {
    const resumed = resume(raw, now(), cfg);
    return { state: resumed.state, grant: resumed.grant, summary: resumed.summary, origin: "resumed", problem: null };
  } catch (error) {
    const why = error instanceof SaveError ? error.message : `unexpected error (${message(error)})`;
    return fresh(why, "recovered");
  }
}

function fresh(problem: string | null, origin: "fresh" | "recovered"): BootResult {
  return { state: marsStart(), grant: null, summary: null, origin, problem };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Periodic and on-demand saving.
 *
 * Writes are serialised through a single in-flight promise: autosave, a
 * visibility change and a page-hide can all fire within a frame of each other,
 * and overlapping IndexedDB writes to one slot race for which lands last.
 */
export class Autosaver {
  private inFlight: Promise<void> = Promise.resolve();
  private lastSavedAtMs = 0;
  private failures = 0;

  constructor(
    private readonly store: SaveStore,
    private readonly cfg: SimConfig,
    private readonly now: Clock,
    private readonly slot = DEFAULT_SLOT,
  ) {}

  /** Most recent successful write, epoch ms. Zero if nothing has been written yet. */
  get lastSaved(): number {
    return this.lastSavedAtMs;
  }

  /** Consecutive write failures. Non-zero means the UI should stop promising persistence. */
  get failureCount(): number {
    return this.failures;
  }

  snapshot(state: SimState): SaveFile {
    return toSave(state, this.cfg.tuning, new Date(this.now()).toISOString());
  }

  save(state: SimState): Promise<void> {
    const data = this.snapshot(state);
    this.inFlight = this.inFlight
      .catch(() => undefined)
      .then(() => this.store.save(this.slot, data))
      .then(
        () => {
          this.lastSavedAtMs = this.now();
          this.failures = 0;
        },
        (error: unknown) => {
          // Swallowed on purpose: a failed autosave must not take down the
          // render loop. The count is what the UI reads to tell the player.
          this.failures += 1;
          void error;
        },
      );
    return this.inFlight;
  }

  /** True when `intervalMs` has passed since the last successful write. */
  due(intervalMs: number): boolean {
    return this.now() - this.lastSavedAtMs >= intervalMs;
  }
}
