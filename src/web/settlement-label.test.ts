/**
 * Metres in words (Batch 22): the one formatter every elevation on screen uses.
 */

import { describe, expect, it } from "vitest";

import { formatMetres } from "./settlement-label.js";

describe("metres for the player", () => {
  it("groups thousands and uses a true minus sign for elevations on the planet", () => {
    expect(formatMetres(-3120.4)).toBe("−3,120 m");
    expect(formatMetres(1604)).toBe("1,604 m");
    expect(formatMetres(12345678)).toBe("12,345,678 m");
    expect(formatMetres(-0.4)).toBe("0 m");
  });

  it("gives local heights a sign and a decimal, and never a negative zero", () => {
    expect(formatMetres(3.24, true)).toBe("+3.2 m");
    expect(formatMetres(-9.29, true)).toBe("−9.3 m");
    expect(formatMetres(-0.04, true)).toBe("0.0 m");
    expect(formatMetres(0, true)).toBe("0.0 m");
  });
});
