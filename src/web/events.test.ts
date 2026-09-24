/**
 * The event feed, over a real playthrough.
 *
 * Two failure modes matter, and they pull in opposite directions: a feed that
 * misses a milestone leaves §7's "backbone of visible growth" invisible, and a
 * feed that repeats one turns the log into noise the player stops reading.
 * Both are checked here against the reference run rather than against
 * hand-built states, because the wobble that causes the second only happens in
 * a real trajectory.
 */

import { describe, expect, it } from "vitest";

import type { GameEvent } from "./events.js";
import { EventLog } from "./events.js";
import type { SimState } from "../sim/index.js";
import {
  DEFAULT_TUNING,
  NEUTRAL_ENV,
  advance,
  derive,
  effectiveEnv,
  evaluatePhase,
  latchPhase,
  makeTuning,
  marsStart,
  seedBiosphere,
  simYear,
} from "../sim/index.js";
import { REFERENCE_POLICY, applyOrdersDue } from "../harness/policy.js";
import { ARC_SAMPLE_YEARS, ARC_YEARS } from "./config.js";

const t = DEFAULT_TUNING;

function playthrough(): { readonly events: readonly GameEvent[]; readonly log: EventLog } {
  const log = new EventLog();
  let state: SimState = marsStart();
  let year = 0;
  const applied = new Set<number>();
  const all: GameEvent[] = [];
  const steps = Math.max(1, Math.round(ARC_SAMPLE_YEARS / t.SUBSTEP_YEARS));

  for (let i = 0; i <= ARC_YEARS / ARC_SAMPLE_YEARS; i += 1) {
    const env = effectiveEnv(NEUTRAL_ENV, state.facilities, t);
    const d = derive(state.reservoirs, env, t);
    const phase = evaluatePhase(state.reservoirs, d, env, t);
    state = { ...state, phaseReached: latchPhase(state.phaseReached, phase) };
    all.push(
      ...log.observe({ year, state, reservoirs: state.reservoirs, derived: d, phaseReached: state.phaseReached }),
    );

    state = applyOrdersDue(state, REFERENCE_POLICY, year, applied, t);
    const env2 = effectiveEnv(NEUTRAL_ENV, state.facilities, t);
    if (REFERENCE_POLICY.seedAt >= 0 && !state.seeded && year >= REFERENCE_POLICY.seedAt) {
      state = seedBiosphere(state, t, env2).state;
    }
    state = advance(state, steps, { tuning: t, env: NEUTRAL_ENV, forcing: null });
    year = simYear(state, t);
  }
  return { events: all, log };
}

const { events: EVENTS, log: LOG } = playthrough();

describe("the event feed over a playthrough", () => {
  it("reports the milestones of a run that reaches a living world", () => {
    expect(EVENTS.length).toBeGreaterThan(10);
  });

  it("never repeats itself", () => {
    const texts = EVENTS.map((e) => e.text);
    const duplicates = texts.filter((text, i) => texts.indexOf(text) !== i);
    expect(duplicates, `repeated lines: ${[...new Set(duplicates)].join(" | ")}`).toEqual([]);
  });

  it("is in chronological order", () => {
    for (let i = 1; i < EVENTS.length; i += 1) {
      expect(EVENTS[i]!.year).toBeGreaterThanOrEqual(EVENTS[i - 1]!.year);
    }
  });

  /**
   * The latch can advance by more than one phase between samples. Batch 1
   * found exactly this bug in the harness's phase recording, where only the
   * phase landed on was written and the skipped ones read as "never reached"
   * forever. The feed must not lose a beat the same way.
   */
  it("announces every phase it passes through, skipping none", () => {
    const announced = EVENTS.map((e) => /^Phase (\d):/.exec(e.text)).filter((m) => m !== null).map((m) => Number(m![1]));
    expect(announced.length, "no phase was ever announced").toBeGreaterThan(0);
    for (let i = 1; i < announced.length; i += 1) {
      expect(announced[i], `jumped from phase ${announced[i - 1]} to ${announced[i]}`).toBe(announced[i - 1]! + 1);
    }
    // The reference run reaches a living world, so it passes through them all.
    expect(announced[announced.length - 1]).toBe(6);
  });

  it("gives the big beats a headline, and does not give one to everything", () => {
    const headlines = EVENTS.filter((e) => e.headline);
    expect(headlines.length).toBeGreaterThan(0);
    expect(headlines.length).toBeLessThan(EVENTS.length);
    // §7 singles out Phase 2 as the "it's happening" moment.
    expect(headlines.some((e) => e.text.startsWith("Phase 2:"))).toBe(true);
  });

  it("notices the things a player would otherwise miss", () => {
    const text = EVENTS.map((e) => e.text).join("\n");
    expect(text).toMatch(/first liquid water/i);
    expect(text).toMatch(/Cyanobacteria released/);
    expect(text).toMatch(/breathable/i);
  });

  it("keeps the newest entry first", () => {
    const log = LOG.log;
    expect(log.length).toBeGreaterThan(1);
    for (let i = 1; i < log.length; i += 1) {
      expect(log[i]!.year).toBeLessThanOrEqual(log[i - 1]!.year);
    }
  });
});

describe("EventLog", () => {
  it("fires a watch once even when the value wobbles back across it", () => {
    const log = new EventLog();
    const base = marsStart();
    const warm = { ...base.reservoirs, biomass: 0 };
    const d = derive(warm, NEUTRAL_ENV, t);

    const cross = { year: 10, state: base, reservoirs: warm, derived: { ...d, oceanFrac: 0.01 }, phaseReached: 0 as const };
    const back = { year: 11, state: base, reservoirs: warm, derived: { ...d, oceanFrac: 0 }, phaseReached: 0 as const };

    expect(log.observe(cross).some((e) => /first liquid water/i.test(e.text))).toBe(true);
    expect(log.observe(back)).toEqual([]);
    expect(log.observe(cross)).toEqual([]);
  });

  it("forgets everything on clear, so a reset planet starts a fresh log", () => {
    const log = new EventLog();
    const base = marsStart();
    const d = derive(base.reservoirs, NEUTRAL_ENV, t);
    const snap = {
      year: 1,
      state: base,
      reservoirs: base.reservoirs,
      derived: { ...d, oceanFrac: 0.2 },
      phaseReached: 0 as const,
    };
    expect(log.observe(snap).length).toBeGreaterThan(0);
    expect(log.log.length).toBeGreaterThan(0);

    log.clear();
    expect(log.log).toEqual([]);
    expect(log.observe(snap).length).toBeGreaterThan(0);
  });

  it("caps the log rather than growing without bound", () => {
    const log = new EventLog(3);
    const base = marsStart();
    const d = derive(base.reservoirs, NEUTRAL_ENV, t);
    // Every watch at once, which is more than the capacity.
    log.observe({
      year: 1,
      state: { ...base, seeded: true },
      reservoirs: { ...base.reservoirs, o2: 300, biomass: 1, co2_atm: 1 },
      derived: { ...d, T: 288, P: 1013, oceanFrac: 0.4 },
      phaseReached: 6,
    });
    expect(log.log.length).toBe(3);
  });
});

/**
 * §12.2's weather in the feed.
 *
 * Reported on a different rule from every other line in the file: milestones
 * latch forever, weather recurs. Getting that wrong either reports one storm
 * and never another, or reports the same storm on every readout.
 */
describe("weather in the feed", () => {
  const stormy = makeTuning({ EVENTS_ENABLED: 1 });

  function weatherOver(years: number, step: number): readonly GameEvent[] {
    const log = new EventLog(500);
    const base = marsStart();
    const d = derive(base.reservoirs, NEUTRAL_ENV, t);
    const out: GameEvent[] = [];
    for (let y = 0; y <= years; y += step) {
      out.push(
        ...log.observe({
          year: y,
          state: base,
          reservoirs: base.reservoirs,
          derived: d,
          phaseReached: 0,
          tuning: stormy,
        }),
      );
    }
    return out.filter((e) => /dust storm|cometary/i.test(e.text));
  }

  it("reports storms, and more than one of them", () => {
    const weather = weatherOver(600, 0.25);
    expect(weather.length, "no weather was ever reported").toBeGreaterThan(5);
  });

  it("reports each storm exactly once, however often it is asked", () => {
    const coarse = weatherOver(600, 1);
    const fine = weatherOver(600, 0.25);
    // Sampling four times as often must not report four times as many storms.
    expect(fine.length).toBe(coarse.length);
  });

  it("says nothing about weather when events are off", () => {
    const log = new EventLog();
    const base = marsStart();
    const d = derive(base.reservoirs, NEUTRAL_ENV, t);
    const seen: GameEvent[] = [];
    for (let y = 0; y < 400; y += 0.5) {
      seen.push(...log.observe({ year: y, state: base, reservoirs: base.reservoirs, derived: d, phaseReached: 0 }));
    }
    expect(seen.filter((e) => /storm|comet/i.test(e.text))).toEqual([]);
  });

  it("never gives weather a headline banner", () => {
    // A storm is texture. Reserving the banner for §7's beats is what keeps
    // "it's happening" meaning anything.
    for (const event of weatherOver(800, 0.5)) {
      expect(event.headline, `weather took a headline: ${event.text}`).toBe(false);
    }
  });

  it("calls only the big storms a warning", () => {
    const weather = weatherOver(1500, 0.5);
    const tones = new Set(weather.map((e) => e.tone));
    expect(tones.has("note"), "no ordinary weather at all").toBe(true);
    expect(tones.has("milestone"), "weather was reported as a milestone").toBe(false);
  });
});
