/**
 * The sound settings (Batch 35): a slider for the master volume and one for
 * each channel, and mute. Shown on the title's Settings screen and in the
 * world's menu; what is set is the player's, kept for every world.
 *
 * A setting changes the sound, never the world.
 */

import type { SoundSettings, VolumeKey } from "./sound-settings.js";
import { VOLUME_KEYS } from "./sound-settings.js";

export const VOLUME_NAMES: Readonly<Record<VolumeKey, string>> = {
  master: "Master volume",
  music: "Music",
  ambience: "Ambience",
  effects: "Effects",
  interface: "Interface",
};

const VOLUME_ABOUT: Readonly<Record<VolumeKey, string>> = {
  master: "Everything together.",
  music: "The score, which warms as the planet does.",
  ambience: "Wind, rain, the sea, and a city's machinery.",
  effects: "Building, finishing and upgrading; trains and rockets.",
  interface: "Alerts, objectives, milestones and buttons.",
};

export class SoundPanel {
  readonly root: HTMLElement;
  private readonly sliders = new Map<VolumeKey, { input: HTMLInputElement; value: HTMLElement }>();
  private readonly mute: HTMLInputElement;
  private current: SoundSettings;

  constructor(settings: SoundSettings, private readonly onChange: (next: SoundSettings) => void, note: string | null = null) {
    this.current = settings;
    this.root = document.createElement("section");
    this.root.className = "sound-panel";
    this.root.setAttribute("aria-label", "Sound");
    const head = document.createElement("h3");
    head.className = "sound-head";
    head.textContent = "Sound";
    this.root.append(head);
    for (const key of VOLUME_KEYS) {
      const row = document.createElement("label");
      row.className = "sound-row";
      row.dataset["volume"] = key;
      const name = document.createElement("span");
      name.className = "sound-name";
      name.textContent = VOLUME_NAMES[key];
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.step = "1";
      input.className = "sound-slider";
      input.setAttribute("aria-label", VOLUME_NAMES[key]);
      input.title = VOLUME_ABOUT[key];
      const value = document.createElement("span");
      value.className = "sound-value";
      input.addEventListener("input", () => {
        const v = Math.max(0, Math.min(100, Math.round(Number(input.value)))) / 100;
        this.change({ ...this.current, [key]: v });
      });
      row.append(name, input, value);
      this.root.append(row);
      this.sliders.set(key, { input, value });
    }
    const muteRow = document.createElement("label");
    muteRow.className = "sound-row sound-mute";
    this.mute = document.createElement("input");
    this.mute.type = "checkbox";
    this.mute.className = "sound-mute-box";
    this.mute.addEventListener("change", () => this.change({ ...this.current, muted: this.mute.checked }));
    const muteName = document.createElement("span");
    muteName.textContent = "Mute all sound";
    muteRow.append(this.mute, muteName);
    this.root.append(muteRow);
    if (note !== null) {
      const p = document.createElement("p");
      p.className = "sound-note";
      p.textContent = note;
      this.root.append(p);
    }
    this.show(settings);
  }

  get settings(): SoundSettings {
    return this.current;
  }

  private change(next: SoundSettings): void {
    this.show(next);
    this.onChange(next);
  }

  /** Show `s` without telling anyone: what the panel reads on opening. */
  show(s: SoundSettings): void {
    this.current = s;
    for (const key of VOLUME_KEYS) {
      const row = this.sliders.get(key)!;
      const pct = Math.round(s[key] * 100);
      row.input.value = String(pct);
      row.value.textContent = `${pct}%`;
    }
    this.mute.checked = s.muted;
  }
}
