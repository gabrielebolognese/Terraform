// @vitest-environment happy-dom

/**
 * Batch 21's exit gate:
 *
 *   "The macro sim and every settlement advance identically whether the
 *    player is in orbit or in any city. Measured by running the same sim-time
 *    both ways and comparing exactly."
 *   "Only one city scene is ever resident."
 *
 * Two worlds, one timestamp sequence. The control never leaves orbit. The
 * traveller goes down to one city, hops to another by way of orbit, and comes
 * back up - with a real `CityScreen` drawing each city it is in, exactly as
 * `main.ts` wires it. The worlds are compared with `toEqual`, not a tolerance.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { SimState } from "../sim/index.js";
import { NEUTRAL_ENV, foundSettlement, habitat, makeTuning, marsStart, placeBuilding } from "../sim/index.js";
import { CityScreen } from "./city.js";
import { TRAVEL_MS } from "./config.js";
import { WorldDriver } from "./driver.js";
import { Journey } from "./journey.js";
import { SimClock } from "./loop.js";

/** The browser's own tuning (`main.ts`): events, economy, tech gates, settlements, hills. */
const tuning = makeTuning({
  EVENTS_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  TECH_GATE_ENABLED: 1,
  SETTLEMENTS_ENABLED: 1,
  TERRAIN_RELIEF_M: 12,
});
const cfg = () => ({ tuning, env: NEUTRAL_ENV, forcing: null });

/** Two growing settlements on a fresh Mars. */
function start(): SimState {
  let s = foundSettlement(marsStart(undefined, tuning), "city", 0.31, -1.2, tuning).state;
  s = foundSettlement(s, "outpost", -0.4, 2.2, tuning).state;
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1000 } })) };
  for (const [type, tx, ty] of [
    ["spaceport", 12, 12],
    ["geothermal_plant", 15, 12],
    ["habitat_dome", 12, 15],
    ["greenhouse", 15, 15],
    ["water_extractor", 17, 12],
  ] as const) {
    s = placeBuilding(s, "settlement-1", type, tx, ty, tuning).state;
  }
  for (const [type, tx, ty] of [
    ["reactor", 6, 6],
    ["regolith_mine", 8, 6],
  ] as const) {
    s = placeBuilding(s, "settlement-2", type, tx, ty, tuning).state;
  }
  return s;
}

const FRAME_MS = 1000 / 60;

interface Trip {
  readonly control: WorldDriver;
  readonly traveller: WorldDriver;
  readonly residents: Set<string>;
  /** Frames spent with the camera moving, and how many of those had a scene open. */
  readonly transitFrames: number;
  readonly openInTransit: number;
  readonly phases: string[];
  readonly log: string[];
  readonly steps: number;
  readonly mismatchedScreen: number;
}

/** Drive both worlds through `frames` frames; the traveller follows `plan` (frame -> action). */
function trip(frames: number, plan: ReadonlyMap<number, (j: Journey, now: number) => void>): Trip {
  const control = new WorldDriver(start(), new SimClock(cfg, 100), tuning);
  const traveller = new WorldDriver(start(), new SimClock(cfg, 100), tuning);
  const host = document.createElement("div");
  document.body.append(host);
  const city = new CityScreen(
    host,
    {
      onPlace: () => ({ ok: false, reason: "not in this test" }),
      canPlace: () => ({ ok: false, reason: "not in this test" }),
      onRemove: () => ({ ok: false, reason: "not in this test" }),
      onRoad: () => ({ ok: false, reason: "not in this test" }),
      canRoad: () => ({ ok: false, reason: "not in this test" }),
      onUnroad: () => ({ ok: false, reason: "not in this test" }),
      onConnect: () => ({ ok: false, reason: "not in this test", laid: 0 }),
      onBack: () => undefined,
    },
    tuning,
  );
  const log: string[] = [];
  const journey = new Journey(
    {
      load: (id) => {
        log.push(`load:${id}`);
        city.open(id);
      },
      unload: (id) => {
        log.push(`unload:${id}`);
        city.close();
      },
      flush: () => log.push("flush"),
      pose: () => undefined,
      currentPose: () => ({ yaw: 0, pitch: 0.42, zoom: 1 }),
    },
    (id) => {
      const s = traveller.state.settlements.find((x) => x.id === id);
      return s === undefined ? null : { lat: s.lat, lon: s.lon };
    },
  );

  const residents = new Set<string>();
  const phases: string[] = [];
  let transitFrames = 0;
  let openInTransit = 0;
  let steps = 0;
  let mismatchedScreen = 0;
  for (let i = 0; i < frames; i += 1) {
    const now = i * FRAME_MS;
    steps += control.frame(now).stepsRun;
    // The traveller's frame, in main.ts's order: advance, then travel, then draw the city.
    const f = traveller.frame(now);
    plan.get(i)?.(journey, now);
    journey.frame(now);
    const resident = journey.resident;
    if (resident !== null) {
      residents.add(resident);
      const here = traveller.state.settlements.find((s) => s.id === resident)!;
      city.frame(here, habitat(traveller.state.reservoirs, f.world.derived, tuning, 0), now);
    }
    if (journey.phase === "descending" || journey.phase === "ascending") {
      transitFrames += 1;
      if (city.openId !== null) openInTransit += 1;
    }
    if (city.openId !== resident) mismatchedScreen += 1;
    if (phases[phases.length - 1] !== journey.phase) phases.push(journey.phase);
  }
  return { control, traveller, residents, transitFrames, openInTransit, phases, log, steps, mismatchedScreen };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("travel changes the view, never the world", () => {
  // Down to the city, across to the outpost by way of orbit, back up to orbit.
  const FRAMES = 600;
  const PLAN = new Map<number, (j: Journey, now: number) => void>([
    [30, (j, now) => j.goTo("settlement-1", now)],
    [200, (j, now) => j.goTo("settlement-2", now)],
    [420, (j, now) => j.goToOrbit(now)],
  ]);

  it("advances the planet and every settlement exactly as a player who never left orbit", () => {
    const t = trip(FRAMES, PLAN);
    expect(t.traveller.state).toEqual(t.control.state);
  });

  it("really did travel, while the world really moved - the comparison above is not vacuous", () => {
    const t = trip(FRAMES, PLAN);
    expect([...t.residents].sort()).toEqual(["settlement-1", "settlement-2"]);
    expect(t.phases).toEqual(["orbit", "descending", "city", "ascending", "descending", "city", "ascending", "orbit"]);
    // Measured: 119 substeps (about 30 sim-years) over these 10 seconds at
    // speed 100, about three quarters of them while the traveller was away from orbit.
    expect(t.steps).toBeGreaterThan(100);
    const before = start().settlements[0]!;
    const after = t.traveller.state.settlements[0]!;
    expect(after.population).toBeGreaterThan(before.population);
    expect(after.stores).not.toEqual(before.stores);
  });

  it("holds one city scene at most: the resident one, and none while the camera moves", () => {
    const t = trip(FRAMES, PLAN);
    // The screen shows exactly the resident settlement, every frame.
    expect(t.mismatchedScreen).toBe(0);
    // Leaving unloads before the pull-back, and arriving loads after the
    // descent, so a hop between cities never has two - or even one - open
    // in between.
    expect(t.openInTransit).toBe(0);
    // Vacuity: four journeys of TRAVEL_MS each were really in flight.
    expect(t.transitFrames).toBeGreaterThan(4 * Math.floor(TRAVEL_MS / FRAME_MS) - 4);
  });

  it("flushes the save on each arrival and each departure, departing before it unloads", () => {
    const t = trip(FRAMES, PLAN);
    expect(t.log).toEqual([
      "load:settlement-1",
      "flush",
      "flush",
      "unload:settlement-1",
      "load:settlement-2",
      "flush",
      "flush",
      "unload:settlement-2",
    ]);
  });

  it("takes the journey's own time: arrival comes TRAVEL_MS after the request, not before", () => {
    const t = trip(30 + Math.ceil(TRAVEL_MS / FRAME_MS) - 1, new Map([[30, (j: Journey, now: number) => j.goTo("settlement-1", now)]]));
    expect(t.residents.size).toBe(0);
    const u = trip(30 + Math.ceil(TRAVEL_MS / FRAME_MS) + 1, new Map([[30, (j: Journey, now: number) => j.goTo("settlement-1", now)]]));
    expect([...u.residents]).toEqual(["settlement-1"]);
  });
});
