/**
 * Batch 23's exit gate:
 *
 *   - Sea level is monotonic in `ocean_frac` and matches the globe: the share
 *     of the planet below `sea_level_m` equals `ocean_frac` within a measured
 *     tolerance.
 *   - The rate agrees with the change in `sea_level_m` over a real `advance`,
 *     within a measured tolerance.
 *   - No existing gate moves. This is a derived output only.
 *
 * The third is held by the rest of the suite - the golden run, the Batch 3
 * score, determinism and the golden frames all pass untouched - and by the
 * check below that the new input moves nothing but the sea.
 */

import { describe, expect, it } from "vitest";

import { REFERENCE_POLICY, applyOrdersDue } from "../harness/policy.js";
import { surfaceCover } from "./derive.js";
import { derive } from "./derive.js";
import { incomeRate } from "./economy.js";
import { habitat } from "./habitat.js";
import { siteElevation } from "./hypsometry.js";
import { advance, nextSubstepFlows, worldEnv } from "./integrate.js";
import { marsStart } from "./planets/mars.js";
import { computeStep } from "./rates/index.js";
import { liquidWaterRate, seaLevel } from "./sea-level.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { Reservoirs, SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

const t = DEFAULT_TUNING;

/** A Mars with exactly enough liquid water for an ocean fraction of `ocean`. */
function withOcean(ocean: number): Reservoirs {
  const base = marsStart().reservoirs;
  const liquid = -t.OCEAN_M_REF * Math.log(1 - ocean / t.OCEAN_FRAC_MAX);
  // No ice, so the ocean is never capped by 1 - iceFrac (measured: the cap
  // never binds on the reference run either).
  return { ...base, h2o_liq: liquid, h2o_ice: 0, co2_cap: 0 };
}

describe("sea level from the ocean", () => {
  it("rises with the ocean, and never falls as it grows", () => {
    let last = -Infinity;
    for (let i = 1; i <= 740; i += 1) {
      const m = seaLevel(withOcean(i / 1000), t, 0).m;
      expect(m, `ocean ${i / 1000}`).toBeGreaterThan(last);
      last = m;
    }
  });

  it("puts exactly the ocean fraction of the planet under water", () => {
    // Independent of the rank table: 8,000 uniformly random places, their own
    // generator. Measured at nine ocean fractions: at most 0.008 off (binomial
    // sigma near 0.36 is 0.0054). 0.02 is ~2.5 sigma of that worst case.
    let s = 4242;
    const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
    const elevations = Array.from({ length: 8000 }, () => siteElevation(Math.asin(2 * rnd() - 1), (rnd() * 2 - 1) * Math.PI, t));
    for (const target of [0.02, 0.05, 0.12, 0.2, 0.3, 0.364, 0.5, 0.65, 0.74]) {
      const r = withOcean(target);
      const ocean = surfaceCover(r, t).oceanFrac;
      const sea = seaLevel(r, t, 0).m;
      const share = elevations.filter((e) => e < sea).length / elevations.length;
      expect(Math.abs(share - ocean), `ocean ${target}`).toBeLessThan(0.02);
    }
  });
});

describe("the rate the sea level moves at", () => {
  /**
   * The reference playthrough, substep by substep, for its first 1,200
   * years, with the seeded weather on - as the browser runs it. The first
   * water arrives near year 273, the ocean crosses two kinks of the curve
   * (ranks 1/8 and 2/8), and rain condenses into the sea from year 275: the
   * one water flow that crosses units (mbar to metres). With the weather off
   * it does not fall until year 2200, and a first version of this survey,
   * weather off, could not tell a flow that lost its unit conversion.
   */
  function survey(): { moving: number; crossings: number; condensing: number; worstAway: number; worstAwayYear: number; last: SimState } {
    const tw = makeTuning({ EVENTS_ENABLED: 1 });
    const cfg = { tuning: tw, env: NEUTRAL_ENV, forcing: null };
    let s = marsStart();
    const applied = new Set<number>();
    let moving = 0;
    let crossings = 0;
    let condensing = 0;
    let worstAway = 0;
    let worstAwayYear = 0;
    for (let i = 0; i < 1200 * 4; i += 1) {
      const year = i * tw.SUBSTEP_YEARS;
      s = applyOrdersDue(s, REFERENCE_POLICY, year, applied, tw);
      // The very flows the next substep of `advance` integrates, weather and all.
      const flows = nextSubstepFlows(s, cfg);
      if (flows.some((f) => f.id === "h2o.condense" && f.rate > 0)) condensing += 1;
      const now = seaLevel(s.reservoirs, tw, liquidWaterRate(flows));
      const next = advance(s, 1, cfg);
      const actual = seaLevel(next.reservoirs, tw, 0).m - now.m;
      const segment = (r: Reservoirs): number => Math.floor(surfaceCover(r, tw).oceanFrac * 8);
      if (segment(next.reservoirs) !== segment(s.reservoirs)) crossings += 1;
      else if (Math.abs(actual) > 1e-9) {
        moving += 1;
        const rel = Math.abs(actual - now.ratePerYear * tw.SUBSTEP_YEARS) / Math.abs(actual);
        if (rel > worstAway) {
          worstAway = rel;
          worstAwayYear = year;
        }
      }
      s = next;
    }
    return { moving, crossings, condensing, worstAway, worstAwayYear, last: s };
  }

  const found = survey();

  it("predicts each substep's rise from the flows, away from the curve's kinks", () => {
    // Measured, weather on: the worst substep off by 0.104% at year 365.25
    // (the ocean's exponential curving within a quarter-year; weather off it
    // was the same 0.104%, at year 320). 0.5% is five times that.
    expect(found.worstAway, `worst at year ${found.worstAwayYear}`).toBeLessThan(0.005);
  });

  it("really did track a moving sea, across the curve's kinks - the check is not vacuous", () => {
    // Measured: two kink crossings (the only substeps off by more than 1%:
    // the rate is the slope of the segment the ocean starts the step in).
    // The sea first moves near year 273, so these 1,200 years hold 3,695
    // moving substeps; rain fell into the sea on 1,475 of them.
    expect(found.crossings).toBe(2);
    expect(found.moving).toBeGreaterThan(3000);
    expect(found.condensing).toBeGreaterThan(1000);
  });

  it("sees the first water: an empty sea starts rising at once, not a substep late", () => {
    const empty = { ...marsStart().reservoirs, h2o_liq: 0 };
    expect(seaLevel(empty, t, 0.5).ratePerYear).toBeGreaterThan(0);
    // Draining an empty sea moves nothing.
    expect(seaLevel(empty, t, -0.5).ratePerYear).toBe(0);
  });

  it("moves nothing but the sea: the rest of the contract ignores the water rate", () => {
    // A living world - 1,200 years into the reference run, with an ocean and
    // every habitat gate part-open - so a leak into any other channel shows.
    // (A first version used a dead planet, where the gates sit flat at zero,
    // and a water rate leaking into support passed it.)
    const s = found.last;
    const d = derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t);
    expect(d.oceanFrac).toBeGreaterThan(0.1);
    const calm = habitat(s.reservoirs, d, t, 0);
    const rising = habitat(s.reservoirs, d, t, 50);
    expect({ ...rising, seaLevelRateMPerYear: 0 }).toEqual({ ...calm, seaLevelRateMPerYear: 0 });
    expect(rising.seaLevelRateMPerYear).not.toBe(calm.seaLevelRateMPerYear);
    const econ = makeTuning({ ECONOMY_ENABLED: 1 });
    expect(incomeRate(habitat(s.reservoirs, d, econ, 50), econ)).toBe(incomeRate(habitat(s.reservoirs, d, econ, 0), econ));
  });
});
