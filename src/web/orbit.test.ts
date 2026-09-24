import { describe, expect, it } from "vitest";

import { toPlanetJs } from "../render/globe-shader.js";
import { ORBIT, coast, drag, hold, initialOrbit, zoomBy } from "./orbit.js";

describe("the globe turns under the hand", () => {
  it("turns by one radian for one radius of drag", () => {
    const o = drag(initialOrbit(), 300, 0, 300, 1 / 60);
    expect(o.yaw).toBeCloseTo(1, 12);
  });

  it("never tips past the pole, however far you drag", () => {
    let o = initialOrbit();
    for (let i = 0; i < 50; i += 1) o = drag(o, 0, 400, 300, 1 / 60);
    expect(o.pitch).toBe(ORBIT.maxPitch);
    for (let i = 0; i < 100; i += 1) o = drag(o, 0, -400, 300, 1 / 60);
    expect(o.pitch).toBe(-ORBIT.maxPitch);
  });

  it("keeps turning after a flick, and slows down", () => {
    const flicked = drag(initialOrbit(), 30, 0, 300, 1 / 60);
    const a = coast(flicked, 0.1);
    const b = coast(a, 0.1);
    expect(a.yaw).toBeGreaterThan(flicked.yaw);
    expect(b.yaw - a.yaw).toBeLessThan(a.yaw - flicked.yaw);
  });

  it("stops dead when held, instead of sliding out from under the cursor", () => {
    const flicked = drag(initialOrbit(), 30, 0, 300, 1 / 60);
    const held = coast(hold(flicked), 0.5);
    expect(held.yaw).toBe(flicked.yaw);
  });

  it("spins slowly on its own once left alone, and not before", () => {
    let o = hold(initialOrbit());
    o = coast(o, ORBIT.idleDelay * 0.9);
    expect(o.yaw).toBe(0);
    for (let i = 0; i < 600; i += 1) o = coast(o, 1 / 60);
    expect(o.yaw).toBeGreaterThan(0);
  });

  it("zooms within its bounds", () => {
    let o = initialOrbit();
    for (let i = 0; i < 100; i += 1) o = zoomBy(o, 500);
    expect(o.zoom).toBe(ORBIT.minZoom);
    for (let i = 0; i < 100; i += 1) o = zoomBy(o, -500);
    expect(o.zoom).toBe(ORBIT.maxZoom);
  });
});

describe("the surface follows the cursor", () => {
  // The first globe turned AGAINST the hand: drag right, planet turned left.
  // Checked through the real drag and the shader's own rotation (mirrored in
  // TypeScript as toPlanetJs), at the default tilt and at a tipped one.
  const dist = (a: readonly number[], b: readonly number[]): number =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

  for (const pitch of [initialOrbit().pitch, -0.6]) {
    it(`dragging right brings the ground from the left of centre to the centre (pitch ${pitch})`, () => {
      const before = { ...initialOrbit(), pitch };
      const after = drag(before, 60, 0, 300, 1 / 60);
      const nowAtCentre = toPlanetJs([0, 0, 1], after.yaw, after.pitch);
      const s = Math.sin(0.2);
      const c = Math.cos(0.2);
      const wasLeft = toPlanetJs([-s, 0, c], before.yaw, before.pitch);
      const wasRight = toPlanetJs([s, 0, c], before.yaw, before.pitch);
      expect(dist(nowAtCentre, wasLeft)).toBeLessThan(dist(nowAtCentre, wasRight));
    });
  }

  it("dragging down tips the north pole toward the viewer", () => {
    const after = drag(initialOrbit(), 0, 60, 300, 1 / 60);
    // The centre of the screen now sits at a higher latitude than before.
    expect(toPlanetJs([0, 0, 1], after.yaw, after.pitch)[1]).toBeGreaterThan(
      toPlanetJs([0, 0, 1], initialOrbit().yaw, initialOrbit().pitch)[1],
    );
  });
});
