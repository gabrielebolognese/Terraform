/**
 * Batch 9's exit gate: a facility costs something, the tech tree gates on
 * phase, and the city layer has a documented, tested interface.
 *
 * All three are here plus the property that makes them safe to ship - that
 * with the economy OFF, nothing in this batch is observable. Every prior
 * batch's balance, golden frames and exactness tests are written against a
 * world without costs, and they have to keep meaning what they meant.
 */

import { describe, expect, it } from "vitest";

import type { SimState } from "./types.js";
import { NEUTRAL_ENV, Phase } from "./types.js";
import { advance, simYear } from "./integrate.js";
import { derive } from "./derive.js";
import { marsStart } from "./planets/mars.js";
import { makeTuning } from "./tuning.js";
import { orderFacility, buildFacility, seedBiosphere } from "./actions.js";
import { accrue, incomeRate, orderCost, purchase, startingEconomy, upkeepRate } from "./economy.js";
import { habitat } from "./habitat.js";
import { TECH, availableTech, gatingTech, techGate, unlockedFor } from "./tech.js";
import { FACILITY_TYPES } from "./types.js";

const ON = makeTuning({ ECONOMY_ENABLED: 1, TECH_GATE_ENABLED: 1 });
const OFF = makeTuning();

function config(tuning = ON) {
  return { tuning, env: NEUTRAL_ENV, forcing: null };
}

describe("a facility costs something", () => {
  it("charges for an order and takes it out of the bank", () => {
    const start = marsStart(123456, ON);
    const before = start.economy.credits;
    const outcome = orderFacility(start, "orbital_mirror", 3, 1, ON);

    expect(outcome.ok).toBe(true);
    expect(outcome.cost).toBeGreaterThan(0);
    expect(outcome.state.economy.credits).toBeCloseTo(before - outcome.cost, 9);
    expect(outcome.state.economy.spent).toBeCloseTo(outcome.cost, 9);
  });

  it("refuses what cannot be afforded, and changes nothing", () => {
    const start = marsStart(123456, ON);
    const outcome = orderFacility(start, "orbital_mirror", ON.FACILITY_MAX_COUNT, 1, ON);

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/credits/);
    // All-or-nothing: not a single unit sneaks through.
    expect(outcome.state).toBe(start);
  });

  it("makes each successive unit dearer", () => {
    const first = orderCost("orbital_mirror", 0, 1, 1, ON);
    const tenth = orderCost("orbital_mirror", 9, 10, 1, ON);
    expect(tenth).toBeGreaterThan(first);
    // And the escalation is smooth, not a cliff.
    expect(tenth / first).toBeLessThan(3);
  });

  it("charges only for the units being added", () => {
    const zeroToSix = orderCost("atmo_processor", 0, 6, 1, ON);
    const zeroToFour = orderCost("atmo_processor", 0, 4, 1, ON);
    const fourToSix = orderCost("atmo_processor", 4, 6, 1, ON);
    expect(zeroToFour + fourToSix).toBeCloseTo(zeroToSix, 6);
  });

  it("lets a player retire a lever they can no longer afford to run", () => {
    // Scaling down is free and never refused - otherwise an overextended
    // player is stuck paying upkeep on something they cannot sell.
    let state = marsStart(123456, ON);
    state = orderFacility(state, "orbital_mirror", 4, 1, ON).state;
    const broke: SimState = { ...state, economy: { credits: 0, earned: 0, spent: 0 } };

    const down = orderFacility(broke, "orbital_mirror", 1, 1, ON);
    expect(down.ok).toBe(true);
    expect(down.cost).toBe(0);
    expect(down.state.facilities.find((f) => f.type === "orbital_mirror")?.count).toBe(1);
  });

  it("prices every facility, with none left free by accident", () => {
    for (const type of FACILITY_TYPES) {
      expect(orderCost(type, 0, 1, 1, ON), `${type} is free`).toBeGreaterThan(0);
    }
  });

  it("never lets upkeep push the balance below zero", () => {
    let state = marsStart(123456, ON);
    state = orderFacility(state, "orbital_mirror", 8, 1, ON).state;
    // Pretend they are all deployed, then run with an empty bank.
    state = {
      ...state,
      economy: { credits: 0, earned: 0, spent: 0 },
      facilities: state.facilities.map((f) => ({ ...f, deployed: f.count * f.level })),
    };
    const d = derive(state.reservoirs, NEUTRAL_ENV, ON);
    const next = accrue(state.economy, habitat(state.reservoirs, d, ON), state, 1, ON);
    expect(next.credits).toBeGreaterThanOrEqual(0);
  });

  it("charges upkeep for what is deployed, not for what is ordered", () => {
    let state = marsStart(123456, ON);
    state = orderFacility(state, "orbital_mirror", 5, 1, ON).state;
    // Nothing has deployed yet.
    expect(upkeepRate(state.facilities, ON)).toBe(0);

    const running = state.facilities.map((f) => ({ ...f, deployed: 5 }));
    expect(upkeepRate(running, ON)).toBeGreaterThan(0);
  });

  it("refuses nothing when the economy is off", () => {
    const start = marsStart(123456, OFF);
    const outcome = orderFacility(start, "orbital_mirror", OFF.FACILITY_MAX_COUNT, 1, OFF);
    expect(outcome.ok).toBe(true);
    expect(outcome.cost).toBe(0);
  });
});

describe("the tech tree gates on phase", () => {
  it("covers every facility exactly once", () => {
    const seen = new Map<string, number>();
    for (const tech of TECH) {
      for (const type of tech.unlocks) seen.set(type, (seen.get(type) ?? 0) + 1);
    }
    for (const type of FACILITY_TYPES) {
      expect(seen.get(type), `${type} is behind no tech, so it is always available`).toBe(1);
    }
  });

  it("has unique ids", () => {
    expect(new Set(TECH.map((t) => t.id)).size).toBe(TECH.length);
  });

  it("gives a fresh world only its phase-0 tech", () => {
    const start = marsStart(123456, ON);
    expect(start.techUnlocked.length).toBeGreaterThan(0);
    for (const id of start.techUnlocked) {
      const tech = TECH.find((x) => x.id === id);
      expect(tech?.phase).toBe(Phase.Barren);
    }
  });

  it("refuses a facility whose tech has not arrived", () => {
    const start = marsStart(123456, ON);
    const gate = techGate(start, "magnetic_shield", ON);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/not unlocked/);

    const outcome = orderFacility(start, "magnetic_shield", 1, 1, ON);
    expect(outcome.ok).toBe(false);
    expect(outcome.state).toBe(start);
  });

  it("grants tech as the latched phase rises, and never takes it back", () => {
    let unlocked: readonly string[] = [];
    let previous = 0;
    for (const phase of [0, 1, 2, 3, 4, 5, 6] as const) {
      const next = unlockedFor(phase, unlocked);
      // Monotone: everything already granted is still granted.
      for (const id of unlocked) expect(next).toContain(id);
      expect(next.length).toBeGreaterThanOrEqual(previous);
      previous = next.length;
      unlocked = next;
    }
    // By the end every facility is reachable.
    expect(unlocked.length).toBe(TECH.length);
  });

  it("returns the same array when nothing changed, so advance does not churn", () => {
    const once = unlockedFor(Phase.Warming, []);
    expect(unlockedFor(Phase.Warming, once)).toBe(once);
  });

  it("unlocks during advance, not only during tick", () => {
    // Both production drivers call advance directly. An unlock living only in
    // tick never fires for them - the mistake Batch 1 found with the ledger
    // assertion, repeated here and caught the same way.
    let state = marsStart(123456, ON);
    state = buildFacility(state, "orbital_mirror", 20, 1, makeTuning());
    state = buildFacility(state, "ghg_factory", 10, 1, makeTuning());

    const before = state.techUnlocked.length;
    state = advance(state, 4000, config());
    expect(state.phaseReached).toBeGreaterThan(Phase.Barren);
    expect(state.techUnlocked.length, "advance granted no tech").toBeGreaterThan(before);
  });

  it("gates nothing when the gate is off", () => {
    const start = marsStart(123456, OFF);
    expect(techGate(start, "magnetic_shield", OFF).allowed).toBe(true);
  });

  it("names a real tech for every facility", () => {
    for (const type of FACILITY_TYPES) {
      expect(gatingTech(type), `${type} has no gating tech`).toBeDefined();
    }
    expect(availableTech(Phase.Barren).length).toBeGreaterThan(0);
    expect(availableTech(Phase.LivingWorld).length).toBe(TECH.length);
  });
});

describe("income follows the habitat contract", () => {
  it("pays nothing on a dead planet with the economy off", () => {
    const start = marsStart(123456, OFF);
    const d = derive(start.reservoirs, NEUTRAL_ENV, OFF);
    expect(incomeRate(habitat(start.reservoirs, d, OFF), OFF)).toBe(0);
  });

  it("pays something even on a dead planet when it is on", () => {
    // Somebody has to be there to order the mirrors.
    const start = marsStart(123456, ON);
    const d = derive(start.reservoirs, NEUTRAL_ENV, ON);
    expect(incomeRate(habitat(start.reservoirs, d, ON), ON)).toBeGreaterThan(0);
  });

  it("pays more as the planet becomes more habitable", () => {
    const start = marsStart(123456, ON);
    const dead = derive(start.reservoirs, NEUTRAL_ENV, ON);
    const rich = { ...start.reservoirs, o2: 215, co2_atm: 1 };
    const good = { ...dead, T: 288, P: 1013, oceanFrac: 0.4 };

    const poorIncome = incomeRate(habitat(start.reservoirs, dead, ON), ON);
    const richIncome = incomeRate(habitat(rich, good, ON), ON);
    expect(richIncome).toBeGreaterThan(poorIncome * 5);
  });

  it("accrues per substep, so chunking cannot change the balance", () => {
    let state = marsStart(123456, ON);
    state = buildFacility(state, "orbital_mirror", 12, 1, makeTuning());

    const oneJump = advance(state, 2000, config());
    let many = state;
    for (let i = 0; i < 500; i += 1) many = advance(many, 4, config());

    expect(many.economy).toEqual(oneJump.economy);
    expect(simYear(many, ON)).toBeCloseTo(simYear(oneJump, ON), 9);
  });
});

describe("purchase", () => {
  it("is all or nothing", () => {
    const wallet = { credits: 100, earned: 100, spent: 0 };
    expect(purchase(wallet, 150, ON).ok).toBe(false);
    expect(purchase(wallet, 150, ON).economy).toBe(wallet);
    expect(purchase(wallet, 100, ON).ok).toBe(true);
    expect(purchase(wallet, 100, ON).economy.credits).toBe(0);
  });

  it("is free when the economy is off", () => {
    const wallet = { credits: 0, earned: 0, spent: 0 };
    expect(purchase(wallet, 9999, OFF).ok).toBe(true);
    expect(purchase(wallet, 9999, OFF).economy).toBe(wallet);
  });
});

describe("with the economy off, this batch is invisible", () => {
  it("leaves a whole run identical to one with no economy code at all", () => {
    let priced = marsStart(123456, OFF);
    priced = buildFacility(priced, "orbital_mirror", 30, 1, OFF);
    const after = advance(priced, 4000, config(OFF));

    // The wallet is untouched: no income, no upkeep, no purchases.
    expect(after.economy).toEqual(startingEconomy(OFF));
  });
});

/**
 * Findings from the Batch 10 adversarial review.
 *
 * Each of these passed every test in the project when it was found. They are
 * here because a defect that survived a full suite is exactly the defect worth
 * pinning.
 */
describe("Batch 10 review findings", () => {
  /**
   * FOUND: levelling up was free.
   *
   * `orderCost` looped over the COUNT and returned early when the count had
   * not changed, so the level multiplier was applied to nothing. Buy five
   * mirrors at level 1 for 1353 credits, upgrade all five to level 5 for zero,
   * and the solar multiplier goes 1.02 -> 1.10. Optimal play was "buy one
   * unit, then max its level for free", which made the whole economy optional.
   */
  it("charges to upgrade units already owned", () => {
    let state = marsStart(123456, ON);
    const bought = orderFacility(state, "orbital_mirror", 5, 1, ON);
    state = bought.state;
    expect(bought.cost).toBeGreaterThan(0);

    const upgrade = orderFacility(state, "orbital_mirror", 5, 3, ON);
    expect(upgrade.cost, "upgrading five units to level 3 was free").toBeGreaterThan(0);
  });

  it("makes upgrading dearer than nothing and cheaper than rebuying", () => {
    const upgradeFive = orderCost("orbital_mirror", 5, 5, 3, ON, 1);
    const buyFiveAtThree = orderCost("orbital_mirror", 0, 5, 3, ON, 3);
    expect(upgradeFive).toBeGreaterThan(0);
    expect(upgradeFive).toBeLessThan(buyFiveAtThree);
  });

  it("charges new units at the target level, not at level one", () => {
    const atOne = orderCost("orbital_mirror", 0, 4, 1, ON, 1);
    const atFour = orderCost("orbital_mirror", 0, 4, 4, ON, 4);
    expect(atFour).toBeGreaterThan(atOne * 2);
  });

  it("still refunds nothing for a downgrade", () => {
    expect(orderCost("orbital_mirror", 5, 5, 1, ON, 4)).toBe(0);
    expect(orderCost("orbital_mirror", 5, 2, 1, ON, 1)).toBe(0);
  });

  /**
   * FOUND: the tech tree advertised a gate on seeding and did not enforce it.
   *
   * `TECH` lists `ecopoiesis` as unlocking `biosphere_seeding`, `techGate`
   * correctly returned `allowed: false`, and `seedBiosphere` seeded anyway -
   * it has its own entry point and never asked. A phase-0 world could start a
   * biosphere.
   *
   * The registry test above ("covers every facility exactly once") passed
   * throughout, because it checks the TREE's completeness and not the GATE's
   * enforcement. Same shape as an assertion that only lives in `tick`.
   */
  it("refuses to seed a biosphere before ecopoiesis is unlocked", () => {
    const base = marsStart(123456, ON);
    // A genuinely seedable world - warm, wet, pressurised - at phase 0.
    const world: SimState = {
      ...base,
      reservoirs: { ...base.reservoirs, co2_atm: 400, n2: 300, h2o_liq: 40, h2o_ice: 5, ghg: 2 },
      techUnlocked: ["orbital_optics"],
    };
    const env = NEUTRAL_ENV;
    expect(techGate(world, "biosphere_seeding", ON).allowed).toBe(false);

    const outcome = seedBiosphere(world, ON, env);
    expect(outcome.seeded, "seeded without the tech that gates it").toBe(false);
    expect(outcome.reason).toMatch(/Ecopoiesis/);
    expect(outcome.state.reservoirs.biomass).toBe(0);
  });

  it("seeds that same world once the tech is unlocked", () => {
    // Or the test above would pass on an unseedable world and prove nothing.
    const base = marsStart(123456, ON);
    const world: SimState = {
      ...base,
      reservoirs: { ...base.reservoirs, co2_atm: 400, n2: 300, h2o_liq: 40, h2o_ice: 5, ghg: 2 },
      techUnlocked: unlockedFor(Phase.FirstWater, []),
    };
    const outcome = seedBiosphere(world, ON, NEUTRAL_ENV);
    expect(outcome.seeded).toBe(true);
    expect(outcome.state.reservoirs.biomass).toBeGreaterThan(0);
  });

  it("still seeds freely when the tech gate is off", () => {
    const base = marsStart(123456, OFF);
    const world: SimState = {
      ...base,
      reservoirs: { ...base.reservoirs, co2_atm: 400, n2: 300, h2o_liq: 40, h2o_ice: 5, ghg: 2 },
      techUnlocked: [],
    };
    expect(seedBiosphere(world, OFF, NEUTRAL_ENV).seeded).toBe(true);
  });
});

describe("Batch 13 review findings", () => {
  // Economy on, no tech gate, and money enough that price is never the reason
  // for anything below.
  const PAID = makeTuning({ ECONOMY_ENABLED: 1 });
  const rich: SimState = { ...marsStart(), economy: { ...marsStart().economy, credits: 20000 } };
  const bought = orderFacility(rich, "orbital_mirror", 10, 2, PAID);
  const mirrors = (s: SimState) => s.facilities.find((f) => f.type === "orbital_mirror");

  it("starts from ten paid level-2 mirrors, or the rest proves nothing", () => {
    expect(bought.ok).toBe(true);
    expect(mirrors(bought.state)).toMatchObject({ count: 10, level: 2 });
  });

  it("refuses a NaN count instead of dismantling paid units and calling it a success", () => {
    const r = orderFacility(bought.state, "orbital_mirror", Number.NaN, 2, PAID);
    expect(r.ok).toBe(false);
    expect(r.state).toBe(bought.state);
  });

  it("refuses a NaN level instead of silently downgrading", () => {
    const r = orderFacility(bought.state, "orbital_mirror", 10, Number.NaN, PAID);
    expect(r.ok).toBe(false);
    expect(mirrors(r.state)?.level).toBe(2);
  });

  it("treats an infinite count as oversized - saturating at the cap - not as zero", () => {
    // Economy off: whether forty more mirrors are AFFORDABLE is a different
    // question (they are not, at 1.06x compounding) and would refuse the order
    // for a reason that has nothing to do with this.
    const built = orderFacility(marsStart(), "orbital_mirror", 10, 2, OFF).state;
    const r = orderFacility(built, "orbital_mirror", Infinity, 2, OFF);
    expect(r.ok).toBe(true);
    expect(mirrors(r.state)?.count).toBe(OFF.FACILITY_MAX_COUNT);
  });
});

describe("Batch 14 review findings", () => {
  const PAID = makeTuning({ ECONOMY_ENABLED: 1 });
  const rich: SimState = { ...marsStart(), economy: { ...marsStart().economy, credits: 20000 } };
  const bought = orderFacility(rich, "orbital_mirror", 10, 2, PAID).state;
  const mirrors = (s: SimState) => s.facilities.find((f) => f.type === "orbital_mirror");

  it("refuses a level below 1 instead of silently downgrading paid units", () => {
    // Batch 13 refused a NaN level for exactly this harm; -Infinity, 0 and -1
    // still clamped UP to level 1 and dropped the paid level 2.
    for (const level of [0, -1, -Infinity]) {
      const r = orderFacility(bought, "orbital_mirror", 10, level, PAID);
      expect(r.ok, `level ${level}`).toBe(false);
      expect(mirrors(r.state)?.level, `level ${level}`).toBe(2);
    }
  });

  it("still treats a negative count as dismantle, which Batch 2 made deliberate", () => {
    for (const count of [-1, -Infinity]) {
      const r = orderFacility(bought, "orbital_mirror", count, 2, PAID);
      expect(r.ok, `count ${count}`).toBe(true);
      expect(mirrors(r.state)?.count ?? 0, `count ${count}`).toBe(0);
    }
  });
});
