/**
 * Batch 29: rovers that use the city. "A path from the garage to the job:
 * over corridors first, then open buildable ground, never under a building,
 * never over hard rock or steep ground ... computed once per job, in the
 * simulation (it sets the trip time Batch 28 uses), and deterministic. No
 * reachable path means the job is refused, with the reason."
 */

import { describe, expect, it } from "vitest";

import { advance } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, fromSave, serialize, toSave } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, Settlement, SettlementJob, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { BUILDING_DEFS, keySet } from "./buildings.js";
import { DOOR_KEPT_CLEAR, NO_ROUTE, ROVER_PASSING, buildingSite, drive, expandRoute, garageDoor, garageLeg, roverRoute, tileSite } from "./drive.js";
import { foundSettlement } from "./registry.js";
import { garage, rocksOf, siteGround } from "./rocks.js";
import { checkPlacement, claimLand, claimableChunks, placeBuilding, placeLink, upgradeBuilding } from "./settlement.js";
import { claimTest, keyTile, tileKey } from "./space.js";

const BASE = { SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, BUILD_TIME_ENABLED: 1, CITY_GRID_TILES: 64 } as const;
/** Flat ground and no rock: every layout here is what the test lays. */
const ON = makeTuning({ ...BASE, ROVER_ROUTES_ENABLED: 1 });
const OFF = makeTuning(BASE);
/** The browser's ground: hills, crags and clusters of hard rock. */
const ROUGH = makeTuning({ ...BASE, ROVER_ROUTES_ENABLED: 1, TERRAIN_RELIEF_M: 12, ROCK_CLUSTER_CHANCE: 0.65, CITY_GRID_TILES: 96 });
const AT = "2026-10-14T12:00:00.000Z";

function city(t: Tuning, materials = 5000, population = 400): SimState {
  const s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population, stores: { ...c.stores, materials } })) };
}
const first = (s: SimState): Settlement => s.settlements[0]!;
const sid = (s: SimState): string => first(s).id;

function place(s: SimState, type: BuildingType, tx: number, ty: number, t: Tuning): SimState {
  const o = placeBuilding(s, sid(s), type, tx, ty, t);
  expect(o.ok, `${type} at ${tx},${ty}: ${o.reason}`).toBe(true);
  return o.state;
}

/** Whether a rover may drive on tile (x, y) of `s` - judged here from the ground, the rocks, the land and the buildings. */
function driveable(s: Settlement, x: number, y: number, t: Tuning): boolean {
  const ground = siteGround(s, t);
  const n = ground.tiles;
  if (x < 0 || y < 0 || x >= n || y >= n || !claimTest(s, t)(x, y)) return false;
  if (ground.steep[y * n + x] === true || rocksOf(s, t)[y * n + x] === "crag") return false;
  return !s.buildings.some((b) => x >= b.tx && y >= b.ty && x < b.tx + BUILDING_DEFS[b.type].footprint && y < b.ty + BUILDING_DEFS[b.type].depth);
}

/**
 * A route's one-way drive, sim-years, worked out from its tiles: the garage
 * to its door, then step by step, a step's length over open ground at
 * ROVER_YEARS_PER_TILE a tile and along a corridor ROVER_CORRIDOR_SPEEDUP
 * times quicker, half of each step on each tile's ground.
 */
function timeAlong(s: Settlement, points: readonly number[], t: Tuning): number {
  const corridors = keySet(s.corridors);
  const pace = (x: number, y: number): number => t.ROVER_YEARS_PER_TILE / (corridors.has(tileKey(x, y)) ? t.ROVER_CORRIDOR_SPEEDUP : 1);
  const g = garage(s)!;
  const door = garageDoor(s)!;
  let years = Math.hypot(door.tx + 0.5 - g.x, door.ty + 0.5 - g.y) * t.ROVER_YEARS_PER_TILE;
  const tiles = points.map((k) => keyTile(k));
  for (let k = 1; k < tiles.length; k += 1) {
    let { tx: x, ty: y } = tiles[k - 1]!;
    const to = tiles[k]!;
    const sx = Math.sign(to.tx - x);
    const sy = Math.sign(to.ty - y);
    while (x !== to.tx || y !== to.ty) {
      const len = Math.hypot(sx, sy);
      years += (len * (pace(x, y) + pace(x + sx, y + sy))) / 2;
      x += sx;
      y += sy;
    }
  }
  return years;
}

/** Whether tile (x, y) touches the site across one of its sides, from outside it. */
function beside(site: { tx: number; ty: number; w: number; h: number }, x: number, y: number): boolean {
  const alongX = x >= site.tx && x < site.tx + site.w;
  const alongY = y >= site.ty && y < site.ty + site.h;
  return (alongX && (y === site.ty - 1 || y === site.ty + site.h)) || (alongY && (x === site.tx - 1 || x === site.tx + site.w));
}

describe("a rover's route", () => {
  it("leaves by the garage door and goes round a building in the way, never under it", () => {
    let s = city(ON);
    const door = garageDoor(first(s))!;
    // A wall of depots across the way south, with the target beyond it (laid without routes: their rovers drive anywhere).
    for (let x = door.tx - 6; x <= door.tx + 6; x += 1) s = place(s, "storage_depot", x, door.ty + 4, OFF);
    const target = tileSite(door.tx, door.ty + 9);
    const route = roverRoute(first(s), target, ON)!;
    expect(route).not.toBeNull();
    const tiles = expandRoute(route.points);
    expect(tiles[0]).toBe(tileKey(door.tx, door.ty));
    for (const k of tiles) {
      const { tx, ty } = keyTile(k);
      expect(driveable(first(s), tx, ty, ON), `tile ${tx},${ty}`).toBe(true);
    }
    const end = keyTile(tiles[tiles.length - 1]!);
    expect(beside(target, end.tx, end.ty)).toBe(true);
    // It went round: further than the straight line through the wall would be.
    expect(tiles.length).toBeGreaterThan(9);
  });

  it("stays on corridors, open ground or beside its own site, over hills and hard rock (every building of a rough city)", () => {
    let s = city(ROUGH, 1e6, 3000);
    const id = sid(s);
    const door = garageDoor(first(s))!;
    // A ring of buildings round the headquarters' front, wherever the ground takes them.
    let placed = 0;
    for (let r = 4; r < 30 && placed < 40; r += 3) {
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [r, r], [-r, r], [r, -r], [-r, -r], [0, -r - 5]] as const) {
        const o = placeBuilding(s, id, "solar_array", door.tx + dx, door.ty + dy, ROUGH);
        if (o.ok) {
          s = o.state;
          placed += 1;
        }
      }
    }
    expect(placed, "vacuity: a city to drive round").toBeGreaterThan(15);
    const c = first(s);
    const n = siteGround(c, ROUGH).tiles;
    const crags = rocksOf(c, ROUGH).filter((r) => r === "crag").length;
    expect(crags, "vacuity: hard rock and cliffs on the ground").toBeGreaterThan(0);
    let checked = 0;
    for (const b of c.buildings) {
      if (b.type === "headquarters") continue;
      const site = buildingSite(b);
      const route = roverRoute(c, site, ROUGH);
      expect(route, `${b.type} at ${b.tx},${b.ty}`).not.toBeNull();
      const tiles = expandRoute(route!.points);
      for (const k of tiles) {
        const { tx, ty } = keyTile(k);
        expect(driveable(c, tx, ty, ROUGH), `the way to the ${b.type} at ${b.tx},${b.ty} crosses ${tx},${ty}`).toBe(true);
      }
      const end = keyTile(tiles[tiles.length - 1]!);
      expect(beside(site, end.tx, end.ty)).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(c.buildings.length - 1);
    void n;
  });

  it("sets the trip: twice its drive at the tuned speeds, and the work", () => {
    let s = city(ON);
    const door = garageDoor(first(s))!;
    // A corridor out of the door and along, so part of the drive is on it.
    for (let y = door.ty; y <= door.ty + 12; y += 1) s = placeLink(s, sid(s), "corridors", door.tx, y, ON).state;
    for (let x = door.tx; x <= door.tx + 14; x += 1) s = placeLink(s, sid(s), "corridors", x, door.ty + 12, ON).state;
    const before = first(s);
    s = place(s, "storage_depot", door.tx + 14, door.ty + 14, ON);
    s = place(s, "regolith_mine", door.tx - 12, door.ty + 3, ON);
    const jobs = first(s).jobs.filter((j): j is Extract<SettlementJob, { kind: "build" }> => j.kind === "build");
    expect(jobs).toHaveLength(2);
    for (const j of jobs) {
      expect(j.route, "a job sent with routes on carries its route").toBeDefined();
      const drive = (j.total - j.work) / 2;
      expect(drive).toBeCloseTo(timeAlong(before, j.route!, ON), 12);
    }
    // The corridor made the first quicker than open ground would: its route's ground, priced as open ground, is longer.
    const open = timeAlong({ ...before, corridors: [] }, jobs[0]!.route!, ON);
    expect((jobs[0]!.total - jobs[0]!.work) / 2).toBeLessThan(open - 1e-9);
  });

  it("takes the corridors first: a way along one, though longer, over the shorter open ground", () => {
    let s = city(ON);
    const door = garageDoor(first(s))!;
    const target = tileSite(door.tx + 16, door.ty + 1);
    const plain = roverRoute(first(s), target, ON)!;
    // A corridor that goes down and round - longer in tiles than the way straight across.
    for (let y = door.ty; y <= door.ty + 4; y += 1) s = placeLink(s, sid(s), "corridors", door.tx, y, ON).state;
    for (let x = door.tx; x <= door.tx + 15; x += 1) s = placeLink(s, sid(s), "corridors", x, door.ty + 4, ON).state;
    for (let y = door.ty + 1; y <= door.ty + 4; y += 1) s = placeLink(s, sid(s), "corridors", door.tx + 15, y, ON).state;
    const roads = roverRoute(first(s), target, ON)!;
    const onCorridor = expandRoute(roads.points).filter((k) => keySet(first(s).corridors).has(k)).length;
    expect(onCorridor).toBeGreaterThan(15);
    expect(expandRoute(roads.points).length).toBeGreaterThan(expandRoute(plain.points).length);
    expect(roads.years).toBeLessThan(plain.years);
  });

  it("is the same every time it is asked, and on a copy of the city", () => {
    const s = city(ROUGH, 1e6, 3000);
    const door = garageDoor(first(s))!;
    const site = tileSite(door.tx + 20, door.ty + 18);
    const a = roverRoute(first(s), site, ROUGH);
    const copy = JSON.parse(JSON.stringify(first(s))) as Settlement;
    expect(roverRoute(copy, site, ROUGH)).toEqual(a);
  });
});

describe("a job no rover can get to", () => {
  /** A city whose headquarters' front is walled off by a ring of depots, built with routes off. */
  function walledIn(): SimState {
    let s = city(OFF);
    const door = garageDoor(first(s))!;
    for (let x = door.tx - 3; x <= door.tx + 3; x += 1) s = place(s, "storage_depot", x, door.ty + 3, OFF);
    for (let y = door.ty; y <= door.ty + 2; y += 1) {
      s = place(s, "storage_depot", door.tx - 3, y, OFF);
      s = place(s, "storage_depot", door.tx + 3, y, OFF);
    }
    const hq = first(s).buildings[0]!;
    // Round the back of the headquarters too, so the pocket in front of the door is closed.
    for (let x = hq.tx - 1; x <= hq.tx + 5; x += 1) s = place(s, "storage_depot", x, hq.ty - 1, OFF);
    for (let y = hq.ty; y < door.ty; y += 1) {
      s = place(s, "storage_depot", hq.tx - 1, y, OFF);
      if (!first(s).buildings.some((b) => b.tx <= hq.tx + 5 && hq.tx + 5 < b.tx + BUILDING_DEFS[b.type].footprint && b.ty <= y && y < b.ty + BUILDING_DEFS[b.type].depth)) s = place(s, "storage_depot", hq.tx + 5, y, OFF);
    }
    // Every rover home, nothing waiting, the stores full again.
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, jobs: [], buildQueue: [], stores: { ...c.stores, materials: 5000 } })) };
    return s;
  }

  it("is refused, with the reason: a building, an upgrade, a rock", () => {
    const s = walledIn();
    const door = garageDoor(first(s))!;
    expect(roverRoute(first(s), tileSite(door.tx, door.ty + 10), ON)).toBeNull();
    const o = placeBuilding(s, sid(s), "solar_array", door.tx + 10, door.ty + 10, ON);
    expect(o.ok).toBe(false);
    expect(o.reason).toContain(NO_ROUTE);
    const depot = first(s).buildings.find((b) => b.type === "storage_depot" && b.tx === door.tx && b.ty === door.ty + 3)!;
    // The depots of the wall: their inner side is reachable, so an upgrade goes; a building outside is not.
    const outer = placeBuilding(walledIn(), sid(s), "storage_depot", door.tx + 20, door.ty, OFF).state;
    const far = first(outer).buildings[first(outer).buildings.length - 1]!;
    const up = upgradeBuilding({ ...outer, settlements: outer.settlements.map((c) => ({ ...c, jobs: [], buildQueue: [] })) }, sid(s), far.tx, far.ty, ON);
    expect(up.ok).toBe(false);
    expect(up.reason).toContain(NO_ROUTE);
    const near = upgradeBuilding(s, sid(s), depot.tx, depot.ty, ON);
    expect(near.ok, `vacuity: one that can be reached is not refused (${near.reason})`).toBe(true);
    // Not vacuous: with routes off the same building is placed - the old straight line goes through anything.
    expect(placeBuilding(s, sid(s), "solar_array", door.tx + 10, door.ty + 10, OFF).ok).toBe(true);
  });

  it("keeps its place in the queue while walled in, and the next goes instead", () => {
    // Two builds waiting; the first walled in after it was queued.
    let s = city(ON, 5000, 400);
    const door = garageDoor(first(s))!;
    const rovers = first(s).jobs.length;
    void rovers;
    // Every rover out, far away.
    for (const [x, y] of [[2, 2], [60, 2], [2, 60]] as const) s = place(s, "storage_depot", x, y, ON);
    s = place(s, "storage_depot", door.tx + 8, door.ty + 8, ON);
    s = place(s, "storage_depot", door.tx - 8, door.ty + 8, ON);
    expect(first(s).buildQueue).toHaveLength(2);
    // Wall the first in, the way the game would not let a player (laid straight into the state).
    const w = door.tx + 8;
    const h = door.ty + 8;
    const wall = [] as { type: BuildingType; tx: number; ty: number; level: number }[];
    for (let x = w - 1; x <= w + 1; x += 1) for (const y of [h - 1, h + 1]) wall.push({ type: "storage_depot", tx: x, ty: y, level: 1 });
    for (const x of [w - 1, w + 1]) wall.push({ type: "storage_depot", tx: x, ty: h, level: 1 });
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: [...c.buildings, ...wall] })) };
    const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
    let sentToSecond = false;
    for (let k = 0; k < 400 && !sentToSecond; k += 1) {
      s = advance(s, 1, cfg);
      sentToSecond = first(s).jobs.some((j) => j.kind === "build" && j.tile === tileKey(door.tx - 8, door.ty + 8));
    }
    expect(sentToSecond, "the second went").toBe(true);
    expect(first(s).buildQueue.map((q) => q.tile)).toEqual([tileKey(w, h)]);
  });
});

describe("keeping the way open", () => {
  it("keeps the garage door and the ground in front of it clear", () => {
    const s = city(ON);
    const door = garageDoor(first(s))!;
    for (const [type, x, y] of [["storage_depot", door.tx, door.ty], ["storage_depot", door.tx, door.ty + 1], ["habitat_dome", door.tx - 1, door.ty]] as const) {
      const o = placeBuilding(s, sid(s), type, x, y, ON);
      expect(o.ok).toBe(false);
      expect(o.reason).toBe(DOOR_KEPT_CLEAR);
    }
    // Beside the apron, free; and with routes off, the door as before.
    expect(placeBuilding(s, sid(s), "storage_depot", door.tx + 1, door.ty, ON).ok).toBe(true);
    expect(placeBuilding(s, sid(s), "storage_depot", door.tx, door.ty, OFF).ok).toBe(true);
  });

  it("keeps a building off the way a rover is driving, until it has passed", () => {
    let s = city(ON);
    const door = garageDoor(first(s))!;
    s = place(s, "storage_depot", door.tx, door.ty + 20, ON);
    const job = first(s).jobs.find((j) => j.kind === "build")!;
    expect(job.kind === "build" && job.route !== undefined).toBe(true);
    const onIt = expandRoute((job as Extract<SettlementJob, { kind: "build" }>).route!).map(keyTile).find((p) => p.ty > door.ty + 5)!;
    const o = placeBuilding(s, sid(s), "storage_depot", onIt.tx, onIt.ty, ON);
    expect(o.reason).toBe(ROVER_PASSING);
    // Home again, the way is free.
    const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
    let w = s;
    for (let k = 0; k < 200 && first(w).jobs.length > 0; k += 1) w = advance(w, 1, cfg);
    expect(first(w).jobs).toHaveLength(0);
    expect(placeBuilding(w, sid(w), "storage_depot", onIt.tx, onIt.ty, ON).ok).toBe(true);
  });

  it("refuses a building that would wall others in, and says how many", () => {
    let s = city(ON, 1e5);
    const door = garageDoor(first(s))!;
    // A pocket: a depot with a U of depots round it, open at one tile.
    const cx = door.tx + 10;
    const cy = door.ty + 10;
    s = place(s, "storage_depot", cx, cy, ON);
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, jobs: [], buildQueue: [] })) };
    for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx + 1, cy - 1], [cx - 1, cy], [cx + 1, cy], [cx - 1, cy + 1], [cx + 1, cy + 1]] as const) {
      s = place(s, "storage_depot", x, y, ON);
      s = { ...s, settlements: s.settlements.map((c) => ({ ...c, jobs: [], buildQueue: [] })) };
    }
    // The last gap: closing it walls in the depot in the middle (the ring's own depots are reached from outside).
    const o = placeBuilding(s, sid(s), "storage_depot", cx, cy + 1, ON);
    expect(o.ok).toBe(false);
    expect(o.reason).toContain("wall in a building");
    // A building that walls nothing in, beside it, is placed; with routes off, the gap too.
    expect(placeBuilding(s, sid(s), "storage_depot", cx + 3, cy + 3, ON).ok).toBe(true);
    expect(placeBuilding(s, sid(s), "storage_depot", cx, cy + 1, OFF).ok).toBe(true);
  });

  it("never lets the scripted player wall in its own garage (every building reachable after a long day)", () => {
    // The city the pacing script grows in an hour, routes on: without the rule above it boxed in its own door
    // after 13 buildings and was refused everything after (measured).
    let s = city(ROUGH, 1e5, 2000);
    const door = garageDoor(first(s))!;
    const n = siteGround(first(s), ROUGH).tiles;
    const order: [number, number][] = [];
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) order.push([x, y]);
    order.sort((a, b) => Math.hypot(a[0] - door.tx, a[1] - door.ty) - Math.hypot(b[0] - door.tx, b[1] - door.ty) || a[1] - b[1] || a[0] - b[0]);
    const types: BuildingType[] = ["habitat_dome", "solar_array", "storage_depot", "greenhouse", "regolith_mine"];
    let placed = 0;
    let walls = 0;
    for (let k = 0; placed < 60 && k < order.length; k += 1) {
      const [x, y] = order[k]!;
      const o = placeBuilding(s, sid(s), types[placed % types.length]!, x, y, ROUGH);
      if (o.ok) {
        s = { ...o.state, settlements: o.state.settlements.map((c) => ({ ...c, jobs: [], buildQueue: [] })) };
        placed += 1;
      } else if (o.reason !== null && o.reason.includes("wall in")) walls += 1;
    }
    expect(placed).toBe(60);
    expect(walls, "vacuity: packing round the door was refused for walling in").toBeGreaterThan(0);
    for (const b of first(s).buildings) {
      if (b.type === "headquarters") continue;
      expect(roverRoute(first(s), buildingSite(b), ROUGH), `${b.type} at ${b.tx},${b.ty}`).not.toBeNull();
    }
  });
});

describe("routes in the world", () => {
  it("are chunk-independent: a substep at a time equals all at once, with rovers routed out of the queue", () => {
    let s = city(ON, 5000, 400);
    const door = garageDoor(first(s))!;
    for (const [x, y] of [[door.tx + 9, door.ty + 2], [door.tx - 9, door.ty + 6], [door.tx + 3, door.ty + 15], [door.tx - 14, door.ty + 14], [door.tx + 16, door.ty - 12]] as const) s = place(s, "storage_depot", x, y, ON);
    expect(first(s).buildQueue.length, "vacuity: some wait for a rover").toBeGreaterThan(0);
    const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
    let stepped = s;
    for (let k = 0; k < 150; k += 1) stepped = advance(stepped, 1, cfg);
    expect(advance(s, 150, cfg)).toEqual(stepped);
  });

  it("survive the save exactly; a v14 save's jobs load with their times and no route", () => {
    // Stores and people the city has room for, so a save keeps them as they are.
    let s = city(ON, 300, 0);
    const door = garageDoor(first(s))!;
    s = place(s, "storage_depot", door.tx + 9, door.ty + 9, ON);
    expect(deserialize(serialize(s, ON, AT), ON)).toEqual(s);
    const v15 = toSave(s, ON, AT) as unknown as Record<string, unknown>;
    const old = {
      ...v15,
      schema_version: 14,
      settlements: (v15["settlements"] as Record<string, unknown>[]).map((c) => ({ ...c, jobs: (c["jobs"] as Record<string, unknown>[]).map(({ route: _r, ...rest }) => rest) })),
    };
    const loaded = fromSave(old, ON);
    const jobs = first(loaded).jobs;
    expect(jobs.map((j) => [j.total, j.remaining])).toEqual(first(s).jobs.map((j) => [j.total, j.remaining]));
    expect(jobs.every((j) => j.kind === "rocket" || j.route === undefined)).toBe(true);
    // A route that jumps is not one the game makes.
    const bad = { ...v15, settlements: (v15["settlements"] as Record<string, unknown>[]).map((c) => ({ ...c, jobs: (c["jobs"] as Record<string, unknown>[]).map((j) => ({ ...j, route: [tileKey(1, 1), tileKey(4, 2)] })) })) };
    expect(() => fromSave(bad, ON)).toThrow(/straight run/);
  });

  it("move with the land when a claim moves the frame", () => {
    let s = city(makeTuning({ ...BASE, ROVER_ROUTES_ENABLED: 1, CITY_GRID_TILES: 64, CLAIM_FIRST_POPULATION: 0 }), 5000, 5000);
    const t = makeTuning({ ...BASE, ROVER_ROUTES_ENABLED: 1, CITY_GRID_TILES: 64, CLAIM_FIRST_POPULATION: 0 });
    const door = garageDoor(first(s))!;
    s = place(s, "storage_depot", door.tx + 9, door.ty + 9, t);
    const before = first(s).jobs.find((j) => j.kind === "build")! as Extract<SettlementJob, { kind: "build" }>;
    const west = claimableChunks(first(s), t).find((c) => c.i < 0);
    expect(west, "vacuity: land to the west to claim").toBeDefined();
    const o = claimLand(s, sid(s), west!.i, west!.j, t);
    expect(o.ok, o.reason ?? "").toBe(true);
    const after = first(o.state).jobs.find((j) => j.kind === "build")! as Extract<SettlementJob, { kind: "build" }>;
    const shift = keyTile(after.tile).tx - keyTile(before.tile).tx;
    expect(shift).toBeGreaterThan(0);
    expect(after.route!.map((k) => keyTile(k))).toEqual(before.route!.map((k) => ({ tx: keyTile(k).tx + shift, ty: keyTile(k).ty })));
  });
});

describe("the placement preview (checkPlacement)", () => {
  it("says what placing would, without searching out the route - over a rough city, tile by tile", () => {
    let s = city(ROUGH, 1e6, 3000);
    const door = garageDoor(first(s))!;
    // Some buildings to go round, and to wall in.
    for (const [x, y] of [[door.tx + 4, door.ty + 2], [door.tx - 6, door.ty + 3], [door.tx + 1, door.ty + 9], [door.tx - 2, door.ty - 12]] as const) {
      const o = placeBuilding(s, sid(s), "habitat_dome", x, y, ROUGH);
      if (o.ok) s = { ...o.state, settlements: o.state.settlements.map((c) => ({ ...c, jobs: [], buildQueue: [] })) };
    }
    let compared = 0;
    let refused = 0;
    for (let y = door.ty - 20; y <= door.ty + 20; y += 3) {
      for (let x = door.tx - 20; x <= door.tx + 20; x += 3) {
        for (const type of ["storage_depot", "habitat_dome"] as const) {
          const real = placeBuilding(s, sid(s), type, x, y, ROUGH);
          const dry = checkPlacement(s, sid(s), type, x, y, ROUGH);
          expect([dry.ok, dry.reason], `${type} at ${x},${y}`).toEqual([real.ok, real.reason]);
          expect(dry.state).toBe(s);
          compared += 1;
          if (!real.ok) refused += 1;
        }
      }
    }
    expect(refused, "vacuity: some refused").toBeGreaterThan(10);
    expect(compared - refused, "and some placed").toBeGreaterThan(10);
    // And where no rover can get to, the same refusal.
    const walled = { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: [...c.buildings, ...[[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].map(([dx, dy]) => ({ type: "storage_depot" as BuildingType, tx: door.tx + 30 + dx!, ty: door.ty + dy!, level: 1 }))] })) };
    const real = placeBuilding(walled, sid(s), "storage_depot", door.tx + 30, door.ty, ROUGH);
    expect(real.reason).toContain(NO_ROUTE);
    expect(checkPlacement(walled, sid(s), "storage_depot", door.tx + 30, door.ty, ROUGH).reason).toBe(real.reason);
  });
});

describe("a world made before routes (ROVER_ROUTES_ENABLED 0)", () => {
  it("times every trip as it always did, the straight line, and keeps no route", () => {
    let s = city(OFF);
    const g = garage(first(s))!;
    s = place(s, "storage_depot", 50, 12, OFF);
    const job = first(s).jobs[0]! as Extract<SettlementJob, { kind: "build" }>;
    // Batch 28's formula, to the bit.
    const distance = Math.hypot(50 + 0.5 - g.x, 12 + 0.5 - g.y);
    expect(job.total).toBe(2 * distance * OFF.ROVER_YEARS_PER_TILE + job.work);
    expect(job.route).toBeUndefined();
    expect(drive(first(s), tileSite(3, 3), OFF)).toEqual({ years: Math.hypot(3.5 - g.x, 3.5 - g.y) * OFF.ROVER_YEARS_PER_TILE });
    expect(garageLeg(first(s))).toBe(3);
  });
});
