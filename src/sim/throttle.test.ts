/**
 * Batch 38 - the throttle link (detail §4.5, BUILD_PLAN §Batch 28): "a
 * forecast that shows how much time slowing the water buys", held to the
 * exit gate's "the flood-crossing year with the defence minus without,
 * measured through a real advance".
 *
 * The reference arc at year 290, the burst's start (the sea at -7,612 m and
 * rising some 80 m a year), three cities founded at -6,000, -5,000 and
 * -4,400 m. Switching every facility off then, and leaving them on, each run
 * through `advance` with the cities in it until the sea takes them.
 */

import { describe, expect, it } from "vitest";

import { terraformedMars } from "../harness/example.js";
import { siteElevation } from "./hypsometry.js";
import { advance } from "./integrate.js";
import { foundSettlement } from "./micro/registry.js";
import { throttleForecast } from "./throttle.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

const t = makeTuning({ SETTLEMENTS_ENABLED: 1, FLOODING_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };

/** The site nearest each height, from a fixed spiral of the planet. */
function sitesAt(heights: readonly number[]): { lat: number; lon: number; m: number }[] {
  return heights.map((want) => {
    let best: { lat: number; lon: number; m: number } | null = null;
    for (let i = 0; i < 4000; i += 1) {
      const lat = Math.asin(((i * 0.618034) % 1) * 1.8 - 0.9);
      const lon = ((i * 0.754877) % 1) * 2 * Math.PI - Math.PI;
      const m = siteElevation(lat, lon, t);
      if (best === null || Math.abs(m - want) < Math.abs(best.m - want)) best = { lat, lon, m };
    }
    return best!;
  });
}

const START: SimState = (() => {
  let s = terraformedMars(DEFAULT_TUNING, 290);
  for (const x of sitesAt([-6000, -5000, -4400])) s = foundSettlement(s, "city", x.lat, x.lon, t).state;
  return s;
})();
const IDS = START.settlements.map((s) => s.id);
const off = (s: SimState): SimState => ({ ...s, facilities: s.facilities.map((f) => ({ ...f, enabled: false })) });

/** Sim-years from the start to each city's fall, through a real advance with the cities in it. */
function falls(start: SimState): (number | null)[] {
  let s = start;
  const when: (number | null)[] = start.settlements.map(() => null);
  for (let i = 1; i <= Math.round(t.THROTTLE_HORIZON_YEARS / t.SUBSTEP_YEARS) && when.includes(null); i += 1) {
    s = advance(s, 1, cfg);
    s.settlements.forEach((c, k) => {
      if (when[k] === null && c.lostAtSeaLevelM !== null) when[k] = i * t.SUBSTEP_YEARS;
    });
  }
  return when;
}

describe("throttling the planet buys the threatened cities time (detail §4.5)", () => {
  const forecast = throttleForecast(START, cfg, IDS);
  const asIs = falls(START);
  const throttled = falls(off(START));

  it("buys measured time through a real advance: switching the facilities off holds each city years longer", () => {
    expect(START.settlements.map((s) => Math.round(siteElevation(s.lat, s.lon, t)))).toEqual([-6002, -5001, -4401]);
    // Measured: the cities fall 17.5, 25.25 and 38.75 years on as things are; 25.25, 45 and 86.75 with every
    // facility switched off at year 290 - 7.75, 19.75 and 48 years bought.
    expect(asIs).toEqual([17.5, 25.25, 38.75]);
    expect(throttled).toEqual([25.25, 45, 86.75]);
  });

  it("forecasts it: each city's loss either way to a substep, and the time bought exactly", () => {
    IDS.forEach((id, k) => {
      const r = forecast.get(id)!;
      // The projection names the substep the sea crosses; the city is lost on the next (it reads the sea the substep began with).
      expect(asIs[k]! - r.asIsYears!, `${id} as is`).toBeCloseTo(t.SUBSTEP_YEARS, 9);
      expect(throttled[k]! - r.throttledYears!, `${id} throttled`).toBeCloseTo(t.SUBSTEP_YEARS, 9);
      expect(r.throttledYears! - r.asIsYears!).toBeCloseTo(throttled[k]! - asIs[k]!, 9);
    });
  });

  it("counts a city's Seawall: walled, its loss comes later both ways", () => {
    const walled: SimState = { ...START, settlements: START.settlements.map((s, k) => (k === 0 ? { ...s, buildings: [...s.buildings, { type: "seawall", tx: 2, ty: 0, level: 8 }] } : s)) };
    const r = throttleForecast(walled, cfg, IDS).get(IDS[0]!)!;
    expect(r.asIsYears!).toBeGreaterThan(forecast.get(IDS[0]!)!.asIsYears!);
    expect(r.throttledYears!).toBeGreaterThan(forecast.get(IDS[0]!)!.throttledYears!);
  });

  it("says nothing with nothing to throttle, with flooding off, or for a city the sea has passed - and is pure", () => {
    expect(forecast.size).toBe(3);
    expect(throttleForecast(off(START), cfg, IDS).size).toBe(0);
    expect(throttleForecast(START, { ...cfg, tuning: makeTuning({ ...t, FLOODING_ENABLED: 0 }) }, IDS).size).toBe(0);
    // Twenty years on the sea has passed the -6,000 m city - still standing, held by a grace - so it is left out,
    // the others are not. (A city already lost is left out by that alone: the test first used one, and passed
    // with the rule it is for removed.)
    const held: SimState = { ...START, settlements: START.settlements.map((s, k) => (k === 0 ? { ...s, floodGraceYears: 1000 } : s)) };
    const later = advance(held, 80, cfg);
    expect(later.settlements[0]!.lostAtSeaLevelM).toBeNull();
    expect([...throttleForecast(later, cfg, IDS).keys()]).toEqual(IDS.slice(1));
    const again = throttleForecast(START, cfg, IDS);
    expect([...again]).toEqual([...forecast]);
  });
});
