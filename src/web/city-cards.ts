/**
 * The build bar's card pictures (at the user's request: "a bottom bar just
 * like Clash of Clans, where each structure is a card, with a preview").
 *
 * Each preview is the game's own renderer drawing a tiny scene - one
 * building on its own patch of ground, or a stretch of road - so a card
 * shows exactly what will be built. They are drawn ONCE, when the city
 * screen is made: the scene renderer keeps one cache per level of detail,
 * and drawing a preview mid-game would throw a metropolis's away (about a
 * second to rebuild, measured in the level-of-detail pass).
 */

import { cityScene } from "../render/city.js";
import type { Shape } from "../render/raster.js";
import type { BuildingType, CityBuildingView, CityView } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES } from "../sim/index.js";
import { fillShapes } from "./city.js";

/** A card picture's size in CSS pixels; drawn at twice that for sharp screens. */
export const PREVIEW_W = 112;
export const PREVIEW_H = 80;

/** What a card can show: a building, a corridor, a power cable, or "connect everything". */
export type CardKind = BuildingType | "corridor" | "cable" | "connect" | "claim";

/** A tiny flat scene: `tiles` square, with these buildings and road tiles. */
export function previewView(id: string, tiles: number, buildings: readonly CityBuildingView[], corridorTiles: readonly (readonly [number, number])[], cableTiles: readonly (readonly [number, number])[] = []): CityView {
  const grid = (list: readonly (readonly [number, number])[]): boolean[] => {
    const g = new Array<boolean>(tiles * tiles).fill(false);
    for (const [x, y] of list) g[y * tiles + x] = true;
    return g;
  };
  const zero = { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 };
  return {
    id: `preview:${id}`,
    kind: "city",
    tiles,
    origin: { x: 0, y: 0 },
    claimed: new Array<boolean>(tiles * tiles).fill(true),
    claims: { chunk: 32, held: 0, allowed: 0, nextAt: null, open: [] },
    groundZ: new Array<number>(tiles * tiles).fill(0),
    corners: new Array<number>((tiles + 1) * (tiles + 1)).fill(0),
    world: { margin: 0, size: tiles, corners: new Array<number>((tiles + 1) * (tiles + 1)).fill(0), caves: [], rocks: [] },
    greenery: 0,
    heightM: new Array<number>(tiles * tiles).fill(0),
    steep: new Array<boolean>(tiles * tiles).fill(false),
    baseElevationM: 0,
    buildings,
    population: 0,
    housing: 0,
    supported: true,
    stores: zero,
    capacities: zero,
    net: zero,
    shortages: [],
    wet: new Array<boolean>(tiles * tiles).fill(false),
    floodState: "dry",
    floodDepthM: null,
    lostAtSeaLevelM: null,
    corridors: grid(corridorTiles),
    cables: grid(cableTiles),
    rocks: new Array<"none">(tiles * tiles).fill("none"),
    garage: null,
    jobs: [],
  };
}

const building = (type: BuildingType, tx: number, ty: number, index = 0): CityBuildingView => ({
  index,
  type,
  tx,
  ty,
  size: BUILDING_DEFS[type].footprint,
  operable: true,
  activity: 1,
  baseZ: 0,
  submerged: false,
  network: null,
});

/** The two buildings the Power cable card joins: a solar array and a mine. */
export function cableBuildings(): CityBuildingView[] {
  return [building("solar_array", 0, 0, 0), building("regolith_mine", 4, 4, 1)];
}

/** The tiny scene a card shows. */
export function previewScene(kind: CardKind): Shape[] {
  // Mid-animation, so lights are on and blades have turned; rovers mid-road.
  const at = { time: 2.4, selected: null, ghost: null, quality: "high" as const };
  if (kind === "corridor") {
    // A bend of corridor with a junction.
    return cityScene(previewView("corridor", 4, [], [[0, 1], [1, 1], [2, 1], [3, 1], [2, 2], [2, 3]]), at);
  }
  if (kind === "cable") {
    // A power cable from a solar array to a mine.
    return cityScene(previewView("cable", 6, cableBuildings(), [], [[2, 1], [3, 1], [4, 1], [4, 2], [4, 3]]), at);
  }
  if (kind === "claim") {
    // A chunk of ground on offer, outlined as claim mode shows it.
    return cityScene(previewView("claim", 6, [], []), { ...at, claimable: [{ tx: 1, ty: 1, size: 4, ready: true, hover: true }] });
  }
  if (kind === "connect") {
    // A dome and a greenhouse joined by a corridor, and the greenhouse's power cable.
    return cityScene(
      previewView("connect", 6, [building("habitat_dome", 0, 0, 0), building("greenhouse", 4, 4, 1)], [[3, 1], [4, 1], [4, 2], [4, 3]], [[5, 0], [5, 1], [5, 2], [5, 3]]),
      at,
    );
  }
  const size = BUILDING_DEFS[kind].footprint;
  return cityScene(previewView(kind, size, [building(kind, 0, 0)], []), at);
}

/** How to fit a shape list into a `width` x `height` picture: centred, with a margin. Null if it draws nothing. */
export function previewFit(shapes: readonly Shape[], width: number, height: number): { scale: number; offsetX: number; offsetY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    for (const ring of s.rings) {
      for (let k = 0; k < ring.length; k += 2) {
        minX = Math.min(minX, ring[k]!);
        maxX = Math.max(maxX, ring[k]!);
        minY = Math.min(minY, ring[k + 1]!);
        maxY = Math.max(maxY, ring[k + 1]!);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  const margin = width / 20;
  const scale = Math.min((width - 2 * margin) / (maxX - minX), (height - 2 * margin) / (maxY - minY));
  return { scale, offsetX: width / 2 - ((minX + maxX) / 2) * scale, offsetY: height / 2 - ((minY + maxY) / 2) * scale };
}

/** Draw a shape list into a canvas, fitted by `previewFit`. */
export function drawPreview(canvas: HTMLCanvasElement, shapes: readonly Shape[]): void {
  const ctx = canvas.getContext("2d");
  const fit = previewFit(shapes, canvas.width, canvas.height);
  if (ctx === null || fit === null) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(fit.scale, 0, 0, fit.scale, fit.offsetX, fit.offsetY);
  fillShapes(ctx, shapes);
}

/** Every card's picture, drawn once. In a page with no 2D canvas (tests) they stay blank. */
export function makePreviews(): Map<CardKind, HTMLCanvasElement> {
  const out = new Map<CardKind, HTMLCanvasElement>();
  for (const kind of [...BUILDING_TYPES.filter((t) => BUILDING_DEFS[t].buildable), "corridor", "cable", "connect", "claim"] as CardKind[]) {
    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_W * 2;
    canvas.height = PREVIEW_H * 2;
    drawPreview(canvas, previewScene(kind));
    out.set(kind, canvas);
  }
  return out;
}
