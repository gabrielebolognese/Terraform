/**
 * The player's sound settings (Batch 35): a volume for each channel, a
 * master volume and mute.
 *
 * Kept per player, not per world: one record in the store's index beside the
 * worlds list (`SETTINGS_KEY`), read when the game opens and written when a
 * slider moves. Untrusted like a save - a value out of range, missing or of
 * the wrong kind falls back to its default, and an unreadable record leaves
 * every default in place rather than stopping the game.
 */

import type { IndexStore } from "./storage.js";

export const CHANNELS = ["music", "ambience", "effects", "interface"] as const;
export type Channel = (typeof CHANNELS)[number];

export interface SoundSettings {
  /** 0 to 1. */
  readonly master: number;
  readonly music: number;
  readonly ambience: number;
  readonly effects: number;
  readonly interface: number;
  readonly muted: boolean;
}

export const DEFAULT_SOUND: SoundSettings = Object.freeze({
  master: 0.8,
  music: 0.6,
  ambience: 0.7,
  effects: 0.8,
  interface: 0.7,
  muted: false,
});

/** The player's settings record in the store's index: sound now; the rest of the settings join it in Batch 36. */
export const SETTINGS_KEY = "settings";
/** The record's version, for a later change to migrate from. */
export const SETTINGS_VERSION = 1;

export const VOLUME_KEYS = ["master", ...CHANNELS] as const;
export type VolumeKey = (typeof VOLUME_KEYS)[number];

/** What a player's record may hold: anything else is the default. */
export function readSound(raw: unknown): SoundSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SOUND;
  const sound = (raw as { sound?: unknown }).sound;
  if (typeof sound !== "object" || sound === null) return DEFAULT_SOUND;
  const r = sound as Record<string, unknown>;
  const volume = (k: VolumeKey): number => {
    const v = r[k];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_SOUND[k];
  };
  return {
    master: volume("master"),
    music: volume("music"),
    ambience: volume("ambience"),
    effects: volume("effects"),
    interface: volume("interface"),
    muted: typeof r["muted"] === "boolean" ? r["muted"] : DEFAULT_SOUND.muted,
  };
}

/**
 * The player's settings, from their record and to it. A record that cannot
 * be read or written is not a reason to stop: the game plays on the defaults
 * (or what was set this session), and says nothing - sound is not progress.
 */
export class PlayerSettings {
  private current: SoundSettings = DEFAULT_SOUND;
  /** The whole record as read: what this does not know about (Batch 36's settings) is written back untouched. */
  private record: Record<string, unknown> = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly store: IndexStore) {}

  get sound(): SoundSettings {
    return this.current;
  }

  async load(): Promise<SoundSettings> {
    try {
      const raw = await this.store.loadMeta(SETTINGS_KEY);
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) this.record = { ...(raw as Record<string, unknown>) };
      this.current = readSound(raw);
    } catch {
      this.current = DEFAULT_SOUND;
    }
    return this.current;
  }

  /** Change the sound settings and write them; writes go one after another, the last one wins. */
  setSound(next: SoundSettings): Promise<void> {
    this.current = next;
    this.record = { ...this.record, version: SETTINGS_VERSION, sound: { ...next } };
    const record = this.record;
    this.writing = this.writing.then(() => this.store.saveMeta(SETTINGS_KEY, record)).catch(() => undefined);
    return this.writing;
  }

  /** Every write so far, done: what a test (and a reload) waits for. */
  settled(): Promise<void> {
    return this.writing;
  }
}
