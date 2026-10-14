/**
 * Build times as the player reads them (Batch 28): "the countdown shown
 * everywhere a build is - over the worksite, in the city panel, in the queue,
 * in real time ('3 min 20 s')".
 *
 * Everything here reads a settlement and never writes it. The simulation
 * counts in its own years; this turns them into the real time they will take
 * at the speed the player has the world running at.
 */

import type { BuildingType, Settlement, Tuning } from "../sim/index.js";
import { BUILDING_DEFS, buildYears, buildingSite, citySecondsPerYear, drive } from "../sim/index.js";
import { garage } from "../sim/micro/rocks.js";
import { tileKey } from "../sim/micro/space.js";

/** "45 s", "3 min 20 s", "2 h 05 min" - to the second under an hour, to the minute after. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m} min ${r} s`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

/**
 * Real seconds a span of a settlement's years takes at `speed`. Paused (0),
 * it is the time at 1x: what it will take once the world moves again.
 */
export function realSeconds(cityYears: number, t: Tuning, speed: number): number {
  return (cityYears * citySecondsPerYear(t)) / (speed > 0 ? speed : 1);
}

export type BuildState =
  /** A rover is at work; `seconds` until the building stands (a new one) or takes its level (an upgrade). */
  | { readonly kind: "building"; readonly tile: number; readonly type: BuildingType; readonly upgrade: boolean; readonly level: number; readonly seconds: number; readonly done: number }
  /** Waiting for a rover, `place` in the queue (0 is next); `seconds` it will take once one goes. */
  | { readonly kind: "waiting"; readonly tile: number; readonly type: BuildingType; readonly upgrade: boolean; readonly level: number; readonly seconds: number; readonly place: number };

/**
 * Every build under way and waiting in a settlement, in the order a player
 * reads them: the rovers' work first, then the queue in its order.
 */
export function buildStates(s: Settlement, t: Tuning, speed: number): BuildState[] {
  // By corner tile, made once: a metropolis has tens of thousands of buildings, and the example hundreds of builds.
  const byTile = new Map(s.buildings.map((b) => [tileKey(b.tx, b.ty), b]));
  const at = (tile: number) => byTile.get(tile);
  const out: BuildState[] = [];
  for (const j of s.jobs) {
    if (j.kind !== "build") continue;
    const b = at(j.tile);
    if (b === undefined) continue;
    // A new building stands once the work is done (the drive home is the rover's);
    // an upgrade takes its level when the rover is home.
    const back = (j.total - j.work) / 2;
    const left = j.upgrade ? j.remaining : Math.max(0, j.remaining - back);
    const done = Math.min(1, Math.max(0, (j.total - j.remaining - back) / Math.max(1e-12, j.work)));
    out.push({ kind: "building", tile: j.tile, type: b.type, upgrade: j.upgrade, level: j.upgrade ? b.level + 1 : 1, seconds: realSeconds(left, t, speed), done });
  }
  s.buildQueue.forEach((q, place) => {
    const b = at(q.tile);
    if (b === undefined) return;
    const level = q.upgrade ? b.level + 1 : 1;
    out.push({ kind: "waiting", tile: q.tile, type: b.type, upgrade: q.upgrade, level, seconds: realSeconds(timeOnceSent(s, b.type, b.tx, b.ty, q.upgrade, level, t), t, speed), place });
  });
  return out;
}

/**
 * What a build will take once its rover leaves: the drive out and the work
 * (and, for an upgrade, the drive home) - the drive along its route where
 * routes are on (Batch 29), as the rover would go now.
 */
function timeOnceSent(s: Settlement, type: BuildingType, tx: number, ty: number, upgrade: boolean, level: number, t: Tuning): number {
  const way = garage(s) === null ? null : drive(s, buildingSite({ type, tx, ty }), t);
  const years = way === null ? 0 : way.years;
  return years * (upgrade ? 2 : 1) + buildYears(type, t, level);
}

/** One line for a build, as the inspector and the queue say it. */
export function buildWords(b: BuildState): string {
  const what = b.upgrade ? `${BUILDING_DEFS[b.type].name} to level ${b.level}` : BUILDING_DEFS[b.type].name;
  if (b.kind === "building") return b.upgrade ? `Upgrading the ${what}: ${formatDuration(b.seconds)} left.` : `Building the ${what}: ready in ${formatDuration(b.seconds)}.`;
  const turn = b.place === 0 ? "next for a rover" : `${ordinal(b.place + 1)} in the queue`;
  return `${b.upgrade ? "Upgrade of the" : "The"} ${what} waits for a rover (${turn}); it takes ${formatDuration(b.seconds)} once one goes.`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}
