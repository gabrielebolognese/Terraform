/**
 * The headquarters, rovers and rockets (at the user's request):
 *
 *   "a headquarter structure, you can't place it, it's always at the center
 *    of the city, 5x5 ... the first structure, and it's where the rovers
 *    start. Also when I create a city ... there is also ONE spaceport."
 *   "The headquarters don't consume power but create +5 oxygen and +3 water."
 *   "Select tiles with rocks, or tiles with mountains where I can't place
 *    things, and send a rover to break the rocks; the normal rocks give 1
 *    material, the big ones 5; it takes time depending on how far the rover
 *    is from the city."
 *   "Send a rocket ... to get back 20 material (or if there is 140/150, just
 *    10) ... it takes one minute."
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, fromSave, serialize, toSave } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { rocksOf, siteGround } from "./rocks.js";
import { capacities, launchRocket, placeBuilding, removeBuilding, sendRover, settlementStep } from "./settlement.js";
import { gridTiles } from "./space.js";

const HQ = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const cfg = { tuning: HQ, env: NEUTRAL_ENV, forcing: null };

const city = (t: Tuning = HQ): SimState => foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
const id = (s: SimState): string => s.settlements[0]!.id;
const materials = (s: SimState): number => s.settlements[0]!.stores.materials;
const withMaterials = (s: SimState, m: number): SimState => ({ ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: m } })) });

/** The nearest rock of a kind to the headquarters, and the furthest. */
function rocks(s: SimState, kind: "loose" | "crag"): { near: [number, number]; far: [number, number] } {
  const n = gridTiles("city", HQ);
  const all = rocksOf(s.settlements[0]!, HQ)
    .map((r, i) => [r, i % n, Math.floor(i / n)] as const)
    .filter(([r]) => r === kind)
    .map(([, x, y]) => [x, y] as [number, number])
    .sort((a, b) => Math.hypot(a[0] - 16, a[1] - 16) - Math.hypot(b[0] - 16, b[1] - 16));
  expect(all.length, `this site must have ${kind} rocks`).toBeGreaterThan(1);
  return { near: all[0]!, far: all[all.length - 1]! };
}

describe("the headquarters", () => {
  it("is the first structure, 5 x 5 at the centre, and a city also lands with one spaceport", () => {
    const b = city().settlements[0]!.buildings;
    expect(b[0]).toEqual({ type: "headquarters", tx: 14, ty: 14, level: 1 });
    // Its middle is the grid's middle.
    expect(b[0]!.tx + 2.5).toBe(gridTiles("city", HQ) / 2 + 0.5);
    expect(b.filter((x) => x.type === "spaceport")).toHaveLength(1);
    expect(b).toHaveLength(2);
    // An outpost lands with the headquarters only.
    const outpost = foundSettlement(marsStart(undefined, HQ), "outpost", 0.31, -1.2, HQ).state.settlements[0]!;
    expect(outpost.buildings.map((x) => x.type)).toEqual(["headquarters"]);
  });

  it("stays off without its switch: nothing is founded but the settlement", () => {
    const off = makeTuning({ SETTLEMENTS_ENABLED: 1 });
    expect(city(off).settlements[0]!.buildings).toEqual([]);
  });

  it("cannot be placed, and cannot be removed", () => {
    const s = withMaterials(city(), 1000);
    expect(placeBuilding(s, id(s), "headquarters", 2, 2, HQ).reason).toMatch(/founded with the settlement, never built/);
    expect(removeBuilding(s, id(s), 16, 16).reason).toMatch(/Headquarters cannot be removed/);
    // The spaceport it landed with can.
    expect(removeBuilding(s, id(s), 20, 16).ok).toBe(true);
  });

  it("makes 5 oxygen and 3 water a year, and draws no power", () => {
    const s = city();
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, HQ), HQ), HQ, 0);
    const step = settlementStep(s.settlements[0]!, env, HQ, HQ.SUBSTEP_YEARS);
    expect(step.operable[0]).toBe(true);
    // The spaceport has no power yet, so the headquarters' output is all there is.
    expect(step.operable[1]).toBe(false);
    expect(step.production.oxygen).toBe(5);
    expect(step.production.water).toBe(3);
    expect(step.consumption.power).toBe(0);
  });
});

describe("rovers", () => {
  it("break loose rocks for 1 material and crags for 5, and the rock is gone", () => {
    for (const [kind, gain] of [["loose", 1], ["crag", 5]] as const) {
      const s0 = withMaterials(city(), 100);
      const [tx, ty] = rocks(s0, kind).near;
      const sent = sendRover(s0, id(s0), tx, ty, HQ);
      expect(sent.ok, sent.reason ?? "").toBe(true);
      const job = sent.state.settlements[0]!.jobs[0]!;
      // Long enough to see it through, and nothing else touching materials: no mine, no powered port.
      const done = advance(sent.state, Math.ceil(job.total / HQ.SUBSTEP_YEARS), cfg);
      expect(materials(done) - materials(sent.state), kind).toBeCloseTo(gain, 9);
      expect(done.settlements[0]!.jobs).toEqual([]);
      expect(rocksOf(done.settlements[0]!, HQ)[ty * 32 + tx], kind).toBe("none");
    }
  });

  it("take longer the further the rock is from the headquarters", () => {
    const s0 = city();
    const { near, far } = rocks(s0, "loose");
    const years = (at: [number, number]): number => sendRover(s0, id(s0), at[0], at[1], HQ).state.settlements[0]!.jobs[0]!.total;
    expect(years(far)).toBeGreaterThan(years(near));
  });

  it("bring nothing home before they are back", () => {
    const s0 = withMaterials(city(), 100);
    const [tx, ty] = rocks(s0, "crag").near;
    const sent = sendRover(s0, id(s0), tx, ty, HQ).state;
    const total = sent.settlements[0]!.jobs[0]!.total;
    const early = advance(sent, Math.floor(total / HQ.SUBSTEP_YEARS) - 1, cfg);
    expect(materials(early)).toBe(materials(sent));
    expect(early.settlements[0]!.jobs).toHaveLength(1);
  });

  it("leave a broken crag as ground a building can stand on", () => {
    const s0 = withMaterials(city(), 1000);
    const [tx, ty] = rocks(s0, "crag").near;
    expect(placeBuilding(s0, id(s0), "storage_depot", tx, ty, HQ).reason).toMatch(/too steep/);
    const sent = sendRover(s0, id(s0), tx, ty, HQ).state;
    const done = advance(sent, Math.ceil(sent.settlements[0]!.jobs[0]!.total / HQ.SUBSTEP_YEARS), cfg);
    expect(siteGround(done.settlements[0]!, HQ).steep[ty * 32 + tx]).toBe(false);
    expect(placeBuilding(done, id(done), "storage_depot", tx, ty, HQ).ok).toBe(true);
  });

  it("number three: a fourth job waits for one to come back", () => {
    const s0 = city();
    const n = gridTiles("city", HQ);
    const loose = rocksOf(s0.settlements[0]!, HQ).flatMap((r, i) => (r === "loose" ? [[i % n, Math.floor(i / n)] as const] : [])).slice(0, 4);
    let s = s0;
    for (const [x, y] of loose.slice(0, 3)) s = sendRover(s, id(s), x, y, HQ).state;
    expect(s.settlements[0]!.jobs).toHaveLength(HQ.ROVERS_PER_HQ);
    const fourth = sendRover(s, id(s), loose[3]![0], loose[3]![1], HQ);
    expect(fourth.ok).toBe(false);
    expect(fourth.reason).toMatch(/all 3 rovers are out/);
  });

  it("refuse what cannot be done, changing nothing", () => {
    const s = city();
    const [tx, ty] = rocks(s, "loose").near;
    const once = sendRover(s, id(s), tx, ty, HQ).state;
    expect(sendRover(once, id(once), tx, ty, HQ).reason).toMatch(/already on its way/);
    // The headquarters' own tile has no rock.
    expect(sendRover(s, id(s), 16, 16, HQ).reason).toMatch(/no rock there/);
    const noHq = foundSettlement(marsStart(), "city", 0.31, -1.2, makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 })).state;
    expect(sendRover(noHq, id(noHq), tx, ty, HQ).reason).toMatch(/no headquarters/);
  });
});

describe("rockets", () => {
  const port = (s: SimState): [number, number] => {
    const p = s.settlements[0]!.buildings.find((b) => b.type === "spaceport")!;
    return [p.tx + 1, p.ty + 1];
  };

  it("come back after one real minute at 1x with 20 materials, and not before", () => {
    const s0 = withMaterials(city(), 100);
    const launched = launchRocket(s0, id(s0), ...port(s0), HQ);
    expect(launched.ok, launched.reason ?? "").toBe(true);
    // One minute at 1x: 60 s x TIME_SCALE sim-years a second.
    expect(HQ.ROCKET_TRIP_YEARS).toBeCloseTo(60 * HQ.TIME_SCALE, 12);
    const steps = Math.ceil(HQ.ROCKET_TRIP_YEARS / HQ.SUBSTEP_YEARS);
    expect(materials(advance(launched.state, steps - 1, cfg))).toBe(100);
    expect(materials(advance(launched.state, steps, cfg))).toBe(120);
  });

  it("bring only what fits: 140 of 150 takes 10", () => {
    const s0 = city();
    const cap = capacities(s0.settlements[0]!, HQ).materials;
    const nearlyFull = withMaterials(s0, cap - 10);
    const launched = launchRocket(nearlyFull, id(nearlyFull), ...port(nearlyFull), HQ).state;
    expect(materials(advance(launched, Math.ceil(HQ.ROCKET_TRIP_YEARS / HQ.SUBSTEP_YEARS), cfg))).toBe(cap);
    // Full stores: nothing to fetch.
    const full = withMaterials(s0, cap);
    expect(launchRocket(full, id(full), ...port(full), HQ).reason).toMatch(/stores are full/);
  });

  it("fly one at a time from each spaceport, and need a spaceport - but no power", () => {
    const s0 = withMaterials(city(), 100);
    // The founding spaceport has no power yet, and launches anyway: rockets carry their own fuel.
    const env = habitat(s0.reservoirs, derive(s0.reservoirs, worldEnv(s0, NEUTRAL_ENV, HQ), HQ), HQ, 0);
    expect(settlementStep(s0.settlements[0]!, env, HQ, HQ.SUBSTEP_YEARS).operable[1]).toBe(false);
    const once = launchRocket(s0, id(s0), ...port(s0), HQ).state;
    expect(launchRocket(once, id(once), ...port(once), HQ).reason).toMatch(/already away/);
    expect(launchRocket(s0, id(s0), 2, 2, HQ).reason).toMatch(/no spaceport there/);
  });
});

describe("jobs in time and in the save", () => {
  const busy = (): SimState => {
    let s = withMaterials(city(), 100);
    const [tx, ty] = rocks(s, "crag").far;
    s = sendRover(s, id(s), tx, ty, HQ).state;
    const p = s.settlements[0]!.buildings.find((b) => b.type === "spaceport")!;
    return launchRocket(s, id(s), p.tx, p.ty, HQ).state;
  };

  it("are chunk-independent: advance(s, 12) is twelve advance(s, 1)", () => {
    let chunked = busy();
    for (let i = 0; i < 12; i += 1) chunked = advance(chunked, 1, cfg);
    expect(chunked).toEqual(advance(busy(), 12, cfg));
  });

  it("survive the save exactly, mid-trip", () => {
    const mid = advance(busy(), 3, cfg);
    expect(mid.settlements[0]!.jobs).toHaveLength(2);
    expect(deserialize(serialize(mid, HQ, "2026-09-24T12:00:00.000Z"), HQ)).toEqual(mid);
  });

  it("give a settlement from before the headquarters one at its centre, where the ground is free", () => {
    const old = foundSettlement(marsStart(undefined, HQ), "city", 0.31, -1.2, makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 })).state;
    expect(old.settlements[0]!.buildings).toEqual([]);
    const loaded = fromSave(toSave(old, HQ, "2026-09-24T12:00:00.000Z"), HQ);
    expect(loaded.settlements[0]!.buildings).toEqual([{ type: "headquarters", tx: 14, ty: 14, level: 1 }]);
  });

  it("put it on the nearest free ground when the player built at the centre", () => {
    const off = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    let old = withMaterials(foundSettlement(marsStart(undefined, HQ), "city", 0.31, -1.2, off).state, 1000);
    old = placeBuilding(old, id(old), "storage_depot", 16, 16, off).state;
    const loaded = fromSave(toSave(old, HQ, "2026-09-24T12:00:00.000Z"), HQ).settlements[0]!;
    const hq = loaded.buildings.find((b) => b.type === "headquarters")!;
    // Clear of the depot, and as near the centre as that allows: every
    // origin within two tiles of the centre's (14, 14) spans 16, 16 - the
    // first clear one is three out.
    expect(hq.tx > 16 || hq.ty > 16 || hq.tx + 5 <= 16 || hq.ty + 5 <= 16).toBe(true);
    expect(Math.max(Math.abs(hq.tx - 14), Math.abs(hq.ty - 14))).toBe(3);
  });

  it("refuse a job that cannot be, naming it", () => {
    const save = toSave(busy(), HQ, "2026-09-24T12:00:00.000Z") as unknown as Record<string, unknown>;
    const withJob = (patch: Record<string, unknown>): unknown => ({
      ...save,
      settlements: (save["settlements"] as Record<string, unknown>[]).map((c) => ({ ...c, jobs: [{ ...(c["jobs"] as Record<string, unknown>[])[0], ...patch }] })),
    });
    expect(() => fromSave(withJob({ remaining: 0 }), HQ)).toThrow(/settlements\[0\]\.jobs\[0\] has 0 of/);
    expect(() => fromSave(withJob({ kind: "drone" }), HQ)).toThrow(/jobs\[0\]\.kind must be "rover" or "rocket"/);
    expect(() => fromSave(withJob({ materials: -1 }), HQ)).toThrow(/materials is negative/);
  });
});

