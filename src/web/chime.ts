/**
 * The milestone's sound (Batch 30): a short rising chime, made on the spot
 * with the Web Audio API - no sound files, nothing to load. Batch 35 brings
 * the game's sound proper (music, ambience, a mixer); this is one effect.
 *
 * Quiet, and it never throws: a browser that blocks sound until the player
 * has clicked, or a page with no audio at all (the tests' happy-dom), simply
 * gets silence. It reads nothing and writes nothing of the world.
 */

type AudioContextLike = {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { setValueAtTime(v: number, t: number): void };
    connect(node: unknown): void;
    start(t: number): void;
    stop(t: number): void;
  };
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
    connect(node: unknown): void;
  };
};

let context: AudioContextLike | null = null;

function audio(): AudioContextLike | null {
  if (context !== null) return context;
  const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext;
  if (typeof Ctor !== "function") return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Notes of the chime, Hz: a rising major arpeggio; the grand one (a phase) adds the octave. */
const NOTES = [523.25, 659.25, 783.99];
const OCTAVE = 1046.5;

/** Play the chime. `grand` for the big beats - a new phase - and a plain three notes for the rest. */
export function chime(grand = false): void {
  const ctx = audio();
  if (ctx === null) return;
  try {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const notes = grand ? [...NOTES, OCTAVE] : NOTES;
    const start = ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const at = start + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.06, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.95);
    });
  } catch {
    // Sound is a nicety: never let it take the game down.
  }
}
