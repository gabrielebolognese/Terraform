/**
 * Claimed land, drawn (at the user's request: "after a city reaches 200
 * habitats, I can claim new terrain"): the boundary follows the land the city
 * holds, claim mode shows the land on offer, and a screen point finds the
 * ground under it - off the grid too, where land is claimed.
 */

import { describe, expect, it } from "vitest";

import type { CityView, SimState } from "../sim/index.js";
import { NEUTRAL_ENV, claimLand, cityView, derive, foundSettlement, habitat, makeTuning, worldEnv } from "../sim/index.js";
import { marsStart } from "../sim/planets/mars.js";
import type { CitySceneOptions } from "./city.js";
import { cityScene, groundPointAt, resetSceneCache } from "./city.js";
import { isoProject } from "./iso.js";

const T = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 64 });
const at: CitySceneOptions = { time: 1, selected: null, ghost: null, quality: "high" };

function viewOf(s: SimState): CityView {
  const env = habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, T), T), T, 0);
  return cityView(s.settlements[0]!, env, T);
}

function founded(): SimState {
  const s = foundSettlement(marsStart(undefined, T), "city", 0.31, -1.2, T).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, population: 400 })) };
}

function claimed(s: SimState, i: number, j: number): SimState {
  const o = claimLand(s, s.settlements[0]!.id, i, j, T);
  expect(o.ok, o.reason ?? "").toBe(true);
  return o.state;
}

/** The boundary's dashes, as the tile edges they lie on: "x,y,h" for an edge along x, "x,y,v" along y. */
function dashes(view: CityView): Set<string> {
  resetSceneCache();
  const out = new Set<string>();
  for (const sh of cityScene(view, at)) {
    const f = sh.fill;
    if (!(f.r === 1 && f.g === 0.86 && f.b === 0.55 && f.a === 0.55)) continue;
    // Back to the ground: a dash's corners are within 0.05 tile of its edge.
    const ring = sh.rings[0]!;
    const pts: { x: number; y: number }[] = [];
    for (let k = 0; k < ring.length; k += 2) pts.push({ x: ring[k]!, y: ring[k + 1]! });
    // Unproject by the dash's own heights is not needed: an edge's tiles are named by its screen middle and orientation.
    const mid = { sx: (pts[0]!.x + pts[2]!.x) / 2, sy: (pts[0]!.y + pts[2]!.y) / 2 };
    const g = groundPointAt(view, mid.sx, mid.sy);
    const along = Math.abs(pts[1]!.x - pts[0]!.x) > 0 && Math.sign(pts[1]!.x - pts[0]!.x) === Math.sign(pts[1]!.y - pts[0]!.y) ? "h" : "v";
    out.add(along === "h" ? `${Math.floor(g.x)},${Math.round(g.y)},h` : `${Math.round(g.x)},${Math.floor(g.y)},v`);
  }
  return out;
}

describe("the building boundary", () => {
  it("follows the land the city holds: a claim moves it out, and none runs between the claim and the square", () => {
    const before = viewOf(founded());
    const after = viewOf(claimed(founded(), 2, 0));
    const was = dashes(before);
    const now = dashes(after);
    // Round the 64-tile square: dashes on its east edge, x = 64.
    expect([...was].filter((d) => d.startsWith("64,") && d.endsWith(",v")).length).toBeGreaterThan(10);
    // Claim chunk (2, 0) - east, y 0..31: the edge between them is gone there...
    expect([...now].filter((d) => d.startsWith("64,") && d.endsWith(",v") && Number(d.split(",")[1]) < 32)).toEqual([]);
    // ...runs on at x = 64 below the claim...
    expect([...now].filter((d) => d.startsWith("64,") && d.endsWith(",v") && Number(d.split(",")[1]) >= 32).length).toBeGreaterThan(5);
    // ...and round the claim's far side, x = 96.
    expect([...now].filter((d) => d.startsWith("96,") && d.endsWith(",v")).length).toBeGreaterThan(5);
    // Not round the frame's unclaimed padding (x 64..95, y 32..95).
    expect([...now].filter((d) => d.endsWith(",h") && Number(d.split(",")[1]) === 96 && Number(d.split(",")[0]) >= 64)).toEqual([]);
  });
});

describe("claim mode", () => {
  it("draws the land on offer only when asked, green when it can be claimed now, grey when not", () => {
    const view = viewOf(founded());
    const chunks = view.claims.open.map((c) => ({ tx: c.tx, ty: c.ty, size: view.claims.chunk, ready: true, hover: false }));
    expect(chunks.length).toBe(8);
    const tint = (opts: CitySceneOptions) => {
      resetSceneCache();
      return cityScene(view, opts).filter((sh) => sh.fill.a < 0.4 && sh.fill.g > 0.9 && sh.fill.r < 0.5).length;
    };
    expect(tint(at)).toBe(0);
    expect(tint({ ...at, claimable: chunks })).toBeGreaterThanOrEqual(8);
    const grey = tint({ ...at, claimable: chunks.map((c) => ({ ...c, ready: false })) });
    expect(grey).toBe(0);
  });
});

describe("the ground under a screen point", () => {
  it("is the nearest ground along the line of sight - on the grid and off it, on hills", () => {
    const view = viewOf(claimed(founded(), -1, 0));
    const w = view.world;
    const m = w.size + 1;
    // The ground's height, bilinear between the world's corners (the grid's are the same corners).
    const h = (x: number, y: number): number => {
      const i = Math.floor(x) + w.margin;
      const j = Math.floor(y) + w.margin;
      const fx = x - Math.floor(x);
      const fy = y - Math.floor(y);
      const c = (a: number, b: number): number => w.corners[Math.min(w.size, Math.max(0, j + b)) * m + Math.min(w.size, Math.max(0, i + a))]!;
      return (c(0, 0) * (1 - fx) + c(1, 0) * fx) * (1 - fy) + (c(0, 1) * (1 - fx) + c(1, 1) * fx) * fy;
    };
    let hilly = 0;
    let hidden = 0;
    for (let k = 0; k < 60; k += 1) {
      // Ground points across the world and the grid; the screen point that draws each.
      const x = -40 + ((k * 37) % 130) + 0.3;
      const y = -40 + ((k * 53) % 130) + 0.6;
      const s = isoProject(x, y, h(x, y));
      const g = groundPointAt(view, s.sx, s.sy);
      const z = h(g.x, g.y);
      // On the ground, and drawn at the same screen point...
      const back = isoProject(g.x, g.y, z);
      expect(Math.hypot(back.sx - s.sx, back.sy - s.sy), `${x},${y}`).toBeLessThan(1);
      // ...and nothing nearer: the line of sight is above the ground all the way to the viewer.
      for (let d = 0.1; d < 40; d += 0.1) expect(h(g.x + d, g.y + d) < z + d + 0.02, `${x},${y}: ground in front at +${d.toFixed(1)}`).toBe(true);
      if (Math.abs(z) > 0.3) hilly += 1;
      if (Math.hypot(g.x - x, g.y - y) > 0.5) hidden += 1;
    }
    expect(hilly, "vacuity: many of these points are on hills").toBeGreaterThan(10);
    expect(hidden, "most points are the point itself; a few lie behind a hill").toBeLessThan(20);
  });
});
