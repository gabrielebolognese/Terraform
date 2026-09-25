/**
 * Railways between settlements (at the user's request: "we also need
 * interconnected cities").
 */

import { describe, expect, it } from "vitest";

import { advance } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { connectSettlements, disconnectSettlements, routeCost, routeKm } from "./routes.js";
import { capacities, placeBuilding } from "./settlement.js";

const ON = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, INTERCITY_ENABLED: 1 });
const OFF = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1 });

/** Two cities a few hundred kilometres apart, each with materials to lay a line. */
function pair(t = ON, materials = 5000): SimState {
  let s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
  s = foundSettlement(s, "city", 0.36, -1.05, t).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials } })) };
}
const [A, B] = ["settlement-1", "settlement-2"] as const;
const of = (s: SimState, id: string) => s.settlements.find((c) => c.id === id)!;

describe("laying a railway between two settlements", () => {
  it("costs materials by the kilometre, half from each end", () => {
    const s = pair();
    const km = routeKm(of(s, A), of(s, B));
    expect(km, "vacuity: some way apart").toBeGreaterThan(200);
    const cost = routeCost(of(s, A), of(s, B), ON);
    expect(cost).toBe(Math.ceil(km * ON.INTERCITY_COST_PER_KM));
    const o = connectSettlements(s, A, B, ON);
    expect(o.ok, o.reason ?? "").toBe(true);
    expect(o.state.routes).toEqual([{ a: A, b: B, km }]);
    expect(of(o.state, A).stores.materials).toBeCloseTo(5000 - cost / 2, 9);
    expect(of(o.state, B).stores.materials).toBeCloseTo(5000 - cost / 2, 9);
  });

  it("is refused, changing nothing, and says why: off, to itself, twice, or short of materials at either end", () => {
    expect(connectSettlements(pair(OFF), A, B, OFF).reason).toMatch(/not part of this game/);
    expect(connectSettlements(pair(), A, A, ON).reason).toMatch(/itself/);
    const once = connectSettlements(pair(), A, B, ON).state;
    expect(connectSettlements(once, B, A, ON).reason).toMatch(/joined already/);
    const poor = { ...pair(), settlements: pair().settlements.map((c) => (c.id === B ? { ...c, stores: { ...c.stores, materials: 10 } } : c)) };
    const refused = connectSettlements(poor, A, B, ON);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/km of railway needs .* materials, half from each end - settlement-2 has 10/);
    expect(refused.state).toBe(poor);
    expect(disconnectSettlements(once, B, A).state.routes).toEqual([]);
  });
});

describe("along a railway", () => {
  /** A and B joined, each with two water tanks' room, A's water full, B's empty. */
  function uneven(t = ON): SimState {
    let s = connectSettlements(pair(ON), A, B, ON).state;
    for (const id of [A, B]) for (const x of [4, 8]) s = placeBuilding(s, id, "water_tank", x, 4, ON).state;
    const capA = capacities(of(s, A), t);
    return { ...s, settlements: s.settlements.map((c) => (c.id === A ? { ...c, stores: { ...c.stores, water: capA.water, power: 7 } } : { ...c, stores: { ...c.stores, water: 0, power: 3 } })) };
  }
  const cfg = (t = ON) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });

  it("water, oxygen, food and materials flow from the fuller city to the emptier, up to a line's carry a year - never power", () => {
    const s = uneven();
    const before = of(s, A).stores.water - of(s, B).stores.water;
    const one = advance(s, 1, cfg());
    // The first substep: a line's carry for a quarter-year, exactly, over what B makes itself - the gap is far wider.
    const alone = advance({ ...s, routes: [] }, 1, cfg());
    expect(of(one, B).stores.water - of(alone, B).stores.water).toBeCloseTo(ON.INTERCITY_CARRY * ON.SUBSTEP_YEARS, 9);
    // In time, as full as each other.
    const later = advance(s, 4 * 40, cfg());
    const fill = (id: string) => of(later, id).stores.water / capacities(of(later, id), ON).water;
    expect(Math.abs(fill(A) - fill(B))).toBeLessThan(0.02);
    // Measured: 840 apart, more than a year's carry.
    expect(before, "vacuity: they began uneven").toBeGreaterThan(ON.INTERCITY_CARRY);
    // Power is not carried: the same power as with no line.
    expect(of(one, A).stores.power).toBe(of(alone, A).stores.power);
  });

  it("carries nothing with railways between settlements off", () => {
    const s = uneven();
    const off = advance(s, 4, cfg(OFF));
    const unjoined = advance({ ...s, routes: [] }, 4, cfg(OFF));
    expect(off.settlements).toEqual(unjoined.settlements);
  });

  it("is the same however time is chunked, and survives the save", () => {
    const s = uneven();
    let chunked = s;
    for (let k = 0; k < 12; k += 1) chunked = advance(chunked, 1, cfg());
    expect(chunked).toEqual(advance(s, 12, cfg()));
    expect(deserialize(serialize(chunked, ON, "2026-09-25T00:00:00.000Z"), ON)).toEqual(chunked);
  });
});

describe("saves before railways between settlements", () => {
  it("load with none", () => {
    const s = connectSettlements(pair(), A, B, ON).state;
    const old = JSON.parse(serialize(s, ON, "2026-09-25T00:00:00.000Z")) as Record<string, unknown>;
    delete old["routes"];
    old["schema_version"] = 12;
    expect(deserialize(JSON.stringify(old), ON).routes).toEqual([]);
  });

  it("refuse a railway to a settlement that is not there", () => {
    const s = connectSettlements(pair(), A, B, ON).state;
    const bad = JSON.parse(serialize(s, ON, "2026-09-25T00:00:00.000Z")) as { routes: { b: string }[] };
    bad.routes[0]!.b = "settlement-9";
    expect(() => deserialize(JSON.stringify(bad), ON)).toThrow(/two different settlements of this world/);
  });
});
