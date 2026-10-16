// @vitest-environment happy-dom

/**
 * Batch 36's exit gate, through the real components:
 *   - every setting changes what it says, and survives a reload: the title's
 *     Settings screen and a world's menu, the App, `startGame`, the city,
 *     the planner, the map and the planet;
 *   - no setting changes the simulation: the same world, played frame by
 *     frame with every setting away from its default, comes out the same.
 * The page's colours and their second cue are in `settings-cues.test.ts`;
 * the settings record and the keys on their own in `settings.test.ts`.
 *
 * Frames and the clock are driven by hand (`Frames`), so a camera moved by a
 * held key or the screen's edge moves a known distance.
 */

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SimState } from "../sim/index.js";
import { NEUTRAL_ENV, advance, foundSettlement, marsStart, placeBuilding } from "../sim/index.js";
import { App } from "./app.js";
import { startGame } from "./game.js";
import type { GameHandle, GameOptions } from "./game.js";
import { KEY_PAN_PX, KEY_ZOOM_STEP } from "./game.js";
import { BROWSER_TUNING, worldTuning } from "./game-tuning.js";
import { EDGE_SPEED_PX } from "./city.js";
import { setWaitingForKey } from "./keys.js";
import { CHUNK_PIXELS, DEFAULT_SETTINGS, PlayerSettings } from "./settings.js";
import { SettingsPanel } from "./settings-panel.js";
import { FrameCosts } from "./frame-costs.js";
import type { Settings } from "./settings.js";
import { MemorySaveStore } from "./storage.js";

const T = worldTuning("standard", 0, "standard");
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Animation frames and `performance.now` by hand: each step is `ms` of the page's time. */
class Frames {
  t = 10_000;
  private readonly queue = new Map<number, FrameRequestCallback>();
  private next = 0;

  install(): void {
    vi.spyOn(performance, "now").mockImplementation(() => this.t);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      this.next += 1;
      this.queue.set(this.next, cb);
      return this.next;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      this.queue.delete(id);
    });
  }

  step(n = 1, ms = 16): void {
    for (let k = 0; k < n; k += 1) {
      this.t += ms;
      const due = [...this.queue.values()];
      this.queue.clear();
      for (const cb of due) cb(this.t);
    }
  }
}

/** A 2D context that draws nothing, so the city's whole frame - its level of detail, its pictures - runs in happy-dom. */
function nullContext(counted: { fills: number }): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string | symbol, unknown>> = {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "fill") return () => (counted.fills += 1);
      if (key === "measureText") return () => ({ width: 10 });
      if (key === "getImageData" || key === "createImageData") return (w = 1, h = 1) => ({ data: new Uint8ClampedArray(4 * Math.max(1, w) * Math.max(1, h)), width: w, height: h });
      return () => new Proxy({}, handler);
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

let frames: Frames;
const realGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  frames = new Frames();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  HTMLCanvasElement.prototype.getContext = realGetContext;
  setWaitingForKey(false);
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-test]").forEach((s) => s.remove());
  const html = document.documentElement;
  html.removeAttribute("data-palette");
  html.removeAttribute("data-contrast");
  html.removeAttribute("data-motion");
  html.style.removeProperty("--ui-scale");
});

/** The city's canvases get a context that draws nothing but counts its fills; the planet's none (it would draw in software). */
function drawCities(): { fills: number } {
  const counted = { fills: 0 };
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== "2d" || this.classList.contains("globe-canvas")) return null;
    return nullContext(counted);
  } as typeof HTMLCanvasElement.prototype.getContext;
  return counted;
}

/** The game's stylesheet on the page, as the browser has it. */
function styles(): void {
  const style = document.createElement("style");
  style.dataset["test"] = "";
  style.textContent = readFileSync("src/web/style.css", "utf8");
  document.head.append(style);
}

const key = (code: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}, type: "keydown" | "keyup" = "keydown") =>
  window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true, ...mods }));
const press = (code: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => {
  key(code, mods);
  key(code, mods, "keyup");
};

/** The title, over `store`. */
async function title(store: MemorySaveStore, now: () => number = () => Date.parse("2026-10-16T12:00:00Z")): Promise<{ app: App; root: HTMLElement }> {
  const root = document.createElement("div");
  document.body.append(root);
  const app = new App({ root, store, now, randomSeed: () => 4242, launch: startGame, buildExample: () => ({ state: marsStart(7, BROWSER_TUNING), tuning: BROWSER_TUNING }), download: () => undefined, titleGlobe: false });
  await app.start();
  return { app, root };
}

const buttonNamed = (root: ParentNode, name: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;
const control = (root: ParentNode, setting: string) => root.querySelector<HTMLInputElement & HTMLSelectElement>(`[data-setting="${setting}"]`)!;

/** Set a control as the player would: a choice picked, a box ticked. */
function choose(root: ParentNode, setting: string, value: string | boolean): void {
  const c = control(root, setting);
  expect(c, setting).not.toBeNull();
  if (typeof value === "boolean") c.checked = value;
  else {
    expect([...(c as HTMLSelectElement).options].map((o) => o.value), setting).toContain(value);
    c.value = value;
  }
  c.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Every setting away from its default, as a player would set them on the Settings screen. */
const AWAY: readonly (readonly [string, string | boolean])[] = [
  ["graphics.detail", "low"],
  ["graphics.chunks", "fewer"],
  ["graphics.effects", false],
  ["controls.cameraSpeed", "2"],
  ["controls.edgeScroll", true],
  ["controls.invertZoom", true],
  ["controls.scrollPans", true],
  ["ui.scale", "1.25"],
  ["ui.palette", "red-green"],
  ["ui.motion", "reduced"],
  ["ui.contrast", true],
  ["ui.popups", "urgent"],
  ["saving.autosaveMs", "60000"],
];

// ---------------------------------------------------------------------------
// The Settings screen: every setting kept, through a reload
// ---------------------------------------------------------------------------

describe("the Settings screen", () => {
  it("has every part - sound, graphics, controls with every key, the interface and saving - and where the worlds are kept", async () => {
    const store = new MemorySaveStore(true);
    const { root } = await title(store);
    buttonNamed(root, "Settings").click();
    expect([...root.querySelectorAll(".settings-head")].map((h) => h.textContent)).toEqual(["Graphics", "Controls", "Interface", "Saving"]);
    expect(root.querySelector(".sound-panel")).not.toBeNull();
    for (const [setting] of AWAY) expect(control(root, setting), setting).not.toBeNull();
    // Every shortcut listed, with its keys.
    const rows = [...root.querySelectorAll<HTMLElement>(".settings-key")];
    expect(rows.map((r) => r.dataset["action"])).toContain("pause");
    expect(rows.length).toBe(21);
    const pause = rows.find((r) => r.dataset["action"] === "pause")!;
    expect([...pause.querySelectorAll(".settings-key-button")].map((b) => b.textContent)).toEqual(["Space", "none"]);
    expect(root.querySelector(".settings-place")!.textContent).toContain(store.place);
    expect(store.place).toMatch(/this browser's storage for this site/);
  });

  it("keeps every setting, set on the title, through a reload - shown as set, and at work", async () => {
    const store = new MemorySaveStore(true);
    const first = await title(store);
    buttonNamed(first.root, "Settings").click();
    for (const [setting, value] of AWAY) choose(first.root, setting, value);
    // A key: Pause moved to Q.
    const pauseKey = first.root.querySelector<HTMLButtonElement>('.settings-key[data-action="pause"] .settings-key-button[data-slot="0"]')!;
    pauseKey.click();
    expect(first.root.querySelector<HTMLButtonElement>('.settings-key[data-action="pause"] .settings-key-button[data-slot="0"]')!.textContent).toBe("Press a key...");
    press("KeyQ");
    expect(first.app.settings.current.controls.keys.pause).toEqual(["KeyQ", null]);
    expect(first.root.querySelector(".settings-key-note")!.textContent).toBe('"Pause or resume" is Q.');
    const set = first.app.settings.current;
    expect(set).toEqual({
      ...DEFAULT_SETTINGS,
      graphics: { detail: "low", chunks: "fewer", effects: false },
      controls: { ...DEFAULT_SETTINGS.controls, keys: set.controls.keys, cameraSpeed: 2, edgeScroll: true, invertZoom: true, scrollPans: true },
      ui: { scale: 1.25, palette: "red-green", motion: "reduced", contrast: true, popups: "urgent" },
      saving: { autosaveMs: 60_000 },
    });
    await first.app.settings.settled();
    first.root.remove();

    // A reload: a new page over the same store.
    const second = await title(store);
    expect(second.app.settings.current).toEqual(set);
    // The interface is on the page before any screen is opened.
    const html = document.documentElement;
    expect(html.dataset["palette"]).toBe("red-green");
    expect(html.dataset["contrast"]).toBe("high");
    expect(html.dataset["motion"]).toBe("reduced");
    expect(html.style.getPropertyValue("--ui-scale")).toBe("1.25");
    buttonNamed(second.root, "Settings").click();
    for (const [setting, value] of AWAY) {
      const c = control(second.root, setting);
      if (typeof value === "boolean") expect(c.checked, setting).toBe(value);
      else expect(c.value, setting).toBe(value);
    }
    expect(second.root.querySelector<HTMLButtonElement>('.settings-key[data-action="pause"] .settings-key-button[data-slot="0"]')!.textContent).toBe("Q");
  });

  it("a key taken from another action swaps them, any key counts (Esc too), Clear empties a slot, Reset keys puts every key back", async () => {
    const store = new MemorySaveStore(true);
    const { app, root } = await title(store);
    buttonNamed(root, "Settings").click();
    const slot = (action: string, n: 0 | 1) => root.querySelector<HTMLButtonElement>(`.settings-key[data-action="${action}"] .settings-key-button[data-slot="${n}"]`)!;
    slot("pause", 0).click();
    press("KeyM");
    expect(app.settings.current.controls.keys.pause[0]).toBe("KeyM");
    expect(app.settings.current.controls.keys.worldMap[0]).toBe("Space");
    expect(root.querySelector(".settings-key-note")!.textContent).toMatch(/"World map" took its old key, Space/);
    slot("earth", 1).click();
    press("Escape");
    // Esc was the menu's: the menu takes Earth's empty slot.
    expect(app.settings.current.controls.keys.earth).toEqual(["KeyE", "Escape"]);
    expect(app.settings.current.controls.keys.menu[0]).toBeNull();
    slot("earth", 0).click();
    root.querySelector<HTMLButtonElement>(".settings-key-clear")!.click();
    expect(app.settings.current.controls.keys.earth[0]).toBeNull();
    buttonNamed(root, "Reset keys").click();
    expect(app.settings.current.controls.keys).toEqual(DEFAULT_SETTINGS.controls.keys);
    expect(slot("pause", 0).textContent).toBe("Space");
  });
});

// ---------------------------------------------------------------------------
// In a world
// ---------------------------------------------------------------------------

/** Ares: a city a little way into the game. */
function ares(): SimState {
  let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
  s = advance(s, 40, cfg);
  return s;
}

/** A world played on its own page, frame by frame, with `settings` as the player's. */
function play(state: SimState, settings: { current: Settings }, extra: Partial<GameOptions> = {}): { root: HTMLElement; handle: GameHandle; saves: { n: number } } {
  const root = document.createElement("div");
  document.body.append(root);
  const saves = { n: 0 };
  const handle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T), debugSpeeds: true, settings, ...extra }, {
    save: () => {},
    saveDue: () => false,
    saveFailures: () => 0,
    onMenu: () => {},
    onBackToTitle: () => {},
    saveNow: () => {
      saves.n += 1;
      return Promise.resolve("Saved.");
    },
  });
  return { root, handle, saves };
}

/** Down to the first settlement, through its Open button, frames stepped until it is there. */
function goDown(root: HTMLElement, handle: GameHandle): void {
  root.querySelector<HTMLButtonElement>(".hud-settlement-open")!.click();
  for (let i = 0; i < 200 && handle.views.city.root.hidden; i += 1) frames.step();
  expect(handle.views.city.root.hidden, "down in the city").toBe(false);
  const canvas = root.querySelector<HTMLCanvasElement>(".city canvas")!;
  canvas.width = 800;
  canvas.height = 600;
  frames.step(2);
}

const settingsOf = (patch: (s: Settings) => Settings = (s) => s): { current: Settings } => ({ current: patch(DEFAULT_SETTINGS) });

describe("the keys, in a world", () => {
  it("pause and the speeds, the panels, the world map and Save do what their buttons do; not while the player types", () => {
    frames.install();
    const { root, handle, saves } = play(ares(), settingsOf());
    try {
      frames.step(3);
      expect(handle.speed).toBe(1);
      press("Space");
      expect(handle.speed).toBe(0);
      press("Space");
      expect(handle.speed).toBe(1);
      press("Digit3");
      expect(handle.speed).toBe(3);
      press("Digit4");
      expect(handle.speed).toBe(10);
      press("Space");
      press("Space");
      expect(handle.speed, "resumes at the speed it had").toBe(10);
      press("Digit1");
      // Typing in a field is typing, not a shortcut.
      const field = document.createElement("input");
      root.append(field);
      field.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));
      expect(handle.speed).toBe(1);
      const open = (sel: string) => !root.querySelector<HTMLElement>(sel)!.hidden;
      press("KeyN");
      expect(open(".alerts-panel")).toBe(true);
      press("KeyC");
      expect(open(".statistics-panel"), "statistics, and alerts closed").toBe(true);
      expect(open(".alerts-panel")).toBe(false);
      press("KeyC");
      expect(open(".statistics-panel")).toBe(false);
      press("KeyE");
      expect(open(".earth-panel")).toBe(true);
      press("KeyO");
      expect(open(".objectives-panel")).toBe(true);
      press("KeyM");
      expect(handle.views.worldMap.isOpen).toBe(true);
      press("KeyM");
      expect(handle.views.worldMap.isOpen).toBe(false);
      press("KeyS", { ctrlKey: true });
      expect(saves.n).toBe(1);
    } finally {
      handle.stop();
    }
  });

  it("a key the player moved works at once, and the old one no longer does", () => {
    frames.install();
    const settings = settingsOf();
    const { handle } = play(ares(), settings);
    try {
      frames.step(2);
      settings.current = { ...settings.current, controls: { ...settings.current.controls, keys: { ...settings.current.controls.keys, pause: ["KeyQ", null] } } };
      press("Space");
      expect(handle.speed).toBe(1);
      press("KeyQ");
      expect(handle.speed).toBe(0);
    } finally {
      handle.stop();
    }
  });

  it("move and zoom the camera in a city, at the player's camera speed; turn the planet in orbit; the planner and the map too", () => {
    drawCities();
    frames.install();
    const settings = settingsOf();
    const { root, handle } = play(ares(), settings);
    try {
      frames.step(2);
      // In orbit, the planet turns.
      const yaw0 = handle.views.globe.currentPose().yaw;
      key("KeyD");
      frames.step(10);
      key("KeyD", {}, "keyup");
      const turned = handle.views.globe.currentPose().yaw - yaw0;
      expect(turned).toBeGreaterThan(0.1);

      goDown(root, handle);
      const city = handle.views.city;
      const moved = (speed: number): number => {
        settings.current = { ...settings.current, controls: { ...settings.current.controls, cameraSpeed: speed } };
        const before = city.cameraNow!;
        key("KeyD");
        frames.step(10);
        key("KeyD", {}, "keyup");
        frames.step(2);
        const after = city.cameraNow!;
        return (after.cx - before.cx) * after.zoom;
      };
      // Ten frames of 16 ms held: 0.16 s at 600 px a second, measured on screen.
      expect(moved(1)).toBeCloseTo(KEY_PAN_PX * 0.16, 3);
      expect(moved(2)).toBeCloseTo(2 * KEY_PAN_PX * 0.16, 3);
      const z0 = city.cameraNow!.zoom;
      press("Equal");
      expect(city.cameraNow!.zoom / z0).toBeCloseTo(KEY_ZOOM_STEP, 6);
      press("Minus");
      expect(city.cameraNow!.zoom).toBeCloseTo(z0, 6);

      // The planner (P), its map moved by the same keys.
      press("KeyP");
      expect(handle.views.planner.openId).not.toBeNull();
      const p0 = handle.views.planner.placement;
      key("KeyS");
      frames.step(5);
      key("KeyS", {}, "keyup");
      expect(handle.views.planner.placement.oy - p0.oy).toBeCloseTo(-2 * KEY_PAN_PX * 0.08, 3);
      press("KeyP");
      expect(handle.views.planner.openId).toBeNull();
      expect(city.root.hidden).toBe(false);

      // Back to orbit (B), then the map (M), moved by the keys.
      press("KeyB");
      for (let i = 0; i < 200 && handle.views.globe.currentPose() && !city.root.hidden; i += 1) frames.step();
      for (let i = 0; i < 200 && root.querySelector(".hud-settlement-open") !== null && (handle.views.globe as unknown as { posed: boolean }).posed; i += 1) frames.step();
      press("KeyM");
      expect(handle.views.worldMap.isOpen).toBe(true);
      frames.step(2);
      const m0 = handle.views.worldMap.camera!;
      key("KeyA");
      frames.step(5);
      key("KeyA", {}, "keyup");
      const m1 = handle.views.worldMap.camera!;
      expect((m0.x - m1.x) * m1.scale).toBeCloseTo(2 * KEY_PAN_PX * 0.08, 3);
    } finally {
      handle.stop();
    }
  });
});

describe("the mouse, the trackpad and touch, in a city", () => {
  /** A wheel as a browser sends it: happy-dom's leaves out where the pointer is and the Ctrl key, so they are put in. */
  function wheel(target: Element, deltaY: number, mods: { ctrlKey?: boolean; deltaX?: number } = {}): void {
    const e = new WheelEvent("wheel", { deltaY, deltaX: mods.deltaX ?? 0, bubbles: true, cancelable: true });
    for (const [k, v] of [["clientX", 400], ["clientY", 300], ["ctrlKey", mods.ctrlKey ?? false]] as const) Object.defineProperty(e, k, { value: v });
    target.dispatchEvent(e);
  }

  it("the wheel zooms out, or in with Invert zoom; with two fingers to move the map it moves the view, and a pinch zooms", () => {
    drawCities();
    frames.install();
    const settings = settingsOf();
    const { root, handle } = play(ares(), settings);
    try {
      frames.step(2);
      goDown(root, handle);
      const city = handle.views.city;
      const canvas = root.querySelector<HTMLCanvasElement>(".city canvas")!;
      const z0 = city.cameraNow!.zoom;
      wheel(canvas, 100);
      const out = city.cameraNow!.zoom;
      expect(out).toBeLessThan(z0);
      settings.current = { ...settings.current, controls: { ...settings.current.controls, invertZoom: true } };
      wheel(canvas, 100);
      expect(city.cameraNow!.zoom).toBeCloseTo(z0, 6);
      // Two fingers on a trackpad: the view moves and the zoom stays.
      settings.current = { ...settings.current, controls: { ...settings.current.controls, scrollPans: true } };
      const c0 = city.cameraNow!;
      wheel(canvas, 50, { deltaX: 30 });
      const c1 = city.cameraNow!;
      expect(c1.zoom).toBe(c0.zoom);
      expect((c1.cx - c0.cx) * c1.zoom).toBeCloseTo(30, 6);
      expect((c1.cy - c0.cy) * c1.zoom).toBeCloseTo(50, 6);
      // A trackpad's pinch (the wheel with Ctrl) zooms whatever the setting: fingers apart come closer.
      wheel(canvas, -20, { ctrlKey: true });
      expect(city.cameraNow!.zoom).toBeGreaterThan(c1.zoom);

      // A touch screen: two fingers pinched apart zoom in, about the point between them.
      const z1 = city.cameraNow!.zoom;
      const touch = (type: string, id: number, x: number) => canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: 300, bubbles: true }));
      touch("pointerdown", 1, 350);
      touch("pointerdown", 2, 450);
      touch("pointermove", 2, 550);
      expect(city.cameraNow!.zoom / z1).toBeCloseTo(2, 6);
      const placed = handle.state.settlements[0]!.buildings.length;
      touch("pointerup", 2, 550);
      touch("pointerup", 1, 350);
      expect(handle.state.settlements[0]!.buildings.length, "a pinch places nothing").toBe(placed);
    } finally {
      handle.stop();
    }
  });

  it("edge scrolling moves the view while the pointer rests at the edge, at the camera speed; off, it stays", () => {
    drawCities();
    frames.install();
    const settings = settingsOf();
    const { root, handle } = play(ares(), settings);
    try {
      frames.step(2);
      goDown(root, handle);
      const city = handle.views.city;
      const canvas = root.querySelector<HTMLCanvasElement>(".city canvas")!;
      canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 795, clientY: 300, bubbles: true }));
      const rest = (): number => {
        const before = city.cameraNow!;
        frames.step(10);
        return (city.cameraNow!.cx - before.cx) * city.cameraNow!.zoom;
      };
      expect(rest(), "off: the view stays").toBe(0);
      settings.current = { ...settings.current, controls: { ...settings.current.controls, edgeScroll: true } };
      frames.step(1);
      expect(rest()).toBeCloseTo(EDGE_SPEED_PX * 0.16, 3);
      settings.current = { ...settings.current, controls: { ...settings.current.controls, cameraSpeed: 3 } };
      expect(rest()).toBeCloseTo(3 * EDGE_SPEED_PX * 0.16, 3);
      // Away from the edge, it stops.
      canvas.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 400, clientY: 300, bubbles: true }));
      expect(rest()).toBe(0);
    } finally {
      handle.stop();
    }
  });

  it("the planet zooms with the wheel, the other way with Invert zoom", () => {
    frames.install();
    const settings = settingsOf();
    const { root, handle } = play(ares(), settings);
    try {
      frames.step(2);
      const canvas = root.querySelector<HTMLCanvasElement>(".globe-canvas")!;
      const z0 = handle.views.globe.currentPose().zoom;
      wheel(canvas, 100);
      expect(handle.views.globe.currentPose().zoom).toBeLessThan(z0);
      settings.current = { ...settings.current, controls: { ...settings.current.controls, invertZoom: true } };
      wheel(canvas, 100);
      expect(handle.views.globe.currentPose().zoom).toBeCloseTo(z0, 9);
    } finally {
      handle.stop();
    }
  });
});

describe("graphics, in a city", () => {
  it("the detail, the pictures kept and the moving details reach the city's drawing; each frame's cost is kept under its level, and the settings show it", () => {
    const counted = drawCities();
    frames.install();
    const settings = settingsOf();
    const costs = new FrameCosts();
    const { root, handle } = play(ares(), settings, { frameCosts: costs });
    try {
      frames.step(2);
      goDown(root, handle);
      const city = handle.views.city;
      // Auto: by what is on screen - close in on a few tiles, High; the whole world in view, less.
      const zoomed = (steps: number, factor: number): void => {
        for (let k = 0; k < steps; k += 1) city.zoomStep(factor);
        frames.step(1);
      };
      zoomed(12, 1.5);
      expect(city.quality).toBe("high");
      zoomed(30, 1 / 1.5);
      const far = city.quality;
      expect(far).not.toBe("high");
      // Held at a level, the zoom does not move it.
      for (const detail of ["low", "medium", "high"] as const) {
        settings.current = { ...settings.current, graphics: { ...settings.current.graphics, detail } };
        frames.step(1);
        expect(city.quality, detail).toBe(detail);
        zoomed(30, 1.5);
        expect(city.quality, `${detail}, zoomed in`).toBe(detail);
        zoomed(30, 1 / 1.5);
        expect(city.quality, `${detail}, zoomed out`).toBe(detail);
        expect(costs.frames(detail), detail).toBeGreaterThan(0);
      }
      zoomed(12, 1.5);
      for (const chunks of ["fewer", "more", "standard"] as const) {
        settings.current = { ...settings.current, graphics: { ...settings.current.graphics, chunks } };
        frames.step(1);
        expect(city.pictureBudget, chunks).toBe(CHUNK_PIXELS[chunks]);
      }
      // Moving details: once the pictures are made, a frame with them on fills the lights and the steam again; off, it does not.
      const fillsPerFrame = (effects: boolean): number => {
        settings.current = { ...settings.current, graphics: { ...settings.current.graphics, detail: "high", effects } };
        frames.step(30);
        const before = counted.fills;
        frames.step(5);
        return (counted.fills - before) / 5;
      };
      const on = fillsPerFrame(true);
      const off = fillsPerFrame(false);
      expect(on, "moving details drawn every frame").toBeGreaterThan(0);
      expect(off).toBeLessThan(on);
      expect(costs.frames("high", false)).toBeGreaterThan(0);

      // The Settings panel says what each level cost here.
      const panel = new SettingsPanel({ settings: new PlayerSettings(new MemorySaveStore(true)), soundUnlocked: true, frameCosts: costs, place: "here" });
      const options = [...panel.root.querySelectorAll<HTMLOptionElement>('[data-setting="graphics.detail"] option')].map((o) => o.textContent);
      for (const level of ["High", "Medium", "Low"]) expect(options.find((o) => o!.startsWith(level)), level).toMatch(/ - about [\d.]+ ms a frame here$/);
      expect(panel.root.querySelector('[data-setting="graphics.effects"]')!.parentElement!.textContent).toMatch(/at High, on: [\d.]+ ms, off: [\d.]+ ms a frame/);
      panel.dispose();
    } finally {
      handle.stop();
    }
  });

  it("not yet measured, the settings say so", async () => {
    const { root } = await title(new MemorySaveStore(true));
    buttonNamed(root, "Settings").click();
    const options = [...root.querySelectorAll<HTMLOptionElement>('[data-setting="graphics.detail"] option')].map((o) => o.textContent);
    expect(options).toEqual(["Auto - by how much is on screen", "High - not measured yet - open a city", "Medium - not measured yet - open a city", "Low - not measured yet - open a city"]);
  });
});

// ---------------------------------------------------------------------------
// The interface on the page
// ---------------------------------------------------------------------------

/** A new world opened from the title, its game's handle. */
async function newWorld(app: App, root: HTMLElement): Promise<GameHandle> {
  buttonNamed(root, "New world").click();
  root.querySelector<HTMLFormElement>("form.new-world")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  for (let i = 0; i < 50 && app.currentView !== "game"; i += 1) await wait(20);
  await app.settled();
  expect(app.currentView).toBe("game");
  return (app as unknown as { game: { handle: GameHandle } }).game.handle;
}

describe("the interface, on the page", () => {
  it("sizes the panels and never the planet or the city; swaps the colours that mean something; makes the panels solid; stills the interface", async () => {
    styles();
    const store = new MemorySaveStore(true);
    const { app, root } = await title(store);
    const style = (sel: string) => getComputedStyle(root.querySelector<HTMLElement>(sel)!);
    await newWorld(app, root);
    try {
      // As it comes: everything at its size, the standard colours, the panels as they were, things that move.
      expect(style(".shell-hud").zoom).toBe("1");
      expect(style('.hud-metric-status[data-state="below-minimum"]').color).toBe("#e3b46e");
      expect(style(".game-menu-button").transitionDuration).not.toBe("0.001ms");

      await app.settings.update("ui", { scale: 1.25, palette: "red-green", motion: "reduced", contrast: true, popups: "all" });
      expect(style(".shell-hud").zoom).toBe("1.25");
      expect(style(".game-bar").zoom).toBe("1.25");
      // The planet and the city keep their size: a click lands where it did.
      expect(style(".stage").zoom).not.toBe("1.25");
      expect(style(".city-canvas").zoom).not.toBe("1.25");
      expect(style(".city-panel").zoom).toBe("1.25");
      expect(style('.hud-metric-status[data-state="below-minimum"]').color).toBe("#f0e442");
      app.openMenu();
      expect(style(".game-menu-panel").backgroundColor).toBe("#000");
      expect(style(".game-menu-panel").zoom).toBe("1.25");
      expect(style(".game-menu-button").transitionDuration).toBe("0.001ms");
      app.closeMenu();

      await app.settings.update("ui", { scale: 1, palette: "blue-yellow", motion: "full", contrast: false, popups: "all" });
      expect(style('.hud-metric-status[data-state="below-minimum"]').color).toBe("#ff9db5");
      expect(style(".shell-hud").zoom).toBe("1");
    } finally {
      await app.quitToTitle();
    }
  });

  it("Motion on Auto follows the system's own setting", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q }));
    const { app } = await title(new MemorySaveStore(true));
    expect(app.settings.current.ui.motion).toBe("auto");
    expect(document.documentElement.dataset["motion"]).toBe("reduced");
    await app.settings.update("ui", { ...app.settings.current.ui, motion: "full" });
    expect(document.documentElement.dataset["motion"]).toBe("full");
  });
});

describe("reduced motion, in a world", () => {
  it("going down to a city is a cut, not a flight; the planet does not turn by itself", () => {
    frames.install();
    const run = (motion: "reduced" | "full"): { framesDown: number; spun: number } => {
      const { root, handle } = play(ares(), settingsOf((s) => ({ ...s, ui: { ...s.ui, motion } })));
      try {
        frames.step(2);
        const yaw = handle.views.globe.currentPose().yaw;
        frames.step(400);
        const spun = handle.views.globe.currentPose().yaw - yaw;
        root.querySelector<HTMLButtonElement>(".hud-settlement-open")!.click();
        let n = 0;
        while (handle.views.city.root.hidden && n < 300) {
          frames.step();
          n += 1;
        }
        return { framesDown: n, spun };
      } finally {
        handle.stop();
      }
    };
    const full = run("full");
    const reduced = run("reduced");
    // The flight is 1.2 s: 75 frames of 16 ms; a cut, the next frame or so.
    expect(full.framesDown).toBeGreaterThanOrEqual(75);
    expect(reduced.framesDown).toBeLessThanOrEqual(2);
    expect(full.spun, "6.4 s idle: the planet turns").toBeGreaterThan(0.05);
    expect(reduced.spun).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/** An autosave is written a moment after the frame that asks for it, outside the App's queue: wait for it and the queue. */
async function written(app: App): Promise<void> {
  await wait(5);
  await app.settled();
}

/** A store that counts its writes of worlds. */
class CountingStore extends MemorySaveStore {
  writes = 0;
  override save(slot: string, data: Parameters<MemorySaveStore["save"]>[1]): Promise<void> {
    this.writes += 1;
    return super.save(slot, data);
  }
}

describe("saving", () => {
  it("autosaves at the player's interval, read as the world plays", async () => {
    frames.install();
    const store = new CountingStore(true);
    let now = Date.parse("2026-10-16T12:00:00Z");
    const { app, root } = await title(store, () => now);
    await app.settings.update("saving", { autosaveMs: 60_000 });
    await newWorld(app, root);
    try {
      frames.step(2);
      await written(app);
      const first = store.writes;
      expect(first, "saved on opening").toBeGreaterThan(0);
      now += 20_000;
      frames.step(1);
      await written(app);
      expect(store.writes, "20 s on, a minute's interval: not yet").toBe(first);
      now += 41_000;
      frames.step(1);
      await written(app);
      expect(store.writes, "61 s on: saved").toBe(first + 1);
      // Changed while playing: 15 s counts at once.
      await app.settings.update("saving", { autosaveMs: 15_000 });
      now += 16_000;
      frames.step(1);
      await written(app);
      expect(store.writes).toBe(first + 2);
    } finally {
      await app.quitToTitle();
    }
  });

  it("the menu says where the worlds are kept and when this one was last saved; Save and the Save key write it now", async () => {
    frames.install();
    const store = new CountingStore(true);
    let now = Date.parse("2026-10-16T12:00:00Z");
    const { app, root } = await title(store, () => now);
    await newWorld(app, root);
    try {
      frames.step(2);
      await written(app);
      now += 42_000;
      app.openMenu();
      const menu = root.querySelector<HTMLElement>(".game-menu")!;
      expect(menu.querySelector(".game-menu-place")!.textContent).toBe(store.place);
      expect(menu.querySelector(".game-menu-saved")!.textContent).toBe("Last saved 42 seconds ago.");
      const before = store.writes;
      buttonNamed(menu, "Save").click();
      await app.settled();
      await wait(0);
      expect(store.writes).toBe(before + 1);
      expect(menu.querySelector(".game-menu-saved")!.textContent).toBe("Last saved just now.");
      expect(menu.querySelector(".front-notice")!.textContent).toBe("Saved.");
      app.closeMenu();
      // Ctrl+S, from the world.
      press("KeyS", { ctrlKey: true });
      await app.settled();
      await wait(0);
      expect(store.writes).toBe(before + 2);
      const note = root.querySelector<HTMLElement>(".game-saved-note")!;
      expect(note.hidden).toBe(false);
      expect(note.textContent).toBe("Saved.");
    } finally {
      await app.quitToTitle();
    }
  });

  it("the Example planet says nothing is saved, to the Save key as to the menu", async () => {
    frames.install();
    const store = new CountingStore(true);
    const { app, root } = await title(store);
    buttonNamed(root, "Example planet").click();
    for (let i = 0; i < 50 && app.currentView !== "game"; i += 1) await wait(20);
    await app.settled();
    try {
      frames.step(2);
      press("KeyS", { ctrlKey: true });
      await wait(0);
      expect(root.querySelector(".game-saved-note")!.textContent).toBe("Nothing is saved on the Example planet.");
      app.openMenu();
      expect(root.querySelector(".game-menu-saved")!.textContent).toBe("Nothing here is saved.");
      expect(root.querySelector<HTMLElement>(".game-menu-place")!.hidden).toBe(true);
      expect(store.writes).toBe(0);
    } finally {
      await app.quitToTitle();
    }
  });
});

// ---------------------------------------------------------------------------
// In the menu
// ---------------------------------------------------------------------------

describe("the Settings in a world's menu", () => {
  it("are the same settings; a key bound there takes Esc without closing the menu, and works once the menu is closed; kept through a reload", async () => {
    frames.install();
    const store = new MemorySaveStore(true);
    const { app, root } = await title(store);
    const handle = await newWorld(app, root);
    try {
      frames.step(2);
      app.openMenu();
      const menu = root.querySelector<HTMLElement>(".game-menu")!;
      buttonNamed(menu, "Settings").click();
      choose(menu, "controls.cameraSpeed", "3");
      expect(app.settings.current.controls.cameraSpeed).toBe(3);
      // Pause moved to Esc: the menu's key, taken while the panel waits - the menu stays.
      menu.querySelector<HTMLButtonElement>('.settings-key[data-action="pause"] .settings-key-button[data-slot="0"]')!.click();
      press("Escape");
      expect(root.querySelector(".game-menu"), "the menu is still open").not.toBeNull();
      expect(app.settings.current.controls.keys.pause[0]).toBe("Escape");
      expect(app.settings.current.controls.keys.menu[0]).toBe("Space");
      // Space now opens and closes the menu; Esc pauses.
      press("Space");
      expect(root.querySelector(".game-menu"), "Space closed the menu").toBeNull();
      expect(handle.speed).toBe(1);
      press("Escape");
      expect(handle.speed).toBe(0);
      await app.settings.settled();
    } finally {
      await app.quitToTitle();
    }
    root.remove();
    const again = await title(store);
    expect(again.app.settings.current.controls.cameraSpeed).toBe(3);
    expect(again.app.settings.current.controls.keys.pause[0]).toBe("Escape");
  });
});

// ---------------------------------------------------------------------------
// Pop-up alerts
// ---------------------------------------------------------------------------

describe("pop-up alerts", () => {
  /** Ares with a greenhouse placed out on its own, on no network: finished during play, "Greenhouse offline" - a notice. */
  function worksite(): SimState {
    let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
    const hq = s.settlements[0]!.buildings.find((b) => b.type === "headquarters")!;
    for (let r = 8; r < 30; r += 1) {
      const o = placeBuilding(s, "settlement-1", "greenhouse", hq.tx + r, hq.ty + r, T);
      if (o.ok) return o.state;
    }
    throw new Error("nowhere to build a greenhouse");
  }

  it("all that interrupt, urgent ones only, or none: the Alerts panel keeps every one", () => {
    frames.install();
    const state = worksite();
    const seen = (popups: Settings["ui"]["popups"]): { toasts: string[]; centre: string[] } => {
      const { root, handle } = play(state, settingsOf((s) => ({ ...s, ui: { ...s.ui, popups } })));
      try {
        frames.step(2);
        [...root.querySelectorAll<HTMLButtonElement>(".hud-speed")].find((b) => b.textContent === "1000x")!.click();
        // At 1000x the greenhouse goes up and stands offline within these frames, the same in every run.
        frames.step(400);
        expect(handle.state.settlements[0]!.jobs.length, "the greenhouse is finished").toBe(0);
        const toasts = [...root.querySelectorAll(".alert-toast .alert-title")].map((n) => n.textContent ?? "");
        root.querySelector<HTMLButtonElement>(".alerts-toggle")!.click();
        return { toasts, centre: [...root.querySelectorAll(".alerts-now .alert-title")].map((n) => n.textContent ?? "") };
      } finally {
        handle.stop();
      }
    };
    const all = seen("all");
    expect(all.toasts.some((t) => /Greenhouse offline in Ares/.test(t)), all.toasts.join(" | ")).toBe(true);
    for (const popups of ["urgent", "none"] as const) {
      const quiet = seen(popups);
      expect(quiet.toasts.some((t) => /Greenhouse offline/.test(t)), popups).toBe(false);
      expect(quiet.centre.some((t) => /Greenhouse offline in Ares/.test(t)), `${popups}: in the panel`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// No setting changes the simulation
// ---------------------------------------------------------------------------

describe("no setting changes the simulation", () => {
  it("the same world, played the same frames with every setting away from its default and the camera moved, comes out the same", () => {
    drawCities();
    frames.install();
    const away: Settings = {
      ...DEFAULT_SETTINGS,
      graphics: { detail: "low", chunks: "fewer", effects: false },
      controls: { ...DEFAULT_SETTINGS.controls, cameraSpeed: 3, edgeScroll: true, invertZoom: true, scrollPans: true },
      ui: { scale: 1.5, palette: "blue-yellow", motion: "reduced", contrast: true, popups: "none" },
      saving: { autosaveMs: 300_000 },
    };
    const start = ares();
    const run = (settings: Settings, fiddle: boolean): { state: SimState; t: number } => {
      const t0 = frames.t;
      const { root, handle } = play(start, { current: settings });
      try {
        frames.step(2);
        press("Digit3");
        root.querySelector<HTMLButtonElement>(".hud-settlement-open")!.click();
        // The same frames either way: the flight down (or the cut) inside them.
        frames.step(100);
        if (fiddle) {
          key("KeyD");
          frames.step(20);
          key("KeyD", {}, "keyup");
          press("Equal");
          root.querySelector(".city canvas")!.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 2, clientY: 300, bubbles: true }));
          frames.step(200);
        } else frames.step(220);
        expect(handle.views.city.root.hidden, "down in the city").toBe(false);
        return { state: handle.state, t: frames.t - t0 };
      } finally {
        handle.stop();
      }
    };
    const plain = run(DEFAULT_SETTINGS, false);
    frames.t = 10_000;
    const set = run(away, true);
    expect(set.t).toBe(plain.t);
    expect(set.state.steps, "the world moved on").toBeGreaterThan(start.steps);
    expect(set.state).toEqual(plain.state);
  });
});
