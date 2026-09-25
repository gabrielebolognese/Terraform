/**
 * Micro §3.2: "Pan (drag), zoom (clamped range), no rotation."
 */

import { describe, expect, it } from "vitest";

import { isoProject } from "../render/iso.js";
import type { CityCamera } from "./city-camera.js";
import { sceneBounds } from "../render/city.js";
import {
  CITY_ZOOM_MAX,
  CITY_ZOOM_MIN,
  centreCamera,
  clampCamera,
  footprintOrigin,
  isoToScreen,
  pan,
  qualityFor,
  screenToIso,
  tileAt,
  zoomAt,
} from "./city-camera.js";

const W = 1200;
const H = 800;
const TILES = 32;

describe("the city camera", () => {
  it("opens centred on the settlement", () => {
    const cam = centreCamera(TILES, W);
    const centre = isoProject(TILES / 2, TILES / 2);
    expect(isoToScreen(cam, W, H, centre.sx, centre.sy)).toEqual({ px: W / 2, py: H / 2 });
  });

  it("clamps zoom at both ends, however hard the wheel turns", () => {
    let cam = centreCamera(TILES, W);
    for (let i = 0; i < 100; i += 1) cam = zoomAt(cam, 1.5, W / 2, H / 2, W, H, TILES);
    expect(cam.zoom).toBe(CITY_ZOOM_MAX);
    for (let i = 0; i < 100; i += 1) cam = zoomAt(cam, 1 / 1.5, W / 2, H / 2, W, H, TILES);
    expect(cam.zoom).toBe(CITY_ZOOM_MIN);
  });

  it("zooms about the pointer: the ground under it stays under it", () => {
    const cam = centreCamera(TILES, W);
    const before = screenToIso(cam, W, H, 300, 250);
    const next = zoomAt(cam, 1.3, 300, 250, W, H, TILES);
    const after = isoToScreen(next, W, H, before.sx, before.sy);
    expect(after.px).toBeCloseTo(300, 9);
    expect(after.py).toBeCloseTo(250, 9);
  });

  it("pans with the pointer, and can never lose the city off-screen", () => {
    const cam = centreCamera(TILES, W);
    const moved = pan(cam, 40, -25, TILES);
    expect(moved.cx).toBeCloseTo(cam.cx - 40 / cam.zoom, 9);
    expect(moved.cy).toBeCloseTo(cam.cy + 25 / cam.zoom, 9);
    let far: CityCamera = cam;
    for (let i = 0; i < 200; i += 1) far = pan(far, 500, 500, TILES);
    // The view centre is pinned to the grid's own box: some of the city is always in view.
    const corner = isoProject(0, TILES);
    expect(far.cx).toBeCloseTo(corner.sx, 9);
  });

  it("finds the tile under the pointer, and nothing off the grid", () => {
    const cam = centreCamera(TILES, W);
    const mid = isoProject(7.5, 20.5);
    const p = isoToScreen(cam, W, H, mid.sx, mid.sy);
    expect(tileAt(cam, W, H, p.px, p.py, TILES)).toEqual({ tx: 7, ty: 20 });
    const outside = isoProject(-2, 5);
    const q = isoToScreen(cam, W, H, outside.sx, outside.sy);
    expect(tileAt(cam, W, H, q.px, q.py, TILES)).toBeNull();
  });

  it("centres a footprint on the tile under the pointer", () => {
    expect(footprintOrigin(10, 10, 1)).toEqual({ tx: 10, ty: 10 });
    expect(footprintOrigin(10, 10, 2)).toEqual({ tx: 10, ty: 10 });
    expect(footprintOrigin(10, 10, 3)).toEqual({ tx: 9, ty: 9 });
  });

  describe("the open world (at the user's request)", () => {
    const grid = sceneBounds(32);
    const world = sceneBounds(32, 0, 48);

    it("pans off the buildable grid into the world round it", () => {
      const far = clampCamera({ cx: grid.maxX + 1500, cy: grid.maxY + 1500, zoom: 1 }, 32, 48);
      expect(far.cx).toBeGreaterThan(grid.maxX);
      expect(far.cy).toBeGreaterThan(grid.maxY);
    });

    it("but no further than the world's edge", () => {
      const beyond = clampCamera({ cx: 1e6, cy: -1e6, zoom: 1 }, 32, 48);
      expect(beyond.cx).toBe(world.maxX);
      expect(beyond.cy).toBe(world.minY);
      // Without a world, the grid's own box, as before.
      expect(clampCamera({ cx: 1e6, cy: 1e6, zoom: 1 }, 32).cx).toBe(grid.maxX);
    });

    it("zooms out far enough to see a whole city's world on a laptop", () => {
      // 128 tiles of world, 64 iso pixels a tile across, into 1,440 screen pixels.
      expect(CITY_ZOOM_MIN * 128 * 64).toBeLessThanOrEqual(1440);
    });
  });

  describe("level of detail (a zoomed-out metropolis lagged)", () => {
    const at = (zoom: number): CityCamera => ({ cx: 0, cy: 0, zoom });

    it("drops as the player zooms out of a metropolis, and comes back as they zoom in", () => {
      const levels = [3, 1.5, 1, 0.75, 0.5, 0.4, CITY_ZOOM_MIN].map((z) => qualityFor(at(z), 1600, 900, 96));
      expect(levels[0]).toBe("high");
      expect(levels.at(-1)).toBe("low");
      expect(levels).toContain("medium");
      // Never back up the ladder while zooming out.
      const rank = { high: 0, medium: 1, low: 2 } as const;
      for (let i = 1; i < levels.length; i += 1) expect(rank[levels[i]!]).toBeGreaterThanOrEqual(rank[levels[i - 1]!]);
    });

    it("keeps a city at full detail at city zoom, and steps down only once its open world fills the screen", () => {
      // A city's world is its 32-tile grid and 48 tiles of open world each side: 128 across.
      for (const z of [1, CITY_ZOOM_MAX]) expect(qualityFor(at(z), 1600, 900, 128), `zoom ${z}`).toBe("high");
      expect(qualityFor(at(CITY_ZOOM_MIN), 1600, 900, 128)).toBe("low");
      // A grid alone - no world round it - never has enough on screen to step down.
      expect(qualityFor(at(CITY_ZOOM_MIN), 2560, 1440, 32)).toBe("high");
    });

    it("counts what is on screen: a bigger window shows more and draws less of each", () => {
      expect(qualityFor(at(0.8), 800, 600, 96)).toBe("high");
      expect(qualityFor(at(0.8), 2560, 1440, 96)).not.toBe("high");
    });
  });
});
