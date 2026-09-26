/**
 * Batch 25's exit gate - detail doc §4.4, the forecast, checked against the
 * simulation:
 *
 *   - The predicted year of each crossing matches when the sim actually
 *     crosses it, within a measured tolerance, on a run at a steady rate.
 *   - The forecast responds to throttling: slowing the water pushes the
 *     predicted year later.
 *
 * The drowning fixture (Batch 24): the sea rises by a steady import of water.
 * The high city's base lies across a kink of the sea-level curve from where
 * the sea starts, which a straight line in metres cannot see.
 */

import { describe, expect, it } from "vitest";

import { siteElevation } from "../hypsometry.js";
import { advance, nextSubstepFlows } from "../integrate.js";
import { liquidWaterRate } from "../sea-level.js";
import { makeTuning } from "../tuning.js";
import type { SimConfig } from "../integrate.js";
import type { SimState } from "../types.js";
import { HIGH, LOW, channels, fixture, importWater, rising, t } from "../../testkit/flood.js";
import type { FloodForecast } from "./flood.js";
import { floodAlert, floodForecast, floodReading } from "./flood.js";

const START = fixture();
const BASES = [siteElevation(LOW.lat, LOW.lon, t), siteElevation(HIGH.lat, HIGH.lon, t)];
const H = t.SUBSTEP_YEARS;

/** The water import at `scale` of the fixture's. */
const at = (scale: number): SimConfig => ({ ...rising, forcing: () => importWater().map((f) => ({ ...f, rate: f.rate * scale })) });

const forecastOf = (s: SimState, cfg: SimConfig): (FloodForecast | null)[] => {
  const rate = liquidWaterRate(nextSubstepFlows(s, cfg));
  return s.settlements.map((c) => floodForecast(c, s.reservoirs, rate, t));
};

/**
 * Run the sea up and note, for each city, the years at which its base went under and at which it stood
 * FLOOD_THRESHOLD_M over it: the midpoint of the substep in which the sea crossed.
 */
function crossings(cfg: SimConfig, substeps: number): { base: number; lost: number }[] {
  const out = BASES.map(() => ({ base: NaN, lost: NaN }));
  let s = START;
  for (let i = 1; i <= substeps; i += 1) {
    s = advance(s, 1, cfg);
    const next = channels(s).seaLevelM;
    BASES.forEach((b, k) => {
      if (Number.isNaN(out[k]!.base) && next > b) out[k]!.base = (i - 0.5) * H;
      if (Number.isNaN(out[k]!.lost) && next - b >= t.FLOOD_THRESHOLD_M) out[k]!.lost = (i - 0.5) * H;
    });
  }
  return out;
}

const FULL = crossings(at(1), 500);
const HALF = crossings(at(0.5), 960);

describe("the forecast, against the simulation", () => {
  it("names the year of each crossing to within half a substep, the high city's across a kink", () => {
    const f = forecastOf(START, at(1));
    // Measured: within 0.069 sim-years of the middle of the substep the sea crossed in (a substep is 0.25).
    FULL.forEach((actual, k) => {
      expect(actual.base, `vacuity: city ${k} goes under`).toBeGreaterThan(0);
      expect(Math.abs(f[k]!.yearsToBase! - actual.base), `city ${k}: base`).toBeLessThan(0.125);
      expect(Math.abs(f[k]!.yearsToDestroy! - actual.lost), `city ${k}: lost`).toBeLessThan(0.125);
    });
    // The run does cross a kink: §4.4's straight line in metres, read at the start, misses the high city by
    // decades (measured: 58 sim-years late).
    const c = channels(START);
    const straight = (BASES[1]! - c.seaLevelM) / c.seaLevelRateMPerYear;
    expect(Math.abs(straight - FULL[1]!.base), "vacuity: a kink between the sea and the high city").toBeGreaterThan(20);
  });

  it("names the same year however close the sea has come", () => {
    // Asked again every 50 substeps on the way up, the high city's forecast year does not wander.
    // Measured: 114.94 to 115.00 sim-years in, against a crossing at 114.875.
    let s = START;
    for (let i = 0; i < 440; i += 1) {
      if (i % 50 === 0) {
        const year = i * H + forecastOf(s, at(1))[1]!.yearsToBase!;
        expect(Math.abs(year - FULL[1]!.base), `asked at substep ${i}`).toBeLessThan(0.25);
      }
      s = advance(s, 1, at(1));
    }
  });

  it("pushes every crossing later when the water is slowed - and is still right", () => {
    const full = forecastOf(START, at(1));
    const half = forecastOf(START, at(0.5));
    HALF.forEach((actual, k) => {
      expect(half[k]!.yearsToBase!, `city ${k}: later`).toBeGreaterThan(full[k]!.yearsToBase! * 1.5);
      expect(half[k]!.yearsToDestroy!, `city ${k}: later`).toBeGreaterThan(full[k]!.yearsToDestroy! * 1.5);
      // Measured: within 0.179 sim-years of the slowed run's own crossings.
      expect(Math.abs(half[k]!.yearsToBase! - actual.base), `city ${k}: base, slowed`).toBeLessThan(0.25);
      expect(Math.abs(half[k]!.yearsToDestroy! - actual.lost), `city ${k}: lost, slowed`).toBeLessThan(0.25);
    });
  });
});

describe("when the sea is not coming", () => {
  const low = START.settlements[0]!;

  it("forecasts nothing with the sea still or falling, and 0 once the sea is over the height", () => {
    expect(floodForecast(low, START.reservoirs, 0, t)).toEqual({ yearsToBase: null, yearsToDestroy: null });
    expect(floodForecast(low, START.reservoirs, -0.05, t)).toEqual({ yearsToBase: null, yearsToDestroy: null });
    const drowned = { ...START.reservoirs, h2o_liq: START.reservoirs.h2o_liq + 50 };
    expect(floodForecast(low, drowned, -0.05, t)).toEqual({ yearsToBase: 0, yearsToDestroy: 0 });
  });

  it("forecasts nothing for a ruin, with flooding off, or past what the ocean can ever cover", () => {
    expect(floodForecast({ ...low, lostAtSeaLevelM: -3000 }, START.reservoirs, 0.1, t)).toBeNull();
    const off = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    expect(floodForecast(low, START.reservoirs, 0.1, off)).toBeNull();
    // An ocean that saturates short of the low city's base (36.5% of the planet below it) never reaches it.
    const shallow = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12, FLOODING_ENABLED: 1, OCEAN_FRAC_MAX: 0.36 });
    expect(floodForecast(low, START.reservoirs, 0.1, shallow)).toEqual({ yearsToBase: null, yearsToDestroy: null });
    // Nor one whose ice holds the ground: at the most (85%) the sea may cover 15% of the planet, whatever water comes.
    const icy = { ...START.reservoirs, h2o_ice: START.reservoirs.h2o_ice + 1e4 };
    expect(floodForecast(low, icy, 0.1, t)).toEqual({ yearsToBase: null, yearsToDestroy: null });
  });
});

describe("the warning", () => {
  it("is raised within FLOOD_ALERT_YEARS of the sea's arrival, or inside the warning margin - and not before", () => {
    const warned = (s: SimState, k: number): boolean =>
      floodAlert(forecastOf(s, at(1))[k]!, floodReading(s.settlements[k]!, channels(s), t), t);
    // At the start: the low city is 5.4 years off (warned), the high one 114.9 (not yet).
    expect(warned(START, 0)).toBe(true);
    expect(warned(START, 1)).toBe(false);
    // The high city is warned once it is 50 years off (measured: 49.88) - long before the margin would warn it
    // (measured: 20 m under its base, the sea is 4.1 sim-years off).
    let s = START;
    let first = -1;
    for (let i = 0; i < 470 && first < 0; i += 1) {
      if (warned(s, 1)) first = i;
      s = advance(s, 1, at(1));
    }
    expect(FULL[1]!.base - first * H).toBeLessThanOrEqual(t.FLOOD_ALERT_YEARS + H);
    expect(FULL[1]!.base - first * H).toBeGreaterThan(t.FLOOD_ALERT_YEARS - 1);
  });
});
