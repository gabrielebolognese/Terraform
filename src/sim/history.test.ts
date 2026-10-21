/**
 * Batch 31's statistics, in the simulation: the planet's record and a city's
 * production and use.
 *
 * The exit gate's half that is the simulation's: "The history the charts
 * show survives the save and is bounded (measured size after 1,000
 * sim-years)". And the rules every per-substep thing here is held to: the
 * same in any chunks, and changing nothing it records.
 */

import { describe, expect, it } from "vitest";

import { advance } from "./integrate.js";
import { emptyPlanetHistory } from "./history.js";
import { foundSettlement } from "./micro/registry.js";
import { placeBuilding } from "./micro/settlement.js";
import { marsStart } from "./planets/mars.js";
import { SaveError, deserialize, fromSave, serialize, toSave } from "./save.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { Tuning } from "./tuning.js";
import type { BuildingType, SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

const AT = "2026-10-15T10:00:00.000Z";
const SITE = { lat: 0.31, lon: -1.2 } as const;

/** The browser's world, Classic and Standard pace (as `worldTuning` makes them; the sim cannot import the web). */
const BROWSER = { EVENTS_ENABLED: 1, ECONOMY_ENABLED: 1, TECH_GATE_ENABLED: 1, SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1, HEADQUARTERS_ENABLED: 1, BUILD_TIME_ENABLED: 1 } as const;
const CLASSIC = makeTuning(BROWSER);
const STANDARD = makeTuning({ ...BROWSER, TIME_SCALE: DEFAULT_TUNING.TIME_SCALE / 8, SUBSTEP_YEARS: DEFAULT_TUNING.SUBSTEP_YEARS / 8, CITY_CLOCK: 8, BUILD_CURVE_ENABLED: 1 });

const cfgOf = (t: Tuning) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });
const city = (t: Tuning): SimState => foundSettlement(marsStart(undefined, t), "city", SITE.lat, SITE.lon, t, "Ares").state;

describe("the planet's record", () => {
  it("samples a new world every PLANET_HISTORY_EVERY substeps, oldest first", () => {
    const s = advance(city(CLASSIC), 40, cfgOf(CLASSIC));
    expect(s.history.every).toBe(4);
    expect(s.history.samples.map((x) => x.steps)).toEqual([4, 8, 12, 16, 20, 24, 28, 32, 36, 40]);
    // The people are the city's, the bank the economy's: what the HUD shows at that moment.
    const last = s.history.samples.at(-1)!;
    expect(last.people).toBe(s.settlements[0]!.population);
    expect(last.credits).toBe(s.economy.credits);
  });

  it("starts empty, and records nothing with PLANET_HISTORY_EVERY at 0", () => {
    expect(marsStart(undefined, CLASSIC).history).toEqual({ every: 4, samples: [] });
    const off = makeTuning({ ...BROWSER, PLANET_HISTORY_EVERY: 0 });
    expect(advance(city(off), 100, cfgOf(off)).history.samples).toEqual([]);
  });

  it("is reachable at all: a sample's numbers move with the planet", () => {
    // Guards the tests below against a record of constants: the reference policy's planet warms.
    const s = advance(city(CLASSIC), 400, cfgOf(CLASSIC));
    const temps = s.history.samples.map((x) => x.T);
    expect(Math.max(...temps) - Math.min(...temps)).toBeGreaterThan(0);
  });

  it("halves when full: keeps the samples on multiples of twice the gap, then samples half as often", () => {
    const t = makeTuning({ ...BROWSER, PLANET_HISTORY_EVERY: 1, PLANET_HISTORY_SAMPLES: 8 });
    const cfg = cfgOf(t);
    let s = advance(city(t), 7, cfg);
    expect(s.history.samples.map((x) => x.steps)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    s = advance(s, 1, cfg);
    expect(s.history.every).toBe(2);
    expect(s.history.samples.map((x) => x.steps)).toEqual([2, 4, 6, 8]);
    s = advance(s, 8, cfg);
    expect(s.history.every).toBe(4);
    expect(s.history.samples.map((x) => x.steps)).toEqual([4, 8, 12, 16]);
  });

  /**
   * Measured (2026-10-15), a Standard-mode world with a city founded and left
   * to run, and the reference policy on the default tuning: after 1,000
   * sim-years the record holds 125 samples (every 32 substeps in Classic, 256
   * in Standard), 25,203 / 25,331 / 26,258 bytes of JSON - about 202-210 a
   * sample. Full, it holds at most PLANET_HISTORY_SAMPLES - 1 = 239: under
   * 51 kB whatever the length of the game.
   */
  it.each([
    ["Classic", CLASSIC],
    ["Standard", STANDARD],
  ] as const)("stays bounded after 1,000 sim-years (%s), and still begins at the beginning", (_name, t) => {
    const steps = Math.round(1000 / t.SUBSTEP_YEARS);
    const s = advance(city(t), steps, cfgOf(t));
    const h = s.history;
    expect(h.samples.length).toBe(125);
    expect(h.samples.length).toBeLessThan(t.PLANET_HISTORY_SAMPLES);
    expect(h.samples[0]!.steps, "the first sample kept is the first multiple of the gap").toBe(h.every);
    expect(h.samples.at(-1)!.steps).toBe(steps);
    const bytes = JSON.stringify(toSave(s, t, AT).history).length;
    expect(bytes).toBeGreaterThan(24_000);
    expect(bytes).toBeLessThan(26_500);
    expect(bytes / h.samples.length).toBeLessThan(212);
  });

  it("is the same in any chunks: one call, single substeps, and odd pieces", () => {
    const t = STANDARD;
    const cfg = cfgOf(t);
    let s = city(t);
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 400 } })) };
    const whole = advance(s, 600, cfg);
    let ones = s;
    for (let i = 0; i < 600; i += 1) ones = advance(ones, 1, cfg);
    let odd = s;
    for (const n of [7, 13, 1, 99, 250, 230]) odd = advance(odd, n, cfg);
    expect(whole.history.samples.length).toBe(150);
    expect(ones).toEqual(whole);
    expect(odd).toEqual(whole);
  });

  it("changes nothing it records: the same world with and without it, but for the record", () => {
    const off = makeTuning({ ...BROWSER, PLANET_HISTORY_EVERY: 0 });
    const a = advance(city(CLASSIC), 2000, cfgOf(CLASSIC));
    const b = advance(city(off), 2000, cfgOf(off));
    expect(a.history.samples.length).toBeGreaterThan(0);
    expect({ ...a, history: null }).toEqual({ ...b, history: null });
  });
});

describe("the planet's record in the save", () => {
  const played = (): SimState => advance(city(CLASSIC), 300, cfgOf(CLASSIC));

  it("survives the save exactly, and carries on as if never saved", () => {
    const s = played();
    const back = deserialize(serialize(s, CLASSIC, AT), CLASSIC);
    expect(back.history).toEqual(s.history);
    expect(back).toEqual(s);
    expect(advance(back, 333, cfgOf(CLASSIC))).toEqual(advance(s, 333, cfgOf(CLASSIC)));
  });

  it("loads a save from before it (v16): the planet starts recording, a city keeps what it had", () => {
    // Mid-sample: two substeps into a city's year, so the sample gathering began before made and drawn were kept.
    const s = advance(played(), 2, cfgOf(CLASSIC));
    expect(s.settlements[0]!.history.acc.substeps).toBe(2);
    const v17 = toSave(s, CLASSIC, AT) as unknown as Record<string, unknown>;
    // As v16 wrote it: no planet record, and a city's record without made or drawn.
    const v16: Record<string, unknown> = {
      ...v17,
      schema_version: 16,
      settlements: (v17["settlements"] as Record<string, unknown>[]).map((raw) => {
        const h = raw["history"] as Record<string, unknown>;
        const { made: _m, drawn: _d, ...acc } = h["acc"] as Record<string, unknown>;
        void _m;
        void _d;
        const samples = (h["samples"] as Record<string, unknown>[]).map(({ made: _sm, drawn: _sd, ...rest }) => (void _sm, void _sd, rest));
        return { ...raw, history: { ...h, acc, samples } };
      }),
    };
    delete v16["history"];
    const loaded = fromSave(v16, CLASSIC);
    expect(loaded.history).toEqual(emptyPlanetHistory(CLASSIC));
    const c = loaded.settlements[0]!;
    expect(c.history.samples.length).toBe(s.settlements[0]!.history.samples.length);
    expect(c.history.samples.every((x) => x.made === undefined && x.drawn === undefined), "nothing made up for the old samples").toBe(true);
    expect(c.history.acc.made).toBeNull();
    // Carried on: the sample begun before goes without made and drawn; the next has them.
    const on = advance(loaded, 6, cfgOf(CLASSIC)).settlements[0]!.history.samples;
    expect(on.at(-2)!.made).toBeUndefined();
    expect(on.at(-1)!.made).toHaveLength(5);
    expect(advance(loaded, 6, cfgOf(CLASSIC)).history.samples.length).toBeGreaterThan(0);
  });

  it("refuses a save whose planet record is corrupt, naming the field", () => {
    const good = toSave(played(), CLASSIC, AT) as unknown as Record<string, unknown>;
    const h = good["history"] as { every: number; samples: Record<string, number>[] };
    const bad = (history: unknown): string => {
      try {
        fromSave({ ...good, history }, CLASSIC);
      } catch (e) {
        expect(e).toBeInstanceOf(SaveError);
        return (e as Error).message;
      }
      throw new Error("loaded");
    };
    expect(bad({ ...h, every: 0 })).toMatch(/history.every/);
    expect(bad({ ...h, samples: [...h.samples].reverse() })).toMatch(/history.samples\[1\].steps/);
    expect(bad({ ...h, samples: [{ ...h.samples[0]!, steps: 10_000 }] })).toMatch(/not after the world's own time/);
    expect(bad({ ...h, samples: [{ ...h.samples[0]!, T: "warm" }] })).toMatch(/history.samples\[0\].T/);
    expect(bad(null)).toMatch(/history must be an object/);
  });
});

describe("a city's production and use", () => {
  function place(s: SimState, type: BuildingType, tx: number, ty: number, t: Tuning): SimState {
    const o = placeBuilding(s, s.settlements[0]!.id, type, tx, ty, t);
    expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
    return o.state;
  }
  const t = makeTuning({ SETTLEMENTS_ENABLED: 1 });

  it("records what was made and what was drawn: two more solar arrays make twice SOLAR_POWER more", () => {
    const base = foundSettlement(marsStart(undefined, t), "city", 0.3, 1.0, t).state;
    const one = advance(place(place(base, "solar_array", 2, 2, t), "habitat_dome", 2, 6, t), 8, cfgOf(t));
    const three = advance(place(place(place(place(base, "solar_array", 2, 2, t), "habitat_dome", 2, 6, t), "solar_array", 6, 2, t), "solar_array", 9, 2, t), 8, cfgOf(t));
    const power = (s: SimState) => s.settlements[0]!.history.samples.at(-1)!;
    expect(power(three).made![0]! - power(one).made![0]!).toBeCloseTo(2 * t.SOLAR_POWER, 9);
    // The dome draws the same either way.
    expect(power(three).drawn![0]).toBeCloseTo(power(one).drawn![0]!, 9);
    expect(power(one).drawn![0]).toBeGreaterThan(0);
  });
});
