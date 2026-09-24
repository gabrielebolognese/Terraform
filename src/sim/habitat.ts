/**
 * The macro -> micro contract. Design doc §12.3.
 *
 * §12.3's open question is "how the city (micro) layer reads the macro state",
 * and its recommendation is that "cities consume the same derived channels
 * (local `T`, `P`, `o2`, water access) as environmental inputs, so a city's
 * viable footprint grows as the planet terraforms. That keeps the two layers
 * coupled through the one contract in section 9."
 *
 * This is that contract, and it is deliberately the SAME SHAPE as §9's: a
 * small struct of numbers, derived fresh, never stored, never written back.
 * §9 is the wall between the simulation and the graphics; this is the wall
 * between the simulation and the city layer. Neither wall has a door.
 *
 * WHY NOT JUST HAND CITIES `Derived`? Because `Derived` is the simulation's
 * own working set - it carries `pGreenhouse`, `iceFrac`, `albedo`, things a
 * city has no business knowing and that would pin the macro internals the
 * moment a city read one. A separate, smaller contract means the physics can
 * be rewritten freely underneath, exactly as §9 promises for the renderer.
 *
 * WHAT A CITY LAYER MAY ASSUME. Every field is finite. Every 0..1 field really
 * is in 0..1. `supportIndex` is strictly positive even on a dead planet -
 * there are colonists on day one, under domes, or there would be nobody to
 * order the mirrors. `habitat.test.ts` asserts all three across a full
 * playthrough rather than leaving them as promises.
 */

import type { Derived, Reservoirs } from "./types.js";
import type { Tuning } from "./tuning.js";
import { clamp01, ramp } from "./math.js";
import { TARGETS } from "./targets.js";

/**
 * Everything the city layer is allowed to see.
 *
 * Five environmental readings and two indices derived from them. The readings
 * are in the doc's own units so a city can apply its own rules; the indices
 * are the convenience the doc actually asks for.
 */
export interface HabitatChannels {
  /** Mean surface temperature, K. */
  readonly temperature: number;
  /** Total surface pressure, mbar. */
  readonly pressure: number;
  /** Partial pressure of oxygen, mbar. */
  readonly oxygen: number;
  /** Partial pressure of CO2, mbar - the toxicity ceiling of §2.3. */
  readonly carbonDioxide: number;
  /** 0..1. How much of the surface has liquid water within reach. */
  readonly waterAccess: number;
  /**
   * Sunlight reaching the ground, relative to Mars's natural insolation: 1 on
   * a bare Mars, higher under mirrors, lower under shades. Added in Batch 18
   * for micro doc section 5's Solar Array, whose "efficiency scales with
   * effective insolation (macro mirrors raise it)" - the one reading section
   * 2.1 needs that this contract did not already carry.
   */
  readonly insolation: number;

  /**
   * 0..1. Where a person can go outside in a breathing mask - warm enough for
   * liquid water, above the Armstrong limit, with water in reach. No oxygen
   * needed, because a mask carries it.
   *
   * This is the tier that opens in the MIDDLE of a playthrough, and it is why
   * the contract has tiers at all. A single all-or-nothing "open air" gate
   * needs breathable oxygen, which arrives in the last third - so a city's
   * footprint would sit at its floor for most of the game and then jump, and
   * §12.3 asks for a footprint that GROWS as you terraform.
   */
  readonly maskFraction: number;

  /**
   * 0..1. Where a person can go outside with no equipment at all: the mask
   * tier plus breathable oxygen and CO2 below the §2.3 toxicity ceiling.
   */
  readonly openAirFraction: number;

  /**
   * 0..1. What a city layer scales its capacity by.
   *
   * Never zero: sealed habitats work on a dead Mars, and the game's premise is
   * that somebody is already there. It rises about twelvefold across a
   * playthrough, which is the growth §12.3 is describing.
   */
  readonly supportIndex: number;
}

/**
 * Water within reach.
 *
 * Not `oceanFrac` directly. A planet that is 90% ocean is not twice as good to
 * live on as one that is 45% - it is worse, because the land is gone. This
 * peaks inside §2.3's ocean band and falls away on both sides, which is the
 * same band the victory condition uses.
 */
function waterAccessOf(d: Derived): number {
  const { bandLo, bandHi } = TARGETS.ocean;
  if (d.oceanFrac <= 0) return 0;
  if (d.oceanFrac < bandLo) return d.oceanFrac / bandLo;
  if (d.oceanFrac <= bandHi) return 1;
  // Past the top of the band the land is drowning.
  return clamp01((1 - d.oceanFrac) / (1 - bandHi));
}

/**
 * The §12.3 contract.
 *
 * Pure, and takes no seed and no time - a city's environment is a function of
 * the world, not of when you asked. Weather is deliberately excluded: a dust
 * storm is a §9 visual and a few kelvin, not a reason to evacuate, and letting
 * it into this contract would make a city's capacity flicker.
 */
export function habitat(r: Reservoirs, d: Derived, t: Tuning): HabitatChannels {
  const waterAccess = waterAccessOf(d);

  /**
   * The open-air gates, multiplied rather than averaged.
   *
   * Same argument as §8.1's geometric mean and §3.5's suitability product: you
   * cannot stand outside on a warm airless planet, and averaging would say you
   * could. Any single unmet gate closes the footprint.
   */
  const gTemp = ramp(d.T, t.HAB_T_MIN, t.HAB_T_WIDTH, 0.5);
  const gPress = ramp(d.P, t.HAB_P_MIN, t.HAB_P_WIDTH, 0.5);
  const gOxygen = ramp(r.o2, t.HAB_O2_MIN, t.HAB_O2_WIDTH, 0.5);
  // Toxicity runs backwards: the gate closes as CO2 RISES.
  const gToxic = 1 - ramp(r.co2_atm, t.HAB_CO2_MAX, t.HAB_CO2_WIDTH, 0.5);
  const gWater = ramp(waterAccess, t.HAB_WATER_MIN, t.HAB_WATER_WIDTH, 0.5);

  // A mask supplies oxygen but cannot supply pressure or warmth.
  const maskFraction = clamp01(gTemp * gPress * gWater);
  // Open air is the mask tier, plus air you can actually breathe.
  const openAirFraction = clamp01(maskFraction * gOxygen * gToxic);

  /**
   * Three tiers, summed by weight.
   *
   * Sealed habitats are the floor and work from day one; the mask tier opens
   * once there is warmth, pressure and water; open air is the last third.
   * Spreading the growth across three thresholds rather than one is what makes
   * the footprint grow THROUGH a playthrough instead of jumping at the end.
   */
  const maskWeight = t.HAB_MASK_WEIGHT;
  const openWeight = 1 - t.HAB_SEALED_BASE - maskWeight;

  return {
    temperature: d.T,
    pressure: d.P,
    oxygen: r.o2,
    carbonDioxide: r.co2_atm,
    waterAccess,
    insolation: d.sEff / t.S_MARS,
    maskFraction,
    openAirFraction,
    supportIndex: clamp01(t.HAB_SEALED_BASE + maskWeight * maskFraction + openWeight * openAirFraction),
  };
}
