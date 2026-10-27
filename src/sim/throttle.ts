/**
 * Detail doc §4.5's last lever, "throttle the planet" (Batch 38): "slowing
 * water-raising subsystems slows d(sea_level_m)/dt globally, buying time for
 * all threatened cities at once, at the cost of terraforming pace". BUILD_PLAN
 * asks for "a forecast that shows how much time slowing the water buys".
 *
 * Not the forecast at current rate (Batch 25) with another rate in it: the
 * water comes from ice melting as the planet warms, and switching the planet's
 * facilities off leaves this substep's melt where it is - measured on the
 * reference arc, the net liquid rate the same to three places with every
 * facility on or off, at years 290 to 400. What the facilities change is the
 * warming to come. So the planet is projected: run on from now as it stands,
 * and again with every facility switched off, and each threatened city's
 * total loss read off both. The difference is the time throttling buys.
 *
 * A projection of the planet alone - the settlements, events that ask for
 * decisions, Earth and the guide are left out of both runs alike - on a grid
 * of THROTTLE_STEP_YEARS (the Standard pace's eighth-of-a-year substeps would
 * make it eight times the work for the same answer, measured in the Batch 38
 * note). Derived, never stored; pure, like everything here.
 */

import { derive } from "./derive.js";
import { habitat } from "./habitat.js";
import { siteElevation } from "./hypsometry.js";
import type { SimConfig } from "./integrate.js";
import { advance, worldEnv } from "./integrate.js";
import { dikeHeightM } from "./micro/flood.js";
import type { Tuning } from "./tuning.js";
import type { SimState } from "./types.js";

export interface ThrottleReading {
  /** Planet sim-years from now to the city's total loss with the planet as it is, or null past the horizon. */
  readonly asIsYears: number | null;
  /** The same with every facility switched off now, or null past the horizon. */
  readonly throttledYears: number | null;
}

/** The planet alone, as the projection runs it: no settlement, decision, Earth or guide to step. */
function projectionTuning(t: Tuning): Tuning {
  return { ...t, SUBSTEP_YEARS: Math.max(t.SUBSTEP_YEARS, t.THROTTLE_STEP_YEARS), DECISIONS_ENABLED: 0, EARTH_ENABLED: 0, GUIDE_ENABLED: 0, INTERCITY_ENABLED: 0 };
}

/**
 * For each settlement named, when the sea would take it with the planet as it
 * is, and with every facility switched off now - within THROTTLE_HORIZON_YEARS.
 * Empty with flooding off, or with no facility running to switch off. A city
 * the sea already stands over is left out: there is nothing left to buy.
 */
export function throttleForecast(state: SimState, cfg: SimConfig, ids: readonly string[]): Map<string, ThrottleReading> {
  const t = cfg.tuning;
  const out = new Map<string, ThrottleReading>();
  if (!t.FLOODING_ENABLED || !state.facilities.some((f) => f.enabled && f.count > 0)) return out;
  const p = projectionTuning(t);
  const seaOf = (s: SimState): number => {
    const d = derive(s.reservoirs, worldEnv(s, cfg.env, p), p);
    const h = habitat(s.reservoirs, d, p, 0);
    return h.oceanFraction > 0 ? h.seaLevelM : -Infinity;
  };
  const now = seaOf(state);
  // Each city's total loss: FLOOD_THRESHOLD_M over its effective base (its Seawall's height counts).
  const targets: { id: string; m: number }[] = [];
  for (const id of ids) {
    const s = state.settlements.find((x) => x.id === id);
    if (s === undefined || s.lostAtSeaLevelM !== null) continue;
    const m = siteElevation(s.lat, s.lon, t) + dikeHeightM(s, t) + t.FLOOD_THRESHOLD_M;
    if (now < m) targets.push({ id, m });
  }
  if (targets.length === 0) return out;
  const pcfg: SimConfig = { ...cfg, tuning: p };
  const planet: SimState = { ...state, settlements: [], routes: [] };
  const run = (start: SimState): Map<string, number> => {
    const when = new Map<string, number>();
    let s = start;
    const steps = Math.ceil(t.THROTTLE_HORIZON_YEARS / p.SUBSTEP_YEARS);
    for (let i = 1; i <= steps && when.size < targets.length; i += 1) {
      s = advance(s, 1, pcfg);
      const sea = seaOf(s);
      for (const { id, m } of targets) if (!when.has(id) && sea >= m) when.set(id, i * p.SUBSTEP_YEARS);
    }
    return when;
  };
  const asIs = run(planet);
  const throttled = run({ ...planet, facilities: planet.facilities.map((f) => (f.enabled ? { ...f, enabled: false } : f)) });
  for (const { id } of targets) out.set(id, { asIsYears: asIs.get(id) ?? null, throttledYears: throttled.get(id) ?? null });
  return out;
}
