/**
 * Building mode, drawn (at the user's request: "put the opacity of the
 * buildings at 30%, and delete their hitbox, only leave the 2D tiles red on
 * the ground"), and a building still going up: a worksite.
 */

import { describe, expect, it } from "vitest";

import { buildingSheet } from "../harness/city-frames.js";
import type { CitySceneOptions } from "./city.js";
import { SEE_THROUGH_ALPHA, cityScene, rayHit, resetSceneCache } from "./city.js";
import { isoProject } from "./iso.js";

const { view } = buildingSheet();
const at: CitySceneOptions = { time: 1, selected: null, ghost: null, quality: "high" };
const scene = (v: typeof view, o: CitySceneOptions) => {
  resetSceneCache();
  return cityScene(v, o);
};

describe("building mode", () => {
  it("draws every building see-through, and each footprint red on the ground", () => {
    const bare = scene({ ...view, buildings: [] }, at).length;
    const normal = scene(view, at);
    const through = scene(view, { ...at, seeThrough: true });
    const faint = (list: typeof normal): number => list.filter((s) => s.fill.a <= SEE_THROUGH_ALPHA + 1e-9).length;
    // The building shapes, less the few already fainter than that (glass, steam).
    expect(faint(through) - faint(normal)).toBeGreaterThan(0.9 * (normal.length - bare));
    const red = through.filter((s) => s.fill.r === 0.95 && s.fill.g === 0.3 && s.fill.b === 0.28);
    expect(red).toHaveLength(view.buildings.length);
    expect(normal.filter((s) => s.fill.r === 0.95 && s.fill.g === 0.3 && s.fill.b === 0.28)).toHaveLength(0);
  });

  it("gives buildings no hitbox: the pick finds the ground behind them", () => {
    const b = view.buildings[0]!;
    const s = isoProject(b.tx + 1.5, b.ty + 1.5, 1.8);
    expect(rayHit(view, s.sx, s.sy)?.kind).toBe("building");
    const g = rayHit(view, s.sx, s.sy, true);
    expect(g?.kind).toBe("ground");
    // Behind the dome: nearer the back corner than its footprint.
    expect(g!.tx + g!.ty).toBeLessThan(b.tx + b.ty);
  });
});

describe("a building going up", () => {
  it("is a worksite - lower than the building, and growing as the work goes on", () => {
    const height = (construction: number | null): number => {
      const v = { ...view, buildings: [{ ...view.buildings[0]!, construction }] };
      let top = Infinity;
      for (const s of scene(v, at)) for (let k = 1; k < s.rings[0]!.length; k += 2) top = Math.min(top, s.rings[0]![k]!);
      return -top;
    };
    const built = height(null);
    const early = height(0.1);
    const late = height(0.9);
    expect(early).toBeLessThan(late);
    // Up close a crane stands over the site; without it the frame is lower than the dome.
    expect(early).not.toBe(built);
  });
});
