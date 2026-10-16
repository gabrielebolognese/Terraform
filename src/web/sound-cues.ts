/**
 * What the world does that is heard (Batch 35): a building finished, a
 * building raised a level, a rocket lifting off - and in the city view, a
 * train going by.
 *
 * Derived, like the milestones and the alerts: each is a crossing seen
 * between two looks at the state, never stored, and the first look only
 * takes its bearings, so opening a world (or coming back to it after a
 * while away) sounds nothing that was already so.
 *
 * Reads the state; never writes it.
 */

import type { Settlement, SimState, Tuning } from "../sim/index.js";
import { constructionOf, frameOf, keyTile } from "../sim/index.js";
import type { Ear } from "./sound-ambience.js";

export type CueKind = "built" | "upgraded" | "rocket";

/** Something heard: what, in which settlement, and where there (its tile, in the settlement's grid now). */
export interface Cue {
  readonly kind: CueKind;
  readonly settlement: string;
  readonly tx: number;
  readonly ty: number;
}

/** A building's corner on the ground as founded: a claim west or north renumbers the grid, not this. */
function groundKey(tile: number, x0: number, y0: number): string {
  const { tx, ty } = keyTile(tile);
  return `${tx + x0},${ty + y0}`;
}

interface Seen {
  readonly buildings: Settlement["buildings"];
  readonly jobs: Settlement["jobs"];
  readonly queue: Settlement["buildQueue"];
  readonly claims: Settlement["claims"];
  /** Worksites going up, by ground corner. */
  readonly going: ReadonlySet<string>;
  /** Buildings being raised, by ground corner: the level they stood at. */
  readonly raising: ReadonlyMap<string, number>;
  /** Rockets away, by ground corner: the sim-years each had left. */
  readonly rockets: ReadonlyMap<string, number>;
}

export class SoundWatch {
  private first = true;
  private readonly seen = new Map<string, Seen>();

  /** What was heard since the last look. The first look after `reset` only takes its bearings. */
  observe(state: SimState, t: Tuning): readonly Cue[] {
    const first = this.first;
    this.first = false;
    const out: Cue[] = [];
    const alive = new Set<string>();
    for (const s of state.settlements) {
      if (s.lostAtSeaLevelM !== null) continue;
      alive.add(s.id);
      const last = this.seen.get(s.id);
      // Nothing finished, raised or launched unless the buildings, the jobs or the queue changed.
      if (last !== undefined && last.buildings === s.buildings && last.jobs === s.jobs && last.queue === s.buildQueue && last.claims === s.claims) continue;
      const frame = frameOf(s, t);
      const ground = (tile: number) => groundKey(tile, frame.x0, frame.y0);
      const local = (key: string): { tx: number; ty: number } => {
        const [x, y] = key.split(",").map(Number);
        return { tx: x! - frame.x0, ty: y! - frame.y0 };
      };
      const going = new Set<string>();
      for (const tile of constructionOf(s).keys()) going.add(ground(tile));
      const raising = new Map<string, number>();
      const rockets = new Map<string, number>();
      let levels: Map<string, number> | null = null;
      const levelAt = (key: string): number | undefined => {
        if (levels === null) {
          levels = new Map();
          for (const b of s.buildings) levels.set(`${b.tx + frame.x0},${b.ty + frame.y0}`, b.level);
        }
        return levels.get(key);
      };
      for (const j of s.jobs) {
        if (j.kind === "build" && j.upgrade) {
          const k = ground(j.tile);
          const level = levelAt(k);
          if (level !== undefined) raising.set(k, level);
        } else if (j.kind === "rocket") {
          rockets.set(ground(j.tile), j.remaining);
        }
      }
      if (!first && last !== undefined) {
        // Finished: a worksite no longer going up, with its building still standing (not taken down).
        for (const k of last.going) if (!going.has(k) && levelAt(k) !== undefined) out.push({ kind: "built", settlement: s.id, ...local(k) });
        // Raised: an upgrade's job over, and the building a level higher than it stood.
        for (const [k, before] of last.raising) {
          if (raising.has(k)) continue;
          const now = levelAt(k);
          if (now !== undefined && now > before) out.push({ kind: "upgraded", settlement: s.id, ...local(k) });
        }
        // Lifted off: a rocket away where none was, or one with more of its trip ahead than before (away again).
        for (const [k, remaining] of rockets) {
          const before = last.rockets.get(k);
          if (before === undefined || remaining > before) out.push({ kind: "rocket", settlement: s.id, ...local(k) });
        }
      }
      this.seen.set(s.id, { buildings: s.buildings, jobs: s.jobs, queue: s.buildQueue, claims: s.claims, going, raising, rockets });
    }
    for (const id of [...this.seen.keys()]) if (!alive.has(id)) this.seen.delete(id);
    return out;
  }

  /** A fresh start: a world opened, the example left. */
  reset(): void {
    this.first = true;
    this.seen.clear();
  }
}

/** A train car as the ear needs it: where it is, which train, and whether it leads. */
export interface Car {
  readonly x: number;
  readonly y: number;
  readonly train: number;
  readonly lead: boolean;
}

/** A train come within earshot: which, and where its front is. */
export interface Pass {
  readonly train: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Trains going by the camera: each heard once as it comes near - within
 * `PASS_NEAR` of the ear's radius - and not again until it has gone past
 * `PASS_FAR` of it, so a train idling at the edge of hearing is not heard
 * over and over.
 */
export const PASS_NEAR = 0.6;
export const PASS_FAR = 0.9;

export class TrainEar {
  private near = new Set<number>();
  private settlement: string | null = null;

  hear(settlement: string, cars: readonly Car[], ear: Ear): readonly Pass[] {
    if (settlement !== this.settlement) {
      // A new city: take bearings - what is already near is not "coming".
      this.settlement = settlement;
      this.near = new Set(cars.filter((c) => c.lead && Math.hypot(c.x - ear.x, c.y - ear.y) <= ear.radius * PASS_NEAR).map((c) => c.train));
      return [];
    }
    const out: Pass[] = [];
    const next = new Set<number>();
    for (const c of cars) {
      if (!c.lead) continue;
      const d = Math.hypot(c.x - ear.x, c.y - ear.y);
      const was = this.near.has(c.train);
      if (was ? d <= ear.radius * PASS_FAR : d <= ear.radius * PASS_NEAR) next.add(c.train);
      if (!was && d <= ear.radius * PASS_NEAR) out.push({ train: c.train, x: c.x, y: c.y });
    }
    this.near = next;
    return out;
  }

  reset(): void {
    this.near.clear();
    this.settlement = null;
  }
}
