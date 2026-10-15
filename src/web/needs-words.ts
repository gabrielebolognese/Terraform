/**
 * People's needs and happiness in words (Batch 32), for the city's panel and
 * the planner. Pure: what the readout shows, from the simulation's reading.
 */

import type { NeedReading, NeedsReading, Tuning } from "../sim/index.js";
import { NEED_BY_ID, happinessOf, needAskedFrom } from "../sim/index.js";

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const signed = (x: number): string => `${x >= 0 ? "+" : "-"}${Math.round(Math.abs(x) * 100)}%`;

/** "Happiness 72%: ..." - the mood, and what it does to growth and to what the buildings make. */
export function happinessWords(n: NeedsReading): string {
  const h = `Happiness ${pct(happinessOf(n.mood))}`;
  if (!n.needs.some((x) => x.asked)) return `${h}: content - a settlement this small asks only for life support.`;
  if (Math.abs(n.mood) < 0.005) return `${h}: content - growth and work as usual.`;
  return `${h}: growth ${signed(n.growth - 1)}, buildings make ${signed(n.output - 1)}.`;
}

export type NeedState = "met" | "part" | "unmet" | "later";

export interface NeedLine {
  readonly id: NeedReading["id"];
  readonly name: string;
  readonly state: NeedState;
  readonly text: string;
}

/** One line a need: how far it is met, and what meets it - or from how many people it will be asked. */
export function needLines(n: NeedsReading, t: Tuning): NeedLine[] {
  return n.needs.map((x) => {
    const def = NEED_BY_ID[x.id];
    if (!x.asked) return { id: x.id, name: def.name, state: "later", text: `asked from ${needAskedFrom(def, t).toLocaleString("en")} people` };
    const state: NeedState = x.met >= 0.995 ? "met" : x.met > 0.005 ? "part" : "unmet";
    if (!def.reach) {
      const kinds = Math.round(x.met * t.FOOD_VARIETY_KINDS);
      const grown = kinds === 0 ? "no food grown here" : kinds === 1 ? "food grown one way" : `food grown ${kinds} ways`;
      return { id: x.id, name: def.name, state, text: state === "met" ? grown : `${grown} - wants ${def.meets.replace(/^food grown more than one way: /, "")}` };
    }
    const share = `${pct(x.met)} of homes in reach`;
    return { id: x.id, name: def.name, state, text: state === "met" ? share : `${share} - wants ${def.meets}` };
  });
}
