/**
 * Detail §3.1 - terrain resource deposits (Batch 37).
 *
 *   | Deposit                | Boosts            | Typical location              |
 *   | Ore / metal vein       | Regolith Mine     | ridges, crater rims           |
 *   | Subsurface ice lens    | Water Extractor   | low basins, poleward sites    |
 *   | Geothermal vent        | Geothermal Plant  | fault lines                   |
 *   | High-insolation flat   | Solar Array       | flat, high, unshadowed tiles  |
 *
 * DERIVED, never stored: a deposit is a function of the site's natural
 * terrain (`terrainHeight`, before anyone levelled anything) at SITE
 * coordinates, so the same place always has the same deposits and claiming
 * land never moves one. Nothing is depleted, so the save holds none of it.
 *
 * A tile is judged against a ring of ground `DEPOSIT_RING_TILES` round it -
 * twelve tile corners, symmetric about its centre:
 *   - ore where it stands ORE_RISE_M above the ring's mean (convex: a ridge,
 *     a hilltop, a crater's rim);
 *   - ice where it lies ICE_DIP_M x cos(latitude) below it (a basin; the
 *     poleward the site, the shallower a hollow that holds ice);
 *   - a vent on the site's fault line - the contour the canyons are cut
 *     along - on the stretches a slow noise picks;
 *   - sun on flat ground SUN_HIGH_M above the base with no corner of its ring
 *     above it (nothing near to shade it).
 * One deposit a tile at most (detail §1.3's `resource?`): a vent first, then
 * ore, ice and sun.
 *
 * The bonus goes through each building's efficiency (settlement.ts): a
 * building makes x(1 + bonus x share), the share of its footprint on its
 * own deposit. Bare ground keeps today's output - a bonus only.
 */

import type { HabitatChannels } from "../habitat.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, PlacedBuilding } from "../types.js";
import { BUILDING_DEFS } from "./buildings.js";
import type { FrameSource } from "./space.js";
import { frameOf } from "./space.js";
import { faultCourse, featureNoise, groundOf, placeSeed, terrainHeight } from "./terrain.js";

export type DepositKind = "ore" | "ice" | "vent" | "sun";

/** In code order: a tile's code is 1 + its kind's index here, 0 for none. */
export const DEPOSIT_KINDS: readonly DepositKind[] = ["ore", "ice", "vent", "sun"];

/** The building each deposit boosts. */
export const DEPOSIT_BOOSTS: Readonly<Record<DepositKind, BuildingType>> = {
  ore: "regolith_mine",
  ice: "water_extractor",
  vent: "geothermal_plant",
  sun: "solar_array",
};

/** The deposit a type is boosted by, or null. */
export function depositFor(type: BuildingType): DepositKind | null {
  for (const k of DEPOSIT_KINDS) if (DEPOSIT_BOOSTS[k] === type) return k;
  return null;
}

/** A kind's full bonus as a share (x(1 + this) wholly on it), as the planet stands: the ice's fades with liquid water in reach. */
export function depositBonus(kind: DepositKind, env: HabitatChannels, t: Tuning): number {
  if (kind === "ore") return t.ORE_BONUS;
  if (kind === "vent") return t.VENT_BONUS;
  if (kind === "sun") return t.SUN_BONUS;
  return t.ICE_BONUS * (1 - Math.min(1, Math.max(0, env.waterAccess)));
}

/** A settlement, or a bare place. */
type Place = FrameSource & { readonly lat: number; readonly lon: number };

/** Exactly 0, not -0: as the ground's own corners are kept (terrain.ts). */
function clean(v: number): number {
  return v === 0 ? 0 : v;
}

/** The salt of the noise that picks the fault's stretches with vents. */
const VENT_SALT = 0x7e47;

/** The diagonal ring's reach, tiles: the ring's radius along a diagonal. */
function diagonal(t: Tuning): number {
  return Math.max(1, Math.round(t.DEPOSIT_RING_TILES * Math.SQRT1_2));
}

/**
 * The twelve ring corners of site tile (sx, sy) as offsets from its own
 * corner (sx, sy), in the order they are summed - a pair either side along
 * each axis, and the four diagonals, symmetric about the tile's centre.
 * Both readers sum them in this order, so their floating point agrees.
 */
function ringOffsets(t: Tuning): readonly (readonly [number, number])[] {
  const r = t.DEPOSIT_RING_TILES;
  const q = diagonal(t);
  return [
    [-r, 0], [-r, 1], [1 + r, 0], [1 + r, 1],
    [0, -r], [1, -r], [0, 1 + r], [1, 1 + r],
    [-q, -q], [1 + q, -q], [-q, 1 + q], [1 + q, 1 + q],
  ];
}

/**
 * The deposit code of site tile (sx, sy), from its four corners (a at
 * (sx, sy), b east of it, c south, d south-east) and its ring's sum and
 * highest corner. The one rule, read by both the whole-frame map and the
 * single tile, so what the city view shows is what the simulation pays.
 */
function judge(seed: number, sx: number, sy: number, a: number, b: number, c: number, d: number, ringSum: number, ringTop: number, lat: number, t: Tuning): number {
  // A vent: on the fault line, on a stretch of it with vents. Not height: the fault runs under hills and plains alike.
  const cx = sx + 0.5;
  const cy = sy + 0.5;
  if (Math.abs(faultCourse(seed, cx, cy) - 0.5) < t.VENT_FAULT_WIDTH && featureNoise(seed, VENT_SALT, cx, cy, 12) > t.VENT_STRETCH_MIN) return 3;
  // As the ground has them: the mean of the corners, and the steepest rise along an edge.
  const h = clean((a + b + c + d) / 4);
  const slope = Math.max(Math.abs(a - b), Math.abs(c - d), Math.abs(a - c), Math.abs(b - d)) / t.TILE_METRES;
  const rel = h - ringSum / 12;
  if (rel >= t.ORE_RISE_M) return 1;
  if (rel <= -t.ICE_DIP_M * Math.cos(lat)) return 2;
  if (slope <= t.SUN_FLAT_SLOPE && h >= t.SUN_HIGH_M && ringTop <= h) return 4;
  return 0;
}

/** The deposit code of site tile (sx, sy), given the height at any site corner. */
function classify(corner: (x: number, y: number) => number, seed: number, sx: number, sy: number, lat: number, t: Tuning): number {
  let sum = 0;
  let top = -Infinity;
  for (const [dx, dy] of ringOffsets(t)) {
    const v = corner(sx + dx, sy + dy);
    sum += v;
    if (v > top) top = v;
  }
  return judge(seed, sx, sy, corner(sx, sy), corner(sx + 1, sy), corner(sx, sy + 1), corner(sx + 1, sy + 1), sum, top, lat, t);
}

/** The kind for a code, or null. */
export function depositOfCode(code: number): DepositKind | null {
  return DEPOSIT_KINDS[code - 1] ?? null;
}

/**
 * The deposit on site tile (sx, sy) of a place, straight from the terrain
 * function: what `depositsOf` holds for the same tile. None with deposits off.
 */
export function depositAt(place: Place, sx: number, sy: number, t: Tuning): DepositKind | null {
  if (!t.DEPOSITS_ENABLED) return null;
  const seed = placeSeed(place.lat, place.lon);
  const base = frameOf(place, t).base;
  return depositOfCode(classify((x, y) => clean(terrainHeight(seed, base, x, y, t)), seed, sx, sy, place.lat, t));
}

/** Whole-frame maps, recently made: a view asks for its city's every frame. */
const maps = new Map<string, Uint8Array>();
const KEEP_MAPS = 8;

/** The empty map of a place with deposits off. */
const NONE = new Uint8Array(0);

/**
 * Every tile of a place's frame, row-major (`ty * n + tx`, local tiles): its
 * deposit's code (1 + its index in DEPOSIT_KINDS), 0 for none. Empty with
 * deposits off. Read from the ground's corners where the frame has them, and
 * from the terrain function round its edge - the same heights, so the same
 * deposits as `depositAt`.
 */
export function depositsOf(place: Place, t: Tuning): Uint8Array {
  if (!t.DEPOSITS_ENABLED) return NONE;
  const key = mapKey(place, t);
  const kept = maps.get(key);
  if (kept !== undefined) {
    maps.delete(key);
    maps.set(key, kept);
    return kept;
  }
  const steps = depositSteps(place, t);
  for (;;) {
    const r = steps.next();
    if (r.done === true) return keep(key, r.value);
  }
}

function mapKey(place: Place, t: Tuning): string {
  const f = frameOf(place, t);
  return [place.lat, place.lon, place.kind, f.base, f.x0, f.y0, f.n, ...DEPOSIT_TUNING.map((k) => t[k])].join("|");
}

function keep(key: string, map: Uint8Array): Uint8Array {
  maps.set(key, map);
  while (maps.size > KEEP_MAPS) maps.delete(maps.keys().next().value as string);
  return map;
}

/**
 * Make a place's deposit map a little at a time, yielding how far through it
 * is, 0 to 1, and keep it where `depositsOf` looks (a metropolis's took
 * 120 ms in one go, measured). Nothing to do with deposits off, or kept.
 */
export function* prepareDeposits(place: Place, t: Tuning): Generator<number, void> {
  if (!t.DEPOSITS_ENABLED) return;
  const key = mapKey(place, t);
  if (maps.has(key)) return;
  const steps = depositSteps(place, t);
  for (;;) {
    const r = steps.next();
    if (r.done === true) {
      keep(key, r.value);
      return;
    }
    yield r.value;
  }
}

/**
 * The map, a band of rows at a time. Corners are read from the ground where
 * the frame has them and made from the terrain function in a band round it
 * (the ring reaches past the frame's edge), into one padded grid.
 */
function* depositSteps(place: Place, t: Tuning): Generator<number, Uint8Array> {
  const f = frameOf(place, t);
  const { cornersM } = groundOf(place, t);
  const seed = placeSeed(place.lat, place.lon);
  const n = f.n;
  const m = n + 1;
  const pad = Math.max(t.DEPOSIT_RING_TILES, diagonal(t)) + 1;
  const w = m + 2 * pad;
  const grid = new Float64Array(w * w);
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const gx = x - pad;
      const gy = y - pad;
      grid[y * w + x] = gx >= 0 && gy >= 0 && gx < m && gy < m ? cornersM[gy * m + gx]! : clean(terrainHeight(seed, f.base, gx + f.x0, gy + f.y0, t));
    }
  }
  const ring = ringOffsets(t).map(([dx, dy]) => dy * w + dx);
  const out = new Uint8Array(n * n);
  for (let ty = 0; ty < n; ty += 1) {
    for (let tx = 0; tx < n; tx += 1) {
      const at = (ty + pad) * w + tx + pad;
      let sum = 0;
      let top = -Infinity;
      for (const o of ring) {
        const v = grid[at + o]!;
        sum += v;
        if (v > top) top = v;
      }
      out[ty * n + tx] = judge(seed, tx + f.x0, ty + f.y0, grid[at]!, grid[at + 1]!, grid[at + w]!, grid[at + w + 1]!, sum, top, place.lat, t);
    }
    if (ty % 32 === 31) yield (ty + 1) / n;
  }
  return out;
}

/** Every constant a deposit depends on beyond the place, for the kept maps' key. */
const DEPOSIT_TUNING = [
  "DEPOSIT_RING_TILES",
  "ORE_RISE_M",
  "ICE_DIP_M",
  "VENT_FAULT_WIDTH",
  "VENT_STRETCH_MIN",
  "SUN_HIGH_M",
  "SUN_FLAT_SLOPE",
  "TERRAIN_RELIEF_M",
  "TERRAIN_FEATURE_TILES",
  "TERRAIN_CLEAR_TILES",
  "TERRAIN_MOUNTAIN_SCALE",
  "TERRAIN_CANYON_SCALE",
  "TERRAIN_PIT_SCALE",
  "TILE_METRES",
] as const satisfies readonly (keyof Tuning)[];

/** Per tuning, per site: each site tile asked about, by its packed key - a building's tiles, asked once. */
const siteTiles = new WeakMap<Tuning, Map<string, Map<number, number>>>();

/** The code of site tile (sx, sy) at a place, kept: the simulation asks for the tiles under its buildings. */
function codeAt(place: Place, sx: number, sy: number, t: Tuning): number {
  let sites = siteTiles.get(t);
  if (sites === undefined) {
    sites = new Map();
    siteTiles.set(t, sites);
  }
  const base = frameOf(place, t).base;
  const siteKey = `${place.lat}|${place.lon}|${base}`;
  let tiles = sites.get(siteKey);
  if (tiles === undefined) {
    if (sites.size > 256) sites.clear();
    tiles = new Map();
    sites.set(siteKey, tiles);
  }
  const k = (sy + 32768) * 65536 + (sx + 32768);
  let code = tiles.get(k);
  if (code === undefined) {
    const seed = placeSeed(place.lat, place.lon);
    code = classify((x, y) => clean(terrainHeight(seed, base, x, y, t)), seed, sx, sy, place.lat, t);
    tiles.set(k, code);
  }
  return code;
}

/** What each building stands on: the share of its footprint on its own deposit, and which deposit (an index into DEPOSIT_KINDS, -1 for none). */
export interface Siting {
  readonly shares: Float64Array;
  readonly kinds: Int8Array;
}

const sitings = new WeakMap<readonly PlacedBuilding[], { t: Tuning; lat: number; lon: number; x0: number; y0: number; base: number; siting: Siting | null }>();

/**
 * For a settlement's buildings, the share of each one's footprint on the
 * deposit that boosts it - or null when none stands on one (or deposits are
 * off). Kept per building list: it changes only when something is built.
 */
export function sitingOf(s: Place & { readonly buildings: readonly PlacedBuilding[] }, t: Tuning): Siting | null {
  if (!t.DEPOSITS_ENABLED) return null;
  const f = frameOf(s, t);
  const kept = sitings.get(s.buildings);
  if (kept !== undefined && kept.t === t && kept.lat === s.lat && kept.lon === s.lon && kept.x0 === f.x0 && kept.y0 === f.y0 && kept.base === f.base) return kept.siting;
  const shares = new Float64Array(s.buildings.length);
  const kinds = new Int8Array(s.buildings.length).fill(-1);
  let any = false;
  s.buildings.forEach((b, i) => {
    const kind = depositFor(b.type);
    if (kind === null) return;
    const def = BUILDING_DEFS[b.type];
    const want = DEPOSIT_KINDS.indexOf(kind) + 1;
    let on = 0;
    for (let y = b.ty; y < b.ty + def.depth; y += 1) for (let x = b.tx; x < b.tx + def.footprint; x += 1) if (codeAt(s, x + f.x0, y + f.y0, t) === want) on += 1;
    if (on === 0) return;
    shares[i] = on / (def.footprint * def.depth);
    kinds[i] = want - 1;
    any = true;
  });
  const siting = any ? { shares, kinds } : null;
  sitings.set(s.buildings, { t, lat: s.lat, lon: s.lon, x0: f.x0, y0: f.y0, base: f.base, siting });
  return siting;
}

/**
 * What a building of `type` with its corner on local tile (tx, ty) would make
 * for its deposit, as a factor (1 on bare ground), and how many of its tiles
 * lie on it - the placement preview's words, read off the same rule the
 * simulation pays by.
 */
export function sitingPreview(s: Place, type: BuildingType, tx: number, ty: number, env: HabitatChannels, t: Tuning): { readonly kind: DepositKind; readonly on: number; readonly of: number; readonly factor: number } | null {
  const kind = depositFor(type);
  if (kind === null || !t.DEPOSITS_ENABLED) return null;
  const f = frameOf(s, t);
  const def = BUILDING_DEFS[type];
  const want = DEPOSIT_KINDS.indexOf(kind) + 1;
  let on = 0;
  for (let y = ty; y < ty + def.depth; y += 1) for (let x = tx; x < tx + def.footprint; x += 1) if (codeAt(s, x + f.x0, y + f.y0, t) === want) on += 1;
  const of = def.footprint * def.depth;
  return { kind, on, of, factor: 1 + depositBonus(kind, env, t) * (on / of) };
}
