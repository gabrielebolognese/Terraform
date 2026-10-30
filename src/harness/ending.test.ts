/**
 * Batch 39's exit gate, on scripted runs:
 *
 * - the reference policy, scripted to the end, reaches victory at a measured
 *   real time under Batch 28's pacing;
 * - the score is derived, and identical for the same world live or offline;
 * - every achievement is earned in some scripted run, and none in the first
 *   minute.
 */

import { describe, expect, it } from "vitest";

import type { SimState, Tuning } from "../sim/index.js";
import { ACHIEVEMENTS, NEUTRAL_ENV, advance, cancelEarthOrder, foundSettlement, makeTuning, orderFromEarth, resume, toSave, worldScore } from "../sim/index.js";
import { PACE_OVERRIDES, tuningRecord, worldTuning } from "../web/game-tuning.js";
import { HIGH_SITES, LEAN_POLICY, SEA_TUNING, SWIFT_POLICY, earnedSeconds, placeFirst, playEvacuation, playToVictory, playWalled } from "./ending.js";
import { playPacing } from "./pacing.js";
import { REFERENCE_POLICY } from "./policy.js";

/** The planet as calibrated (the golden run's), at Batch 28's Standard pace, with the ending kept. */
const STANDARD = makeTuning({ ...PACE_OVERRIDES.standard, ENDING_ENABLED: 1 });
/** The same at the Classic pace. */
const CLASSIC = makeTuning({ ENDING_ENABLED: 1 });
/** A new Standard world (seed 7), as the browser makes it. */
const WORLD = worldTuning("standard", 7, "standard");

const reference = playToVictory(REFERENCE_POLICY, STANDARD, 2600);

describe("victory", () => {
  it("comes to the reference policy, scripted to the end, at a measured real time under Batch 28's pacing", () => {
    // Phase 6 at year 1,709.75 (substep 54,712), held 10 years: won on substep 55,032, year 1,719.75 -
    // 458,600 real seconds, 127.4 hours at 1x (42.5 at 3x). Measured, exact: a change here moved the pacing.
    expect(reference.state.ending.victory).toBe(55_032);
    expect(reference.victorySeconds).toBe(458_600);
    expect(reference.victorySeconds! / 3600).toBeCloseTo(127.39, 2);
  });

  it("comes exactly the hold after the planet enters the band, and the band is never left on the way", () => {
    // "A living world" is latched on the substep after the one whose start first read the band, as the phase is.
    const firstRead = reference.state.ending.achievements.find((a) => a.id === "living")!.step - 1;
    expect(reference.state.ending.victory! - firstRead).toBe(Math.round(STANDARD.VICTORY_HOLD_YEARS / STANDARD.SUBSTEP_YEARS));
  });

  it("comes at the Classic pace on the golden run's year, ten years after Phase 6", () => {
    const classic = playToVictory(REFERENCE_POLICY, CLASSIC, 2600);
    // The golden run reaches Phase 6 at 1,710; won at 1,720: 57,333 s, 15.9 h at 1x.
    expect(classic.state.ending.victory! * CLASSIC.SUBSTEP_YEARS).toBe(1720);
  });
});

/** Each scripted run, and when each achievement came in it (real seconds at 1x). */
const city = playPacing(WORLD, 5 * 3600, false, undefined, { guided: true, claim: true, needs: true, answer: true, trade: true, siting: 8, metropolis: true });
const runs: Readonly<Record<string, Readonly<Record<string, number>>>> = (() => {
  return {
    "the reference policy (Standard pace)": reference.earned,
    "a new Standard world, the scripted player, 5 hours": earnedSeconds(city.state, WORLD),
    "three high cities and a walled one, to the victory": playWalled().earned,
    "a low city evacuated": playEvacuation().earned,
    "the lean policy": playToVictory(LEAN_POLICY, CLASSIC, 2600).earned,
    "the swift policy": playToVictory(SWIFT_POLICY, CLASSIC, 2600).earned,
  };
})();

describe("achievements", () => {
  it("are about thirty, each once", () => {
    expect(ACHIEVEMENTS.length).toBe(30);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it("are each earned in some scripted run", () => {
    const never = ACHIEVEMENTS.filter((a) => !Object.values(runs).some((r) => r[a.id] !== undefined)).map((a) => a.id);
    expect(never).toEqual([]);
  });

  it("are none of them earned in the first minute of any run", () => {
    const early: string[] = [];
    for (const [run, earned] of Object.entries(runs)) for (const [id, s] of Object.entries(earned)) if (s <= 60) early.push(`${id} at ${s.toFixed(0)} s in ${run}`);
    expect(early).toEqual([]);
    // Not vacuous: the runs earn plenty, the soonest within the first hour.
    const soonest = Math.min(...Object.values(runs).flatMap((r) => Object.values(r)));
    expect(soonest).toBeLessThan(3600);
  });

  it("keeps the rare ones from the reference playthrough: a style of play, not a matter of time", () => {
    const rare = ACHIEVEMENTS.filter((a) => a.rare && a.id !== "self_reliant").map((a) => a.id);
    expect(rare.filter((id) => reference.earned[id] !== undefined)).toEqual([]);
    // Each is earned by the run that plays that way.
    expect(runs["the lean policy"]!["light_touch"]).toBeDefined();
    expect(runs["the swift policy"]!["swift"]).toBeDefined();
    expect(runs["three high cities and a walled one, to the victory"]!["nobody_lost"]).toBeDefined();
  });

  it("counts every event the player answered", () => {
    const answered = city.log.filter((l) => / answered /.test(l)).length;
    expect(answered).toBeGreaterThanOrEqual(5);
    expect(city.state.ending.eventsAnswered).toBe(answered);
  });

  it("does not hand 'Nobody lost to the sea' to a world that lost a city", () => {
    // The evacuation run's low city falls: run it on to the victory, and the achievement is not there.
    const lost = playToVictory(REFERENCE_POLICY, SEA_TUNING, 2600, {
      found: [{ lat: 0.31, lon: -1.2 }, { lat: 0.31, lon: -1.22 }, { lat: 0.33, lon: -1.2 }, { lat: -1.0493, lon: -2.8899 }],
    });
    expect(lost.state.ending.victory).not.toBeNull();
    expect(lost.state.settlements.filter((c) => c.lostAtSeaLevelM !== null).length).toBe(1);
    expect(lost.earned["nobody_lost"]).toBeUndefined();
  });

  it("judges 'Nobody lost to the sea' as the world stood at the victory: a third city founded after it does not earn it", () => {
    // Won with two cities high above the sea; the third founded (free and instant) the moment after the victory's substep.
    let foundedAt: number | null = null;
    const late = playToVictory(REFERENCE_POLICY, SEA_TUNING, 2600, {
      found: HIGH_SITES.slice(0, 2),
      after: 5,
      act: (s) => {
        if (s.ending.victory === null || foundedAt !== null) return s;
        const o = foundSettlement(s, "city", HIGH_SITES[2]!.lat, HIGH_SITES[2]!.lon, SEA_TUNING);
        if (!o.ok) throw new Error(`could not found the third city: ${o.reason}`);
        foundedAt = s.steps;
        return o.state;
      },
    });
    expect(late.state.ending.victory).not.toBeNull();
    expect(foundedAt).toBe(late.state.ending.victory);
    // Not vacuous: five years on, every other part of the condition holds - three cities standing, nothing and no one lost.
    expect(late.state.settlements.filter((c) => c.kind === "city" && c.lostAtSeaLevelM === null).length).toBe(SEA_TUNING.ACH_STANDING_CITIES);
    expect(late.state.ending.peopleLost).toBe(0);
    expect(late.state.steps).toBeGreaterThan(foundedAt! + 1);
    expect(late.earned["nobody_lost"]).toBeUndefined();
  });

  it("withholds 'Self-reliant' from a world that bought from Earth, however long ago its market forgot the trade", () => {
    // The sea's world with Earth on, and a bank deep enough for the reference schedule. Its market forgets all its trade at
    // every window (EARTH_MARKET_RECOVERY 0): the browser's (0.5) has forgotten one material bought after 1,077 windows,
    // year 2,300, so a world that bought one at its first window and won after that was handed the achievement (review 2).
    const t = makeTuning({ ...tuningRecord(SEA_TUNING), ECONOMY_ENABLED: 1, EARTH_ENABLED: 1, ECON_STARTING_CREDITS: 1e9, EARTH_MARKET_RECOVERY: 0 });
    const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };
    // A city with a spaceport, 1,700 years in: the victory twenty years off.
    const before = playToVictory(REFERENCE_POLICY, t, 1700, {
      found: [HIGH_SITES[0]!],
      act: (s) => (s.steps === 0 ? placeFirst(s, "settlement-1", "spaceport", t) : s),
    }).state;
    expect(before.ending.victory).toBeNull();
    const bought = orderFromEarth(before, "settlement-1", "materials", "buy", 1, t);
    expect(bought.ok, bought.reason ?? "").toBe(true);
    // The same order taken back before its window: nothing bought after all.
    const taken = cancelEarthOrder(bought.state, bought.state.earth.orders.at(-1)!.id, t);
    expect(taken.ok, taken.reason ?? "").toBe(true);
    const buyer = advance(bought.state, 120, cfg);
    const keeper = advance(taken.state, 120, cfg);
    expect(buyer.ending.victory).not.toBeNull();
    // The material came, and the market has forgotten it.
    expect(buyer.earth.orders).toEqual([]);
    expect(buyer.earth.bought.materials).toBe(0);
    expect(earnedSeconds(buyer, t)["self_reliant"]).toBeUndefined();
    // Not vacuous: the same world, its order cancelled, wins on the same substep with the achievement.
    expect(keeper.ending.victory).toBe(buyer.ending.victory);
    expect(earnedSeconds(keeper, t)["self_reliant"]).toBe(earnedSeconds(keeper, t)["victory"]);
  });
});

describe("the score", () => {
  /** A Standard world an hour into the scripted player's game: a city, people, machines, Earth. */
  const start: SimState = playPacing(WORLD, 3600, false, undefined, { guided: true, claim: true, trade: true }).state;
  const cfg = { tuning: WORLD, env: NEUTRAL_ENV, forcing: null };
  const away = 2 * 3600;

  function live(s: SimState, t: Tuning, seconds: number): SimState {
    const steps = Math.round((seconds * t.TIME_SCALE) / t.SUBSTEP_YEARS);
    let x = s;
    // The browser's driver: a substep or so a frame at 1x.
    for (let i = 0; i < steps; i += 1) x = advance(x, 1, cfg);
    return x;
  }

  it("is identical for the same world live or offline", () => {
    const savedAt = Date.parse("2026-10-30T12:00:00Z");
    const offline = resume(toSave(start, WORLD, new Date(savedAt).toISOString()), savedAt + away * 1000, cfg).state;
    const played = live(start, WORLD, away);
    expect(offline.steps).toBe(played.steps);
    expect(worldScore(offline, WORLD)).toEqual(worldScore(played, WORLD));
    expect(offline.ending).toEqual(played.ending);
    // Not vacuous: the two hours moved the score.
    expect(worldScore(played, WORLD)!.total).not.toBe(worldScore(start, WORLD)!.total);
  });

  it("rewards a sooner victory, a lighter touch and a city held by its wall, and costs a city lost", () => {
    const ref = worldScore(playToVictory(REFERENCE_POLICY, CLASSIC, 2600).state, CLASSIC)!;
    const swift = worldScore(playToVictory(SWIFT_POLICY, CLASSIC, 2600).state, CLASSIC)!;
    const lean = worldScore(playToVictory(LEAN_POLICY, CLASSIC, 2600).state, CLASSIC)!;
    expect(swift.speed).toBeGreaterThan(ref.speed);
    expect(lean.pressure).toBeGreaterThan(ref.pressure);
    const walled = worldScore(playWalled().state, SEA_TUNING)!;
    expect(walled.citiesSaved).toBe(1);
    expect(walled.saved).toBe(SEA_TUNING.SCORE_CITY_SAVED_POINTS);
    const evacuated = worldScore(playEvacuation().state, SEA_TUNING)!;
    expect(evacuated.citiesLost).toBe(1);
    expect(evacuated.lost).toBe(-SEA_TUNING.SCORE_CITY_LOST_POINTS);
    // The card shows the parts and the total: they add up, never below 0.
    for (const x of [ref, swift, lean, walled, evacuated]) expect(x.total).toBe(Math.max(0, x.speed + x.people + x.saved + x.lost + x.pressure));
    expect(walled.total).toBeGreaterThan(0);
  });

  it("is not kept in a world without the ending", () => {
    expect(worldScore(start, worldTuning("sandbox", 7, "standard"))).toBeNull();
  });
});
