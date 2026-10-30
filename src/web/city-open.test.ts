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
import { DEFAULT_TUNING, NEUTRAL_ENV, TILE_STRIDE, cityView, claimTest, derive, habitat, keyTile, makeTuning, prepareCity, worldEnv, worldOf } from "../sim/index.js";
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

  /*
   * Batch 40: load-proof. This timed the wall clock against 400 ms - the longest step 145-203 ms alone -
   * and failed in full runs at 400-513 ms. Each time is now a share of the whole making, timed in the
   * same run: load slows the whole as it slows the step, and a stall the scheduler puts on one step is
   * a few percent of it (195 ms of 5.2 s, the worst measured). Each bound leaves room for such a stall
   * and still fails what it guards against. The work was cut first, so the shares are small: the
   * longest step was 255 ms (four conversions and the first route in one step), then 185 ms (broken
   * rocks read on a deprecated map); the view built its buildings with four spreads each (65 ms of its
   * 95-140). The process's CPU time was tried and is worse: it counts the collector's threads beside
   * the step (a 51 ms step read 157 ms), and under load it grew as much as the wall clock.
   */
  it("makes a metropolis's ground a frame's worth at a time, then its view at once from what was made", () => {
    // Another metropolis, never opened: its world, its view's lists, not yet made.
    const other = state.settlements.filter((c) => c.kind === "metropolis" && c.id !== largest.id)[0]!;
    const steps = prepareCity(other, game);
    let count = 0;
    let longest = 0;
    let last = 0;
    const began = performance.now();
    for (;;) {
      const start = performance.now();
      const r = steps.next();
      longest = Math.max(longest, performance.now() - start);
      if (r.done === true) break;
      expect(r.value).toBeGreaterThanOrEqual(last);
      last = r.value;
      count += 1;
    }
    const whole = performance.now() - began;
    expect(last).toBe(1);
    // Measured: 5,111 steps in 3.5-4.9 s alone (made at once: 4.8 s, and the view 0.9 s more).
    expect(count, "vacuity: many steps").toBeGreaterThan(500);
    // Measured: the longest 51-114 ms alone, 1.3-2.3% of the whole; 134-195 ms, 1.6-3.8%, with twenty processes
    // keeping every core busy. The world's fine heights sampled in one step: 1,981 of 3,681 ms, 54%.
    expect(longest / whole, `the longest step, ${longest.toFixed(0)} of ${whole.toFixed(0)} ms`).toBeLessThan(0.1);
    const start = performance.now();
    const v = cityView(other, env, game);
    const firstView = performance.now() - start;
    // Measured: 104-129 ms from what was made, 2.0-2.9% of the whole, alone or busy (257 ms before Batch 40;
    // 530-570 ms, about 13%, had the view to make its world's heights itself).
    expect(firstView / whole, `the first view, ${firstView.toFixed(0)} of ${whole.toFixed(0)} ms`).toBeLessThan(0.08);
    // And again, as the city screen re-derives it five times a second: the quickest of three, against the whole
    // making as above. Measured: 19-29 ms, 0.47-0.69% (alone); 25-67 ms, 0.47-0.82% (every core busy). Before
    // Batch 40 it was 95-144 ms, 2.3-3.3% (and the city screen's own note said ~15 ms).
    let again = Infinity;
    for (let k = 0; k < 3; k += 1) {
      const at = performance.now();
      cityView(other, env, game);
      again = Math.min(again, performance.now() - at);
    }
    expect(again / whole, `the view again, ${again.toFixed(0)} of ${whole.toFixed(0)} ms`).toBeLessThan(0.015);
    // And what was made is what the view would have made itself.
    const w = worldOf(other, game);
    expect(v.world.fine).toEqual(w.fineM.map((h) => h / game.TILE_METRES));
    const ours = claimTest(other, game);
    expect(v.claimed.every((c, i) => c === ours(i % v.tiles, Math.floor(i / v.tiles)))).toBe(true);
  });

  it("reads a tile's key as fast as a fresh copy of the same sums, once the example is built (Batch 40)", () => {
    // Every `{ tx, ty }` object literal shared one hidden class; once the example was built, each tile
    // `keyTile` made was born on a deprecated map and migrated where it was read. Measured over the
    // metropolises' broken rocks: 1,159 ms against 81 ms for a copy as a literal (14x); 4.5 ms against 44
    // since the tile is an object of its own class (a literal made here is slowed too, less). Both timed back
    // to back, the best of five, so load slows them alike.
    const keys = state.settlements.filter((c) => c.kind === "metropolis").flatMap((c) => c.cleared);
    expect(keys.length, "vacuity: a metropolis's broken rocks").toBeGreaterThan(100_000);
    const copy = (key: number): { tx: number; ty: number } => ({ tx: key % TILE_STRIDE, ty: Math.floor(key / TILE_STRIDE) });
    const best = (read: (key: number) => { tx: number; ty: number }): number => {
      let quickest = Infinity;
      for (let r = 0; r < 5; r += 1) {
        const at = performance.now();
        let sum = 0;
        for (const key of keys) {
          const { tx, ty } = read(key);
          sum += tx + ty;
        }
        quickest = Math.min(quickest, performance.now() - at);
        expect(sum).toBeGreaterThan(0);
      }
      return quickest;
    };
    const ours = best(keyTile);
    const fresh = best(copy);
    expect(ours / fresh, `keyTile ${ours.toFixed(1)} ms, a copy ${fresh.toFixed(1)} ms`).toBeLessThan(4);
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
