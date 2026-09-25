/**
 * The metropolis beyond its quarters (at the user's request: "the metropolis
 * has an 8x8 grid - far too small, do it 24x24; clear of all the stones; the
 * center 8x8 remains as it is now, with stations and railways; in the outer
 * parts, more 2x2, 3x3 and 4x4 clusters, at least one or two big land claims,
 * spaced, where in the spaces there are many corridors; one zone for solar
 * panels, wind turbines, mega-malls, storage of every kind; very
 * interconnected; deep city planning zones with different colours and
 * purposes; giant railways that interconnect the extremes of the city, with
 * trains passing").
 *
 * The quarters (`metropolis.ts`) stand on the founding square and its ring
 * of claimed land: eleven chunks a side, eight quarters a side. Round them,
 * ten more chunks a side are laid out on a lattice of AVENUES - a ring at the
 * city's edge, a ring round the quarters, and radials between - each a chunk
 * wide, carrying a double railway, four corridors and their cross-links, and
 * power. Between the avenues lie DISTRICTS of 2 x 2, 3 x 3 and 4 x 4 chunks,
 * and two big ones - a solar farm and a wind farm - with wild, unclaimed
 * land between them. Each district is blocks wall to wall, as the quarters
 * are, for its purpose; each is a zone of its own colour. Then the whole city
 * is joined - corridors, cables, one railway - made good (power, water, food,
 * oxygen), cleared of rock, and set to work.
 */

import type { BuildingType, HabitatChannels, MicroResource, PlacedBuilding, Settlement, SettlementJob, SimState, Tuning, Zone } from "../sim/index.js";
import {
  BUILDING_DEFS,
  capacities,
  claimLand,
  claimTest,
  frameOf,
  groundOf,
  housing,
  levelGround,
  rocksOf,
  tileKey,
} from "../sim/index.js";

/** Chunks a side of the whole metropolis: the quarters' eleven, and ten more each side. */
export const METROPOLIS_CHUNKS = 31;
/** Chunks between the frame's edge and the quarters. */
const OUTER = 10;

type Purpose = "solar" | "wind" | "commerce" | "agriculture" | "industry" | "port" | "research" | "suburb" | "storage" | "parkland";

/** Every purpose's name, and its colour on the planner. */
export const PURPOSES: Readonly<Record<Purpose, { name: string; colour: string }>> = {
  solar: { name: "Solar farm", colour: "#f2d64b" },
  wind: { name: "Wind farm", colour: "#9ad0f5" },
  commerce: { name: "Commerce", colour: "#e0605a" },
  agriculture: { name: "Agriculture", colour: "#5fbf6a" },
  industry: { name: "Industry", colour: "#e0803b" },
  port: { name: "Port", colour: "#48c2b5" },
  research: { name: "Research", colour: "#c46ad6" },
  suburb: { name: "Suburb", colour: "#7fb0e0" },
  storage: { name: "Storage", colour: "#8a8fe8" },
  parkland: { name: "Parkland", colour: "#3fae5a" },
};

/** What each district is filled with: first these, then the repeat until its blocks are full (or `passes` runs out). */
const RECIPES: Readonly<Record<Exclude<Purpose, "wind">, { first: readonly BuildingType[]; repeat: readonly BuildingType[]; passes: number; open: number }>> = {
  solar: { first: ["battery_bank", "battery_bank", "battery_bank"], repeat: ["solar_array"], passes: 12, open: 0 },
  commerce: { first: ["station", "mega_mall", "mega_mall", "mega_mall", "medical_center"], repeat: ["skyscraper", "skyscraper", "freezer", "habitat_dome"], passes: 6, open: 4 },
  agriculture: { first: ["station", "biosphere", "biosphere", "biosphere", "biosphere"], repeat: ["greenhouse", "biosphere", "algae_reactor", "water_extractor", "greenhouse", "freezer"], passes: 6, open: 4 },
  industry: { first: ["station", "industrial_command", "rover_post", "materials_depot"], repeat: ["regolith_mine", "regolith_mine", "geothermal_plant", "materials_depot", "reactor", "battery_bank", "storage_depot"], passes: 6, open: 4 },
  port: { first: ["station", "spaceport", "spaceport", "spaceport", "spaceport"], repeat: ["storage_depot", "materials_depot", "water_tank", "spaceport", "freezer"], passes: 4, open: 3 },
  research: { first: ["observatory", "research_forum", "research_forum", "laboratory"], repeat: ["laboratory", "laboratory", "algae_reactor", "habitat_dome"], passes: 4, open: 3 },
  suburb: { first: ["park", "rover_post"], repeat: ["habitat_dome", "habitat_dome", "greenhouse", "habitat_dome", "water_tank"], passes: 4, open: 3 },
  storage: { first: ["materials_depot", "materials_depot"], repeat: ["water_tank", "battery_bank", "freezer", "materials_depot", "storage_depot"], passes: 5, open: 4 },
  parkland: { first: [], repeat: ["park", "park", "park", "habitat_dome"], passes: 3, open: 3 },
};

/** A district, in chunks from the frame's corner. */
interface District {
  u: number;
  v: number;
  readonly w: number;
  readonly h: number;
  purpose: Purpose;
}

/**
 * The ground a city grows over, in chunks: a frame `F` a side, its core - what
 * was built before it grew (a metropolis's quarters, 11; a city's founding
 * square, 3) - `Q` a side in the middle, the founding square `fo` chunks in
 * from the core's corner, and how near its middle its outline may come.
 */
export interface Geometry {
  readonly F: number;
  readonly Q: number;
  readonly fo: number;
  readonly least: number;
}

/** A metropolis: 31 chunks a side at most, its eleven of quarters in the middle. */
export const METROPOLIS_GEOMETRY: Geometry = { F: METROPOLIS_CHUNKS, Q: 11, fo: 1, least: 11 };

const outerOf = (g: Geometry): number => (g.F - g.Q) / 2;
const inCore = (g: Geometry, c: number): boolean => c >= outerOf(g) && c < outerOf(g) + g.Q;

/** A metropolis's outline: how far it reaches, in chunks from its middle, at each angle. */
export interface Outline {
  readonly reach: (angle: number) => number;
}

/**
 * The outline of a metropolis as a town grows (at the user's request: "less
 * square, more like a normal city development - a blob, same space, a more
 * natural shape"): round its quarters, a radius that wanders slowly with the
 * angle (a few broad lobes), and three or four arms reaching out where it grew
 * along its roads - scaled until it covers about `area` chunks, clipped to the
 * frame. Each metropolis its own, from `rnd`.
 */
export function outlineOf(rnd: () => number, area = 620, g: Geometry = METROPOLIS_GEOMETRY): Outline {
  const MID = g.F / 2;
  const lobes = [2, 3, 4, 5].map((k) => ({ k, a: [0.13, 0.09, 0.06, 0.04][k - 2]! * (0.6 + 0.8 * rnd()), phase: rnd() * 2 * Math.PI }));
  const arms = Array.from({ length: 3 + Math.floor(rnd() * 2) }, () => ({ at: rnd() * 2 * Math.PI, width: 0.18 + 0.12 * rnd(), lift: 0.22 + 0.18 * rnd() }));
  const shape = (angle: number): number => {
    let f = 1;
    for (const l of lobes) f += l.a * Math.cos(l.k * angle + l.phase);
    for (const arm of arms) {
      const d = Math.atan2(Math.sin(angle - arm.at), Math.cos(angle - arm.at));
      f += arm.lift * Math.exp(-((d / arm.width) ** 2));
    }
    return f;
  };
  // The biggest the frame allows: a chunk short of its edge, and never inside the quarters' corners.
  // A chunk short of its edge (a small frame, a quarter chunk: or its edge's middle chunks never make it).
  const most = MID - (g.F >= 21 ? 0.6 : 0.25);
  // Never so close that its ring (a chunk and a half inside) would meet the core's ring at a corner.
  const least = Math.min(g.least, most);
  let scale = 12;
  const covered = (k: number): number => {
    let count = 0;
    for (let v = 0; v < g.F; v += 1) for (let u = 0; u < g.F; u += 1) if (inside(u, v, (angle) => Math.min(most, Math.max(least, k * shape(angle))), g)) count += 1;
    return count;
  };
  // Scaled to the area: a few rounds of bisection.
  let lo = 0.5;
  let hi = 20;
  for (let i = 0; i < 18; i += 1) {
    scale = (lo + hi) / 2;
    if (covered(scale) < area) lo = scale;
    else hi = scale;
  }
  return { reach: (angle) => Math.min(most, Math.max(least, scale * shape(angle))) };
}

/** Whether chunk (u, v)'s middle lies inside an outline (the quarters always do). */
function inside(u: number, v: number, reach: (angle: number) => number, g: Geometry): boolean {
  if (inCore(g, u) && inCore(g, v)) return true;
  const dx = u + 0.5 - g.F / 2;
  const dy = v + 0.5 - g.F / 2;
  return Math.hypot(dx, dy) <= reach(Math.atan2(dy, dx));
}

/** The chunks of a metropolis, as "u,v", inside its outline. */
export function chunksOf(outline: Outline, g: Geometry = METROPOLIS_GEOMETRY): Set<string> {
  const out = new Set<string>();
  for (let v = 0; v < g.F; v += 1) for (let u = 0; u < g.F; u += 1) if (inside(u, v, outline.reach, g)) out.add(`${u},${v}`);
  return out;
}

/** An avenue's course, in tiles of the frame: a line of points, closed round for a ring. */
interface Route {
  readonly points: readonly (readonly [number, number])[];
  readonly closed: boolean;
}

/**
 * The avenues: a ring round the quarters, a ring round the city a chunk and a
 * half inside its outline, and eight radials from the one to the other - the
 * railways that join the city's extremes run along them.
 */
function routesOf(outline: Outline, C: number, g: Geometry): Route[] {
  const c = (g.F * C) / 2;
  const half = (g.Q / 2) * C + C / 2;
  const inner: [number, number][] = [
    [c - half, c - half],
    [c + half, c - half],
    [c + half, c + half],
    [c - half, c + half],
  ];
  const ringAt = (angle: number): number => Math.max((g.least - 1.8) * C, (outline.reach(angle) - 1.6) * C);
  const outer: [number, number][] = [];
  for (let k = 0; k < 96; k += 1) {
    const angle = (k / 96) * 2 * Math.PI;
    const r = ringAt(angle);
    outer.push([c + r * Math.cos(angle), c + r * Math.sin(angle)]);
  }
  const radials: Route[] = [];
  for (let k = 0; k < 8; k += 1) {
    const angle = (k / 8) * 2 * Math.PI;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // From where the ray leaves the inner ring's square to the outer ring.
    const leave = half / Math.max(Math.abs(dx), Math.abs(dy));
    const r = ringAt(angle);
    radials.push({ points: [[c + leave * dx, c + leave * dy], [c + r * dx, c + r * dy]], closed: false });
  }
  return [{ points: inner, closed: true }, { points: outer, closed: true }, ...radials];
}

/** A line along a route, `offset` tiles to its side, as tiles each beside the last (4-connected). */
function laneOf(route: Route, offset: number, n: number): number[] {
  const out: number[] = [];
  let last: [number, number] | null = null;
  const pts = route.closed ? [...route.points, route.points[0]!] : route.points;
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= n || y >= n) {
      last = null;
      return;
    }
    if (last !== null) {
      // Fill the corner between diagonal neighbours, so the lane is unbroken tile to tile.
      if (last[0] !== x && last[1] !== y) out.push(last[1] * n + x);
      if (last[0] === x && last[1] === y) return;
    }
    out.push(y * n + x);
    last = [x, y];
  };
  for (let k = 0; k + 1 < pts.length; k += 1) {
    const [ax, ay] = pts[k]!;
    const [bx, by] = pts[k + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;
    const steps = Math.ceil(len * 2);
    for (let i = 0; i <= steps; i += 1) {
      const f = i / steps;
      push(Math.round(ax + (bx - ax) * f + nx * offset), Math.round(ay + (by - ay) * f + ny * offset));
    }
  }
  return out;
}

/** Points every `every` tiles along a route, with the way it runs across there: for the cross-links. */
function alongRoute(route: Route, every: number): { x: number; y: number; nx: number; ny: number }[] {
  const out: { x: number; y: number; nx: number; ny: number }[] = [];
  const pts = route.closed ? [...route.points, route.points[0]!] : route.points;
  let carry = every / 2;
  for (let k = 0; k + 1 < pts.length; k += 1) {
    const [ax, ay] = pts[k]!;
    const [bx, by] = pts[k + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    let at = carry;
    for (; at < len; at += every) out.push({ x: ax + ((bx - ax) * at) / len, y: ay + ((by - ay) * at) / len, nx: -(by - ay) / len, ny: (bx - ax) / len });
    carry = at - len;
  }
  return out;
}

/** The districts' sizes and purposes, largest first: the two farms, then 4, 3 and 2 chunks a side. */
function districtList(): District[] {
  const out: District[] = [
    { u: 0, v: 0, w: 6, h: 6, purpose: "solar" },
    { u: 0, v: 0, w: 6, h: 6, purpose: "wind" },
  ];
  const bySize: [number, Purpose[]][] = [
    [4, ["commerce", "agriculture", "industry", "port", "research", "commerce", "agriculture"]],
    [3, ["storage", "suburb", "industry", "agriculture", "suburb", "storage", "commerce", "suburb"]],
    [2, ["parkland", "suburb", "storage", "parkland", "research", "suburb", "parkland", "storage", "suburb", "parkland", "storage", "research"]],
  ];
  for (const [size, purposes] of bySize) for (const purpose of purposes) out.push({ u: 0, v: 0, w: size, h: size, purpose });
  return out;
}

/** How a city grows: its geometry, how many chunks it covers, its districts, and whether avenues run through it. */
export interface GrowPlan {
  readonly g: Geometry;
  readonly area: number;
  readonly districts: readonly District[];
  readonly avenues: boolean;
  /** Every stone in the frame broken first (a metropolis: "clear of all the stones"); else its crags are built round. */
  readonly clearRocks: boolean;
}

export function widenMetropolis(start: SimState, id: string, env: HabitatChannels, t: Tuning, rnd: () => number): SimState {
  return growCity(start, id, env, t, rnd, { g: METROPOLIS_GEOMETRY, area: 620, districts: districtList(), avenues: true, clearRocks: true });
}

/**
 * A city of `K` chunks across at most (the user: "even normal cities way
 * bigger in the perfect planet: at least 3x3 tiles, at most 17x17, blob
 * shaped"): its founding square the core, an outline over some 70% of its
 * box, avenues once it is 13 chunks or more, and districts in proportion.
 */
export function cityPlan(K: number): GrowPlan {
  const F = K % 2 === 1 ? K : K + 1;
  const avenues = F >= 13;
  const area = Math.max(9, Math.round(0.7 * K * K));
  const outside = area - 9;
  const out: District[] = [];
  if (outside >= 100) out.push({ u: 0, v: 0, w: 4, h: 4, purpose: "solar" }, { u: 0, v: 0, w: 4, h: 4, purpose: "wind" });
  else if (outside >= 40) out.push({ u: 0, v: 0, w: 3, h: 3, purpose: "solar" });
  // Homes a third of the way round (with suburbs rarer, a 17-chunk city housed 648 people, measured).
  const cycle: Purpose[] = ["suburb", "agriculture", "industry", "suburb", "storage", "research", "suburb", "commerce", "parkland", "port"];
  let k = 0;
  for (const [size, per] of [[4, 70], [3, 35], [2, 18]] as const) for (let i = 0; i < Math.floor(outside / per); i += 1) out.push({ u: 0, v: 0, w: size, h: size, purpose: cycle[k++ % cycle.length]! });
  // Avenues need a ring's room round the founding square: 2 chunks out, the outer ring a chunk and a half in from the edge.
  return { g: { F, Q: 3, fo: 0, least: avenues ? 5.5 : 2.2 }, area, districts: out, avenues, clearRocks: false };
}

export function growCity(start: SimState, id: string, env: HabitatChannels, t: Tuning, rnd: () => number, growth: GrowPlan): SimState {
  const g = growth.g;
  const OUTER = outerOf(g);
  const inQuarters = (c: number): boolean => inCore(g, c);
  const settlementOf = (st: SimState): Settlement => st.settlements.find((c) => c.id === id)!;
  const withSettlement = (st: SimState, s: Settlement): SimState => ({ ...st, settlements: st.settlements.map((c) => (c.id === id ? s : c)) });
  const C = t.CLAIM_CHUNK_TILES;
  let state = start;
  const founding = settlementOf(state);
  const per = founding.base / C;
  if (!Number.isInteger(per) || per + 2 * g.fo !== g.Q) return state;

  // 1. The land: every chunk inside the city's outline, claimed outward from the core (a claim must touch the city's own).
  const outline = outlineOf(rnd, growth.area, g);
  const shape = chunksOf(outline, g);
  const want = new Set([...shape].filter((k) => {
    const [u, v] = k.split(",").map(Number) as [number, number];
    return !(inQuarters(u) && inQuarters(v));
  }));
  // Chunk (u, v) of the frame is chunk (u - OUTER - fo, v - OUTER - fo) from the founding square.
  const mid = (g.F - 1) / 2;
  let pending = [...want].map((k) => k.split(",").map(Number) as [number, number]).sort((a, b) => Math.max(Math.abs(a[0] - mid), Math.abs(a[1] - mid)) - Math.max(Math.abs(b[0] - mid), Math.abs(b[1] - mid)));
  state = withSettlement(state, { ...settlementOf(state), population: 1e6 });
  for (let pass = 0; pass < 40 && pending.length > 0; pass += 1) {
    const before = pending.length;
    pending = pending.filter(([u, v]) => {
      const o = claimLand(state, id, u - OUTER - g.fo, v - OUTER - g.fo, t);
      if (o.ok) state = o.state;
      return !o.ok;
    });
    if (pending.length === before) break;
  }
  let s = settlementOf(state);
  const f0 = frameOf(s, t);
  const n = f0.n;
  // The frame is the outline's box: where it falls short of the full 31 chunks, the outline is shifted with it.
  const du = Math.round(f0.x0 / C) + OUTER + g.fo;
  const dv = Math.round(f0.y0 / C) + OUTER + g.fo;
  const chunkIn = (u: number, v: number): boolean => shape.has(`${u + du},${v + dv}`);
  // Cleared of every rock in the frame first (the user: "a metropolis is clear of all the stones") - before
  // anything is built, as the rocks under a building are not counted once it stands (cleared at the end, the
  // outer districts had been built on crags the rules forbid, measured by replaying them).
  if (growth.clearRocks) {
    const cleared = new Set(s.cleared);
    rocksOf(s, t).forEach((r, i) => {
      if (r !== "none") cleared.add(tileKey(i % n, Math.floor(i / n)));
    });
    s = { ...s, cleared: [...cleared].sort((a, b) => a - b) };
  }
  // Hard rock left standing is not built on, nor laid over.
  const crag = rocksOf(s, t);
  const ground = groundOf(s, t);
  const ours = claimTest(s, t);

  // 2. The ground: open where claimed and not too steep (rock is cleared at the end, all of it).
  const taken = new Uint8Array(n * n);
  const placed: PlacedBuilding[] = [...s.buildings];
  const sizeOf = (type: BuildingType): [number, number] => [BUILDING_DEFS[type].footprint, BUILDING_DEFS[type].depth];
  const occupy = (x0: number, y0: number, w: number, h: number): void => {
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) taken[y * n + x] = 1;
  };
  for (const b of s.buildings) occupy(b.tx, b.ty, ...sizeOf(b.type));
  const openAt = new Uint8Array(n * n);
  // The avenues' strips, kept clear of buildings (their lanes, and the ground between them): laid out below.
  // And the quarters' own corridors, cables and railways: nothing may stand on a link.
  const strip = new Uint8Array(n * n);
  for (const list of [s.corridors, s.cables, s.rails]) for (const k of list) strip[(k >> 10) * n + (k & 1023)] = 1;
  for (let i = 0; i < n * n; i += 1) openAt[i] = !ground.steep[i] && crag[i] !== "crag" && ours(i % n, Math.floor(i / n)) ? 1 : 0;
  // Only ground a corridor can reach from the headquarters: flat land walled in by slopes is left alone (the first
  // outer city built in such pockets - 160 groups of buildings no corridor could ever join, measured).
  {
    const reach = new Uint8Array(n * n);
    const hq = s.buildings.find((b) => b.type === "headquarters");
    const stack = hq === undefined ? [] : [(hq.ty + 5) * n + hq.tx + 2];
    while (stack.length > 0) {
      const i = stack.pop()!;
      if (reach[i] || !openAt[i]) continue;
      reach[i] = 1;
      const x = i % n;
      if (x > 0) stack.push(i - 1);
      if (x < n - 1) stack.push(i + 1);
      if (i >= n) stack.push(i - n);
      if (i < n * n - n) stack.push(i + n);
    }
    // Everything already built stands on reachable ground by its own rules; keep what it stands on.
    for (let i = 0; i < n * n; i += 1) if (!reach[i] && !taken[i]) openAt[i] = 0;
  }
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  const fits = (tx: number, ty: number, w: number, h: number, r: Rect, gap: number): boolean => {
    if (tx < r.x0 || ty < r.y0 || tx + w > r.x1 || ty + h > r.y1) return false;
    for (let y = ty; y < ty + h; y += 1) for (let x = tx; x < tx + w; x += 1) if (!openAt[y * n + x] || strip[y * n + x]) return false;
    for (let y = Math.max(0, ty - gap); y < Math.min(n, ty + h + gap); y += 1) for (let x = Math.max(0, tx - gap); x < Math.min(n, tx + w + gap); x += 1) if (taken[y * n + x]) return false;
    return true;
  };
  const put = (type: BuildingType, tx: number, ty: number): PlacedBuilding => {
    occupy(tx, ty, ...sizeOf(type));
    const b: PlacedBuilding = { type, tx, ty, level: 1 };
    placed.push(b);
    return b;
  };
  const cursor = new Map<string, number>();
  /** The first slot in rows (see `metropolis.ts`: a cursor per rectangle and footprint, as ground only fills up). */
  const inRows = (type: BuildingType, r: Rect, gap = 0): PlacedBuilding | null => {
    const [w, h] = sizeOf(type);
    const key = `${r.x0},${r.y0},${r.x1},${r.y1}|${w}x${h}|${gap}`;
    const from = cursor.get(key) ?? 0;
    if (from < 0) return null;
    const span = r.x1 - r.x0;
    for (let at = from; ; at += 1) {
      const x = r.x0 + (at % span);
      const y = r.y0 + Math.floor(at / span);
      if (y + h > r.y1) break;
      if (x + w <= r.x1 && fits(x, y, w, h, r, gap)) {
        cursor.set(key, at);
        return put(type, x, y);
      }
    }
    cursor.set(key, -1);
    return null;
  };

  // 3. The avenues: in each avenue chunk, along the way it runs, two rails (a double line), four corridors,
  // cross-links every 16 tiles over them (the rails go over on bridges), and power with the outer corridors.
  const corridor = new Uint8Array(n * n);
  const cable = new Uint8Array(n * n);
  const rail = new Uint8Array(n * n);
  const lay = (grid: Uint8Array, x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = y * n + x;
    if (openAt[i] && !taken[i]) grid[i] = 1;
  };
  // Offsets across an avenue, tiles from its middle: a double railway, four corridors, power along the outer two.
  const RAILS = [-2, 1];
  const CORRIDORS = [-12, -6, 7, 13];
  const CABLES = [-12, 13];
  const WIDTH = 14;
  const routes = (growth.avenues ? routesOf(outline, C, g) : []).map((r) => ({ ...r, points: r.points.map(([x, y]) => [x - du * C, y - dv * C] as const) }));
  for (const route of routes) {
    for (const o of RAILS) for (const i of laneOf(route, o, n)) lay(rail, i % n, Math.floor(i / n));
    for (const o of CORRIDORS) for (const i of laneOf(route, o, n)) lay(corridor, i % n, Math.floor(i / n));
    for (const o of CABLES) for (const i of laneOf(route, o, n)) lay(cable, i % n, Math.floor(i / n));
    for (let o = -WIDTH; o <= WIDTH; o += 1) for (const i of laneOf(route, o, n)) strip[i] = 1;
    // Cross-links every 16 tiles, from the outer corridor to the outer corridor, over the rails on bridges.
    for (const p of alongRoute(route, 16)) {
      for (let o = CORRIDORS[0]!; o <= CORRIDORS[CORRIDORS.length - 1]!; o += 1) {
        const x = Math.round(p.x + p.nx * o);
        const y = Math.round(p.y + p.ny * o);
        lay(corridor, x, y);
        lay(cable, x, y);
      }
    }
  }


  // 4. The districts: blocks wall to wall, for their purpose; a station where the recipe has one.
  const PITCH = 16;
  const GAP = 3;
  const zones: Zone[] = [...s.zones];
  let zoneId = zones.reduce((m, z) => Math.max(m, z.id), 0);
  const stations: PlacedBuilding[] = placed.filter((b) => b.type === "station");
  const blocksOf = (d: District, r: Rect): Rect[] => {
    const out: Rect[] = [];
    const across = Math.max(1, Math.floor((r.x1 - r.x0 + GAP) / PITCH));
    const down = Math.max(1, Math.floor((r.y1 - r.y0 + GAP) / PITCH));
    const bw = Math.floor((r.x1 - r.x0 - (across - 1) * GAP) / across);
    const bh = Math.floor((r.y1 - r.y0 - (down - 1) * GAP) / down);
    const open = d.purpose === "solar" ? 0 : RECIPES[d.purpose === "wind" ? "solar" : d.purpose].open;
    for (let j = 0; j < down; j += 1) {
      for (let i = 0; i < across; i += 1) {
        // Open ground: one block in `open`, somewhere else in each district.
        if (open > 0 && (i * 5 + j * 3 + d.u + d.v) % open === 0 && !(i === 0 && j === 0)) continue;
        const bx = r.x0 + i * (bw + GAP);
        const by = r.y0 + j * (bh + GAP);
        out.push({ x0: bx, y0: by, x1: bx + bw, y1: by + bh });
      }
    }
    return out;
  };
  // Where each district goes: inside the outline, clear of the quarters, a chunk apart from every other
  // district, and not across an avenue - the biggest first (a farm a chunk smaller if it must), each at one
  // of the places it fits, chosen in turn.
  const cu = Math.round(n / C);
  const stripIn = new Float64Array(cu * cu);
  for (let i = 0; i < n * n; i += 1) if (strip[i]) stripIn[Math.floor(Math.floor(i / n) / C) * cu + Math.floor((i % n) / C)]! += 1 / (C * C);
  const quarterChunk = (u: number, v: number): boolean => inQuarters(u + du) && inQuarters(v + dv);
  const used = new Uint8Array(cu * cu);
  const plan: District[] = [];
  for (const wanted of growth.districts) {
    const sizes = wanted.purpose === "solar" || wanted.purpose === "wind" ? [6, 5, 4] : [wanted.w];
    for (const size of sizes) {
      const places: [number, number][] = [];
      for (let v = 0; v + size <= cu; v += 1) {
        for (let u = 0; u + size <= cu; u += 1) {
          let ok = true;
          let across = 0;
          for (let y = v - 1; y <= v + size && ok; y += 1) {
            for (let x = u - 1; x <= u + size && ok; x += 1) {
              const inRect = x >= u && y >= v && x < u + size && y < v + size;
              if (x < 0 || y < 0 || x >= cu || y >= cu) {
                if (inRect) ok = false;
                continue;
              }
              if (used[y * cu + x]) ok = false;
              if (inRect && (!chunkIn(x, y) || quarterChunk(x, y))) ok = false;
              if (inRect) across += stripIn[y * cu + x]!;
            }
          }
          // An avenue may skirt a district, not run through it: at most a third of its ground under an avenue.
          if (ok && across / (size * size) <= 0.35) places.push([u, v]);
        }
      }
      if (places.length === 0) continue;
      const [u, v] = places[Math.floor(rnd() * places.length)]!;
      for (let y = v; y < v + size; y += 1) for (let x = u; x < u + size; x += 1) used[y * cu + x] = 1;
      plan.push({ u, v, w: size, h: size, purpose: wanted.purpose });
      break;
    }
  }
  const districtBlocks = new Map<District, Rect[]>();
  for (const d of plan) {
    // Two tiles in from the district's edge: the avenues' outer corridors run close by.
    const r: Rect = { x0: d.u * C + 2, y0: d.v * C + 2, x1: (d.u + d.w) * C - 2, y1: (d.v + d.h) * C - 2 };
    const blocks = blocksOf(d, r);
    districtBlocks.set(d, blocks);
    if (d.purpose === "wind") {
      // Turbines stand apart - three tiles between each - with battery banks in the first block.
      for (let k = 0; k < 4; k += 1) inRows("battery_bank", blocks[0]!, 0);
      for (const b of blocks) while (inRows("wind_turbine", b, 3) !== null);
    } else {
      const recipe = RECIPES[d.purpose];
      for (const type of recipe.first) {
        for (const b of blocks) {
          const got = inRows(type, b, 0);
          if (got !== null) {
            if (type === "station") {
              stations.push(got);
              // An apron round it no building takes, so the railway can always reach it (walled in by its
              // block's buildings, one district's station was on no line, measured).
              const [sw, sh] = sizeOf("station");
              for (let y = got.ty - 1; y <= got.ty + sh; y += 1) for (let x = got.tx - 1; x <= got.tx + sw; x += 1) if (x >= 0 && y >= 0 && x < n && y < n && !taken[y * n + x]) strip[y * n + x] = 1;
            }
            break;
          }
        }
      }
      for (const b of blocks) {
        for (let k = 0; k < recipe.passes; k += 1) {
          let any = false;
          for (const type of recipe.repeat) any = inRows(type, b, 0) !== null || any;
          if (!any) break;
        }
      }
    }
    // Its zone: the district's land.
    const tiles: number[] = [];
    for (let y = d.v * C; y < (d.v + d.h) * C; y += 1) for (let x = d.u * C; x < (d.u + d.w) * C; x += 1) tiles.push(tileKey(x, y));
    zoneId += 1;
    const count = zones.filter((z) => z.name.startsWith(PURPOSES[d.purpose].name)).length;
    const farm = d.purpose === "solar" || d.purpose === "wind";
    zones.push({ id: zoneId, name: `${PURPOSES[d.purpose].name}${count > 0 || !farm ? ` ${count + 1}` : ""}`, colour: PURPOSES[d.purpose].colour, tiles: tiles.sort((a, b) => a - b) });
  }

  // 4b. No empty land (at the user's request: "in each empty tile there has to be between 3 and 25
  // structures, none of them homes - many factories, standalone storage depots - so the city feels full"):
  // every chunk of the city still holding fewer than three buildings is filled to between 3 and 25 of the
  // works a city runs on, in one to three clusters wall to wall.
  const WORKS: readonly [BuildingType, number][] = [
    ["regolith_mine", 5],
    ["storage_depot", 4],
    ["water_extractor", 3],
    ["materials_depot", 2],
    ["water_tank", 2],
    ["battery_bank", 2],
    ["geothermal_plant", 2],
    ["freezer", 1],
    ["reactor", 1],
    ["algae_reactor", 1],
    ["solar_array", 1],
    ["wind_turbine", 1],
    ["laboratory", 0.5],
    ["industrial_command", 0.3],
  ];
  const weight = WORKS.reduce((a, [, w]) => a + w, 0);
  const pickWork = (): BuildingType => {
    let r = rnd() * weight;
    for (const [type, w] of WORKS) if ((r -= w) < 0) return type;
    return "storage_depot";
  };
  const inChunk = new Int32Array(cu * cu);
  for (const b of placed) if (b.tx >= 0 && b.ty >= 0 && b.tx < n && b.ty < n) inChunk[Math.floor(b.ty / C) * cu + Math.floor(b.tx / C)]! += 1;
  /** The free slot for a footprint nearest (ax, ay) within the chunk, searched outwards ring by ring. */
  const nearIn = (type: BuildingType, ax: number, ay: number, r: Rect): PlacedBuilding | null => {
    const [w, h] = sizeOf(type);
    for (let ring = 0; ring < C; ring += 1) {
      // The ring's own tiles only, row by row as before (the whole square walked for each ring was a
      // tenth of building the planet, measured).
      for (let y = ay - ring; y <= ay + ring; y += 1) {
        const edge = y === ay - ring || y === ay + ring;
        for (let x = ax - ring; x <= ax + ring; x += edge || ring === 0 ? 1 : 2 * ring) {
          if (fits(x, y, w, h, r, 0)) return put(type, x, y);
        }
      }
    }
    return null;
  };
  const worksTiles: number[] = [];
  for (let v = 0; v < cu; v += 1) {
    for (let u = 0; u < cu; u += 1) {
      // The quarters too: their open blocks had left whole chunks bare.
      if (!chunkIn(u, v) || inChunk[v * cu + u]! >= 3) continue;
      const r: Rect = { x0: u * C, y0: v * C, x1: (u + 1) * C, y1: (v + 1) * C };
      const target = 3 + Math.floor(rnd() * 23);
      const centres = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => [r.x0 + 4 + Math.floor(rnd() * (C - 8)), r.y0 + 4 + Math.floor(rnd() * (C - 8))] as const);
      let count = inChunk[v * cu + u]!;
      for (let tries = 0; count < target && tries < target * 4; tries += 1) {
        const [ax, ay] = centres[tries % centres.length]!;
        // A chosen work, or where a big one will not go, a depot: the smallest there is.
        const work = nearIn(pickWork(), ax, ay, r) ?? nearIn("storage_depot", ax, ay, r);
        if (work === null) continue;
        count += 1;
        // In the core, the works are their own footprints: the core's own buildings stay in the core's zones.
        if (quarterChunk(u, v)) {
          const [ww, wh] = sizeOf(work.type);
          for (let y = work.ty; y < work.ty + wh; y += 1) for (let x = work.tx; x < work.tx + ww; x += 1) worksTiles.push(tileKey(x, y));
        }
      }
      inChunk[v * cu + u] = count;
      // A district's own chunk, left thin by its open blocks, is filled too - but stays its district's; so does a
      // core chunk but for the works' own footprints (above).
      if (used[v * cu + u] || quarterChunk(u, v)) continue;
      for (let y = r.y0; y < r.y1; y += 1) for (let x = r.x0; x < r.x1; x += 1) if (!strip[y * n + x]) worksTiles.push(tileKey(x, y));
    }
  }
  // A tile in one zone at most: the works take their chunks from the core's zones.
  const worksSet = new Set(worksTiles);
  for (let k = 0; k < zones.length; k += 1) {
    const z = zones[k]!;
    if (z.tiles.some((tile) => worksSet.has(tile))) zones[k] = { ...z, tiles: z.tiles.filter((tile) => !worksSet.has(tile)) };
  }
  zoneId += 1;
  zones.push({ id: zoneId, name: "Works and stores", colour: "#b0896a", tiles: worksTiles.sort((a, b) => a - b) });
  const avenueTiles: number[] = [];
  for (let i = 0; i < n * n; i += 1) {
    const x = i % n;
    const y = Math.floor(i / n);
    if (strip[i] && ours(x, y) && !quarterChunk(Math.floor(x / C), Math.floor(y / C))) avenueTiles.push(tileKey(x, y));
  }
  zoneId += 1;
  zones.push({ id: zoneId, name: "Avenues - rail and corridor", colour: "#9c7a5b", tiles: avenueTiles.sort((a, b) => a - b) });

  // 5. Made good: producers added where they belong until nothing runs short.
  const net = { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 };
  let counted = 0;
  const supply = (): Record<MicroResource, number> => {
    for (; counted < placed.length; counted += 1) {
      const def = BUILDING_DEFS[placed[counted]!.type];
      const eff = def.canOperate(env, t) ? def.efficiency(env, t) : 0;
      for (const [r, v] of Object.entries(def.produces(t)) as [MicroResource, number][]) net[r] += v * eff;
      for (const [r, v] of Object.entries(def.consumes(t, env)) as [MicroResource, number][]) net[r] -= v;
    }
    return net;
  };
  const byPurpose = (p: Purpose): District[] => plan.filter((d) => d.purpose === p);
  const inDistricts = (type: BuildingType, list: readonly District[], gap = 0): boolean => list.some((d) => (districtBlocks.get(d) ?? []).some((b) => inRows(type, b, gap) !== null));
  const makers: Readonly<Record<Exclude<MicroResource, "materials">, [BuildingType, Purpose[]][]>> = {
    power: [["reactor", ["industry"]], ["geothermal_plant", ["industry", "storage"]], ["solar_array", ["solar"]], ["reactor", ["storage", "port", "commerce"]]],
    water: [["water_extractor", ["agriculture", "storage", "industry", "suburb"]]],
    oxygen: [["algae_reactor", ["agriculture", "research", "suburb", "storage"]]],
    food: [["greenhouse", ["agriculture", "suburb", "parkland", "storage"]]],
  };
  for (let k = 0; k < 4000; k += 1) {
    const now = supply();
    const short = (["power", "water", "food", "oxygen"] as const).find((r) => now[r] < 2);
    if (short === undefined) break;
    // Where it belongs first; then any district with room (not the farms).
    const anywhere = plan.filter((d) => d.purpose !== "solar" && d.purpose !== "wind");
    if (!makers[short].some(([type, where]) => inDistricts(type, where.flatMap(byPurpose))) && !inDistricts(makers[short][0]![0], anywhere)) break;
  }

  // 5b. Only what the city's people allow (a city smaller than a metropolis cannot have a station below
  // 5,000 people, a skyscraper below 1,000, a post for every 100): each such building swapped for one that
  // fits its ground and needs nobody - until the people it leaves (a swapped skyscraper houses none) allow the rest.
  const SWAP: Partial<Record<BuildingType, BuildingType>> = { station: "research_forum", mega_mall: "biosphere", skyscraper: "greenhouse", observatory: "laboratory", medical_center: "laboratory", rover_post: "laboratory" };
  for (let round = 0; round < 6; round += 1) {
    let homes = 0;
    for (const b of placed) homes += BUILDING_DEFS[b.type].housing(t);
    const people = Math.floor(homes * 0.9);
    let posts = 0;
    let changed = false;
    placed.forEach((b, k) => {
      const def = BUILDING_DEFS[b.type];
      const tooFew = def.minPopulation(t) > people || (b.type === "rover_post" && ++posts > Math.floor(people / t.ROVER_POST_PEOPLE));
      const swap = SWAP[b.type];
      if (!tooFew || swap === undefined) return;
      // Its ground freed and the smaller taken again, so the way to it is open.
      const [ow, oh] = sizeOf(b.type);
      for (let y = b.ty; y < b.ty + oh; y += 1) for (let x = b.tx; x < b.tx + ow; x += 1) taken[y * n + x] = 0;
      occupy(b.tx, b.ty, ...sizeOf(swap));
      placed[k] = { ...b, type: swap };
      const at = stations.indexOf(b);
      if (at >= 0) stations.splice(at, 1);
      changed = true;
    });
    if (!changed) break;
    // What the swaps draw, made good again.
    counted = 0;
    for (const r of Object.keys(net) as MicroResource[]) net[r] = 0;
    for (let k = 0; k < 4000; k += 1) {
      const now = supply();
      const short = (["power", "water", "food", "oxygen"] as const).find((r) => now[r] < 2);
      if (short === undefined) break;
      const anywhere = plan.filter((d) => d.purpose !== "solar" && d.purpose !== "wind");
      if (!makers[short].some(([type, where]) => inDistricts(type, where.flatMap(byPurpose))) && !inDistricts(makers[short][0]![0], anywhere)) break;
    }
  }

  // 6. Joined: the quarters' corridors and rails carried out to the avenues; every district's blocks to the
  // nearest corridor; then whatever is still apart, by the shortest way.
  const s1: Settlement = { ...s, buildings: placed };
  for (const k of s1.corridors) corridor[(k >> 10) * n + (k & 1023)] = 1;
  for (const k of s1.rails) rail[(k >> 10) * n + (k & 1023)] = 1;
  const free = (i: number): boolean => openAt[i] === 1 && !taken[i];
  /** Straight from (x, y) along (dx, dy), over free ground, until a tile of `grid`: the tiles on the way, or null. */
  const trace = (grid: Uint8Array, x: number, y: number, dx: number, dy: number, limit: number): number[] | null => {
    const out: number[] = [];
    for (let k = 0; k < limit; k += 1) {
      const px = x + dx * k;
      const py = y + dy * k;
      if (px < 0 || py < 0 || px >= n || py >= n) return null;
      const i = py * n + px;
      if (grid[i] && k > 0) return out;
      if (!free(i)) return null;
      out.push(i);
    }
    return null;
  };
  // Each block: from its building nearest a side, straight out to the nearest corridor.
  // The buildings of each block, found in one pass (filtered per block, 20 million tests).
  const blockList = [...districtBlocks.values()].flat();
  const blockAt = new Int32Array(n * n).fill(-1);
  blockList.forEach((r, k) => {
    for (let y = r.y0; y < r.y1; y += 1) for (let x = r.x0; x < r.x1; x += 1) blockAt[y * n + x] = k;
  });
  const inBlock: PlacedBuilding[][] = blockList.map(() => []);
  for (const b of placed) {
    const k = b.tx >= 0 && b.ty >= 0 && b.tx < n && b.ty < n ? blockAt[b.ty * n + b.tx]! : -1;
    if (k >= 0) inBlock[k]!.push(b);
  }
  for (const [k] of blockList.entries()) {
    {
      const inside = inBlock[k]!;
      if (inside.length === 0) continue;
      const tries: number[][] = [];
      for (const b of inside) {
        const [w, h] = sizeOf(b.type);
        const mx = b.tx + Math.floor(w / 2);
        const my = b.ty + Math.floor(h / 2);
        for (const path of [trace(corridor, b.tx - 1, my, -1, 0, 48), trace(corridor, b.tx + w, my, 1, 0, 48), trace(corridor, mx, b.ty - 1, 0, -1, 48), trace(corridor, mx, b.ty + h, 0, 1, 48)]) if (path !== null) tries.push(path);
      }
      tries.sort((a, b) => a.length - b.length);
      for (const i of tries[0] ?? []) corridor[i] = cable[i] = 1;
    }
  }
  // The quarters' edge: every corridor there carried straight out to the avenue beside it.
  // The core's box in the frame.
  const qx0 = (OUTER - du) * C;
  const qx1 = qx0 + g.Q * C - 1;
  const qy0 = (OUTER - dv) * C;
  const qy1 = qy0 + g.Q * C - 1;
  const inBox = (i: number): boolean => i % n >= qx0 && i % n <= qx1 && Math.floor(i / n) >= qy0 && Math.floor(i / n) <= qy1;
  for (let a = 0; a <= g.Q * C - 1; a += 1) {
    for (const [x, y, dx, dy] of [[qx0 + a, qy0, 0, -1], [qx0 + a, qy1, 0, 1], [qx0, qy0 + a, -1, 0], [qx1, qy0 + a, 1, 0]] as const) {
      if (!corridor[y * n + x]) continue;
      const path = trace(corridor, x + dx, y + dy, dx, dy, C);
      if (path !== null) for (const i of path) corridor[i] = cable[i] = 1;
    }
  }
  joinAll(n, placed, corridor, (i) => free(i), placed[0]);
  // Power runs with every corridor, as it does in the quarters.
  for (let i = 0; i < n * n; i += 1) if (corridor[i]) cable[i] = 1;

  // 7. One railway: each district's station to the nearest rail, then every piece of line to the rest.
  const stationTiles = (b: PlacedBuilding): number[] => {
    const [w, h] = sizeOf(b.type);
    const out: number[] = [];
    for (let x = b.tx; x < b.tx + w; x += 1) out.push((b.ty - 1) * n + x, (b.ty + h) * n + x);
    for (let y = b.ty; y < b.ty + h; y += 1) out.push(y * n + b.tx - 1, y * n + b.tx + w);
    return out.filter((i) => i >= 0 && i < n * n && free(i));
  };
  const railPath = (from: readonly number[], goal: (i: number) => boolean): number[] => {
    const prev = new Int32Array(n * n).fill(-2);
    const queue: number[] = [];
    for (const i of from) {
      prev[i] = -1;
      queue.push(i);
    }
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head]!;
      if (goal(i)) {
        const out: number[] = [];
        for (let k = i; k >= 0; k = prev[k]!) out.push(k);
        return out;
      }
      const x = i % n;
      for (const j of [i + 1, i - 1, i + n, i - n]) {
        if (j < 0 || j >= n * n || prev[j] !== -2 || Math.abs((j % n) - x) > 1 || !free(j)) continue;
        prev[j] = i;
        queue.push(j);
      }
    }
    return [];
  };
  const outerStations = stations.filter((b) => !inBox(b.ty * n + b.tx));
  for (const b of outerStations) for (const i of railPath(stationTiles(b), (i) => rail[i] === 1)) rail[i] = 1;
  // The quarters' line to the ring round them.
  const quarterRail: number[] = [];
  for (let i = 0; i < n * n; i += 1) {
    const x = i % n;
    const y = (i - x) / n;
    if (rail[i] && inBox(y * n + x)) quarterRail.push(i);
  }
  if (quarterRail.length > 0) for (const i of railPath(quarterRail, (i) => rail[i] === 1 && !inBox(i))) rail[i] = 1;
  // Wherever steep ground cut a line, the pieces joined again by the shortest way round: one railway.
  joinAll(n, stations, rail, (i) => free(i), stations[0]);
  // A station no railway could reach (in a flat pocket walled in by slopes, its one way in built over) is a
  // research forum instead: the same 4 x 6, so what it touches stays joined (measured: one in a metropolis).
  if (stations.length > 0) {
    const onLine = new Uint8Array(n * n);
    const queue = stationTiles(stations[0]!).filter((i) => rail[i]);
    for (const i of queue) onLine[i] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const i = queue[head]!;
      const x = i % n;
      for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, i - n, i + n]) {
        if (j < 0 || j >= n * n || onLine[j] || !rail[j]) continue;
        onLine[j] = 1;
        queue.push(j);
      }
    }
    // Rails through other stations join too: their far sides count as reached once a near side is.
    for (let round = 0; round < stations.length; round += 1) {
      let grew = false;
      for (const b of stations) {
        const around = stationTiles(b).filter((i) => rail[i]);
        if (!around.some((i) => onLine[i]) || around.every((i) => onLine[i])) continue;
        const more = around.filter((i) => !onLine[i]);
        for (const i of more) onLine[i] = 1;
        for (let head = 0; head < more.length; head += 1) {
          const i = more[head]!;
          const x = i % n;
          for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, i - n, i + n]) {
            if (j < 0 || j >= n * n || onLine[j] || !rail[j]) continue;
            onLine[j] = 1;
            more.push(j);
          }
        }
        grew = true;
      }
      if (!grew) break;
    }
    for (const b of stations) {
      if (stationTiles(b).some((i) => onLine[i])) continue;
      const k = placed.indexOf(b);
      if (k >= 0) placed[k] = { ...b, type: "research_forum" };
    }
  }

  // A rail tile with no rail beside it (a piece of lane stranded between slopes and buildings, which nothing
  // could join) is taken up: no train could ever run on it (three in one city, measured).
  for (let i = 0; i < n * n; i += 1) {
    if (!rail[i]) continue;
    const x = i % n;
    if (!(x > 0 && rail[i - 1]) && !(x < n - 1 && rail[i + 1]) && !(i >= n && rail[i - n]) && !(i < n * n - n && rail[i + n])) rail[i] = 0;
  }

  // 8. The lists.
  const listOf = (grid: Uint8Array): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n * n; i += 1) if (grid[i]) out.push(tileKey(i % n, Math.floor(i / n)));
    return out;
  };
  s = { ...s1, buildings: [...placed], corridors: listOf(corridor), cables: listOf(cable), rails: listOf(rail), zones, jobs: [] };

  // 9. People and full stores - and at work: rovers out levelling the avenues' ground, rockets away.
  s = { ...s, population: Math.floor(housing(s, t) * 0.9) };
  s = { ...s, stores: { ...capacities(s, t) } };
  state = withSettlement(state, s);
  for (let k = 0, sent = 0; k < 400 && sent < 12; k += 1) {
    const x = Math.floor(rnd() * n);
    const y = Math.floor(rnd() * n);
    const o = levelGround(state, id, x, y, t);
    if (o.ok) {
      state = o.state;
      sent += 1;
    }
  }
  s = settlementOf(state);
  const rockets: SettlementJob[] = [];
  for (const b of s.buildings) {
    if (b.type === "spaceport" && rnd() < 0.5) rockets.push({ kind: "rocket", tile: tileKey(b.tx, b.ty), total: t.ROCKET_TRIP_YEARS, remaining: t.ROCKET_TRIP_YEARS * (0.05 + 0.9 * rnd()) });
  }
  return withSettlement(state, { ...s, jobs: [...s.jobs, ...rockets] });
}

/**
 * Join every group of buildings (and the links of `corridor` - a corridor or a
 * railway grid) to the first's, in one sweep: a flood out from the first
 * group's footprints and links over free ground; where it meets
 * another group, the way back is laid as corridor and that group floods on
 * with it. (The game's own `linksToConnect` sweeps the whole grid once per
 * group: over a million tiles and hundreds of groups, minutes.)
 */
function joinAll(n: number, buildings: readonly PlacedBuilding[], corridor: Uint8Array, free: (i: number) => boolean, first: PlacedBuilding | undefined): void {
  // Groups: 4-connected pieces of footprint and corridor.
  const solid = new Uint8Array(n * n);
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.type];
    for (let y = b.ty; y < b.ty + d.depth; y += 1) for (let x = b.tx; x < b.tx + d.footprint; x += 1) solid[y * n + x] = 1;
  }
  for (let i = 0; i < n * n; i += 1) if (corridor[i]) solid[i] = 1;
  const group = new Int32Array(n * n).fill(-1);
  const members: number[][] = [];
  const neighbours = (i: number): number[] => {
    const x = i % n;
    const out: number[] = [];
    if (x > 0) out.push(i - 1);
    if (x < n - 1) out.push(i + 1);
    if (i >= n) out.push(i - n);
    if (i < n * n - n) out.push(i + n);
    return out;
  };
  for (let i = 0; i < n * n; i += 1) {
    if (!solid[i] || group[i]! >= 0) continue;
    const g = members.length;
    const list = [i];
    group[i] = g;
    for (let h = 0; h < list.length; h += 1) for (const j of neighbours(list[h]!)) if (solid[j] && group[j]! < 0) {
      group[j] = g;
      list.push(j);
    }
    members.push(list);
  }
  if (members.length <= 1 || first === undefined) return;
  const b0 = first;
  const home = group[b0.ty * n + b0.tx]!;
  const joined = new Uint8Array(members.length);
  const prev = new Int32Array(n * n).fill(-2);
  const queue: number[] = [];
  const flood = (g: number): void => {
    joined[g] = 1;
    for (const i of members[g]!) {
      prev[i] = -1;
      queue.push(i);
    }
  };
  flood(home);
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]!;
    for (const j of neighbours(i)) {
      if (prev[j] !== -2) continue;
      if (solid[j]) {
        const g = group[j]!;
        if (joined[g]) continue;
        // Met another group: lay the way back to the joined ones, and flood on from it.
        for (let k = i; k >= 0 && !solid[k]; k = prev[k]!) corridor[k] = 1;
        flood(g);
        continue;
      }
      if (!free(j)) continue;
      prev[j] = i;
      queue.push(j);
    }
  }
}
