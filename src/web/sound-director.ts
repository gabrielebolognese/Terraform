/**
 * What the game sounds like at each moment (Batch 35): the go-between from
 * the world to the sound engine.
 *
 * At each readout it sets the music by the phase the planet has reached, the
 * planet's beds of sound (wind, rain, sea) from what the world shows, and
 * plays what the world did since the last look (`SoundWatch`). In the city
 * view it hears from the camera: the machinery near it, the trains going by,
 * and every effect of that city placed by where it happened - louder near
 * the camera, to the left or right as it is on screen.
 *
 * Reads the state and the views; never writes either. The engine stays
 * silent until the player's first gesture, so none of this makes a sound
 * before then.
 */

import type { CityView, Derived, SimState, Tuning } from "../sim/index.js";
import { pieceFor } from "./sound-music.js";
import type { Piece } from "./sound-music.js";
import type { Ear } from "./sound-ambience.js";
import { ORBIT_HEARING, SILENCE, machineryFor, nearness, rainFor, seaFor, shoreNearness, windFor } from "./sound-ambience.js";
import type { AmbienceLevels } from "./sound-ambience.js";
import type { Car, Cue } from "./sound-cues.js";
import { SoundWatch, TrainEar } from "./sound-cues.js";
import type { Heard, SoundEngine } from "./sound-engine.js";
import type { EffectName } from "./sound-recipes.js";

/** Where the city view listens from: its camera over the ground, in tiles, and how far it hears. */
export interface CityEar extends Ear {
  readonly settlement: string;
  readonly view: CityView;
  /** The camera's zoom: zoomed far out, everything is a little further off. */
  readonly zoom: number;
}

/** At most this many of one effect in one look; the rest are one sound already playing. */
export const EFFECTS_PER_LOOK = 3;
/** Seconds between several of one effect in a look. */
export const EFFECT_SPACING_S = 0.12;
/** How loud the faintest effect of the city in view still is: something done far off is still heard. */
export const FAINTEST_HEARD = 0.12;
/** How loud another place's effects are: from orbit, or from another city. */
export const ELSEWHERE_HEARD = 0.4;
/** The city's ear is worked out this often, ms: the hum and the trains do not need every frame. */
export const EAR_MS = 100;

/** The planet's beds, from what the world shows: wind by pressure and storm, rain by weather, the sea by the ocean. */
export function planetBeds(d: Pick<Derived, "P" | "T" | "oceanFrac" | "cloudFrac">, storm: number): { wind: number; windHz: number; rain: number; ocean: number } {
  const wind = windFor(d.P, storm);
  return { wind: wind.level, windHz: wind.hz, rain: rainFor(d.cloudFrac, d.T, d.oceanFrac), ocean: d.oceanFrac };
}

export class SoundDirector {
  private readonly watch = new SoundWatch();
  private readonly trains = new TrainEar();
  private ear: CityEar | null = null;
  private earAt = -Infinity;
  private beds = { wind: 0, windHz: SILENCE.windHz, rain: 0, ocean: 0 };
  private machinery = 0;
  private shore = 0;
  private seaLevelM = 0;
  /** Effects heard so far, by name, after the per-look cap: the measurements' count. */
  readonly heard = new Map<EffectName, number>();

  constructor(readonly engine: SoundEngine, private readonly tuning: Tuning) {}

  /**
   * A readout: the music, the planet's beds, and - unless `cues` is false
   * (the example planet, which is not the player's) - what the world did.
   */
  readout(input: { readonly state: SimState; readonly derived: Derived; readonly storm: number; readonly seaLevelM: number; readonly cues: boolean }): readonly Cue[] {
    this.engine.setMusic(this.pieceOf(input.state));
    this.beds = planetBeds(input.derived, input.storm);
    this.seaLevelM = input.seaLevelM;
    this.mix();
    const cues = this.watch.observe(input.state, this.tuning);
    if (!input.cues) return [];
    const byKind = new Map<EffectName, number>();
    for (const c of cues) {
      const n = byKind.get(c.kind) ?? 0;
      byKind.set(c.kind, n + 1);
      if (n >= EFFECTS_PER_LOOK) continue;
      this.play(c.kind, this.heardAt(c.settlement, c.tx + 0.5, c.ty + 0.5), n * EFFECT_SPACING_S);
    }
    return cues;
  }

  /** The music for a world: its phase reached (the arc only goes forward, so the music never flips back and forth). */
  pieceOf(state: SimState): Piece {
    return pieceFor(state.phaseReached);
  }

  /**
   * A frame in the city view: the camera's ear. Worked out every `EAR_MS`:
   * the machinery near it, how near the city is to its sea, and the trains
   * that came within earshot. `cars` is asked for only then.
   */
  city(ear: CityEar, now: number, cars: () => readonly Car[]): void {
    const changed = this.ear === null || this.ear.settlement !== ear.settlement;
    this.ear = ear;
    if (!changed && now - this.earAt < EAR_MS) return;
    this.earAt = now;
    this.machinery = machineryFor(ear.view.buildings, ear);
    this.shore = shoreNearness(ear.view.baseElevationM, this.seaLevelM);
    const passes = this.trains.hear(ear.settlement, cars(), ear);
    passes.slice(0, EFFECTS_PER_LOOK).forEach((p, i) => this.play("train", this.heardAt(ear.settlement, p.x, p.y), i * EFFECT_SPACING_S));
    this.mix();
  }

  /** Out of the city view (orbit, the map, the planner): no ear on the ground. */
  orbit(): void {
    if (this.ear === null) return;
    this.ear = null;
    this.earAt = -Infinity;
    this.machinery = 0;
    this.trains.reset();
    this.mix();
  }

  /** The player set a building down, its footprint from (tx, ty). */
  placed(settlement: string, tx: number, ty: number, size: number, depth: number): void {
    this.play("place", this.heardAt(settlement, tx + size / 2, ty + depth / 2));
  }

  /** Alerts new this look: a sound for each that interrupts (a record only says nothing), the urgent more urgently. */
  alerts(fresh: readonly { readonly priority: "urgent" | "notice" | "record" }[]): void {
    const loud = fresh.filter((a) => a.priority !== "record");
    loud.slice(0, EFFECTS_PER_LOOK).forEach((a, i) => this.play(a.priority === "urgent" ? "urgent" : "alert", { gain: 1, pan: 0 }, i * EFFECT_SPACING_S * 3));
  }

  /** A milestone's card: the chime - grander for a phase, its own for an objective done. */
  milestone(kind: "phase" | "founded" | "great" | "objective"): void {
    this.play(kind === "phase" ? "phase" : kind === "objective" ? "objective" : "milestone");
  }

  /** A fresh start (a world opened, the example left): take bearings again. */
  reset(): void {
    this.watch.reset();
    this.trains.reset();
    this.ear = null;
    this.earAt = -Infinity;
    this.machinery = 0;
  }

  /** The world closed: the beds fall silent (the title sets its own music). */
  stop(): void {
    this.reset();
    this.engine.setAmbience(SILENCE);
  }

  /** The beds as heard now: the planet's, near or far, and the city's machinery. */
  levels(): AmbienceLevels {
    const inCity = this.ear !== null;
    const far = inCity ? { wind: 1, rain: 1, sea: 1 } : ORBIT_HEARING;
    return {
      wind: this.beds.wind * far.wind,
      windHz: this.beds.windHz,
      machinery: inCity ? this.machinery : 0,
      rain: this.beds.rain * far.rain,
      sea: seaFor(this.beds.ocean, inCity ? this.shore : 1) * far.sea,
    };
  }

  private mix(): void {
    this.engine.setAmbience(this.levels());
  }

  /** How an effect at (x, y) in `settlement` is heard: placed, if the camera is in that city; from afar if not. */
  heardAt(settlement: string, x: number, y: number): Heard {
    const ear = this.ear;
    if (ear === null || ear.settlement !== settlement) return { gain: ELSEWHERE_HEARD, pan: 0 };
    const dx = x - ear.x;
    const dy = y - ear.y;
    const zoom = 0.55 + 0.45 * Math.min(1, Math.max(0, ear.zoom));
    const gain = Math.max(FAINTEST_HEARD, nearness(Math.hypot(dx, dy), ear) * zoom);
    // Left and right as on screen: a tile's screen x goes with x - y.
    const pan = Math.max(-1, Math.min(1, (dx - dy) / (Math.SQRT2 * Math.max(1, ear.radius)))) * 0.8;
    return { gain, pan };
  }

  private play(effect: EffectName, heard: Heard = { gain: 1, pan: 0 }, delay = 0): void {
    this.heard.set(effect, (this.heard.get(effect) ?? 0) + 1);
    this.engine.play(effect, heard, delay);
  }
}
