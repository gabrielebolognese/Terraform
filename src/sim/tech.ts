/**
 * The tech tree, gated on phase.
 *
 * "Gated on phase" is the whole design, and it is a deliberate refusal of the
 * obvious alternative. A research tree where credits buy nodes would let a
 * player bank money through the early game and unlock the endgame levers
 * before the planet is anywhere near ready for them - which §7's phase
 * ordering exists to prevent. The doc is explicit that phases "intentionally
 * match the real scientific ordering (warm, thicken, liquid water, seed life,
 * oxygenate, buffer) so the science and the game teach the same thing".
 *
 * So what unlocks a lever is the STATE OF THE PLANET, not a purchase. You get
 * nitrogen import when the planet has water, because that is when importing
 * nitrogen is the right move. The economy decides how MUCH you can build; the
 * tech tree decides WHAT, and the planet decides when.
 *
 * Phase is latched (`phaseReached`), so an unlock never reverses - a dust
 * storm dropping the temperature must not confiscate a technology.
 */

import type { FacilityType, Phase, SimState } from "./types.js";
import { Phase as P } from "./types.js";

export interface TechDef {
  readonly id: string;
  readonly name: string;
  /** Why the planet is ready for it now. Surfaced in the UI. */
  readonly rationale: string;
  /** The latched phase that grants it. */
  readonly phase: Phase;
  /** Facilities this makes buildable. */
  readonly unlocks: readonly FacilityType[];
}

/**
 * The tree.
 *
 * Every facility appears exactly once, and `tech.test.ts` asserts that - a
 * lever gated behind no tech would be silently always available, and one
 * listed twice would have an ambiguous gate.
 */
export const TECH: readonly TechDef[] = Object.freeze([
  {
    id: "orbital_optics",
    name: "Orbital optics",
    rationale: "Sunlight is the only energy source that needs nothing shipped from home.",
    phase: P.Barren,
    unlocks: ["orbital_mirror", "solar_shade"],
  },
  {
    id: "halocarbon_synthesis",
    name: "Halocarbon synthesis",
    rationale: "Tiny mass, enormous forcing. The kickstart before the caps can carry themselves.",
    phase: P.Barren,
    unlocks: ["ghg_factory"],
  },
  {
    id: "regolith_processing",
    name: "Regolith processing",
    rationale: "Once the ground is warm enough to work, the regolith is the nearest CO2 reservoir.",
    phase: P.Warming,
    unlocks: ["atmo_processor"],
  },
  {
    id: "volatile_capture",
    name: "Volatile capture",
    rationale: "Moving comets needs an atmosphere thick enough to aerobrake against.",
    phase: P.RunawayThickening,
    unlocks: ["comet_redirect"],
  },
  {
    id: "ecopoiesis",
    name: "Ecopoiesis",
    rationale: "There is standing water. Something can live in it.",
    phase: P.FirstWater,
    unlocks: ["biosphere_seeding"],
  },
  {
    id: "buffer_gas_logistics",
    name: "Buffer gas logistics",
    rationale: "A biosphere is making oxygen; it now needs an inert gas to breathe it in.",
    phase: P.Ecopoiesis,
    unlocks: ["nitrogen_import"],
  },
  {
    id: "carbon_sequestration",
    name: "Carbon sequestration",
    rationale: "With a nitrogen buffer holding the pressure up, the carbon can finally come out.",
    phase: P.Oxygenation,
    unlocks: ["carbon_scrubber"],
  },
  {
    id: "magnetospheric_engineering",
    name: "Magnetospheric engineering",
    rationale: "The capstone: without it, holding a thick atmosphere means importing forever.",
    phase: P.Oxygenation,
    unlocks: ["magnetic_shield"],
  },
]);

const BY_ID: ReadonlyMap<string, TechDef> = new Map(TECH.map((tech) => [tech.id, tech]));

/** Which facility each tech gates, inverted once. */
const GATE: ReadonlyMap<FacilityType, TechDef> = (() => {
  const out = new Map<FacilityType, TechDef>();
  for (const tech of TECH) for (const type of tech.unlocks) out.set(type, tech);
  return out;
})();

export function techById(id: string): TechDef | undefined {
  return BY_ID.get(id);
}

/** The tech that gates a facility, or undefined if nothing does. */
export function gatingTech(type: FacilityType): TechDef | undefined {
  return GATE.get(type);
}

/** Every tech the planet has earned at this latched phase. */
export function availableTech(phaseReached: Phase): readonly TechDef[] {
  return TECH.filter((tech) => tech.phase <= phaseReached);
}

/**
 * Bring `techUnlocked` up to date with the latched phase.
 *
 * Returns the same array when nothing changed, so the caller's identity check
 * stays cheap and `advance` does not allocate a new state every substep.
 */
export function unlockedFor(phaseReached: Phase, already: readonly string[]): readonly string[] {
  const have = new Set(already);
  let added = false;
  const out = [...already];
  for (const tech of availableTech(phaseReached)) {
    if (have.has(tech.id)) continue;
    out.push(tech.id);
    added = true;
  }
  return added ? out : already;
}

export interface TechGate {
  readonly allowed: boolean;
  readonly tech: TechDef | undefined;
  readonly reason: string | null;
}

/**
 * May this facility be built yet?
 *
 * Reads `techUnlocked` rather than recomputing from phase, because the
 * unlocked list is what the save carries: a world loaded from an older save
 * must behave exactly as it did when it was written, and deriving the gate
 * fresh would quietly re-gate it against whatever the tree says today.
 */
export function techGate(state: SimState, type: FacilityType, t: { readonly TECH_GATE_ENABLED: number }): TechGate {
  const tech = gatingTech(type);
  if (!t.TECH_GATE_ENABLED || tech === undefined) return { allowed: true, tech, reason: null };
  if (state.techUnlocked.includes(tech.id)) return { allowed: true, tech, reason: null };
  return {
    allowed: false,
    tech,
    reason: `${tech.name} is not unlocked yet - it arrives at phase ${tech.phase}`,
  };
}
