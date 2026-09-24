// @vitest-environment happy-dom

/**
 * The city view through the real component (Batch 20): the palette arms a
 * building, a click places it through the simulation's own rules, a refusal
 * is written in words, a click selects, and the inspector says what a
 * building is doing - in words, so it reads without colour.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { isoProject } from "../render/iso.js";
import type { BuildingType, SimState } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  derive,
  foundSettlement,
  habitat,
  makeTuning,
  marsStart,
  placeBuilding,
  removeBuilding,
  worldEnv,
} from "../sim/index.js";
import { centreCamera, isoToScreen } from "./city-camera.js";
import { CityScreen } from "./city.js";

const t = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_ROUGH_FRACTION: 0.12 });
const W = 800;
const H = 600;

function mount(kind: "city" | "outpost" = "city", stores: Record<string, number> = {}) {
  let state: SimState = foundSettlement(marsStart(), kind, 0.31, -1.2, t).state;
  state = { ...state, settlements: state.settlements.map((s) => ({ ...s, stores: { ...s.stores, materials: 1000, ...stores } })) };
  const calls: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const screen = new CityScreen(
    host,
    {
      onPlace: (id, type, tx, ty) => {
        calls.push(`place:${type}@${tx},${ty}`);
        const o = placeBuilding(state, id, type, tx, ty, t);
        state = o.state;
        return o;
      },
      canPlace: (id, type, tx, ty) => placeBuilding(state, id, type, tx, ty, t),
      onRemove: (id, tx, ty) => {
        calls.push(`remove@${tx},${ty}`);
        const o = removeBuilding(state, id, tx, ty);
        state = o.state;
        return o;
      },
      onBack: () => calls.push("back"),
    },
    t,
  );
  const canvas = host.querySelector("canvas")!;
  canvas.width = W;
  canvas.height = H;
  let now = 0;
  const frame = (): void => {
    now += 1000;
    const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t), t);
    screen.frame(state.settlements[0]!, env, now);
  };
  screen.open("settlement-1");
  frame();
  /** Click the screen point where a world point (x, y, z) is drawn, as a pointer would. */
  const clickAt = (x: number, y: number, z: number): void => {
    const iso = isoProject(x, y, z);
    const p = isoToScreen(centreCamera(32, W), W, H, iso.sx, iso.sy);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: p.px, clientY: p.py, pointerId: 1 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: p.px, clientY: p.py, pointerId: 1 }));
    frame();
  };
  /** Click the middle of a tile on the ground. */
  const clickTile = (tx: number, ty: number): void => clickAt(tx + 0.5, ty + 0.5, 0);
  const q = (sel: string): HTMLElement => {
    const e = host.querySelector<HTMLElement>(sel);
    if (e === null) throw new Error(`missing ${sel}`);
    return e;
  };
  const option = (type: BuildingType): HTMLButtonElement => q(`.city-build-option[data-type="${type}"]`) as HTMLButtonElement;
  return { host, screen, calls, frame, clickTile, clickAt, q, option, state: () => state };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the city view", () => {
  it("offers only what this kind of settlement may build", () => {
    const city = mount("city");
    expect(city.host.querySelectorAll(".city-build-option").length).toBe(10);
    document.body.replaceChildren();
    const outpost = mount("outpost");
    const offered = [...outpost.host.querySelectorAll<HTMLElement>(".city-build-option")].map((b) => b.dataset["type"]);
    expect(offered).not.toContain("habitat_dome");
    expect(offered).not.toContain("greenhouse");
    expect(offered.length).toBe(8);
  });

  it("places the armed building where the player clicks, through the sim", () => {
    const page = mount();
    page.option("reactor").click();
    page.frame();
    expect(page.option("reactor").getAttribute("aria-pressed")).toBe("true");
    expect(page.q(".city-hint").textContent).toMatch(/Click the ground to place a Reactor/);
    page.clickTile(14, 14);
    expect(page.calls).toEqual(["place:reactor@14,14"]);
    expect(page.state().settlements[0]!.buildings).toEqual([{ type: "reactor", tx: 14, ty: 14, level: 1 }]);
  });

  it("says in words why a placement was refused, and builds nothing", () => {
    const page = mount();
    page.option("reactor").click();
    page.clickTile(14, 14);
    page.clickTile(15, 15);
    expect(page.state().settlements[0]!.buildings.length).toBe(1);
    expect(page.q(".city-hint").textContent).toBe("Cannot build: Reactor would overlap another building.");
  });

  it("selects a building by clicking it, and the inspector says what it is doing", () => {
    // A dry city: the dome has no water, so it is browned out.
    const page = mount("city", { water: 0 });
    page.option("geothermal_plant").click();
    page.clickTile(12, 12);
    page.option("habitat_dome").click();
    page.clickTile(16, 16);
    page.option("habitat_dome").click(); // disarm
    page.clickTile(12, 12);
    expect(page.q(".city-inspector").hidden).toBe(false);
    expect(page.q(".city-inspector-name").textContent).toBe("Geothermal Plant");
    expect(page.q(".city-inspector-status").textContent).toBe("Running.");
    page.clickTile(16, 16);
    expect(page.q(".city-inspector-name").textContent).toBe("Habitat Dome");
    expect(page.q(".city-inspector-status").textContent).toBe("Offline: this city is short of water.");
    expect(page.q(".city-status").textContent).toMatch(/Short of water/);
  });

  it("selects a tall building by its upper part, which is drawn over ground behind it", () => {
    // A dome at tiles 15..17. Its surface at (15.8, 15.8, 0.93) - on the
    // sphere of radius 1.24 about (16.5, 16.5, 0.18) - is drawn over the
    // ground point (14.87, 14.87), tile 14,14: bare ground, off its footprint.
    // Picking only the ground under the pointer would select nothing.
    const page = mount();
    page.option("habitat_dome").click();
    page.clickTile(16, 16);
    page.option("habitat_dome").click(); // disarm
    expect(page.state().settlements[0]!.buildings[0]).toMatchObject({ tx: 15, ty: 15 });
    page.clickAt(15.8, 15.8, 0.93);
    expect(page.q(".city-inspector").hidden, "clicking the dome's upper part selected nothing").toBe(false);
    expect(page.q(".city-inspector-name").textContent).toBe("Habitat Dome");
  });

  it("removes the selected building", () => {
    const page = mount();
    page.option("storage_depot").click();
    page.clickTile(13, 13);
    page.option("storage_depot").click();
    page.clickTile(13, 13);
    (page.q(".city-remove") as HTMLButtonElement).click();
    page.frame();
    expect(page.calls).toEqual(["place:storage_depot@13,13", "remove@13,13"]);
    expect(page.state().settlements[0]!.buildings).toEqual([]);
    expect(page.q(".city-inspector").hidden).toBe(true);
  });

  it("clicking bare ground selects nothing", () => {
    const page = mount();
    page.clickTile(20, 13);
    expect(page.q(".city-inspector").hidden).toBe(true);
  });

  it("Escape disarms the palette", () => {
    const page = mount();
    page.option("reactor").click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    page.frame();
    expect(page.option("reactor").getAttribute("aria-pressed")).toBe("false");
    page.clickTile(14, 14);
    expect(page.calls).toEqual([]);
  });

  it("goes back to orbit", () => {
    const page = mount();
    (page.q(".city-back") as HTMLButtonElement).click();
    expect(page.calls).toEqual(["back"]);
  });
});
