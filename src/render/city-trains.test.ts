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
import { BRIDGE_Z, cityLiveChunks, railDeck, railsDrawn, resetSceneCache, trainLapsOf, trainLinesOf, trainsAt } from "./city.js";
import { TRAIN_CARS } from "./vehicles.js";
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

  it("run on each line, one to every 56 tiles of it, five cars each, and move along it", () => {
    // The ring each way round: two loops of 116, two trains each.
    expect(trainLinesOf(ring).map((l) => l.tiles.length)).toEqual([116, 116]);
    const cars = (time: number) => [...trainsAt(ring, time).values()].flat();
    expect(cars(0)).toHaveLength(2 * 2 * TRAIN_CARS);
    // A second later every car is somewhere else, and a lap later where it began.
    const a = cars(0).map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`).sort();
    const b = cars(1).map((c) => `${c.x.toFixed(3)},${c.y.toFixed(3)}`).sort();
    expect(b.filter((p) => a.includes(p))).toEqual([]);
    // A lap later (Batch 29: slower round the four bends, so longer than 116 tiles at full speed) where it began.
    const [lap, other] = trainLapsOf(ring);
    expect(lap).toBe(other);
    expect(lap!).toBeGreaterThan(116 / 2.2);
    const c = cars(lap!).map((car) => `${car.x.toFixed(3)},${car.y.toFixed(3)}`).sort();
    expect(c).toEqual(a);
  });

  it("ride up over a bridge", () => {
    const view = laid(laid(open, "corridors", col(17, 0, 31), "ring corridor"), "rails", [...row(1, 1, 30), ...row(30, 1, 30), ...col(1, 2, 29), ...col(30, 2, 29)], "bridged ring");
    let over = 0;
    for (let time = 0; time < 60; time += 0.05) {
      for (const car of [...trainsAt(view, time).values()].flat()) {
        // Over the crossing's middle, on either track (Batch 29: each way runs off the line's middle).
        if (Math.abs(car.x - 17.5) < 0.05 && (Math.floor(car.y) === 1 || Math.floor(car.y) === 30)) {
          over += 1;
          // A car rides on its two bogies, 0.3 tiles either side of its middle, down the climb (0.21 a tile) from the
          // deck: 0.85 of the deck's height, and never above it.
          const up = car.z - (view.groundZ[Math.floor(car.y) * n + 17] ?? 0);
          expect(up).toBeGreaterThan(0.8 * BRIDGE_Z);
          expect(up).toBeLessThanOrEqual(BRIDGE_Z + 1e-9);
        }
      }
    }
    expect(over, "vacuity: a car crossed the bridge").toBeGreaterThan(0);
  });

  it("ride on the rails drawn: a rail either side of each car's middle, round the bends too", () => {
    // How far a point is from a strip of rail, across the ground (0 on it).
    const away = (px: number, py: number, pts: readonly (readonly number[])[]): number => {
      let inside = true;
      let best = Infinity;
      pts.forEach((a, k) => {
        const b = pts[(k + 1) % pts.length]!;
        const ex = b[0]! - a[0]!;
        const ey = b[1]! - a[1]!;
        const crossed = ex * (py - a[1]!) - ey * (px - a[0]!);
        const next = pts[(k + 2) % pts.length]!;
        if (Math.sign(crossed) !== Math.sign(ex * (next[1]! - a[1]!) - ey * (next[0]! - a[0]!))) inside = false;
        const f = Math.max(0, Math.min(1, ((px - a[0]!) * ex + (py - a[1]!) * ey) / (ex * ex + ey * ey)));
        best = Math.min(best, Math.hypot(a[0]! + ex * f - px, a[1]! + ey * f - py));
      });
      return inside ? 0 : best;
    };
    const rails = new Map<number, (readonly (readonly number[])[])[]>();
    const railsNear = (x: number, y: number): (readonly (readonly number[])[])[] => {
      const out: (readonly (readonly number[])[])[] = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const tx = Math.floor(x) + dx;
          const ty = Math.floor(y) + dy;
          if (ring.rails?.[ty * n + tx] !== true) continue;
          if (!rails.has(ty * n + tx)) rails.set(ty * n + tx, railsDrawn(ring, tx, ty));
          out.push(...rails.get(ty * n + tx)!);
        }
      }
      return out;
    };
    const [lap] = trainLapsOf(ring);
    let probes = 0;
    let onBends = 0;
    for (let time = 0; time < lap!; time += 0.2) {
      for (const car of [...trainsAt(ring, time).values()].flat()) {
        const ux = Math.cos(car.angle);
        const uy = Math.sin(car.angle);
        // Either side of the car's middle, 0.06 out: over its track's two rails.
        for (const across of [-0.06, 0.06]) {
          const wx = car.x - uy * across;
          const wy = car.y + ux * across;
          const d = Math.min(...railsNear(wx, wy).map((pts) => away(wx, wy, pts)));
          probes += 1;
          const tx = Math.floor(wx);
          const ty = Math.floor(wy);
          if ((tx === 1 || tx === 30) && (ty === 1 || ty === 30)) onBends += 1;
          // Measured: 0.028 at most, on the outer track round a bend (a car's middle is inside the curve its bogies
          // ride); 0.079 with a bend drawn as two straight halves, as before Batch 29.
          expect(d, `the car at ${car.x.toFixed(3)},${car.y.toFixed(3)} at ${time.toFixed(1)} s is off its rails`).toBeLessThan(0.05);
        }
      }
    }
    expect(onBends, "vacuity: cars went round the bends").toBeGreaterThan(100);
    expect(probes).toBeGreaterThan(10_000);
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
