/**
 * Why a building is not running, in words - one source for the city's
 * inspector and the alerts (Batch 31), so the two can never disagree.
 */

import type { CityBuildingView, HabitatChannels, MicroResource, SettlementKind, Tuning } from "../sim/index.js";
import type { Layer } from "../sim/index.js";
import { BUILDING_DEFS, layerOf } from "../sim/index.js";

/** What makes each resource, for the words: where a corridor or cable should lead. */
export const MADE_BY: Readonly<Record<MicroResource, string>> = {
  power: "a power plant",
  water: "a Water Extractor",
  oxygen: "an Atmosphere Processor",
  food: "a Greenhouse",
  materials: "a Regolith Mine",
};

export const RESOURCE_NAMES: Readonly<Record<MicroResource, string>> = {
  power: "Power",
  water: "Water",
  oxygen: "Oxygen",
  food: "Food",
  materials: "Materials",
};

/** What the words need of a building: the view's own fields. */
export type OfflineBuilding = Pick<CityBuildingView, "type" | "operable" | "submerged" | "network"> & { readonly construction?: number | null | undefined; readonly fault?: CityBuildingView["fault"] | undefined };

/**
 * Why a building is not running, or null for one that is. `shortages` are
 * the settlement's, this substep; `kind` names it ("this city is short of").
 */
export function offlineWords(b: OfflineBuilding, kind: SettlementKind, shortages: readonly MicroResource[], env: HabitatChannels, t: Tuning): string | null {
  if (b.operable) return null;
  if (b.construction !== undefined && b.construction !== null) return `Under construction: ${Math.round(b.construction * 100)}% built. A rover is at work on it.`;
  if (b.submerged) return "Offline: under water.";
  // Batch 33: an equipment failure left to break down.
  if (b.fault !== undefined && b.fault.factor === 0) return "Broken down: an equipment failure nobody saw to. It runs again once the fault is past.";
  if (b.network !== null) {
    const lacks = b.network.resources;
    // Power comes by cable; everything else by corridor - say which to lay, to what.
    const how = (layer: Layer): string[] =>
      lacks.filter((r) => layerOf(r) === layer).map((r) => `${layer === "cables" ? "a power cable" : "a corridor"} to ${MADE_BY[r]}`);
    const lay = [...how("cables"), ...how("corridors")];
    return `Not connected: nothing on its network makes ${lacks.map((r) => RESOURCE_NAMES[r].toLowerCase()).join(" or ")}. Lay ${lay.join(", and ")}.`;
  }
  const def = BUILDING_DEFS[b.type];
  if (!def.canOperate(env, t)) return "Offline: the planet does not allow it here yet - the air needs more CO2.";
  const draws = def.consumes(t, env);
  const short = shortages.filter((r) => (draws[r] ?? 0) > 0);
  if (short.length === 0) return "Offline: browned out.";
  return `Offline: this ${kind} is short of ${short.map((r) => RESOURCE_NAMES[r].toLowerCase()).join(" and ")}.`;
}
