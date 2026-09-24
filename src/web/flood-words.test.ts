/**
 * The flood, in words (Batch 24): a real drowning city, through `cityView`,
 * to the inspector's reason. In the web layer because the simulation is
 * compiled without the DOM - a sim test that imported the inspector failed the
 * typecheck, which is invariant #7 doing its job.
 */

import { describe, expect, it } from "vitest";

import { advance } from "../sim/integrate.js";
import { cityView } from "../sim/micro/view.js";
import { channels, fixture, rising, t } from "../testkit/flood.js";
import { offlineReason } from "./city.js";

describe("what the player is told", () => {
  it("marks a building under water in the city view, and the inspector says so in words", async () => {
    // Substep 22 of the drowning: the landing zone is just under water.
    let s = fixture();
    for (let i = 0; i < 23; i += 1) s = advance(s, 1, rising);
    const env = channels(s);
    const view = cityView(s.settlements[0]!, env, t);
    const i = view.buildings.findIndex((b) => b.tx === 13 && b.ty === 13);
    expect(view.buildings[i]!.submerged).toBe(true);
    expect(view.buildings[i]!.operable).toBe(false);
    expect(view.floodState).toBe("partial");
    expect(view.wet.filter(Boolean).length).toBeGreaterThan(600);
    expect(offlineReason(view, i, env, t)).toBe("Offline: under water.");
  });
});

