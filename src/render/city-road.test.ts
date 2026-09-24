/**
 * Roads in the picture (at the user's request): the surface, a connection
 * point where a road meets a building, rovers driving the roads, and a badge
 * that says "not connected" by its shape.
 */

import { describe, expect, it } from "vitest";

import { referenceCity, renderCity } from "../harness/city-frames.js";
import type { CityBuildingView, CityView } from "../sim/index.js";
import type { CityQuality, CitySceneOptions } from "./city.js";
import { cityScene, resetSceneCache } from "./city.js";
import { frameDifference } from "./planet.js";

const { view: reference } = referenceCity();
const n = reference.tiles;
/** Flat, open ground: whatever is drawn is the roads' and the buildings' doing. */
const open: CityView = { ...reference, id: "open", buildings: [], groundZ: reference.groundZ.map(() => 0), steep: reference.steep.map(() => false) };

const at = (quality: CityQuality, time = 1): CitySceneOptions => ({ time, selected: null, ghost: null, quality });

function withRoads(view: CityView, tiles: readonly (readonly [number, number])[]): CityView {
  const roads = [...view.roads];
  for (const [x, y] of tiles) roads[y * n + x] = true;
  return { ...view, roads };
}

const depot = (tx: number, ty: number, extra: Partial<CityBuildingView> = {}): CityBuildingView => ({
  index: 0,
  type: "storage_depot",
  tx,
  ty,
  size: 1,
  operable: true,
  activity: 1,
  baseZ: 0,
  submerged: false,
  network: null,
  ...extra,
});

/** A straight road ten tiles long, along x at row 12. */
const street = withRoads(open, Array.from({ length: 10 }, (_, i) => [8 + i, 12] as const));

describe("roads", () => {
  it("are drawn, at every level of detail", () => {
    // Low merges flat ground into patches; a road must not be swallowed by one.
    for (const quality of ["high", "medium", "low"] as const) {
      resetSceneCache();
      const bare = renderCity(open, at(quality), 480, 300, false);
      resetSceneCache();
      expect(frameDifference(renderCity(street, at(quality), 480, 300, false), bare), quality).toBeGreaterThan(0);
    }
  });

  it("appear the moment they are laid: the kept ground is thrown away with the old layout", () => {
    resetSceneCache();
    cityScene(open, at("high"));
    const cached = cityScene(street, at("high"));
    resetSceneCache();
    expect(cached).toEqual(cityScene(street, at("high")));
  });
});

describe("connection points", () => {
  /** Shapes lit in the connection point's lamp colour. */
  const lamps = (view: CityView, quality: CityQuality = "high"): number => {
    resetSceneCache();
    return cityScene(view, at(quality)).filter((s) => s.fill.r === 1 && s.fill.g === 0.72 && s.fill.b === 0.25).length;
  };
  // A depot at 14,14; roads on its four sides, or two.
  const four = withRoads({ ...open, buildings: [depot(14, 14)] }, [[13, 14], [15, 14], [14, 13], [14, 15]]);
  const two = withRoads({ ...open, buildings: [depot(14, 14)] }, [[13, 14], [14, 13]]);

  it("stand where a road meets a building, one to a side", () => {
    const perSide = lamps(two) / 2;
    expect(perSide).toBeGreaterThan(0);
    expect(lamps(four)).toBe(4 * perSide);
  });

  it("stand nowhere else: not on a road with no building beside it", () => {
    expect(lamps(street)).toBe(0);
    // The same roads as `four`, with the depot gone.
    expect(lamps({ ...four, buildings: [] })).toBe(0);
  });

  it("are one to a side however long the side: a street is not a row of bollards", () => {
    // A 3 x 3 dome with road all along its west side: one connection point, not three.
    const dome: CityBuildingView = { ...depot(14, 14), type: "habitat_dome", size: 3 };
    const west = withRoads({ ...open, buildings: [dome] }, [[13, 14], [13, 15], [13, 16]]);
    const oneTile = withRoads({ ...open, buildings: [dome] }, [[13, 15]]);
    expect(lamps(west)).toBe(lamps(oneTile));
  });
});

describe("rovers", () => {
  it("drive the roads up close: the picture changes with time where there is road, and only there", () => {
    const frameAt = (view: CityView, time: number) => {
      resetSceneCache();
      return renderCity(view, at("high", time), 480, 300, false);
    };
    expect(frameDifference(frameAt(street, 1), frameAt(street, 4.2))).toBeGreaterThan(0);
    // No road, nothing moves: vacuity guard for the line above.
    expect(frameDifference(frameAt(open, 1), frameAt(open, 4.2))).toBe(0);
  });

  it("are left out further away, like every moving part", () => {
    for (const quality of ["medium", "low"] as const) {
      resetSceneCache();
      const a = cityScene(street, at(quality, 1));
      expect(cityScene(street, at(quality, 4.2)), quality).toEqual(a);
    }
  });
});

describe("the not-connected badge", () => {
  it("differs from the badge for any other reason a building is off", () => {
    const off = { ...open, buildings: [depot(14, 14, { operable: false, activity: 0 })] };
    const unlinked = { ...open, buildings: [depot(14, 14, { operable: false, activity: 0, network: { kind: "unsupplied", resources: ["power"] } })] };
    resetSceneCache();
    const a = cityScene(off, at("high"));
    resetSceneCache();
    const b = cityScene(unlinked, at("high"));
    expect(b).not.toEqual(a);
    // And both have a badge: a running depot has none.
    resetSceneCache();
    expect(a.length).toBeGreaterThan(cityScene({ ...open, buildings: [depot(14, 14)] }, at("high")).length);
  });
});
