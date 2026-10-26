/**
 * The player's sound settings (Batch 35): a volume for each channel, a
 * master volume and mute.
 *
 * Kept per player, not per world, with the rest of the player's settings
 * (Batch 36, `settings.ts`). Untrusted like a save - a value out of range,
 * missing or of the wrong kind falls back to its default.
 */

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
