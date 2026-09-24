/**
 * Deterministic pseudo-randomness, keyed on coordinates rather than on order.
 *
 * This is the piece the build plan calls the hard part of Batch 8, and the
 * reason is §8.2. Offline catch-up runs the same elapsed time in whatever
 * chunks the load screen can afford, and the browser runs it in whatever
 * chunks a frame budget allows. A conventional PRNG - a generator carrying a
 * cursor that each call advances - makes the stream depend on HOW MANY TIMES
 * it was called, so the same absence produces different weather depending on
 * how the work happened to be split. The save would be reproducible and the
 * world would not.
 *
 * So there is no generator and no cursor. `rand01(seed, year, salt)` is a pure
 * hash: ask for the same coordinates and you get the same number, forever, in
 * any order, from any driver, however the time was divided. Nothing here holds
 * state and nothing here can be "advanced".
 *
 * CROSS-ENGINE EXACTNESS. Invariant #5 only promises 1e-6 agreement between
 * engines, because ECMA-262 leaves `Math.exp`, `Math.log` and `Math.pow`
 * implementation-approximated. That caveat does not apply here: every
 * operation below is a 32-bit integer op - `Math.imul`, `^`, `>>>` - which the
 * spec pins exactly. The event TIMELINE is therefore bit-identical across
 * engines even though the physics it perturbs is not, which is exactly the
 * distinction the batch's exit gate draws.
 */

/**
 * 32-bit integer avalanche.
 *
 * The finalising mix from MurmurHash3. Its job is that adjacent inputs - and
 * year 300 and year 301 are adjacent - produce completely unrelated outputs,
 * so consecutive years do not share weather.
 */
function mix32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Hash a coordinate tuple to a 32-bit unsigned integer.
 *
 * The odd multipliers keep each argument's bits from cancelling another's:
 * with plain addition, `(seed+1, year-1)` would collide with `(seed, year)`
 * and a save one seed apart would replay the neighbouring save's weather one
 * year offset.
 */
export function hashInts(...values: readonly number[]): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < values.length; i += 1) {
    const v = Math.trunc(values[i] ?? 0) | 0;
    h = mix32(h ^ Math.imul(v, 0x27d4eb2d));
    h = (h + Math.imul(i + 1, 0x165667b1)) >>> 0;
  }
  return mix32(h);
}

/**
 * A uniform draw in [0, 1), keyed on coordinates.
 *
 * `salt` separates independent questions asked about the same year - "is there
 * a storm" and "how big is it" must not be the same number, or every storm
 * would begin exactly as strong as it is likely.
 */
export function rand01(seed: number, year: number, salt: number): number {
  // 2^32. Dividing an integer by a power of two is exact in binary floating
  // point, so this introduces no engine-dependent rounding.
  return hashInts(seed, year, salt) / 4294967296;
}

/** A uniform draw in [lo, hi). */
export function randRange(seed: number, year: number, salt: number, lo: number, hi: number): number {
  return lo + (hi - lo) * rand01(seed, year, salt);
}

/**
 * A draw from a roughly bell-shaped distribution on [0, 1), mean 0.5.
 *
 * The mean of four uniforms. Magnitudes drawn uniformly give as many
 * once-a-century storms as ordinary ones, which reads as noise rather than as
 * weather; this makes the extremes rare and the middle common.
 *
 * Deliberately not a Box-Muller normal: that needs `log` and `cos`, which are
 * exactly the functions invariant #5 says disagree between engines, and it
 * would cost this module its bit-identical timeline.
 */
export function randBell(seed: number, year: number, salt: number): number {
  return (
    (rand01(seed, year, salt) +
      rand01(seed, year, salt + 0x5f1) +
      rand01(seed, year, salt + 0xb27) +
      rand01(seed, year, salt + 0x1d3d)) /
    4
  );
}
