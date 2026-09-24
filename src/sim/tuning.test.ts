import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BASE_TUNING, DEFAULT_TUNING, TUNING_SCALAR_KEYS, TuningError, makeTuning, validateTuning } from "./tuning.js";

describe("validateTuning catches what would divide by zero", () => {
  it("accepts the shipped table", () => {
    expect(() => validateTuning(DEFAULT_TUNING)).not.toThrow();
  });

  /**
   * The gate constants are the ones that end up as denominators. OCEAN_FOR_LIFE
   * was the single unguarded one: at 0 it makes `oceanFrac / OCEAN_FOR_LIFE`
   * evaluate 0/0 on a dry world, and the NaN propagates through suitability
   * into biomass, temperature and the save file without failing a single
   * non-negativity check, because every comparison against NaN is false.
   */
  it("rejects a zero on any denominator constant", () => {
    for (const key of ["OCEAN_FOR_LIFE", "CO2_FOR_LIFE", "P_REF", "GHG_REF", "H2O_MBAR_PER_M", "SUBSTEP_YEARS"] as const) {
      expect(() => validateTuning(makeTuning({ [key]: 0 })), `${key} = 0 should be rejected`).toThrow(TuningError);
    }
  });

  it("no single zeroed constant can produce a tuning that passes and then yields NaN", () => {
    // Exhaustive: every key, set to zero, must either be rejected up front or
    // be harmless. A constant that passes validation and then poisons the
    // state is the failure mode this check exists for.
    for (const key of TUNING_SCALAR_KEYS) {
      const tuned = makeTuning({ [key]: 0 });
      let rejected = false;
      try {
        validateTuning(tuned);
      } catch {
        rejected = true;
      }
      if (rejected) continue;
      for (const k of TUNING_SCALAR_KEYS) {
        expect(Number.isFinite(tuned[k]), `${key}=0 left ${k} non-finite`).toBe(true);
      }
    }
  });

  it("rejects an inverted band", () => {
    expect(() => validateTuning(makeTuning({ T_LIFE_HI: 200 }))).toThrow(TuningError);
    expect(() => validateTuning(makeTuning({ P_LIFE_OK: 1 }))).toThrow(TuningError);
    expect(() => validateTuning(makeTuning({ ALBEDO_MAX: 0 }))).toThrow(TuningError);
  });

  it("rejects progress weights that sum to zero", () => {
    expect(() => validateTuning(makeTuning({ W_T: 0, W_P: 0, W_O2: 0, W_WATER: 0, W_BIO: 0 }))).toThrow(TuningError);
  });
});

describe("the depletion-ramp guard covers every rate that uses avail()", () => {
  /**
   * A reservoir on an `avail(x, S)` ramp surrenders `R * h / S` of what remains
   * every substep, however little is left - so an S that is too small trips the
   * flux tripwire partway through a run with a confusing message. The guard
   * exists to catch that up front, and it has to cover ALL the rates sharing
   * each scale, not just the two most obvious ones.
   */
  it("covers the melt and freeze rates", () => {
    expect(() => validateTuning(makeTuning({ M_RATE: 20 }))).toThrow(/H2O_DEPLETE_SCALE/);
    expect(() => validateTuning(makeTuning({ F_RATE: 20 }))).toThrow(/H2O_DEPLETE_SCALE/);
  });

  it("covers sublimation, which shares H2O_DEPLETE_SCALE", () => {
    expect(() => validateTuning(makeTuning({ SUBL_RATE: 20 }))).toThrow(/H2O_DEPLETE_SCALE/);
  });

  it("covers the CO2 release rates", () => {
    expect(() => validateTuning(makeTuning({ R_CAP: 40 }))).toThrow(/CO2_DEPLETE_SCALE/);
    expect(() => validateTuning(makeTuning({ R_REG: 40 }))).toThrow(/CO2_DEPLETE_SCALE/);
  });

  it("covers nitrate release, which shares CO2_DEPLETE_SCALE", () => {
    expect(() => validateTuning(makeTuning({ R_N2: 40 }))).toThrow(/CO2_DEPLETE_SCALE/);
  });
});

describe("the section 10 table cannot silently go stale", () => {
  /**
   * Invariant #4 says balance lives in one file. It does - but the design doc
   * carries its own copy of the table, and nothing connected the two. The v0.1
   * draft's numbers were already wrong in eight places by the end of Batch 1
   * and nobody reading the doc would have known.
   *
   * This asserts the direction that matters: every constant the engine
   * actually uses is documented. It does not assert the values match, because
   * the doc groups and annotates them - `src/sim/tuning.ts` is normative.
   */
  const DOC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "design", "macro-world.md");

  function sectionTenCodeBlocks(): string {
    const text = readFileSync(DOC, "utf8");
    const start = text.indexOf("## 10. Tuning table");
    const end = text.indexOf("## 11. Save / serialization schema");
    expect(start, "section 10 not found in the design doc").toBeGreaterThan(-1);
    expect(end, "section 11 not found in the design doc").toBeGreaterThan(start);
    return (text.slice(start, end).match(/```[\s\S]*?```/g) ?? []).join("\n");
  }

  it("documents every constant the engine uses", () => {
    const documented = sectionTenCodeBlocks();
    const missing = TUNING_SCALAR_KEYS.filter((key) => !new RegExp(`\\b${key}\\b`).test(documented));
    expect(missing, `section 10 is missing ${missing.length} constant(s)`).toEqual([]);
  });

  it("does not document constants the engine no longer has", () => {
    // The draft's G_GHG, E_RATE, C_RATE and SUBSTEPS were all replaced during
    // Batch 1. Naming a dead constant in the table is how a reader ends up
    // tuning something that is not wired to anything.
    const documented = sectionTenCodeBlocks();
    const known = new Set<string>(TUNING_SCALAR_KEYS);
    const retired = ["G_GHG", "E_RATE", "C_RATE", "SUBSTEPS"];
    for (const dead of retired) {
      if (known.has(dead)) continue;
      const assignedSomewhere = new RegExp(`^\\s*${dead}\\s*=`, "m").test(documented);
      expect(assignedSomewhere, `section 10 still assigns the retired constant ${dead}`).toBe(false);
    }
  });
});

describe("tuning variants are independent", () => {
  it("makeTuning does not mutate the base table", () => {
    makeTuning({ C_GH: 999 });
    expect(DEFAULT_TUNING.C_GH).toBe(BASE_TUNING.C_GH);
  });

  it("returns a frozen object", () => {
    expect(Object.isFrozen(makeTuning())).toBe(true);
  });

  it("the photosynthesis stoichiometry follows Y_CO2 rather than drifting from it", () => {
    // Written as an expression so a retune of Y_CO2 cannot silently break the
    // mass ratio, and so the die-off reverse reaction stays carbon-neutral.
    expect(DEFAULT_TUNING.Y_O2 / DEFAULT_TUNING.Y_CO2).toBeCloseTo(32 / 44, 12);
  });
});
