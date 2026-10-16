// @vitest-environment happy-dom

/**
 * Batch 35's sound, against a fake `AudioContext` that writes down every node,
 * every scheduled value and every note (`fake-audio.ts`):
 *   - no audio before the player's first gesture;
 *   - each effect once per event: a building finished, raised, a rocket up,
 *     a train going by, a building placed, an alert, an objective;
 *   - each bed of ambience following its driver;
 *   - the music by the phase, crossfaded and never cut;
 *   - the simulation the same with sound and without, the state never written.
 * The settings and the assembled game are in `sound-gate.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Derived, SimState } from "../sim/index.js";
import { NEUTRAL_ENV, advance, cityView, claimLand, constructionOf, derive, foundSettlement, habitat, launchRocket, marsStart, placeBuilding, upgradeBuilding, worldEnv } from "../sim/index.js";
import { deepFreeze } from "../testkit/helpers.js";
import { worldTuning } from "./game-tuning.js";
import { FakeAudioContext, FakeGain, FakeOscillator } from "./fake-audio.js";
import { GESTURES, SoundEngine } from "./sound-engine.js";
import { EFFECTS } from "./sound-recipes.js";
import { CROSSFADE_S, PIECES, midiHz, pieceFor } from "./sound-music.js";
import type { Piece } from "./sound-music.js";
import { BEDS, ORBIT_HEARING, SILENCE, machineryFor, rainFor, seaFor, shoreNearness, windFor } from "./sound-ambience.js";
import { SoundWatch, TrainEar } from "./sound-cues.js";
import type { Car } from "./sound-cues.js";
import { ELSEWHERE_HEARD, EFFECTS_PER_LOOK, SoundDirector, planetBeds } from "./sound-director.js";
import type { CityEar } from "./sound-director.js";
import { CHANNELS, DEFAULT_SOUND } from "./sound-settings.js";

const T = worldTuning("standard", 0, "standard");
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };

beforeEach(() => {
  FakeAudioContext.made = [];
});
afterEach(() => {
  document.body.replaceChildren();
});

/** An engine over the fake, let start as a gesture would. */
function started(): { engine: SoundEngine; ctx: FakeAudioContext } {
  const engine = new SoundEngine(() => new FakeAudioContext());
  expect(engine.unlock()).toBe(true);
  return { engine, ctx: FakeAudioContext.made[0]! };
}

/** Ares at 0.31, -1.2 with materials to spare. */
function ares(): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
}

/** The first place on a ring round (46, 46) a building of `type` may stand, and the world with it placed. */
function place(s: SimState, type: Parameters<typeof placeBuilding>[2], from = 4): { state: SimState; tx: number; ty: number } {
  for (let r = from; r < 30; r += 1) {
    for (let k = 0; k < 8 * r; k += 1) {
      const a = (k / (8 * r)) * 2 * Math.PI;
      const tx = Math.round(46 + r * Math.cos(a));
      const ty = Math.round(46 + r * Math.sin(a));
      const o = placeBuilding(s, "settlement-1", type, tx, ty, T);
      if (o.ok) return { state: o.state, tx, ty };
    }
  }
  throw new Error(`nowhere for a ${type}`);
}

const derivedOf = (s: SimState): Derived => derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T);

// ---------------------------------------------------------------------------
// The first gesture
// ---------------------------------------------------------------------------

describe("no audio before the player's first gesture", () => {
  it("makes no AudioContext and plays nothing until a gesture, and drops what was asked rather than saving it up", () => {
    const engine = new SoundEngine(() => new FakeAudioContext());
    const target = new EventTarget();
    engine.listen(target);
    engine.setVolumes(DEFAULT_SOUND);
    engine.setMusic(pieceFor(0));
    engine.setAmbience({ ...SILENCE, wind: 0.5 });
    for (const e of EFFECTS) expect(engine.play(e), e).toBe(false);
    engine.frame();
    expect(FakeAudioContext.made, "a context made before any gesture").toHaveLength(0);
    expect(engine.unlocked).toBe(false);
    expect(engine.dropped).toBe(EFFECTS.length);

    target.dispatchEvent(new Event("pointerdown"));
    expect(FakeAudioContext.made).toHaveLength(1);
    const ctx = FakeAudioContext.made[0]!;
    expect(ctx.resumed).toBe(1);
    // What was asked for before is what starts - the music and the beds - and none of the dropped effects.
    expect(engine.player!.current).toBe(pieceFor(0));
    expect((engine.bed!.level.wind.gain as FakeGain["gain"]).last).toBeGreaterThan(0);
    expect(engine.played.size).toBe(0);
    expect(engine.play("built")).toBe(true);
    // Another gesture makes no second context.
    target.dispatchEvent(new Event("keydown"));
    expect(FakeAudioContext.made).toHaveLength(1);
  });

  it.each(["pointerdown", "keydown", "touchend"])("is let start by a %s", (gesture) => {
    expect(GESTURES).toContain(gesture);
    const engine = new SoundEngine(() => new FakeAudioContext());
    const target = new EventTarget();
    engine.listen(target);
    target.dispatchEvent(new Event("pointermove"));
    target.dispatchEvent(new Event("scroll"));
    expect(FakeAudioContext.made, "something that is not a gesture").toHaveLength(0);
    target.dispatchEvent(new Event(gesture));
    expect(FakeAudioContext.made).toHaveLength(1);
    expect(engine.unlocked).toBe(true);
  });

  it("stays silent, without an error, in a browser with no Web Audio", () => {
    let asked = 0;
    const engine = new SoundEngine(() => {
      asked += 1;
      return null;
    });
    const target = new EventTarget();
    engine.listen(target);
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("pointerdown"));
    expect(engine.unlocked).toBe(false);
    expect(asked, "tried once, not at every click").toBe(1);
    expect(engine.play("click")).toBe(false);
    expect(() => engine.frame()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The effects
// ---------------------------------------------------------------------------

describe("the effects", () => {
  it("each makes its sound on its channel, from now, with every ramp a sound one", () => {
    const { engine, ctx } = started();
    // The master, then a gain a channel in CHANNELS order: the first five made.
    const buses = ctx.nodes.filter((n) => n.kind === "gain").slice(0, 5);
    const world = ["place", "built", "upgraded", "train", "rocket"];
    ctx.currentTime = 5;
    for (const e of EFFECTS) {
      const mark = ctx.nodes.length;
      // The fake refuses an exponential ramp to 0, as the browser does.
      expect(engine.play(e, { gain: 0.5, pan: 0.4 }), e).toBe(true);
      const made = ctx.since(mark);
      const sources = made.filter((n): n is FakeOscillator => n instanceof FakeOscillator);
      expect(made.some((n) => n.kind === "oscillator" || n.kind === "buffer-source"), `${e} makes no sound`).toBe(true);
      for (const o of sources) expect(o.started!, e).toBeGreaterThanOrEqual(5);
      // Placed: the effect's own gain at what it was asked, and the panner.
      const own = made[0] as FakeGain;
      expect(own.gain.events[0]).toEqual({ kind: "set", value: 0.5, time: 5.01 });
      expect(made.some((n) => n.kind === "panner")).toBe(true);
      // The world's effects on the effects channel, the rest on the interface's.
      const panner = own.outputs[0] as FakeGain;
      expect(panner.kind).toBe("panner");
      expect(panner.outputs, e).toEqual([buses[1 + CHANNELS.indexOf(world.includes(e) ? "effects" : "interface")]]);
    }
    expect([...engine.played.values()].every((n) => n === 1)).toBe(true);
  });

  it("hears a building finished, a building raised and a rocket up, each once, where it happened", () => {
    const watch = new SoundWatch();
    let s = ares();
    const placed = place(s, "solar_array");
    s = placed.state;
    const heard: string[] = [];
    const look = () => {
      for (const c of watch.observe(s, T)) heard.push(`${c.kind}@${c.tx},${c.ty}`);
    };
    look();
    // Going up: nothing yet; finished: once; the rover's drive home after: nothing more.
    for (let i = 0; i < 40 && s.settlements[0]!.jobs.length > 0; i += 1) {
      s = advance(s, 1, cfg);
      look();
    }
    expect(heard).toEqual([`built@${placed.tx},${placed.ty}`]);
    s = upgradeBuilding(s, "settlement-1", placed.tx, placed.ty, T).state;
    for (let i = 0; i < 40 && s.settlements[0]!.jobs.length > 0; i += 1) {
      s = advance(s, 1, cfg);
      look();
    }
    expect(heard).toEqual([`built@${placed.tx},${placed.ty}`, `upgraded@${placed.tx},${placed.ty}`]);
    const port = s.settlements[0]!.buildings.find((b) => b.type === "spaceport")!;
    s = launchRocket(s, "settlement-1", port.tx, port.ty, T).state;
    for (let i = 0; i < 80 && s.settlements[0]!.jobs.length > 0; i += 1) {
      look();
      s = advance(s, 1, cfg);
    }
    look();
    expect(heard).toEqual([`built@${placed.tx},${placed.ty}`, `upgraded@${placed.tx},${placed.ty}`, `rocket@${port.tx},${port.ty}`]);
    // The rocket is home: the run had something to hear and heard it all.
    expect(s.settlements[0]!.jobs).toEqual([]);
  });

  it("hears two buildings finished in one look twice, and takes its bearings on a world already under way", () => {
    let s = ares();
    const a = place(s, "solar_array");
    const b = place(a.state, "solar_array", 9);
    s = b.state;
    // Opened mid-build: the first look says nothing, though both are going up.
    const watch = new SoundWatch();
    expect(watch.observe(s, T)).toEqual([]);
    const kinds: string[] = [];
    for (let i = 0; i < 60 && constructionOf(s.settlements[0]!).size > 0; i += 1) {
      s = advance(s, 1, cfg);
      kinds.push(...watch.observe(s, T).map((c) => c.kind));
    }
    expect(kinds).toEqual(["built", "built"]);
    // A building taken down while going up is not "finished".
    let t2 = place(ares(), "solar_array").state;
    const w2 = new SoundWatch();
    w2.observe(t2, T);
    const site = t2.settlements[0]!.buildings.at(-1)!;
    t2 = { ...t2, settlements: t2.settlements.map((c) => ({ ...c, buildings: c.buildings.filter((x) => x !== site), jobs: [] })) };
    expect(w2.observe(t2, T)).toEqual([]);
  });

  it("hears no finish when land claimed west renumbers the ground under a worksite", () => {
    // A building standing, and a worksite the width of a claim east of it: claimed west, the worksite takes the
    // standing one's old numbers - a watch that kept the numbers, not the ground, would hear that one finish.
    let s = ares();
    const shift = T.CLAIM_CHUNK_TILES;
    let pair: { tx: number; ty: number } | null = null;
    for (let ty = 30; ty < 60 && pair === null; ty += 1) {
      for (let tx = 2; tx < 30 && pair === null; tx += 1) {
        const a = placeBuilding(s, "settlement-1", "solar_array", tx, ty, T);
        if (a.ok && placeBuilding(a.state, "settlement-1", "solar_array", tx + shift, ty, T).ok) pair = { tx, ty };
      }
    }
    expect(pair, "two places a claim apart").not.toBeNull();
    s = placeBuilding(s, "settlement-1", "solar_array", pair!.tx, pair!.ty, T).state;
    for (let i = 0; i < 60 && s.settlements[0]!.jobs.length > 0; i += 1) s = advance(s, 1, cfg);
    s = placeBuilding(s, "settlement-1", "solar_array", pair!.tx + shift, pair!.ty, T).state;
    const watch = new SoundWatch();
    expect(watch.observe(s, T)).toEqual([]);
    // Enough people to claim (the run so far has none: no homes).
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 400 })) };
    const claimed = claimLand(s, "settlement-1", -1, 0, T);
    expect(claimed.ok, claimed.reason ?? "").toBe(true);
    s = claimed.state;
    expect(s.settlements[0]!.buildings.some((b) => b.tx === pair!.tx + shift && b.ty === pair!.ty), "the standing one renumbered onto the worksite's old tile").toBe(true);
    const said = (c: { kind: string; tx: number; ty: number }) => `${c.kind}@${c.tx},${c.ty}`;
    const heard: string[] = watch.observe(s, T).map(said);
    for (let i = 0; i < 60 && constructionOf(s.settlements[0]!).size > 0; i += 1) {
      s = advance(s, 1, cfg);
      heard.push(...watch.observe(s, T).map(said));
    }
    expect(heard).toEqual([`built@${pair!.tx + 2 * shift},${pair!.ty}`]);
  });

  it("hears a rocket that landed and went up again between two looks", () => {
    // Room in the stores: a rocket is refused when they are full.
    let s: SimState = { ...ares(), settlements: ares().settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 0 } })) };
    const port = s.settlements[0]!.buildings.find((b) => b.type === "spaceport")!;
    const launch = () => {
      const o = launchRocket(s, "settlement-1", port.tx, port.ty, T);
      expect(o.ok, o.reason ?? "").toBe(true);
      s = o.state;
    };
    launch();
    const watch = new SoundWatch();
    watch.observe(s, T);
    s = advance(s, 3, cfg);
    expect(watch.observe(s, T), "still away").toEqual([]);
    for (let i = 0; i < 80 && s.settlements[0]!.jobs.length > 0; i += 1) s = advance(s, 1, cfg);
    expect(s.settlements[0]!.jobs, "home").toEqual([]);
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 0 } })) };
    launch();
    expect(watch.observe(s, T).map((c) => c.kind)).toEqual(["rocket"]);
  });

  it("plays nothing of what the world does while the example planet shows, but keeps its music and its wind", () => {
    const { engine } = started();
    const director = new SoundDirector(engine, T);
    let s = place(ares(), "solar_array").state;
    for (let i = 0; i < 40; i += 1) {
      director.readout({ state: s, derived: derivedOf(s), storm: 0, seaLevelM: 0, cues: false });
      s = advance(s, 1, cfg);
    }
    expect(engine.played.size).toBe(0);
    expect(engine.musicPiece).toBe(pieceFor(s.phaseReached));
    expect(engine.ambienceLevels.wind).toBeGreaterThan(0);
    // Vacuity: the same run, the player's own, is heard.
    const mine = new SoundDirector(started().engine, T);
    let m = place(ares(), "solar_array").state;
    for (let i = 0; i < 40; i += 1) {
      mine.readout({ state: m, derived: derivedOf(m), storm: 0, seaLevelM: 0, cues: true });
      m = advance(m, 1, cfg);
    }
    expect(mine.engine.played.get("built")).toBe(1);
  });

  it("hears a train once as it comes near, not again until it has gone and come back", () => {
    const ear = new TrainEar();
    const at = (x: number): Car[] => [
      { x, y: 0, train: 7, lead: true },
      { x: x - 1, y: 0, train: 7, lead: false },
    ];
    const listen = { x: 0, y: 0, radius: 10 };
    const passes: number[] = [];
    // Taking bearings in a new city: a train already near is not "coming".
    expect(ear.hear("a", at(2), listen)).toEqual([]);
    expect(ear.hear("a", at(3), listen)).toEqual([]);
    // Away past 9 (0.9 of the radius), then in within 6: heard. Wavering about 6, or lingering out to 9: not again.
    for (const x of [20, 30, 12, 7, 5.9, 6.2, 5.8, 6.3, 8.5, 5.5, 0, -5, -8.9]) passes.push(...ear.hear("a", at(x), listen).map((p) => p.train));
    expect(passes).toEqual([7]);
    // Gone past 9 and back: heard again.
    for (const x of [-9.5, -20, -4]) passes.push(...ear.hear("a", at(x), listen).map((p) => p.train));
    expect(passes).toEqual([7, 7]);
    // Vacuity: one coming from far off is heard at once.
    const fresh = new TrainEar();
    fresh.hear("b", at(40), listen);
    expect(fresh.hear("b", at(4), listen).map((p) => p.train)).toEqual([7]);
  });

  it("plays a train for each that comes near the camera in the city view, placed where it is", () => {
    const { engine } = started();
    const director = new SoundDirector(engine, T);
    let s = ares();
    s = place(s, "solar_array").state;
    const view = cityView(s.settlements[0]!, habitat(s.reservoirs, derivedOf(s), T, 0), T);
    const ear: CityEar = { settlement: "settlement-1", view, x: 46, y: 46, radius: 10, zoom: 1 };
    const cars = (x: number): Car[] => [{ x, y: 46, train: 1, lead: true }];
    director.city(ear, 0, () => cars(80));
    director.city(ear, 50, () => cars(46));
    expect(engine.played.get("train") ?? 0, "within the ear's refresh: not looked at yet").toBe(0);
    director.city(ear, 200, () => cars(50));
    expect(engine.played.get("train")).toBe(1);
    director.city(ear, 400, () => cars(48));
    expect(engine.played.get("train")).toBe(1);
  });

  it("plays a place where it was set down, an alert for what interrupts, and the objective's chime", () => {
    const { engine } = started();
    const director = new SoundDirector(engine, T);
    director.placed("settlement-1", 10, 10, 2, 2);
    director.alerts([{ priority: "urgent" }, { priority: "notice" }, { priority: "record" }, { priority: "record" }]);
    director.milestone("objective");
    director.milestone("phase");
    director.milestone("founded");
    expect(Object.fromEntries(engine.played)).toEqual({ place: 1, urgent: 1, alert: 1, objective: 1, phase: 1, milestone: 1 });
  });

  it("plays at most a few of one effect in a look, spaced, and hears every event up to that", () => {
    const { engine, ctx } = started();
    const director = new SoundDirector(engine, T);
    director.alerts(Array.from({ length: 7 }, () => ({ priority: "notice" as const })));
    expect(engine.played.get("alert")).toBe(EFFECTS_PER_LOOK);
    const starts = ctx.oscillators().map((o) => o.started!);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.5);
  });
});

describe("where an effect is heard from in the city view", () => {
  const view = cityView(ares().settlements[0]!, habitat(marsStart(undefined, T).reservoirs, derivedOf(marsStart(undefined, T)), T, 0), T);
  const director = new SoundDirector(new SoundEngine(() => null), T);
  const ear: CityEar = { settlement: "settlement-1", view, x: 40, y: 40, radius: 18, zoom: 1 };
  director.city(ear, 0, () => []);

  it("is louder near the camera, and left or right as on screen", () => {
    const here = director.heardAt("settlement-1", 40, 40);
    const near = director.heardAt("settlement-1", 46, 40);
    const far = director.heardAt("settlement-1", 70, 40);
    expect(here.gain).toBeCloseTo(1, 9);
    expect(here.gain).toBeGreaterThan(near.gain);
    expect(near.gain).toBeGreaterThan(far.gain);
    // A tile's screen x goes with x - y: +x is to the right, +y to the left.
    expect(director.heardAt("settlement-1", 50, 40).pan).toBeGreaterThan(0);
    expect(director.heardAt("settlement-1", 40, 50).pan).toBeLessThan(0);
    expect(director.heardAt("settlement-1", 45, 45).pan).toBeCloseTo(0, 9);
  });

  it("hears another city's from afar, as from orbit", () => {
    expect(director.heardAt("settlement-2", 40, 40)).toEqual({ gain: ELSEWHERE_HEARD, pan: 0 });
    const orbit = new SoundDirector(new SoundEngine(() => null), T);
    expect(orbit.heardAt("settlement-1", 40, 40)).toEqual({ gain: ELSEWHERE_HEARD, pan: 0 });
  });
});

// ---------------------------------------------------------------------------
// Ambience
// ---------------------------------------------------------------------------

describe("ambience follows its driver", () => {
  it("the wind by pressure, louder and deeper in thicker air, harder in a storm", () => {
    const pressures = [1, 6, 20, 100, 400, 1000, 2000];
    const winds = pressures.map((p) => windFor(p, 0));
    for (let i = 1; i < winds.length; i += 1) {
      expect(winds[i]!.level).toBeGreaterThanOrEqual(winds[i - 1]!.level);
      expect(winds[i]!.hz).toBeLessThanOrEqual(winds[i - 1]!.hz);
    }
    expect(winds[1]!.level).toBeCloseTo(0.18, 9);
    expect(winds[5]!.level).toBeCloseTo(0.75, 9);
    expect(windFor(6, 1).level).toBeCloseTo(0.43, 9);
  });

  it("rain only with clouds over liquid water above freezing; the sea only with a sea, louder at its shore", () => {
    expect(rainFor(0.5, 290, 0.3)).toBeGreaterThan(0.5);
    expect(rainFor(0, 290, 0.3), "no clouds").toBe(0);
    expect(rainFor(0.5, 260, 0.3), "frozen").toBe(0);
    expect(rainFor(0.5, 290, 0), "no water").toBe(0);
    expect(seaFor(0, 1)).toBe(0);
    expect(seaFor(0.3, 1)).toBe(1);
    expect(seaFor(0.3, shoreNearness(-100, 0))).toBe(1);
    expect(seaFor(0.3, shoreNearness(750, 0))).toBeCloseTo(0.5, 9);
    expect(seaFor(0.3, shoreNearness(3000, 0))).toBe(0);
  });

  it("the machinery by what runs near the camera", () => {
    const run = (tx: number, operable = true, activity = 1) => ({ tx, ty: 0, size: 2, operable, activity });
    const ear = { x: 1, y: 1, radius: 12 };
    expect(machineryFor([], ear)).toBe(0);
    expect(machineryFor([run(0, false), run(0, true, 0)], ear), "nothing running").toBe(0);
    const one = machineryFor([run(0)], ear);
    const two = machineryFor([run(0), run(2)], ear);
    const farOne = machineryFor([run(20)], ear);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(farOne).toBeLessThan(one);
    expect(machineryFor([{ ...run(0), construction: 0.5 }], ear), "a worksite").toBe(0);
    expect(machineryFor(Array.from({ length: 400 }, (_, i) => run(i % 4)), ear)).toBeLessThanOrEqual(1);
  });

  it("through the director and the engine: the planet's beds from the world, the machinery from the city, gliding to each", () => {
    const { engine } = started();
    const director = new SoundDirector(engine, T);
    const target = (bed: (typeof BEDS)[number]) => (engine.bed!.level[bed].gain as FakeGain["gain"]).last;
    const bare = marsStart(undefined, T);
    director.readout({ state: bare, derived: derivedOf(bare), storm: 0, seaLevelM: 0, cues: true });
    const thin = windFor(derivedOf(bare).P, 0).level * ORBIT_HEARING.wind;
    expect(engine.ambienceLevels.wind).toBeCloseTo(thin, 12);
    expect(target("wind")).toBeCloseTo(thin * 0.32, 12);
    expect(engine.ambienceLevels.rain).toBe(0);
    expect(engine.ambienceLevels.sea).toBe(0);
    // Thicker air: more wind, at once in the level and the gain's target.
    const thick = { ...bare, reservoirs: { ...bare.reservoirs, co2_atm: bare.reservoirs.co2_atm * 40 } };
    director.readout({ state: thick, derived: derivedOf(thick), storm: 0, seaLevelM: 0, cues: true });
    expect(engine.ambienceLevels.wind).toBeGreaterThan(thin * 1.5);
    expect(target("wind")).toBeCloseTo(engine.ambienceLevels.wind * 0.32, 12);
    // A storm on top.
    director.readout({ state: thick, derived: derivedOf(thick), storm: 1, seaLevelM: 0, cues: true });
    expect(engine.ambienceLevels.wind).toBeCloseTo(windFor(derivedOf(thick).P, 1).level * ORBIT_HEARING.wind, 12);
    // A wet, warm, cloudy world: rain and the sea.
    const wet = { P: 1000, T: 290, oceanFrac: 0.3, cloudFrac: 0.5 };
    expect(planetBeds(wet, 0).rain).toBeGreaterThan(0.5);
    // Down in a city: its machinery near the camera; the planet's beds heard in full, not from afar.
    let s = ares();
    for (let i = 0; i < 4; i += 1) s = place(s, "solar_array", 4 + i * 3).state;
    for (let i = 0; i < 200 && s.settlements[0]!.jobs.length > 0; i += 1) s = advance(s, 1, cfg);
    const view = cityView(s.settlements[0]!, habitat(s.reservoirs, derivedOf(s), T, 0), T);
    expect(view.buildings.some((b) => b.operable && b.activity > 0), "the city has something running").toBe(true);
    director.readout({ state: s, derived: derivedOf(s), storm: 0, seaLevelM: -9000, cues: true });
    const fromOrbit = engine.ambienceLevels.wind;
    director.city({ settlement: "settlement-1", view, x: 46, y: 46, radius: 18, zoom: 1 }, 0, () => []);
    expect(engine.ambienceLevels.machinery).toBeGreaterThan(0.05);
    expect(target("machinery")).toBeCloseTo(engine.ambienceLevels.machinery * 0.22, 12);
    expect(engine.ambienceLevels.wind).toBeCloseTo(fromOrbit / ORBIT_HEARING.wind, 12);
    // Far from every building: quieter.
    const close = engine.ambienceLevels.machinery;
    director.city({ settlement: "settlement-1", view, x: 46 + 60, y: 46 - 60, radius: 18, zoom: 1 }, 1000, () => []);
    expect(engine.ambienceLevels.machinery).toBeLessThan(close / 4);
    // Back to orbit: no machinery.
    director.orbit();
    expect(engine.ambienceLevels.machinery).toBe(0);
    expect(target("machinery")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------

/** The pitch classes a piece may play, over its root. */
const classesOf = (p: Piece): Set<number> => new Set(p.scale.map((n) => ((n % 12) + 12) % 12));
const classOf = (hz: number, p: Piece): number => ((Math.round(12 * Math.log2(hz / 440) + 69) - p.root) % 12 + 12) % 12;
/** A note's pitch: the first value its oscillator was set to. */
const hzOf = (o: FakeOscillator): number => {
  const e = o.frequency.events.find((x) => x.kind === "set");
  return e !== undefined && e.kind === "set" ? e.value : NaN;
};
/** The notes the music wrote into `voice` (its input), started from `from` to `to`. */
const notes = (ctx: FakeAudioContext, voice: unknown, from: number, to: number): FakeOscillator[] =>
  ctx.nodes.filter((n): n is FakeOscillator => {
    if (!(n instanceof FakeOscillator) || n.started === null || n.started < from || n.started >= to) return false;
    // A note goes oscillator -> (filter ->) its envelope -> the voice's input.
    const reaches = (node: unknown, hops: number): boolean =>
      node === voice || (hops > 0 && ((node as { outputs?: unknown[] }).outputs ?? []).some((o) => reaches(o, hops - 1)));
    return reaches(n, 3);
  });

describe("the music changes with the phase", () => {
  it("is colder and sparser at the start, warmer and fuller as the planet greens", () => {
    expect(PIECES.map((p) => p.phase)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < PIECES.length; i += 1) {
      const [a, b] = [PIECES[i - 1]!, PIECES[i]!];
      expect(b.tempo, `${b.name} tempo`).toBeGreaterThan(a.tempo);
      expect(b.pad.cutoff, `${b.name} brightness`).toBeGreaterThan(a.pad.cutoff);
      expect(b.melody.chance, `${b.name} notes`).toBeGreaterThan(a.melody.chance);
      expect(b.glints, `${b.name} glints`).toBeLessThanOrEqual(a.glints);
    }
    // Every chord tone in its mode; minor (a minor third over the root) at the start, major at the end.
    for (const p of PIECES) for (const c of p.chords) for (const n of c) expect(classesOf(p).has(((n % 12) + 12) % 12), `${p.name} ${n}`).toBe(true);
    expect(classesOf(PIECES[0]!).has(3)).toBe(true);
    expect(classesOf(PIECES[0]!).has(4)).toBe(false);
    expect(classesOf(PIECES[6]!).has(4)).toBe(true);
    expect(pieceFor(-1)).toBe(PIECES[0]);
    expect(pieceFor(9)).toBe(PIECES[6]);
  });

  it("plays only its piece's notes, crossfades to the next phase's over the crossfade and never cuts", () => {
    const { engine, ctx } = started();
    const director = new SoundDirector(engine, T);
    const bare = marsStart(undefined, T);
    const run = (until: number) => {
      while (ctx.currentTime < until) {
        ctx.currentTime = Math.round((ctx.currentTime + 0.1) * 10) / 10;
        engine.frame();
      }
    };
    director.readout({ state: bare, derived: derivedOf(bare), storm: 0, seaLevelM: 0, cues: true });
    expect(engine.musicPiece).toBe(PIECES[0]);
    run(30);
    const coldVoice = engine.player!.voicesNow()[0]!;
    const cold = notes(ctx, coldVoice.input, 0, 30);
    expect(cold.length, "notes written in 30 s").toBeGreaterThan(10);
    for (const o of cold) expect(classesOf(PIECES[0]!).has(classOf(hzOf(o), PIECES[0]!)), `${hzOf(o)} Hz`).toBe(true);
    const oldOut = coldVoice.out.gain as FakeGain["gain"];

    // The planet reaches First Water.
    const later = { ...bare, phaseReached: 3 as SimState["phaseReached"] };
    const at = ctx.currentTime;
    director.readout({ state: later, derived: derivedOf(later), storm: 0, seaLevelM: 0, cues: true });
    expect(engine.musicPiece).toBe(PIECES[3]);
    expect(engine.player!.sounding).toBe(2);
    // The old piece ramps down from where it was to nothing over the crossfade - no drop to 0 at the change.
    const fade = oldOut.events.filter((e) => e.time >= at);
    expect(fade.some((e) => e.kind === "set" && e.value === 0), "cut").toBe(false);
    expect(fade.at(-1)).toEqual({ kind: "linear", value: 0, time: at + CROSSFADE_S });
    const warmVoice = engine.player!.voicesNow()[1]!;
    const newOut = warmVoice.out.gain as FakeGain["gain"];
    expect(newOut.events).toEqual([
      { kind: "set", value: 0, time: at },
      { kind: "linear", value: 1, time: at + CROSSFADE_S },
    ]);
    run(at + CROSSFADE_S + 30);
    // After the fade, only First Water's notes are written; the old one is let go.
    const warm = notes(ctx, warmVoice.input, 0, Infinity);
    expect(warm.length).toBeGreaterThan(10);
    for (const o of warm) expect(classesOf(PIECES[3]!).has(classOf(hzOf(o), PIECES[3]!)), `${hzOf(o)} Hz`).toBe(true);
    // During the fade both write; after it, the cold piece writes nothing more.
    expect(notes(ctx, coldVoice.input, at, at + CROSSFADE_S).length).toBeGreaterThan(0);
    expect(notes(ctx, warmVoice.input, at, at + CROSSFADE_S).length).toBeGreaterThan(0);
    expect(notes(ctx, coldVoice.input, at + CROSSFADE_S, Infinity)).toEqual([]);
    // A tune, not one note held.
    expect(new Set(warm.map(hzOf)).size).toBeGreaterThan(3);
    expect(engine.player!.sounding).toBe(1);
    // And the same world again changes nothing.
    const voices = engine.player!.voicesNow();
    director.readout({ state: later, derived: derivedOf(later), storm: 0, seaLevelM: 0, cues: true });
    expect(engine.player!.voicesNow()).toEqual(voices);
    expect(midiHz(69)).toBe(440);
  });
});

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

describe("the sound reads the state and never writes it", () => {
  /** A scripted run - two buildings, an upgrade, a rocket - looked at by the sound every substep, or not at all. */
  function scripted(listen: SoundDirector | null): SimState {
    let s = ares();
    const a = place(s, "solar_array");
    s = place(a.state, "greenhouse", 9).state;
    let upgraded = false;
    let launched = false;
    for (let i = 0; i < 120; i += 1) {
      if (listen !== null) {
        const frozen = deepFreeze(s);
        listen.readout({ state: frozen, derived: derivedOf(frozen), storm: 0.2, seaLevelM: 0, cues: true });
        const view = cityView(frozen.settlements[0]!, habitat(frozen.reservoirs, derivedOf(frozen), T, 0), T);
        listen.city({ settlement: "settlement-1", view, x: 46, y: 46, radius: 18, zoom: 1 }, i * 200, () => [{ x: 46 + ((i * 3) % 40) - 20, y: 46, train: 1, lead: true }]);
      }
      if (!upgraded && constructionOf(s.settlements[0]!).size === 0 && s.settlements[0]!.jobs.length === 0) {
        s = upgradeBuilding(s, "settlement-1", a.tx, a.ty, T).state;
        upgraded = true;
      } else if (upgraded && !launched && s.settlements[0]!.jobs.length === 0) {
        const port = s.settlements[0]!.buildings.find((b) => b.type === "spaceport")!;
        s = launchRocket(s, "settlement-1", port.tx, port.ty, T).state;
        launched = true;
      }
      s = advance(s, 1, cfg);
    }
    return s;
  }

  it("leaves the world the same to the bit with sound on and off, through a run it heard", () => {
    const { engine } = started();
    const director = new SoundDirector(engine, T);
    const heard = scripted(director);
    const silent = scripted(null);
    expect(heard).toEqual(silent);
    // Vacuity: the run gave the sound something to do.
    expect(engine.played.get("built")).toBe(2);
    expect(engine.played.get("upgraded")).toBe(1);
    expect(engine.played.get("rocket")).toBe(1);
    expect(engine.played.get("train") ?? 0).toBeGreaterThan(0);
  });
});
