/**
 * Design doc §9 - the visualization contract.
 *
 * "The renderer reads only these derived channels. This is the wall between
 * simulation and graphics: change the sim internals freely as long as this
 * contract holds, and the city layer later reads the same channels."
 *
 * THE LOAD-BEARING PROPERTY IS THAT `phase` IS NOT AN INPUT HERE.
 *
 * §9: "All of these are continuous functions of continuous state, which is what
 * makes the growth look slow and alive rather than snapping between discrete
 * looks at phase boundaries. Phases change tech and UI; the visuals move
 * continuously underneath them."
 *
 * That is also the fix for the failure mode §0.3 names - Per Aspera's
 * terraforming reading as "colored keys" gating progress while the planet
 * barely changes. The moment a channel branches on phase, the planet starts
 * snapping between looks and the whole contract is decorative. Nothing in this
 * file imports `Phase`, and `boundary.test.ts` enforces that.
 *
 * Colours are VALUES, not strings. A renderer should not be parsing `#rrggbb`
 * to interpolate, and a test should not be asserting on text.
 */

import { clamp01, lerp, quarterTurns, safeDiv, saturating } from "./math.js";
import type { Tuning } from "./tuning.js";
import type { Derived, Flow, Reservoirs } from "./types.js";

/** Linear RGB, each component 0..1. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface VisualChannels {
  /**
   * Angular radius of each polar cap, as a fraction of a quarter turn.
   * 0 is no cap, 1 is a cap reaching the equator.
   */
  readonly capRadius: number;
  /** Fraction of the surface under liquid water. */
  readonly oceanCoverage: number;
  /** Fraction of the surface greened. */
  readonly surfaceGreen: number;
  /** Limb brightness and haze, 0..1. */
  readonly atmosphereThickness: number;
  /** Butterscotch -> pale -> blue, fading toward vacuum as the air thins. */
  readonly skyColour: Rgb;
  /** Cloud layer opacity and extent, 0..1. */
  readonly cloudCover: number;
  /** Frost-blue when cold, warm-neutral when temperate. */
  readonly surfaceTint: Rgb;
  /** Particle and haze bursts, 0..1. Peaks during rapid thickening. */
  readonly dustIntensity: number;
  /**
   * Fraction of the atmosphere that is clear gas rather than dusty CO2 and
   * vapour. Exposed because it drives the sky and a renderer may want it for
   * scattering as well.
   */
  readonly clearFraction: number;
}

/**
 * Art direction, deliberately NOT in `src/sim/tuning.ts`.
 *
 * Cross-batch invariant #4 puts every tunable number in the balance table, and
 * these are not tunable in that sense: the balance sweep varies constants to
 * change how the game PLAYS, and varying a sky colour to change a pacing score
 * would be meaningless. Keeping them out means the sweep cannot reach them,
 * which is the point. They are still all in one place.
 */
export const VISUAL_TUNING = Object.freeze({
  /** Pressure at which the limb reads about 63% of full brightness, mbar. */
  ATMO_VIS_REF: 300,
  /** CO2 release rate that saturates the dust channel, mbar/yr. */
  DUST_RELEASE_REF: 0.9,
  /** Temperature band over which the surface goes from frost to temperate, K. */
  TINT_COLD_K: 180,
  TINT_WARM_K: 295,
  /** Where the sky reads fully "pale" on the way from butterscotch to blue. */
  SKY_PALE_AT: 0.55,
  /**
   * Shape of the sky's response to the clear fraction: the sky position is
   * `1 - (1 - clearFraction)^SKY_CLEAR_GAMMA`. 1 is linear.
   *
   * Linear put the whole victory approach off screen. From year ~1500 to
   * Phase 6 the air goes from 6% CO2 to 1.4% - the atmosphere becoming
   * breathable, the change the progress bar spends its last 0.06 on - and
   * that is 0.943 -> 0.986 in clear fraction: the last 4% of the palette,
   * applied to a sky that was already 94% blue. Below 1 the curve spends
   * more of the palette on the dirty tail and less on the early mix, so the
   * sky reaches pale around year 1230 rather than 940 and is still visibly
   * clearing when the player wins.
   *
   * 0.45 is the measured value that clears every golden-frame step with
   * `SCENE.haze*` at 0.15/0.20; see the Batch 11 note. It is art direction:
   * a 5% CO2 sky and a 1% one would look alike to a real eye, and §0.3 asks
   * for the planet to show the change regardless.
   */
  SKY_CLEAR_GAMMA: 0.45,
  /** Below this much atmosphere the sky fades toward vacuum, mbar. */
  SKY_VACUUM_REF: 40,
});

/**
 * The palette, as linear RGB.
 *
 * §9 names three sky stops by colour word; these are those words, picked to
 * read as Mars-at-6-mbar, a thickening haze, and Earth.
 */
export const PALETTE = Object.freeze({
  /** Dusty CO2 - present-day Mars. */
  skyButterscotch: Object.freeze({ r: 0.78, g: 0.55, b: 0.32 }),
  /** The transitional haze of a thick, mixed atmosphere. */
  skyPale: Object.freeze({ r: 0.82, g: 0.79, b: 0.72 }),
  /** Clear O2/N2 - Rayleigh scattering. */
  skyBlue: Object.freeze({ r: 0.42, g: 0.6, b: 0.85 }),
  /** What is left when there is no air to scatter anything. */
  skyVacuum: Object.freeze({ r: 0.04, g: 0.04, b: 0.06 }),
  /** Surface under frost. */
  tintFrost: Object.freeze({ r: 0.72, g: 0.82, b: 0.95 }),
  /** Surface at temperate. Neutral, so the ground's own colour shows through. */
  tintTemperate: Object.freeze({ r: 1.0, g: 0.98, b: 0.94 }),
});

function mixRgb(a: Rgb, b: Rgb, tValue: number): Rgb {
  const k = clamp01(tValue);
  return { r: lerp(a.r, b.r, k), g: lerp(a.g, b.g, k), b: lerp(a.b, b.b, k) };
}

/**
 * Polar cap angular radius from the ice cover fraction.
 *
 * §9 asks for "cap radius scales with reservoir remaining", and `ice_frac`
 * already carries both reservoirs (`h2o_ice` and `co2_cap`). Turning a surface
 * FRACTION into a RADIUS is geometry, not a new mapping: two polar caps each
 * subtending angle θ cover `1 - cos θ` of the sphere between them, so the
 * radius is `acos(1 - f)` - which is exactly what a renderer wants and what a
 * second saturating curve invented here would only approximate.
 */
export function capRadiusFrom(iceFrac: number): number {
  return quarterTurns(Math.acos(1 - clamp01(iceFrac)));
}

/**
 * How much of the atmosphere is clear gas rather than dust-carrying CO2 and
 * water vapour. §9 drives the sky from exactly this.
 */
export function clearFractionOf(r: Reservoirs, d: Derived, t: Tuning): number {
  const clear = Math.max(0, r.n2) + Math.max(0, r.o2);
  return clamp01(safeDiv(clear, d.P, 0, t.P_EPS));
}

/**
 * Total CO2 outgassing, mbar/yr, read off the flows.
 *
 * This is why rate contributions are FLOWS carrying a `FlowId` rather than
 * per-reservoir net numbers: the dust channel needs the release specifically,
 * and a net rate on `co2_atm` would have the biosphere's uptake and the solar
 * wind's bleed already mixed into it.
 */
export function co2ReleaseRate(flows: readonly Flow[]): number {
  let rate = 0;
  for (const flow of flows) {
    if (flow.id === "co2.cap_sublimation" || flow.id === "co2.regolith_desorption") {
      rate += Math.max(0, flow.rate);
    }
  }
  return rate;
}

/**
 * The eight §9 channels.
 *
 * Deliberately NOT computed inside `tick`: a substep does not need them, and a
 * renderer reads at frame rate rather than substep rate. The caller decides
 * when it wants a frame's worth of visuals.
 */
export function deriveVisuals(
  r: Reservoirs,
  d: Derived,
  flows: readonly Flow[],
  t: Tuning,
  /**
   * Dust raised by a §12.2 weather event, 0..1, from `stormIntensity`.
   *
   * Passed in rather than derived here, deliberately. A storm is a function of
   * `(seed, simYear)`, and this module must not know about either: §9's
   * contract is that the channels are a function of WORLD STATE, and a seed is
   * not world state. The caller, which already has both, does that lookup.
   *
   * Defaulted so every existing call site - and every test written before
   * Batch 8 - keeps its exact meaning.
   */
  stormDust = 0,
): VisualChannels {
  const clearFraction = clearFractionOf(r, d, t);

  const atmosphereThickness = clamp01(saturating(d.P, 1, VISUAL_TUNING.ATMO_VIS_REF));

  // Butterscotch -> pale -> blue across the clear fraction, then faded toward
  // vacuum when there is barely any air. Without that second step a 6 mbar
  // Mars and a 6 mbar Mars with the dust removed would look equally skyful.
  const skyPosition = 1 - Math.pow(1 - clearFraction, VISUAL_TUNING.SKY_CLEAR_GAMMA);
  const composition =
    skyPosition <= VISUAL_TUNING.SKY_PALE_AT
      ? mixRgb(PALETTE.skyButterscotch, PALETTE.skyPale, skyPosition / VISUAL_TUNING.SKY_PALE_AT)
      : mixRgb(
          PALETTE.skyPale,
          PALETTE.skyBlue,
          (skyPosition - VISUAL_TUNING.SKY_PALE_AT) / (1 - VISUAL_TUNING.SKY_PALE_AT),
        );
  const airiness = clamp01(saturating(d.P, 1, VISUAL_TUNING.SKY_VACUUM_REF));
  const skyColour = mixRgb(PALETTE.skyVacuum, composition, airiness);

  const warmth = clamp01(
    (d.T - VISUAL_TUNING.TINT_COLD_K) / (VISUAL_TUNING.TINT_WARM_K - VISUAL_TUNING.TINT_COLD_K),
  );

  // Dust needs something to lift and somewhere dry to lift it from: rapid
  // outgassing over bare ground. An ocean-covered world does not raise a
  // global dust storm however fast its regolith is venting.
  //
  // A weather event lifts dust the same way and is damped by the same wet
  // ground, so the two go through one term rather than being summed after the
  // fact - otherwise a storm over a finished ocean world would still show.
  const lifted = clamp01(co2ReleaseRate(flows) / VISUAL_TUNING.DUST_RELEASE_REF) + clamp01(stormDust);
  const dustIntensity = clamp01(lifted) * (1 - clamp01(d.oceanFrac));

  return {
    capRadius: capRadiusFrom(d.iceFrac),
    oceanCoverage: clamp01(d.oceanFrac),
    surfaceGreen: clamp01(d.vegFrac),
    atmosphereThickness,
    skyColour,
    cloudCover: clamp01(d.cloudFrac),
    surfaceTint: mixRgb(PALETTE.tintFrost, PALETTE.tintTemperate, warmth),
    dustIntensity,
    clearFraction,
  };
}

/** Every scalar channel, for tests and plots that want to walk them uniformly. */
export const SCALAR_CHANNELS = [
  "capRadius",
  "oceanCoverage",
  "surfaceGreen",
  "atmosphereThickness",
  "cloudCover",
  "dustIntensity",
  "clearFraction",
] as const;

export type ScalarChannel = (typeof SCALAR_CHANNELS)[number];

/** Hex, for a host that wants one. The contract itself stays numeric. */
export function toHex(colour: Rgb): string {
  const byte = (v: number): string =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(colour.r)}${byte(colour.g)}${byte(colour.b)}`;
}
