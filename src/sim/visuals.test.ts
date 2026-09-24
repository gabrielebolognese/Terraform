import { describe, expect, it } from "vitest";

import { derive } from "./derive.js";
import { marsStart } from "./planets/mars.js";
import { DEFAULT_TUNING } from "./tuning.js";
import type { Flow, Reservoirs } from "./types.js";
import { NEUTRAL_ENV } from "./types.js";
import type { Rgb, VisualChannels } from "./visuals.js";
import { PALETTE, SCALAR_CHANNELS, VISUAL_TUNING, capRadiusFrom, deriveVisuals, toHex } from "./visuals.js";

const t = DEFAULT_TUNING;

function channels(over: Partial<Reservoirs>, flows: readonly Flow[] = []): VisualChannels {
  const r = { ...marsStart().reservoirs, ...over };
  return deriveVisuals(r, derive(r, NEUTRAL_ENV, t), flows, t);
}

function releasing(rate: number): readonly Flow[] {
  return [{ id: "co2.cap_sublimation", from: "co2_cap", to: "co2_atm", rate, conversion: 1 }];
}

const components = (c: Rgb): readonly number[] => [c.r, c.g, c.b];

describe("every channel is bounded and finite", () => {
  const states: readonly Partial<Reservoirs>[] = [
    {},
    { co2_atm: 0, co2_cap: 0, co2_reg: 0, n2: 0, n2_reg: 0, o2: 0, h2o_ice: 0, h2o_liq: 0, h2o_vap: 0, ghg: 0, biomass: 0 },
    { co2_atm: 1e6, h2o_vap: 1e5, biomass: 1 },
    { h2o_ice: 1e6, co2_cap: 1e6 },
    { h2o_liq: 1e6, n2: 1e5, o2: 1e5 },
    { co2_atm: -5, o2: -5, biomass: -1 },
  ];

  it("stays inside 0..1 on every channel", () => {
    for (const state of states) {
      for (const rate of [0, 0.5, 1e6]) {
        const v = channels(state, releasing(rate));
        for (const key of SCALAR_CHANNELS) {
          expect(v[key], `${key} out of range for ${JSON.stringify(state)}`).toBeGreaterThanOrEqual(0);
          expect(v[key], `${key} out of range for ${JSON.stringify(state)}`).toBeLessThanOrEqual(1);
        }
        for (const colour of [v.skyColour, v.surfaceTint]) {
          for (const component of components(colour)) {
            expect(component).toBeGreaterThanOrEqual(0);
            expect(component).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("produces no NaN on a vacuum world, where every ratio has a zero denominator", () => {
    const v = channels({ co2_atm: 0, n2: 0, n2_reg: 0, o2: 0, h2o_vap: 0, ghg: 0 });
    for (const key of SCALAR_CHANNELS) expect(Number.isFinite(v[key]), key).toBe(true);
    for (const component of [...components(v.skyColour), ...components(v.surfaceTint)]) {
      expect(Number.isFinite(component)).toBe(true);
    }
  });
});

describe("the section 9 table, row by row", () => {
  it("polar cap size follows both ice reservoirs", () => {
    const bare = channels({ h2o_ice: 0, co2_cap: 0 });
    const water = channels({ h2o_ice: 40, co2_cap: 0 });
    const both = channels({ h2o_ice: 40, co2_cap: 40 });
    expect(bare.capRadius).toBe(0);
    expect(water.capRadius).toBeGreaterThan(0);
    expect(both.capRadius).toBeGreaterThan(water.capRadius);
  });

  it("cap radius is the geometry of a cap, not another invented curve", () => {
    // Two caps subtending angle θ cover `1 - cos θ` between them.
    expect(capRadiusFrom(0)).toBe(0);
    expect(capRadiusFrom(1)).toBeCloseTo(1, 12);
    expect(capRadiusFrom(0.5)).toBeCloseTo(Math.acos(0.5) / (Math.PI / 2), 12);
  });

  it("ocean coverage follows liquid water", () => {
    expect(channels({ h2o_liq: 30 }).oceanCoverage).toBeGreaterThan(channels({ h2o_liq: 5 }).oceanCoverage);
    expect(channels({ h2o_liq: 0 }).oceanCoverage).toBe(0);
  });

  it("surface greenness follows biomass", () => {
    expect(channels({ biomass: 0.8 }).surfaceGreen).toBeGreaterThan(channels({ biomass: 0.1 }).surfaceGreen);
    expect(channels({ biomass: 0 }).surfaceGreen).toBe(0);
  });

  it("atmosphere thickness follows pressure", () => {
    const thin = channels({});
    const thick = channels({ n2: 900 });
    expect(thick.atmosphereThickness).toBeGreaterThan(thin.atmosphereThickness);
    expect(thin.atmosphereThickness).toBeLessThan(0.05);
    expect(thick.atmosphereThickness).toBeGreaterThan(0.9);
  });

  it("sky colour runs butterscotch to blue on the clear fraction", () => {
    const dusty = channels({ co2_atm: 300, n2: 1, o2: 1 });
    const clear = channels({ co2_atm: 1, n2: 800, o2: 210 });
    expect(dusty.clearFraction).toBeLessThan(0.1);
    expect(clear.clearFraction).toBeGreaterThan(0.9);

    // Dusty reads warm - more red than blue. Clear reads cool - the reverse.
    expect(dusty.skyColour.r).toBeGreaterThan(dusty.skyColour.b);
    expect(clear.skyColour.b).toBeGreaterThan(clear.skyColour.r);
  });

  it("the sky fades toward vacuum when there is barely any air", () => {
    // Without this a 6 mbar Mars and a 1 bar Mars of the same composition
    // would be equally skyful, which is the one thing a limb must not do.
    const trace = channels({ co2_atm: 0.05, n2: 0, o2: 0, h2o_vap: 0 });
    const thick = channels({ co2_atm: 400, n2: 0, o2: 0, h2o_vap: 0 });
    for (const component of components(trace.skyColour)) expect(component).toBeLessThan(0.2);
    expect(thick.skyColour.r).toBeGreaterThan(trace.skyColour.r);
  });

  it("cloud cover follows water vapour", () => {
    expect(channels({ h2o_vap: 4 }).cloudCover).toBeGreaterThan(channels({ h2o_vap: 0.2 }).cloudCover);
  });

  it("surface tint runs frost-blue to warm-neutral on temperature", () => {
    const cold = channels({});
    const warm = channels({ co2_atm: 900, n2: 200 });
    expect(cold.surfaceTint.b).toBeGreaterThan(cold.surfaceTint.r);
    expect(warm.surfaceTint.r).toBeGreaterThanOrEqual(warm.surfaceTint.b);
  });

  it("dust needs rapid outgassing AND dry ground", () => {
    // §9: "particle/haze bursts during rapid thickening". An ocean world does
    // not raise a global dust storm however fast its regolith is venting.
    const quiet = channels({}, releasing(0));
    const venting = channels({}, releasing(VISUAL_TUNING.DUST_RELEASE_REF));
    const ventingButWet = channels({ h2o_liq: 200 }, releasing(VISUAL_TUNING.DUST_RELEASE_REF));

    expect(quiet.dustIntensity).toBe(0);
    expect(venting.dustIntensity).toBeGreaterThan(0.9);
    expect(ventingButWet.dustIntensity).toBeLessThan(venting.dustIntensity * 0.5);
  });

  it("dust reads the release flows specifically, not a net rate on co2_atm", () => {
    // A net rate would already have the biosphere's uptake and the solar
    // wind's bleed mixed in; the flow id is what keeps them separate.
    const withSinks: readonly Flow[] = [
      ...releasing(0.5),
      { id: "bio.photosynthesis", from: "co2_atm", to: "c_fixed", rate: 10, conversion: 1 },
      { id: "loss.co2_atm", from: "co2_atm", to: "c_lost", rate: 5, conversion: 1 },
    ];
    expect(channels({}, withSinks).dustIntensity).toBeCloseTo(channels({}, releasing(0.5)).dustIntensity, 12);
  });
});

describe("continuity - the property the whole contract rests on", () => {
  /**
   * §9: "All of these are continuous functions of continuous state, which is
   * what makes the growth look slow and alive rather than snapping between
   * discrete looks at phase boundaries."
   *
   * Sweeping each driving reservoir finely and bounding the largest adjacent
   * step is how a step function gets caught: any branch, threshold or
   * phase-dependent lookup shows up as one delta far above its neighbours.
   */
  function maxStepOver(
    key: keyof Reservoirs,
    from: number,
    to: number,
    samples = 2000,
  ): { channel: string; step: number } {
    let worst = { channel: "none", step: 0 };
    let previous: VisualChannels | null = null;
    for (let i = 0; i <= samples; i += 1) {
      const value = from + ((to - from) * i) / samples;
      const now = channels({ [key]: value } as Partial<Reservoirs>, releasing(0.3));
      if (previous !== null) {
        for (const channel of RENDERED_CHANNELS) {
          const step = Math.abs(now[channel] - previous[channel]);
          if (step > worst.step) worst = { channel, step };
        }
        for (const [name, a, b] of [
          ["sky.r", now.skyColour.r, previous.skyColour.r],
          ["sky.g", now.skyColour.g, previous.skyColour.g],
          ["sky.b", now.skyColour.b, previous.skyColour.b],
          ["tint.r", now.surfaceTint.r, previous.surfaceTint.r],
        ] as const) {
          const step = Math.abs(a - b);
          if (step > worst.step) worst = { channel: name, step };
        }
      }
      previous = now;
    }
    return worst;
  }

  /**
   * `clearFraction` is excluded because it is an exposed INTERMEDIATE, not
   * something drawn. It is a ratio, so near vacuum its denominator vanishes
   * and it genuinely does swing - adding 0.6 mbar of CO2 to a 0.21 mbar
   * atmosphere really does quadruple the pressure. That steepness is real,
   * and the test below pins the thing that actually matters: it does not
   * reach the screen.
   */
  const RENDERED_CHANNELS = SCALAR_CHANNELS.filter((c) => c !== "clearFraction");

  /**
   * The bound is not tighter because polar cap geometry genuinely is steep
   * near zero: a cap covering fraction f has angular radius proportional to
   * sqrt(f), so the first sliver of ice appears fast. That is real geometry
   * and correct on screen; a step function would be orders of magnitude worse.
   */
  const MAX_STEP = 0.02;

  it("no channel jumps as the ice reservoirs vary", () => {
    const ice = maxStepOver("h2o_ice", 0, 200);
    const cap = maxStepOver("co2_cap", 0, 200);
    expect(ice.step, `${ice.channel} jumped`).toBeLessThan(MAX_STEP);
    expect(cap.step, `${cap.channel} jumped`).toBeLessThan(MAX_STEP);
  });

  it("no channel jumps as water, life or air vary", () => {
    for (const [key, from, to] of [
      ["h2o_liq", 0, 300],
      ["biomass", 0, 1],
      ["h2o_vap", 0, 40],
      ["co2_atm", 0, 1200],
      ["n2", 0, 1200],
      ["o2", 0, 400],
    ] as const) {
      const worst = maxStepOver(key, from, to);
      expect(worst.step, `${worst.channel} jumped while sweeping ${key}`).toBeLessThan(MAX_STEP);
    }
  });

  it("a steep clear fraction near vacuum does not reach the sky", () => {
    /**
     * The one place an input genuinely swings: with 0.21 mbar of trace gas,
     * clearFraction runs 1.0 down to 0.26 over the first 0.6 mbar of CO2.
     * The sky does not follow, because a near-vacuum sky is faded almost
     * entirely to the vacuum colour - which is both correct (there is no air
     * to scatter anything) and what keeps the swing off the screen.
     */
    const vacuum = channels({ co2_atm: 0 });
    const trace = channels({ co2_atm: 0.6 });
    expect(Math.abs(trace.clearFraction - vacuum.clearFraction)).toBeGreaterThan(0.5);

    for (const [a, b] of [
      [vacuum.skyColour.r, trace.skyColour.r],
      [vacuum.skyColour.g, trace.skyColour.g],
      [vacuum.skyColour.b, trace.skyColour.b],
    ] as const) {
      expect(Math.abs(a - b)).toBeLessThan(MAX_STEP);
    }
    expect(vacuum.atmosphereThickness).toBeLessThan(0.01);
  });

  it("no channel jumps as the outgassing rate varies", () => {
    let worst = 0;
    let previous: VisualChannels | null = null;
    for (let i = 0; i <= 2000; i += 1) {
      const now = channels({}, releasing((i / 2000) * 3));
      if (previous !== null) worst = Math.max(worst, Math.abs(now.dustIntensity - previous.dustIntensity));
      previous = now;
    }
    expect(worst).toBeLessThan(MAX_STEP);
  });
});

describe("colours are values, not strings", () => {
  it("the contract returns numbers a renderer can interpolate", () => {
    const sky = channels({}).skyColour;
    expect(typeof sky.r).toBe("number");
    expect(sky).not.toHaveProperty("length");
  });

  it("hex is a convenience on top, not the contract", () => {
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe("#000000");
    expect(toHex({ r: 1, g: 1, b: 1 })).toBe("#ffffff");
    expect(toHex(PALETTE.skyBlue)).toMatch(/^#[0-9a-f]{6}$/);
    // Out-of-range input clamps rather than producing a malformed string.
    expect(toHex({ r: 5, g: -5, b: 0.5 })).toBe("#ff0080");
  });
});
