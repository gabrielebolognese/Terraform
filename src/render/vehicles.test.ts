/**
 * Batch 29's exit gate: "No vehicle inside a building. Over a scripted day in
 * the reference city and in a metropolis, at every frame sampled, no rover or
 * train car's footprint overlaps a building's footprint" - and the vehicles
 * that use the city: rovers on their routes, facing where they drive and
 * keeping apart; trains on their rails, stopping at stations; and every one
 * of them drawn behind what stands in front of it.
 */

import { beforeAll, describe, expect, it } from "vitest";

import type { CityDay, MetropolisScene } from "../harness/vehicles.js";
import { cityDay, metropolisScene } from "../harness/vehicles.js";
import type { CityView } from "../sim/index.js";
import { cityView } from "../sim/index.js";
import { worldTuning } from "../web/game-tuning.js";
import type { CityQuality, CitySceneOptions } from "./city.js";
import { CITY_BACKGROUND, buildingTop, cityChunkRange, cityChunkReach, cityScene, drawCarShapes, drawRoverShapes, trainCars, trainLinesOf } from "./city.js";
import { TILE_H, TILE_W, Z_PX, drawsBefore } from "./iso.js";
import type { Shape } from "./raster.js";
import { rasterize } from "./raster.js";
import type { Footprint, TrainCar } from "./vehicles.js";
import { ROVER_HALF_L, TRAIN_DWELL_S, cornersOf, footprintsOverlap, roversOf } from "./vehicles.js";

/** A new world's tuning: the Standard pace, routes on. */
const T = worldTuning("standard", 0, "standard");
const SUBSTEP = T.SUBSTEP_YEARS * T.CITY_CLOCK;

let day: CityDay;
let metro: MetropolisScene;
let metroView: CityView;
beforeAll(() => {
  day = cityDay(T, 2 * 3600);
  metro = metropolisScene(T);
  metroView = cityView(metro.state.settlements.find((c) => c.id === metro.id)!, metro.env, T);
}, 240_000);

/** Row-major: which building stands on each tile, or -1. */
function owners(view: CityView): Int32Array {
  const n = view.tiles;
  const owner = new Int32Array(n * n).fill(-1);
  view.buildings.forEach((b, i) => {
    for (let y = b.ty; y < b.ty + (b.depth ?? b.size); y += 1) for (let x = b.tx; x < b.tx + b.size; x += 1) if (x >= 0 && y >= 0 && x < n && y < n) owner[y * n + x] = i;
  });
  return owner;
}

/** Whether a vehicle's footprint overlaps the footprint of any building - any tile one stands on, by any area at all. */
function inBuilding(view: CityView, owner: Int32Array, f: Footprint): boolean {
  const n = view.tiles;
  const pts = cornersOf(f);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.floor(Math.max(...ys)); y += 1) {
    for (let x = Math.floor(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x += 1) {
      if (x < 0 || y < 0 || x >= n || y >= n || owner[y * n + x]! < 0) continue;
      if (footprintsOverlap(f, { x: x + 0.5, y: y + 0.5, angle: 0, halfL: 0.5, halfW: 0.5 })) return true;
    }
  }
  return false;
}

/** Whether every corner of a car, and its middle, is over a railway tile. */
function onRails(view: CityView, c: Footprint): boolean {
  const n = view.tiles;
  return [...cornersOf(c), [c.x, c.y] as [number, number]].every(([x, y]) => view.rails?.[Math.floor(y) * n + Math.floor(x)] === true);
}

/** A view's jobs as an old save's, with no way given: drawn the straight line of Batches 21-28. */
const straight = (view: CityView): CityView => ({ ...view, jobs: view.jobs.map(({ path: _p, at: _a, ...j }) => j) });

/**
 * Batch 28's trains, as they were placed (the code this batch replaced, kept
 * here only to show the check finds what it is for): car after car a tile
 * apart, each between two tile middles, the lead car's nose 0.56 tiles ahead.
 */
function batch28Cars(view: CityView, time: number): Footprint[] {
  const n = view.tiles;
  const out: Footprint[] = [];
  trainLinesOf(view).forEach((line, li) => {
    const len = line.tiles.length;
    if (len < 12) return;
    const trains = Math.max(1, Math.floor(len / 56));
    for (let k = 0; k < trains; k += 1) {
      const head = time * 2.2 + (k * len) / trains + li * 7.3;
      for (let c = 0; c < 4; c += 1) {
        const s = (((head - c) % len) + len) % len;
        const i0 = Math.floor(s);
        const a = line.tiles[i0]!;
        const b = line.tiles[(i0 + 1) % len]!;
        const ax = (a % n) + 0.5;
        const ay = Math.floor(a / n) + 0.5;
        const bx = (b % n) + 0.5;
        const by = Math.floor(b / n) + 0.5;
        const angle = Math.atan2(by - ay, bx - ax);
        const x = ax + (bx - ax) * (s - i0);
        const y = ay + (by - ay) * (s - i0);
        out.push({ x, y, angle, halfL: 0.44, halfW: 0.16 });
        if (c === 0) out.push({ x: x + Math.cos(angle) * 0.5, y: y + Math.sin(angle) * 0.5, angle, halfL: 0.06, halfW: 0.13 });
      }
    }
  });
  return out;
}

describe("a scripted day in the reference city: two hours of the scripted player, routes on", () => {
  it("never has a rover inside a building - every substep, four moments each", () => {
    let frames = 0;
    let inside = 0;
    let old = 0;
    for (const s of day.days) {
      if (s.jobs.length === 0) continue;
      const view = cityView(s, day.env, T);
      const owner = owners(view);
      for (const f of [0, 0.25, 0.5, 0.75]) {
        for (const r of roversOf(view, f * SUBSTEP)) {
          frames += 1;
          if (inBuilding(view, owner, r)) inside += 1;
        }
        for (const r of roversOf(straight(view), f * SUBSTEP)) if (inBuilding(view, owner, r)) old += 1;
      }
    }
    // Measured: 8,610 rover-frames, none inside a building.
    expect(frames, "vacuity: rovers out all day").toBeGreaterThan(5000);
    expect(inside).toBe(0);
    // Vacuity: the same check on the straight line rovers drove before (and an old job still does) - 7,379 of
    // 7,578 frames inside a building, measured.
    expect(old).toBeGreaterThan(5000);
  });

  it("keeps two rovers on one stretch apart", () => {
    let near = 0;
    let touching = 0;
    for (const s of day.days) {
      if (s.jobs.length < 2) continue;
      const view = cityView(s, day.env, T);
      for (const f of [0, 0.25, 0.5, 0.75]) {
        const rs = roversOf(view, f * SUBSTEP).filter((r) => r.working === null);
        for (let i = 0; i < rs.length; i += 1) {
          for (let j = i + 1; j < rs.length; j += 1) {
            if (Math.hypot(rs[i]!.x - rs[j]!.x, rs[i]!.y - rs[j]!.y) < 1.5) near += 1;
            if (footprintsOverlap(rs[i]!, rs[j]!)) touching += 1;
          }
        }
      }
    }
    expect(near, "vacuity: rovers drive close together (14 times, measured)").toBeGreaterThan(5);
    expect(touching).toBe(0);
  });

  it("never has a train car inside a building or off its rails, on a railway laid round the city", () => {
    const view = cityView(day.railed, day.env, T);
    const owner = owners(view);
    let cars = 0;
    for (let time = 0; time < 600; time += 0.25) {
      for (const c of trainCars(view, time)) {
        cars += 1;
        expect(inBuilding(view, owner, c), `a car at ${c.x.toFixed(2)},${c.y.toFixed(2)} at ${time} s`).toBe(false);
        expect(onRails(view, c), `a car at ${c.x.toFixed(2)},${c.y.toFixed(2)} at ${time} s`).toBe(true);
      }
    }
    // Measured: 48,000 car-frames on four loops.
    expect(cars, "vacuity: trains ran").toBeGreaterThan(10_000);
  });
});

describe("a world made before routes", () => {
  it("still has its rovers drawn round the buildings, not through them - on a way found for each, in the time it set out with", () => {
    // The scripted day's jobs as a save from before Batch 29 holds them: no route, the straight line's time.
    let frames = 0;
    let routed = 0;
    for (const s of day.days.filter((_, k) => k % 3 === 0)) {
      if (s.jobs.length === 0) continue;
      const old = { ...s, jobs: s.jobs.map((j) => (j.kind === "rocket" ? j : (({ route: _r, ...rest }) => rest)(j))) };
      const view = cityView(old, day.env, T);
      const owner = owners(view);
      for (const j of view.jobs) if (j.kind === "rover" && (j.path?.length ?? 0) > 2) routed += 1;
      for (const r of roversOf(view, 0.5 * SUBSTEP)) {
        frames += 1;
        expect(inBuilding(view, owner, r), `rover ${r.job} at ${r.x.toFixed(2)},${r.y.toFixed(2)}`).toBe(false);
      }
    }
    expect(frames).toBeGreaterThan(500);
    expect(routed, "vacuity: drawn on a way round, not the straight line").toBeGreaterThan(100);
  });
});

describe("a metropolis with every rover out and its railways", () => {
  it("never has a rover inside a building, all the way through every trip", () => {
    const owner = owners(metroView);
    let frames = 0;
    let old = 0;
    for (let q = 0; q <= 1; q += 0.004) {
      const at: CityView = { ...metroView, jobs: metroView.jobs.map((j) => ({ ...j, remaining: Math.max(1e-9, j.total * (1 - q)) })) };
      for (const r of roversOf(at, 0)) {
        frames += 1;
        expect(inBuilding(metroView, owner, r), `rover ${r.job} at ${r.x.toFixed(2)},${r.y.toFixed(2)}, ${q.toFixed(3)} through`).toBe(false);
      }
      for (const r of roversOf(straight(at), 0)) if (inBuilding(metroView, owner, r)) old += 1;
    }
    expect(metro.sent, "vacuity: every rover out (14)").toBeGreaterThan(10);
    expect(frames).toBeGreaterThan(2000);
    // The straight line: 2,549 of 3,192 frames inside a building, measured.
    expect(old).toBeGreaterThan(1000);
  });

  it("never has a train car inside a building or off its rails", () => {
    const owner = owners(metroView);
    let cars = 0;
    let before = 0;
    for (let time = 0; time < 600; time += 0.5) {
      for (const c of trainCars(metroView, time)) {
        cars += 1;
        if (inBuilding(metroView, owner, c) || !onRails(metroView, c)) expect.fail(`a car at ${c.x.toFixed(2)},${c.y.toFixed(2)} at ${time} s`);
      }
      for (const f of batch28Cars(metroView, time)) if (inBuilding(metroView, owner, f)) before += 1;
    }
    // Measured: 330,000 car-frames.
    expect(cars).toBeGreaterThan(100_000);
    // Vacuity: Batch 28's trains, the same check - 17 noses into a station or another building at a line's end, measured.
    expect(before).toBeGreaterThan(0);
  });

  it("stops each passing train at a station's platform for the tuned dwell", () => {
    const n = metroView.tiles;
    const platforms = new Set<number>();
    for (const b of metroView.buildings) {
      if (b.type !== "station") continue;
      const d = b.depth ?? b.size;
      for (let x = b.tx; x < b.tx + b.size; x += 1) for (const y of [b.ty - 1, b.ty + d]) platforms.add(y * n + x);
      for (let y = b.ty; y < b.ty + d; y += 1) for (const x of [b.tx - 1, b.tx + b.size]) platforms.add(y * n + x);
    }
    const dt = 0.05;
    const last = new Map<number, { car: TrainCar; since: number; heading: number }>();
    const stops: { held: number; through: boolean; platform: boolean }[] = [];
    for (let time = 0; time < 240; time += dt) {
      for (const c of trainCars(metroView, time)) {
        if (c.car !== 0) continue;
        const l = last.get(c.train);
        if (l !== undefined && Math.hypot(c.x - l.car.x, c.y - l.car.y) < 1e-9) continue;
        if (l !== undefined) {
          const held = time - dt - l.since;
          // Through: it goes on the way it came, not back.
          if (held > 0.5) stops.push({ held, through: Math.cos(c.angle - l.heading) > 0.5, platform: c.freight ? false : platforms.has(Math.floor(l.car.y) * n + Math.floor(l.car.x)) });
        }
        last.set(c.train, { car: c, since: time, heading: c.angle });
      }
    }
    const through = stops.filter((s) => s.through);
    expect(through.length, "vacuity: trains pass through stations").toBeGreaterThan(0);
    for (const s of through) {
      // Every stop on the way through is at a platform, and lasts the dwell (to the sampling: 3.95 s measured, sampled every 0.05 s).
      expect(s.platform).toBe(true);
      expect(s.held).toBeGreaterThanOrEqual(TRAIN_DWELL_S - 2 * dt);
      expect(s.held).toBeLessThanOrEqual(TRAIN_DWELL_S + dt);
    }
  });

  it("runs each way of a line on its own track: two trains passing never touch, away from a junction", () => {
    // Each way of a line is a loop of its own, on its own track: trains pass each other on every line. Where lines
    // meet, trains of the two cross the same ground: there are no signals (recorded in the batch note), so a tile
    // and a half round a junction is left out.
    const n = metroView.tiles;
    const rails = metroView.rails!;
    const near = new Set<number>();
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (!rails[y * n + x]) continue;
        const ways = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => rails[(y + dy!) * n + x + dx!] === true).length;
        if (ways < 3) continue;
        for (let j = -2; j <= 2; j += 1) for (let i = -2; i <= 2; i += 1) near.add((y + j) * n + x + i);
      }
    }
    const clear = (c: TrainCar): boolean => !near.has(Math.floor(c.y) * n + Math.floor(c.x));
    let passes = 0;
    for (let time = 0; time < 120; time += 0.25) {
      const cars = trainCars(metroView, time);
      const byTile = new Map<number, TrainCar[]>();
      for (const c of cars) {
        const k = Math.floor(c.y) * n + Math.floor(c.x);
        byTile.set(k, [...(byTile.get(k) ?? []), c]);
      }
      for (const c of cars) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            for (const o of byTile.get((Math.floor(c.y) + dy) * n + Math.floor(c.x) + dx) ?? []) {
              if (o.train <= c.train || !clear(c) || !clear(o)) continue;
              if (Math.hypot(o.x - c.x, o.y - c.y) < 0.6) passes += 1;
              expect(footprintsOverlap(c, o), `trains ${c.train} and ${o.train} at ${time} s, ${c.x.toFixed(2)},${c.y.toFixed(2)}`).toBe(false);
            }
          }
        }
      }
    }
    expect(passes, "vacuity: trains pass close by each other").toBeGreaterThan(0);
  });

  it("runs maglevs on lines past a station and freight on the rest, drawn differently", () => {
    const cars = trainCars(metroView, 10);
    const freight = cars.filter((c) => c.freight);
    const maglev = cars.filter((c) => !c.freight);
    expect(freight.length).toBeGreaterThan(0);
    expect(maglev.length).toBeGreaterThan(0);
    // Drawn: a freight car and a maglev car on the same spot, on open ground, share no colour.
    const colours = (car: TrainCar): Set<string> => new Set(drawCarShapes(car).map((s) => `${s.fill.r.toFixed(2)},${s.fill.g.toFixed(2)},${s.fill.b.toFixed(2)}`));
    const a = colours({ ...freight[0]!, x: 5.5, y: 5.5, z: 0, lead: false });
    const b = colours({ ...maglev[0]!, x: 5.5, y: 5.5, z: 0, lead: false });
    expect([...a].filter((c) => b.has(c))).toEqual([]);
  });
});


describe("a rover", () => {
  it("faces where it drives", () => {
    let moving = 0;
    for (let q = 0.02; q < 1; q += 0.01) {
      const at = (dq: number): CityView => ({ ...metroView, jobs: metroView.jobs.map((j) => ({ ...j, remaining: Math.max(1e-9, j.total * (1 - q - dq)) })) });
      const a = roversOf(at(0), 0);
      const b = roversOf(at(0.0005), 0);
      for (const r of a) {
        const s = b.find((x) => x.job === r.job);
        if (s === undefined || r.working !== null || s.working !== null) continue;
        const d = Math.hypot(s.x - r.x, s.y - r.y);
        // A moment on, the same way: not across a corner, where the heading turns.
        if (d < 1e-4 || Math.abs(s.angle - r.angle) > 1e-9) continue;
        moving += 1;
        expect(((s.x - r.x) * Math.cos(r.angle) + (s.y - r.y) * Math.sin(r.angle)) / d).toBeGreaterThan(0.999);
      }
    }
    expect(moving, "vacuity: rovers seen moving").toBeGreaterThan(500);
  });

  it("works at its site, standing, the arm hammering", () => {
    const job = metroView.jobs.findIndex((j) => j.kind === "rover");
    const j = metroView.jobs[job]!;
    const drive = (j.total - j.work) / 2;
    const at = (elapsed: number): CityView => ({ ...metroView, jobs: metroView.jobs.map((x, i) => (i === job ? { ...x, remaining: x.total - elapsed } : x)) });
    const early = roversOf(at(drive + 0.1 * j.work), 0).find((r) => r.job === job)!;
    const late = roversOf(at(drive + 0.9 * j.work), 0).find((r) => r.job === job)!;
    expect(early.working).toBeCloseTo(0.1, 6);
    expect(late.working).toBeCloseTo(0.9, 6);
    expect([late.x, late.y, late.angle]).toEqual([early.x, early.y, early.angle]);
    // The arm moves with the render clock: drawn at two moments the rover at work differs, and one driving does not.
    const pic = (time: number, r = early): string => JSON.stringify(drawRoverShapes({ ...r, x: 5.5, y: 5.5, z: 0 }, time).filter((s) => s.fill.a === 1).map((s) => s.rings));
    expect(pic(0.01)).not.toBe(pic(0.07));
    expect(pic(0.01, { ...early, working: null })).toBe(pic(0.07, { ...early, working: null }));
  });

  it("waits behind another on the same stretch rather than through it", () => {
    // Two rovers sent the same moment along the same way: the later one keeps a gap behind.
    const job = metroView.jobs.find((j) => j.kind === "rover" && (j.path?.length ?? 0) > 3)!;
    const twins: CityView = { ...metroView, jobs: [job, { ...job }] };
    const drive = (job.total - job.work) / 2;
    let seen = 0;
    for (let q = 0.05; q < 0.95; q += 0.05) {
      const at: CityView = { ...twins, jobs: twins.jobs.map((j) => ({ ...j, remaining: j.total - q * drive })) };
      const rs = roversOf(at, 0);
      if (rs.length < 2) continue;
      seen += 1;
      expect(footprintsOverlap(rs[0]!, rs[1]!)).toBe(false);
      expect(Math.hypot(rs[0]!.x - rs[1]!.x, rs[0]!.y - rs[1]!.y)).toBeLessThan(2 * ROVER_HALF_L + 0.3);
    }
    expect(seen).toBeGreaterThan(5);
  });
});

describe("depth: a vehicle behind a building is hidden by it", () => {
  /** The shapes the browser fills for a part of the city: each chunk's still picture, then what moves in it, back to front; then the overlays. */
  function asTheBrowserDraws(view: CityView, o: CitySceneOptions, size: number, redrawn = true): Shape[] {
    const r = cityChunkRange(view, size);
    const vp = o.viewport!;
    const chunks: [number, number][] = [];
    for (let cy = r.cy0; cy <= r.cy1; cy += 1) {
      for (let cx = r.cx0; cx <= r.cx1; cx += 1) {
        const reach = cityChunkReach(view, size, cx, cy);
        if (reach.maxX < vp.minX || reach.minX > vp.maxX || reach.maxY < vp.minY || reach.minY > vp.maxY) continue;
        chunks.push([cx, cy]);
      }
    }
    chunks.sort((a, b) => a[0] + a[1] - (b[0] + b[1]) || a[0] - b[0]);
    const out: Shape[] = [];
    for (const [cx, cy] of chunks) {
      const chunk = { x0: cx * size, y0: cy * size, size };
      // Without `redrawn`, the moving layer as it was before Batch 29: what moves, and nothing drawn again over it.
      const live = cityScene(view, { ...o, chunk, layer: "live" });
      out.push(...cityScene(view, { ...o, chunk, layer: "static" }), ...(redrawn ? live : live.filter((shape) => shape.clip === undefined)));
    }
    out.push(...cityScene(view, { ...o, layer: "overlay" }));
    return out;
  }

  for (const [quality, size] of [["medium", 16], ["high", 8]] as [CityQuality, number][]) it(`in the browser's chunked drawing as in the whole scene, at ${quality} detail - a metropolis's trains passing behind its towers`, () => {
    const n = metroView.tiles;
    const owner = owners(metroView);
    // Moments and cars behind a tall building of their own chunk: the case the still picture under the moving layer
    // got wrong.
    const candidates: { time: number; car: TrainCar }[] = [];
    for (let time = 0; time < 60 && candidates.length < 24; time += 1) {
      for (const c of trainCars(metroView, time)) {
        const tx = Math.floor(c.x);
        const ty = Math.floor(c.y);
        let behind = false;
        for (let y = ty - 1; y <= ty + 6 && !behind; y += 1) {
          for (let x = tx - 6; x <= tx + 6 && !behind; x += 1) {
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            const o = owner[y * n + x]!;
            if (o < 0) continue;
            const b = metroView.buildings[o]!;
            const same = Math.floor(b.tx / size) === Math.floor(tx / size) && Math.floor(b.ty / size) === Math.floor(ty / size);
            if (!same || buildingTop(b.type) < 1.5 || !drawsBefore({ tx, ty, w: 1, h: 1 }, { tx: b.tx, ty: b.ty, w: b.size, h: b.depth ?? b.size })) continue;
            // In front on screen too: its image across the car's.
            const sx = ((c.x - c.y) * TILE_W) / 2;
            const bx0 = ((b.tx - b.ty - (b.depth ?? b.size)) * TILE_W) / 2;
            const bx1 = ((b.tx + b.size - b.ty) * TILE_W) / 2;
            behind = sx > bx0 + 8 && sx < bx1 - 8;
          }
        }
        if (behind) {
          candidates.push({ time, car: c });
          break;
        }
      }
    }
    const w = 320;
    const h = 200;
    const differing = (a: { pixels: Uint8ClampedArray | Uint8Array }, b: { pixels: Uint8ClampedArray | Uint8Array }): number => {
      let count = 0;
      for (let i = 0; i < w * h; i += 1) if (Math.max(...[0, 1, 2].map((k) => Math.abs(a.pixels[i * 4 + k]! - b.pixels[i * 4 + k]!))) > 2) count += 1;
      return count;
    };
    // Those where something of the car's own chunk does cover it on screen (most do not): drawn as the browser drew
    // it before this batch - each chunk's still picture, then only what moves in it, none of it drawn again over a
    // vehicle - the picture is not the whole scene. At each, the browser's drawing now is.
    let checked = 0;
    let most = 0;
    for (const { time, car } of candidates) {
      const cx = ((car.x - car.y) * TILE_W) / 2;
      const cy = ((car.x + car.y) * TILE_H) / 2 - car.z * Z_PX;
      const viewport = { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2 };
      const o: CitySceneOptions = { time, selected: null, ghost: null, quality, viewport, sinceYears: 0 };
      const frame = (shapes: readonly Shape[]) => rasterize(shapes, w, h, { scale: 1, offsetX: w / 2 - cx, offsetY: h / 2 - cy }, CITY_BACKGROUND);
      const whole = frame(cityScene(metroView, o));
      const before = differing(whole, frame(asTheBrowserDraws(metroView, o, size, false)));
      if (before === 0) continue;
      checked += 1;
      most = Math.max(most, before);
      const noCars = frame(cityScene({ ...metroView, rails: (metroView.rails ?? []).map(() => false) }, o));
      expect(differing(whole, noCars), "vacuity: trains in the picture").toBeGreaterThan(20);
      // Measured: no pixel differs, at either detail. Before, at the first such moment (4 s): 104 pixels at medium and
      // 131 at high, the cars over a dome's glass. Drawing again what covered them clipped to the train's box, not its
      // outline, blended the glass twice round it: 786 and 735 (the version this batch first shipped).
      expect(differing(whole, frame(asTheBrowserDraws(metroView, o, size))), `at ${time} s`).toBe(0);
    }
    // Measured: 6 moments of 24 at medium, the most 104 pixels covered; 9 at high, the most 131.
    expect(checked, `vacuity: cars hidden on screen by a building of their own chunk (of ${candidates.length} behind one)`).toBeGreaterThan(0);
    expect(most, "vacuity: one well hidden").toBeGreaterThan(20);
  });
});
