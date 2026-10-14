/**
 * Batch 28's exit gate, offline: "long builds keep going while the game is
 * closed", and "offline equals live play through a long build's completion,
 * exactly". Coming back says what finished: "While you were away: the
 * reactor reached level 4, the mega mall is half built".
 */

import { describe, expect, it } from "vitest";

import { advance } from "./integrate.js";
import { buildsWhileAway, resume } from "./offline.js";
import { marsStart } from "./planets/mars.js";
import { toSave } from "./save.js";
import { makeTuning } from "./tuning.js";
import type { SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";
import { foundSettlement } from "./micro/registry.js";
import { placeBuilding, upgradeBuilding } from "./micro/settlement.js";

/** The Standard pace's clock and offline rule (`game-tuning.ts`'s PACE_OVERRIDES.standard). */
const T = makeTuning({
  SETTLEMENTS_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  BUILD_TIME_ENABLED: 1,
  BUILD_CURVE_ENABLED: 1,
  TIME_SCALE: 0.03 / 8,
  SUBSTEP_YEARS: 0.25 / 8,
  CITY_CLOCK: 8,
  OFFLINE_RATE_FACTOR: 1,
  OFFLINE_CAP_HOURS: 10,
  CITY_GRID_TILES: 64,
});
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const SAVED = Date.parse("2026-10-14T12:00:00.000Z");
const HOUR = 3_600_000;
/** Substeps an absence of `ms` is worth, at the live rate. */
const stepsFor = (ms: number): number => Math.round(((ms / 1000) * T.TIME_SCALE * T.OFFLINE_RATE_FACTOR) / T.SUBSTEP_YEARS);

/** A city whose level-4 reactor has just begun its upgrade to 5 - 35 real minutes of work - and a spaceport just placed. */
function building(): SimState {
  const founded = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
  let s: SimState = {
    ...founded,
    settlements: founded.settlements.map((c) => ({ ...c, population: 400, stores: { ...c.stores, materials: 5000 }, buildings: [...c.buildings, { type: "reactor", tx: 44, ty: 44, level: 4 }] })),
  };
  const id = s.settlements[0]!.id;
  const up = upgradeBuilding(s, id, 44, 44, T);
  if (!up.ok) throw new Error(up.reason ?? "no upgrade");
  s = up.state;
  const port = placeBuilding(s, id, "spaceport", 40, 20, T);
  if (!port.ok) throw new Error(port.reason ?? "no spaceport");
  return port.state;
}

describe("builds while the game is closed (Batch 28)", () => {
  it("offline equals live play through a long build's completion, exactly", () => {
    const s = building();
    const away = HOUR;
    const back = resume(toSave(s, T, new Date(SAVED).toISOString()), SAVED + away, cfg);
    const live = advance(s, stepsFor(away), cfg);
    expect(back.state).toEqual(live);
    // Not vacuous: the reactor's upgrade was under way, and finished while away.
    const reactor = (x: SimState) => x.settlements[0]!.buildings.find((b) => b.type === "reactor")!;
    expect(reactor(s).level).toBe(4);
    expect(reactor(back.state).level).toBe(5);
    expect(back.state.settlements[0]!.jobs.some((j) => j.kind === "build" && j.upgrade)).toBe(false);
  });

  it("says what finished and how far the rest has got", () => {
    const s = building();
    // Seven and a half minutes: the reactor not done, the spaceport (15 min) about half.
    const half = resume(toSave(s, T, new Date(SAVED).toISOString()), SAVED + 7.5 * 60_000, cfg);
    expect(half.summary.builds).toEqual(["the spaceport is half built"]);
    expect(half.summary.headline).toMatch(/In the cities, the spaceport is half built\./);
    const done = resume(toSave(s, T, new Date(SAVED).toISOString()), SAVED + HOUR, cfg);
    expect(done.summary.builds).toEqual(expect.arrayContaining(["the reactor reached level 5", "the spaceport was finished"]));
  });

  it("says nothing of builds when none were under way", () => {
    const quiet = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
    expect(buildsWhileAway(quiet, advance(quiet, 40, cfg))).toEqual([]);
  });
});
