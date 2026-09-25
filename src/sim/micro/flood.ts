/**
 * Detail doc §4.2 and §4.3 - the flood model (Batch 24).
 *
 *   flood_depth = sea_level_m - effective_base        (no dikes yet: Batch 28)
 *   tile_flooded(tx, ty) = sea_level_m > base_elev_m + local_height[tx][ty]
 *
 * Four states by `flood_depth`: dry, warning (within FLOOD_WARN_MARGIN_M
 * below the base), partial (0 to FLOOD_THRESHOLD_M above it) and flooded -
 * "the city is declared flooded. Everything is destroyed and the settlement
 * is lost."
 *
 * The STATE is derived every substep and never stored (§4.7). Its
 * CONSEQUENCES are true state and are: a building lost to the water leaves
 * the settlement for good, and a lost settlement records the sea level it
 * fell at. A building partly under water is not lost, only offline - "go
 * offline, then are lost" - and it is lost once the water stands
 * FLOOD_BUILDING_LOSS_M over the highest tile of its footprint.
 *
 * No ocean, no flooding: with no sea on the planet, `seaLevelM` is only the
 * hypsometric curve's floor, and a city in the deepest basin would otherwise
 * find its low tiles "under water" on the first day.
 */

import type { HabitatChannels } from "../habitat.js";
import { siteElevation } from "../hypsometry.js";
import type { Tuning } from "../tuning.js";
import type { PlacedBuilding, Settlement } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { siteGround } from "./rocks.js";

export type FloodState = "dry" | "warning" | "partial" | "flooded";

export interface FloodReading {
  readonly state: FloodState;
  /** The settlement's base elevation on the planet, metres (detail §1.1). */
  readonly baseM: number;
  /** The waterline, metres, or null when there is no sea. */
  readonly seaM: number | null;
  /** `seaM - baseM`, or null when there is no sea. */
  readonly depthM: number | null;
  /**
   * Row-major: which tiles are under water. Null when none can be - the sea
   * is below even the lowest ground the relief allows - which spares building
   * the heightmap on every substep of a dry city.
   */
  readonly wet: readonly boolean[] | null;
}

const DRY_FAR: Omit<FloodReading, "baseM"> = { state: "dry", seaM: null, depthM: null, wet: null };

/** The flood as it stands for a settlement: derived, never stored. */
export function floodReading(s: Settlement, env: HabitatChannels, t: Tuning): FloodReading {
  const baseM = siteElevation(s.lat, s.lon, t);
  if (!t.FLOODING_ENABLED || !(env.oceanFraction > 0)) return { ...DRY_FAR, baseM };
  const seaM = env.seaLevelM;
  const depthM = seaM - baseM;
  const state: FloodState =
    depthM >= t.FLOOD_THRESHOLD_M ? "flooded" : depthM >= 0 ? "partial" : depthM >= -t.FLOOD_WARN_MARGIN_M ? "warning" : "dry";
  // Tiles can only be wet if the sea is above the lowest ground the relief allows.
  if (depthM <= -Math.max(0, t.TERRAIN_RELIEF_M)) return { state, baseM, seaM, depthM, wet: null };
  // The ground as the rovers have left it: a levelled tile floods at its level.
  const ground = siteGround(s, t);
  return { state, baseM, seaM, depthM, wet: ground.heightM.map((h) => seaM > baseM + h) };
}

/** The tiles of a building's footprint that lie on the grid, as row-major indices. */
function footprintIndices(b: PlacedBuilding, tiles: number): number[] {
  const size = BUILDING_DEFS[b.type].footprint;
  const depth = BUILDING_DEFS[b.type].depth;
  const out: number[] = [];
  for (let y = b.ty; y < b.ty + depth; y += 1) {
    for (let x = b.tx; x < b.tx + size; x += 1) {
      if (x >= 0 && y >= 0 && x < tiles && y < tiles) out.push(y * tiles + x);
    }
  }
  return out;
}

/** Is any tile of this building's footprint under water? Then it is offline. */
export function submerged(b: PlacedBuilding, reading: FloodReading): boolean {
  const wet = reading.wet;
  if (wet === null) return false;
  const tiles = Math.round(Math.sqrt(wet.length));
  return footprintIndices(b, tiles).some((i) => wet[i] === true);
}

/**
 * Apply the flood's consequences: the true state it changes. A settlement
 * declared flooded loses everything and records the sea level it fell at; a
 * building with water FLOOD_BUILDING_LOSS_M over its highest tile is lost.
 * Everything else is left exactly as it was.
 */
export function applyFlood(s: Settlement, reading: FloodReading, t: Tuning): Settlement {
  if (s.lostAtSeaLevelM !== null || reading.seaM === null) return s;
  if (reading.state === "flooded") {
    return {
      ...s,
      population: 0,
      stores: { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 },
      buildings: [],
      lostAtSeaLevelM: reading.seaM,
    };
  }
  if (reading.wet === null) return s;
  const ground = siteGround(s, t);
  const sea = reading.seaM;
  const kept = s.buildings.filter((b) => {
    const under = footprintIndices(b, ground.tiles);
    if (under.length === 0) return true;
    const highest = Math.max(...under.map((i) => ground.heightM[i] ?? 0));
    return !(sea > reading.baseM + highest + t.FLOOD_BUILDING_LOSS_M);
  });
  return kept.length === s.buildings.length ? s : { ...s, buildings: kept };
}
