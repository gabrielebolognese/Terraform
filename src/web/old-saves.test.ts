/**
 * Real old saves (Batch 40's review: "every save migration loaded from a real
 * old save").
 *
 * Every migration test before this one made its "old" save from a new one -
 * a v21 save with the ending taken out and the number set to 20. That tests
 * what the migration was written to expect, not what an old game wrote.
 * These were written by the old games themselves: each era's own source, at
 * the commit before its schema moved on, made a Standard world through its own
 * world library and in-memory store, founded a city and an outpost, built,
 * connected, upgraded and queued, played on, saved as the app saves, and
 * exported the world (`scripts/old-save.ts`, on each era's source from `git archive`). Each file
 * holds the worlds list and the save exactly as that browser would have kept
 * them, and the export file it would have given the player.
 *
 * Here today's world library opens each as the browser does: the list, the
 * check of every save, the load with two hours away, play, a save in today's
 * schema and a load of that; and the old export imported.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { SimState } from "../sim/index.js";
import { NEUTRAL_ENV, NO_ENDING, SAVE_SCHEMA_VERSION, advance, fromSave, toSave } from "../sim/index.js";
import { fromRecord } from "./game-tuning.js";
import { MemorySaveStore } from "./storage.js";
import { WorldLibrary } from "./worlds.js";

interface OldSave {
  readonly schema: number;
  readonly commit: string;
  readonly made: { readonly steps: number; readonly settlements: number; readonly buildings: number; readonly jobs: number; readonly queued: number };
  readonly slot: string;
  readonly index: { readonly worlds: readonly { readonly id: string; readonly name: string; readonly slot: string }[] };
  readonly save: string;
  readonly exported: string;
}

const VERSIONS = [13, 14, 15, 16, 17, 18, 19, 20] as const;
const read = (v: number): OldSave => JSON.parse(readFileSync(new URL(`./old-saves/v${v}.json`, import.meta.url), "utf8")) as OldSave;
const TWO_HOURS = 2 * 3600 * 1000;

/** The library over a store holding exactly what the old browser kept, its clock two hours after the save. */
async function oldBrowser(old: OldSave): Promise<{ store: MemorySaveStore; lib: WorldLibrary; savedAt: number; clock: { now: number } }> {
  const store = new MemorySaveStore(true);
  await store.saveMeta("worlds", old.index);
  const raw = JSON.parse(old.save) as { last_saved_real: string };
  store.putRaw(old.slot, raw);
  const savedAt = Date.parse(raw.last_saved_real);
  expect(Number.isFinite(savedAt), "the save says when it was written").toBe(true);
  const clock = { now: savedAt + TWO_HOURS };
  const lib = new WorldLibrary(store, () => clock.now);
  await lib.open();
  return { store, lib, savedAt, clock };
}

/** What a settlement is made of, as a save holds it. */
function built(s: { readonly buildings: readonly { readonly type: string; readonly tx: number; readonly ty: number; readonly level?: number }[] }): string[] {
  return s.buildings.map((b) => `${b.type}@${b.tx},${b.ty}:${b.level ?? 1}`);
}

describe("real old saves, each written by its own era's game", () => {
  it("are what they say: every schema from v13 to the one before today's, each a played world (vacuity)", () => {
    expect(VERSIONS.at(-1)).toBe(SAVE_SCHEMA_VERSION - 1);
    for (const v of VERSIONS) {
      const old = read(v);
      const raw = JSON.parse(old.save) as { schema_version: number; settlements: unknown[] };
      expect(raw.schema_version, `v${v}`).toBe(v);
      expect(old.schema).toBe(v);
      expect(old.made.settlements, `v${v}: a city and an outpost`).toBe(2);
      expect(old.made.buildings, `v${v}: built`).toBeGreaterThan(8);
      // Builds under way in every era with rovers' build times, and waiting in the queue from v14 (the queue's own version).
      if (v >= 14) expect(old.made.jobs + old.made.queued, `v${v}: work under way`).toBeGreaterThan(3);
      if (v >= 14) expect(old.made.queued, `v${v}: queued`).toBeGreaterThan(0);
    }
  });

  for (const v of VERSIONS) {
    it(`v${v}: listed, checked, opened two hours later, played, saved as v${SAVE_SCHEMA_VERSION} and opened again`, async () => {
      const old = read(v);
      const { store, lib, savedAt, clock } = await oldBrowser(old);
      const id = old.index.worlds[0]!.id;
      const meta = lib.find(id);
      expect(meta?.name).toBe(`Old world v${v}`);
      // The check every launch runs: no problem recorded against it.
      await lib.verify();
      expect(lib.find(id)?.problem).toBeNull();

      // As the old game wrote it, migrated: nothing it held is lost.
      const raw = JSON.parse(old.save) as { steps: number; reservoirs: Record<string, number>; settlements: { id: string; population: number; buildings: { type: string; tx: number; ty: number; level?: number }[] }[] };
      const t = fromRecord(meta!.tuning);
      const migrated = fromSave(raw, t);
      expect(migrated.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      expect(migrated.steps).toBe(raw.steps);
      for (const [k, value] of Object.entries(raw.reservoirs)) expect(migrated.reservoirs[k as keyof SimState["reservoirs"]], k).toBe(value);
      expect(migrated.settlements.map((s) => s.id)).toEqual(raw.settlements.map((s) => s.id));
      for (const [i, s] of raw.settlements.entries()) {
        expect(built(migrated.settlements[i]!), `${s.id}'s buildings`).toEqual(built(s));
        expect(migrated.settlements[i]!.population).toBe(s.population);
      }
      // Features from after it was made stay off in it: it plays as it did (Batch 27), and has no ending (v21).
      expect(t.ENDING_ENABLED, "the ending, off in a world made before it").toBe(0);
      expect(migrated.ending).toEqual(NO_ENDING);

      // Opened as the browser opens it, two hours later: caught up by the absence, and its work going on.
      const loaded = await lib.load(id);
      if (!loaded.ok) throw new Error(loaded.reason);
      expect(loaded.state.steps, "caught up by two hours away").toBeGreaterThan(raw.steps);
      expect(loaded.grant).not.toBeNull();
      // And played on.
      const played = advance(loaded.state, 200, { tuning: loaded.tuning, env: NEUTRAL_ENV, forcing: null });
      expect(played.steps).toBe(loaded.state.steps + 200);
      expect(played.settlements.every((s) => Object.values(s.stores).every((x) => Number.isFinite(x) && x >= 0))).toBe(true);
      expect(played.ending).toEqual(NO_ENDING);

      // Saved in today's schema, as the app saves, and opened again: the same world.
      clock.now += 60_000;
      const again = toSave(played, loaded.tuning, new Date(clock.now).toISOString());
      expect(again.schema_version).toBe(SAVE_SCHEMA_VERSION);
      await store.save(old.slot, again);
      await lib.record(id, played, { playtimeMs: clock.now - savedAt });
      const reopened = await lib.load(id);
      if (!reopened.ok) throw new Error(reopened.reason);
      expect(reopened.state.steps).toBe(played.steps);
      expect(toSave(reopened.state, reopened.tuning, "x")).toEqual(toSave(played, loaded.tuning, "x"));
    });

    it(`v${v}: its export file imports into today's game`, async () => {
      const old = read(v);
      const lib = new WorldLibrary(new MemorySaveStore(true), () => Date.parse("2026-10-30T12:00:00Z"));
      await lib.open();
      const meta = await lib.importWorld(old.exported);
      expect(meta.name).toBe(`Old world v${v}`);
      const loaded = await lib.load(meta.id);
      if (!loaded.ok) throw new Error(loaded.reason);
      expect(loaded.state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
      expect(loaded.state.settlements.length).toBe(2);
    });
  }
});
