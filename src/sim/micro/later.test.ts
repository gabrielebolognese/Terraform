/**
 * The city's later buildings (at the user's request): laboratory, algae
 * reactor, skyscraper (1,000 people), astronomy observatory (5 x 5, 2,000),
 * station (4 x 6, railways between districts, 5,000), research forum
 * (4 x 6, bar and lab), medical center (5 x 5, 1,000: shelter from dying when
 * oxygen or food runs short), industrial command center (6 x 4: facilities in
 * a 15 x 15 square about it make 10% more at level 1).
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import type { HabitatChannels } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { housing, placeBuilding, placeLink, settlementStep, upgradeBuilding } from "./settlement.js";

const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, NETWORK_ENABLED: 1, CITY_GRID_TILES: 96 });

function city(people: number, t: Tuning = T): SimState {
  const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: people, stores: { ...c.stores, materials: 1e6 } })) };
}
const first = (s: SimState): Settlement => s.settlements[0]!;
const id = (s: SimState): string => first(s).id;
const envOf = (s: SimState, t: Tuning = T): HabitatChannels => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t, 0);
const step = (s: SimState, t: Tuning = T) => settlementStep(first(s), envOf(s, t), t, t.SUBSTEP_YEARS);

function place(s: SimState, type: BuildingType, tx: number, ty: number, t: Tuning = T): SimState {
  const o = placeBuilding(s, id(s), type, tx, ty, t);
  expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
  return o.state;
}
/** Power and water enough for anything a test builds, far from where it builds (no networks). */
function supplied(s: SimState, t: Tuning): SimState {
  let out = s;
  for (let k = 0; k < 10; k += 1) out = place(out, "geothermal_plant", 60 + 3 * (k % 5), 80 + 3 * Math.floor(k / 5), t);
  for (let k = 0; k < 4; k += 1) out = place(out, "water_extractor", 76 + 3 * k, 80, t);
  return out;
}

const runs = (s: SimState, type: BuildingType, t: Tuning = T): boolean => {
  const i = first(s).buildings.findIndex((b) => b.type === type);
  return step(s, t).operable[i] === true;
};

describe("who may build them", () => {
  it("asks a city for its people: skyscraper and medical center 1,000, observatory 2,000, station 5,000", () => {
    for (const [type, needs] of [["skyscraper", 1000], ["medical_center", 1000], ["observatory", 2000], ["station", 5000]] as const) {
      expect(placeBuilding(city(needs - 1), "settlement-1", type, 10, 10, T).reason, type).toMatch(new RegExp(`needs a city of ${needs} people`));
      expect(placeBuilding(city(needs), "settlement-1", type, 10, 10, T).ok, type).toBe(true);
    }
    expect(placeBuilding(city(0), "settlement-1", "laboratory", 10, 10, T).ok).toBe(true);
  });

  it("gives a station 4 tiles by 6, and a command center 6 by 4", () => {
    let s = place(city(6000), "station", 10, 10);
    // Its far corner is (13, 15); just past it is free.
    expect(placeBuilding(s, id(s), "storage_depot", 13, 15, T).reason).toMatch(/overlap/);
    expect(placeBuilding(s, id(s), "storage_depot", 14, 15, T).ok).toBe(true);
    expect(placeBuilding(s, id(s), "storage_depot", 13, 16, T).ok).toBe(true);
    s = place(city(0), "industrial_command", 10, 10);
    expect(placeBuilding(s, id(s), "storage_depot", 15, 13, T).reason).toMatch(/overlap/);
    expect(placeBuilding(s, id(s), "storage_depot", 16, 13, T).ok).toBe(true);
    expect(placeBuilding(s, id(s), "storage_depot", 15, 14, T).ok).toBe(true);
  });
});

describe("what they do", () => {
  // No networks: what is tested is each building's own work.
  const PLAIN = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, CITY_GRID_TILES: 96 });

  it("a skyscraper houses 160 people on four tiles; an algae reactor breathes out oxygen", () => {
    const before = supplied(city(1000, PLAIN), PLAIN);
    const s = place(before, "skyscraper", 10, 10, PLAIN);
    expect(housing(first(s), PLAIN) - housing(first(before), PLAIN)).toBe(160);
    const algae = place(before, "algae_reactor", 10, 10, PLAIN);
    expect(step(algae, PLAIN).production.oxygen - step(before, PLAIN).production.oxygen).toBeCloseTo(PLAIN.ALGAE_OXYGEN, 10);
  });

  it("laboratories, observatories and forums earn credits - the planet's economy grows by them", () => {
    const ECON = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, CITY_GRID_TILES: 96, ECONOMY_ENABLED: 1 });
    let s = city(3000, ECON);
    s = place(s, "geothermal_plant", 20, 20, ECON);
    s = place(s, "geothermal_plant", 20, 24, ECON);
    s = place(s, "water_extractor", 24, 20, ECON);
    const without = s;
    s = place(s, "laboratory", 30, 30, ECON);
    s = place(s, "observatory", 30, 40, ECON);
    expect(step(s, ECON).research).toBeCloseTo(ECON.LAB_RESEARCH + ECON.OBSERVATORY_RESEARCH, 10);
    const years = 4;
    const a = advance(s, years / ECON.SUBSTEP_YEARS, { tuning: ECON, env: NEUTRAL_ENV, forcing: null });
    const b = advance(without, years / ECON.SUBSTEP_YEARS, { tuning: ECON, env: NEUTRAL_ENV, forcing: null });
    expect(a.economy.earned - b.economy.earned).toBeCloseTo((ECON.LAB_RESEARCH + ECON.OBSERVATORY_RESEARCH) * years, 6);
  });

  it("a research forum makes the city grow faster", () => {
    let s = supplied(city(200, PLAIN), PLAIN);
    for (let k = 0; k < 8; k += 1) s = place(s, "habitat_dome", 10 + 4 * k, 10, PLAIN);
    for (let k = 0; k < 5; k += 1) s = place(s, "greenhouse", 10 + 3 * k, 20, PLAIN);
    for (let k = 0; k < 4; k += 1) s = place(s, "geothermal_plant", 10 + 3 * k, 30, PLAIN);
    for (let k = 0; k < 3; k += 1) s = place(s, "water_extractor", 30 + 3 * k, 30, PLAIN);
    const grown = (st: SimState): number => first(st).population;
    const plain = grown(advance(s, 4, { tuning: PLAIN, env: NEUTRAL_ENV, forcing: null }));
    const withForum = place(s, "research_forum", 40, 40, PLAIN);
    expect(runs(withForum, "research_forum", PLAIN), "vacuity: the forum runs").toBe(true);
    const faster = grown(advance(withForum, 4, { tuning: PLAIN, env: NEUTRAL_ENV, forcing: null }));
    expect(plain, "vacuity: the city grows at all").toBeGreaterThan(200);
    expect(faster - 200).toBeGreaterThan((plain - 200) * 1.15);
  });

  it("a medical center shelters its people from dying while oxygen runs short - and not while power does", () => {
    // Domes and plenty of everything but oxygen: people start to die.
    let s = supplied(city(1200, PLAIN), PLAIN);
    // Homes for all 1,200 (a load, or a step, clamps people to their homes).
    for (let k = 0; k < 30; k += 1) s = place(s, "habitat_dome", 10 + 4 * (k % 10), 10 + 4 * Math.floor(k / 10), PLAIN);
    expect(housing(first(s), PLAIN)).toBeGreaterThanOrEqual(1200);
    for (let k = 0; k < 18; k += 1) s = place(s, "greenhouse", 10 + 3 * (k % 12), 24 + 3 * Math.floor(k / 12), PLAIN);
    for (let k = 0; k < 16; k += 1) s = place(s, "geothermal_plant", 10 + 3 * (k % 12), 40 + 3 * Math.floor(k / 12), PLAIN);
    for (let k = 0; k < 10; k += 1) s = place(s, "water_extractor", 10 + 3 * k, 50, PLAIN);
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, oxygen: 0 } })) };
    const lost = (st: SimState): number => 1200 - first(advance(st, 1, { tuning: PLAIN, env: NEUTRAL_ENV, forcing: null })).population;
    expect(step(s, PLAIN).shortages, "vacuity: oxygen is short, nothing else").toEqual(["oxygen"]);
    const without = lost(s);
    expect(without, "vacuity: people die without shelter").toBeGreaterThan(0);
    const one = place(s, "medical_center", 60, 60, PLAIN);
    const two = place(one, "medical_center", 70, 60, PLAIN);
    // Each shelters 400 of the 1,200: the rest decline as before.
    expect(lost(one)).toBeCloseTo((without * (1200 - 400)) / 1200, 6);
    expect(lost(two)).toBeCloseTo((without * (1200 - 800)) / 1200, 6);
    // A center still going up does not run, and shelters nobody.
    const BUILDING = { ...PLAIN, BUILD_TIME_ENABLED: 1 };
    const rising = placeBuilding(s, id(s), "medical_center", 60, 60, BUILDING);
    expect(rising.ok, rising.reason ?? "").toBe(true);
    expect(1200 - first(advance(rising.state, 1, { tuning: BUILDING, env: NEUTRAL_ENV, forcing: null })).population).toBeCloseTo(without, 6);
    // Short of power, the centers cannot run, and cannot save anyone.
    const dark = { ...two, settlements: two.settlements.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type !== "geothermal_plant"), stores: { ...c.stores, power: 0 } })) };
    expect(lost(dark)).toBeGreaterThan(lost(two));
  });

  it("an industrial command center: facilities in the square about it make 10% more, the square growing each level", () => {
    let s = supplied(city(0, PLAIN), PLAIN);
    s = place(s, "industrial_command", 10, 10, PLAIN);
    // Its middle is (13, 12); at level 1 its square reaches 7.5 tiles each way.
    const power = (st: SimState): number => step(st, PLAIN).production.power;
    const plantAt = (x: number, y: number): number => {
      const base = power(s);
      return power(place(s, "geothermal_plant", x, y, PLAIN)) - base;
    };
    expect(runs(s, "industrial_command", PLAIN), "vacuity: the command center runs").toBe(true);
    const alone = (() => {
      const bare = supplied(city(0, PLAIN), PLAIN);
      return power(place(bare, "geothermal_plant", 30, 30, PLAIN)) - power(bare);
    })();
    // Middle (17, 16): 4 tiles each way from the command's.
    expect(plantAt(16, 15) / alone).toBeCloseTo(1.1, 10);
    // Middle (21, 12): 8 tiles east - outside at level 1.
    expect(plantAt(20, 11) / alone).toBeCloseTo(1, 10);
    s = upgradeBuilding(s, id(s), 11, 11, PLAIN).state;
    // Level 2: 17 tiles a side, 8.5 each way - now inside.
    expect(plantAt(20, 11) / alone).toBeCloseTo(1.1, 10);
  });
});

describe("stations and railways", () => {
  /**
   * Two districts far apart, each with a station, cabled to it: a mine in
   * the west needing power, the power plant in the east.
   */
  function districts(): SimState {
    let s = city(6000);
    s = place(s, "station", 10, 60);
    s = place(s, "regolith_mine", 16, 62);
    s = place(s, "station", 70, 60);
    // Power enough for both stations, the mine and the spaceport.
    for (const y of [60, 63, 66]) s = place(s, "geothermal_plant", 76, y);
    s = placeLink(s, id(s), "cables", 76, 62, T).state;
    for (const [x0, x1, y] of [[14, 15, 62], [74, 75, 62]] as const) for (let x = x0; x <= x1; x += 1) s = placeLink(s, id(s), "cables", x, y, T).state;
    return s;
  }

  it("join the districts round the stations they link: a mine powered from across the city", () => {
    const apart = districts();
    const issue = (st: SimState) => step(st).network[first(st).buildings.findIndex((b) => b.type === "regolith_mine")];
    expect(issue(apart), "vacuity: without rails, no power on the mine's network").toEqual({ kind: "unsupplied", resources: ["power"] });
    let s = apart;
    // A line of rail from the west station's east side to the east station's west side.
    for (let x = 14; x < 70; x += 1) {
      const o = placeLink(s, id(s), "rails", x, 65, T);
      expect(o.ok, `rail at ${x},65: ${o.reason}`).toBe(true);
      s = o.state;
    }
    expect(first(s).rails).toHaveLength(56);
    expect(issue(s)).toBeNull();
    expect(runs(s, "regolith_mine")).toBe(true);
    // Take one rail up: the line is cut, and the mine is dark again.
    const cut = { ...s, settlements: s.settlements.map((c) => ({ ...c, rails: c.rails.filter((_, i) => i !== 20) })) };
    expect(runs(cut, "regolith_mine")).toBe(false);
  });

  it("board only stations: a rail touching any other building joins nothing", () => {
    let s = city(6000);
    // Two stations elsewhere, off the line: only they could board it.
    s = place(s, "station", 10, 10);
    s = place(s, "station", 30, 10);
    s = place(s, "regolith_mine", 16, 62);
    s = place(s, "geothermal_plant", 76, 62);
    for (let x = 18; x < 76; x += 1) s = placeLink(s, id(s), "rails", x, 62, T).state;
    expect(runs(s, "regolith_mine")).toBe(false);
  });

  it("are saved, and a building may not stand on them", () => {
    let s = districts();
    for (let x = 14; x < 70; x += 1) s = placeLink(s, id(s), "rails", x, 65, T).state;
    expect(placeBuilding(s, id(s), "storage_depot", 30, 65, T).reason).toMatch(/railway/);
    const back = deserialize(serialize(s, T, "2026-09-25T00:00:00.000Z"), T);
    expect(first(back).rails).toEqual(first(s).rails);
  });
});
