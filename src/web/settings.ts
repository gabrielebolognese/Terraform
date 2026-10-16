/**
 * The player's settings (Batch 36): sound, graphics, controls, the interface
 * and saving.
 *
 * Kept per player, not per world, in a store of their own (`PlayerStore`):
 * no world's save carries them, and deleting a world never touches them.
 * Batch 35 kept the sound in a record in the worlds' index; that record is
 * read once, when the player's own store has nothing yet, and left where it
 * is - a newer game moves it, it never deletes it.
 *
 * Untrusted like a save: every value out of range, missing or of the wrong
 * kind falls back to its default, section by section, and a store that
 * cannot be read or written leaves the game playing on the defaults (or on
 * what was set this session) rather than stopping it.
 *
 * A setting changes how the game looks, sounds and answers the player -
 * never the world. Nothing here is read by `src/sim/`.
 */

import type { IndexStore, PlayerStore } from "./storage.js";
import type { SoundSettings } from "./sound-settings.js";
import { DEFAULT_SOUND, readSound } from "./sound-settings.js";
import type { KeyBindings } from "./keys.js";
import { DEFAULT_KEYS, readKeys } from "./keys.js";

/** The city's level of detail: chosen by what is on screen (auto, as before), or held at one. */
export const DETAILS = ["auto", "high", "medium", "low"] as const;
export type Detail = (typeof DETAILS)[number];

/** How many of the city's pictures are kept: memory against redrawing when the camera comes back. */
export const CHUNKS_KEPT = ["fewer", "standard", "more"] as const;
export type ChunksKept = (typeof CHUNKS_KEPT)[number];
/**
 * Picture pixels each keeps. Standard is the 24 million Batch 26 measured as
 * what a tab holds beside a metropolis (some 96 MB); 48 million was more than
 * a tab could hold, so More stops at 36.
 */
export const CHUNK_PIXELS: Readonly<Record<ChunksKept, number>> = { fewer: 12_000_000, standard: 24_000_000, more: 36_000_000 };

export interface GraphicsSettings {
  readonly detail: Detail;
  readonly chunks: ChunksKept;
  /** The city's moving details - lights blinking, blades turning, crowds, steam. Off, they stand still. */
  readonly effects: boolean;
}

/** The camera's speed for keys and the screen's edge, as a multiple of the usual. */
export const CAMERA_SPEEDS = [0.5, 0.75, 1, 1.5, 2, 3] as const;

export interface ControlSettings {
  readonly keys: KeyBindings;
  readonly cameraSpeed: number;
  /** In a city, the camera moves when the pointer rests at the edge of the screen. */
  readonly edgeScroll: boolean;
  /** The wheel zooms the other way, everywhere. */
  readonly invertZoom: boolean;
  /** For a trackpad: two fingers scroll the city, the planner and the map; a pinch zooms. Off, the wheel zooms. */
  readonly scrollPans: boolean;
}

export const PALETTES = ["standard", "red-green", "blue-yellow"] as const;
export type Palette = (typeof PALETTES)[number];
export const MOTIONS = ["auto", "reduced", "full"] as const;
export type Motion = (typeof MOTIONS)[number];
/** Which alerts pop up: all that interrupt (urgent and notices), urgent ones only, or none. The Alerts panel keeps every one. */
export const POPUPS = ["all", "urgent", "none"] as const;
export type Popups = (typeof POPUPS)[number];
export const UI_SCALES = [0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;

export interface InterfaceSettings {
  /** Panels, buttons and text, as a multiple of their size (the planet and the city are drawn as ever). */
  readonly scale: number;
  readonly palette: Palette;
  /** Auto follows the system's setting. */
  readonly motion: Motion;
  /** Solid black panels, white text and stronger edges. */
  readonly contrast: boolean;
  readonly popups: Popups;
}

/** How often the world is written while playing. Never off: a crash would lose the session. */
export const AUTOSAVE_CHOICES = [15_000, 30_000, 60_000, 300_000] as const;

export interface SavingSettings {
  readonly autosaveMs: number;
}

export interface Settings {
  readonly sound: SoundSettings;
  readonly graphics: GraphicsSettings;
  readonly controls: ControlSettings;
  readonly ui: InterfaceSettings;
  readonly saving: SavingSettings;
}

export const DEFAULT_GRAPHICS: GraphicsSettings = Object.freeze({ detail: "auto", chunks: "standard", effects: true });
export const DEFAULT_CONTROLS: ControlSettings = Object.freeze({ keys: DEFAULT_KEYS, cameraSpeed: 1, edgeScroll: false, invertZoom: false, scrollPans: false });
export const DEFAULT_UI: InterfaceSettings = Object.freeze({ scale: 1, palette: "standard", motion: "auto", contrast: false, popups: "all" });
/** The 15 s Batch 4 chose. */
export const DEFAULT_SAVING: SavingSettings = Object.freeze({ autosaveMs: 15_000 });

export const DEFAULT_SETTINGS: Settings = Object.freeze({ sound: DEFAULT_SOUND, graphics: DEFAULT_GRAPHICS, controls: DEFAULT_CONTROLS, ui: DEFAULT_UI, saving: DEFAULT_SAVING });

/** The record in the player's store, and its version. v1 was Batch 35's sound alone, in the worlds' index. */
export const SETTINGS_KEY = "settings";
export const SETTINGS_VERSION = 2;

const section = (raw: unknown, key: string): Record<string, unknown> | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const v = (raw as Record<string, unknown>)[key];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
};
function oneOf<T extends string | number>(choices: readonly T[], v: unknown, fallback: T): T {
  return (choices as readonly unknown[]).includes(v) ? (v as T) : fallback;
}
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

export function readGraphics(raw: unknown): GraphicsSettings {
  const g = section(raw, "graphics");
  if (g === null) return DEFAULT_GRAPHICS;
  return { detail: oneOf(DETAILS, g["detail"], DEFAULT_GRAPHICS.detail), chunks: oneOf(CHUNKS_KEPT, g["chunks"], DEFAULT_GRAPHICS.chunks), effects: flag(g["effects"], DEFAULT_GRAPHICS.effects) };
}

export function readControls(raw: unknown): ControlSettings {
  const c = section(raw, "controls");
  if (c === null) return DEFAULT_CONTROLS;
  return {
    keys: readKeys(c["keys"]),
    cameraSpeed: oneOf(CAMERA_SPEEDS, c["cameraSpeed"], DEFAULT_CONTROLS.cameraSpeed as (typeof CAMERA_SPEEDS)[number]),
    edgeScroll: flag(c["edgeScroll"], DEFAULT_CONTROLS.edgeScroll),
    invertZoom: flag(c["invertZoom"], DEFAULT_CONTROLS.invertZoom),
    scrollPans: flag(c["scrollPans"], DEFAULT_CONTROLS.scrollPans),
  };
}

export function readInterface(raw: unknown): InterfaceSettings {
  const u = section(raw, "ui");
  if (u === null) return DEFAULT_UI;
  return {
    scale: oneOf(UI_SCALES, u["scale"], DEFAULT_UI.scale as (typeof UI_SCALES)[number]),
    palette: oneOf(PALETTES, u["palette"], DEFAULT_UI.palette),
    motion: oneOf(MOTIONS, u["motion"], DEFAULT_UI.motion),
    contrast: flag(u["contrast"], DEFAULT_UI.contrast),
    popups: oneOf(POPUPS, u["popups"], DEFAULT_UI.popups),
  };
}

export function readSaving(raw: unknown): SavingSettings {
  const s = section(raw, "saving");
  if (s === null) return DEFAULT_SAVING;
  return { autosaveMs: oneOf(AUTOSAVE_CHOICES, s["autosaveMs"], DEFAULT_SAVING.autosaveMs as (typeof AUTOSAVE_CHOICES)[number]) };
}

/** Every setting from a record, v1 or v2: what is not there, or not right, is the default. */
export function readSettings(raw: unknown): Settings {
  return { sound: readSound(raw), graphics: readGraphics(raw), controls: readControls(raw), ui: readInterface(raw), saving: readSaving(raw) };
}

/** The record as written. */
export function settingsRecord(s: Settings): Record<string, unknown> {
  return {
    version: SETTINGS_VERSION,
    sound: { ...s.sound },
    graphics: { ...s.graphics },
    controls: { ...s.controls, keys: Object.fromEntries(Object.entries(s.controls.keys).map(([k, v]) => [k, [v[0], v[1]]])) },
    ui: { ...s.ui },
    saving: { ...s.saving },
  };
}

/** What the settings are read from: the player's store, and (for Batch 35's record) the worlds' index. */
export type SettingsStore = PlayerStore & Partial<IndexStore>;

/** Where the settings came from when the game opened. */
export type SettingsOrigin = "defaults" | "player" | "moved" | "unreadable";

/**
 * The player's settings, from their store and to it. One for the session:
 * the title and every world opened from it read the same, and hear of each
 * change at once.
 */
export class PlayerSettings {
  private value: Settings = DEFAULT_SETTINGS;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(s: Settings) => void>();
  /** Where they came from on loading: nothing yet, the player's store, Batch 35's record moved, or a store that would not read. */
  origin: SettingsOrigin = "defaults";

  constructor(private readonly store: SettingsStore) {}

  get current(): Settings {
    return this.value;
  }

  /** Batch 35's callers: the sound alone. */
  get sound(): SoundSettings {
    return this.value.sound;
  }

  async load(): Promise<Settings> {
    try {
      const raw = await this.store.loadPlayer(SETTINGS_KEY);
      if (raw !== null) {
        this.value = readSettings(raw);
        this.origin = "player";
      } else {
        // Nothing of the player's own yet: Batch 35's record in the worlds' index, if there is one, moved over.
        const old = this.store.loadMeta === undefined ? null : await this.store.loadMeta(SETTINGS_KEY).catch(() => null);
        if (old !== null) {
          this.value = readSettings(old);
          this.origin = "moved";
          this.write();
        }
      }
    } catch {
      this.value = DEFAULT_SETTINGS;
      this.origin = "unreadable";
    }
    this.tell();
    return this.value;
  }

  /** Change the settings and write them; writes go one after another, the last one wins. */
  set(next: Settings): Promise<void> {
    this.value = next;
    this.tell();
    return this.write();
  }

  /** Change one part of them. */
  update<K extends keyof Settings>(part: K, next: Settings[K]): Promise<void> {
    return this.set({ ...this.value, [part]: next });
  }

  setSound(next: SoundSettings): Promise<void> {
    return this.update("sound", next);
  }

  /** Hear of every change (and of loading); the returned function stops. */
  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every write so far, done: what a test (and a reload) waits for. */
  settled(): Promise<void> {
    return this.writing;
  }

  private write(): Promise<void> {
    const record = settingsRecord(this.value);
    this.writing = this.writing.then(() => this.store.savePlayer(SETTINGS_KEY, record)).catch(() => undefined);
    return this.writing;
  }

  private tell(): void {
    for (const l of this.listeners) l(this.value);
  }
}
