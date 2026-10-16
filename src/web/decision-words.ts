/**
 * Events that ask for decisions (Batch 33), in words: an event's headline,
 * its countdown, and what it did - one source for the card, the alerts and
 * the history, so they never disagree.
 *
 * The simulation states each choice and the default (`decisionChoices`,
 * `defaultWords`); this says what happened, from the record it kept.
 */

import type { DecisionRecord, OpenDecision, SimState, Tuning } from "../sim/index.js";
import { decisionTitle, secondsFor } from "../sim/index.js";
import type { HistoryLine } from "./alert-centre.js";
import { formatDuration } from "./build-time.js";
import { settlementLabel } from "./settlement-label.js";

/** What the player did, in the past tense, by choice; null is the default. */
const DONE: Readonly<Record<string, string>> = {
  shelter: "Took shelter",
  shields: "Raised the shields",
  work: "Kept working",
  repair: "Repaired it",
  degraded: "Ran it degraded",
  treat: "Treated everyone",
  quarantine: "Quarantined the city",
  rough: "Landed it rough",
  pad: "Cleared the pad",
  rush: "Paid to rush it",
  wait: "Waited for it",
  search: "Searched for it",
  writeoff: "Wrote it off",
  study: "Studied it",
  sell: "Sold the samples",
};

const count = (n: number, one: string, many = `${one}s`): string => `${Math.round(n).toLocaleString("en")} ${Math.round(n) === 1 ? one : many}`;
const minutes = (seconds: number): string => formatDuration(seconds);

/** The event and where: "Meteor shower in Ares", "Solar Array failing in Ares". */
export function decisionHeadline(e: Pick<OpenDecision, "kind" | "variant" | "building">, where: string): string {
  return `${decisionTitle(e)} in ${where}`;
}

/** Real time until the deadline at the speed the world runs; paused, the time at 1x. */
export function deadlineWords(e: Pick<OpenDecision, "deadline">, steps: number, t: Tuning, speed: number): string {
  return formatDuration(secondsFor(Math.max(0, e.deadline - steps), t) / (speed > 0 ? speed : 1));
}

/** What the event did, from its record: "Kept working: 3 buildings hit, 2 wrecked." */
export function outcomeWords(r: DecisionRecord, t: Tuning): string {
  const did = r.chosen === null ? "Nothing was chosen" : (DONE[r.chosen] ?? r.chosen);
  const o = r.outcome;
  switch (r.kind) {
    case "meteor":
      if (r.chosen === "shelter") return `${did}: nothing was hit, and no materials or research for ${minutes(t.METEOR_SHELTER_SECONDS)}.`;
      if (r.chosen === "shields") return `${did}: nothing was hit.`;
      return `${did}: ${count(o.hit, "building")} hit${o.wrecked > 0 ? `, ${o.wrecked.toLocaleString("en")} wrecked` : ""}.`;
    case "failure":
      if (r.chosen === "repair") return `${did}: it runs as before.`;
      if (r.chosen === "degraded") return `${did}: ${Math.round(t.FAILURE_DEGRADED * 100)}% of its output for ${minutes(t.FAILURE_SECONDS)}.`;
      return `${did}: it broke down, offline for ${minutes(t.FAILURE_SECONDS)}.`;
    case "outbreak": {
      const lost = `${count(-o.people, "person", "people")} lost`;
      return r.chosen === "treat" ? `${did}: ${lost}.` : `${did}: ${lost}, and no growth for ${minutes(t.OUTBREAK_QUARANTINE_SECONDS)}.`;
    }
    case "ship": {
      if (r.chosen === "writeoff") return `${did}: Earth's insurance paid ${count(o.credits, "credit")}.`;
      const parts = [o.materials > 0 ? count(o.materials, "material") : "", o.people > 0 ? count(o.people, "settler") : ""].filter((x) => x !== "");
      return `${did}: ${parts.length === 0 ? "nothing landed" : `${parts.join(" and ")} landed`}.`;
    }
    case "discovery":
      return o.credits > 0 ? `${did}: ${count(o.credits, "credit")}${r.chosen === "study" ? " of research" : ""}.` : `${did}: the find was left where it lay.`;
  }
}

/** The world's event history for the alert centre, newest first: each resolved event, where, and what it did. */
export function historyLines(state: SimState, t: Tuning): HistoryLine[] {
  const out: HistoryLine[] = [];
  for (let i = state.decisions.log.length - 1; i >= 0; i -= 1) {
    const r = state.decisions.log[i]!;
    const city = state.settlements.find((c) => c.id === r.settlement);
    out.push({
      key: `event:${r.id}`,
      title: decisionHeadline(r, city === undefined ? "a city" : settlementLabel(city)),
      text: outcomeWords(r, t),
      year: r.resolved * t.SUBSTEP_YEARS,
      ignored: r.chosen === null,
      target: { kind: "city", id: r.settlement, at: null },
    });
  }
  return out;
}
