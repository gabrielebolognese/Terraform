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
import { TOWARD_VIEWER, TILE_H, TILE_W, Z_PX, depthOrder, isoProject } from "./iso.js";
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
}

// ---------------------------------------------------------------------------
// Palette and light
// ---------------------------------------------------------------------------

const rgb = (r: number, g: number, b: number): Rgb => ({ r, g, b });

export const CITY_BACKGROUND: Rgba = { r: 0.086, g: 0.09, b: 0.102, a: 1 };

const GROUND = rgb(0.56, 0.36, 0.25);
const GROUND_ROUGH = rgb(0.4, 0.26, 0.19);
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
  habitat_dome: 1.45,
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

interface Built {
  readonly parts: Part[];
  /** Height of the tallest part, tiles: where the status badge floats. */
  readonly top: number;
  readonly extras: Shape[];
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

function assemble(b: CityBuildingView, time: number): Built {
  const s = b.size;
  const x0 = b.tx;
  const y0 = b.ty;
  const cx = x0 + s / 2;
  const cy = y0 + s / 2;
  const on = b.operable;
  const act = b.activity;
  const parts: Part[] = [];
  const extras: Shape[] = [];
  const pad = (h = 0.06, inset = 0.08): void => {
    parts.push(part(box(x0 + inset, y0 + inset, 0, x0 + s - inset, y0 + s - inset, h), CONCRETE));
  };

  switch (b.type) {
    case "habitat_dome": {
      // "A dome is a hemisphere plus a base ring."
      parts.push(part(frustum(cx, cy, 1.38, 1.34, 0, 0.18, 28), CONCRETE));
      parts.push(part(dome(cx, cy, 0.18, 1.24), GLASS));
      // Window lights around the base ring: how full the dome is.
      const lit = Math.round(act * 8);
      for (let i = 0; i < 8; i += 1) {
        const a = -Math.PI / 4 + (i / 7) * Math.PI;
        const wx = cx + 1.36 * Math.cos(a);
        const wy = cy + 1.36 * Math.sin(a);
        parts.push(part(box(wx - 0.05, wy - 0.05, 0.06, wx + 0.05, wy + 0.05, 0.13), i < lit ? WARM_LIGHT : UNLIT, { emissive: true }));
      }
      // Airlock toward the viewer.
      parts.push(part(box(cx + 0.95, cy + 0.95, 0, cx + 1.3, cy + 1.3, 0.34), METAL));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "solar_array": {
      pad(0.04);
      // Four panels on posts, tilted toward the low sun.
      const colour = on ? mix(PANEL, PANEL_ON, Math.max(0.4, act)) : PANEL;
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const px = x0 + u + 0.12;
        const py = y0 + v + 0.18;
        parts.push(part(box(px + 0.33, py + 0.3, 0.04, px + 0.43, py + 0.4, 0.34), DARK_METAL));
        parts.push(
          part(
            sheet([
              [px, py, 0.5],
              [px + 0.76, py, 0.5],
              [px + 0.76, py + 0.62, 0.22],
              [px, py + 0.62, 0.22],
            ]),
            colour,
            { twoSided: true },
          ),
        );
      }
      return { parts, top: buildingTop(b.type), extras };
    }
    case "geothermal_plant": {
      pad();
      parts.push(part(box(x0 + 0.3, y0 + 0.45, 0.06, x0 + 0.95, y0 + 0.62, 0.3), DARK_METAL));
      parts.push(part(frustum(x0 + 1.35, y0 + 0.6, 0.42, 0.3, 0.06, 1.15, 20), METAL));
      parts.push(part(box(x0 + 0.2, y0 + 1.0, 0.06, x0 + 1.5, y0 + 1.8, 0.62), CONCRETE));
      extras.push(...plume(x0 + 1.35, y0 + 0.6, 1.15, time, on));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "reactor": {
      // "A reactor is a core plus towers plus pipes." Core brightness = load.
      pad();
      parts.push(part(frustum(x0 + 0.45, y0 + 0.4, 0.14, 0.14, 0.06, 1.35, 12), METAL));
      parts.push(part(frustum(x0 + 0.4, y0 + 1.2, 0.14, 0.14, 0.06, 1.35, 12), METAL));
      parts.push(part(box(x0 + 0.5, y0 + 0.75, 0.2, cx + 0.1, y0 + 0.85, 0.3), DARK_METAL));
      // The containment, in three stacked rings so the glowing core band sits
      // in the wall rather than inside it.
      const glow = on ? mix(UNLIT, COLD_LIGHT, 0.25 + 0.75 * act) : UNLIT;
      parts.push(part(frustum(cx + 0.25, cy + 0.1, 0.55, 0.55, 0.06, 0.4, 24), CONCRETE));
      parts.push(part(frustum(cx + 0.25, cy + 0.1, 0.56, 0.56, 0.4, 0.52, 24), glow, { emissive: true }));
      parts.push(part(frustum(cx + 0.25, cy + 0.1, 0.55, 0.55, 0.52, 0.8, 24), CONCRETE));
      parts.push(part(dome(cx + 0.25, cy + 0.1, 0.8, 0.55, 20, 5), CONCRETE));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "water_extractor": {
      pad(0.18, 0.1);
      parts.push(part(box(cx - 0.15, cy - 0.15, 0.18, cx + 0.15, cy + 0.15, 1.2), DARK_METAL));
      parts.push(part(frustum(x0 + 0.55, y0 + 1.45, 0.33, 0.33, 0.18, 0.72, 18), WATER));
      // "Extractor arms move when operable."
      const angle = on ? time * 1.2 : 0.6;
      parts.push(part(turnedBox(cx, cy, 0.72, 0.06, angle, 1.05, 1.15), METAL));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "atmosphere_processor": {
      pad();
      parts.push(part(frustum(x0 + 0.55, y0 + 0.3, 0.2, 0.2, 0.06, 0.55, 14), DARK_METAL));
      parts.push(part(frustum(x0 + 1.1, y0 + 0.3, 0.2, 0.2, 0.06, 0.55, 14), DARK_METAL));
      parts.push(part(box(x0 + 0.25, y0 + 0.5, 0.06, x0 + 1.7, y0 + 1.6, 0.7), METAL));
      const light = on ? COLD_LIGHT : UNLIT;
      parts.push(part(box(x0 + 0.5, y0 + 1.6, 0.35, x0 + 1.2, y0 + 1.62, 0.45), light, { emissive: true }));
      parts.push(part(frustum(x0 + 1.45, y0 + 1.1, 0.16, 0.12, 0.7, 1.45, 14), CONCRETE));
      extras.push(...plume(x0 + 1.45, y0 + 1.1, 1.45, time, on));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "greenhouse": {
      pad(0.1);
      parts.push(part(box(x0 + 0.15, y0 + 0.35, 0.1, x0 + 1.85, y0 + 1.65, 0.3), CONCRETE));
      parts.push(part(vault(x0 + 0.15, x0 + 1.85, cy, 0.65, 0.3), on ? LEAF : LEAF_OFF, { alpha: 0.95 }));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "regolith_mine": {
      parts.push(part(box(x0 + 0.1, y0 + 0.1, 0, x0 + 1.1, y0 + 1.1, 0.02), rgb(0.3, 0.19, 0.14)));
      parts.push(part(box(x0 + 0.45, y0 + 0.45, 0, x0 + 0.75, y0 + 0.75, 0.3), rgb(0.85, 0.66, 0.2)));
      // The digger's boom swings while the mine runs.
      const angle = on ? 0.6 + 0.5 * Math.sin(time * 0.9) : 0.6;
      parts.push(part(turnedBox(x0 + 0.6, y0 + 0.6, 0.45, 0.07, angle, 0.25, 0.35), rgb(0.85, 0.66, 0.2)));
      parts.push(part(box(x0 + 1.2, y0 + 0.2, 0, x0 + 1.85, y0 + 0.95, 0.75), DARK_METAL));
      parts.push(part(box(x0 + 1.25, y0 + 1.15, 0, x0 + 1.85, y0 + 1.85, 0.4), CONCRETE));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "storage_depot": {
      pad(0.04, 0.04);
      parts.push(part(box(x0 + 0.08, y0 + 0.08, 0.04, x0 + 0.5, y0 + 0.92, 0.42), CONCRETE));
      parts.push(part(frustum(x0 + 0.72, y0 + 0.5, 0.22, 0.22, 0.04, 0.62, 16), METAL));
      return { parts, top: buildingTop(b.type), extras };
    }
    case "spaceport": {
      parts.push(part(frustum(cx - 0.1, cy - 0.1, 1.3, 1.3, 0, 0.1, 28), CONCRETE));
      // Pad lights, chasing round the ring while the port runs.
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * 2 * Math.PI;
        const lx = cx - 0.1 + 1.12 * Math.cos(a);
        const ly = cy - 0.1 + 1.12 * Math.sin(a);
        const litNow = on && (Math.floor(time * 3) + i) % 3 !== 0;
        parts.push(part(box(lx - 0.04, ly - 0.04, 0.1, lx + 0.04, ly + 0.04, 0.14), litNow ? WARM_LIGHT : UNLIT, { emissive: true }));
      }
      // A lander on the pad, and the control tower on the near corner.
      parts.push(part(frustum(cx - 0.1, cy - 0.1, 0.2, 0.2, 0.1, 1.1, 16), METAL));
      parts.push(part(frustum(cx - 0.1, cy - 0.1, 0.2, 0.0, 1.1, 1.45, 16), METAL));
      parts.push(part(box(x0 + 2.35, y0 + 2.35, 0, x0 + 2.85, y0 + 2.85, 0.9), CONCRETE));
      parts.push(part(box(x0 + 2.3, y0 + 2.3, 0.9, x0 + 2.9, y0 + 2.9, 1.1), on ? GLASS : DARK_METAL));
      return { parts, top: buildingTop(b.type), extras };
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

/** A ring around a footprint, on the ground. */
function footprintRing(tx: number, ty: number, size: number, width: number, fill: Rgba): Shape {
  return {
    rings: [diamond(tx - width, ty - width, tx + size + width, ty + size + width), diamond(tx, ty, tx + size, ty + size)],
    fill,
  };
}

/** A thin strip on the ground from a to b: the arms of the "cannot" cross. */
function groundStrip(ax: number, ay: number, bx: number, by: number, half: number): number[] {
  const dx = bx - ax;
  const dy = by - ay;
  const l = Math.hypot(dx, dy);
  const nx = (-dy / l) * half;
  const ny = (dx / l) * half;
  return ringOf([
    [ax + nx, ay + ny, 0],
    [bx + nx, by + ny, 0],
    [bx - nx, by - ny, 0],
    [ax - nx, ay - ny, 0],
  ]);
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/** The iso-pixel box a grid of `tiles` occupies, with room for the tallest building. */
export function sceneBounds(tiles: number): { minX: number; maxX: number; minY: number; maxY: number } {
  const half = (tiles * TILE_W) / 2;
  return { minX: -half, maxX: half, minY: -2 * Z_PX, maxY: tiles * TILE_H + 0.6 * Z_PX };
}

export function cityScene(view: CityView, options: CitySceneOptions): Shape[] {
  const n = view.tiles;
  const out: Shape[] = [];

  // Ground: the grid's slab, its top, the rough patches and the tile lines.
  emitParts([part(box(0, 0, -0.5, n, n, 0).slice(1, 3), CLIFF)], out);
  out.push({ rings: [diamond(0, 0, n, n)], fill: { ...GROUND, a: 1 } });
  for (let ty = 0; ty < n; ty += 1) {
    for (let tx = 0; tx < n; tx += 1) {
      if (view.rough[ty * n + tx] === true) out.push({ rings: [diamond(tx, ty, tx + 1, ty + 1)], fill: { ...GROUND_ROUGH, a: 1 } });
    }
  }
  const line: Rgba = { r: 0.2, g: 0.12, b: 0.08, a: 0.16 };
  for (let k = 0; k <= n; k += 1) {
    out.push({ rings: [diamond(k - 0.015, 0, k + 0.015, n)], fill: line });
    out.push({ rings: [diamond(0, k - 0.015, n, k + 0.015)], fill: line });
  }

  // Everything that stands on the ground, far to near: buildings and rocks.
  interface Occupant extends FootprintBox {
    readonly building: CityBuildingView | null;
  }
  const occupants: Occupant[] = view.buildings.map((b) => ({ tx: b.tx, ty: b.ty, w: b.size, h: b.size, building: b }));
  for (let ty = 0; ty < n; ty += 1) {
    for (let tx = 0; tx < n; tx += 1) {
      if (view.rough[ty * n + tx] === true) occupants.push({ tx, ty, w: 1, h: 1, building: null });
    }
  }
  const badges: Shape[] = [];
  for (const i of depthOrder(occupants)) {
    const o = occupants[i]!;
    if (o.building === null) {
      const h = 0.18 + 0.4 * hash2(o.tx, o.ty);
      const r = 0.3 + 0.12 * hash2(o.ty + 91, o.tx);
      emitParts([part(frustum(o.tx + 0.5, o.ty + 0.5, r, r * 0.45, 0, h, 7), ROCK)], out);
      continue;
    }
    const built = assemble(o.building, options.time);
    emitParts(built.parts, out);
    out.push(...built.extras);
    if (!o.building.operable) {
      badges.push(...offlineBadge(o.tx + o.w / 2, o.ty + o.h / 2, built.top + 0.35));
    }
  }

  // Overlays, on top of everything so they are never hidden.
  if (options.selected !== null) {
    const b = view.buildings[options.selected];
    if (b !== undefined) out.push(footprintRing(b.tx, b.ty, b.size, 0.12, { r: 1, g: 1, b: 1, a: 0.9 }));
  }
  const g = options.ghost;
  if (g !== null) {
    out.push({
      rings: [diamond(g.tx, g.ty, g.tx + g.size, g.ty + g.size)],
      fill: g.valid ? { r: 1, g: 1, b: 1, a: 0.28 } : { r: 0.95, g: 0.35, b: 0.3, a: 0.35 },
    });
    out.push(footprintRing(g.tx, g.ty, g.size, 0.06, { r: 1, g: 1, b: 1, a: 0.85 }));
    if (!g.valid) {
      // A cross, so "cannot build here" reads without colour.
      const cross: Rgba = { r: 1, g: 1, b: 1, a: 0.9 };
      // Through the edge midpoints, which project to the screen's diagonals.
      const mx = g.tx + g.size / 2;
      const my = g.ty + g.size / 2;
      out.push({ rings: [groundStrip(g.tx + 0.2, my, g.tx + g.size - 0.2, my, 0.05)], fill: cross });
      out.push({ rings: [groundStrip(mx, g.ty + 0.2, mx, g.ty + g.size - 0.2, 0.05)], fill: cross });
    }
  }
  out.push(...badges);
  return out;
}

/** Tile height of the scene in pixels at scale 1: exported so hosts can fit it. */
export const CITY_TILE_PX = { w: TILE_W, h: TILE_H } as const;
