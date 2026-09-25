/**
 * The example planet (at the user's request): Mars at the end of the
 * reference playthrough - fully habitable, the best the simulation's own
 * playthrough ever gets - with a thriving civilisation on it.
 *
 *   27 cities, 3 of them metropolises (3 x 3 a city's ground), and 15
 *   outposts, of every size from a handful of buildings to hundreds - laid
 *   out in zones: homes, power, industry, a port, and mixed districts,
 *   spread from the centre to the corners and joined by corridor and cable.
 *
 * Deterministic: the same planet every time, from the same code the game
 * runs. The world comes from `advance`, not from numbers typed in; the
 * settlements are placed by the same rules `placeBuilding` enforces (on the
 * grid, off steep ground, never overlapping, only what the kind may build),
 * checked in `example.test.ts`. Pure - no Node, no DOM - so the browser can
 * build it too.
 */

import type { BuildingType, HabitatChannels, PlacedBuilding, Route, Settlement, SettlementKind, SimState, Tuning, Zone as PlannerZone } from "../sim/index.js";
import {
  BUILDING_DEFS,
  NEUTRAL_ENV,
  advance,
  capacities,
  claimTest,
  derive,
  evaluatePhase,
  foundSettlement,
  groundOf,
  habitat,
  rocksOf,
  housing,
  latchPhase,
  liquidWaterRate,
  marsStart,
  nextSubstepFlows,
  linksToConnect,
  tileKey,
  routeKm,
  seedBiosphere,
  siteElevation,
  worldEnv,
} from "../sim/index.js";
import { buildMetropolis } from "./metropolis.js";
import { cityPlan, growCity } from "./metropolis-outer.js";
import { REFERENCE_POLICY, applyOrdersDue } from "./policy.js";

/** Where the reference playthrough has plateaued: progress 98.6%, Phase 6 (measured). */
export const EXAMPLE_YEARS = 2800;

export const EXAMPLE_COUNTS = { cities: 24, metropolises: 3, outposts: 15 } as const;

/** Mars run through the reference playthrough, as the harness runs it. */
export function terraformedMars(physics: Tuning, years = EXAMPLE_YEARS): SimState {
  let state = marsStart();
  const applied = new Set<number>();
  const cfg = { tuning: physics, env: NEUTRAL_ENV, forcing: null };
  const chunk = 8;
  for (let year = 0; year < years; year += chunk * physics.SUBSTEP_YEARS) {
    state = applyOrdersDue(state, REFERENCE_POLICY, year, applied, physics);
    const env = worldEnv(state, NEUTRAL_ENV, physics);
    if (REFERENCE_POLICY.seedAt >= 0 && !state.seeded && year >= REFERENCE_POLICY.seedAt) {
      state = seedBiosphere(state, physics, env).state;
    }
    state = advance(state, chunk, cfg);
    const d = derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, physics), physics);
    state = { ...state, phaseReached: latchPhase(state.phaseReached, evaluatePhase(state.reservoirs, d, worldEnv(state, NEUTRAL_ENV, physics), physics)) };
  }
  return state;
}

/** A small deterministic generator (the simulation may not use Math.random, and neither does this). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function angularDistance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const c = Math.sin(a.lat) * Math.sin(b.lat) + Math.cos(a.lat) * Math.cos(b.lat) * Math.cos(a.lon - b.lon);
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

/**
 * Zones (at the user's request: "mining zones, habitat zones, solar panel
 * zones, some mixed of any type, a port zone with for example 4 spaceports
 * lined up, all interconnected, not cramped up. Things at the corners, and
 * things at the center, decentralized").
 */
type Zone = "habitat" | "power" | "industry" | "port" | "mixed";

const ZONE_OF: Readonly<Record<BuildingType, Zone>> = {
  habitat_dome: "habitat",
  greenhouse: "habitat",
  solar_array: "power",
  geothermal_plant: "power",
  reactor: "power",
  regolith_mine: "industry",
  water_extractor: "industry",
  storage_depot: "industry",
  rover_post: "industry",
  atmosphere_processor: "industry",
  spaceport: "port",
  laboratory: "mixed",
  algae_reactor: "habitat",
  skyscraper: "habitat",
  observatory: "mixed",
  station: "port",
  research_forum: "mixed",
  medical_center: "habitat",
  industrial_command: "industry",
  wind_turbine: "power",
  mega_mall: "mixed",
  water_tank: "industry",
  battery_bank: "power",
  freezer: "habitat",
  materials_depot: "industry",
  park: "mixed",
  biosphere: "habitat",
  headquarters: "mixed",
};

/** Free tiles kept round every building: a street each side, so no two stand closer than this. */
const STREET = 2;

/**
 * Where each zone's districts lie on an `n`-tile grid, as fractions of it:
 * the centre is the mixed heart round the headquarters; the corners and edges
 * hold the rest, so the city spreads out from its middle. A small city has
 * too few buildings to reach its corners, and keeps its districts close.
 */
function districts(kind: SettlementKind, size: number): Readonly<Record<Zone, readonly (readonly [number, number])[]>> {
  if (kind === "outpost") {
    return { habitat: [[0.5, 0.5]], power: [[0.3, 0.3]], industry: [[0.7, 0.7], [0.3, 0.7]], port: [[0.7, 0.3]], mixed: [[0.5, 0.5]] };
  }
  if (size <= 3) {
    return { habitat: [[0.4, 0.62]], power: [[0.62, 0.38]], industry: [[0.62, 0.62]], port: [[0.62, 0.45]], mixed: [[0.4, 0.4]] };
  }
  if (size <= 9) {
    return { habitat: [[0.3, 0.7], [0.7, 0.7]], power: [[0.72, 0.28]], industry: [[0.28, 0.3]], port: [[0.5, 0.2]], mixed: [[0.5, 0.5]] };
  }
  if (kind === "metropolis") {
    // Nine districts a side of three: a heart, habitat rings, industry and power on the corners, the port along the north.
    return {
      habitat: [[0.5, 0.78], [0.22, 0.5], [0.78, 0.5], [0.35, 0.65], [0.65, 0.65]],
      power: [[0.15, 0.15], [0.85, 0.85], [0.85, 0.15]],
      industry: [[0.15, 0.85], [0.3, 0.3], [0.7, 0.3]],
      port: [[0.5, 0.12]],
      mixed: [[0.5, 0.5], [0.35, 0.4], [0.65, 0.4]],
    };
  }
  return {
    habitat: [[0.25, 0.75], [0.75, 0.75], [0.5, 0.8]],
    power: [[0.8, 0.2]],
    industry: [[0.2, 0.2]],
    port: [[0.5, 0.14]],
    mixed: [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5]],
  };
}

/**
 * A settlement laid out in zones, by the rules: each building goes to its
 * zone's district (a share of every kind to the mixed ones), on the free,
 * reachable, buildable ground nearest the district's middle, with a street
 * of `STREET` tiles clear all round it. A port's spaceports go in one line.
 * What does not fit is left out.
 */
function layOut(s: Settlement, wants: readonly BuildingType[], size: number, t: Tuning): PlacedBuilding[] {
  const ground = groundOf(s, t);
  const rocks = rocksOf(s, t);
  const n = ground.tiles;
  const taken = new Uint8Array(n * n);
  // What the settlement was founded with (the headquarters, a spaceport) stays where it landed.
  const placed: PlacedBuilding[] = [...s.buildings];
  const occupy = (x0: number, y0: number, sz: number, sd = sz): void => {
    for (let y = y0; y < y0 + sd; y += 1) for (let x = x0; x < x0 + sz; x += 1) taken[y * n + x] = 1;
  };
  for (const b of s.buildings) occupy(b.tx, b.ty, BUILDING_DEFS[b.type].footprint, BUILDING_DEFS[b.type].depth);
  // Only ground a corridor can reach from the centre, round hard rock too: a
  // pocket walled off is one no player could connect (the first version with
  // roads built 23 buildings in such a pocket, and its domes had no oxygen).
  const open = (i: number): boolean => !ground.steep[i] && rocks[i] !== "crag";
  const reach = new Uint8Array(n * n);
  const hq = s.buildings.find((b) => b.type === "headquarters");
  const start = hq === undefined ? Math.floor(n / 2) * n + Math.floor(n / 2) : (hq.ty + 5) * n + hq.tx + 2;
  const stack = open(start) ? [start] : [];
  while (stack.length > 0) {
    const tile = stack.pop()!;
    if (reach[tile]) continue;
    reach[tile] = 1;
    const x = tile % n;
    const y = (tile - x) / n;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx >= 0 && ny >= 0 && nx < n && ny < n && !reach[ny * n + nx] && open(ny * n + nx)) stack.push(ny * n + nx);
    }
  }
  /** On reachable open ground, with a street clear of every building all round (and room for it at the grid's edge). */
  const fits = (tx: number, ty: number, sz: number, sd = sz): boolean => {
    if (tx < 1 || ty < 1 || tx + sz > n - 1 || ty + sd > n - 1) return false;
    for (let y = ty; y < ty + sd; y += 1) for (let x = tx; x < tx + sz; x += 1) if (!reach[y * n + x]) return false;
    for (let y = Math.max(0, ty - STREET); y < Math.min(n, ty + sd + STREET); y += 1) {
      for (let x = Math.max(0, tx - STREET); x < Math.min(n, tx + sz + STREET); x += 1) if (taken[y * n + x]) return false;
    }
    return true;
  };
  const put = (type: BuildingType, tx: number, ty: number): void => {
    occupy(tx, ty, BUILDING_DEFS[type].footprint, BUILDING_DEFS[type].depth);
    placed.push({ type, tx, ty, level: 1 });
  };
  /** The free spot nearest (ax, ay) for a footprint of `sz`, searched outwards in square rings. */
  const nearest = (ax: number, ay: number, sz: number, sd = sz): [number, number] | null => {
    const cx = Math.round(ax - sz / 2);
    const cy = Math.round(ay - sd / 2);
    for (let r = 0; r < n; r += 1) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let y = cy - r; y <= cy + r; y += 1) {
        for (let x = cx - r; x <= cx + r; x += 1) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !fits(x, y, sz, sd)) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d < bestD) {
            bestD = d;
            best = [x, y];
          }
        }
      }
      if (best !== null) return best;
    }
    return null;
  };
  const plan = districts(s.kind, size);
  const at = (zone: Zone, k: number): [number, number] => {
    const list = plan[zone];
    const [fx, fy] = list[k % list.length]!;
    return [fx * n, fy * n];
  };

  // The port first: its spaceports in one line, a street apart, west to east.
  const ports = wants.filter((w) => w === "spaceport");
  if (ports.length > 0) {
    const [px, py] = at("port", 0);
    const stride = 3 + STREET;
    const width = ports.length * stride - STREET;
    let row: [number, number] | null = null;
    for (let r = 0; r < n && row === null; r += 1) {
      for (let dy = -r; dy <= r && row === null; dy += 1) {
        for (let dx = -r; dx <= r && row === null; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x0 = Math.round(px - width / 2) + dx;
          const y0 = Math.round(py - 1.5) + dy;
          if (ports.every((_, i) => fits(x0 + i * stride, y0, 3))) row = [x0, y0];
        }
      }
    }
    if (row !== null) ports.forEach((_, i) => put("spaceport", row![0] + i * stride, row![1]));
  }

  // Everything else to its district; every fourth of each kind to a mixed one.
  const seen = new Map<BuildingType, number>();
  const turn = new Map<Zone, number>();
  for (const type of wants) {
    if (type === "spaceport" && ports.length > 0) continue;
    const k = seen.get(type) ?? 0;
    seen.set(type, k + 1);
    const zone: Zone = k % 4 === 3 ? "mixed" : ZONE_OF[type];
    // Districts of a zone take turns, a few buildings at a time, so each grows as a block.
    const j = turn.get(zone) ?? 0;
    turn.set(zone, j + 1);
    const [ax, ay] = at(zone, Math.floor(j / 6));
    const spot = nearest(ax, ay, BUILDING_DEFS[type].footprint, BUILDING_DEFS[type].depth);
    if (spot !== null) put(type, spot[0], spot[1]);
  }
  return placed;
}

/**
 * Streets: a corridor on every open, buildable tile beside a building (the
 * layout leaves a one-tile street round each), then whatever corridor it
 * takes to join what the streets leave apart; and the power cables that
 * join every building - so each is on one network of each, as the game with
 * networks requires.
 */
function streets(s: Settlement, t: Tuning): { corridors: number[]; cables: number[] } {
  // No street round every building (the user: "far, far too many corridors ...
  // think of it like a huge motherboard, there aren't roads everywhere"):
  // the shortest traces that join every building, and power along the same.
  const corridors = linksToConnect(s, "corridors", t).sort((a, b) => a - b);
  const cables = [...corridors, ...linksToConnect({ ...s, cables: corridors }, "cables", t)].sort((a, b) => a - b);
  return { corridors, cables };
}

/** The districts' middles on an `n`-tile grid, with the zone each is for, in the order of `districts`. */
function districtPoints(kind: SettlementKind, size: number, n: number): { zone: Zone; x: number; y: number }[] {
  const plan = districts(kind, size);
  const out: { zone: Zone; x: number; y: number }[] = [];
  for (const zone of ["mixed", "habitat", "power", "industry", "port"] as const) for (const [fx, fy] of plan[zone]) out.push({ zone, x: fx * n, y: fy * n });
  return out;
}

/**
 * A railway round a city's districts: from each district's middle to the
 * next, by angle round the city, back to the first - over open ground the
 * rules allow a railway on, across corridors (it bridges them).
 */
function railLoop(s: Settlement, size: number, t: Tuning): number[] {
  const ground = groundOf(s, t);
  const rocks = rocksOf(s, t);
  const n = ground.tiles;
  const under = new Uint8Array(n * n);
  for (const b of s.buildings) {
    const d = BUILDING_DEFS[b.type];
    for (let y = b.ty; y < b.ty + d.depth; y += 1) for (let x = b.tx; x < b.tx + d.footprint; x += 1) under[y * n + x] = 1;
  }
  const ours = claimTest(s, t);
  const passable = (i: number): boolean => !under[i] && !ground.steep[i] && rocks[i] !== "crag" && ours(i % n, Math.floor(i / n));
  const seen = new Set<string>();
  const points = districtPoints(s.kind, size, n)
    .filter((p) => {
      const key = `${Math.round(p.x)},${Math.round(p.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Math.atan2(a.y - n / 2, a.x - n / 2) - Math.atan2(b.y - n / 2, b.x - n / 2));
  if (points.length < 3) return [];
  /** The open tile nearest a point. */
  const nearestOpen = (x: number, y: number): number => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < n * n; i += 1) {
      if (!passable(i)) continue;
      const d = Math.hypot((i % n) + 0.5 - x, Math.floor(i / n) + 0.5 - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const stops = points.map((p) => nearestOpen(p.x, p.y)).filter((i) => i >= 0);
  const rail = new Set<number>();
  const near = (i: number, j: number): boolean => Math.abs((i % n) - (j % n)) + Math.abs(Math.floor(i / n) - Math.floor(j / n)) <= 2;
  /** Beside the line already laid, and not where this leg starts or ends: a second track alongside, which it keeps off. */
  const beside = (j: number, from: number, to: number): boolean => {
    if (rail.has(j) || near(j, from) || near(j, to)) return false;
    const x = j % n;
    return (x > 0 && rail.has(j - 1)) || (x < n - 1 && rail.has(j + 1)) || rail.has(j - n) || rail.has(j + n);
  };
  for (let k = 0; k < stops.length; k += 1) {
    const from = stops[k]!;
    const to = stops[(k + 1) % stops.length]!;
    // One line, a tile wide: each leg keeps off the ground beside the legs before it (laid over each
    // other, the loop came out in doubled stretches trains ran round in fours, measured); if it cannot, as it may.
    for (const strict of [true, false]) {
      const prev = new Int32Array(n * n).fill(-2);
      prev[from] = -1;
      const queue = [from];
      for (let head = 0; head < queue.length; head += 1) {
        const i = queue[head]!;
        if (i === to) break;
        const x = i % n;
        for (const j of [i + 1, i - 1, i + n, i - n]) {
          if (j < 0 || j >= n * n || prev[j] !== -2 || Math.abs((j % n) - x) > 1 || !passable(j) || (strict && beside(j, from, to))) continue;
          prev[j] = i;
          queue.push(j);
        }
      }
      if (prev[to] === -2) continue;
      for (let i = to; i >= 0; i = prev[i]!) rail.add(i);
      break;
    }
  }
  return [...rail].map((i) => tileKey(i % n, Math.floor(i / n))).sort((a, b) => a - b);
}

/** What each kind of district is called on the planner, and its colour. */
const ZONE_LOOK: Readonly<Record<Zone, { name: string; colour: string }>> = {
  mixed: { name: "Centre", colour: "#c46ad6" },
  habitat: { name: "Homes", colour: "#4f9dde" },
  power: { name: "Power", colour: "#f0b429" },
  // Not "Industry" and "Port": the districts a city grows are named those.
  industry: { name: "Old works", colour: "#e0803b" },
  port: { name: "Spaceport", colour: "#48c2b5" },
};

/**
 * A city's districts as zones of the planner (the user: "deep city planning
 * zones with different colours, purposes"): each building to the district
 * middle nearest it, each district the ground round its buildings, the
 * smaller districts drawn over the larger where they meet.
 */
function cityZones(s: Settlement, size: number, t: Tuning): PlannerZone[] {
  const n = groundOf(s, t).tiles;
  const ours = claimTest(s, t);
  const points = districtPoints(s.kind, size, n);
  const boxes = points.map(() => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, count: 0 }));
  for (const b of s.buildings) {
    if (b.type === "headquarters") continue;
    const d = BUILDING_DEFS[b.type];
    const cx = b.tx + d.footprint / 2;
    const cy = b.ty + d.depth / 2;
    let best = 0;
    points.forEach((p, k) => {
      if (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(points[best]!.x - cx, points[best]!.y - cy)) best = k;
    });
    const box = boxes[best]!;
    box.x0 = Math.min(box.x0, b.tx - 2);
    box.y0 = Math.min(box.y0, b.ty - 2);
    box.x1 = Math.max(box.x1, b.tx + d.footprint + 2);
    box.y1 = Math.max(box.y1, b.ty + d.depth + 2);
    box.count += 1;
  }
  const order = points.map((p, k) => ({ p, box: boxes[k]! })).filter((e) => e.box.count > 0);
  order.sort((a, b) => (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0) - (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0));
  const taken = new Set<number>();
  const counts = new Map<Zone, number>();
  const made: PlannerZone[] = [];
  for (const { p, box } of order) {
    const tiles: number[] = [];
    for (let y = Math.max(0, box.y0); y < Math.min(n, box.y1); y += 1) {
      for (let x = Math.max(0, box.x0); x < Math.min(n, box.x1); x += 1) {
        const k = tileKey(x, y);
        if (taken.has(k) || !ours(x, y)) continue;
        taken.add(k);
        tiles.push(k);
      }
    }
    if (tiles.length === 0) continue;
    const count = (counts.get(p.zone) ?? 0) + 1;
    counts.set(p.zone, count);
    made.push({ id: made.length + 1, name: `${ZONE_LOOK[p.zone].name} ${count}`, colour: ZONE_LOOK[p.zone].colour, tiles: tiles.sort((a, b) => a - b) });
  }
  return made;
}

/** Everything a settlement of `homes` domes needs, in the order to place it. */
function wishList(kind: SettlementKind, homes: number, founded: boolean, t: Tuning): BuildingType[] {
  if (kind === "outpost") {
    const out: BuildingType[] = [];
    // Outposts work the land: power, a mine, extractors, depots - no people.
    for (let i = 0; i < homes; i += 1) out.push(i % 3 === 0 ? "reactor" : "geothermal_plant", "regolith_mine", "water_extractor", "storage_depot", "solar_array");
    return out;
  }
  // A city is founded with its spaceport when the headquarters are on; otherwise it builds one first.
  const out: BuildingType[] = founded ? [] : ["spaceport"];
  // A port of four spaceports in a line for a city of any size (the user: "a
  // port zone with for example 4 spaceports lined up"), a geothermal plant to
  // power each; a metropolis's line is longer.
  if (homes >= 4) {
    const port = kind === "metropolis" ? 6 : 4;
    for (let i = 0; i < port; i += 1) out.push("spaceport", "geothermal_plant");
  }
  // Rover posts, one for every ROVER_POST_PEOPLE people the city will hold (nine homes in ten taken).
  const posts = Math.min(4, Math.floor((homes * t.DOME_HOUSING * 0.9) / t.ROVER_POST_PEOPLE));
  for (let i = 0; i < posts; i += 1) out.push("rover_post");
  // The later buildings (at the user's request), each with the power, water,
  // food and air to run it: a laboratory and algae in a mid-sized city, a
  // command center over the works of a large one; skyscrapers, an
  // observatory, a research forum and medical centers in a metropolis.
  if (homes >= 6) out.push("laboratory", "algae_reactor", "algae_reactor", "geothermal_plant", "water_extractor");
  if (homes >= 12) out.push("industrial_command", "geothermal_plant");
  if (kind === "metropolis") {
    for (let i = 0; i < 4; i += 1) out.push("skyscraper");
    out.push("observatory", "research_forum", "medical_center", "medical_center", "laboratory");
    for (let i = 0; i < 4; i += 1) out.push("reactor");
    for (let i = 0; i < 12; i += 1) out.push("water_extractor");
    for (let i = 0; i < 9; i += 1) out.push("greenhouse");
    for (let i = 0; i < 7; i += 1) out.push("algae_reactor");
  }
  // The later additions (at the user's request): stores of every kind, wind on a planet whose air turns
  // it, parks on a terraformed world, and in a large city a biosphere - each with what it needs to run.
  if (homes >= 4) out.push("water_tank", "battery_bank", "freezer", "park");
  if (homes >= 8) out.push("materials_depot", "wind_turbine", "wind_turbine", "park", "water_extractor");
  if (homes >= 12) out.push("biosphere", "geothermal_plant", "geothermal_plant", "water_extractor", "water_extractor", "water_extractor");
  for (let i = 0; i < homes; i += 1) {
    out.push("habitat_dome", "greenhouse", "geothermal_plant", "water_extractor", i % 2 === 0 ? "wind_turbine" : "solar_array");
    if (i % 4 === 3) out.push("park");
    if (i % 2 === 1) out.push("reactor", "storage_depot");
    // No Atmosphere Processors: on a finished planet the air holds 0.24 mbar
    // of CO2, below the 1 mbar they need, and all 144 of them stood idle
    // (measured). Their job is done; a finished city builds food and storage.
    if (i % 3 === 2) out.push("greenhouse", "storage_depot", "regolith_mine");
  }
  return out;
}

export interface ExamplePlanet {
  readonly state: SimState;
  /** The size (in domes, or work sets for an outpost) each settlement was laid out for, by id. */
  readonly sizes: Readonly<Record<string, number>>;
}

/**
 * The example planet. `physics` runs the playthrough (the calibrated default);
 * `game` is the tuning the settlements are built under (the browser's).
 */
export function examplePlanet(physics: Tuning, game: Tuning): ExamplePlanet {
  let state = terraformedMars(physics);
  const d = derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, game), game);
  const env: HabitatChannels = habitat(state.reservoirs, d, game, liquidWaterRate(nextSubstepFlows(state, { tuning: game, env: NEUTRAL_ENV, forcing: null })));
  const rnd = lcg(20260924);

  // Sizes from very small to very large, then the three metropolises.
  const citySizes = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 12, 14, 16, 18, 22, 26];
  const outpostSizes = [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 5, 6];
  const plan: { kind: SettlementKind; size: number }[] = [
    { kind: "metropolis", size: 90 },
    { kind: "metropolis", size: 120 },
    { kind: "metropolis", size: 150 },
    ...citySizes.map((size) => ({ kind: "city" as const, size })),
    ...outpostSizes.map((size) => ({ kind: "outpost" as const, size })),
  ];

  // Sites: high above the sea (nothing floods), and spread over the planet.
  const sites: { lat: number; lon: number }[] = [];
  for (const { kind } of plan) {
    const spacing = kind === "metropolis" ? 0.55 : 0.3;
    for (let tries = 0; tries < 20000; tries += 1) {
      const site = { lat: Math.asin((2 * rnd() - 1) * 0.92), lon: (2 * rnd() - 1) * Math.PI };
      if (siteElevation(site.lat, site.lon, game) < env.seaLevelM + 300) continue;
      if (sites.some((o) => angularDistance(o, site) < spacing)) continue;
      sites.push(site);
      break;
    }
  }

  const sizes: Record<string, number> = {};
  let cities = 0;
  plan.forEach(({ kind, size }, i) => {
    const site = sites[i];
    if (site === undefined) return;
    state = foundSettlement(state, kind, site.lat, site.lon, game).state;
    const founded = state.settlements[state.settlements.length - 1]!;
    sizes[founded.id] = size;
    if (kind === "metropolis") {
      // In quarters, on claimed land, and at work (see `metropolis.ts`).
      state = buildMetropolis(state, founded.id, env, game, rnd);
      return;
    }
    const buildings = layOut(founded, wishList(kind, size, founded.buildings.some((b) => b.type === "spaceport"), game), size, game);
    const laid: Settlement = { ...founded, buildings };
    const streeted: Settlement = { ...laid, ...streets(laid, game) };
    // A railway round the districts of any but the smallest city (the user: "the cities need more railways,
    // and working trains"), and each district a zone of the planner in its colour.
    const railed: Settlement = kind === "city" && size >= 4 ? { ...streeted, rails: railLoop(streeted, size, game) } : streeted;
    const built: Settlement = kind === "city" ? { ...railed, zones: cityZones(railed, size, game) } : railed;
    // A thriving settlement: full stores, nine in ten homes taken.
    const cap = capacities(built, game);
    const settled: Settlement = { ...built, stores: { ...cap }, population: Math.floor(housing(built, game) * 0.9) };
    state = { ...state, settlements: state.settlements.map((s) => (s.id === founded.id ? settled : s)) };
    if (kind === "city") {
      // Grown round its founding square (the user: "even normal cities way bigger - at least 3x3 tiles, at
      // most 17x17, blob shaped"): 3, 5, ... 17 chunks across, three cities of each, the bigger to the bigger.
      const K = 3 + 2 * Math.floor(cities / 3);
      cities += 1;
      state = growCity(state, founded.id, env, game, rnd, cityPlan(K));
    }
    sizes[founded.id] = size;
  });
  void env;
  return { state: { ...state, routes: interconnect(state.settlements) }, sizes };
}

/**
 * The railways between the example's settlements (the user: "we also need
 * interconnected cities"): every settlement joined to the rest by the
 * shortest lines that join them all, then each city and metropolis to the
 * nearest settlement it is not yet joined to - so the network has loops, and
 * no one line cut leaves a city alone.
 */
export function interconnect(settlements: readonly Settlement[]): Route[] {
  const list = settlements.filter((s) => s.lostAtSeaLevelM === null);
  if (list.length < 2) return [];
  const routes: Route[] = [];
  const joined = new Set<string>();
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const add = (a: Settlement, b: Settlement): void => {
    if (joined.has(key(a.id, b.id))) return;
    joined.add(key(a.id, b.id));
    routes.push({ a: a.id, b: b.id, km: routeKm(a, b) });
  };
  // Prim's tree, from the first settlement.
  const inTree = new Set([list[0]!.id]);
  while (inTree.size < list.length) {
    let best: [Settlement, Settlement, number] | null = null;
    for (const a of list) {
      if (!inTree.has(a.id)) continue;
      for (const b of list) {
        if (inTree.has(b.id)) continue;
        const km = routeKm(a, b);
        if (best === null || km < best[2]) best = [a, b, km];
      }
    }
    add(best![0], best![1]);
    inTree.add(best![1].id);
  }
  for (const a of list) {
    if (a.kind === "outpost") continue;
    const others = list.filter((b) => b.id !== a.id && !joined.has(key(a.id, b.id))).sort((p, q) => routeKm(a, p) - routeKm(a, q));
    if (others[0] !== undefined) add(a, others[0]);
  }
  return routes;
}
