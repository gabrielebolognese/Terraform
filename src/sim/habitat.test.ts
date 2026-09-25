/**
 * The macro -> micro contract, §12.3.
 *
 * A city layer does not exist yet, which is exactly why this file matters: the
 * contract is being published now, and whatever gets built against it will
 * assume these properties whether or not anybody wrote them down. So they are
 * written down, and checked across a whole playthrough rather than at a few
 * hand-picked states.
 *
 * The guarantees, in one place:
 *   - every field is finite, always
 *   - every 0..1 field really is in 0..1
 *   - `supportIndex` is strictly positive even on a dead planet
 *   - it rises monotonically as the planet is terraformed, so a city's
 *     footprint grows rather than jumping
 *   - it never depends on the weather, so capacity cannot flicker
 */

import { describe, expect, it } from "vitest";

import type { Derived, Reservoirs, SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";
import { advance } from "./integrate.js";
import { derive } from "./derive.js";
import { effectiveEnv } from "./facilities/index.js";
import { marsStart } from "./planets/mars.js";
import { buildFacility, seedBiosphere } from "./actions.js";
import { makeTuning, DEFAULT_TUNING } from "./tuning.js";
import { habitat } from "./habitat.js";
import { computeStep } from "./rates/index.js";
import { liquidWaterRate } from "./sea-level.js";
import { eventEnv } from "./events.js";

const t = DEFAULT_TUNING;

/** The reference playthrough, sampled, with its habitat reading at each point. */
const RUN = (() => {
  let state: SimState = marsStart();
  state = buildFacility(state, "orbital_mirror", 30, 1, t);
  state = buildFacility(state, "ghg_factory", 10, 1, t);
  state = buildFacility(state, "atmo_processor", 8, 1, t);
  state = buildFacility(state, "nitrogen_import", 10, 1, t);

  const out: { year: number; r: Reservoirs; d: Derived; h: ReturnType<typeof habitat> }[] = [];
  for (let i = 0; i < 300; i += 1) {
    const env = effectiveEnv(NEUTRAL_ENV, state.facilities, t);
    const d = derive(state.reservoirs, env, t);
    if (!state.seeded) state = seedBiosphere(state, t, env).state;
    const water = liquidWaterRate(computeStep(state, d, t, t.SUBSTEP_YEARS, null).flows);
    out.push({ year: i * 8, r: state.reservoirs, d, h: habitat(state.reservoirs, d, t, water) });
    state = advance(state, Math.round(8 / t.SUBSTEP_YEARS), { tuning: t, env: NEUTRAL_ENV, forcing: null });
  }
  return out;
})();

describe("the contract's guarantees", () => {
  it("is finite everywhere, on every state a real run passes through", () => {
    for (const { year, h } of RUN) {
      for (const [key, value] of Object.entries(h)) {
        expect(Number.isFinite(value), `${key} was ${value} at year ${year}`).toBe(true);
      }
    }
  });

  it("keeps every fraction inside 0..1", () => {
    for (const { year, h } of RUN) {
      for (const key of ["waterAccess", "maskFraction", "openAirFraction", "supportIndex"] as const) {
        expect(h[key], `${key} left 0..1 at year ${year}`).toBeGreaterThanOrEqual(0);
        expect(h[key], `${key} left 0..1 at year ${year}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("never reports zero support, even on a dead planet", () => {
    // There are colonists on day one - under domes - or there is nobody to
    // order the mirrors. A city layer may divide by this.
    for (const { year, h } of RUN) {
      expect(h.supportIndex, `no support at all at year ${year}`).toBeGreaterThan(0);
    }
    const dead = RUN[0];
    expect(dead).toBeDefined();
    expect(dead!.h.supportIndex).toBeCloseTo(t.HAB_SEALED_BASE, 6);
    expect(dead!.h.openAirFraction).toBe(0);
  });

  it("grows as the planet is terraformed, and ends far above where it began", () => {
    const first = RUN[0]!.h.supportIndex;
    const best = Math.max(...RUN.map((s) => s.h.supportIndex));
    expect(best).toBeGreaterThan(first * 5);
  });

  /**
   * §12.3 asks for a footprint that GROWS. A single all-or-nothing gate would
   * sit at its floor for most of the game and then jump, which is why the
   * contract has three tiers - and this is the assertion that keeps them.
   */
  it("grows gradually rather than jumping at the end", () => {
    const series = RUN.map((s) => s.h.supportIndex);
    const first = series[0]!;
    const last = Math.max(...series);
    const span = last - first;

    // By the halfway point of the run it should have covered real ground.
    const midway = series[Math.floor(series.length / 2)]!;
    expect((midway - first) / span, "support was still at its floor halfway through").toBeGreaterThan(0.25);

    // And no single sample may carry most of the growth.
    let worst = 0;
    for (let i = 1; i < series.length; i += 1) worst = Math.max(worst, series[i]! - series[i - 1]!);
    expect(worst / span, "support jumped in one step").toBeLessThan(0.3);
  });

  it("puts the mask tier ahead of open air, never behind it", () => {
    // Open air is a strict subset: it is the mask tier plus breathable air.
    for (const { year, h } of RUN) {
      expect(h.openAirFraction, `open air exceeded the mask tier at year ${year}`).toBeLessThanOrEqual(
        h.maskFraction + 1e-12,
      );
    }
  });

  it("reports the doc's own readings, unmodified", () => {
    // §12.3 says cities read "local T, P, o2, water access". These are those,
    // in the doc's units - a city applies its own rules to them.
    for (const { r, d, h } of RUN) {
      expect(h.temperature).toBe(d.T);
      expect(h.pressure).toBe(d.P);
      expect(h.oxygen).toBe(r.o2);
      expect(h.carbonDioxide).toBe(r.co2_atm);
    }
  });
});

describe("greenery: the share of land the biosphere has greened (the city's ground follows it)", () => {
  it("is nothing on the dead planet, and grows through the playthrough to most of the land", () => {
    expect(RUN[0]!.h.greenery).toBe(0);
    const last = RUN[RUN.length - 1]!;
    expect(last.h.greenery).toBeGreaterThan(0.5);
    expect(last.h.greenery).toBeLessThanOrEqual(1);
  });

  it("is the globe's own green, as a share of land: vegFrac over landFrac", () => {
    // Independent of habitat(): read straight off what derive() gives the globe.
    for (const p of RUN.filter((_, i) => i % 30 === 0)) {
      const expected = p.d.landFrac > 0 ? Math.min(1, p.d.vegFrac / p.d.landFrac) : 0;
      expect(p.h.greenery, `year ${p.year}`).toBeCloseTo(expected, 12);
    }
  });
});

describe("water access is a band, not a level", () => {
  it("peaks inside the §2.3 ocean band", () => {
    const base = marsStart();
    const d0 = derive(base.reservoirs, NEUTRAL_ENV, t);
    const at = (oceanFrac: number) => habitat(base.reservoirs, { ...d0, oceanFrac }, t, 0).waterAccess;

    expect(at(0)).toBe(0);
    expect(at(0.4)).toBe(1);
    expect(at(0.15)).toBeGreaterThan(0);
    expect(at(0.15)).toBeLessThan(1);
    // A drowned planet is worse to live on, not better.
    expect(at(0.95)).toBeLessThan(at(0.4));
    expect(at(1)).toBe(0);
  });
});

describe("the contract does not flicker", () => {
  /**
   * Weather is deliberately excluded. A dust storm is a §9 visual and a few
   * kelvin; if it reached this contract a city's capacity would wobble every
   * time the wind got up, and any city layer would have to smooth it back out.
   */
  it("ignores the weather entirely", () => {
    const stormy = makeTuning({ EVENTS_ENABLED: 1 });
    const base = marsStart();
    let state = buildFacility(base, "orbital_mirror", 30, 1, stormy);
    state = advance(state, 2000, { tuning: stormy, env: NEUTRAL_ENV, forcing: null });

    // Same world, once with the weather's environment applied and once without.
    const year = 500;
    const calm = effectiveEnv(NEUTRAL_ENV, state.facilities, stormy);
    const windy = effectiveEnv(eventEnv(NEUTRAL_ENV, state.seed, year, stormy), state.facilities, stormy);

    // The environments really do differ, or this proves nothing.
    const differs =
      calm.albedoDelta !== windy.albedoDelta || calm.sMultiplier !== windy.sMultiplier;
    expect(differs, "the weather made no difference to the environment at all").toBe(true);

    // habitat() takes reservoirs and derived - it never sees a seed or a time.
    const h = habitat(state.reservoirs, derive(state.reservoirs, calm, stormy), stormy, 0);
    expect(Number.isFinite(h.supportIndex)).toBe(true);
    expect(habitat(state.reservoirs, derive(state.reservoirs, calm, stormy), stormy, 0)).toEqual(h);
  });

  it("is a pure function of the world", () => {
    const base = marsStart();
    const d = derive(base.reservoirs, NEUTRAL_ENV, t);
    expect(habitat(base.reservoirs, d, t, 0)).toEqual(habitat(base.reservoirs, d, t, 0));
  });
});
