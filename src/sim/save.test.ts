import { describe, expect, it } from "vitest";

import { advance } from "./integrate.js";
import { carbonInvariant } from "./conserve.js";
import { buildFacility, seedBiosphere } from "./actions.js";
import { marsStart } from "./planets/mars.js";
import { SAVE_SCHEMA_VERSION, SaveError, deserialize, fromSave, serialize, toSave } from "./save.js";
import { TECH, availableTech, techById } from "./tech.js";
import { defaultConfig } from "./tick.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import type { SimState } from "./types.js";

const t = DEFAULT_TUNING;
const cfg = defaultConfig();
const AT = "2026-09-22T10:00:00.000Z";

/** A world with something in every field a save has to carry. */
function playedState(): SimState {
  let state = buildFacility(marsStart(), "orbital_mirror", 30, 2, t);
  state = buildFacility(state, "ghg_factory", 10, 1, t);
  state = advance(state, 4 * 600, { ...cfg, env: { sMultiplier: 1.12, albedoDelta: 0 } });
  state = seedBiosphere(state, t, { sMultiplier: 1.12, albedoDelta: 0 }).state;
  return { ...state, techUnlocked: ["mirrors", "ghg"], economy: { credits: 12500, earned: 30000, spent: 17500 } };
}

describe("a save round-trips", () => {
  it("preserves the state exactly, through JSON", () => {
    const before = playedState();
    const after = deserialize(serialize(before, t, AT), t);
    expect(after.reservoirs).toEqual(before.reservoirs);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.facilities).toEqual(before.facilities);
    expect(after.steps).toBe(before.steps);
    expect(after.seeded).toBe(before.seeded);
    expect(after.phaseReached).toBe(before.phaseReached);
    expect(after.shieldStrength).toBe(before.shieldStrength);
    expect(after.techUnlocked).toEqual(before.techUnlocked);
  });

  it("leaves the simulation on the same substep grid", () => {
    /**
     * The strong property: a save in the middle of a run is invisible to the
     * result. This is why `steps` is stored as an integer rather than
     * recovered from the rounded `sim_year` beside it - deriving it back would
     * let the grid drift by a substep on every save/load cycle.
     */
    const start = playedState();
    const straight = advance(start, 4 * 200, cfg);
    const viaSave = advance(deserialize(serialize(start, t, AT), t), 4 * 200, cfg);
    expect(viaSave.reservoirs).toEqual(straight.reservoirs);
    expect(viaSave.ledger).toEqual(straight.ledger);
  });

  it("carries the ledger, so conservation can be checked across a save", () => {
    // Without the ledger there is no way to tell a legitimate sink from a leak
    // after a reload, and cross-batch invariant #6 stops being checkable.
    const before = playedState();
    const after = deserialize(serialize(before, t, AT), t);
    expect(carbonInvariant(after)).toBeCloseTo(carbonInvariant(before), 9);
  });

  it("stores no derived values", () => {
    // §11: "Store only reservoirs. Never store derived values (T, P, visuals);
    // recompute them on load so a tuning change to constants retroactively
    // applies to old saves instead of baking in stale numbers."
    const save = toSave(playedState(), t, AT) as unknown as Record<string, unknown>;
    for (const forbidden of ["T", "P", "albedo", "progress", "temperature", "pressure", "visual"]) {
      expect(save[forbidden], `a save must not carry ${forbidden}`).toBeUndefined();
    }
    expect(Object.keys(save.reservoirs as object).sort()).toEqual(
      [...Object.keys(marsStart().reservoirs)].sort(),
    );
  });

  it("writes the section 11 field names", () => {
    const save = toSave(playedState(), t, AT);
    expect(save.schema_version).toBe(SAVE_SCHEMA_VERSION);
    expect(save.planet_id).toBe("mars");
    expect(save.last_saved_real).toBe(AT);
    expect(save.shield_strength).toBeGreaterThanOrEqual(0);
    expect(save.sim_year).toBeCloseTo(save.steps * t.SUBSTEP_YEARS, 9);
  });
});

describe("a save is untrusted input", () => {
  const good = (): Record<string, unknown> => toSave(playedState(), t, AT) as unknown as Record<string, unknown>;

  it("rejects things that are not saves", () => {
    for (const junk of [null, 42, "hello", [], undefined]) {
      expect(() => fromSave(junk, t), `${JSON.stringify(junk)} should be rejected`).toThrow(SaveError);
    }
  });

  it("rejects a save from a newer build rather than guessing at it", () => {
    expect(() => fromSave({ ...good(), schema_version: 99 }, t)).toThrow(/newer version/);
  });

  it("rejects a missing or malformed schema_version", () => {
    expect(() => fromSave({ ...good(), schema_version: undefined }, t)).toThrow(/schema_version/);
    expect(() => fromSave({ ...good(), schema_version: 1.5 }, t)).toThrow(/schema_version/);
  });

  it("names the reservoir it rejected", () => {
    const missing = good();
    delete (missing.reservoirs as Record<string, unknown>).o2;
    expect(() => fromSave(missing, t)).toThrow(/reservoirs\.o2/);

    const negative = good();
    (negative.reservoirs as Record<string, number>).co2_atm = -5;
    expect(() => fromSave(negative, t)).toThrow(/reservoirs\.co2_atm is negative/);

    const nan = good();
    (nan.reservoirs as Record<string, unknown>).n2 = null;
    expect(() => fromSave(nan, t)).toThrow(/reservoirs\.n2/);
  });

  it("rejects a phase outside the ladder", () => {
    expect(() => fromSave({ ...good(), phase: 9 }, t)).toThrow(/phase 9/);
    expect(() => fromSave({ ...good(), phase: -1 }, t)).toThrow(/phase/);
  });

  it("rejects a facility the engine does not have", () => {
    const save = good();
    save.facilities = [{ type: "antigravity_array", count: 1, level: 1, enabled: true, deployed: 1 }];
    expect(() => fromSave(save, t)).toThrow(/not a known lever/);
  });

  it("rejects duplicate facility entries", () => {
    // `orderedUnits` reads one entry and `deployedUnitsOf` sums them all, so a
    // duplicate makes the two disagree about the same lever.
    const save = good();
    save.facilities = [
      { type: "orbital_mirror", count: 1, level: 1, enabled: true, deployed: 1 },
      { type: "orbital_mirror", count: 2, level: 1, enabled: true, deployed: 2 },
    ];
    expect(() => fromSave(save, t)).toThrow(/more than one entry for orbital_mirror/);
  });

  it("clamps a lever deployed above the facility cap (Batch 13, clamped since Batch 14)", () => {
    // Nothing checked the top end. deployed = 1000 on a maxed mirror array
    // loaded fine and ran at sMultiplier 5 and 350 K for as long as you liked.
    const save = good();
    save.facilities = [{ type: "orbital_mirror", count: 50, level: 5, enabled: true, deployed: 1000 }];
    expect(fromSave(save, t).facilities[0]?.deployed).toBe(t.FACILITY_MAX_COUNT * t.FACILITY_MAX_LEVEL);
  });

  it("still loads a legitimate save after a retune lowers the cap (Batch 14)", () => {
    // Batch 13 REJECTED an over-cap value, and a save is read under the
    // loading build's tuning: this 250-unit array, written honestly, threw -
    // and boot answers a SaveError with a fresh Mars.
    let s = buildFacility(marsStart(), "orbital_mirror", 50, 5, t);
    s = advance(s, 2048, defaultConfig());
    s = advance(s, 2048, defaultConfig());
    expect(s.facilities[0]?.deployed).toBe(250);
    const tighter = makeTuning({ FACILITY_MAX_LEVEL: 4 });
    const loaded = deserialize(serialize(s, t, AT), tighter);
    expect(loaded.steps).toBe(s.steps);
    expect(loaded.facilities[0]?.deployed).toBe(200);
  });

  it("still loads a lever ramping down, which is legitimately above its order", () => {
    // Dismantled to 5 units while 40 are still up is a real mid-ramp state.
    const save = good();
    save.facilities = [{ type: "orbital_mirror", count: 5, level: 1, enabled: true, deployed: 40 }];
    expect(fromSave(save, t).facilities[0]?.deployed).toBe(40);
  });

  it("rejects malformed JSON with something a human can act on", () => {
    expect(() => deserialize("{not json", t)).toThrow(/not valid JSON/);
  });

  it("refuses to WRITE a non-finite state, where the bug actually is", () => {
    // A NaN reaching JSON.stringify becomes `null`, and the failure then
    // surfaces on load pointing at the reader rather than at whatever made it.
    const broken = { ...marsStart(), reservoirs: { ...marsStart().reservoirs, o2: Number.NaN } };
    expect(() => toSave(broken, t, AT)).toThrow(/reservoirs\.o2 is NaN/);
  });
});

describe("migrating a section 11 v1 save", () => {
  /**
   * The exact shape from §11 of the design doc, which genuinely predates the
   * nitrate reservoir, the ledger, the `seeded` flag, the deployment ramp and
   * the integer substep counter.
   */
  const V1 = {
    schema_version: 1,
    planet_id: "mars",
    seed: 123456,
    sim_year: 184.5,
    last_saved_real: "2026-09-21T10:00:00Z",
    phase: 3,
    reservoirs: {
      co2_atm: 210.4,
      co2_cap: 2.1,
      co2_reg: 88.0,
      n2: 30.0,
      o2: 4.2,
      ghg: 1.1,
      h2o_ice: 22.0,
      h2o_liq: 15.5,
      h2o_vap: 3.0,
      biomass: 0.12,
    },
    facilities: [
      { type: "orbital_mirror", count: 4, level: 2, enabled: true },
      { type: "ghg_factory", count: 2, level: 1, enabled: true },
    ],
    shield_strength: 0.0,
    tech_unlocked: ["mirrors", "ghg", "atmo_processor"],
    economy: { credits: 12500, materials: 3400 },
  };

  it("loads", () => {
    const state = fromSave(V1, t);
    expect(state.planetId).toBe("mars");
    expect(state.phaseReached).toBe(3);
    expect(state.reservoirs.co2_atm).toBe(210.4);
    expect(state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it("recovers elapsed time from sim_year when steps is absent", () => {
    expect(fromSave(V1, t).steps).toBe(Math.round(184.5 / t.SUBSTEP_YEARS));
  });

  it("gives the new nitrate reservoir nothing, rather than the Mars default", () => {
    // A v1 world was played without one. Handing it 20 mbar on load would
    // materialise nitrogen that world never had.
    expect(fromSave(V1, t).reservoirs.n2_reg).toBe(0);
  });

  it("infers `seeded` from the biosphere the save already has", () => {
    expect(fromSave(V1, t).seeded).toBe(true);
    const lifeless = { ...V1, reservoirs: { ...V1.reservoirs, biomass: 0 } };
    expect(fromSave(lifeless, t).seeded).toBe(false);
  });

  it("brings facilities online, because v1 predates the deployment ramp", () => {
    // Starting them at zero would silently switch off a loaded player's whole
    // industry and look like the save had been corrupted.
    const mirrors = fromSave(V1, t).facilities.find((f) => f.type === "orbital_mirror");
    expect(mirrors?.deployed).toBe(4 * 2);
  });

  it("zeroes the ledger, which is harmless because conservation is drift-based", () => {
    const state = fromSave(V1, t);
    for (const value of Object.values(state.ledger)) expect(value).toBe(0);
    // And the loaded world still holds together going forward.
    expect(() => advance(state, 400, cfg)).not.toThrow();
  });

  it("still loads after the shape changed again - it is held to the CURRENT standard", () => {
    const migrated = fromSave(V1, t);
    const rewritten = deserialize(serialize(migrated, t, AT), t);
    expect(rewritten.reservoirs).toEqual(migrated.reservoirs);
    expect(rewritten.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });
});

describe("migrating a v2 save into the Batch 9 economy", () => {
  /**
   * v2 is the shape this project shipped for Batches 4 through 8. It wrote
   * `economy: null`, because §11 left it "TBD", and never wrote a tech list.
   */
  const V2 = {
    schema_version: 2,
    planet_id: "mars",
    seed: 123456,
    steps: 2400,
    last_saved_real: "2026-09-22T10:00:00Z",
    phase: 5,
    reservoirs: {
      co2_atm: 120,
      co2_cap: 0,
      co2_reg: 40,
      n2: 300,
      n2_reg: 5,
      o2: 90,
      ghg: 0.4,
      h2o_ice: 4,
      h2o_liq: 30,
      h2o_vap: 8,
      biomass: 0.7,
    },
    ledger: { c_fixed: 10, c_lost: 1, c_sequestered: 0, c_imported: 0, h2o_lost: 0, h2o_imported: 2, n2_lost: 0, n2_imported: 300 },
    facilities: [{ type: "orbital_mirror", count: 20, level: 1, enabled: true, deployed: 20 }],
    shield_strength: 0,
    seeded: true,
    tech_unlocked: [],
    economy: null,
  };

  it("loads", () => {
    const state = fromSave(V2, t);
    expect(state.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(state.phaseReached).toBe(5);
    expect(state.steps).toBe(2400);
  });

  /**
   * A v2 world was played WITHOUT costs. Dropping it into a priced world with
   * an empty wallet would strand a player who had done nothing wrong, and
   * there is no honest way to reconstruct what they would have banked.
   */
  it("arrives with the starting balance, not with nothing", () => {
    const state = fromSave(V2, t);
    expect(state.economy.credits).toBe(t.ECON_STARTING_CREDITS);
    expect(Number.isFinite(state.economy.earned)).toBe(true);
    expect(Number.isFinite(state.economy.spent)).toBe(true);
  });

  /**
   * v2 never wrote a tech list. An empty one would leave a phase-5 world
   * unable to build the levers it already owns.
   */
  it("rebuilds the tech list from the latched phase", () => {
    const state = fromSave(V2, t);
    expect(state.techUnlocked.length).toBeGreaterThan(0);
    for (const id of state.techUnlocked) {
      expect(techById(id)?.phase, `${id} is from a later phase than the save reached`).toBeLessThanOrEqual(5);
    }
    // Everything phase 5 has earned, specifically.
    expect(state.techUnlocked).toEqual(availableTech(5).map((x) => x.id));
  });

  it("does not hand a phase-5 world the phase-6 tech it has not reached", () => {
    const state = fromSave(V2, t);
    const late = TECH.filter((x) => x.phase > 5).map((x) => x.id);
    for (const id of late) expect(state.techUnlocked).not.toContain(id);
  });

  it("keeps a tech list that was already there", () => {
    const withTech = { ...V2, tech_unlocked: ["orbital_optics"] };
    expect(fromSave(withTech, t).techUnlocked).toEqual(["orbital_optics"]);
  });

  it("round-trips the economy once it is real", () => {
    const loaded = fromSave(V2, t);
    const again = fromSave(JSON.parse(JSON.stringify(toSave(loaded, t, "2026-09-22T11:00:00Z"))), t);
    expect(again.economy).toEqual(loaded.economy);
    expect(again.techUnlocked).toEqual(loaded.techUnlocked);
  });
});
