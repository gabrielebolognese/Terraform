/**
 * Worlds (Batch 27): "a new game like minecraft worlds".
 *
 * The player keeps any number of worlds, each its own planet with its own
 * save. Two things are stored, apart:
 *
 * - **the saves**, one `SaveStore` slot per world, exactly the `SaveFile` the
 *   simulation has always written;
 * - **the index**: each world's name, seed, mode and the whole tuning it was
 *   made with, and what the list shows (phase, sim-year, playtime, a
 *   thumbnail) - so the list opens without loading a single world.
 *
 * Three rules this file is built round:
 *
 * 1. **A world is never lost to an update.** The save from before worlds
 *    existed stays in its slot and becomes "My planet" - by an index entry,
 *    not a copy. A world records its tuning, so a later rebalance never
 *    silently changes it.
 * 2. **A world that fails to load is never written over.** Loading says why
 *    it failed and starts nothing; there is no fresh planet for an autosave to
 *    put in its slot (Batch 26's recorded defect in `boot`).
 * 3. **One broken world never stops the others.** Each is checked on its own.
 *
 * The menus read this; the simulation never sees it. Nothing here writes a
 * world's state: it moves saves between slots, files and the index.
 */

import type { AwaySummary, OfflineGrant, SaveFile, SimConfig, SimState, Tuning } from "../sim/index.js";
import { DEFAULT_TUNING, NAME_MAX, NEUTRAL_ENV, SaveError, fromSave, marsStart, resume, toSave } from "../sim/index.js";
import { examplePlanet } from "../harness/example.js";
import type { GameStore } from "./storage.js";
import type { WorldMode, WorldPace } from "./game-tuning.js";
import { BROWSER_TUNING, WORLD_MODES, WORLD_PACES, fromRecord, tuningRecord, worldTuning } from "./game-tuning.js";

/** Epoch milliseconds, injected. */
export type Clock = () => number;

/** The slot every save lived in before worlds - it stays the first world's slot. */
export const LEGACY_SLOT = "mars";
export const LEGACY_NAME = "My planet";
const INDEX_KEY = "worlds";
const INDEX_VERSION = 1;
/** The exported file's own format, around a `SaveFile`. */
export const EXPORT_FORMAT = "terraform-world";
const EXPORT_VERSION = 1;

export interface WorldMeta {
  readonly id: string;
  /** The `SaveStore` slot its save lives in. */
  readonly slot: string;
  readonly name: string;
  readonly seed: number;
  readonly mode: WorldMode;
  readonly pace: WorldPace;
  /** The whole tuning the world was made with: every constant, by name. */
  readonly tuning: Readonly<Record<string, number>>;
  readonly createdAt: number;
  readonly lastPlayedAt: number;
  readonly playtimeMs: number;
  readonly simYear: number;
  /** The phase reached (latched), as the save numbers it. */
  readonly phase: number;
  /** The globe as last seen, a data URL; null until one has been drawn. */
  readonly thumbnail: string | null;
  /** Why the save would not load when last tried; null when it loads (or has not been tried). */
  readonly problem: string | null;
}

interface WorldIndex {
  readonly version: number;
  readonly worlds: readonly WorldMeta[];
  readonly last: string | null;
}

export interface NewWorld {
  readonly name: string;
  readonly seed: number;
  readonly mode: WorldMode;
  readonly pace: WorldPace;
}

export type Loaded =
  | { readonly ok: true; readonly state: SimState; readonly tuning: Tuning; readonly grant: OfflineGrant | null; readonly summary: AwaySummary | null }
  | { readonly ok: false; readonly reason: string };

/** A seed from a player's typing: a number as itself, any other text hashed - the same text, the same world. */
export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n <= 0xffffffff ? n : n % 0x100000000;
  }
  let h = 2166136261;
  for (let i = 0; i < trimmed.length; i += 1) h = Math.imul(h ^ trimmed.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/**
 * A new world's first state. Standard and Sandbox start on the bare planet;
 * "Terraformed start" on the example planet, laid out from the seed (about
 * twenty seconds to build, measured).
 */
export function startState(spec: NewWorld, t: Tuning): SimState {
  if (spec.mode === "terraformed") return examplePlanet(DEFAULT_TUNING, t, spec.seed).state;
  return marsStart(spec.seed, t);
}

function message(error: unknown): string {
  if (error instanceof SaveError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function cleanName(name: string, fallback: string): string {
  const n = name.trim().slice(0, NAME_MAX);
  return n === "" ? fallback : n;
}

/** One index entry, read leniently: a world with an id and a slot is never dropped for a bad field. */
function readMeta(raw: unknown): WorldMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || typeof r["slot"] !== "string") return null;
  const num = (k: string, d: number): number => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : d);
  const mode = WORLD_MODES.includes(r["mode"] as WorldMode) ? (r["mode"] as WorldMode) : "standard";
  const pace = WORLD_PACES.includes(r["pace"] as WorldPace) ? (r["pace"] as WorldPace) : "standard";
  const tuning = typeof r["tuning"] === "object" && r["tuning"] !== null ? (r["tuning"] as Record<string, number>) : tuningRecord(BROWSER_TUNING);
  return {
    id: r["id"],
    slot: r["slot"],
    name: typeof r["name"] === "string" && r["name"] !== "" ? r["name"] : "Unnamed world",
    seed: num("seed", 0),
    mode,
    pace,
    tuning,
    createdAt: num("createdAt", 0),
    lastPlayedAt: num("lastPlayedAt", 0),
    playtimeMs: num("playtimeMs", 0),
    simYear: num("simYear", 0),
    phase: num("phase", 0),
    thumbnail: typeof r["thumbnail"] === "string" ? r["thumbnail"] : null,
    problem: typeof r["problem"] === "string" ? r["problem"] : null,
  };
}

/** What the list can say about a save without loading it. */
function summaryOf(raw: unknown): { simYear: number; phase: number; seed: number } {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const n = (k: string): number => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : 0);
  return { simYear: n("sim_year"), phase: n("phase"), seed: n("seed") };
}

export class WorldLibrary {
  private index: WorldIndex = { version: INDEX_VERSION, worlds: [], last: null };
  /** Set when the stored index could not be read: it was set aside, never overwritten. */
  private recovered: string | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly now: Clock,
  ) {}

  /** The worlds, most recently played first. */
  get worlds(): readonly WorldMeta[] {
    return [...this.index.worlds].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || a.name.localeCompare(b.name));
  }

  /** The last world played, for Continue; null when there is none. */
  get last(): WorldMeta | null {
    return this.index.worlds.find((w) => w.id === this.index.last) ?? null;
  }

  get problem(): string | null {
    return this.recovered;
  }

  find(id: string): WorldMeta | undefined {
    return this.index.worlds.find((w) => w.id === id);
  }

  /**
   * Read the index. On the first launch after Batch 27 there is none: the
   * save from before worlds becomes "My planet", in place.
   */
  async open(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await this.store.loadMeta(INDEX_KEY);
    } catch (error) {
      this.recovered = `the worlds list could not be read (${message(error)})`;
      return;
    }
    if (raw !== null) {
      const r = typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      if (r !== null && Array.isArray(r["worlds"])) {
        const worlds = r["worlds"].map(readMeta).filter((w): w is WorldMeta => w !== null);
        this.index = { version: INDEX_VERSION, worlds, last: typeof r["last"] === "string" ? r["last"] : null };
        return;
      }
      // Unreadable: set it aside under its own key rather than lose what it named.
      const aside = `${INDEX_KEY}-unreadable-${this.now()}`;
      await this.store.saveMeta(aside, raw);
      this.recovered = `the worlds list was unreadable; it was kept as "${aside}"`;
    }
    await this.migrateLegacy();
  }

  private async migrateLegacy(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await this.store.load(LEGACY_SLOT);
    } catch {
      raw = null;
    }
    if (raw === null || raw === undefined) {
      await this.write({ ...this.index, worlds: [] });
      return;
    }
    // The world before worlds was played with the browser's tuning and the original planet.
    const s = summaryOf(raw);
    const at = this.now();
    const legacy: WorldMeta = {
      id: "my-planet",
      slot: LEGACY_SLOT,
      name: LEGACY_NAME,
      seed: s.seed,
      mode: "standard",
      pace: "standard",
      tuning: tuningRecord(BROWSER_TUNING),
      createdAt: at,
      lastPlayedAt: at,
      playtimeMs: 0,
      simYear: s.simYear,
      phase: s.phase,
      thumbnail: null,
      problem: null,
    };
    await this.write({ version: INDEX_VERSION, worlds: [legacy], last: legacy.id });
  }

  private async write(index: WorldIndex): Promise<void> {
    this.index = index;
    await this.store.saveMeta(INDEX_KEY, index);
  }

  private async put(meta: WorldMeta, last = this.index.last): Promise<void> {
    const exists = this.index.worlds.some((w) => w.id === meta.id);
    const worlds = exists ? this.index.worlds.map((w) => (w.id === meta.id ? meta : w)) : [...this.index.worlds, meta];
    await this.write({ ...this.index, worlds, last });
  }

  private freshId(base: string): string {
    const taken = new Set(this.index.worlds.map((w) => w.id));
    const slots = new Set(this.index.worlds.map((w) => w.slot));
    let id = base;
    for (let k = 2; taken.has(id) || slots.has(`world:${id}`) || id === LEGACY_SLOT; k += 1) id = `${base}-${k}`;
    return id;
  }

  /** Make a world: its tuning from the mode and seed, its first save, then its entry. */
  async create(spec: NewWorld): Promise<WorldMeta> {
    const t = worldTuning(spec.mode, spec.seed);
    const state = startState(spec, t);
    const at = this.now();
    const id = this.freshId(`w${at.toString(36)}`);
    const meta: WorldMeta = {
      id,
      slot: `world:${id}`,
      name: cleanName(spec.name, "New world"),
      seed: spec.seed,
      mode: spec.mode,
      pace: spec.pace,
      tuning: tuningRecord(t),
      createdAt: at,
      lastPlayedAt: at,
      playtimeMs: 0,
      simYear: state.steps * t.SUBSTEP_YEARS,
      phase: state.phaseReached,
      thumbnail: null,
      problem: null,
    };
    // The save first: an entry whose slot is empty would list a world that is not there.
    await this.store.save(meta.slot, toSave(state, t, new Date(at).toISOString()));
    await this.put(meta, meta.id);
    return meta;
  }

  /**
   * Load a world to play: validate, migrate, and advance by the absence.
   * A failure is recorded against the world and returned - nothing is
   * started, so nothing can be saved over it.
   */
  async load(id: string): Promise<Loaded> {
    const meta = this.find(id);
    if (meta === undefined) return { ok: false, reason: "there is no such world" };
    let tuning: Tuning;
    try {
      tuning = fromRecord(meta.tuning);
    } catch (error) {
      return this.fail(meta, `its tuning is invalid (${message(error)})`);
    }
    let raw: unknown;
    try {
      raw = await this.store.load(meta.slot);
    } catch (error) {
      return this.fail(meta, `its save could not be read (${message(error)})`);
    }
    if (raw === null || raw === undefined) return this.fail(meta, "its save is missing");
    try {
      const cfg: SimConfig = { tuning, env: NEUTRAL_ENV, forcing: null };
      const r = resume(raw, this.now(), cfg);
      if (meta.problem !== null) await this.put({ ...meta, problem: null });
      return { ok: true, state: r.state, tuning, grant: r.grant, summary: r.summary };
    } catch (error) {
      return this.fail(meta, message(error));
    }
  }

  private async fail(meta: WorldMeta, reason: string): Promise<Loaded> {
    await this.put({ ...meta, problem: reason });
    return { ok: false, reason };
  }

  /** Check every world's save on its own, recording why any fails. One failure never stops the rest. */
  async verify(): Promise<void> {
    for (const meta of this.index.worlds) {
      let reason: string | null = null;
      try {
        const raw = await this.store.load(meta.slot);
        if (raw === null || raw === undefined) reason = "its save is missing";
        else fromSave(raw, fromRecord(meta.tuning));
      } catch (error) {
        reason = message(error);
      }
      const current = this.find(meta.id);
      if (current !== undefined && current.problem !== reason) await this.put({ ...current, problem: reason });
    }
  }

  /** After a save: what the list shows. Marks the world the last played. */
  async record(id: string, state: SimState, extra: { readonly playtimeMs: number; readonly thumbnail?: string | null | undefined }): Promise<void> {
    const meta = this.find(id);
    if (meta === undefined) return;
    const t = fromRecord(meta.tuning);
    await this.put(
      {
        ...meta,
        lastPlayedAt: this.now(),
        playtimeMs: extra.playtimeMs,
        simYear: state.steps * t.SUBSTEP_YEARS,
        phase: state.phaseReached,
        thumbnail: extra.thumbnail === undefined ? meta.thumbnail : extra.thumbnail,
        problem: null,
      },
      id,
    );
  }

  async rename(id: string, name: string): Promise<void> {
    const meta = this.find(id);
    if (meta === undefined) return;
    await this.put({ ...meta, name: cleanName(name, meta.name) });
  }

  /** A copy under a new name and slot. A world that does not load is not copied: its reason says why. */
  async duplicate(id: string): Promise<WorldMeta | string> {
    const meta = this.find(id);
    if (meta === undefined) return "there is no such world";
    const raw = await this.store.load(meta.slot);
    try {
      fromSave(raw, fromRecord(meta.tuning));
    } catch (error) {
      return `it does not load (${message(error)})`;
    }
    const at = this.now();
    const newId = this.freshId(`w${at.toString(36)}`);
    const copy: WorldMeta = { ...meta, id: newId, slot: `world:${newId}`, name: cleanName(`${meta.name} (copy)`, meta.name), createdAt: at, lastPlayedAt: at };
    await this.store.save(copy.slot, raw as SaveFile);
    await this.put(copy);
    return copy;
  }

  /** Delete a world: its entry first (a slot left behind is harmless; an entry with no save is not), then its save. */
  async remove(id: string): Promise<void> {
    const meta = this.find(id);
    if (meta === undefined) return;
    await this.write({ ...this.index, worlds: this.index.worlds.filter((w) => w.id !== id), last: this.index.last === id ? null : this.index.last });
    await this.store.clear(meta.slot);
  }

  /** The world as a file: its entry and its save, exactly as stored. */
  async exportWorld(id: string): Promise<string> {
    const meta = this.find(id);
    if (meta === undefined) throw new Error("there is no such world");
    const save = await this.store.load(meta.slot);
    if (save === null) throw new Error("its save is missing");
    const { problem: _problem, ...world } = meta;
    void _problem;
    return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, world, save });
  }

  /**
   * A world from a file. The save is checked before anything is written; a
   * world whose id or slot is taken comes in beside it, under new ones.
   */
  async importWorld(text: string): Promise<WorldMeta> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("the file is not a world (not valid JSON)");
    }
    const r = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    if (r["format"] !== EXPORT_FORMAT) throw new Error("the file is not a world");
    if (typeof r["version"] !== "number" || r["version"] > EXPORT_VERSION) throw new Error("the file was written by a newer version of the game");
    const meta = readMeta({ ...(r["world"] as object), problem: null });
    if (meta === null) throw new Error("the file's world has no id");
    try {
      fromSave(r["save"], fromRecord(meta.tuning));
    } catch (error) {
      throw new Error(`the file's save does not load (${message(error)})`);
    }
    const clash = this.index.worlds.some((w) => w.id === meta.id || w.slot === meta.slot);
    const id = clash ? this.freshId(`${meta.id}-imported`) : meta.id;
    const placed: WorldMeta = clash ? { ...meta, id, slot: `world:${id}` } : meta;
    await this.store.save(placed.slot, r["save"] as SaveFile);
    await this.put(placed);
    return placed;
  }

  /** Make a world the one Continue opens. */
  async markLast(id: string): Promise<void> {
    if (this.find(id) === undefined) return;
    await this.write({ ...this.index, last: id });
  }
}
