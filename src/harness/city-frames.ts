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
import { isoProject } from "../render/iso.js";
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
 * The same view on flat ground with no open world round it: every corner at
 * the base, nothing steep. `bumps` moves every other corner by that many
 * tiles - enough to keep the renderer from merging tiles into patches, for
 * a test that must see ground drawn tile by tile - except inside `level`
 * (corner coordinates, inclusive), which stays flat.
 */
export function flatten(view: CityView, bumps = 0, level: readonly [number, number, number, number] | null = null): CityView {
  const m = view.tiles + 1;
  const corners = Array.from({ length: m * m }, (_, i) => {
    const x = i % m;
    const y = Math.floor(i / m);
    if (level !== null && x >= level[0] && y >= level[1] && x <= level[2] && y <= level[3]) return 0;
    return (x + y) % 2 === 1 ? bumps : 0;
  });
  return {
    ...view,
    groundZ: view.groundZ.map(() => bumps / 2),
    corners,
    steep: view.steep.map(() => false),
    world: { margin: 0, size: view.tiles, corners, caves: [] },
  };
}

/**
 * Render a view to fit a frame - the part of the grid the reference city
 * occupies, not the whole 32x32, so the buildings are big enough to see.
 */
export function renderCity(
  view: CityView,
  options: CitySceneOptions,
  width: number,
  height: number,
  focus = true,
  frame: { minX: number; maxX: number; minY: number; maxY: number } | null = null,
): Frame {
  const b = sceneBounds(view.tiles, Math.max(...view.groundZ));
  // The reference city sits around tiles 11..21; frame that, or the whole grid.
  const box = frame ?? (focus ? { minX: -8 * 32, maxX: 8 * 32, minY: 17 * 16, maxY: 41 * 16 } : b);
  const scale = Math.min(width / (box.maxX - box.minX), height / (box.maxY - box.minY));
  return rasterize(cityScene(view, options), width, height, {
    scale,
    offsetX: width / 2 - ((box.minX + box.maxX) / 2) * scale,
    offsetY: height / 2 - ((box.minY + box.maxY) / 2) * scale,
  }, CITY_BACKGROUND);
}

/**
 * Every building type, running, side by side on flat ground: a close-up
 * sheet for a human to look at (not compared). The city renders them small;
 * this is where their detail can be judged.
 */
export function buildingSheet(): { view: CityView; options: CitySceneOptions } {
  const layout: readonly [BuildingType, number, number, number][] = [
    ["habitat_dome", 1, 1, 3],
    ["spaceport", 5, 1, 3],
    ["reactor", 9, 1, 2],
    ["geothermal_plant", 12, 1, 2],
    ["solar_array", 1, 5, 2],
    ["water_extractor", 4, 5, 2],
    ["atmosphere_processor", 7, 5, 2],
    ["greenhouse", 10, 5, 2],
    ["regolith_mine", 13, 5, 2],
    ["storage_depot", 16, 5, 1],
  ];
  const tiles = 18;
  const view: CityView = {
    id: "sheet",
    kind: "city",
    tiles,
    groundZ: new Array<number>(tiles * tiles).fill(0),
    corners: new Array<number>((tiles + 1) * (tiles + 1)).fill(0),
    world: { margin: 0, size: tiles, corners: new Array<number>((tiles + 1) * (tiles + 1)).fill(0), caves: [] },
    greenery: 0,
    heightM: new Array<number>(tiles * tiles).fill(0),
    steep: new Array<boolean>(tiles * tiles).fill(false),
    baseElevationM: 0,
    buildings: layout.map(([type, tx, ty, size], index) => ({ index, type, tx, ty, size, operable: true, activity: 0.8, baseZ: 0, submerged: false, network: null })),
    population: 0,
    housing: 0,
    supported: true,
    stores: { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 },
    capacities: { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 },
    net: { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 },
    shortages: [],
    wet: new Array<boolean>(tiles * tiles).fill(false),
    floodState: "dry",
    floodDepthM: null,
    lostAtSeaLevelM: null,
    corridors: new Array<boolean>(tiles * tiles).fill(false),
    cables: new Array<boolean>(tiles * tiles).fill(false),
    rocks: new Array<"none">(tiles * tiles).fill("none"),
    garage: null,
    jobs: [],
  };
  return { view, options: { time: 1.3, selected: null, ghost: null } };
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
  const sheet = buildingSheet();
  // Framed on the buildings (tiles 0..18 by 0..8, up to 2 tiles tall), not the whole grid.
  const sheetBox = {
    minX: isoProject(0, 8.5).sx - 20,
    maxX: isoProject(18, 0).sx + 20,
    minY: isoProject(0, 0, 2.2).sy,
    maxY: isoProject(18, 8.5).sy + 20,
  };
  writeFileSync(join(FRAMES_DIR, "city-buildings.png"), encodePng(renderCity(sheet.view, sheet.options, 1800, 900, false, sheetBox)));
  console.log(`wrote ${CITY_GOLDEN.name}, ${CITY_GOLDEN_WHOLE.name}, city-preview.png, city-whole.png and city-buildings.png to ${FRAMES_DIR}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
