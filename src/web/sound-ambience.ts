/**
 * Ambience (Batch 35): the beds of sound under everything, each following
 * what drives it.
 *
 *   wind       the air's pressure: a thin high whisper on bare Mars, a full,
 *              deeper wind under a bar of air; a dust storm blows harder;
 *   machinery  in a city, what runs near the camera, by how hard it works;
 *   rain       once there is weather - clouds over liquid water, above
 *              freezing;
 *   sea        once there is a sea, louder for a city near its shore.
 *
 * From orbit the planet is heard from far off: its wind, rain and sea
 * softer, and no machinery.
 *
 * The drivers are pure functions of what the world shows; `AmbienceBed`
 * turns their levels into sound, gliding to each so nothing jumps.
 */

import type { AudioContextLike, GainLike, NodeLike } from "./sound-engine.js";
import { noiseBuffer } from "./sound-recipes.js";

/** 0 to 1 each, and the wind's pitch, Hz. */
export interface AmbienceLevels {
  readonly wind: number;
  readonly windHz: number;
  readonly machinery: number;
  readonly rain: number;
  readonly sea: number;
}

export const SILENCE: AmbienceLevels = Object.freeze({ wind: 0, windHz: 1200, machinery: 0, rain: 0, sea: 0 });

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Mars's air at the start, mbar, and a breathable world's: the wind's scale runs between them. */
export const WIND_THIN_MBAR = 6;
export const WIND_FULL_MBAR = 1000;

/** The wind, by the air's pressure (mbar) and a dust storm (0 to 1). */
export function windFor(pressureMbar: number, storm: number): { readonly level: number; readonly hz: number } {
  const x = clamp01((Math.log10(Math.max(0.1, pressureMbar)) - Math.log10(WIND_THIN_MBAR)) / (Math.log10(WIND_FULL_MBAR) - Math.log10(WIND_THIN_MBAR)));
  return { level: clamp01(0.18 + 0.57 * x + 0.25 * clamp01(storm)), hz: 1500 * (1 - x) + 380 * x };
}

/** Rain: clouds, over liquid water (`oceanFrac` of the surface), above freezing. None on a dry or frozen world. */
export function rainFor(cloudFrac: number, temperatureK: number, oceanFrac: number): number {
  return clamp01(cloudFrac * 1.5) * smoothstep(273.15, 280, temperatureK) * clamp01(oceanFrac / 0.05);
}

/** The sea: none without one; `near` is 1 at its shore, 0 far above it. */
export function seaFor(oceanFrac: number, near: number): number {
  return smoothstep(0.005, 0.25, oceanFrac) * clamp01(near);
}

/** Metres above the sea at which a city no longer hears it. */
export const SEA_HEARD_M = 1500;

/** How near a city is to the shore, from its height over the waterline: 1 on it, 0 from `SEA_HEARD_M` up. */
export function shoreNearness(elevationM: number, seaLevelM: number): number {
  return clamp01(1 - (elevationM - seaLevelM) / SEA_HEARD_M);
}

/** A building as the machinery hears it: where it is, and how hard it works (0 when it does not run). */
export interface Machine {
  readonly tx: number;
  readonly ty: number;
  readonly size: number;
  readonly depth?: number;
  readonly operable: boolean;
  readonly activity: number;
  readonly construction?: number | null;
}

/** Where the camera listens from, in tiles on the ground, and how far it hears. */
export interface Ear {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Buildings' worth of work at which the hum is about two thirds of full. */
export const MACHINERY_HALF = 6;

/** How loud something at distance `d` is, heard by `ear`: 1 under the camera, half at a third of the radius. */
export function nearness(d: number, ear: Ear): number {
  const near = Math.max(1, ear.radius / 3);
  return 1 / (1 + (d / near) * (d / near));
}

/** The city's machinery as the camera hears it: what runs, by how hard and how near. */
export function machineryFor(buildings: readonly Machine[], ear: Ear): number {
  let sum = 0;
  for (const b of buildings) {
    if (!b.operable || b.activity <= 0) continue;
    if (b.construction !== undefined && b.construction !== null) continue;
    const cx = b.tx + b.size / 2;
    const cy = b.ty + (b.depth ?? b.size) / 2;
    const d = Math.hypot(cx - ear.x, cy - ear.y);
    if (d > ear.radius * 3) continue;
    sum += Math.min(1, b.activity) * nearness(d, ear);
  }
  return 1 - Math.exp(-sum / MACHINERY_HALF);
}

/** From orbit, the planet is heard from far off. */
export const ORBIT_HEARING = Object.freeze({ wind: 0.5, rain: 0.4, sea: 0.45 });

/** Each bed's loudness at its level of 1. */
const PEAK = Object.freeze({ wind: 0.32, machinery: 0.22, rain: 0.2, sea: 0.28 });
/** Seconds each glides to a new level over (a time constant). */
const GLIDE_S = 1.2;

export type Bed = "wind" | "machinery" | "rain" | "sea";
export const BEDS: readonly Bed[] = ["wind", "machinery", "rain", "sea"];

/** The beds, made once the context is: each a source of sound into its level, then a slow swell, then the channel. */
export class AmbienceBed {
  /** Each bed's level: what follows its driver. */
  readonly level: Readonly<Record<Bed, GainLike>>;
  private readonly windFilter: { readonly frequency: { setTargetAtTime(v: number, t: number, c: number): unknown } };

  constructor(private readonly ctx: AudioContextLike, bus: NodeLike) {
    const t = ctx.currentTime;
    const noise = (filters: readonly (readonly [string, number, number])[]): { head: NodeLike; tail: NodeLike; first: ReturnType<AudioContextLike["createBiquadFilter"]> } => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      let tail: NodeLike = src;
      let first: ReturnType<AudioContextLike["createBiquadFilter"]> | null = null;
      for (const [type, freq, q] of filters) {
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.setValueAtTime(freq, t);
        f.Q.setValueAtTime(q, t);
        tail.connect(f);
        tail = f;
        first ??= f;
      }
      src.start(t);
      return { head: src, tail, first: first! };
    };
    const gain = (v: number): GainLike => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      return g;
    };
    /** A slow swell over a bed, `depth` either way at `hz`: gusts, waves. */
    const swell = (hz: number, depth: number): GainLike => {
      const g = gain(1);
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(hz, t);
      const amount = gain(depth);
      lfo.connect(amount);
      amount.connect(g.gain as unknown as NodeLike);
      lfo.start(t);
      return g;
    };

    const wind = noise([["bandpass", 1200, 0.9]]);
    this.windFilter = wind.first;
    const machineNoise = noise([["lowpass", 380, 0.7]]);
    const rain = noise([["highpass", 1800, 0.6], ["lowpass", 8000, 0.6]]);
    const sea = noise([["lowpass", 420, 0.6]]);

    const level = { wind: gain(0), machinery: gain(0), rain: gain(0), sea: gain(0) };
    const out = { wind: swell(0.13, 0.3), machinery: gain(1), rain: swell(0.05, 0.1), sea: swell(0.09, 0.45) };
    wind.tail.connect(level.wind);
    machineNoise.tail.connect(level.machinery);
    // The machines' own note under the rumble: two low saws, a fifth apart, kept dark.
    const hum = ctx.createBiquadFilter();
    hum.type = "lowpass";
    hum.frequency.setValueAtTime(240, t);
    for (const hz of [55, 82.5]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(hz, t);
      const g = gain(0.35);
      o.connect(g);
      g.connect(hum);
      o.start(t);
    }
    hum.connect(level.machinery);
    rain.tail.connect(level.rain);
    sea.tail.connect(level.sea);
    for (const b of BEDS) {
      level[b].connect(out[b]);
      out[b].connect(bus);
    }
    this.level = level;
  }

  /** Glide every bed to its level. */
  set(levels: AmbienceLevels): void {
    const t = this.ctx.currentTime;
    for (const b of BEDS) this.level[b].gain.setTargetAtTime(clamp01(levels[b]) * PEAK[b], t, GLIDE_S);
    this.windFilter.frequency.setTargetAtTime(levels.windHz, t, GLIDE_S);
  }
}
