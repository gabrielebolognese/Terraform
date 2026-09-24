/**
 * Deterministic value noise on the sphere.
 *
 * Sampled from the 3D surface direction rather than from a UV parameterisation,
 * which costs nothing and avoids the seam and the polar pinch a lat/lon lookup
 * would give - both of which would show as artefacts exactly where the ice caps
 * are.
 *
 * Hash-based, so it needs no seed table and no allocation, and it is
 * bit-identical everywhere: the golden frames depend on that. `Math.random` is
 * nowhere near this file, and neither is any mutable state.
 */

/** Integer hash. `Math.imul` keeps the multiplies in 32-bit, which JS numbers otherwise would not. */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hermite fade, so the interpolated field has a continuous first derivative. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Trilinearly interpolated value noise, output in 0..1. */
export function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);

  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = lerp(c000, c100, xf);
  const x10 = lerp(c010, c110, xf);
  const x01 = lerp(c001, c101, xf);
  const x11 = lerp(c011, c111, xf);

  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

/**
 * Fractal sum, output in 0..1.
 *
 * `octaves` is fixed at the call site rather than adaptive: a frame whose
 * detail depends on anything but the inputs would not be reproducible, and the
 * golden frames rest on reproducibility.
 */
export function fbm(x: number, y: number, z: number, octaves: number, lacunarity = 2.07): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  let frequency = 1;

  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * frequency, y * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    // Not exactly 2, so successive octaves do not line up on the lattice and
    // produce visible grid structure.
    frequency *= lacunarity;
  }

  return total > 0 ? sum / total : 0;
}
