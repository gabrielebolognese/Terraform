/**
 * Railways over corridors and trains on them (at the user's request: "the
 * cities need more railways, and working trains ... giant railways that
 * interconnect the extremes of the city, with trains passing, bridges for
 * passing rails over corridors, maglev trains on top").
 */

import { describe, expect, it } from "vitest";

import { flatten, referenceCity, renderCity } from "../harness/city-frames.js";
import type { CityView, Rock } from "../sim/index.js";
import type { CityQuality, CitySceneOptions } from "./city.js";
import { BRIDGE_Z, cityLiveChunks, railDeck, resetSceneCache, trainLinesOf, trainsAt } from "./city.js";
import { frameDifference } from "./planet.js";

const { view: reference } = referenceCity();
const n = reference.tiles;
const open: CityView = {
  ...flatten(reference),
  id: "open",
  buildings: [],
  rocks: reference.rocks.map((): Rock => "none"),
  garage: null,
  jobs: [],
  corridors: reference.corridors.map(() => false),
  cables: reference.cables.map(() => false),
  rails: reference.corridors.map(() => false),
};
const at = (quality: CityQuality, time = 1): CitySceneOptions => ({ time, selected: null, ghost: null, quality });

function laid(view: CityView, layer: "corridors" | "rails", tiles: readonly (readonly [number, number])[], id: string): CityView {
  const list = [...(view[layer] ?? view.corridors.map(() => false))];
  for (const [x, y] of tiles) list[y * n + x] = true;
  return { ...view, id, [layer]: list };
}
const row = (y: number, x0: number, x1: number): [number, number][] => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y]);
const col = (x: number, y0: number, y1: number): [number, number][] => Array.from({ length: y1 - y0 + 1 }, (_, i) => [x, y0 + i]);

describe("bridges", () => {
  const corridor = laid(open, "corridors", col(12, 6, 18), "corridor");
  const crossing = laid(corridor, "rails", row(12, 6, 18), "crossing");

  it("carry a railway over a corridor: up on the crossing, half-way on the tiles either side, on the ground beyond", () => {
    expect(railDeck(crossing, 12, 12)).toBe(BRIDGE_Z);
    expect(railDeck(crossing, 11, 12)).toBe(BRIDGE_Z / 2);
    expect(railDeck(crossing, 13, 12)).toBe(BRIDGE_Z / 2);
    expect(railDeck(crossing, 10, 12)).toBe(0);
    // A corridor tile the line does not cross is no bridge.
    expect(railDeck(crossing, 12, 8)).toBe(0);
  });

  it("are drawn above the corridor's roof", () => {
    // One tile of each, on the same tile: the only thing the railway can be drawn above or below is the corridor there.
    const corridor = laid(open, "corridors", [[12, 12]], "one corridor");
    const crossing = laid(corridor, "rails", [[12, 12]], "one crossing");
    // The highest changed row of the picture: the corridor over bare ground, then the railway over the corridor.
    const top = (a: CityView, b: CityView): number => {
      resetSceneCache();
      // The still picture: a train passing would be the top of it.
      const fa = renderCity(a, { ...at("high"), layer: "static" }, 480, 300, false);
      resetSceneCache();
      const fb = renderCity(b, { ...at("high"), layer: "static" }, 480, 300, false);
      for (let y = 0; y < 300; y += 1) {
        for (let x = 0; x < 480; x += 1) {
          const i = (y * 480 + x) * 4;
          if (fa.pixels[i] !== fb.pixels[i] || fa.pixels[i + 1] !== fb.pixels[i + 1] || fa.pixels[i + 2] !== fb.pixels[i + 2]) return y;
        }
      }
      return Infinity;
    };
    const roof = top(open, corridor);
    expect(roof, "vacuity: the corridor is in the picture").toBeLessThan(300);
    // Measured: the railway's top 3 rows above the corridor's roof; drawn flat over it, level with it.
    expect(top(corridor, crossing)).toBeLessThan(roof);
  });
});

describe("the lines trains run on", () => {
  it("run there and back along a line between two dead ends, over every tile of it", () => {
    const view = laid(open, "rails", row(12, 4, 13), "line");
    const lines = trainLinesOf(view);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.tiles).toHaveLength(2 * 10 - 2);
    expect(new Set(lines[0]!.tiles)).toEqual(new Set(row(12, 4, 13).map(([x, y]) => y * n + x)));
  });

  it("run round a ring each way, and straight on where two lines cross", () => {
    const ring = laid(open, "rails", [...row(4, 4, 20), ...row(20, 4, 20), ...col(4, 5, 19), ...col(20, 5, 19)], "ring");
    const loops = trainLinesOf(ring);
    expect(loops.map((l) => l.tiles.length)).toEqual([4 * 16, 4 * 16]);
    expect(new Set(loops.map((l) => l.tiles[1]))).toHaveProperty("size", 2);
    const plus = laid(laid(open, "rails", row(12, 4, 20), "plus-a"), "rails", col(12, 4, 20), "plus");
    const lines = trainLinesOf(plus);
    expect(lines).toHaveLength(2);
    // Each line is one straight way, there and back: along x only, or along y only.
    for (const l of lines) {
      const xs = new Set(l.tiles.map((i) => i % n));
      const ys = new Set(l.tiles.map((i) => Math.floor(i / n)));
      expect(Math.min(xs.size, ys.size)).toBe(1);
    }
  });
});

describe("where trains run", () => {
  it("every stretch of a railway, each way - a branch met side-on too", () => {
    // A line with a spur off it to one side, and a crossing: every tile on some loop, each way along it.
    // A spur off each side (the one to the north met first, in the order tiles are looked at), and a crossing.
    const view = laid(laid(laid(laid(open, "rails", row(12, 2, 28), "t-a"), "rails", col(15, 13, 26), "t-b"), "rails", col(22, 2, 24), "t-c"), "rails", col(9, 3, 11), "t");
    const lines = trainLinesOf(view);
    const on = new Set(lines.flatMap((l) => l.tiles));
    const rails = [...row(12, 2, 28), ...col(15, 13, 26), ...col(22, 2, 24), ...col(9, 3, 11)].map(([x, y]) => y * n + x);
    expect(rails.filter((i) => !on.has(i))).toEqual([]);
    // Each way: the spur's tiles come twice over the loops (out and back).
    const count = (i: number) => lines.reduce((a, l) => a + l.tiles.filter((t) => t === i).length, 0);
    expect(count(20 * n + 15)).toBe(2);
    // And each is a loop a train can go round for ever: every tile beside the next, the last beside the first.
    for (const l of lines) {
      l.tiles.forEach((tile, k) => {
        const next = l.tiles[(k + 1) % l.tiles.length]!;
        expect(Math.abs((tile % n) - (next % n)) + Math.abs(Math.floor(tile / n) - Math.floor(next / n)), `step ${k} of a loop of ${l.tiles.length}`).toBe(1);
      });
    }
  });
});

describe("trains", () => {
  // Round the grid's edge, a tile in: 30 a side, 116 tiles.
  const ring = laid(open, "rails", [...row(1, 1, 30), ...row(30, 1, 30), ...col(1, 2, 29), ...col(30, 2, 29)], "long ring");

  it("run on each line, one to every 56 tiles of it, four cars each, and move along it", () => {
    // The ring each way round: two loops of 116, two trains each.
    expect(trainLinesOf(ring).map((l) => l.tiles.length)).toEqual([116, 116]);
    const cars = (time: number) => [...trainsAt(ring, time).values()].flat();
    expect(cars(0)).toHaveLength(2 * 2 * 4);
    // A second later every car is somewhere else, and a lap later where it began.
    const a = cars(0).map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`).sort();
    const b = cars(1).map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`).sort();
    expect(b.filter((p) => a.includes(p))).toEqual([]);
    const lap = 116 / 2.2;
    const c = cars(lap).map((car) => `${car.x.toFixed(3)},${car.y.toFixed(3)}`).sort();
    expect(c).toEqual(a);
  });

  it("ride up over a bridge", () => {
    const view = laid(laid(open, "corridors", col(17, 0, 31), "ring corridor"), "rails", [...row(1, 1, 30), ...row(30, 1, 30), ...col(1, 2, 29), ...col(30, 2, 29)], "bridged ring");
    let over = 0;
    for (let time = 0; time < 60; time += 0.05) {
      for (const car of [...trainsAt(view, time).values()].flat()) {
        if (Math.abs(car.x - 17.5) < 0.05 && (Math.abs(car.y - 1.5) < 0.05 || Math.abs(car.y - 30.5) < 0.05)) {
          over += 1;
          // Within a twentieth of a tile of the crossing's middle: within a twentieth of the climb (0.21 a tile) of the deck.
          const up = car.z - (view.groundZ[Math.floor(car.y) * n + 17] ?? 0);
          expect(up).toBeGreaterThan(BRIDGE_Z - 0.011);
          expect(up).toBeLessThanOrEqual(BRIDGE_Z + 1e-9);
        }
      }
    }
    expect(over, "vacuity: a car crossed the bridge").toBeGreaterThan(0);
  });

  it("are drawn moving: the picture changes with the clock where trains run, and not where none do", () => {
    const moved = (view: CityView): number => {
      resetSceneCache();
      const a = renderCity(view, at("medium", 0), 480, 300, false);
      resetSceneCache();
      const b = renderCity(view, at("medium", 3), 480, 300, false);
      return frameDifference(a, b);
    };
    // Measured: 0.094% of the picture a second or three apart, a four-car train being a few pixels; exactly none without trains.
    expect(moved(ring)).toBeGreaterThan(0);
    expect(moved(open)).toBe(0);
  });

  it("mark the chunks they are in as moving, so the chunked city draws them every frame", () => {
    const chunks = cityLiveChunks(ring, at("medium", 0), 8);
    const cars = [...trainsAt(ring, 0).keys()];
    expect(cars.length).toBeGreaterThan(0);
    for (const tile of cars) expect(chunks.has(`${Math.floor((tile % n) / 8)},${Math.floor(Math.floor(tile / n) / 8)}`)).toBe(true);
    expect(cityLiveChunks(open, at("medium", 0), 8).size).toBe(0);
  });
});
