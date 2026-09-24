/**
 * The browser must read the planet the simulation is running (Batch 13).
 *
 * `main.ts` derived its readout - and latched the phase from it - with no
 * weather, while the browser runs with §12.2's events on and `advance`
 * integrates against them. During a storm the two were several kelvin apart.
 *
 * Tested by behaviour, not by reading `readWorld`'s body: step a weathered
 * world one substep at a time across first water, and require the phase the
 * readout reports to be exactly the phase the simulation latches when it steps
 * from that state.
 */

import { describe, expect, it } from "vitest";

import type { SimConfig, SimState } from "../sim/index.js";
import { NEUTRAL_ENV, advance, derive, effectiveEnv, makeTuning, simYear } from "../sim/index.js";
import { REFERENCE_POLICY } from "../harness/policy.js";
import { runTrajectory } from "../harness/run.js";
import { readWorld } from "./readout.js";

const t = makeTuning({ EVENTS_ENABLED: 1 });
const cfg: SimConfig = { tuning: t, env: NEUTRAL_ENV, forcing: null };

// Years 250-299: first water (Phase 3) is crossed here, under solar
// variability and at least one storm, and no reference order falls inside it.
const states: SimState[] = [];
let s = runTrajectory(REFERENCE_POLICY, 250, 2, t).finalState;
while (simYear(s, t) < 299) {
  states.push(s);
  s = advance(s, 1, cfg);
}

describe("the browser readout describes the world advance() integrated", () => {
  it("is tested across a window where the weather actually matters", () => {
    let worst = 0;
    for (const w of states) {
      const calm = derive(w.reservoirs, effectiveEnv(NEUTRAL_ENV, w.facilities, t), t).T;
      worst = Math.max(worst, Math.abs(readWorld(w, t).derived.T - calm));
    }
    // Measured 2.76 K (year 260.5). Without weather in the window this test
    // proves nothing.
    expect(worst).toBeGreaterThan(1);
    expect(new Set(states.map((w) => w.phaseReached)).size).toBeGreaterThan(1);
  });

  it("reads exactly the temperature advance() integrates, at every substep", () => {
    // Batch 14: the phase check below rests on ONE sample - first water is the
    // only crossing in the window - so a readout one substep late (0.93 K off)
    // passed it. This asks advance() itself: a forcing is handed the derived
    // state the simulation is really using, so a spy on it reads the
    // simulation's own temperature without restating how it was built.
    const off: string[] = [];
    for (const w of states) {
      let seen = Number.NaN;
      const spy: SimConfig = { ...cfg, forcing: (_r, d) => ((seen = d.T), []) };
      advance(w, 1, spy);
      const read = readWorld(w, t).derived.T;
      if (read !== seen) off.push(`year ${simYear(w, t)}: readout ${read.toFixed(4)} K, simulation ${seen.toFixed(4)} K`);
    }
    expect(off, off.slice(0, 3).join("; ")).toEqual([]);
  });

  it("reports exactly the phase the simulation latches from the same state", () => {
    const disagreements: string[] = [];
    for (const w of states) {
      const latched = advance(w, 1, cfg).phaseReached;
      const read = Math.max(w.phaseReached, readWorld(w, t).phase);
      if (read !== latched) disagreements.push(`year ${simYear(w, t)}: readout ${read}, simulation ${latched}`);
    }
    expect(disagreements, disagreements.slice(0, 3).join("; ")).toEqual([]);
  });
});
