/**
 * Three levels of detail (requested by the user: "in a metropolis if I zoom
 * out a lot it lags"). Measured on the example's largest metropolis, the
 * whole grid (9,216 tiles, 758 buildings, and its streets since roads came):
 * 266,310 shapes at high, 46,506 at medium, 16,717 at low.
 *
 * A far view is only worth drawing if it still looks like the city. The first
 * version did not: it merged sloping ground into flat patches and coloured
 * each building by its main material, and the far metropolis differed from
 * the near one by more (0.0386) than bare ground did (0.0335).
 */

import { describe, expect, it } from "vitest";

import { referenceCity, renderCity } from "../harness/city-frames.js";
import { examplePlanet } from "../harness/example.js";
import type { CityView } from "../sim/index.js";
import { BUILDING_DEFS, BUILDING_TYPES, DEFAULT_TUNING, NEUTRAL_ENV, cityView, derive, habitat, makeTuning, worldEnv } from "../sim/index.js";
import type { CityQuality, CitySceneOptions } from "./city.js";
import { cityScene, resetSceneCache } from "./city.js";
import type { Frame } from "./planet.js";
import { frameDifference } from "./planet.js";

const game = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const { state } = examplePlanet(DEFAULT_TUNING, game);
const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game), game, 0);
const largest = state.settlements.filter((s) => s.kind === "metropolis").sort((a, b) => b.buildings.length - a.buildings.length)[0]!;
const metropolis = cityView(largest, env, game);

const at = (quality: CityQuality, time = 1): CitySceneOptions => ({ time, selected: null, ghost: null, quality });

/**
 * Where two scenes first differ, or -1. A metropolis scene is ~230,000
 * shapes: `toEqual` on two that differ runs the diff printer out of memory
 * ("Invalid array length") instead of failing with a message.
 */
function firstDifference(a: readonly unknown[], b: readonly unknown[]): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i;
  return -1;
}

/** The frame as it reads from a distance: each 8 x 8 block of pixels averaged. */
function fromAfar(f: Frame, k = 8): Frame {
  const w = f.width / k;
  const h = f.height / k;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        let sum = 0;
        for (let j = 0; j < k; j += 1) for (let i = 0; i < k; i += 1) sum += f.pixels[((y * k + j) * f.width + x * k + i) * 4 + c] ?? 0;
        pixels[(y * w + x) * 4 + c] = sum / (k * k);
      }
      pixels[(y * w + x) * 4 + 3] = 255;
    }
  }
  return { width: w, height: h, pixels };
}

describe("levels of detail", () => {
  it("cut a whole metropolis's shapes to a fifth, then to a tenth", () => {
    // Measured: medium 17.5% of high, low 6.3%. (Roads first took medium to
    // 23%: kerbs and connection points on every street. Now high only.)
    const high = cityScene(metropolis, at("high")).length;
    expect(cityScene(metropolis, at("medium")).length).toBeLessThan(0.2 * high);
    expect(cityScene(metropolis, at("low")).length).toBeLessThan(0.1 * high);
  });

  it("still look like the city from as far as they are drawn", () => {
    // 960 x 600 is the whole metropolis about as large as it is on screen at
    // the widest zoom. Measured, over 8 x 8 blocks: bare ground 0.0238 from
    // the full city, medium 0.0060 (25% of that), low 0.0095 (40%). Streets
    // drawn in their bare surface colour took low to 45%; they now take the
    // colour a street reads as up close, kerbs, dashes and rovers included.
    const W = 960;
    const H = 600;
    const high = fromAfar(renderCity(metropolis, at("high"), W, H, false));
    const bare = frameDifference(fromAfar(renderCity({ ...metropolis, buildings: [] }, at("high"), W, H, false)), high);
    expect(bare, "the buildings must make a visible difference, or this test measures nothing").toBeGreaterThan(0.02);
    expect(frameDifference(fromAfar(renderCity(metropolis, at("medium"), W, H, false)), high)).toBeLessThan(0.4 * bare);
    expect(frameDifference(fromAfar(renderCity(metropolis, at("low"), W, H, false)), high)).toBeLessThan(0.45 * bare);
  });

  it("draw each type of building far away in the colour and size it has up close", () => {
    // One building at a time on flat ground whose tiles never merge (heights
    // alternate by a micron), so what changes on screen is the building
    // alone. Measured: at low every type's mean colour is within 1% of its
    // full-detail drawing, and it covers 80-116% of the same pixels. A type
    // left undrawn shows a hole in the ground instead. (The version of this
    // test that removed buildings one by one from the reference city passed
    // with spaceports undrawn: the reference city has none, and uncovering
    // the ground changes the scene whether the building was drawn or not.)
    const { view: reference } = referenceCity();
    const flat: CityView = { ...reference, id: "one building", groundZ: reference.groundZ.map((_, i) => (i % 2) * 1e-6), steep: reference.steep.map(() => false) };
    const W = 400;
    const H = 260;
    const seen = (quality: CityQuality, type: (typeof BUILDING_TYPES)[number]): { colour: number[]; pixels: number } => {
      const bare = renderCity({ ...flat, buildings: [] }, at(quality), W, H, false);
      const b = { index: 0, type, tx: 10, ty: 10, size: BUILDING_DEFS[type].footprint, operable: true, activity: 1, baseZ: 0, submerged: false, network: null };
      const f = renderCity({ ...flat, buildings: [b] }, at(quality), W, H, false);
      const sum = [0, 0, 0];
      let pixels = 0;
      for (let i = 0; i < f.pixels.length; i += 4) {
        if (f.pixels[i] === bare.pixels[i] && f.pixels[i + 1] === bare.pixels[i + 1] && f.pixels[i + 2] === bare.pixels[i + 2]) continue;
        for (let c = 0; c < 3; c += 1) sum[c]! += f.pixels[i + c]! / 255;
        pixels += 1;
      }
      return { colour: sum.map((v) => v / Math.max(1, pixels)), pixels };
    };
    for (const type of BUILDING_TYPES) {
      const near = seen("high", type);
      for (const quality of ["medium", "low"] as const) {
        const far = seen(quality, type);
        // Measured: low's colour within 1% of full detail per channel, medium's
        // within 15% (the reactor); area 80-127% at low, 70-100% at medium.
        const tolerance = quality === "low" ? 0.03 : 0.2;
        far.colour.forEach((c, i) => expect(Math.abs(c / near.colour[i]! - 1), `${type} at ${quality}: channel ${i} of its colour`).toBeLessThan(tolerance));
        const area = far.pixels / near.pixels;
        expect(area, `${type} at ${quality}: its size on screen`).toBeGreaterThan(0.6);
        expect(area, `${type} at ${quality}: its size on screen`).toBeLessThan(1.4);
      }
    }
  });

  it("draw the ground far away as it is up close: terraces, hills and all", () => {
    // Merging sloping ground into flat patches erased the terraces: bare
    // ground at low differed from high by 0.0206. Merging only flat patches:
    // 0.0012 (measured, 480 x 300).
    // The terrain alone: no buildings, and no roads (they have tests of their own).
    const bare: CityView = { ...metropolis, buildings: [], roads: metropolis.roads.map(() => false) };
    const high = renderCity(bare, at("high"), 480, 300, false);
    expect(frameDifference(renderCity(bare, at("low"), 480, 300, false), high)).toBeLessThan(0.004);
    // And the patches are really used, where they can be: on flat open
    // ground (the metropolis's hills merge little, and there the rocks low
    // leaves out swamp the count). Measured: 192 shapes at low, 1,088 at medium.
    const { view } = referenceCity();
    const open: CityView = { ...view, id: "open", buildings: [], groundZ: view.groundZ.map(() => 0), steep: view.steep.map(() => false) };
    expect(cityScene(open, at("low")).length).toBeLessThan(0.25 * cityScene(open, at("medium")).length);
  });

  it("animate only up close: steam and moving parts cost nothing far away", () => {
    for (const quality of ["medium", "low"] as const) expect(firstDifference(cityScene(metropolis, at(quality, 1)), cityScene(metropolis, at(quality, 2.3))), `${quality}: first shape that moved`).toBe(-1);
    // And there is something to leave out: the full city does move.
    expect(firstDifference(cityScene(metropolis, at("high", 1)), cityScene(metropolis, at("high", 2.3)))).not.toBe(-1);
  });

  it("keep a cache each, so zooming back and forth draws what a fresh start would", () => {
    const { view } = referenceCity();
    const fresh = new Map<CityQuality, ReturnType<typeof cityScene>>();
    for (const quality of ["high", "medium", "low"] as const) {
      resetSceneCache();
      fresh.set(quality, cityScene(view, at(quality)));
    }
    resetSceneCache();
    for (const quality of ["high", "low", "medium", "high", "medium", "low", "high"] as const) expect(cityScene(view, at(quality)), quality).toEqual(fresh.get(quality));
    expect(fresh.get("high")).not.toEqual(fresh.get("medium"));
    expect(fresh.get("medium")).not.toEqual(fresh.get("low"));
  });
});

describe("loose rocks", () => {
  // Flat, open ground: no hills, so any rock is a loose one.
  const { view } = referenceCity();
  const open: CityView = { ...view, id: "open", buildings: [], groundZ: view.groundZ.map(() => 0), steep: view.steep.map(() => false) };

  it("lie on open ground up close, on a scattering of tiles, not everywhere", () => {
    const W = 640;
    const H = 400;
    resetSceneCache();
    const near = renderCity(open, at("high"), W, H, false);
    const plain = renderCity(open, at("medium"), W, H, false);
    let changed = 0;
    for (let i = 0; i < near.pixels.length; i += 4) if (near.pixels[i] !== plain.pixels[i] || near.pixels[i + 1] !== plain.pixels[i + 1]) changed += 1;
    // Measured: 0.27% of the frame (the grid fills about half of it) - rocks
    // are there, and they are pebbles on a few tiles, not a rubble field.
    const share = changed / (W * H);
    expect(share).toBeGreaterThan(0.0015);
    expect(share).toBeLessThan(0.006);
  });

  it("are the same rocks on every visit, and at every moment", () => {
    resetSceneCache();
    const first = cityScene(open, at("high", 1));
    resetSceneCache();
    expect(cityScene(open, at("high", 7.5))).toEqual(first);
  });
});
