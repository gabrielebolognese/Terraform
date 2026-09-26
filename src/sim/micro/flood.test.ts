/**
 * Batch 24's exit gate - detail doc §4.2 and §4.3, proved in numbers:
 *
 *   - A low test city drowns from its lowest tiles inward as sea level
 *     rises, and a high one does not. Both measured, not assumed.
 *   - Chunk-independence holds with flooding on.
 *   - Offline catch-up equals live play through a threshold crossing, exactly.
 *   - Off by default: the golden run, the Batch 3 score and the golden
 *     frames are unchanged (the rest of the suite; and the check below that
 *     flooding off leaves a drowning city standing).
 *
 * The world is the reference run 1,200 years in: an ocean of 36.46%, the sea
 * at -3,091 m. The low city stands 15.15 m above it, the high one 473 m.
 * The sea is raised by importing water - through `advance`, like any flow.
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { siteElevation } from "../hypsometry.js";
import { advance, nextSubstepFlows, worldEnv } from "../integrate.js";
import { resume } from "../offline.js";
import { marsStart } from "../planets/mars.js";
import { serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import type { FloodState } from "./flood.js";
import { floodReading, submerged } from "./flood.js";
import { placeBuilding } from "./settlement.js";
import { groundOf } from "./terrain.js";
import { LOW, channels, fixture, importWater, rising, t } from "../../testkit/flood.js";

interface Frame {
  readonly state: SimState;
  readonly sea: number;
  readonly flood: FloodState;
  readonly wet: readonly boolean[] | null;
  readonly low: SimState["settlements"][number];
  readonly high: SimState["settlements"][number];
  readonly submergedAt: readonly string[];
}

/** Raise the sea substep by substep until the low city is lost, and a little past. */
function drown(start: SimState): Frame[] {
  const frames: Frame[] = [];
  let s = start;
  for (let i = 0; i < 60; i += 1) {
    const c = channels(s);
    const low = s.settlements[0]!;
    const r = floodReading(low, c, t);
    frames.push({
      state: s,
      sea: c.seaLevelM,
      flood: r.state,
      wet: r.wet,
      low,
      high: s.settlements[1]!,
      submergedAt: low.buildings.filter((b) => submerged(b, r)).map((b) => `${b.tx},${b.ty}`),
    });
    if (low.lostAtSeaLevelM !== null && frames.filter((f) => f.low.lostAtSeaLevelM !== null).length > 3) break;
    s = advance(s, 1, rising);
  }
  return frames;
}

const START = fixture();
const FRAMES = drown(START);
const BASE = siteElevation(LOW.lat, LOW.lon, t);
const HEIGHTS = groundOf(START.settlements[0]!, t).heightM;

describe("a low city drowns from its lowest ground inward", () => {
  it("floods the lowest tiles first: every wet tile lies below every dry one, and water never recedes", () => {
    let wetBefore = 0;
    for (const f of FRAMES) {
      if (f.wet === null) continue;
      const wet = HEIGHTS.filter((_, i) => f.wet![i]);
      const dry = HEIGHTS.filter((_, i) => !f.wet![i]);
      if (wet.length > 0 && dry.length > 0) expect(Math.max(...wet)).toBeLessThan(Math.min(...dry));
      expect(wet.length).toBeGreaterThanOrEqual(wetBefore);
      wetBefore = wet.length;
    }
    // Measured: 997 of the 1,024 tiles under water when the city falls. (On
    // Batch 24's terrain every tile was; the open world's ground rises higher
    // inside the grid, and its highest knolls are still dry at the end.)
    expect(wetBefore).toBeGreaterThan(950);
  });

  it("takes buildings from the lowest up: each goes offline under water before it is lost", () => {
    const lostAt = (key: string): number => FRAMES.findIndex((f) => !f.low.buildings.some((b) => `${b.tx},${b.ty}` === key));
    const offlineAt = (key: string): number => FRAMES.findIndex((f) => f.submergedAt.includes(key));
    const lowest = lostAt("0,15");
    const zone = lostAt("13,13");
    const mid = lostAt("8,26");
    // Measured: the -11 m depot lost at substep 10, the landing zone at 26,
    // the +4 m depot at 32; the +8.2 m depot still stood when the city fell.
    expect(lowest).toBeGreaterThan(0);
    expect(zone).toBeGreaterThan(lowest);
    expect(mid).toBeGreaterThan(zone);
    for (const key of ["0,15", "13,13", "8,26"]) {
      expect(offlineAt(key), `${key} went offline`).toBeGreaterThanOrEqual(0);
      expect(offlineAt(key), `${key} was offline before it was lost`).toBeLessThan(lostAt(key));
    }
  });

  it("passes through every state the doc names, and is declared lost at +10 m", () => {
    const states = FRAMES.map((f) => f.flood).filter((s, i, all) => i === 0 || s !== all[i - 1]);
    expect(states).toEqual(["warning", "partial", "flooded"]);
    const fell = FRAMES.find((f) => f.low.lostAtSeaLevelM !== null)!.low;
    // Recorded at the sea level of the substep that crossed: at least 10 m
    // over the base, and no more than one substep's rise beyond (0.706 m, measured).
    expect(fell.lostAtSeaLevelM! - BASE).toBeGreaterThanOrEqual(10);
    expect(fell.lostAtSeaLevelM! - BASE).toBeLessThan(10 + 0.75);
    expect(fell.buildings).toEqual([]);
    expect(fell.population).toBe(0);
  });

  it("loses a building on a slope only once the water stands over its highest tile: partly under water, it stands", () => {
    // Every building above stands on one tile or on the flat landing zone, so its lowest and highest ground are
    // one height: losing a building by its lowest tile passed every test (shown by injection). A water extractor
    // on the slope at 5,21 spans -1.43 m to +1.37 m.
    const placed = placeBuilding(START, "settlement-1", "water_extractor", 5, 21, t);
    expect(placed.ok, placed.reason ?? "").toBe(true);
    const frames = drown(placed.state);
    const g = groundOf(START.settlements[0]!, t);
    const under = [0, 1].flatMap((dy) => [0, 1].map((dx) => g.heightM[(21 + dy) * g.tiles + 5 + dx]!));
    const lo = Math.min(...under);
    const hi = Math.max(...under);
    expect(hi - lo, "vacuity: a slope under it").toBeGreaterThan(2.5);
    const stands = (f: Frame): boolean => f.low.buildings.some((b) => b.type === "water_extractor");
    const lostAt = frames.findIndex((f) => !stands(f));
    expect(lostAt, "vacuity: lost before the city fell").toBeGreaterThan(0);
    // Each substep's step sees the sea of the frame before it.
    const seen = (i: number): number => frames[i - 1]!.sea - BASE;
    expect(seen(lostAt)).toBeGreaterThan(hi + t.FLOOD_BUILDING_LOSS_M);
    expect(seen(lostAt - 1)).toBeLessThanOrEqual(hi + t.FLOOD_BUILDING_LOSS_M);
    // Partly under water - its low side wet, its high side dry - it stood, offline, for substeps on end.
    const partly = frames.filter((f) => stands(f) && f.sea - BASE > lo && f.sea - BASE < hi);
    // Measured: 4 substeps.
    expect(partly.length).toBeGreaterThanOrEqual(3);
    for (const f of partly) expect(f.submergedAt, "offline").toContain("5,21");
  });

  it("wipes out whatever still stands when it is declared lost, and records the sea it fell at", () => {
    // By the time the fixture's city falls the water has taken every building one by one, and it never had
    // people: "everything is destroyed" held of a city with nothing left (shown by injection). So: the substep
    // before the fall, with a depot on its high ground and forty people put back.
    const at = FRAMES.findIndex((f) => f.low.lostAtSeaLevelM !== null);
    const before = FRAMES[at - 1]!.state;
    const low = before.settlements[0]!;
    const full: SimState = {
      ...before,
      settlements: before.settlements.map((c, i) => (i === 0 ? { ...c, population: 40, buildings: [...low.buildings, { type: "storage_depot" as const, tx: 5, ty: 0, level: 1 }] } : c)),
    };
    const after = advance(full, 1, rising).settlements[0]!;
    expect(after.lostAtSeaLevelM, "it falls on this substep").not.toBeNull();
    expect(after.buildings).toEqual([]);
    expect(after.population).toBe(0);
    expect(after.stores).toEqual({ power: 0, water: 0, oxygen: 0, food: 0, materials: 0 });
    // The sea level that substep saw, exactly - not the threshold it crossed.
    expect(after.lostAtSeaLevelM).toBe(channels(full).seaLevelM);
    expect(after.lostAtSeaLevelM! - BASE).toBeGreaterThan(t.FLOOD_THRESHOLD_M);
  });

  it("keeps the record: a lost settlement stays lost, with the sea level it fell at", () => {
    const lost = FRAMES.filter((f) => f.low.lostAtSeaLevelM !== null);
    expect(lost.length).toBeGreaterThan(1);
    for (const f of lost) expect(f.low.lostAtSeaLevelM).toBe(lost[0]!.low.lostAtSeaLevelM);
  });

  it("stops what the lost city did to the planet: its processor draws no more CO2", () => {
    const draw = (s: SimState): number =>
      nextSubstepFlows(s, rising)
        .filter((f) => f.id === "micro.moxie_carbon")
        .reduce((n, f) => n + f.rate, 0);
    let s = START;
    const before = draw(s);
    while (s.settlements[0]!.lostAtSeaLevelM === null) s = advance(s, 1, rising);
    // Two processors before, one after (the high city's); the carbon ledger
    // is checked by `advance` itself on every call along the way.
    expect(before).toBeGreaterThan(0);
    expect(draw(s)).toBeLessThan(before * 0.6);
    expect(draw(s)).toBeGreaterThan(0);
  });
});

describe("a high city", () => {
  it("does not flood while the low one drowns", () => {
    for (const f of FRAMES) {
      expect(f.high.buildings.length).toBe(3);
      expect(f.high.lostAtSeaLevelM).toBeNull();
    }
  });
});

describe("the flood inside `advance`", () => {
  it("is chunk-independent through the crossing: 64 substeps at once equal sixteen fours", () => {
    let chunked = START;
    for (let i = 0; i < 16; i += 1) chunked = advance(chunked, 4, rising);
    const whole = advance(START, 64, rising);
    expect(chunked).toEqual(whole);
    expect(whole.settlements[0]!.lostAtSeaLevelM, "the city fell inside the span").not.toBeNull();
  });

  it("is chunk-independent as the exit gate words it: 4,000 substeps at once equal a thousand fours", () => {
    // A thousand years of the import: the sea climbs over the low city and then the high one, 473 m up.
    let chunked = START;
    for (let i = 0; i < 1000; i += 1) chunked = advance(chunked, 4, rising);
    const whole = advance(START, 4000, rising);
    expect(chunked).toEqual(whole);
    // Measured: both fell - the low one at substep 37, the high one at 470.
    expect(whole.settlements.map((c) => c.lostAtSeaLevelM !== null), "both crossings inside the span").toEqual([true, true]);
  });

  it("gives offline catch-up exactly what live play gives, through the city's fall", () => {
    const at = Date.parse("2026-09-24T10:00:00.000Z");
    const raw = JSON.parse(serialize(START, t, "2026-09-24T10:00:00.000Z")) as unknown;
    const back = resume(raw, at + 2 * 3600_000, rising);
    const steps = Math.round(back.grant.grantedSimYears / t.SUBSTEP_YEARS);
    expect(back.state).toEqual(advance(START, steps, rising));
    expect(back.state.settlements[0]!.lostAtSeaLevelM, "the fall happened while away").not.toBeNull();
    // Detail §4.7: the summary says so, first.
    expect(back.summary.headline).toMatch(/The sea rose over a settlement - lost\./);
  });
});

describe("when there is nothing to flood with", () => {
  it("floods nothing with no ocean, even a city below the curve's floor", () => {
    // On a dry Mars the sea level is only the curve's floor (-8,200 m); the
    // low city's hills reach 11 m below its base. Nothing may be wet.
    const dry = marsStart();
    const d = derive(dry.reservoirs, worldEnv(dry, NEUTRAL_ENV, t), t);
    const env = habitat(dry.reservoirs, d, t, 0);
    expect(env.oceanFraction).toBe(0);
    const floor = { ...START.settlements[0]!, lat: LOW.lat, lon: LOW.lon };
    const reading = floodReading(floor, { ...env, seaLevelM: BASE + 50 }, t);
    expect(reading.state).toBe("dry");
    expect(reading.wet).toBeNull();
  });

  it("is off by default: the same rising sea leaves the city standing", () => {
    const off = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
    const s = advance(fixture(off), 64, { tuning: off, env: NEUTRAL_ENV, forcing: importWater });
    expect(s.settlements[0]!.lostAtSeaLevelM).toBeNull();
    expect(s.settlements[0]!.buildings.length).toBe(6);
  });
});
