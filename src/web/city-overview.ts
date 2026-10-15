/**
 * A city at a glance (Batch 31): "people, shortages, builds in progress" -
 * the card the HUD's settlement list and the world map both show.
 *
 * From the state, and what is short from the alerts' own conditions (the
 * settlement's next substep, the one the city view draws from too) - never a
 * step of its own, so the card and the alerts can never disagree about what
 * is short, and a planet of forty settlements is not stepped twice over.
 */

import type { MicroResource, Settlement, Tuning } from "../sim/index.js";
import { constructionOf, housing } from "../sim/index.js";

const isCityKind = (kind: Settlement["kind"]): boolean => kind === "city" || kind === "metropolis";
import { RESOURCE_NAMES } from "./offline-words.js";

export interface CityOverview {
  readonly people: number;
  /** Homes: zero for an outpost, which houses no one. */
  readonly homes: number;
  /** What ran short at its last substep, in `MICRO_RESOURCES` order. */
  readonly short: readonly MicroResource[];
  /** New buildings a rover is at work on, upgrades a rover is at work on, and builds of either waiting for a rover. */
  readonly building: number;
  readonly upgrading: number;
  readonly waiting: number;
}

export function cityOverview(s: Settlement, short: readonly MicroResource[], t: Tuning): CityOverview {
  // A new building stands once its rover's work is done (the drive home is the rover's); an upgrade takes its
  // level when the rover is home. Going up is what `constructionOf` holds, less what still waits for a rover.
  const queuedNew = new Set(s.buildQueue.filter((q) => !q.upgrade).map((q) => q.tile));
  let building = 0;
  for (const tile of constructionOf(s).keys()) if (!queuedNew.has(tile)) building += 1;
  const upgrading = s.jobs.filter((j) => j.kind === "build" && j.upgrade).length;
  const standing = s.lostAtSeaLevelM === null;
  return {
    people: s.population,
    homes: isCityKind(s.kind) ? housing(s, t) : 0,
    short: standing ? short : [],
    building,
    upgrading,
    waiting: s.buildQueue.length,
  };
}

/** "120 of 160 people - short of water and food - 2 going up, 1 upgrading, 3 waiting for a rover". */
export function overviewWords(o: CityOverview, s: Settlement): string {
  const people = isCityKind(s.kind) ? `${Math.floor(o.people).toLocaleString("en")} of ${Math.round(o.homes).toLocaleString("en")} people` : "An outpost: no people";
  const short = o.short.length === 0 ? "nothing short" : `short of ${o.short.map((r) => RESOURCE_NAMES[r].toLowerCase()).join(" and ")}`;
  const parts: string[] = [];
  if (o.building > 0) parts.push(`${o.building} going up`);
  if (o.upgrading > 0) parts.push(`${o.upgrading} upgrading`);
  if (o.waiting > 0) parts.push(`${o.waiting} waiting for a rover`);
  return `${people} - ${short} - ${parts.length === 0 ? "nothing being built" : parts.join(", ")}`;
}
