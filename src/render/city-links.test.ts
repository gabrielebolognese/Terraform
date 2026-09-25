/**
 * Corridors, cables, rocks, rovers and rockets in the picture (at the user's
 * request). Each is drawn from what the view says - the same view the
 * simulation's rules produced - so what the player sees is what they can
 * act on.
 */

import { describe, expect, it } from "vitest";

import { flatten, referenceCity, renderCity } from "../harness/city-frames.js";
import type { CityBuildingView, CityJobView, CityView, Rock } from "../sim/index.js";
import type { CityQuality, CitySceneOptions } from "./city.js";
import { cityScene, resetSceneCache } from "./city.js";
import { frameDifference } from "./planet.js";

const { view: reference } = referenceCity();
const n = reference.tiles;
/** Flat, open ground with no rocks: whatever is drawn is what the test puts there. */
const open: CityView = {
  ...flatten(reference),
  id: "open",
  buildings: [],
  rocks: reference.rocks.map((): Rock => "none"),
  garage: null,
  jobs: [],
};

const at = (quality: CityQuality, time = 1, sinceYears = 0): CitySceneOptions => ({ time, selected: null, ghost: null, quality, sinceYears });

function withLinks(view: CityView, layer: "corridors" | "cables", tiles: readonly (readonly [number, number])[]): CityView {
  const list = [...view[layer]];
  for (const [x, y] of tiles) list[y * n + x] = true;
  return { ...view, [layer]: list };
}

const building = (type: CityBuildingView["type"], tx: number, ty: number, size: number, extra: Partial<CityBuildingView> = {}): CityBuildingView => ({
  index: 0,
  type,
  tx,
  ty,
  size,
  operable: true,
  activity: 1,
  baseZ: 0,
  submerged: false,
  network: null,
  ...extra,
});

const line = Array.from({ length: 10 }, (_, i) => [8 + i, 12] as const);

/** Pixels that differ from the same view without the thing under test. */
function changed(a: CityView, b: CityView, quality: CityQuality, opts: Partial<CitySceneOptions> = {}): number {
  resetSceneCache();
  const fa = renderCity(a, { ...at(quality), ...opts }, 480, 300, false);
  resetSceneCache();
  const fb = renderCity(b, { ...at(quality), ...opts }, 480, 300, false);
  return frameDifference(fa, fb);
}

describe("corridors and cables", () => {
  it("draw a corridor at every level of detail, and a cable up close and at medium - not furthest out, where it is too thin to see", () => {
    for (const q of ["high", "medium", "low"] as const) expect(changed(withLinks(open, "corridors", line), open, q), `corridor at ${q}`).toBeGreaterThan(0);
    for (const q of ["high", "medium"] as const) expect(changed(withLinks(open, "cables", line), open, q), `cable at ${q}`).toBeGreaterThan(0);
    // On hilly ground, where tiles are drawn one by one rather than merged
    // into flat patches (on flat ground a patch would hide a drawn cable, and
    // this check passed with cables drawn).
    const hills: CityView = { ...open, groundZ: reference.groundZ, corners: reference.corners, steep: reference.steep };
    expect(changed(withLinks(hills, "cables", line), hills, "low")).toBe(0);
    expect(changed(withLinks(hills, "corridors", line), hills, "low"), "and a corridor still shows there").toBeGreaterThan(0);
  });

  it("look different: a cable is not a corridor", () => {
    expect(changed(withLinks(open, "cables", line), withLinks(open, "corridors", line), "high")).toBeGreaterThan(0);
  });

  it("draw the cable yellow, and the corridor not", () => {
    const yellow = (v: CityView): number => {
      resetSceneCache();
      const f = renderCity(v, at("high"), 480, 300, false);
      let count = 0;
      for (let i = 0; i < f.pixels.length; i += 4) if (f.pixels[i]! > 150 && f.pixels[i + 1]! > 110 && f.pixels[i + 2]! < 70) count += 1;
      return count;
    };
    expect(yellow(withLinks(open, "cables", line))).toBeGreaterThan(yellow(open));
    expect(yellow(withLinks(open, "corridors", line))).toBe(yellow(open));
  });

  it("appear the moment they are laid: the kept ground is thrown away with the old layout", () => {
    for (const layer of ["corridors", "cables"] as const) {
      resetSceneCache();
      cityScene(open, at("high"));
      const cached = cityScene(withLinks(open, layer, line), at("high"));
      resetSceneCache();
      expect(cached, layer).toEqual(cityScene(withLinks(open, layer, line), at("high")));
    }
  });
});

describe("where a network meets a building", () => {
  /** Shapes lit in the connection lamp's colour. */
  const lamps = (view: CityView): number => {
    resetSceneCache();
    return cityScene(view, at("high")).filter((s) => s.fill.r === 1 && s.fill.g === 0.72 && s.fill.b === 0.25).length;
  };
  const depot = { ...open, buildings: [building("storage_depot", 14, 14, 1)] };

  it("puts one connection point to a side, for each network", () => {
    const one = lamps(withLinks(depot, "corridors", [[13, 14]]));
    expect(one).toBeGreaterThan(0);
    expect(lamps(withLinks(depot, "corridors", [[13, 14], [15, 14], [14, 13], [14, 15]]))).toBe(4 * one);
    // A cable on the same side is a second connection, its own terminal.
    expect(lamps(withLinks(withLinks(depot, "corridors", [[13, 14]]), "cables", [[13, 14]]))).toBeGreaterThan(one);
  });

  it("puts one to a side however long the side: a street is not a row of bollards", () => {
    const dome = { ...open, buildings: [building("habitat_dome", 14, 14, 3)] };
    expect(lamps(withLinks(dome, "corridors", [[13, 14], [13, 15], [13, 16]]))).toBe(lamps(withLinks(dome, "corridors", [[13, 15]])));
  });

  it("puts none where nothing meets a building", () => {
    expect(lamps(withLinks(open, "corridors", line))).toBe(0);
  });
});

describe("rocks", () => {
  const rockAt = (rock: Rock): CityView => ({ ...open, rocks: open.rocks.map((r, i) => (i === 12 * n + 12 ? rock : r)) });

  it("are drawn exactly where the view says there is one - a rover can break what is drawn", () => {
    expect(changed(rockAt("loose"), open, "high")).toBeGreaterThan(0);
    expect(changed(rockAt("crag"), open, "high")).toBeGreaterThan(0);
    expect(changed(rockAt("loose"), rockAt("crag"), "high")).toBeGreaterThan(0);
  });

  it("ring a selected rock", () => {
    expect(changed(rockAt("loose"), rockAt("loose"), "high", { selectedTile: { tx: 12, ty: 12 } })).toBe(0);
    resetSceneCache();
    const plain = cityScene(rockAt("loose"), at("high"));
    resetSceneCache();
    expect(cityScene(rockAt("loose"), { ...at("high"), selectedTile: { tx: 12, ty: 12 } }).length).toBe(plain.length + 1);
  });
});

describe("rovers and rockets", () => {
  const hq = building("headquarters", 14, 14, 5);
  const base: CityView = { ...open, buildings: [hq], garage: { x: 16.5, y: 16.5 } };
  const rover = (remaining: number): CityJobView => ({ kind: "rover", tx: 16, ty: 4, total: 1, remaining, work: 0.2 });

  it("draw a rover out on a job, and move it as the job goes on - smoothly, between the simulation's steps", () => {
    const job = { ...base, jobs: [rover(0.8)] };
    expect(changed(job, base, "high")).toBeGreaterThan(0);
    // The same job a little later - by the step, or by the moment between steps.
    expect(changed({ ...base, jobs: [rover(0.7)] }, job, "high")).toBeGreaterThan(0);
    expect(changed(job, job, "high", { sinceYears: 0.05 })).toBe(0);
    resetSceneCache();
    const now = renderCity(job, at("high", 1, 0), 480, 300, false);
    resetSceneCache();
    expect(frameDifference(renderCity(job, at("high", 1, 0.05), 480, 300, false), now)).toBeGreaterThan(0);
  });

  it("drive out, work at the rock, and come back: halfway there and halfway back are the same place", () => {
    // Total 1, work 0.2: the drive is 0.4 each way. 0.2 in = halfway out; 0.8 in = halfway back.
    const out = rover(0.8);
    const back = rover(0.2);
    const draw = (j: CityJobView): number[] => {
      resetSceneCache();
      return [...renderCity({ ...base, jobs: [j] }, at("high"), 480, 300, false).pixels];
    };
    const a = draw(out);
    const b = draw(back);
    // Facing the other way, in the same place: the pictures differ, but only a little.
    let differ = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) differ += 1;
    expect(differ).toBeGreaterThan(0);
    expect(differ).toBeLessThan(400);
  });

  it("lift a spaceport's rocket off, leave the pad empty while it is away, and bring it down", () => {
    const port = building("spaceport", 10, 10, 3);
    const pad = { ...open, buildings: [port] };
    const trip = (remaining: number): CityView => ({ ...pad, jobs: [{ kind: "rocket", tx: 10, ty: 10, total: 1.8, remaining, work: 0 }] });
    const onPad = cityScene(pad, at("high"));
    resetSceneCache();
    const away = cityScene(trip(0.9), at("high"));
    // Away: fewer shapes - no lander.
    expect(away.length).toBeLessThan(onPad.length);
    // Just launched and nearly home: the lander is flying, over its exhaust.
    resetSceneCache();
    expect(cityScene(trip(1.75), at("high")).length).toBeGreaterThan(away.length);
    resetSceneCache();
    expect(cityScene(trip(0.05), at("high")).length).toBeGreaterThan(away.length);
  });
});
