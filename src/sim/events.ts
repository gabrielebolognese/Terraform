/**
 * Seeded world events - design doc §12.2.
 *
 * §12.2 asks that "random" events stay "seeded from `seed` + `sim_year` so
 * offline catch-up stays reproducible". That one sentence rules out almost
 * every conventional way of doing this, and the consequence is the shape of
 * this file.
 *
 * THERE IS NO EVENT QUEUE AND NO EVENT STATE. Nothing here is stored in the
 * save, nothing accumulates, and no event is ever "spawned". `activeEvents`
 * is a pure function of `(seed, simYear)`: ask what is happening at year 812.5
 * and you get the same answer whether you arrived there in one 812-year jump,
 * in 3250 substeps, or across four sessions with two reloads in between. The
 * timeline is a property of the seed, not of how the simulation was driven.
 *
 * That is what makes the exit gate reachable. A queue would have to be
 * serialised, migrated, and kept consistent with a catch-up that runs in
 * arbitrary chunks; a function of time has none of those failure modes,
 * because there is nothing to keep consistent.
 *
 * WHY A LOOKBACK RATHER THAN A SCAN. Events last longer than a year, so
 * "what is happening now" needs the years that could still be running, not
 * just the current one. The lookback is bounded by the longest event a tuning
 * can produce, and `validateTuning` checks that bound is honest - if a storm
 * could outlive the window it would vanish mid-storm, which is the one bug
 * this design can still have.
 */

import type { Derived, Env, Flow, Reservoirs } from "./types.js";
import type { Tuning } from "./tuning.js";
import { rand01, randBell, randRange } from "./rng.js";
import { metresToVapourFactor } from "./units.js";

export type EventKind = "dust_storm" | "comet_impact";

export interface WorldEvent {
  readonly kind: EventKind;
  /** Sim-year the event begins. Fractional: events do not start on new year's day. */
  readonly start: number;
  /** Sim-years it lasts. */
  readonly duration: number;
  /** 0..1, the draw that scales its effect. */
  readonly magnitude: number;
}

/** An event plus how far through it we are. */
export interface ActiveEvent extends WorldEvent {
  /** 0..1 through the event's span. */
  readonly phase: number;
  /**
   * The envelope at this instant, 0..1.
   *
   * Events ramp up and down rather than switching on: a storm that appeared at
   * full strength would be a step in `albedoDelta`, and Batch 5's continuity
   * test measures exactly that - no channel may move more than 25% of its
   * range in a real minute.
   */
  readonly intensity: number;
}

/**
 * Salts, so independent questions about one year get independent answers.
 *
 * Arbitrary distinct constants; they only have to differ. Changing one
 * reshuffles that event's timeline for every existing seed, which is why they
 * are fixed here rather than derived from anything that might move.
 */
const SALT = {
  dustOccurs: 0x1a2b,
  dustOffset: 0x2b3c,
  dustDuration: 0x3c4d,
  dustMagnitude: 0x4d5e,
  cometOccurs: 0x5e6f,
  cometOffset: 0x6f70,
  cometMagnitude: 0x7081,
  solarPhase: 0x8192,
} as const;

/**
 * A raised-cosine envelope: zero at both ends, one in the middle, smooth
 * throughout.
 *
 * Cheap, and - unlike a Gaussian - it reaches exactly zero at the edges, so an
 * event genuinely ends instead of decaying forever and leaving a permanent
 * offset behind every storm that ever happened.
 */
function envelope(phase: number): number {
  if (phase <= 0 || phase >= 1) return 0;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
}

/** The events that BEGIN in a given whole year. Pure; the heart of the design. */
export function eventsBeginningIn(seed: number, year: number, t: Tuning): readonly WorldEvent[] {
  const out: WorldEvent[] = [];

  if (rand01(seed, year, SALT.dustOccurs) < t.DUST_STORM_RATE) {
    out.push({
      kind: "dust_storm",
      start: year + rand01(seed, year, SALT.dustOffset),
      duration: randRange(seed, year, SALT.dustDuration, t.DUST_STORM_YEARS_MIN, t.DUST_STORM_YEARS_MAX),
      magnitude: randBell(seed, year, SALT.dustMagnitude),
    });
  }

  if (rand01(seed, year, SALT.cometOccurs) < t.COMET_IMPACT_RATE) {
    out.push({
      kind: "comet_impact",
      start: year + rand01(seed, year, SALT.cometOffset),
      // Fixed, not drawn. A real impact is an impulse, but an impulse has no
      // well-defined rate, and every flow in this engine is a rate. Spreading
      // delivery over a fixed window makes the mass exact and independent of
      // the substep size - which is the whole point of this batch.
      duration: t.COMET_DELIVERY_YEARS,
      magnitude: randBell(seed, year, SALT.cometMagnitude),
    });
  }

  return out;
}

/** How many whole years back `activeEvents` must look. */
export function lookbackYears(t: Tuning): number {
  return Math.ceil(Math.max(t.DUST_STORM_YEARS_MAX, t.COMET_DELIVERY_YEARS)) + 1;
}

/**
 * Everything happening at `simYear`. Pure function of (seed, time).
 *
 * This is the entire public surface of the event system: the substep loop and
 * the UI both call it, and neither can observe anything the other cannot.
 */
export function activeEvents(seed: number, simYear: number, t: Tuning): readonly ActiveEvent[] {
  if (!t.EVENTS_ENABLED) return [];

  const out: ActiveEvent[] = [];
  const current = Math.floor(simYear);
  const back = lookbackYears(t);

  for (let year = current - back; year <= current; year += 1) {
    // Negative years are before the world began; skipping them keeps a fresh
    // save from opening with a storm already half over.
    if (year < 0) continue;
    for (const event of eventsBeginningIn(seed, year, t)) {
      const phase = (simYear - event.start) / event.duration;
      if (phase <= 0 || phase >= 1) continue;
      out.push({ ...event, phase, intensity: envelope(phase) });
    }
  }
  return out;
}

/**
 * Solar variability, as a continuous function rather than as events.
 *
 * §12.2 lists it alongside storms and impacts, but it is not an occurrence -
 * it is a wander, always present. Modelling it as a sum of sinusoids with
 * seed-derived phases makes it smooth, bounded, reproducible and free of any
 * bookkeeping at all, and it costs no lookback.
 *
 * Three incommensurable periods, so the sum does not visibly repeat on any
 * timescale a playthrough covers.
 */
export function solarVariability(seed: number, simYear: number, t: Tuning): number {
  if (!t.EVENTS_ENABLED || t.SOLAR_VARIABILITY === 0) return 1;

  const periods = [t.SOLAR_CYCLE_SHORT, t.SOLAR_CYCLE_MID, t.SOLAR_CYCLE_LONG];
  let sum = 0;
  for (let i = 0; i < periods.length; i += 1) {
    const period = periods[i] ?? 1;
    const phase = rand01(seed, i, SALT.solarPhase);
    sum += Math.sin(2 * Math.PI * (simYear / period + phase));
  }
  // Divided by the count, so SOLAR_VARIABILITY is the true peak deviation
  // rather than something three times larger than it reads.
  return 1 + (t.SOLAR_VARIABILITY * sum) / periods.length;
}

/**
 * The environment the events impose, composed onto whatever the player's
 * facilities already produced.
 *
 * Additive on albedo and multiplicative on flux, matching how `Env` already
 * defines its two fields - so a dust storm during a mirror build is the sum of
 * both, not whichever was applied last.
 */
export function eventEnv(base: Env, seed: number, simYear: number, t: Tuning): Env {
  if (!t.EVENTS_ENABLED) return base;

  let albedoDelta = base.albedoDelta;
  for (const event of activeEvents(seed, simYear, t)) {
    if (event.kind === "dust_storm") {
      // Dust brightens the disc: §9's dust channel and the cooling both follow
      // from this one number.
      albedoDelta += t.DUST_STORM_ALBEDO * event.magnitude * event.intensity;
    } else if (event.kind === "comet_impact") {
      // Ejecta, briefly. Smaller than a storm and over much faster.
      albedoDelta += t.COMET_DUST_ALBEDO * event.magnitude * event.intensity;
    }
  }

  return {
    sMultiplier: base.sMultiplier * solarVariability(seed, simYear, t),
    albedoDelta,
  };
}

/**
 * The flows the events contribute - comet water, double-entry.
 *
 * Same mechanism as the player's comet redirect facility, deliberately: an
 * import that did not name `h2o_imported` as well as `h2o_ice` would break the
 * invariant #6 water identity on the first impact, and `advance` asserts that
 * every substep in dev.
 *
 * A fraction arrives as vapour rather than ice. That is §12.2's "heat pulse",
 * and it is DERIVED rather than injected: water vapour is a greenhouse gas in
 * this model, so the impact warms the planet through the same term everything
 * else does, and the warming fades as the vapour condenses. There is no
 * bespoke energy channel, because a bespoke energy channel would be a second
 * way for temperature to happen - and §2.2 says temperature is derived.
 */
export function eventFlows(seed: number, simYear: number, t: Tuning, _r: Reservoirs, _d: Derived): readonly Flow[] {
  if (!t.EVENTS_ENABLED) return [];

  const flows: Flow[] = [];
  for (const event of activeEvents(seed, simYear, t)) {
    if (event.kind !== "comet_impact") continue;

    // Metres of ice-equivalent per sim-year, averaged by the envelope.
    const total = t.COMET_WATER_METRES * event.magnitude;
    const rate = (total * event.intensity) / event.duration;
    if (!(rate > 0)) continue;

    const toVapour = rate * t.COMET_VAPOUR_FRACTION;
    const toIce = rate - toVapour;

    if (toIce > 0) {
      flows.push({ id: "event.comet_water", from: null, to: "h2o_ice", rate: toIce, conversion: 1 });
    }
    if (toVapour > 0) {
      flows.push({
        id: "event.comet_water",
        from: null,
        to: "h2o_vap",
        rate: toVapour,
        // Metres of water become mbar of vapour: the one unit boundary in the
        // water system, and the factor §3.4 got wrong by 371x. Named rather
        // than spelled, which boundary.test.ts requires and which is exactly
        // the guard that would have caught that error.
        conversion: metresToVapourFactor(t),
      });
    }
    // The double-entry leg, in metres, for the whole delivery.
    flows.push({ id: "event.comet_water", from: null, to: "h2o_imported", rate, conversion: 1 });
  }
  return flows;
}

/**
 * How much dust the weather is holding up right now, 0..1.
 *
 * §9's dust channel already exists and already means "particle and haze
 * bursts"; a storm is exactly that, so it feeds the same channel rather than
 * getting one of its own. `deriveVisuals` takes this as an argument because it
 * must not know about seeds or sim time - see the note there.
 */
export function stormIntensity(seed: number, simYear: number, t: Tuning): number {
  if (!t.EVENTS_ENABLED) return 0;
  let dust = 0;
  for (const event of activeEvents(seed, simYear, t)) {
    dust += event.magnitude * event.intensity * (event.kind === "dust_storm" ? 1 : 0.5);
  }
  return dust > 1 ? 1 : dust;
}

/** A compact description for the Batch 7 feed. */
export function describeEvent(event: ActiveEvent, t: Tuning): string {
  const strength = event.magnitude < 0.34 ? "minor" : event.magnitude < 0.67 ? "moderate" : "major";
  if (event.kind === "dust_storm") {
    return `A ${strength} dust storm has risen, and will run for about ${event.duration.toFixed(0)} years.`;
  }
  const metres = (t.COMET_WATER_METRES * event.magnitude).toFixed(2);
  return `A ${strength} cometary impact: roughly ${metres} m of water delivered.`;
}
