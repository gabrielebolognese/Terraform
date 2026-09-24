/**
 * The planet as a WebGL2 fragment shader: the full-screen, rotatable globe.
 *
 * A PORT of `planet.ts`, not a second design. Same noise (the integer hash is
 * reproduced bit for bit in `uint` arithmetic), the same fields (clouds use
 * `cloudFieldHighAt`, a six-octave warped version of `cloudFieldAt`), same
 * GROUND colours, same SCENE constants, same compositing order - surface,
 * warmth tint and light, clouds, dust, in-scattered haze, limb glow. The
 * constants are written INTO the source from `planet.ts`, so the two cannot
 * drift apart by someone editing one of them.
 *
 * What it adds, all of it presentation rather than contract:
 * - resolution: every pixel shaded at display resolution, not 128-260 px;
 * - relief: a high-frequency detail field lights the land as bumps, and
 *   roughens rock colour and coastlines;
 * - sun glint on open water;
 * - swirled, six-octave clouds with sharp edges, thick bright cores and
 *   wispy margins, drifting slowly over the ground;
 * - a starfield and faint nebula behind the planet, and an atmosphere rim
 *   brighter on the sunlit side.
 *
 * Coverage stays honest: the elevation and cloud fields are mapped through
 * their sphere CDFs (`sphere-cdf.ts`), which is this shader's version of the
 * software renderer's rank transform. The golden frames still pin
 * `planet.ts`; they cannot run this, so the parity is by construction.
 *
 * Pure strings - no DOM, compiled against the renderer's no-DOM lib like the
 * rest of `src/render/`. `src/web/globe.ts` does the GL plumbing.
 */

import { CLOUD_WARP, GROUND, SCENE } from "./planet.js";

/** Number of entries in each CDF texture. */
export const CDF_BINS = 1024;

function f(x: number): string {
  const s = x.toString();
  return s.includes(".") || s.includes("e") ? s : `${s}.0`;
}

function v3(c: { readonly r: number; readonly g: number; readonly b: number }): string {
  return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
}

/**
 * The shader's `toPlanet`, in TypeScript: which planet point a view-space
 * direction lands on, for a given yaw and pitch.
 *
 * The spin angle is -yaw so that INCREASING yaw carries the surface to the
 * RIGHT. The first version spun by +yaw, which carried it left, and since a
 * drag to the right increases yaw, the planet turned against the hand.
 * `orbit.test.ts` holds this to "the surface follows the cursor".
 */
export function toPlanetJs(
  v: readonly [number, number, number],
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cT = Math.cos(pitch);
  const sT = Math.sin(pitch);
  const cS = Math.cos(-yaw);
  const sS = Math.sin(-yaw);
  const wy = v[1] * cT + v[2] * sT;
  const wz = -v[1] * sT + v[2] * cT;
  return [v[0] * cS + wz * sS, wy, -v[0] * sS + wz * cS];
}

/**
 * The inverse of `toPlanetJs`: where a planet-space point sits in view space
 * (x right, y up, z toward the viewer). Undo the spin, then the tilt. Batch 17
 * places settlement markers with it; `globe-geometry.test.ts` holds it to
 * being the exact inverse.
 */
export function toViewJs(
  p: readonly [number, number, number],
  yaw: number,
  pitch: number,
): [number, number, number] {
  const cS = Math.cos(-yaw);
  const sS = Math.sin(-yaw);
  // Undo the spin about y: toPlanet did x' = x cS + wz sS, z' = -x sS + wz cS.
  const x = p[0] * cS - p[2] * sS;
  const wz = p[0] * sS + p[2] * cS;
  const wy = p[1];
  // Undo the tilt about x: toPlanet did wy = y cT + z sT, wz = -y sT + z cT.
  const cT = Math.cos(pitch);
  const sT = Math.sin(pitch);
  return [x, wy * cT - wz * sT, wy * sT + wz * cT];
}

export const GLOBE_VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const GLOBE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

out vec4 outColor;

uniform vec2 uResolution;   // device pixels
uniform vec2 uCenter;       // device pixels, origin bottom-left
uniform float uRadius;      // device pixels
uniform float uPixelRatio;
uniform float uYaw;
uniform float uPitch;
uniform float uTime;

uniform float uCap;
uniform float uOcean;
uniform float uGreen;
uniform float uCloud;
uniform float uDust;
uniform float uAir;
uniform vec3 uSky;
uniform vec3 uTint;

uniform sampler2D uElevCdf;
uniform sampler2D uCloudCdf;

// ---- constants, written in from planet.ts -------------------------------
const float AMBIENT = ${f(SCENE.ambient)};
const float HALO_WIDTH = ${f(SCENE.haloWidth)};
const float ELEV_FREQ = ${f(SCENE.elevationFreq)};
const float CLOUD_FREQ = ${f(SCENE.cloudFreq)};
const float CAP_FREQ = ${f(SCENE.capEdgeFreq)};
const float SHORE_SOFT = ${f(SCENE.shoreSoft)};
const float CAP_SOFT = ${f(SCENE.capSoft)};
const float VEG_SOFT = ${f(SCENE.vegSoft)};
const float HAZE_BASE = ${f(SCENE.hazeBase)};
const float HAZE_LIMB = ${f(SCENE.hazeLimb)};
const float HAZE_NIGHT = ${f(SCENE.hazeNight)};
const vec3 LIGHT = normalize(vec3(${f(SCENE.lightX)}, ${f(SCENE.lightY)}, ${f(SCENE.lightZ)}));

const vec3 ROCK = ${v3(GROUND.rock)};
const vec3 ROCK_HIGH = ${v3(GROUND.rockHigh)};
const vec3 OCEAN = ${v3(GROUND.ocean)};
const vec3 OCEAN_SHALLOW = ${v3(GROUND.oceanShallow)};
const vec3 VEG = ${v3(GROUND.vegetation)};
const vec3 VEG_LUSH = ${v3(GROUND.vegetationLush)};
const vec3 ICE = ${v3(GROUND.ice)};
const vec3 DUST = ${v3(GROUND.dust)};
const vec3 SPACE = ${v3(GROUND.space)};

// ---- presentation only: not in the software renderer ---------------------
const float DETAIL_FREQ = ${f(SCENE.elevationFreq * 7)};
const float COAST_DETAIL = 0.022;     // coastline roughness, in rank units
const float BUMP = 0.9;               // relief strength on land
const float CLOUD_DRIFT = 0.012;      // radians per second relative to the ground
const float CLOUD_WARP_FREQ = ${f(CLOUD_WARP.freq)};
const float CLOUD_WARP_STRENGTH = ${f(CLOUD_WARP.strength)};
const int CLOUD_OCTAVES = ${CLOUD_WARP.octaves};
// Edge softness of the globe's clouds, in rank units. Much sharper than
// CLOUD_SOFT, which was chosen for a 128 px frame; at full resolution that
// softness read as fog. Still symmetric about the threshold, so the covered
// share is unchanged.
const float CLOUD_EDGE = 0.06;
const int CDF_LAST = ${CDF_BINS - 1};

// ---- noise.ts, ported ------------------------------------------------------
// hash3 in noise.ts is Math.imul arithmetic, i.e. multiplication modulo 2^32:
// exactly what uint multiplication does here.
float hash3(ivec3 c) {
  uint x = uint(c.x);
  uint y = uint(c.y);
  uint z = uint(c.z);
  uint h = (x * 374761393u) ^ (y * 668265263u) ^ (z * 1103515245u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}

float fade(float t) { return t * t * (3.0 - 2.0 * t); }

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  ivec3 c = ivec3(i);
  vec3 fr = p - i;
  vec3 u = vec3(fade(fr.x), fade(fr.y), fade(fr.z));
  float c000 = hash3(c);
  float c100 = hash3(c + ivec3(1, 0, 0));
  float c010 = hash3(c + ivec3(0, 1, 0));
  float c110 = hash3(c + ivec3(1, 1, 0));
  float c001 = hash3(c + ivec3(0, 0, 1));
  float c101 = hash3(c + ivec3(1, 0, 1));
  float c011 = hash3(c + ivec3(0, 1, 1));
  float c111 = hash3(c + ivec3(1, 1, 1));
  float x00 = mix(c000, c100, u.x);
  float x10 = mix(c010, c110, u.x);
  float x01 = mix(c001, c101, u.x);
  float x11 = mix(c011, c111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amplitude = 1.0;
  float total = 0.0;
  float frequency = 1.0;
  for (int k = 0; k < 8; k++) {
    if (k >= octaves) break;
    sum += valueNoise(p * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / total;
}

// ---- the fields of planet.ts ----------------------------------------------
// Elevation, cap wobble and dust haze are ported exactly. Clouds use
// cloudFieldHighAt (below), the globe's richer version of cloudFieldAt.
float elevationField(vec3 p) { return fbm(p * ELEV_FREQ, 4); }
float capWobble(vec3 p) { return (valueNoise(p * CAP_FREQ) - 0.5) * 0.11; }
float dustHaze(vec3 p) { return valueNoise(vec3(p.x * 1.9 + 3.1, p.y * 1.9, p.z * 1.9)) * 0.4 + 0.6; }
float detailField(vec3 p) { return fbm(p * DETAIL_FREQ + vec3(31.7, -4.1, 12.9), 5); }

// planet.ts cloudFieldHighAt, ported: a warped six-octave field.
float cloudFieldHigh(vec3 p) {
  vec3 q = vec3(p.x * CLOUD_FREQ + 11.3, p.y * CLOUD_FREQ, p.z * CLOUD_FREQ - 5.7);
  vec3 qw = q * CLOUD_WARP_FREQ;
  vec3 w = vec3(
    fbm(qw + vec3(1.7, 9.2, 0.0), 3),
    fbm(qw + vec3(8.3, 2.8, 4.1), 3),
    fbm(qw + vec3(-3.6, 7.4, -1.9), 3)
  ) - 0.5;
  return fbm(q + CLOUD_WARP_STRENGTH * w, CLOUD_OCTAVES);
}

float cdf(sampler2D table, float value) {
  float v = clamp(value, 0.0, 1.0) * float(CDF_LAST);
  int i = int(floor(v));
  float a = texelFetch(table, ivec2(i, 0), 0).r;
  float b = texelFetch(table, ivec2(min(i + 1, CDF_LAST), 0), 0).r;
  return mix(a, b, v - float(i));
}

// View space -> planet space: tilt the pole toward the camera, then spin
// about it - the same order as createScene in planet.ts. The spin is -uYaw:
// see \`toPlanetJs\` at the top of globe-shader.ts, which is this function in TypeScript and pins the
// direction with a test.
vec3 toPlanet(vec3 v) {
  float cT = cos(uPitch), sT = sin(uPitch);
  float cS = cos(-uYaw), sS = sin(-uYaw);
  float wy = v.y * cT + v.z * sT;
  float wz = -v.y * sT + v.z * cT;
  return vec3(v.x * cS + wz * sS, wy, -v.x * sS + wz * cS);
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// ---- the sky behind it ---------------------------------------------------
float starLayer(vec2 px, float cell, float density, float seed) {
  vec2 g = px / cell;
  ivec2 id = ivec2(floor(g));
  float present = hash3(ivec3(id, int(seed)));
  if (present > density) return 0.0;
  vec2 pos = vec2(hash3(ivec3(id, int(seed) + 1)), hash3(ivec3(id, int(seed) + 2)));
  vec2 d = (fract(g) - pos) * cell;
  float size = 0.55 * uPixelRatio;
  float brightness = pow(hash3(ivec3(id, int(seed) + 3)), 3.0);
  return brightness * exp(-dot(d, d) / (2.0 * size * size));
}

vec3 sky(vec2 px) {
  vec3 col = SPACE;
  vec2 uv = px / max(uResolution.x, uResolution.y);
  float neb = fbm(vec3(uv * 2.2, 4.0), 4);
  col += vec3(0.05, 0.03, 0.07) * smoothstep(0.45, 0.85, neb);
  col += vec3(0.02, 0.035, 0.05) * smoothstep(0.5, 0.9, fbm(vec3(uv * 3.1 + 9.0, 1.0), 3));
  float stars = starLayer(px, 3.2 * uPixelRatio, 0.035, 11.0) + 1.6 * starLayer(px, 9.0 * uPixelRatio, 0.05, 23.0);
  vec3 tint = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), hash3(ivec3(ivec2(px / (3.2 * uPixelRatio)), 5)));
  return col + tint * stars;
}

// ---- the planet ------------------------------------------------------------
vec3 surfaceAt(vec2 d, float r2) {
  float z = sqrt(max(0.0, 1.0 - r2));
  vec3 nView = vec3(d, z);
  vec3 p = toPlanet(nView);
  vec3 lightP = toPlanet(LIGHT);
  vec3 viewP = toPlanet(vec3(0.0, 0.0, 1.0));

  float ocean = clamp(uOcean, 0.0, 1.0);
  float green = clamp(uGreen, 0.0, 1.0);
  float cloud = clamp(uCloud, 0.0, 1.0);
  float dust = clamp(uDust, 0.0, 1.0);
  float air = clamp(uAir, 0.0, 1.0);
  float cap = clamp(uCap, 0.0, 1.0);

  float detail = detailField(p);
  float elevation = cdf(uElevCdf, elevationField(p)) + (detail - 0.5) * COAST_DETAIL;

  float oceanMask = 1.0 - smoothstep(ocean - SHORE_SOFT, ocean + SHORE_SOFT, elevation);
  float depth = clamp((ocean - elevation) * 3.0, 0.0, 1.0);

  float landFraction = max(1.0 - ocean, 1e-3);
  float landCoverage = clamp(green / landFraction, 0.0, 1.0);
  float lushness = clamp(green / landFraction - 1.0 + 0.35, 0.0, 1.0);
  float landRank = clamp((elevation - ocean) / max(1.0 - ocean, 1e-3), 0.0, 1.0);
  float vegMask = (1.0 - oceanMask) * (1.0 - smoothstep(landCoverage - VEG_SOFT, landCoverage + VEG_SOFT, landRank));

  float capEdgeLat = 1.5707963 * (1.0 - cap);
  float latitude = asin(clamp(abs(p.y), 0.0, 1.0));
  float capMask = cap <= 0.0 ? 0.0 : smoothstep(capEdgeLat - CAP_SOFT, capEdgeLat + CAP_SOFT, latitude + capWobble(p));

  // Relief: light the land as if the detail field were height. Finite
  // differences along two tangents, in planet space.
  vec3 t1 = normalize(abs(p.y) > 0.98 ? cross(vec3(1.0, 0.0, 0.0), p) : cross(vec3(0.0, 1.0, 0.0), p));
  vec3 t2 = cross(p, t1);
  float eps = 0.004;
  float gx = (detailField(normalize(p + t1 * eps)) - detail) / eps;
  float gy = (detailField(normalize(p + t2 * eps)) - detail) / eps;
  float relief = BUMP * (1.0 - oceanMask) * (1.0 - capMask);
  vec3 nBump = normalize(p - relief * 0.018 * (gx * t1 + gy * t2));

  float litSmooth = AMBIENT + (1.0 - AMBIENT) * max(0.0, dot(p, lightP));
  float lit = AMBIENT + (1.0 - AMBIENT) * max(0.0, dot(nBump, lightP));

  vec3 rock = mix(ROCK, ROCK_HIGH, smoothstep(ocean, 1.0, elevation)) * (0.88 + 0.24 * detail);
  vec3 surface = rock;
  surface = mix(surface, mix(VEG, VEG_LUSH, lushness) * (0.9 + 0.2 * detail), vegMask);
  surface = mix(surface, mix(OCEAN_SHALLOW, OCEAN, depth), oceanMask);
  surface = mix(surface, ICE, capMask);

  surface = surface * uTint * lit;

  // Sun glint on open water.
  vec3 halfway = normalize(lightP + viewP);
  float glint = pow(max(dot(p, halfway), 0.0), 90.0) * 0.6 * oceanMask * (1.0 - capMask) * step(0.0, dot(p, lightP));
  surface += vec3(1.0, 0.96, 0.88) * glint;

  if (cloud > 0.0) {
    vec3 pc = rotateY(p, uTime * CLOUD_DRIFT);
    float field = cdf(uCloudCdf, cloudFieldHigh(pc));
    float threshold = 1.0 - cloud;
    // Coverage: a sharp, symmetric edge, so exactly \`cloud\` of the sphere is inside.
    float cloudMask = smoothstep(threshold - CLOUD_EDGE, threshold + CLOUD_EDGE, field);
    // Body: how far inside the cloud this point is. Cores are thick and
    // bright, edges thin and broken up into wisps by fine noise.
    float thickness = clamp((field - threshold) / 0.22, 0.0, 1.0);
    float wisp = fbm(pc * 28.0 + vec3(3.3, 1.1, -7.7), 3);
    float opacity = cloudMask * mix(0.45 + 0.4 * wisp, 0.93, thickness);
    float cloudLight = AMBIENT + (1.0 - AMBIENT) * max(0.0, dot(p, lightP));
    vec3 cloudColour = vec3(0.97, 0.97, 0.96) * mix(0.8, 1.0, thickness) * (0.35 + 0.65 * cloudLight);
    surface = mix(surface, cloudColour, opacity);
  }

  if (dust > 0.0) {
    surface = mix(surface, DUST * litSmooth, dust * dustHaze(p) * 0.72);
  }

  float haze = air * (HAZE_BASE + HAZE_LIMB * (1.0 - z));
  surface += uSky * haze * (HAZE_NIGHT + (1.0 - HAZE_NIGHT) * litSmooth);

  float limb = (1.0 - z) * (1.0 - z);
  surface += uSky * air * limb * 0.9;
  return surface;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 d = (px - uCenter) / uRadius;
  float r2 = dot(d, d);
  float r = sqrt(r2);

  vec3 col = sky(px);

  // Atmosphere past the disc - planet.ts's halo, brighter on the sunlit limb.
  float haloOuter = 1.0 + HALO_WIDTH;
  if (r > 1.0 && r < haloOuter) {
    float falloff = 1.0 - smoothstep(1.0, haloOuter, r);
    float sunward = 0.45 + 0.55 * max(0.0, dot(normalize(d), normalize(LIGHT.xy)));
    col += uSky * clamp(uAir, 0.0, 1.0) * falloff * falloff * 0.85 * sunward;
  }

  // The disc, with its edge antialiased over about one device pixel.
  float edge = 1.0 - smoothstep(1.0 - 1.5 / uRadius, 1.0, r);
  if (edge > 0.0) {
    col = mix(col, surfaceAt(d, min(r2, 1.0)), edge);
  }

  // Dither away the banding a smooth dark gradient shows at 8 bits.
  col += (hash3(ivec3(ivec2(px), 97)) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
