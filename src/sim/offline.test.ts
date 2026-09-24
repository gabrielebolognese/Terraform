import { describe, expect, it } from "vitest";

import { buildFacility } from "./actions.js";
import { advance } from "./integrate.js";
import { offlineGrant, resume, summariseAway } from "./offline.js";
import { marsStart } from "./planets/mars.js";
import { toSave } from "./save.js";
import { defaultConfig } from "./tick.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import { Phase } from "./types.js";

const t = DEFAULT_TUNING;
const cfg = defaultConfig();

const HOUR = 3600;
const DAY = 24 * HOUR;

/** The reference playthrough reaches Phase 6 here - see src/harness/golden.test.ts. */
const ONE_ARC_SIM_YEARS = 1710;

describe("the design cap on offline progression", () => {
  /**
   * §8.2 read literally gives an absent player the whole game. At
   * TIME_SCALE 0.03 a 48-hour absence is worth 5184 sim-years against a 1710
   * sim-year playthrough - one weekend away finishes it three times over,
   * which contradicts design goal #2 outright.
   */
  it("would hand over three playthroughs without a cap", () => {
    expect(2 * DAY * t.TIME_SCALE).toBeGreaterThan(3 * ONE_ARC_SIM_YEARS);
  });

  it("counts only the first stretch of an absence", () => {
    const overnight = offlineGrant(t.OFFLINE_CAP_HOURS * HOUR, t);
    const aWeek = offlineGrant(7 * DAY, t);
    expect(aWeek.grantedSimYears).toBe(overnight.grantedSimYears);
    expect(aWeek.limitedBy).toBe("absence-cap");
    expect(overnight.limitedBy).toBe("none");
  });

  it("runs slower while nobody is watching, so playing beats not playing", () => {
    const window = 4 * HOUR;
    const idle = offlineGrant(window, t).grantedSimYears;
    const active = window * t.TIME_SCALE;
    expect(idle).toBeLessThan(active);
    expect(active / idle).toBeCloseTo(1 / t.OFFLINE_RATE_FACTOR, 6);
  });

  it("reports what the absence WOULD have been worth, so the UI can be honest", () => {
    const grant = offlineGrant(2 * DAY, t);
    expect(grant.uncappedSimYears).toBeCloseTo(2 * DAY * t.TIME_SCALE, 6);
    expect(grant.grantedSimYears).toBeLessThan(grant.uncappedSimYears / 10);
  });

  it("ten consecutive 48-hour absences do not finish the game", () => {
    /**
     * The property the whole cap exists for. Twenty days of not playing must
     * not amount to a playthrough.
     */
    let state = marsStart();
    let now = Date.parse("2026-01-01T00:00:00.000Z");

    for (let absence = 0; absence < 10; absence += 1) {
      const save = toSave(state, t, new Date(now).toISOString());
      now += 2 * DAY * 1000;
      state = resume(save, now, cfg).state;
    }

    const granted = state.steps * t.SUBSTEP_YEARS;
    expect(granted).toBeLessThan(ONE_ARC_SIM_YEARS);

    // Each grant lands on the integer substep grid, so a fraction of a substep
    // is dropped per absence - 129.6 sim-years becomes 518 steps, or 129.5.
    // Ten absences come to 1295 rather than 1296. The rounding is the right
    // behaviour (the grid is what makes a save invisible to the result) and it
    // always rounds DOWN in the player's disfavour, never up.
    const ideal = 10 * t.OFFLINE_CAP_HOURS * HOUR * t.TIME_SCALE * t.OFFLINE_RATE_FACTOR;
    expect(granted).toBeLessThanOrEqual(ideal);
    expect(ideal - granted).toBeLessThan(10 * t.SUBSTEP_YEARS);
  });

  it("a backwards clock costs nothing rather than breaking the save", () => {
    // Daylight saving, an NTP correction, a user changing the system date.
    expect(offlineGrant(-5000, t).grantedSimYears).toBe(0);
    expect(offlineGrant(Number.NaN, t).grantedSimYears).toBe(0);

    const save = toSave(marsStart(), t, "2026-06-01T00:00:00.000Z");
    const resumed = resume(save, Date.parse("2026-05-01T00:00:00.000Z"), cfg);
    expect(resumed.grant.grantedSimYears).toBe(0);
    expect(resumed.state.steps).toBe(0);
  });

  it("an unreadable timestamp resumes with no time passed rather than throwing", () => {
    const save = { ...toSave(marsStart(), t, "not-a-date"), last_saved_real: "not-a-date" };
    const resumed = resume(save, Date.parse("2026-06-01T00:00:00.000Z"), cfg);
    expect(resumed.grant.grantedSimYears).toBe(0);
    expect(resumed.summary.headline).toBe("No time passed.");
  });

  it("still respects the work cap, which is a different thing", () => {
    // The work cap bounds load-screen milliseconds; the design cap bounds how
    // much of the game an absence is worth. A tuning with no design cap must
    // still not hang the load screen.
    const uncapped = makeTuning({ OFFLINE_CAP_HOURS: 1e9, OFFLINE_RATE_FACTOR: 1, CATCHUP_MAX_SIM_YEARS: 500 });
    expect(offlineGrant(1e9, uncapped).grantedSimYears).toBe(500);
    expect(offlineGrant(1e9, uncapped).limitedBy).toBe("work-cap");
  });
});

describe("resuming advances the world correctly", () => {
  it("matches advancing the same elapsed time directly", () => {
    const start = buildFacility(marsStart(), "orbital_mirror", 30, 1, t);
    const savedAt = Date.parse("2026-01-01T00:00:00.000Z");
    const save = toSave(start, t, new Date(savedAt).toISOString());

    const resumed = resume(save, savedAt + 4 * HOUR * 1000, cfg);
    const expectedYears = 4 * HOUR * t.TIME_SCALE * t.OFFLINE_RATE_FACTOR;
    expect(resumed.grant.grantedSimYears).toBeCloseTo(expectedYears, 9);

    const direct = advance(start, Math.round(expectedYears / t.SUBSTEP_YEARS), cfg);
    expect(resumed.state.reservoirs).toEqual(direct.reservoirs);
    expect(resumed.state.steps).toBe(direct.steps);
  });

  it("is reproducible - the same absence always yields the same world", () => {
    const save = toSave(buildFacility(marsStart(), "orbital_mirror", 30, 1, t), t, "2026-01-01T00:00:00.000Z");
    const at = Date.parse("2026-01-02T00:00:00.000Z");
    expect(resume(save, at, cfg).state.reservoirs).toEqual(resume(save, at, cfg).state.reservoirs);
  });
});

describe("while you were away", () => {
  it("leads with a milestone when one was crossed", () => {
    const before = marsStart();
    const after = { ...before, steps: 4000, phaseReached: Phase.FirstWater };
    const summary = summariseAway(before, after, t);
    expect(summary.phasesGained).toEqual([Phase.Warming, Phase.RunawayThickening, Phase.FirstWater]);
    expect(summary.headline).toContain("First water");
    expect(summary.simYears).toBe(1000);
  });

  it("falls back to whatever actually changed most", () => {
    const before = buildFacility(marsStart(), "orbital_mirror", 40, 2, t);
    const after = advance(before, 4 * 300, cfg);
    const summary = summariseAway(before, after, t);
    expect(summary.phasesGained.length).toBeGreaterThanOrEqual(0);
    expect(summary.deltas.T).toBeGreaterThan(0);
    expect(summary.headline).toMatch(/sim-years passed/);
  });

  it("says so plainly when nothing happened", () => {
    const state = marsStart();
    expect(summariseAway(state, state, t).headline).toBe("No time passed.");
  });

  it("reports deltas from re-derived values, since the save stores none", () => {
    const before = buildFacility(marsStart(), "orbital_mirror", 40, 2, t);
    const after = advance(before, 4 * 400, cfg);
    const summary = summariseAway(before, after, t);
    expect(summary.deltas.P).toBeGreaterThan(0);
    expect(summary.deltas.progress).toBeGreaterThan(0);
    expect(Number.isFinite(summary.deltas.oceanFrac)).toBe(true);
  });
});
