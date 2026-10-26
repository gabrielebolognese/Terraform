/**
 * The Settings screen (Batch 36): sound, graphics, controls, the interface
 * and saving, in one panel - on the title's Settings screen and in a world's
 * menu, the same settings either way.
 *
 * Every control writes the player's settings at once and is heard, seen or
 * felt at once; none of them reaches the world. The key list takes any key
 * while it waits for one (Esc too), with Cancel and Clear beside it.
 */

import type { ActionId, KeyBindings } from "./keys.js";
import { ACTIONS, chordOf, keyName, rebind, ACTION_BY_ID, DEFAULT_KEYS } from "./keys.js";
import type { Settings } from "./settings.js";
import { AUTOSAVE_CHOICES, CAMERA_SPEEDS, CHUNKS_KEPT, CHUNK_PIXELS, DETAILS, MOTIONS, PALETTES, POPUPS, UI_SCALES } from "./settings.js";
import type { PlayerSettings } from "./settings.js";
import type { FrameCosts } from "./frame-costs.js";
import { costWords } from "./frame-costs.js";
import { SoundPanel } from "./sound-panel.js";

export const DETAIL_NAMES: Readonly<Record<Settings["graphics"]["detail"], string>> = {
  auto: "Auto - by how much is on screen",
  high: "High",
  medium: "Medium",
  low: "Low",
};
export const CHUNKS_NAMES: Readonly<Record<Settings["graphics"]["chunks"], string>> = {
  fewer: "Fewer - less memory",
  standard: "Standard",
  more: "More - smoother when you come back to a place",
};
export const PALETTE_NAMES: Readonly<Record<Settings["ui"]["palette"], string>> = {
  standard: "Standard",
  "red-green": "Red-green colour-blind safe",
  "blue-yellow": "Blue-yellow colour-blind safe",
};
export const MOTION_NAMES: Readonly<Record<Settings["ui"]["motion"], string>> = {
  auto: "Follow my system's setting",
  reduced: "Reduced",
  full: "Full",
};
export const POPUP_NAMES: Readonly<Record<Settings["ui"]["popups"], string>> = {
  all: "Urgent alerts and notices",
  urgent: "Urgent alerts only",
  none: "None (the Alerts panel keeps them all)",
};

export function autosaveName(ms: number): string {
  return ms < 60_000 ? `Every ${ms / 1000} seconds` : ms === 60_000 ? "Every minute" : `Every ${ms / 60_000} minutes`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

export interface SettingsPanelDeps {
  readonly settings: PlayerSettings;
  /** The sound engine's state, for the note that sound waits for a gesture. */
  readonly soundUnlocked: boolean;
  /** Each city frame's cost on this machine, this session. */
  readonly frameCosts: FrameCosts;
  /** Where the worlds are kept. */
  readonly place: string;
  /** The world's last save, in words, when there is a world open (the menu). */
  readonly lastSaved?: () => string | null;
}

/** A key waiting to be pressed: which action, which of its two keys. */
interface Waiting {
  readonly action: ActionId;
  readonly slot: 0 | 1;
}

export class SettingsPanel {
  readonly root: HTMLElement;
  private readonly sound: SoundPanel;
  private readonly keyList: HTMLElement;
  private readonly keyNote: HTMLElement;
  private readonly controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private waiting: Waiting | null = null;
  private readonly listening = new AbortController();
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: SettingsPanelDeps) {
    const s = deps.settings.current;
    this.root = el("div", "settings-panel");
    this.root.setAttribute("aria-label", "Settings");

    this.sound = new SoundPanel(s.sound, (next) => void deps.settings.setSound(next), deps.soundUnlocked ? null : "Sound starts with your first click or key press: browsers keep a page silent until then.");

    // ---- graphics
    const graphics = this.section("Graphics", "settings-graphics");
    graphics.append(
      this.select("graphics.detail", "Detail in a city", DETAILS.map((d) => [d, this.detailLabel(d)]), s.graphics.detail, (v) => this.change("graphics", { ...this.now.graphics, detail: v as Settings["graphics"]["detail"] })),
      this.select("graphics.chunks", "Pictures of the city kept", CHUNKS_KEPT.map((c) => [c, `${CHUNKS_NAMES[c]} (up to ${Math.round((CHUNK_PIXELS[c] * 4) / 1e6)} MB)`]), s.graphics.chunks, (v) =>
        this.change("graphics", { ...this.now.graphics, chunks: v as Settings["graphics"]["chunks"] }),
      ),
      this.check("graphics.effects", `Moving details: lights, turning blades, crowds and steam (${this.effectsCost()})`, s.graphics.effects, (v) => this.change("graphics", { ...this.now.graphics, effects: v })),
    );

    // ---- controls
    const controls = this.section("Controls", "settings-controls");
    controls.append(
      this.select("controls.cameraSpeed", "Camera speed (keys and screen edge)", CAMERA_SPEEDS.map((c) => [String(c), `${c}x`]), String(s.controls.cameraSpeed), (v) => this.change("controls", { ...this.now.controls, cameraSpeed: Number(v) })),
      this.check("controls.edgeScroll", "Edge scrolling: in a city, the camera moves when the pointer rests at the edge of the screen", s.controls.edgeScroll, (v) => this.change("controls", { ...this.now.controls, edgeScroll: v })),
      this.check("controls.invertZoom", "Invert zoom: the wheel zooms the other way", s.controls.invertZoom, (v) => this.change("controls", { ...this.now.controls, invertZoom: v })),
      this.check("controls.scrollPans", "Trackpad: two fingers move the map, a pinch zooms (off: the wheel zooms)", s.controls.scrollPans, (v) => this.change("controls", { ...this.now.controls, scrollPans: v })),
      el("p", "settings-about", "On a touch screen, drag with one finger to move and pinch with two to zoom, in every view."),
    );
    const keysHead = el("div", "settings-keys-head");
    keysHead.append(el("h4", "settings-subhead", "Keys"));
    const reset = el("button", "front-button settings-keys-reset", "Reset keys");
    reset.type = "button";
    reset.addEventListener("click", () => {
      this.waiting = null;
      this.change("controls", { ...this.now.controls, keys: DEFAULT_KEYS });
      this.keyNote.textContent = "Every key is back to how it came.";
    });
    keysHead.append(reset);
    this.keyNote = el("p", "settings-key-note");
    this.keyNote.setAttribute("role", "status");
    this.keyList = el("table", "settings-keys");
    controls.append(keysHead, this.keyNote, this.keyList);
    this.renderKeys();
    // While a key is awaited, the next key pressed is it - before the game or a menu hears it.
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.waiting === null || !this.root.isConnected) return;
        const chord = chordOf(e);
        if (chord === null) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.bind(this.waiting, chord);
      },
      { capture: true, signal: this.listening.signal },
    );

    // ---- interface
    const ui = this.section("Interface", "settings-interface");
    ui.append(
      this.select("ui.scale", "Interface size", UI_SCALES.map((k) => [String(k), `${Math.round(k * 100)}%`]), String(s.ui.scale), (v) => this.change("ui", { ...this.now.ui, scale: Number(v) })),
      this.select("ui.palette", "Colours", PALETTES.map((p) => [p, PALETTE_NAMES[p]]), s.ui.palette, (v) => this.change("ui", { ...this.now.ui, palette: v as Settings["ui"]["palette"] })),
      this.select("ui.motion", "Motion", MOTIONS.map((m) => [m, MOTION_NAMES[m]]), s.ui.motion, (v) => this.change("ui", { ...this.now.ui, motion: v as Settings["ui"]["motion"] })),
      this.check("ui.contrast", "High contrast: solid black panels, white text and stronger edges", s.ui.contrast, (v) => this.change("ui", { ...this.now.ui, contrast: v })),
      this.select("ui.popups", "Pop-up alerts", POPUPS.map((p) => [p, POPUP_NAMES[p]]), s.ui.popups, (v) => this.change("ui", { ...this.now.ui, popups: v as Settings["ui"]["popups"] })),
    );

    // ---- saving
    const saving = this.section("Saving", "settings-saving");
    saving.append(
      this.select("saving.autosaveMs", "Autosave", AUTOSAVE_CHOICES.map((ms) => [String(ms), autosaveName(ms)]), String(s.saving.autosaveMs), (v) => this.change("saving", { autosaveMs: Number(v) })),
      el("p", "settings-about", "A world is also saved when you quit to the title, when you go up from a city, when you switch to another tab, and when you press Save in the menu."),
    );
    const where = el("p", "settings-place");
    where.append(el("strong", "", "Where your worlds are kept: "), document.createTextNode(deps.place));
    saving.append(where);
    const last = deps.lastSaved?.() ?? null;
    if (last !== null) saving.append(el("p", "settings-last-saved", last));

    this.root.append(this.sound.root, graphics, controls, ui, saving);
    // Changes made elsewhere (a reset, another panel) show here too.
    this.unsubscribe = deps.settings.onChange((next) => this.show(next));
  }

  private get now(): Settings {
    return this.deps.settings.current;
  }

  /** Take the panel down: its listeners go with it. */
  dispose(): void {
    this.listening.abort();
    this.unsubscribe();
    this.root.remove();
  }

  /** Awaiting a key for an action: what a test, or the player, presses next. */
  get awaiting(): { readonly action: ActionId; readonly slot: 0 | 1 } | null {
    return this.waiting;
  }

  private change<K extends keyof Settings>(part: K, next: Settings[K]): void {
    void this.deps.settings.update(part, next);
  }

  private section(title: string, className: string): HTMLElement {
    const s = el("section", `settings-section ${className}`);
    s.setAttribute("aria-label", title);
    s.append(el("h3", "settings-head", title));
    return s;
  }

  private select(key: string, label: string, options: readonly (readonly [string, string])[], value: string, onChange: (v: string) => void): HTMLElement {
    const row = el("label", "settings-row");
    const select = el("select", "settings-select");
    select.dataset["setting"] = key;
    for (const [v, text] of options) {
      const o = el("option", "", text);
      o.value = v;
      select.append(o);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    row.append(el("span", "settings-name", label), select);
    this.controls.set(key, select);
    return row;
  }

  private check(key: string, label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = el("label", "settings-row settings-check");
    const box = el("input", "settings-box");
    box.type = "checkbox";
    box.dataset["setting"] = key;
    box.checked = value;
    box.addEventListener("change", () => onChange(box.checked));
    row.append(box, el("span", "settings-name", label));
    this.controls.set(key, box);
    return row;
  }

  private detailLabel(d: Settings["graphics"]["detail"]): string {
    const costs = this.deps.frameCosts;
    if (d === "auto") return DETAIL_NAMES.auto;
    return `${DETAIL_NAMES[d]} - ${costWords(costs.of(d, true))}`;
  }

  private effectsCost(): string {
    const costs = this.deps.frameCosts;
    const on = costs.of("high", true);
    const off = costs.of("high", false);
    if (on === null && off === null) return "their cost is measured when a city is drawn at High";
    return `at High, on: ${on === null ? "not measured yet" : `${on.toFixed(1)} ms`}, off: ${off === null ? "not measured yet" : `${off.toFixed(1)} ms`} a frame`;
  }

  // ---- keys -------------------------------------------------------------------

  private renderKeys(): void {
    const keys = this.now.controls.keys;
    const rows: HTMLElement[] = [];
    let group = "";
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        const head = el("tr", "settings-key-group");
        const th = el("th", "", group);
        th.colSpan = 3;
        head.append(th);
        rows.push(head);
      }
      const tr = el("tr", "settings-key");
      tr.dataset["action"] = a.id;
      tr.append(el("td", "settings-key-name", a.name));
      for (const slot of [0, 1] as const) {
        const td = el("td", "settings-key-slot");
        const waiting = this.waiting !== null && this.waiting.action === a.id && this.waiting.slot === slot;
        const b = el("button", "settings-key-button", waiting ? "Press a key..." : keyName(keys[a.id][slot]));
        b.type = "button";
        b.dataset["slot"] = String(slot);
        b.setAttribute("aria-label", `${a.name}, ${slot === 0 ? "key" : "other key"}: ${keyName(keys[a.id][slot])}. Change`);
        b.addEventListener("click", () => {
          this.waiting = { action: a.id, slot };
          this.keyNote.textContent = `Press the key for "${a.name}". Any key counts, Esc too.`;
          this.renderKeys();
        });
        td.append(b);
        if (waiting) {
          const cancel = el("button", "settings-key-cancel", "Cancel");
          cancel.type = "button";
          cancel.addEventListener("click", () => {
            this.waiting = null;
            this.keyNote.textContent = "";
            this.renderKeys();
          });
          const clear = el("button", "settings-key-clear", "Clear");
          clear.type = "button";
          clear.addEventListener("click", () => this.bind({ action: a.id, slot }, null));
          td.append(cancel, clear);
        }
        tr.append(td);
      }
      rows.push(tr);
    }
    this.keyList.replaceChildren(...rows);
  }

  private bind(w: Waiting, chord: string | null): void {
    const { bindings, swapped } = rebind(this.now.controls.keys, w.action, w.slot, chord);
    this.waiting = null;
    const name = ACTION_BY_ID[w.action].name;
    this.keyNote.textContent =
      chord === null
        ? `"${name}" has no ${w.slot === 0 ? "key" : "other key"} now.`
        : swapped === null
          ? `"${name}" is ${keyName(chord)}.`
          : `"${name}" is ${keyName(chord)}; "${ACTION_BY_ID[swapped].name}" took its old key, ${keyName(this.now.controls.keys[w.action][w.slot])}.`;
    this.change("controls", { ...this.now.controls, keys: bindings as KeyBindings });
  }

  /** Show `s` without telling anyone: what the panel reads when the settings change. */
  private show(s: Settings): void {
    this.sound.show(s.sound);
    const values: Readonly<Record<string, string | boolean>> = {
      "graphics.detail": s.graphics.detail,
      "graphics.chunks": s.graphics.chunks,
      "graphics.effects": s.graphics.effects,
      "controls.cameraSpeed": String(s.controls.cameraSpeed),
      "controls.edgeScroll": s.controls.edgeScroll,
      "controls.invertZoom": s.controls.invertZoom,
      "controls.scrollPans": s.controls.scrollPans,
      "ui.scale": String(s.ui.scale),
      "ui.palette": s.ui.palette,
      "ui.motion": s.ui.motion,
      "ui.contrast": s.ui.contrast,
      "ui.popups": s.ui.popups,
      "saving.autosaveMs": String(s.saving.autosaveMs),
    };
    for (const [key, v] of Object.entries(values)) {
      const c = this.controls.get(key);
      if (c === undefined) continue;
      if (typeof v === "boolean") (c as HTMLInputElement).checked = v;
      else c.value = v;
    }
    this.renderKeys();
  }
}
