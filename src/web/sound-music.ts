/**
 * The score (Batch 35): music by the planet's phase, made by the game itself.
 *
 * "Sparse and cold at the start, warmer as the planet greens. Crossfaded,
 * never cut." Each phase has a piece: a key, a few chords, a tempo and a
 * timbre. A piece is not a recording but a set of rules the player writes
 * notes from, a few seconds ahead of the clock - so it never repeats exactly
 * and costs nothing to download. Barren Mars is slow open fifths in a minor
 * mode, a pure tone through a dark filter, with glassy glints; a living
 * world is a major key, twice as many notes, a bass, and a bright warm pad.
 *
 * A change of piece is a crossfade: the old one's gain falls to nothing over
 * `CROSSFADE_S` while the new one's rises, and only then does the old one
 * stop writing notes.
 */

import type { AudioContextLike, GainLike, NodeLike } from "./sound-engine.js";

export interface Piece {
  /** The phase it plays for (the title plays the first). */
  readonly phase: number;
  readonly name: string;
  /** Beats a minute. */
  readonly tempo: number;
  readonly beatsPerBar: number;
  /** MIDI note of the key's root. */
  readonly root: number;
  /** The mode: semitones over the root, within an octave. Every note the piece plays is in it. */
  readonly scale: readonly number[];
  /** One chord a bar, in turn: semitones over the root. */
  readonly chords: readonly (readonly number[])[];
  /** The pad that holds each chord: its wave and how bright its filter lets it be, Hz. */
  readonly pad: { readonly type: string; readonly cutoff: number; readonly gain: number };
  /** The tune over it: the chance of a note on a beat, its wave, its register and how long it rings. */
  readonly melody: { readonly chance: number; readonly type: string; readonly octave: number; readonly gain: number; readonly decay: number };
  /** The bass's loudness under each chord; 0 for none. */
  readonly bass: number;
  /** The chance a beat brings a high, glassy glint: the cold. */
  readonly glints: number;
  /** How much of each note comes back in the echo. */
  readonly echo: number;
}

/** Seconds a change of piece takes: the old fades out while the new fades in. */
export const CROSSFADE_S = 8;
/** Seconds ahead the notes are written: longer than a frame, so a slow frame never leaves a gap. */
export const LOOKAHEAD_S = 0.6;

const MINOR_PENTATONIC = [0, 3, 5, 7, 10] as const;
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const;
const LYDIAN = [0, 2, 4, 6, 7, 9, 11] as const;
const MAJOR_PENTATONIC = [0, 2, 4, 7, 9] as const;
const IONIAN = [0, 2, 4, 5, 7, 9, 11] as const;

/** One piece a phase, Barren (0) to Living World (6): slower, darker, sparser at the start. */
export const PIECES: readonly Piece[] = [
  {
    phase: 0,
    name: "Cold ground",
    tempo: 40,
    beatsPerBar: 4,
    root: 50,
    scale: MINOR_PENTATONIC,
    chords: [[0, 7, 15], [-2, 5, 10], [3, 10, 15], [0, 7, 12]],
    pad: { type: "sine", cutoff: 650, gain: 0.05 },
    melody: { chance: 0.12, type: "sine", octave: 12, gain: 0.07, decay: 3.5 },
    bass: 0,
    glints: 0.08,
    echo: 0.45,
  },
  {
    phase: 1,
    name: "Thin light",
    tempo: 44,
    beatsPerBar: 4,
    root: 50,
    scale: DORIAN,
    chords: [[0, 7, 15], [5, 12, 17], [-2, 5, 14], [0, 7, 14]],
    pad: { type: "sine", cutoff: 850, gain: 0.05 },
    melody: { chance: 0.16, type: "sine", octave: 12, gain: 0.07, decay: 3.2 },
    bass: 0.03,
    glints: 0.06,
    echo: 0.42,
  },
  {
    phase: 2,
    name: "Pressure",
    tempo: 50,
    beatsPerBar: 4,
    root: 48,
    scale: DORIAN,
    chords: [[0, 7, 15], [-2, 5, 14], [3, 10, 17], [5, 12, 21]],
    pad: { type: "triangle", cutoff: 1100, gain: 0.045 },
    melody: { chance: 0.22, type: "triangle", octave: 12, gain: 0.065, decay: 2.8 },
    bass: 0.06,
    glints: 0.04,
    echo: 0.4,
  },
  {
    phase: 3,
    name: "First water",
    tempo: 56,
    beatsPerBar: 4,
    root: 53,
    scale: LYDIAN,
    chords: [[0, 7, 16], [2, 9, 18], [-1, 7, 14], [4, 11, 19]],
    pad: { type: "triangle", cutoff: 1450, gain: 0.045 },
    melody: { chance: 0.28, type: "triangle", octave: 12, gain: 0.065, decay: 2.4 },
    bass: 0.08,
    glints: 0.02,
    echo: 0.38,
  },
  {
    phase: 4,
    name: "Green",
    tempo: 60,
    beatsPerBar: 4,
    root: 55,
    scale: MAJOR_PENTATONIC,
    chords: [[0, 7, 16], [-3, 4, 12], [2, 9, 14], [-5, 4, 12]],
    pad: { type: "sawtooth", cutoff: 1800, gain: 0.03 },
    melody: { chance: 0.32, type: "triangle", octave: 12, gain: 0.06, decay: 2.2 },
    bass: 0.09,
    glints: 0,
    echo: 0.35,
  },
  {
    phase: 5,
    name: "Breath",
    tempo: 64,
    beatsPerBar: 4,
    root: 57,
    scale: IONIAN,
    chords: [[0, 7, 16], [5, 12, 21], [-3, 4, 12], [7, 14, 23]],
    pad: { type: "sawtooth", cutoff: 2150, gain: 0.03 },
    melody: { chance: 0.36, type: "triangle", octave: 12, gain: 0.06, decay: 2 },
    bass: 0.1,
    glints: 0,
    echo: 0.32,
  },
  {
    phase: 6,
    name: "Living world",
    tempo: 68,
    beatsPerBar: 4,
    root: 50,
    scale: IONIAN,
    chords: [[0, 7, 16], [-3, 4, 12], [5, 12, 21], [7, 14, 23]],
    pad: { type: "sawtooth", cutoff: 2500, gain: 0.03 },
    melody: { chance: 0.4, type: "triangle", octave: 12, gain: 0.06, decay: 1.8 },
    bass: 0.1,
    glints: 0,
    echo: 0.3,
  },
];

/** The piece for a phase: the last phase's past the end, the first's before the start. */
export function pieceFor(phase: number): Piece {
  const i = Math.max(0, Math.min(PIECES.length - 1, Math.floor(phase)));
  return PIECES[i]!;
}

export function midiHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** A small seeded generator for the notes (mulberry32): the music's own, nothing to do with the world's. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One piece playing: its notes go into `input`, through the echo, out through the fade. */
class Voice {
  readonly input: GainLike;
  readonly out: GainLike;
  private readonly nodes: NodeLike[] = [];
  /** When the next beat falls, and its number. */
  next: number;
  beat = 0;
  /** Set when it is fading out: when it is silent, and stops writing notes. */
  until: number | null = null;
  readonly random: () => number;

  constructor(private readonly ctx: AudioContextLike, bus: NodeLike, readonly piece: Piece, private readonly start: number) {
    this.input = ctx.createGain();
    this.out = ctx.createGain();
    const beat = 60 / piece.tempo;
    const delay = ctx.createDelay(4);
    delay.delayTime.setValueAtTime(beat * 0.75, start);
    const feedback = ctx.createGain();
    feedback.gain.setValueAtTime(piece.echo, start);
    const wet = ctx.createGain();
    wet.gain.setValueAtTime(0.5, start);
    this.input.connect(this.out);
    this.input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(this.out);
    this.out.connect(bus);
    this.nodes.push(this.input, this.out, delay, feedback, wet);
    // Fade in from nothing.
    this.out.gain.setValueAtTime(0, start);
    this.out.gain.linearRampToValueAtTime(1, start + CROSSFADE_S);
    this.next = start + 0.05;
    this.random = generator(0x9e3779b9 ^ (piece.phase * 7919 + 17));
  }

  fadeOut(now: number): void {
    if (this.until !== null) return;
    const g = this.out.gain;
    // From wherever it is now - still fading in, perhaps - down to nothing: never a cut. Where it is
    // follows from its own fade in (a parameter's value is not to be trusted while it is ramping).
    const from = Math.max(0, Math.min(1, (now - this.start) / CROSSFADE_S));
    g.cancelScheduledValues(now);
    g.setValueAtTime(from, now);
    g.linearRampToValueAtTime(0, now + CROSSFADE_S);
    this.until = now + CROSSFADE_S;
  }

  /** Write the notes due before `horizon`. */
  write(horizon: number): void {
    const p = this.piece;
    const beatS = 60 / p.tempo;
    while (this.next < horizon && (this.until === null || this.next < this.until)) {
      const t = this.next;
      const inBar = this.beat % p.beatsPerBar;
      if (inBar === 0) {
        const chord = p.chords[Math.floor(this.beat / p.beatsPerBar) % p.chords.length]!;
        const bar = beatS * p.beatsPerBar;
        for (const n of chord) {
          for (const detune of [-6, 6]) this.note(p.pad.type, midiHz(p.root + n), t, p.pad.gain, Math.min(1.8, bar * 0.4), bar + 2.2, detune, p.pad.cutoff);
        }
        if (p.bass > 0) this.note("sine", midiHz(p.root + chord[0]! - 12), t, p.bass, 0.08, bar * 0.9, 0, null);
      }
      if (this.random() < p.melody.chance) {
        const degree = p.scale[Math.floor(this.random() * p.scale.length)]!;
        const lift = this.random() < 0.25 ? 12 : 0;
        this.note(p.melody.type, midiHz(p.root + p.melody.octave + degree + lift), t, p.melody.gain, 0.03, p.melody.decay, 0, null);
      }
      if (this.random() < p.glints) {
        const degree = p.scale[Math.floor(this.random() * p.scale.length)]!;
        this.note("sine", midiHz(p.root + 36 + degree), t + beatS * 0.5, 0.025, 0.005, 1.2, 0, null);
      }
      this.beat += 1;
      this.next += beatS;
    }
  }

  private note(type: string, freq: number, t: number, peak: number, attack: number, length: number, detune: number, cutoff: number | null): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (detune !== 0) osc.detune.setValueAtTime(detune, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + length);
    if (cutoff !== null) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(cutoff, t);
      f.Q.setValueAtTime(0.5, t);
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(this.input);
    osc.start(t);
    osc.stop(t + attack + length + 0.05);
  }

  dispose(): void {
    for (const n of this.nodes) n.disconnect();
  }
}

export class MusicPlayer {
  private readonly voices: Voice[] = [];

  constructor(private readonly ctx: AudioContextLike, private readonly bus: NodeLike) {}

  /** The piece playing now (the one fading in or held), or null. */
  get current(): Piece | null {
    const v = this.voices[this.voices.length - 1];
    return v === undefined || v.until !== null ? null : v.piece;
  }

  /** The pieces sounding, oldest first, and each one's fade: what a test looks at. */
  voicesNow(): readonly { readonly piece: Piece; readonly input: GainLike; readonly out: GainLike; readonly until: number | null }[] {
    return this.voices.map((v) => ({ piece: v.piece, input: v.input, out: v.out, until: v.until }));
  }

  /** How many pieces are sounding: two while a crossfade lasts. */
  get sounding(): number {
    return this.voices.length;
  }

  set(piece: Piece | null): void {
    if (piece === this.current) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) v.fadeOut(now);
    if (piece !== null) this.voices.push(new Voice(this.ctx, this.bus, piece, now));
    this.frame();
  }

  /** Write what is due, and let go of a piece faded out. */
  frame(): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) v.write(now + LOOKAHEAD_S);
    for (let i = this.voices.length - 1; i >= 0; i -= 1) {
      const v = this.voices[i]!;
      // Its last notes ring a while after the fade: let go once they are past.
      if (v.until !== null && now > v.until + 4) {
        v.dispose();
        this.voices.splice(i, 1);
      }
    }
  }
}
