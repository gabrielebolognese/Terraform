/**
 * The §0.3 response requirement, measured.
 *
 * §0.3 names the failure this whole batch exists to prevent: terraforming that
 * reads as "colored keys" gating progress while the planet barely changes on
 * screen. A renderer can satisfy "it draws a planet" and still fail that
 * completely - so what is asserted here is not that the picture looks right
 * (no test can), but that the picture MOVES when the channels do, everywhere
 * in their range, without cliffs.
 *
 * Deliberately independent of the simulation: the base channels below are
 * written here rather than taken from a reference run, so a balance change
 * cannot silently alter what the renderer is held to. `golden-frames.test.ts`
 * is where the two meet.
 */

import { describe, expect, it } from "vitest";

import type { VisualChannels } from "../sim/index.js";
import { createScene, frameDifference, renderPlanet, renderScene } from "./planet.js";

/** Small: a per-pixel sweep over six channels at eleven values each adds up. */
const SIZE = 96;
const SCENE = createScene({ width: SIZE, height: SIZE, spin: 0 });

/**
 * A mid-run planet, with every channel held off its own ceiling.
 *
 * This matters more than it looks. An earlier version of this test measured
 * against a frame from the reference run, where `capRadius` was already 0 and
 * `surfaceGreen` was already saturated - so two channels measured as inert
 * when the fixture, not the renderer, was what had nothing left to give.
 */
const BASE: VisualChannels = {
  capRadius: 0.3,
  oceanCoverage: 0.35,
  surfaceGreen: 0.2,
  atmosphereThickness: 0.5,
  skyColour: { r: 0.45, g: 0.55, b: 0.72 },
  cloudCover: 0.3,
  surfaceTint: { r: 1.0, g: 0.94, b: 0.88 },
  dustIntensity: 0.3,
  clearFraction: 0.6,
};

type ScalarChannel =
  | "capRadius"
  | "oceanCoverage"
  | "surfaceGreen"
  | "atmosphereThickness"
  | "cloudCover"
  | "dustIntensity";

const SCALAR_CHANNELS: readonly ScalarChannel[] = [
  "capRadius",
  "oceanCoverage",
  "surfaceGreen",
  "atmosphereThickness",
  "cloudCover",
  "dustIntensity",
];

/**
 * The smallest image change that counts as "something happened", as a mean
 * absolute per-pixel fraction.
 *
 * Set at 0.0005 for margin, not at the tightest passing value. The tightest is
 * `capRadius`'s first step at 0.0009, and that one is pinned by geometry rather
 * than by anything the renderer chooses: caps of angular radius r cover
 * `1 - cos(r * pi/2)` of the sphere, so the channel's first tenth is genuinely
 * only 1.2% of the surface and its response near zero is quadratic. Floored at
 * 0.0008 this test failed when an unrelated change to the VEGETATION mapping
 * moved cap's first step to 0.00080 - a threshold that tight reports the wrong
 * channel.
 *
 * It still catches what it is for by a wide margin: both dead zones this test
 * was written against measured 0.00000 and 0.00001, fifty times under this.
 */
const RESPONSE_FLOOR = 0.0005;

/** No single tenth of a channel may carry this much of its whole range. */
const MAX_STEP_SHARE = 0.4;

function at(channel: ScalarChannel, value: number) {
  return renderScene(SCENE, { ...BASE, [channel]: value });
}

describe("renderPlanet", () => {
  it("is a pure function of its inputs", () => {
    const a = renderPlanet(BASE, { width: 40, height: 40, spin: 0.25 });
    const b = renderPlanet(BASE, { width: 40, height: 40, spin: 0.25 });
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });

  it("fills the requested frame, fully opaque", () => {
    const frame = renderPlanet(BASE, { width: 37, height: 21 });
    expect(frame.width).toBe(37);
    expect(frame.height).toBe(21);
    expect(frame.pixels.length).toBe(37 * 21 * 4);
    for (let i = 3; i < frame.pixels.length; i += 4) expect(frame.pixels[i]).toBe(255);
  });

  it("gives the same pixels whether or not the scene is reused", () => {
    const options = { width: 48, height: 48, spin: 0.1 };
    const direct = renderPlanet(BASE, options);
    const viaScene = renderScene(createScene(options), BASE);
    expect(Array.from(viaScene.pixels)).toEqual(Array.from(direct.pixels));
  });

  it("survives channels outside 0..1 without producing garbage", () => {
    const wild: VisualChannels = {
      ...BASE,
      capRadius: -0.5,
      oceanCoverage: 2,
      surfaceGreen: Number.NaN,
      cloudCover: -3,
      dustIntensity: 1.9,
      atmosphereThickness: 4,
    };
    const frame = renderPlanet(wild, { width: 32, height: 32 });
    for (const value of frame.pixels) expect(Number.isFinite(value)).toBe(true);
  });
});

/**
 * §0.3, in three parts. Each part failed against a real version of this
 * renderer, which is the only reason to keep all three.
 */
describe("channel response (§0.3)", () => {
  it.each(SCALAR_CHANNELS)("%s moves the image at every step of its range", (channel) => {
    const dead: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const delta = frameDifference(at(channel, i / 10), at(channel, (i + 1) / 10));
      if (delta < RESPONSE_FLOOR) {
        dead.push(`${(i / 10).toFixed(1)}->${((i + 1) / 10).toFixed(1)}: ${delta.toFixed(5)}`);
      }
    }
    expect(dead, `${channel} has dead steps: ${dead.join(", ")}`).toEqual([]);
  });

  it.each(SCALAR_CHANNELS)("%s moves the image monotonically away from zero", (channel) => {
    const zero = at(channel, 0);
    let previous = -1;
    for (let i = 0; i <= 10; i += 1) {
      const distance = frameDifference(zero, at(channel, i / 10));
      expect(distance, `${channel} at ${(i / 10).toFixed(1)} moved back toward its zero`).toBeGreaterThanOrEqual(
        previous,
      );
      previous = distance;
    }
  });

  it.each(SCALAR_CHANNELS)("%s has no cliff - no tenth carries the range", (channel) => {
    const span = frameDifference(at(channel, 0), at(channel, 1));
    let worst = 0;
    for (let i = 0; i < 10; i += 1) {
      worst = Math.max(worst, frameDifference(at(channel, i / 10), at(channel, (i + 1) / 10)));
    }
    const share = worst / span;
    expect(share, `${channel}'s biggest tenth is ${(share * 100).toFixed(0)}% of its range`).toBeLessThan(
      MAX_STEP_SHARE,
    );
  });

  it("responds to sky colour, roughly in proportion", () => {
    const base = renderScene(SCENE, BASE);
    const shift = (d: number) =>
      frameDifference(base, renderScene(SCENE, { ...BASE, skyColour: { ...BASE.skyColour, r: BASE.skyColour.r + d } }));
    const small = shift(0.05);
    const large = shift(0.2);
    expect(small).toBeGreaterThan(RESPONSE_FLOOR);
    // Four times the change should give close to four times the response.
    expect(large / small).toBeGreaterThan(3);
    expect(large / small).toBeLessThan(5);
  });

  it("responds to the surface tint", () => {
    const base = renderScene(SCENE, BASE);
    const shifted = renderScene(SCENE, { ...BASE, surfaceTint: { ...BASE.surfaceTint, r: BASE.surfaceTint.r - 0.2 } });
    expect(frameDifference(base, shifted)).toBeGreaterThan(RESPONSE_FLOOR);
  });
});

describe("geometry", () => {
  it("shows the pole, so a small cap is not a sliver on the limb", () => {
    // The whole point of the axial tilt. Pole-on-edge this difference is ~0.
    const bare = renderScene(SCENE, { ...BASE, capRadius: 0 });
    const tiny = renderScene(SCENE, { ...BASE, capRadius: 0.12 });
    expect(frameDifference(bare, tiny)).toBeGreaterThan(RESPONSE_FLOOR);
  });

  it("spins to a different view of the same planet", () => {
    const options = { width: SIZE, height: SIZE };
    const front = renderPlanet(BASE, { ...options, spin: 0 });
    const side = renderPlanet(BASE, { ...options, spin: 0.25 });
    // Different terrain...
    expect(frameDifference(front, side)).toBeGreaterThan(RESPONSE_FLOOR);
    // ...but the same world: overall brightness should barely shift.
    const mean = (pixels: Uint8ClampedArray) => {
      let total = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        total += (pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0);
      }
      return total / ((pixels.length / 4) * 3);
    };
    expect(Math.abs(mean(front.pixels) - mean(side.pixels))).toBeLessThan(6);
  });

  it("puts space, not planet, in the corners", () => {
    const frame = renderPlanet(BASE, { width: 64, height: 64 });
    expect(Math.max(frame.pixels[0] ?? 0, frame.pixels[1] ?? 0, frame.pixels[2] ?? 0)).toBeLessThan(20);
  });
});

describe("frameDifference", () => {
  it("is zero for a frame against itself", () => {
    expect(frameDifference(renderScene(SCENE, BASE), renderScene(SCENE, BASE))).toBe(0);
  });

  it("is one for black against white", () => {
    const black = { width: 2, height: 2, pixels: new Uint8ClampedArray(16) };
    const white = { width: 2, height: 2, pixels: new Uint8ClampedArray(16).fill(255) };
    expect(frameDifference(black, white)).toBe(1);
  });

  it("refuses to compare frames of different sizes", () => {
    const a = renderPlanet(BASE, { width: 8, height: 8 });
    const b = renderPlanet(BASE, { width: 9, height: 8 });
    expect(() => frameDifference(a, b)).toThrow(RangeError);
  });
});
