// @vitest-environment happy-dom

/**
 * The city view through the real component (Batch 20): the palette arms a
 * building, a click places it through the simulation's own rules, a refusal
 * is written in words, a click selects, and the inspector says what a
 * building is doing - in words, so it reads without colour.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { isoProject } from "../render/iso.js";
import type { BuildingType, SimState, Tuning } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  connectAll,
  derive,
  foundSettlement,
  habitat,
  makeTuning,
  marsStart,
  launchRocket,
  placeBuilding,
  placeLink,
  groundOf,
  removeBuilding,
  removeLink,
  rocksOf,
  sendRover,
  tileKey,
  worldEnv,
} from "../sim/index.js";
import { centreCamera, isoToScreen } from "./city-camera.js";
import { CityScreen } from "./city.js";

const t = makeTuning({ SETTLEMENTS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
const W = 800;
const H = 600;

function mount(kind: "city" | "outpost" = "city", stores: Record<string, number> = {}, tuning: Tuning = t) {
  const t = tuning;
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
      onLink: (id, layer, tx, ty) => {
        calls.push(`${layer}@${tx},${ty}`);
        const o = placeLink(state, id, layer, tx, ty, t);
        state = o.state;
        return o;
      },
      canLink: (id, layer, tx, ty) => placeLink(state, id, layer, tx, ty, t),
      onUnlink: (id, layer, tx, ty) => {
        calls.push(`un-${layer}@${tx},${ty}`);
        const o = removeLink(state, id, layer, tx, ty);
        state = o.state;
        return o;
      },
      onSendRover: (id, tx, ty) => {
        calls.push(`rover@${tx},${ty}`);
        const o = sendRover(state, id, tx, ty, t);
        state = o.state;
        return o;
      },
      onLaunch: (id, tx, ty) => {
        calls.push(`launch@${tx},${ty}`);
        const o = launchRocket(state, id, tx, ty, t);
        state = o.state;
        return o;
      },
      onConnect: (id) => {
        calls.push("connect");
        const o = connectAll(state, id, t);
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
  /** One frame, `dt` ms after the last (a second by default: past every refresh interval). */
  const frame = (dt = 1000): void => {
    now += dt;
    const env = habitat(state.reservoirs, derive(state.reservoirs, worldEnv(state, NEUTRAL_ENV, t), t), t, 0);
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
  /** Move the pointer over the screen point where (x, y, z) is drawn. */
  const hoverAt = (x: number, y: number, z: number): void => {
    const iso = isoProject(x, y, z);
    const p = isoToScreen(centreCamera(32, W), W, H, iso.sx, iso.sy);
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: p.px, clientY: p.py, pointerId: 1 }));
    frame();
  };
  /** Click the middle of a tile on the ground. */
  const clickTile = (tx: number, ty: number): void => clickAt(tx + 0.5, ty + 0.5, 0);
  /** Press on the first tile, move across the rest, release on the last - as a drag with the main button. */
  const dragTiles = (tiles: readonly (readonly [number, number])[]): void => {
    const at = ([x, y]: readonly [number, number]) => {
      const iso = isoProject(x + 0.5, y + 0.5, 0);
      return isoToScreen(centreCamera(32, W), W, H, iso.sx, iso.sy);
    };
    const first = at(tiles[0]!);
    canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: first.px, clientY: first.py, pointerId: 1, button: 0 }));
    for (const tile of tiles.slice(1)) {
      const p = at(tile);
      canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: p.px, clientY: p.py, pointerId: 1, button: 0 }));
    }
    const last = at(tiles[tiles.length - 1]!);
    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: last.px, clientY: last.py, pointerId: 1, button: 0 }));
    frame();
  };
  const q = (sel: string): HTMLElement => {
    const e = host.querySelector<HTMLElement>(sel);
    if (e === null) throw new Error(`missing ${sel}`);
    return e;
  };
  const option = (type: BuildingType): HTMLButtonElement => q(`.city-card[data-type="${type}"]`) as HTMLButtonElement;
  return { host, screen, calls, frame, clickTile, clickAt, hoverAt, dragTiles, q, option, state: () => state };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("the city view", () => {
  it("offers only what this kind of settlement may build", () => {
    const city = mount("city");
    expect(city.host.querySelectorAll(".city-card[data-type]").length).toBe(10);
    document.body.replaceChildren();
    const outpost = mount("outpost");
    const offered = [...outpost.host.querySelectorAll<HTMLElement>(".city-card[data-type]")].map((b) => b.dataset["type"]);
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

  it("builds on a hill where the pointer shows it, and says how high the ground is", () => {
    // A buildable tile well up a hill, found rather than assumed.
    const g = groundOf({ kind: "city", lat: 0.31, lon: -1.2 }, t);
    let k = -1;
    g.heightM.forEach((h, i) => {
      if (!g.steep[i] && h > 5 && (i % 32) < 31 && (k < 0 || h > g.heightM[k]!)) k = i;
    });
    expect(k, "no buildable hilltop at the test site").toBeGreaterThanOrEqual(0);
    const tx = k % 32;
    const ty = Math.floor(k / 32);
    const z = g.heightM[k]! / t.TILE_METRES;
    const page = mount();
    page.option("storage_depot").click();
    page.hoverAt(tx + 0.5, ty + 0.5, z);
    const hint = page.q(".city-hint").textContent ?? "";
    expect(hint).toContain(`Ground here: +${g.heightM[k]!.toFixed(1)} m`);
    expect(hint).toContain(`on the planet`);
    page.clickAt(tx + 0.5, ty + 0.5, z);
    expect(page.state().settlements[0]!.buildings).toEqual([{ type: "storage_depot", tx, ty, level: 1 }]);
  });

  it("warns, in words, that steep ground cannot be built on", () => {
    const g = groundOf({ kind: "city", lat: 0.31, lon: -1.2 }, t);
    const k = g.steep.findIndex(Boolean);
    const page = mount();
    page.option("storage_depot").click();
    page.hoverAt((k % 32) + 0.5, Math.floor(k / 32) + 0.5, g.heightM[k]! / t.TILE_METRES);
    expect(page.q(".city-hint").textContent).toContain("Too steep to build on.");
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

describe("corridors and cables (at the user's request: connect the power plant to the mines)", () => {
  const net = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1 });
  const at = (page: ReturnType<typeof mount>, layer: "corridors" | "cables", tx: number, ty: number): boolean => page.state().settlements[0]![layer].includes(tileKey(tx, ty));

  it("lays power cable along a drag, one call a tile, through the sim", () => {
    const page = mount("city", {}, net);
    (page.q(".city-cable") as HTMLButtonElement).click();
    page.frame();
    expect(page.q(".city-cable").getAttribute("aria-pressed")).toBe("true");
    expect(page.q(".city-hint").textContent).toMatch(/Click or drag to lay power cable/);
    // The pointer lingers on a tile (two moves on 11,14): still one cable there.
    page.dragTiles([[10, 14], [11, 14], [11, 14], [12, 14], [13, 14]]);
    expect(page.calls).toEqual(["cables@10,14", "cables@11,14", "cables@12,14", "cables@13,14"]);
    for (const x of [10, 11, 12, 13]) expect(at(page, "cables", x, 14), `${x},14`).toBe(true);
    expect(page.state().settlements[0]!.corridors).toEqual([]);
  });

  it("lays corridor with the corridor tool, and takes it up when the drag starts on it", () => {
    const page = mount("city", {}, net);
    (page.q(".city-corridor") as HTMLButtonElement).click();
    page.frame();
    expect(page.q(".city-hint").textContent).toMatch(/Click or drag to lay corridor/);
    page.dragTiles([[10, 14], [11, 14], [12, 14]]);
    page.dragTiles([[11, 14], [12, 14]]);
    expect(at(page, "corridors", 10, 14)).toBe(true);
    expect(at(page, "corridors", 11, 14)).toBe(false);
    expect(at(page, "corridors", 12, 14)).toBe(false);
    expect(page.state().settlements[0]!.cables).toEqual([]);
  });

  it("says in words why a cable was refused", () => {
    const page = mount("city", {}, net);
    page.option("storage_depot").click();
    page.clickTile(14, 14);
    (page.q(".city-cable") as HTMLButtonElement).click();
    page.dragTiles([[14, 14]]);
    expect(page.q(".city-hint").textContent).toBe("Cannot lay cable: a building stands there.");
  });

  it("tells the player a building is not connected, and what to lay to what", () => {
    const page = mount("city", {}, net);
    page.option("reactor").click();
    page.clickTile(4, 4);
    page.option("regolith_mine").click();
    page.clickTile(10, 4);
    page.option("regolith_mine").click();
    page.clickAt(11, 5, 0);
    expect(page.q(".city-inspector-status").textContent).toBe("Not connected: nothing on its network makes power. Lay a power cable to a power plant.");
  });

  it("connects everything at a click, and the mine runs on the very next frame", () => {
    const page = mount("city", {}, net);
    page.option("reactor").click();
    page.clickTile(4, 4);
    page.option("regolith_mine").click();
    page.clickTile(10, 4);
    page.option("regolith_mine").click();
    page.clickAt(11, 5, 0);
    expect(page.q(".city-inspector-status").textContent).toMatch(/^Not connected/);
    (page.q(".city-connect") as HTMLButtonElement).click();
    // 16 ms later - well inside the view's 200 ms refresh: what was laid must redraw at once.
    page.frame(16);
    expect(page.calls.at(-1)).toBe("connect");
    expect(page.q(".city-hint").textContent).toMatch(/^Laid \d+ tiles? of corridor and cable\.$/);
    expect(page.q(".city-inspector-status").textContent).toBe("Running.");
  });

  it("puts the tool down with Escape", () => {
    const page = mount("city", {}, net);
    (page.q(".city-corridor") as HTMLButtonElement).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    page.frame();
    expect(page.q(".city-corridor").getAttribute("aria-pressed")).toBe("false");
    page.clickTile(10, 14);
    expect(page.calls).toEqual([]);
  });
});

describe("the headquarters, rovers and rockets (at the user's request)", () => {
  const hq = makeTuning({ SETTLEMENTS_ENABLED: 1, NETWORK_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12 });
  /** A loose rock on this site, and where its ground is drawn. */
  const looseRock = (page: ReturnType<typeof mount>): { tx: number; ty: number; z: number } => {
    const s = page.state().settlements[0]!;
    const ground = groundOf(s, hq);
    const k = rocksOf(s, hq).findIndex((r, i) => r === "loose" && Math.abs((i % 32) - 16) < 9 && Math.abs(Math.floor(i / 32) - 16) < 9);
    expect(k, "a loose rock near the middle of this site").toBeGreaterThanOrEqual(0);
    return { tx: k % 32, ty: Math.floor(k / 32), z: ground.heightM[k]! / hq.TILE_METRES };
  };

  it("selects a rock with a click, says what breaking it brings and how long a rover takes, and sends one", () => {
    const page = mount("city", {}, hq);
    const rock = looseRock(page);
    page.clickAt(rock.tx + 0.5, rock.ty + 0.5, rock.z);
    expect(page.q(".city-inspector").hidden).toBe(false);
    expect(page.q(".city-inspector-name").textContent).toBe("Loose rocks");
    expect(page.q(".city-inspector-summary").textContent).toMatch(/brings back 1 material/);
    expect(page.q(".city-inspector-status").textContent).toMatch(/A rover would take about \d+ s at 1x there and back\. 3 of 3 rovers/);
    expect(page.q(".city-send-rover").hidden).toBe(false);
    (page.q(".city-send-rover") as HTMLButtonElement).click();
    page.frame(16);
    expect(page.calls.at(-1)).toBe(`rover@${rock.tx},${rock.ty}`);
    expect(page.q(".city-hint").textContent).toBe("A rover is on its way.");
    expect(page.q(".city-inspector-status").textContent).toMatch(/A rover is on its way: back in about \d+ s at 1x\./);
  });

  it("launches the spaceport's rocket, and says when it will be back", () => {
    // Room in the stores: a rocket is refused when they are full.
    const page = mount("city", { materials: 100 }, hq);
    // The spaceport the city landed with, east of the headquarters.
    page.clickAt(20.5, 16.5, 0);
    expect(page.q(".city-inspector-name").textContent).toBe("Spaceport");
    expect(page.q(".city-launch").hidden).toBe(false);
    expect(page.q(".city-inspector-summary").textContent).toMatch(/back in about 60 s at 1x with 20 materials/);
    (page.q(".city-launch") as HTMLButtonElement).click();
    page.frame(16);
    expect(page.calls.at(-1)).toMatch(/^launch@/);
    expect(page.q(".city-inspector-summary").textContent).toMatch(/Its rocket is away: back in about 60 s at 1x\./);
  });

  it("offers no card for the headquarters, and no way to remove it", () => {
    const page = mount("city", {}, hq);
    expect(page.host.querySelector('.city-card[data-type="headquarters"]')).toBeNull();
    page.clickAt(16.5, 16.5, 0);
    expect(page.q(".city-inspector-name").textContent).toBe("Headquarters");
    expect(page.q(".city-remove").hidden).toBe(true);
    expect(page.q(".city-launch").hidden).toBe(true);
  });
});

describe("the build bar (at the user's request: cards along the bottom, as in Clash of Clans)", () => {
  it("puts every structure on a card in a bar along the bottom, not in the sidebar", () => {
    const page = mount();
    const dock = page.q(".city-dock");
    const cards = [...dock.querySelectorAll<HTMLElement>(".city-card")];
    // Ten buildings, the corridor, the power cable and "connect everything".
    expect(cards.length).toBe(13);
    expect(page.q(".city-panel").querySelector(".city-card")).toBeNull();
    for (const c of cards) {
      expect(c.querySelector("canvas.city-card-preview"), c.dataset["card"]).not.toBeNull();
      expect(c.querySelector(".city-card-name")?.textContent, c.dataset["card"]).not.toBe("");
      expect(c.querySelector(".city-card-cost")?.textContent, c.dataset["card"]).toMatch(/\d/);
    }
    expect(page.option("reactor").querySelector(".city-card-name")?.textContent).toBe("Reactor");
    expect(page.option("reactor").querySelector(".city-card-cost")?.textContent).toBe(String(t.COST_REACTOR));
  });

  it("tells what a structure does while its card is hovered, and stops when the pointer leaves", () => {
    const page = mount();
    const tip = page.q(".city-tip");
    expect(tip.hidden).toBe(true);
    page.option("greenhouse").dispatchEvent(new PointerEvent("pointerenter"));
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain("Greenhouse");
    expect(tip.textContent).toContain("power and water into food");
    expect(tip.textContent).toMatch(/Uses power [\d.]+\/yr, water [\d.]+\/yr\./);
    expect(tip.textContent).toMatch(/Makes food [\d.]+\/yr\./);
    page.option("greenhouse").dispatchEvent(new PointerEvent("pointerleave"));
    expect(tip.hidden).toBe(true);
    // The corridor's and the cable's cards say what each carries.
    page.q(".city-cable").dispatchEvent(new PointerEvent("pointerenter"));
    expect(tip.textContent).toMatch(/Carries power, and only power: a mine needs a cable to a power plant/);
    page.q(".city-corridor").dispatchEvent(new PointerEvent("pointerenter"));
    expect(tip.textContent).toMatch(/water, oxygen, food and materials\. A dome needs a corridor to a greenhouse/);
  });

  it("tells it from the keyboard too: focus shows the same words", () => {
    const page = mount();
    page.option("habitat_dome").focus();
    expect(page.q(".city-tip").hidden).toBe(false);
    expect(page.q(".city-tip").textContent).toContain("Houses");
    expect(page.option("habitat_dome").getAttribute("aria-describedby")).toBe("city-tip");
  });

  it("marks, in words, a card the settlement cannot afford", () => {
    const page = mount("city", { materials: 25 });
    // A reactor costs more than 25; a depot does not.
    expect(page.option("reactor").dataset["short"]).toBe("true");
    expect(page.option("reactor").textContent).toContain("not enough materials");
    expect(page.option("storage_depot").dataset["short"]).toBeUndefined();
  });
});
