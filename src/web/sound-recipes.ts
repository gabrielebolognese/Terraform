/**
 * The effects (Batch 35), each made on the spot from oscillators and noise:
 * nothing is recorded or loaded. Every one is short, and quiet enough to sit
 * under the music.
 *
 * Effects of the world - a building placed, finished or raised, a train, a
 * rocket - are on the effects channel and are placed in the city view; the
 * interface's - an alert, an objective, a milestone, a button - are on the
 * interface channel.
 */

import type { AudioContextLike, BufferLike, GainLike, Heard, NodeLike, ParamLike } from "./sound-engine.js";
import type { Channel } from "./sound-settings.js";

export const EFFECTS = ["place", "built", "upgraded", "train", "rocket", "alert", "urgent", "objective", "milestone", "phase", "click"] as const;
export type EffectName = (typeof EFFECTS)[number];

export const EFFECT_CHANNEL: Readonly<Record<EffectName, Channel>> = {
  place: "effects",
  built: "effects",
  upgraded: "effects",
  train: "effects",
  rocket: "effects",
  alert: "interface",
  urgent: "interface",
  objective: "interface",
  milestone: "interface",
  phase: "interface",
  click: "interface",
};

/** A second of white noise for each context, made once: the wind, the rain, a rocket's roar. */
const noiseBuffers = new WeakMap<AudioContextLike, BufferLike>();

export function noiseBuffer(ctx: AudioContextLike): BufferLike {
  let b = noiseBuffers.get(ctx);
  if (b !== undefined) return b;
  const length = Math.max(1, Math.round(ctx.sampleRate * 2));
  b = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = b.getChannelData(0);
  // A fixed sequence (a linear congruential generator), not the clock's randomness: the same hiss every time.
  let x = 12345;
  for (let i = 0; i < data.length; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    data[i] = (x / 0x100000000) * 2 - 1;
  }
  noiseBuffers.set(ctx, b);
  return b;
}

/** An envelope: from silence to `peak` in `attack`, down to silence by `t + attack + decay`. */
function envelope(p: ParamLike, t: number, peak: number, attack: number, decay: number): void {
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** One tone through its own envelope into `out`. */
function tone(ctx: AudioContextLike, out: NodeLike, type: string, freq: number, t: number, peak: number, attack: number, decay: number, glideTo?: number): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay);
  envelope(g.gain, t, peak, attack, decay);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + attack + decay + 0.05);
}

/** Noise through a filter, shaped by an envelope; the filter's centre may sweep through `sweep`. */
function hiss(
  ctx: AudioContextLike,
  out: NodeLike,
  filter: string,
  freq: number,
  q: number,
  t: number,
  peak: number,
  attack: number,
  decay: number,
  sweep: readonly (readonly [number, number])[] = [],
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t);
  for (const [at, hz] of sweep) f.frequency.exponentialRampToValueAtTime(hz, t + at);
  f.Q.setValueAtTime(q, t);
  const g = ctx.createGain();
  envelope(g.gain, t, peak, attack, decay);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + attack + decay + 0.05);
}

/** The effect's way in: its loudness and its place left to right, then the channel. */
function placed(ctx: AudioContextLike, bus: GainLike, heard: Heard, t: number): NodeLike {
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0, Math.min(1, heard.gain)), t);
  if (heard.pan !== 0 && typeof ctx.createStereoPanner === "function") {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, heard.pan)), t);
    g.connect(p);
    p.connect(bus);
  } else {
    g.connect(bus);
  }
  return g;
}

/** The chime's notes, Hz: a rising major arpeggio; the grand one (a phase) adds the octave (Batch 30's, kept). */
export const CHIME_NOTES = [523.25, 659.25, 783.99] as const;
export const CHIME_OCTAVE = 1046.5;

/** Make `effect` at time `t` into the channel `bus`, heard as `heard`. */
export function playEffect(ctx: AudioContextLike, bus: GainLike, effect: EffectName, t: number, heard: Heard): void {
  const out = placed(ctx, bus, heard, t);
  switch (effect) {
    case "place":
      // A thump as it is set down, and the grit under it.
      tone(ctx, out, "sine", 170, t, 0.5, 0.005, 0.18, 65);
      hiss(ctx, out, "bandpass", 1800, 0.8, t, 0.12, 0.003, 0.07);
      return;
    case "built":
      // Two bell notes, the second a fifth above: done.
      for (const [f, at] of [[659.25, 0], [987.77, 0.13]] as const) {
        tone(ctx, out, "sine", f, t + at, 0.22, 0.004, 1.3);
        tone(ctx, out, "sine", f * 2.01, t + at, 0.05, 0.004, 0.5);
      }
      return;
    case "upgraded":
      // Three notes up, and a glint at the top: a level more.
      [659.25, 880, 1174.66].forEach((f, i) => tone(ctx, out, "triangle", f, t + i * 0.085, 0.16, 0.004, 0.75));
      tone(ctx, out, "sine", 2349.3, t + 0.3, 0.05, 0.004, 0.6);
      return;
    case "train":
      // A maglev going by: air swelling and falling away, its note dropping as it passes.
      hiss(ctx, out, "bandpass", 450, 1.2, t, 0.35, 1.1, 1.6, [[1.1, 1300], [2.7, 380]]);
      tone(ctx, out, "sine", 233, t, 0.06, 1.0, 1.7, 175);
      return;
    case "rocket":
      // The roar: a deep rumble that builds and fades as it climbs, with the crackle over it.
      hiss(ctx, out, "lowpass", 160, 0.7, t, 0.9, 0.7, 4.2, [[0.7, 260], [4.9, 90]]);
      hiss(ctx, out, "bandpass", 900, 0.6, t + 0.15, 0.12, 0.4, 2.6);
      tone(ctx, out, "sine", 58, t, 0.35, 0.6, 3.8, 38);
      return;
    case "alert":
      // Two soft notes down: something to look at.
      tone(ctx, out, "triangle", 783.99, t, 0.16, 0.01, 0.35);
      tone(ctx, out, "triangle", 659.25, t + 0.18, 0.16, 0.01, 0.5);
      return;
    case "urgent":
      // Three pulses, twice: look now. Rounded, never a siren.
      for (let i = 0; i < 3; i += 1) {
        tone(ctx, out, "square", 880, t + i * 0.22, 0.05, 0.01, 0.12);
        tone(ctx, out, "triangle", 740, t + i * 0.22 + 0.1, 0.12, 0.01, 0.16);
      }
      return;
    case "objective":
    case "milestone":
      CHIME_NOTES.forEach((f, i) => tone(ctx, out, "sine", f, t + i * 0.11, 0.06 * 3, 0.02, 0.88));
      return;
    case "phase":
      [...CHIME_NOTES, CHIME_OCTAVE].forEach((f, i) => tone(ctx, out, "sine", f, t + i * 0.11, 0.06 * 3, 0.02, 0.88));
      return;
    case "click":
      tone(ctx, out, "sine", 1750, t, 0.07, 0.002, 0.035);
      return;
  }
}
