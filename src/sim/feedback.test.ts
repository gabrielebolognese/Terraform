/**
 * Design doc section 4 - the feedback loop map, tested as behaviour.
 *
 * Section 4 is the only part of the doc that is pure prose with no equations,
 * and it is also the part that determines whether the game has an S-curve at
 * all. Each arrow gets one test: perturb the tail of the arrow, assert the
 * SIGN of the change at the head. Signs, not magnitudes - magnitudes are the
 * balance batch's business, and asserting them here would make every retune
 * look like a regression.
 */

import { describe, expect, it } from "vitest";

import { LOOP_TEST_EPS } from "../testkit/helpers.js";
import { derive, greenhouseDelta } from "./derive.js";
import { marsStart } from "./planets/mars.js";
import { capRelease } from "./rates/co2.js";
import { biomassStep, suitability } from "./rates/biomass.js";
import { lossFlows } from "./rates/loss.js";
import { equilibriumVapour, waterFlows } from "./rates/water.js";
import { DEFAULT_TUNING } from "./tuning.js";
import type { Reservoirs } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

const t = DEFAULT_TUNING;

/** A warm mid-game world where every loop is actually live. */
const MIDGAME: Reservoirs = {
  ...marsStart().reservoirs,
  co2_atm: 220,
  co2_cap: 10,
  co2_reg: 120,
  h2o_ice: 20,
  h2o_liq: 12,
  h2o_vap: 1.5,
  o2: 8,
  biomass: 0.2,
};

/**
 * A late-game world above freezing, for the loops that only exist once there
 * is liquid water and a biosphere. MIDGAME above sits at 248 K, where melting
 * and photosynthesis are both correctly switched off.
 */
const WARM_WET: Reservoirs = {
  ...marsStart().reservoirs,
  co2_atm: 300,
  co2_cap: 0,
  co2_reg: 0,
  n2: 700,
  n2_reg: 0,
  h2o_ice: 10,
  h2o_liq: 20,
  h2o_vap: 2,
  o2: 8,
  biomass: 0.2,
};

const d = (r: Reservoirs) => derive(r, NEUTRAL_ENV, t);

describe("positive loops - the engine of the accelerating middle", () => {
  it("T up -> CO2 release up (the runaway)", () => {
    const base = d(MIDGAME);
    const warmer = { ...base, T: base.T + 1 };
    expect(capRelease(warmer, MIDGAME, t)).toBeGreaterThan(capRelease(base, MIDGAME, t));
  });

  it("co2_atm up -> P up -> dT_gh up -> T up (the loop closes)", () => {
    const before = d(MIDGAME);
    const after = d({ ...MIDGAME, co2_atm: MIDGAME.co2_atm + 10 });
    expect(after.P).toBeGreaterThan(before.P);
    expect(after.dTgh).toBeGreaterThan(before.dTgh);
    expect(after.T).toBeGreaterThan(before.T);
  });

  it("T up -> ice melts (ice-albedo, first half)", () => {
    const base = d(WARM_WET);
    const meltAt = (T: number): number =>
      waterFlows(WARM_WET, { ...base, T }, t, 0.25).find((f) => f.id === "h2o.melt")?.rate ?? 0;
    expect(meltAt(274)).toBeGreaterThan(0);
    expect(meltAt(276)).toBeGreaterThan(meltAt(274));
    expect(meltAt(272)).toBe(0);
  });

  it("ice down -> albedo down -> T_eq up (ice-albedo, second half)", () => {
    const icy = d({ ...MIDGAME, h2o_ice: 40, co2_cap: 40 });
    const bare = d({ ...MIDGAME, h2o_ice: 1, co2_cap: 0 });
    expect(bare.iceFrac).toBeLessThan(icy.iceFrac);
    expect(bare.albedo).toBeLessThan(icy.albedo);
    expect(bare.tEq).toBeGreaterThan(icy.tEq);
  });

  it("T up -> evaporation up (water vapour, first half)", () => {
    const base = d(MIDGAME);
    expect(equilibriumVapour({ ...base, T: base.T + 5 }, t)).toBeGreaterThan(equilibriumVapour(base, t));
  });

  it("h2o_vap up -> P up and T up (water vapour, second half)", () => {
    const before = d(MIDGAME);
    const after = d({ ...MIDGAME, h2o_vap: MIDGAME.h2o_vap + 5 });
    expect(after.P).toBeGreaterThan(before.P);
    expect(after.dTgh).toBeGreaterThan(before.dTgh);
  });
});

describe("negative loops - the brakes that produce the plateau", () => {
  it("dT_gh saturates logarithmically: warming per added mbar falls off", () => {
    const early = greenhouseDelta(100, 0, t) - greenhouseDelta(50, 0, t);
    const late = greenhouseDelta(1050, 0, t) - greenhouseDelta(1000, 0, t);
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0);
  });

  it("biomass up -> more CO2 consumed -> less greenhouse (the biosphere self-regulates)", () => {
    const drawAt = (biomass: number): number => {
      const r = { ...WARM_WET, biomass };
      const photo = biomassStep(r, d(r), t, 1, true).flows.find((f) => f.id === "bio.photosynthesis");
      return photo?.rate ?? 0;
    };
    expect(drawAt(0.2)).toBeGreaterThan(0);
    expect(drawAt(0.4)).toBeGreaterThan(drawAt(0.2));

    // And the carbon it removes really does cool the planet.
    const rich = { ...WARM_WET, co2_atm: WARM_WET.co2_atm - 50 };
    expect(d(rich).dTgh).toBeLessThan(d(WARM_WET).dTgh);
  });

  it("o2 fraction up past the fire threshold -> suitability down (oxygen self-limits)", () => {
    const safe = { ...MIDGAME, o2: 10, n2: 500, co2_atm: 220 };
    const burning = { ...MIDGAME, o2: 400, n2: 0, co2_atm: 220 };
    expect(suitability(burning, d(burning), t).gTox).toBeLessThan(suitability(safe, d(safe), t).gTox);
  });

  it("P up -> absolute atmospheric loss up (the slow bleed)", () => {
    const thin = lossFlows(MIDGAME, 0, t, 1).find((f) => f.id === "loss.co2_atm")?.rate ?? 0;
    const thick = lossFlows({ ...MIDGAME, co2_atm: 900 }, 0, t, 1).find((f) => f.id === "loss.co2_atm")?.rate ?? 0;
    expect(thick).toBeGreaterThan(thin);
  });

  it("the magnetic shield cancels the bleed (section 3.7's capstone)", () => {
    const unshielded = lossFlows(MIDGAME, 0, t, 1).find((f) => f.id === "loss.co2_atm")?.rate ?? 0;
    const shielded = lossFlows(MIDGAME, 1, t, 1).find((f) => f.id === "loss.co2_atm")?.rate ?? 0;
    expect(unshielded).toBeGreaterThan(0);
    expect(shielded).toBe(0);
  });

  it("clouds brake the warming they come from", () => {
    // More vapour is both greenhouse (warming) and cloud (cooling). The cloud
    // term must actually be present, or the late game has no brake at all.
    const dry = d({ ...MIDGAME, h2o_vap: 0.01 });
    const humid = d({ ...MIDGAME, h2o_vap: 8 });
    expect(humid.cloudFrac).toBeGreaterThan(dry.cloudFrac);
    expect(humid.albedo).toBeGreaterThan(dry.albedo);
  });
});

describe("loop sensitivity is smooth, not switch-like", () => {
  it("a tiny perturbation produces a tiny, same-signed response", () => {
    const base = d(MIDGAME);
    const nudged = d({ ...MIDGAME, co2_atm: MIDGAME.co2_atm + LOOP_TEST_EPS });
    expect(nudged.T - base.T).toBeGreaterThan(0);
    expect(nudged.T - base.T).toBeLessThan(0.01);
  });
});
