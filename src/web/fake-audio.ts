/**
 * A stand-in for the Web Audio API, for tests (Batch 35): every node made,
 * every value scheduled on every parameter, every source started - written
 * down, and nothing heard. Its clock moves only when a test moves it.
 *
 * Not part of the game: nothing the game ships imports it.
 */

import type {
  AudioContextLike,
  BufferLike,
  BufferSourceLike,
  DelayLike,
  FilterLike,
  GainLike,
  NodeLike,
  OscillatorLike,
  PannerLike,
  ParamLike,
} from "./sound-engine.js";

export type ParamEvent =
  | { readonly kind: "set"; readonly value: number; readonly time: number }
  | { readonly kind: "linear"; readonly value: number; readonly time: number }
  | { readonly kind: "exp"; readonly value: number; readonly time: number }
  | { readonly kind: "target"; readonly value: number; readonly time: number; readonly constant: number }
  | { readonly kind: "cancel"; readonly time: number };

export class FakeParam implements ParamLike {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial: number) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "set", value, time });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "linear", value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (!(value > 0)) throw new RangeError("an exponential ramp needs a value above 0");
    this.events.push({ kind: "exp", value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, constant: number): this {
    this.events.push({ kind: "target", value, time, constant });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ kind: "cancel", time });
    return this;
  }

  /** The last value this was told to go to (a set, a ramp's end or a target), or its first value. */
  get last(): number {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const e = this.events[i]!;
      if (e.kind !== "cancel") return e.value;
    }
    return this.value;
  }
}

export type FakeKind = "gain" | "oscillator" | "buffer-source" | "filter" | "panner" | "delay" | "destination";

export class FakeNode implements NodeLike {
  readonly outputs: unknown[] = [];
  disconnected = false;

  constructor(readonly kind: FakeKind) {}

  connect(destination: NodeLike): NodeLike {
    this.outputs.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam(1);
  constructor() {
    super("gain");
  }
}

export class FakeSource extends FakeNode {
  started: number | null = null;
  stopped: number | null = null;

  start(when = 0): void {
    this.started = when;
  }

  stop(when = 0): void {
    this.stopped = when;
  }
}

export class FakeOscillator extends FakeSource implements OscillatorLike {
  type = "sine";
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  constructor() {
    super("oscillator");
  }
}

export class FakeBuffer implements BufferLike {
  private readonly data: Float32Array;
  constructor(readonly length: number, readonly sampleRate: number) {
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeBufferSource extends FakeSource implements BufferSourceLike {
  buffer: BufferLike | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  constructor() {
    super("buffer-source");
  }
}

export class FakeFilter extends FakeNode implements FilterLike {
  type = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  constructor() {
    super("filter");
  }
}

export class FakePanner extends FakeNode implements PannerLike {
  readonly pan = new FakeParam(0);
  constructor() {
    super("panner");
  }
}

export class FakeDelay extends FakeNode implements DelayLike {
  readonly delayTime = new FakeParam(0);
  constructor() {
    super("delay");
  }
}

export class FakeAudioContext implements AudioContextLike {
  /** Every context made, in order: what the gesture check counts. */
  static made: FakeAudioContext[] = [];

  currentTime = 0;
  readonly sampleRate = 8000;
  state = "suspended";
  readonly destination = new FakeNode("destination");
  readonly nodes: FakeNode[] = [];
  resumed = 0;
  suspended = 0;

  constructor() {
    FakeAudioContext.made.push(this);
  }

  resume(): Promise<void> {
    this.resumed += 1;
    this.state = "running";
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspended += 1;
    this.state = "suspended";
    return Promise.resolve();
  }

  private add<N extends FakeNode>(n: N): N {
    this.nodes.push(n);
    return n;
  }

  createGain(): FakeGain {
    return this.add(new FakeGain());
  }

  createOscillator(): FakeOscillator {
    return this.add(new FakeOscillator());
  }

  createBuffer(_channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(length, sampleRate);
  }

  createBufferSource(): FakeBufferSource {
    return this.add(new FakeBufferSource());
  }

  createBiquadFilter(): FakeFilter {
    return this.add(new FakeFilter());
  }

  createStereoPanner(): FakePanner {
    return this.add(new FakePanner());
  }

  createDelay(): FakeDelay {
    return this.add(new FakeDelay());
  }

  /** Oscillators started at or after `from` (and before `to`): the notes and tones made then. */
  oscillators(from = -Infinity, to = Infinity): FakeOscillator[] {
    return this.nodes.filter((n): n is FakeOscillator => n instanceof FakeOscillator && n.started !== null && n.started >= from && n.started < to);
  }

  /** Every node made since `mark` (a count of `nodes` taken before). */
  since(mark: number): FakeNode[] {
    return this.nodes.slice(mark);
  }
}
