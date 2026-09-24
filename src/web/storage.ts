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
const DB_VERSION = 1;
const STORE = "saves";

/** A store that forgets everything on reload, used when the browser has no durable option. */
export class MemorySaveStore implements SaveStore {
  readonly durable: boolean;
  private readonly slots = new Map<string, string>();

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

class IndexedDbSaveStore implements SaveStore {
  readonly durable = true;

  constructor(private readonly db: IDBDatabase) {}

  load(slot: string): Promise<unknown | null> {
    return this.run("readonly", (store) => store.get(slot)).then((value) => value ?? null);
  }

  save(slot: string, data: SaveFile): Promise<void> {
    return this.run("readwrite", (store) => store.put(data, slot)).then(() => undefined);
  }

  clear(slot: string): Promise<void> {
    return this.run("readwrite", (store) => store.delete(slot)).then(() => undefined);
  }

  private run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let request: IDBRequest<T>;
      try {
        request = work(this.db.transaction(STORE, mode).objectStore(STORE));
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
export function openSaveStore(): Promise<SaveStore> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(new MemorySaveStore());
  }

  return new Promise<SaveStore>((resolve) => {
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
