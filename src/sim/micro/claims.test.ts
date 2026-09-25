/**
 * Claiming land (at the user's request):
 *
 *   "make the initial boundaries at least 3x bigger ... after a city reaches
 *    200 habitats, I can claim new terrain, then at 300, I can claim new one,
 *    etc, indefinitely, the more I expand, the more terrain it generates in
 *    that direction."
 *
 * "Habitats" read as inhabitants: 200 habitat domes would house 8,000.
 */

import { describe, expect, it } from "vitest";

import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { SaveError, deserialize, fromSave, serialize, toSave } from "../save.js";
import { makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { Settlement, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { foundSettlement } from "./registry.js";
import { rocksOf } from "./rocks.js";
import { claimLand, headquartersOrigin, placeBuilding, placeLink, sendRover } from "./settlement.js";
import { chunkKey, claimTest, frameOf, keyTile } from "./space.js";
import { linksToConnect } from "./network.js";
import { groundOf, worldOf } from "./terrain.js";
import { cityView } from "./view.js";
import { habitat } from "../habitat.js";
import { derive } from "../derive.js";

/** The browser's world: a 96-tile founding square, hills, the headquarters. */
const BIG = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 96, OUTPOST_GRID_TILES: 48, METROPOLIS_GRID_TILES: 288, ROCK_CLUSTER_CHANCE: 0.65 });
const PLACE = { lat: 0.31, lon: -1.2 };

function city(t: Tuning = BIG, people = 0): SimState {
  const s = foundSettlement(marsStart(undefined, t), "city", PLACE.lat, PLACE.lon, t).state;
  return people === 0 ? s : withPeople(s, people);
}
const withPeople = (s: SimState, people: number): SimState => ({ ...s, settlements: s.settlements.map((c) => ({ ...c, population: people, stores: { ...c.stores, materials: 5000 } })) });
const first = (s: SimState): Settlement => s.settlements[0]!;
const id = (s: SimState): string => first(s).id;

/** Claim, and insist it was allowed. */
function claim(s: SimState, i: number, j: number, t: Tuning = BIG): SimState {
  const o = claimLand(s, id(s), i, j, t);
  expect(o.ok, `claim ${i},${j}: ${o.reason}`).toBe(true);
  return o.state;
}

describe("the founding square", () => {
  it("is 96 tiles for a city in the browser's tuning - three times the 32 it was - with the headquarters at its centre", () => {
    const s = first(city());
    expect(s.base).toBe(96);
    expect(frameOf(s, BIG)).toEqual({ base: 96, x0: 0, y0: 0, n: 96 });
    expect(s.buildings[0]).toMatchObject({ type: "headquarters", ...headquartersOrigin(96) });
    expect(headquartersOrigin(96)).toEqual({ tx: 46, ty: 46 });
  });
});

describe("claiming land", () => {
  it("opens at 200 people, and one more claim with every 100 after - indefinitely", () => {
    // Three chunks in a row east of the founding square: chunk (3, 0), (4, 0), (5, 0).
    let s = city(BIG, 199);
    expect(claimLand(s, id(s), 3, 0, BIG).reason).toMatch(/needs 200 people - the city has 199/);
    s = claim(withPeople(s, 200), 3, 0);
    expect(claimLand(s, id(s), 4, 0, BIG).reason).toMatch(/needs 300 people/);
    s = claim(withPeople(s, 300), 4, 0);
    expect(claimLand(withPeople(s, 399), id(s), 5, 0, BIG).ok).toBe(false);
    s = claim(withPeople(s, 400), 5, 0);
    // Far past any number a test would think of: 2,000 people, 19 claims.
    let big = withPeople(city(), 2000);
    for (let k = 0; k < 19; k += 1) big = claim(big, 3 + k, 1);
    expect(claimLand(big, id(big), 22, 1, BIG).reason).toMatch(/needs 2100 people/);
    expect(first(big).claims).toHaveLength(19);
  });

  it("takes only land beside the city's own, and only once", () => {
    const s = city(BIG, 1000);
    expect(claimLand(s, id(s), 5, 0, BIG).reason).toMatch(/not beside/);
    expect(claimLand(s, id(s), 1, 1, BIG).reason, "inside the founding square").toMatch(/not beside/);
    expect(claimLand(s, id(s), 3, 3, BIG).reason, "corner to corner is not beside").toMatch(/not beside/);
    const once = claim(s, 3, 1);
    expect(claimLand(once, id(once), 3, 1, BIG).reason).toMatch(/already/);
    // Beside a claim is beside the city's land.
    expect(claimLand(once, id(once), 3, 2, BIG).ok).toBe(true);
    expect(claimLand(s, id(s), 1.5, 0, BIG).ok).toBe(false);
  });

  it("is a city's: an outpost cannot claim", () => {
    let s = foundSettlement(marsStart(undefined, BIG), "outpost", PLACE.lat, PLACE.lon, BIG).state;
    s = withPeople(s, 1000);
    expect(claimLand(s, id(s), 2, 0, BIG).reason).toMatch(/outpost cannot claim/);
  });

  it("lets the city build on the new land, and on nothing it has not claimed", () => {
    const s = city(BIG, 250);
    // Chunk (3, 1): tiles 96..127 east, 32..63 south.
    expect(placeBuilding(s, id(s), "solar_array", 100, 40, BIG).reason).toMatch(/runs off the grid/);
    const owned = claim(s, 3, 1);
    const flat = findFlat(owned, 96, 32, 32);
    expect(placeBuilding(owned, id(owned), "solar_array", flat.tx, flat.ty, BIG).ok).toBe(true);
    // The frame is square, 128 a side: tile (100, 10) is in it but not claimed.
    expect(frameOf(first(owned), BIG).n).toBe(128);
    const padding = findFlat(owned, 96, 0, 32);
    expect(placeBuilding(owned, id(owned), "solar_array", padding.tx, padding.ty, BIG).reason).toMatch(/runs off the grid/);
    expect(placeLink(owned, id(owned), "corridors", padding.tx, padding.ty, BIG).reason).toMatch(/must be on the grid/);
    const rock = rocksOf(first(owned), BIG).findIndex((r, i) => r !== "none" && i % 128 >= 96 && Math.floor(i / 128) < 32);
    expect(rock, "a rock on the unclaimed padding, to test the rover against").toBeGreaterThan(0);
    expect(sendRover(owned, id(owned), rock % 128, Math.floor(rock / 128), BIG).reason).toMatch(/off the grid/);
  });
});

/** A buildable 2 x 2 spot inside a square of the frame. */
function findFlat(s: SimState, x0: number, y0: number, size: number): { tx: number; ty: number } {
  const st = first(s);
  const g = groundOf(st, BIG);
  const rocks = rocksOf(st, BIG);
  for (let ty = y0; ty < y0 + size - 1; ty += 1) {
    for (let tx = x0; tx < x0 + size - 1; tx += 1) {
      const ok = [0, 1].every((dy) => [0, 1].every((dx) => !g.steep[(ty + dy) * g.tiles + tx + dx] && rocks[(ty + dy) * g.tiles + tx + dx] === "none"));
      if (ok) return { tx, ty };
    }
  }
  throw new Error("no flat spot");
}

describe("connecting", () => {
  it("lays corridors and cables only across the land the city holds, round the unclaimed corner of the frame", () => {
    // Claim the chunk north-east (x 96..127, y 0..31): the frame is 128 square,
    // and x 96..127, y 32..95 is unclaimed - the short way between a building
    // low in the square's east and one in the claim.
    // Flat ground: what is tested is the land, not the hills.
    const FLAT = { ...BIG, TERRAIN_RELIEF_M: 0 };
    let s = claim(city(FLAT, 250), 3, 0, FLAT);
    s = placeBuilding(s, id(s), "solar_array", 100, 26, FLAT).state;
    const placed = placeBuilding(s, id(s), "regolith_mine", 88, 80, FLAT);
    expect(placed.ok, placed.reason ?? "").toBe(true);
    const tiles = linksToConnect(first(placed.state), "cables", FLAT);
    expect(tiles.length, "vacuity: there is a cable to lay").toBeGreaterThan(20);
    const ours = claimTest(first(placed.state), FLAT);
    const outside = tiles.map(keyTile).filter(({ tx, ty }) => !ours(tx, ty));
    expect(outside).toEqual([]);
  });
});

describe("the ground stays put", () => {
  it("a claim west or north moves the frame's corner, and everything built moves with it - onto the same ground", () => {
    let s = city(BIG, 500);
    s = claim(s, 3, 1);
    const flat = findFlat(s, 96, 32, 32);
    s = placeBuilding(s, id(s), "solar_array", flat.tx, flat.ty, BIG).state;
    s = placeLink(s, id(s), "cables", flat.tx - 1, flat.ty, BIG).state;
    const before = first(s);
    const heightUnder = (st: Settlement, b: { tx: number; ty: number }): number => {
      const g = groundOf(st, BIG);
      return g.heightM[b.ty * g.tiles + b.tx]!;
    };
    const was = before.buildings.map((b) => heightUnder(before, b));
    // West of the founding square, then north of it.
    s = claim(s, -1, 1);
    s = claim(s, 1, -1);
    const after = first(s);
    expect(frameOf(after, BIG)).toMatchObject({ x0: -32, y0: -32 });
    expect(after.buildings.map((b) => [b.tx, b.ty])).toEqual(before.buildings.map((b) => [b.tx + 32, b.ty + 32]));
    // The height under every building is what it was: the ground did not move under them.
    expect(after.buildings.map((b) => heightUnder(after, b))).toEqual(was);
    expect(was.some((h) => h !== 0), "vacuity: some building stands off the flat landing zone").toBe(true);
    // The world round it too: the same ground, 32 tiles further along its arrays.
    const w0 = worldOf(before, BIG);
    const w1 = worldOf(after, BIG);
    for (const [x, y] of [[0, 0], [30, 70], [100, 20], [w0.size, w0.size]] as const) {
      expect(w1.cornersM[(y + 32) * (w1.size + 1) + x + 32], `world ${x},${y}`).toBe(w0.cornersM[y * (w0.size + 1) + x]);
    }
    // Corridors and cables moved with them.
    expect(after.cables).toEqual(before.cables.map((k) => k + 32 * 1024 + 32));
    // And every tile of the old frame kept its rock.
    const oldRocks = rocksOf(before, BIG);
    const newRocks = rocksOf(after, BIG);
    const n0 = frameOf(before, BIG).n;
    const n1 = frameOf(after, BIG).n;
    let rocky = 0;
    for (let ty = 0; ty < n0; ty += 1) {
      for (let tx = 0; tx < n0; tx += 1) {
        expect(newRocks[(ty + 32) * n1 + tx + 32], `${tx},${ty}`).toBe(oldRocks[ty * n0 + tx]);
        if (oldRocks[ty * n0 + tx] !== "none") rocky += 1;
      }
    }
    expect(rocky, "vacuity: rocks to keep").toBeGreaterThan(50);
  });

  it("the world reaches further in every direction the city grows", () => {
    // The user: "the more I expand, the more terrain it generates in that direction".
    let s = city(BIG, 1500);
    const world0 = worldOf(first(s), BIG);
    for (let k = 0; k < 6; k += 1) s = claim(s, 3 + k, 1);
    const f = frameOf(first(s), BIG);
    const world1 = worldOf(first(s), BIG);
    // Six chunks east: the frame and its world are 192 tiles wider.
    expect(f).toMatchObject({ x0: 0, y0: 0, n: 96 + 192 });
    expect(world1.size - world0.size).toBe(192);
    // And it is the same world: where the two overlap, the same ground.
    const m0 = world0.size + 1;
    const m1 = world1.size + 1;
    for (const [x, y] of [[0, 0], [50, 70], [world0.size, 3], [120, 120]] as const) {
      expect(world1.cornersM[y * m1 + x], `${x},${y}`).toBe(world0.cornersM[y * m0 + x]);
    }
  });
});

describe("the view", () => {
  it("shows the land held, and the land on offer", () => {
    const s = claim(city(BIG, 320), 3, 1);
    const v = cityView(first(s), habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, BIG), BIG), BIG, 0), BIG);
    expect(v.tiles).toBe(128);
    expect(v.claimed.filter(Boolean).length).toBe(96 * 96 + 32 * 32);
    expect(v.claims).toMatchObject({ chunk: 32, held: 1, allowed: 2, nextAt: 300 });
    // The chunks beside the land: twelve round the 3 x 3 square, less the one
    // claimed, plus the one beyond it (its other sides were beside the square already).
    expect(v.claims.open).toHaveLength(12 - 1 + 1);
    expect(v.claims.open).toContainEqual({ i: -1, j: 0, tx: -32, ty: 0 });
    expect(v.claims.open).toContainEqual({ i: 4, j: 1, tx: 128, ty: 32 });
    // After a claim west, the frame's corner is 32 tiles west: the offers are counted from it.
    const west = claim(s, -1, 0);
    const vw = cityView(first(west), habitat(west.reservoirs, derive(west.reservoirs, worldEnv(west, NEUTRAL_ENV, BIG), BIG), BIG, 0), BIG);
    expect(vw.origin).toEqual({ x: -32, y: 0 });
    expect(vw.claims.open).toContainEqual({ i: -2, j: 0, tx: -32, ty: 0 });
    expect(vw.claims.open).toContainEqual({ i: 4, j: 1, tx: 160, ty: 32 });
  });
});

describe("the save", () => {
  it("round-trips claimed land exactly, and play carries on the same", () => {
    let s = claim(city(BIG, 400), -1, 0);
    s = claim(s, 3, 2);
    // No more people and materials than the city has room for (a load clamps the rest): the claims stay.
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 0, stores: { ...c.stores, materials: 100 } })) };
    const back = deserialize(serialize(s, BIG, "2026-09-25T00:00:00.000Z"), BIG);
    expect(back).toEqual(s);
    const cfg = { tuning: BIG, env: NEUTRAL_ENV, forcing: null };
    expect(advance(back, 40, cfg)).toEqual(advance(s, 40, cfg));
  });

  it("rejects a claim the save cannot mean", () => {
    const save = toSave(claim(city(BIG, 300), 3, 0), BIG, "2026-09-25T00:00:00.000Z") as unknown as { settlements: Record<string, unknown>[] };
    const twice = { ...save, settlements: [{ ...save.settlements[0], claims: [chunkKey(3, 0), chunkKey(3, 0)] }] };
    expect(() => fromSave(twice, BIG)).toThrow(SaveError);
    const half = { ...save, settlements: [{ ...save.settlements[0], claims: [0.5] }] };
    expect(() => fromSave(half, BIG)).toThrow(/chunk key/);
    const noBase = { ...save, settlements: [{ ...save.settlements[0], base: 0 }] };
    expect(() => fromSave(noBase, BIG)).toThrow(/base/);
  });

  it("brings a city founded on 32 tiles into the 96-tile square, centred, everything on the ground it stood on", () => {
    // A v8 save, as the browser wrote them before: a 32-tile city.
    const SMALL = { ...BIG, CITY_GRID_TILES: 32 };
    const old = city(SMALL, 50);
    const v8 = toSave(old, SMALL, "2026-09-25T00:00:00.000Z") as unknown as Record<string, unknown> & { settlements: Record<string, unknown>[] };
    const { base: _b, claims: _c, ...rest } = v8.settlements[0]!;
    const loaded = first(fromSave({ ...v8, schema_version: 8, settlements: [rest] }, BIG));
    expect(loaded.base).toBe(96);
    expect(loaded.buildings.map((b) => [b.type, b.tx, b.ty])).toEqual(first(old).buildings.map((b) => [b.type, b.tx + 32, b.ty + 32]));
    // The headquarters is still at the centre of the (new) square.
    expect(loaded.buildings[0]).toMatchObject({ type: "headquarters", ...headquartersOrigin(96) });
    // Under a build that keeps 32, it stays as it was.
    const same = first(fromSave({ ...v8, schema_version: 8, settlements: [rest] }, SMALL));
    expect(same.base).toBe(32);
    expect(same.buildings).toEqual(first(old).buildings);
  });

  it("never shrinks a city a retune made smaller", () => {
    const save = toSave(city(BIG, 0), BIG, "2026-09-25T00:00:00.000Z");
    const SMALL = { ...BIG, CITY_GRID_TILES: 32 };
    const loaded = first(fromSave(save, SMALL));
    expect(loaded.base).toBe(96);
    expect(frameOf(loaded, SMALL).n).toBe(96);
  });
});

describe("the view of claimed land", () => {
  it("follows a claim that fills a gap inside the frame - the frame unchanged, the land the city holds not", () => {
    // The column east of the founding square and a chunk south of it, then the chunk beside that one: the last
    // claim moves no edge of the frame, so everything the view keeps per frame stays - but the land the city holds does not.
    let s = claim(claim(claim(claim(city(BIG, 1e6), 3, 0), 3, 1), 3, 2), 0, 3);
    const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, BIG), BIG), BIG, 0);
    const corner = (st: SimState): boolean => {
      const v = cityView(first(st), env, BIG);
      const f = frameOf(first(st), BIG);
      return v.claimed[(3 * 32 - f.y0 + 5) * v.tiles + (1 * 32 - f.x0 + 5)]!;
    };
    const before = frameOf(first(s), BIG);
    expect(corner(s), "vacuity: the corner is not the city's yet").toBe(false);
    s = claim(s, 1, 3);
    expect(frameOf(first(s), BIG)).toEqual(before);
    expect(corner(s)).toBe(true);
  });
});
