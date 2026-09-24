import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONSERVATION_REL_TOL, assertPhysical, deepFreeze, stateWith } from "../testkit/helpers.js";
import { setDevChecks } from "./dev.js";
import { carbonInvariant, nitrogenInvariant, waterInvariant } from "./conserve.js";
import { advance, applyFluxes, simYear, worldEnv } from "./integrate.js";
import { buildFacility } from "./actions.js";
import type { SimConfig } from "./integrate.js";
import { marsStart } from "./planets/mars.js";
import { computeStep } from "./rates/index.js";
import { derive } from "./derive.js";
import { defaultConfig } from "./tick.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { Flow, Ledger, Reservoirs } from "./types.js";
import { NEUTRAL_ENV, RESERVOIR_KEYS } from "./types.js";

const t = DEFAULT_TUNING;
const cfg: SimConfig = defaultConfig();

/** A configuration that forces the release terms hard, for stress cases. */
const HOT: SimConfig = { tuning: t, env: { sMultiplier: 1.3, albedoDelta: 0 }, forcing: null };

describe("applyFluxes rations proportionally", () => {
  const reservoirs: Reservoirs = { ...marsStart().reservoirs, co2_cap: 1 };
  const ledger: Ledger = marsStart().ledger;

  // These cases deliberately over-draw by 400x to exercise the limiter. The
  // dev tripwire exists to shout about exactly that, so it is off here and
  // tested on its own below.
  beforeEach(() => setDevChecks(false));
  afterEach(() => setDevChecks(true));

  it("never lets a reservoir go negative, however greedy the flows", () => {
    const greedy: readonly Flow[] = [
      { id: "co2.cap_sublimation", from: "co2_cap", to: "co2_atm", rate: 100, conversion: 1 },
      { id: "co2.regolith_desorption", from: "co2_cap", to: "co2_atm", rate: 300, conversion: 1 },
    ];
    const result = applyFluxes(reservoirs, ledger, greedy, 1, t);
    expect(result.reservoirs.co2_cap).toBeGreaterThanOrEqual(0);
    expect(result.reservoirs.co2_cap).toBeCloseTo(0, 12);
  });

  it("conserves mass exactly while rationing - the clamp cannot mint carbon", () => {
    /**
     * This is the bug the section 6 algorithm has. Its release term is
     * zeroth-order in the reservoir, so an overdrawn cap keeps delivering CO2
     * to the atmosphere and `clampReservoirs` then lifts the cap back to zero
     * afterwards - carbon out of nothing. Measured drift at a coarse step
     * exceeded 300%. Limiting BEFORE applying makes it exact.
     */
    const greedy: readonly Flow[] = [
      { id: "co2.cap_sublimation", from: "co2_cap", to: "co2_atm", rate: 100, conversion: 1 },
      { id: "co2.regolith_desorption", from: "co2_cap", to: "co2_atm", rate: 300, conversion: 1 },
    ];
    const before = reservoirs.co2_atm + reservoirs.co2_cap + reservoirs.co2_reg;
    const result = applyFluxes(reservoirs, ledger, greedy, 1, t);
    const after = result.reservoirs.co2_atm + result.reservoirs.co2_cap + result.reservoirs.co2_reg;
    expect(after).toBeCloseTo(before, 12);
  });

  it("gives the same answer whatever order the flows arrive in", () => {
    const a: Flow = { id: "co2.cap_sublimation", from: "co2_cap", to: "co2_atm", rate: 100, conversion: 1 };
    const b: Flow = { id: "co2.regolith_desorption", from: "co2_cap", to: "co2_atm", rate: 300, conversion: 1 };
    const forward = applyFluxes(reservoirs, ledger, [a, b], 1, t);
    const backward = applyFluxes(reservoirs, ledger, [b, a], 1, t);
    expect(forward.reservoirs).toEqual(backward.reservoirs);
  });

  it("applies the unit conversion to the destination only", () => {
    const evaporate: readonly Flow[] = [
      { id: "h2o.evaporate", from: "h2o_liq", to: "h2o_vap", rate: 1, conversion: t.H2O_MBAR_PER_M },
    ];
    const wet = { ...reservoirs, h2o_liq: 10 };
    const result = applyFluxes(wet, ledger, evaporate, 1, t);
    expect(result.reservoirs.h2o_liq).toBeCloseTo(9, 12);
    expect(result.reservoirs.h2o_vap).toBeCloseTo(t.H2O_MBAR_PER_M, 10);
  });
});

describe("the dev tripwire", () => {
  const greedy: readonly Flow[] = [
    { id: "co2.cap_sublimation", from: "co2_cap", to: "co2_atm", rate: 100, conversion: 1 },
  ];

  it("throws loudly when a rate is far too large for the step size", () => {
    // A LOUD assertion, never a silent clip - a silent clip is the
    // mass-creation bug wearing a different hat.
    expect(() => applyFluxes({ ...marsStart().reservoirs, co2_cap: 1 }, marsStart().ledger, greedy, 1, t)).toThrow(
      /requested .* of the reservoir in one substep/,
    );
  });

  it("can be switched off for a long sweep without changing the result", () => {
    const withChecks = advance(marsStart(), 400, HOT);
    setDevChecks(false);
    const withoutChecks = advance(marsStart(), 400, HOT);
    setDevChecks(true);
    expect(withoutChecks.reservoirs).toEqual(withChecks.reservoirs);
  });

  it("does not fire on the exactly-integrated relaxation terms", () => {
    // The vapour column legitimately closes 63% of its gap to equilibrium in
    // one substep, and atmospheric escape is an exact exponential. Neither can
    // overshoot, so neither should trip a wire meant for tuning errors.
    const wet = stateWith({ co2_atm: 300, h2o_liq: 30, h2o_vap: 400 });
    expect(() => advance(wet, 40, cfg)).not.toThrow();
  });
});

describe("advance", () => {
  it("rejects a nonsensical step count instead of coercing it", () => {
    expect(() => advance(marsStart(), -1, cfg)).toThrow(RangeError);
    expect(() => advance(marsStart(), Number.NaN, cfg)).toThrow(RangeError);
    expect(() => advance(marsStart(), Infinity, cfg)).toThrow(RangeError);
  });

  it("is a no-op for zero steps", () => {
    const state = marsStart();
    expect(advance(state, 0, cfg)).toBe(state);
  });

  it("derives sim-year from the integer step counter rather than accumulating it", () => {
    const state = advance(marsStart(), 4000, cfg);
    expect(state.steps).toBe(4000);
    expect(simYear(state, t)).toBe(1000);
  });

  it("keeps every reservoir finite and non-negative over a long hot run", () => {
    const state = advance(marsStart(), 8000, HOT);
    assertPhysical(state);
  });
});

describe("conservation over a full trajectory", () => {
  it("the carbon ledger identity holds to 1e-9 over 2000 sim-years", () => {
    const start = marsStart();
    const end = advance(start, 8000, HOT);
    expect(carbonInvariant(end)).toBeCloseTo(carbonInvariant(start), 6);
    const drift = Math.abs(carbonInvariant(end) - carbonInvariant(start)) / carbonInvariant(start);
    expect(drift).toBeLessThan(CONSERVATION_REL_TOL);
  });

  it("the water ledger identity holds over the same run", () => {
    const start = marsStart();
    const end = advance(start, 8000, HOT);
    const drift = Math.abs(waterInvariant(end, t) - waterInvariant(start, t)) / waterInvariant(start, t);
    expect(drift).toBeLessThan(CONSERVATION_REL_TOL);
  });

  it("the nitrogen ledger identity holds over the same run", () => {
    const start = marsStart();
    const end = advance(start, 8000, HOT);
    const drift = Math.abs(nitrogenInvariant(end) - nitrogenInvariant(start)) / nitrogenInvariant(start);
    expect(drift).toBeLessThan(CONSERVATION_REL_TOL);
  });

  it("holds even when the biosphere is growing and dying", () => {
    // The fixture has to actually DIE. An earlier version kept suitability at
    // exactly 1.0 for the whole run, so `decay = D_BIO * b * (1 - g)` was
    // identically zero, no die-off flow was ever emitted, and deleting the
    // entire die-off block left this test green. The die-off leg is the half
    // that draws on the c_fixed ledger account and is rationed against it, so
    // it is precisely where a paired-flow desync would show up.
    const living = {
      ...stateWith({ co2_atm: 300, co2_cap: 0, co2_reg: 0, n2: 700, h2o_ice: 0, h2o_liq: 30, h2o_vap: 2, o2: 1, biomass: 0.3 }),
      seeded: true,
    };
    const grown = advance(living, 2000, cfg);

    // Now freeze it: suitability collapses and the biosphere respires away.
    const cold: SimConfig = { tuning: t, env: { sMultiplier: 0.2, albedoDelta: 0 }, forcing: null };
    const dyingFlows = computeStep(grown, derive(grown.reservoirs, cold.env, t), t, t.SUBSTEP_YEARS, null).flows;
    expect(dyingFlows.find((f) => f.id === "bio.decay_carbon")).toBeDefined();

    const end = advance(grown, 2000, cold);
    expect(end.reservoirs.biomass).toBeLessThan(grown.reservoirs.biomass);

    const drift = Math.abs(carbonInvariant(end) - carbonInvariant(living)) / carbonInvariant(living);
    expect(drift).toBeLessThan(CONSERVATION_REL_TOL);
  });
});

describe("the ledger identity is checked on the path every driver uses", () => {
  /**
   * Both production drivers - the headless harness and the browser loop - call
   * advance() directly, so an assertion living only in tick() never ran on any
   * path that actually drives the simulation. Batch 2's facility work relies
   * on this firing when an import is not double-entry, and that is exactly the
   * mistake a new rate module makes first.
   */
  it("advance() throws when a forcing creates mass without naming an account", () => {
    const smuggler: SimConfig = {
      tuning: t,
      env: NEUTRAL_ENV,
      forcing: () => [{ id: "forcing.co2_vent", from: null, to: "co2_atm", rate: 1, conversion: 1 }],
    };
    expect(() => advance(marsStart(), 400, smuggler)).toThrow(/carbon ledger drifted/);
  });

  it("advance() accepts the same import when it is double-entry", () => {
    const honest: SimConfig = {
      tuning: t,
      env: NEUTRAL_ENV,
      forcing: () => [
        { id: "forcing.n2_import", from: null, to: "n2", rate: 1, conversion: 1 },
        { id: "forcing.n2_import", from: null, to: "n2_imported", rate: 1, conversion: 1 },
      ],
    };
    const end = advance(marsStart(), 400, honest);
    expect(end.reservoirs.n2).toBeGreaterThan(90);
    expect(nitrogenInvariant(end)).toBeCloseTo(nitrogenInvariant(marsStart()), 6);
  });

  it("catches water appearing from nowhere too", () => {
    const comet: SimConfig = {
      tuning: t,
      env: NEUTRAL_ENV,
      forcing: () => [{ id: "forcing.h2o_import", from: null, to: "h2o_ice", rate: 1, conversion: 1 }],
    };
    expect(() => advance(marsStart(), 40, comet)).toThrow(/water ledger drifted/);
  });
});

/**
 * Batch 13: the tolerance is relative to the SIZE of the identity's terms.
 *
 * It used to be relative to the identity's net value, which is not what float
 * error scales with. Both tests below threw a SimInvariantError - in the
 * shipped browser loop, which does not catch one - on a ledger that was
 * exactly double-entry.
 */
describe("the ledger check does not cry wolf", () => {
  const honestImport: SimConfig = {
    tuning: t,
    env: NEUTRAL_ENV,
    forcing: () => [
      { id: "forcing.n2_import", from: null, to: "n2", rate: 1, conversion: 1 },
      { id: "forcing.n2_import", from: null, to: "n2_imported", rate: 1, conversion: 1 },
    ],
  };

  it("accepts an honest import into a world whose identity is exactly zero", () => {
    // A save with no nitrogen at all: the identity is 0, so ANY rounding
    // error was an infinite relative drift. Threw at substep 1 at 3.5e-18.
    const empty = { ...marsStart(), reservoirs: { ...marsStart().reservoirs, n2: 0, n2_reg: 0 } };
    expect(nitrogenInvariant(empty)).toBe(0);
    expect(() => advance(empty, 400, honestImport)).not.toThrow();
  });

  it("accepts an honest import once the imported total dwarfs the net identity", () => {
    // What ~211,000 sim-years of maxed imports looks like: terms of 1e9
    // cancelling to ~20. Rounding on terms that size is ~1e-7 mbar, which is
    // 5e-9 of the net identity and threw.
    const base = marsStart();
    const huge = {
      ...base,
      reservoirs: { ...base.reservoirs, n2: 1e9 + base.reservoirs.n2 },
      ledger: { ...base.ledger, n2_imported: base.ledger.n2_imported + 1e9 },
    };
    expect(() => advance(huge, 400, honestImport)).not.toThrow();
  });

  it("still catches a small leak on an ordinary world, so the new scale is not a blindfold", () => {
    // 0.01 mbar/yr of undeclared nitrogen for 100 years is 1 mbar against
    // terms of ~20: caught by a factor of about 5e7.
    const leak: SimConfig = {
      tuning: t,
      env: NEUTRAL_ENV,
      forcing: () => [{ id: "forcing.n2_import", from: null, to: "n2", rate: 0.01, conversion: 1 }],
    };
    expect(() => advance(marsStart(), 400, leak)).toThrow(/nitrogen ledger drifted/);
  });
});

describe("determinism", () => {
  /**
   * Fixing the step SIZE and deriving the COUNT means any decomposition of
   * the same elapsed time executes the identical sequence of floating-point
   * operations. That makes this an equality rather than a tolerance - and a
   * tolerance here would hide exactly the regressions it exists to catch.
   */
  it("one long run equals many short runs, EXACTLY", () => {
    const oneShot = advance(marsStart(), 4000, HOT);

    let chained = marsStart();
    for (let i = 0; i < 1000; i += 1) chained = advance(chained, 4, HOT);

    expect(chained.reservoirs).toEqual(oneShot.reservoirs);
    expect(chained.ledger).toEqual(oneShot.ledger);
    expect(chained.steps).toBe(oneShot.steps);
  });

  it("holds for uneven decompositions too", () => {
    const oneShot = advance(marsStart(), 1000, HOT);
    const uneven = advance(advance(advance(marsStart(), 377, HOT), 1, HOT), 622, HOT);
    expect(uneven.reservoirs).toEqual(oneShot.reservoirs);
  });

  it("produces identical results from identical inputs", () => {
    const a = advance(marsStart(), 2000, HOT);
    const b = advance(marsStart(), 2000, HOT);
    expect(a.reservoirs).toEqual(b.reservoirs);
  });
});

describe("purity", () => {
  it("does not mutate the state it is given", () => {
    const frozen = deepFreeze(marsStart());
    // Frozen objects throw on write in ES module strict mode, so a mutation
    // fails at the offending line rather than being inferred afterwards.
    expect(() => advance(frozen, 200, HOT)).not.toThrow();
  });

  it("leaves the input reservoirs byte-identical after a long run", () => {
    const start = marsStart();
    const snapshot = { ...start.reservoirs };
    advance(start, 4000, HOT);
    expect(start.reservoirs).toEqual(snapshot);
  });

  it("returns a state whose reservoirs are a different object", () => {
    const start = marsStart();
    const next = advance(start, 4, cfg);
    expect(next.reservoirs).not.toBe(start.reservoirs);
  });
});

describe("tuning variants are independent", () => {
  it("two tunings in the same process do not interfere", () => {
    const slow = makeTuning({ R_CAP: 0.1 });
    const fast = makeTuning({ R_CAP: 2.0 });
    const hotSlow = advance(marsStart(), 2000, { tuning: slow, env: HOT.env, forcing: null });
    const hotFast = advance(marsStart(), 2000, { tuning: fast, env: HOT.env, forcing: null });
    expect(hotFast.reservoirs.co2_cap).toBeLessThan(hotSlow.reservoirs.co2_cap);
    expect(DEFAULT_TUNING.R_CAP).toBe(0.8);
  });

  it("an override of undefined does not widen a constant to NaN", () => {
    const tuned = makeTuning({ R_CAP: undefined });
    expect(tuned.R_CAP).toBe(DEFAULT_TUNING.R_CAP);
    for (const key of RESERVOIR_KEYS) {
      expect(Number.isFinite(advance(marsStart(), 4, { tuning: tuned, env: NEUTRAL_ENV, forcing: null }).reservoirs[key])).toBe(true);
    }
  });
});

/**
 * Batch 14: the review of Batch 13's own fixes.
 */
describe("the ledger check is tight enough for the browser's one-substep calls", () => {
  // A late-game world: a thousand metres of water imported by comet and still
  // on the ground. Gross water terms ~2,040 m.
  const base = marsStart();
  const wet = {
    ...base,
    reservoirs: { ...base.reservoirs, h2o_ice: base.reservoirs.h2o_ice + 1000 },
    ledger: { ...base.ledger, h2o_imported: base.ledger.h2o_imported + 1000 },
  };
  // Natural water escape at the rate measured at year 1710 (5.7e-6 m/yr) -
  // once with its ledger leg, once with the leg dropped, which is the
  // regression Batch 13's looser tolerance let through on 1-substep calls.
  const escape = (withLedger: boolean): SimConfig => ({
    tuning: t,
    env: NEUTRAL_ENV,
    forcing: () => [
      { id: "forcing.h2o_import", from: "h2o_ice", to: withLedger ? "h2o_lost" : null, rate: 5.7e-6, conversion: 1 },
    ],
  });

  it("accepts the honest version, so the check is not simply refusing everything", () => {
    expect(() => advance(wet, 1, escape(true))).not.toThrow();
  });

  it("catches the same escape with its ledger leg dropped, in a single substep", () => {
    // 1.4e-6 m against ~2,040 m of terms is 7e-10: under the 1e-9 Batch 13
    // used, 700x over the 1e-12 it is now.
    expect(() => advance(wet, 1, escape(false))).toThrow(/water ledger drifted/);
  });
});

describe("a tied flow still respects its own source's rationing", () => {
  it("never overdraws c_fixed when something else is also drawing on it", () => {
    // Decay's carbon leg is tied to oxygen's rationing. Add a second consumer
    // of c_fixed and c_fixed is the account that runs short - following only
    // the tie drove it to -0.0017.
    const base = marsStart();
    const dying = {
      ...base,
      seeded: true,
      reservoirs: { ...base.reservoirs, biomass: 0.8, o2: 100 },
      ledger: { ...base.ledger, c_fixed: 0.01 },
    };
    const burial: SimConfig = {
      tuning: t,
      env: NEUTRAL_ENV,
      forcing: () => [{ id: "forcing.co2_scrub", from: "c_fixed", to: "c_lost", rate: 0.008, conversion: 1 }],
    };
    const once = advance(dying, 1, burial);
    // It really was over-requested: the account is emptied, not merely drawn on.
    expect(once.ledger.c_fixed).toBeLessThan(1e-12);
    expect(once.ledger.c_fixed).toBeGreaterThanOrEqual(0);
    expect(() => advance(once, 1, burial)).not.toThrow();
  });
});

describe("growth is paid for in carbon, even when the carbon is rationed", () => {
  // The Batch 13 open item: a tuning where a maxed scrubber and the biosphere
  // over-request co2_atm together. Latent at the shipped values.
  const tt = makeTuning({ CO2_FOR_LIFE: 0.005, R_BIO: 3 });
  const base = marsStart();
  let world = {
    ...base,
    seeded: true,
    reservoirs: {
      ...base.reservoirs, co2_atm: 0.05, co2_cap: 0, co2_reg: 0, h2o_ice: 0, h2o_liq: 20, n2: 700, o2: 150, biomass: 0.3,
    },
    ledger: { ...base.ledger, c_fixed: 50 },
  };
  world = buildFacility(world, "carbon_scrubber", 50, 5, tt);
  world = { ...world, facilities: world.facilities.map((f) => ({ ...f, deployed: 250 })) };
  const d = derive(world.reservoirs, worldEnv(world, NEUTRAL_ENV, tt), tt);
  const step = computeStep(world, d, tt, tt.SUBSTEP_YEARS, null);
  const rationed = applyFluxes(world.reservoirs, world.ledger, step.flows, tt.SUBSTEP_YEARS, tt).scale.get("co2_atm") ?? 1;
  const after = advance(world, 1, { tuning: tt, env: NEUTRAL_ENV, forcing: null });

  it("really does ration the carbon, or this proves nothing", () => {
    expect(rationed).toBeLessThan(1);
  });

  it("grows less than it would have with all the carbon it asked for", () => {
    // Measured: carbon cut 0.83%, and the biosphere grew the full 0.01504.
    expect(after.reservoirs.biomass - world.reservoirs.biomass).toBeLessThan(
      step.biomassNext - world.reservoirs.biomass,
    );
  });
});

describe("a NaN cannot leave advance() quietly", () => {
  const base = marsStart();
  const living = { ...base, seeded: true, reservoirs: { ...base.reservoirs, co2_atm: 100, h2o_liq: 20, n2: 400, o2: 50, biomass: 0.3 } };
  const poisoned = (key: "R_BIO" | "M_PHOTO"): SimConfig => ({ tuning: { ...t, [key]: Number.NaN }, env: NEUTRAL_ENV, forcing: null });

  it("refuses a NaN biomass made on the last substep of a call", () => {
    // Returned NaN from a 1-substep call; the next call threw on an unrelated
    // flow. Two guards now stand in the way - the photosynthesis demand check
    // fires first on this path, the end-of-call biomass check behind it - and
    // each was verified to catch it on its own by removing the other.
    expect(() => advance(living, 1, poisoned("R_BIO"))).toThrow(/not finite/);
  });

  it("refuses a NaN photosynthesis demand instead of silently skipping photosynthesis", () => {
    // Emitted no flow at all, so nothing downstream could see it.
    expect(() => advance(living, 1, poisoned("M_PHOTO"))).toThrow(/photosynthesis demand is not finite/);
  });
});
