/**
 * Earth (Batch 34), in words: the launch windows' countdown, the player's
 * standing, a contract, and what each record says happened - one source for
 * the Earth panel, the alerts and the spaceport's inspector, so they never
 * disagree.
 */

import type { ContractKind, EarthContract, EarthGoods, EarthRecord, SimState, Tuning } from "../sim/index.js";
import { EARTH_GOODS, goodWords, secondsFor, windowIndex, windowStep } from "../sim/index.js";
import { formatDuration } from "./build-time.js";
import { settlementLabel } from "./settlement-label.js";

/** Real time from substep `now` to substep `then` at the speed the world runs; paused, the time at 1x. */
export function untilWords(then: number, now: number, t: Tuning, speed: number): string {
  return formatDuration(secondsFor(Math.max(0, then - now), t) / (speed > 0 ? speed : 1));
}

/** The next launch window, by number, and the substep it opens at. */
export function nextWindow(s: SimState, t: Tuning): { readonly k: number; readonly step: number } {
  const k = windowIndex(s.steps, t) + 1;
  return { k, step: windowStep(k, t) };
}

/** "Next launch window in 6 min 12 s." */
export function windowWords(s: SimState, t: Tuning, speed: number): string {
  return `Next launch window in ${untilWords(nextWindow(s, t).step, s.steps, t, speed)}.`;
}

/** The player's standing with Earth, in a word. */
export function reputationWord(reputation: number): string {
  if (reputation >= 80) return "Trusted";
  if (reputation >= 60) return "Respected";
  if (reputation > 40) return "Neutral";
  if (reputation > 20) return "Doubted";
  return "Distrusted";
}

/** "25 units of water and 10 settlers", or "nothing". */
export function goodsWords(goods: EarthGoods): string {
  const parts = EARTH_GOODS.filter((g) => goods[g] > 0).map((g) => goodWords(g, Math.round(goods[g])));
  if (parts.length === 0) return "nothing";
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)!}`;
}

const CONTRACT_GOODS: Readonly<Record<ContractKind, readonly [string, string]>> = {
  materials: ["material", "materials"],
  water: ["unit of water", "units of water"],
  research: ["credit of research", "credits of research"],
};

/** An amount a contract asks for: "180 materials", "60 credits of research". */
export function contractAmount(kind: ContractKind, n: number): string {
  const whole = Math.floor(n);
  const [one, many] = CONTRACT_GOODS[kind];
  return `${whole.toLocaleString("en")} ${whole === 1 ? one : many}`;
}

/** What a contract asks, by when: "180 materials by the launch window in 28 min". */
export function contractAsk(c: EarthContract, s: SimState, t: Tuning, speed: number): string {
  return `${contractAmount(c.kind, c.amount)} by the launch window in ${untilWords(windowStep(c.due, t), s.steps, t, speed)}`;
}

/** How a contract is sent: on the rockets, or by radio as it is earned. */
export function contractHow(kind: ContractKind, t: Tuning): string {
  return kind === "research"
    ? "Research the planet earns goes to Earth instead of the bank until it is met."
    : `It goes up on the rockets at each launch window, from what the cities hold beyond a quarter of their room (${Math.round(t.EARTH_KEEP_SHARE * 100)}%).`;
}

/** Credits in words: "1,240 credits". */
export function credits(n: number): string {
  const whole = Math.round(n);
  return `${whole.toLocaleString("en")} ${whole === 1 ? "credit" : "credits"}`;
}

/** A record's line: what happened, where - for the panel's record and the alerts. */
export function recordWords(r: EarthRecord, s: SimState): { readonly title: string; readonly text: string } {
  const city = r.settlement === null ? undefined : s.settlements.find((c) => c.id === r.settlement);
  const where = city === undefined ? "a city" : settlementLabel(city);
  switch (r.kind) {
    case "launched": {
      const sent = goodsWords(r.goods);
      const paid = r.credits > 0 ? ` Earth paid ${credits(r.credits)} for what it bought.` : "";
      return { title: `Rocket up from ${where}`, text: sent === "nothing" ? `Lifted off for Earth to fetch the order.${paid}` : `Lifted off for Earth with ${sent}.${paid}` };
    }
    case "landed": {
      const back = r.credits > 0 ? ` ${credits(r.credits)} back for what did not fit.` : "";
      return { title: `Rocket home in ${where}`, text: `Landed ${goodsWords(r.goods)}.${back}` };
    }
    case "missed":
      return { title: `Launch window missed in ${where}`, text: "Its rocket was away, or it has no finished spaceport: its orders wait for the next window." };
    case "fulfilled":
      return { title: `Earth's ${r.contract ?? ""} contract met`.replace("  ", " "), text: `Earth paid ${credits(r.credits)}. Reputation +${Math.round(r.reputation)}.` };
    case "failed":
      return { title: `Earth's ${r.contract ?? ""} contract failed`.replace("  ", " "), text: `It was not met by its launch window. Reputation ${Math.round(r.reputation)}.` };
  }
}
