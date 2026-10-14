/**
 * Browser persistence, behind the `SaveStore` contract the simulation defines.
 *
 * IndexedDB with a documented fallback. It is genuinely unavailable in several
 * ordinary situations - a private window, blocked site data, some embedded
 * webviews - and in those the game should keep running and SAY that progress
 * will not survive a reload, rather than throwing on the first autosave or,
 * worse, silently discarding the player's afternoon.
 *
 * Nothing here knows the save shape beyond "it is JSON-serialisable". Reading
 * back an unvalidated blob is deliberate: `fromSave` is the validator, and it
 * has to handle untrusted input anyway.
 */

import type { SaveFile, SaveStore } from "../sim/index.js";

const DB_NAME = "terraform";
/** v2 (Batch 27): a second object store, for the worlds' index. v1's saves are untouched. */
const DB_VERSION = 2;
const STORE = "saves";
const META = "meta";

/**
 * The worlds' index (Batch 27): small, kept apart from the saves so the
 * worlds list opens without loading a world. Untrusted like a save - the
 * reader validates it.
 */
export interface IndexStore {
  loadMeta(key: string): Promise<unknown | null>;
  saveMeta(key: string, value: unknown): Promise<void>;
}

export type GameStore = SaveStore & IndexStore;

/** A store that forgets everything on reload, used when the browser has no durable option. */
export class MemorySaveStore implements GameStore {
  readonly durable: boolean;
  private readonly slots = new Map<string, string>();
  private readonly meta = new Map<string, string>();

  loadMeta(key: string): Promise<unknown | null> {
    const raw = this.meta.get(key);
    return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as unknown));
  }

  saveMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, JSON.stringify(value));
    return Promise.resolve();
  }

  /** Tests: write a raw value into a slot, as a corrupt or future save would sit on disk. */
  putRaw(slot: string, value: unknown): void {
    this.slots.set(slot, JSON.stringify(value));
  }

  /** Tests: every slot holding something. */
  slotNames(): string[] {
    return [...this.slots.keys()];
  }

  /** Tests: the slot exactly as stored, or undefined. */
  raw(slot: string): string | undefined {
    return this.slots.get(slot);
  }

  constructor(durable = false) {
    this.durable = durable;
  }

  load(slot: string): Promise<unknown | null> {
    const raw = this.slots.get(slot);
    return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as unknown));
  }

  save(slot: string, data: SaveFile): Promise<void> {
    // Round-trips through JSON like the real store, so a value that would not
    // survive persistence fails here too rather than only in production.
    this.slots.set(slot, JSON.stringify(data));
    return Promise.resolve();
  }

  clear(slot: string): Promise<void> {
    this.slots.delete(slot);
    return Promise.resolve();
  }
}

class IndexedDbSaveStore implements GameStore {
  readonly durable = true;

  constructor(private readonly db: IDBDatabase) {}

  load(slot: string): Promise<unknown | null> {
    return this.run(STORE, "readonly", (store) => store.get(slot)).then((value) => value ?? null);
  }

  save(slot: string, data: SaveFile): Promise<void> {
    return this.run(STORE, "readwrite", (store) => store.put(data, slot)).then(() => undefined);
  }

  clear(slot: string): Promise<void> {
    return this.run(STORE, "readwrite", (store) => store.delete(slot)).then(() => undefined);
  }

  loadMeta(key: string): Promise<unknown | null> {
    return this.run(META, "readonly", (store) => store.get(key)).then((value) => value ?? null);
  }

  saveMeta(key: string, value: unknown): Promise<void> {
    return this.run(META, "readwrite", (store) => store.put(value, key)).then(() => undefined);
  }

  private run<T>(name: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let request: IDBRequest<T>;
      try {
        request = work(this.db.transaction(name, mode).objectStore(name));
      } catch (error) {
        // A transaction can throw synchronously - the database was closed by
        // the browser, or storage was cleared mid-session.
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
}

/**
 * Open the best available store.
 *
 * Never rejects. A game that cannot save is still a game; a game that refuses
 * to start because it cannot save is not.
 */
export function openSaveStore(): Promise<GameStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(new MemorySaveStore());
  }

  return new Promise<GameStore>((resolve) => {
    let settled = false;
    const fallback = (): void => {
      if (!settled) {
        settled = true;
        resolve(new MemorySaveStore());
      }
    };

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      fallback();
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      resolve(new IndexedDbSaveStore(request.result));
    };
    request.onerror = fallback;
    request.onblocked = fallback;
  });
}
