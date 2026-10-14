/**
 * Batch 28's build queue: "jobs wait for a free rover; the queue is shown,
 * reorderable and cancellable (with a refund); more rover posts mean more
 * builds at once" - and, as everything per substep must be, the same whether
 * the world is advanced a step at a time or all at once.
 */

import { describe, expect, it } from "vitest";

import { advance } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize, toSave, fromSave } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { BuildingType, Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { roverCount } from "./rocks.js";
import { cancelQueuedBuild, constructionOf, housing, moveQueuedBuild, placeBuilding, removeBuilding, upgradeBuilding } from "./settlement.js";
import { tileKey } from "./space.js";

const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, BUILD_TIME_ENABLED: 1, CITY_GRID_TILES: 64 });
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const AT = "2026-10-14T12:00:00.000Z";

function city(materials = 5000, population = 400): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population, stores: { ...c.stores, materials } })) };
}
const first = (s: SimState): Settlement => s.settlements[0]!;
const id = (s: SimState): string => first(s).id;

function place(s: SimState, type: BuildingType, tx: number, ty: number): SimState {
  const o = placeBuilding(s, id(s), type, tx, ty, T);
  expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
  return o.state;
}

/**
 * Every rover out on a depot - one close by, two far, so the first rover is
 * home well before the others - and two more builds waiting: a dome, then a
 * greenhouse. Stores within what the city can hold, so a save keeps them as they are.
 */
const DEPOTS: readonly (readonly [number, number])[] = [
  [26, 31],
  [10, 10],
  [2, 60],
];
function busy(): SimState {
  let s = city(1000, 0);
  for (const [tx, ty] of DEPOTS) s = place(s, "storage_depot", tx, ty);
  s = place(s, "habitat_dome", 10, 30);
  s = place(s, "greenhouse", 10, 40);
  return s;
}

/** Substeps until the building at (tx, ty) has a rover at work on it. */
function startsAfter(s: SimState, tx: number, ty: number, limit = 400): number {
  let w = s;
  for (let k = 1; k <= limit; k += 1) {
    w = advance(w, 1, cfg);
    if (first(w).jobs.some((j) => j.kind === "build" && j.tile === tileKey(tx, ty))) return k;
  }
  throw new Error(`no rover ever went to ${tx},${ty}`);
}

describe("the build queue (Batch 28)", () => {
  it("holds what no rover is free for - paid for, a worksite that does not run - and sends a rover when one comes home", () => {
    const s = busy();
    const c = first(s);
    expect(c.jobs).toHaveLength(T.ROVERS_PER_HQ);
    expect(c.buildQueue.map((q) => q.tile)).toEqual([tileKey(10, 30), tileKey(10, 40)]);
    expect(c.stores.materials).toBe(1000 - 3 * T.COST_STORAGE_DEPOT - T.COST_HABITAT_DOME - T.COST_GREENHOUSE);
    // A dome waiting for its rover houses nobody yet.
    expect(constructionOf(c).get(tileKey(10, 30))).toBe(0);
    expect(housing(c, T)).toBe(0);
    // The first depot's rover home, the dome is next - and the greenhouse after it.
    const dome = startsAfter(s, 10, 30);
    const greenhouse = startsAfter(s, 10, 40);
    expect(greenhouse).toBeGreaterThan(dome);
  });

  it("never sends more rovers than the city has", () => {
    let s = busy();
    for (let k = 0; k < 200; k += 1) {
      s = advance(s, 1, cfg);
      expect(first(s).jobs.filter((j) => j.kind === "build" || j.kind === "rover").length).toBeLessThanOrEqual(roverCount(first(s), T));
    }
  });

  it("is reorderable: moved to the front, the greenhouse goes before the dome", () => {
    const s = busy();
    const moved = moveQueuedBuild(s, id(s), 1, 0);
    expect(moved.ok).toBe(true);
    expect(startsAfter(moved.state, 10, 40)).toBeLessThan(startsAfter(moved.state, 10, 30));
    expect(moveQueuedBuild(s, id(s), 5, 0).ok).toBe(false);
  });

  it("is cancellable with the whole cost back: a new building's worksite goes, an upgrade leaves the building as it was", () => {
    const s = busy();
    const before = first(s).stores.materials;
    const gone = cancelQueuedBuild(s, id(s), 0);
    expect(gone.ok).toBe(true);
    expect(first(gone.state).stores.materials).toBe(before + T.COST_HABITAT_DOME);
    expect(first(gone.state).buildings.some((b) => b.type === "habitat_dome")).toBe(false);
    expect(first(gone.state).buildQueue.map((q) => q.tile)).toEqual([tileKey(10, 40)]);

    // An upgrade waiting: the solar array stands, every rover is out, its upgrade queues.
    let u = city();
    u = place(u, "solar_array", 40, 40);
    for (let k = 0; k < 200 && first(u).jobs.length > 0; k += 1) u = advance(u, 1, cfg);
    for (let k = 0; k < T.ROVERS_PER_HQ; k += 1) u = place(u, "storage_depot", 10 + 3 * k, 10);
    const up = upgradeBuilding(u, id(u), 40, 40, T);
    expect(up.ok).toBe(true);
    expect(first(up.state).buildQueue).toEqual([{ tile: tileKey(40, 40), upgrade: true, paid: T.COST_SOLAR_ARRAY }]);
    const back = cancelQueuedBuild(up.state, id(u), 0);
    expect(first(back.state).buildings.find((b) => b.tx === 40 && b.ty === 40)).toEqual({ type: "solar_array", tx: 40, ty: 40, level: 1 });
    expect(first(back.state).stores.materials).toBe(first(u).stores.materials);
  });

  it("refunds a waiting worksite that is removed - it never started - but not one a rover is building", () => {
    const s = busy();
    const before = first(s).stores.materials;
    expect(first(removeBuilding(s, id(s), 10, 30).state).stores.materials).toBe(before + T.COST_HABITAT_DOME);
    expect(first(removeBuilding(s, id(s), 26, 31).state).stores.materials).toBe(before);
  });

  it("builds more at once with more rover posts", () => {
    // Build a Rover Post, wait for it to stand, then queue more depots than the headquarters' rovers.
    const runningAt = (posts: number): number => {
      let s = city(20_000, 1000);
      for (let p = 0; p < posts; p += 1) s = place(s, "rover_post", 2 + 6 * p, 50);
      for (let k = 0; k < 400 && first(s).jobs.length > 0; k += 1) s = advance(s, 1, cfg);
      for (let k = 0; k < 8; k += 1) s = place(s, "storage_depot", 4 + 3 * k, 20);
      return first(s).jobs.filter((j) => j.kind === "build").length;
    };
    expect(runningAt(0)).toBe(T.ROVERS_PER_HQ);
    expect(runningAt(2)).toBe(T.ROVERS_PER_HQ + 2);
  });

  it("sends a waiting upgrade with its own level's time on the curve, not the first build's", () => {
    const C = makeTuning({ ...T, BUILD_CURVE_ENABLED: 1 });
    let s = city();
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: [...c.buildings, { type: "reactor" as const, tx: 44, ty: 44, level: 3 }] })) };
    for (const [tx, ty] of DEPOTS) s = placeBuilding(s, id(s), "storage_depot", tx, ty, C).state;
    s = upgradeBuilding(s, id(s), 44, 44, C).state;
    expect(first(s).buildQueue).toHaveLength(1);
    for (let k = 0; k < 400 && first(s).buildQueue.length > 0; k += 1) s = advance(s, 1, { tuning: C, env: NEUTRAL_ENV, forcing: null });
    const job = first(s).jobs.find((j) => j.kind === "build" && j.tile === tileKey(44, 44));
    if (job === undefined || job.kind !== "build") throw new Error("no rover went to the reactor");
    // Level 4 on the plan's curve: BASE x GROWTH^3 real seconds, in the city's years.
    const seconds = job.work / (C.TIME_SCALE * C.CITY_CLOCK);
    expect(seconds).toBeCloseTo(C.BUILD_SECONDS_REACTOR * C.BUILD_GROWTH_MEDIUM ** 3, 6);
  });

  it("is chunk-independent: a step at a time equals all at once, exactly", () => {
    const s = busy();
    let stepped = s;
    for (let k = 0; k < 120; k += 1) stepped = advance(stepped, 1, cfg);
    expect(advance(s, 120, cfg)).toEqual(stepped);
    // Not vacuous: the queue emptied over those steps.
    expect(first(stepped).buildQueue).toHaveLength(0);
  });

  it("survives the save exactly, and a save from before it (v13) loads with nothing waiting", () => {
    const s = busy();
    expect(deserialize(serialize(s, T, AT), T)).toEqual(s);
    const v13 = toSave(s, T, AT) as unknown as Record<string, unknown>;
    const old = {
      ...v13,
      schema_version: 13,
      settlements: (v13["settlements"] as Record<string, unknown>[]).map((raw) => {
        const { build_queue: _q, ...rest } = raw;
        void _q;
        return rest;
      }),
    };
    const loaded = fromSave(old, T);
    expect(first(loaded).buildQueue).toEqual([]);
    expect(first(loaded).buildings).toEqual(first(s).buildings);
  });
});
