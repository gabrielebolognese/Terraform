/**
 * Micro doc §1 - the three coordinate spaces round-trip, and the local frame
 * points the way its names say. Tolerances are MEASURED (Batch 17), each with
 * the measurement beside it.
 */

import { describe, expect, it } from "vitest";

import { MARS_RADIUS_M } from "../planets/mars.js";
import { DEFAULT_TUNING as t } from "../tuning.js";
import {
  footprintFits,
  footprintTiles,
  gridTiles,
  latLonToVec,
  onGrid,
  planetToWorld,
  tangentFrame,
  tileToWorld,
  vecToLatLon,
  worldToPlanet,
  worldToTile,
  wrapLongitude,
} from "./space.js";

// A lat/lon grid that approaches but never sits on a pole, where longitude is undefined.
const LATS = Array.from({ length: 37 }, (_, i) => -Math.PI / 2 * 0.999 + i * ((Math.PI * 0.999) / 36));
const LONS = Array.from({ length: 72 }, (_, i) => -Math.PI + (i + 0.5) * ((2 * Math.PI) / 72));

describe("planetary space (§1.1)", () => {
  it("uses the doc's formula: x = cos lat cos lon, y = sin lat, z = cos lat sin lon", () => {
    const [x, y, z] = latLonToVec(0.3, 1.1, 2);
    expect(x).toBeCloseTo(2 * Math.cos(0.3) * Math.cos(1.1), 15);
    expect(y).toBeCloseTo(2 * Math.sin(0.3), 15);
    expect(z).toBeCloseTo(2 * Math.cos(0.3) * Math.sin(1.1), 15);
  });

  it("round-trips lat/lon through the 3D point", () => {
    // Measured worst 6.4e-15 rad over this grid.
    let worst = 0;
    for (const lat of LATS) {
      for (const lon of LONS) {
        const back = vecToLatLon(latLonToVec(lat, lon));
        worst = Math.max(worst, Math.abs(back.lat - lat), Math.abs(wrapLongitude(back.lon - lon)));
      }
    }
    expect(worst).toBeLessThan(1e-13);
  });

  it("wraps longitude into (-pi, pi] without moving the place", () => {
    for (const lon of [-7, -Math.PI, 0, Math.PI, 4, 100]) {
      const w = wrapLongitude(lon);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      const [a, , c] = latLonToVec(0.2, lon);
      const [a2, , c2] = latLonToVec(0.2, w);
      expect(Math.hypot(a - a2, c - c2)).toBeLessThan(1e-12);
    }
  });
});

describe("settlement world space (§1.2)", () => {
  it("round-trips metres through the planet, at Mars's real radius", () => {
    // Measured worst 5.5e-10 m: float resolution at 3.39e6 m.
    let worst = 0;
    for (const lat of LATS) {
      for (const lon of LONS) {
        for (const [x, y] of [[0, 0], [160, -155], [-3000, 42.5]] as const) {
          const w = planetToWorld(lat, lon, worldToPlanet(lat, lon, x, y, MARS_RADIUS_M), MARS_RADIUS_M);
          worst = Math.max(worst, Math.abs(w.x - x), Math.abs(w.y - y));
        }
      }
    }
    expect(worst).toBeLessThan(1e-8);
  });

  it("points north toward higher latitude and east toward higher longitude", () => {
    // Behaviour, not the cross product: step a little along each axis and see
    // which way the coordinates move.
    for (const [lat, lon] of [[0, 0], [0.7, -2], [-1.1, 2.9]] as const) {
      const { north, east, up } = tangentFrame(lat, lon);
      const step = (d: readonly number[]) => vecToLatLon([up[0] + d[0]! * 1e-4, up[1] + d[1]! * 1e-4, up[2] + d[2]! * 1e-4]);
      expect(step(north).lat).toBeGreaterThan(lat);
      expect(wrapLongitude(step(east).lon - lon)).toBeGreaterThan(0);
    }
  });

  it("keeps the frame orthonormal", () => {
    for (const lat of [0, 0.9, -1.4]) {
      const { up, east, north } = tangentFrame(lat, 0.5);
      const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      expect(Math.abs(dot(up, east))).toBeLessThan(1e-15);
      expect(Math.abs(dot(up, north))).toBeLessThan(1e-15);
      expect(Math.abs(dot(east, north))).toBeLessThan(1e-15);
      expect(dot(north, north)).toBeCloseTo(1, 14);
    }
  });
});

describe("tile space (§1.3)", () => {
  it("sizes the grids as §3.3 says: 32 for a city, 16 for an outpost", () => {
    expect(gridTiles("city", t)).toBe(32);
    expect(gridTiles("outpost", t)).toBe(16);
  });

  it("round-trips every tile exactly through world space", () => {
    for (const kind of ["city", "outpost"] as const) {
      const n = gridTiles(kind, t);
      for (let tx = 0; tx < n; tx += 1) {
        for (let ty = 0; ty < n; ty += 1) {
          const w = tileToWorld(tx, ty, n, t);
          expect(worldToTile(w.x, w.y, n, t)).toEqual({ tx, ty });
        }
      }
    }
  });

  it("centres the grid on the settlement's coordinate", () => {
    const corner = tileToWorld(0, 0, 32, t);
    const far = tileToWorld(31, 31, 32, t);
    expect(corner.x + far.x).toBeCloseTo(0, 12);
    expect(corner.y + far.y).toBeCloseTo(0, 12);
    expect(far.x - corner.x).toBe(31 * t.TILE_METRES);
  });

  it("knows which footprints fit on the grid", () => {
    expect(footprintTiles({ tx: 2, ty: 3, w: 2, h: 3 })).toHaveLength(6);
    expect(footprintFits({ tx: 29, ty: 29, w: 3, h: 3 }, 32)).toBe(true);
    expect(footprintFits({ tx: 30, ty: 29, w: 3, h: 3 }, 32)).toBe(false);
    expect(footprintFits({ tx: -1, ty: 0, w: 1, h: 1 }, 32)).toBe(false);
    expect(onGrid(1.5, 0, 32)).toBe(false);
  });
});
