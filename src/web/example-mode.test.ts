/**
 * The example planet must never cost the player their own: it is set aside
 * while the example shows, nothing may be saved meanwhile, and it comes back
 * exactly as it was.
 */

import { describe, expect, it } from "vitest";

import { marsStart } from "../sim/index.js";
import { ExampleMode } from "./example-mode.js";

describe("the example mode", () => {
  it("keeps the player's planet aside and gives it back exactly", () => {
    const mode = new ExampleMode();
    const mine = { ...marsStart(), steps: 1234 };
    const other = { ...marsStart(), steps: 99 };
    expect(mode.mayPersist).toBe(true);
    expect(mode.enter(mine, () => other)).toBe(other);
    expect(mode.active).toBe(true);
    expect(mode.mayPersist).toBe(false);
    expect(mode.leave()).toBe(mine);
    expect(mode.active).toBe(false);
    expect(mode.mayPersist).toBe(true);
  });

  it("never swaps the example in as 'theirs' when asked twice", () => {
    const mode = new ExampleMode();
    const mine = { ...marsStart(), steps: 1 };
    const first = mode.enter(mine, () => ({ ...marsStart(), steps: 2 }));
    mode.enter(first, () => ({ ...marsStart(), steps: 3 }));
    expect(mode.leave()).toBe(mine);
  });

  it("has nothing to give back when no example was showing", () => {
    expect(new ExampleMode().leave()).toBeNull();
  });
});
