/**
 * Levelling ground (at the user's request): "allow users to also flat out the
 * terrain for better aesthetics - right now there are the levels where the
 * structure goes up with concrete foundations, but also there has to be the
 * possibility to send a rover and flat out the terrain to the nearby level."
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { rocksOf, siteGround } from "./rocks.js";
import { claimLand, levelGround, placeBuilding } from "./settlement.js";
import { tileKey } from "./space.js";
import { cityView } from "./view.js";

const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 96 });
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };

function city(): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 300, stores: { ...c.stores, materials: 100 } })) };
}
const first = (s: SimState): Settlement => s.settlements[0]!;
const id = (s: SimState): string => first(s).id;

/** The four corners of a tile, metres, as the rules see the ground. */
function cornersOf(s: SimState, tx: number, ty: number): number[] {
  const g = siteGround(first(s), T);
  const m = g.tiles + 1;
  return [g.cornersM[ty * m + tx]!, g.cornersM[ty * m + tx + 1]!, g.cornersM[(ty + 1) * m + tx]!, g.cornersM[(ty + 1) * m + tx + 1]!];
}
const spread = (c: number[]): number => Math.max(...c) - Math.min(...c);

/** Send the rover and wait until it is home. */
function level(s: SimState, tx: number, ty: number): SimState {
  const o = levelGround(s, id(s), tx, ty, T);
  expect(o.ok, `level ${tx},${ty}: ${o.reason}`).toBe(true);
  const job = first(o.state).jobs[first(o.state).jobs.length - 1]!;
  return advance(o.state, Math.ceil(job.total / T.SUBSTEP_YEARS) + 1, cfg);
}

/** Open tiles on a slope, not under a building, nearest the centre first. */
function sloped(s: SimState, from: [number, number], within = 12): [number, number][] {
  const g = siteGround(first(s), T);
  const rocks = rocksOf(first(s), T);
  const out: [number, number][] = [];
  for (let ty = from[1] - within; ty <= from[1] + within; ty += 1) {
    for (let tx = from[0] - within; tx <= from[0] + within; tx += 1) {
      const i = ty * g.tiles + tx;
      if (g.slope[i]! > 0.05 && !g.steep[i] && rocks[i] === "none") out.push([tx, ty]);
    }
  }
  return out.sort((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) - Math.hypot(b[0] - from[0], b[1] - from[1]));
}

describe("levelling ground with a rover", () => {
  it("levels a sloping tile: all four corners at one height, no slope left, and the grade kept", () => {
    const s = city();
    const [tx, ty] = sloped(s, [48, 48])[0]!;
    expect(spread(cornersOf(s, tx, ty)), "vacuity: the tile slopes").toBeGreaterThan(0.05);
    const done = level(s, tx, ty);
    const [h] = cornersOf(done, tx, ty);
    for (const c of cornersOf(done, tx, ty)) expect(c).toBe(h);
    expect(siteGround(first(done), T).slope[ty * 96 + tx]).toBe(0);
    expect(first(done).grades).toEqual([{ tile: tileKey(tx, ty), heightM: h }]);
  });

  it("grows a terrace: the next tile levels to the one levelled beside it", () => {
    let s = city();
    // Far from any level ground: the first tile levels to its own height.
    const [ax, ay] = sloped(s, [20, 20], 10).find(([x, y]) => Math.hypot(x - 48, y - 48) > 30 && Math.abs(siteGround(first(s), T).heightM[y * 96 + x]!) > 1)!;
    s = level(s, ax, ay);
    const h = cornersOf(s, ax, ay)[0]!;
    expect(cornersOf(s, ax, ay).every((c) => c === h)).toBe(true);
    expect(h, "vacuity: not at the base").not.toBe(0);
    // Its neighbour, still sloping, levels to it.
    const next = [[ax + 1, ay], [ax, ay + 1], [ax - 1, ay], [ax, ay - 1]].find(([x, y]) => spread(cornersOf(s, x!, y!)) > 0.3)!;
    s = level(s, next[0]!, next[1]!);
    for (const c of cornersOf(s, next[0]!, next[1]!)) expect(c).toBe(h);
  });

  it("lets a building stand without a foundation where the ground was levelled", () => {
    let s = city();
    const [tx, ty] = sloped(s, [48, 48]).find(([x, y]) => [[x + 1, y], [x, y + 1], [x + 1, y + 1]].every(([a, b]) => spread(cornersOf(s, a!, b!)) < 3))!;
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);
    const drop = (st: SimState): number => {
      const v = cityView(first(st), env, T);
      const b = v.buildings[v.buildings.length - 1]!;
      let lowest = Infinity;
      for (let y = b.ty; y <= b.ty + 2; y += 1) for (let x = b.tx; x <= b.tx + 2; x += 1) lowest = Math.min(lowest, v.corners[y * (v.tiles + 1) + x]!);
      return b.baseZ - lowest;
    };
    const before = placeBuilding(s, id(s), "storage_depot", tx, ty, T);
    expect(before.ok, before.reason ?? "").toBe(true);
    expect(drop(before.state), "vacuity: on the slope it needs a foundation").toBeGreaterThan(0.02);
    for (const [x, y] of [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]] as const) if (spread(cornersOf(s, x, y)) > 0) s = level(s, x, y);
    const after = placeBuilding(s, id(s), "storage_depot", tx, ty, T);
    expect(after.ok, after.reason ?? "").toBe(true);
    expect(drop(after.state)).toBe(0);
  });

  it("shows in the picture: the view's ground, and the fine samples it is drawn through, at the level", () => {
    const s = city();
    const [tx, ty] = sloped(s, [48, 48])[0]!;
    const done = level(s, tx, ty);
    const h = first(done).grades[0]!.heightM / T.TILE_METRES;
    const env = habitat(done.reservoirs, derive(done.reservoirs, worldEnv(done, NEUTRAL_ENV, T), T), T, 0);
    const v = cityView(first(done), env, T);
    const w = v.world;
    const f = 2 * w.size + 1;
    for (let j = 0; j <= 2; j += 1) for (let i = 0; i <= 2; i += 1) expect(w.fine![(2 * (ty + w.margin) + j) * f + 2 * (tx + w.margin) + i]).toBe(h);
    expect(v.corners[ty * (v.tiles + 1) + tx]).toBe(h);
  });

  it("breaks the rock on the tile, and brings it back", () => {
    const s = city();
    const rocks = rocksOf(first(s), T);
    const i = rocks.findIndex((r, k) => r === "loose" && Math.hypot((k % 96) - 48, Math.floor(k / 96) - 48) < 30 && spread(cornersOf(s, k % 96, Math.floor(k / 96))) > 0.05);
    expect(i, "vacuity: loose rock on sloping ground near the centre").toBeGreaterThan(0);
    const tx = i % 96;
    const ty = Math.floor(i / 96);
    const done = level(s, tx, ty);
    expect(rocksOf(first(done), T)[i]).toBe("none");
    expect(first(done).stores.materials).toBeGreaterThanOrEqual(100 + T.ROCK_LOOSE_MATERIALS);
  });

  it("is refused under a building, off the land, on level ground, and with every rover out", () => {
    const s = city();
    expect(levelGround(s, id(s), 47, 47, T).reason).toMatch(/building stands there/);
    expect(levelGround(s, id(s), 100, 10, T).reason).toMatch(/off the grid/);
    expect(levelGround(s, id(s), 44, 50, T).reason, "the landing zone").toMatch(/already level/);
    let busy = s;
    const tiles = sloped(s, [48, 48]);
    for (const [x, y] of tiles.slice(0, T.ROVERS_PER_HQ)) busy = levelGround(busy, id(busy), x, y, T).state;
    const [x, y] = tiles[T.ROVERS_PER_HQ]!;
    expect(levelGround(busy, id(busy), x, y, T).reason).toMatch(/rovers are out/);
    expect(levelGround(busy, id(busy), tiles[0]![0], tiles[0]![1], T).reason).toMatch(/already on its way/);
  });

  it("comes out the same however the time is chunked, survives the save mid-job, and moves with a claim", () => {
    const s = city();
    const [tx, ty] = sloped(s, [48, 48])[0]!;
    const sent = levelGround(s, id(s), tx, ty, T).state;
    const steps = Math.ceil(first(sent).jobs[0]!.total / T.SUBSTEP_YEARS) + 2;
    let chunked = sent;
    for (let k = 0; k < steps; k += 1) chunked = advance(chunked, 1, cfg);
    expect(chunked).toEqual(advance(sent, steps, cfg));
    const mid = advance(sent, 2, cfg);
    const reloaded = deserialize(serialize(mid, T, "2026-09-25T00:00:00.000Z"), T);
    expect(reloaded).toEqual(mid);
    expect(advance(reloaded, steps, cfg)).toEqual(advance(mid, steps, cfg));
    // A claim west moves the levelled tile with everything else - onto the same ground.
    // (No domes: the people ran down while the rover worked. Give them back to claim.)
    const done = advance(sent, steps, cfg);
    const peopled = { ...done, settlements: done.settlements.map((c) => ({ ...c, population: 300 })) };
    const west = claimLand(peopled, id(peopled), -1, 0, T);
    expect(west.ok, west.reason ?? "").toBe(true);
    const h = first(done).grades[0]!.heightM;
    expect(first(west.state).grades).toEqual([{ tile: tileKey(tx + 32, ty), heightM: h }]);
    for (const c of cornersOf(west.state, tx + 32, ty)) expect(c).toBe(h);
  });
});
