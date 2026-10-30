/**
 * The ending in the player's words (Batch 39): the world's story in numbers,
 * its score part by part, and the line the worlds list shows. Reads what the
 * simulation derives; never works anything out of its own.
 */

import type { Tuning, WorldScore, WorldStory } from "../sim/index.js";

export interface Line {
  readonly label: string;
  readonly value: string;
}

const n = (x: number): string => Math.round(x).toLocaleString("en");
const plural = (x: number, one: string, many = `${one}s`): string => `${n(x)} ${Math.round(x) === 1 ? one : many}`;
const signed = (x: number): string => (x > 0 ? `+${n(x)}` : x < 0 ? `-${n(-x)}` : "0");

/** Real time at 1x for a span of sim-years, as a player reads it. */
export function realTime(years: number, t: Tuning): string {
  const hours = years / t.TIME_SCALE / 3600;
  if (hours < 1) return `about ${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 48) return `about ${Math.round(hours)} hours`;
  return `about ${Math.round(hours / 24)} days`;
}

/** The world's story, a line at a time: what the victory's card shows. */
export function storyLines(story: WorldStory, t: Tuning): readonly Line[] {
  const lines: Line[] = [];
  if (story.victoryYear !== null) lines.push({ label: "Won in", value: `year ${n(story.victoryYear)} - ${realTime(story.victoryYear, t)} of play at 1x` });
  lines.push({ label: "Cities", value: `${n(story.citiesFounded)} founded, ${n(story.citiesStanding)} standing${story.outposts > 0 ? `; ${plural(story.outposts, "outpost")}` : ""}` });
  lines.push({ label: "People", value: `${n(story.peakPeople)} at the most, ${n(story.people)} now` });
  const lost = [story.citiesLost > 0 ? plural(story.citiesLost, "city", "cities") : "", story.peopleLost >= 0.5 ? plural(story.peopleLost, "person", "people") : ""].filter((x) => x !== "");
  lines.push({ label: "Lost to the sea", value: lost.length === 0 ? "nothing and no one" : lost.join(", ") });
  const saved = [story.citiesSaved > 0 ? `${plural(story.citiesSaved, "city", "cities")} behind ${story.citiesSaved === 1 ? "its" : "their"} Seawall` : "", story.peopleEvacuated >= 0.5 ? `${plural(story.peopleEvacuated, "person", "people")} moved to safety` : ""].filter((x) => x !== "");
  if (saved.length > 0) lines.push({ label: "Saved from the sea", value: saved.join(", ") });
  lines.push({ label: "Pressure on the planet", value: `${n(story.machineYears)} machine-years` });
  lines.push({ label: "Credits taken in", value: n(story.creditsEarned) });
  if (story.contractsMet > 0) lines.push({ label: "Earth's contracts met", value: n(story.contractsMet) });
  lines.push({ label: "Achievements", value: `${n(story.achievements)} earned in this world` });
  return lines;
}

/** The score, part by part, and its total last. */
export function scoreLines(score: WorldScore): readonly Line[] {
  const lines: Line[] = [{ label: score.yearsToVictory === null ? "Speed (once won)" : "Speed", value: signed(score.speed) }, { label: "People at the most", value: signed(score.people) }];
  if (score.saved !== 0) lines.push({ label: "Cities held by their Seawall", value: signed(score.saved) });
  if (score.lost !== 0) lines.push({ label: "Cities lost to the sea", value: signed(score.lost) });
  lines.push({ label: "Pressure on the planet", value: signed(score.pressure) });
  lines.push({ label: "Score", value: n(score.total) });
  return lines;
}

/** What the worlds list says of a world's ending: its score, and whether and when it was won. Empty without one. */
export function listWords(score: number | null, wonYear: number | null, achievements: number): string {
  if (score === null) return "";
  const won = wonYear === null ? "not won yet" : `won in year ${n(wonYear)}`;
  return `Score ${n(score)} - ${won} - ${plural(achievements, "achievement")}`;
}
