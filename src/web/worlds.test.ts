/**
 * Batch 27's exit gate, the storage half: worlds kept apart, the old save
 * carried in, the same seed the same world, a world round-tripped through a
 * file, and a broken world listed - never deleted, never in the way.
 */

import { describe, expect, it } from "vitest";

import type { SimState, Tuning } from "../sim/index.js";
import { NEUTRAL_ENV, advance, buildFacility, foundSettlement, makeTuning, marsStart, siteElevation, toSave } from "../sim/index.js";
import { REFERENCE_POLICY, applyOrdersDue } from "../harness/policy.js";
import { boot } from "./session.js";
import { MemorySaveStore } from "./storage.js";
import { BROWSER_OVERRIDES, BROWSER_TUNING, MODE_OVERRIDES, NEW_WORLD_OVERRIDES, PACE_OVERRIDES } from "./game-tuning.js";
import type { NewWorld } from "./worlds.js";
import { LEGACY_NAME, LEGACY_SLOT, WorldLibrary, parseSeed } from "./worlds.js";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");
const HOUR = 3_600_000;
/** Measured: neighbouring seeds move 59-60 of these 60 places by more than 100 m (four pairs tried). */
const GROUND_LEAST = 45;

function clock(start = T0): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

/** A world played before Batch 27: the browser's tuning, a settlement, a lever ordered. */
function playedBeforeWorlds(): SimState {
  let s = marsStart(123456, BROWSER_TUNING);
  s = buildFacility(s, "orbital_mirror", 6, 1, BROWSER_TUNING);
  s = foundSettlement(s, "city", 0.31, 1.2, BROWSER_TUNING, "First light").state;
  return advance(s, 40, { tuning: BROWSER_TUNING, env: NEUTRAL_ENV, forcing: null });
}

/** The reference playthrough for `years`, under a world's own tuning. */
function play(state: SimState, t: Tuning, years: number): SimState {
  const applied = new Set<number>();
  const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };
  let s = state;
  for (let year = 0; year < years; year += t.SUBSTEP_YEARS * 8) {
    s = applyOrdersDue(s, REFERENCE_POLICY, year, applied, t);
    s = advance(s, 8, cfg);
  }
  return s;
}

async function loaded(lib: WorldLibrary, id: string): Promise<{ state: SimState; tuning: Tuning }> {
  const r = await lib.load(id);
  if (!r.ok) throw new Error(`world ${id} did not load: ${r.reason}`);
  return { state: r.state, tuning: r.tuning };
}

describe("the save from before worlds", () => {
  it('opens as a world called "My planet", identical to loading it the old way', async () => {
    const store = new MemorySaveStore();
    const c = clock();
    await store.save(LEGACY_SLOT, toSave(playedBeforeWorlds(), BROWSER_TUNING, new Date(c.now()).toISOString()));
    c.advance(3 * HOUR);

    const old = await boot(store, { tuning: BROWSER_TUNING, env: NEUTRAL_ENV, forcing: null }, c.now, LEGACY_SLOT);
    expect(old.origin).toBe("resumed");

    const lib = new WorldLibrary(store, c.now);
    await lib.open();
    expect(lib.worlds.map((w) => w.name)).toEqual([LEGACY_NAME]);
    const mine = lib.worlds[0]!;
    expect(mine.slot, "carried in place, not copied").toBe(LEGACY_SLOT);
    expect(lib.last?.id).toBe(mine.id);
    const now = await loaded(lib, mine.id);
    expect(now.state).toEqual(old.state);
    expect(now.tuning).toEqual(BROWSER_TUNING);
    // Played before real build times: a Classic world, and it stays one (Batch 28).
    expect(mine.pace).toBe("classic");
  });

  it("is carried in once: a second launch reads the index and finds the same one world", async () => {
    const store = new MemorySaveStore();
    const c = clock();
    await store.save(LEGACY_SLOT, toSave(playedBeforeWorlds(), BROWSER_TUNING, new Date(c.now()).toISOString()));
    const first = new WorldLibrary(store, c.now);
    await first.open();
    await first.rename(first.worlds[0]!.id, "Renamed");
    const second = new WorldLibrary(store, c.now);
    await second.open();
    expect(second.worlds.map((w) => w.name)).toEqual(["Renamed"]);
  });

  it("reads a world Batch 27 made - entered as \"standard\", before there were paces - as Classic, from its tuning (Batch 28)", async () => {
    const store = new MemorySaveStore();
    const c = clock();
    const made = new WorldLibrary(store, c.now);
    await made.open();
    const w = await made.create({ name: "Before paces", seed: 5, mode: "standard", pace: "classic" });
    // As Batch 27 wrote it: the label "standard", and a tuning with no curve in it at all.
    const index = (await store.loadMeta("worlds")) as { worlds: Record<string, unknown>[] };
    const { BUILD_CURVE_ENABLED: _gone, ...older } = w.tuning;
    void _gone;
    await store.saveMeta("worlds", { ...index, worlds: index.worlds.map((x) => ({ ...x, pace: "standard", tuning: older })) });
    const later = new WorldLibrary(store, c.now);
    await later.open();
    expect(later.find(w.id)?.pace).toBe("classic");
    const opened = await loaded(later, w.id);
    expect(opened.tuning.BUILD_CURVE_ENABLED).toBe(0);
  });

  it("leaves a first launch with no save with no worlds", async () => {
    const lib = new WorldLibrary(new MemorySaveStore(), clock().now);
    await lib.open();
    expect(lib.worlds).toEqual([]);
    expect(lib.last).toBeNull();
  });
});

describe("a seed makes a world", () => {
  const spec = (seed: number, mode: NewWorld["mode"] = "standard"): NewWorld => ({ name: "W", seed, mode, pace: "standard" });
  /** A spread of places on the planet, to ask what ground each world puts under them. */
  const places = Array.from({ length: 60 }, (_, i) => ({ lat: Math.asin(((i * 0.618034) % 1) * 2 - 1), lon: ((i * 0.381966) % 1) * 2 * Math.PI - Math.PI }));
  const ground = (t: Tuning): number[] => places.map((p) => siteElevation(p.lat, p.lon, t));

  it.each(["standard", "sandbox"] as const)("%s: the same seed twice is the same world - at the start and after 100 sim-years", async (mode) => {
    const lib = new WorldLibrary(new MemorySaveStore(), clock().now);
    await lib.open();
    const a = await loaded(lib, (await lib.create(spec(424242, mode))).id);
    const b = await loaded(lib, (await lib.create(spec(424242, mode))).id);
    expect(b.tuning).toEqual(a.tuning);
    expect(b.state).toEqual(a.state);
    expect(play(b.state, b.tuning, 100)).toEqual(play(a.state, a.tuning, 100));
  });

  it.each(["standard", "sandbox"] as const)("%s: two seeds are two worlds - another planet at the start, another history after 100 sim-years", async (mode) => {
    const lib = new WorldLibrary(new MemorySaveStore(), clock().now);
    await lib.open();
    const a = await loaded(lib, (await lib.create(spec(424242, mode))).id);
    const b = await loaded(lib, (await lib.create(spec(424243, mode))).id);
    // The start: the ground under the same places.
    const ga = ground(a.tuning);
    const gb = ground(b.tuning);
    const moved = ga.filter((m, i) => Math.abs(m - gb[i]!) > 100).length;
    expect(moved).toBeGreaterThan(GROUND_LEAST);
    // A hundred years on: the weather each seed brings has moved the planet differently.
    const pa = play(a.state, a.tuning, 100).reservoirs;
    const pb = play(b.state, b.tuning, 100).reservoirs;
    expect(pb).not.toEqual(pa);
  });

  /**
   * The terraformed start is the example planet laid out from the seed: 19-21
   * s to build (measured), so three builds and ten sim-years, not a hundred
   * (a hundred would add about 26 s a world on its 42 settlements).
   */
  it("terraformed: the same seed twice is the same world, and another seed lays it out elsewhere", async () => {
    const lib = new WorldLibrary(new MemorySaveStore(), clock().now);
    await lib.open();
    const a = await loaded(lib, (await lib.create(spec(31337, "terraformed"))).id);
    const b = await loaded(lib, (await lib.create(spec(31337, "terraformed"))).id);
    expect(b.state).toEqual(a.state);
    const cfg = (t: Tuning) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });
    expect(advance(b.state, 40, cfg(b.tuning))).toEqual(advance(a.state, 40, cfg(a.tuning)));
    const c = await loaded(lib, (await lib.create(spec(31338, "terraformed"))).id);
    const sites = (s: SimState): string[] => s.settlements.map((x) => `${x.lat.toFixed(4)},${x.lon.toFixed(4)}`);
    expect(sites(c.state).filter((p) => sites(a.state).includes(p))).toEqual([]);
    expect(c.state.settlements.length).toBeGreaterThan(30);
  }, 240_000);

  it("records the tuning it was made with: the mode's rules, and nothing of them in a standard world", async () => {
    const lib = new WorldLibrary(new MemorySaveStore(), clock().now);
    await lib.open();
    const standard = await lib.create(spec(9, "standard"));
    const sandbox = await lib.create(spec(9, "sandbox"));
    expect(standard.tuning["SANDBOX_ENABLED"]).toBe(0);
    expect(sandbox.tuning["SANDBOX_ENABLED"]).toBe(1);
    expect(standard.tuning["TERRAIN_SEED"]).toBe(9);
    // The rest of a standard world's tuning is the browser's own, at the pace it was made with (Batch 28), with what
    // every world made since has (Batch 29: the rovers' routes), and the mode's own first hour (Batch 30).
    expect({ ...standard.tuning, TERRAIN_SEED: 0 }).toEqual({ ...makeTuning({ ...BROWSER_OVERRIDES, ...NEW_WORLD_OVERRIDES, ...PACE_OVERRIDES.standard, ...MODE_OVERRIDES.standard }) });
    expect(sandbox.tuning["GUIDE_ENABLED"]! + sandbox.tuning["OBJECTIVES_ENABLED"]!).toBe(0);
    expect(standard.pace).toBe("standard");
  });

  it("reads a typed seed as itself, and any other text as the same number every time", () => {
    expect(parseSeed("12345")).toBe(12345);
    expect(parseSeed(" olympus ")).toBe(parseSeed("olympus"));
    expect(parseSeed("olympus")).not.toBe(parseSeed("tharsis"));
    expect(parseSeed("")).toBeNull();
  });
});

describe("a world through a file", () => {
  it("comes back exactly after export, delete and import", async () => {
    const store = new MemorySaveStore();
    const c = clock();
    const lib = new WorldLibrary(store, c.now);
    await lib.open();
    const made = await lib.create({ name: "Hellas", seed: 77, mode: "standard", pace: "standard" });
    // Played a while, and saved as the game saves.
    const played = play((await loaded(lib, made.id)).state, (await loaded(lib, made.id)).tuning, 20);
    await store.save(made.slot, toSave(played, BROWSER_TUNING, new Date(c.now()).toISOString()));
    await lib.record(made.id, played, { playtimeMs: 123_456, thumbnail: "data:image/png;base64,AAAA" });
    const before = { meta: lib.find(made.id), world: await loaded(lib, made.id) };

    const file = await lib.exportWorld(made.id);
    await lib.remove(made.id);
    expect(lib.find(made.id)).toBeUndefined();
    expect(await store.load(made.slot), "deleting a world deletes its save").toBeNull();

    const back = await lib.importWorld(file);
    expect(back).toEqual(before.meta);
    expect(await loaded(lib, back.id)).toEqual(before.world);
  });

  it("comes in beside a world it would collide with, never over it", async () => {
    const store = new MemorySaveStore();
    const lib = new WorldLibrary(store, clock().now);
    await lib.open();
    const made = await lib.create({ name: "Hellas", seed: 77, mode: "standard", pace: "standard" });
    const file = await lib.exportWorld(made.id);
    const copy = await lib.importWorld(file);
    expect(copy.id).not.toBe(made.id);
    expect(copy.slot).not.toBe(made.slot);
    expect(lib.worlds).toHaveLength(2);
  });

  it("refuses a file that is not a world, and writes nothing", async () => {
    const lib = new WorldLibrary(new MemorySaveStore(), clock().now);
    await lib.open();
    await expect(lib.importWorld("{}")).rejects.toThrow(/not a world/);
    await expect(lib.importWorld(JSON.stringify({ format: "terraform-world", version: 1, world: { id: "x", slot: "world:x" }, save: { schema_version: 1 } }))).rejects.toThrow(/does not load/);
    expect(lib.worlds).toEqual([]);
  });
});

describe("a world that fails to load", () => {
  async function three(): Promise<{ store: MemorySaveStore; lib: WorldLibrary; good: string; corrupt: string; future: string }> {
    const store = new MemorySaveStore();
    const lib = new WorldLibrary(store, clock().now);
    await lib.open();
    const good = await lib.create({ name: "Good", seed: 1, mode: "standard", pace: "standard" });
    const corrupt = await lib.create({ name: "Corrupt", seed: 2, mode: "standard", pace: "standard" });
    const future = await lib.create({ name: "Future", seed: 3, mode: "standard", pace: "standard" });
    store.putRaw(corrupt.slot, { schema_version: 13, reservoirs: "rubbish" });
    const saved = JSON.parse(store.raw(future.slot)!) as Record<string, unknown>;
    store.putRaw(future.slot, { ...saved, schema_version: 999 });
    return { store, lib, good: good.id, corrupt: corrupt.id, future: future.id };
  }

  it("is listed with the reason", async () => {
    const { lib, good, corrupt, future } = await three();
    await lib.verify();
    expect(lib.find(corrupt)?.problem).toMatch(/corrupt save/);
    expect(lib.find(future)?.problem).toMatch(/newer version/);
    expect(lib.find(good)?.problem).toBeNull();
    expect(lib.worlds).toHaveLength(3);
  });

  it("is never deleted or written over, and never stops the others opening", async () => {
    const { store, lib, good, corrupt, future } = await three();
    const corruptRaw = store.raw(lib.find(corrupt)!.slot);
    const futureRaw = store.raw(lib.find(future)!.slot);

    const tried = await lib.load(corrupt);
    expect(tried.ok).toBe(false);
    expect((await lib.load(future)).ok).toBe(false);
    // The others still open and save round them.
    const g = await loaded(lib, good);
    await store.save(lib.find(good)!.slot, toSave(g.state, g.tuning, new Date(T0).toISOString()));
    await lib.record(good, g.state, { playtimeMs: 10 });
    await lib.verify();

    expect(store.raw(lib.find(corrupt)!.slot)).toBe(corruptRaw);
    expect(store.raw(lib.find(future)!.slot)).toBe(futureRaw);
    expect(lib.worlds.map((w) => w.name).sort()).toEqual(["Corrupt", "Future", "Good"]);
  });

  it("is the old save's fate too: a corrupt save from before worlds is listed, not replaced", async () => {
    const store = new MemorySaveStore();
    store.putRaw(LEGACY_SLOT, { schema_version: 13, broken: true });
    const lib = new WorldLibrary(store, clock().now);
    await lib.open();
    expect(lib.worlds.map((w) => w.name)).toEqual([LEGACY_NAME]);
    expect((await lib.load(lib.worlds[0]!.id)).ok).toBe(false);
    expect(lib.worlds[0]!.problem).toMatch(/corrupt save/);
    expect(store.raw(LEGACY_SLOT)).toBe(JSON.stringify({ schema_version: 13, broken: true }));
  });

  it("an unreadable worlds list is set aside, never overwritten", async () => {
    const store = new MemorySaveStore();
    await store.saveMeta("worlds", "garbage");
    const lib = new WorldLibrary(store, clock().now);
    await lib.open();
    expect(lib.problem).toMatch(/unreadable/);
    expect(await store.loadMeta(`worlds-unreadable-${T0}`)).toBe("garbage");
  });
});
