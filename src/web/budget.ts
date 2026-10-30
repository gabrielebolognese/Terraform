/**
 * Batch 40's performance budget, measured. No browser is opened in this
 * project's runs, so it is measured in Node, through the code the browser
 * runs: the city screen's chunked pictures, its view re-derived as the screen
 * re-derives it, and every shape filled through the screen's own `fillShapes`
 * into a stand-in canvas that counts what it is asked to do. What only a
 * browser can time - the canvas's own filling and the GPU - is counted, not
 * timed. The machine and the numbers are in docs/balance/batch40-playtest.md.
 *
 *   npx tsx src/web/budget.ts city          the reference city, 60 fps wanted
 *   npx tsx src/web/budget.ts metropolis    panning a metropolis, 30 fps wanted
 *   npx tsx src/web/budget.ts open          opening a world, under 3 s wanted
 *   npx tsx src/web/budget.ts memory        memory bounded
 */

import type { CityView, HabitatChannels, Settlement, SimState, Tuning } from "../sim/index.js";
import { DEFAULT_TUNING, NEUTRAL_ENV, advance, cityView, makeTuning, marsStart, prepareCity, resumeSteps, toSave } from "../sim/index.js";
import { examplePlanet } from "../harness/example.js";
import { playPacing } from "../harness/pacing.js";
import { cityDay, metropolisScene } from "../harness/vehicles.js";
import { CHUNK_PIXELS } from "./settings.js";
import type { CityCamera } from "./city-camera.js";
import { centreCamera, pan, qualityFor } from "./city-camera.js";
import { ChunkedCity } from "./city-chunks.js";
import { fillShapes } from "./city.js";
import { fromRecord, tuningRecord, worldTuning } from "./game-tuning.js";
import { ViewInputs } from "./view-inputs.js";

/** The window: a laptop's browser, full screen, at a device pixel ratio of 1. */
const W = 1600;
const H = 900;
/** The city screen's own cadence (city.ts): the view re-derived every 200 ms. */
const VIEW_MS = 200;
const FPS = 60;

/** A stand-in 2D context: counts the paths and points it is asked to fill, and does nothing else. */
class CountingContext {
  paths = 0;
  points = 0;
  clips = 0;
  fillStyle = "";
  save(): void {}
  restore(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {
    this.points += 1;
  }
  lineTo(): void {
    this.points += 1;
  }
  rect(): void {}
  clip(): void {
    this.clips += 1;
  }
  fill(): void {
    this.paths += 1;
  }
}

interface FrameStats {
  readonly frames: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Frames over the budget's frame time. */
  readonly over: number;
  /** A frame's canvas work, on average: paths and points filled into the frame, pictures drawn in, and pictures painted. */
  readonly perFrame: { readonly paths: number; readonly points: number; readonly blits: number; readonly painted: number };
  /** The first frame: the view's first derivation and the first pictures (what opening the city costs). */
  readonly firstMs: number;
  readonly views: number;
  /** The view re-derived after the first: the slowest, and the median. */
  readonly viewMedianMs: number;
  readonly viewMaxMs: number;
  /** Frames over budget that re-derived the view; that painted new pictures and derived no view. */
  readonly overWithView: number;
  readonly overWithPaint: number;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/**
 * Frames as the city screen draws them: the view re-derived as the screen re-derives it (`ViewInputs`:
 * when the settlement or the planet's channels changed, at most every 200 ms), then the chunked city drawn - new pictures within the first-draw budget, the rest blitted, what moves
 * filled on top. `cityAt(k)` is the settlement at frame k; `cameraAt(k)` the camera.
 */
function play(cityAt: (k: number) => Settlement, env: HabitatChannels, t: Tuning, cameraAt: (k: number, view: CityView) => CityCamera, n: number, budgetMs: number, firstBudgetMs?: number): FrameStats {
  const frameCtx = new CountingContext();
  const pictureCtx = new CountingContext();
  let blits = 0;
  let painted = 0;
  const chunks = new ChunkedCity<{ w: number; h: number }>({
    make: (w, h) => ({ w, h }),
    paint: (_picture, shapes) => {
      painted += 1;
      fillShapes(pictureCtx as unknown as CanvasRenderingContext2D, shapes);
    },
    blit: () => {
      blits += 1;
    },
    fill: (shapes) => fillShapes(frameCtx as unknown as CanvasRenderingContext2D, shapes),
    now: () => performance.now(),
  }, undefined, undefined, firstBudgetMs);
  chunks.budget = CHUNK_PIXELS.standard;
  const paintedIn: boolean[] = [];
  const inputs = new ViewInputs();
  let view: CityView | null = null;
  let viewAt = -Infinity;
  const viewTimes: number[] = [];
  const derived: boolean[] = [];
  const times: number[] = [];
  for (let k = 0; k < n; k += 1) {
    const now = (k * 1000) / FPS;
    const s = cityAt(k);
    const start = performance.now();
    const again = view === null || (inputs.changed(s, env) && now - viewAt >= VIEW_MS);
    if (view === null || again) {
      const v0 = performance.now();
      view = cityView(s, env, t);
      viewTimes.push(performance.now() - v0);
      viewAt = now;
      inputs.took(s, env);
    }
    derived.push(again);
    const cam = cameraAt(k, view);
    const halfW = W / 2 / cam.zoom;
    const halfH = H / 2 / cam.zoom;
    const viewport = { minX: cam.cx - halfW, maxX: cam.cx + halfW, minY: cam.cy - halfH, maxY: cam.cy + halfH };
    const quality = qualityFor(cam, W, H, view.world.size);
    const paintedBefore = painted;
    chunks.draw(view, { time: now / 1000, selected: null, ghost: null, quality, effects: true }, viewport, cam.zoom);
    times.push(performance.now() - start);
    paintedIn.push(painted > paintedBefore);
  }
  const round = (x: number): number => Math.round(x * 100) / 100;
  const first = times[0]!;
  const rest = times.slice(1);
  const sorted = [...rest].sort((a, b) => a - b);
  const later = viewTimes.slice(1).sort((a, b) => a - b);
  return {
    frames: n - 1,
    medianMs: round(quantile(sorted, 0.5)),
    p95Ms: round(quantile(sorted, 0.95)),
    p99Ms: round(quantile(sorted, 0.99)),
    maxMs: round(sorted.at(-1)!),
    over: rest.filter((x) => x > budgetMs).length,
    overWithView: rest.filter((x, i) => x > budgetMs && derived[i + 1]).length,
    overWithPaint: rest.filter((x, i) => x > budgetMs && !derived[i + 1] && paintedIn[i + 1]).length,
    perFrame: { paths: Math.round(frameCtx.paths / n), points: Math.round(frameCtx.points / n), blits: Math.round(blits / n), painted: round(painted / n) },
    firstMs: round(first),
    views: viewTimes.length,
    viewMedianMs: round(quantile(later, 0.5)),
    viewMaxMs: round(later.at(-1) ?? 0),
  };
}

/** A new Standard world's tuning, as the vehicles' tests take it (the sea off: the scripted site is low). */
function newWorld(): Tuning {
  return makeTuning({ ...worldTuning("standard", 0, "standard"), FLOODING_ENABLED: 0 });
}

function city(): unknown {
  const t = newWorld();
  const made = performance.now();
  // The scripted player's city two hours in, its rovers out (Batch 29's reference city), a substep a frame-step.
  const day = cityDay(t, 2 * 3600);
  const built = performance.now() - made;
  const days = day.days;
  // Each substep is 8.3 s at 1x: 500 frames at 60 fps. The last 1,200 frames' worth of days, two of them.
  const from = days.length - 3;
  const at = (k: number): Settlement => days[Math.min(days.length - 1, from + Math.floor(k / 500))]!;
  const still = (_k: number, v: CityView): CityCamera => centreCamera(v.tiles, W);
  const settled = play(at, day.env, t, still, 1200, 1000 / 60);
  return { scene: "the reference city, two hours in, its first camera", madeS: Math.round(built / 100) / 10, buildings: at(0).buildings.length, jobs: at(0).jobs.length, ...settled };
}

function metropolis(): unknown {
  const t = newWorld();
  const made = performance.now();
  const scene = metropolisScene(t);
  const built = performance.now() - made;
  const s = scene.state.settlements.find((c) => c.id === scene.id)!;
  // The surveying is done before the city shows (prepareCity); not part of a panning frame.
  for (const _ of prepareCity(s, t)) void _;
  // Held keys pan 600 screen pixels a second (KEY_PAN_PX at the default camera speed): 10 a frame at 60 fps.
  let cam: CityCamera | null = null;
  const panning = (k: number, v: CityView): CityCamera => {
    cam ??= centreCamera(v.tiles, W);
    const dir = Math.floor(k / 600) % 2 === 0 ? 1 : -1;
    cam = pan(cam, dir * 10, (k % 300 < 150 ? 1 : -1) * 3, v.tiles, v.world.margin);
    return cam;
  };
  // A substep makes the settlement anew: every 8.3 s at 1x (500 frames), 2.8 s at 3x (167), a Standard world's fastest.
  const speed = Number(process.argv[3] ?? 1);
  const every = Math.round(500 / speed);
  const copies = [s, { ...s }];
  const first = process.argv[4] === undefined ? undefined : Number(process.argv[4]);
  const panned = play((k) => copies[Math.floor(k / every) % 2]!, scene.env, t, panning, 1800, 1000 / 30, first);
  return { scene: `a metropolis, panned by held keys for 30 s at 60 frames a second, at ${speed}x`, firstBudgetMs: first ?? "default", madeS: Math.round(built / 100) / 10, buildings: s.buildings.length, ...panned };
}

function open(): unknown {
  const out: Record<string, unknown>[] = [];
  const time = <T>(f: () => T): [T, number] => {
    const a = performance.now();
    const r = f();
    return [r, Math.round(performance.now() - a)];
  };
  const worlds: [string, () => { state: SimState; t: Tuning }][] = [
    ["a new Standard world", () => {
      const t = worldTuning("standard", 7, "standard");
      return { state: marsStart(7, t), t };
    }],
    ["the scripted player's world, five hours in", () => {
      const t = worldTuning("standard", 0, "standard");
      return { state: playPacing(t, 5 * 3600, false).state, t };
    }],
    ["a Terraformed start", () => {
      const t = worldTuning("terraformed", 7, "standard");
      return { state: examplePlanet(DEFAULT_TUNING, t, 7).state, t };
    }],
  ];
  for (const [name, make] of worlds) {
    const [{ state, t }, madeMs] = time(make);
    const savedAt = Date.parse("2026-10-30T12:00:00Z");
    const text = JSON.stringify(toSave(state, t, new Date(savedAt).toISOString()));
    const record = tuningRecord(t);
    for (const awayH of [0, 1, 10]) {
      // As the library loads it: the tuning from its record, the save read and migrated, then caught up a substep at
      // a time (the page handed back between): the whole, and the longest single slice - the longest the page stops.
      const began = performance.now();
      const steps = resumeSteps(JSON.parse(text) as unknown, savedAt + awayH * 3600_000, { tuning: fromRecord(record), env: NEUTRAL_ENV, forcing: null }, 1);
      let longest = 0;
      let at = performance.now();
      let r = steps.next();
      // The first slice holds the parse and the migration.
      const readMs = Math.round(performance.now() - began);
      while (r.done !== true) {
        at = performance.now();
        r = steps.next();
        longest = Math.max(longest, performance.now() - at);
      }
      const loadMs = Math.round(performance.now() - began);
      const loaded = r.value;
      // And the first substep played after it.
      const [, stepMs] = time(() => advance(loaded.state, 1, { tuning: t, env: NEUTRAL_ENV, forcing: null }));
      out.push({ world: name, awayHours: awayH, madeMs, saveKb: Math.round(text.length / 1024), readMs, loadMs, longestSliceMs: Math.round(longest), firstStepMs: stepMs, caughtUpSteps: loaded.state.steps - state.steps });
    }
  }
  return out;
}

function memory(): unknown {
  const mb = (): number => Math.round(process.memoryUsage().heapUsed / 1048576);
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const t = newWorld();
  const before = mb();
  const scene = metropolisScene(t);
  gc?.();
  const withScene = mb();
  const s = scene.state.settlements.find((c) => c.id === scene.id)!;
  for (const _ of prepareCity(s, t)) void _;
  let cam: CityCamera | null = null;
  const across = (k: number, v: CityView): CityCamera => {
    cam ??= centreCamera(v.tiles, W);
    cam = pan(cam, 40, (k % 120 < 60 ? 1 : -1) * 12, v.tiles, v.world.margin);
    return cam;
  };
  const marks: number[] = [];
  for (let lap = 0; lap < 3; lap += 1) {
    play(() => s, scene.env, t, across, 600, 1000 / 30);
    gc?.();
    marks.push(mb());
  }
  return { heapMb: { before, withScene, afterEachPan: marks } };
}

const section = process.argv[2] ?? "city";
const runs: Record<string, () => unknown> = { city, metropolis, open, memory };
const run = runs[section];
if (run === undefined) throw new Error(`no section "${section}": ${Object.keys(runs).join(", ")}`);
console.log(JSON.stringify({ section, result: run() }, null, 1));
