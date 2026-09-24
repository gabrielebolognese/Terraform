/**
 * Micro §1.4's travel, as a state machine, and the camera move's aim.
 */

import { describe, expect, it } from "vitest";

import { latLonToVec } from "../sim/index.js";
import { TRAVEL_MS } from "./config.js";
import { projectToScreen } from "./globe-geometry.js";
import type { Travel } from "./travel.js";
import { IN_ORBIT, aimAt, goTo, goToOrbit, residentCity, step, travelPose } from "./travel.js";

/** Run a travel forward, collecting every effect, one "frame" per 100 ms. */
function run(t: Travel, from: number, to: number): { travel: Travel; effects: string[] } {
  let travel = t;
  const effects: string[] = [];
  for (let now = from; now <= to; now += 100) {
    const out = step(travel, now);
    travel = out.travel;
    for (const e of out.effects) effects.push(e.type === "flush" ? "flush" : `${e.type}:${e.id}`);
  }
  return { travel, effects };
}

describe("travel between orbit and a city", () => {
  it("goes down: the camera moves first, then the scene loads and the save is written", () => {
    const down = goTo(IN_ORBIT, "settlement-1", 0);
    expect(down.travel.phase).toBe("descending");
    expect(down.effects).toEqual([]);
    // Nothing is resident while the camera is still moving.
    expect(residentCity(run(down.travel, 0, TRAVEL_MS - 100).travel)).toBeNull();
    const arrived = run(down.travel, 0, TRAVEL_MS);
    expect(arrived.travel).toEqual({ phase: "city", id: "settlement-1" });
    expect(arrived.effects).toEqual(["load:settlement-1", "flush"]);
  });

  it("comes back up in the doc's order: flush, unload, then the camera pulls back", () => {
    const up = goToOrbit({ phase: "city", id: "settlement-1" }, 5000);
    expect(up.effects.map((e) => e.type)).toEqual(["flush", "unload"]);
    expect(residentCity(up.travel)).toBeNull();
    expect(run(up.travel, 5000, 5000 + TRAVEL_MS).travel).toEqual(IN_ORBIT);
  });

  it("goes city to city by way of orbit - never a direct warp", () => {
    const hop = goTo({ phase: "city", id: "settlement-1" }, "settlement-2", 0);
    expect(hop.travel.phase).toBe("ascending");
    expect(hop.effects.map((e) => (e.type === "flush" ? "flush" : `${e.type}:${e.id}`))).toEqual(["flush", "unload:settlement-1"]);
    const phases: string[] = [];
    let t = hop.travel;
    const effects: string[] = [];
    for (let now = 0; now <= 3 * TRAVEL_MS; now += 100) {
      const out = step(t, now);
      t = out.travel;
      for (const e of out.effects) effects.push(e.type === "flush" ? "flush" : `${e.type}:${e.id}`);
      if (phases[phases.length - 1] !== t.phase) phases.push(t.phase);
    }
    expect(phases).toEqual(["ascending", "descending", "city"]);
    expect(t).toEqual({ phase: "city", id: "settlement-2" });
    expect(effects).toEqual(["load:settlement-2", "flush"]);
  });

  it("ignores a new destination while a journey is under way", () => {
    const down = goTo(IN_ORBIT, "settlement-1", 0).travel;
    expect(goTo(down, "settlement-2", 300)).toEqual({ travel: down, effects: [] });
    expect(goToOrbit(down, 300)).toEqual({ travel: down, effects: [] });
    // And asking for the city the player is already in does nothing.
    const here: Travel = { phase: "city", id: "settlement-1" };
    expect(goTo(here, "settlement-1", 0)).toEqual({ travel: here, effects: [] });
  });
});

describe("the camera move", () => {
  const CAM = { cx: 500, cy: 400, radius: 300 };

  it("aims the site at the centre of the disc, facing the viewer", () => {
    // The oracle is the globe's own projection, not the aim's algebra.
    for (const [lat, lon] of [
      [0, 0],
      [0.5, 1.2],
      [-0.9, -2.8],
      [1.2, 3.1],
      [-0.3, -0.01],
    ] as const) {
      for (const fromYaw of [0, 2.5, -7]) {
        const aim = aimAt(lat, lon, fromYaw);
        const at = projectToScreen(latLonToVec(lat, lon), { ...CAM, ...aim });
        expect(at.visible, `${lat},${lon} from ${fromYaw}`).toBe(true);
        expect(at.x).toBeCloseTo(CAM.cx, 9);
        expect(at.y).toBeCloseTo(CAM.cy, 9);
        expect(at.depth).toBeCloseTo(1, 9);
        // The short way round: never more than half a turn.
        expect(Math.abs(aim.yaw - fromYaw)).toBeLessThanOrEqual(Math.PI + 1e-12);
      }
    }
  });

  it("stops short of the pole the globe will not tip past, and the site still faces the viewer", () => {
    const aim = aimAt(1.5, 0.4, 0);
    expect(aim.pitch).toBe(1.35);
    expect(projectToScreen(latLonToVec(1.5, 0.4), { ...CAM, ...aim }).visible).toBe(true);
  });

  it("starts from where the player was and ends over the site, then returns them there", () => {
    const home = { yaw: 0.3, pitch: 0.42, zoom: 1.1 };
    const site = { lat: 0.5, lon: 1.2 };
    const siteOf = (): { lat: number; lon: number } => site;
    const down: Travel = { phase: "descending", id: "a", start: 0 };
    expect(travelPose(down, 0, home, siteOf)).toEqual(home);
    const end = travelPose(down, TRAVEL_MS, home, siteOf)!;
    const at = projectToScreen(latLonToVec(site.lat, site.lon), { ...CAM, ...end });
    expect(at.x).toBeCloseTo(CAM.cx, 9);
    expect(end.zoom).toBeGreaterThan(home.zoom);
    const up: Travel = { phase: "ascending", id: "a", start: 0, next: null };
    const back = travelPose(up, TRAVEL_MS, home, siteOf)!;
    expect(back.yaw).toBeCloseTo(home.yaw, 12);
    expect(back.pitch).toBeCloseTo(home.pitch, 12);
    expect(back.zoom).toBeCloseTo(home.zoom, 12);
  });
});
