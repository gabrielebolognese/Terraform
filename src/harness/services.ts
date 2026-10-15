/**
 * The example planet's services (Batch 32): its cities rebuilt to meet their
 * people's needs.
 *
 * The example was laid out before people needed more than life support, by
 * purpose: homes in suburbs and quarters, the mega malls in commerce, the
 * laboratories in research, the biospheres on the farms. With needs on, a
 * metropolis's homes were 1-10% in reach of each service, its mood -0.74,
 * and 13 of its 27 cities ran short of something for it (measured). So each
 * city that asks for a need is given its providers among the homes, and what
 * that costs is made good.
 *
 * A provider takes a rectangle of its footprint over buildings and open
 * ground - no link, no rock a rover is breaking, nothing a city keeps (the
 * headquarters, a port, a service). Every building under it goes; where one
 * stood beyond the rectangle, its ground carries a corridor and a cable. A
 * building joins both networks by touching, so the provider and those links
 * touch all it touched: every network stays joined as it was. (Whole
 * buildings only, a park found room for 58% of a city's homes, measured.)
 * The rectangle is chosen where the most homes not yet reached come into
 * reach, for the fewest homes lost. The example's own rules are kept: a
 * street of two tiles round a building on a city's founding square, sixteen
 * buildings at least on a grown chunk that had them, every building in a zone
 * (a provider joins the zone of what it replaced).
 *
 * Then what the replaced buildings made, and what the providers draw, is made
 * good by turning stores into producers in place (a 2 x 2 for a 2 x 2: no
 * network changes). Deterministic, as the rest of the example: no randomness
 * at all here.
 */

import type { BuildingType, HabitatChannels, MicroResource, NeedId, PlacedBuilding, Settlement, SimState, Tuning, Zone } from "../sim/index.js";
import {
  BUILDING_DEFS,
  NEEDS,
  NEED_BY_ID,
  capacities,
  claimTest,
  frameOf,
  garageApron,
  groundOf,
  housing,
  keyTile,
  levelFactor,
  needAskedFrom,
  reachSide,
  rocksOf,
  settlementStep,
  tileKey,
} from "../sim/index.js";
import { PURPOSES } from "./metropolis-outer.js";

/** What each need is given: the smallest building that meets it (food variety, a second way of growing food). */
const PROVIDER: Readonly<Record<NeedId, BuildingType>> = {
  shops: "mega_mall",
  transport: "station",
  medical: "medical_center",
  green: "park",
  research: "laboratory",
  variety: "biosphere",
};
/** The biggest first, while there is most room. */
const ORDER: readonly Exclude<NeedId, "variety">[] = ["shops", "transport", "medical", "green", "research"];

/** What a city keeps where it is: its heart, its ports, its rover posts, its works' command, and every service. */
const KEEP: ReadonlySet<BuildingType> = new Set<BuildingType>(["headquarters", "spaceport", "station", "rover_post", "industrial_command", ...NEEDS.flatMap((n) => (n.reach ? n.providers : [])), "biosphere", "mega_mall"]);

/** Stores that may become producers in place, and what each shortage turns them into. */
const MAKES: Readonly<Record<Exclude<MicroResource, "materials">, { into: BuildingType; from: readonly BuildingType[] }>> = {
  power: { into: "reactor", from: ["battery_bank", "water_tank", "freezer"] },
  water: { into: "water_extractor", from: ["water_tank", "freezer", "battery_bank"] },
  food: { into: "greenhouse", from: ["freezer", "water_tank", "battery_bank"] },
  oxygen: { into: "algae_reactor", from: ["water_tank", "freezer", "battery_bank"] },
};

/** The districts a city grows round its founding square (`metropolis-outer.ts`): not its own laid-out ground. */
const GROWN = new RegExp(`^(Works and stores|${Object.values(PURPOSES).map((p) => p.name).join("|")}) ?\\d*$`);
/** The street kept clear round a building on a city's founding square, tiles (`example.ts`'s STREET). */
const STREET = 2;
/** The fewest buildings a grown chunk with room holds (`metropolis-outer.ts`: 16 to 50 a chunk). */
const CHUNK_LEAST = 16;

export interface ServiceReport {
  /** Providers placed, by type. */
  readonly placed: Readonly<Partial<Record<BuildingType, number>>>;
  /** Housing lost to them. */
  readonly homesLost: number;
  /** Homes no provider could be put in reach of, by need. */
  readonly unserved: Readonly<Partial<Record<NeedId, number>>>;
  /** Stores turned into producers to make good. */
  readonly swapped: number;
}

const centreOf = (b: PlacedBuilding): [number, number] => [b.tx + BUILDING_DEFS[b.type].footprint / 2, b.ty + BUILDING_DEFS[b.type].depth / 2];

/** One city given what its people need. `log`, if given, hears how each need went. */
export function serveCity(s0: Settlement, env: HabitatChannels, t: Tuning, log?: (line: string) => void): { settlement: Settlement; report: ServiceReport } {
  let s = s0;
  const f = frameOf(s, t);
  const n = f.n;
  const C = t.CLAIM_CHUNK_TILES;
  const cu = Math.ceil(n / C);
  const ground = groundOf(s, t);
  const rocks = rocksOf(s, t);
  const ours = claimTest(s, t);
  const people = s.population;
  const homeTotal = housing(s, t);
  const housed = (b: PlacedBuilding): number => BUILDING_DEFS[b.type].housing(t) * levelFactor(b.level, t);

  // Ground no provider may take: off the city's land, steep, hard rock, a link, the garage's apron, where a rover
  // is - and, kept up to date as providers go in, under a building the city keeps. Float64, as the gains below.
  const blocked = new Float64Array(n * n);
  for (let i = 0; i < n * n; i += 1) if (!ours(i % n, Math.floor(i / n)) || ground.steep[i] || rocks[i] === "crag") blocked[i] = 1;
  const block = (k: number): void => {
    const { tx, ty } = keyTile(k);
    if (tx >= 0 && ty >= 0 && tx < n && ty < n) blocked[ty * n + tx] = 1;
  };
  for (const list of [s.corridors, s.cables, s.rails]) list.forEach(block);
  for (const a of garageApron(s)) block(tileKey(a.tx, a.ty));
  for (const j of s.jobs) {
    block(j.tile);
    if (j.kind !== "rocket") for (const k of j.route ?? []) block(k);
  }

  // Who stands where (kept up to date placement by placement: made afresh for each, the grid was 40 ms of every
  // placement in a city, measured), and how many buildings each chunk holds, by corner.
  const owner = new Int32Array(n * n).fill(-1);
  const standing: (PlacedBuilding | null)[] = [...s.buildings];
  const chunkOf = (b: PlacedBuilding): number => Math.floor(b.ty / C) * cu + Math.floor(b.tx / C);
  const inChunk = new Int32Array(cu * cu);
  const own = (b: PlacedBuilding, k: number): void => {
    const def = BUILDING_DEFS[b.type];
    for (let y = b.ty; y < b.ty + def.depth; y += 1) {
      for (let x = b.tx; x < b.tx + def.footprint; x += 1) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        owner[y * n + x] = k;
        if (KEEP.has(b.type)) blocked[y * n + x] = 1;
      }
    }
    if (b.tx >= 0 && b.ty >= 0 && b.tx < n && b.ty < n) inChunk[chunkOf(b)] = inChunk[chunkOf(b)]! + 1;
  };
  standing.forEach((b, k) => own(b!, k));
  // A chunk keeps the sixteen it had (a city's grown chunks hold 16 to 50).
  const least = Int32Array.from(inChunk, (c) => Math.min(c, CHUNK_LEAST));

  // The city's own laid-out ground - its founding square, but for the districts it grew - keeps its street.
  const zoneAt = new Map<number, number>();
  s.zones.forEach((z, k) => {
    for (const tile of z.tiles) zoneAt.set(tile, k);
  });
  const grown = new Set(s.zones.flatMap((z, k) => (GROWN.test(z.name) ? [k] : [])));
  const laidOut = (x: number, y: number): boolean => s.kind === "city" && x >= -f.x0 && y >= -f.y0 && x < -f.x0 + s.base && y < -f.y0 + s.base && !grown.has(zoneAt.get(tileKey(x, y)) ?? -1);

  // The people a placement may not take the city below: what its asked needs and its buildings want.
  const floor = Math.max(0, ...s.buildings.map((b) => BUILDING_DEFS[b.type].minPopulation(t)), ...NEEDS.filter((nd) => people >= needAskedFrom(nd, t)).map((nd) => needAskedFrom(nd, t)));
  let homesLost = 0;
  const peopleAfter = (loss: number): number => Math.floor((people * (homeTotal - homesLost - loss)) / Math.max(1, homeTotal));

  const links = new Set<number>();
  const zoneAdds = new Map<number, number[]>();
  const placed: Partial<Record<BuildingType, number>> = {};
  const unserved: Partial<Record<NeedId, number>> = {};

  /**
   * What a provider of `w` x `d` with its corner at (x0, y0) would replace -
   * the buildings under it - or null where it may not go: blocked ground, no
   * building under it (whose networks it takes over), the city's people
   * below what it needs, a chunk thinned below its sixteen, or a laid-out
   * building within the street.
   */
  const under = (x0: number, y0: number, w: number, d: number): { gone: number[]; loss: number; tiles: number } | null => {
    if (x0 < 0 || y0 < 0 || x0 + w > n || y0 + d > n) return null;
    const gone: number[] = [];
    let loss = 0;
    let tiles = 0;
    for (let y = y0; y < y0 + d; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        if (blocked[y * n + x]) return null;
        const k = owner[y * n + x]!;
        if (k < 0 || gone.includes(k)) continue;
        gone.push(k);
        const b = standing[k]!;
        loss += housed(b);
        tiles += BUILDING_DEFS[b.type].footprint * BUILDING_DEFS[b.type].depth;
      }
    }
    if (gone.length === 0) return null;
    if (loss > 0 && peopleAfter(loss) < floor) return null;
    // Chunks: what each loses, and the provider's own gains one.
    const corner = Math.floor(y0 / C) * cu + Math.floor(x0 / C);
    const change = new Map<number, number>([[corner, 1]]);
    for (const k of gone) {
      const c = chunkOf(standing[k]!);
      change.set(c, (change.get(c) ?? 0) - 1);
    }
    for (const [c, dc] of change) if (dc < 0 && inChunk[c]! + dc < least[c]!) return null;
    if (laidOut(x0, y0)) {
      for (let y = y0 - STREET; y < y0 + d + STREET; y += 1) {
        for (let x = x0 - STREET; x < x0 + w + STREET; x += 1) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const k = owner[y * n + x]!;
          if (k >= 0 && !gone.includes(k)) return null;
        }
      }
    }
    return { gone, loss, tiles };
  };

  /** Put a provider down over what it replaces; their ground beyond it becomes corridor and cable. */
  const put = (type: BuildingType, x0: number, y0: number, gone: readonly number[], loss: number): PlacedBuilding => {
    const def = BUILDING_DEFS[type];
    // Its zone: the zone of the first building it replaces (every one of which stood in one).
    const zone = zoneAt.get(tileKey(standing[gone[0]!]!.tx, standing[gone[0]!]!.ty));
    for (const k of gone) {
      const b = standing[k]!;
      const bd = BUILDING_DEFS[b.type];
      inChunk[chunkOf(b)] = inChunk[chunkOf(b)]! - 1;
      standing[k] = null;
      for (let y = b.ty; y < b.ty + bd.depth; y += 1) {
        for (let x = b.tx; x < b.tx + bd.footprint; x += 1) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          owner[y * n + x] = -1;
          if (x >= x0 && x < x0 + def.footprint && y >= y0 && y < y0 + def.depth) continue;
          links.add(tileKey(x, y));
          blocked[y * n + x] = 1;
        }
      }
    }
    const provider: PlacedBuilding = { type, tx: x0, ty: y0, level: 1 };
    standing.push(provider);
    own(provider, standing.length - 1);
    if (zone !== undefined) {
      for (let y = y0; y < y0 + def.depth; y += 1) {
        for (let x = x0; x < x0 + def.footprint; x += 1) {
          if (zoneAt.has(tileKey(x, y))) continue;
          zoneAt.set(tileKey(x, y), zone);
          zoneAdds.set(zone, [...(zoneAdds.get(zone) ?? []), tileKey(x, y)]);
        }
      }
    }
    homesLost += loss;
    placed[type] = (placed[type] ?? 0) + 1;
    return provider;
  };

  /**
   * The housing of the homes not yet reached, as running sums along each row
   * (`row[y * (n + 1) + x]` is the sum of the row's first x tiles): kept up
   * to date as homes are reached, and summed over a square a row at a time.
   * (The whole grid's 2-D sums made again for every placement were 6.4 s of
   * a metropolis's 15, measured.)
   */
  const row = new Float64Array((n + 1) * n);
  const addGain = (i: number, v: number): void => {
    const y = Math.floor(i / n);
    for (let x = (i % n) + 1, k = y * (n + 1) + x; x <= n; x += 1, k += 1) row[k] = row[k]! + v;
  };
  const gainIn = (x0: number, y0: number, x1: number, y1: number): number => {
    const a = Math.max(0, x0);
    const c = Math.min(n, x1);
    if (c <= a) return 0;
    let sum = 0;
    for (let y = Math.max(0, y0); y < Math.min(n, y1); y += 1) sum += row[y * (n + 1) + c]! - row[y * (n + 1) + a]!;
    return sum;
  };

  for (const id of ORDER) {
    const need = NEED_BY_ID[id];
    if (people < needAskedFrom(need, t)) continue;
    const began = Date.now();
    const type = PROVIDER[id];
    const w = BUILDING_DEFS[type].footprint;
    const d = BUILDING_DEFS[type].depth;
    const half = reachSide(1, t) / 2;
    // The homes, north to south, west to east: each in turn the target, until every one is reached or given up.
    const homes = standing.filter((b): b is PlacedBuilding => b !== null && BUILDING_DEFS[b.type].housing(t) > 0).sort((a, b) => a.ty - b.ty || a.tx - b.tx);
    const hx = Float64Array.from(homes, (b) => centreOf(b)[0]);
    const hy = Float64Array.from(homes, (b) => centreOf(b)[1]);
    const at = Int32Array.from(homes, (_, k) => Math.min(n - 1, Math.max(0, Math.floor(hy[k]!))) * n + Math.min(n - 1, Math.max(0, Math.floor(hx[k]!))));
    const index = new Map(homes.map((b, k) => [b, k]));
    // Which some provider of this need reaches (by the square alone: the example is one network); and which are gone.
    const reached = new Set<PlacedBuilding>();
    const removed = new Set<PlacedBuilding>();
    row.fill(0);
    homes.forEach((b, k) => addGain(at[k]!, housed(b)));
    const reach = (p: PlacedBuilding): void => {
      const [px, py] = centreOf(p);
      const h = reachSide(p.level, t) / 2;
      for (let k = 0; k < homes.length; k += 1) {
        if (Math.abs(hx[k]! - px) > h || Math.abs(hy[k]! - py) > h) continue;
        const b = homes[k]!;
        if (reached.has(b) || removed.has(b)) continue;
        reached.add(b);
        addGain(at[k]!, -housed(b));
      }
    };
    for (const b of standing) if (b !== null && need.providers.includes(b.type)) reach(b);
    for (let ti = 0; ti < homes.length; ti += 1) {
      const target = homes[ti]!;
      if (reached.has(target) || removed.has(target)) continue;
      let best: { x: number; y: number; score: number; gone: number[]; loss: number } | null = null;
      // Every corner that puts the target's middle within the provider's square.
      for (let y0 = Math.ceil(hy[ti]! - half - d / 2); y0 <= Math.floor(hy[ti]! + half - d / 2); y0 += 1) {
        for (let x0 = Math.ceil(hx[ti]! - half - w / 2); x0 <= Math.floor(hx[ti]! + half - w / 2); x0 += 1) {
          const u = under(x0, y0, w, d);
          if (u === null) continue;
          const cx = x0 + w / 2;
          const cy = y0 + d / 2;
          const score = gainIn(Math.ceil(cx - half - 0.5), Math.ceil(cy - half - 0.5), Math.floor(cx + half) + 1, Math.floor(cy + half) + 1) - 2 * u.loss - 5 * u.tiles;
          if (best === null || score > best.score) best = { x: x0, y: y0, score, gone: u.gone, loss: u.loss };
        }
      }
      if (best === null) {
        unserved[id] = (unserved[id] ?? 0) + 1;
        continue;
      }
      for (const k of best.gone) {
        const b = standing[k]!;
        removed.add(b);
        const h = index.get(b);
        if (h !== undefined && !reached.has(b)) addGain(at[h]!, -housed(b));
      }
      reach(put(type, best.x, best.y, best.gone, best.loss));
    }
    log?.(`${s.id} ${id}: ${placed[type] ?? 0} placed, ${unserved[id] ?? 0} unserved, ${Date.now() - began} ms`);
  }

  // Food grown more than one way: a biosphere where a city grows its food one way only - anywhere, for the least lost.
  const kinds = new Set(standing.flatMap((b) => (b !== null && NEED_BY_ID.variety.providers.includes(b.type) ? [b.type] : [])));
  if (people >= needAskedFrom(NEED_BY_ID.variety, t) && kinds.size < t.FOOD_VARIETY_KINDS) {
    const w = BUILDING_DEFS.biosphere.footprint;
    const d = BUILDING_DEFS.biosphere.depth;
    let best: { x: number; y: number; cost: number; gone: number[]; loss: number } | null = null;
    for (let y0 = 0; y0 + d <= n; y0 += 1) {
      for (let x0 = 0; x0 + w <= n; x0 += 1) {
        const u = under(x0, y0, w, d);
        if (u === null) continue;
        const cost = 2 * u.loss + 5 * u.tiles;
        if (best === null || cost < best.cost) best = { x: x0, y: y0, cost, gone: u.gone, loss: u.loss };
      }
    }
    if (best !== null) put("biosphere", best.x, best.y, best.gone, best.loss);
    else unserved.variety = 1;
  }

  s = { ...s, buildings: standing.filter((b): b is PlacedBuilding => b !== null) };
  if (links.size > 0) {
    const merge = (list: readonly number[]): number[] => [...new Set([...list, ...links])].sort((a, b) => a - b);
    s = { ...s, corridors: merge(s.corridors), cables: merge(s.cables) };
  }
  if (zoneAdds.size > 0) s = { ...s, zones: s.zones.map((z: Zone, k) => (zoneAdds.has(k) ? { ...z, tiles: [...z.tiles, ...zoneAdds.get(k)!].sort((a, b) => a - b) } : z)) };
  // People as the homes left allow, in the same share; stores no fuller than their room.
  const home = housing(s, t);
  s = { ...s, population: Math.min(Math.floor(home * 0.9), Math.floor((people * home) / Math.max(1, homeTotal))) };
  const goodAt = Date.now();
  const made = makeGood(s, env, t);
  log?.(`${s.id} made good: ${made.swapped} swapped, ${Date.now() - goodAt} ms`);
  s = made.settlement;
  const cap = capacities(s, t);
  s = { ...s, stores: Object.fromEntries((Object.keys(s.stores) as MicroResource[]).map((r) => [r, Math.min(s.stores[r], cap[r])])) as Record<MicroResource, number> };
  return { settlement: s, report: { placed, homesLost, unserved, swapped: made.swapped } };
}

/**
 * What the city draws, made good: while a life-support resource is made at a
 * loss (as the city's own step finds it, needs off), stores become its
 * producers, one footprint for the same footprint.
 */
function makeGood(s0: Settlement, env: HabitatChannels, t: Tuning): { settlement: Settlement; swapped: number } {
  let s = s0;
  let swapped = 0;
  const plain: Tuning = t.NEEDS_ENABLED ? { ...t, NEEDS_ENABLED: 0 } : t;
  for (let round = 0; round < 12; round += 1) {
    const step = settlementStep(s, env, plain, plain.SUBSTEP_YEARS);
    const short = (["power", "water", "food", "oxygen"] as const).map((r) => [r, step.production[r] - step.consumption[r]] as const).filter(([, net]) => net < 1);
    if (short.length === 0) break;
    const buildings = [...s.buildings];
    let any = false;
    for (const [r, net] of short) {
      const { into, from } = MAKES[r];
      const def = BUILDING_DEFS[into];
      const each = (def.produces(t)[r] ?? 0) * (def.canOperate(env, t) ? def.efficiency(env, t) : 0);
      if (!(each > 0)) continue;
      // Enough for the loss and what the new producers draw of it, and a little over.
      let want = Math.ceil((1 - net) / each) + 1;
      for (const type of from) {
        for (let i = 0; i < buildings.length && want > 0; i += 1) {
          if (buildings[i]!.type !== type) continue;
          buildings[i] = { ...buildings[i]!, type: into };
          want -= 1;
          swapped += 1;
          any = true;
        }
      }
    }
    if (!any) break;
    s = { ...s, buildings };
  }
  return { settlement: s, swapped };
}

/** Every city of a state given what its people need (outposts house no one). */
export function serveCities(state: SimState, env: HabitatChannels, t: Tuning): { state: SimState; reports: Readonly<Record<string, ServiceReport>> } {
  const reports: Record<string, ServiceReport> = {};
  const settlements = state.settlements.map((s) => {
    if (s.kind === "outpost") return s;
    const { settlement, report } = serveCity(s, env, t);
    reports[s.id] = report;
    return settlement;
  });
  return { state: { ...state, settlements }, reports };
}
