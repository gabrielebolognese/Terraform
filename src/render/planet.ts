/**
 * The macro renderer - design doc §9 consumed for real.
 *
 * Imports `VisualChannels` and NOTHING else from the simulation. No
 * reservoirs, no derived values, no phase, no progress. That is cross-batch
 * invariant #2, and `boundary.test.ts` enforces it: if this file ever needs a
 * sim internal, the contract was wrong and the contract is what should change.
 *
 * A pure function from channels to pixels. No canvas, no WebGL, no DOM - it is
 * compiled against `lib: ["ES2023"]` with the DOM deliberately absent, so it
 * *cannot* reach for a browser API. `src/web/` does the blitting.
 *
 * WHY SOFTWARE RATHER THAN WEBGL: the exit gate is twelve golden frames
 * compared per pixel, and WebGL cannot render in Node. A GPU path would need
 * headless GL or a browser in CI, and every library upgrade would shift pixels
 * and churn the goldens. This runs identically in Node and the browser and is
 * bit-identical across machines. When resolution demands a GPU, a backend can
 * slot in behind this same signature - the golden frames are what would keep
 * it honest.
 *
 * THE RESPONSE REQUIREMENT: §0.3 names the failure this exists to prevent -
 * terraforming that becomes "colored keys" gating progress while the planet
 * barely changes on screen. So a change in a channel has to produce a
 * proportional change in the image, and `planet.test.ts` measures exactly that.
 *
 * GEOMETRY AND NOISE ARE CACHED. Everything that depends only on the camera -
 * the sphere, the elevation field, the cloud field, the lighting - is computed
 * once per `PlanetScene` and reused for every set of channels. Rebuilding it
 * per frame cost 77 ms at 260x260, which is not a live readout; reusing it
 * costs about 3 ms, which is.
 */

import type { VisualChannels } from "../sim/index.js";
import { fbm, valueNoise } from "../shared/noise.js";
import { PLANET_ELEVATION_FREQ, elevationField } from "../shared/planet-terrain.js";

export interface RenderOptions {
  readonly width: number;
  readonly height: number;
  /** Rotation about the pole, in turns. Spin the planet without touching the sim. */
  readonly spin?: number;
  /** Fraction of the frame's short side the planet's disc occupies. */
  readonly discScale?: number;
}

export interface Frame {
  readonly width: number;
  readonly height: number;
  /** RGBA, four bytes per pixel, row-major from the top left. */
  readonly pixels: Uint8ClampedArray;
}

const KIND_SPACE = 0;
const KIND_HALO = 1;
const KIND_DISC = 2;

/** Camera-dependent work, computed once and reused across channel changes. */
export interface PlanetScene {
  readonly width: number;
  readonly height: number;
  readonly kind: Uint8Array;
  /** Halo pixels: how strongly the glow reaches this pixel. */
  readonly halo: Float32Array;
  /** Disc pixels. */
  readonly depth: Float32Array;
  readonly latitude: Float32Array;
  readonly elevation: Float32Array;
  readonly cloudField: Float32Array;
  readonly capWobble: Float32Array;
  readonly dustHaze: Float32Array;
  readonly light: Float32Array;
}

/**
 * Fixed scene constants.
 *
 * Fixed because the golden frames depend on them, and because none of this is
 * balance: a light direction is not something the Batch 3 sweep should be able
 * to vary. Same argument as `VISUAL_TUNING` in the contract itself.
 */
export const SCENE = {
  /**
   * Axial tilt toward the viewer, radians.
   *
   * Not decoration. Pole-on-edge, the north cap lies exactly on the limb, so a
   * `capRadius` of 0.1 is a one-pixel sliver at the top of the disc and the
   * channel reads as dead over its whole first tenth. Tipping the pole into
   * view turns the cap into an ellipse whose area tracks the channel.
   */
  tilt: 0.42,
  /** Unit light direction, front-upper-left. */
  lightX: -0.5,
  lightY: 0.42,
  lightZ: 0.76,
  /** Light that reaches the night side. Not zero, or the terminator is a hard edge. */
  ambient: 0.14,
  /** How far the atmosphere extends past the disc, as a fraction of the radius. */
  haloWidth: 0.16,
  /** The continents' frequency: the shared field's own, so the globe and the settlements agree. */
  elevationFreq: PLANET_ELEVATION_FREQ,
  cloudFreq: 3.4,
  capEdgeFreq: 5.0,
  /** Softness of the shoreline, ice edge and cloud edge, in field units. */
  shoreSoft: 0.035,
  capSoft: 0.12,
  cloudSoft: 0.26,
  /** Softness of the vegetation line, in units of the normalised land rank. */
  vegSoft: 0.1,
  /**
   * Aerial haze over the whole disc, as a share of `atmosphereThickness`:
   * `hazeBase` everywhere plus `hazeLimb` more toward the edge.
   *
   * §9 asks for "brighter limb, more haze" and for the sky colour to go
   * butterscotch -> pale -> blue. Until Batch 11 both lived only in the limb
   * glow, whose `(1 - z)^2` weight is near zero over most of the disc - so
   * from year ~940 on, while the sky channel travelled from grey to blue, the
   * middle of the planet did not change at all. The golden frames quarantined
   * that stretch as a pacing problem; it was this.
   *
   * Measured on the golden frames (see the Batch 11 note): 0.15/0.20 takes
   * the three quarantined steps from 0.0094/0.0083/0.0042 to
   * 0.0182/0.0120/0.0110, all past `VISIBLE_STEP`. Stronger haze buys a
   * little more there and starts bleaching the late frames.
   */
  hazeBase: 0.15,
  hazeLimb: 0.2,
  /** How much haze the night side still scatters, relative to the day side. */
  hazeNight: 0.3,
} as const;

interface Colour {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Ground truth for the surface, before any channel tints it. */
export const GROUND = {
  rock: { r: 0.46, g: 0.24, b: 0.15 },
  rockHigh: { r: 0.72, g: 0.49, b: 0.34 },
  ocean: { r: 0.05, g: 0.17, b: 0.35 },
  oceanShallow: { r: 0.11, g: 0.35, b: 0.52 },
  vegetation: { r: 0.18, g: 0.38, b: 0.15 },
  vegetationLush: { r: 0.12, g: 0.46, b: 0.12 },
  ice: { r: 0.93, g: 0.95, b: 0.99 },
  dust: { r: 0.72, g: 0.5, b: 0.28 },
  space: { r: 0.02, g: 0.02, b: 0.035 },
} as const;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span === 0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / span);
  return t * t * (3 - 2 * t);
}

function mix(a: Colour, b: Colour, t: number): Colour {
  const k = clamp01(t);
  return { r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k };
}

const LIGHT_LEN = Math.hypot(SCENE.lightX, SCENE.lightY, SCENE.lightZ);
const LX = SCENE.lightX / LIGHT_LEN;
const LY = SCENE.lightY / LIGHT_LEN;
const LZ = SCENE.lightZ / LIGHT_LEN;

/**
 * The four noise fields, as functions of a point on the unit sphere in PLANET
 * space (y is the pole).
 *
 * Named and exported so the GPU globe (`src/web/globe.ts`, via
 * `globe-shader.ts`) and this renderer are built from one definition: the
 * shader is a port of exactly these, and `sphereCdf` ranks them.
 */
export { elevationField };

export function cloudFieldAt(x: number, y: number, z: number): number {
  return fbm(x * SCENE.cloudFreq + 11.3, y * SCENE.cloudFreq, z * SCENE.cloudFreq - 5.7, 3);
}

/**
 * The GPU globe's cloud field: the same base frequency and offset as
 * `cloudFieldAt`, but six octaves instead of three, pulled into swirls by a
 * low-frequency domain warp. Globe only - the software renderer and the golden
 * frames keep `cloudFieldAt`. The globe ranks THIS function through its own
 * sphere CDF, so the cloud channel still covers exactly its share.
 */
export const CLOUD_WARP = { freq: 0.7, strength: 1.4, octaves: 6 } as const;

export function cloudFieldHighAt(x: number, y: number, z: number): number {
  const f = SCENE.cloudFreq;
  const qx = x * f + 11.3;
  const qy = y * f;
  const qz = z * f - 5.7;
  const w = CLOUD_WARP.freq;
  const wx = fbm(qx * w + 1.7, qy * w + 9.2, qz * w, 3) - 0.5;
  const wy = fbm(qx * w + 8.3, qy * w + 2.8, qz * w + 4.1, 3) - 0.5;
  const wz = fbm(qx * w - 3.6, qy * w + 7.4, qz * w - 1.9, 3) - 0.5;
  const s = CLOUD_WARP.strength;
  return fbm(qx + s * wx, qy + s * wy, qz + s * wz, CLOUD_WARP.octaves);
}

export function capWobbleAt(x: number, y: number, z: number): number {
  return (valueNoise(x * SCENE.capEdgeFreq, y * SCENE.capEdgeFreq, z * SCENE.capEdgeFreq) - 0.5) * 0.11;
}

export function dustHazeAt(x: number, y: number, z: number): number {
  return valueNoise(x * 1.9 + 3.1, y * 1.9, z * 1.9) * 0.4 + 0.6;
}

/** Build the camera-dependent fields. Expensive; do it once per camera. */
export function createScene(options: RenderOptions): PlanetScene {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const spin = options.spin ?? 0;
  const discScale = options.discScale ?? 0.38;

  const count = width * height;
  const scene: PlanetScene = {
    width,
    height,
    kind: new Uint8Array(count),
    halo: new Float32Array(count),
    depth: new Float32Array(count),
    latitude: new Float32Array(count),
    elevation: new Float32Array(count),
    cloudField: new Float32Array(count),
    capWobble: new Float32Array(count),
    dustHaze: new Float32Array(count),
    light: new Float32Array(count),
  };

  const radius = Math.min(width, height) * discScale;
  const cx = width / 2;
  const cy = height / 2;
  const cosSpin = Math.cos(spin * Math.PI * 2);
  const sinSpin = Math.sin(spin * Math.PI * 2);
  const cosTilt = Math.cos(SCENE.tilt);
  const sinTilt = Math.sin(SCENE.tilt);
  const haloOuter = 1 + SCENE.haloWidth;

  for (let py = 0; py < height; py += 1) {
    const ny = (py + 0.5 - cy) / radius;
    for (let px = 0; px < width; px += 1) {
      const nx = (px + 0.5 - cx) / radius;
      const r2 = nx * nx + ny * ny;
      const i = py * width + px;

      if (r2 > haloOuter * haloOuter) {
        scene.kind[i] = KIND_SPACE;
        continue;
      }
      if (r2 > 1) {
        const falloff = smoothstep(haloOuter, 1, Math.sqrt(r2));
        scene.kind[i] = KIND_HALO;
        scene.halo[i] = falloff * falloff * 0.85;
        continue;
      }

      const z = Math.sqrt(1 - r2);
      // Screen y grows downward; the sphere's does not.
      const sy = -ny;

      // View space -> planet space. Tilt the pole toward the camera first, then
      // spin about the tilted polar axis, so spinning the globe does not also
      // rock it. Lighting stays in view space: the sun does not tilt with the
      // planet.
      const worldY = sy * cosTilt + z * sinTilt;
      const worldZ = -sy * sinTilt + z * cosTilt;
      const dx = nx * cosSpin + worldZ * sinSpin;
      const dz = -nx * sinSpin + worldZ * cosSpin;

      scene.kind[i] = KIND_DISC;
      scene.depth[i] = z;
      scene.latitude[i] = Math.abs(Math.asin(Math.max(-1, Math.min(1, worldY))));
      scene.elevation[i] = elevationField(dx, worldY, dz);
      scene.cloudField[i] = cloudFieldAt(dx, worldY, dz);
      scene.capWobble[i] = capWobbleAt(dx, worldY, dz);
      scene.dustHaze[i] = dustHazeAt(dx, worldY, dz);
      scene.light[i] = SCENE.ambient + (1 - SCENE.ambient) * Math.max(0, nx * LX + sy * LY + z * LZ);
    }
  }

  // Both fields get thresholded against a COVERAGE channel, so both have to be
  // uniformly distributed or the coverage will not match the channel.
  rankTransform(scene.elevation, scene.kind);
  rankTransform(scene.cloudField, scene.kind);

  return scene;
}

/**
 * Replace each visible value by its rank among the visible values, scaled to
 * 0..1 - so the field becomes exactly uniform over the disc.
 *
 * This is what makes coverage channels honest. Thresholding a field at `c`
 * covers `c` of the surface only if the field is uniform, and fractal noise is
 * emphatically not: `fbm` piles up hard around 0.5. An analytic sine-warp was
 * tried first and was not enough - thresholding the warped field at 0.36 still
 * covered only 18.6% of the disc, so every coverage channel read at about half
 * strength, and no exponent fixes the tails.
 *
 * Ranking measures the distribution instead of assuming one, so it is exact
 * rather than approximate, and it costs one sort per scene rather than per
 * frame. It is deterministic: same inputs, same ranks, same pixels.
 */
function rankTransform(field: Float32Array, kind: Uint8Array): void {
  const indices: number[] = [];
  for (let i = 0; i < kind.length; i += 1) if (kind[i] === KIND_DISC) indices.push(i);
  if (indices.length < 2) return;

  indices.sort((a, b) => (field[a] ?? 0) - (field[b] ?? 0));
  const last = indices.length - 1;
  for (let r = 0; r <= last; r += 1) {
    const i = indices[r];
    if (i !== undefined) field[i] = r / last;
  }
}

/** Composite one set of channels over a prepared scene. Cheap; do it per frame. */
export function renderScene(scene: PlanetScene, channels: VisualChannels): Frame {
  const { width, height } = scene;
  const pixels = new Uint8ClampedArray(width * height * 4);

  const cap = clamp01(channels.capRadius);
  const ocean = clamp01(channels.oceanCoverage);
  const green = clamp01(channels.surfaceGreen);
  const cloud = clamp01(channels.cloudCover);
  const dust = clamp01(channels.dustIntensity);
  const air = clamp01(channels.atmosphereThickness);
  const sky = channels.skyColour;
  const tint = channels.surfaceTint;

  // The cap edge as a latitude: capRadius is a fraction of a quarter turn from
  // the pole, so a radius of 1 reaches the equator.
  const capEdgeLat = (Math.PI / 2) * (1 - cap);

  /**
   * Greenness is a fraction of the whole SURFACE, so how much of the LAND it
   * has to cover depends on how much land there is. Thresholding on the raw
   * channel made the mapping saturate at about 0.67 - a tenth of a channel
   * moved the image by 0.0002 there, which is precisely the "cosmetic
   * terraforming" §0.3 warns about.
   */
  const landFraction = Math.max(1 - ocean, 1e-3);
  const landCoverage = clamp01(green / landFraction);
  // Past full coverage the colour keeps deepening, so the channel still reads
  // even when there is no bare ground left to take.
  const lushness = clamp01(green / landFraction - 1 + 0.35);

  const cloudThreshold = 1 - cloud;

  for (let i = 0; i < scene.kind.length; i += 1) {
    const offset = i * 4;
    const kind = scene.kind[i];

    if (kind === KIND_SPACE) {
      writePixel(pixels, offset, GROUND.space);
      continue;
    }

    if (kind === KIND_HALO) {
      const strength = air * (scene.halo[i] ?? 0);
      writePixel(pixels, offset, {
        r: GROUND.space.r + sky.r * strength,
        g: GROUND.space.g + sky.g * strength,
        b: GROUND.space.b + sky.b * strength,
      });
      continue;
    }

    const z = scene.depth[i] ?? 0;
    const elevation = scene.elevation[i] ?? 0;
    const lit = scene.light[i] ?? 0;

    // Water fills the low ground first, which is §9's "fills basins from low
    // elevation up" without needing a heightmap the model does not have.
    const oceanMask = 1 - smoothstep(ocean - SCENE.shoreSoft, ocean + SCENE.shoreSoft, elevation);
    const depth = clamp01((ocean - elevation) * 3);

    /**
     * Vegetation spreads from the water's edge - so it takes the LOWEST land
     * first, and `landRank` is how high this pixel sits within the land band.
     *
     * Ranking by elevation rather than by distance-above-water is what makes
     * the channel linear: `rankTransform` leaves elevation exactly uniform, so
     * thresholding the rank at `c` covers `c` of the land. The exponential
     * proximity field this replaced was clustered hard near zero, and green
     * moved the image 7x faster in its middle than at either end.
     */
    const landRank = clamp01((elevation - ocean) / Math.max(1 - ocean, 1e-3));
    const vegMask =
      (1 - oceanMask) * (1 - smoothstep(landCoverage - SCENE.vegSoft, landCoverage + SCENE.vegSoft, landRank));

    const capMask =
      cap <= 0
        ? 0
        : smoothstep(
            capEdgeLat - SCENE.capSoft,
            capEdgeLat + SCENE.capSoft,
            (scene.latitude[i] ?? 0) + (scene.capWobble[i] ?? 0),
          );

    let surface = mix(GROUND.rock, GROUND.rockHigh, smoothstep(ocean, 1, elevation));
    surface = mix(surface, mix(GROUND.vegetation, GROUND.vegetationLush, lushness), vegMask);
    surface = mix(surface, mix(GROUND.oceanShallow, GROUND.ocean, depth), oceanMask);
    surface = mix(surface, GROUND.ice, capMask);

    // §9's surface warmth tint, applied multiplicatively so the ground's own
    // colour shows through rather than being replaced by it.
    surface = { r: surface.r * tint.r * lit, g: surface.g * tint.g * lit, b: surface.b * tint.b * lit };

    if (cloud > 0) {
      // Centred on the threshold, like the shoreline. One-sided, the softness
      // ate the whole band at low cover and the first 15% of the channel drew
      // nothing at all.
      const cloudMask = smoothstep(
        cloudThreshold - SCENE.cloudSoft,
        cloudThreshold + SCENE.cloudSoft,
        scene.cloudField[i] ?? 0,
      );
      const shade = 0.78 + 0.2 * lit;
      // Never fully opaque. At Earth's ~60% cover a fully opaque cloud layer
      // buries the planet - the oceans and greenery have to read THROUGH it,
      // and the mask already thins toward each cloud's edge.
      surface = mix(surface, { r: shade, g: shade * 0.99, b: shade * 0.97 }, cloudMask * 0.7);
    }

    if (dust > 0) {
      const haze = scene.dustHaze[i] ?? 0;
      surface = mix(
        surface,
        { r: GROUND.dust.r * lit, g: GROUND.dust.g * lit, b: GROUND.dust.b * lit },
        dust * haze * 0.72,
      );
    }

    /**
     * Haze: sunlight the air scatters toward the camera, in the sky's colour.
     *
     * ADDED, not mixed. A mix veils the ground by the same amount it adds
     * sky, and the ecopoiesis step (frames 3->4, the greening) only clears
     * `VISIBLE_STEP` by 14%: mixing enough haze to show the late sky pushed
     * it to 0.0091 and failed it. In-scatter adds light without taking the
     * surface's contrast away, so on the mid-run fixture `planet.test.ts`
     * uses, every channel's response is exactly what it was.
     *
     * NOT everywhere (Batch 13's review): added light can pass 1.0, and the
     * brightest late-game pixels clip - 8.2% of the disc on frame 8 and 11.6%
     * on frame 11, against 3.2% and 4.7% with no haze - costing the cap
     * channel 10-14% of its response there. A screen blend was measured and
     * rejected: it halves the clipping but damps EVERY change beneath it
     * (cloud 0.0114 -> 0.0105, planet stall 31.1 -> 33.3 min, the smallest
     * golden step down to 0.0101). Clipping loses a little in the brightest
     * pixels; screening loses more, everywhere.
     */
    const haze = air * (SCENE.hazeBase + SCENE.hazeLimb * (1 - z));
    const hazeLight = haze * (SCENE.hazeNight + (1 - SCENE.hazeNight) * lit);
    surface = {
      r: surface.r + sky.r * hazeLight,
      g: surface.g + sky.g * hazeLight,
      b: surface.b + sky.b * hazeLight,
    };

    // Atmosphere over the disc: strongest at the limb, where the line of sight
    // passes through the most air. Same quantity as the halo outside the disc,
    // so the two meet without a seam.
    const limb = (1 - z) * (1 - z);
    const glow = air * limb * 0.9;
    writePixel(pixels, offset, {
      r: surface.r + sky.r * glow,
      g: surface.g + sky.g * glow,
      b: surface.b + sky.b * glow,
    });
  }

  return { width, height, pixels };
}

/** Convenience: build a scene and render it once. */
export function renderPlanet(channels: VisualChannels, options: RenderOptions): Frame {
  return renderScene(createScene(options), channels);
}

function writePixel(pixels: Uint8ClampedArray, offset: number, colour: Colour): void {
  pixels[offset] = Math.round(clamp01(colour.r) * 255);
  pixels[offset + 1] = Math.round(clamp01(colour.g) * 255);
  pixels[offset + 2] = Math.round(clamp01(colour.b) * 255);
  pixels[offset + 3] = 255;
}

/** Mean absolute per-channel difference between two frames, 0..1. */
export function frameDifference(a: Frame, b: Frame): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new RangeError(`frames differ in size: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let total = 0;
  let counted = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      total += Math.abs((a.pixels[i + c] ?? 0) - (b.pixels[i + c] ?? 0));
      counted += 1;
    }
  }
  return counted === 0 ? 0 : total / counted / 255;
}
