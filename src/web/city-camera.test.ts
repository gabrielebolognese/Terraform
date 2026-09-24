/**
 * Micro §3.2: "Pan (drag), zoom (clamped range), no rotation."
 */

import { describe, expect, it } from "vitest";

import { isoProject } from "../render/iso.js";
import type { CityCamera } from "./city-camera.js";
import {
  CITY_ZOOM_MAX,
  CITY_ZOOM_MIN,
  centreCamera,
  footprintOrigin,
  isoToScreen,
  pan,
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
});
