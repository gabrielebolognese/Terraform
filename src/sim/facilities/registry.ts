/**
 * Design doc section 5 - the nine player levers.
 *
 * Each lever declares WHAT it does and how strongly, and nothing about how it
 * is applied. Section 5's framing is that "facilities are just extra terms in
 * the same difference equations", so a lever is one more summand in
 * `computeStep` and the engine cannot tell the difference between a player's
 * greenhouse factory and the planet's own regolith outgassing.
 *
 * Costs and unlock conditions are NOT here - the economy and tech layer is a
 * separate document and a later batch. A lever in Batch 2 is free to build.
 */

import type { Tuning } from "../tuning.js";
import type { FacilityType } from "../types.js";

/**
 * How a lever reaches the simulation.
 *
 * - `flow`   adds paired flows, exactly like a natural rate term.
 * - `env`    modifies effective solar flux, which is not a reservoir.
 * - `shield` moves `shieldStrength`, which is not a reservoir either.
 * - `action` is a one-shot state edit, not a rate. Ecopoiesis is the only one,
 *            and section 3.5 requires it: logistic growth cannot start at zero.
 */
export type FacilityKind = "flow" | "env" | "shield" | "action";

export interface FacilityDef {
  readonly type: FacilityType;
  readonly name: string;
  /** What it does, in the player's words. */
  readonly summary: string;
  /** What the doc says to watch out for. Surfaced in the UI. */
  readonly caution: string;
  readonly kind: FacilityKind;
  /** Display unit of the per-unit effect. */
  readonly unit: string;
  /** Effect per deployed unit. Dimensionless for `env` and `shield`. */
  readonly perUnit: (t: Tuning) => number;
  /**
   * Credits for the FIRST unit at level 1. Later units escalate - see
   * `orderCost`. Reads from tuning like `perUnit` does, so invariant #4 holds
   * and the balance sweep can reach a price.
   */
  readonly baseCost: (t: Tuning) => number;
}

export const FACILITY_DEFS: Readonly<Record<FacilityType, FacilityDef>> = Object.freeze({
  orbital_mirror: {
    type: "orbital_mirror",
    name: "Orbital mirror array",
    summary: "Raises effective solar flux. The main early warming lever, and the one that reaches the cap threshold.",
    caution: "Can be dialled down later, but the array takes decades to deploy or retire.",
    kind: "env",
    unit: "x S per unit",
    perUnit: (t) => t.MIRROR_S_PER_UNIT,
    baseCost: (t) => t.COST_MIRROR,
  },
  solar_shade: {
    type: "solar_shade",
    name: "Solar shade",
    summary: "Lowers effective solar flux. Cooling, for correcting an overshoot.",
    caution: "The endgame runs hot once the nitrogen buffer is in place; this is the correction.",
    kind: "env",
    unit: "x S per unit",
    perUnit: (t) => -t.SHADE_S_PER_UNIT,
    baseCost: (t) => t.COST_SHADE,
  },
  ghg_factory: {
    type: "ghg_factory",
    name: "Greenhouse factory",
    summary: "Produces super-greenhouse gases. Tiny mass, large warming - the kickstart before the caps ignite.",
    caution: "PFCs decay photolytically, so the factory is an ongoing cost, not a one-off.",
    kind: "flow",
    unit: "mbar/yr per unit",
    perUnit: (t) => t.GHG_FACTORY_PER_UNIT,
    baseCost: (t) => t.COST_GHG_FACTORY,
  },
  atmo_processor: {
    type: "atmo_processor",
    name: "Atmospheric processor",
    summary: "Vents CO2 out of the regolith directly, thickening the air without waiting on temperature.",
    caution: "Draws on the regolith reservoir - it moves carbon, it does not create it, and the reservoir runs out.",
    kind: "flow",
    unit: "mbar/yr per unit",
    perUnit: (t) => t.ATMO_PROCESSOR_PER_UNIT,
    baseCost: (t) => t.COST_ATMO_PROCESSOR,
  },
  comet_redirect: {
    type: "comet_redirect",
    name: "Comet redirect",
    summary: "Imports volatiles as ice.",
    caution: "Watch the flooding when it melts: the ocean band has an upper edge as well as a lower one.",
    kind: "flow",
    unit: "m SLE/yr per unit",
    perUnit: (t) => t.COMET_ICE_PER_UNIT,
    baseCost: (t) => t.COST_COMET_REDIRECT,
  },
  nitrogen_import: {
    type: "nitrogen_import",
    name: "Nitrogen import",
    summary: "Ships in the inert buffer. The late-game push to a breathable 1 bar.",
    caution: "Nitrogen also raises total pressure, which raises the greenhouse - the endgame overshoot lives here.",
    kind: "flow",
    unit: "mbar/yr per unit",
    perUnit: (t) => t.N2_IMPORT_PER_UNIT,
    baseCost: (t) => t.COST_N2_IMPORT,
  },
  biosphere_seeding: {
    type: "biosphere_seeding",
    name: "Cyanobacteria seeding",
    summary: "Ecopoiesis. Sets biomass to a small positive value so it can grow.",
    caution: "A one-shot action, not a rate. Refuses below the temperature, water and pressure gates.",
    kind: "action",
    unit: "one-shot",
    perUnit: (t) => t.SEED_AMOUNT,
    baseCost: (t) => t.COST_SEEDING,
  },
  carbon_scrubber: {
    type: "carbon_scrubber",
    name: "Carbon scrubber",
    summary: "Draws CO2 out of the atmosphere and sequesters it, for the final push to a breathable mix.",
    caution: "Stops automatically near the pressure floor: scrubbing below the triple point would lock liquid water out permanently.",
    kind: "flow",
    unit: "mbar/yr per unit",
    perUnit: (t) => t.SCRUBBER_PER_UNIT,
    baseCost: (t) => t.COST_SCRUBBER,
  },
  magnetic_shield: {
    type: "magnetic_shield",
    name: "Orbital magnetic shield",
    summary: "Cancels solar-wind stripping. The capstone megaproject.",
    caution: "Without it, holding a thick atmosphere means importing nitrogen forever.",
    kind: "shield",
    unit: "strength per unit",
    perUnit: (t) => t.SHIELD_PER_UNIT,
    baseCost: (t) => t.COST_SHIELD,
  },
});

export const FACILITY_LIST: readonly FacilityDef[] = Object.freeze(Object.values(FACILITY_DEFS));
