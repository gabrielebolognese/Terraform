/**
 * Turning the section 5 registry into terms the engine already understands.
 *
 * Three kinds of contribution, because the levers genuinely act on three
 * different things: flows on reservoirs, effective solar flux, and shield
 * strength. Everything else about a facility - ordering, levelling, enabling -
 * is bookkeeping that resolves into `deployed` before any of this runs.
 */

import { avail, clamp, clamp01, smoothstep } from "../math.js";
import type { Tuning } from "../tuning.js";
import type { Derived, Env, Facility, FacilityType, Flow, Reservoirs, SimState } from "../types.js";
import { FACILITY_DEFS } from "./registry.js";

export { FACILITY_DEFS, FACILITY_LIST } from "./registry.js";
export type { FacilityDef, FacilityKind } from "./registry.js";

/** Capacity that has been ordered, as opposed to what is online. */
export function orderedUnits(f: Facility): number {
  if (!f.enabled) return 0;
  return Math.max(0, f.count) * Math.max(0, f.level);
}

/**
 * The units of one facility that are actually working: `deployed`, clamped to
 * the facility cap.
 *
 * Every reader of `deployed` goes through this. Batch 13 made the ramp
 * normalise an out-of-range value, but the ramp runs AFTER the environment is
 * built each substep, so the first substep still integrated a raw 1000 units
 * (sMultiplier 5) before the ramp caught it (Batch 14).
 */
export function liveUnits(f: Facility, t: Tuning): number {
  return clamp(f.deployed, 0, t.FACILITY_MAX_COUNT * t.FACILITY_MAX_LEVEL);
}

/** Deployed units of one facility type, summed over however many entries exist. */
export function deployedUnitsOf(facilities: readonly Facility[], type: FacilityType, t: Tuning): number {
  let total = 0;
  for (const f of facilities) {
    if (f.type === type) total += liveUnits(f, t);
  }
  return total;
}

/**
 * Advance deployment toward what has been ordered.
 *
 * Both directions ramp. Retiring an orbital mirror array is no more
 * instantaneous than building one, and letting it snap to zero would hand the
 * player an instant cooling lever that section 5's design rule forbids just as
 * much as an instant warming one.
 */
export function stepFacilities(facilities: readonly Facility[], t: Tuning, h: number): readonly Facility[] {
  if (facilities.length === 0) return facilities;

  const maxUnits = t.FACILITY_MAX_COUNT * t.FACILITY_MAX_LEVEL;
  const stepUnits = t.FACILITY_BUILD_RATE * h;
  let changed = false;

  const next = facilities.map((f) => {
    const target = clamp(orderedUnits(f), 0, maxUnits);
    const current = clamp(f.deployed, 0, maxUnits);
    // Compare against the RAW value, not only the clamped one. Batch 13: a
    // save holding deployed = 1000 on a maxed lever clamped to 250 here,
    // matched its target, and returned `f` untouched - so the raw 1000 went on
    // feeding `effectiveEnv` forever (sMultiplier 5, T 350 K).
    if (current === target && current === f.deployed) return f;
    if (current === target) {
      changed = true;
      return { ...f, deployed: current };
    }
    const moved =
      current < target ? Math.min(target, current + stepUnits) : Math.max(target, current - stepUnits);
    changed = true;
    return { ...f, deployed: moved };
  });

  return changed ? next : facilities;
}

/**
 * The environment the facilities produce, combined with whatever the outside
 * world is already doing.
 *
 * `base` carries the external forcings - Batch 8's dust storms, and anything a
 * test injects - and the facilities multiply into it rather than overwriting
 * it, so the two compose instead of racing.
 */
export function effectiveEnv(base: Env, facilities: readonly Facility[], t: Tuning): Env {
  let delta = 0;
  for (const f of facilities) {
    const def = FACILITY_DEFS[f.type];
    if (def.kind !== "env") continue;
    delta += def.perUnit(t) * liveUnits(f, t);
  }
  if (delta === 0) return base;
  // Floored well above zero: a shade stack must be able to cool the planet, not
  // switch the sun off. A full shade deck is exactly delta = -1 at the current
  // constants, so without this the multiplier lands on 0. `derive` floors
  // S_eff again at S_EFF_MIN regardless; this floor is the playable one.
  return { ...base, sMultiplier: Math.max(base.sMultiplier * (1 + delta), t.S_MULTIPLIER_MIN) };
}

/** Shield strength the deployed hardware is capable of, 0..1. */
export function shieldTarget(facilities: readonly Facility[], t: Tuning): number {
  let strength = 0;
  for (const f of facilities) {
    const def = FACILITY_DEFS[f.type];
    if (def.kind !== "shield") continue;
    strength += def.perUnit(t) * liveUnits(f, t);
  }
  return clamp01(strength);
}

/** Move actual shield strength toward what the hardware supports. */
export function stepShield(current: number, facilities: readonly Facility[], t: Tuning, h: number): number {
  const target = shieldTarget(facilities, t);
  const safe = Number.isFinite(current) ? clamp01(current) : 0;
  if (safe === target) return safe;
  const step = t.SHIELD_BUILD_RATE * h;
  return safe < target ? Math.min(target, safe + step) : Math.max(target, safe - step);
}

/**
 * The flow-type levers.
 *
 * Every import is DOUBLE-ENTRY - the reservoir and its `*_imported` ledger
 * account both rise - so mass arriving from off-world is recorded as arriving
 * rather than appearing from nowhere. `advance` asserts the ledger identities
 * on every call, so a single-entry import here fails loudly and immediately.
 */
export function facilityFlows(state: SimState, d: Derived, t: Tuning): readonly Flow[] {
  const flows: Flow[] = [];
  const r: Reservoirs = state.reservoirs;
  const units = (type: FacilityType): number => deployedUnitsOf(state.facilities, type, t);

  // --- greenhouse factory: manufactured, not imported. There is no ghg ledger
  // identity to satisfy because engineered gas is not conserved anywhere - it
  // decays photolytically and the loss module already accounts for that.
  const ghgRate = FACILITY_DEFS.ghg_factory.perUnit(t) * units("ghg_factory");
  if (ghgRate > 0) {
    flows.push({ id: "forcing.ghg_import", from: null, to: "ghg", rate: ghgRate, conversion: 1 });
  }

  // --- atmospheric processor: moves carbon out of the regolith, it does not
  // create it, so this is a plain paired transfer and the reservoir runs dry.
  const ventRate =
    FACILITY_DEFS.atmo_processor.perUnit(t) * units("atmo_processor") * avail(r.co2_reg, t.FACILITY_DEPLETE_SCALE);
  if (ventRate > 0) {
    flows.push({ id: "forcing.co2_vent", from: "co2_reg", to: "co2_atm", rate: ventRate, conversion: 1 });
  }

  // --- comet redirect: water from off-world, double-entry.
  const iceRate = FACILITY_DEFS.comet_redirect.perUnit(t) * units("comet_redirect");
  if (iceRate > 0) {
    flows.push({ id: "forcing.h2o_import", from: null, to: "h2o_ice", rate: iceRate, conversion: 1 });
    flows.push({ id: "forcing.h2o_import", from: null, to: "h2o_imported", rate: iceRate, conversion: 1 });
  }

  // --- nitrogen import: the buffer, double-entry.
  const n2Rate = FACILITY_DEFS.nitrogen_import.perUnit(t) * units("nitrogen_import");
  if (n2Rate > 0) {
    flows.push({ id: "forcing.n2_import", from: null, to: "n2", rate: n2Rate, conversion: 1 });
    flows.push({ id: "forcing.n2_import", from: null, to: "n2_imported", rate: n2Rate, conversion: 1 });
  }

  // --- carbon scrubber: the one lever that removes atmosphere, and therefore
  // the one that needs a floor. Below P_FLOOR it fades out rather than
  // stopping dead, so the player sees it easing off rather than a switch
  // flipping. Without this, scrubbing early pushes P under the triple point
  // and locks liquid water out of the run permanently, with nothing on screen
  // to explain it.
  const scrubDemand = FACILITY_DEFS.carbon_scrubber.perUnit(t) * units("carbon_scrubber");
  if (scrubDemand > 0) {
    const headroom = smoothstep(t.P_FLOOR, t.P_FLOOR + t.P_FLOOR_W, d.P);
    const scrubRate = scrubDemand * headroom * avail(r.co2_atm, t.FACILITY_DEPLETE_SCALE);
    if (scrubRate > 0) {
      flows.push({
        id: "forcing.co2_scrub",
        from: "co2_atm",
        to: "c_sequestered",
        rate: scrubRate,
        conversion: 1,
      });
    }
  }

  return flows;
}

/** True when the scrubber is being held back by the pressure floor, for the UI to explain. */
export function scrubberThrottled(state: SimState, d: Derived, t: Tuning): boolean {
  if (deployedUnitsOf(state.facilities, "carbon_scrubber", t) <= 0) return false;
  return smoothstep(t.P_FLOOR, t.P_FLOOR + t.P_FLOOR_W, d.P) < 1;
}
