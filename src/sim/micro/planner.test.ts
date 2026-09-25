/**
 * The city planner, in the simulation (at the user's request): "when creating
 * a city, I can name it; I can assign zones and colour zones, assign robots
 * to flatten out an entire zone without me manually clicking each; I can draw
 * roads and power lines, and they get built; I need to see population charts,
 * blackouts, food shortages, population growth and deaths."
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { siteGround } from "./rocks.js";
import { deleteZone, editZone, housing, levelGround, levelZone, placeBuilding, planLinks, renameSettlement, settlementStep } from "./settlement.js";
import { tileKey } from "./space.js";

const HILLS = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 96 });
const FLAT = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, CITY_GRID_TILES: 64 });
const cfg = (t: Tuning) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });

function city(t: Tuning, materials = 1000, name = ""): SimState {
  const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t, name).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials } })) };
}
const first = (s: SimState): Settlement => s.settlements[0]!;
const id = (s: SimState): string => first(s).id;
const square = (x0: number, y0: number, w: number, h: number): number[] => {
  const out: number[] = [];
  for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) out.push(tileKey(x, y));
  return out;
};
const place = (s: SimState, type: BuildingType, x: number, y: number, t: Tuning): SimState => {
  const o = placeBuilding(s, id(s), type, x, y, t);
  expect(o.ok, `${type} at ${x},${y}: ${o.reason}`).toBe(true);
  return o.state;
};

describe("names", () => {
  it("are given at founding, changed later, and saved", () => {
    let s = city(FLAT, 100, "  New   Olympus ");
    expect(first(s).name).toBe("New Olympus");
    s = renameSettlement(s, id(s), "Ares Prime").state;
    expect(first(s).name).toBe("Ares Prime");
    expect(renameSettlement(s, id(s), "x".repeat(41)).reason).toMatch(/at most 40/);
    expect(first(deserialize(serialize(s, FLAT, "2026-09-25T00:00:00.000Z"), FLAT)).name).toBe("Ares Prime");
  });
});

describe("zones", () => {
  it("are drawn, coloured, renamed and deleted - and a tile belongs to one zone at most", () => {
    let s = city(FLAT);
    const a = editZone(s, id(s), { name: "Homes", colour: "#3366FF", add: square(2, 2, 4, 4) }, FLAT);
    expect(a.ok).toBe(true);
    s = a.state;
    const b = editZone(s, id(s), { name: "Works", add: square(4, 4, 4, 4) }, FLAT);
    s = b.state;
    const [homes, works] = first(s).zones;
    expect(homes).toMatchObject({ name: "Homes", colour: "#3366ff" });
    // The overlap went to the zone drawn last.
    expect(homes!.tiles).toHaveLength(16 - 4);
    expect(works!.tiles).toHaveLength(16);
    s = editZone(s, id(s), { id: a.zone!, name: "Old town", colour: "#00ff00", remove: square(2, 2, 1, 4) }, FLAT).state;
    expect(first(s).zones[0]).toMatchObject({ name: "Old town", colour: "#00ff00" });
    expect(first(s).zones[0]!.tiles).toHaveLength(12 - 4);
    expect(editZone(s, id(s), { colour: "blue" }, FLAT).reason).toMatch(/not a colour/);
    s = deleteZone(s, id(s), b.zone!).state;
    expect(first(s).zones.map((z) => z.name)).toEqual(["Old town"]);
  });
});

describe("levelling a whole zone", () => {
  it("queues its tiles, and rovers go out to them one after another, until the zone is level", () => {
    let s = city(HILLS, 1000);
    // A zone on the slopes beside the landing zone.
    const tiles = square(34, 50, 6, 3);
    const cornersOf = (st: SimState, k: number): number[] => {
      const g = siteGround(first(st), HILLS);
      const m = g.tiles + 1;
      const x = k % 1024;
      const y = Math.floor(k / 1024);
      return [g.cornersM[y * m + x]!, g.cornersM[y * m + x + 1]!, g.cornersM[(y + 1) * m + x]!, g.cornersM[(y + 1) * m + x + 1]!];
    };
    const spread = (st: SimState, k: number): number => Math.max(...cornersOf(st, k)) - Math.min(...cornersOf(st, k));
    // Two tiles of it levelled first, by hand, side by side: flat, each the
    // other's "nearby level" - but not the zone's plane.
    const byHand = [tileKey(39, 52), tileKey(38, 52)];
    for (const k of byHand) {
      const hand = levelGround(s, id(s), k % 1024, Math.floor(k / 1024), HILLS);
      expect(hand.ok, hand.reason ?? "").toBe(true);
      s = hand.state;
      for (let j = 0; j < 40 && first(s).jobs.length > 0; j += 1) s = advance(s, 1, cfg(HILLS));
      expect(spread(s, k), "vacuity: the hand-levelled tile is flat").toBeLessThan(0.01);
    }
    s = editZone(s, id(s), { name: "Terrace", add: tiles }, HILLS).state;
    const sloping = tiles.filter((k) => spread(s, k) >= 0.01);
    expect(sloping.length, "vacuity: the zone slopes").toBeGreaterThan(8);
    const o = levelZone(s, id(s), first(s).zones[0]!.id, HILLS);
    // Every sloping tile, and the flat ones off the zone's plane.
    for (const k of byHand) expect(sloping).not.toContain(k);
    expect(o.queued).toBe(sloping.length + byHand.length);
    expect(first(o.state).levelQueue.map((q) => q.tile)).toEqual(expect.arrayContaining(byHand));
    s = o.state;
    // One substep: as many rovers out as there are, the rest waiting.
    s = advance(s, 1, cfg(HILLS));
    expect(first(s).jobs.filter((j) => j.kind === "rover")).toHaveLength(HILLS.ROVERS_PER_HQ);
    expect(first(s).levelQueue.length).toBe(sloping.length + byHand.length - HILLS.ROVERS_PER_HQ);
    // In time, every tile of it level, no one clicking.
    for (let k = 0; k < 200 && (first(s).levelQueue.length > 0 || first(s).jobs.length > 0); k += 1) s = advance(s, 4, cfg(HILLS));
    expect(first(s).levelQueue).toEqual([]);
    for (const k of tiles) expect(spread(s, k), `tile ${k % 1024},${Math.floor(k / 1024)}`).toBeLessThan(0.01);
    // And one plane, not a stair of flat tiles: the zone's highest corner within a centimetre of its lowest.
    const all = tiles.flatMap((k) => cornersOf(s, k));
    expect(Math.max(...all) - Math.min(...all)).toBeLessThan(0.01);
  });
});

describe("drawn corridors, cables and rails", () => {
  it("are built in the order drawn, as materials allow, by crews of so many tiles a year", () => {
    // Materials for 80 tiles (more than one substep's crews lay); 100 drawn.
    let s = city(FLAT, 80);
    const line = square(4, 20, 50, 1);
    const cable = square(4, 22, 50, 1);
    const o = planLinks(s, id(s), "corridors", line, FLAT);
    expect(o.planned).toBe(50);
    s = planLinks(o.state, id(s), "cables", cable, FLAT).state;
    expect(first(s).planned).toHaveLength(100);
    // A quarter-year substep: crews lay LINK_BUILD_PER_YEAR / 4.
    s = advance(s, 1, cfg(FLAT));
    const perStep = Math.floor(FLAT.LINK_BUILD_PER_YEAR * FLAT.SUBSTEP_YEARS);
    const built1 = first(s).corridors.length + first(s).cables.length;
    expect(perStep, "vacuity: the crews, not the materials, bound the first substep").toBeLessThan(80);
    expect(built1).toBe(perStep);
    // Then materials run out: the rest waits, in order - the corridor first, as it was drawn first.
    for (let k = 0; k < 10; k += 1) s = advance(s, 1, cfg(FLAT));
    expect(first(s).corridors).toEqual(line);
    expect(first(s).cables.length).toBeLessThan(50);
    expect(first(s).planned.length).toBeGreaterThan(0);
    // Materials come; the plan is finished.
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 500 } })) };
    s = advance(s, 4, cfg(FLAT));
    expect(first(s).cables).toEqual(cable);
    expect(first(s).planned).toEqual([]);
  });

  it("leaves out what cannot be laid, and drops a planned tile a building then stands on", () => {
    let s = city(FLAT, 0);
    // Under the headquarters: nothing planned there.
    expect(planLinks(s, id(s), "corridors", square(33, 33, 1, 1), FLAT).planned).toBe(0);
    s = planLinks(s, id(s), "corridors", square(10, 10, 5, 1), FLAT).state;
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 200 } })) };
    s = place(s, "storage_depot", 12, 10, FLAT);
    s = advance(s, 1, cfg(FLAT));
    expect(first(s).corridors).toEqual(square(10, 10, 5, 1).filter((k) => k !== tileKey(12, 10)));
    expect(first(s).planned).toEqual([]);
  });
});

describe("the record", () => {
  const envOf = (s: SimState, t: Tuning) => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, t), t), t, 0);

  /** A small city that grows: homes, food, water and power. */
  function growing(t: Tuning): SimState {
    let s = city(t, 2000);
    for (let k = 0; k < 4; k += 1) s = place(s, "habitat_dome", 4 + 4 * k, 4, t);
    for (let k = 0; k < 3; k += 1) s = place(s, "greenhouse", 4 + 3 * k, 10, t);
    for (let k = 0; k < 3; k += 1) s = place(s, "geothermal_plant", 4 + 3 * k, 14, t);
    s = place(s, "water_extractor", 16, 14, t);
    return s;
  }

  it("samples the city once a year: people, homes, births and deaths that add up", () => {
    let s = growing(FLAT);
    s = advance(s, 4 * 12, cfg(FLAT));
    const h = first(s).history;
    expect(h.taken).toBe(12);
    expect(h.samples).toHaveLength(12);
    expect(h.samples.map((x) => x.index)).toEqual([...Array(12).keys()]);
    const last = h.samples[h.samples.length - 1]!;
    expect(last.population).toBe(first(s).population);
    expect(last.housing).toBe(housing(first(s), FLAT));
    // Each year's change in people is what was born less what was lost (the first settlers arrive, not born).
    for (let k = 2; k < h.samples.length; k += 1) {
      const a = h.samples[k - 1]!;
      const b = h.samples[k]!;
      expect(b.population - a.population, `year ${k}`).toBeCloseTo(b.births - b.deaths, 6);
    }
    expect(h.samples.some((x) => x.births > 0), "vacuity: people are born").toBe(true);
  });

  it("marks a blackout: power short throughout the year its plants went dark", () => {
    let s = growing(FLAT);
    s = advance(s, 8, cfg(FLAT));
    expect(first(s).history.samples.every((x) => x.short[0] === 0), "vacuity: no blackout before").toBe(true);
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type !== "geothermal_plant"), stores: { ...c.stores, power: 0 } })) };
    s = advance(s, 4, cfg(FLAT));
    const year = first(s).history.samples.at(-1)!;
    expect(year.short[0]).toBe(1);
    expect(year.deaths).toBeGreaterThan(0);
    expect(settlementStep(first(s), envOf(s, FLAT), FLAT, FLAT.SUBSTEP_YEARS).shortages).toContain("power");
  });

  it("keeps the latest HISTORY_SAMPLES, and is the same however time is chunked, and through the save", () => {
    const SHORT = { ...FLAT, HISTORY_SAMPLES: 5 };
    let s = growing(SHORT);
    const whole = advance(s, 4 * 9 + 2, cfg(SHORT));
    for (let k = 0; k < 4 * 9 + 2; k += 1) s = advance(s, 1, cfg(SHORT));
    expect(s).toEqual(whole);
    expect(first(s).history.samples.map((x) => x.index)).toEqual([4, 5, 6, 7, 8]);
    expect(first(s).history.acc.substeps).toBe(2);
    expect(deserialize(serialize(s, SHORT, "2026-09-25T00:00:00.000Z"), SHORT)).toEqual(s);
  });
});
