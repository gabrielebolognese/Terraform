/**
 * The drowning-city fixture (Batch 24), shared by the simulation's flood
 * tests and the web layer's: the reference world 1,200 years in, a low city
 * 15.15 m above the sea and a high one 473 m above it, and the water import
 * that raises the sea through `advance`.
 */

import { REFERENCE_POLICY, applyOrdersDue } from "../harness/policy.js";
import { derive } from "../sim/derive.js";
import { habitat } from "../sim/habitat.js";
import type { HabitatChannels } from "../sim/habitat.js";
import { advance, nextSubstepFlows, worldEnv } from "../sim/integrate.js";
import { foundSettlement } from "../sim/micro/registry.js";
import { placeBuilding } from "../sim/micro/settlement.js";
import { marsStart } from "../sim/planets/mars.js";
import { liquidWaterRate } from "../sim/sea-level.js";
import { makeTuning } from "../sim/tuning.js";
import type { Flow, SimState } from "../sim/types.js";
import { NEUTRAL_ENV } from "../sim/types.js";

export const t = makeTuning({ SETTLEMENTS_ENABLED: 1, FLOODING_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
export const LOW = { lat: 1.0734990285136419, lon: -1.1411990820367182 };
export const HIGH = { lat: 0.3826955450654856, lon: 0.5875725894082384 };

/** Half a metre of water a decade: the sea climbs about 0.7 m a substep here. */
export const importWater = (): Flow[] => [
  { id: "forcing.h2o_import", from: null, to: "h2o_liq", rate: 0.05, conversion: 1 },
  { id: "forcing.h2o_import", from: null, to: "h2o_imported", rate: 0.05, conversion: 1 },
];
export const rising = { tuning: t, env: NEUTRAL_ENV, forcing: importWater };

/**
 * The two cities, each with a geothermal plant, an Atmosphere Processor and a
 * depot on the flat landing zone; the low one has three more depots on
 * buildable ground at its lowest (-11.03 m), about +4 m, and its highest
 * (+8.20 m) - so the order the water takes them can be seen.
 */
export function fixture(tuning = t): SimState {
  const plain = { tuning, env: NEUTRAL_ENV, forcing: null };
  let s = marsStart();
  const applied = new Set<number>();
  for (let i = 0; i < 1200 * 4; i += 1) {
    s = applyOrdersDue(s, REFERENCE_POLICY, i * tuning.SUBSTEP_YEARS, applied, tuning);
    s = advance(s, 1, plain);
  }
  s = foundSettlement(s, "city", LOW.lat, LOW.lon, tuning).state;
  s = foundSettlement(s, "city", HIGH.lat, HIGH.lon, tuning).state;
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
  for (const id of ["settlement-1", "settlement-2"]) {
    for (const [type, tx, ty] of [
      ["geothermal_plant", 13, 13],
      ["atmosphere_processor", 15, 13],
      ["storage_depot", 17, 17],
    ] as const) {
      s = placeBuilding(s, id, type, tx, ty, tuning).state;
    }
  }
  for (const [tx, ty] of DEPOTS) s = placeBuilding(s, "settlement-1", "storage_depot", tx, ty, tuning).state;
  return s;
}

/** Found by searching the low city's buildable ground outside the landing zone. */
export const DEPOTS: readonly (readonly [number, number])[] = [
  [0, 15], // -11.03 m
  [8, 26], // +4.00 m
  [5, 0], // +8.20 m
];

export function channels(s: SimState): HabitatChannels {
  const d = derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t);
  return habitat(s.reservoirs, d, t, liquidWaterRate(nextSubstepFlows(s, rising)));
}

