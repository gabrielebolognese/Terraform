import { describe, expect, it } from "vitest";

import { avail, bell, clamp, clamp01, expDecay, lerp, log1p, quartRoot, ramp, safeDiv, saturating, sig, smoothstep } from "./math.js";

describe("clamp / clamp01 / lerp", () => {
  it("clamps to the interval", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-0.1)).toBe(0);
  });

  it("interpolates", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 0)).toBe(10);
  });
});

describe("smoothstep", () => {
  it("is 0 below, 1 above, and 0.5 at the midpoint", () => {
    expect(smoothstep(0, 10, -1)).toBe(0);
    expect(smoothstep(0, 10, 11)).toBe(1);
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5, 12);
  });

  it("degenerates to a hard step rather than dividing by zero", () => {
    expect(smoothstep(5, 5, 4)).toBe(0);
    expect(smoothstep(5, 5, 6)).toBe(1);
    expect(Number.isFinite(smoothstep(5, 5, 5))).toBe(true);
  });

  it("is monotonic non-decreasing", () => {
    let previous = -Infinity;
    for (let x = -2; x <= 12; x += 0.25) {
      const value = smoothstep(0, 10, x);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("ramp - the renormalised sigmoid", () => {
  const CUT = 0.5;

  it("is EXACTLY zero at and below the threshold", () => {
    // This is the whole point. The doc's bare sigmoid is 0.5 at the threshold,
    // which makes the polar caps sublimate at 38% of full rate on turn one.
    expect(ramp(216, 216, 6, CUT)).toBe(0);
    expect(ramp(215.99, 216, 6, CUT)).toBe(0);
    expect(ramp(213.07, 216, 6, CUT)).toBe(0);
    expect(ramp(100, 216, 6, CUT)).toBe(0);
  });

  it("equals clamp01(tanh((x - x0) / (2w))) at cut = 0.5", () => {
    for (const x of [216, 218, 220, 225, 230, 250]) {
      const expected = Math.max(0, Math.tanh((x - 216) / (2 * 6)));
      expect(ramp(x, 216, 6, CUT)).toBeCloseTo(expected, 12);
    }
  });

  it("rises monotonically above the threshold and approaches 1", () => {
    let previous = -1;
    for (let x = 210; x <= 280; x += 1) {
      const value = ramp(x, 216, 6, CUT);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(ramp(400, 216, 6, CUT)).toBeCloseTo(1, 6);
  });

  it("degrades to a hard step on a zero width rather than producing NaN", () => {
    expect(ramp(220, 216, 0, CUT)).toBe(1);
    expect(ramp(210, 216, 0, CUT)).toBe(0);
  });
});

describe("bell - the plateau suitability band", () => {
  it("is 1 across the whole comfortable band, not just at its centre", () => {
    // A raised cosine scores 0.61 at 288 K, the game's own victory
    // temperature, which caps biomass below its target no matter what.
    expect(bell(288, 278, 313, 8)).toBeCloseTo(1, 10);
    expect(bell(278, 278, 313, 8)).toBeCloseTo(1, 10);
    expect(bell(313, 278, 313, 8)).toBeCloseTo(1, 10);
  });

  it("falls smoothly to zero outside the shoulders", () => {
    expect(bell(270, 278, 313, 8)).toBe(0);
    expect(bell(321, 278, 313, 8)).toBe(0);
    expect(bell(274, 278, 313, 8)).toBeGreaterThan(0);
    expect(bell(274, 278, 313, 8)).toBeLessThan(1);
  });

  it("never leaves [0, 1]", () => {
    for (let T = 200; T <= 400; T += 1) {
      const value = bell(T, 278, 313, 8);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe("guards against non-finite arithmetic", () => {
  it("safeDiv falls back instead of dividing by zero", () => {
    expect(safeDiv(1, 0, -1, 1e-9)).toBe(-1);
    expect(safeDiv(1, 1e-12, 0, 1e-9)).toBe(0);
    expect(safeDiv(1, 2, 0, 1e-9)).toBe(0.5);
  });

  it("quartRoot never sees a negative base", () => {
    expect(quartRoot(-100)).toBe(0);
    expect(quartRoot(16)).toBeCloseTo(2, 12);
    expect(Number.isNaN(quartRoot(-1))).toBe(false);
  });

  it("log1p floors at zero", () => {
    expect(log1p(-5)).toBe(0);
    expect(log1p(0)).toBe(0);
    expect(log1p(20)).toBeCloseTo(Math.log(21), 12);
  });

  it("avail and saturating stay bounded and finite on degenerate scales", () => {
    expect(avail(5, 0)).toBe(1);
    expect(avail(0, 0)).toBe(0);
    expect(avail(0.5, 2)).toBe(0.25);
    expect(saturating(100, 0.85, 0)).toBe(0);
    expect(saturating(-5, 0.85, 10)).toBe(0);
    expect(saturating(1e9, 0.85, 10)).toBeCloseTo(0.85, 10);
  });

  it("expDecay is bounded in [0, 1]", () => {
    expect(expDecay(0, 100)).toBe(1);
    expect(expDecay(1e6, 1)).toBeCloseTo(0, 10);
    expect(expDecay(-1, 1)).toBe(1);
  });

  it("sig is bounded and symmetric", () => {
    expect(sig(0)).toBeCloseTo(0.5, 12);
    expect(sig(1000)).toBeCloseTo(1, 12);
    expect(sig(-1000)).toBeCloseTo(0, 12);
  });
});
