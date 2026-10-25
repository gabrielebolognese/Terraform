/**
 * Batch 34's exit gate: Earth.
 *
 * - Launch windows land on the dates the orbit gives (synodic period 2.135
 *   years), measured over 50 windows.
 * - A contract fulfilled, against the same run failed, changes credits and
 *   reputation by the tuned amounts.
 * - Behind a constant at 0 (it moves the economy). The browser opts in, and
 *   the Batch 3 score and golden run hold with it off (both are in the suite,
 *   on the default tuning, where Earth is off).
 *
 * Measured on the browser's new worlds (`worldTuning`), beside the browser's
 * tuning rather than in `src/sim/`, which may not import it even in a test.
 * The contract's world is the scripted Standard player's (`playPacing`) at 60
 * minutes.
 */

import { describe, expect, it } from "vitest";

import { playPacing } from "../harness/pacing.js";
import { BROWSER_TUNING, tuningRecord, worldTuning } from "./game-tuning.js";
import { contractFor, orderFromEarth, windowStep } from "../sim/earth.js";
import { advance } from "../sim/integrate.js";
import { capacities, removeBuilding } from "../sim/micro/settlement.js";
import { DEFAULT_TUNING, makeTuning } from "../sim/tuning.js";
import type { Tuning } from "../sim/tuning.js";
import type { SimState } from "../sim/types.js";
import { NEUTRAL_ENV } from "../sim/types.js";

/** The orbit's figure, as the plan states it: Mars and Earth line up every 2.135 years. */
const SYNODIC = 2.135;

const cfg = (t: Tuning) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });

/**
 * Play `windows` launch windows on `t`'s new world, in chunks of `chunk`
 * substeps that know nothing of where a window falls, a cheap order always
 * waiting; return the substep each rocket lifted off at, in order.
 */
function launches(t: Tuning, windows: number, chunk: number): number[] {
  const founded = playPacing(t, 1, false).state;
  const id = founded.settlements[0]!.id;
  let s: SimState = founded;
  const seen = new Set<number>();
  const out: number[] = [];
  const end = Math.ceil((windows + 0.5) * (SYNODIC / t.SUBSTEP_YEARS));
  while (s.steps < end) {
    if (!s.earth.orders.some((o) => o.settlement === id)) {
      const o = orderFromEarth(s, id, "materials", "buy", 1, t);
      expect(o.ok, o.reason ?? "").toBe(true);
      s = o.state;
    }
    s = advance(s, Math.min(chunk, end - s.steps), cfg(t));
    for (const r of s.earth.log) {
      if (r.kind === "missed") throw new Error(`a window was missed at ${r.step}`);
      if (r.kind !== "launched" || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r.step);
    }
  }
  return out;
}

describe("launch windows by the orbit (Batch 34's exit gate)", () => {
  it("is the orbit's period in the browser's tuning", () => {
    expect(worldTuning("standard", 0, "standard").EARTH_SYNODIC_YEARS).toBe(SYNODIC);
  });

  for (const pace of ["standard", "classic"] as const) {
    it(`lands 50 windows on their dates, a ${pace}-paced world`, () => {
      const t = worldTuning("standard", 7, pace);
      const h = t.SUBSTEP_YEARS;
      // Chunks of 17 substeps (Standard: windows 68.3 apart) or one (Classic: 8.5 apart), blind to the windows.
      const steps = launches(t, 50, pace === "standard" ? 17 : 1);
      expect(steps.length).toBe(50);
      let worst = 0;
      steps.forEach((step, i) => {
        const date = (i + 1) * SYNODIC;
        // The first substep whose end is on or after the date: never early, never a substep late.
        expect(step * h).toBeGreaterThanOrEqual(date - 1e-9);
        expect((step - 1) * h).toBeLessThan(date);
        worst = Math.max(worst, step * h - date);
      });
      // No drift: the fiftieth is as close to its date as the first. Measured: at most 0.030 years late at
      // Standard (a substep is 0.03125), 0.245 at Classic (0.25); the mean gap over 49 windows 2.1346 and 2.1327.
      expect(worst).toBeLessThan(h);
      const mean = ((steps[49]! - steps[0]!) * h) / 49;
      expect(Math.abs(mean - SYNODIC)).toBeLessThan(h / 49);
    });
  }
});

describe("a contract met, against the same run failed (Batch 34's exit gate)", () => {
  /** The scripted player's city at 60 minutes, played with Earth off. Kept: it takes a few seconds. */
  let kept: SimState | null = null;
  const T = worldTuning("standard", 0, "standard");
  const OFF = makeTuning({ ...tuningRecord(T), EARTH_ENABLED: 0 });
  function world(): SimState {
    kept ??= playPacing(OFF, 3600, false).state;
    return kept;
  }

  it("pays its reward and raises the reputation by EARTH_REP_FULFIL when met; pays nothing and lowers it by EARTH_REP_FAIL when not", () => {
    const base = world();
    const c = base.settlements[0]!;
    const k = Math.floor((base.steps * T.SUBSTEP_YEARS) / SYNODIC);
    const deal = { ...contractFor(base, k, "materials", T), accepted: true };
    // The store full: the next window can carry the whole of it (at most 300 of a 400 store kept at a quarter).
    const full: SimState = { ...base, settlements: base.settlements.map((x) => (x.id === c.id ? { ...x, stores: { ...x.stores, materials: capacities(x, T).materials } } : x)), earth: { ...base.earth, contracts: [deal] } };
    expect(deal.amount).toBeLessThanOrEqual(capacities(c, T).materials * (1 - T.EARTH_KEEP_SHARE));
    // The same world, but its spaceport gone: nothing can go up, so the contract fails at its window.
    const port = c.buildings.find((b) => b.type === "spaceport")!;
    const grounded = removeBuilding(full, c.id, port.tx, port.ty);
    expect(grounded.ok, grounded.reason ?? "").toBe(true);
    const end = windowStep(deal.due, T);
    const met = advance(full, end - full.steps, cfg(T));
    const failed = advance(grounded.state, end - full.steps, cfg(T));
    expect(met.earth.log.filter((r) => r.kind === "fulfilled").map((r) => r.credits)).toEqual([deal.reward]);
    expect(failed.earth.log.filter((r) => r.kind === "failed").length).toBe(1);
    // The tuned amounts: the reward is the amount at EARTH_CONTRACT_PAY_MATERIALS a unit.
    expect(deal.reward).toBe(Math.ceil(deal.amount * T.EARTH_CONTRACT_PAY_MATERIALS));
    expect(met.economy.credits - failed.economy.credits).toBeCloseTo(deal.reward, 6);
    expect(met.earth.reputation).toBe(T.EARTH_REP_START + T.EARTH_REP_FULFIL);
    expect(failed.earth.reputation).toBe(T.EARTH_REP_START - T.EARTH_REP_FAIL);
    expect(met.earth.reputation - failed.earth.reputation).toBe(T.EARTH_REP_FULFIL + T.EARTH_REP_FAIL);
  });
});

describe("the pace with Earth (Batch 34, measured)", () => {
  /** The scripted player to the end of its moments, events off, trading with Earth or not. */
  const run = (pace: "standard" | "classic", trade: boolean) => {
    const T = worldTuning("standard", 0, pace);
    return playPacing(makeTuning({ ...tuningRecord(T), DECISIONS_ENABLED: 0 }), 8 * 3600, true, undefined, { trade });
  };

  it("at Standard, a player who trades has the city of 1,000 sooner and the planet's Phase 2 sooner, and fails no contract", () => {
    const plain = run("standard", false);
    const trader = run("standard", true);
    // The first ten minutes are Earth's to come: the first building and upgrade are the same.
    expect(trader.moments.firstBuilding).toBe(plain.moments.firstBuilding);
    expect(trader.moments.firstUpgrade).toBe(plain.moments.firstUpgrade);
    // Measured: the city of 1,000 at 2.05 h against 2.16 h; Phase 2 at 78.5 min against 99.2 min (the
    // credits from Earth buy the planet's levers sooner); 3 contracts met, none failed, by 2.05 h.
    expect(trader.moments.city1000!).toBeLessThan(plain.moments.city1000!);
    expect(trader.moments.phase2!).toBeLessThan(plain.moments.phase2!);
    expect(trader.state.earth.fulfilled).toBeGreaterThanOrEqual(1);
    expect(trader.state.earth.failed).toBe(0);
    expect(trader.state.earth.earned + trader.state.earth.rewards).toBeGreaterThan(0);
  });

  it("at Classic, trading does not hold the city back: the city of 1,000 within 1%", () => {
    const plain = run("classic", false);
    const trader = run("classic", true);
    // Measured: 1.743 h against 1.736 h (25 s later: the materials sold); Phase 2 at 12.4 min both ways
    // (before the first sale); 14 contracts met, 1 failed.
    expect(trader.moments.city1000!).toBeLessThan(plain.moments.city1000! * 1.01);
    expect(trader.moments.phase2).toBe(plain.moments.phase2);
    expect(trader.state.earth.fulfilled).toBeGreaterThan(trader.state.earth.failed);
  });
});

describe("Earth is behind a constant at 0 (Batch 34's exit gate)", () => {
  it("is off by default and in every world made before it; new Standard and Terraformed worlds turn it on, a sandbox does not", () => {
    expect(DEFAULT_TUNING.EARTH_ENABLED).toBe(0);
    expect(BROWSER_TUNING.EARTH_ENABLED).toBe(0);
    expect(worldTuning("standard", 0, "standard").EARTH_ENABLED).toBe(1);
    expect(worldTuning("standard", 0, "classic").EARTH_ENABLED).toBe(1);
    expect(worldTuning("terraformed", 0, "standard").EARTH_ENABLED).toBe(1);
    expect(worldTuning("sandbox", 0, "standard").EARTH_ENABLED).toBe(0);
  });

  it("changes nothing for a player who does not trade: the scripted Standard hour the same to the bit, Earth aside", () => {
    const T = worldTuning("standard", 0, "standard");
    const OFF = makeTuning({ ...tuningRecord(T), EARTH_ENABLED: 0 });
    const on = playPacing(T, 3600, false);
    const off = playPacing(OFF, 3600, false);
    expect(on.moments).toEqual(off.moments);
    expect({ ...on.state, earth: null }).toEqual({ ...off.state, earth: null });
    // Not vacuous: Earth was there, with windows passing and an offer standing.
    expect(on.state.earth.offer).not.toBeNull();
    expect(off.state.earth.offer).toBeNull();
  });
});
