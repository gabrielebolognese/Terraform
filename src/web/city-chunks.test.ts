/**
 * The city drawn in chunks: pictures kept, redrawn only when their chunk
 * changes, the frame the same shapes as ever - and a metropolis cheap to
 * draw again.
 */

import { describe, expect, it } from "vitest";

import { examplePlanet } from "../harness/example.js";
import type { CitySceneOptions } from "../render/city.js";
import { cityScene, sceneBounds } from "../render/city.js";
import type { Shape } from "../render/raster.js";
import type { CityView } from "../sim/index.js";
import { DEFAULT_TUNING, NEUTRAL_ENV, cityView, derive, habitat, makeTuning, worldEnv } from "../sim/index.js";
import { ChunkedCity, pictureScale } from "./city-chunks.js";

const game = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12, HEADQUARTERS_ENABLED: 1, NETWORK_ENABLED: 1 });
const { state } = examplePlanet(DEFAULT_TUNING, game);
const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game), game, 0);
const largest = state.settlements.filter((s) => s.kind === "metropolis").sort((a, b) => b.buildings.length - a.buildings.length)[0]!;
const metropolis = cityView(largest, env, game);

/** A stand-in for the canvases: it keeps what was painted, and counts what each frame draws. */
function fake() {
  let clock = 0;
  const painted: Shape[] = [];
  const frame = { blits: 0, filled: 0 };
  const backend = {
    make: (w: number, h: number) => ({ w, h, shapes: [] as Shape[] }),
    paint: (p: { shapes: Shape[] }, shapes: readonly Shape[]) => {
      p.shapes.push(...shapes);
      painted.push(...shapes);
      clock += 0.02 * shapes.length;
    },
    blit: () => {
      frame.blits += 1;
    },
    fill: (shapes: readonly Shape[]) => {
      frame.filled += shapes.length;
    },
    now: () => clock,
  };
  return { backend, painted, frame, reset: () => Object.assign(frame, { blits: 0, filled: 0 }) };
}

const whole = (v: CityView) => {
  const b = sceneBounds(v.tiles, 30, v.world.margin);
  return { minX: b.minX - 500, maxX: b.maxX + 500, minY: b.minY - 2000, maxY: b.maxY + 500 };
};

describe("the city in chunks", () => {
  const o: CitySceneOptions = { time: 1, selected: null, ghost: null, quality: "low" };

  it("draws a whole metropolis from kept pictures: every shape painted once, and the next frame paints nothing", () => {
    const f = fake();
    const city = new ChunkedCity(f.backend, 8);
    // The first frames fill it in, a budget at a time, nearest the middle first.
    city.draw(metropolis, o, whole(metropolis), 0.25);
    expect(city.settled, "a whole metropolis is more than one frame's budget").toBe(false);
    let frames = 1;
    while (!city.settled && frames < 500) {
      f.reset();
      city.draw(metropolis, o, whole(metropolis), 0.25);
      frames += 1;
    }
    expect(city.settled).toBe(true);
    const first = city.renders;
    // Measured: 81 pictures - far away a chunk is 32 tiles a side (at 8, a million-tile metropolis was 18,000 of them).
    expect(first).toBeGreaterThan(50);
    // What the pictures hold, with what was filled over them, is the scene.
    expect(f.painted.length + f.frame.filled).toBe(cityScene(metropolis, o).length);
    f.reset();
    city.draw(metropolis, o, whole(metropolis), 0.25);
    expect(city.renders).toBe(first);
    // Measured: this metropolis whole at low detail is 97,036 shapes a frame to fill (the browser's, 352 tiles a side, 394,697);
    // from kept pictures, one picture per chunk and the overlays.
    console.log(`frame: ${f.frame.blits} pictures, ${f.frame.filled} shapes filled, against ${cityScene(metropolis, o).length} shapes a frame before`);
    expect(f.frame.filled).toBeLessThan(cityScene(metropolis, o).length / 50);
  });

  it("redraws only the chunk whose building changed", () => {
    const f = fake();
    const city = new ChunkedCity(f.backend, 8, 48_000_000, 1e9);
    const mid: CitySceneOptions = { ...o, quality: "medium" };
    city.draw(metropolis, mid, whole(metropolis), 0.4);
    const before = city.renders;
    const dome = metropolis.buildings.find((b) => b.type === "habitat_dome")!;
    const changed: CityView = { ...metropolis, buildings: metropolis.buildings.map((b) => (b === dome ? { ...b, activity: b.activity > 0.5 ? 0.1 : 0.9 } : b)) };
    city.draw(changed, mid, whole(metropolis), 0.4);
    expect(city.renders - before).toBe(1);
  });

  it("keeps its pictures within half an octave of zoom, and redraws beyond it a budget at a time, the old ones standing in", () => {
    const f = fake();
    const city = new ChunkedCity(f.backend, 8, 48_000_000, 1e9);
    city.draw(metropolis, o, whole(metropolis), 0.25);
    const all = city.renders;
    expect(pictureScale(0.25)).toBe(0.25);
    expect(pictureScale(0.3)).toBeCloseTo(Math.SQRT1_2 / 2, 10);
    city.draw(metropolis, o, whole(metropolis), 0.25 * 0.95);
    expect(city.renders, "a little out: the same pictures").toBe(all);
    f.reset();
    city.draw(metropolis, o, whole(metropolis), 0.3);
    const redrawn = city.renders - all;
    expect(redrawn, "a new half-octave: some redrawn this frame").toBeGreaterThan(0);
    expect(redrawn, "not all in one frame").toBeLessThan(all);
    expect(f.frame.blits, "every chunk still drawn, old or new").toBe(all);
  });

  it("forgets the pictures longest unseen when over its budget of pixels", () => {
    const f = fake();
    const city = new ChunkedCity(f.backend, 8, 50_000, 1e9);
    city.draw(metropolis, o, whole(metropolis), 0.25);
    const everything = city.size;
    // Now only a corner, many times.
    const corner = { minX: -200, maxX: 200, minY: 0, maxY: 400 };
    city.draw(metropolis, o, corner, 0.25);
    expect(city.size).toBeLessThan(everything);
  });
});
