import { describe, expect, it } from "vitest";

import { derive, equilibriumTemp, greenhouseDelta, planetaryAlbedo, surfaceCover, totalPressure } from "./derive.js";
import { marsStart } from "./planets/mars.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { Reservoirs } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

const t = DEFAULT_TUNING;

describe("the design doc's own sanity anchors", () => {
  // Section 3.1: "S=590, albedo=0.25 gives T_eq ~= 210 K, which is Mars' real
  // mean temperature. The model is self-consistent at t=0."
  it("T_eq(590 W/m^2, albedo 0.25) = 210.17 K", () => {
    expect(equilibriumTemp(590, 0.25, t)).toBeCloseTo(210.1685, 3);
  });

  // Section 3.1: "At P = 1000 with no engineered GHG, dT_gh = 25 * ln(21) ~= 76 K"
  it("dT_gh(1000 mbar, no engineered GHG) = 76.11 K", () => {
    expect(greenhouseDelta(1000, 0, t)).toBeCloseTo(76.1131, 3);
  });

  /**
   * The third anchor, which the doc never states but which is the one that
   * actually catches a miscalibration.
   *
   * The 210 K anchor tests `equilibriumTemp` in isolation and passes for ANY
   * ice_frac mapping. Section 3.1's albedo of 0.25 plus section 3.2's formula
   * with A_ICE = 0.60 and A_BARE = 0.17 together FORCE
   * ice_frac(marsStart) = (0.25 - 0.17) / (0.60 - 0.17) = 0.186. If the
   * fraction maps drift, this fails and the isolated anchor above still passes.
   */
  it("albedo at the Mars start reproduces the 0.25 the anchor assumes", () => {
    const d = derive(marsStart().reservoirs, NEUTRAL_ENV, t);
    expect(d.albedo).toBeCloseTo(0.25, 2);
    expect(d.iceFrac).toBeCloseTo(0.186, 2);
    expect(d.tEq).toBeCloseTo(210.15, 1);
  });

  it("the Mars start is cold, thin and below the cap ignition threshold", () => {
    const d = derive(marsStart().reservoirs, NEUTRAL_ENV, t);
    expect(d.P).toBeCloseTo(6.21, 2);
    expect(d.T).toBeLessThan(t.T_SUBL_CAP);
    expect(d.T).toBeGreaterThan(205);
  });
});

describe("surface cover is disjoint by construction", () => {
  const cases: readonly Partial<Reservoirs>[] = [
    {},
    { h2o_ice: 1e6, h2o_liq: 1e6, biomass: 1 },
    { h2o_liq: 500, biomass: 1 },
    { h2o_ice: 0, h2o_liq: 0, co2_cap: 0, biomass: 1 },
    { h2o_ice: 1e9, co2_cap: 1e9 },
  ];

  it("the four fractions always sum to exactly 1", () => {
    for (const override of cases) {
      const r = { ...marsStart().reservoirs, ...override };
      const cover = surfaceCover(r, t);
      const sum = cover.iceFrac + cover.oceanFrac + cover.vegFrac + cover.bareFrac;
      expect(sum).toBeCloseTo(1, 12);
      expect(cover.iceFrac).toBeGreaterThanOrEqual(0);
      expect(cover.oceanFrac).toBeGreaterThanOrEqual(0);
      expect(cover.vegFrac).toBeGreaterThanOrEqual(0);
      expect(cover.bareFrac).toBeGreaterThanOrEqual(0);
    }
  });

  it("albedo stays inside its bounds even on an all-ice ocean world", () => {
    for (const override of cases) {
      const r = { ...marsStart().reservoirs, ...override };
      const cover = surfaceCover(r, t);
      const albedo = planetaryAlbedo(cover, 1, NEUTRAL_ENV, t);
      expect(albedo).toBeGreaterThanOrEqual(t.ALBEDO_MIN);
      expect(albedo).toBeLessThanOrEqual(t.ALBEDO_MAX);
      expect(Number.isFinite(equilibriumTemp(590, albedo, t))).toBe(true);
    }
  });
});

describe("derive never produces a non-finite value", () => {
  it("survives the all-zero reservoir vector", () => {
    const zero = Object.fromEntries(
      Object.keys(marsStart().reservoirs).map((k) => [k, 0]),
    ) as unknown as Reservoirs;
    const d = derive(zero, NEUTRAL_ENV, t);
    expect(Number.isFinite(d.T)).toBe(true);
    expect(Number.isFinite(d.albedo)).toBe(true);
    expect(d.P).toBe(0);
    expect(d.T).toBeGreaterThan(t.T_FLOOR_K);
  });

  it("survives one-hot vectors and absurd comet imports", () => {
    const keys = Object.keys(marsStart().reservoirs);
    for (const key of keys) {
      for (const magnitude of [1e-12, 1, 1e6, 1e12]) {
        const zero = Object.fromEntries(keys.map((k) => [k, 0])) as unknown as Reservoirs;
        const r = { ...zero, [key]: magnitude } as Reservoirs;
        const d = derive(r, NEUTRAL_ENV, t);
        expect(Number.isFinite(d.T)).toBe(true);
        expect(Number.isFinite(d.tEq)).toBe(true);
        expect(Number.isFinite(d.dTgh)).toBe(true);
        expect(d.T).toBeGreaterThanOrEqual(t.T_FLOOR_K);
        expect(d.T).toBeLessThanOrEqual(t.T_CEIL_K);
      }
    }
  });

  it("survives a negative reservoir without producing NaN", () => {
    // Should never happen, but a NaN here would be written to the save as null.
    const r = { ...marsStart().reservoirs, co2_atm: -50, h2o_ice: -10 };
    const d = derive(r, NEUTRAL_ENV, t);
    expect(Number.isFinite(d.T)).toBe(true);
    expect(d.P).toBeGreaterThanOrEqual(0);
  });

  it("survives a solar shade stack that would take S_eff to zero", () => {
    const d = derive(marsStart().reservoirs, { sMultiplier: 0, albedoDelta: 0 }, t);
    expect(Number.isFinite(d.T)).toBe(true);
    expect(d.sEff).toBeGreaterThanOrEqual(t.S_EFF_MIN);
  });
});

describe("greenhouse shape", () => {
  it("is concave in pressure - warming per added mbar falls off", () => {
    // This is section 4's named negative feedback and the reason the late
    // game does not cook itself. The correct statement is concavity: the same
    // ADDED PRESSURE buys less warming the thicker the atmosphere already is.
    const delta = 50;
    let previous = Infinity;
    for (const P of [50, 100, 200, 400, 800]) {
      const gain = greenhouseDelta(P + delta, 0, t) - greenhouseDelta(P, 0, t);
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThan(previous);
      previous = gain;
    }
  });

  it("approaches a fixed increment per DOUBLING, from below, never exceeding it", () => {
    // ln(1 + P/P_REF) is near-linear while P << P_REF, so early doublings buy
    // less than the asymptote rather than more. The ceiling is what matters:
    // no doubling can ever be worth more than C_GH * ln(2) = 17.33 K.
    const ceiling = t.C_GH * Math.LN2;
    let previous = 0;
    for (const P of [50, 100, 200, 400, 800, 1600, 3200]) {
      const gain = greenhouseDelta(2 * P, 0, t) - greenhouseDelta(P, 0, t);
      expect(gain).toBeLessThan(ceiling);
      expect(gain).toBeGreaterThan(previous);
      previous = gain;
    }
    expect(greenhouseDelta(2e6, 0, t) - greenhouseDelta(1e6, 0, t)).toBeCloseTo(ceiling, 2);
  });

  it("gives engineered GHG a large effect per mbar at low pressure", () => {
    const withoutGhg = greenhouseDelta(6.21, 0, t);
    const withGhg = greenhouseDelta(7.21, 1, t);
    expect(withGhg - withoutGhg).toBeGreaterThan(5);
  });

  it("does not run away on a pure-PFC atmosphere", () => {
    // The doc's multiplicative form gives 471 K here - Venus in one project.
    const d = derive({ ...marsStart().reservoirs, ghg: 20, co2_atm: 0 }, NEUTRAL_ENV, t);
    expect(d.T).toBeLessThan(300);
  });

  it("respects N2_GREENHOUSE_WEIGHT", () => {
    const r = { ...marsStart().reservoirs, n2: 800 };
    const full = derive(r, NEUTRAL_ENV, makeTuning({ N2_GREENHOUSE_WEIGHT: 1 }));
    const broadening = derive(r, NEUTRAL_ENV, makeTuning({ N2_GREENHOUSE_WEIGHT: 0.3 }));
    expect(full.T).toBeGreaterThan(broadening.T);
    expect(full.P).toBeCloseTo(broadening.P, 10);
  });
});

describe("totalPressure", () => {
  it("sums only the atmospheric components", () => {
    const r = marsStart().reservoirs;
    expect(totalPressure(r)).toBeCloseTo(r.co2_atm + r.n2 + r.o2 + r.h2o_vap + r.ghg, 12);
  });

  it("ignores the frozen and adsorbed reservoirs", () => {
    const a = totalPressure(marsStart().reservoirs);
    const b = totalPressure({ ...marsStart().reservoirs, co2_cap: 9999, co2_reg: 9999, n2_reg: 9999 });
    expect(a).toBeCloseTo(b, 12);
  });
});
