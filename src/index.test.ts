import { describe, expect, it } from "vitest";

import { describeStart, main } from "./index.js";

describe("the entry point", () => {
  it("runs without throwing", () => {
    expect(() => main()).not.toThrow();
  });

  it("reports the starting world and how far it is from ignition", () => {
    const summary = describeStart();
    expect(summary).toContain("mars");
    expect(summary).toContain("phase 0 Barren");
    // The gap the player has to close is the whole early game, so the
    // summary states it explicitly rather than leaving it to be inferred.
    expect(summary).toMatch(/K short/);
  });
});
