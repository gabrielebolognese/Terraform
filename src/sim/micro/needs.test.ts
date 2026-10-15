/**
 * People's needs and happiness (Batch 32).
 *
 * The exit gate: each need, met against unmet in otherwise identical cities
 * through a real `advance`, moves growth and output by its tuned factor -
 * twice its weight times HAPPINESS_GROWTH, and times HAPPINESS_OUTPUT -
 * measured from what the city did, not from the mood it reports. And with
 * NEEDS_ENABLED at 0 nothing changes.
 */

import { describe, expect, it } from "vitest";

import { advance } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, PlacedBuilding, Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import type { NeedId } from "./needs.js";
import { NEEDS, NEED_BY_ID, needAskedFrom, needCoverage, readNeeds } from "./needs.js";
import { foundSettlement } from "./registry.js";
import { settlementStep } from "./settlement.js";
import { tileKey } from "./space.js";
import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { worldEnv } from "../integrate.js";

/** Stores so deep nothing runs short in a few substeps, so every difference is the people's mood. */
const DEEP = { MICRO_CAP_POWER: 1e9, MICRO_CAP_WATER: 1e9, MICRO_CAP_OXYGEN: 1e9, MICRO_CAP_FOOD: 1e9, MICRO_CAP_MATERIALS: 1e9 } as const;
const BASE = { SETTLEMENTS_ENABLED: 1, CITY_GRID_TILES: 96, ...DEEP } as const;
const ON = makeTuning({ ...BASE, NEEDS_ENABLED: 1 });
const OFF = makeTuning(BASE);

/**
 * 70 skyscrapers wall to wall in the north-west corner (14 by 5, homes for
 * 11,200), 11,000 people - enough to ask for every need - and a regolith mine
 * well away, whose materials (drawn by nothing) are the city's output.
 */
function homes(): PlacedBuilding[] {
  const out: PlacedBuilding[] = [];
  for (let j = 0; j < 5; j += 1) for (let i = 0; i < 14; i += 1) out.push({ type: "skyscraper", tx: 2 * i, ty: 2 * j, level: 1 });
  return out;
}
const MINE: PlacedBuilding = { type: "regolith_mine", tx: 50, ty: 40, level: 1 };
/** Research credits, the city's other output: an observatory far from the homes (so it meets no need). */
const OBSERVATORY: PlacedBuilding = { type: "observatory", tx: 85, ty: 50, level: 1 };
/** Just south of the homes: every home's middle within the square of a provider whose middle is here. */
const NEAR = { tx: 11, ty: 11 };
/** The far corner: no home within reach. */
const FAR = { tx: 80, ty: 80 };

function cityWith(extra: readonly PlacedBuilding[], people = 11000, t: Tuning = ON): SimState {
  const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
  const full = { power: 1e8, water: 1e8, oxygen: 1e8, food: 1e8, materials: 0 };
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: [...homes(), MINE, OBSERVATORY, ...extra], population: people, stores: full })) };
}

/**
 * One substep of the real `advance`: how much the people grew, and the
 * materials the city made, per year; and the research credits the same step
 * earns (they go to the bank, with the planet's own income).
 */
function measure(state: SimState, t: Tuning): { growth: number; output: number; research: number } {
  const next = advance(state, 1, { tuning: t, env: NEUTRAL_ENV, forcing: null });
  const before = state.settlements[0]!;
  const after = next.settlements[0]!;
  const h = t.SUBSTEP_YEARS * t.CITY_CLOCK;
  const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t), t, 0);
  return { growth: (after.population - before.population) / h, output: (after.stores.materials - before.stores.materials) / h, research: settlementStep(before, env, t, h).research };
}

const at = (type: BuildingType, p: { tx: number; ty: number }): PlacedBuilding => ({ type, tx: p.tx, ty: p.ty, level: 1 });

/** Each need's met and unmet cities, alike but for the need. */
const CASES: readonly { id: NeedId; met: PlacedBuilding[]; unmet: PlacedBuilding[]; span: number }[] = [
  // A biosphere runs on any planet; a park waits for open air.
  { id: "green", met: [at("biosphere", NEAR)], unmet: [at("biosphere", FAR)], span: 2 },
  { id: "medical", met: [at("medical_center", NEAR)], unmet: [at("medical_center", FAR)], span: 2 },
  { id: "research", met: [at("laboratory", NEAR)], unmet: [at("laboratory", FAR)], span: 2 },
  { id: "transport", met: [at("station", NEAR)], unmet: [at("station", FAR)], span: 2 },
  { id: "shops", met: [at("mega_mall", NEAR)], unmet: [at("mega_mall", FAR)], span: 2 },
  // Food is hauled, not walked to: two kinds grown anywhere against none. (Out of the homes' reach, so green space is unmet in both.)
  { id: "variety", met: [at("greenhouse", { tx: 70, ty: 40 }), at("biosphere", FAR)], unmet: [], span: 2 },
];

describe("each need moves growth and output by its tuned factor (the exit gate)", () => {
  const off = measure(cityWith([], 11000, OFF), OFF);

  it("a city with nothing to read from grows and makes something (the measure is not vacuous)", () => {
    expect(off.growth).toBeGreaterThan(1);
    expect(off.output).toBeGreaterThan(1);
    expect(off.research).toBeGreaterThan(1);
  });

  for (const c of CASES) {
    it(`${NEED_BY_ID[c.id].name}: met against unmet, through a real advance`, () => {
      const met = measure(cityWith(c.met), ON);
      const unmet = measure(cityWith(c.unmet), ON);
      const w = NEED_BY_ID[c.id].weight(ON);
      // Measured against the same city with needs off: what each grew and made, as a multiple.
      const growthMoved = met.growth / off.growth - unmet.growth / off.growth;
      const outputMoved = met.output / off.output - unmet.output / off.output;
      expect(growthMoved, "growth").toBeCloseTo(c.span * w * ON.HAPPINESS_GROWTH, 9);
      expect(outputMoved, "output").toBeCloseTo(c.span * w * ON.HAPPINESS_OUTPUT, 9);
      // Research is output too. (In the research case the laboratory earns as well, met and unmet alike.)
      const researchOff = c.id === "research" ? measure(cityWith(c.unmet, 11000, OFF), OFF).research : off.research;
      expect(met.research / researchOff - unmet.research / researchOff, "research").toBeCloseTo(c.span * w * ON.HAPPINESS_OUTPUT, 9);
      // Not a pair of equal cities read the same: meeting it is the better.
      expect(met.growth).toBeGreaterThan(unmet.growth);
      expect(met.output).toBeGreaterThan(unmet.output);
    });
  }

  it("with every need met a city grows and makes more than with needs off, and with none met less", () => {
    // Three levels up, so five providers south of the homes each reach every one of them.
    const up = (type: BuildingType, tx: number, ty: number): PlacedBuilding => ({ type, tx, ty, level: 3 });
    const all = measure(cityWith([up("mega_mall", 5, 10), up("station", 13, 10), up("medical_center", 17, 10), up("laboratory", 5, 16), up("biosphere", 9, 16), at("greenhouse", { tx: 70, ty: 40 })]), ON);
    const none = measure(cityWith([]), ON);
    expect(all.growth / off.growth).toBeCloseTo(1 + ON.HAPPINESS_GROWTH, 9);
    expect(all.output / off.output).toBeCloseTo(1 + ON.HAPPINESS_OUTPUT, 9);
    expect(none.growth / off.growth).toBeCloseTo(1 - ON.HAPPINESS_GROWTH, 9);
    expect(none.output / off.output).toBeCloseTo(1 - ON.HAPPINESS_OUTPUT, 9);
  });
});

describe("off, and too small to ask, nothing changes", () => {
  it("NEEDS_ENABLED 0: the city's next state is the one a city too small to ask for anything takes with it on", () => {
    // 400 people ask for nothing: the mood is 0, neither better nor worse. With the needs off, the same - exactly.
    const small = (t: Tuning) => advance(cityWith([at("laboratory", NEAR)], 400, t), 8, { tuning: t, env: NEUTRAL_ENV, forcing: null });
    const a = small(OFF).settlements[0]!;
    const b = small(makeTuning({ ...BASE, NEEDS_ENABLED: 1 })).settlements[0]!;
    expect(a).toEqual(b);
    // And it did grow and make something: equal, not idle.
    expect(a.population).toBeGreaterThan(400);
    expect(a.stores.materials).toBeGreaterThan(0);
  });

  it("reports no needs with them off, nor for an outpost", () => {
    const s = cityWith([]);
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, ON), ON), ON, 0);
    expect(settlementStep(s.settlements[0]!, env, OFF, OFF.SUBSTEP_YEARS).needs).toBeNull();
    expect(settlementStep(s.settlements[0]!, env, ON, ON.SUBSTEP_YEARS).needs).not.toBeNull();
    const outpost: Settlement = { ...s.settlements[0]!, kind: "outpost" };
    expect(settlementStep(outpost, env, ON, ON.SUBSTEP_YEARS).needs).toBeNull();
  });

  it("is the same in any chunks: 64 substeps at once, or 16 calls of 4", () => {
    // 1,990 people, growing about 40 a substep (measured): asked for medical care and research from the first
    // substep, for transport from about the 55th. The mood moves during the run (0.25, -0.1, -0.3), so a mood
    // found once a call, not once a substep, shows here; with 11,000 people it was the same all run and did not.
    const start = cityWith([at("biosphere", NEAR), at("laboratory", FAR), at("greenhouse", { tx: 70, ty: 40 })], 1990);
    const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
    let chained = start;
    for (let k = 0; k < 16; k += 1) chained = advance(chained, 4, cfg);
    const whole = advance(start, 64, cfg);
    // The city first, so a difference names what moved; then everything.
    expect({ people: whole.settlements[0]!.population, stores: whole.settlements[0]!.stores }).toEqual({ people: chained.settlements[0]!.population, stores: chained.settlements[0]!.stores });
    expect(whole).toEqual(chained);
    // Not vacuous: the mood the run ends with is not the one it starts with.
    const mood = (s: SimState) => readNeeds(s.settlements[0]!, s.settlements[0]!.buildings.map(() => true), new Set(), null, ON)!.mood;
    expect(mood(start)).toBeCloseTo(0.25, 9);
    expect(mood(chained)).toBeCloseTo(-0.3, 9);
  });
});

describe("who asks, and who is reached", () => {
  it("asks for comfort from 500 people, services from 2,000, and none before its building may be built", () => {
    const from = Object.fromEntries(NEEDS.map((n) => [n.id, needAskedFrom(n, ON)]));
    expect(from).toEqual({ green: 500, variety: 500, medical: 2000, research: 2000, transport: 5000, shops: 10000 });
    for (const n of NEEDS) {
      // Some building that meets it may be built at that many people.
      expect(n.providers.some((p) => BUILDING_DEFS[p].minPopulation(ON) <= from[n.id]!), n.id).toBe(true);
    }
  });

  const read = (extra: PlacedBuilding[], people: number, t: Tuning = ON, operable?: boolean[]) => {
    const s = cityWith(extra, people, t).settlements[0]!;
    return readNeeds(s, operable ?? s.buildings.map(() => true), new Set(), null, t)!;
  };

  it("a need not yet asked counts for nothing, met or not", () => {
    const small = read([], 499);
    expect(small.needs.every((n) => !n.asked)).toBe(true);
    expect(small.mood).toBe(0);
    const town = read([], 500);
    expect(town.needs.filter((n) => n.asked).map((n) => n.id)).toEqual(["green", "variety"]);
    expect(town.mood).toBeLessThan(0);
  });

  it("a provider that is not running reaches no one", () => {
    const extra = [at("laboratory", NEAR)];
    const s = cityWith(extra).settlements[0]!;
    const lab = s.buildings.findIndex((b) => b.type === "laboratory");
    const running = readNeeds(s, s.buildings.map(() => true), new Set(), null, ON)!;
    const dark = readNeeds(s, s.buildings.map((_, i) => i !== lab), new Set(), null, ON)!;
    expect(running.needs.find((n) => n.id === "research")!.met).toBe(1);
    expect(dark.needs.find((n) => n.id === "research")!.met).toBe(0);
  });

  it("a provider browned out for want this substep reaches no one, nor a greenhouse with it grows food", () => {
    // No water at all: everything that draws it - the laboratory, the greenhouse, the homes - goes dark.
    const s = cityWith([at("laboratory", NEAR), at("greenhouse", { tx: 70, ty: 40 })]);
    const dry: Settlement = { ...s.settlements[0]!, stores: { ...s.settlements[0]!.stores, water: 0 } };
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, ON), ON), ON, 0);
    const wet = settlementStep(s.settlements[0]!, env, ON, ON.SUBSTEP_YEARS);
    const parched = settlementStep(dry, env, ON, ON.SUBSTEP_YEARS);
    expect(wet.needs!.needs.find((n) => n.id === "research")!.met).toBe(1);
    expect(wet.needs!.needs.find((n) => n.id === "variety")!.met).toBe(0.5);
    expect(parched.shortages).toContain("water");
    expect(parched.needs!.needs.find((n) => n.id === "research")!.met).toBe(0);
    expect(parched.needs!.needs.find((n) => n.id === "variety")!.met).toBe(0);
  });

  it("reaches the homes in its square, and further a level up", () => {
    // A laboratory south of the homes' east end reaches only the eastern half of them; five levels up, all of them.
    const one = read([{ type: "laboratory", tx: 30, ty: 11, level: 1 }], 11000).needs.find((n) => n.id === "research")!.met;
    const six = read([{ type: "laboratory", tx: 30, ty: 11, level: 6 }], 11000).needs.find((n) => n.id === "research")!.met;
    expect(one).toBe(0.5);
    expect(six).toBe(1);
  });

  it("a home still going up houses no one, and counts for nothing", () => {
    const s = cityWith([at("laboratory", { tx: 30, ty: 11 })]).settlements[0]!;
    const all = readNeeds(s, s.buildings.map(() => true), new Set(), null, ON)!.needs.find((n) => n.id === "research")!.met;
    // Every home the laboratory does not reach, still going up: what is left is all reached.
    const cover = needCoverage(s, "research", s.buildings.map(() => true), ON);
    const going = new Set(cover.homes.filter((h) => !h.reached).map((h) => tileKey(s.buildings[h.index]!.tx, s.buildings[h.index]!.ty)));
    const built = readNeeds(s, s.buildings.map(() => true), going, null, ON)!.needs.find((n) => n.id === "research")!.met;
    expect(all).toBeLessThan(1);
    expect(built).toBe(1);
  });
});

describe("over the city's networks", () => {
  const NET = makeTuning({ ...BASE, NEEDS_ENABLED: 1, NETWORK_ENABLED: 1 });
  /**
   * Two domes and a laboratory near each other but not touching; the
   * laboratory's power and water from a plant and an extractor against its
   * wall (on the network, what it draws must be made on its own).
   */
  const apart = (corridors: number[]): Settlement => {
    const s = cityWith([], 600, NET).settlements[0]!;
    return {
      ...s,
      buildings: [
        { type: "habitat_dome", tx: 10, ty: 10, level: 1 },
        { type: "habitat_dome", tx: 14, ty: 10, level: 1 },
        { type: "laboratory", tx: 12, ty: 16, level: 1 },
        { type: "geothermal_plant", tx: 15, ty: 16, level: 1 },
        { type: "water_extractor", tx: 15, ty: 18, level: 1 },
      ],
      corridors,
      population: 2500,
    };
  };
  const research = (s: Settlement) => readNeeds(s, s.buildings.map(() => true), new Set(), null, NET)!;

  it("a provider in reach but on other corridors reaches no one; a corridor between them, and it does", () => {
    const env = habitat(marsStart().reservoirs, derive(marsStart().reservoirs, NEUTRAL_ENV, NET), NET, 0);
    const cut = apart([]);
    // A corridor along the domes' south walls, and down to the laboratory's north wall.
    const line = [tileKey(11, 13), tileKey(12, 13), tileKey(13, 13), tileKey(14, 13), tileKey(11, 14), tileKey(11, 15), tileKey(12, 15)].sort((a, b) => a - b);
    const joined = apart(line);
    const stepCut = settlementStep(cut, env, NET, NET.SUBSTEP_YEARS).needs!;
    const stepJoined = settlementStep(joined, env, NET, NET.SUBSTEP_YEARS).needs!;
    expect(stepCut.needs.find((n) => n.id === "research")!.met).toBe(0);
    expect(stepJoined.needs.find((n) => n.id === "research")!.met).toBe(1);
    // Read without the network, it is in reach either way: the corridors are what decided.
    expect(research(cut).needs.find((n) => n.id === "research")!.met).toBe(1);
  });
});
