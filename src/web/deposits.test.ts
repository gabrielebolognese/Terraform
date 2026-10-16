// @vitest-environment happy-dom

/**
 * Batch 37 - "deposits visible in the city view before placing", through the
 * real component: the Deposits card, the marks drawn while a building a
 * deposit boosts is being placed, the words under the pointer and in the
 * placement hint (what it would make there), and the inspectors. Every
 * number in the words is the simulation's (`sitingPreview`, the view's
 * `deposit`), checked here against what a real `advance` pays.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { DEPOSIT_CODES, DEPOSIT_MARKS, cityScene, depositMark } from "../render/city.js";
import { isoProject } from "../render/iso.js";
import type { SimState, Tuning } from "../sim/index.js";
import {
  DEPOSIT_KINDS,
  NEUTRAL_ENV,
  advance,
  cityView,
  depositsOf,
  derive,
  foundSettlement,
  groundOf,
  habitat,
  makeTuning,
  marsStart,
  placeBuilding,
  worldEnv,
} from "../sim/index.js";
import { centreCamera, isoToScreen } from "./city-camera.js";
import { CityScreen } from "./city.js";
import { sitingWords } from "./deposit-words.js";

/** The browser's ground on a city's founding square of 32 tiles, with deposits on - and off. */
const ON = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12, DEPOSITS_ENABLED: 1 });
const OFF = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const HERE = { kind: "city" as const, lat: 0.31, lon: -1.2 };
const W = 800;
const H = 600;
const N = 32;

const failed = { ok: false as const, state: null as unknown as SimState, reason: "not in this test", laid: 0 };

function mount(t: Tuning) {
  let state: SimState = foundSettlement(marsStart(undefined, t), "city", HERE.lat, HERE.lon, t).state;
  state = { ...state, settlements: state.settlements.map((s) => ({ ...s, stores: { ...s.stores, materials: 1000 } })) };
  const host = document.createElement("div");
  document.body.append(host);
  const screen = new CityScreen(
    host,
    {
      onPlace: (id, type, tx, ty) => {
        const o = placeBuilding(state, id, type, tx, ty, t);
        state = o.state;
        return o;
      },
      canPlace: (id, type, tx, ty) => placeBuilding(state, id, type, tx, ty, t),
      onRemove: () => failed,
      onLink: () => failed,
      canLink: () => failed,
      onUnlink: () => failed,
      onSendRover: () => failed,
      onLaunch: () => failed,
      onUpgrade: () => failed,
      onConnectTwice: () => failed,
      onLevel: () => failed,
      canLevel: () => failed,
      onClaim: () => failed,
      onConnect: () => failed,
      onBack: () => undefined,
      onPlanner: () => undefined,
      onWorldMap: () => undefined,
    },
    t,
  );
  const canvas = host.querySelector("canvas")!;
  canvas.width = W;
  canvas.height = H;
  let now = 0;
  const env = () => habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t), t, 0);
  const frame = (): void => {
    now += 1000;
    screen.frame(state.settlements[0]!, env(), now);
  };
  screen.open("settlement-1");
  frame();
  const pointer = (type: string, tx: number, ty: number): void => {
    const z = (groundOf(HERE, t).heightM[ty * N + tx] ?? 0) / t.TILE_METRES;
    const iso = isoProject(tx + 0.5, ty + 0.5, z);
    const p = isoToScreen(centreCamera(N, W), W, H, iso.sx, iso.sy);
    canvas.dispatchEvent(new PointerEvent(type, { clientX: p.px, clientY: p.py, pointerId: 1, button: 0 }));
  };
  const hoverTile = (tx: number, ty: number): void => {
    pointer("pointermove", tx, ty);
    frame();
  };
  const clickTile = (tx: number, ty: number): void => {
    pointer("pointerdown", tx, ty);
    pointer("pointerup", tx, ty);
    frame();
  };
  const q = (sel: string): HTMLElement => {
    const e = host.querySelector<HTMLElement>(sel);
    if (e === null) throw new Error(`missing ${sel}`);
    return e;
  };
  /** What the screen would draw over the city now: the overlay layer of its own scene options. */
  const overlay = () => cityScene(cityView(state.settlements[0]!, env(), t), { ...screen.sceneOptions(now), layer: "overlay" });
  return { host, screen, frame, hoverTile, clickTile, q, overlay, env, state: () => state, set: (f: (s: SimState) => SimState) => ((state = f(state)), frame()) };
}

/** The corner of the 2 x 2 square of buildable ground nearest the middle with all four tiles of `code` (or none, for 0). */
function square(code: number, t: Tuning): { tx: number; ty: number } {
  const d = depositsOf(HERE, t);
  const g = groundOf(HERE, t);
  let best: { tx: number; ty: number; dist: number } | null = null;
  for (let y = 1; y + 2 < N; y += 1) {
    for (let x = 1; x + 2 < N; x += 1) {
      const tiles = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => (y + dy!) * N + x + dx!);
      if (!tiles.every((i) => (d.length === 0 ? 0 : d[i]) === code && g.steep[i] !== true)) continue;
      // Clear of the headquarters and spaceport at the middle.
      if (Math.abs(x + 1 - N / 2) < 6 && Math.abs(y + 1 - N / 2) < 6) continue;
      const dist = Math.hypot(x + 1 - N / 2, y + 1 - N / 2);
      if (best === null || dist < best.dist) best = { tx: x, ty: y, dist };
    }
  }
  if (best === null) throw new Error(`no square of ${code}`);
  return best;
}

const ORE = DEPOSIT_KINDS.indexOf("ore") + 1;
/** Marks drawn of one deposit kind: shapes in its colour, over the shapes in its colour one mark has (a cross is two strokes). */
const marks = (shapes: ReturnType<typeof cityScene>, kind: (typeof DEPOSIT_KINDS)[number]) =>
  shapes.filter((s) => s.fill === DEPOSIT_MARKS[kind].fill).length / depositMark(kind, 0, 0, 0).filter((s) => s.fill === DEPOSIT_MARKS[kind].fill).length;

beforeEach(() => {
  document.body.replaceChildren();
});

describe("deposits in the city view, before placing (Batch 37's third deliverable)", () => {
  it("the renderer reads the view's codes in the simulation's order", () => {
    expect(DEPOSIT_CODES).toEqual(DEPOSIT_KINDS);
  });

  it("a world without deposits has no Deposits card and draws no marks, even placing a mine", () => {
    const page = mount(OFF);
    expect(page.host.querySelector(".city-deposits")).toBeNull();
    page.q('.city-card[data-type="regolith_mine"]').click();
    page.frame();
    for (const k of DEPOSIT_KINDS) expect(marks(page.overlay(), k)).toBe(0);
  });

  it("choosing a mine marks the ore on the ground, and only the ore; putting it down marks nothing", () => {
    const page = mount(ON);
    expect(marks(page.overlay(), "ore")).toBe(0);
    page.q('.city-card[data-type="regolith_mine"]').click();
    page.frame();
    // Every ore tile of the city marked (one mark shape each), nothing else.
    const ore = [...depositsOf(HERE, ON)].filter((c) => c === ORE).length;
    expect(ore).toBeGreaterThan(10);
    expect(marks(page.overlay(), "ore")).toBe(ore);
    for (const k of DEPOSIT_KINDS) if (k !== "ore") expect(marks(page.overlay(), k), k).toBe(0);
    page.q('.city-card[data-type="regolith_mine"]').click(); // disarm
    page.frame();
    expect(marks(page.overlay(), "ore")).toBe(0);
  });

  it("the Deposits card marks all four kinds, says what each gives in its tip, and takes them away again", () => {
    const page = mount(ON);
    const card = page.q(".city-deposits");
    card.dispatchEvent(new PointerEvent("pointerenter"));
    const tip = page.q(".city-tip").textContent ?? "";
    expect(tip).toContain("Ore vein (a copper diamond): a Regolith Mine standing wholly on it makes x2 materials.");
    expect(tip).toContain("Ice lens (a pale blue disc): a Water Extractor standing wholly on it makes x2 water.");
    expect(tip).toContain("Geothermal vent (a red ring): a Geothermal Plant standing wholly on it makes x2 power.");
    expect(tip).toContain("Sunny high flat (a yellow cross): a Solar Array standing wholly on it makes x1.5 power.");
    card.click();
    page.frame();
    const codes = [...depositsOf(HERE, ON)];
    for (const k of DEPOSIT_KINDS) expect(marks(page.overlay(), k), k).toBe(codes.filter((c) => c === DEPOSIT_KINDS.indexOf(k) + 1).length);
    expect(page.q(".city-deposits").getAttribute("aria-pressed")).toBe("true");
    page.q(".city-deposits").click();
    page.frame();
    for (const k of DEPOSIT_KINDS) expect(marks(page.overlay(), k), k).toBe(0);
  });

  it("the hint says what a mine would make where it would stand - x2 wholly on ore, x1 off it - and the mine placed there makes it", () => {
    const page = mount(ON);
    const vein = square(ORE, ON);
    const bare = square(0, ON);
    page.q('.city-card[data-type="regolith_mine"]').click();
    page.hoverTile(vein.tx, vein.ty);
    const on = page.q(".city-hint").textContent ?? "";
    expect(on).toContain("Ore vein here.");
    expect(on).toContain("On ore vein, all 4 of its tiles: it would make x2 materials.");
    page.hoverTile(bare.tx, bare.ty);
    expect(page.q(".city-hint").textContent).toContain("No ore vein under it: it would make x1. Ore veins are marked with copper diamonds.");
    // Placed on the vein: the inspector says so, and the simulation pays it.
    page.hoverTile(vein.tx, vein.ty);
    page.clickTile(vein.tx, vein.ty);
    const mine = page.state().settlements[0]!.buildings.find((b) => b.type === "regolith_mine");
    expect(mine).toMatchObject({ tx: vein.tx, ty: vein.ty });
    const view = cityView(page.state().settlements[0]!, page.env(), ON);
    expect(view.buildings.find((b) => b.type === "regolith_mine")?.deposit).toEqual({ kind: "ore", share: 1, factor: 2 });
    // The ore under it is no longer marked: a mark there would be drawn over the mine.
    page.q('.city-card[data-type="regolith_mine"]').click(); // disarm
    page.q(".city-deposits").click();
    page.frame();
    const ore = [...depositsOf(HERE, ON)].filter((c) => c === ORE).length;
    expect(marks(page.overlay(), "ore")).toBe(ore - 4);
  });

  it("the hint's words are whole sentences for each of the four, off its deposit and on it", () => {
    // The first form added an "s" to the name and to "a copper diamond": "Ice lenss are marked with a pale blue discs."
    const off = Object.fromEntries(DEPOSIT_KINDS.map((kind) => [kind, sitingWords({ kind, on: 0, of: 4, factor: 1 })]));
    expect(off).toEqual({
      ore: " No ore vein under it: it would make x1. Ore veins are marked with copper diamonds.",
      ice: " No ice lens under it: it would make x1. Ice lenses are marked with pale blue discs.",
      vent: " No geothermal vent under it: it would make x1. Geothermal vents are marked with red rings.",
      sun: " No sunny high flat under it: it would make x1. Sunny high flats are marked with yellow crosses.",
    });
    const on = Object.fromEntries(DEPOSIT_KINDS.map((kind) => [kind, [sitingWords({ kind, on: 4, of: 4, factor: 2 }), sitingWords({ kind, on: 2, of: 4, factor: 1.5 })]]));
    expect(on).toEqual({
      ore: [" On ore vein, all 4 of its tiles: it would make x2 materials.", " On ore vein, 2 of its 4 tiles: it would make x1.5 materials."],
      ice: [" On ice lens, all 4 of its tiles: it would make x2 water.", " On ice lens, 2 of its 4 tiles: it would make x1.5 water."],
      vent: [" On geothermal vent, all 4 of its tiles: it would make x2 power.", " On geothermal vent, 2 of its 4 tiles: it would make x1.5 power."],
      sun: [" On sunny high flat, all 4 of its tiles: it would make x2 power.", " On sunny high flat, 2 of its 4 tiles: it would make x1.5 power."],
    });
  });

  it("the ore's mark is a diamond on the screen, as a tile is: its points straight above, below and either side of its middle", () => {
    /** Where each point of an outline lies from its middle on the screen, and its width over its height. */
    const lie = (pts: readonly { sx: number; sy: number }[]) => {
      const mx = pts.reduce((a, p) => a + p.sx, 0) / pts.length;
      const my = pts.reduce((a, p) => a + p.sy, 0) / pts.length;
      const at = pts.map((p) => (Math.abs(p.sx - mx) < 1e-6 ? (p.sy < my ? "above" : "below") : Math.abs(p.sy - my) < 1e-6 ? (p.sx < mx ? "left" : "right") : "off")).sort();
      const width = Math.max(...pts.map((p) => p.sx)) - Math.min(...pts.map((p) => p.sx));
      const height = Math.max(...pts.map((p) => p.sy)) - Math.min(...pts.map((p) => p.sy));
      return { at, aspect: Math.round((width / height) * 1000) / 1000, middle: { sx: mx, sy: my } };
    };
    const points = (ring: readonly number[]) => Array.from({ length: ring.length / 2 }, (_, i) => ({ sx: ring[2 * i]!, sy: ring[2 * i + 1]! }));
    // A tile's corners on the screen: the diamond the mark is to be.
    const tile = lie([[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => isoProject(x!, y!)));
    expect({ at: tile.at, aspect: tile.aspect }).toEqual({ at: ["above", "below", "left", "right"], aspect: 2 });
    // Every ore mark the city draws while a mine is being placed.
    const page = mount(ON);
    page.q('.city-card[data-type="regolith_mine"]').click();
    page.frame();
    const drawn = page.overlay().filter((s) => s.fill === DEPOSIT_MARKS.ore.fill);
    expect(drawn.length).toBeGreaterThan(10);
    for (const s of drawn) {
      expect(s.rings.length).toBe(1);
      const mark = lie(points(s.rings[0]!));
      expect({ at: mark.at, aspect: mark.aspect }).toEqual({ at: tile.at, aspect: tile.aspect });
    }
    // Its middle the tile's middle: one at tile (7, 3) on level ground.
    const one = lie(points(depositMark("ore", 7, 3, 0).find((s) => s.fill === DEPOSIT_MARKS.ore.fill)!.rings[0]!));
    const middle = isoProject(7.5, 3.5, 0);
    expect(one.middle.sx).toBeCloseTo(middle.sx, 9);
    expect(one.middle.sy).toBeCloseTo(middle.sy, 9);
  });

  it("partly on the vein, the hint gives the share and its factor: two of four tiles, x1.5", () => {
    const d = depositsOf(HERE, ON);
    const g = groundOf(HERE, ON);
    let half: { tx: number; ty: number } | null = null;
    for (let y = 1; y + 2 < N && half === null; y += 1) {
      for (let x = 1; x + 2 < N; x += 1) {
        const tiles = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => (y + dy!) * N + x + dx!);
        if (tiles.filter((i) => d[i] === ORE).length === 2 && tiles.every((i) => g.steep[i] !== true) && !(Math.abs(x + 1 - N / 2) < 6 && Math.abs(y + 1 - N / 2) < 6)) {
          half = { tx: x, ty: y };
          break;
        }
      }
    }
    expect(half).not.toBeNull();
    const page = mount(ON);
    page.q('.city-card[data-type="regolith_mine"]').click();
    page.hoverTile(half!.tx, half!.ty);
    expect(page.q(".city-hint").textContent).toContain("On ore vein, 2 of its 4 tiles: it would make x1.5 materials.");
    // Placed there, the view and the inspector say the same: half of it on ore, x1.5.
    page.clickTile(half!.tx, half!.ty);
    const view = cityView(page.state().settlements[0]!, page.env(), ON);
    const index = view.buildings.findIndex((b) => b.type === "regolith_mine");
    expect(view.buildings[index]?.deposit).toEqual({ kind: "ore", share: 0.5, factor: 1.5 });
    page.q('.city-card[data-type="regolith_mine"]').click(); // disarm
    page.clickTile(half!.tx, half!.ty);
    expect(page.q(".city-inspector").textContent).toContain("On ore vein (2 of its 4 tiles): x1.5 output.");
  });

  it("the words' factor is what a real advance pays: the mine on the vein makes twice the one off it", () => {
    const at = (p: { tx: number; ty: number }) => {
      const s = foundSettlement(marsStart(undefined, ON), "city", HERE.lat, HERE.lon, ON).state;
      const full = { power: 1e8, water: 1e8, oxygen: 1e8, food: 1e8, materials: 0 };
      const city = { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: [{ type: "regolith_mine" as const, tx: p.tx, ty: p.ty, level: 1 }], stores: full })) };
      return advance(city, 1, { tuning: ON, env: NEUTRAL_ENV, forcing: null }).settlements[0]!.stores.materials;
    };
    expect(at(square(ORE, ON)) / at(square(0, ON))).toBeCloseTo(2, 9);
  });

  it("clicking open ground on a deposit names it and says what it gives", () => {
    const page = mount(ON);
    const vein = square(ORE, ON);
    page.clickTile(vein.tx, vein.ty);
    expect(page.q(".city-inspector").hidden).toBe(false);
    expect(page.q(".city-inspector-name").textContent).toBe("Ore vein");
    expect(page.q(".city-inspector").textContent).toContain("a Regolith Mine standing wholly on it makes x2 materials.");
    // Nothing to break there: no rover to send.
    expect(page.q(".city-send-rover").hidden).toBe(true);
    // Bare ground is still nothing to select.
    const bare = square(0, ON);
    page.clickTile(bare.tx, bare.ty);
    expect(page.q(".city-inspector").hidden).toBe(true);
  });
});
