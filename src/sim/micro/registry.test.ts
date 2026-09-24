/**
 * Micro doc §9.1 and §2.3 step 1 - founding, and the registry in the save.
 */

import { describe, expect, it } from "vitest";

import { REFERENCE_POLICY } from "../../harness/policy.js";
import { runTrajectory } from "../../harness/run.js";
import { advance } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { SaveError, deserialize, fromSave, serialize, toSave } from "../save.js";
import { defaultConfig } from "../tick.js";
import { DEFAULT_TUNING as t } from "../tuning.js";
import { foundSettlement } from "./registry.js";

const AT = "2026-09-23T10:00:00.000Z";

describe("founding builds nothing (§2.3 step 1)", () => {
  it("adds exactly one settlement, and changes nothing else about the world", () => {
    const before = advance(marsStart(), 400, defaultConfig());
    const outcome = foundSettlement(before, "city", 0.3, 1.2);
    expect(outcome.ok).toBe(true);
    expect(outcome.state.settlements).toHaveLength(1);
    // Where, what kind, and empty: no buildings and nobody living there yet.
    expect(outcome.state.settlements[0]).toMatchObject({ id: "settlement-1", kind: "city", lat: 0.3, lon: 1.2, population: 0, buildings: [] });
    const { settlements: _a, ...restAfter } = outcome.state;
    const { settlements: _b, ...restBefore } = before;
    expect(restAfter).toEqual(restBefore);
  });

  it("gives deterministic ids that are never reused", () => {
    let s = marsStart();
    for (const kind of ["city", "outpost", "city"] as const) s = foundSettlement(s, kind, 0, 0).state;
    expect(s.settlements.map((x) => x.id)).toEqual(["settlement-1", "settlement-2", "settlement-3"]);
    // Drop the middle one (as a later batch might); the next id still moves forward.
    s = { ...s, settlements: s.settlements.filter((x) => x.id !== "settlement-2") };
    expect(foundSettlement(s, "outpost", 0, 0).settlement?.id).toBe("settlement-4");
  });

  it("refuses what is not a place, and says why", () => {
    for (const [lat, lon] of [[2, 0], [Number.NaN, 0], [0, Infinity]] as const) {
      const outcome = foundSettlement(marsStart(), "city", lat, lon);
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toMatch(/.+/);
      expect(outcome.state.settlements).toEqual([]);
    }
  });

  it("stores longitude wrapped, so the same place always has the same coordinates", () => {
    expect(foundSettlement(marsStart(), "outpost", 0, 3 * Math.PI).settlement?.lon).toBeCloseTo(Math.PI, 12);
  });
});

describe("a settlement is inert until Batch 18 couples it", () => {
  it("survives advance untouched", () => {
    const s = foundSettlement(marsStart(), "city", -0.7, 1.3).state;
    expect(advance(s, 4000, defaultConfig()).settlements).toEqual(s.settlements);
  });

  it("does not move the planet: the same run with and without settlements is identical", () => {
    // A real mid-game world (600 years of the reference playthrough), then the
    // same 200 further years with and without a city on it. Any coupling of
    // the registry to the planet would show up as a difference.
    const plain = runTrajectory(REFERENCE_POLICY, 600, 2, t);
    const withCity = foundSettlement(plain.finalState, "city", 0.2, 0.4).state;
    const a = advance(plain.finalState, 800, defaultConfig());
    const b = advance(withCity, 800, defaultConfig());
    expect(b.reservoirs).toEqual(a.reservoirs);
    expect(b.ledger).toEqual(a.ledger);
  });
});

describe("the registry is saved (schema v4)", () => {
  const world = (): ReturnType<typeof marsStart> => {
    let s = marsStart();
    s = foundSettlement(s, "city", -0.72, 1.31).state;
    s = foundSettlement(s, "outpost", 1.34, 0.1).state;
    return s;
  };

  it("round-trips exactly", () => {
    const s = world();
    expect(deserialize(serialize(s, t, AT), t).settlements).toEqual(s.settlements);
  });

  it("brings a v3 save forward with an empty registry", () => {
    const v3: Record<string, unknown> = { ...(toSave(marsStart(), t, AT) as unknown as Record<string, unknown>), schema_version: 3 };
    delete v3["settlements"];
    expect(fromSave(v3, t).settlements).toEqual([]);
  });

  it("rejects a hostile registry with the field named", () => {
    const bad = (mutate: (list: Record<string, unknown>[]) => void): unknown => {
      const save = toSave(world(), t, AT) as unknown as Record<string, unknown>;
      const list = (save["settlements"] as Record<string, unknown>[]).map((x) => ({ ...x }));
      mutate(list);
      return { ...save, settlements: list };
    };
    expect(() => fromSave(bad((l) => (l[1]!["id"] = l[0]!["id"])), t)).toThrow(/settlements\[1\]\.id .* more than once/);
    expect(() => fromSave(bad((l) => (l[0]!["kind"] = "castle")), t)).toThrow(/settlements\[0\]\.kind/);
    expect(() => fromSave(bad((l) => (l[0]!["lat"] = 2)), t)).toThrow(/settlements\[0\]\.lat .* past a pole/);
    expect(() => fromSave(bad((l) => (l[0]!["lon"] = null)), t)).toThrow(SaveError);
  });

  it("repairs the one thing that has an honest reading: an unwrapped longitude", () => {
    const save = toSave(world(), t, AT) as unknown as Record<string, unknown>;
    const list = (save["settlements"] as Record<string, unknown>[]).map((x) => ({ ...x }));
    list[0]!["lon"] = 1.31 + 2 * Math.PI;
    expect(fromSave({ ...save, settlements: list }, t).settlements[0]?.lon).toBeCloseTo(1.31, 12);
  });
});
