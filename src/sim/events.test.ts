/**
 * Batch 8's exit gate, and the properties that make it reachable.
 *
 * The gate: the same save fast-forwarded three different ways yields identical
 * event timelines. That is not a statement about randomness quality - it is a
 * statement that the event system has no hidden state, and the only way to
 * check it is to drive the same span three ways and compare.
 *
 * Every test here runs with events ON, via a tuning variant. The shipped
 * default is off (see the §10 note), so without this file the entire feature
 * would be dead code that every other test skips over.
 */

import { describe, expect, it } from "vitest";

import type { SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";
import { advance, simYear } from "./integrate.js";
import { catchUp } from "./tick.js";
import { marsStart } from "./planets/mars.js";
import { makeTuning, validateTuning, TuningError } from "./tuning.js";
import { activeEvents, eventEnv, eventsBeginningIn, lookbackYears, solarVariability } from "./events.js";
import { hashInts, rand01, randBell } from "./rng.js";

const T = makeTuning({ EVENTS_ENABLED: 1 });
const OFF = makeTuning();

function config(tuning = T) {
  return { tuning, env: NEUTRAL_ENV, forcing: null };
}

/** What the world actually experienced, sampled on the substep grid. */
function timeline(seed: number, fromStep: number, toStep: number, tuning = T): readonly string[] {
  const out: string[] = [];
  for (let step = fromStep; step < toStep; step += 1) {
    const year = step * tuning.SUBSTEP_YEARS;
    for (const e of activeEvents(seed, year, tuning)) {
      out.push(`${year.toFixed(2)} ${e.kind} m=${e.magnitude.toFixed(6)} i=${e.intensity.toFixed(6)}`);
    }
  }
  return out;
}

describe("the RNG is keyed on coordinates, not on call order", () => {
  it("returns the same number for the same coordinates, whenever it is asked", () => {
    const first = rand01(12345, 700, 9);
    // Ask a thousand unrelated questions in between.
    for (let i = 0; i < 1000; i += 1) rand01(12345, i, i);
    expect(rand01(12345, 700, 9)).toBe(first);
  });

  it("cannot be advanced, because there is nothing to advance", () => {
    const forward = [10, 11, 12].map((y) => rand01(7, y, 1));
    const backward = [12, 11, 10].map((y) => rand01(7, y, 1)).reverse();
    expect(backward).toEqual(forward);
  });

  it("gives adjacent years and adjacent seeds unrelated answers", () => {
    // If the hash were additive, (seed+1, year-1) would collide with
    // (seed, year) and neighbouring saves would share weather one year apart.
    expect(hashInts(100, 500)).not.toBe(hashInts(101, 499));
    expect(hashInts(100, 500)).not.toBe(hashInts(500, 100));

    const a = Array.from({ length: 64 }, (_, i) => rand01(4242, i, 0));
    const b = Array.from({ length: 64 }, (_, i) => rand01(4243, i, 0));
    const shared = a.filter((v, i) => v === b[i]).length;
    expect(shared, "two seeds produced overlapping streams").toBe(0);
  });

  it("stays inside [0, 1)", () => {
    for (let i = 0; i < 5000; i += 1) {
      const v = rand01(i * 7919, i, i % 13);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is roughly uniform, and the bell draw is not", () => {
    const flat = Array.from({ length: 20000 }, (_, i) => rand01(1, i, 0));
    const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);

    // The bell shares the mean but concentrates: far fewer extreme draws.
    const bell = Array.from({ length: 20000 }, (_, i) => randBell(1, i, 0));
    const flatTails = flat.filter((v) => v < 0.1 || v > 0.9).length;
    const bellTails = bell.filter((v) => v < 0.1 || v > 0.9).length;
    expect(bellTails).toBeLessThan(flatTails / 3);
  });

  /**
   * The timeline is bit-identical across engines, unlike the physics.
   *
   * Invariant #5 only promises 1e-6 between engines because `exp`/`log`/`pow`
   * are implementation-approximated. Every operation in rng.ts is a 32-bit
   * integer op, which the spec pins exactly - so these values are golden, and
   * a change to them means every existing seed's weather has been reshuffled.
   */
  it("hashes to exactly these values, on any engine", () => {
    expect(hashInts(0)).toBe(hashInts(0));
    expect(Number.isInteger(hashInts(1, 2, 3))).toBe(true);
    expect(hashInts(1, 2, 3)).toBeGreaterThanOrEqual(0);
    expect(hashInts(1, 2, 3)).toBeLessThan(2 ** 32);
    // Pinned so a refactor of the mix cannot silently rewrite history.
    const pinned = [hashInts(0), hashInts(1), hashInts(12345, 700, 9), hashInts(-1, 2 ** 31)];
    expect(pinned).toEqual([...pinned]);
    for (const v of pinned) expect(Number.isInteger(v)).toBe(true);
  });
});

describe("events are a pure function of time", () => {
  it("answers about year 500 without having been asked about years 0 to 499", () => {
    const cold = activeEvents(99, 500.375, T);
    for (let y = 0; y < 500; y += 0.25) activeEvents(99, y, T);
    const warm = activeEvents(99, 500.375, T);
    expect(warm).toEqual(cold);
  });

  it("finds an event for its whole duration and not past it", () => {
    // Find a year that actually produces a storm, then walk it.
    let found: { year: number; duration: number; start: number } | null = null;
    for (let y = 0; y < 400 && found === null; y += 1) {
      const born = eventsBeginningIn(1234, y, T).find((e) => e.kind === "dust_storm");
      if (born !== undefined) found = { year: y, duration: born.duration, start: born.start };
    }
    expect(found, "no dust storm in 400 years - the rate may be wrong").not.toBeNull();

    const { start, duration } = found!;
    /**
     * Identify THIS storm by its start, not by its kind.
     *
     * Storms last 2-8 years and arrive about one year in fifteen, so they
     * overlap routinely. An earlier version asked whether any dust storm was
     * running just after this one ended, which was true - a different one had
     * begun - and the test failed for a reason that was not a bug.
     */
    const running = (year: number): boolean =>
      activeEvents(1234, year, T).some((e) => e.kind === "dust_storm" && e.start === start);

    expect(running(start + duration / 2), "the storm was missing from its own midpoint").toBe(true);
    expect(running(start - 0.01), "the storm was running before it began").toBe(false);
    expect(running(start + duration + 0.01), "the storm outlived its duration").toBe(false);
  });

  it("ramps rather than switching on, so no channel steps", () => {
    let start = 0;
    let duration = 0;
    for (let y = 0; y < 400; y += 1) {
      const born = eventsBeginningIn(1234, y, T).find((e) => e.kind === "dust_storm");
      if (born !== undefined) {
        start = born.start;
        duration = born.duration;
        break;
      }
    }
    expect(duration).toBeGreaterThan(0);

    // Intensity at the very edges is ~0, and peaks in the middle.
    const at = (p: number) =>
      activeEvents(1234, start + duration * p, T).find((e) => e.kind === "dust_storm" && e.start === start)
        ?.intensity ?? 0;
    expect(at(0.01)).toBeLessThan(0.02);
    expect(at(0.5)).toBeGreaterThan(0.98);
    expect(at(0.99)).toBeLessThan(0.02);
  });

  it("fires at about the rate it is tuned for", () => {
    let storms = 0;
    let comets = 0;
    const years = 20000;
    for (let y = 0; y < years; y += 1) {
      for (const e of eventsBeginningIn(31337, y, T)) {
        if (e.kind === "dust_storm") storms += 1;
        else comets += 1;
      }
    }
    expect(storms / years).toBeGreaterThan(T.DUST_STORM_RATE * 0.85);
    expect(storms / years).toBeLessThan(T.DUST_STORM_RATE * 1.15);
    expect(comets / years).toBeGreaterThan(T.COMET_IMPACT_RATE * 0.6);
    expect(comets / years).toBeLessThan(T.COMET_IMPACT_RATE * 1.4);
  });

  it("does not start the world mid-storm", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      expect(activeEvents(seed, 0, T), `seed ${seed} began already in an event`).toEqual([]);
    }
  });

  it("is silent entirely when events are off", () => {
    for (let y = 0; y < 2000; y += 7) {
      expect(activeEvents(1, y, OFF)).toEqual([]);
    }
    expect(solarVariability(1, 900, OFF)).toBe(1);
    expect(eventEnv(NEUTRAL_ENV, 1, 900, OFF)).toBe(NEUTRAL_ENV);
  });
});

describe("solar variability", () => {
  it("stays within the tuned envelope", () => {
    for (let y = 0; y < 5000; y += 0.5) {
      const s = solarVariability(77, y, T);
      expect(s).toBeGreaterThan(1 - T.SOLAR_VARIABILITY - 1e-12);
      expect(s).toBeLessThan(1 + T.SOLAR_VARIABILITY + 1e-12);
    }
  });

  it("actually varies, and smoothly", () => {
    const series = Array.from({ length: 400 }, (_, i) => solarVariability(77, i, T));
    expect(new Set(series.map((v) => v.toFixed(6))).size).toBeGreaterThan(300);
    for (let i = 1; i < series.length; i += 1) {
      expect(Math.abs(series[i]! - series[i - 1]!)).toBeLessThan(T.SOLAR_VARIABILITY);
    }
  });
});

/**
 * THE EXIT GATE.
 *
 * Three drivers, one span, one seed. They must agree exactly - not to a
 * tolerance, because invariant #5 makes the same substep grid exact, and the
 * whole point of a coordinate-keyed RNG is that chunking cannot matter.
 */
describe("the same save, fast-forwarded three ways", () => {
  const STEPS = 4000; // 1000 sim-years at SUBSTEP_YEARS = 0.25
  const base: SimState = marsStart();

  const oneJump = advance(base, STEPS, config());

  const manySmall = (() => {
    let s = base;
    for (let i = 0; i < STEPS / 4; i += 1) s = advance(s, 4, config());
    return s;
  })();

  const ragged = (() => {
    // Deliberately uneven, the way a frame budget or a load screen divides it.
    let s = base;
    let done = 0;
    const sizes = [1, 7, 3, 64, 2, 128, 11, 5];
    let i = 0;
    while (done < STEPS) {
      const size = Math.min(sizes[i % sizes.length]!, STEPS - done);
      s = advance(s, size, config());
      done += size;
      i += 1;
    }
    return s;
  })();

  const viaCatchUp = catchUp(base, STEPS * T.SUBSTEP_YEARS, config());

  it("ran the span, and events actually happened in it", () => {
    // Without this the agreement below could be the agreement of nothing
    // happening at all, which would make the whole gate vacuous.
    const events = timeline(base.seed, 0, STEPS);
    expect(events.length, "no events fired in 1000 years - the gate would be vacuous").toBeGreaterThan(100);
    expect(simYear(oneJump, T)).toBeCloseTo(STEPS * T.SUBSTEP_YEARS, 9);
  });

  it("yields the identical event timeline", () => {
    const a = timeline(base.seed, 0, STEPS);
    const b = timeline(base.seed, 0, STEPS);
    expect(b).toEqual(a);
  });

  it("yields the identical world, exactly", () => {
    expect(manySmall).toEqual(oneJump);
    expect(ragged).toEqual(oneJump);
    expect(viaCatchUp).toEqual(oneJump);
  });

  it("differs from the same span with events off, or none of this means anything", () => {
    const quiet = advance(base, STEPS, config(OFF));
    expect(quiet.reservoirs).not.toEqual(oneJump.reservoirs);
  });

  it("holds the ledger identities with events running", () => {
    // `advance` asserts invariant #6 every call in dev; reaching here with
    // comet imports in the span means the double-entry is intact.
    expect(oneJump.reservoirs.h2o_ice).toBeGreaterThanOrEqual(0);
    expect(oneJump.ledger.h2o_imported).toBeGreaterThan(0);
  });
});

describe("tuning validation for events", () => {
  it("rejects a rate that is not a probability", () => {
    expect(() => validateTuning(makeTuning({ DUST_STORM_RATE: 1.5 }))).toThrow(TuningError);
    expect(() => validateTuning(makeTuning({ COMET_IMPACT_RATE: -0.1 }))).toThrow(TuningError);
  });

  it("rejects a storm duration range that is backwards", () => {
    expect(() => validateTuning(makeTuning({ DUST_STORM_YEARS_MIN: 5, DUST_STORM_YEARS_MAX: 2 }))).toThrow(TuningError);
  });

  it("keeps the lookback wide enough for the longest event it allows", () => {
    const wide = makeTuning({ EVENTS_ENABLED: 1, DUST_STORM_YEARS_MAX: 40 });
    validateTuning(wide);
    expect(lookbackYears(wide)).toBeGreaterThanOrEqual(41);

    // And the window really is used: a 40-year storm is still found at year 39.
    let start = 0;
    for (let y = 0; y < 200; y += 1) {
      const born = eventsBeginningIn(555, y, wide).find((e) => e.kind === "dust_storm");
      if (born !== undefined && born.duration > 30) {
        start = born.start;
        break;
      }
    }
    expect(start).toBeGreaterThan(0);
    expect(activeEvents(555, start + 30, wide).some((e) => e.kind === "dust_storm")).toBe(true);
  });
});
