/**
 * Batch 31's exit gate, the alerts' half: "Every alert type fires in a
 * scripted run that causes it, and does not fire in one that does not
 * (vacuity both ways). Alerts are derived from state changes inside the
 * readout, never stored as truth."
 *
 * Each scripted run plays a real Standard world through `advance` and looks
 * at it as the browser does, a look every half second of real time. Each
 * type has a run that causes it and one beside it, alike but for the cause,
 * that must stay quiet.
 */

import { describe, expect, it } from "vitest";

import type { BuildingType, HabitatChannels, SimState, Tuning } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  advance,
  claimObjective,
  connectAll,
  constructionOf,
  derive,
  eventsBeginningIn,
  foundSettlement,
  habitat,
  liquidWaterRate,
  makeTuning,
  marsStart,
  nextSubstepFlows,
  placeBuilding,
  removeBuilding,
  serialize,
  deserialize,
  simYear,
  upgradeBuilding,
  worldEnv,
} from "../sim/index.js";
import { channels, fixture, rising, t as FLOOD_T } from "../testkit/flood.js";
import type { Alert, AlertKind } from "./alerts.js";
import { AlertWatch, buildingAt, conditions, stormAlert } from "./alerts.js";
import { ALERT_QUIET_MS, STORM_WARN_SECONDS } from "./config.js";
import { worldTuning } from "./game-tuning.js";

const T = worldTuning("standard", 0, "standard");
const cfg = (t: Tuning) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });
const envOf = (s: SimState, t: Tuning): HabitatChannels => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t, liquidWaterRate(nextSubstepFlows(s, cfg(t))));
const kinds = (list: readonly Alert[]): AlertKind[] => [...new Set(list.map((a) => a.kind))].sort();

/** A Standard world with a city founded: its headquarters at 46,46, its spaceport at 51,47. */
function founded(t: Tuning = T): SimState {
  const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t, "Ares").state;
  // Materials enough for every placement a run makes (a city starts with 250).
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 5000 } })) };
}
const ID = "settlement-1";
const city = (s: SimState) => s.settlements[0]!;

/** Somewhere it may stand: the first of a ring of places round the headquarters that takes it. */
function place(s: SimState, type: BuildingType, near: readonly [number, number] = [46, 46], t: Tuning = T): SimState {
  for (let r = 4; r < 30; r += 1) {
    for (let k = 0; k < 8 * r; k += 1) {
      const a = (k / (8 * r)) * 2 * Math.PI;
      const o = placeBuilding(s, ID, type, Math.round(near[0] + r * Math.cos(a)), Math.round(near[1] + r * Math.sin(a)), t);
      if (o.ok) return o.state;
    }
  }
  throw new Error(`nowhere for a ${type}`);
}

/** Everything placed built: substeps until nothing is going up and no rover is out (at most `cap`). */
function settle(s: SimState, t: Tuning = T, cap = 600): SimState {
  let out = s;
  for (let i = 0; i < cap; i += 1) {
    if (constructionOf(city(out)).size === 0 && city(out).jobs.length === 0) return out;
    out = advance(out, 1, cfg(t));
  }
  throw new Error("still building");
}

/** Join everything up; already joined (everything touching) is as good. */
function connect(s: SimState, t: Tuning = T): SimState {
  const o = connectAll(s, ID, t);
  if (!o.ok) expect(o.reason, "connect").toMatch(/already is/);
  return o.state;
}

/**
 * Play `steps` substeps, looking at the world after each as the browser
 * does (half a second of real time apart): everything that came fresh, and
 * the last look's conditions.
 */
function play(s0: SimState, steps: number, t: Tuning = T, watch = new AlertWatch(), between?: (s: SimState, i: number) => SimState) {
  let s = s0;
  let now = 0;
  const look = () => watch.observe({ state: s, env: envOf(s, t), liquidRatePerYear: liquidWaterRate(nextSubstepFlows(s, cfg(t))), tuning: t, now: (now += 500) });
  const first = look();
  const fresh: Alert[] = [];
  /** Every condition that held at any look, by key. */
  const seen = new Map(first.now.map((a) => [a.key, a] as const));
  let last = first;
  for (let i = 0; i < steps; i += 1) {
    if (between !== undefined) s = between(s, i);
    s = advance(s, 1, cfg(t));
    last = look();
    fresh.push(...last.fresh);
    for (const a of last.now) seen.set(a.key, a);
  }
  return { state: s, first, fresh, now: last.now, seen };
}

/** The city's stores, changed: a store run dry is the cause a scripted run sets. */
const stores = (s: SimState, change: Partial<Record<"power" | "water" | "oxygen" | "food" | "materials", number>>, population?: number): SimState => ({
  ...s,
  settlements: s.settlements.map((c, i) => (i === 0 ? { ...c, stores: { ...c.stores, ...change }, ...(population === undefined ? {} : { population }) } : c)),
});

/** A powered city: a solar array and a dome, connected and built (one dome's 3 and the spaceport's 2 against the array's 6). */
function powered(): SimState {
  let s = place(founded(), "solar_array");
  s = place(s, "habitat_dome");
  return settle(connect(s));
}

describe("each alert fires in a run that causes it, and not in one that does not", () => {
  it("a blackout: two more domes on one solar array, its store run dry; not with a second array beside them", () => {
    const base = powered();
    const short = stores(settle(connect(place(place(base, "habitat_dome"), "habitat_dome"))), { power: 0 });
    const fed = stores(settle(connect(place(place(place(base, "habitat_dome"), "habitat_dome"), "solar_array"))), { power: 0 });
    const dark = play(short, 8);
    const lit = play(fed, 8);
    const blackout = dark.seen.get(`blackout:${ID}`);
    expect(blackout, `blackout in ${JSON.stringify([...dark.seen.keys()])}`).toBeDefined();
    expect(blackout!.title).toBe("Blackout in Ares");
    expect(blackout!.priority).toBe("urgent");
    expect(blackout!.text).toMatch(/^Power is short\. \d+ buildings? (is|are) off for it\. Build a power plant, or lay a power cable to one\.$/);
    expect(blackout!.target).toMatchObject({ kind: "city", id: ID });
    expect([...lit.seen.values()].map((a) => a.kind)).not.toContain("blackout");
    expect(kinds(lit.fresh)).not.toContain("blackout");
  });

  it("a blackout that begins while watched is fresh; one already so on opening the world is only listed", () => {
    const fed = stores(settle(connect(place(place(place(powered(), "habitat_dome"), "habitat_dome"), "solar_array"))), { power: 0 });
    const arrays = city(fed).buildings.filter((b) => b.type === "solar_array");
    const dark = removeBuilding(fed, ID, arrays[1]!.tx, arrays[1]!.ty).state;
    // Opened on a blackout: the first look takes its bearings.
    const opened = play(dark, 2);
    expect(kinds(opened.first.now)).toContain("blackout");
    expect(opened.first.fresh).toEqual([]);
    expect(kinds(opened.fresh)).not.toContain("blackout");
    // Watched as the second array is pulled down: the blackout begins under the player's eyes.
    const watch = new AlertWatch();
    expect(kinds(play(fed, 2, T, watch).now)).not.toContain("blackout");
    expect(play(dark, 1, T, watch).first.fresh.map((a) => a.kind)).toContain("blackout");
  });

  it("a shortage of water: three domes of people and the tanks dry; not with a Water Extractor to fill them", () => {
    // Three domes draw 6 a year; the headquarters makes 3. Two more arrays keep the power up.
    const base = settle(connect(place(place(place(place(powered(), "habitat_dome"), "habitat_dome"), "solar_array"), "solar_array")));
    const thirsty = play(stores(base, { water: 0 }, 30), 6);
    const watered = play(stores(settle(connect(place(base, "water_extractor"))), { water: 0 }, 30), 6);
    const water = thirsty.seen.get(`short:${ID}:water`);
    expect(water, JSON.stringify([...thirsty.seen.keys()])).toBeDefined();
    expect(water!.title).toBe("Ares is short of water");
    expect(water!.priority).toBe("urgent");
    expect(water!.text).toMatch(/^Water is running short\. Its people go without\./);
    expect([...watered.seen.keys()]).not.toContain(`short:${ID}:water`);
  });

  it("buildings offline, grouped: three greenhouses on a network of their own are one line of three; none once joined", () => {
    let s = powered();
    for (let k = 0; k < 3; k += 1) s = place(s, "greenhouse", [72, 72]);
    s = settle(s);
    const off = play(s, 2);
    const houses = off.now.filter((a) => a.kind === "offline" && a.title.includes("Greenhouse"));
    expect(houses, JSON.stringify(off.now.map((a) => a.title))).toHaveLength(1);
    expect(houses[0]!.title).toBe("3 Greenhouses offline in Ares");
    expect(houses[0]!.count).toBe(3);
    expect(houses[0]!.text).toMatch(/^Not connected: nothing on its network makes power/);
    expect(houses[0]!.priority).toBe("notice");
    // It clicks through to one of them.
    const at = houses[0]!.target;
    expect(at.kind === "city" && at.at !== null && city(s).buildings[buildingAt(city(s), at.at, T)]!.type).toBe("greenhouse");
    const on = play(settle(connect(s)), 2);
    expect(kinds(on.now)).not.toContain("offline");
  });

  it("a build finished: a solar array placed and built; nothing when nothing is placed", () => {
    const base = powered();
    const building = play(place(base, "solar_array"), 40);
    const idle = play(base, 40);
    const done = building.fresh.filter((a) => a.kind === "built");
    expect(done.map((a) => a.title)).toEqual(["Solar Array finished in Ares"]);
    expect(done[0]!.priority).toBe("record");
    const target = done[0]!.target;
    expect(target.kind === "city" && target.at !== null && city(building.state).buildings[buildingAt(city(building.state), target.at, T)]!.type).toBe("solar_array");
    expect(kinds(idle.fresh)).not.toContain("built");
  });

  it("an upgrade finished: the array raised a level; nothing when it is not", () => {
    const base = powered();
    const array = city(base).buildings.find((b) => b.type === "solar_array")!;
    const asked = upgradeBuilding(base, ID, array.tx, array.ty, T);
    expect(asked.ok, asked.reason ?? "").toBe(true);
    const raised = play(asked.state, 80);
    const idle = play(base, 80);
    expect(raised.fresh.filter((a) => a.kind === "upgraded").map((a) => a.title)).toEqual(["Solar Array raised to level 2 in Ares"]);
    expect(kinds(raised.fresh)).not.toContain("built");
    expect(kinds(idle.fresh)).not.toContain("upgraded");
  });

  it("a flood warning, in Batch 25's words: the low city as the sea rises; not the high one, and none with flooding off", () => {
    const s = fixture();
    const rate = liquidWaterRate(nextSubstepFlows(s, rising));
    const warned = conditions(s, channels(s), rate, FLOOD_T).filter((a) => a.kind === "flood");
    expect(warned.map((a) => a.key)).toEqual(["flood:settlement-1"]);
    expect(warned[0]!.text).toBe("Flood warning: submersion begins in ~5 yr, total loss in ~9 yr at current rate.");
    expect(warned[0]!.priority).toBe("urgent");
    const dry = makeTuning({ SETTLEMENTS_ENABLED: 1, FLOODING_ENABLED: 0, TERRAIN_RELIEF_M: 12 });
    expect(kinds(conditions(s, channels(s), rate, dry))).not.toContain("flood");
  });

  it("a storm coming: announced before it rises, gone once it has; never with the weather off", () => {
    // The world's first dust storm, from the seeded weather.
    const seed = marsStart(undefined, T).seed;
    let first: { start: number; duration: number } | null = null;
    for (let y = 0; first === null && y < 200; y += 1) for (const e of eventsBeginningIn(seed, y, T)) if (e.kind === "dust_storm" && first === null) first = e;
    expect(first, "a storm in the first 200 years").not.toBeNull();
    const look = STORM_WARN_SECONDS * T.TIME_SCALE;
    const before = Math.floor((first!.start - look / 2) / T.SUBSTEP_YEARS);
    const at = (steps: number): SimState => ({ ...marsStart(undefined, T), steps });
    const coming = stormAlert(at(before), T);
    expect(coming, `a storm at ${first!.start} seen from ${before * T.SUBSTEP_YEARS}`).not.toBeNull();
    expect(coming!.title).toBe("A dust storm is coming");
    expect(coming!.text).toMatch(/^A (minor|moderate|major) dust storm rises in about 1 min/);
    expect(coming!.target).toEqual({ kind: "planet" });
    expect(stormAlert(at(Math.ceil(first!.start / T.SUBSTEP_YEARS) + 1), T), "risen: no longer coming").toBeNull();
    expect(stormAlert(at(Math.floor((first!.start - 3 * look) / T.SUBSTEP_YEARS)), T), "too far off").toBeNull();
    expect(stormAlert(at(before), makeTuning({ ...T, EVENTS_ENABLED: 0 }))).toBeNull();
    // And through the watch, over the run up to it: fresh once.
    const run = play(at(Math.floor((first!.start - 2 * look) / T.SUBSTEP_YEARS)), Math.ceil((2 * look) / T.SUBSTEP_YEARS) + 2);
    expect(run.fresh.filter((a) => a.kind === "storm")).toHaveLength(1);
  });

  it("an objective done: a hundred people; not at ninety, and not in a world without objectives", () => {
    const base = powered();
    const grown = (s: SimState, n: number) => ({ ...s, settlements: s.settlements.map((c) => ({ ...c, population: n })) });
    const watch = new AlertWatch();
    play(grown(base, 90), 1, T, watch);
    const done = play(grown(base, 100), 1, T, watch);
    expect(done.first.fresh.filter((a) => a.kind === "objective").map((a) => a.title)).toEqual(["Objective done: A hundred people"]);
    expect(done.first.fresh.find((a) => a.kind === "objective")!.target).toEqual({ kind: "objectives" });
    const short = new AlertWatch();
    play(grown(base, 80), 1, T, short);
    expect(kinds(play(grown(base, 90), 1, T, short).first.fresh)).not.toContain("objective");
    const off = worldTuning("sandbox", 0, "standard");
    const sandbox = new AlertWatch();
    const s = settle(connect(place(place(founded(off), "solar_array", [46, 46], off), "habitat_dome", [46, 46], off), off), off);
    play(grown(s, 90), 1, off, sandbox);
    expect(kinds(play(grown(s, 100), 1, off, sandbox).first.fresh)).not.toContain("objective");
    // Claimed, it is not done again.
    const claimed = claimObjective(grown(base, 100), "city_first", T);
    expect(claimed.ok).toBe(true);
  });
});

describe("alerts are derived, never stored", () => {
  it("come back the same from a reloaded world, and a fresh watch sees the same as the old one", () => {
    let s = powered();
    for (let k = 0; k < 2; k += 1) s = place(s, "greenhouse", [72, 72]);
    s = stores(settle(place(place(s, "habitat_dome"), "habitat_dome")), { power: 0, water: 0 }, 30);
    const old = new AlertWatch();
    const a = play(s, 0, T, old).now;
    const reloaded = deserialize(serialize(s, T, "2026-10-15T00:00:00.000Z"), T);
    expect(conditions(reloaded, envOf(reloaded, T), 0, T)).toEqual(conditions(s, envOf(s, T), 0, T));
    expect(play(s, 0, T, new AlertWatch()).now).toEqual(a);
    expect(kinds(a), "vacuity: there was something to see").toEqual(["blackout", "offline", "shortage"]);
  });

  it("does not announce a condition again that comes back within ALERT_QUIET_MS of ending", () => {
    const watch = new AlertWatch();
    const fed = stores(settle(connect(place(place(place(powered(), "habitat_dome"), "habitat_dome"), "solar_array"))), { power: 0 });
    const arrays = city(fed).buildings.filter((b) => b.type === "solar_array");
    const dark = removeBuilding(fed, ID, arrays[1]!.tx, arrays[1]!.ty).state;
    const look = (s: SimState, now: number) => watch.observe({ state: s, env: envOf(s, T), liquidRatePerYear: 0, tuning: T, now }).fresh.map((x) => x.kind);
    look(fed, 0);
    expect(look(dark, 500)).toContain("blackout");
    expect(look(fed, 1000)).not.toContain("blackout");
    expect(look(dark, 1000 + ALERT_QUIET_MS - 1), "back within the quiet spell").not.toContain("blackout");
    expect(look(fed, 2000 + ALERT_QUIET_MS)).toEqual([]);
    expect(look(dark, 2000 + 2 * ALERT_QUIET_MS + 1), "back after it").toContain("blackout");
  });

  it("a quiet, healthy city says nothing at all, for a long while", () => {
    const healthy = settle(connect(place(place(place(place(powered(), "water_extractor"), "greenhouse"), "solar_array"), "solar_array")));
    const run = play(healthy, 200);
    const said = [...run.seen.values(), ...run.fresh].filter((a) => a.kind !== "storm" && a.kind !== "objective");
    expect(said.map((a) => `${a.key}: ${a.text}`)).toEqual([]);
    expect(simYear(run.state, T)).toBeGreaterThan(6);
    expect(city(run.state).population, "vacuity: a city that lives").toBeGreaterThan(4);
  });
});
