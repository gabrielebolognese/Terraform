/**
 * The game's sound (Batch 35): one audio engine for the whole session, over
 * the Web Audio API.
 *
 * Four channels - music, ambience, effects and the interface - each a gain
 * into a master gain, each with the player's volume. Nothing is loaded:
 * every sound is made on the spot from oscillators and noise
 * (`sound-recipes.ts`, `sound-music.ts`), so there are no files to fetch and
 * no licences but the game's own.
 *
 * Silent until the first user gesture, as browsers require: no
 * `AudioContext` is made before the player presses a key, clicks or touches,
 * and whatever was asked for before that is dropped, never saved up to burst
 * out on the first click. A page with no Web Audio (the tests' happy-dom)
 * gets silence and no error.
 *
 * Reads nothing of the world and writes nothing of it: the director
 * (`sound-director.ts`) reads the state and tells this what to play.
 */

import { CHANNELS, DEFAULT_SOUND } from "./sound-settings.js";
import type { Channel, SoundSettings } from "./sound-settings.js";
import { EFFECT_CHANNEL, playEffect } from "./sound-recipes.js";
import type { EffectName } from "./sound-recipes.js";
import { MusicPlayer } from "./sound-music.js";
import type { Piece } from "./sound-music.js";
import { AmbienceBed, SILENCE } from "./sound-ambience.js";
import type { AmbienceLevels } from "./sound-ambience.js";

// ---------------------------------------------------------------------------
// The slice of the Web Audio API the game uses: the browser's own objects
// satisfy it, and so does the tests' fake (`fake-audio.ts`).
// ---------------------------------------------------------------------------

export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown;
  cancelScheduledValues(time: number): unknown;
}

export interface NodeLike {
  connect(destination: NodeLike): unknown;
  disconnect(): void;
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike;
}

export interface SourceLike extends NodeLike {
  start(when?: number): void;
  stop(when?: number): void;
}

export interface OscillatorLike extends SourceLike {
  type: string;
  readonly frequency: ParamLike;
  readonly detune: ParamLike;
}

export interface BufferLike {
  readonly length: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends SourceLike {
  buffer: BufferLike | null;
  loop: boolean;
  readonly playbackRate: ParamLike;
}

export interface FilterLike extends NodeLike {
  type: string;
  readonly frequency: ParamLike;
  readonly Q: ParamLike;
}

export interface PannerLike extends NodeLike {
  readonly pan: ParamLike;
}

export interface DelayLike extends NodeLike {
  readonly delayTime: ParamLike;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: string;
  readonly destination: NodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  createGain(): GainLike;
  createOscillator(): OscillatorLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike;
  createBufferSource(): BufferSourceLike;
  createBiquadFilter(): FilterLike;
  createStereoPanner(): PannerLike;
  createDelay(maxDelayTime?: number): DelayLike;
}

/** The browser's `AudioContext`, or null where there is none (or it will not start). */
export function browserAudio(): AudioContextLike | null {
  const Ctor = (globalThis as { AudioContext?: new () => unknown }).AudioContext;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor() as AudioContextLike;
  } catch {
    return null;
  }
}

/** The events that count as the player's gesture: what browsers let start sound. */
export const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/** Seconds the channel volumes take to follow a slider: quick, but never a click. */
const VOLUME_GLIDE_S = 0.03;

/** Where an effect is heard from, in the city view: its loudness there and left-right, -1 to 1. */
export interface Heard {
  readonly gain: number;
  readonly pan: number;
}

export class SoundEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainLike | null = null;
  private readonly buses = new Map<Channel, GainLike>();
  private settings: SoundSettings = DEFAULT_SOUND;
  private music: MusicPlayer | null = null;
  private ambience: AmbienceBed | null = null;
  /** What should be playing, kept while silent so the first gesture starts it. */
  private piece: Piece | null = null;
  private levels: AmbienceLevels = SILENCE;
  /** Effects asked for before the first gesture: dropped, and counted. */
  dropped = 0;
  /** Effects played since the first gesture, by name: what a test reads, and the note's measurements. */
  readonly played = new Map<EffectName, number>();
  /** The context's construction failed (no Web Audio): never tried again. */
  private unavailable = false;

  constructor(private readonly make: () => AudioContextLike | null = browserAudio) {}

  /** Sound has been let start: a gesture came and the browser has audio. */
  get unlocked(): boolean {
    return this.ctx !== null;
  }

  get volumes(): SoundSettings {
    return this.settings;
  }

  /**
   * The player's gesture: make the context, if there is none, and let it run.
   * Only ever called from a gesture's handler (`listen`), or a test standing
   * in for one.
   */
  unlock(): boolean {
    if (this.ctx !== null) {
      if (this.ctx.state === "suspended" && !this.hidden()) void this.ctx.resume().catch(() => undefined);
      return true;
    }
    if (this.unavailable) return false;
    const ctx = this.make();
    if (ctx === null) {
      this.unavailable = true;
      return false;
    }
    try {
      const master = ctx.createGain();
      master.connect(ctx.destination);
      this.master = master;
      for (const c of CHANNELS) {
        const bus = ctx.createGain();
        bus.connect(master);
        this.buses.set(c, bus);
      }
      this.ctx = ctx;
      this.applyVolumes(true);
      void ctx.resume().catch(() => undefined);
      this.music = new MusicPlayer(ctx, this.buses.get("music")!);
      this.ambience = new AmbienceBed(ctx, this.buses.get("ambience")!);
      if (this.piece !== null) this.music.set(this.piece);
      this.ambience.set(this.levels);
      return true;
    } catch {
      this.unavailable = true;
      this.ctx = null;
      return false;
    }
  }

  /**
   * Wait for the player's first gesture on `target` (the window), and keep
   * listening: a later gesture resumes a context the browser suspended. A
   * hidden tab is quiet - the frame loop that writes the music stops there.
   */
  listen(target: EventTarget, signal?: AbortSignal): void {
    const options = signal === undefined ? { capture: true, passive: true } : { capture: true, passive: true, signal };
    for (const g of GESTURES) target.addEventListener(g, () => this.unlock(), options);
    const doc = (globalThis as { document?: Document }).document;
    doc?.addEventListener(
      "visibilitychange",
      () => {
        const ctx = this.ctx;
        if (ctx === null) return;
        if (doc.hidden) void ctx.suspend().catch(() => undefined);
        else void ctx.resume().catch(() => undefined);
      },
      signal === undefined ? {} : { signal },
    );
  }

  private hidden(): boolean {
    return (globalThis as { document?: Document }).document?.hidden === true;
  }

  /** The player's volumes (the settings): each channel's, the master, and mute. */
  setVolumes(settings: SoundSettings): void {
    this.settings = settings;
    this.applyVolumes(false);
  }

  private applyVolumes(now: boolean): void {
    const ctx = this.ctx;
    if (ctx === null || this.master === null) return;
    const t = ctx.currentTime;
    const set = (p: ParamLike, v: number) => {
      p.cancelScheduledValues(t);
      if (now) p.setValueAtTime(v, t);
      else p.setTargetAtTime(v, t, VOLUME_GLIDE_S);
    };
    set(this.master.gain, this.settings.muted ? 0 : this.settings.master);
    for (const c of CHANNELS) set(this.buses.get(c)!.gain, this.settings[c]);
  }

  /**
   * Play an effect now. Before the first gesture it is dropped (and
   * counted); after, it is made on the spot. `heard` places it in the city
   * view; `delay` spaces several of a kind in one look.
   */
  play(effect: EffectName, heard: Heard = { gain: 1, pan: 0 }, delay = 0): boolean {
    const ctx = this.ctx;
    if (ctx === null) {
      this.dropped += 1;
      return false;
    }
    const bus = this.buses.get(EFFECT_CHANNEL[effect]);
    if (bus === undefined) return false;
    try {
      playEffect(ctx, bus, effect, ctx.currentTime + 0.01 + delay, heard);
      this.played.set(effect, (this.played.get(effect) ?? 0) + 1);
      return true;
    } catch {
      // Sound is a nicety: never let it take the game down.
      return false;
    }
  }

  /** The music to play: a piece, or none. Changed, the old crossfades into the new (never cut). */
  setMusic(piece: Piece | null): void {
    this.piece = piece;
    this.music?.set(piece);
  }

  get musicPiece(): Piece | null {
    return this.piece;
  }

  /** The beds of sound under everything: each glides to its level. */
  setAmbience(levels: AmbienceLevels): void {
    this.levels = levels;
    this.ambience?.set(levels);
  }

  get ambienceLevels(): AmbienceLevels {
    return this.levels;
  }

  /** The beds and the music as made, once a gesture has let sound start: what a test listens to. */
  get bed(): AmbienceBed | null {
    return this.ambience;
  }

  get player(): MusicPlayer | null {
    return this.music;
  }

  /** Every frame: the music writes its next notes a little ahead. */
  frame(): void {
    try {
      this.music?.frame();
    } catch {
      // As above: silence, never a stopped game.
    }
  }
}
