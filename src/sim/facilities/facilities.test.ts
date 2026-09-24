import { describe, expect, it } from "vitest";

import { carbonInvariant, nitrogenInvariant, waterInvariant } from "../conserve.js";
import { derive } from "../derive.js";
import { advance } from "../integrate.js";
import type { SimConfig } from "../integrate.js";
import { evaluatePhase } from "../phase.js";
import { marsStart } from "../planets/mars.js";
import { defaultConfig } from "../tick.js";
import { DEFAULT_TUNING, makeTuning, validateTuning } from "../tuning.js";
import type { FacilityType, SimState } from "../types.js";
import { FACILITY_TYPES, NEUTRAL_ENV, Phase } from "../types.js";
import { buildFacility, setFacilityEnabled, setShieldStrength } from "../actions.js";
import { CONSERVATION_REL_TOL } from "../../testkit/helpers.js";
import {
  FACILITY_DEFS,
  deployedUnitsOf,
  effectiveEnv,
  facilityFlows,
  orderedUnits,
  scrubberThrottled,
  shieldTarget,
  stepFacilities,
} from "./index.js";

const t = DEFAULT_TUNING;
const cfg: SimConfig = defaultConfig();

function withLever(type: FacilityType, count: number, level = 1, base: SimState = marsStart()): SimState {
  return buildFacility(base, type, count, level, t);
}

function envOf(state: SimState) {
  return effectiveEnv(NEUTRAL_ENV, state.facilities, t);
}

function phaseOf(state: SimState): Phase {
  const env = envOf(state);
  return evaluatePhase(state.reservoirs, derive(state.reservoirs, env, t), env, t);
}

describe("the registry covers section 5", () => {
  it("defines all nine levers and nothing else", () => {
    expect(FACILITY_TYPES).toHaveLength(9);
    for (const type of FACILITY_TYPES) {
      const def = FACILITY_DEFS[type];
      expect(def.type).toBe(type);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.summary.length).toBeGreaterThan(0);
      expect(def.caution.length).toBeGreaterThan(0);
      expect(Number.isFinite(def.perUnit(t))).toBe(true);
    }
  });

  it("covers every kind the engine knows how to apply", () => {
    const kinds = new Set(FACILITY_TYPES.map((type) => FACILITY_DEFS[type].kind));
    expect(kinds).toEqual(new Set(["flow", "env", "shield", "action"]));
  });

  it("the warming and cooling levers point in opposite directions", () => {
    expect(FACILITY_DEFS.orbital_mirror.perUnit(t)).toBeGreaterThan(0);
    expect(FACILITY_DEFS.solar_shade.perUnit(t)).toBeLessThan(0);
  });
});

describe("ordering and deployment", () => {
  it("ordering capacity does not put it online", () => {
    const ordered = withLever("orbital_mirror", 30);
    expect(orderedUnits(ordered.facilities[0]!)).toBe(30);
    expect(ordered.facilities[0]?.deployed).toBe(0);
    expect(envOf(ordered).sMultiplier).toBe(1);
  });

  it("never lets an out-of-range deployed value keep driving the planet (Batch 13)", () => {
    // A maxed array whose `deployed` somehow reads 1000. The ramp clamped it
    // to 250, found that equal to the target, and returned the facility
    // untouched - so 1000 stayed in the state and in `effectiveEnv`.
    const maxed = withLever("orbital_mirror", t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL);
    const hostile: SimState = { ...maxed, facilities: [{ ...maxed.facilities[0]!, deployed: 1000 }] };
    const stepped = stepFacilities(hostile.facilities, t, t.SUBSTEP_YEARS);
    const cap = t.FACILITY_MAX_COUNT * t.FACILITY_MAX_LEVEL;
    expect(stepped[0]?.deployed).toBe(cap);
    expect(envOf({ ...hostile, facilities: stepped }).sMultiplier).toBeCloseTo(1 + t.MIRROR_S_PER_UNIT * cap, 12);
  });

  it("never lets an out-of-range deployed value drive even one substep (Batch 14)", () => {
    // The ramp normalises the value, but it runs AFTER the environment is
    // built, so the first substep used to integrate 1000 units (sMultiplier 5).
    // A world holding 1000 must now be exactly a world holding the cap.
    const maxed = withLever("orbital_mirror", t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL);
    const cap = t.FACILITY_MAX_COUNT * t.FACILITY_MAX_LEVEL;
    const at = (deployed: number): SimState => ({ ...maxed, facilities: [{ ...maxed.facilities[0]!, deployed }] });
    expect(advance(at(1000), 1, cfg).reservoirs).toEqual(advance(at(cap), 1, cfg).reservoirs);
  });

  it("deployment ramps toward the order and stops there", () => {
    let state = withLever("orbital_mirror", 30);
    state = { ...state, facilities: stepFacilities(state.facilities, t, 10) };
    expect(state.facilities[0]?.deployed).toBeCloseTo(t.FACILITY_BUILD_RATE * 10, 10);

    for (let i = 0; i < 200; i += 1) {
      state = { ...state, facilities: stepFacilities(state.facilities, t, 1) };
    }
    expect(state.facilities[0]?.deployed).toBe(30);
  });

  it("dismantling ramps down too, so there is no instant cooling lever either", () => {
    let state = withLever("orbital_mirror", 30);
    for (let i = 0; i < 200; i += 1) {
      state = { ...state, facilities: stepFacilities(state.facilities, t, 1) };
    }
    state = buildFacility(state, "orbital_mirror", 0, 1, t);
    state = { ...state, facilities: stepFacilities(state.facilities, t, 10) };
    const deployed = state.facilities[0]?.deployed ?? 0;
    expect(deployed).toBeLessThan(30);
    expect(deployed).toBeGreaterThan(0);
  });

  it("disabling a lever retires it without losing the order", () => {
    const state = setFacilityEnabled(withLever("ghg_factory", 10), "ghg_factory", false);
    expect(state.facilities[0]?.count).toBe(10);
    expect(orderedUnits(state.facilities[0]!)).toBe(0);
  });

  it("clamps counts and levels rather than throwing", () => {
    const maxed = withLever("orbital_mirror", 1e6, 1e6);
    expect(maxed.facilities[0]?.count).toBe(t.FACILITY_MAX_COUNT);
    expect(maxed.facilities[0]?.level).toBe(t.FACILITY_MAX_LEVEL);
    const negative = withLever("orbital_mirror", -5);
    expect(negative.facilities).toHaveLength(0);
  });

  it("level multiplies the order", () => {
    expect(orderedUnits(withLever("orbital_mirror", 10, 3).facilities[0]!)).toBe(30);
  });
});

describe("section 5's design rule: no lever trivialises an axis instantly", () => {
  /**
   * "No lever should trivialize a whole axis instantly. Each moves a RATE, so
   * the planet still changes over time, preserving visible steady growth."
   *
   * Phase 1 is exempt and deliberately so: its entry condition IS "the player
   * has built something", so it is an acknowledgement rather than an
   * achievement and should land the moment the first mirror comes online.
   * Every boundary above it has to be earned over time.
   */
  const maxUnits = t.FACILITY_MAX_COUNT;

  for (const type of FACILITY_TYPES) {
    const def = FACILITY_DEFS[type];
    if (def.kind === "action") continue;

    it(`${def.name} at maximum cannot reach Phase 2+ in under ${t.MIN_PHASE_CROSS_YEARS} sim-years`, () => {
      let state = withLever(type, maxUnits, t.FACILITY_MAX_LEVEL);
      const stepYears = 1;
      let crossedAt: number | null = null;

      for (let year = stepYears; year <= t.MIN_PHASE_CROSS_YEARS; year += stepYears) {
        state = advance(state, stepYears / t.SUBSTEP_YEARS, cfg);
        if (phaseOf(state) > Phase.Warming) {
          crossedAt = year;
          break;
        }
      }

      expect(crossedAt, `${def.name} crossed a phase boundary at year ${crossedAt}`).toBeNull();
    });
  }

  it("but a lever at maximum DOES eventually get there, or it is not a lever", () => {
    // The rule is about pace, not impotence. Mirrors must still ignite the caps.
    const state = advance(withLever("orbital_mirror", maxUnits, t.FACILITY_MAX_LEVEL), 4 * 200, cfg);
    expect(phaseOf(state)).toBeGreaterThan(Phase.Warming);
  });
});

describe("the environment levers", () => {
  it("mirrors warm the planet and shades cool it", () => {
    const deploy = (type: FacilityType): number => {
      const state = advance(withLever(type, 20), 4 * 200, cfg);
      return derive(state.reservoirs, envOf(state), t).T;
    };
    // Against a MATCHED no-facility run, not the t=0 state. The planet cools
    // 0.12 K on its own over 200 years from the section 3.7 bleed, which is
    // enough to satisfy a "shade cools it" assertion for a shade contributing
    // nothing at all - the real shade contributes -4.3 K, so the wrong
    // baseline hides a 36x miss.
    const baseline = derive(advance(marsStart(), 4 * 200, cfg).reservoirs, NEUTRAL_ENV, t).T;
    expect(deploy("orbital_mirror")).toBeGreaterThan(baseline);
    expect(deploy("solar_shade")).toBeLessThan(baseline);
  });

  it("they compose rather than one overwriting the other", () => {
    let state = withLever("orbital_mirror", 20);
    state = buildFacility(state, "solar_shade", 20, 1, t);
    state = advance(state, 4 * 400, cfg);
    expect(envOf(state).sMultiplier).toBeCloseTo(1, 6);
  });

  it("a shade stack cannot switch the sun off", () => {
    let state = withLever("solar_shade", t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL);
    state = advance(state, 4 * 2000, cfg);
    const env = envOf(state);
    expect(env.sMultiplier).toBeGreaterThan(0);
    expect(derive(state.reservoirs, env, t).sEff).toBeGreaterThanOrEqual(t.S_EFF_MIN);
    expect(Number.isFinite(derive(state.reservoirs, env, t).T)).toBe(true);
  });

  it("an external forcing and the facilities multiply together", () => {
    const state = advance(withLever("orbital_mirror", 20), 4 * 200, cfg);
    const dusty = effectiveEnv({ sMultiplier: 0.9, albedoDelta: 0 }, state.facilities, t);
    expect(dusty.sMultiplier).toBeCloseTo(0.9 * (1 + 20 * t.MIRROR_S_PER_UNIT), 10);
  });
});

describe("the flow levers", () => {
  it("the atmospheric processor MOVES carbon rather than creating it", () => {
    // Section 5 calls it "venting regolith directly". Venting is a transfer.
    const state = advance(withLever("atmo_processor", 20), 4 * 300, cfg);
    expect(state.reservoirs.co2_atm).toBeGreaterThan(marsStart().reservoirs.co2_atm);
    expect(state.reservoirs.co2_reg).toBeLessThan(marsStart().reservoirs.co2_reg);
    expect(carbonInvariant(state)).toBeCloseTo(carbonInvariant(marsStart()), 6);
  });

  it("the processor stops when the regolith runs out", () => {
    const empty = { ...marsStart(), reservoirs: { ...marsStart().reservoirs, co2_reg: 0 } };
    const state = advance(buildFacility(empty, "atmo_processor", 20, 1, t), 4 * 300, cfg);
    const d = derive(state.reservoirs, envOf(state), t);
    expect(facilityFlows(state, d, t).find((f) => f.id === "forcing.co2_vent")).toBeUndefined();
    expect(state.reservoirs.co2_reg).toBeGreaterThanOrEqual(0);
  });

  it("imports are double-entry, so the ledger identities survive them", () => {
    let state = marsStart();
    for (const type of ["comet_redirect", "nitrogen_import", "ghg_factory"] as const) {
      state = buildFacility(state, type, t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL, t);
    }
    // advance() asserts the identities itself; these confirm the numbers move.
    const end = advance(state, 4 * 500, cfg);
    expect(end.reservoirs.n2).toBeGreaterThan(marsStart().reservoirs.n2);
    expect(end.reservoirs.h2o_ice).toBeGreaterThan(marsStart().reservoirs.h2o_ice);
    expect(end.reservoirs.ghg).toBeGreaterThan(0);
    expect(nitrogenInvariant(end)).toBeCloseTo(nitrogenInvariant(marsStart()), 6);
    expect(waterInvariant(end, t)).toBeCloseTo(waterInvariant(marsStart(), t), 6);
  });

  it("the scrubber sequesters carbon into the ledger rather than deleting it", () => {
    // The frozen reservoirs are emptied so the scrubber is the only term
    // moving co2_atm. Left full, a 400 mbar world is warm enough that the caps
    // and regolith outgas faster than the scrubber removes, and co2_atm RISES.
    const thick = {
      ...marsStart(),
      reservoirs: { ...marsStart().reservoirs, co2_atm: 400, co2_cap: 0, co2_reg: 0 },
    };
    const end = advance(buildFacility(thick, "carbon_scrubber", 20, 1, t), 4 * 300, cfg);
    expect(end.reservoirs.co2_atm).toBeLessThan(400);
    expect(end.ledger.c_sequestered).toBeGreaterThan(0);
    const drift = Math.abs(carbonInvariant(end) - carbonInvariant(thick)) / carbonInvariant(thick);
    expect(drift).toBeLessThan(CONSERVATION_REL_TOL);
  });
});

describe("the pressure floor under the scrubber", () => {
  /**
   * The melt gate sits at P_TRIPLE = 6.1 mbar and the Mars start is 6.21 - a
   * margin of 0.11 mbar. The scrubber subtracts co2_atm directly, so without a
   * floor a player who scrubs early pushes pressure under the triple point and
   * locks liquid water out of the run permanently, with nothing on screen
   * saying why.
   */
  it("draws nothing at all from a start-state atmosphere", () => {
    const deployed = {
      ...marsStart(),
      facilities: [{ type: "carbon_scrubber" as const, count: 50, level: 5, enabled: true, deployed: 250 }],
    };
    const d = derive(deployed.reservoirs, NEUTRAL_ENV, t);
    expect(d.P).toBeLessThan(t.P_FLOOR);
    expect(facilityFlows(deployed, d, t).find((f) => f.id === "forcing.co2_scrub")).toBeUndefined();
  });

  it("a maxed scrubber cannot make a thin atmosphere any thinner than it would be anyway", () => {
    // Stated as a COMPARISON. Pressure falls over 2000 sim-years regardless,
    // because of the section 3.7 bleed - an absolute threshold here would be
    // measuring atmospheric loss and calling it the scrubber.
    const baseline = advance(marsStart(), 4 * 2000, cfg);
    const scrubbing = advance(withLever("carbon_scrubber", t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL), 4 * 2000, cfg);
    expect(derive(scrubbing.reservoirs, envOf(scrubbing), t).P).toBeCloseTo(
      derive(baseline.reservoirs, NEUTRAL_ENV, t).P,
      9,
    );
    expect(scrubbing.ledger.c_sequestered).toBe(0);
  });

  it("scrubs freely once there is pressure to spare", () => {
    const thick = { ...marsStart(), reservoirs: { ...marsStart().reservoirs, co2_atm: 400 } };
    const d = derive(thick.reservoirs, NEUTRAL_ENV, t);
    const deployed = { ...thick, facilities: [{ type: "carbon_scrubber" as const, count: 10, level: 1, enabled: true, deployed: 10 }] };
    const rate = facilityFlows(deployed, d, t).find((f) => f.id === "forcing.co2_scrub")?.rate ?? 0;
    expect(rate).toBeCloseTo(10 * t.SCRUBBER_PER_UNIT, 6);
  });

  it("reports when it is being held back, so the UI can explain it", () => {
    const thin = { ...marsStart(), facilities: [{ type: "carbon_scrubber" as const, count: 10, level: 1, enabled: true, deployed: 10 }] };
    expect(scrubberThrottled(thin, derive(thin.reservoirs, NEUTRAL_ENV, t), t)).toBe(true);

    const thick = { ...thin, reservoirs: { ...thin.reservoirs, co2_atm: 400 } };
    expect(scrubberThrottled(thick, derive(thick.reservoirs, NEUTRAL_ENV, t), t)).toBe(false);
  });
});

describe("the magnetic shield", () => {
  it("ramps up rather than switching on", () => {
    const early = advance(withLever("magnetic_shield", t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL), 4 * 5, cfg);
    expect(early.shieldStrength).toBeGreaterThan(0);
    expect(early.shieldStrength).toBeLessThan(1);
  });

  it("reaches full strength at full deployment and stops there", () => {
    const late = advance(withLever("magnetic_shield", t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL), 4 * 1200, cfg);
    expect(late.shieldStrength).toBe(1);
    expect(shieldTarget(late.facilities, t)).toBe(1);
  });

  it("cancels the atmospheric bleed once engaged", () => {
    // Built as real hardware, not by setting the field: shield strength
    // FOLLOWS the deployed facilities, so a hand-set value with no hardware
    // behind it ramps straight back down to zero.
    const thick = { ...marsStart(), reservoirs: { ...marsStart().reservoirs, co2_atm: 900 } };
    const unshielded = advance(thick, 4 * 2000, cfg);
    const shielded = advance(
      buildFacility(thick, "magnetic_shield", t.FACILITY_MAX_COUNT, t.FACILITY_MAX_LEVEL, t),
      4 * 2000,
      cfg,
    );
    expect(shielded.shieldStrength).toBe(1);
    expect(shielded.ledger.c_lost).toBeLessThan(unshielded.ledger.c_lost * 0.6);
  });

  it("a hand-set strength decays back to what the hardware supports", () => {
    // Worth pinning: it is the reason `setShieldStrength` is documented as a
    // save-loading and test affordance rather than a lever.
    const faked = advance(setShieldStrength(marsStart(), 1), 4 * 10, cfg);
    expect(faked.shieldStrength).toBeLessThan(1);
    expect(faked.shieldStrength).toBeCloseTo(1 - t.SHIELD_BUILD_RATE * 10, 6);
  });
});

describe("facilities do not break the engine's guarantees", () => {
  function everyLever(): SimState {
    let state = marsStart();
    for (const type of FACILITY_TYPES) {
      if (FACILITY_DEFS[type].kind === "action") continue;
      state = buildFacility(state, type, 10, 2, t);
    }
    return state;
  }

  it("determinism survives: one long run equals many short ones, exactly", () => {
    const oneShot = advance(everyLever(), 4000, cfg);
    let chained = everyLever();
    for (let i = 0; i < 1000; i += 1) chained = advance(chained, 4, cfg);
    expect(chained.reservoirs).toEqual(oneShot.reservoirs);
    expect(chained.facilities).toEqual(oneShot.facilities);
    expect(chained.shieldStrength).toBe(oneShot.shieldStrength);
  });

  it("conservation survives every lever running at once", () => {
    const start = everyLever();
    const end = advance(start, 4 * 1000, cfg);
    for (const [name, value] of [
      ["carbon", carbonInvariant(end) - carbonInvariant(start)],
      ["water", waterInvariant(end, t) - waterInvariant(start, t)],
      ["nitrogen", nitrogenInvariant(end) - nitrogenInvariant(start)],
    ] as const) {
      expect(Math.abs(value), `${name} drifted`).toBeLessThan(1e-6);
    }
  });

  it("purity survives: the input facilities are not mutated", () => {
    const start = everyLever();
    const snapshot = JSON.stringify(start.facilities);
    advance(start, 4 * 500, cfg);
    expect(JSON.stringify(start.facilities)).toBe(snapshot);
  });

  it("no legal combination of levers can crash the engine", () => {
    /**
     * The gap this closes: the existing tests DID construct 250-unit levers of
     * every type, but never ran them long enough to drain a reservoir. The
     * atmospheric processor and the carbon scrubber draw through the same
     * `avail(x, scale)` depletion ramp as the natural rates, which surrenders
     * `rate * h / scale` of whatever remains every substep however little is
     * left - so at maximum they asked for 2.5x the flux tripwire and threw a
     * SimInvariantError mid-run, killing the browser loop as well as the
     * harness. A 400-trial sweep crashed 24% of the time.
     *
     * validateTuning now enforces the relationship, so a future retune that
     * reintroduces it fails at startup with an explicit number rather than
     * partway through somebody's playthrough.
     */
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const buildable = FACILITY_TYPES.filter((type) => FACILITY_DEFS[type].kind !== "action");

    for (let trial = 0; trial < 120; trial += 1) {
      let state = marsStart();
      for (let k = 0; k <= rnd(3); k += 1) {
        const type = buildable[rnd(buildable.length)];
        if (type === undefined) continue;
        state = buildFacility(state, type, 1 + rnd(t.FACILITY_MAX_COUNT), 1 + rnd(t.FACILITY_MAX_LEVEL), t);
      }
      const ordered = state.facilities.map((f) => `${f.type} ${f.count}x${f.level}`).join(", ");
      // 1200 sim-years: long enough for the regolith and the atmosphere to run out.
      expect(() => advance(state, 4 * 1200, cfg), `crashed with ${ordered}`).not.toThrow();
    }
  });

  it("validateTuning rejects a facility depletion scale too small for a maxed lever", () => {
    expect(() => validateTuning(makeTuning({ FACILITY_DEPLETE_SCALE: 2.0 }))).toThrow(/FACILITY_DEPLETE_SCALE/);
    expect(() => validateTuning(makeTuning({ SCRUBBER_PER_UNIT: 1 }))).toThrow(/FACILITY_DEPLETE_SCALE/);
    expect(() => validateTuning(makeTuning({ ATMO_PROCESSOR_PER_UNIT: 1 }))).toThrow(/FACILITY_DEPLETE_SCALE/);
    expect(() => validateTuning(DEFAULT_TUNING)).not.toThrow();
  });

  it("a state with no facilities behaves exactly as Batch 1 did", () => {
    const bare = advance(marsStart(), 4 * 500, cfg);
    expect(bare.facilities).toHaveLength(0);
    expect(bare.shieldStrength).toBe(0);
    expect(deployedUnitsOf(bare.facilities, "orbital_mirror", t)).toBe(0);
  });
});
