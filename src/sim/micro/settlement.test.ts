/**
 * Batch 18's exit gate - micro doc §12 step 2: "Verify a city survives,
 * grows, and that an Atmosphere Processor's planetary output shows up in the
 * macro sim's rate." Every threshold below was MEASURED first; the
 * measurement sits beside it.
 */

import { describe, expect, it } from "vitest";

import { REFERENCE_POLICY } from "../../harness/policy.js";
import { runTrajectory } from "../../harness/run.js";
import { carbonInvariant } from "../conserve.js";
import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { computeStep } from "../rates/index.js";
import { DEFAULT_TUNING, makeTuning } from "../tuning.js";
import type { BuildingType, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { buildFacility } from "../actions.js";
import { foundSettlement } from "./registry.js";
import { placeBuilding, removeBuilding, settlementStep } from "./settlement.js";

const ON = makeTuning({ SETTLEMENTS_ENABLED: 1 });
const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };

function step(s: SimState) {
  const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, ON), ON), ON, 0);
  return settlementStep(s.settlements[0]!, env, ON, ON.SUBSTEP_YEARS);
}

function withMaterials(s: SimState, materials: number): SimState {
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials } })) };
}

function build(s: SimState, plan: readonly (readonly [BuildingType, number, number])[]): SimState {
  let out = s;
  const id = s.settlements[0]!.id;
  for (const [type, tx, ty] of plan) {
    const o = placeBuilding(out, id, type, tx, ty, ON);
    expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
    out = o.state;
  }
  return out;
}

/** A single-dome city with every need met: section 7.3's logistic, clean. */
function supplyCity(): SimState {
  const s = withMaterials(foundSettlement(marsStart(), "city", 0.3, 1.0, ON).state, 1000);
  return build(s, [
    ["spaceport", 2, 2],
    ["geothermal_plant", 6, 2],
    ["geothermal_plant", 9, 2],
    ["habitat_dome", 2, 6],
    ["greenhouse", 6, 6],
    ["water_extractor", 9, 6],
    ["atmosphere_processor", 12, 2],
  ]);
}

describe("a city survives and grows (the doc's section 2.3 bootstrap)", () => {
  it("bootstraps from the founding stock in the doc's order and grows to fill its housing", () => {
    // Section 2.3: Spaceport and power first, then life support, then more as
    // materials arrive from Earth and the mine. Built only when affordable.
    let s = foundSettlement(marsStart(), "city", 0.3, 1.0, ON).state;
    const id = s.settlements[0]!.id;
    const plan: [BuildingType, number, number][] = [
      ["spaceport", 2, 2], ["geothermal_plant", 6, 2], ["solar_array", 9, 2], ["habitat_dome", 2, 6],
      ["greenhouse", 6, 6], ["water_extractor", 9, 6], ["regolith_mine", 12, 6], ["geothermal_plant", 12, 2],
      ["atmosphere_processor", 15, 2], ["storage_depot", 15, 6], ["habitat_dome", 2, 10],
      ["greenhouse", 6, 10], ["geothermal_plant", 9, 10],
    ];
    let next = 0;
    let unsupported = 0;
    for (let year = 0; year < 150; year += 1) {
      while (next < plan.length) {
        const [type, x, y] = plan[next]!;
        const o = placeBuilding(s, id, type, x, y, ON);
        if (!o.ok) break;
        s = o.state;
        next += 1;
      }
      if (year > 0 && !step(s).supported) unsupported += 1;
      s = advance(s, 4, cfg);
    }
    // Measured: every building placed by year 48; supported every year; 80.00
    // people at year 150 in two 40-person domes.
    expect(next, "the plan stalled - the city could not afford its own growth").toBe(plan.length);
    expect(unsupported).toBe(0);
    expect(s.settlements[0]!.population).toBeGreaterThan(79.9);
    expect(s.settlements[0]!.population).toBeLessThanOrEqual(80);
  });

  it("grows along an S-curve: fastest around half its housing, as section 7.3's logistic should", () => {
    let s = supplyCity();
    const pops: number[] = [];
    for (let year = 0; year <= 80; year += 1) {
      pops.push(s.settlements[0]!.population);
      s = advance(s, 4, cfg);
    }
    // Skip year 0, where the first settlers arrive in one step.
    const gains = pops.slice(2).map((p, i) => p - pops[i + 1]!);
    const fastest = gains.indexOf(Math.max(...gains)) + 1;
    const half = pops.findIndex((p) => p >= 20);
    // Measured: half housing crossed at year 23; the fastest year sits there too.
    expect(Math.abs(fastest - half), `fastest growth at year ${fastest}, half full at ${half}`).toBeLessThanOrEqual(3);
    expect(half).toBeGreaterThan(10);
  });
});

describe("a shortfall browns out and harms the population (section 7.2)", () => {
  const grown = (): SimState => {
    let s = supplyCity();
    s = advance(s, 400, cfg); // 100 years: full
    return s;
  };

  it("is reachable: the grown city is fully running and supported", () => {
    const st = step(grown());
    expect(st.operable.every(Boolean)).toBe(true);
    expect(st.supported).toBe(true);
  });

  it("switches off everything that needs power when the power plants go, and the people decline", () => {
    let s = grown();
    const id = s.settlements[0]!.id;
    for (const [x, y] of [[6, 2], [9, 2]] as const) s = removeBuilding(s, id, x, y).state;
    const before = s.settlements[0]!.population;
    s = advance(s, 4, cfg); // the one-substep power buffer drains within the year
    const st = step(s);
    const powered = s.settlements[0]!.buildings.map((b) => ["spaceport", "habitat_dome", "greenhouse", "water_extractor", "atmosphere_processor"].includes(b.type));
    st.operable.forEach((on, i) => {
      if (powered[i]) expect(on, `${s.settlements[0]!.buildings[i]!.type} kept running without power`).toBe(false);
    });
    expect(st.supported).toBe(false);
    s = advance(s, 16, cfg);
    // Measured: 39.99 -> 15.09 over five years at the 0.2/yr decline (e^-1 = 0.37).
    const ratio = s.settlements[0]!.population / before;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.45);
  });
});

describe("the Atmosphere Processor pushes the planet (section 2.2)", () => {
  // A real mid-game world: 600 years of the reference playthrough, 397 mbar, 273 mbar of CO2.
  const mid = runTrajectory(REFERENCE_POLICY, 600, 2, DEFAULT_TUNING).finalState;
  const withProcessors = (n: number): SimState => {
    let s = withMaterials(foundSettlement(mid, "outpost", 0, 0, ON).state, 2000);
    const id = s.settlements[0]!.id;
    s = placeBuilding(s, id, "reactor", 0, 0, ON).state;
    for (let k = 0; k < n; k += 1) s = placeBuilding(s, id, "atmosphere_processor", 3 + 2 * k, 0, ON).state;
    return s;
  };
  const microFlows = (s: SimState) => {
    const d = derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, ON), ON);
    return computeStep(s, d, ON, ON.SUBSTEP_YEARS, null).flows.filter((f) => f.id.startsWith("micro."));
  };

  it("shows up in the macro sim's rate, in proportion to the buildings", () => {
    const four = microFlows(withProcessors(4));
    const carbon = four.find((f) => f.id === "micro.moxie_carbon");
    const oxygen = four.find((f) => f.id === "micro.moxie_o2");
    // Measured: exactly 4 x PROCESSOR_CO2_DRAW with this much air (no floor, no depletion).
    expect(carbon?.rate).toBeCloseTo(4 * ON.PROCESSOR_CO2_DRAW, 12);
    expect(oxygen?.rate).toBeCloseTo(4 * ON.PROCESSOR_CO2_DRAW * (32 / 88), 12);
    expect(microFlows(withProcessors(2)).find((f) => f.id === "micro.moxie_carbon")?.rate).toBeCloseTo(2 * ON.PROCESSOR_CO2_DRAW, 12);
  });

  it("goes when the processors go", () => {
    let s = withProcessors(4);
    const id = s.settlements[0]!.id;
    for (let k = 0; k < 4; k += 1) s = removeBuilding(s, id, 3 + 2 * k, 0).state;
    expect(microFlows(s)).toEqual([]);
  });

  it("moves the planet by what the chemistry says, and the carbon ledger closes", () => {
    const start = withProcessors(4);
    const a = advance(start, 400, cfg);
    const b = advance(foundSettlement(mid, "outpost", 0, 0, ON).state, 400, cfg);
    // Measured over 100 years: 20.000 mbar sequestered, CO2 down 19.95, O2 up 7.25 (32/88 of 20 = 7.27).
    expect(a.ledger.c_sequestered - b.ledger.c_sequestered).toBeCloseTo(20, 6);
    expect(b.reservoirs.co2_atm - a.reservoirs.co2_atm).toBeGreaterThan(19);
    expect(a.reservoirs.o2 - b.reservoirs.o2).toBeGreaterThan(7);
    expect(a.reservoirs.o2 - b.reservoirs.o2).toBeLessThan(7.3);
    // Measured drift 8.8e-12 mbar over the century.
    expect(Math.abs(carbonInvariant(a) - carbonInvariant(start))).toBeLessThan(1e-9);
  });

  it("will not pull a bare Mars under the triple point: no planetary draw below the pressure floor", () => {
    // 6.2 mbar is under P_FLOOR, so the scrubber's guard holds the processor back.
    let s = withMaterials(foundSettlement(marsStart(), "outpost", 0, 0, ON).state, 2000);
    const id = s.settlements[0]!.id;
    s = placeBuilding(s, id, "reactor", 0, 0, ON).state;
    s = placeBuilding(s, id, "atmosphere_processor", 3, 0, ON).state;
    expect(step(s).planetaryCo2, "it does want to draw").toBeGreaterThan(0);
    expect(microFlows(s)).toEqual([]);
  });
});

describe("the settlement layer keeps the engine's guarantees", () => {
  it("is chunk-independent: one long call equals many short ones, settlements included", () => {
    const start = supplyCity();
    let chunked = start;
    for (let i = 0; i < 100; i += 1) chunked = advance(chunked, 4, cfg);
    expect(chunked).toEqual(advance(start, 400, cfg));
  });

  it("is off by default: with SETTLEMENTS_ENABLED 0 a settlement does not even tick", () => {
    const s = supplyCity();
    const after = advance(s, 400, { tuning: DEFAULT_TUNING, env: NEUTRAL_ENV, forcing: null });
    expect(after.settlements).toEqual(s.settlements);
  });
});

describe("placement (section 3.3) and the building set (section 5)", () => {
  const city = () => withMaterials(foundSettlement(marsStart(), "city", 0, 0, ON).state, 1000);

  it("refuses every way a building cannot go, and says why", () => {
    const s = build(city(), [["spaceport", 0, 0]]);
    const id = s.settlements[0]!.id;
    expect(placeBuilding(s, id, "reactor", 31, 0, ON).reason).toMatch(/runs off the grid/);
    expect(placeBuilding(s, id, "reactor", 2, 2, ON).reason).toMatch(/overlap/);
    const poor = withMaterials(s, 5);
    expect(placeBuilding(poor, id, "reactor", 10, 10, ON).reason).toMatch(/needs 150 materials, 5 available/);
    const outpost = foundSettlement(marsStart(), "outpost", 0, 0, ON).state;
    expect(placeBuilding(outpost, outpost.settlements[0]!.id, "habitat_dome", 0, 0, ON).reason).toMatch(/cannot be built in an outpost/);
  });

  it("charges the cost and frees the tiles when the building goes", () => {
    let s = city();
    const id = s.settlements[0]!.id;
    s = placeBuilding(s, id, "reactor", 4, 4, ON).state;
    expect(s.settlements[0]!.stores.materials).toBe(1000 - ON.COST_REACTOR);
    expect(placeBuilding(s, id, "solar_array", 5, 5, ON).ok).toBe(false);
    s = removeBuilding(s, id, 5, 5).state;
    expect(placeBuilding(s, id, "solar_array", 5, 5, ON).ok).toBe(true);
  });

  it("scales solar power with the planet's sunlight: real orbital mirrors raise it", () => {
    // Through the whole chain: a mirror changes the planet's sunlight, the
    // city-layer contract carries it, the array makes more power.
    const plain = build(city(), [["solar_array", 0, 0]]);
    const mirrored = { ...buildFacility(plain, "orbital_mirror", 50, 5, ON) };
    const deployed = { ...mirrored, facilities: mirrored.facilities.map((f) => ({ ...f, deployed: f.count * f.level })) };
    expect(step(deployed).next.stores.power).toBeGreaterThan(step(plain).next.stores.power);
  });
});
