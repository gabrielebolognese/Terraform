/**
 * Detail doc §2 - procedural structures (Batch 26): "complex, not detailed".
 *
 *   generateStructure(type, seed, level, hosts) -> { variant, instances }
 *
 * Two of §2.2's three layers were already built, by hand, one archetype a
 * type: the foundation and the SIGNATURE masses in `city.ts` (a dome on its
 * ring, a derrick over a pump house, a reactor's towers). What this module
 * adds is what makes each building its own and makes it grow:
 *
 *   - the VARIANT: the signature's parameters, drawn from the seed - how many
 *     cooling towers, how tall the derrick, how many tanks - within the
 *     archetype, so a type still reads at a glance (§2.3);
 *   - the GREEBLES (layer 3): small mechanical bits - pipes, tanks, vents,
 *     struts, panels, antennas, crates - scattered over the signature's own
 *     flat surfaces (its HOSTS, read off the drawn geometry), as many as
 *     GREEBLE_BASE[type] + level * GREEBLE_PER_LEVEL, so an upgraded
 *     building visibly accretes complexity (§2.4).
 *
 * Pure and seeded: the same (type, seed, level, hosts) always gives the same
 * list. The seed is the building's place (see `structureSeed`), so nothing
 * about the geometry is stored - it is made again from the save (§2.5).
 * Instances are in the building's own frame: tiles from its footprint's
 * corner, height from its base.
 */

/** The small palette of greeble primitives (§2.2: "six or seven meshes"). */
export type GreebleKind = "pipe" | "tank" | "vent" | "strut" | "panel" | "antenna" | "crate";

/** The flat material palette greebles are drawn in (§2.5), by name. */
export type GreebleColour = "metal" | "dark" | "paint" | "accent" | "hazard";

/** One placed greeble: a primitive, where and how big, its colour, and whether it is animated. */
export interface Instance {
  readonly kind: GreebleKind;
  /** Centre of its footprint and the height it stands on, in the building's frame. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Extent along x and y, and height. */
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly colour: GreebleColour;
  /** A blinking tip (antennas), driven at render time from whether the building runs. */
  readonly blink: boolean;
}

/** A flat, upward-facing surface of the signature: where greebles may stand. */
export interface Host {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z: number;
}

/** A solid of the signature, as a box: no greeble may stand inside one. */
export interface Box3 {
  readonly x0: number;
  readonly y0: number;
  readonly z0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
}

/** A signature's seeded parameters: each type reads only its own (absent for a type with none). */
export interface Variant {
  /** Reactor: cooling towers, 1 or 2 - a second from level 3 at the latest. */
  readonly towers: number;
  /** Reactor: cooling tower height, tiles. */
  readonly towerZ: number;
  /** Reactor: transformers in the switchyard, 1 or 2. */
  readonly transformers: number;
  /** Extractor: derrick height, tiles. */
  readonly derrickZ: number;
  /** Extractor: holding tanks, 1 or 2 - a second from level 4 at the latest. */
  readonly tanks: number;
  /** Extractor: the main tank's height, tiles. */
  readonly tankZ: number;
  /** Dome: the glass's radius, tiles. */
  readonly domeR: number;
  /** Dome: ribs round the glass. */
  readonly ribs: number;
  /** Dome: the mast's height over the crown, tiles. */
  readonly mastZ: number;
  /** Dome: annexes in the footprint's free corners - one at level 3, two at level 5. */
  readonly annexes: number;
}

/** How many greebles each type carries at level 0, before levels add theirs (§2.2). */
export const GREEBLE_BASE: Readonly<Record<string, number>> = {
  habitat_dome: 6,
  solar_array: 2,
  geothermal_plant: 6,
  reactor: 6,
  water_extractor: 4,
  atmosphere_processor: 7,
  greenhouse: 4,
  regolith_mine: 5,
  storage_depot: 2,
  spaceport: 6,
  rover_post: 3,
  laboratory: 6,
  algae_reactor: 5,
  skyscraper: 8,
  observatory: 5,
  station: 8,
  research_forum: 6,
  medical_center: 6,
  industrial_command: 7,
  wind_turbine: 0,
  mega_mall: 12,
  water_tank: 2,
  battery_bank: 3,
  freezer: 3,
  materials_depot: 3,
  park: 0,
  biosphere: 4,
  headquarters: 6,
};

/** Greebles each level adds (§2.4: "complexity scales with level"). */
export const GREEBLE_PER_LEVEL = 3;

/** How many greebles a building of this type and level carries. */
export function greebleBudget(type: string, level: number): number {
  const base = GREEBLE_BASE[type] ?? 3;
  // A type with no greebles (a park, a turbine) gains none by level either.
  return base === 0 ? 0 : base + Math.max(1, Math.floor(level)) * GREEBLE_PER_LEVEL;
}

/** Mulberry32 (§2.2's PRNG): a seed to a stream of numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A building's seed: its type and where it stands from its settlement's
 * founding square (the grid's tile index moves when the city claims land to
 * the west or north; this does not), and the settlement.
 */
export function structureSeed(settlement: string, type: string, fx: number, fy: number): number {
  let h = 2166136261;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  mix(settlement);
  mix("|");
  mix(type);
  mix(`|${fx},${fy}`);
  return h >>> 0;
}

/** The signature's parameters for this type, seed and level. */
export function variantOf(type: string, seed: number, level: number): Variant {
  // Its own stream, apart from the greebles', so adding a greeble kind never changes a building's shape.
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const pick = (lo: number, hi: number): number => lo + (hi - lo) * rnd();
  const lv = Math.max(1, Math.floor(level));
  const towers = Math.min(2, (rnd() < 0.5 ? 1 : 2) + (lv >= 3 ? 1 : 0));
  const tanks = Math.min(2, (rnd() < 0.35 ? 2 : 1) + (lv >= 4 ? 1 : 0));
  const transformers = Math.min(2, 1 + Math.floor(rnd() * 2) + (lv >= 2 ? 1 : 0));
  void type;
  return {
    towers,
    towerZ: pick(1.1, 1.42),
    transformers,
    derrickZ: pick(1.0, 1.4) + 0.04 * (lv - 1),
    tanks,
    tankZ: pick(0.6, 0.86),
    domeR: pick(1.14, 1.26),
    ribs: [12, 16, 20][Math.floor(rnd() * 3)]!,
    mastZ: pick(0.22, 0.46),
    annexes: lv >= 5 ? 2 : lv >= 3 ? 1 : 0,
  };
}

/** The palette: what a greeble is, how big it may be, and whether it wants a roof's height to stand out. */
const KINDS: readonly { kind: GreebleKind; weight: number; roofOnly: boolean; size: (r: () => number) => [number, number, number] }[] = [
  { kind: "vent", weight: 4, roofOnly: false, size: (r) => [0.08 + 0.06 * r(), 0.08 + 0.06 * r(), 0.05 + 0.04 * r()] },
  { kind: "tank", weight: 3, roofOnly: false, size: (r) => { const d = 0.09 + 0.08 * r(); return [d, d, 0.08 + 0.1 * r()]; } },
  { kind: "pipe", weight: 3, roofOnly: false, size: (r) => (r() < 0.5 ? [0.22 + 0.26 * r(), 0.04, 0.04] : [0.04, 0.22 + 0.26 * r(), 0.04]) },
  { kind: "crate", weight: 2, roofOnly: false, size: (r) => [0.07 + 0.07 * r(), 0.07 + 0.07 * r(), 0.05 + 0.05 * r()] },
  { kind: "panel", weight: 2, roofOnly: true, size: (r) => [0.12 + 0.06 * r(), 0.1 + 0.05 * r(), 0.1 + 0.06 * r()] },
  { kind: "strut", weight: 1, roofOnly: true, size: (r) => [0.03, 0.03, 0.12 + 0.14 * r()] },
  { kind: "antenna", weight: 1, roofOnly: true, size: (r) => [0.03, 0.03, 0.2 + 0.25 * r()] },
];
const TOTAL_WEIGHT = KINDS.reduce((a, k) => a + k.weight, 0);

const COLOURS: Readonly<Record<GreebleKind, readonly GreebleColour[]>> = {
  vent: ["metal", "dark"],
  tank: ["paint", "metal", "accent"],
  pipe: ["metal", "dark"],
  crate: ["hazard", "dark", "paint"],
  panel: ["dark", "metal"],
  strut: ["metal"],
  antenna: ["metal"],
};

/** Surfaces this low are the ground-level pad: no rooftop kit (masts, panels) stands there. */
const PAD_Z = 0.2;

/**
 * Layer 3: the greebles, scattered over the hosts - each host chosen by its
 * area, each greeble clear of the others on it and of every solid of the
 * signature it would stand inside (a few tries, then skipped).
 */
export function greeblesOf(type: string, seed: number, level: number, hosts: readonly Host[], solids: readonly Box3[] = []): Instance[] {
  const budget = greebleBudget(type, level);
  const usable = hosts.filter((h) => h.x1 - h.x0 >= 0.12 && h.y1 - h.y0 >= 0.12);
  if (budget === 0 || usable.length === 0) return [];
  const rnd = mulberry32(seed);
  // Roofs three times over the pad, area for area: kit on a roof reads as machinery, on the pad as litter.
  const area = usable.map((h) => (h.x1 - h.x0) * (h.y1 - h.y0) * (h.z >= PAD_Z ? 3 : 1));
  const total = area.reduce((a, b) => a + b, 0);
  const out: Instance[] = [];
  for (let g = 0; g < budget; g += 1) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      let r = rnd() * total;
      let hi = 0;
      while (hi < usable.length - 1 && (r -= area[hi]!) >= 0) hi += 1;
      const host = usable[hi]!;
      let w = rnd() * TOTAL_WEIGHT;
      let ki = 0;
      while (ki < KINDS.length - 1 && (w -= KINDS[ki]!.weight) >= 0) ki += 1;
      let spec = KINDS[ki]!;
      // Rooftop kit only on a roof; on the pad, the nearest ground-level kind.
      if (spec.roofOnly && host.z < PAD_Z) spec = KINDS[g % 4]!;
      const [sx, sy, sz] = spec.size(rnd);
      const fx = host.x1 - host.x0 - sx;
      const fy = host.y1 - host.y0 - sy;
      if (fx < 0 || fy < 0) continue;
      const x = host.x0 + sx / 2 + fx * rnd();
      const y = host.y0 + sy / 2 + fy * rnd();
      const clear =
        out.every((o) => o.z !== host.z || Math.abs(o.x - x) * 2 > o.sx + sx + 0.02 || Math.abs(o.y - y) * 2 > o.sy + sy + 0.02) &&
        // Under nothing that rises above the surface it stands on - the body on its pad, a railing on its roof, a
        // solar panel overhead (checked only at its own height, greebles hid under the panels of a solar array).
        solids.every((b) => b.z1 <= host.z + 0.005 || b.x1 <= x - sx / 2 || b.x0 >= x + sx / 2 || b.y1 <= y - sy / 2 || b.y0 >= y + sy / 2);
      const colours = COLOURS[spec.kind];
      const colour = colours[Math.floor(rnd() * colours.length)]!;
      if (!clear) continue;
      out.push({ kind: spec.kind, x, y, z: host.z, sx, sy, sz, colour, blink: spec.kind === "antenna" });
      break;
    }
  }
  return out;
}

/** §2.2's whole procedural description of one building. */
export function generateStructure(type: string, seed: number, level: number, hosts: readonly Host[], solids: readonly Box3[] = []): { variant: Variant; instances: Instance[] } {
  return { variant: variantOf(type, seed, level), instances: greeblesOf(type, seed, level, hosts, solids) };
}
