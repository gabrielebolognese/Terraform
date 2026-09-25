/**
 * The example planet's metropolises (at the user's request: "make them 3x
 * bigger; a little more order, in quarters; after the zones, suburbs - 8
 * domes, or smaller clusters; in general the city full besides some parts,
 * very very wide, with ALL structures, including a railway station, rovers
 * going back and forth, an alive city; connected with many corridors, the
 * zones very busy").
 *
 * The founding square and a ring of claimed land round it are cut into
 * quarters on a grid, boulevards between them. The middle quarters are the
 * civic heart, the next ring homes, the next industry, power, the port and
 * mixed districts by the side of the city they face; the outer ring is
 * suburbs, clusters of domes with open ground between. Each quarter is
 * filled in rows, a street round every building. Every boulevard carries two
 * lanes of corridor and cable and a lane of railway; stations in several
 * quarters are joined by rail along them. Then what the city draws is made
 * good - power, water, food, oxygen - and it is set to work: rovers out,
 * rockets away, a few buildings going up.
 *
 * Built by the same rules the game enforces; `example.test.ts` replays them.
 */

import type { BuildingType, HabitatChannels, MicroResource, PlacedBuilding, Settlement, SettlementJob, SimState, Tuning } from "../sim/index.js";
import {
  BUILDING_DEFS,
  capacities,
  claimLand,
  claimTest,
  frameOf,
  groundOf,
  housing,
  linksForRedundancy,
  linksToConnect,
  rocksOf,
  roverCount,
  roverYears,
  garage,
  tileKey,
} from "../sim/index.js";

type Quarter = "civic" | "habitat" | "mixed" | "industry" | "power" | "port" | "suburb";

/** Free tiles kept round every building. */
const STREET = 2;
/** Tiles of boulevard between quarters. */
const BOULEVARD = 4;
/** About this many tiles from one quarter to the next. */
const QUARTER_PITCH = 44;

/** What each kind of quarter is filled with, in order, repeated until it is full or `times` runs out. */
const RECIPES: Readonly<Record<Exclude<Quarter, "suburb" | "port">, { first: readonly BuildingType[]; repeat: readonly BuildingType[]; times: number }>> = {
  civic: {
    first: ["observatory", "research_forum", "medical_center", "medical_center", "laboratory", "laboratory", "industrial_command"],
    repeat: ["skyscraper", "skyscraper", "algae_reactor", "habitat_dome", "storage_depot"],
    times: 6,
  },
  habitat: { first: [], repeat: ["habitat_dome", "habitat_dome", "greenhouse", "habitat_dome", "algae_reactor", "greenhouse"], times: 6 },
  mixed: { first: ["laboratory"], repeat: ["habitat_dome", "solar_array", "greenhouse", "storage_depot", "regolith_mine", "algae_reactor", "skyscraper"], times: 4 },
  // Atmosphere Processors too, the user asked for ALL structures: on a finished planet the air holds too
  // little CO2 for them, and they stand idle, as the simulation says they would.
  industry: { first: ["industrial_command", "rover_post", "atmosphere_processor", "atmosphere_processor", "geothermal_plant", "geothermal_plant"], repeat: ["regolith_mine", "regolith_mine", "storage_depot", "water_extractor", "regolith_mine"], times: 6 },
  power: { first: ["reactor", "reactor"], repeat: ["solar_array", "solar_array", "geothermal_plant", "solar_array", "geothermal_plant"], times: 6 },
};

export function buildMetropolis(start: SimState, id: string, env: HabitatChannels, t: Tuning, rnd: () => number): SimState {
  const settlementOf = (st: SimState): Settlement => st.settlements.find((c) => c.id === id)!;
  const withSettlement = (st: SimState, s: Settlement): SimState => ({ ...st, settlements: st.settlements.map((c) => (c.id === id ? s : c)) });

  // 1. Wider: a ring of claimed land round the founding square (people enough to claim it are coming).
  let state = withSettlement(start, { ...settlementOf(start), population: 1e6 });
  const founding = settlementOf(state);
  const per = founding.base / t.CLAIM_CHUNK_TILES;
  if (Number.isInteger(per)) {
    let ring: [number, number][] = [];
    for (let j = -1; j <= per; j += 1) for (let i = -1; i <= per; i += 1) if (i === -1 || j === -1 || i === per || j === per) ring.push([i, j]);
    for (let pass = 0; pass < 4 && ring.length > 0; pass += 1) {
      ring = ring.filter(([i, j]) => {
        const o = claimLand(state, id, i, j, t);
        if (o.ok) state = o.state;
        return !o.ok;
      });
    }
  }
  let s = settlementOf(state);
  const n = frameOf(s, t).n;
  const ground = groundOf(s, t);
  const rocks = rocksOf(s, t);
  const ours = claimTest(s, t);

  // 2. The ground a building may take: reachable from the headquarters, open, the city's.
  const taken = new Uint8Array(n * n);
  const placed: PlacedBuilding[] = [...s.buildings];
  const sizeOf = (type: BuildingType): [number, number] => [BUILDING_DEFS[type].footprint, BUILDING_DEFS[type].depth];
  const occupy = (x0: number, y0: number, w: number, h: number): void => {
    for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) taken[y * n + x] = 1;
  };
  for (const b of s.buildings) occupy(b.tx, b.ty, ...sizeOf(b.type));
  const open = (i: number): boolean => !ground.steep[i] && rocks[i] !== "crag" && ours(i % n, Math.floor(i / n));
  const reach = new Uint8Array(n * n);
  // From the headquarters' door, or - founded without one - the middle.
  const hq = s.buildings.find((b) => b.type === "headquarters");
  const stack = [hq === undefined ? Math.floor(n / 2) * n + Math.floor(n / 2) : (hq.ty + 5) * n + hq.tx + 2];
  while (stack.length > 0) {
    const tile = stack.pop()!;
    if (reach[tile] || !open(tile)) continue;
    reach[tile] = 1;
    const x = tile % n;
    const y = (tile - x) / n;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) if (nx >= 0 && ny >= 0 && nx < n && ny < n && !reach[ny * n + nx]) stack.push(ny * n + nx);
  }
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  const fits = (tx: number, ty: number, w: number, h: number, r: Rect): boolean => {
    if (tx < r.x0 || ty < r.y0 || tx + w > r.x1 || ty + h > r.y1) return false;
    for (let y = ty; y < ty + h; y += 1) for (let x = tx; x < tx + w; x += 1) if (!reach[y * n + x]) return false;
    for (let y = Math.max(0, ty - STREET); y < Math.min(n, ty + h + STREET); y += 1) for (let x = Math.max(0, tx - STREET); x < Math.min(n, tx + w + STREET); x += 1) if (taken[y * n + x]) return false;
    return true;
  };
  const put = (type: BuildingType, tx: number, ty: number): void => {
    occupy(tx, ty, ...sizeOf(type));
    placed.push({ type, tx, ty, level: 1 });
  };
  /**
   * The first slot in rows, from the quarter's back corner: the quarter fills
   * in order. Ground only ever fills up, so a footprint that found no slot in
   * a quarter never will, and one that did need not look before its last
   * slot again (without these, filling rescanned every quarter from its
   * corner at each try: 35% of a 13-second build).
   */
  const cursor = new Map<string, number>();
  const inRows = (type: BuildingType, r: Rect): boolean => {
    const [w, h] = sizeOf(type);
    const key = `${r.x0},${r.y0}|${w}x${h}`;
    const from = cursor.get(key) ?? 0;
    if (from < 0) return false;
    const span = r.x1 - r.x0;
    for (let at = from; ; at += 1) {
      const x = r.x0 + (at % span);
      const y = r.y0 + Math.floor(at / span);
      if (y + h > r.y1) break;
      if (x + w <= r.x1 && fits(x, y, w, h, r)) {
        put(type, x, y);
        cursor.set(key, at);
        return true;
      }
    }
    cursor.set(key, -1);
    return false;
  };
  /** The free slot nearest a point, for a suburb's cluster. */
  const near = (type: BuildingType, ax: number, ay: number, r: Rect): boolean => {
    const [w, h] = sizeOf(type);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = r.y0; y + h <= r.y1; y += 1) {
      for (let x = r.x0; x + w <= r.x1; x += 1) {
        const d = Math.hypot(x + w / 2 - ax, y + h / 2 - ay);
        if (d < bestD && fits(x, y, w, h, r)) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best === null) return false;
    put(type, best[0], best[1]);
    return true;
  };

  // 3. The quarters, and what each is.
  const count = Math.max(3, Math.round(n / QUARTER_PITCH));
  const pitch = Math.floor(n / count);
  const land = pitch - BOULEVARD;
  const mid = (count - 1) / 2;
  const quarters: { qi: number; qj: number; kind: Quarter; r: Rect }[] = [];
  for (let qj = 0; qj < count; qj += 1) {
    for (let qi = 0; qi < count; qi += 1) {
      const d = Math.max(Math.abs(qi - mid), Math.abs(qj - mid));
      const r = { x0: qi * pitch + BOULEVARD / 2, y0: qj * pitch + BOULEVARD / 2, x1: qi * pitch + BOULEVARD / 2 + land, y1: qj * pitch + BOULEVARD / 2 + land };
      // The side of the city it faces: the port to the north, industry east, power south, homes west.
      const a = Math.atan2(qj - mid, qi - mid);
      const side: Quarter = a < -2.36 || a > 2.36 ? "habitat" : a < -0.79 ? "port" : a < 0.79 ? "industry" : "power";
      let kind: Quarter;
      if (d < 1) kind = "civic";
      else if (d < 2) kind = (qi + qj) % 4 === 0 ? "mixed" : "habitat";
      else if (d >= mid - 0.01 && count > 4) kind = "suburb";
      else kind = (qi * 3 + qj) % 3 === 0 ? "habitat" : side === "port" && (qi + qj) % 2 === 0 ? "mixed" : side;
      quarters.push({ qi, qj, kind, r });
    }
  }
  // At most two port quarters: the rest of the north is mixed.
  let ports = 0;
  for (const q of quarters) if (q.kind === "port" && ++ports > 2) q.kind = "mixed";

  /** Each suburb's middle, to lay its own corridor to the nearest boulevard. */
  const suburbs: [number, number][] = [];

  // 4. Stations first, each at a quarter's corner by the boulevard's rail lane: in the port quarters and a few others.
  const stations: PlacedBuilding[] = [];
  const stationQuarters = quarters.filter((q) => q.kind === "port" || (q.kind === "civic" && q.qi === Math.floor(mid) && q.qj === Math.floor(mid)) || (q.kind === "industry" && (q.qi + q.qj) % 2 === 0) || (q.kind === "habitat" && q.qi === 1));
  for (const q of stationQuarters.slice(0, 7)) {
    const [w, h] = sizeOf("station");
    for (const [x, y] of [[q.r.x1 - w, q.r.y0], [q.r.x1 - w, q.r.y1 - h], [q.r.x0, q.r.y0]] as const) {
      if (fits(x, y, w, h, q.r)) {
        put("station", x, y);
        stations.push(placed[placed.length - 1]!);
        break;
      }
    }
  }

  // 5. Fill every quarter.
  for (const q of quarters) {
    if (q.kind === "suburb") {
      // One or two clusters of four to eight domes, a greenhouse or two, solar and water; open ground between.
      const clusters = 1 + Math.floor(rnd() * 2);
      for (let c = 0; c < clusters; c += 1) {
        const ax = q.r.x0 + 6 + rnd() * (land - 12);
        const ay = q.r.y0 + 6 + rnd() * (land - 12);
        const domes = 4 + Math.floor(rnd() * 5);
        for (let k = 0; k < domes; k += 1) near("habitat_dome", ax, ay, q.r);
        for (let k = 0; k < Math.ceil(domes / 3); k += 1) near("greenhouse", ax, ay, q.r);
        near("solar_array", ax, ay, q.r);
        near("solar_array", ax, ay, q.r);
        near("water_extractor", ax, ay, q.r);
        suburbs.push([Math.round(ax), Math.round(ay)]);
      }
      continue;
    }
    if (q.kind === "port") {
      // Six spaceports in a line along the front, then the depots.
      const [w] = sizeOf("spaceport");
      for (let y = q.r.y1 - 3; y >= q.r.y0; y -= 1) {
        let x = q.r.x0;
        const line: number[] = [];
        while (line.length < 6 && x + w <= q.r.x1) {
          if (fits(x, y, w, w, q.r)) {
            line.push(x);
            x += w + STREET;
          } else break;
        }
        if (line.length === 6) {
          for (const lx of line) put("spaceport", lx, y);
          break;
        }
      }
      for (const type of ["storage_depot", "storage_depot", "water_extractor", "rover_post", "storage_depot", "laboratory"] as const) inRows(type, q.r);
      continue;
    }
    const recipe = RECIPES[q.kind];
    for (const type of recipe.first) inRows(type, q.r);
    // Until the quarter is full ("the zones are very busy") - but power quarters keep room for what the city will draw.
    const passes = q.kind === "power" ? 2 : 40;
    for (let k = 0; k < passes; k += 1) {
      let any = false;
      for (const type of recipe.repeat) any = inRows(type, q.r) || any;
      if (!any) break;
    }
  }

  // 6. What the city draws, made good: producers added, in the power and industry quarters first, until nothing runs short.
  // A running total, each building counted once (summed afresh per addition, it was 1.2 s a metropolis).
  const net = { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 };
  let counted = 0;
  const supply = (): Record<MicroResource, number> => {
    for (; counted < placed.length; counted += 1) {
      const def = BUILDING_DEFS[placed[counted]!.type];
      const eff = def.efficiency(env);
      for (const [r, v] of Object.entries(def.produces(t)) as [MicroResource, number][]) net[r] += v * eff;
      for (const [r, v] of Object.entries(def.consumes(t, env)) as [MicroResource, number][]) net[r] -= v;
    }
    return net;
  };
  const maker: Readonly<Record<Exclude<MicroResource, "materials">, BuildingType>> = { power: "reactor", water: "water_extractor", oxygen: "algae_reactor", food: "greenhouse" };
  const room = [...quarters.filter((q) => q.kind === "power" || q.kind === "industry"), ...quarters.filter((q) => q.kind === "mixed" || q.kind === "habitat"), ...quarters];
  for (let k = 0; k < 600; k += 1) {
    const net = supply();
    const short = (["power", "water", "food", "oxygen"] as const).find((r) => net[r] < 2);
    if (short === undefined) break;
    const type = maker[short];
    if (!room.some((q) => inRows(type, q.r)) && short === "power" && !room.some((q) => inRows("geothermal_plant", q.r))) break;
  }
  // What room the power quarters have left: solar fields.
  for (const q of quarters) if (q.kind === "power") while (inRows("solar_array", q.r));

  // 7. Streets round every building, two lanes of corridor and cable down every boulevard, a lane of rail.
  const lane = new Uint8Array(n * n);
  const railLane = new Uint8Array(n * n);
  for (let k = 1; k < count; k += 1) {
    const b0 = k * pitch - BOULEVARD / 2;
    for (let v = 0; v < n; v += 1) {
      for (const off of [1, 2]) {
        lane[v * n + b0 + off] = 1;
        lane[(b0 + off) * n + v] = 1;
      }
      railLane[v * n + b0] = 1;
      railLane[b0 * n + v] = 1;
    }
  }
  const free = (i: number): boolean => !taken[i] && reach[i] === 1;
  // A suburb's own roads in, two of them: straight from its middle to the nearest boulevard each way,
  // where the ground is free - so no one tile is the suburb's only way to the city.
  for (const [ax, ay] of suburbs) {
    const toX = Math.round((ax + BOULEVARD / 2) / pitch) * pitch - BOULEVARD / 2 + 1;
    const toY = Math.round((ay + BOULEVARD / 2) / pitch) * pitch - BOULEVARD / 2 + 1;
    for (const alongX of [true, false]) {
      const [a, b] = alongX ? [ax, toX] : [ay, toY];
      for (let v = Math.min(a, b); v <= Math.max(a, b); v += 1) {
        const i = alongX ? ay * n + v : v * n + ax;
        if (v >= 0 && v < n && i >= 0 && i < n * n && free(i)) lane[i] = 1;
      }
    }
  }
  const links: number[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      if (!free(i)) continue;
      // Streets two deep round every building: they meet across any gap the rows leave (one deep, a metropolis was 80 networks apart).
      let beside = false;
      for (let dy = -2; dy <= 2 && !beside; dy += 1) {
        for (let dx = -2; dx <= 2 && !beside; dx += 1) {
          const bx = x + dx;
          const by = y + dy;
          if ((dx !== 0 || dy !== 0) && bx >= 0 && by >= 0 && bx < n && by < n && taken[by * n + bx] && Math.abs(dx) + Math.abs(dy) <= 2) beside = true;
        }
      }
      if (beside || lane[i]) links.push(tileKey(x, y));
    }
  }
  s = { ...s, buildings: placed };
  const corridors = [...links, ...linksToConnect({ ...s, corridors: links }, "corridors", t)].sort((a, b) => a - b);
  const joined = [...corridors, ...linksForRedundancy({ ...s, corridors }, "corridors", t)].sort((a, b) => a - b);
  // Every building its own route to two others ("connect twice"): no one tile of corridor the only way in.
  const cables = [...joined, ...linksToConnect({ ...s, cables: joined }, "cables", t)].sort((a, b) => a - b);

  // 8. Railways: each station to the next, along the boulevards' rail lane.
  const rails = new Set<number>();
  const onRail = (i: number): boolean => railLane[i] === 1 && free(i);
  const aroundBy = (b: PlacedBuilding, passable: (i: number) => boolean): number[] => {
    const [w, h] = sizeOf(b.type);
    const out: number[] = [];
    for (let x = b.tx; x < b.tx + w; x += 1) out.push((b.ty - 1) * n + x, (b.ty + h) * n + x);
    for (let y = b.ty; y < b.ty + h; y += 1) out.push(y * n + b.tx - 1, y * n + b.tx + w);
    return out.filter((i) => i >= 0 && i < n * n && passable(i));
  };
  /** Whether the rails laid so far run from one station to another. */
  const joinedBy = (a: PlacedBuilding, b: PlacedBuilding): boolean => {
    const goal = new Set(aroundBy(b, (i) => rails.has(tileKey(i % n, Math.floor(i / n)))));
    const seen = new Set<number>();
    const queue = aroundBy(a, (i) => rails.has(tileKey(i % n, Math.floor(i / n))));
    for (let head = 0; head < queue.length; head += 1) {
      const tile = queue[head]!;
      if (goal.has(tile)) return true;
      if (seen.has(tile)) continue;
      seen.add(tile);
      const x = tile % n;
      for (const nt of [tile + 1, tile - 1, tile + n, tile - n]) if (nt >= 0 && nt < n * n && Math.abs((nt % n) - x) <= 1 && rails.has(tileKey(nt % n, Math.floor(nt / n)))) queue.push(nt);
    }
    return false;
  };
  const order = [...stations].sort((a, b) => Math.atan2(a.ty - n / 2, a.tx - n / 2) - Math.atan2(b.ty - n / 2, b.tx - n / 2));
  // Along the rail lane where it runs; where the ground cuts it, over any open ground.
  const anyGround = (i: number): boolean => free(i);
  for (const [k, passable] of order.flatMap((_, k) => [[k, onRail] as const, [k, anyGround] as const])) {
    const a = order[k]!;
    const b = order[(k + 1) % order.length]!;
    if (a === b) continue;
    // Already joined by the lane: nothing to lay.
    if (passable === anyGround && joinedBy(a, b)) continue;
    const goal = new Set(aroundBy(b, passable));
    const from = new Map<number, number>();
    const queue = aroundBy(a, passable);
    for (const q of queue) from.set(q, -1);
    let end = -1;
    for (let head = 0; head < queue.length && end < 0; head += 1) {
      const tile = queue[head]!;
      if (goal.has(tile)) {
        end = tile;
        break;
      }
      const x = tile % n;
      for (const nt of [tile + 1, tile - 1, tile + n, tile - n]) {
        if (nt < 0 || nt >= n * n || from.has(nt) || !passable(nt)) continue;
        if (Math.abs((nt % n) - x) > 1) continue;
        from.set(nt, tile);
        queue.push(nt);
      }
    }
    for (let tile = end; tile >= 0; tile = from.get(tile) ?? -1) rails.add(tileKey(tile % n, Math.floor(tile / n)));
  }

  // 9. People, full stores - and at work: rovers out, rockets away, a few buildings going up.
  s = { ...s, corridors: joined, cables, rails: [...rails].sort((a, b) => a - b) };
  s = { ...s, population: Math.floor(housing(s, t) * 0.9) };
  s = { ...s, stores: { ...capacities(s, t) } };
  const jobs: SettlementJob[] = [];
  const home = garage(s);
  if (home !== null) {
    const rovers = roverCount(s, t);
    const rockList = rocksOf(s, t)
      .map((r, i) => [r, i] as const)
      .filter(([r, i]) => r !== "none" && ours(i % n, Math.floor(i / n)))
      .map(([r, i]) => [r, i % n, Math.floor(i / n)] as const);
    for (let k = 0; k < Math.min(rovers - 2, 12) && rockList.length > 0; k += 1) {
      const [rock, x, y] = rockList[Math.floor(rnd() * rockList.length)]!;
      if (jobs.some((j) => j.tile === tileKey(x, y))) continue;
      const total = roverYears(s, x, y, rock, t);
      const work = rock === "crag" ? t.ROVER_WORK_YEARS_CRAG : t.ROVER_WORK_YEARS_LOOSE;
      jobs.push({ kind: "rover", tile: tileKey(x, y), materials: rock === "crag" ? t.ROCK_CRAG_MATERIALS : t.ROCK_LOOSE_MATERIALS, work, total, remaining: total * (0.15 + 0.8 * rnd()) });
    }
    for (const b of placed) {
      if (b.type === "spaceport" && rnd() < 0.5) jobs.push({ kind: "rocket", tile: tileKey(b.tx, b.ty), total: t.ROCKET_TRIP_YEARS, remaining: t.ROCKET_TRIP_YEARS * (0.05 + 0.9 * rnd()) });
    }
  }
  return withSettlement(state, { ...s, jobs });
}
