/**
 * The open world and its ground (at the user's request):
 *   "make it open world, but with building boundaries";
 *   "smoothed out, so the different level is visible but it doesn't look fake";
 *   "building on a slope terrain builds concrete foundations under it";
 *   "the amount of green spreads as the biosphere grows".
 */

import { describe, expect, it } from "vitest";

import { flatten, referenceCity, renderCity } from "../harness/city-frames.js";
import type { CityBuildingView, CityView } from "../sim/index.js";
import { NEUTRAL_ENV, cityView, derive, habitat, makeTuning, worldEnv } from "../sim/index.js";
import type { CityQuality, CitySceneOptions } from "./city.js";
import { cityScene, groundColour, resetSceneCache } from "./city.js";

const at = (quality: CityQuality = "high"): CitySceneOptions => ({ time: 1, selected: null, ghost: null, quality });
const isGreen = (c: { r: number; g: number }): boolean => c.g > c.r;

/** A real site's view in the browser's tuning: hills, and the open world round it. */
const { state } = referenceCity();
const hills = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, hills), hills), hills, 0);
const site: CityView = cityView(state.settlements[0]!, env, hills);

describe("the ground greens with the planet", () => {
  const share = (greenery: number, z = 0, slope = 0): number => {
    let green = 0;
    for (let y = 0; y < 80; y += 1) for (let x = 0; x < 80; x += 1) if (isGreen(groundColour(x + 0.5, y + 0.5, z, slope, greenery))) green += 1;
    return green / 6400;
  };

  it("in step with the biosphere: at greenery g, about a share g of level ground is green", () => {
    // Measured: 0 at 0; 13.6% at 0.1, 30.1% at 0.25, 55.6% at 0.5, 79.5% at
    // 0.75, 100% at 1. (A guessed threshold greened 70% at 0.5; ends of
    // +-Infinity turned the ground bare again at 1.)
    expect(share(0)).toBe(0);
    for (const g of [0.1, 0.25, 0.5, 0.75]) expect(Math.abs(share(g) - g), `greenery ${g}`).toBeLessThan(0.08);
    expect(share(1)).toBe(1);
  });

  it("spreading, never flickering: ground green at some greenery stays green as it rises", () => {
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        let was = false;
        for (let g = 0; g <= 1.0001; g += 0.05) {
          const now = isGreen(groundColour(x + 0.5, y + 0.5, 0, 0, g));
          if (was) expect(now, `${x},${y} at ${g.toFixed(2)}`).toBe(true);
          was = now;
        }
      }
    }
  });

  it("valleys first, and never the cliffs", () => {
    expect(share(0.3, -4)).toBeGreaterThan(share(0.3, 0));
    expect(share(0.3, 0)).toBeGreaterThan(share(0.3, 8));
    expect(share(1, 0, 1.2)).toBe(0);
  });

  it("redraws the kept ground when only its corners change - the ground is drawn through them", () => {
    const m = site.tiles + 1;
    const corners = [...site.corners];
    corners[10 * m + 10] = (corners[10 * m + 10] ?? 0) + 0.5;
    const moved = { ...site, corners };
    resetSceneCache();
    cityScene(site, at());
    const cached = cityScene(moved, at());
    resetSceneCache();
    expect(cached).toEqual(cityScene(moved, at()));
  });

  it("redraws the kept ground as the planet greens", () => {
    resetSceneCache();
    cityScene(site, at());
    const cached = cityScene({ ...site, greenery: 0.6 }, at());
    resetSceneCache();
    expect(cached).toEqual(cityScene({ ...site, greenery: 0.6 }, at()));
    expect(cached).not.toEqual(cityScene(site, at()));
  });
});

describe("the open world", () => {
  it("draws ground far beyond the buildable grid, on every side", () => {
    // Any shape of ground whose points lie outside the grid's diamond in tile space.
    const shapes = cityScene(site, at("low"));
    expect(shapes.length).toBeGreaterThan(cityScene({ ...site, world: { margin: 0, size: site.tiles, corners: site.corners, caves: [], rocks: [] } }, at("low")).length * 2);
  });

  it("marks the building boundary on the ground - up close and at medium, not furthest out", () => {
    const boundaryColour = (q: CityQuality): number => {
      resetSceneCache();
      return cityScene(site, at(q)).filter((s) => s.fill.r === 1 && s.fill.g === 0.86 && s.fill.b === 0.55).length;
    };
    // Two dashes of four sides every other tile: 16 a side on a 32-tile grid.
    expect(boundaryColour("high")).toBe(64);
    expect(boundaryColour("medium")).toBe(64);
    expect(boundaryColour("low")).toBe(0);
  });

  it("opens caves in its rock faces", () => {
    expect(site.world.caves.length).toBeGreaterThan(0);
    resetSceneCache();
    const dark = cityScene(site, at("high")).filter((s) => s.fill.r === 0.07 && s.fill.g === 0.05 && s.fill.b === 0.05).length;
    expect(dark).toBe(site.world.caves.length);
  });
});

describe("foundations", () => {
  const depot = (baseZ: number): CityBuildingView => ({ index: 0, type: "storage_depot", tx: 14, ty: 14, size: 1, operable: true, activity: 1, baseZ, submerged: false, network: null });
  const foundation = (view: CityView): number => {
    resetSceneCache();
    // The foundation's lit sides and top, in concrete; the depot itself is drawn in other colours.
    return cityScene(view, at("high")).filter((s) => Math.abs(s.fill.r - s.fill.g) < 0.02 && Math.abs(s.fill.g - s.fill.b) < 0.04 && s.fill.r > 0.45 && s.fill.r < 0.75).length;
  };

  it("stand a building on a slope on concrete down to the ground, and one on level ground on none", () => {
    const flat = flatten(site);
    const m = flat.tiles + 1;
    // The ground under the depot falls away to one side.
    const corners = [...flat.corners];
    corners[15 * m + 15] = -0.6;
    corners[15 * m + 14] = -0.3;
    const sloped: CityView = { ...flat, corners };
    const onSlope = foundation({ ...sloped, buildings: [depot(0)] }) - foundation({ ...sloped, buildings: [] });
    const onFlat = foundation({ ...flat, buildings: [depot(0)] }) - foundation({ ...flat, buildings: [] });
    expect(onSlope).toBeGreaterThan(onFlat);
  });
});

describe("the ground up close (the user: \"smooth out the graphics ... canyons and craters higher quality\")", () => {
  // The site's ground alone: no buildings, no rocks, no world round it.
  const ground: CityView = { ...site, buildings: [], rocks: site.rocks.map(() => "none"), world: { ...site.world, rocks: [], caves: [] } };

  it("is drawn through the half-tile samples up close, and through tile corners further away", () => {
    // A bump between the corners, in the half-tile samples only: seen at full detail, not at medium.
    const fine = [...(ground.world.fine ?? [])];
    const f = 2 * ground.world.size + 1;
    const i = (2 * (10 + ground.world.margin) + 1) * f + 2 * (10 + ground.world.margin) + 1;
    fine[i] = (fine[i] ?? 0) + 0.6;
    const bumped: CityView = { ...ground, world: { ...ground.world, fine } };
    const differs = (q: CityQuality): boolean => {
      resetSceneCache();
      const a = cityScene(ground, at(q));
      resetSceneCache();
      return JSON.stringify(cityScene(bumped, at(q))) !== JSON.stringify(a);
    };
    expect(differs("high")).toBe(true);
    expect(differs("medium")).toBe(false);
  });

  it("shows strata on rock faces - canyon walls, crater bowls - and none on level ground", () => {
    // Up a face the colour goes light, dark, light in bands; on level ground it
    // only shades steadily with height (the regolith's ramp). Count the turns.
    const turns = (slope: number): number => {
      const r = Array.from({ length: 13 }, (_, k) => groundColour(40.5, 40.5, k * 0.25, slope, 0).r);
      let n = 0;
      for (let k = 2; k < r.length; k += 1) if ((r[k]! - r[k - 1]!) * (r[k - 1]! - r[k - 2]!) < 0) n += 1;
      return n;
    };
    expect(turns(1)).toBeGreaterThanOrEqual(2);
    expect(turns(0)).toBe(0);
  });

  it("grows shrubs on the green, up close only - more of them as the planet greens, none on bare ground", () => {
    // The grid alone (the world round it grows its own).
    const { fine: _drop, ...plainWorld } = ground.world;
    const grid: CityView = { ...ground, world: { ...plainWorld, margin: 0, size: ground.tiles, corners: ground.corners } };
    const leaves = (v: CityView, q: CityQuality): number => {
      resetSceneCache();
      // Shrubs are the only shapes with more green than red that are not ground triangles.
      return cityScene(v, at(q)).filter((sh) => sh.rings[0]!.length > 6 && sh.fill.g > sh.fill.r * 1.1).length;
    };
    const some = leaves({ ...grid, greenery: 0.3 }, "high");
    expect(some).toBeGreaterThan(0);
    // Only where the ground reads green: more of it green, more shrubs.
    expect(leaves({ ...grid, greenery: 0.9 }, "high")).toBeGreaterThan(some);
    expect(leaves({ ...grid, greenery: 0 }, "high")).toBe(0);
    expect(leaves({ ...grid, greenery: 0.8 }, "medium")).toBe(0);
  });
});

describe("hard rock in the picture", () => {
  const plain = flatten(site);
  const withRock = (steep: boolean): CityView => ({ ...plain, buildings: [], steep: plain.steep.map((_, i) => (i === 12 * 32 + 12 ? steep : false)), rocks: plain.rocks.map((_, i) => (i === 12 * 32 + 12 ? "crag" : "none")) });
  const boulderShapes = (v: CityView): number => {
    resetSceneCache();
    return cityScene(v, at("high")).length;
  };

  it("draws a cluster's boulders, but not a boulder on every cliff: a cliff is its own bare rock", () => {
    const none: CityView = { ...plain, buildings: [], rocks: plain.rocks.map(() => "none") };
    expect(boulderShapes(withRock(false))).toBeGreaterThan(boulderShapes(none));
    expect(boulderShapes(withRock(true))).toBe(boulderShapes({ ...none, steep: withRock(true).steep }));
  });
});
