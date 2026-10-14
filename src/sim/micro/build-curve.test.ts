/**
 * Batch 28's exit gate, the curve: "measured through a real `advance`: each
 * build and upgrade takes its tuned real time at 1x to within one substep",
 * and "each level takes strictly longer than the last".
 *
 * Every buildable type is built and raised to its top level in one city,
 * each step timed in substeps of a real `advance` and turned into real
 * seconds - and set against the curve as the plan states it, BASE x
 * GROWTH^(level - 1), computed here from the constants rather than through
 * the code under test.
 */

import { describe, expect, it } from "vitest";

import { advance } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, Settlement, SimState } from "../types.js";
import { BUILDING_TYPES, NEUTRAL_ENV } from "../types.js";
import { BUILDING_DEFS, BUILD_TIER, maxLevel } from "./buildings.js";
import { foundSettlement } from "./registry.js";
import { constructionOf, placeBuilding, upgradeBuilding } from "./settlement.js";
import { tileKey } from "./space.js";

/**
 * The Standard pace's clock (the planet eight times slower, the city's
 * clock eight times faster) with the drive taken out, so what is timed is
 * the work alone; a sandbox's open gates, so every type can be built at once,
 * and enough rovers that nothing waits.
 */
const T = makeTuning({
  SETTLEMENTS_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  BUILD_TIME_ENABLED: 1,
  BUILD_CURVE_ENABLED: 1,
  TIME_SCALE: 0.03 / 8,
  SUBSTEP_YEARS: 0.25 / 8,
  CITY_CLOCK: 8,
  ROVER_YEARS_PER_TILE: 0,
  ROVERS_PER_HQ: 40,
  SANDBOX_ENABLED: 1,
  CITY_GRID_TILES: 96,
});
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
/** Real seconds a substep lasts at 1x: 8.33. */
const SUBSTEP_S = T.SUBSTEP_YEARS / T.TIME_SCALE;

const GROWTH: Readonly<Record<"small" | "medium" | "great", number>> = { small: T.BUILD_GROWTH_SMALL, medium: T.BUILD_GROWTH_MEDIUM, great: T.BUILD_GROWTH_GREAT };
const BASE_KEY = (type: BuildingType): keyof Tuning => `BUILD_SECONDS_${type.toUpperCase()}` as keyof Tuning;
/** The plan's curve, from the constants: level `level`'s real seconds at 1x. */
const planned = (type: BuildingType, level: number): number => T[BASE_KEY(type)] * GROWTH[BUILD_TIER[type]] ** (level - 1);

const BUILDABLE = BUILDING_TYPES.filter((type) => BUILDING_DEFS[type].buildable && BUILDING_DEFS[type].kinds.includes("city"));

function city(): { state: SimState; id: string } {
  const founded = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
  return { state: founded, id: founded.settlements[0]!.id };
}

/** Every type placed once, wherever it fits, scanning the grid; and where each went (the city lands with a spaceport of its own). */
function placeAll(start: SimState, id: string): { state: SimState; where: Map<BuildingType, { tx: number; ty: number }> } {
  let state = start;
  const where = new Map<BuildingType, { tx: number; ty: number }>();
  for (const type of BUILDABLE) {
    let placed = false;
    for (let ty = 0; ty < 96 && !placed; ty += 1) {
      for (let tx = 0; tx < 96 && !placed; tx += 1) {
        const o = placeBuilding(state, id, type, tx, ty, T);
        if (o.ok) {
          state = o.state;
          placed = true;
          where.set(type, { tx, ty });
        }
      }
    }
    if (!placed) throw new Error(`nowhere to place a ${type}`);
  }
  return { state, where };
}

/**
 * Build every type and raise each to its top level, upgrading the moment a
 * level lands. Returns each step's measured real seconds: [type][level - 1].
 */
function measureAll(): Map<BuildingType, number[]> {
  const { state: start, id } = city();
  const all = placeAll(start, id);
  let state = all.state;
  const at = (s: Settlement, type: BuildingType) => {
    const w = all.where.get(type)!;
    return s.buildings.find((b) => b.tx === w.tx && b.ty === w.ty)!;
  };
  const timed = new Map<BuildingType, number[]>(BUILDABLE.map((type) => [type, []]));
  const began = new Map<BuildingType, number>(BUILDABLE.map((type) => [type, 0]));
  const stage = new Map<BuildingType, number>(BUILDABLE.map((type) => [type, 0]));
  let step = 0;
  const limit = 40_000;
  while ([...stage].some(([type, level]) => level < maxLevel(type, T)) && step < limit) {
    state = advance(state, 1, cfg);
    step += 1;
    const s = state.settlements[0]!;
    const building = constructionOf(s);
    for (const type of BUILDABLE) {
      const b = at(s, type);
      const reached = building.has(tileKey(b.tx, b.ty)) ? 0 : b.level;
      if (reached <= stage.get(type)!) continue;
      timed.get(type)!.push((step - began.get(type)!) * SUBSTEP_S);
      stage.set(type, reached);
      if (reached < maxLevel(type, T)) {
        const o = upgradeBuilding(state, id, b.tx, b.ty, T);
        if (!o.ok) throw new Error(`could not upgrade the ${type} to ${reached + 1}: ${o.reason}`);
        state = o.state;
        began.set(type, step);
      }
    }
  }
  if (step >= limit) throw new Error("the curve run did not finish");
  return timed;
}

describe("the build-time curve, through a real advance (Batch 28)", () => {
  const timed = measureAll();

  it("covers every buildable type at every level", () => {
    for (const type of BUILDABLE) expect(timed.get(type), type).toHaveLength(maxLevel(type, T));
  });

  it("takes each build and upgrade its tuned real time at 1x, to within one substep", () => {
    for (const type of BUILDABLE) {
      timed.get(type)!.forEach((seconds, i) => {
        const want = planned(type, i + 1);
        // Never early, and late by less than one substep: the step a job finishes on is the next boundary.
        expect(seconds, `${type} level ${i + 1}: ${seconds.toFixed(1)} s against ${want.toFixed(1)} s`).toBeGreaterThanOrEqual(want - 1e-6);
        expect(seconds - want, `${type} level ${i + 1}`).toBeLessThan(SUBSTEP_S);
      });
    }
  });

  it("makes each level take strictly longer than the one before", () => {
    for (const type of BUILDABLE) {
      const t = timed.get(type)!;
      for (let i = 1; i < t.length; i += 1) expect(t[i]!, `${type}: level ${i + 1} against level ${i}`).toBeGreaterThan(t[i - 1]!);
    }
  });

  it("lands on the plan's starting targets (GAME_PLAN Batch 28's table)", () => {
    const first = (type: BuildingType) => timed.get(type)![0]!;
    const top = (type: BuildingType) => timed.get(type)!.at(-1)!;
    // The plan proposed these; they are the curve's own numbers to a substep.
    expect(first("storage_depot")).toBeLessThan(30);
    expect(top("storage_depot") / 60).toBeGreaterThan(15);
    expect(top("storage_depot") / 60).toBeLessThan(25);
    expect(first("reactor") / 60).toBeCloseTo(4, 0);
    expect(top("reactor") / 3600).toBeGreaterThan(2.5);
    expect(top("reactor") / 3600).toBeLessThan(3.5);
    expect(first("mega_mall") / 3600).toBeCloseTo(1, 1);
    expect(top("mega_mall") / 3600).toBeGreaterThan(7);
    expect(top("mega_mall") / 3600).toBeLessThan(9);
  });
});

describe("the drive is added to the work", () => {
  it("a building far from the headquarters stands later than the same one close by", () => {
    const D = makeTuning({ ...T, ROVER_YEARS_PER_TILE: 0.015 });
    const { state: start, id } = city();
    const hq = start.settlements[0]!.buildings.find((b) => b.type === "headquarters")!;
    let state = placeBuilding(start, id, "solar_array", hq.tx - 4, hq.ty, D).state;
    state = placeBuilding(state, id, "solar_array", hq.tx - 40, hq.ty, D).state;
    expect(state.settlements[0]!.jobs).toHaveLength(2);
    const standsAt = (tx: number): number => {
      let s = state;
      for (let k = 1; k < 500; k += 1) {
        s = advance(s, 1, { tuning: D, env: NEUTRAL_ENV, forcing: null });
        const c = s.settlements[0]!;
        const b = c.buildings.find((x) => x.tx === tx)!;
        if (!constructionOf(c).has(tileKey(b.tx, b.ty))) return k;
      }
      throw new Error("never stood");
    };
    expect(standsAt(hq.tx - 40)).toBeGreaterThan(standsAt(hq.tx - 4));
  });
});
