/**
 * Batch 20's reference city render: a fixed settlement, drawn by the software
 * rasteriser, committed as a PNG and compared per pixel by
 * `city-golden.test.ts` - Batch 6's golden frames, for the city view.
 *
 * The city is built through the simulation's own API (found, place, and a
 * stated store), so a change to placement, terrain, the view contract or the
 * renderer all show up here. It shows nine of the ten building types (no
 * water extractor: the city is dry on purpose), rough ground, three
 * browned-out buildings with their badges, a selection and a refused
 * placement ghost.
 *
 *   npm run sim:city     rewrite docs/frames/city-*.png - LOOK at them first
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { cityScene, CITY_BACKGROUND, sceneBounds } from "../render/city.js";
import type { CitySceneOptions } from "../render/city.js";
import type { Frame } from "../render/planet.js";
import { rasterize } from "../render/raster.js";
import type { BuildingType, CityView, SimState } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  cityView,
  liquidWaterRate,
  nextSubstepFlows,
  derive,
  foundSettlement,
  habitat,
  makeTuning,
  marsStart,
  placeBuilding,
  worldEnv,
} from "../sim/index.js";
import { FRAMES_DIR } from "./frames.js";
import { encodePng } from "./png.js";

export const CITY_TUNING = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });

export const CITY_GOLDEN = { name: "city-reference.png", width: 384, height: 240 } as const;
/**
 * The whole grid (Batch 22): the close-up above frames the flat landing zone,
 * so the hills were barely in it - lowering a hill tile by a metre changed it
 * by 0.0000%. This one holds the terrain to account.
 */
export const CITY_GOLDEN_WHOLE = { name: "city-terrain.png", width: 384, height: 240 } as const;

/** Where the reference city stands - any fixed place; the ground is derived from it. */
const SITE = { lat: 0.31, lon: -1.2 };

const PLAN: readonly (readonly [BuildingType, number, number])[] = [
  ["spaceport", 12, 12],
  ["reactor", 15, 12],
  ["geothermal_plant", 17, 12],
  ["solar_array", 19, 12],
  ["habitat_dome", 12, 15],
  ["habitat_dome", 15, 15],
  ["storage_depot", 18, 14],
  ["storage_depot", 19, 14],
  ["greenhouse", 18, 15],
  ["atmosphere_processor", 18, 17],
  ["regolith_mine", 12, 18],
  // Up a hill, about 8 m above the landing zone (Batch 22): the one building
  // that proves buildings stand on their own ground in the terrain frame.
  ["solar_array", 29, 8],
];

export function referenceCity(): { state: SimState; view: CityView; options: CitySceneOptions } {
  const t = CITY_TUNING;
  let state = foundSettlement(marsStart(undefined, t), "city", SITE.lat, SITE.lon, t).state;
  const id = state.settlements[0]!.id;
  state = {
    ...state,
    settlements: state.settlements.map((s) => ({ ...s, stores: { ...s.stores, materials: 2000 } })),
  };
  for (const [type, tx, ty] of PLAN) {
    const o = placeBuilding(state, id, type, tx, ty, t);
    if (!o.ok) throw new Error(`reference city: ${type} at ${tx},${ty} refused - ${o.reason ?? ""}`);
    state = o.state;
  }
  // A dry city: no water in store and no extractor, so everything that drinks
  // - the domes and the greenhouse - is browned out, and wears its badge.
  state = {
    ...state,
    settlements: state.settlements.map((s) => ({ ...s, population: 12, stores: { ...s.stores, water: 0, power: 5 } })),
  };
  const env = worldEnv(state, NEUTRAL_ENV, t);
  const d = derive(state.reservoirs, env, t);
  const channels = habitat(state.reservoirs, d, t, liquidWaterRate(nextSubstepFlows(state, { tuning: t, env: NEUTRAL_ENV, forcing: null })));
  const view = cityView(state.settlements[0]!, channels, t);
  // A water extractor ghosted half on the spaceport: refused. The reactor selected.
  return { state, view, options: { time: 0, selected: 1, ghost: { tx: 10, ty: 11, size: 2, valid: false } } };
}

/**
 * Render a view to fit a frame - the part of the grid the reference city
 * occupies, not the whole 32x32, so the buildings are big enough to see.
 */
export function renderCity(view: CityView, options: CitySceneOptions, width: number, height: number, focus = true): Frame {
  const b = sceneBounds(view.tiles, Math.max(...view.groundZ));
  // The reference city sits around tiles 11..21; frame that, or the whole grid.
  const box = focus ? { minX: -8 * 32, maxX: 8 * 32, minY: 17 * 16, maxY: 41 * 16 } : b;
  const scale = Math.min(width / (box.maxX - box.minX), height / (box.maxY - box.minY));
  return rasterize(cityScene(view, options), width, height, {
    scale,
    offsetX: width / 2 - ((box.minX + box.maxX) / 2) * scale,
    offsetY: height / 2 - ((box.minY + box.maxY) / 2) * scale,
  }, CITY_BACKGROUND);
}

function main(): void {
  const { view, options } = referenceCity();
  mkdirSync(FRAMES_DIR, { recursive: true });
  const golden = renderCity(view, options, CITY_GOLDEN.width, CITY_GOLDEN.height);
  writeFileSync(join(FRAMES_DIR, CITY_GOLDEN.name), encodePng(golden));
  writeFileSync(join(FRAMES_DIR, CITY_GOLDEN_WHOLE.name), encodePng(renderCity(view, options, CITY_GOLDEN_WHOLE.width, CITY_GOLDEN_WHOLE.height, false)));
  // Larger, for a human to look at; not compared.
  writeFileSync(join(FRAMES_DIR, "city-preview.png"), encodePng(renderCity(view, options, 1280, 800)));
  writeFileSync(join(FRAMES_DIR, "city-whole.png"), encodePng(renderCity(view, options, 1280, 800, false)));
  console.log(`wrote ${CITY_GOLDEN.name}, ${CITY_GOLDEN_WHOLE.name}, city-preview.png and city-whole.png to ${FRAMES_DIR}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
