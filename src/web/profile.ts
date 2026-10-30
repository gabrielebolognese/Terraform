/**
 * The player's record across their worlds (Batch 39): every victory and the
 * first time each achievement was earned, kept in the player's own store
 * beside their settings - so deleting a world never takes back what was won
 * in it, and new game plus stays open once a world has been won.
 *
 * Written from a world's state when it is saved, never into it: a world's
 * own victory and achievements are its state's (`SimState.ending`); this is
 * the player's memory of them. A record the store will not give back is
 * never written over: the session plays on with an empty one in memory.
 */

import type { SimState, Tuning } from "../sim/index.js";
import type { GameStore } from "./storage.js";

const PROFILE_KEY = "profile";
const PROFILE_VERSION = 1;

export interface Victory {
  readonly world: string;
  readonly name: string;
  /** The sim-year it was won. */
  readonly year: number;
  /** When it was first seen won, epoch ms. */
  readonly at: number;
}

export interface FirstEarned {
  readonly world: string;
  readonly name: string;
  readonly at: number;
}

export interface PlayerRecord {
  readonly victories: readonly Victory[];
  /** Each achievement the player has earned, by id: the world it was first earned in. */
  readonly achievements: Readonly<Record<string, FirstEarned>>;
}

export const EMPTY_RECORD: PlayerRecord = Object.freeze({ victories: Object.freeze([]) as readonly Victory[], achievements: Object.freeze({}) });

function readRecord(raw: unknown): PlayerRecord {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const victories = Array.isArray(r["victories"])
    ? (r["victories"] as unknown[]).flatMap((v) => {
        const x = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
        if (x === null || typeof x["world"] !== "string") return [];
        return [{ world: x["world"], name: typeof x["name"] === "string" ? x["name"] : "A world", year: typeof x["year"] === "number" ? x["year"] : 0, at: typeof x["at"] === "number" ? x["at"] : 0 }];
      })
    : [];
  const achievements: Record<string, FirstEarned> = {};
  const a = typeof r["achievements"] === "object" && r["achievements"] !== null ? (r["achievements"] as Record<string, unknown>) : {};
  for (const [id, v] of Object.entries(a)) {
    const x = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
    if (x === null || typeof x["world"] !== "string") continue;
    achievements[id] = { world: x["world"], name: typeof x["name"] === "string" ? x["name"] : "A world", at: typeof x["at"] === "number" ? x["at"] : 0 };
  }
  return { victories, achievements };
}

export class PlayerProfile {
  private value: PlayerRecord = EMPTY_RECORD;
  private writing: Promise<void> = Promise.resolve();
  /** Set when the record could not be read: it is never written over. */
  private readOnly = false;

  constructor(
    private readonly store: GameStore,
    private readonly now: () => number,
  ) {}

  get current(): PlayerRecord {
    return this.value;
  }

  /** New game plus is open once any world has been won. */
  get newGamePlus(): boolean {
    return this.value.victories.length > 0;
  }

  async load(): Promise<PlayerRecord> {
    try {
      const raw = await this.store.loadPlayer(PROFILE_KEY);
      if (raw !== null) this.value = readRecord(raw);
    } catch {
      // The store would not answer: play on with an empty record, and write nothing over what it may still hold.
      this.value = EMPTY_RECORD;
      this.readOnly = true;
    }
    return this.value;
  }

  /**
   * What a world's state adds to the record: its victory, and each
   * achievement the player had not earned anywhere before. Written only when
   * something is new.
   */
  note(world: { readonly id: string; readonly name: string }, state: SimState, t: Tuning): Promise<void> {
    if (!t.ENDING_ENABLED) return this.writing;
    const at = this.now();
    let victories = this.value.victories;
    if (state.ending.victory !== null && !victories.some((v) => v.world === world.id)) {
      victories = [...victories, { world: world.id, name: world.name, year: state.ending.victory * t.SUBSTEP_YEARS, at }];
    }
    let achievements = this.value.achievements;
    for (const a of state.ending.achievements) {
      if (achievements[a.id] !== undefined) continue;
      if (achievements === this.value.achievements) achievements = { ...achievements };
      (achievements as Record<string, FirstEarned>)[a.id] = { world: world.id, name: world.name, at };
    }
    if (victories === this.value.victories && achievements === this.value.achievements) return this.writing;
    this.value = { victories, achievements };
    if (this.readOnly) return this.writing;
    const record = { version: PROFILE_VERSION, ...this.value };
    this.writing = this.writing.then(() => this.store.savePlayer(PROFILE_KEY, record)).catch(() => undefined);
    return this.writing;
  }
}
