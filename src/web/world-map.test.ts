// @vitest-environment happy-dom

/**
 * The world map (at the user's request): "interconnected cities - a middle
 * game where the full map of the world is visible in 2D with all the cities
 * extremely zoomed out".
 */

import { describe, expect, it } from "vitest";

import type { SimState } from "../sim/index.js";
import { connectSettlements, foundSettlement, makeTuning, marsStart } from "../sim/index.js";
import { MAP_H, MAP_W, WORLD_TILES_X, WORLD_TILES_Y, WORLD_TILE_KM, WorldMapScreen, mapImage, worldPoint } from "./world-map.js";

const t = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, INTERCITY_ENABLED: 1 });
/** A planet with high ground in the north and a sea in the south. */
const elevation = (lat: number): number => (lat > 0 ? 3000 : -3000);
const env = { seaLevelM: 0, oceanFraction: 0.3, greenery: 0.5 } as never;

function world(): SimState {
  let s = foundSettlement(marsStart(undefined, t), "city", 0.31, -1.2, t, "Ares").state;
  s = foundSettlement(s, "city", 0.36, -1.05, t, "Olympus").state;
  s = foundSettlement(s, "outpost", -0.2, 2.0, t).state;
  s = { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials: 1e5 } })) };
  return connectSettlements(s, "settlement-1", "settlement-3", t).state;
}

describe("the world, as a map", () => {
  it("is 2,048 by 1,024 world tiles, about 10 km each, west to east and pole to pole", () => {
    expect(WORLD_TILE_KM).toBeGreaterThan(10);
    expect(WORLD_TILE_KM).toBeLessThan(11);
    expect(worldPoint(0, 0)).toEqual({ x: WORLD_TILES_X / 2, y: WORLD_TILES_Y / 2 });
    expect(worldPoint(Math.PI / 2, -Math.PI)).toEqual({ x: 0, y: 0 });
    // Round the back of the planet, it comes in again from the west.
    expect(worldPoint(0, Math.PI + 0.1).x).toBeCloseTo((0.1 / (2 * Math.PI)) * WORLD_TILES_X, 9);
  });

  it("is drawn by height: the sea blue below its level, land the planet's rust, greener in the lowlands", () => {
    const run = (ocean: number, green: number): Uint8ClampedArray => {
      const steps = mapImage(elevation, 0, ocean, green, 64, 32);
      for (;;) {
        const r = steps.next();
        if (r.done === true) return r.value;
      }
    };
    const at = (px: Uint8ClampedArray, x: number, y: number) => [...px.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
    const wet = run(0.3, 0);
    const [lr, lg, lb] = at(wet, 30, 8);
    expect(lr!).toBeGreaterThan(lb!);
    const [sr, , sb] = at(wet, 30, 24);
    expect(sb!).toBeGreaterThan(sr!);
    // No ocean on the planet, no sea drawn, however low the ground.
    const [dr, , db] = at(run(0, 0), 30, 24);
    expect(dr!).toBeGreaterThan(db!);
    // Green with the planet's green.
    // Measured: 10 greener at 3,000 m (more in the lowlands, none on the peaks).
    expect(at(run(0.3, 0.9), 30, 8)[1]! - lg!).toBeGreaterThan(5);
  });
});

describe("the world map screen", () => {
  function mount() {
    let state = world();
    const calls: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const screen = new WorldMapScreen(
      host,
      {
        onOpen: (id) => calls.push(`open:${id}`),
        onConnect: (a, b) => {
          calls.push(`connect:${a}-${b}`);
          const o = connectSettlements(state, a, b, t);
          state = o.state;
          return o;
        },
        onClose: () => calls.push("close"),
      },
      t,
      elevation,
    );
    screen.open();
    let now = 0;
    const frame = (): void => screen.frame(state, env, (now += 16));
    // The picture is made a little a frame: until it is, the map says how far along it is.
    frame();
    let frames = 1;
    while (/Drawing the map/.test(host.querySelector(".worldmap-hint")!.textContent ?? "") && frames < 500) {
      frame();
      frames += 1;
    }
    frame();
    return { host, screen, calls, frame, frames, get state() { return state; } };
  }

  it("makes its picture over frames, then shows the whole planet: its settlements, people and railways", () => {
    const m = mount();
    expect(m.frames, `vacuity: ${MAP_W} x ${MAP_H} is more than one frame's work`).toBeGreaterThanOrEqual(1);
    const panel = m.host.querySelector(".worldmap-panel")!.textContent ?? "";
    expect(panel).toContain("3 settlements");
    expect(panel).toContain("1 railways between them");
  });

  it("chooses a settlement by clicking it, and opens its city", () => {
    const m = mount();
    const ares = m.state.settlements[0]!;
    const at = m.screen.screenOf(ares);
    m.screen.click(at.px, at.py);
    m.frame();
    expect(m.host.querySelector(".worldmap-name")!.textContent).toBe("Ares");
    expect(m.host.querySelector(".worldmap-panel")!.textContent).toMatch(/Railways to 1 settlement/);
    m.host.querySelector<HTMLButtonElement>(".worldmap-open")!.click();
    expect(m.calls).toEqual(["open:settlement-1"]);
    // Nowhere near a settlement: nothing chosen.
    m.screen.click(5, 5);
    m.frame();
    expect(m.host.querySelector(".worldmap-name")!.textContent).toBe("The planet");
  });

  it("lays a railway from the chosen settlement to the next one clicked, and says what it cost", () => {
    const m = mount();
    const [ares, olympus] = m.state.settlements;
    const a = m.screen.screenOf(ares!);
    m.screen.click(a.px, a.py);
    m.frame();
    m.host.querySelector<HTMLButtonElement>(".worldmap-join")!.click();
    m.frame();
    expect(m.host.querySelector(".worldmap-hint")!.textContent).toMatch(/Click another settlement/);
    // Zoomed in, the two cities apart on screen.
    m.screen.zoomAt(60, a.px, a.py);
    const b = m.screen.screenOf(olympus!);
    m.screen.click(b.px, b.py);
    expect(m.calls).toEqual(["connect:settlement-1-settlement-2"]);
    expect(m.state.routes).toHaveLength(2);
    expect(m.host.querySelector(".worldmap-hint")!.textContent).toMatch(/Railway laid to Olympus: [\d,]+ materials, half from each end/);
    // Twice: refused, and says so.
    m.screen.click(a.px, a.py);
    m.host.querySelector<HTMLButtonElement>(".worldmap-join")?.click();
    m.frame();
    m.screen.click(m.screen.screenOf(ares!).px, m.screen.screenOf(ares!).py);
    m.frame();
    m.host.querySelector<HTMLButtonElement>(".worldmap-join")!.click();
    m.screen.click(m.screen.screenOf(olympus!).px, m.screen.screenOf(olympus!).py);
    expect(m.host.querySelector(".worldmap-hint")!.textContent).toMatch(/No railway: they are joined already/);
  });

  it("zooms from the whole planet in to a city's chunks, and no further either way", () => {
    const m = mount();
    const whole = m.screen.scale;
    // At the least, the whole world across the view (the fallback view is 1,200 x 700).
    expect(whole * WORLD_TILES_X).toBeLessThanOrEqual(1200 + 1e-6);
    for (let k = 0; k < 60; k += 1) m.screen.zoomAt(0.5, 600, 350);
    expect(m.screen.scale).toBe(whole);
    for (let k = 0; k < 60; k += 1) m.screen.zoomAt(2, 600, 350);
    expect(m.screen.scale).toBe(256);
  });
});
