import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { marsStart } from "../planets/mars.js";
import { DEFAULT_TUNING } from "../tuning.js";
import type { Reservoirs } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { biomassStep, suitability } from "./biomass.js";
import { advance } from "../integrate.js";

const t = DEFAULT_TUNING;

/**
 * A world life would actually like: warm, wet, thick, with carbon available.
 *
 * This has to be a SELF-CONSISTENT state, not just a pile of large numbers.
 * An earlier version of this fixture carried 5 mbar of vapour at what turned
 * out to be 248 K - vapour that would have rained out instantly - and the
 * resulting 80% cloud deck pushed albedo to 0.40 and froze the planet. The
 * cloud brake was working correctly; the fixture was not.
 */
const HABITABLE: Reservoirs = {
  ...marsStart().reservoirs,
  co2_atm: 300,
  co2_cap: 0,
  co2_reg: 0,
  n2: 700,
  n2_reg: 0,
  o2: 1,
  h2o_ice: 0,
  h2o_liq: 30,
  h2o_vap: 2,
  biomass: 0.1,
};

function step(r: Reservoirs, h: number, seeded: boolean) {
  return biomassStep(r, derive(r, NEUTRAL_ENV, t), t, h, seeded);
}

describe("life cannot grow from nothing (section 3.5)", () => {
  it("stays at exactly zero on a habitable world until it is seeded", () => {
    const unseeded = step({ ...HABITABLE, biomass: 0 }, 1, false);
    expect(unseeded.next).toBe(0);
    expect(unseeded.flows).toHaveLength(0);
  });

  it("grows once seeded, from the refugium alone", () => {
    const seeded = step({ ...HABITABLE, biomass: 0 }, 1, true);
    expect(seeded.next).toBeGreaterThan(0);
  });

  it("keeps a refugium so a recovered climate can regrow a wiped biosphere", () => {
    let r = { ...HABITABLE, biomass: 1e-9 };
    for (let i = 0; i < 10; i += 1) {
      r = { ...r, biomass: step(r, 1, true).next };
    }
    expect(r.biomass).toBeGreaterThanOrEqual(t.BIOMASS_REFUGIA);
  });
});

describe("the logistic step is stable at any step size", () => {
  /**
   * Explicit Euler on r*b*(1-b) is the logistic MAP: it period-doubles above
   * r*h = 2 and diverges above 3. At the 1000-year offline catch-up step that
   * section 8.2 asks for, the product reaches 19.75 and biomass goes to
   * -Infinity. The Mickens discretisation is unconditionally bounded.
   */
  it("stays in [0, 1] at step sizes from a day to a millennium", () => {
    for (const h of [1 / 365, 0.25, 1, 10, 125, 1000, 1e6]) {
      const result = step(HABITABLE, h, true);
      expect(Number.isFinite(result.next)).toBe(true);
      expect(result.next).toBeGreaterThanOrEqual(0);
      expect(result.next).toBeLessThanOrEqual(1);
    }
  });

  it("agrees with a fine-grained integration for small steps", () => {
    const coarse = step(HABITABLE, 1, true).next;
    let r = HABITABLE;
    for (let i = 0; i < 100; i += 1) {
      r = { ...r, biomass: step(r, 0.01, true).next };
    }
    expect(coarse).toBeCloseTo(r.biomass, 2);
  });

  it("saturates at the carrying capacity rather than overshooting it", () => {
    let r = { ...HABITABLE, biomass: 0.99 };
    for (let i = 0; i < 200; i += 1) {
      r = { ...r, biomass: step(r, 1, true).next };
    }
    expect(r.biomass).toBeLessThanOrEqual(1);
    expect(r.biomass).toBeGreaterThan(0.5);
  });
});

describe("the five suitability gates", () => {
  it("any single unmet factor stalls life, as section 3.5 intends", () => {
    const dry = suitability({ ...HABITABLE, h2o_liq: 0 }, derive({ ...HABITABLE, h2o_liq: 0 }, NEUTRAL_ENV, t), t);
    expect(dry.gWater).toBe(0);
    expect(dry.g).toBe(0);

    const thin = { ...HABITABLE, co2_atm: 5, n2: 0, h2o_vap: 0 };
    const thinG = suitability(thin, derive(thin, NEUTRAL_ENV, t), t);
    expect(thinG.gPress).toBe(0);
    expect(thinG.g).toBe(0);
  });

  it("penalises a fire-risk oxygen fraction", () => {
    // The fire penalty is on the oxygen FRACTION, not its partial pressure,
    // so the burning case needs oxygen past 30% of the whole atmosphere -
    // which is exactly why the inert nitrogen buffer of section 3.6 matters.
    const safe = { ...HABITABLE, o2: 10, co2_atm: 300 };
    const burning = { ...HABITABLE, o2: 900, co2_atm: 300 };
    const safeG = suitability(safe, derive(safe, NEUTRAL_ENV, t), t);
    const burningG = suitability(burning, derive(burning, NEUTRAL_ENV, t), t);
    expect(safeG.gTox).toBeCloseTo(1, 6);
    expect(burningG.gTox).toBeLessThan(safeG.gTox);
  });

  it("guards the o2/P division on an airless world instead of producing NaN", () => {
    const vacuum = Object.fromEntries(
      Object.keys(HABITABLE).map((k) => [k, 0]),
    ) as unknown as Reservoirs;
    const g = suitability(vacuum, derive(vacuum, NEUTRAL_ENV, t), t);
    expect(Number.isFinite(g.gTox)).toBe(true);
    expect(Number.isFinite(g.g)).toBe(true);
  });

  it("requires a carbon source - the gate section 3.5 omits", () => {
    const starved = { ...HABITABLE, co2_atm: 300, biomass: 0.5 };
    const full = suitability(starved, derive(starved, NEUTRAL_ENV, t), t);
    expect(full.gCarbon).toBe(1);

    // A biosphere that has drawn the air down to its own endgame target.
    const depleted = { ...HABITABLE, co2_atm: 0.05, n2: 300 };
    const empty = suitability(depleted, derive(depleted, NEUTRAL_ENV, t), t);
    expect(empty.gCarbon).toBeLessThan(0.2);
  });

  it("dies off when conditions turn hostile", () => {
    const frozen = { ...HABITABLE, biomass: 0.5 };
    const result = biomassStep(frozen, { ...derive(frozen, NEUTRAL_ENV, t), T: 200 }, t, 1, true);
    expect(result.suitability.gTemp).toBe(0);
    expect(result.next).toBeLessThan(0.5);
  });
});

describe("photosynthesis stoichiometry", () => {
  it("emits oxygen in the mass ratio 32/44 of the carbon it fixes", () => {
    const result = step(HABITABLE, 1, true);
    const photo = result.flows.find((f) => f.id === "bio.photosynthesis");
    const o2 = result.flows.find((f) => f.id === "bio.o2_release");
    expect(photo).toBeDefined();
    expect(o2).toBeDefined();
    expect((o2?.rate ?? 0) / (photo?.rate ?? 1)).toBeCloseTo(32 / 44, 6);
  });

  it("routes fixed carbon to the ledger rather than deleting it", () => {
    const photo = step(HABITABLE, 1, true).flows.find((f) => f.id === "bio.photosynthesis");
    expect(photo?.from).toBe("co2_atm");
    expect(photo?.to).toBe("c_fixed");
  });

  it("cannot draw more carbon than the atmosphere holds", () => {
    const nearlyEmpty = { ...HABITABLE, co2_atm: 0.02, n2: 300, biomass: 1 };
    const result = step(nearlyEmpty, 1, true);
    const photo = result.flows.find((f) => f.id === "bio.photosynthesis");
    expect((photo?.rate ?? 0) * 1).toBeLessThanOrEqual(nearlyEmpty.co2_atm);
  });

  it("die-off returns carbon at the same ratio, so a grow/die cycle is carbon-neutral", () => {
    const dying = { ...HABITABLE, biomass: 0.5, o2: 50 };
    // 100 mbar of previously fixed carbon: decay un-fixes carbon, so there has
    // to be some to un-fix.
    const result = biomassStep(dying, { ...derive(dying, NEUTRAL_ENV, t), T: 200 }, t, 1, true, 100);
    const o2Used = result.flows.find((f) => f.id === "bio.decay_o2");
    const carbonBack = result.flows.find((f) => f.id === "bio.decay_carbon");
    expect(o2Used).toBeDefined();
    expect(carbonBack).toBeDefined();
    expect((o2Used?.rate ?? 0) / (carbonBack?.rate ?? 1)).toBeCloseTo(32 / 44, 6);
    expect(carbonBack?.from).toBe("c_fixed");
    expect(carbonBack?.to).toBe("co2_atm");
  });

  it("does not burn oxygen when there is no fixed carbon to respire", () => {
    /**
     * The two legs of respiration draw on DIFFERENT accounts - oxygen and
     * fixed carbon - and `applyFluxes` rations per source. So limiting only
     * the oxygen leg let the reaction split in half: on a biosphere seeded
     * into a world whose climate then turned, `c_fixed` was near zero, the
     * carbon leg rationed to nothing, and the oxygen leg still consumed
     * oxygen at full rate and returned no CO2. Oxygen has no ledger identity,
     * so no assertion anywhere caught it. It fired in the shipped reference
     * trajectory at year 600.
     */
    const dying = { ...HABITABLE, biomass: 0.5, o2: 50 };
    const d = { ...derive(dying, NEUTRAL_ENV, t), T: 200 };
    const starved = biomassStep(dying, d, t, 1, true, 0);
    expect(starved.flows.find((f) => f.id === "bio.decay_o2")).toBeUndefined();
    expect(starved.flows.find((f) => f.id === "bio.decay_carbon")).toBeUndefined();

    // And it scales with whichever reagent is scarcer.
    const trickle = biomassStep(dying, d, t, 1, true, 0.01);
    const o2Leg = trickle.flows.find((f) => f.id === "bio.decay_o2");
    const carbonLeg = trickle.flows.find((f) => f.id === "bio.decay_carbon");
    expect((carbonLeg?.rate ?? 0) * 1).toBeLessThanOrEqual(0.01);
    expect((o2Leg?.rate ?? 0) / (carbonLeg?.rate ?? 1)).toBeCloseTo(32 / 44, 6);
  });

  it("does not release oxygen for carbon it could not fix", () => {
    // `bio.o2_release` has no source of its own, and a null-sourced flow is
    // exempt from rationing by construction. `scaleWith` ties it to the carbon
    // leg so a competing sink on co2_atm cannot break the stoichiometry.
    const o2 = step(HABITABLE, 1, true).flows.find((f) => f.id === "bio.o2_release");
    expect(o2?.scaleWith).toBe("co2_atm");
  });

  it("carbon-limited growth does not happen", () => {
    const starved = { ...HABITABLE, co2_atm: 0.02, n2: 300, biomass: 0.5 };
    const rich = { ...HABITABLE, biomass: 0.5 };
    const starvedNext = step(starved, 1, true).next;
    const richNext = step(rich, 1, true).next;
    expect(starvedNext).toBeLessThan(richNext);
  });
});

/**
 * Batch 13: decay stays a whole reaction when oxygen is short.
 *
 * Both reagents were limited up front, but `bio.decay_o2` shares `o2` with the
 * atmospheric-loss sink, so the two could over-request it; `applyFluxes` then
 * rationed the oxygen leg and the carbon leg ran in full. Oxygen has no ledger
 * account, so this identity - oxygen, plus oxygen lost to space, against the
 * carbon fixed at photosynthesis stoichiometry - is the only thing that sees it.
 */
describe("decay under an oxygen shortage", () => {
  const base = marsStart();
  // A dying biosphere (Mars cold, so g is ~0) with plenty of fixed carbon and
  // almost no oxygen left: decay is limited by o2, and loss competes for it.
  const dying = {
    ...base,
    seeded: true,
    reservoirs: { ...base.reservoirs, biomass: 0.5, o2: 0.001 },
    ledger: { ...base.ledger, c_fixed: 5 },
  };
  const oxygenIdentity = (s: typeof dying): number =>
    s.reservoirs.o2 + s.ledger.o2_lost - (t.Y_O2 / t.Y_CO2) * s.ledger.c_fixed;
  const after = advance(dying, 1, { tuning: t, env: NEUTRAL_ENV, forcing: null });

  it("really does run out of oxygen, so the rationing path is exercised", () => {
    expect(after.reservoirs.o2).toBeLessThan(1e-6);
  });

  it("moves oxygen and carbon in stoichiometric step", () => {
    // Measured: 1.25e-8 of oxygen created before the fix, 4.4e-16 after.
    expect(Math.abs(oxygenIdentity(after) - oxygenIdentity(dying))).toBeLessThan(1e-13);
  });
});
