import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { advance } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { DEFAULT_TUNING } from "../tuning.js";
import { metresFromVapourMbar, vapourMbarFromMetres } from "../units.js";
import type { Derived, Reservoirs } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { equilibriumVapour, pressureGate, sat, waterFlows } from "./water.js";

const t = DEFAULT_TUNING;

function derivedAt(overrides: Partial<Reservoirs>, T?: number): Derived {
  const r = { ...marsStart().reservoirs, ...overrides };
  const d = derive(r, NEUTRAL_ENV, t);
  return T === undefined ? d : { ...d, T };
}

describe("the metres <-> mbar bridge", () => {
  /**
   * The doc's H2O_MBAR_PER_M is 0.1, which is wrong by a factor of 371.
   * A hydrostatic column's pressure is rho*g*h, so one metre of water on Mars
   * is 1000 * 3.711 = 3711 Pa = 37.11 mbar. At 0.1, the entire 40 m inventory
   * is 4 mbar and the water-vapour feedback - one of section 4's three named
   * positive loops - does nothing at all.
   */
  it("is the physical value rho * g / 100", () => {
    expect(t.H2O_MBAR_PER_M).toBeCloseTo(37.11, 2);
  });

  it("round-trips exactly", () => {
    for (const metres of [0, 1e-6, 0.5, 40, 1000]) {
      expect(metresFromVapourMbar(vapourMbarFromMetres(metres, t), t)).toBeCloseTo(metres, 10);
    }
  });

  it("makes the full water inventory a climatically significant mass", () => {
    // 40 m of water is over a bar of vapour if it all evaporated, which is
    // why the vapour feedback matters and why condensation has to work.
    expect(vapourMbarFromMetres(40, t)).toBeGreaterThan(1000);
  });
});

describe("saturation curve", () => {
  it("is anchored at the triple point and matches Earth at 288 K", () => {
    expect(sat(t.T_FREEZE, t)).toBeCloseTo(6.112, 3);
    expect(sat(288, t)).toBeCloseTo(17.0, 0);
  });

  it("is monotonic increasing and bounded", () => {
    let previous = 0;
    for (let T = 150; T <= 800; T += 5) {
      const value = sat(T, t);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(Number.isFinite(value)).toBe(true);
      previous = value;
    }
    expect(sat(5000, t)).toBeLessThanOrEqual(t.SAT_MAX_MBAR);
  });

  it("cannot produce Infinity, which would make a vapour subtraction NaN", () => {
    expect(Number.isFinite(sat(1e9, t))).toBe(true);
    expect(Number.isFinite(sat(0, t))).toBe(true);
    expect(Number.isFinite(sat(-100, t))).toBe(true);
  });
});

describe("the triple point gate", () => {
  it("blocks melting in a near-vacuum and opens well above it", () => {
    expect(pressureGate(0, t)).toBe(0);
    expect(pressureGate(t.P_TRIPLE, t)).toBe(0);
    expect(pressureGate(t.P_TRIPLE + t.P_TRIPLE_W, t)).toBe(1);
    expect(pressureGate(500, t)).toBe(1);
  });

  it("is smooth, so the start state does not flicker across it every substep", () => {
    // The Mars start sits 0.11 mbar above the triple point. A hard cut there
    // is a coin toss; the smoothstep makes it a gradual opening.
    const atStart = pressureGate(6.21, t);
    expect(atStart).toBeGreaterThan(0);
    expect(atStart).toBeLessThan(0.05);
  });
});

describe("water flows", () => {
  it("melts only above freezing AND above the triple point", () => {
    const cold = waterFlows(marsStart().reservoirs, derivedAt({}, 250), t, 0.25);
    expect(cold.find((f) => f.id === "h2o.melt")?.rate ?? 0).toBe(0);

    // At the Mars start, P sits 0.11 mbar above the triple point, so the
    // smoothed gate is barely open: melting is suppressed by over 99%, not
    // switched off entirely. That gradual opening is the point of smoothing it.
    const warmButThin = waterFlows(marsStart().reservoirs, derivedAt({}, 290), t, 0.25);
    const warmAndThick = waterFlows(
      { ...marsStart().reservoirs, co2_atm: 300 },
      derivedAt({ co2_atm: 300 }, 290),
      t,
      0.25,
    );
    const thinMelt = warmButThin.find((f) => f.id === "h2o.melt")?.rate ?? 0;
    const thickMelt = warmAndThick.find((f) => f.id === "h2o.melt")?.rate ?? 0;
    expect(thickMelt).toBeGreaterThan(0);
    expect(thinMelt).toBeLessThan(0.01 * thickMelt);
  });

  it("sublimates ice straight to vapour when melting is gated off", () => {
    // Section 3.4 describes this path in prose and never writes it. Without
    // it, a thin-atmosphere world locks every water molecule in the caps.
    const flows = waterFlows(marsStart().reservoirs, derivedAt({}, 230), t, 0.25);
    const sublimate = flows.find((f) => f.id === "h2o.sublimate");
    expect(sublimate).toBeDefined();
    expect(sublimate?.rate ?? 0).toBeGreaterThan(0);
    expect(sublimate?.conversion).toBeCloseTo(t.H2O_MBAR_PER_M, 6);
  });

  it("condenses as SNOW below freezing and as rain above it", () => {
    const wet = { ...marsStart().reservoirs, h2o_vap: 50, h2o_liq: 10, co2_atm: 300 };
    const freezing = waterFlows(wet, derivedAt(wet, 250), t, 0.25);
    expect(freezing.find((f) => f.id === "h2o.snow")?.to).toBe("h2o_ice");

    const mild = { ...wet, h2o_vap: 500 };
    const raining = waterFlows(mild, derivedAt(mild, 290), t, 0.25);
    expect(raining.find((f) => f.id === "h2o.condense")?.to).toBe("h2o_liq");
  });

  it("does not boil the ocean away: vapour relaxes toward equilibrium, not upward forever", () => {
    // Section 3.4's unbounded `evaporate = E_RATE * sat(T)` runs at full rate
    // however much vapour is already aloft, so ocean_frac goes permanently to
    // zero and phases 4-6 become unreachable.
    const wet = { ...marsStart().reservoirs, h2o_liq: 30, co2_atm: 300, h2o_vap: 1e4 };
    const flows = waterFlows(wet, derivedAt(wet, 290), t, 0.25);
    expect(flows.find((f) => f.id === "h2o.evaporate")).toBeUndefined();
    expect(flows.find((f) => f.id === "h2o.condense")?.rate ?? 0).toBeGreaterThan(0);
  });

  it("cannot supersaturate a barren world", () => {
    /**
     * The sublimation path is the one place the section 3.4 rewrite could
     * reintroduce the bug it was written to remove: an unbounded vapour source
     * with no reference to how much is already aloft. Its only sink is the
     * relaxation toward `equilibriumVapour`, which is identically zero without
     * an ocean - so on a barren world (the opening of every playthrough) the
     * column ran to 25x saturation, pulled cloud cover to 0.19, albedo to
     * 0.287, and widened the ignition gap the player must close by 84%.
     *
     * Scaling the rate by a saturation deficit is not enough at this step
     * size; the AMOUNT has to be capped.
     */
    for (const steps of [8, 400, 4000, 16000]) {
      const state = advance(marsStart(), steps, { tuning: t, env: NEUTRAL_ENV, forcing: null });
      const d = derive(state.reservoirs, NEUTRAL_ENV, t);
      expect(state.reservoirs.h2o_vap).toBeLessThanOrEqual(sat(d.T, t));
    }
  });

  it("leaves the section 3.1 albedo anchor intact as the run proceeds", () => {
    // A spurious cloud deck shows up here first: the anchor is checked at t=0
    // in derive.test.ts, and nothing else would notice it drifting afterwards.
    const later = advance(marsStart(), 4000, { tuning: t, env: NEUTRAL_ENV, forcing: null });
    expect(derive(later.reservoirs, NEUTRAL_ENV, t).albedo).toBeCloseTo(0.25, 2);
  });

  it("equilibrium vapour needs an ocean to evaporate from", () => {
    expect(equilibriumVapour(derivedAt({ h2o_liq: 0 }, 290), t)).toBe(0);
    expect(equilibriumVapour(derivedAt({ h2o_liq: 50, co2_atm: 300 }, 290), t)).toBeGreaterThan(0);
  });

  it("carries the unit conversion on exactly one side of each flow", () => {
    const wet = { ...marsStart().reservoirs, h2o_liq: 30, co2_atm: 300 };
    for (const flow of waterFlows(wet, derivedAt(wet, 290), t, 0.25)) {
      const movesVapour = flow.from === "h2o_vap" || flow.to === "h2o_vap";
      if (movesVapour) {
        expect(flow.conversion).not.toBe(1);
      } else {
        expect(flow.conversion).toBe(1);
      }
    }
  });
});
