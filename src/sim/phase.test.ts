import { describe, expect, it } from "vitest";

import { derive } from "./derive.js";
import { PHASE_INFO, evaluatePhase, inLivingWorldBand, latchPhase } from "./phase.js";
import { marsStart } from "./planets/mars.js";
import { DEFAULT_TUNING } from "./tuning.js";
import type { Reservoirs } from "./types.js";
import { NEUTRAL_ENV, PHASE_ORDER, Phase } from "./types.js";

const t = DEFAULT_TUNING;

function phaseOf(r: Reservoirs, env = NEUTRAL_ENV): Phase {
  return evaluatePhase(r, derive(r, env, t), env, t);
}

const LIVING: Reservoirs = {
  ...marsStart().reservoirs,
  co2_atm: 1,
  co2_cap: 0,
  co2_reg: 0,
  n2: 1300,
  n2_reg: 0,
  o2: 210,
  h2o_ice: 0,
  // 46 m of sea-level-equivalent puts ocean cover at 0.402, inside the
  // section 2.3 band of 0.3 to 0.7. At 30 m it is 0.295 and just misses.
  h2o_liq: 46,
  h2o_vap: 2,
  biomass: 0.85,
};

describe("phase 0 and 1 - the player has to do something first", () => {
  it("an untouched Mars is Barren, not Warming", () => {
    // Section 7 gives Phase 1 as "T > 200 K and rising", but T at the Mars
    // start is already 213 K - so the planet would enter Phase 1, captioned
    // "Mirrors/GHG online", before the player has built anything at all.
    expect(phaseOf(marsStart().reservoirs)).toBe(Phase.Barren);
  });

  it("enters Warming once mirrors are deployed", () => {
    expect(phaseOf(marsStart().reservoirs, { sMultiplier: 1.05, albedoDelta: 0 })).toBe(Phase.Warming);
  });

  it("enters Warming once greenhouse gas is in the air", () => {
    expect(phaseOf({ ...marsStart().reservoirs, ghg: 0.01 })).toBe(Phase.Warming);
  });
});

describe("the milestone ladder", () => {
  it("enters Runaway thickening when the caps ignite", () => {
    const igniting = { ...marsStart().reservoirs, co2_atm: 25, ghg: 0.1 };
    const d = derive(igniting, NEUTRAL_ENV, t);
    expect(d.T).toBeGreaterThan(t.T_SUBL_CAP);
    expect(phaseOf(igniting)).toBe(Phase.RunawayThickening);
  });

  it("enters First water only when it is both warm AND thick enough", () => {
    // The negative case has to isolate ONE missing condition. An earlier
    // version used a fixture that was neither warm nor thick, so it would have
    // passed even if the pressure clause had been dropped entirely.
    const warmButThin = { ...marsStart().reservoirs, ghg: 90 };
    const thinD = derive(warmButThin, NEUTRAL_ENV, t);
    expect(thinD.T).toBeGreaterThan(t.T_FREEZE);
    expect(thinD.P).toBeLessThan(t.PHASE3_P_MIN);
    expect(phaseOf(warmButThin)).not.toBe(Phase.FirstWater);

    const thickButCold = { ...marsStart().reservoirs, n2: 300 };
    const coldD = derive(thickButCold, NEUTRAL_ENV, t);
    expect(coldD.P).toBeGreaterThan(t.PHASE3_P_MIN);
    expect(coldD.T).toBeLessThan(t.T_FREEZE);
    expect(phaseOf(thickButCold)).not.toBe(Phase.FirstWater);

    const warmAndThick = { ...marsStart().reservoirs, co2_atm: 700, h2o_ice: 20, h2o_liq: 1 };
    const d = derive(warmAndThick, NEUTRAL_ENV, t);
    expect(d.T).toBeGreaterThan(t.T_FREEZE);
    expect(d.P).toBeGreaterThan(t.PHASE3_P_MIN);
    expect(phaseOf(warmAndThick)).toBe(Phase.FirstWater);
  });

  it("enters Ecopoiesis above the biomass threshold", () => {
    const seeded = { ...marsStart().reservoirs, co2_atm: 700, h2o_ice: 20, h2o_liq: 5, biomass: 0.06 };
    expect(phaseOf(seeded)).toBe(Phase.Ecopoiesis);
  });

  it("enters Oxygenation only with oxygen AND a buffer", () => {
    // Section 7 names the phase "Oxygenation and buffer" and gives its entry
    // condition as "o2 > 50 mbar and N2 import active". Checking oxygen alone
    // awards the buffer milestone to an atmosphere with no buffer at all.
    const base = { ...marsStart().reservoirs, co2_atm: 700, h2o_ice: 20, h2o_liq: 5, biomass: 0.3, o2: 60 };
    expect(phaseOf(base)).toBe(Phase.Ecopoiesis);
    expect(phaseOf({ ...base, n2: 200 })).toBe(Phase.Oxygenation);
  });
});

describe("phase 6 checks all SIX rows of the section 2.3 table", () => {
  it("recognises a finished world", () => {
    expect(inLivingWorldBand(LIVING, derive(LIVING, NEUTRAL_ENV, t))).toBe(true);
    expect(phaseOf(LIVING)).toBe(Phase.LivingWorld);
  });

  /**
   * Section 7 lists five quantities for Phase 6 and omits the CO2 toxicity
   * ceiling from the section 2.3 table it points at. A world can hit all five
   * while holding 200 mbar of CO2, which is not a world anyone can breathe on.
   */
  it("refuses a world that is toxic with carbon dioxide", () => {
    const toxic = { ...LIVING, co2_atm: 200 };
    expect(inLivingWorldBand(toxic, derive(toxic, NEUTRAL_ENV, t))).toBe(false);
    expect(phaseOf(toxic)).not.toBe(Phase.LivingWorld);
  });

  it("refuses a drowned world outside the ocean band", () => {
    const drowned = { ...LIVING, h2o_liq: 5000 };
    expect(inLivingWorldBand(drowned, derive(drowned, NEUTRAL_ENV, t))).toBe(false);
  });

  it("refuses a world with too little oxygen", () => {
    const suffocating = { ...LIVING, o2: 40 };
    expect(inLivingWorldBand(suffocating, derive(suffocating, NEUTRAL_ENV, t))).toBe(false);
  });
});

describe("the latch", () => {
  it("keeps the high-water mark when the instantaneous phase falls back", () => {
    expect(latchPhase(Phase.Oxygenation, Phase.FirstWater)).toBe(Phase.Oxygenation);
  });

  it("advances when a new milestone is reached", () => {
    expect(latchPhase(Phase.FirstWater, Phase.Ecopoiesis)).toBe(Phase.Ecopoiesis);
  });

  it("is idempotent", () => {
    for (const phase of PHASE_ORDER) {
      expect(latchPhase(phase, phase)).toBe(phase);
    }
  });
});

describe("phase metadata", () => {
  it("every phase has a name and a caption, so adding one is a compile error", () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_INFO[phase].name.length).toBeGreaterThan(0);
      expect(PHASE_INFO[phase].caption.length).toBeGreaterThan(0);
    }
  });

  it("phases serialise as bare numbers, matching the section 11 save schema", () => {
    expect(JSON.parse(JSON.stringify({ phase: Phase.FirstWater }))).toEqual({ phase: 3 });
  });
});
