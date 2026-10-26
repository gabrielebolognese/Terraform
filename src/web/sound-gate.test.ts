// @vitest-environment happy-dom

/**
 * Batch 35 through the real components, against the fake `AudioContext`:
 *   - the settings: a volume per channel and mute, kept per player in the
 *     store's index, surviving a reload, reaching the channels' gains;
 *   - the title: its music waits for the player's first gesture;
 *   - the assembled game: silent until a gesture, then the phase's music and
 *     the planet's wind; down in a city, the machinery near the camera; a
 *     building placed through the canvas answered with its sound, once.
 * The engine, the cues, the beds and the music on their own are in
 * `sound.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SimState } from "../sim/index.js";
import { BUILDING_DEFS, NEUTRAL_ENV, advance, cityView, derive, foundSettlement, habitat, marsStart, placeBuilding, worldEnv } from "../sim/index.js";
import { isoProject } from "../render/iso.js";
import { App } from "./app.js";
import { centreCamera, isoToScreen } from "./city-camera.js";
import { FakeAudioContext } from "./fake-audio.js";
import type { FakeGain } from "./fake-audio.js";
import { startGame } from "./game.js";
import type { GameHandle } from "./game.js";
import { BROWSER_TUNING, worldTuning } from "./game-tuning.js";
import { SoundEngine } from "./sound-engine.js";
import { PIECES, pieceFor } from "./sound-music.js";
import { DEFAULT_SOUND, PlayerSettings, SETTINGS_KEY, readSound } from "./sound-settings.js";
import { MemorySaveStore } from "./storage.js";

const T = worldTuning("standard", 0, "standard");
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let listening: AbortController;
beforeEach(() => {
  FakeAudioContext.made = [];
  listening = new AbortController();
});
afterEach(() => {
  listening.abort();
  document.body.replaceChildren();
});

/** The session's engine as `main.ts` makes it, over the fake: listening on the window for the first gesture. */
function engine(): SoundEngine {
  const e = new SoundEngine(() => new FakeAudioContext());
  e.listen(window, listening.signal);
  return e;
}

const gesture = () => window.dispatchEvent(new Event("pointerdown"));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("the sound settings", () => {
  it("read only what is sound in a record: anything missing, out of range or of the wrong kind is the default", () => {
    expect(readSound(null)).toEqual(DEFAULT_SOUND);
    expect(readSound("loud")).toEqual(DEFAULT_SOUND);
    expect(readSound({ sound: 3 })).toEqual(DEFAULT_SOUND);
    expect(readSound({ sound: { music: 0.25, effects: 1.5, ambience: -0.1, interface: "x", master: Number.NaN, muted: "yes" } })).toEqual({ ...DEFAULT_SOUND, music: 0.25 });
    expect(readSound({ sound: { master: 0, music: 1, ambience: 0.5, effects: 0.2, interface: 0.9, muted: true } })).toEqual({ master: 0, music: 1, ambience: 0.5, effects: 0.2, interface: 0.9, muted: true });
  });

  it("are kept per player beside the worlds, and keep what this does not know of the record", async () => {
    const store = new MemorySaveStore(true);
    await store.saveMeta(SETTINGS_KEY, { graphics: { detail: "low" } });
    const a = new PlayerSettings(store);
    expect(await a.load()).toEqual(DEFAULT_SOUND);
    await a.setSound({ ...DEFAULT_SOUND, music: 0.1, muted: true });
    const b = new PlayerSettings(store);
    expect(await b.load()).toEqual({ ...DEFAULT_SOUND, music: 0.1, muted: true });
    expect(await store.loadMeta(SETTINGS_KEY)).toEqual({ graphics: { detail: "low" }, version: 1, sound: { ...DEFAULT_SOUND, music: 0.1, muted: true } });
    // Not in any world's save: a world is written without them.
    expect(await store.loadMeta("worlds")).toBeNull();
  });

  it("play on the defaults when the record cannot be read or written", async () => {
    const broken = { loadMeta: () => Promise.reject(new Error("no")), saveMeta: () => Promise.reject(new Error("no")) };
    const s = new PlayerSettings(broken);
    expect(await s.load()).toEqual(DEFAULT_SOUND);
    await expect(s.setSound({ ...DEFAULT_SOUND, music: 0 })).resolves.toBeUndefined();
    expect(s.sound.music).toBe(0);
  });

  it("set each channel's gain and the master, and mute silences everything", () => {
    const e = new SoundEngine(() => new FakeAudioContext());
    e.setVolumes({ master: 0.5, music: 0.1, ambience: 0.2, effects: 0.3, interface: 0.4, muted: false });
    e.unlock();
    const ctx = FakeAudioContext.made[0]!;
    // The master is the first gain made, into the speakers; then a gain a channel, in CHANNELS order.
    const gains = ctx.nodes.filter((n): n is FakeGain => n.kind === "gain").slice(0, 5);
    expect(gains[0]!.outputs).toEqual([ctx.destination]);
    expect(gains.map((g) => g.gain.last)).toEqual([0.5, 0.1, 0.2, 0.3, 0.4]);
    e.setVolumes({ master: 0.5, music: 0.7, ambience: 0.2, effects: 0.3, interface: 0.4, muted: true });
    expect(gains.map((g) => g.gain.last)).toEqual([0, 0.7, 0.2, 0.3, 0.4]);
  });

  /** The title, over `store`, with the session's engine. */
  async function title(store: MemorySaveStore, sound = engine()): Promise<{ app: App; root: HTMLElement; sound: SoundEngine }> {
    const root = document.createElement("div");
    document.body.append(root);
    const app = new App({
      root,
      store,
      now: () => Date.parse("2026-10-16T12:00:00Z"),
      randomSeed: () => 4242,
      launch: startGame,
      buildExample: () => ({ state: marsStart(7, BROWSER_TUNING), tuning: BROWSER_TUNING }),
      download: () => undefined,
      titleGlobe: false,
      sound,
    });
    await app.start();
    return { app, root, sound };
  }

  const slider = (root: ParentNode, key: string) => root.querySelector<HTMLInputElement>(`.sound-row[data-volume="${key}"] input`)!;

  it("move with their sliders on the Settings screen, are heard at once, and survive a reload", async () => {
    const store = new MemorySaveStore(true);
    const first = await title(store);
    [...first.root.querySelectorAll("button")].find((b) => b.textContent === "Settings")!.click();
    expect(first.app.currentView).toBe("settings");
    expect([...first.root.querySelectorAll(".sound-name")].map((n) => n.textContent)).toEqual(["Master volume", "Music", "Ambience", "Effects", "Interface"]);
    expect(first.root.querySelector(".sound-note")!.textContent).toMatch(/first click or key press/);
    const music = slider(first.root, "music");
    expect(music.value).toBe("60");
    music.value = "25";
    music.dispatchEvent(new Event("input", { bubbles: true }));
    const mute = first.root.querySelector<HTMLInputElement>(".sound-mute-box")!;
    mute.checked = true;
    mute.dispatchEvent(new Event("change", { bubbles: true }));
    expect(first.sound.volumes).toEqual({ ...DEFAULT_SOUND, music: 0.25, muted: true });
    expect(first.root.querySelector(`.sound-row[data-volume="music"] .sound-value`)!.textContent).toBe("25%");
    await first.app.settings.settled();
    first.root.remove();

    // A reload: a new page over the same store, its own engine.
    const second = await title(store, new SoundEngine(() => new FakeAudioContext()));
    expect(second.sound.volumes).toEqual({ ...DEFAULT_SOUND, music: 0.25, muted: true });
    [...second.root.querySelectorAll("button")].find((b) => b.textContent === "Settings")!.click();
    expect(slider(second.root, "music").value).toBe("25");
    expect(second.root.querySelector<HTMLInputElement>(".sound-mute-box")!.checked).toBe(true);
  });

  it("are the session's in a world opened from the title: its music follows that world's phase", async () => {
    const store = new MemorySaveStore(true);
    const root = document.createElement("div");
    document.body.append(root);
    const sound = engine();
    const app = new App({ root, store, now: () => Date.parse("2026-10-16T12:00:00Z"), randomSeed: () => 4242, launch: startGame, buildExample: () => ({ state: marsStart(7, BROWSER_TUNING), tuning: BROWSER_TUNING }), download: () => undefined, titleGlobe: false, sound });
    await app.start();
    expect(sound.musicPiece).toBe(PIECES[0]);
    [...root.querySelectorAll("button")].find((b) => b.textContent === "New world")!.click();
    root.querySelector<HTMLFormElement>("form.new-world")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait(80);
    await app.settled();
    expect(app.currentView).toBe("game");
    try {
      // A new planet is in Phase 1 from its first moments (the title plays Phase 0's piece): the title's
      // engine, handed to the world, plays Thin Light.
      for (let i = 0; i < 40 && sound.musicPiece === PIECES[0]; i += 1) await wait(100);
      expect(sound.musicPiece).toBe(PIECES[1]);
    } finally {
      await app.quitToTitle();
    }
    // Back on the title: Cold Ground again.
    expect(sound.musicPiece).toBe(PIECES[0]);
  });

  it("open in a world's menu too, the same settings", async () => {
    const store = new MemorySaveStore(true);
    const page = await title(store);
    await page.app.settings.setSound({ ...DEFAULT_SOUND, effects: 0.35 });
    page.sound.setVolumes(page.app.settings.sound);
    [...page.root.querySelectorAll("button")].find((b) => b.textContent === "New world")!.click();
    page.root.querySelector<HTMLFormElement>("form.new-world")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait(80);
    await page.app.settled();
    expect(page.app.currentView).toBe("game");
    try {
      page.app.openMenu();
      const menu = page.root.querySelector<HTMLElement>(".game-menu")!;
      const settings = [...menu.querySelectorAll("button")].find((b) => b.textContent === "Settings")!;
      settings.click();
      expect(slider(menu, "effects").value).toBe("35");
      slider(menu, "effects").value = "80";
      slider(menu, "effects").dispatchEvent(new Event("input", { bubbles: true }));
      expect(page.sound.volumes.effects).toBe(0.8);
      settings.click();
      expect(menu.querySelector(".sound-panel"), "closed again").toBeNull();
    } finally {
      await page.app.quitToTitle();
    }
  });

  it("the title's music waits for the first gesture, then starts, plays on, and every button ticks", async () => {
    const store = new MemorySaveStore(true);
    const page = await title(store);
    expect(page.sound.musicPiece).toBe(PIECES[0]);
    [...page.root.querySelectorAll("button")].find((b) => b.textContent === "Credits")!.click();
    expect(FakeAudioContext.made, "audio before a gesture").toHaveLength(0);
    expect(page.root.textContent).toMatch(/Music and sound: made by the game itself/);
    gesture();
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(page.sound.player!.current).toBe(PIECES[0]);
    // No world's frames on the title: the engine's own clock keeps writing the music as time goes on.
    const ctx = FakeAudioContext.made[0]!;
    const later = () => ctx.oscillators(20, Infinity).length;
    expect(later()).toBe(0);
    ctx.currentTime = 25;
    await wait(500);
    expect(later(), "notes written 20 s on").toBeGreaterThan(0);
    [...page.root.querySelectorAll("button")].find((b) => b.textContent === "Back")!.click();
    expect(page.sound.played.get("click")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The assembled game
// ---------------------------------------------------------------------------

describe("the assembled game", () => {
  /** Ares with four solar arrays standing and running. */
  function city(): SimState {
    let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
    let placed = 0;
    for (let r = 4; r < 30 && placed < 4; r += 1) {
      for (let k = 0; k < 8 * r && placed < 4; k += 3) {
        const a = (k / (8 * r)) * 2 * Math.PI;
        const o = placeBuilding(s, "settlement-1", "solar_array", Math.round(46 + r * Math.cos(a)), Math.round(46 + r * Math.sin(a)), T);
        if (o.ok) {
          s = o.state;
          placed += 1;
        }
      }
    }
    for (let i = 0; i < 300 && s.settlements[0]!.jobs.length > 0; i += 1) s = advance(s, 1, cfg);
    return s;
  }

  function play(state: SimState, sound: SoundEngine): { root: HTMLElement; handle: GameHandle } {
    const root = document.createElement("div");
    document.body.append(root);
    // Every speed (the debug setting), so a build can finish within the test.
    const handle = startGame(root, { state, tuning: T, fresh: () => marsStart(undefined, T), sound, debugSpeeds: true }, { save: () => {}, saveDue: () => false, saveFailures: () => 0, onMenu: () => {}, onBackToTitle: () => {} });
    return { root, handle };
  }

  it("is silent until a gesture, then plays the phase's music, the wind, the city's machinery, a building placed and finished, and the alert it brings", async () => {
    const s = city();
    const sound = engine();
    const { root, handle } = play(s, sound);
    const canvas = root.querySelector<HTMLCanvasElement>(".city canvas")!;
    canvas.width = 800;
    canvas.height = 600;
    try {
      await wait(500);
      // Read, not heard: the music (the phase the world has reached) and the wind are chosen, and no context is made.
      expect(s.phaseReached).toBeGreaterThan(0);
      expect(sound.musicPiece).toBe(pieceFor(s.phaseReached));
      expect(sound.ambienceLevels.wind).toBeGreaterThan(0);
      expect(sound.ambienceLevels.machinery).toBe(0);
      expect(FakeAudioContext.made, "audio before a gesture").toHaveLength(0);
      gesture();
      expect(FakeAudioContext.made).toHaveLength(1);
      expect(sound.player!.current).toBe(pieceFor(s.phaseReached));

      // Down to Ares: its machinery near the camera.
      root.querySelector<HTMLButtonElement>(".hud-settlement-open")!.click();
      await wait(3000);
      expect(root.querySelector<HTMLElement>(".city")!.hidden).toBe(false);
      expect(sound.ambienceLevels.machinery).toBeGreaterThan(0);

      // A greenhouse placed through the canvas, as a player would: the place sound, once.
      const now = handle.state;
      const env = habitat(now.reservoirs, derive(now.reservoirs, worldEnv(now, NEUTRAL_ENV, T), T), T, 0);
      const view = cityView(now.settlements[0]!, env, T);
      let spot: { tx: number; ty: number } | null = null;
      for (let r = 3; r < 12 && spot === null; r += 1) {
        for (let k = 0; k < 8 * r; k += 1) {
          const a = (k / (8 * r)) * 2 * Math.PI;
          const tx = Math.round(view.tiles / 2 + r * Math.cos(a));
          const ty = Math.round(view.tiles / 2 + r * Math.sin(a));
          if (placeBuilding(now, "settlement-1", "greenhouse", tx, ty, T).ok) {
            spot = { tx, ty };
            break;
          }
        }
      }
      expect(spot, "somewhere on screen to build").not.toBeNull();
      const before = now.settlements[0]!.buildings.length;
      root.querySelector<HTMLButtonElement>('.city-card[data-type="greenhouse"]')!.click();
      const size = BUILDING_DEFS.greenhouse.footprint;
      const at = { x: spot!.tx + Math.floor((size - 1) / 2) + 0.5, y: spot!.ty + Math.floor((size - 1) / 2) + 0.5 };
      const z = view.groundZ[Math.floor(at.y) * view.tiles + Math.floor(at.x)]!;
      const iso = isoProject(at.x, at.y, z);
      const p = isoToScreen(centreCamera(view.tiles, 800), 800, 600, iso.sx, iso.sy);
      const click = () => {
        canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: p.px, clientY: p.py, pointerId: 1, button: 0 }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: p.px, clientY: p.py, pointerId: 1, button: 0 }));
      };
      click();
      expect(handle.state.settlements[0]!.buildings.length, root.querySelector(".city-hint")?.textContent ?? "").toBe(before + 1);
      expect(sound.played.get("place")).toBe(1);
      // The same place again, the card still chosen, is refused: no sound for a building not placed.
      expect(root.querySelector('.city-card[data-type="greenhouse"]')!.getAttribute("aria-pressed")).toBe("true");
      click();
      await wait(250);
      expect(root.querySelector(".city-hint")!.textContent).toMatch(/^Cannot build: /);
      expect(handle.state.settlements[0]!.buildings.length).toBe(before + 1);
      expect(sound.played.get("place")).toBe(1);
      expect(sound.played.get("built") ?? 0).toBe(0);

      // Fast, until it is finished: its sound once, and - standing on no network - the alert that it is offline.
      [...root.querySelectorAll<HTMLButtonElement>(".hud-speed")].find((b) => b.textContent === "1000x")!.click();
      for (let i = 0; i < 40 && sound.played.get("built") === undefined; i += 1) await wait(100);
      await wait(1200);
      expect(sound.played.get("built")).toBe(1);
      root.querySelector<HTMLButtonElement>(".alerts-toggle")!.click();
      const centre = [...root.querySelectorAll(".alerts-now .alert-title")].map((n) => n.textContent);
      expect(centre.some((t) => /Greenhouse offline in Ares/.test(t ?? "")), centre.join(" | ")).toBe(true);
      expect((sound.played.get("alert") ?? 0) + (sound.played.get("urgent") ?? 0)).toBeGreaterThan(0);
    } finally {
      handle.stop();
    }
  }, 30_000);

  it("chimes for an objective done, with its card", async () => {
    // Batch 30's setting: a hundred people claimed, and the steady supply behind it done the moment it opens.
    let s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
    const g = s.settlements[0]!.buildings.find((b) => b.type === "headquarters")!;
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 400 } })) };
    for (let k = 0; k < 3; k += 1) s = placeBuilding(s, "settlement-1", "habitat_dome", g.tx - 12 + 4 * k, g.ty - 10, T).state;
    s = advance(s, 200, cfg);
    const sample = { index: 0, population: 210, housing: 240, births: 0, deaths: 0, short: [0, 0, 0, 0, 0], stores: [0, 0, 0, 0, 0], net: [0, 0, 0, 0, 0] };
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 100, history: { ...c.history, samples: Array.from({ length: 20 }, () => sample) } })) };
    const sound = engine();
    const { root, handle } = play(s, sound);
    try {
      gesture();
      await wait(400);
      expect(sound.played.get("objective") ?? 0, "nothing on opening the world").toBe(0);
      root.querySelector<HTMLButtonElement>(".objectives-toggle")!.click();
      await wait(300);
      root.querySelector<HTMLButtonElement>('.objective[data-id="city_first"] .objective-claim')!.click();
      await wait(400);
      expect(root.querySelector(".milestone-card")!.textContent).toContain("Objective done: Steady supply");
      expect(sound.played.get("objective")).toBe(1);
    } finally {
      handle.stop();
    }
  });
});
