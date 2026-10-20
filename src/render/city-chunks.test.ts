/**
 * The scene in chunks (at the user's request: "in a huge metropolis there
 * are still heavy performance issues - without lowering the quality"): the
 * still part of each square of tiles is drawn once into a picture and kept,
 * and only what moves is drawn each frame. For that to lose nothing, the
 * chunks' still parts, their moving parts and the overlays must be the whole
 * scene - every shape, once.
 */

import { describe, expect, it } from "vitest";

import { referenceCity } from "../harness/city-frames.js";
import { examplePlanet } from "../harness/example.js";
import type { CityView } from "../sim/index.js";
import { DEFAULT_TUNING, NEUTRAL_ENV, cityView, derive, habitat, makeTuning, worldEnv } from "../sim/index.js";
import type { CityQuality, CitySceneOptions } from "./city.js";
import { cityChunkRange, cityChunkSignature, cityScene } from "./city.js";

const game = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12, HEADQUARTERS_ENABLED: 1, NETWORK_ENABLED: 1 });
const { state } = examplePlanet(DEFAULT_TUNING, game);
const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game), game, 0);
const largest = state.settlements.filter((s) => s.kind === "metropolis").sort((a, b) => b.buildings.length - a.buildings.length)[0]!;
const metropolis = cityView(largest, env, game);

function pieces(view: CityView, o: CitySceneOptions, size: number) {
  const r = cityChunkRange(view, size);
  const stat: unknown[] = [];
  const live: unknown[] = [];
  for (let cy = r.cy0; cy <= r.cy1; cy += 1) {
    for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
      const chunk = { x0: cx * size, y0: cy * size, size };
      stat.push(...cityScene(view, { ...o, chunk, layer: "static" }));
      live.push(...cityScene(view, { ...o, chunk, layer: "live" }));
    }
  }
  const overlay = cityScene(view, { ...o, layer: "overlay" });
  return { stat, live, overlay };
}

/** A shape as its fill and first point, to compare lists without order. */
const tag = (s: { fill: { r: number; g: number; b: number; a: number }; rings: readonly (readonly number[])[] }): string =>
  `${s.fill.r.toFixed(4)},${s.fill.g.toFixed(4)},${s.fill.b.toFixed(4)},${s.fill.a.toFixed(4)}|${s.rings.map((r) => r.slice(0, 4).map((v) => v.toFixed(3)).join(",")).join(";")}|${s.rings[0]!.length}`;

describe("the scene in chunks", () => {
  /** The metropolis with nothing moving through it: no trains, no rovers out. */
  const still: CityView = { ...metropolis, id: "still", rails: (metropolis.rails ?? []).map(() => false), jobs: metropolis.jobs.filter((j) => j.kind === "rocket") };

  for (const quality of ["high", "medium", "low"] as CityQuality[]) {
    it(`is the whole scene, every shape once, at ${quality} detail - the example's largest metropolis, nothing moving through it`, () => {
      const o: CitySceneOptions = { time: 2.2, selected: null, ghost: null, quality, sinceYears: 0.1 };
      const whole = cityScene(still, o);
      const { stat, live, overlay } = pieces(still, o, 8);
      const all = [...stat, ...live, ...overlay] as Parameters<typeof tag>[0][];
      expect(all.length).toBe(whole.length);
      const count = new Map<string, number>();
      for (const s of whole) count.set(tag(s), (count.get(tag(s)) ?? 0) + 1);
      for (const s of all) count.set(tag(s), (count.get(tag(s)) ?? 0) - 1);
      expect([...count.values()].filter((v) => v !== 0)).toEqual([]);
      if (quality === "high") expect(live.length, "vacuity: something moves (medium and low draw nothing moving)").toBeGreaterThan(0);
      expect(stat.length, "and most of it stands still").toBeGreaterThan(20 * live.length);
    });

    it(`is the whole scene and nothing else, at ${quality} detail - with its trains and rovers, what covers them drawn again over them`, () => {
      // Batch 29: what moves is drawn over a chunk's still picture, so whatever stands in front of a vehicle is drawn
      // again over it. Every shape of the whole scene is in the pieces; the only ones more are those drawn again.
      const o: CitySceneOptions = { time: 2.2, selected: null, ghost: null, quality, sinceYears: 0.1 };
      const whole = cityScene(metropolis, o);
      const { stat, live, overlay } = pieces(metropolis, o, 8);
      const all = [...stat, ...live, ...overlay] as Parameters<typeof tag>[0][];
      const count = new Map<string, number>();
      for (const s of whole) count.set(tag(s), (count.get(tag(s)) ?? 0) + 1);
      for (const s of all) count.set(tag(s), (count.get(tag(s)) ?? 0) - 1);
      const missing = [...count.entries()].filter(([, v]) => v > 0);
      expect(missing).toEqual([]);
      const known = new Set(whole.map(tag));
      expect(all.filter((s) => !known.has(tag(s))).map(tag)).toEqual([]);
      const again = all.length - whole.length;
      if (quality !== "low") expect(again, "vacuity: something was drawn again over a vehicle").toBeGreaterThan(0);
      else expect(again, "furthest out nothing moves").toBe(0);
      // Only what overlaps a vehicle is drawn again. Measured: 902 shapes at high detail (of 1,269,060) and 233 at
      // medium (of 127,265); drawing again everything after a vehicle in its chunk, overlapping it or not, 1,885 and
      // 448 - which a bound of 1% of the whole scene let through.
      const measured = { high: 902, medium: 233, low: 0 }[quality];
      expect(again, "drawn again over the vehicles").toBeLessThanOrEqual(Math.ceil(1.25 * measured));
    });
  }

  it("changes a chunk's signature when a building in it changes, and no other chunk's", () => {
    const o: CitySceneOptions = { time: 1, selected: null, ghost: null, quality: "medium" };
    const b = metropolis.buildings.find((x) => x.type === "habitat_dome")!;
    const size = 8;
    const at = { cx: Math.floor((b.tx + b.size - 1) / size), cy: Math.floor((b.ty + (b.depth ?? b.size) - 1) / size) };
    const fuller: CityView = { ...metropolis, buildings: metropolis.buildings.map((x) => (x === b ? { ...x, activity: x.activity > 0.5 ? 0.1 : 0.9 } : x)) };
    const r = cityChunkRange(metropolis, size);
    let changed = 0;
    for (let cy = r.cy0; cy <= r.cy1; cy += 1) {
      for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
        if (cityChunkSignature(metropolis, o, size, cx, cy) === cityChunkSignature(fuller, o, size, cx, cy)) continue;
        changed += 1;
        expect([cx, cy]).toEqual([at.cx, at.cy]);
      }
    }
    expect(changed).toBe(1);
  });

  it("draws the reference city the same in chunks as whole", () => {
    const { view } = referenceCity();
    const o: CitySceneOptions = { time: 1.3, selected: null, ghost: null, quality: "high" };
    const whole = cityScene(view, o);
    const { stat, live, overlay } = pieces(view, o, 8);
    expect(stat.length + live.length + overlay.length).toBe(whole.length);
  });
});
