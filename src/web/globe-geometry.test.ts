/**
 * Batch 17's exit gate: a settlement marker is drawn exactly where the
 * globe's own rotation puts that surface point, and hidden when that point
 * faces away.
 *
 * "The globe's own rotation" is `toPlanetJs`, the TypeScript mirror of the
 * shader's `toPlanet`. The marker is PLACED with the inverse, `toViewJs`; the
 * test checks the placement by going back through `toPlanetJs`, so a wrong
 * inverse fails. Visibility is checked against an independent fact: a point
 * faces the viewer exactly when it lies on the same side of the planet as the
 * point at the centre of the disc.
 */

import { describe, expect, it } from "vitest";

import { toPlanetJs, toViewJs } from "../render/globe-shader.js";
import { latLonToVec } from "../sim/index.js";
import type { GlobeCamera } from "./globe-geometry.js";
import { pickPlanet, projectToScreen } from "./globe-geometry.js";

const CAMERAS: readonly GlobeCamera[] = [
  { cx: 640, cy: 400, radius: 330, yaw: 0, pitch: 0.42 },
  { cx: 900, cy: 380, radius: 280, yaw: 1.3, pitch: -0.6 },
  { cx: 500, cy: 520, radius: 410, yaw: -2.2, pitch: 1.2 },
  { cx: 640, cy: 400, radius: 330, yaw: 7.9, pitch: 0 },
];

const SITES: readonly (readonly [number, number])[] = [];
for (let i = 0; i <= 12; i += 1) {
  for (let j = 0; j < 24; j += 1) {
    (SITES as [number, number][]).push([-1.5 + i * 0.25, -Math.PI + (j + 0.5) * (Math.PI / 12)]);
  }
}

const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("a marker sits on its spot on the turning globe", () => {
  it("is drawn where the globe's rotation puts that surface point, at every camera", () => {
    // Measured worst 9.0e-14 on the unit sphere, away from the very limb where
    // a square root loses precision.
    let worst = 0;
    let checked = 0;
    for (const cam of CAMERAS) {
      for (const [lat, lon] of SITES) {
        const p = latLonToVec(lat, lon);
        const s = projectToScreen(p, cam);
        if (!s.visible || s.depth < 1e-3) continue;
        checked += 1;
        // Back through the SHADER's rotation, from the pixel the marker is on.
        const dx = (s.x - cam.cx) / cam.radius;
        const dy = (cam.cy - s.y) / cam.radius;
        const underMarker = toPlanetJs([dx, dy, Math.sqrt(1 - dx * dx - dy * dy)], cam.yaw, cam.pitch);
        worst = Math.max(worst, dist(underMarker, p));
      }
    }
    expect(checked, "no marker was on the visible side, so nothing was checked").toBeGreaterThan(500);
    expect(worst).toBeLessThan(1e-11);
  });

  it("hides exactly the markers on the far side", () => {
    let shown = 0;
    let hidden = 0;
    for (const cam of CAMERAS) {
      const centre = toPlanetJs([0, 0, 1], cam.yaw, cam.pitch);
      for (const [lat, lon] of SITES) {
        const p = latLonToVec(lat, lon);
        const facing = p[0] * centre[0] + p[1] * centre[1] + p[2] * centre[2];
        if (Math.abs(facing) < 1e-9) continue; // on the limb itself
        const s = projectToScreen(p, cam);
        expect(s.visible, `lat ${lat} lon ${lon.toFixed(3)} at yaw ${cam.yaw}`).toBe(facing > 0);
        if (s.visible) shown += 1;
        else hidden += 1;
      }
    }
    // Both halves of the claim were exercised.
    expect(shown).toBeGreaterThan(100);
    expect(hidden).toBeGreaterThan(100);
  });

  it("uses an inverse that really is one", () => {
    // Measured worst 4.0e-16.
    for (const cam of CAMERAS) {
      for (const [lat, lon] of SITES) {
        const p = latLonToVec(lat, lon);
        expect(dist(toPlanetJs(toViewJs(p, cam.yaw, cam.pitch), cam.yaw, cam.pitch), p)).toBeLessThan(1e-14);
      }
    }
  });
});

describe("picking a founding site", () => {
  it("returns the surface point under the cursor, the same one a marker there would mark", () => {
    const cam = CAMERAS[1]!;
    // A site well on the facing side at this camera (not a guess: chosen by depth).
    const site = SITES.map(([lat, lon]) => latLonToVec(lat, lon)).find((q) => projectToScreen(q, cam).depth > 0.5);
    expect(site, "no site faces this camera").toBeDefined();
    const p = site!;
    const s = projectToScreen(p, cam);
    const picked = pickPlanet(s.x, s.y, cam);
    expect(picked).not.toBeNull();
    expect(dist(picked!, p)).toBeLessThan(1e-11);
  });

  it("returns nothing off the disc - clicking space founds nothing", () => {
    const cam = CAMERAS[0]!;
    expect(pickPlanet(cam.cx + cam.radius * 1.01, cam.cy, cam)).toBeNull();
    expect(pickPlanet(5, 5, cam)).toBeNull();
    expect(pickPlanet(cam.cx, cam.cy, cam)).not.toBeNull();
  });
});
