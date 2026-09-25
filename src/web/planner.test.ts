// @vitest-environment happy-dom

/**
 * The city planner through the real component (at the user's request): the
 * map from above, zones painted and levelled, corridors and power lines
 * drawn and then built by the simulation, and the record charted.
 */

import { describe, expect, it } from "vitest";

import type { SimState, Tuning } from "../sim/index.js";
import {
  NEUTRAL_ENV,
  advance,
  cancelPlans,
  cityView,
  deleteZone,
  derive,
  editZone,
  foundSettlement,
  habitat,
  keyTile,
  levelZone,
  makeTuning,
  marsStart,
  placeBuilding,
  planLinks,
  renameSettlement,
  tileKey,
  worldEnv,
} from "../sim/index.js";
import { MAP_COLOURS, PlannerScreen, charts, lineTiles, plannerPixels, rectTiles } from "./planner.js";

const t = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, TERRAIN_RELIEF_M: 12, CITY_GRID_TILES: 64 });
/** Flat ground, for what is placed by hand. */
const FLAT = makeTuning({ SETTLEMENTS_ENABLED: 1, HEADQUARTERS_ENABLED: 1, CITY_GRID_TILES: 64 });
const envOf = (s: SimState, tuning: Tuning = t) => habitat(s.reservoirs, derive(s.reservoirs, worldEnv(s, NEUTRAL_ENV, tuning), tuning), tuning, 0);

function start(materials = 2000, tuning: Tuning = t): SimState {
  const s = foundSettlement(marsStart(undefined, tuning), "city", 0.31, -1.2, tuning).state;
  return { ...s, settlements: s.settlements.map((c) => ({ ...c, stores: { ...c.stores, materials } })) };
}

function mount(initial: SimState = start(), tn: Tuning = t) {
  const t = tn;
  let state = initial;
  const calls: string[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const act = <O extends { state: SimState }>(label: string, o: O): O => {
    calls.push(label);
    state = o.state;
    return o;
  };
  const screen = new PlannerScreen(
    host,
    {
      onRename: (id, name) => act(`rename:${name}`, renameSettlement(state, id, name)),
      onZone: (id, edit) => act(`zone:${edit.id ?? "new"}:+${edit.add?.length ?? 0}-${edit.remove?.length ?? 0}`, editZone(state, id, edit, t)),
      onDeleteZone: (id, zone) => act(`delete:${zone}`, deleteZone(state, id, zone)),
      onLevelZone: (id, zone) => act(`level:${zone}`, levelZone(state, id, zone, t)),
      onPlan: (id, layer, tiles) => act(`plan:${layer}:${tiles.length}`, planLinks(state, id, layer, tiles, t)),
      onCancelPlans: (id) => act("cancel", cancelPlans(state, id)),
      onCityView: () => calls.push("city view"),
    },
    t,
  );
  const id = state.settlements[0]!.id;
  screen.open(id);
  let now = 0;
  const frame = (dt = 1000): void => {
    now += dt;
    screen.frame(state.settlements[0]!, envOf(state), now);
  };
  frame();
  const n = cityView(state.settlements[0]!, envOf(state), t).tiles;
  // happy-dom lays nothing out: the map is the fallback 800 x 600, the grid fitted to its height and centred.
  const scale = 600 / n;
  const at = (tx: number, ty: number) => ({ clientX: 100 + (tx + 0.5) * scale, clientY: (ty + 0.5) * scale });
  const map = host.querySelector<HTMLCanvasElement>(".planner-map")!;
  const drag = (a: [number, number], b: [number, number]): void => {
    map.dispatchEvent(new PointerEvent("pointerdown", { ...at(...a), buttons: 1, pointerId: 1 }));
    map.dispatchEvent(new PointerEvent("pointermove", { ...at(...b), buttons: 1, pointerId: 1 }));
    map.dispatchEvent(new PointerEvent("pointerup", { ...at(...b), pointerId: 1 }));
  };
  const click = (selector: string, text?: string): void => {
    const all = [...host.querySelectorAll<HTMLButtonElement>(selector)].filter((b) => text === undefined || b.textContent === text);
    expect(all.length, `${selector} ${text ?? ""}`).toBeGreaterThan(0);
    all[0]!.click();
  };
  return { host, screen, calls, frame, drag, click, id, n, get state() { return state; }, set state(s: SimState) { state = s; } };
}

describe("the map from above", () => {
  it("paints buildings by what they do, zones in their colour, links, plans, and dims land not the city's", () => {
    const t = FLAT;
    let s = start(2000, t);
    const placed = placeBuilding(s, s.settlements[0]!.id, "habitat_dome", 10, 10, t);
    expect(placed.ok, placed.reason ?? "").toBe(true);
    s = placed.state;
    s = editZone(s, s.settlements[0]!.id, { name: "Works", colour: "#00ff00", add: rectTiles({ tx: 20, ty: 20 }, { tx: 23, ty: 23 }) }, t).state;
    s = planLinks(s, s.settlements[0]!.id, "cables", [tileKey(40, 12)], t).state;
    const c = s.settlements[0]!;
    const view = cityView(c, envOf(s, t), t);
    const px = plannerPixels(view, c);
    const n = view.tiles;
    const rgb = (tx: number, ty: number): number[] => [...px.slice((ty * n + tx) * 4, (ty * n + tx) * 4 + 3)];
    const bare = plannerPixels(view, { ...c, zones: [], planned: [] });
    const bareRgb = (tx: number, ty: number): number[] => [...bare.slice((ty * n + tx) * 4, (ty * n + tx) * 4 + 3)];
    // The dome's inside is the homes colour.
    const dome = view.buildings.find((b) => b.type === "habitat_dome")!;
    expect(rgb(dome.tx + 1, dome.ty + 1)).toEqual([...MAP_COLOURS.home]);
    // The zone washes its tiles green; the same tile with no zone is not.
    const z = rgb(21, 21);
    const plain = bareRgb(21, 21);
    expect(z[1]! - plain[1]!).toBeGreaterThan(40);
    expect(z[0]!).toBeLessThan(plain[0]!);
    // The planned cable is marked; without the plan it is ground.
    expect(rgb(40, 12)).not.toEqual(bareRgb(40, 12));
    // Land not the city's (a founding square alone has none in its frame: one tile of bare ground is made so) is darker.
    const i = 60 * n + 2;
    expect(view.claimed[i]).toBe(true);
    const unclaimed = plannerPixels({ ...view, claimed: view.claimed.map((x, j) => x && j !== i) }, { ...c, zones: [], planned: [] });
    const sum = (p: Uint8ClampedArray) => p[i * 4]! + p[i * 4 + 1]! + p[i * 4 + 2]!;
    expect(sum(unclaimed)).toBeLessThan(0.6 * sum(bare));
  });

  it("draws a line tile by tile in an L, the longer way first, and a rectangle whole", () => {
    const line = lineTiles({ tx: 2, ty: 3 }, { tx: 9, ty: 1 }).map(keyTile);
    expect(line[0]).toEqual({ tx: 2, ty: 3 });
    expect(line.at(-1)).toEqual({ tx: 9, ty: 1 });
    expect(line).toHaveLength(7 + 2 + 1);
    for (let k = 1; k < line.length; k += 1) expect(Math.abs(line[k]!.tx - line[k - 1]!.tx) + Math.abs(line[k]!.ty - line[k - 1]!.ty)).toBe(1);
    // Along x first: the corner is at the far column's start row.
    expect(line[7]).toEqual({ tx: 9, ty: 3 });
    expect(lineTiles({ tx: 5, ty: 5 }, { tx: 5, ty: 5 })).toEqual([tileKey(5, 5)]);
    expect(new Set(rectTiles({ tx: 6, ty: 1 }, { tx: 2, ty: 4 })).size).toBe(5 * 4);
  });
});

describe("the planner's tools", () => {
  it("paints a zone with a drag, grows the selected one, erases from it, and levels it by rovers", () => {
    const m = mount();
    m.click(".planner-tool", "Paint zone");
    m.drag([30, 50], [35, 52]);
    expect(m.calls).toEqual(["zone:new:+18-0"]);
    const zone = m.state.settlements[0]!.zones[0]!;
    expect(zone.tiles).toHaveLength(18);
    // A second drag adds to it (it is selected now), not a new zone.
    m.drag([36, 50], [36, 52]);
    expect(m.state.settlements[0]!.zones).toHaveLength(1);
    expect(m.state.settlements[0]!.zones[0]!.tiles).toHaveLength(21);
    m.click(".planner-tool", "Erase zone");
    m.drag([30, 50], [30, 52]);
    expect(m.state.settlements[0]!.zones[0]!.tiles).toHaveLength(18);
    // The zones panel lists it, and "Level it" sends it to the rovers' queue.
    m.frame();
    expect(m.host.querySelector(".planner-zone-size")!.textContent).toBe("18 tiles");
    m.click(".planner-zone-level");
    expect(m.calls.at(-1)).toBe(`level:${zone.id}`);
    expect(m.state.settlements[0]!.levelQueue.length, "vacuity: the zone slopes").toBeGreaterThan(0);
    expect(m.host.querySelector(".planner-hint")!.textContent).toMatch(/queued for the rovers/);
    // Time passes; the rovers go without another click.
    m.state = advance(m.state, 1, { tuning: t, env: NEUTRAL_ENV, forcing: null });
    expect(m.state.settlements[0]!.jobs.some((j) => j.kind === "rover")).toBe(true);
  });

  it("plans a corridor and a power line along a drag, and the simulation builds them", () => {
    const m = mount();
    m.click(".planner-tool", "Road (corridor)");
    m.drag([4, 20], [14, 20]);
    m.click(".planner-tool", "Power line");
    m.drag([4, 22], [4, 28]);
    expect(m.calls).toEqual(["plan:corridors:11", "plan:cables:7"]);
    expect(m.host.querySelector(".planner-hint")!.textContent).toMatch(/Planned 7 tiles of power line/);
    m.state = advance(m.state, 4, { tuning: t, env: NEUTRAL_ENV, forcing: null });
    const c = m.state.settlements[0]!;
    expect(c.planned).toEqual([]);
    expect(c.corridors).toEqual(expect.arrayContaining(lineTiles({ tx: 4, ty: 20 }, { tx: 14, ty: 20 })));
    expect(c.cables).toEqual(expect.arrayContaining(lineTiles({ tx: 4, ty: 22 }, { tx: 4, ty: 28 })));
    // The move tool plans nothing.
    m.click(".planner-tool", "Move");
    m.drag([4, 30], [14, 30]);
    expect(m.calls).toHaveLength(2);
  });

  it("renames the city, and goes back to the city view", () => {
    const m = mount();
    const name = m.host.querySelector<HTMLInputElement>(".planner-name")!;
    name.value = "Nova Roma";
    name.dispatchEvent(new Event("change"));
    expect(m.state.settlements[0]!.name).toBe("Nova Roma");
    m.click(".planner-city");
    expect(m.calls).toEqual(["rename:Nova Roma", "city view"]);
  });
});

describe("the record, charted", () => {
  it("draws people, births and deaths, and a blackout, from the settlement's own samples", () => {
    const t = FLAT;
    let s = start(4000, t);
    const id = s.settlements[0]!.id;
    const place = (type: Parameters<typeof placeBuilding>[2], x: number, y: number): void => {
      const o = placeBuilding(s, id, type, x, y, t);
      expect(o.ok, `${type}: ${o.reason}`).toBe(true);
      s = o.state;
    };
    // The same small powered, fed and watered city as the simulation's own record test.
    for (let k = 0; k < 4; k += 1) place("habitat_dome", 4 + 4 * k, 4);
    for (let k = 0; k < 3; k += 1) place("greenhouse", 4 + 3 * k, 10);
    for (let k = 0; k < 3; k += 1) place("geothermal_plant", 4 + 3 * k, 14);
    place("water_extractor", 16, 14);
    const cfg = { tuning: t, env: NEUTRAL_ENV, forcing: null };
    s = advance(s, 4 * 6, cfg);
    // The plant goes dark.
    s = { ...s, settlements: s.settlements.map((c) => ({ ...c, buildings: c.buildings.filter((b) => b.type !== "geothermal_plant"), stores: { ...c.stores, power: 0 } })) };
    s = advance(s, 4, cfg);
    const samples = s.settlements[0]!.history.samples;
    const cs = charts(samples);
    const blackout = cs.find((c) => /Shortages/.test(c.title))!.series.find((x) => /Blackout/.test(x.label))!;
    expect(blackout.values.at(-1)).toBe(1);
    expect(blackout.values.slice(0, -1).every((v) => v === 0), "vacuity: no blackout before").toBe(true);
    const m = mount(s, t);
    m.click(".planner-tab", "Charts");
    m.frame();
    const figs = [...m.host.querySelectorAll(".planner-chart")];
    expect(figs.map((f) => f.querySelector("figcaption")!.textContent)).toEqual(cs.map((c) => `${c.title} (${c.unit})`));
    const shortages = figs.find((f) => /Shortages/.test(f.textContent ?? ""))!;
    expect(shortages.querySelector("canvas")!.getAttribute("aria-label")).toMatch(/Blackout \(power\) 1\.0/);
    const people = figs[0]!.querySelector("canvas")!.getAttribute("aria-label")!;
    expect(people).toContain(`People ${Math.floor(s.settlements[0]!.population) >= 10 ? Math.round(s.settlements[0]!.population) : s.settlements[0]!.population.toFixed(1)}`);
    m.click(".planner-tab", "Overview");
    m.frame();
    expect(m.host.querySelector(".planner-facts")!.textContent).toMatch(/blackout 100% of the year/);
  });
});
