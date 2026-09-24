/**
 * Every transcendental the simulation uses routes through this file.
 *
 * That is a deliberate constraint, not tidiness: each function here is the
 * single place a NaN or an Infinity could be born, so each one is guarded once
 * and the rest of `src/sim/` can be read as if floating point were arithmetic.
 */

export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

export function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep from 0 at `edge0` to 1 at `edge1`. Degenerate edges become a hard step. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span === 0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / span);
  return t * t * (3 - 2 * t);
}

/** Logistic sigmoid. */
export function sig(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * A sigmoid with its lower tail cut off and the remainder renormalised, so the
 * threshold is a real threshold.
 *
 * Design doc section 3.3 uses a bare `sig((T - T0) / W)`, which is 0.5 AT the
 * threshold and never reaches zero below it - so the polar caps sublimate at
 * 38% of full rate on turn one and the planet terraforms itself while the
 * player watches. That deletes the moment section 0 calls the emotional core
 * of the game.
 *
 * At the default `cut` of 0.5 this is algebraically exactly
 * `clamp01(tanh((x - x0) / (2 * w)))`: identically zero at and below `x0`,
 * and approaching 1 well above it.
 */
export function ramp(x: number, x0: number, w: number, cut: number): number {
  if (!(w > 0)) return x > x0 ? 1 : 0;
  if (!(cut < 1)) return 0;
  return clamp01((sig((x - x0) / w) - cut) / (1 - cut));
}

/**
 * A flat-topped suitability band with smooth shoulders of half-width `edge`.
 *
 * Section 3.5 says "1 in the comfortable band, 0 outside" but then suggests a
 * Gaussian or raised cosine, which peak at the band CENTRE and fall off
 * everywhere else. That form scores only 0.61 at the game's own 288 K victory
 * temperature, capping biomass below the 0.8 target no matter what the player
 * does. The plateau is what the prose actually describes.
 */
export function bell(x: number, lo: number, hi: number, edge: number): number {
  return smoothstep(lo - edge, lo, x) * (1 - smoothstep(hi, hi + edge, x));
}

/**
 * Smooth depletion ramp, replacing section 3.3's `step(reservoir > 0)`.
 *
 * A hard step makes the release rate discontinuous at exhaustion, which is
 * both visible as a kink in the curve and a source of substep-order
 * sensitivity. This eases the last of a reservoir out instead.
 */
export function avail(x: number, scale: number): number {
  if (!(scale > 0)) return x > 0 ? 1 : 0;
  return clamp01(x / scale);
}

/** A saturating map from an unbounded reservoir to a bounded surface fraction. */
export function saturating(x: number, max: number, scale: number): number {
  if (!(scale > 0)) return 0;
  return max * (1 - Math.exp(-Math.max(0, x) / scale));
}

/** Division that cannot produce Infinity or NaN. */
export function safeDiv(a: number, b: number, fallback: number, eps: number): number {
  if (!(Math.abs(b) > eps)) return fallback;
  return a / b;
}

/**
 * Fourth root via two square roots.
 *
 * `Math.pow(x, 0.25)` on a negative base is NaN, and NaN passes every
 * `x < 0` assertion because NaN comparisons are false - so the bad value would
 * flow silently into the save file as `null`. `Math.sqrt` is the only
 * IEEE-mandated transcendental in ECMA-262, which also makes this the most
 * reproducible way to spell it across engines.
 */
export function quartRoot(x: number): number {
  return Math.sqrt(Math.sqrt(Math.max(0, x)));
}

/** `log(1 + x)` with the standard accuracy guarantee for small x, floored at x = 0. */
export function log1p(x: number): number {
  return Math.log1p(Math.max(0, x));
}

/** The exact factor by which a quantity decaying at rate `k` shrinks over `h` years. */
export function expDecay(k: number, h: number): number {
  return Math.exp(-Math.max(0, k) * Math.max(0, h));
}

/**
 * Where `x` sits on a LOGARITHMIC scale running from `hi` (reads 0) down to
 * `lo` (reads 1). For a quantity that has to be driven DOWN across orders of
 * magnitude, which a linear axis cannot show.
 */
export function logDescent(x: number, lo: number, hi: number): number {
  if (!(hi > lo) || !(lo > 0)) return 0;
  const value = Math.max(x, lo);
  return clamp01((Math.log(hi) - Math.log(value)) / (Math.log(hi) - Math.log(lo)));
}

/**
 * An angle in radians, as a fraction of a quarter turn.
 *
 * The unit a renderer wants for a polar cap: 0 is a point, 1 reaches the
 * equator. Clamped, so a cap fraction nudged past 1 by float noise cannot
 * produce a radius beyond the equator.
 */
export function quarterTurns(radians: number): number {
  return clamp01(radians / (Math.PI / 2));
}

export function isFiniteNumber(x: number): boolean {
  return Number.isFinite(x);
}
