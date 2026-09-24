import { describe, expect, it } from "vitest";

import { deepFreeze, stateWith } from "../testkit/helpers.js";
import { seedBiosphere } from "./actions.js";
import type { SimConfig } from "./integrate.js";
import { marsStart } from "./planets/mars.js";
import { catchUp, defaultConfig, tick } from "./tick.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import { Phase, RESERVOIR_KEYS } from "./types.js";

const t = DEFAULT_TUNING;
const cfg = defaultConfig();
const HOT: SimConfig = { tuning: t, env: { sMultiplier: 1.3, albedoDelta: 0 }, forcing: null };

describe("tick is a pure function of (state, dt)", () => {
  it("does not mutate the state it is handed", () => {
    const frozen = deepFreeze(marsStart());
    expect(() => tick(frozen, 100, HOT)).not.toThrow();
  });

  it("leaves the input reservoirs untouched", () => {
    const start = marsStart();
    const snapshot = { ...start.reservoirs };
    tick(start, 500, HOT);
    expect(start.reservoirs).toEqual(snapshot);
  });

  it("is referentially transparent", () => {
    const a = tick(marsStart(), 500, HOT);
    const b = tick(marsStart(), 500, HOT);
    expect(a.state.reservoirs).toEqual(b.state.reservoirs);
    expect(a.progress).toBe(b.progress);
    expect(a.derived.T).toBe(b.derived.T);
  });
});

describe("dt handling", () => {
  it("rejects a nonsensical dt rather than coercing it", () => {
    expect(() => tick(marsStart(), -1, cfg)).toThrow(RangeError);
    expect(() => tick(marsStart(), Number.NaN, cfg)).toThrow(RangeError);
    expect(() => tick(marsStart(), Infinity, cfg)).toThrow(RangeError);
  });

  it("reports when a dt was too small to advance anything", () => {
    // Reported rather than silently swallowed: a caller passing 0.01 every
    // frame would otherwise see a frozen planet and no explanation.
    const result = tick(marsStart(), 0.01, cfg);
    expect(result.stepsRun).toBe(0);
    expect(result.state.steps).toBe(0);
  });

  it("quantises dt to whole substeps", () => {
    expect(tick(marsStart(), 1, cfg).stepsRun).toBe(4);
    expect(tick(marsStart(), 0.25, cfg).stepsRun).toBe(1);
    expect(tick(marsStart(), 10, cfg).stepsRun).toBe(40);
  });

  it("bounds the work done in a single call", () => {
    const result = tick(marsStart(), 1e6, cfg);
    expect(result.stepsRun).toBe(t.MAX_SUBSTEPS_PER_TICK);
  });
});

describe("the tick result bundle", () => {
  it("reports derived values from AFTER the integration", () => {
    const before = tick(marsStart(), 0, cfg);
    const after = tick(marsStart(), 400, HOT);
    expect(after.derived.T).toBeGreaterThan(before.derived.T);
    // The phase describes the world the player is now looking at.
    expect(after.phase).toBeGreaterThanOrEqual(before.phase);
  });

  it("reports tick-mean rates, not an instantaneous snapshot", () => {
    const result = tick(marsStart(), 400, HOT);
    const expected = (result.state.reservoirs.co2_cap - marsStart().reservoirs.co2_cap) / 400;
    expect(result.rates.co2_cap).toBeCloseTo(expected, 10);
    expect(result.rates.co2_cap).toBeLessThan(0);
    expect(result.rates.co2_atm).toBeGreaterThan(0);
  });

  it("reports dT/dt, so a UI can say 'and rising'", () => {
    expect(tick(marsStart(), 400, HOT).dTdt).toBeGreaterThan(0);
  });

  it("carries the flows, so the visual contract can attribute rates later", () => {
    const result = tick(marsStart(), 400, HOT);
    const release = result.flows.find((f) => f.id === "co2.cap_sublimation");
    expect(release).toBeDefined();
    expect(release?.rate).toBeGreaterThan(0);
  });

  it("latches the phase while reporting the instantaneous one separately", () => {
    const hot = tick(marsStart(), 600, HOT);
    expect(hot.phaseReached).toBeGreaterThanOrEqual(hot.phase);
    expect(hot.state.phaseReached).toBe(hot.phaseReached);

    // Cool it back down: the latch holds, the instantaneous value falls.
    const cooled = tick(hot.state, 400, { ...cfg, env: { sMultiplier: 0.5, albedoDelta: 0 } });
    expect(cooled.phaseReached).toBe(hot.phaseReached);
  });

  it("keeps every reservoir finite and non-negative", () => {
    const result = tick(marsStart(), 500, HOT);
    for (const key of RESERVOIR_KEYS) {
      expect(Number.isFinite(result.state.reservoirs[key])).toBe(true);
      expect(result.state.reservoirs[key]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("catchUp - section 8.2 offline progression", () => {
  it("equals the same elapsed time run as one tick", () => {
    const chunked = catchUp(marsStart(), 500, HOT);
    const oneShot = tick(marsStart(), 500, HOT).state;
    expect(chunked.reservoirs).toEqual(oneShot.reservoirs);
  });

  it("caps the WORK for an absurd absence instead of hanging", () => {
    // Uses a low cap so the test is fast: the behaviour under test is the
    // clamp, not the throughput. The real 100,000-year cap costs ~4 s, which
    // is fine for a load screen and not fine in a unit test.
    const capped = makeTuning({ CATCHUP_MAX_SIM_YEARS: 500 });
    const result = catchUp(marsStart(), 1e9, { ...HOT, tuning: capped });
    expect(result.steps).toBe(Math.round(500 / capped.SUBSTEP_YEARS));
  });

  it("reports progress in chunks so a load screen can move", () => {
    const seen: number[] = [];
    catchUp(marsStart(), 2000, HOT, (_s, done, total) => {
      seen.push(done / total);
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it("rejects a negative or non-finite elapsed time", () => {
    expect(() => catchUp(marsStart(), -1, cfg)).toThrow(RangeError);
    expect(() => catchUp(marsStart(), Number.NaN, cfg)).toThrow(RangeError);
  });
});

describe("seeding (section 3.5, section 5)", () => {
  it("refuses on a dead world, with a reason", () => {
    const outcome = seedBiosphere(marsStart(), t);
    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toMatch(/water/);
    expect(outcome.state.reservoirs.biomass).toBe(0);
  });

  it("succeeds on a world that is warm, wet and thick enough", () => {
    const ready = stateWith({
      co2_atm: 300,
      co2_cap: 0,
      co2_reg: 0,
      n2: 700,
      h2o_ice: 10,
      h2o_liq: 20,
      h2o_vap: 2,
    });
    const outcome = seedBiosphere(ready, t);
    expect(outcome.seeded).toBe(true);
    expect(outcome.reason).toBeNull();
    expect(outcome.state.reservoirs.biomass).toBe(t.SEED_AMOUNT);
  });

  it("seeds BELOW the Phase 4 threshold, so the milestone still has to be earned", () => {
    expect(t.SEED_AMOUNT).toBeLessThan(t.PHASE4_BIO);
  });

  it("is idempotent", () => {
    const ready = stateWith({ co2_atm: 300, co2_cap: 0, co2_reg: 0, n2: 700, h2o_ice: 10, h2o_liq: 20, h2o_vap: 2 });
    const once = seedBiosphere(ready, t).state;
    const twice = seedBiosphere(once, t).state;
    expect(twice.reservoirs.biomass).toBe(once.reservoirs.biomass);
  });
});

describe("the whole arc is reachable", () => {
  it("an untouched Mars is still Barren after 3000 sim-years", () => {
    // The control that would have caught the original spec's worst balance
    // bug: with the documented bare sigmoid, an untouched Mars empties its
    // polar caps in about 130 years, entirely on its own.
    const idle = catchUp(marsStart(), 3000, cfg);
    const result = tick(idle, 0, cfg);
    expect(result.phase).toBe(Phase.Barren);
    expect(result.state.reservoirs.co2_cap).toBeCloseTo(40, 6);
  });
});
