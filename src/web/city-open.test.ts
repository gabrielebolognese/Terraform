// @vitest-environment happy-dom

/**
 * Opening a metropolis (at the user's request: "when opening the metropolis,
 * the app crashes because you are trying to load the whole city in one go,
 * making the whole browser crash - fix this deeply").
 *
 * The example's metropolises are a million tiles. Their whole scene - an
 * occupant for every tile, each ordered against the ~2,000 sharing its screen
 * column - ran out of memory before the first frame (past 3.5 GB, measured
 * in Node). These open one as the city screen does: the browser's tuning, its
 * first camera, the chunked picture cache.
 */

import { describe, expect, it } from "vitest";

import { examplePlanet } from "../harness/example.js";
import { sceneStats } from "../render/city.js";
import type { CityView } from "../sim/index.js";
import { DEFAULT_TUNING, NEUTRAL_ENV, cityView, claimTest, derive, habitat, makeTuning, prepareCity, worldEnv, worldOf } from "../sim/index.js";
import { centreCamera, qualityFor } from "./city-camera.js";
import { ChunkedCity } from "./city-chunks.js";
import type { CityHooks } from "./city.js";
import { CityScreen } from "./city.js";

/** The browser's tuning, as `main.ts` has it. */
const game = makeTuning({
  EVENTS_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  TECH_GATE_ENABLED: 1,
  SETTLEMENTS_ENABLED: 1,
  TERRAIN_RELIEF_M: 12,
  NETWORK_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  ROCK_CLUSTER_CHANCE: 0.65,
  BUILD_TIME_ENABLED: 1,
  CITY_GRID_TILES: 96,
  OUTPOST_GRID_TILES: 48,
  METROPOLIS_GRID_TILES: 288,
});
const { state } = examplePlanet(DEFAULT_TUNING, game);
const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game), game, 0);
const largest = state.settlements.filter((s) => s.kind === "metropolis").sort((a, b) => b.buildings.length - a.buildings.length)[0]!;
const view: CityView = cityView(largest, env, game);

const W = 1600;
const H = 900;
function screen(): { city: ChunkedCity<{ w: number; h: number }>; frame: (cam: ReturnType<typeof centreCamera>, t: number) => number } {
  const city = new ChunkedCity<{ w: number; h: number }>({ make: (w, h) => ({ w, h }), paint: () => undefined, blit: () => undefined, fill: () => undefined, now: () => performance.now() });
  const frame = (cam: ReturnType<typeof centreCamera>, t: number): number => {
    const halfW = W / 2 / cam.zoom;
    const halfH = H / 2 / cam.zoom;
    const start = performance.now();
    city.draw(view, { time: t, selected: null, ghost: null, quality: qualityFor(cam, W, H, view.world.size) }, { minX: cam.cx - halfW, maxX: cam.cx + halfW, minY: cam.cy - halfH, maxY: cam.cy + halfH }, cam.zoom);
    return performance.now() - start;
  };
  return { city, frame };
}

describe("opening a metropolis", () => {
  it("is near a million tiles - vacuity: the size of city that crashed the browser", () => {
    // 992 tiles a side as a square; 928 as a town grows (its outline need not reach every edge of 31 chunks).
    expect(view.tiles).toBeGreaterThan(800);
    expect(view.buildings.length).toBeGreaterThan(18_000);
  });

  it("builds only the chunks in view, never the whole city, and draws its first frame in well under a second", () => {
    const before = sceneStats();
    const { frame } = screen();
    const cam = centreCamera(view.tiles, W);
    // Measured: 274 ms for the first frame (the whole city's order was never finished); 6-14 ms after.
    const first = frame(cam, 0);
    expect(first).toBeLessThan(2000);
    for (let k = 1; k < 10; k += 1) frame(cam, k / 60);
    const after = sceneStats();
    expect(after.whole - before.whole, "the whole city's scene").toBe(0);
    // Measured: 42 chunks on screen at the first camera.
    expect(after.chunks - before.chunks).toBeGreaterThan(0);
    expect(after.chunks - before.chunks).toBeLessThan(100);
  });

  it("keeps a bounded number of chunk scenes however far the camera goes", () => {
    const { frame } = screen();
    let cam = centreCamera(view.tiles, W);
    // Across the city and back, up close.
    for (let f = 0; f < 300; f += 1) {
      cam = { ...cam, cx: cam.cx + (f < 150 ? 160 : -160), cy: cam.cy + (f % 60 < 30 ? 40 : -40) };
      frame(cam, f / 60);
    }
    const s = sceneStats();
    expect(s.chunks, "vacuity: the pan built many chunks").toBeGreaterThan(200);
    // At most 120 kept up close (measured: a megabyte of shapes each; 900 held 1.4 GB).
    expect(s.kept).toBeLessThanOrEqual(120);
  });

  it("makes a metropolis's ground a frame's worth at a time, then its view at once from what was made", () => {
    // Another metropolis, never opened: its world, its view's lists, not yet made.
    const other = state.settlements.filter((c) => c.kind === "metropolis" && c.id !== largest.id)[0]!;
    const steps = prepareCity(other, game);
    let count = 0;
    let longest = 0;
    let last = 0;
    for (;;) {
      const start = performance.now();
      const r = steps.next();
      longest = Math.max(longest, performance.now() - start);
      if (r.done === true) break;
      expect(r.value).toBeGreaterThanOrEqual(last);
      last = r.value;
      count += 1;
    }
    expect(last).toBe(1);
    // Measured: 5,422 steps, the longest 175 ms (made at once: 4.8 s, and the view 0.9 s more).
    expect(count, "vacuity: many steps").toBeGreaterThan(500);
    expect(longest).toBeLessThan(400);
    const start = performance.now();
    const v = cityView(other, env, game);
    // Measured: 170 ms from what was made; 530-570 ms had the view to make its world's heights itself.
    expect(performance.now() - start).toBeLessThan(400);
    // And what was made is what the view would have made itself.
    const w = worldOf(other, game);
    expect(v.world.fine).toEqual(w.fineM.map((h) => h / game.TILE_METRES));
    const ours = claimTest(other, game);
    expect(v.claimed.every((c, i) => c === ours(i % v.tiles, Math.floor(i / v.tiles)))).toBe(true);
  });

  it("shows how far the ground is made while a metropolis first opens, then the city", () => {
    // The third metropolis: never opened.
    const third = state.settlements.filter((c) => c.kind === "metropolis" && c.id !== largest.id)[1]!;
    const host = document.createElement("div");
    document.body.append(host);
    const refuse = () => ({ state, ok: false, reason: "not in this test", laid: 0 });
    const hooks = new Proxy({}, { get: () => refuse }) as unknown as CityHooks;
    const screen = new CityScreen(host, hooks, game);
    screen.open(third.id);
    let now = 0;
    const frame = (): void => screen.frame(third, env, (now += 16));
    frame();
    expect(host.querySelector(".city-status")!.textContent).toMatch(/^Surveying the ground: \d+%$/);
    expect(host.querySelectorAll(".city-card[data-type]").length, "no city yet").toBe(0);
    let frames = 1;
    while (/Surveying/.test(host.querySelector(".city-status")!.textContent ?? "") && frames < 5000) {
      frame();
      frames += 1;
    }
    frame();
    // Many frames, each a frame's worth of work; then the city, and its palette.
    expect(frames).toBeGreaterThan(20);
    expect(host.querySelector(".city-status")!.textContent).not.toMatch(/Surveying/);
    expect(host.querySelectorAll(".city-card[data-type]").length).toBeGreaterThan(20);
  });
});
