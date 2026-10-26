// @vitest-environment happy-dom

/**
 * Batch 36: the player's settings - what a record may hold, where it is kept,
 * Batch 35's record moved, and the keys: named, bound, swapped, read back.
 * Every setting through the real components is in `settings-gate.test.ts`.
 */

import { afterEach, describe, expect, it } from "vitest";

import type { KeyBindings } from "./keys.js";
import { ACTIONS, ACTION_IDS, DEFAULT_KEYS, actionFor, chordOf, keyName, readKeys, rebind, typing } from "./keys.js";
import { DEFAULT_SETTINGS, PlayerSettings, SETTINGS_KEY, SETTINGS_VERSION, readSettings, settingsRecord } from "./settings.js";
import { DEFAULT_SOUND } from "./sound-settings.js";
import { MemorySaveStore } from "./storage.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("a settings record", () => {
  it("reads every part back as written", () => {
    const s = {
      sound: { ...DEFAULT_SOUND, music: 0.2 },
      graphics: { detail: "low", chunks: "more", effects: false },
      controls: { keys: rebind(DEFAULT_KEYS, "pause", 0, "KeyQ").bindings, cameraSpeed: 2, edgeScroll: true, invertZoom: true, scrollPans: true },
      ui: { scale: 1.25, palette: "blue-yellow", motion: "reduced", contrast: true, popups: "urgent" },
      saving: { autosaveMs: 60_000 },
    } as const;
    const back = readSettings(JSON.parse(JSON.stringify(settingsRecord(s))));
    expect(back).toEqual(s);
    expect(settingsRecord(s)["version"]).toBe(SETTINGS_VERSION);
  });

  it("is untrusted: anything missing, out of range or of the wrong kind is its default, part by part", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings("x")).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ graphics: { detail: "ultra", chunks: 7, effects: "no" } }).graphics).toEqual(DEFAULT_SETTINGS.graphics);
    expect(readSettings({ controls: { cameraSpeed: 1e9, edgeScroll: 1, invertZoom: null } }).controls).toEqual(DEFAULT_SETTINGS.controls);
    expect(readSettings({ ui: { scale: 4, palette: "rainbow", motion: "fast", contrast: "yes", popups: "some" } }).ui).toEqual(DEFAULT_SETTINGS.ui);
    expect(readSettings({ saving: { autosaveMs: 0 } }).saving).toEqual(DEFAULT_SETTINGS.saving);
    // One part wrong leaves the others as written.
    const mixed = readSettings({ ui: { scale: 1.5, palette: 3 }, saving: { autosaveMs: 300_000 } });
    expect(mixed.ui).toEqual({ ...DEFAULT_SETTINGS.ui, scale: 1.5 });
    expect(mixed.saving.autosaveMs).toBe(300_000);
  });
});

describe("the player's own store", () => {
  it("keeps the settings for every world, apart from the worlds and their index", async () => {
    const store = new MemorySaveStore(true);
    const a = new PlayerSettings(store);
    await a.load();
    expect(a.origin).toBe("defaults");
    await a.update("ui", { ...a.current.ui, contrast: true });
    const b = new PlayerSettings(store);
    expect((await b.load()).ui.contrast).toBe(true);
    expect(b.origin).toBe("player");
    expect(await store.loadMeta(SETTINGS_KEY)).toBeNull();
    expect(store.slotNames()).toEqual([]);
  });

  it("moves Batch 35's sound record from the worlds' index, and leaves it where it was", async () => {
    const store = new MemorySaveStore(true);
    // A v1 record exactly as Batch 35 wrote it.
    const v1 = { version: 1, sound: { master: 0.5, music: 0.1, ambience: 0.2, effects: 0.3, interface: 0.4, muted: true } };
    await store.saveMeta(SETTINGS_KEY, v1);
    const s = new PlayerSettings(store);
    const loaded = await s.load();
    expect(s.origin).toBe("moved");
    expect(loaded.sound).toEqual(v1.sound);
    expect({ ...loaded, sound: DEFAULT_SOUND }).toEqual(DEFAULT_SETTINGS);
    await s.settled();
    expect(await store.loadPlayer(SETTINGS_KEY)).toMatchObject({ version: 2, sound: v1.sound });
    // Never deleted: an older game opened on this browser still finds its record.
    expect(await store.loadMeta(SETTINGS_KEY)).toEqual(v1);
    // Once moved, the player's own store wins: a change is not undone by the old record.
    await s.setSound({ ...v1.sound, music: 0.9 });
    const again = new PlayerSettings(store);
    expect((await again.load()).sound.music).toBe(0.9);
    expect(again.origin).toBe("player");
  });

  it("plays on the defaults, and on what is set this session, when the store will not read or write", async () => {
    const broken = { loadPlayer: () => Promise.reject(new Error("no")), savePlayer: () => Promise.reject(new Error("no")) };
    const s = new PlayerSettings(broken);
    expect(await s.load()).toEqual(DEFAULT_SETTINGS);
    expect(s.origin).toBe("unreadable");
    await expect(s.update("graphics", { ...DEFAULT_SETTINGS.graphics, detail: "low" })).resolves.toBeUndefined();
    expect(s.current.graphics.detail).toBe("low");
  });

  it("tells whoever listens of every change and of loading", async () => {
    const store = new MemorySaveStore(true);
    const s = new PlayerSettings(store);
    const heard: string[] = [];
    const stop = s.onChange((x) => heard.push(x.ui.palette));
    await s.load();
    await s.update("ui", { ...s.current.ui, palette: "red-green" });
    stop();
    await s.update("ui", { ...s.current.ui, palette: "standard" });
    expect(heard).toEqual(["standard", "red-green"]);
  });
});

describe("the keys", () => {
  it("every action has a key out of the box, and no key is bound twice", () => {
    const all = ACTION_IDS.flatMap((id) => DEFAULT_KEYS[id].filter((k): k is string => k !== null));
    expect(new Set(all).size).toBe(all.length);
    for (const a of ACTIONS) expect(a.keys[0], a.id).not.toBeNull();
    expect(ACTIONS.map((a) => a.id)).toEqual([...ACTION_IDS]);
  });

  it("are named by where they sit, with Ctrl, Alt and Shift in front; Cmd counts as Ctrl; a modifier alone is no key", () => {
    const e = (code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
    expect(chordOf(e("KeyS", { ctrlKey: true }))).toBe("Ctrl+KeyS");
    expect(chordOf(e("KeyS", { metaKey: true }))).toBe("Ctrl+KeyS");
    expect(chordOf(e("Digit1", { shiftKey: true, altKey: true }))).toBe("Alt+Shift+Digit1");
    expect(chordOf(e("ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(chordOf(e(""))).toBeNull();
    expect(keyName("Ctrl+KeyS")).toBe("Ctrl+S");
    expect(keyName("Escape")).toBe("Esc");
    expect(keyName("ArrowUp")).toBe("Up arrow");
    expect(keyName("Digit3")).toBe("3");
    expect(keyName("Equal")).toBe("=");
    expect(keyName(null)).toBe("none");
  });

  it("find their action", () => {
    expect(actionFor(DEFAULT_KEYS, "Space")).toBe("pause");
    expect(actionFor(DEFAULT_KEYS, "ArrowLeft")).toBe("panLeft");
    expect(actionFor(DEFAULT_KEYS, "Ctrl+KeyS")).toBe("save");
    expect(actionFor(DEFAULT_KEYS, "KeyS")).toBe("panDown");
    expect(actionFor(DEFAULT_KEYS, "KeyZ")).toBeNull();
  });

  it("rebinding a key another action holds swaps the two: no key lost, none bound twice", () => {
    // M is the world map's: give it to Pause, and the world map takes Space.
    const r = rebind(DEFAULT_KEYS, "pause", 0, "KeyM");
    expect(r.swapped).toBe("worldMap");
    expect(r.bindings.pause[0]).toBe("KeyM");
    expect(r.bindings.worldMap[0]).toBe("Space");
    // Moving a key within one action's two slots leaves the other slot empty.
    const within = rebind(DEFAULT_KEYS, "panUp", 1, "KeyW");
    expect(within.swapped).toBeNull();
    expect(within.bindings.panUp).toEqual([null, "KeyW"]);
    // Cleared.
    expect(rebind(DEFAULT_KEYS, "earth", 0, null).bindings.earth).toEqual([null, null]);
    for (const b of [r.bindings, within.bindings]) {
      const all = ACTION_IDS.flatMap((id) => b[id].filter((k): k is string => k !== null));
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it("read from a record are untrusted: a non-key is dropped, a key bound twice keeps its first action, a missing action its default", () => {
    const raw: Record<string, unknown> = { ...JSON.parse(JSON.stringify(DEFAULT_KEYS)) };
    raw["pause"] = ["KeyM", "<script>"];
    delete raw["save"];
    const keys: KeyBindings = readKeys(raw);
    expect(keys.pause).toEqual(["KeyM", null]);
    // The world map comes after Pause: its M is dropped.
    expect(keys.worldMap).toEqual([null, null]);
    expect(keys.save).toEqual(DEFAULT_KEYS.save);
    expect(readKeys("x")).toEqual(DEFAULT_KEYS);
  });

  it("are not shortcuts while the player types or works a control, nor Space and Enter on a button", () => {
    const input = document.createElement("input");
    const slider = document.createElement("input");
    slider.type = "range";
    const b = document.createElement("button");
    const div = document.createElement("div");
    expect(typing(input, "KeyW")).toBe(true);
    expect(typing(input, "Escape")).toBe(false);
    expect(typing(slider, "ArrowLeft")).toBe(true);
    expect(typing(b, "Space")).toBe(true);
    expect(typing(b, "KeyM")).toBe(false);
    expect(typing(div, "Space")).toBe(false);
    expect(typing(null, "Space")).toBe(false);
  });
});
