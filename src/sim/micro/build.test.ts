/**
 * Build times, levels and redundant links (at the user's request):
 *
 *   "each structure has a build time, smaller structures have a smaller
 *    build time (mines 1m, hab domes 5m), where 10m is 1y ... building takes
 *    1 rover, rover posts are the only structure that despite being big has
 *    a small build time. When a structure is being built, there is just the
 *    foundation and some worksite equipment."
 *   "hab dome goes up to level 5, mines to level 10, everything else to
 *    level 8, every level adds +10% (incremental: 100, 110, 121...)."
 *   "a redundancy connection button next to connect all, where each
 *    structure is connected to two structures - two that are NOT the same,
 *    if possible."
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import type { HabitatChannels } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import { ownerGrid, linkGrid } from "./network.js";
import { foundSettlement } from "./registry.js";
import { connectTwice, constructionOf, housing, placeBuilding, placeLink, removeBuilding, sendRover, settlementStep, upgradeBuilding } from "./settlement.js";
import { keyTile, tileKey } from "./space.js";
import { rocksOf } from "./rocks.js";

// Flat ground: what is tested is time and levels, not where things fit.
const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, BUILD_TIME_ENABLED: 1, CITY_GRID_TILES: 64 });
const INSTANT = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, CITY_GRID_TILES: 64 });

function city(t: Tuning = T, materials = 5000): SimState {
  const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 400, stores: { ...c.stores, materials } })) };
}
const first = (s: SimState): Settlement => s.settlements[0]!;
const id = (s: SimState): string => first(s).id;
const cfg = (t: Tuning) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });

function place(s: SimState, type: BuildingType, tx: number, ty: number, t: Tuning = T): SimState {
  const o = placeBuilding(s, id(s), type, tx, ty, t);
  expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
  return o.state;
}

/** The planet as the city sees it. */
function envOf(s: SimState, t: Tuning): HabitatChannels {
  return habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t, 0);
}

/** Whether the building at (tx, ty) ran this substep. */
function runs(s: SimState, tx: number, ty: number, t: Tuning = T): boolean {
  const st = first(s);
  const i = st.buildings.findIndex((b) => b.tx === tx && b.ty === ty);
  return settlementStep(st, envOf(s, t), t, t.SUBSTEP_YEARS).operable[i] === true;
}

/** Sim-years until the building at (tx, ty) stands: its rover's drive out and its work. */
function standsAfter(s: SimState, tx: number, ty: number): number {
  const job = first(s).jobs.find((j) => j.kind === "build" && j.tile === tileKey(tx, ty));
  if (job === undefined || job.kind !== "build") throw new Error(`no build job at ${tx},${ty}`);
  return job.total - (job.total - job.work) / 2;
}

describe("build times", () => {
  it("a mine goes up in a month, a dome in five - ten months a year - and neither runs, houses or stores till then", () => {
    let s = city();
    // Two tiles apart, the same drive from the headquarters.
    s = place(s, "solar_array", 20, 40);
    s = place(s, "habitat_dome", 40, 20);
    const mine = standsAfter(s, 20, 40);
    const dome = standsAfter(s, 40, 20);
    // The work at the site: 0.1 and 0.5 sim-years (the rest is the drive).
    const jobs = first(s).jobs.filter((j) => j.kind === "build");
    expect(jobs.map((j) => (j.kind === "build" ? j.work : 0))).toEqual([T.BUILD_YEARS_SOLAR_ARRAY, T.BUILD_YEARS_HABITAT_DOME]);
    expect(T.BUILD_YEARS_REGOLITH_MINE).toBe(0.1);
    expect(T.BUILD_YEARS_HABITAT_DOME).toBe(0.5);
    expect(housing(first(s), T)).toBe(0);
    expect(runs(s, 20, 40)).toBe(false);
    // Jobs count down a substep (a quarter year) at a time: each is done at the first substep boundary after its time.
    const step = (years: number): number => Math.ceil(years / T.SUBSTEP_YEARS - 1e-9);
    const early = advance(s, step(mine) - 1, cfg(T));
    expect(runs(early, 20, 40), "the solar array before its work is done").toBe(false);
    const upMine = advance(s, step(mine), cfg(T));
    expect(step(dome), "vacuity: the dome's time is a later substep").toBeGreaterThan(step(mine));
    expect(runs(upMine, 20, 40), "the solar array once its rover has done the work").toBe(true);
    expect(housing(first(upMine), T), "the dome still going up").toBe(0);
    const upDome = advance(s, step(dome), cfg(T));
    expect(housing(first(upDome), T)).toBe(T.DOME_HOUSING);
    expect(dome - mine).toBeCloseTo(T.BUILD_YEARS_HABITAT_DOME - T.BUILD_YEARS_SOLAR_ARRAY, 1);
  });

  it("takes a rover: with every rover out, nothing more can be built", () => {
    let s = city();
    const rovers = T.ROVERS_PER_HQ;
    for (let k = 0; k < rovers; k += 1) s = place(s, "storage_depot", 10 + 3 * k, 10);
    expect(first(s).jobs).toHaveLength(rovers);
    expect(placeBuilding(s, id(s), "storage_depot", 30, 10, T).reason).toMatch(/rovers are out/);
    const rock = rocksOf(first(s), T).findIndex((r) => r !== "none");
    if (rock >= 0) expect(sendRover(s, id(s), rock % 64, Math.floor(rock / 64), T).reason).toMatch(/rovers are out/);
    // Removing a building still going up calls its rover home.
    const freed = removeBuilding(s, id(s), 10, 10);
    expect(freed.ok).toBe(true);
    expect(first(freed.state).jobs).toHaveLength(rovers - 1);
    expect(placeBuilding(freed.state, id(s), "storage_depot", 30, 10, T).ok).toBe(true);
  });

  it("gives the Rover Post, a 5 x 5, the short time of the smallest buildings", () => {
    let s = city();
    s = place(s, "rover_post", 10, 30);
    s = place(s, "spaceport", 30, 10);
    const [post, port] = first(s).jobs.map((j) => (j.kind === "build" ? j.work : 0));
    expect(post).toBeLessThanOrEqual(T.BUILD_YEARS_REGOLITH_MINE);
    expect(port).toBeGreaterThan(post! * 3);
  });

  it("builds at once with build times off, as every calibrated test assumes", () => {
    let s = city(INSTANT);
    s = place(s, "solar_array", 20, 40, INSTANT);
    expect(first(s).jobs).toHaveLength(0);
    expect(runs(s, 20, 40, INSTANT)).toBe(true);
  });

  it("is the same however time is chunked, and a save mid-build carries on exactly", () => {
    let s = city();
    s = place(s, "habitat_dome", 40, 20);
    const steps = Math.ceil(first(s).jobs[0]!.total / T.SUBSTEP_YEARS) + 2;
    let chunked = s;
    for (let k = 0; k < steps; k += 1) chunked = advance(chunked, 1, cfg(T));
    expect(chunked).toEqual(advance(s, steps, cfg(T)));
    const mid = advance(s, 1, cfg(T));
    expect(constructionOf(first(mid)).size).toBe(1);
    const back = deserialize(serialize(mid, T, "2026-09-25T00:00:00.000Z"), T);
    expect(back).toEqual(mid);
    expect(advance(back, steps, cfg(T))).toEqual(advance(mid, steps, cfg(T)));
  });
});

describe("levels", () => {
  it("adds 10% a level, compounding: 100, 110, 121", () => {
    let s = city(INSTANT);
    s = place(s, "solar_array", 20, 40, INSTANT);
    const power = (st: SimState): number => settlementStep(first(st), envOf(st, INSTANT), INSTANT, INSTANT.SUBSTEP_YEARS).production.power;
    // The array's own share: the city's power with it, less without it.
    const others = power({ ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type !== "solar_array") })) });
    const base = power(s) - others;
    expect(base, "vacuity: the array makes power").toBeGreaterThan(0);
    const at = (st: SimState): number => power(st) - others;
    const u = upgradeBuilding(s, id(s), 20, 40, INSTANT);
    expect(u.ok, u.reason ?? "").toBe(true);
    s = u.state;
    expect(at(s) / base).toBeCloseTo(1.1, 10);
    s = upgradeBuilding(s, id(s), 20, 40, INSTANT).state;
    expect(at(s) / base).toBeCloseTo(1.21, 10);
    expect(first(s).buildings.find((b) => b.type === "solar_array")!.level).toBe(3);
  });

  it("houses 10% more a level, and costs the building's price", () => {
    let s = city(INSTANT, 1000);
    s = place(s, "habitat_dome", 40, 20, INSTANT);
    const before = first(s).stores.materials;
    s = upgradeBuilding(s, id(s), 41, 21, INSTANT).state;
    expect(housing(first(s), INSTANT)).toBeCloseTo(INSTANT.DOME_HOUSING * 1.1, 10);
    expect(first(s).stores.materials).toBe(before - BUILDING_DEFS.habitat_dome.cost(INSTANT));
  });

  it("stops at 5 for a dome, 10 for a mine, 8 for anything else", () => {
    for (const [type, top] of [["habitat_dome", 5], ["regolith_mine", 10], ["greenhouse", 8], ["rover_post", 8]] as const) {
      let s = city(INSTANT, 1e6);
      s = place(s, type, 20, 20, INSTANT);
      for (let k = 1; k < top; k += 1) {
        const o = upgradeBuilding(s, id(s), 20, 20, INSTANT);
        expect(o.ok, `${type} to ${k + 1}: ${o.reason}`).toBe(true);
        s = o.state;
      }
      expect(upgradeBuilding(s, id(s), 20, 20, INSTANT).reason, type).toMatch(new RegExp(`highest level \\(${top}\\)`));
    }
    expect(upgradeBuilding(city(INSTANT), id(city(INSTANT)), 32, 32, INSTANT).reason).toMatch(/cannot be upgraded/);
  });

  it("with build times, takes a rover and comes when it is home - the building running meanwhile", () => {
    let s = city();
    s = place(s, "solar_array", 20, 40);
    s = advance(s, Math.ceil(first(s).jobs[0]!.total / T.SUBSTEP_YEARS) + 1, cfg(T));
    const up = upgradeBuilding(s, id(s), 20, 40, T);
    expect(up.ok, up.reason ?? "").toBe(true);
    expect(first(up.state).buildings.find((b) => b.type === "solar_array")!.level).toBe(1);
    expect(runs(up.state, 20, 40), "an upgrade does not stop it").toBe(true);
    expect(upgradeBuilding(up.state, id(s), 20, 40, T).reason).toMatch(/already being upgraded/);
    const done = advance(up.state, Math.ceil(first(up.state).jobs[0]!.total / T.SUBSTEP_YEARS) + 1, cfg(T));
    expect(first(done).buildings.find((b) => b.type === "solar_array")!.level).toBe(2);
  });
});

/**
 * The buildings each building has a route of its own to: along its links
 * from its footprint, never through another building, to a building its
 * links (or its walls) touch. Independent of the code that laid them.
 */
function routes(s: Settlement, layer: "corridors" | "cables", n: number): Set<number>[] {
  const owner = ownerGrid(s.buildings, n);
  const road = linkGrid(s[layer], n);
  return s.buildings.map((b, self) => {
    const size = BUILDING_DEFS[b.type].footprint;
    const seen = new Uint8Array(n * n);
    const stack: number[] = [];
    for (let y = b.ty; y < b.ty + size; y += 1) for (let x = b.tx; x < b.tx + size; x += 1) stack.push(y * n + x);
    const found = new Set<number>();
    while (stack.length > 0) {
      const tile = stack.pop()!;
      if (seen[tile]) continue;
      seen[tile] = 1;
      const x = tile % n;
      const y = (tile - x) / n;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const o = owner[ny * n + nx]!;
        if (o >= 0 && o !== self) found.add(o);
        else if (o < 0 && road[ny * n + nx]) stack.push(ny * n + nx);
      }
    }
    return found;
  });
}

describe("connect twice", () => {
  it("gives every building its own routes to two different buildings, by corridor and by cable, all layable by hand", () => {
    let s = city(INSTANT);
    for (const [type, x, y] of [["solar_array", 8, 8], ["regolith_mine", 50, 10], ["storage_depot", 12, 52], ["greenhouse", 52, 50], ["water_extractor", 30, 12]] as const) s = place(s, type, x, y, INSTANT);
    const before = routes(first(s), "corridors", 64);
    expect(before.some((r) => r.size < 2), "vacuity: some building lacks two routes").toBe(true);
    const o = connectTwice(s, id(s), INSTANT);
    expect(o.ok, o.reason ?? "").toBe(true);
    for (const layer of ["corridors", "cables"] as const) {
      routes(first(o.state), layer, 64).forEach((r, i) => expect(r.size, `${layer}: ${first(o.state).buildings[i]!.type}`).toBeGreaterThanOrEqual(2));
      let replay: SimState = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1e9 } })) };
      for (const key of first(o.state)[layer].filter((k) => !first(s)[layer].includes(k))) {
        const { tx, ty } = keyTile(key);
        const r = placeLink(replay, id(s), layer, tx, ty, INSTANT);
        expect(r.ok, `${layer} at ${tx},${ty}: ${r.reason}`).toBe(true);
        replay = r.state;
      }
    }
    expect(connectTwice(o.state, id(s), INSTANT).reason).toMatch(/already has its two routes/);
  });

  it("with only one other building to reach, joins to that one", () => {
    let s = city(INSTANT);
    // The headquarters and the spaceport it landed with share a wall; one mine far off.
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type === "headquarters") })) };
    s = place(s, "storage_depot", 8, 8, INSTANT);
    const o = connectTwice(s, id(s), INSTANT);
    expect(o.ok).toBe(true);
    for (const r of routes(first(o.state), "corridors", 64)) expect(r.size).toBe(1);
  });
});
