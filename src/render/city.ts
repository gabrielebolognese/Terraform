/**
 * Micro §8 - the 2.5D city, as a list of flat shapes.
 *
 * "Buildings are procedural parametric assemblies, not hand-modeled meshes: a
 * dome is a hemisphere plus a base ring; a reactor is a core plus towers plus
 * pipes. A function builds each type, so new types are code, not art."
 *
 * Each building is a few convex solids. A convex solid needs no sorting of its
 * own faces - drop the ones facing away and the rest never overlap - so the
 * only ordering is between solids (by depth along the view) and between
 * footprints (`depthOrder`, the fix for §3.1's key).
 *
 * "Aliveness is render-time, driven by state": which buildings run and how
 * hard comes from `CityView`; motion comes from `time`, which the host passes
 * in. Nothing here is stored or simulated, and nothing reads the clock - the
 * reference render passes a fixed time.
 *
 * The render wall: this file sees `CityView` and nothing else of the
 * simulation, as the planet renderer sees only `VisualChannels`.
 */

import type { CityBuildingView, CityView } from "../sim/index.js";
import type { FootprintBox } from "./iso.js";
import { TOWARD_VIEWER, TILE_H, TILE_W, Z_PX, depthOrder, isoProject, isoToGround } from "./iso.js";
import type { Rgba, Shape } from "./raster.js";

type V3 = readonly [number, number, number];
interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Face {
  readonly pts: readonly V3[];
  readonly n: V3;
}

/** One convex solid: its faces, one colour, and how it is lit. */
interface Part {
  readonly faces: readonly Face[];
  readonly colour: Rgb;
  /** Glows: drawn at full colour whatever it faces. */
  readonly emissive?: boolean;
  readonly alpha?: number;
  /** A thin sheet seen from both sides (a solar panel). */
  readonly twoSided?: boolean;
}

export interface CitySceneOptions {
  /** Render time, seconds. Drives motion only. The reference render fixes it. */
  readonly time: number;
  /** Index into `view.buildings`, or null. */
  readonly selected: number | null;
  /** A placement preview: its footprint and whether the sim would accept it. */
  readonly ghost: { readonly tx: number; readonly ty: number; readonly size: number; readonly valid: boolean } | null;
  /**
   * The visible area, in iso pixels, or absent for everything. Anything whose
   * image lies wholly outside it is skipped - a metropolis has ~9,000 tiles
   * and hundreds of buildings, and a screen shows a fraction of them.
   */
  readonly viewport?: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
  /** Level of detail; absent means "high" (the golden frames are drawn at high). */
  readonly quality?: CityQuality;
}

// ---------------------------------------------------------------------------
// Palette and light
// ---------------------------------------------------------------------------

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

export const CITY_BACKGROUND: Rgba = { r: 0.086, g: 0.09, b: 0.102, a: 1 };

/** The ground's colour ramp by height (detail §1.3: elevation shown as a colour ramp). */
const GROUND_LOW = rgb(0.44, 0.27, 0.19);
const GROUND_HIGH = rgb(0.66, 0.45, 0.32);
const GROUND_STEEP = rgb(0.4, 0.26, 0.19);
const CLIFF = rgb(0.38, 0.24, 0.17);
const ROCK = rgb(0.47, 0.31, 0.23);
const CONCRETE = rgb(0.62, 0.6, 0.57);
const METAL = rgb(0.72, 0.73, 0.75);
const DARK_METAL = rgb(0.34, 0.35, 0.38);
const GLASS = rgb(0.6, 0.72, 0.8);
const PANEL = rgb(0.13, 0.2, 0.38);
const PANEL_ON = rgb(0.18, 0.3, 0.55);
const WARM_LIGHT = rgb(1, 0.82, 0.45);
const COLD_LIGHT = rgb(0.45, 0.95, 1);
const UNLIT = rgb(0.2, 0.2, 0.22);
const LEAF = rgb(0.36, 0.64, 0.38);
const LEAF_OFF = rgb(0.34, 0.38, 0.33);
const WATER = rgb(0.3, 0.5, 0.66);
const STEAM = rgb(0.92, 0.93, 0.95);
const PAINT_WHITE = rgb(0.86, 0.86, 0.84);
const FRAME = rgb(0.78, 0.8, 0.82);
const RUBBER = rgb(0.13, 0.13, 0.14);
const ACCENT = rgb(0.92, 0.5, 0.16);
const HAZARD = rgb(0.93, 0.77, 0.2);
const CELL_DARK = rgb(0.07, 0.12, 0.26);
const CELL_LIGHT = rgb(0.15, 0.25, 0.5);
const RED_LIGHT = rgb(1, 0.28, 0.22);
const GREEN_LIGHT = rgb(0.4, 1, 0.55);
const GROW_LIGHT = rgb(0.95, 0.55, 0.85);

/** Light from the far left and above: tops brightest, +y faces next, +x faces darkest. */
const LIGHT: V3 = normalise([0.15, 0.45, 0.88]);
const AMBIENT = 0.36;
const DIFFUSE = 0.64;

function normalise(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function shade(c: Rgb, k: number): Rgb {
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

/** A small integer hash, for deterministic variety (rock heights). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Face[] {
  return [
    { pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], n: [0, 0, 1] },
    { pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], n: [1, 0, 0] },
    { pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], n: [0, 1, 0] },
    { pts: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], n: [-1, 0, 0] },
    { pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], n: [0, -1, 0] },
  ];
}

/** A box turned `angle` radians about its vertical axis at (cx, cy). */
function turnedBox(cx: number, cy: number, halfL: number, halfW: number, angle: number, z0: number, z1: number): Face[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const at = (u: number, v: number, z: number): V3 => [cx + u * c - v * s, cy + u * s + v * c, z];
  const corners: [number, number][] = [
    [-halfL, -halfW],
    [halfL, -halfW],
    [halfL, halfW],
    [-halfL, halfW],
  ];
  const faces: Face[] = [{ pts: corners.map(([u, v]) => at(u, v, z1)), n: [0, 0, 1] }];
  for (let i = 0; i < 4; i += 1) {
    const [u0, v0] = corners[i]!;
    const [u1, v1] = corners[(i + 1) % 4]!;
    const mu = (u0 + u1) / 2;
    const mv = (v0 + v1) / 2;
    const l = Math.hypot(mu, mv);
    faces.push({
      pts: [at(u0, v0, z0), at(u1, v1, z0), at(u1, v1, z1), at(u0, v0, z1)],
      n: [(mu * c - mv * s) / l, (mu * s + mv * c) / l, 0],
    });
  }
  return faces;
}

/** A cylinder, or a frustum when the radii differ. */
function frustum(cx: number, cy: number, r0: number, r1: number, z0: number, z1: number, segments = 20): Face[] {
  const faces: Face[] = [];
  const top: V3[] = [];
  const h = z1 - z0;
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * 2 * Math.PI;
    const a1 = ((i + 1) / segments) * 2 * Math.PI;
    const am = (a0 + a1) / 2;
    faces.push({
      pts: [
        [cx + r0 * Math.cos(a0), cy + r0 * Math.sin(a0), z0],
        [cx + r0 * Math.cos(a1), cy + r0 * Math.sin(a1), z0],
        [cx + r1 * Math.cos(a1), cy + r1 * Math.sin(a1), z1],
        [cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0), z1],
      ],
      n: normalise([Math.cos(am) * h, Math.sin(am) * h, r0 - r1]),
    });
    top.push([cx + r1 * Math.cos(a0), cy + r1 * Math.sin(a0), z1]);
  }
  if (r1 > 0) faces.push({ pts: top, n: [0, 0, 1] });
  return faces;
}

/** The upper half of a sphere resting on z0. */
function dome(cx: number, cy: number, z0: number, r: number, segments = 24, bands = 7): Face[] {
  const faces: Face[] = [];
  const point = (a: number, p: number): V3 => [cx + r * Math.cos(p) * Math.cos(a), cy + r * Math.cos(p) * Math.sin(a), z0 + r * Math.sin(p)];
  for (let k = 0; k < bands; k += 1) {
    const p0 = (k / bands) * (Math.PI / 2);
    const p1 = ((k + 1) / bands) * (Math.PI / 2);
    for (let i = 0; i < segments; i += 1) {
      const a0 = (i / segments) * 2 * Math.PI;
      const a1 = ((i + 1) / segments) * 2 * Math.PI;
      const am = (a0 + a1) / 2;
      const pm = (p0 + p1) / 2;
      faces.push({
        pts: k === bands - 1 ? [point(a0, p0), point(a1, p0), point(am, p1)] : [point(a0, p0), point(a1, p0), point(a1, p1), point(a0, p1)],
        n: [Math.cos(pm) * Math.cos(am), Math.cos(pm) * Math.sin(am), Math.sin(pm)],
      });
    }
  }
  return faces;
}

/** A barrel vault along x: a greenhouse roof. */
function vault(x0: number, x1: number, cy: number, r: number, z0: number, segments = 10): Face[] {
  const faces: Face[] = [];
  const end: V3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * Math.PI;
    const a1 = ((i + 1) / segments) * Math.PI;
    const am = (a0 + a1) / 2;
    const y0 = cy + r * Math.cos(a0);
    const y1 = cy + r * Math.cos(a1);
    const h0 = z0 + r * Math.sin(a0);
    const h1 = z0 + r * Math.sin(a1);
    faces.push({ pts: [[x0, y0, h0], [x1, y0, h0], [x1, y1, h1], [x0, y1, h1]], n: [0, Math.cos(am), Math.sin(am)] });
    end.push([x1, y0, h0]);
  }
  end.push([x1, cy - r, z0]);
  faces.push({ pts: end, n: [1, 0, 0] });
  return faces;
}

/** A flat sheet, tilted; seen from either side. */
function sheet(pts: readonly V3[]): Face[] {
  const [a, b, c] = [pts[0]!, pts[1]!, pts[2]!];
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [{ pts, n: normalise([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]) }];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A round tube from a to b, at any angle: pipes, struts, legs, rails. */
function tube(a: V3, b: V3, r: number, segments = 8): Face[] {
  const d = normalise([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const helper: V3 = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalise(cross(d, helper));
  const v = cross(d, u);
  const at = (o: V3, ang: number): V3 => [
    o[0] + r * (Math.cos(ang) * u[0] + Math.sin(ang) * v[0]),
    o[1] + r * (Math.cos(ang) * u[1] + Math.sin(ang) * v[1]),
    o[2] + r * (Math.cos(ang) * u[2] + Math.sin(ang) * v[2]),
  ];
  const faces: Face[] = [];
  const capA: V3[] = [];
  const capB: V3[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = (i / segments) * 2 * Math.PI;
    const a1 = ((i + 1) / segments) * 2 * Math.PI;
    const am = (a0 + a1) / 2;
    faces.push({
      pts: [at(a, a0), at(a, a1), at(b, a1), at(b, a0)],
      n: normalise([Math.cos(am) * u[0] + Math.sin(am) * v[0], Math.cos(am) * u[1] + Math.sin(am) * v[1], Math.cos(am) * u[2] + Math.sin(am) * v[2]]),
    });
    capA.push(at(a, a0));
    capB.push(at(b, a0));
  }
  faces.push({ pts: capB, n: d }, { pts: capA.reverse(), n: [-d[0], -d[1], -d[2]] });
  return faces;
}

/**
 * A thin band round a vertical cylinder: rings, bolt collars, rims. Its sides
 * only - a band with `frustum`'s top cap painted a flat disc right across the
 * tower it wraps (Batch 22's detail pass, seen in the first render).
 */
function band(cx: number, cy: number, r: number, z: number, h = 0.03, segments = 24): Face[] {
  return frustum(cx, cy, r, r, z, z + h, segments).slice(0, segments);
}

/**
 * A panel of cells: a frame across the quad (p, p + u, p + u + v, p + v),
 * and `cols` x `rows` cells inset from it by `gap`. Solar modules, glazing,
 * control boards. Cells are lifted a hair off the frame along its normal.
 */
function cells(p: V3, u: V3, v: V3, cols: number, rows: number, gap: number): Face[][] {
  const n = normalise(cross(u, v));
  const lift = 0.004;
  const out: Face[][] = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const at = (fu: number, fv: number): V3 => [
        p[0] + u[0] * fu + v[0] * fv + n[0] * lift,
        p[1] + u[1] * fu + v[1] * fv + n[1] * lift,
        p[2] + u[2] * fu + v[2] * fv + n[2] * lift,
      ];
      const u0 = (i + gap) / cols;
      const u1 = (i + 1 - gap) / cols;
      const v0 = (j + gap) / rows;
      const v1 = (j + 1 - gap) / rows;
      out.push(sheet([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]));
    }
  }
  return out;
}

/** Meridian and latitude ribs over a dome's glass: the structure that makes it read as built. */
function domeRibs(cx: number, cy: number, z0: number, r: number, meridians: number, latitudes: readonly number[]): Face[] {
  const faces: Face[] = [];
  const R = r * 1.012;
  const at = (a: number, p: number): V3 => [cx + R * Math.cos(p) * Math.cos(a), cy + R * Math.cos(p) * Math.sin(a), z0 + R * Math.sin(p)];
  const w = 0.022 / r;
  const steps = 8;
  for (let m = 0; m < meridians; m += 1) {
    const a = (m / meridians) * 2 * Math.PI;
    for (let k = 0; k < steps; k += 1) {
      const p0 = (k / steps) * (Math.PI / 2) * 0.97;
      const p1 = ((k + 1) / steps) * (Math.PI / 2) * 0.97;
      const pm = (p0 + p1) / 2;
      faces.push({ pts: [at(a - w, p0), at(a + w, p0), at(a + w, p1), at(a - w, p1)], n: [Math.cos(pm) * Math.cos(a), Math.cos(pm) * Math.sin(a), Math.sin(pm)] });
    }
  }
  for (const p of latitudes) {
    const segs = 32;
    for (let i = 0; i < segs; i += 1) {
      const a0 = (i / segs) * 2 * Math.PI;
      const a1 = ((i + 1) / segs) * 2 * Math.PI;
      const am = (a0 + a1) / 2;
      faces.push({ pts: [at(a0, p - w), at(a1, p - w), at(a1, p + w), at(a0, p + w)], n: [Math.cos(p) * Math.cos(am), Math.cos(p) * Math.sin(am), Math.sin(p)] });
    }
  }
  return faces;
}

function part(faces: readonly Face[], colour: Rgb, extra: Partial<Pick<Part, "emissive" | "alpha" | "twoSided">> = {}): Part {
  return { faces, colour, ...extra };
}

// ---------------------------------------------------------------------------
// Projection to shapes
// ---------------------------------------------------------------------------

function ringOf(pts: readonly V3[]): number[] {
  const out: number[] = [];
  for (const p of pts) {
    const q = isoProject(p[0], p[1], p[2]);
    out.push(q.sx, q.sy);
  }
  return out;
}

/**
 * Draw solids in the order given. Each assembly lists its parts far to near
 * and bottom to top - its own painter's order. Sorting by centroid was tried
 * first and is wrong for exactly what these assemblies are made of: a light
 * sitting on a wide pad has a centroid farther than the pad's, and a glow band
 * wrapped round a core has one inside it, so both vanished (Batch 20).
 * Within a solid, back faces are dropped and the rest never overlap.
 */
function emitParts(parts: readonly Part[], out: Shape[]): void {
  for (const p of parts) {
    for (const f of p.faces) {
      let facing = dot(f.n, TOWARD_VIEWER);
      let n = f.n;
      if (facing <= 1e-9) {
        if (!p.twoSided) continue;
        n = [-n[0], -n[1], -n[2]];
        facing = -facing;
      }
      const lit = p.emissive ? p.colour : shade(p.colour, AMBIENT + DIFFUSE * Math.max(0, dot(n, LIGHT)));
      out.push({ rings: [ringOf(f.pts)], fill: { ...lit, a: p.alpha ?? 1 } });
    }
  }
}

/** A circle in screen space around a world point: steam, glows. */
function puff(x: number, y: number, z: number, radiusPx: number, colour: Rgb, alpha: number): Shape {
  const c = isoProject(x, y, z);
  const ring: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * 2 * Math.PI;
    ring.push(c.sx + radiusPx * Math.cos(a), c.sy + radiusPx * Math.sin(a) * 0.8);
  }
  return { rings: [ring], fill: { ...colour, a: alpha } };
}

function diamond(x0: number, y0: number, x1: number, y1: number, z = 0): number[] {
  return ringOf([
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ]);
}

// ---------------------------------------------------------------------------
// The ten buildings (micro §5), as assemblies
// ---------------------------------------------------------------------------

/**
 * The height of each assembly's tallest part, in tiles: where its status badge
 * floats, and how high a click can land on it (the web's picking reads this,
 * so what is drawn and what is clickable cannot drift apart).
 */
const TOPS: Readonly<Record<string, number>> = {
  habitat_dome: 1.9,
  solar_array: 0.6,
  geothermal_plant: 1.3,
  reactor: 1.5,
  water_extractor: 1.35,
  atmosphere_processor: 1.6,
  greenhouse: 1.1,
  regolith_mine: 1.0,
  storage_depot: 0.8,
  spaceport: 1.6,
};

export function buildingTop(type: string): number {
  return TOPS[type] ?? 1;
}

function plume(x: number, y: number, z: number, time: number, on: boolean): Shape[] {
  if (!on) return [];
  const out: Shape[] = [];
  for (let k = 0; k < 3; k += 1) {
    const cycle = (((time * 0.35 + k / 3) % 1) + 1) % 1;
    out.push(puff(x + cycle * 0.25, y - cycle * 0.1, z + 0.1 + cycle * 1.1, 5 + cycle * 9, STEAM, 0.42 * (1 - cycle)));
  }
  return out;
}

/**
 * A building's parts in painter's order, each either STATIC - its geometry
 * depends only on the building, where it stands and whether it runs, so its
 * shapes are built once and kept - or LIVE: animated, or driven by load, and
 * rebuilt every frame. Parts are thunks, so a frame served from the cache
 * never builds the static geometry at all.
 */
interface Kit {
  readonly items: { readonly live: boolean; readonly make: () => Part | readonly Part[] }[];
  readonly extras: Shape[];
}

function kit(): Kit & { s: (make: () => Part | readonly Part[]) => void; l: (make: () => Part | readonly Part[]) => void } {
  const items: Kit["items"] = [];
  return {
    items,
    extras: [],
    s: (make) => items.push({ live: false, make }),
    l: (make) => items.push({ live: true, make }),
  };
}

/** A lattice mast or tower: four legs from a square base to a square top, with rings and braces on the two faces the viewer sees. */
function lattice(cx: number, cy: number, halfBase: number, halfTop: number, z0: number, z1: number, levels: number, colour: Rgb): Part[] {
  const corner = (half: number, z: number, sx: number, sy: number): V3 => [cx + sx * half, cy + sy * half, z];
  const at = (sx: number, sy: number, f: number): V3 => {
    const half = halfBase + (halfTop - halfBase) * f;
    return corner(half, z0 + (z1 - z0) * f, sx, sy);
  };
  const out: Part[] = [];
  // Far leg first, near leg last.
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    out.push(part(tube(at(sx, sy, 0), at(sx, sy, 1), 0.018, 6), colour));
  }
  for (let k = 1; k <= levels; k += 1) {
    const f0 = (k - 1) / levels;
    const f1 = k / levels;
    // Rings and X-braces on the +x and +y faces (the far faces are hidden by them).
    out.push(part(tube(at(1, -1, f1), at(1, 1, f1), 0.011, 5), colour));
    out.push(part(tube(at(-1, 1, f1), at(1, 1, f1), 0.011, 5), colour));
    out.push(part(tube(at(1, -1, f0), at(1, 1, f1), 0.009, 5), colour));
    out.push(part(tube(at(1, 1, f0), at(1, -1, f1), 0.009, 5), colour));
    out.push(part(tube(at(-1, 1, f0), at(1, 1, f1), 0.009, 5), colour));
    out.push(part(tube(at(1, 1, f0), at(-1, 1, f1), 0.009, 5), colour));
  }
  return out;
}

/** A railing along a roof edge: posts and a top rail. */
function railing(a: V3, b: V3, height: number, posts: number, colour: Rgb): Part[] {
  const out: Part[] = [];
  const up = (p: V3): V3 => [p[0], p[1], p[2] + height];
  for (let i = 0; i <= posts; i += 1) {
    const f = i / posts;
    const p: V3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    out.push(part(tube(p, up(p), 0.007, 4), colour));
  }
  out.push(part(tube(up(a), up(b), 0.008, 4), colour));
  return out;
}

/** Roof vents: small boxes with a dark louvre face. */
function vent(x: number, y: number, z: number, w = 0.12, h = 0.08): Part[] {
  return [part(box(x, y, z, x + w, y + w, z + h), METAL), part(box(x + w, y + 0.02, z + 0.015, x + w + 0.004, y + w - 0.02, z + h - 0.015), RUBBER)];
}

function assemble(b: CityBuildingView, time: number): Kit {
  const s = b.size;
  const x0 = b.tx;
  const y0 = b.ty;
  const cx = x0 + s / 2;
  const cy = y0 + s / 2;
  const on = b.operable;
  // Load, in twentieths: what the lights and glows show. Rounded, so the
  // parts it colours can be kept (keyed by it) instead of rebuilt every frame.
  const act = Math.round(b.activity * 20) / 20;
  const k = kit();
  const { s: add, l: live } = k;
  const pad = (h = 0.06, inset = 0.08): void => add(() => part(box(x0 + inset, y0 + inset, 0, x0 + s - inset, y0 + s - inset, h), CONCRETE));

  switch (b.type) {
    case "habitat_dome": {
      const r = 1.24;
      const zb = 0.2;
      // "A dome is a hemisphere plus a base ring." A two-tier ring, then the glass.
      add(() => part(frustum(cx, cy, 1.42, 1.38, 0, 0.1, 36), CONCRETE));
      add(() => part(frustum(cx, cy, 1.37, 1.33, 0.1, zb, 36), PAINT_WHITE));
      // Corridor stubs out of the back, before the glass that hides their roots.
      add(() => part(tube([cx - 1.25, cy - 0.3, 0.14], [x0 + 0.02, cy - 0.3, 0.14], 0.09, 10), METAL));
      add(() => part(tube([cx + 0.3, cy - 1.25, 0.14], [cx + 0.3, y0 + 0.02, 0.14], 0.09, 10), METAL));
      add(() => part(dome(cx, cy, zb, r, 36, 9), GLASS));
      add(() => part(domeRibs(cx, cy, zb, r, 16, [0.32, 0.72, 1.12]), FRAME));
      // Crown hub and a mast with a beacon.
      add(() => part(frustum(cx, cy, 0.2, 0.15, zb + r - 0.03, zb + r + 0.07, 16), METAL));
      add(() => part(frustum(cx, cy, 0.06, 0.05, zb + r + 0.07, zb + r + 0.1, 10), DARK_METAL));
      add(() => part(tube([cx, cy, zb + r + 0.1], [cx, cy, zb + r + 0.42], 0.012, 5), METAL));
      live(() => part(box(cx - 0.025, cy - 0.025, zb + r + 0.42, cx + 0.025, cy + 0.025, zb + r + 0.46), on && Math.floor(time * 1.5) % 2 === 0 ? RED_LIGHT : UNLIT, { emissive: true }));
      // Window lights around the near half of the ring: how full the dome is.
      add(() => {
        const lit = Math.round(act * 14);
        const out: Part[] = [];
        for (let i = 0; i < 14; i += 1) {
          const a = -Math.PI / 4 + ((i + 0.5) / 14) * Math.PI;
          const wx = cx + 1.36 * Math.cos(a);
          const wy = cy + 1.36 * Math.sin(a);
          out.push(part(box(wx - 0.04, wy - 0.04, 0.115, wx + 0.04, wy + 0.04, 0.17), i < lit ? WARM_LIGHT : UNLIT, { emissive: true }));
        }
        return out;
      });
      // Corridor stubs toward the viewer, and the airlock.
      add(() => part(tube([cx + 1.3, cy + 0.45, 0.14], [x0 + s - 0.02, cy + 0.45, 0.14], 0.09, 10), METAL));
      add(() => part(band(x0 + s - 0.08, cy + 0.45, 0.1, 0.04, 0.2, 10), DARK_METAL));
      add(() => part(box(cx + 0.92, cy + 0.92, 0, cx + 1.32, cy + 1.32, 0.34), METAL));
      add(() => part(box(cx + 0.92, cy + 0.92, 0.34, cx + 1.32, cy + 1.32, 0.36), DARK_METAL));
      add(() => part(box(cx + 1.32, cy + 1.02, 0.02, cx + 1.325, cy + 1.22, 0.27), RUBBER));
      add(() => part(box(cx + 0.92, cy + 1.32, 0.3, cx + 1.32, cy + 1.325, 0.33), HAZARD));
      return k;
    }
    case "solar_array": {
      add(() => part(box(x0 + 0.04, y0 + 0.04, 0, x0 + s - 0.04, y0 + s - 0.04, 0.035), CONCRETE));
      // Cable tray between the rows, and the inverter that collects them.
      const table = (u: number, v: number): void => {
        const px = x0 + u + 0.08;
        const py = y0 + v + 0.1;
        const w = 0.84;
        const d = 0.66;
        const hiZ = 0.54;
        const loZ = 0.2;
        // Legs: two tall at the back, two short at the front; a brace and the torque tube.
        add(() => [
          part(tube([px + 0.12, py + 0.06, 0.035], [px + 0.12, py + 0.06, hiZ - 0.02], 0.016, 6), DARK_METAL),
          part(tube([px + w - 0.12, py + 0.06, 0.035], [px + w - 0.12, py + 0.06, hiZ - 0.02], 0.016, 6), DARK_METAL),
          part(tube([px + 0.12, py + 0.06, 0.28], [px + w - 0.12, py + 0.06, 0.28], 0.01, 5), DARK_METAL),
          part(tube([px + 0.12, py + d - 0.06, 0.035], [px + 0.12, py + d - 0.06, loZ + 0.02], 0.016, 6), DARK_METAL),
          part(tube([px + w - 0.12, py + d - 0.06, 0.035], [px + w - 0.12, py + d - 0.06, loZ + 0.02], 0.016, 6), DARK_METAL),
          part(tube([px, py + d / 2, (hiZ + loZ) / 2 - 0.03], [px + w, py + d / 2, (hiZ + loZ) / 2 - 0.03], 0.018, 6), METAL),
        ]);
        const p: V3 = [px, py, hiZ];
        const uu: V3 = [w, 0, 0];
        const vv: V3 = [0, d, loZ - hiZ];
        // The module frame, then its cells: 6 x 4, each a slightly different blue.
        add(() => part(sheet([p, [px + w, py, hiZ], [px + w, py + d, loZ], [px, py + d, loZ]]), FRAME, { twoSided: true }));
        add(() =>
          cells(p, uu, vv, 6, 4, 0.06).map((faces, i) => {
            const shadeOf = 0.2 + 0.55 * hash2(x0 * 17 + u * 5 + i, y0 * 13 + v * 7 - i);
            const base = mix(CELL_DARK, CELL_LIGHT, shadeOf);
            return part(faces, on ? mix(base, PANEL_ON, 0.25) : base, { twoSided: true });
          }),
        );
        // Sunlight sliding across the glass while the array works: the load it carries.
        live(() => {
          if (!on) return [];
          const sweep = ((time * 0.15 + u * 0.3 + v * 0.2) % 1 + 1) % 1;
          const band0 = sweep;
          const band1 = Math.min(1, sweep + 0.16);
          const at = (fu: number, fv: number): V3 => [p[0] + uu[0] * fu + vv[0] * fv, p[1] + uu[1] * fu + vv[1] * fv + 0.002, p[2] + uu[2] * fu + vv[2] * fv + 0.006];
          return [part(sheet([at(band0, 0.02), at(band1, 0.02), at(band1 - 0.12, 0.98), at(band0 - 0.12, 0.98)]), rgb(0.75, 0.88, 1), { emissive: true, alpha: 0.12 + 0.18 * act, twoSided: true })];
        });
      };
      table(0, 0);
      table(1, 0);
      add(() => part(box(x0 + 0.1, y0 + 0.86, 0.035, x0 + 1.7, y0 + 0.94, 0.07), DARK_METAL));
      add(() => [
        part(box(x0 + 1.72, y0 + 0.8, 0.035, x0 + 1.94, y0 + 1.02, 0.28), PAINT_WHITE),
        part(box(x0 + 1.72, y0 + 0.8, 0.28, x0 + 1.94, y0 + 1.02, 0.3), DARK_METAL),
        part(box(x0 + 1.76, y0 + 1.02, 0.08, x0 + 1.9, y0 + 1.024, 0.22), RUBBER),
      ]);
      add(() => part(box(x0 + 1.94, y0 + 0.87, 0.22, x0 + 1.944, y0 + 0.9, 0.25), on ? GREEN_LIGHT : UNLIT, { emissive: true }));
      table(0, 1);
      table(1, 1);
      return k;
    }
    case "geothermal_plant": {
      pad();
      // Wellheads at the back, their valve trees, and the pipe that carries the brine.
      for (const [wx, wy] of [
        [x0 + 0.3, y0 + 0.3],
        [x0 + 0.75, y0 + 0.25],
      ] as const) {
        add(() => [
          part(frustum(wx, wy, 0.1, 0.1, 0.06, 0.12, 12), DARK_METAL),
          part(frustum(wx, wy, 0.05, 0.05, 0.12, 0.34, 10), METAL),
          part(band(wx, wy, 0.07, 0.24, 0.025, 10), ACCENT),
          part(tube([wx, wy, 0.3], [wx, y0 + 0.62, 0.3], 0.03, 8), METAL),
        ]);
      }
      add(() => part(tube([x0 + 0.25, y0 + 0.62, 0.3], [x0 + 1.05, y0 + 0.62, 0.3], 0.04, 8), METAL));
      // The cooling tower: a waisted shell, banded, with a dark rim.
      const tx = x0 + 1.4;
      const ty = y0 + 0.55;
      add(() => [
        part(frustum(tx, ty, 0.44, 0.31, 0.06, 0.78, 24), PAINT_WHITE),
        part(frustum(tx, ty, 0.31, 0.34, 0.78, 1.16, 24), PAINT_WHITE),
        part(band(tx, ty, 0.405, 0.28, 0.06), ACCENT),
        part(band(tx, ty, 0.355, 1.13, 0.05), DARK_METAL),
      ]);
      k.extras.push(...plume(tx, ty, 1.16 + b.baseZ, time, on));
      // The turbine hall, its roof plant, a railing, and a window band.
      add(() => part(box(x0 + 0.18, y0 + 1.0, 0.06, x0 + 1.52, y0 + 1.82, 0.62), CONCRETE));
      add(() => [...vent(x0 + 0.3, y0 + 1.1, 0.62), ...vent(x0 + 0.55, y0 + 1.1, 0.62), ...vent(x0 + 0.8, y0 + 1.1, 0.62)]);
      add(() => part(box(x0 + 1.05, y0 + 1.25, 0.62, x0 + 1.4, y0 + 1.6, 0.74), METAL));
      add(() => [
        ...railing([x0 + 0.2, y0 + 1.8, 0.62], [x0 + 1.5, y0 + 1.8, 0.62], 0.07, 8, HAZARD),
        ...railing([x0 + 1.5, y0 + 1.02, 0.62], [x0 + 1.5, y0 + 1.8, 0.62], 0.07, 5, HAZARD),
      ]);
      add(() => {
        const glow = on ? WARM_LIGHT : UNLIT;
        const out: Part[] = [];
        for (let i = 0; i < 6; i += 1) {
          const wx = x0 + 0.26 + i * 0.2;
          out.push(part(box(wx, y0 + 1.82, 0.38, wx + 0.12, y0 + 1.825, 0.48), glow, { emissive: true }));
        }
        for (let i = 0; i < 3; i += 1) {
          const wy = y0 + 1.1 + i * 0.22;
          out.push(part(box(x0 + 1.52, wy, 0.38, x0 + 1.525, wy + 0.14, 0.48), glow, { emissive: true }));
        }
        return out;
      });
      // The condensate drum on its saddles, piped into the hall.
      add(() => [
        part(box(x0 + 1.62, y0 + 1.2, 0.06, x0 + 1.72, y0 + 1.7, 0.16), DARK_METAL),
        part(box(x0 + 1.84, y0 + 1.2, 0.06, x0 + 1.94, y0 + 1.7, 0.16), DARK_METAL),
        part(tube([x0 + 1.78, y0 + 1.12, 0.26], [x0 + 1.78, y0 + 1.78, 0.26], 0.12, 12), METAL),
      ]);
      return k;
    }
    case "reactor": {
      pad();
      const rx = x0 + 1.25;
      const ry = y0 + 1.1;
      // Two cooling towers at the back, banded, with dark rims.
      for (const [tx, ty] of [
        [x0 + 0.42, y0 + 0.38],
        [x0 + 0.38, y0 + 1.12],
      ] as const) {
        add(() => [
          part(frustum(tx, ty, 0.2, 0.13, 0.06, 1.3, 16), PAINT_WHITE),
          part(band(tx, ty, 0.175, 0.45, 0.06, 16), ACCENT),
          part(band(tx, ty, 0.15, 0.95, 0.06, 16), ACCENT),
          part(band(tx, ty, 0.14, 1.28, 0.06, 16), DARK_METAL),
          part(tube([tx + 0.12, ty, 0.3], [rx - 0.5, ty < ry ? ry - 0.3 : ty, 0.3], 0.045, 8), METAL),
        ]);
      }
      // The switchyard: transformers with their insulators.
      for (const [sx, sy] of [
        [x0 + 1.55, y0 + 0.18],
        [x0 + 1.55, y0 + 0.46],
      ] as const) {
        add(() => [
          part(box(sx, sy, 0.06, sx + 0.3, sy + 0.2, 0.26), DARK_METAL),
          part(tube([sx + 0.07, sy + 0.1, 0.26], [sx + 0.07, sy + 0.1, 0.38], 0.018, 6), PAINT_WHITE),
          part(tube([sx + 0.15, sy + 0.1, 0.26], [sx + 0.15, sy + 0.1, 0.38], 0.018, 6), PAINT_WHITE),
          part(tube([sx + 0.23, sy + 0.1, 0.26], [sx + 0.23, sy + 0.1, 0.38], 0.018, 6), PAINT_WHITE),
        ]);
      }
      // "A reactor is a core plus towers plus pipes." The containment, in
      // stacked rings so the glowing core band sits in its wall, with bolt collars.
      add(() => part(frustum(rx, ry, 0.56, 0.55, 0.06, 0.4, 28), CONCRETE));
      add(() => part(band(rx, ry, 0.565, 0.16, 0.025, 28), DARK_METAL));
      add(() => part(frustum(rx, ry, 0.565, 0.565, 0.4, 0.52, 28), on ? mix(UNLIT, COLD_LIGHT, 0.25 + 0.75 * act) : UNLIT, { emissive: true }));
      add(() => [
        part(frustum(rx, ry, 0.55, 0.55, 0.52, 0.8, 28), CONCRETE),
        part(band(rx, ry, 0.56, 0.66, 0.025, 28), DARK_METAL),
        part(dome(rx, ry, 0.8, 0.55, 28, 6), CONCRETE),
        part(domeRibs(rx, ry, 0.8, 0.55, 8, [0.5]), DARK_METAL),
        part(box(rx - 0.08, ry - 0.08, 1.33, rx + 0.08, ry + 0.08, 1.4), METAL),
      ]);
      // The turbine hall at the front, with roof vents and a lit strip.
      add(() => part(box(x0 + 0.12, y0 + 1.6, 0.06, x0 + 0.62, y0 + 1.92, 0.5), METAL));
      add(() => [...vent(x0 + 0.18, y0 + 1.66, 0.5, 0.1, 0.06), ...vent(x0 + 0.36, y0 + 1.66, 0.5, 0.1, 0.06)]);
      add(() => part(box(x0 + 0.16, y0 + 1.92, 0.3, x0 + 0.58, y0 + 1.925, 0.36), on ? COLD_LIGHT : UNLIT, { emissive: true }));
      return k;
    }
    case "water_extractor": {
      pad(0.16, 0.08);
      // The derrick: a lattice tower over the well, its crown block on top.
      add(() => lattice(cx, cy, 0.24, 0.07, 0.16, 1.22, 4, DARK_METAL));
      add(() => part(box(cx - 0.1, cy - 0.1, 1.2, cx + 0.1, cy + 0.1, 1.3), HAZARD));
      // The walking beam: "extractor arms move when operable".
      live(() => {
        const angle = on ? time * 1.2 : 0.6;
        const endX = cx + 0.7 * Math.cos(angle);
        const endY = cy + 0.7 * Math.sin(angle);
        return [
          part(turnedBox(cx, cy, 0.72, 0.05, angle, 1.04, 1.12), METAL),
          part(box(endX - 0.07, endY - 0.07, 0.98, endX + 0.07, endY + 0.07, 1.14), DARK_METAL),
        ];
      });
      // The holding tank with bands and a ladder, piped to the pump house.
      const tx = x0 + 0.52;
      const ty = y0 + 1.45;
      add(() => [
        part(frustum(tx, ty, 0.33, 0.33, 0.16, 0.74, 24), WATER),
        part(band(tx, ty, 0.335, 0.3, 0.025), METAL),
        part(band(tx, ty, 0.335, 0.52, 0.025), METAL),
        part(frustum(tx, ty, 0.33, 0.1, 0.74, 0.84, 24), METAL),
        part(box(tx + 0.02, ty + 0.33, 0.16, tx + 0.08, ty + 0.34, 0.76), HAZARD),
        part(tube([tx + 0.33, ty, 0.3], [x0 + 1.2, ty, 0.3], 0.035, 8), METAL),
      ]);
      // The pump house, with a vent and its own lit window.
      add(() => [
        part(box(x0 + 1.2, y0 + 1.18, 0.16, x0 + 1.8, y0 + 1.8, 0.6), PAINT_WHITE),
        part(box(x0 + 1.18, y0 + 1.16, 0.6, x0 + 1.82, y0 + 1.82, 0.63), DARK_METAL),
        ...vent(x0 + 1.3, y0 + 1.28, 0.63),
        part(tube([cx + 0.1, cy + 0.1, 0.3], [x0 + 1.25, y0 + 1.25, 0.3], 0.03, 8), METAL),
      ]);
      add(() => part(box(x0 + 1.35, y0 + 1.8, 0.34, x0 + 1.65, y0 + 1.805, 0.46), on ? COLD_LIGHT : UNLIT, { emissive: true }));
      return k;
    }
    case "atmosphere_processor": {
      pad();
      // Intakes at the back: grilled cylinders with caps.
      for (const ix of [x0 + 0.55, x0 + 1.1]) {
        add(() => [
          part(frustum(ix, y0 + 0.3, 0.2, 0.2, 0.06, 0.55, 16), DARK_METAL),
          part(band(ix, y0 + 0.3, 0.205, 0.15, 0.02, 16), METAL),
          part(band(ix, y0 + 0.3, 0.205, 0.25, 0.02, 16), METAL),
          part(band(ix, y0 + 0.3, 0.205, 0.35, 0.02, 16), METAL),
          part(band(ix, y0 + 0.3, 0.205, 0.45, 0.02, 16), METAL),
          part(frustum(ix, y0 + 0.3, 0.23, 0.08, 0.55, 0.64, 16), METAL),
        ]);
      }
      // The body, with panel seams on the faces the viewer sees.
      add(() => part(box(x0 + 0.25, y0 + 0.5, 0.06, x0 + 1.7, y0 + 1.6, 0.7), METAL));
      add(() => {
        const seams: Part[] = [];
        for (let i = 1; i < 6; i += 1) {
          const sx = x0 + 0.25 + (i * 1.45) / 6;
          seams.push(part(box(sx - 0.006, y0 + 1.6, 0.08, sx + 0.006, y0 + 1.604, 0.68), DARK_METAL));
        }
        for (let i = 1; i < 4; i += 1) {
          const sy = y0 + 0.5 + (i * 1.1) / 4;
          seams.push(part(box(x0 + 1.7, sy - 0.006, 0.08, x0 + 1.704, sy + 0.006, 0.68), DARK_METAL));
        }
        seams.push(part(box(x0 + 0.25, y0 + 1.6, 0.66, x0 + 1.7, y0 + 1.605, 0.7), ACCENT));
        return seams;
      });
      add(() => [...vent(x0 + 0.35, y0 + 0.6, 0.7), ...vent(x0 + 0.6, y0 + 0.6, 0.7), ...vent(x0 + 0.35, y0 + 0.85, 0.7)]);
      add(() => [
        ...railing([x0 + 0.27, y0 + 1.58, 0.7], [x0 + 1.68, y0 + 1.58, 0.7], 0.07, 10, HAZARD),
        ...railing([x0 + 1.68, y0 + 0.52, 0.7], [x0 + 1.68, y0 + 1.58, 0.7], 0.07, 7, HAZARD),
      ]);
      add(() => part(box(x0 + 0.45, y0 + 1.605, 0.32, x0 + 1.2, y0 + 1.61, 0.44), on ? COLD_LIGHT : UNLIT, { emissive: true }));
      // The exhaust stack, banded, with its beacon.
      add(() => [
        part(frustum(x0 + 1.45, y0 + 1.1, 0.17, 0.12, 0.7, 1.45, 16), CONCRETE),
        part(band(x0 + 1.45, y0 + 1.1, 0.16, 0.95, 0.06, 16), ACCENT),
        part(band(x0 + 1.45, y0 + 1.1, 0.135, 1.25, 0.06, 16), ACCENT),
        part(band(x0 + 1.45, y0 + 1.1, 0.125, 1.42, 0.04, 16), DARK_METAL),
      ]);
      live(() => part(box(x0 + 1.43, y0 + 1.08, 1.46, x0 + 1.47, y0 + 1.12, 1.5), on && Math.floor(time * 1.2) % 2 === 1 ? RED_LIGHT : UNLIT, { emissive: true }));
      k.extras.push(...plume(x0 + 1.45, y0 + 1.1, 1.46 + b.baseZ, time, on));
      // The gas drums on the near side, piped into the body.
      for (const dy of [0.7, 1.0, 1.3]) {
        add(() => [
          part(frustum(x0 + 1.84, y0 + dy, 0.1, 0.1, 0.06, 0.52, 14), PAINT_WHITE),
          part(band(x0 + 1.84, y0 + dy, 0.103, 0.18, 0.02, 14), HAZARD),
          part(dome(x0 + 1.84, y0 + dy, 0.52, 0.1, 14, 3), PAINT_WHITE),
          part(tube([x0 + 1.74, y0 + dy, 0.4], [x0 + 1.7, y0 + dy, 0.4], 0.025, 6), METAL),
        ]);
      }
      return k;
    }
    case "greenhouse": {
      pad(0.1);
      add(() => part(box(x0 + 0.15, y0 + 0.35, 0.1, x0 + 1.85, y0 + 1.65, 0.3), CONCRETE));
      // Rows of crops, seen through the glass.
      add(() => {
        const rows: Part[] = [];
        for (const ry of [-0.42, -0.14, 0.14, 0.42]) {
          rows.push(part(box(x0 + 0.25, cy + ry - 0.08, 0.3, x0 + 1.75, cy + ry + 0.08, 0.34), RUBBER));
          rows.push(part(box(x0 + 0.27, cy + ry - 0.06, 0.34, x0 + 1.73, cy + ry + 0.06, 0.42), on ? LEAF : LEAF_OFF));
        }
        return rows;
      });
      // Grow lights over the rows while it runs.
      add(() => (on ? [part(box(x0 + 0.3, cy - 0.5, 0.62, x0 + 1.7, cy + 0.5, 0.63), GROW_LIGHT, { emissive: true, alpha: 0.18 + 0.12 * act })] : []));
      // The glass vault, see-through, then its arches over it.
      add(() => part(vault(x0 + 0.15, x0 + 1.85, cy, 0.65, 0.3, 16), GLASS, { alpha: 0.42 }));
      add(() => {
        const arches: Part[] = [];
        for (let i = 0; i <= 8; i += 1) {
          const ax = x0 + 0.15 + (i * 1.7) / 8;
          const w = 0.012;
          const faces: Face[] = [];
          const R = 0.66;
          for (let j = 0; j < 12; j += 1) {
            const a0 = (j / 12) * Math.PI;
            const a1 = ((j + 1) / 12) * Math.PI;
            const am = (a0 + a1) / 2;
            faces.push({
              pts: [
                [ax - w, cy + R * Math.cos(a0), 0.3 + R * Math.sin(a0)],
                [ax + w, cy + R * Math.cos(a0), 0.3 + R * Math.sin(a0)],
                [ax + w, cy + R * Math.cos(a1), 0.3 + R * Math.sin(a1)],
                [ax - w, cy + R * Math.cos(a1), 0.3 + R * Math.sin(a1)],
              ],
              n: [0, Math.cos(am), Math.sin(am)],
            });
          }
          arches.push(part(faces, FRAME));
        }
        arches.push(part(tube([x0 + 0.15, cy, 0.3 + 0.66], [x0 + 1.85, cy, 0.3 + 0.66], 0.015, 6), FRAME));
        return arches;
      });
      // The plant room on the near end, with a fan.
      add(() => part(box(x0 + 1.86, y0 + 0.7, 0.1, x0 + 1.98, y0 + 1.3, 0.56), METAL));
      live(() => {
        const a = on ? time * 6 : 0.3;
        const blades: Part[] = [part(box(x0 + 1.98, cy - 0.16, 0.18, x0 + 1.984, cy + 0.16, 0.5), RUBBER)];
        for (let i = 0; i < 3; i += 1) {
          const t0 = a + (i * 2 * Math.PI) / 3;
          blades.push(part(sheet([[x0 + 1.986, cy, 0.34], [x0 + 1.986, cy + 0.14 * Math.cos(t0), 0.34 + 0.14 * Math.sin(t0)], [x0 + 1.986, cy + 0.14 * Math.cos(t0 + 0.5), 0.34 + 0.14 * Math.sin(t0 + 0.5)]]), METAL, { twoSided: true }));
        }
        return blades;
      });
      return k;
    }
    case "regolith_mine": {
      // The pit: terraced steps down into the ground, darker as they go.
      add(() => [
        part(box(x0 + 0.08, y0 + 0.08, 0, x0 + 1.12, y0 + 1.12, 0.02), rgb(0.36, 0.23, 0.17)),
        part(box(x0 + 0.2, y0 + 0.2, 0, x0 + 1.0, y0 + 1.0, 0.024), rgb(0.29, 0.18, 0.13)),
        part(box(x0 + 0.34, y0 + 0.34, 0, x0 + 0.86, y0 + 0.86, 0.028), rgb(0.22, 0.14, 0.1)),
      ]);
      // The processing plant at the back right, with a stack.
      add(() => [
        part(box(x0 + 1.2, y0 + 0.2, 0, x0 + 1.86, y0 + 0.95, 0.72), DARK_METAL),
        part(box(x0 + 1.2, y0 + 0.95, 0.5, x0 + 1.86, y0 + 0.954, 0.54), HAZARD),
        part(frustum(x0 + 1.72, y0 + 0.35, 0.07, 0.05, 0.72, 1.0, 10), METAL),
      ]);
      // The conveyor from the pit up into the plant, on posts.
      add(() => [
        part(tube([x0 + 1.02, y0 + 0.58, 0.02], [x0 + 1.02, y0 + 0.58, 0.28], 0.015, 5), DARK_METAL),
        part(tube([x0 + 1.12, y0 + 0.58, 0.02], [x0 + 1.12, y0 + 0.58, 0.38], 0.015, 5), DARK_METAL),
        part(sheet([[x0 + 0.85, y0 + 0.52, 0.14], [x0 + 1.2, y0 + 0.52, 0.5], [x0 + 1.2, y0 + 0.64, 0.5], [x0 + 0.85, y0 + 0.64, 0.14]]), RUBBER, { twoSided: true }),
        part(tube([x0 + 0.85, y0 + 0.64, 0.16], [x0 + 1.2, y0 + 0.64, 0.52], 0.01, 4), HAZARD),
      ]);
      // The digger: tracks, body, cab and a swinging boom.
      add(() => [
        part(box(x0 + 0.44, y0 + 0.44, 0.03, x0 + 0.78, y0 + 0.52, 0.1), RUBBER),
        part(box(x0 + 0.44, y0 + 0.68, 0.03, x0 + 0.78, y0 + 0.76, 0.1), RUBBER),
        part(box(x0 + 0.46, y0 + 0.47, 0.1, x0 + 0.76, y0 + 0.73, 0.26), HAZARD),
        part(box(x0 + 0.62, y0 + 0.62, 0.26, x0 + 0.74, y0 + 0.72, 0.38), HAZARD),
        part(box(x0 + 0.74, y0 + 0.63, 0.29, x0 + 0.745, y0 + 0.71, 0.36), GLASS),
      ]);
      live(() => {
        const angle = on ? 0.6 + 0.5 * Math.sin(time * 0.9) : 0.6;
        const bx = x0 + 0.6 + 0.38 * Math.cos(angle);
        const by = y0 + 0.6 + 0.38 * Math.sin(angle);
        return [
          part(turnedBox(x0 + 0.6 + 0.19 * Math.cos(angle), y0 + 0.6 + 0.19 * Math.sin(angle), 0.2, 0.035, angle, 0.26, 0.32), HAZARD),
          part(box(bx - 0.06, by - 0.06, 0.08, bx + 0.06, by + 0.06, 0.2), DARK_METAL),
        ];
      });
      // Spoil heap and the ore store at the front.
      add(() => part(frustum(x0 + 0.42, y0 + 1.55, 0.32, 0.06, 0, 0.32, 10), ROCK));
      add(() => [
        part(box(x0 + 1.25, y0 + 1.15, 0, x0 + 1.86, y0 + 1.86, 0.4), CONCRETE),
        ...vent(x0 + 1.35, y0 + 1.25, 0.4),
        ...vent(x0 + 1.6, y0 + 1.25, 0.4),
        part(box(x0 + 1.4, y0 + 1.86, 0.02, x0 + 1.72, y0 + 1.864, 0.3), RUBBER),
      ]);
      return k;
    }
    case "storage_depot": {
      // A bunded slab: a low wall round the edge to hold a spill.
      add(() => [
        part(box(x0 + 0.03, y0 + 0.03, 0, x0 + 0.97, y0 + 0.97, 0.03), CONCRETE),
        part(box(x0 + 0.03, y0 + 0.03, 0.03, x0 + 0.97, y0 + 0.07, 0.08), CONCRETE),
        part(box(x0 + 0.03, y0 + 0.03, 0.03, x0 + 0.07, y0 + 0.97, 0.08), CONCRETE),
      ]);
      for (const [tx, ty, h] of [
        [x0 + 0.3, y0 + 0.32, 0.6],
        [x0 + 0.7, y0 + 0.32, 0.5],
        [x0 + 0.3, y0 + 0.72, 0.5],
      ] as const) {
        const r = 0.17;
        add(() => [
          part(frustum(tx, ty, r, r, 0.03, h, 18), PAINT_WHITE),
          part(band(tx, ty, r + 0.004, 0.14, 0.06, 18), ACCENT),
          part(band(tx, ty, r + 0.004, h - 0.12, 0.06, 18), ACCENT),
          part(dome(tx, ty, h, r, 18, 4), PAINT_WHITE),
          part(box(tx - 0.02, ty + r, 0.03, tx + 0.02, ty + r + 0.008, h), DARK_METAL),
        ]);
      }
      add(() => [
        part(tube([x0 + 0.47, y0 + 0.32, 0.2], [x0 + 0.53, y0 + 0.32, 0.2], 0.03, 6), METAL),
        part(tube([x0 + 0.3, y0 + 0.49, 0.2], [x0 + 0.3, y0 + 0.55, 0.2], 0.03, 6), METAL),
        part(box(x0 + 0.58, y0 + 0.6, 0.03, x0 + 0.92, y0 + 0.92, 0.18), METAL),
        part(box(x0 + 0.62, y0 + 0.64, 0.18, x0 + 0.88, y0 + 0.88, 0.3), METAL),
        part(box(x0 + 0.92, y0 + 0.7, 0.05, x0 + 0.925, y0 + 0.82, 0.14), HAZARD),
      ]);
      return k;
    }
    case "spaceport": {
      const px = cx - 0.1;
      const py = cy - 0.1;
      // The pad, its markings: an outer ring, a dark touchdown circle, a cross.
      add(() => [
        part(frustum(px, py, 1.32, 1.3, 0, 0.1, 36), CONCRETE),
        part(frustum(px, py, 1.2, 1.2, 0.1, 0.103, 36), RUBBER),
        part(frustum(px, py, 1.12, 1.12, 0.103, 0.106, 36), CONCRETE),
        part(frustum(px, py, 0.62, 0.62, 0.106, 0.109, 28), HAZARD),
        part(frustum(px, py, 0.56, 0.56, 0.109, 0.112, 28), CONCRETE),
        part(box(px - 0.9, py - 0.04, 0.106, px + 0.9, py + 0.04, 0.11), PAINT_WHITE),
        part(box(px - 0.04, py - 0.9, 0.106, px + 0.04, py + 0.9, 0.11), PAINT_WHITE),
      ]);
      // Pad lights, chasing round the ring while the port runs.
      live(() => {
        const out: Part[] = [];
        for (let i = 0; i < 16; i += 1) {
          const a = (i / 16) * 2 * Math.PI;
          const lx = px + 1.25 * Math.cos(a);
          const ly = py + 1.25 * Math.sin(a);
          const litNow = on && (Math.floor(time * 4) + i) % 4 !== 0;
          out.push(part(box(lx - 0.035, ly - 0.035, 0.1, lx + 0.035, ly + 0.035, 0.14), litNow ? WARM_LIGHT : UNLIT, { emissive: true }));
        }
        return out;
      });
      // The service gantry at the back, and its arm to the lander.
      add(() => lattice(x0 + 0.55, y0 + 0.55, 0.14, 0.1, 0.1, 1.5, 6, HAZARD));
      add(() => part(tube([x0 + 0.62, y0 + 0.62, 1.05], [px - 0.14, py - 0.14, 1.05], 0.025, 6), HAZARD));
      // Fuel tanks on saddles, back right.
      for (const fy of [y0 + 0.3, y0 + 0.62]) {
        add(() => [
          part(box(x0 + 2.35, fy - 0.1, 0, x0 + 2.43, fy + 0.1, 0.12), DARK_METAL),
          part(box(x0 + 2.75, fy - 0.1, 0, x0 + 2.83, fy + 0.1, 0.12), DARK_METAL),
          part(tube([x0 + 2.25, fy, 0.22], [x0 + 2.92, fy, 0.22], 0.12, 14), PAINT_WHITE),
        ]);
      }
      // The lander: legs, engine bell, banded body with windows, nose, fins.
      add(() => {
        const out: Part[] = [];
        for (let i = 0; i < 4; i += 1) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          out.push(part(tube([px + 0.16 * Math.cos(a), py + 0.16 * Math.sin(a), 0.5], [px + 0.42 * Math.cos(a), py + 0.42 * Math.sin(a), 0.11], 0.018, 6), DARK_METAL));
          out.push(part(frustum(px + 0.42 * Math.cos(a), py + 0.42 * Math.sin(a), 0.05, 0.05, 0.1, 0.12, 8), DARK_METAL));
        }
        out.push(part(frustum(px, py, 0.17, 0.1, 0.24, 0.42, 16), DARK_METAL));
        out.push(part(frustum(px, py, 0.2, 0.2, 0.42, 1.12, 20), PAINT_WHITE));
        out.push(part(band(px, py, 0.205, 0.55, 0.06, 20), ACCENT));
        out.push(part(band(px, py, 0.205, 0.98, 0.03, 20), RUBBER));
        out.push(part(frustum(px, py, 0.2, 0.0, 1.12, 1.48, 20), PAINT_WHITE));
        for (let i = 0; i < 3; i += 1) {
          const a = Math.PI / 4 + (i - 1) * 0.7;
          out.push(part(turnedBox(px + 0.26 * Math.cos(a), py + 0.26 * Math.sin(a), 0.07, 0.008, a, 0.42, 0.7), ACCENT));
        }
        return out;
      });
      add(() => {
        const out: Part[] = [];
        for (let i = 0; i < 3; i += 1) {
          const a = Math.PI / 4 + (i - 1) * 0.45;
          const wx = px + 0.203 * Math.cos(a);
          const wy = py + 0.203 * Math.sin(a);
          out.push(part(box(wx - 0.02, wy - 0.02, 0.85, wx + 0.02, wy + 0.02, 0.9), on ? WARM_LIGHT : UNLIT, { emissive: true }));
        }
        return out;
      });
      // The control tower on the near corner: shaft, lit cab, dish and mast.
      add(() => [
        part(box(x0 + 2.35, y0 + 2.35, 0, x0 + 2.85, y0 + 2.85, 0.9), CONCRETE),
        part(box(x0 + 2.3, y0 + 2.3, 0.9, x0 + 2.9, y0 + 2.9, 0.93), DARK_METAL),
      ]);
      add(() => part(box(x0 + 2.3, y0 + 2.3, 0.93, x0 + 2.9, y0 + 2.9, 1.1), on ? mix(GLASS, WARM_LIGHT, 0.35) : DARK_METAL, { emissive: on }));
      add(() => [
        part(box(x0 + 2.28, y0 + 2.28, 1.1, x0 + 2.92, y0 + 2.92, 1.14), DARK_METAL),
        part(tube([x0 + 2.8, y0 + 2.4, 1.14], [x0 + 2.8, y0 + 2.4, 1.45], 0.012, 5), METAL),
        part(tube([x0 + 2.45, y0 + 2.75, 1.14], [x0 + 2.45, y0 + 2.75, 1.26], 0.02, 6), METAL),
        part(sheet([[x0 + 2.33, y0 + 2.7, 1.3], [x0 + 2.52, y0 + 2.62, 1.36], [x0 + 2.6, y0 + 2.82, 1.28], [x0 + 2.41, y0 + 2.9, 1.22]]), PAINT_WHITE, { twoSided: true }),
      ]);
      return k;
    }
  }
}

// ---------------------------------------------------------------------------
// Overlays: status, selection, placement
// ---------------------------------------------------------------------------

/**
 * A browned-out building's badge: a dark diamond with an exclamation mark.
 * Read by its shape, not its colour (Batch 7's rule for the HUD, kept here).
 */
function offlineBadge(x: number, y: number, z: number): Shape[] {
  const c = isoProject(x, y, z);
  const r = 11;
  const outline: number[] = [c.sx, c.sy - r - 2, c.sx + r + 2, c.sy, c.sx, c.sy + r + 2, c.sx - r - 2, c.sy];
  const body: number[] = [c.sx, c.sy - r, c.sx + r, c.sy, c.sx, c.sy + r, c.sx - r, c.sy];
  const bar: number[] = [c.sx - 1.6, c.sy - 6.5, c.sx + 1.6, c.sy - 6.5, c.sx + 1.2, c.sy + 1.5, c.sx - 1.2, c.sy + 1.5];
  const dot: number[] = [c.sx - 1.6, c.sy + 3.2, c.sx + 1.6, c.sy + 3.2, c.sx + 1.6, c.sy + 6.4, c.sx - 1.6, c.sy + 6.4];
  return [
    { rings: [outline], fill: { r: 0.95, g: 0.95, b: 0.95, a: 1 } },
    { rings: [body], fill: { r: 0.12, g: 0.12, b: 0.14, a: 1 } },
    { rings: [bar], fill: { r: 1, g: 0.8, b: 0.3, a: 1 } },
    { rings: [dot], fill: { r: 1, g: 0.8, b: 0.3, a: 1 } },
  ];
}

/**
 * A building kept off by the network: the same diamond, with a broken link
 * in it - two bars that do not meet - so "not connected" reads by shape.
 */
function unlinkedBadge(x: number, y: number, z: number): Shape[] {
  const c = isoProject(x, y, z);
  const r = 11;
  const outline: number[] = [c.sx, c.sy - r - 2, c.sx + r + 2, c.sy, c.sx, c.sy + r + 2, c.sx - r - 2, c.sy];
  const body: number[] = [c.sx, c.sy - r, c.sx + r, c.sy, c.sx, c.sy + r, c.sx - r, c.sy];
  const left: number[] = [c.sx - 7, c.sy - 1.4, c.sx - 1.8, c.sy - 1.4, c.sx - 1.8, c.sy + 1.4, c.sx - 7, c.sy + 1.4];
  const right: number[] = [c.sx + 1.8, c.sy - 1.4, c.sx + 7, c.sy - 1.4, c.sx + 7, c.sy + 1.4, c.sx + 1.8, c.sy + 1.4];
  const amber = { r: 1, g: 0.8, b: 0.3, a: 1 };
  return [
    { rings: [outline], fill: { r: 0.95, g: 0.95, b: 0.95, a: 1 } },
    { rings: [body], fill: { r: 0.12, g: 0.12, b: 0.14, a: 1 } },
    { rings: [left], fill: amber },
    { rings: [right], fill: amber },
  ];
}

/** A ring around a footprint, on the ground at height `z`. */
function footprintRing(tx: number, ty: number, size: number, width: number, fill: Rgba, z = 0): Shape {
  return {
    rings: [diamond(tx - width, ty - width, tx + size + width, ty + size + width, z), diamond(tx, ty, tx + size, ty + size, z)],
    fill,
  };
}

/** A thin strip on the ground from a to b: the arms of the "cannot" cross. */
function groundStrip(ax: number, ay: number, bx: number, by: number, half: number, z = 0): number[] {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy);
  const nx = (-dy / l) * half;
  const ny = (dx / l) * half;
  return ringOf([
    [ax + nx, ay + ny, z],
    [bx + nx, by + ny, z],
    [bx - nx, by - ny, z],
    [ax - nx, ay - ny, z],
  ]);
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/**
 * Three levels of detail, chosen by the host from the zoom (requested by the
 * user: a zoomed-out metropolis lagged). The picture a player sees up close is
 * unchanged; further out, buildings keep only their signature masses, and
 * furthest out a building is one block in its type's colour and flat ground
 * merges into 4 x 4 patches.
 */
export type CityQuality = "high" | "medium" | "low";

/**
 * The colour a building reads as from far away: the mean colour of its
 * full-detail drawing on screen (measured one by one on flat ground; the
 * first version used each building's main material, and green greenhouses
 * and white depots made the far city look less like the near one than bare
 * ground did).
 */
const FAR_COLOUR: Readonly<Record<string, Rgb>> = {
  habitat_dome: rgb(0.647, 0.749, 0.804),
  solar_array: rgb(0.42, 0.528, 0.698),
  geothermal_plant: rgb(0.721, 0.716, 0.684),
  reactor: rgb(0.621, 0.674, 0.67),
  water_extractor: rgb(0.621, 0.651, 0.652),
  atmosphere_processor: rgb(0.758, 0.76, 0.747),
  greenhouse: rgb(0.645, 0.684, 0.684),
  regolith_mine: rgb(0.427, 0.378, 0.332),
  storage_depot: rgb(0.78, 0.73, 0.68),
  spaceport: rgb(0.574, 0.573, 0.538),
};

/** Medium detail: each building's signature masses, coarse curves, no greebles, nothing animated. */
function assembleMedium(b: CityBuildingView): Kit {
  const s = b.size;
  const x0 = b.tx;
  const y0 = b.ty;
  const cx = x0 + s / 2;
  const cy = y0 + s / 2;
  const on = b.operable;
  const act = Math.round(b.activity * 20) / 20;
  const k = kit();
  const add = k.s;
  const slab = (h = 0.05): void => add(() => part(box(x0 + 0.08, y0 + 0.08, 0, x0 + s - 0.08, y0 + s - 0.08, h), CONCRETE));
  switch (b.type) {
    case "habitat_dome":
      add(() => part(frustum(cx, cy, 1.42, 1.34, 0, 0.2, 16), PAINT_WHITE));
      add(() => part(dome(cx, cy, 0.2, 1.24, 16, 4), GLASS));
      break;
    case "solar_array":
      slab(0.035);
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const px = x0 + u + 0.08;
        const py = y0 + v + 0.1;
        add(() => part(sheet([[px, py, 0.54], [px + 0.84, py, 0.54], [px + 0.84, py + 0.66, 0.2], [px, py + 0.66, 0.2]]), mix(FRAME, on ? mix(mix(CELL_DARK, CELL_LIGHT, 0.5), PANEL_ON, 0.25) : CELL_DARK, 0.75), { twoSided: true }));
      }
      break;
    case "geothermal_plant":
      slab();
      add(() => part(frustum(x0 + 1.4, y0 + 0.55, 0.44, 0.32, 0.06, 1.16, 10), PAINT_WHITE));
      add(() => part(box(x0 + 0.18, y0 + 1.0, 0.06, x0 + 1.52, y0 + 1.82, 0.62), CONCRETE));
      break;
    case "reactor":
      slab();
      add(() => part(frustum(x0 + 0.42, y0 + 0.38, 0.2, 0.13, 0.06, 1.3, 8), PAINT_WHITE));
      add(() => part(frustum(x0 + 0.38, y0 + 1.12, 0.2, 0.13, 0.06, 1.3, 8), PAINT_WHITE));
      add(() => part(frustum(x0 + 1.25, y0 + 1.1, 0.56, 0.55, 0.06, 0.8, 12), CONCRETE));
      add(() => part(frustum(x0 + 1.25, y0 + 1.1, 0.565, 0.565, 0.4, 0.52, 12), on ? mix(UNLIT, COLD_LIGHT, 0.25 + 0.75 * act) : UNLIT, { emissive: true }));
      add(() => part(dome(x0 + 1.25, y0 + 1.1, 0.8, 0.55, 12, 3), CONCRETE));
      break;
    case "water_extractor":
      slab(0.16);
      add(() => part(frustum(cx, cy, 0.3, 0.08, 0.16, 1.28, 4), DARK_METAL));
      add(() => part(frustum(x0 + 0.52, y0 + 1.45, 0.33, 0.33, 0.16, 0.8, 10), WATER));
      add(() => part(box(x0 + 1.2, y0 + 1.18, 0.16, x0 + 1.8, y0 + 1.8, 0.62), PAINT_WHITE));
      break;
    case "atmosphere_processor":
      slab();
      add(() => part(box(x0 + 0.25, y0 + 0.5, 0.06, x0 + 1.7, y0 + 1.6, 0.7), METAL));
      add(() => part(frustum(x0 + 1.45, y0 + 1.1, 0.17, 0.12, 0.7, 1.45, 8), CONCRETE));
      break;
    case "greenhouse":
      slab(0.1);
      add(() => part(box(x0 + 0.15, y0 + 0.35, 0.1, x0 + 1.85, y0 + 1.65, 0.3), CONCRETE));
      // The crops as one bed, seen through the same glass as up close.
      add(() => part(box(x0 + 0.27, cy - 0.5, 0.3, x0 + 1.73, cy + 0.5, 0.42), on ? LEAF : LEAF_OFF));
      add(() => part(vault(x0 + 0.15, x0 + 1.85, cy, 0.65, 0.3, 6), GLASS, { alpha: 0.42 }));
      break;
    case "regolith_mine":
      add(() => part(box(x0 + 0.08, y0 + 0.08, 0, x0 + 1.12, y0 + 1.12, 0.02), rgb(0.29, 0.18, 0.13)));
      add(() => part(box(x0 + 1.2, y0 + 0.2, 0, x0 + 1.86, y0 + 0.95, 0.72), DARK_METAL));
      add(() => part(box(x0 + 1.25, y0 + 1.15, 0, x0 + 1.86, y0 + 1.86, 0.4), CONCRETE));
      break;
    case "storage_depot":
      add(() => part(frustum(x0 + 0.3, y0 + 0.32, 0.17, 0.17, 0, 0.6, 8), PAINT_WHITE));
      add(() => part(frustum(x0 + 0.7, y0 + 0.32, 0.17, 0.17, 0, 0.5, 8), PAINT_WHITE));
      add(() => part(frustum(x0 + 0.3, y0 + 0.72, 0.17, 0.17, 0, 0.5, 8), PAINT_WHITE));
      break;
    case "spaceport":
      add(() => part(frustum(cx - 0.1, cy - 0.1, 1.32, 1.3, 0, 0.1, 16), CONCRETE));
      add(() => part(frustum(cx - 0.1, cy - 0.1, 0.2, 0.2, 0.1, 1.12, 8), PAINT_WHITE));
      add(() => part(frustum(cx - 0.1, cy - 0.1, 0.2, 0, 1.12, 1.48, 8), PAINT_WHITE));
      add(() => part(box(x0 + 2.35, y0 + 2.35, 0, x0 + 2.85, y0 + 2.85, 1.1), CONCRETE));
      break;
  }
  return k;
}

/** Low detail: one block per building, in the colour it reads as from far away. */
function assembleLow(b: CityBuildingView): Kit {
  const k = kit();
  const inset = b.size === 1 ? 0.12 : 0.2;
  const h = buildingTop(b.type) * (b.type === "solar_array" ? 0.5 : 0.62);
  const colour = FAR_COLOUR[b.type] ?? CONCRETE;
  const fill = b.operable ? colour : shade(colour, 0.55);
  if (b.type === "habitat_dome" || b.type === "spaceport") {
    // Round buildings stay round: a square block covers their corners' ground.
    const r = b.type === "habitat_dome" ? 1.3 : 1.25;
    k.s(() => part(frustum(b.tx + b.size / 2, b.ty + b.size / 2, r, r * 0.55, 0, h, 8), fill));
  } else {
    k.s(() => part(box(b.tx + inset, b.ty + inset, 0, b.tx + b.size - inset, b.ty + b.size - inset, h), fill));
  }
  return k;
}

/** Loose rocks on open ground: derived from where the tile is, drawn only up close. */
function scatter(tx: number, ty: number, z: number): Part[] {
  const out: Part[] = [];
  if (hash2(tx * 7 + 3, ty * 13 - 5) > 0.08) return out;
  const count = 1 + Math.floor(hash2(tx + 11, ty + 29) * 3);
  for (let i = 0; i < count; i += 1) {
    const rx = tx + 0.2 + 0.6 * hash2(tx * 31 + i, ty * 17 - i);
    const ry = ty + 0.2 + 0.6 * hash2(tx * 19 - i, ty * 23 + i);
    const r = 0.05 + 0.11 * hash2(tx + i * 5, ty - i * 3);
    const h = 0.04 + 0.1 * hash2(tx - i * 7, ty + i * 11);
    out.push(part(frustum(rx, ry, r, r * 0.5, z, z + h, 6), ROCK));
  }
  return out;
}

/** The iso-pixel box a grid of `tiles` occupies, with room for the tallest building and the highest hill. */
export function sceneBounds(tiles: number, maxGroundZ = 0): { minX: number; maxX: number; minY: number; maxY: number } {
  const half = (tiles * TILE_W) / 2;
  return { minX: -half, maxX: half, minY: -(2 + Math.max(0, maxGroundZ)) * Z_PX, maxY: tiles * TILE_H + 0.6 * Z_PX };
}

/** Lowest and highest ground in the view, in tiles. */
function groundRange(view: CityView): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const z of view.groundZ) {
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  return Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 0 };
}

/** The highest ground under a footprint, in tiles - where a building (or a preview of one) stands. */
function footprintTop(view: CityView, tx: number, ty: number, size: number): number {
  const n = view.tiles;
  let top = -Infinity;
  for (let y = ty; y < ty + size; y += 1) {
    for (let x = tx; x < tx + size; x += 1) {
      if (x >= 0 && y >= 0 && x < n && y < n) top = Math.max(top, view.groundZ[y * n + x] ?? 0);
    }
  }
  return Number.isFinite(top) ? top : 0;
}

interface Occupant extends FootprintBox {
  /** A building's index, or -1 for a column of ground. */
  readonly building: number;
}

/**
 * Everything that stands in the scene, far to near: every tile of ground not
 * under a building (a column up to its height), and every building (standing
 * on a plinth that replaces the tiles beneath it). Ordering about a thousand
 * of them is quadratic, so the order is kept until the layout changes - it
 * depends on nothing else.
 */
interface SceneCache {
  key: string;
  occupants: Occupant[];
  order: number[];
  ground: Map<number, Shape[]>;
  /** Each building's static shapes, as the runs between its live parts. */
  buildings: Map<string, Shape[][]>;
  /** The straight stretches of road the rovers drive, found once per layout. */
  runs: RoadRun[] | null;
  /** Connection points, as `tile * 4 + side` (side: the building is east, west, south, north of the road). */
  connectors: Set<number>;
}

/** A straight stretch of road: from (tx, ty), `length` tiles along (dx, dy). */
interface RoadRun {
  readonly tx: number;
  readonly ty: number;
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
}

/** One cache per level of detail, so zooming in and out never throws one away. */
const sceneCaches = new Map<CityQuality, SceneCache>();

const asList = (made: Part | readonly Part[]): readonly Part[] => (Array.isArray(made) ? (made as readonly Part[]) : [made as Part]);

/**
 * A building into the frame. Its static parts are built once per layout,
 * where it stands and whether it runs, and kept as the runs of shapes
 * between its live parts; every frame after that builds only the live parts
 * and slots them back in, so painter's order is exactly the assembly's.
 */
function emitBuilding(kit: Kit, b: CityBuildingView, cache: Map<string, Shape[][]>, out: Shape[]): void {
  // `cache` belongs to one level of detail's scene cache, so the level needs no place in the key.
  const key = `${b.index}|${b.type}|${b.tx},${b.ty}|${b.baseZ}|${b.operable}|${Math.round(b.activity * 20)}`;
  const kept = cache.get(key);
  if (kept === undefined) {
    const runs: Shape[][] = [[]];
    for (const item of kit.items) {
      const start = out.length;
      emitParts(raise(asList(item.make()), b.baseZ), out);
      if (item.live) runs.push([]);
      else runs[runs.length - 1]!.push(...out.slice(start));
    }
    cache.set(key, runs);
    return;
  }
  let run = 0;
  for (const shape of kept[0]!) out.push(shape);
  for (const item of kit.items) {
    if (!item.live) continue;
    emitParts(raise(asList(item.make()), b.baseZ), out);
    run += 1;
    for (const shape of kept[run] ?? []) out.push(shape);
  }
}

/** Forget the cached order and ground shapes: the next frame is built from scratch. */
export function resetSceneCache(): void {
  sceneCaches.clear();
}

/**
 * A cheap fingerprint of the ground, so a cache kept for one terrain is never
 * used for another (a retune, or a different settlement with the same id).
 */
function groundKey(view: CityView): string {
  let sum = 0;
  let weighted = 0;
  view.groundZ.forEach((z, i) => {
    sum += z;
    weighted += z * ((i % 97) + 1);
  });
  // Roads are ground too: laying one must redraw it.
  let roads = 0;
  let roadWeight = 0;
  view.roads.forEach((r, i) => {
    if (!r) return;
    roads += 1;
    roadWeight += (i % 101) + 1;
  });
  return `${sum}|${weighted}|${view.steep.filter(Boolean).length}|${roads}|${roadWeight}`;
}

/** At low detail, open ground is drawn in patches this many tiles across. */
const LOW_PATCH = 4;

function occupantsInOrder(view: CityView, quality: CityQuality): SceneCache {
  const n = view.tiles;
  const key = `${view.id}|${n}|${groundKey(view)}|${view.buildings.map((b) => `${b.tx},${b.ty},${b.size}`).join(";")}`;
  const cached = sceneCaches.get(quality);
  if (cached !== undefined && cached.key === key) return cached;
  const covered = new Set<number>();
  const occupants: Occupant[] = view.buildings.map((b) => {
    for (let y = b.ty; y < b.ty + b.size; y += 1) for (let x = b.tx; x < b.tx + b.size; x += 1) covered.add(y * n + x);
    return { tx: b.tx, ty: b.ty, w: b.size, h: b.size, building: b.index };
  });
  // Open ground: tile by tile, or at low detail in patches wherever a whole
  // patch is open (a patch that a building touches falls back to its tiles).
  const done = new Uint8Array(n * n);
  if (quality === "low") {
    for (let py = 0; py + LOW_PATCH <= n; py += LOW_PATCH) {
      for (let px = 0; px + LOW_PATCH <= n; px += LOW_PATCH) {
        let open = true;
        // Only a patch that is flat: merging slopes erased the terraces and
        // painted whole patches steep, and the far view looked less like the
        // near one than bare ground did (measured).
        const z0 = view.groundZ[py * n + px] ?? 0;
        for (let y = py; y < py + LOW_PATCH && open; y += 1) {
          for (let x = px; x < px + LOW_PATCH; x += 1) {
            if (covered.has(y * n + x) || view.steep[y * n + x] === true || view.roads[y * n + x] === true || (view.groundZ[y * n + x] ?? 0) !== z0) open = false;
          }
        }
        if (!open) continue;
        for (let y = py; y < py + LOW_PATCH; y += 1) for (let x = px; x < px + LOW_PATCH; x += 1) done[y * n + x] = 1;
        occupants.push({ tx: px, ty: py, w: LOW_PATCH, h: LOW_PATCH, building: -1 });
      }
    }
  }
  for (let ty = 0; ty < n; ty += 1) {
    for (let tx = 0; tx < n; tx += 1) {
      if (!covered.has(ty * n + tx) && !done[ty * n + tx]) occupants.push({ tx, ty, w: 1, h: 1, building: -1 });
    }
  }
  // One connection point per side of a building: the road tile nearest the
  // middle of that side (the first version put one on every road tile a
  // building touched, and a street read as a row of bollards).
  const connectors = new Set<number>();
  for (const b of view.buildings) {
    const mid = Math.floor(b.size / 2);
    const offsets = Array.from({ length: b.size }, (_, k) => mid + (k % 2 === 0 ? k / 2 : -(k + 1) / 2)).filter((k) => k >= 0 && k < b.size);
    // [road x, road y, side index] for each side, walked out from its middle.
    const sides: ((k: number) => [number, number, number])[] = [
      (k) => [b.tx - 1, b.ty + k, 0],
      (k) => [b.tx + b.size, b.ty + k, 1],
      (k) => [b.tx + k, b.ty - 1, 2],
      (k) => [b.tx + k, b.ty + b.size, 3],
    ];
    for (const side of sides) {
      for (const k of offsets) {
        const [x, y, dir] = side(k);
        if (x < 0 || y < 0 || x >= n || y >= n || view.roads[y * n + x] !== true) continue;
        connectors.add((y * n + x) * 4 + dir);
        break;
      }
    }
  }
  const fresh: SceneCache = { key, occupants, order: depthOrder(occupants), ground: new Map(), buildings: new Map(), runs: null, connectors };
  sceneCaches.set(quality, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Roads (at the user's request): the surface, where it meets a building, and
// the rovers that drive it.
// ---------------------------------------------------------------------------

const ROAD = rgb(0.34, 0.31, 0.29);
/**
 * A road as it reads from further away, where its kerbs, dashes and rovers
 * are not drawn: the surface scaled by the mean colour of the full drawing
 * over the bare one (measured on the example metropolis's streets: x1.113,
 * x1.127, x1.103). With the bare surface, the far view lost a fifth of its
 * likeness to the near one.
 */
const ROAD_FAR = rgb(0.378, 0.349, 0.32);
const KERB = rgb(0.6, 0.57, 0.52);
const ROAD_DASH = rgb(0.86, 0.74, 0.38);
const CONNECTOR = rgb(0.68, 0.7, 0.72);
const CONNECTOR_LIGHT = rgb(1, 0.72, 0.25);

/**
 * A road tile's markings: a kerb along every edge that is not more road, a
 * dash down the middle of a straight stretch, and a connection point - a
 * pedestal with a light, and a conduit to the wall - on every edge a
 * building stands against. Static, so kept with the ground.
 */
function roadDetail(view: CityView, connectors: ReadonlySet<number>, tx: number, ty: number, z: number, quality: CityQuality): Part[] {
  const n = view.tiles;
  const out: Part[] = [];
  const at = (x: number, y: number): number => (x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1);
  const isRoad = (x: number, y: number): boolean => view.roads[at(x, y)] === true;
  const e = isRoad(tx + 1, ty);
  const w = isRoad(tx - 1, ty);
  const s = isRoad(tx, ty + 1);
  const nn = isRoad(tx, ty - 1);
  const zz = z + 0.004;
  const flat = (x0: number, y0: number, x1: number, y1: number, colour: Rgb, emissive = false): Part =>
    part(sheet([[x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz]]), colour, emissive ? { emissive: true } : {});
  // Kerbs and dashes up close only: at medium they were most of the 23,000
  // shapes roads added to a zoomed-out metropolis (measured).
  if (quality === "high") {
    const k = 0.06;
    if (!nn) out.push(flat(tx, ty, tx + 1, ty + k, KERB));
    if (!s) out.push(flat(tx, ty + 1 - k, tx + 1, ty + 1, KERB));
    if (!w) out.push(flat(tx, ty, tx + k, ty + 1, KERB));
    if (!e) out.push(flat(tx + 1 - k, ty, tx + 1, ty + 1, KERB));
    const along = e || w;
    const across = nn || s;
    if (along && !across) out.push(flat(tx + 0.3, ty + 0.47, tx + 0.7, ty + 0.53, ROAD_DASH));
    else if (across && !along) out.push(flat(tx + 0.47, ty + 0.3, tx + 0.53, ty + 0.7, ROAD_DASH));
  }
  // Connection points: toward the building on each side this tile serves.
  const sides: [number, number, number, number][] = [
    [1, 0, tx + 0.78, ty + 0.5],
    [-1, 0, tx + 0.22, ty + 0.5],
    [0, 1, tx + 0.5, ty + 0.78],
    [0, -1, tx + 0.5, ty + 0.22],
  ];
  sides.forEach(([dx, dy, px, py], side) => {
    if (!connectors.has(at(tx, ty) * 4 + side)) return;
    const h = 0.07;
    out.push(part(box(px - h, py - h, z, px + h, py + h, z + 0.16), CONNECTOR));
    if (quality === "high") {
      out.push(part(box(px - 0.04, py - 0.04, z + 0.16, px + 0.04, py + 0.04, z + 0.2), CONNECTOR_LIGHT, { emissive: true }));
      // The conduit: from the pedestal to the wall.
      const ex = dx === 0 ? px : tx + (dx > 0 ? 1 : 0);
      const ey = dy === 0 ? py : ty + (dy > 0 ? 1 : 0);
      out.push(part(box(Math.min(px, ex) - 0.025, Math.min(py, ey) - 0.025, z, Math.max(px, ex) + 0.025, Math.max(py, ey) + 0.025, z + 0.05), DARK_METAL));
    }
  });
  return out;
}

/** The straight stretches of road, at least three tiles long: rover routes. Along x first, then y. */
function roadRuns(view: CityView): RoadRun[] {
  const n = view.tiles;
  const runs: RoadRun[] = [];
  const road = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < n && y < n && view.roads[y * n + x] === true;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
  ] as const) {
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (!road(x, y) || road(x - dx, y - dy)) continue;
        let length = 1;
        while (road(x + dx * length, y + dy * length)) length += 1;
        if (length >= 3) runs.push({ tx: x, ty: y, dx, dy, length });
      }
    }
  }
  return runs;
}

interface Rover {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Heading: +1 or -1 along the run's axis. */
  readonly dx: number;
  readonly dy: number;
  readonly hue: number;
}

/** Tiles per second. */
const ROVER_SPEED = 0.55;

/**
 * Where every rover is at `time`: each shuttles up and down its stretch of
 * road, turning at the ends. Render-time only (micro §8: aliveness is never
 * simulated), and a pure function of the layout and the time.
 */
function roversOn(view: CityView, cache: SceneCache, time: number): Map<number, Rover[]> {
  cache.runs ??= roadRuns(view);
  const n = view.tiles;
  const byTile = new Map<number, Rover[]>();
  cache.runs.forEach((run, r) => {
    // One rover per stretch, and one more for every ten tiles of it.
    const count = 1 + Math.floor(run.length / 10);
    const travel = run.length - 1;
    for (let k = 0; k < count; k += 1) {
      const offset = hash2(r * 7 + k, run.tx * 13 + run.ty) * 2 * travel;
      const t = (time * ROVER_SPEED + offset) % (2 * travel);
      const forward = t < travel;
      const along = forward ? t : 2 * travel - t;
      const x = run.tx + run.dx * along + 0.5;
      const y = run.ty + run.dy * along + 0.5;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      const tile = ty * n + tx;
      const z = view.groundZ[tile] ?? 0;
      const sign = forward ? 1 : -1;
      // Keep to the right of the dash.
      const side = 0.14 * sign;
      const rover: Rover = { x: x - run.dy * side, y: y + run.dx * side, z, dx: run.dx * sign, dy: run.dy * sign, hue: hash2(r + 3, k + 5) };
      const list = byTile.get(tile);
      if (list === undefined) byTile.set(tile, [rover]);
      else list.push(rover);
    }
  });
  return byTile;
}

const ROVER_BODY = rgb(0.9, 0.88, 0.84);
const ROVER_TRIM = [rgb(0.92, 0.48, 0.16), rgb(0.2, 0.5, 0.78), rgb(0.85, 0.72, 0.2)] as const;

/** A six-wheeled rover: chassis, cab, a stripe, a mast, and a headlamp facing where it is going. */
function drawRovers(list: readonly Rover[] | undefined, out: Shape[]): void {
  if (list === undefined) return;
  for (const r of list) {
    const ax = Math.abs(r.dx);
    // Half-extents along and across its heading.
    const hl = 0.19;
    const hw = 0.11;
    const ex = ax ? hl : hw;
    const ey = ax ? hw : hl;
    const trim = ROVER_TRIM[Math.floor(r.hue * ROVER_TRIM.length)] ?? ROVER_TRIM[0];
    const parts: Part[] = [];
    // Wheels: three a side.
    for (const u of [-0.13, 0, 0.13]) {
      for (const v of [-1, 1]) {
        const cx = r.x + (ax ? u : v * (hw + 0.005));
        const cy = r.y + (ax ? v * (hw + 0.005) : u);
        parts.push(part(box(cx - 0.035, cy - 0.035, r.z, cx + 0.035, cy + 0.035, r.z + 0.07), RUBBER));
      }
    }
    parts.push(part(box(r.x - ex, r.y - ey, r.z + 0.05, r.x + ex, r.y + ey, r.z + 0.12), ROVER_BODY));
    // The stripe along its flank.
    parts.push(part(box(r.x - ex - 0.002, r.y - ey - 0.002, r.z + 0.08, r.x + ex + 0.002, r.y + ey + 0.002, r.z + 0.095), trim));
    // The cab, at the front.
    const fx = r.x + r.dx * 0.09;
    const fy = r.y + r.dy * 0.09;
    const cab = 0.08;
    parts.push(part(box(fx - (ax ? cab : hw * 0.8), fy - (ax ? hw * 0.8 : cab), r.z + 0.12, fx + (ax ? cab : hw * 0.8), fy + (ax ? hw * 0.8 : cab), r.z + 0.2), GLASS));
    // A mast at the back, and the lamp at the front.
    const bx = r.x - r.dx * 0.13;
    const by = r.y - r.dy * 0.13;
    parts.push(part(box(bx - 0.01, by - 0.01, r.z + 0.12, bx + 0.01, by + 0.01, r.z + 0.3), DARK_METAL));
    const lx = r.x + r.dx * (hl + 0.005);
    const ly = r.y + r.dy * (hl + 0.005);
    parts.push(part(box(lx - 0.02, ly - 0.02, r.z + 0.08, lx + 0.02, ly + 0.02, r.z + 0.11), rgb(1, 0.95, 0.75), { emissive: true }));
    emitParts(parts, out);
  }
}

/** Lift a solid by `dz` tiles: a building assembled at ground zero, stood on its own ground. */
function raise(parts: readonly Part[], dz: number): Part[] {
  if (dz === 0) return [...parts];
  return parts.map((p) => ({ ...p, faces: p.faces.map((f) => ({ ...f, pts: f.pts.map(([x, y, z]) => [x, y, z + dz] as V3) })) }));
}

export function cityScene(view: CityView, options: CitySceneOptions): Shape[] {
  const n = view.tiles;
  const out: Shape[] = [];
  const range = groundRange(view);
  // Every column reaches down to the same floor, half a tile below the lowest ground.
  const floor = range.lo - 0.5;
  const span = Math.max(1e-9, range.hi - range.lo);

  const quality: CityQuality = options.quality ?? "high";
  const cache = occupantsInOrder(view, quality);
  const { occupants, order, ground, buildings } = cache;
  const badges: Shape[] = [];
  // Rovers move every frame, so they are never cached: each is drawn with
  // the road tile it is on (up close only).
  const rovers = quality === "high" ? roversOn(view, cache, options.time) : null;
  const vp = options.viewport;
  for (const i of order) {
    const o = occupants[i]!;
    if (vp !== undefined) {
      // The occupant's image: its columns across, and from the floor up to
      // the tallest thing it could carry (a building, a badge, a plume).
      const x0 = ((o.tx - o.ty - o.h) * TILE_W) / 2;
      const x1 = ((o.tx + o.w - o.ty) * TILE_W) / 2;
      const top = (o.building >= 0 ? (view.buildings[o.building]?.baseZ ?? 0) + buildingTop(view.buildings[o.building]!.type) + 1.5 : view.groundZ[o.ty * n + o.tx] ?? 0) + 0.6;
      const y0 = ((o.tx + o.ty) * TILE_H) / 2 - top * Z_PX;
      const y1 = ((o.tx + o.w + o.ty + o.h) * TILE_H) / 2 - floor * Z_PX;
      if (x1 < vp.minX || x0 > vp.maxX || y1 < vp.minY || y0 > vp.maxY) continue;
    }
    if (o.building < 0) {
      // Ground never animates: its shapes are built once per layout and kept
      // (Batch 22 - rebuilding ~1,000 columns cost most of a 9 ms frame).
      const kept = ground.get(i);
      if (kept !== undefined) {
        for (const shape of kept) out.push(shape);
        if (rovers !== null && o.w === 1) drawRovers(rovers.get(o.ty * n + o.tx), out);
        continue;
      }
      const start = out.length;
      if (o.w > 1) {
        // A low-detail patch: its mean height, steep-coloured if any of it is steep.
        let sum = 0;
        let anySteep = false;
        for (let y = o.ty; y < o.ty + o.h; y += 1) {
          for (let x = o.tx; x < o.tx + o.w; x += 1) {
            sum += view.groundZ[y * n + x] ?? 0;
            anySteep = anySteep || view.steep[y * n + x] === true;
          }
        }
        const zp = sum / (o.w * o.h);
        const patch = box(o.tx, o.ty, floor, o.tx + o.w, o.ty + o.h, zp);
        emitParts([part(patch.slice(1, 3), CLIFF)], out);
        out.push({ rings: [ringOf(patch[0]!.pts)], fill: { ...(anySteep ? GROUND_STEEP : mix(GROUND_LOW, GROUND_HIGH, (zp - range.lo) / span)), a: 1 } });
        ground.set(i, out.slice(start));
        continue;
      }
      const z = view.groundZ[o.ty * n + o.tx] ?? 0;
      const steep = view.steep[o.ty * n + o.tx] === true;
      const road = view.roads[o.ty * n + o.tx] === true;
      // Height as a colour ramp, and a faint checker so single tiles read.
      const ramp = mix(GROUND_LOW, GROUND_HIGH, (z - range.lo) / span);
      const checker = (o.tx + o.ty) % 2 === 0 ? 1 : 0.965;
      const top = road ? shade(quality === "high" ? ROAD : ROAD_FAR, 0.985 + 0.015 * checker) : shade(steep ? GROUND_STEEP : ramp, checker);
      const faces = box(o.tx, o.ty, floor, o.tx + 1, o.ty + 1, z);
      // Only the sides that rise above the nearer neighbour can show.
      const sides: Face[] = [];
      const east = o.tx + 1 < n ? view.groundZ[o.ty * n + o.tx + 1] ?? floor : floor;
      const south = o.ty + 1 < n ? view.groundZ[(o.ty + 1) * n + o.tx] ?? floor : floor;
      if (east < z) sides.push(faces[1]!);
      if (south < z) sides.push(faces[2]!);
      emitParts([part(sides, CLIFF)], out);
      out.push({ rings: [ringOf(faces[0]!.pts)], fill: { ...top, a: 1 } });
      if (road) {
        if (quality !== "low") emitParts(roadDetail(view, cache.connectors, o.tx, o.ty, z, quality), out);
      } else if (steep && quality !== "low") {
        const h = 0.18 + 0.3 * hash2(o.tx, o.ty);
        const r = 0.22 + 0.1 * hash2(o.ty + 91, o.tx);
        emitParts([part(frustum(o.tx + 0.5, o.ty + 0.5, r, r * 0.45, z, z + h, quality === "high" ? 7 : 5), ROCK)], out);
      } else if (quality === "high") {
        // Loose rocks on open ground (requested by the user: not only hills).
        emitParts(scatter(o.tx, o.ty, z), out);
      }
      ground.set(i, out.slice(start));
      if (rovers !== null) drawRovers(rovers.get(o.ty * n + o.tx), out);
      continue;
    }
    const b = view.buildings[o.building]!;
    // The plinth: the ground under the building, levelled at its highest point.
    const plinth = box(b.tx, b.ty, floor, b.tx + b.size, b.ty + b.size, b.baseZ);
    emitParts([part(plinth.slice(1, 3), CLIFF)], out);
    out.push({ rings: [ringOf(plinth[0]!.pts)], fill: { ...mix(GROUND_LOW, GROUND_HIGH, (b.baseZ - range.lo) / span), a: 1 } });
    const built = quality === "high" ? assemble(b, options.time) : quality === "medium" ? assembleMedium(b) : assembleLow(b);
    emitBuilding(built, b, buildings, out);
    // Steam and other particles only up close.
    if (quality === "high") out.push(...built.extras);
    // Not connected to what it needs reads differently from any other reason it is off.
    if (!b.operable) badges.push(...(b.network !== null ? unlinkedBadge : offlineBadge)(b.tx + b.size / 2, b.ty + b.size / 2, b.baseZ + buildingTop(b.type) + 0.35));
  }

  // Overlays, on top of everything so they are never hidden - each on its own ground.
  if (options.selected !== null) {
    const b = view.buildings[options.selected];
    if (b !== undefined) out.push(footprintRing(b.tx, b.ty, b.size, 0.12, { r: 1, g: 1, b: 1, a: 0.9 }, b.baseZ));
  }
  const g = options.ghost;
  if (g !== null) {
    const z = footprintTop(view, g.tx, g.ty, g.size);
    out.push({
      rings: [diamond(g.tx, g.ty, g.tx + g.size, g.ty + g.size, z)],
      fill: g.valid ? { r: 1, g: 1, b: 1, a: 0.28 } : { r: 0.95, g: 0.35, b: 0.3, a: 0.35 },
    });
    out.push(footprintRing(g.tx, g.ty, g.size, 0.06, { r: 1, g: 1, b: 1, a: 0.85 }, z));
    if (!g.valid) {
      // A cross, so "cannot build here" reads without colour.
      const cross: Rgba = { r: 1, g: 1, b: 1, a: 0.9 };
      // Through the edge midpoints, which project to the screen's diagonals.
      const mx = g.tx + g.size / 2;
      const my = g.ty + g.size / 2;
      out.push({ rings: [groundStrip(g.tx + 0.2, my, g.tx + g.size - 0.2, my, 0.05, z)], fill: cross });
      out.push({ rings: [groundStrip(mx, g.ty + 0.2, mx, g.ty + g.size - 0.2, 0.05, z)], fill: cross });
    }
  }
  out.push(...badges);
  return out;
}

/** What a screen point lands on first: a building, a tile of ground, or nothing. */
export type RayHit =
  | { readonly kind: "building"; readonly index: number; readonly tx: number; readonly ty: number }
  | { readonly kind: "ground"; readonly tx: number; readonly ty: number };

/**
 * The first solid along the line of sight through an iso-pixel point: every
 * tile of ground not under a building (a column from the floor to its top),
 * and every building (its plinth and body, from the floor to its top).
 *
 * The line through a screen point is the ground point beneath it plus
 * s * (1, 1, 1) (`iso.ts`), with larger s nearer the viewer. For a box it
 * spans s from max(x0 - gx, y0 - gy, z0) to min(x1 - gx, y1 - gy, z1); the
 * surface the viewer sees is the box whose span reaches furthest toward them.
 * Exact, not marched: a first version stepped along the line 0.02 tiles at a
 * time and agreed with this on only 99.15% of screen points - it clipped the
 * corners of columns between steps and picked the tile behind (Batch 22).
 * Heights come from the same view the picture was drawn from, and building
 * heights from the table the assemblies use, so what is clickable is what is
 * drawn.
 */
export function rayHit(view: CityView, sx: number, sy: number): RayHit | null {
  const n = view.tiles;
  const g = isoToGround(sx, sy);
  const floor = groundRange(view).lo - 0.5;
  let best = -Infinity;
  let hit: RayHit | null = null;
  const covered = new Set<number>();
  for (const b of view.buildings) {
    for (let y = b.ty; y < b.ty + b.size; y += 1) for (let x = b.tx; x < b.tx + b.size; x += 1) covered.add(y * n + x);
    const near = Math.min(b.tx + b.size - g.x, b.ty + b.size - g.y, b.baseZ + buildingTop(b.type));
    const far = Math.max(b.tx - g.x, b.ty - g.y, floor);
    if (far < near && near > best) {
      best = near;
      hit = { kind: "building", index: b.index, tx: Math.min(b.tx + b.size - 1, Math.max(b.tx, Math.floor(g.x + near))), ty: Math.min(b.ty + b.size - 1, Math.max(b.ty, Math.floor(g.y + near))) };
    }
  }
  for (let ty = 0; ty < n; ty += 1) {
    for (let tx = 0; tx < n; tx += 1) {
      if (covered.has(ty * n + tx)) continue;
      const near = Math.min(tx + 1 - g.x, ty + 1 - g.y, view.groundZ[ty * n + tx] ?? 0);
      const far = Math.max(tx - g.x, ty - g.y, floor);
      if (far < near && near > best) {
        best = near;
        hit = { kind: "ground", tx, ty };
      }
    }
  }
  return hit;
}

/** Tile height of the scene in pixels at scale 1: exported so hosts can fit it. */
export const CITY_TILE_PX = { w: TILE_W, h: TILE_H } as const;
