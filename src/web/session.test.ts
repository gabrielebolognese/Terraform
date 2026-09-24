/**
 * The exit gate for Batch 4: an injected-clock test proving a save round-trips,
 * advances correctly over a simulated absence, and reports the right delta.
 *
 * Injected rather than real, because "reopen it hours later" is not a thing CI
 * can do. Everything under here takes the time as a parameter, so moving the
 * clock is just calling a function with a bigger number.
 */

import { describe, expect, it } from "vitest";

import type { SaveFile, SaveStore, SimState } from "../sim/index.js";
import { DEFAULT_TUNING, buildFacility, defaultConfig, marsStart, toSave } from "../sim/index.js";
import { Autosaver, boot } from "./session.js";
import { MemorySaveStore } from "./storage.js";

const t = DEFAULT_TUNING;
const cfg = defaultConfig();
const START_MS = Date.parse("2026-01-01T00:00:00.000Z");
const HOUR_MS = 3600_000;

/** A clock the test drives by hand. */
function stubClock(startMs = START_MS): { now: () => number; advance: (ms: number) => void } {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function playedState(): SimState {
  return buildFacility(marsStart(), "orbital_mirror", 30, 1, t);
}

describe("booting", () => {
  it("starts a fresh world when there is no save", async () => {
    const result = await boot(new MemorySaveStore(), cfg, stubClock().now);
    expect(result.origin).toBe("fresh");
    expect(result.state.steps).toBe(0);
    expect(result.grant).toBeNull();
    expect(result.problem).toBeNull();
  });

  it("round-trips a save and advances it by the absence", async () => {
    const store = new MemorySaveStore();
    const clock = stubClock();
    const saver = new Autosaver(store, cfg, clock.now);

    await saver.save(playedState());
    clock.advance(4 * HOUR_MS);

    const result = await boot(store, cfg, clock.now);
    expect(result.origin).toBe("resumed");
    expect(result.problem).toBeNull();

    const expectedYears = 4 * 3600 * t.TIME_SCALE * t.OFFLINE_RATE_FACTOR;
    expect(result.grant?.grantedSimYears).toBeCloseTo(expectedYears, 9);
    expect(result.state.steps).toBe(Math.round(expectedYears / t.SUBSTEP_YEARS));
  });

  it("reports the right delta for the absence", async () => {
    const store = new MemorySaveStore();
    const clock = stubClock();
    const saver = new Autosaver(store, cfg, clock.now);

    // A world with the mirrors already deployed, so something actually happens.
    let warm = buildFacility(marsStart(), "orbital_mirror", 40, 2, t);
    warm = { ...warm, facilities: warm.facilities.map((f) => ({ ...f, deployed: 80 })) };
    await saver.save(warm);

    clock.advance(8 * HOUR_MS);
    const result = await boot(store, cfg, clock.now);

    const summary = result.summary;
    expect(summary).not.toBeNull();
    expect(summary?.simYears).toBeGreaterThan(0);
    expect(summary?.deltas.T).toBeGreaterThan(0);
    expect(summary?.headline).toMatch(/sim-year/);
  });

  it("caps a long absence the same way the sim does", async () => {
    const store = new MemorySaveStore();
    const clock = stubClock();
    await new Autosaver(store, cfg, clock.now).save(playedState());

    clock.advance(30 * 24 * HOUR_MS);
    const result = await boot(store, cfg, clock.now);
    expect(result.grant?.limitedBy).toBe("absence-cap");
    expect(result.grant?.grantedSimYears).toBeCloseTo(
      t.OFFLINE_CAP_HOURS * 3600 * t.TIME_SCALE * t.OFFLINE_RATE_FACTOR,
      9,
    );
  });
});

describe("a broken save does not break the game", () => {
  /** A store whose slot contains something that is not a save. */
  function storeHolding(value: unknown): SaveStore {
    return {
      durable: true,
      load: () => Promise.resolve(value),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
  }

  it("starts fresh and SAYS SO when the save is corrupt", async () => {
    // A complete save with ONE bad field, which is what real corruption looks
    // like - a truncated write, a hand edit, a bad migration. The message has
    // to name that field, or the player is told only that "something" broke.
    const corrupt = { ...toSave(playedState(), t, "2026-01-01T00:00:00.000Z"), planet_id: 7 };
    const result = await boot(storeHolding(corrupt), cfg, stubClock().now);
    expect(result.origin).toBe("recovered");
    expect(result.state.steps).toBe(0);
    expect(result.problem).toMatch(/planet_id/);
  });

  it("names the field when a reservoir is the broken one", async () => {
    const save = toSave(playedState(), t, "2026-01-01T00:00:00.000Z");
    const corrupt = { ...save, reservoirs: { ...save.reservoirs, o2: -1 } };
    const result = await boot(storeHolding(corrupt), cfg, stubClock().now);
    expect(result.problem).toMatch(/reservoirs\.o2 is negative/);
  });

  it("starts fresh when the save came from a newer build", async () => {
    const future = { ...toSave(marsStart(), t, "2026-01-01T00:00:00.000Z"), schema_version: 99 };
    const result = await boot(storeHolding(future), cfg, stubClock().now);
    expect(result.origin).toBe("recovered");
    expect(result.problem).toMatch(/newer version/);
  });

  it("starts fresh when storage itself fails", async () => {
    const broken: SaveStore = {
      durable: true,
      load: () => Promise.reject(new Error("quota exceeded")),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    };
    const result = await boot(broken, cfg, stubClock().now);
    expect(result.origin).toBe("recovered");
    expect(result.problem).toMatch(/quota exceeded/);
    expect(result.state.steps).toBe(0);
  });
});

describe("autosaving", () => {
  it("serialises overlapping writes so the last one wins", async () => {
    /**
     * Autosave, a visibility change and a page-hide can all fire within a
     * frame. Overlapping writes to one slot race for which lands last, and the
     * loser is whichever the browser happens to finish second - not whichever
     * is newer.
     */
    const order: number[] = [];
    const store: SaveStore = {
      durable: true,
      load: () => Promise.resolve(null),
      save: (_slot, data: SaveFile) =>
        new Promise((resolve) =>
          setTimeout(() => {
            order.push(data.steps);
            resolve();
          }, data.steps === 4 ? 20 : 1),
        ),
      clear: () => Promise.resolve(),
    };

    const saver = new Autosaver(store, cfg, stubClock().now);
    const slow = saver.save({ ...playedState(), steps: 4 });
    const fast = saver.save({ ...playedState(), steps: 8 });
    await Promise.all([slow, fast]);

    expect(order).toEqual([4, 8]);
  });

  it("keeps running when a write fails, and counts the failures", async () => {
    let attempts = 0;
    const flaky: SaveStore = {
      durable: true,
      load: () => Promise.resolve(null),
      save: () => {
        attempts += 1;
        return attempts <= 2 ? Promise.reject(new Error("disk full")) : Promise.resolve();
      },
      clear: () => Promise.resolve(),
    };

    const saver = new Autosaver(flaky, cfg, stubClock().now);
    await saver.save(playedState());
    await saver.save(playedState());
    expect(saver.failureCount).toBe(2);
    expect(saver.lastSaved).toBe(0);

    await saver.save(playedState());
    expect(saver.failureCount).toBe(0);
    expect(saver.lastSaved).toBe(START_MS);
  });

  it("knows when the next save is due", () => {
    const clock = stubClock();
    const saver = new Autosaver(new MemorySaveStore(), cfg, clock.now);
    expect(saver.due(30_000)).toBe(true);
  });

  it("stamps the save with the injected clock, not a real one", () => {
    const saver = new Autosaver(new MemorySaveStore(), cfg, stubClock().now);
    expect(saver.snapshot(marsStart()).last_saved_real).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("the memory store stands in for the real one", () => {
  it("round-trips through JSON, so it fails on the same values IndexedDB would", async () => {
    const store = new MemorySaveStore();
    const save = toSave(playedState(), t, "2026-01-01T00:00:00.000Z");
    await store.save("mars", save);
    expect(await store.load("mars")).toEqual(JSON.parse(JSON.stringify(save)));
  });

  it("reports itself as not durable, so the UI can warn", () => {
    expect(new MemorySaveStore().durable).toBe(false);
  });

  it("clears", async () => {
    const store = new MemorySaveStore();
    await store.save("mars", toSave(marsStart(), t, "2026-01-01T00:00:00.000Z"));
    await store.clear("mars");
    expect(await store.load("mars")).toBeNull();
  });
});
