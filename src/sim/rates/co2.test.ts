import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { marsStart } from "../planets/mars.js";
import { DEFAULT_TUNING } from "../tuning.js";
import type { Derived } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { capRelease, co2Flows, regolithRelease } from "./co2.js";

const t = DEFAULT_TUNING;
const r = marsStart().reservoirs;

function atTemp(T: number): Derived {
  return { ...derive(r, NEUTRAL_ENV, t), T };
}

describe("the runaway engine only runs when the player has lit it", () => {
  /**
   * The single most important behavioural test in Batch 1.
   *
   * With the doc's bare sigmoid, release_cap at the Mars start is
   * 0.8 * sig(-0.488) = 0.304 mbar/yr - 38% of maximum - and an untouched
   * Mars empties its caps in about 130 sim-years. Section 0 calls the moment
   * the player pushes the planet past its tipping point "the emotional core
   * of the macro game", and the doc's own constants hand it over for free.
   */
  it("releases EXACTLY nothing at the Mars start temperature", () => {
    const d = derive(r, NEUTRAL_ENV, t);
    expect(d.T).toBeLessThan(t.T_SUBL_CAP);
    expect(capRelease(d, r, t)).toBe(0);
  });

  it("releases exactly nothing anywhere below the threshold", () => {
    for (const T of [150, 200, 210, 213.07, 215, 215.999, 216]) {
      expect(capRelease(atTemp(T), r, t)).toBe(0);
      expect(regolithRelease(atTemp(T), r, t)).toBe(0);
    }
  });

  it("ignites above the threshold and rises monotonically", () => {
    let previous = 0;
    for (let T = 216; T <= 260; T += 2) {
      const rate = capRelease(atTemp(T), r, t);
      expect(rate).toBeGreaterThanOrEqual(previous);
      previous = rate;
    }
    expect(capRelease(atTemp(240), r, t)).toBeGreaterThan(0.5);
  });

  it("never exceeds its rate constant", () => {
    for (let T = 200; T <= 600; T += 10) {
      expect(capRelease(atTemp(T), r, t)).toBeLessThanOrEqual(t.R_CAP);
      expect(regolithRelease(atTemp(T), r, t)).toBeLessThanOrEqual(t.R_REG);
    }
  });
});

describe("the two reservoirs are staged", () => {
  it("the caps ignite before the regolith", () => {
    expect(t.T_SUBL_CAP).toBeLessThan(t.T_SUBL_REG);
    const justAboveCaps = atTemp(t.T_SUBL_CAP + 5);
    expect(capRelease(justAboveCaps, r, t)).toBeGreaterThan(0);
    expect(regolithRelease(justAboveCaps, r, t)).toBe(0);
  });

  it("the regolith holds the larger reservoir - the slower second wave", () => {
    expect(r.co2_reg).toBeGreaterThan(r.co2_cap);
  });
});

describe("depletion", () => {
  it("eases to zero as a reservoir empties, with no discontinuity", () => {
    const hot = atTemp(280);
    const rates = [2, 1, 0.5, 0.1, 0.01, 0].map((co2_cap) => capRelease(hot, { ...r, co2_cap }, t));
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]).toBeLessThanOrEqual(rates[i - 1] ?? Infinity);
    }
    expect(rates[rates.length - 1]).toBe(0);
  });
});

describe("flows are paired, so conservation is structural", () => {
  it("every CO2 flow moves mass from a named source to a named sink", () => {
    for (const flow of co2Flows(r, atTemp(280), t)) {
      expect(flow.from).not.toBeNull();
      expect(flow.to).toBe("co2_atm");
      expect(flow.conversion).toBe(1);
      expect(flow.rate).toBeGreaterThanOrEqual(0);
    }
  });
});
