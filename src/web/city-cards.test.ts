/**
 * The build bar's card pictures. A page with no 2D canvas (happy-dom) cannot
 * show them, so the scenes are checked here, through the software
 * rasteriser the golden frames use.
 */

import { describe, expect, it } from "vitest";

import { cityScene } from "../render/city.js";
import { rasterize } from "../render/raster.js";
import { BUILDING_TYPES } from "../sim/index.js";
import type { CardKind } from "./city-cards.js";
import { PREVIEW_H, PREVIEW_W, previewFit, previewScene, previewView } from "./city-cards.js";

const KINDS: readonly CardKind[] = [...BUILDING_TYPES, "road", "connect"];
const BACK = { r: 0.11, g: 0.11, b: 0.13, a: 1 };

function picture(kind: CardKind): Uint8ClampedArray {
  const shapes = previewScene(kind);
  const fit = previewFit(shapes, PREVIEW_W, PREVIEW_H);
  expect(fit, kind).not.toBeNull();
  return rasterize(shapes, PREVIEW_W, PREVIEW_H, fit!, BACK).pixels;
}

describe("the card pictures", () => {
  it("fill most of the card: something is drawn, fitted, for every card", () => {
    for (const kind of KINDS) {
      const px = picture(kind);
      let drawn = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] !== Math.round(BACK.r * 255) || px[i + 1] !== Math.round(BACK.g * 255)) drawn += 1;
      // Measured: 26% (the atmosphere processor, fitted round its stack and
      // steam) to 46% (the regolith mine) of the card is picture.
      expect(drawn / (PREVIEW_W * PREVIEW_H), kind).toBeGreaterThan(0.2);
    }
  });

  it("show a road on the Road card, not the bare ground it would be without one", () => {
    const bare = cityScene(previewView("road", 4, [], []), { time: 2.4, selected: null, ghost: null, quality: "high" });
    const fit = previewFit(bare, PREVIEW_W, PREVIEW_H)!;
    // The same framing for both, so only the road can differ.
    const road = rasterize(previewScene("road"), PREVIEW_W, PREVIEW_H, fit, BACK).pixels;
    const ground = rasterize(bare, PREVIEW_W, PREVIEW_H, fit, BACK).pixels;
    let differ = 0;
    for (let i = 0; i < road.length; i += 4) if (road[i] !== ground[i]) differ += 1;
    // Measured: 10.8% of the card is road (with its rover) that bare ground is not.
    expect(differ / (PREVIEW_W * PREVIEW_H)).toBeGreaterThan(0.05);
  });

  it("are all different: no card shows another's structure", () => {
    const seen = KINDS.map((k) => picture(k).join(","));
    expect(new Set(seen).size).toBe(KINDS.length);
  });
});
