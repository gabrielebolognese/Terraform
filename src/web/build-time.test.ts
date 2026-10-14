// @vitest-environment happy-dom

/**
 * Batch 28: "the countdown shown everywhere a build is: over the worksite, in
 * the city panel, in the queue, in real time ('3 min 20 s')" - through the
 * real city screen, with the queue's buttons reaching the simulation.
 */

import { describe, expect, it } from "vitest";

import type { SimState, Tuning } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  cancelQueuedBuild,
  connectAll,
  connectTwice,
  derive,
  foundSettlement,
  habitat,
  makeTuning,
  marsStart,
  moveQueuedBuild,
  placeBuilding,
  tileKey,
  worldEnv,
} from "../sim/index.js";
import type { ActionOutcome, CityHooks } from "./city.js";
import { CityScreen } from "./city.js";
import { formatDuration } from "./build-time.js";

const T = makeTuning({
  SETTLEMENTS_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  BUILD_TIME_ENABLED: 1,
  BUILD_CURVE_ENABLED: 1,
  TIME_SCALE: 0.03 / 8,
  SUBSTEP_YEARS: 0.25 / 8,
  CITY_CLOCK: 8,
  CITY_GRID_TILES: 64,
});

const refused: ActionOutcome = { ok: false, reason: "not in this test" };

/** Every rover out on a solar array, then a dome and a greenhouse waiting. */
function busyCity(t: Tuning): SimState {
  const founded = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
  let s: SimState = { ...founded, settlements: founded.settlements.map((c) => ({ ...c, population: 400, stores: { ...c.stores, materials: 5000 } })) };
  const id = s.settlements[0]!.id;
  const place = (type: Parameters<typeof placeBuilding>[2], tx: number, ty: number) => {
    const o = placeBuilding(s, id, type, tx, ty, t);
    if (!o.ok) throw new Error(`${type}: ${o.reason}`);
    s = o.state;
  };
  for (let k = 0; k < t.ROVERS_PER_HQ; k += 1) place("solar_array", 10 + 3 * k, 10);
  place("habitat_dome", 10, 30);
  place("greenhouse", 10, 40);
  return s;
}

function mount() {
  const box = { state: busyCity(T) };
  const host = document.createElement("div");
  document.body.append(host);
  const hooks: CityHooks = {
    onPlace: () => refused,
    canPlace: () => refused,
    onRemove: () => refused,
    onLink: () => refused,
    canLink: () => refused,
    onUnlink: () => refused,
    onSendRover: () => refused,
    onLaunch: () => refused,
    onConnect: (id) => connectAll(box.state, id, T),
    onLevel: () => refused,
    canLevel: () => refused,
    onUpgrade: () => refused,
    onConnectTwice: (id) => connectTwice(box.state, id, T),
    onClaim: () => refused,
    onBack: () => undefined,
    onMoveQueued: (id, from, to) => {
      const o = moveQueuedBuild(box.state, id, from, to);
      box.state = o.state;
      return o;
    },
    onCancelQueued: (id, index) => {
      const o = cancelQueuedBuild(box.state, id, index);
      box.state = o.state;
      return o;
    },
  };
  const screen = new CityScreen(host, hooks, T);
  let now = 0;
  const frame = (): void => {
    now += 1000;
    const s = box.state;
    screen.frame(s.settlements[0]!, habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0), now);
  };
  screen.open(box.state.settlements[0]!.id);
  frame();
  const rows = () => [...host.querySelectorAll<HTMLElement>(".city-build")];
  return { host, screen, box, frame, rows };
}

describe("countdowns in real time", () => {
  it("formats real time the way the plan writes it", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(200)).toBe("3 min 20 s");
    expect(formatDuration(180)).toBe("3 min");
    expect(formatDuration(7500)).toBe("2 h 05 min");
  });

  it("lists the rovers' work with its countdown, then the queue in order, and labels each worksite", () => {
    const { host, rows } = mount();
    const r = rows();
    expect(r.map((x) => x.dataset["kind"])).toEqual(["building", "building", "building", "waiting", "waiting"]);
    expect(r[0]!.textContent).toMatch(/Building the Solar Array: ready in \d+ s\./);
    expect(r[3]!.textContent).toMatch(/The Habitat Dome waits for a rover \(next for a rover\); it takes \d+ min( \d+ s)? once one goes\./);
    expect(r[4]!.textContent).toMatch(/Greenhouse waits for a rover \(2nd in the queue\)/);
    // Over the worksites: the three under way count down; the two waiting say so.
    const labels = [...host.querySelectorAll<HTMLElement>(".city-countdown")].map((l) => l.textContent);
    expect(labels.filter((l) => /^\d+ s$/.test(l ?? ""))).toHaveLength(3);
    expect(labels.filter((l) => l === "waiting")).toHaveLength(2);
  });

  it("counts down at the world's speed: twice as fast at 2x", () => {
    const { screen, frame, rows } = mount();
    const seconds = (): number => Number(/ready in (\d+) s/.exec(rows()[0]!.textContent ?? "")?.[1]);
    const at1 = seconds();
    screen.speed = 2;
    frame();
    // Half, to the rounding of a whole second either side.
    expect(Math.abs(seconds() - at1 / 2)).toBeLessThanOrEqual(1);
  });

  it("moves and cancels through the queue's buttons, refunding in full", () => {
    const { box, frame, rows } = mount();
    const id = box.state.settlements[0]!.id;
    const before = box.state.settlements[0]!.stores.materials;
    // The dome's "Down": the greenhouse goes first.
    rows()[3]!.querySelector<HTMLButtonElement>(".city-build-down")!.click();
    frame();
    expect(box.state.settlements[0]!.buildQueue.map((q) => q.tile)).toEqual([tileKey(10, 40), tileKey(10, 30)]);
    expect(rows()[3]!.textContent).toMatch(/Greenhouse/);
    expect(rows()[3]!.querySelector<HTMLButtonElement>(".city-build-up")!.disabled, "the first cannot go higher").toBe(true);
    // Cancel the dome, now second: its cost back.
    rows()[4]!.querySelector<HTMLButtonElement>(".city-build-cancel")!.click();
    frame();
    expect(box.state.settlements.find((s) => s.id === id)!.stores.materials).toBe(before + T.COST_HABITAT_DOME);
    expect(rows().map((x) => x.dataset["kind"])).toEqual(["building", "building", "building", "waiting"]);
  });
});
