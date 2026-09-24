/**
 * The cumulative distribution of a noise field over the whole sphere.
 *
 * The software renderer rank-transforms its fields over the visible disc, so
 * thresholding at a coverage channel `c` covers exactly `c` of what is on
 * screen (see `rankTransform` in planet.ts). A GPU shader cannot sort its own
 * pixels, but it can look a value up in a table: map the raw field through its
 * CDF and the result is uniform, which is the same property.
 *
 * Measured over the SPHERE by area, not over one view's disc: the globe
 * rotates, and a coverage channel is a fraction of the planet's surface, not
 * of whatever hemisphere is facing the camera.
 *
 * Pure, deterministic, no DOM - it lives beside the renderer it serves.
 */

/** Points evenly spread over the unit sphere by area (a Fibonacci lattice). */
export function fibonacciSphere(count: number): Float64Array {
  const out = new Float64Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * golden;
    out[i * 3] = Math.cos(phi) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(phi) * r;
  }
  return out;
}

/**
 * `bins` values: entry `k` is the fraction of the sphere where the field is at
 * most `k / (bins - 1)`. Non-decreasing, 0..1, last entry 1.
 *
 * The field must return values in 0..1, which `fbm` and `valueNoise` do.
 */
export function sphereCdf(
  field: (x: number, y: number, z: number) => number,
  samples = 60000,
  bins = 1024,
): Float32Array {
  const points = fibonacciSphere(samples);
  const counts = new Uint32Array(bins);
  for (let i = 0; i < samples; i += 1) {
    const v = field(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
    const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
    // The first bin whose upper edge is at or above v.
    counts[Math.min(bins - 1, Math.ceil(clamped * (bins - 1)))]! += 1;
  }
  const cdf = new Float32Array(bins);
  let running = 0;
  for (let k = 0; k < bins; k += 1) {
    running += counts[k]!;
    cdf[k] = running / samples;
  }
  return cdf;
}

/** The lookup a shader does, in TypeScript: linear interpolation into the table. */
export function lookupCdf(cdf: Float32Array, value: number): number {
  const bins = cdf.length;
  const v = (value < 0 ? 0 : value > 1 ? 1 : value) * (bins - 1);
  const i = Math.floor(v);
  const f = v - i;
  const a = cdf[i] ?? 1;
  const b = cdf[Math.min(bins - 1, i + 1)] ?? 1;
  return a + (b - a) * f;
}
