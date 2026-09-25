/**
 * Batch 20's exit gate, first half: "Placement rules proven by tests that try
 * every rejection case and at least one acceptance."
 *
 * Micro §3.3: "Placement validity: footprint fits, all tiles buildable and
 * empty, and (section 6) any connectivity requirement met." Plus the
 * settlement's own rules: the building must exist, suit the kind of
 * settlement, and be paid for.
 *
 * Connectivity is the one §3.3 clause with no case here: section 6's basic
 * version puts every building on the network, so nothing can fail it yet.
 */

import { describe, expect, it } from "vitest";

import { marsStart } from "../planets/mars.js";
import { makeTuning } from "../tuning.js";
import type { BuildingType, SimState } from "../types.js";
import { foundSettlement } from "./registry.js";
import { placeBuilding } from "./settlement.js";
import { groundOf, isSteep } from "./terrain.js";

const t = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const SITE = { lat: 0.31, lon: -1.2 };

function world(materials = 1000): SimState {
  let s = foundSettlement(marsStart(), "city", SITE.lat, SITE.lon, t).state;
  s = foundSettlement(s, "outpost", -0.4, 2.2, t).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials } })) };
}

/** A tile too steep to build on at this site, found rather than assumed. */
function aSteepTile(): { tx: number; ty: number } {
  const g = groundOf({ kind: "city", ...SITE }, t);
  for (let ty = 0; ty < g.tiles; ty += 1) for (let tx = 0; tx < g.tiles; tx += 1) if (isSteep(g, tx, ty)) return { tx, ty };
  throw new Error("no steep ground at the test site - the steep-ground case would be vacuous");
}

describe("placement refuses every case §3.3 and the settlement rules name", () => {
  const base = world();
  const occupied = placeBuilding(base, "settlement-1", "spaceport", 14, 14, t).state;
  const steep = aSteepTile();

  const cases: readonly { what: string; state: SimState; id: string; type: BuildingType; tx: number; ty: number; reason: RegExp }[] = [
    { what: "no such settlement", state: base, id: "settlement-9", type: "reactor", tx: 14, ty: 14, reason: /no settlement settlement-9/ },
    { what: "no such building", state: base, id: "settlement-1", type: "castle" as BuildingType, tx: 14, ty: 14, reason: /"castle" is not a building/ },
    { what: "wrong kind of settlement", state: base, id: "settlement-2", type: "habitat_dome", tx: 4, ty: 4, reason: /cannot be built in an outpost/ },
    { what: "off the grid, west", state: base, id: "settlement-1", type: "reactor", tx: -1, ty: 14, reason: /runs off the grid/ },
    { what: "off the grid, north", state: base, id: "settlement-1", type: "reactor", tx: 14, ty: -1, reason: /runs off the grid/ },
    { what: "off the grid, east", state: base, id: "settlement-1", type: "habitat_dome", tx: 30, ty: 14, reason: /runs off the grid/ },
    { what: "off the grid, south", state: base, id: "settlement-1", type: "habitat_dome", tx: 14, ty: 30, reason: /runs off the grid/ },
    { what: "on ground too steep", state: base, id: "settlement-1", type: "storage_depot", tx: steep.tx, ty: steep.ty, reason: /too steep to build on \(slope 0\.\d\d, limit 0\.3\)/ },
    { what: "overlapping, one tile shared", state: occupied, id: "settlement-1", type: "reactor", tx: 16, ty: 16, reason: /overlap another building/ },
    { what: "not paid for", state: world(59), id: "settlement-1", type: "habitat_dome", tx: 14, ty: 14, reason: /needs 60 materials, 59 available/ },
  ];

  for (const c of cases) {
    it(`refuses: ${c.what}, saying why, and changes nothing`, () => {
      const out = placeBuilding(c.state, c.id, c.type, c.tx, c.ty, t);
      expect(out.ok).toBe(false);
      expect(out.reason).toMatch(c.reason);
      expect(out.state).toBe(c.state);
    });
  }

  it("accepts a legal placement, pays for it, and takes the tiles", () => {
    const out = placeBuilding(base, "settlement-1", "habitat_dome", 14, 14, t);
    expect(out.ok).toBe(true);
    expect(out.reason).toBeNull();
    const city = out.state.settlements[0]!;
    expect(city.buildings).toEqual([{ type: "habitat_dome", tx: 14, ty: 14, level: 1 }]);
    expect(city.stores.materials).toBe(1000 - t.COST_HABITAT_DOME);
    // The tiles are taken: the same footprint again is an overlap.
    expect(placeBuilding(out.state, "settlement-1", "storage_depot", 16, 16, t).reason).toMatch(/overlap/);
  });

  it("accepts right up to every edge, and exactly enough materials", () => {
    const tight = world(t.COST_HABITAT_DOME);
    for (const [tx, ty] of [
      [0, 0],
      [29, 0],
      [0, 29],
      [29, 29],
    ] as const) {
      // The corners of this site may be steep; only a buildable corner proves the edge rule.
      const g = groundOf({ kind: "city", ...SITE }, t);
      const clear = [0, 1, 2].every((dx) => [0, 1, 2].every((dy) => !isSteep(g, tx + dx, ty + dy)));
      const out = placeBuilding(tight, "settlement-1", "habitat_dome", tx, ty, t);
      expect(out.ok, `${tx},${ty}: ${out.reason}`).toBe(clear);
    }
  });

  it("refuses a rise along ANY edge of a tile, not just one", () => {
    // Judged from the corner heights alone, not from `isSteep`: a tile whose
    // only edge rising more than 0.3 x 10 m is one particular edge. Every edge
    // must refuse. (Batch 22's version of this caught an east-only check;
    // the ground is smooth now, and a tile's slope is the rise along its edges.)
    const g = groundOf({ kind: "city", ...SITE }, t);
    const limit = t.TERRAIN_MAX_SLOPE * t.TILE_METRES;
    const c = (x: number, y: number): number => g.cornersM[y * 33 + x]!;
    const edges = {
      north: (x: number, y: number) => Math.abs(c(x, y) - c(x + 1, y)),
      south: (x: number, y: number) => Math.abs(c(x, y + 1) - c(x + 1, y + 1)),
      west: (x: number, y: number) => Math.abs(c(x, y) - c(x, y + 1)),
      east: (x: number, y: number) => Math.abs(c(x + 1, y) - c(x + 1, y + 1)),
    } as const;
    for (const [side, rise] of Object.entries(edges)) {
      let found: [number, number] | null = null;
      for (let ty = 0; ty < 32 && found === null; ty += 1) {
        for (let tx = 0; tx < 32 && found === null; tx += 1) {
          const over = Object.values(edges).filter((e) => e(tx, ty) > limit).length;
          if (rise(tx, ty) > limit && over === 1) found = [tx, ty];
        }
      }
      expect(found, `no tile at this site rises steeply only along its ${side} edge - the case would be vacuous`).not.toBeNull();
      const [tx, ty] = found!;
      const out = placeBuilding(base, "settlement-1", "storage_depot", tx, ty, t);
      expect(out.ok, `built on a tile steep only along its ${side} edge, at ${tx},${ty}`).toBe(false);
      expect(out.reason).toMatch(/too steep/);
    }
  });

  it("had at least one clear corner, so the edge case above proved something", () => {
    const g = groundOf({ kind: "city", ...SITE }, t);
    const clearCorners = ([
      [0, 0],
      [29, 0],
      [0, 29],
      [29, 29],
    ] as const).filter(([tx, ty]) => [0, 1, 2].every((dx) => [0, 1, 2].every((dy) => !isSteep(g, tx + dx, ty + dy))));
    expect(clearCorners.length).toBeGreaterThan(0);
  });
});
