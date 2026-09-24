/**
 * A fixed-capacity ring buffer over a Float64Array.
 *
 * A long inspector session is a slow memory leak if the series are plain
 * arrays - at 10 Hz an hour is 36,000 samples per series and climbing. The
 * capacity is allocated once and never grows.
 *
 * Deliberately free of any DOM reference, so it unit-tests under vitest's
 * default node environment with no jsdom.
 */

export class Ring {
  private readonly data: Float64Array;
  private start = 0;
  private count = 0;

  constructor(public readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`Ring capacity must be a positive integer, got ${capacity}`);
    }
    this.data = new Float64Array(capacity);
  }

  push(value: number): void {
    const index = (this.start + this.count) % this.capacity;
    this.data[index] = value;
    if (this.count < this.capacity) {
      this.count += 1;
    } else {
      this.start = (this.start + 1) % this.capacity;
    }
  }

  get length(): number {
    return this.count;
  }

  /** Oldest-first indexing. The codebase's single `?? 0` lives here. */
  at(i: number): number {
    if (i < 0 || i >= this.count) return 0;
    return this.data[(this.start + i) % this.capacity] ?? 0;
  }

  last(): number {
    return this.count === 0 ? 0 : this.at(this.count - 1);
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }
}
