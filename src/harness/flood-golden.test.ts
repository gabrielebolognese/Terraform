/**
 * Batch 38 - detail §4.6's water plane: "a translucent water plane at
 * sea_level_m ... intersecting the heightmap. Tiles below the plane read as
 * submerged; the shoreline is simply the plane-terrain intersection and moves
 * inland as the plane rises." BUILD_PLAN's exit gate: "The water plane is
 * part of a committed reference frame, with a measured tolerance."
 *
 * When a diff is intended: run `npm run sim:city`, LOOK at
 * docs/frames/city-flood.png, and commit it with the reason.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SEA, cityChunkSignature, cityScene } from "../render/city.js";
import { TILE_H, TILE_W, Z_PX } from "../render/iso.js";
import { frameDifference } from "../render/planet.js";
import { advance } from "../sim/integrate.js";
import type { CityView } from "../sim/index.js";
import { cityView } from "../sim/micro/view.js";
import { channels, fixture, rising, t } from "../testkit/flood.js";
import { CITY_FLOOD, FLOOD_SEA, referenceCity, renderCity } from "./city-frames.js";
import { FRAMES_DIR } from "./frames.js";
import { decodePng } from "./png.js";

/**
 * Mean absolute per-channel difference, as a fraction of full scale. Measured
 * on this frame (384 x 240):
 *
 *   unmodified render                              0.0000%
 *   the waterline 1 cm higher, behind the wall     0.0000%  (drawn to the 200th of a tile: 5 cm)
 *   behind the wall 10 cm higher                   0.0351%
 *   the open sea 10 cm higher                      0.1142%
 *   behind the wall 1 m higher                     0.5321%
 *   no wall (the open sea at the inner level)      4.0488%
 *   no sea                                         9.2108%
 *
 * 0.003% - the city frames' tolerance, about three full-contrast pixels -
 * catches every change of 10 cm or more.
 */
const TOLERANCE = 0.00003;

describe("the water plane's reference frame", () => {
  const path = join(FRAMES_DIR, CITY_FLOOD.name);
  const { view, options } = referenceCity();
  const render = (sea: { readonly inner: number; readonly outer: number } | null) => renderCity({ ...view, sea }, options, CITY_FLOOD.width, CITY_FLOOD.height, false);

  it("is committed", () => {
    expect(existsSync(path), `${CITY_FLOOD.name} is missing - run npm run sim:city`).toBe(true);
  });

  it("matches the committed frame, pixel for pixel within the measured tolerance", () => {
    expect(frameDifference(decodePng(readFileSync(path)), render(FLOOD_SEA))).toBeLessThanOrEqual(TOLERANCE);
  });

  it("redraws a chunk's kept picture when the waterline moves, and not while it stands", () => {
    const at = (sea: { readonly inner: number; readonly outer: number } | null): string => cityChunkSignature({ ...view, sea }, options, 16, 0, 0);
    expect(at(FLOOD_SEA)).toBe(at({ ...FLOOD_SEA }));
    expect(at({ ...FLOOD_SEA, inner: FLOOD_SEA.inner + 0.01 })).not.toBe(at(FLOOD_SEA));
    expect(at({ ...FLOOD_SEA, outer: FLOOD_SEA.outer + 0.01 })).not.toBe(at(FLOOD_SEA));
    // A sea far below every ground in view draws nothing, and keys nothing: no redraw as it rises.
    expect(at({ inner: -40, outer: -40 })).toBe(at(null));
  });

  it("stands a building in the water once the sea is over its ground: the sea over its footprint, under its body", () => {
    const b = view.buildings.find((x) => x.type === "reactor")!;
    const footprint = (shape: { rings: readonly (readonly number[])[] }, z: number): boolean => {
      const ring = shape.rings[0]!;
      const pts = ring.length / 2;
      let sx = 0;
      let sy = 0;
      for (let k = 0; k < ring.length; k += 2) {
        sx += ring[k]!;
        sy += ring[k + 1]!;
      }
      const d = (sx / pts) * 2 / TILE_W;
      const sum = ((sy / pts + z * Z_PX) * 2) / TILE_H;
      const x = (sum + d) / 2;
      const y = (sum - d) / 2;
      return x > b.tx && x < b.tx + b.size && y > b.ty && y < b.ty + (b.depth ?? b.size);
    };
    const over = b.baseZ + 0.1;
    const wet = cityScene({ ...view, sea: { inner: over, outer: over } }, options).filter((s) => s.fill === SEA && footprint(s, over));
    expect(wet.length).toBeGreaterThan(0);
    const under = b.baseZ - 0.3;
    expect(cityScene({ ...view, sea: { inner: under, outer: under } }, options).filter((s) => s.fill === SEA && footprint(s, under))).toEqual([]);
  });

  it("would notice the waterline 10 cm higher behind the wall - the tolerance is not vacuous", () => {
    const golden = decodePng(readFileSync(path));
    expect(frameDifference(golden, render({ ...FLOOD_SEA, inner: FLOOD_SEA.inner + 0.01 }))).toBeGreaterThan(TOLERANCE);
    expect(frameDifference(golden, render({ ...FLOOD_SEA, outer: FLOOD_SEA.outer + 0.01 }))).toBeGreaterThan(TOLERANCE);
  });
});


/**
 * Each tile of the drowning city (Batch 24's fixture) as the scene draws it:
 * water over every tile the simulation calls wet, none over a tile it calls
 * dry. Read from the shapes, not the pixels: a low tile behind a steep rise
 * is rightly hidden in the picture, and the grid's boundary is drawn over
 * its edge tiles (both met when this first sampled pixels). Each water shape
 * is taken back from the screen to the ground at the waterline, to its tile.
 * The ground is drawn through its tile corners here (the world's half-tile
 * samples left out), and a tile the shoreline crosses - corners either side
 * of the waterline - is left out: its middle is where the plane meets the ground.
 * (One tile 2 cm from the waterline disagreed at first: the picture rounds it.)
 */
describe("the water plane draws the simulation's flood", () => {
  const START = fixture();

  function look(substeps: number): { wet: number; dry: number; mismatches: string[]; simWet: number } {
    let s = START;
    for (let i = 0; i < substeps; i += 1) s = advance(s, 1, rising);
    const full = cityView(s.settlements[0]!, channels(s), t);
    const { fine: _fine, ...world } = full.world;
    const view: CityView = { ...full, buildings: [], rocks: full.rocks.map(() => "none"), world: { ...world, rocks: [] } };
    const n = view.tiles;
    const m = n + 1;
    const seaZ = view.sea!.inner;
    const drawnZ = Math.round(seaZ * 200) / 200;
    const drawn = new Set<number>();
    for (const shape of cityScene(view, { time: 1, selected: null, ghost: null, quality: "high" })) {
      if (shape.fill !== SEA) continue;
      const ring = shape.rings[0]!;
      let sx = 0;
      let sy = 0;
      for (let k = 0; k < ring.length; k += 2) {
        sx += ring[k]!;
        sy += ring[k + 1]!;
      }
      sx /= ring.length / 2;
      sy /= ring.length / 2;
      // Back to the ground at the waterline: x - y from across the screen, x + y from down it.
      const d = (sx * 2) / TILE_W;
      const sum = ((sy + drawnZ * Z_PX) * 2) / TILE_H;
      const x = Math.floor((sum + d) / 2);
      const y = Math.floor((sum - d) / 2);
      if (x >= 0 && y >= 0 && x < n && y < n) drawn.add(y * n + x);
    }
    let wet = 0;
    let dry = 0;
    const mismatches: string[] = [];
    for (let ty = 0; ty < n; ty += 1) {
      for (let tx = 0; tx < n; tx += 1) {
        const corners = [view.corners[ty * m + tx]!, view.corners[ty * m + tx + 1]!, view.corners[(ty + 1) * m + tx]!, view.corners[(ty + 1) * m + tx + 1]!];
        // The picture rounds the waterline to the 200th of a tile (2.5 cm either way): a tile within it is on the shoreline too.
        const lo = Math.min(seaZ, drawnZ);
        const hi = Math.max(seaZ, drawnZ);
        if (!corners.every((c) => c < lo) && !corners.every((c) => c > hi)) continue;
        const simWet = view.wet[ty * n + tx] === true;
        if (simWet) wet += 1;
        else dry += 1;
        if (drawn.has(ty * n + tx) !== simWet) mismatches.push(`${tx},${ty}: the simulation says ${simWet ? "wet" : "dry"}, the scene draws ${simWet ? "no water" : "water"}`);
      }
    }
    return { wet, dry, mismatches, simWet: view.wet.filter(Boolean).length };
  }

  it("draws water on exactly the wet tiles, and the shoreline moves inland as the sea rises", () => {
    // 14 substeps up the sea stands 6.5 m under the base, 22 up at it. Measured: 42 tiles wet and 958 dry (of those
    // the shoreline leaves clear), then 596 and 294; the simulation's whole count, 48 then 659.
    const early = look(14);
    const late = look(22);
    expect(early.mismatches).toEqual([]);
    expect(late.mismatches).toEqual([]);
    // Both kinds seen, in numbers, at both heights.
    for (const x of [early, late]) {
      expect(x.wet).toBeGreaterThan(30);
      expect(x.dry).toBeGreaterThan(200);
    }
    expect(late.simWet).toBeGreaterThan(early.simWet);
    expect(late.wet).toBeGreaterThan(early.wet);
  });
});
