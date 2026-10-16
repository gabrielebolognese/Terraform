/**
 * Batch 33, in the simulation alone: what an event leaves on a city follows
 * its building, does what it says in the settlement's own substep, and goes
 * with it; a wreck is cleared up as a removal is; the record is bounded; and
 * coming back says what came and went. (The exit gate itself is measured on
 * the browser's new world, in `src/web/decisions-gate.test.ts`.)
 */

import { describe, expect, it } from "vitest";

import { cardAt, cardFor, cityYearsFor, resolveDecision, stepDecisions, substepsFor } from "./decisions.js";
import { habitat } from "./habitat.js";
import { advance } from "./integrate.js";
import { derive } from "./derive.js";
import { foundSettlement } from "./micro/registry.js";
import { removeBuilding, settlementStep, shiftContent } from "./micro/settlement.js";
import { tileKey } from "./micro/space.js";
import { cityView } from "./micro/view.js";
import { summariseAway } from "./offline.js";
import { marsStart } from "./planets/mars.js";
import { makeTuning } from "./tuning.js";
import type { Settlement, SettlementEffect, SimState } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";

/** A small Standard-paced world with cities and events on (no card dealt: each test places its own). */
const T = makeTuning({
  SETTLEMENTS_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  TIME_SCALE: 0.03 / 8,
  SUBSTEP_YEARS: 0.25 / 8,
  CITY_CLOCK: 8,
  CITY_GRID_TILES: 64,
  DECISIONS_ENABLED: 1,
  DECISION_CHANCE: 0,
});
const cfg = { tuning: T, env: NEUTRAL_ENV, forcing: null };
const env = (s: SimState) => habitat(s.reservoirs, derive(s.reservoirs, NEUTRAL_ENV, T), T, 0);

/** A city with a level-1 Solar Array and a level-2 Water Extractor standing, people and stores enough. */
function town(): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T, "Ares").state;
  return {
    ...s,
    settlements: s.settlements.map((c) => ({
      ...c,
      population: 300,
      stores: { ...c.stores, materials: 300, water: 50, oxygen: 50, food: 50 },
      buildings: [...c.buildings, { type: "solar_array" as const, tx: 4, ty: 4, level: 1 }, { type: "water_extractor" as const, tx: 8, ty: 4, level: 2 }],
    })),
  };
}
const city = (s: SimState): Settlement => s.settlements[0]!;
const fault = (tile: number, factor: number): SettlementEffect => ({ kind: "fault", tile, factor, remaining: cityYearsFor(600, T), event: 7 });
const withEffects = (s: SimState, effects: SettlementEffect[]): SimState => ({ ...s, settlements: s.settlements.map((c, i) => (i === 0 ? { ...c, effects } : c)) });
const solar = tileKey(4, 4);
const indexOf = (c: Settlement, tile: number) => c.buildings.findIndex((b) => tileKey(b.tx, b.ty) === tile);

describe("what an event leaves on a city (Batch 33)", () => {
  it("breaks a building down - offline, drawing nothing - or runs it at its share", () => {
    const s = town();
    const h = T.SUBSTEP_YEARS * T.CITY_CLOCK;
    const whole = settlementStep(city(s), env(s), T, h);
    const broken = settlementStep(city(withEffects(s, [fault(solar, 0)])), env(s), T, h);
    const half = settlementStep(city(withEffects(s, [fault(solar, 0.5)])), env(s), T, h);
    const i = indexOf(city(s), solar);
    expect(whole.operable[i]).toBe(true);
    expect(broken.operable[i]).toBe(false);
    expect(half.operable[i]).toBe(true);
    // What the array makes, by the difference it makes to the city's power.
    const made = whole.production.power - broken.production.power;
    expect(made).toBeGreaterThan(0);
    expect(whole.production.power - half.production.power).toBeCloseTo(made / 2, 9);
    // The view says so too, for the inspector and the alerts.
    const view = cityView(city(withEffects(s, [fault(solar, 0)])), env(s), T);
    expect(view.buildings[i]!.operable).toBe(false);
    expect(view.buildings[i]!.fault).toEqual({ factor: 0, remaining: cityYearsFor(600, T) });
    expect(cityView(city(s), env(s), T).buildings[i]!.fault).toBeUndefined();
  });

  it("counts down a substep at a time and is gone once its time is spent", () => {
    const s = withEffects(town(), [fault(solar, 0.5)]);
    const n = substepsFor(600, T);
    expect(city(advance(s, n - 1, cfg)).effects.length).toBe(1);
    expect(city(advance(s, n, cfg)).effects).toEqual([]);
  });

  it("follows its building when a claim west or north moves every tile", () => {
    const c = city(withEffects(town(), [fault(solar, 0)]));
    const moved = shiftContent(c, 16, 0);
    expect(moved.effects[0]!.tile).toBe(tileKey(20, 4));
    expect(moved.buildings[indexOf(moved, tileKey(20, 4))]!.type).toBe("solar_array");
  });

  it("goes with its building when it is removed, not to what is built there next", () => {
    const s = withEffects(town(), [fault(solar, 0), { kind: "shelter", tile: null, factor: 0, remaining: 1, event: 8 }]);
    const out = removeBuilding(s, city(s).id, 4, 4);
    expect(out.ok).toBe(true);
    expect(city(out.state).effects.map((e) => e.kind)).toEqual(["shelter"]);
  });

  it("wrecks a level-1 building the way a removal would: its queued upgrade refunded, its fault gone", () => {
    // Only the array can be hit (the headquarters cannot; everything else is taken away): every hit lands on it.
    const base = town();
    const only: SimState = withEffects({ ...base, settlements: base.settlements.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type === "headquarters" || b.type === "solar_array"), buildQueue: [{ tile: solar, upgrade: true, paid: 15 }] })) }, [fault(solar, 0.5)]);
    const e = cardFor(only, 1, "meteor", null, city(only), only.steps, T)!;
    const done = resolveDecision(only, e, T);
    expect(done.outcome).toEqual({ people: 0, materials: 0, credits: 0, hit: 1, wrecked: 1 });
    const c = city(done.state);
    expect(c.buildings.some((b) => b.type === "solar_array")).toBe(false);
    expect(c.buildQueue).toEqual([]);
    expect(c.effects).toEqual([]);
    expect(c.stores.materials).toBe(city(only).stores.materials + 15);
  });
});

describe("the deck's record (Batch 33)", () => {
  it("keeps the latest DECISION_LOG resolved events, oldest first", () => {
    const t = makeTuning({ ...T, DECISION_LOG: 3 });
    let s = town();
    for (let k = 0; k < 5; k += 1) {
      const e = cardFor(s, k, "discovery", "ice", city(s), s.steps, t)!;
      s = advance({ ...s, decisions: { ...s.decisions, open: [e] } }, e.deadline - e.opened, { ...cfg, tuning: t });
    }
    expect(s.decisions.log.map((r) => r.id)).toEqual([2, 3, 4]);
  });

  it("changes nothing with events off, not even the object - at a substep where a card is dealt and one is due", () => {
    // Every slot dealt, and the world at the substep the first card falls on, with an event open and due.
    const dealing = makeTuning({ ...T, DECISION_CHANCE: 1 });
    const base = town();
    const at = cardAt(base.seed, 0, dealing)!;
    const due = cardFor(base, 99, "discovery", "ice", city(base), at - 22, dealing)!;
    const s: SimState = { ...base, steps: at, decisions: { open: [{ ...due, deadline: at }], log: [] } };
    // Vacuity: with events on, this substep resolves one and deals another.
    const on = stepDecisions(s, dealing);
    expect(on.decisions.log.map((r) => r.id)).toEqual([99]);
    expect(on.decisions.open.map((e) => e.id)).toEqual([0]);
    expect(stepDecisions(s, makeTuning({ ...dealing, DECISIONS_ENABLED: 0 }))).toBe(s);
    // And with them on, between cards and with nothing open: the same object too.
    const quiet = town();
    expect(stepDecisions(quiet, T)).toBe(quiet);
  });

  it("says, coming back, how many events came to a head and how many nobody answered", () => {
    let s = town();
    const before = s;
    for (const [k, choice] of [[1, null], [2, "sell"], [3, null]] as const) {
      const e = cardFor(s, k, "discovery", "ice", city(s), s.steps, T)!;
      s = { ...s, decisions: { ...s.decisions, open: [{ ...e, chosen: choice }] } };
      s = advance(s, e.deadline - e.opened, cfg);
    }
    const away = summariseAway(before, s, T);
    expect(away.events).toEqual({ resolved: 3, unanswered: 2 });
    expect(away.headline).toMatch(/ 3 events came to a head, 2 unanswered - see Alerts, Event history\.$/);
    expect(summariseAway(s, s, T).headline).not.toMatch(/event/);
  });
});
