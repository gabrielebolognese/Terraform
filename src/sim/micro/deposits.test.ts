/**
 * Batch 37's exit gate - detail §3.1, "terrain resource deposits and siting
 * bonuses":
 *   - the same site always has the same deposits, and none are stored;
 *   - a mine on an ore vein out-produces one on bare ground by the tuned
 *     factor, measured through a real `advance`.
 * And the table's "typical location" column, as properties of the ground
 * the deposits land on - measured first, the measurement beside each bound.
 */

import { describe, expect, it } from "vitest";

import { derive } from "../derive.js";
import { habitat } from "../habitat.js";
import { advance, worldEnv } from "../integrate.js";
import { marsStart } from "../planets/mars.js";
import { deserialize, serialize } from "../save.js";
import { DEFAULT_TUNING, makeTuning } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import type { BuildingType, PlacedBuilding, SimState } from "../types.js";
import { NEUTRAL_ENV } from "../types.js";
import { DEPOSIT_KINDS, depositAt, depositBonus, depositOfCode, depositsOf, sitingOf } from "./deposits.js";
import type { DepositKind } from "./deposits.js";
import { foundSettlement } from "./registry.js";
import { chunkKey, frameOf } from "./space.js";
import { groundOf } from "./terrain.js";

/** The browser's ground, a city's founding square the browser's size, with deposits on - and the same with them off. */
const ON = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 96, DEPOSITS_ENABLED: 1 });
const OFF = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 96, DEPOSITS_ENABLED: 0 });
/** The pacing script's site (Batch 28). */
const HERE = { kind: "city" as const, lat: 0.31, lon: -1.2 };

const code = (k: DepositKind): number => DEPOSIT_KINDS.indexOf(k) + 1;

/** The corner of the first 2 x 2 square of the frame whose four tiles are all of `want` (a code), nearest the middle. */
function square(map: Uint8Array, n: number, want: (c: number) => boolean): { tx: number; ty: number } {
  let best: { tx: number; ty: number; d: number } | null = null;
  for (let ty = 0; ty + 1 < n; ty += 1) {
    for (let tx = 0; tx + 1 < n; tx += 1) {
      if (!(want(map[ty * n + tx]!) && want(map[ty * n + tx + 1]!) && want(map[(ty + 1) * n + tx]!) && want(map[(ty + 1) * n + tx + 1]!))) continue;
      const d = Math.hypot(tx + 1 - n / 2, ty + 1 - n / 2);
      if (best === null || d < best.d) best = { tx, ty, d };
    }
  }
  if (best === null) throw new Error("no such square");
  return best;
}

/**
 * A city with one building of `type` at (tx, ty), its stores full of all it
 * draws and empty of what it makes - so nothing browns out and what it made
 * in one substep is the store's rise. Planet as given (dry by default).
 */
function cityWith(type: BuildingType, at: { tx: number; ty: number }, t: Tuning, planet: (s: SimState) => SimState = (s) => s): SimState {
  const founded = foundSettlement(planet(marsStart(undefined, t)), "city", HERE.lat, HERE.lon, t);
  expect(founded.ok).toBe(true);
  const s = founded.state;
  const building: PlacedBuilding = { type, tx: at.tx, ty: at.ty, level: 1 };
  const full = { power: 1e8, water: 1e8, oxygen: 1e8, food: 1e8, materials: 1e8 };
  const made = { regolith_mine: "materials", water_extractor: "water", geothermal_plant: "power", solar_array: "power" } as const;
  const stores = { ...full, [made[type as keyof typeof made]]: 0 };
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: [building], stores })) };
}

/** What the city made of `resource` in one substep of the real `advance`, per year. */
function made(state: SimState, resource: "materials" | "water" | "power", t: Tuning): number {
  const next = advance(state, 1, { tuning: t, env: NEUTRAL_ENV, forcing: null });
  const h = t.SUBSTEP_YEARS * t.CITY_CLOCK;
  return (next.settlements[0]!.stores[resource] - state.settlements[0]!.stores[resource]) / h;
}

describe("a building on its deposit makes more, by the tuned factor, through a real advance (the exit gate)", () => {
  const map = depositsOf(HERE, ON);
  const n = frameOf(HERE, ON).n;
  const BARE = square(map, n, (c) => c === 0);

  const cases: readonly { kind: DepositKind; type: BuildingType; makes: "materials" | "water" | "power" }[] = [
    { kind: "ore", type: "regolith_mine", makes: "materials" },
    { kind: "ice", type: "water_extractor", makes: "water" },
    { kind: "vent", type: "geothermal_plant", makes: "power" },
    { kind: "sun", type: "solar_array", makes: "power" },
  ];
  for (const c of cases) {
    it(`a ${c.type.replace("_", " ")} wholly on ${c.kind} makes x(1 + its bonus) what one on bare ground makes`, () => {
      const on = made(cityWith(c.type, square(map, n, (x) => x === code(c.kind)), ON), c.makes, ON);
      const bare = made(cityWith(c.type, BARE, ON), c.makes, ON);
      // Not vacuous: the bare one makes something (5 materials, 5 water, 8 or 6 x sunlight power a year).
      expect(bare).toBeGreaterThan(1);
      const bonus = { ore: ON.ORE_BONUS, ice: ON.ICE_BONUS, vent: ON.VENT_BONUS, sun: ON.SUN_BONUS }[c.kind];
      expect(bonus).toBeGreaterThan(0);
      expect(on / bare).toBeCloseTo(1 + bonus, 9);
    });
  }

  it("partly on it, by the share of its footprint: a mine with two of its four tiles on ore makes x(1 + bonus / 2)", () => {
    // A square with exactly two ore tiles: the measure of the share rule.
    const ore = code("ore");
    let half: { tx: number; ty: number } | null = null;
    for (let ty = 0; ty + 1 < n && half === null; ty += 1) {
      for (let tx = 0; tx + 1 < n; tx += 1) {
        const four = [map[ty * n + tx]!, map[ty * n + tx + 1]!, map[(ty + 1) * n + tx]!, map[(ty + 1) * n + tx + 1]!];
        if (four.filter((v) => v === ore).length === 2) {
          half = { tx, ty };
          break;
        }
      }
    }
    expect(half).not.toBeNull();
    const on = made(cityWith("regolith_mine", half!, ON), "materials", ON);
    const bare = made(cityWith("regolith_mine", BARE, ON), "materials", ON);
    expect(on / bare).toBeCloseTo(1 + ON.ORE_BONUS / 2, 9);
  });

  it("a deposit boosts only its own building: a solar array on ore, a mine on ice, make what they make on bare ground", () => {
    const solar = made(cityWith("solar_array", square(map, n, (x) => x === code("ore")), ON), "power", ON);
    const mine = made(cityWith("regolith_mine", square(map, n, (x) => x === code("ice")), ON), "materials", ON);
    expect(solar).toBe(made(cityWith("solar_array", BARE, ON), "power", ON));
    expect(mine).toBe(made(cityWith("regolith_mine", BARE, ON), "materials", ON));
  });

  it("the ice's bonus fades as liquid water comes in reach (section 3.2): by the share of the water in reach", () => {
    // A real planet with liquid water on it: the habitat reads water access off the reservoirs.
    const wet = (s: SimState): SimState => ({ ...s, reservoirs: { ...s.reservoirs, h2o_liq: 13 } });
    const state = cityWith("water_extractor", square(map, n, (x) => x === code("ice")), ON, wet);
    const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, ON), ON), ON, 0);
    // Not vacuous: the planet has water in reach, and not all of it.
    expect(env.waterAccess).toBeGreaterThan(0.05);
    expect(env.waterAccess).toBeLessThan(0.95);
    const on = made(state, "water", ON);
    const bare = made(cityWith("water_extractor", BARE, ON, wet), "water", ON);
    expect(on / bare).toBeCloseTo(1 + ON.ICE_BONUS * (1 - env.waterAccess), 9);
    expect(depositBonus("ice", { ...env, waterAccess: 1 }, ON)).toBe(0);
  });

  it("with deposits off a mine on the same vein makes what one on bare ground makes, exactly", () => {
    const vein = square(map, n, (x) => x === code("ore"));
    expect(made(cityWith("regolith_mine", vein, OFF), "materials", OFF)).toBe(made(cityWith("regolith_mine", BARE, OFF), "materials", OFF));
    expect(DEFAULT_TUNING.DEPOSITS_ENABLED).toBe(0);
    expect(depositsOf(HERE, OFF).length).toBe(0);
    expect(sitingOf(cityWith("regolith_mine", vein, OFF).settlements[0]!, OFF)).toBeNull();
  });

  it("a variant tuning in the same process reads its own ground: where it finds no ore, the same city's mine makes x1", () => {
    // Invariant #4: a balance sweep runs variants side by side, on the very same state.
    const s = cityWith("regolith_mine", square(map, n, (x) => x === code("ore")), ON);
    const bare = made(cityWith("regolith_mine", BARE, ON), "materials", ON);
    expect(made(s, "materials", ON) / bare).toBeCloseTo(1 + ON.ORE_BONUS, 9);
    const NO_ORE = makeTuning({ ...ON, ORE_RISE_M: 1000 });
    expect(made(s, "materials", NO_ORE) / bare).toBe(1);
  });

  it("is chunk-independent: advance(s, 40) equals ten advance(s, 4) with a mine on its vein", () => {
    const s = cityWith("regolith_mine", square(map, n, (x) => x === code("ore")), ON);
    const cfg = { tuning: ON, env: NEUTRAL_ENV, forcing: null };
    let chunked = s;
    for (let k = 0; k < 10; k += 1) chunked = advance(chunked, 4, cfg);
    expect(chunked).toEqual(advance(s, 40, cfg));
  });
});

describe("the same site always has the same deposits, and none are stored", () => {
  it("the whole frame's map is the terrain's own tile by tile: what the view shows is what the simulation pays", () => {
    const map = depositsOf(HERE, ON);
    const n = frameOf(HERE, ON).n;
    let differ = 0;
    for (let ty = 0; ty < n; ty += 1) for (let tx = 0; tx < n; tx += 1) if (depositAt(HERE, tx, ty, ON) !== depositOfCode(map[ty * n + tx]!)) differ += 1;
    expect(differ).toBe(0);
  });

  it("claiming land west and north moves no deposit: the founding square's are where they were", () => {
    const before = depositsOf(HERE, ON);
    const claimed = { ...HERE, claims: [chunkKey(-1, 0), chunkKey(0, -1), chunkKey(-1, -1)] };
    const f = frameOf(claimed, ON);
    // Not vacuous: the frame moved.
    expect(f.x0).toBeLessThan(0);
    expect(f.y0).toBeLessThan(0);
    const after = depositsOf(claimed, ON);
    const n = frameOf(HERE, ON).n;
    let differ = 0;
    for (let ty = 0; ty < n; ty += 1) for (let tx = 0; tx < n; tx += 1) if (before[ty * n + tx] !== after[(ty - f.y0) * f.n + (tx - f.x0)]) differ += 1;
    expect(differ).toBe(0);
  });

  it("a saved and loaded city stands on the same deposits, its buildings on the same shares", () => {
    const map = depositsOf(HERE, ON);
    const n = frameOf(HERE, ON).n;
    const s = cityWith("regolith_mine", square(map, n, (x) => x === code("ore")), ON);
    const loaded = deserialize(serialize(s, ON, "2026-10-16T00:00:00.000Z"), ON);
    const city = loaded.settlements[0]!;
    expect([...depositsOf(city, ON)]).toEqual([...map]);
    expect(sitingOf(city, ON)?.shares[0]).toBe(1);
    // Nothing of the deposits is in the save: it is the same text with them on or off.
    expect(serialize(s, ON, "2026-10-16T00:00:00.000Z")).toBe(serialize(s, OFF, "2026-10-16T00:00:00.000Z"));
  });

  it("differs from place to place", () => {
    const here = depositsOf(HERE, ON);
    const there = depositsOf({ ...HERE, lon: -1.1 }, ON);
    expect(here.filter((c, i) => c !== there[i]).length).toBeGreaterThan(500);
  });
});

describe("where each deposit lies (the table's typical locations)", () => {
  /** Eight cities round a circle of latitude. */
  const at = (lat: number) => Array.from({ length: 8 }, (_, k) => ({ kind: "city" as const, lat, lon: -3 + k * 0.77 }));
  const share = (sites: ReturnType<typeof at>, kind: DepositKind): number => {
    let on = 0;
    let all = 0;
    for (const p of sites) {
      const d = depositsOf(p, ON);
      all += d.length;
      for (const c of d) if (c === code(kind)) on += 1;
    }
    return on / all;
  };

  it("every kind is found at every one of eight sites (the deposits are reachable, not a rarity)", () => {
    for (const p of at(0.31)) {
      const d = depositsOf(p, ON);
      for (const k of DEPOSIT_KINDS) expect(d.includes(code(k)), `${k} at ${p.lat}, ${p.lon}`).toBe(true);
    }
  });

  it("ore on high ground, ice on low: over eight sites, the ore's mean height above the ground's, the ice's below", () => {
    // Measured at the equator: ore 17.5 m, ice -15.2 m, the ground 0.2 m. (At one site of the eight, among mountains,
    // the ore on its hilltops stands 1.7 m against the site's 4.1: high is judged against the ground round it.)
    const sum = [0, 0, 0, 0, 0];
    const count = [0, 0, 0, 0, 0];
    for (const p of at(0)) {
      const g = groundOf(p, ON);
      depositsOf(p, ON).forEach((c, i) => {
        sum[c]! += g.heightM[i]!;
        count[c]! += 1;
      });
    }
    const ground = sum.reduce((a, b) => a + b, 0) / count.reduce((a, b) => a + b, 0);
    expect(count[code("ore")]).toBeGreaterThan(100);
    expect(count[code("ice")]).toBeGreaterThan(100);
    expect(sum[code("ore")]! / count[code("ore")]!).toBeGreaterThan(ground + 10);
    expect(sum[code("ice")]! / count[code("ice")]!).toBeLessThan(ground - 10);
  });

  it("more ice poleward: the share at 63 degrees is more than twice the equator's", () => {
    // Measured: 3.9% at the equator, 14.6% at 1.1 rad north, 18.0% south.
    const equator = share(at(0), "ice");
    expect(equator).toBeGreaterThan(0.01);
    expect(share(at(1.1), "ice")).toBeGreaterThan(2 * equator);
    expect(share(at(-1.1), "ice")).toBeGreaterThan(2 * equator);
  });

  it("vents lie along lines: nearly every vent has another beside it", () => {
    // Measured: 99.5-99.7% of vent tiles have a vent among their eight neighbours; scattered at the same 2.7%, about 20% would.
    let vents = 0;
    let linked = 0;
    for (const p of at(0.31)) {
      const d = depositsOf(p, ON);
      const n = frameOf(p, ON).n;
      for (let y = 1; y < n - 1; y += 1) {
        for (let x = 1; x < n - 1; x += 1) {
          if (d[y * n + x] !== code("vent")) continue;
          vents += 1;
          let beside = false;
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx !== 0 || dy !== 0) && d[(y + dy) * n + x + dx] === code("vent")) beside = true;
          if (beside) linked += 1;
        }
      }
    }
    expect(vents).toBeGreaterThan(100);
    expect(linked / vents).toBeGreaterThan(0.95);
  });

  it("sun on flat, high ground that stands over what is round it", () => {
    let suns = 0;
    for (const p of at(0.31)) {
      const g = groundOf(p, ON);
      const d = depositsOf(p, ON);
      const n = g.tiles;
      const sorted = [...g.heightM].sort((a, b) => a - b);
      const median = sorted[Math.floor(0.5 * sorted.length)]!;
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          const i = y * n + x;
          if (d[i] !== code("sun")) continue;
          suns += 1;
          // Flat: a building's own limit is 0.3; these rise at most a tenth of it.
          expect(g.slope[i]!).toBeLessThanOrEqual(0.1);
          // High: above the founding site's level ground and above half the site.
          expect(g.heightM[i]!).toBeGreaterThan(0);
          expect(g.heightM[i]!).toBeGreaterThan(median);
          // Unshadowed: the ground within five tiles stands lower on average.
          let sum = 0;
          let k = 0;
          for (let dy = -5; dy <= 5; dy += 1) for (let dx = -5; dx <= 5; dx += 1) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
            sum += g.heightM[yy * n + xx]!;
            k += 1;
          }
          expect(sum / k).toBeLessThan(g.heightM[i]!);
        }
      }
    }
    expect(suns).toBeGreaterThan(50);
  });
});
