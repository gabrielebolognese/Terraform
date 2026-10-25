/**
 * Batch 33's exit gate: events that ask for decisions.
 *
 * - The same world seed gives the same events at the same sim-years, live or
 *   offline, chunked any way (`toEqual`).
 * - Each choice's outcome is measured through a real `advance` against the
 *   other choices.
 * - An ignored event resolves to its default, and the default is never the
 *   best choice (checked per event).
 * - Behind a tuning constant at 0. The browser opts in.
 *
 * The world is the scripted Standard player's (`playPacing`), as a new world
 * in the browser is made (here, beside the browser's tuning, rather than in
 * `src/sim/`, which may not import it even in a test): its city at 100
 * minutes, 713 people.
 */

import { describe, expect, it } from "vitest";

import { playPacing } from "../harness/pacing.js";
import { tuningRecord, worldTuning } from "./game-tuning.js";
import { CHOICE_TITLES, cardAt, cardDealtAt, cardFor, chooseDecision, decisionChoices, deckSlots, defaultWords, outbreakAtRisk, secondsFor, substepsFor } from "../sim/decisions.js";
import { emptyEarth } from "../sim/earth.js";
import { advance } from "../sim/integrate.js";
import { BUILDING_DEFS } from "../sim/micro/buildings.js";
import { resume } from "../sim/offline.js";
import { fromSave, toSave } from "../sim/save.js";
import { makeTuning } from "../sim/tuning.js";
import type { Tuning } from "../sim/tuning.js";
import type { DecisionKind, DecisionVariant, OpenDecision, Settlement, SimState } from "../sim/types.js";
import { MICRO_RESOURCES, NEUTRAL_ENV } from "../sim/types.js";

const BASE = tuningRecord(worldTuning("standard", 0, "standard"));
const OFF = makeTuning({ ...BASE, DECISIONS_ENABLED: 0 });
const ON = makeTuning({ ...BASE, DECISIONS_ENABLED: 1 });
/** Events on, but no card dealt: an event placed by a test resolves alone, unjostled by the deck. */
const QUIET = makeTuning({ ...BASE, DECISIONS_ENABLED: 1, DECISION_CHANCE: 0 });
const cfg = (t: Tuning) => ({ tuning: t, env: NEUTRAL_ENV, forcing: null });
const AT = "2026-10-16T12:00:00.000Z";

/** The scripted player's world, `minutes` in, events off while it was played. Kept: each costs a few seconds. */
const played = new Map<number, SimState>();
function world(minutes: number): SimState {
  let s = played.get(minutes);
  if (s === undefined) {
    s = playPacing(OFF, minutes * 60, false).state;
    played.set(minutes, s);
  }
  return s;
}
const cityOf = (s: SimState): Settlement => s.settlements[0]!;
const levels = (c: Settlement): number => c.buildings.reduce((a, b) => a + b.level, 0);

describe("the deck (Batch 33)", () => {
  it("deals nothing before its first slot, at most one card a slot, and the same cards for the same seed", () => {
    const { first, every } = deckSlots(ON);
    // Measured: 30 min and 20 min of real time at 1x are 216 and 144 substeps (8.3 s each).
    expect(first).toBe(216);
    expect(every).toBe(144);
    for (let step = 0; step < first; step += 1) expect(cardDealtAt(7, step, ON)).toBeNull();
    let dealt = 0;
    for (let k = 0; k < 200; k += 1) {
      const at = cardAt(7, k, ON);
      if (at === null) continue;
      dealt += 1;
      expect(at).toBeGreaterThanOrEqual(first + k * every);
      expect(at).toBeLessThan(first + (k + 1) * every);
      expect(cardDealtAt(7, at, ON)).toBe(k);
      expect(cardAt(7, k, ON)).toBe(at);
    }
    // DECISION_CHANCE 0.75 of 200 slots: measured 141 dealt for seed 7. And a second seed is dealt differently.
    expect(dealt).toBeGreaterThan(130);
    expect(dealt).toBeLessThan(170);
    const other = Array.from({ length: 50 }, (_, k) => cardAt(8, k, ON));
    expect(other).not.toEqual(Array.from({ length: 50 }, (_, k) => cardAt(7, k, ON)));
  });

  it("is off by default, off in a world made with it off, and on only by tuning", () => {
    expect(makeTuning().DECISIONS_ENABLED).toBe(0);
    const s = advance(world(100), 1296, cfg(OFF));
    expect(s.decisions.open).toEqual([]);
    expect(s.decisions.log).toEqual([]);
    expect(s.settlements.every((c) => c.effects.length === 0)).toBe(true);
    // Vacuity: the same three hours with events on deal some.
    expect(advance(world(100), 1296, cfg(ON)).decisions.log.length).toBeGreaterThan(3);
  });
});

describe("the same seed, the same events, however it is run (Batch 33's gate)", () => {
  const N = 1296; // three hours at 1x
  const start = (): SimState => world(100);

  it("live in one call, chunked any way, and offline give the identical world", () => {
    const one = advance(start(), N, cfg(ON));
    let chunked = start();
    const pattern = [1, 7, 3, 64, 2, 128, 11, 5, 22, 1];
    for (let done = 0, i = 0; done < N; i += 1) {
      const n = Math.min(pattern[i % pattern.length]!, N - done);
      chunked = advance(chunked, n, cfg(ON));
      done += n;
    }
    expect(chunked).toEqual(one);
    // Offline: the save, closed for three hours at Standard's live rate, caught up on load.
    const saved = Date.parse(AT);
    const away = secondsFor(N, ON) * 1000;
    const back = resume(toSave(start(), ON, AT), saved + away, cfg(ON));
    expect(back.state.steps - start().steps).toBe(N);
    expect(back.state).toEqual(one);
    // Not the agreement of nothing: cards of several kinds were dealt, resolved and left their marks. Measured: 5 events
    // of 3 kinds (a meteor, two outbreaks, a meteor, a discovery).
    const log = one.decisions.log;
    expect(log.length).toBeGreaterThanOrEqual(5);
    expect(new Set(log.map((r) => r.kind)).size).toBeGreaterThanOrEqual(3);
    expect(log.some((r) => r.outcome.people !== 0 || r.outcome.hit > 0)).toBe(true);
  });

  it("deals each card at the sim-year the seed says, and another seed deals others", () => {
    const one = advance(start(), N, cfg(ON));
    for (const r of one.decisions.log) expect(cardAt(start().seed, r.id, ON)).toBe(r.opened);
    const reseeded = advance({ ...start(), seed: start().seed + 1 }, N, cfg(ON));
    expect(reseeded.decisions.log.map((r) => r.opened)).not.toEqual(one.decisions.log.map((r) => r.opened));
  });

  it("stays the same chunked any way with the player's answers, given at the same moments", () => {
    // Played a substep at a time, answering every event as it opens with its first choice the world can pay.
    let live = start();
    const answers: { step: number; id: number; choice: string }[] = [];
    for (let i = 0; i < N; i += 1) {
      live = advance(live, 1, cfg(ON));
      for (const e of live.decisions.open) {
        if (e.chosen !== null || e.opened !== live.steps) continue;
        for (const c of decisionChoices(e, ON)) {
          const out = chooseDecision(live, e.id, c.id, ON);
          if (!out.ok) continue;
          live = out.state;
          answers.push({ step: live.steps, id: e.id, choice: c.id });
          break;
        }
      }
    }
    expect(answers.length).toBeGreaterThanOrEqual(4);
    // Some answer left something to count down: shelter, quarantine or a fault.
    expect(live.decisions.log.some((r) => ["shelter", "quarantine", "degraded"].includes(r.chosen ?? ""))).toBe(true);
    // The same answers at the same substeps, the time between them in ragged chunks.
    let replay = start();
    let k = 0;
    const pattern = [5, 1, 33, 2, 9];
    while (replay.steps < start().steps + N) {
      const next = k < answers.length ? answers[k]!.step : start().steps + N;
      while (replay.steps < next) replay = advance(replay, Math.min(pattern[replay.steps % pattern.length]!, next - replay.steps), cfg(ON));
      while (k < answers.length && answers[k]!.step === replay.steps) {
        const out = chooseDecision(replay, answers[k]!.id, answers[k]!.choice, ON);
        expect(out.ok).toBe(true);
        replay = out.state;
        k += 1;
      }
    }
    expect(replay).toEqual(live);
  });
});

// ---------------------------------------------------------------------------
// Each choice, measured through a real advance against the others
// ---------------------------------------------------------------------------

/** The event as the deck would make it in the town's city, opening now. */
function event(s: SimState, kind: DecisionKind, variant: DecisionVariant | null = null): OpenDecision {
  const e = cardFor(s, 9_999, kind, variant, cityOf(s), s.steps, QUIET);
  if (e === null) throw new Error(`no ${kind} can happen in the town`);
  return e;
}

/** The town with `e` open, answered with `choice` (or left: null), run `steps` substeps on. Null `e`: the town alone. */
function play(s: SimState, e: OpenDecision | null, choice: string | null, steps: number): SimState {
  let x: SimState = { ...s, decisions: { open: e === null ? [] : [e], log: [] } };
  if (e !== null && choice !== null) {
    const out = chooseDecision(x, e.id, choice, QUIET);
    if (!out.ok) throw new Error(`${choice}: ${out.reason}`);
    x = out.state;
  }
  return advance(x, steps, cfg(QUIET));
}

/** What a city made of each resource over the samples taken since `from`, per year summed over samples. */
function madeSince(from: SimState, to: SimState, r: (typeof MICRO_RESOURCES)[number]): number {
  const i = MICRO_RESOURCES.indexOf(r);
  const since = cityOf(from).history.taken;
  return cityOf(to).history.samples.filter((x) => x.index >= since).reduce((a, x) => a + (x.made?.[i] ?? 0), 0);
}
/** People born a year, summed over the samples begun after `from` (the one gathering then holds time before it). */
const birthsAfter = (from: SimState, to: SimState): { births: number; samples: number } => {
  const since = cityOf(from).history.taken;
  const after = cityOf(to).history.samples.filter((x) => x.index > since);
  return { births: after.reduce((a, x) => a + x.births, 0), samples: after.length };
};

/**
 * The measures "best" is judged on, at the deadline the outcome lands: the
 * bank, the people, the levels and buildings standing, the materials stored -
 * what the choices cost and what the events take or give - and, for what an
 * outcome leaves to run on, `extra` (a fault's output). Not every store: a
 * wrecked consumer saves its draw, which is no reason to be glad of it.
 */
function measures(s: SimState, extra: readonly number[] = []): number[] {
  const c = cityOf(s);
  return [s.economy.credits, c.population, levels(c), c.buildings.length, c.stores.materials, ...extra];
}
/** `a` is at least `b` in every measure and more in one (to a rounding's tolerance). */
function dominates(a: readonly number[], b: readonly number[]): boolean {
  const eps = 1e-9;
  return a.every((v, i) => v >= b[i]! - eps * Math.max(1, Math.abs(b[i]!))) && a.some((v, i) => v > b[i]! + eps * Math.max(1, Math.abs(b[i]!)));
}

/** The scripted town with a bank to answer from: the script spends its credits down to tens. */
function banked(): SimState {
  const s = world(100);
  return { ...s, economy: { ...s.economy, credits: 5000 } };
}

describe("each choice, measured through a real advance (Batch 33's gate)", () => {
  const town = banked;
  const toDeadline = (e: OpenDecision): number => e.deadline - e.opened;

  it("a meteor shower: shields cost their credits and spare everything; shelter stops materials; keeping working takes levels; the default takes more", () => {
    const e = event(town(), "meteor");
    const window = toDeadline(e) + substepsFor(ON.METEOR_SHELTER_SECONDS, ON) + 4;
    const control = play(town(), null, null, window);
    const shields = play(town(), e, "shields", window);
    const shelter = play(town(), e, "shelter", window);
    const work = play(town(), e, "work", window);
    const left = play(town(), e, null, window);
    expect(shields.economy.credits).toBeCloseTo(control.economy.credits - ON.METEOR_SHIELD_CREDITS, 6);
    expect(cityOf(shields).buildings).toEqual(cityOf(control).buildings);
    // Shelter: the city's buildings untouched, and over the samples while its people are under cover, no materials made.
    expect(cityOf(shelter).buildings).toEqual(cityOf(control).buildings);
    const atDeadline = play(town(), e, "shelter", toDeadline(e));
    const covered = play(town(), e, "shelter", toDeadline(e) + substepsFor(ON.METEOR_SHELTER_SECONDS, ON));
    const free = play(town(), null, null, toDeadline(e) + substepsFor(ON.METEOR_SHELTER_SECONDS, ON));
    expect(madeSince(atDeadline, free, "materials")).toBeGreaterThan(0);
    expect(madeSince(atDeadline, covered, "materials")).toBeLessThan(madeSince(atDeadline, free, "materials") * 0.5);
    // Keeping working: METEOR_HITS hits, each a level (a level-1 building wrecked). Measured: 3 levels, 2 buildings wrecked.
    const lost = levels(cityOf(control)) - levels(cityOf(work));
    expect(lost).toBeGreaterThanOrEqual(1);
    expect(lost).toBeLessThanOrEqual(ON.METEOR_HITS);
    expect(work.decisions.log[0]!.outcome.hit).toBeGreaterThan(0);
    expect(cityOf(control).buildings.length - cityOf(work).buildings.length).toBe(work.decisions.log[0]!.outcome.wrecked);
    // The default: the same hits and as many more - everything keeping working damaged is damaged at least as much.
    expect(levels(cityOf(left))).toBeLessThan(levels(cityOf(work)));
    for (const b of cityOf(left).buildings) {
      const w = cityOf(work).buildings.find((x) => x.tx === b.tx && x.ty === b.ty);
      expect(w, "a building the default left standing was wrecked by keeping working").toBeDefined();
      expect(b.level).toBeLessThanOrEqual(w!.level);
    }
    expect(left.decisions.log[0]!.chosen).toBeNull();
    const at = toDeadline(e);
    expect(dominates(measures(play(town(), e, "work", at)), measures(play(town(), e, null, at)))).toBe(true);
  });

  it("an equipment failure: repair costs its materials; degraded makes half; the default breaks it down", () => {
    const e = event(town(), "failure");
    const fault = substepsFor(ON.FAILURE_SECONDS, ON);
    const at = toDeadline(e);
    const before = play(town(), null, null, at);
    const runs = {
      control: play(town(), null, null, at + fault),
      repair: play(town(), e, "repair", at + fault),
      degraded: play(town(), e, "degraded", at + fault),
      left: play(town(), e, null, at + fault),
    };
    // Repairing costs the stated materials, at once.
    const s = { ...town(), decisions: { open: [e], log: [] } };
    expect(cityOf(chooseDecision(s, e.id, "repair", QUIET).state).stores.materials).toBe(cityOf(s).stores.materials - e.stake);
    // What the failing building's resource is made, measured from the city's record, the three runs against the town.
    // Over the first sample after the deadline the fault is all that differs: degraded loses FAILURE_DEGRADED of
    // what breaking down loses. Later the broken run's shortages brown out the providers of needs, the mood falls
    // and everything makes less (measured: the ratio 0.466 in most later samples) - a cascade, which is the point.
    const makes = BUILDING_DEFS[e.building!].produces(ON);
    const made = MICRO_RESOURCES.find((r) => (makes[r] ?? 0) > 0)!;
    const firstSample = (run: SimState): number => cityOf(run).history.samples.find((x) => x.index === cityOf(before).history.taken)!.made![MICRO_RESOURCES.indexOf(made)]!;
    const full = firstSample(runs.control);
    const half = firstSample(runs.degraded);
    const none = firstSample(runs.left);
    expect(full - none).toBeGreaterThan(0);
    expect((full - half) / (full - none)).toBeCloseTo(1 - ON.FAILURE_DEGRADED, 6);
    expect(firstSample(runs.repair)).toBe(full);
    // Over the whole fault, degraded between broken and whole.
    expect(madeSince(before, runs.degraded, made)).toBeLessThan(madeSince(before, runs.control, made));
    expect(madeSince(before, runs.degraded, made)).toBeGreaterThan(madeSince(before, runs.left, made));
    // The fault lasts its stated time: still there a substep before it is spent, gone once it is.
    expect(cityOf(play(town(), e, null, at + fault - 1)).effects.map((x) => x.kind)).toEqual(["fault"]);
    expect(cityOf(runs.left).effects).toEqual([]);
    expect(dominates(measures(play(town(), e, "degraded", at), [half]), measures(play(town(), e, null, at), [none]))).toBe(true);
  });

  it("an outbreak: medical capacity matters; treating, quarantine and the default lose what each says", () => {
    const e = event(town(), "outbreak");
    const c = cityOf(town());
    expect(e.stake).toBe(Math.round(ON.OUTBREAK_SHARE * c.population));
    const at = toDeadline(e);
    const control = play(town(), null, null, at);
    const lost = (choice: string | null): number => cityOf(control).population - cityOf(play(town(), e, choice, at)).population;
    expect(lost("treat")).toBeCloseTo(Math.round(e.stake * ON.OUTBREAK_TREATED), 6);
    expect(lost("quarantine")).toBeCloseTo(Math.round(e.stake * ON.OUTBREAK_QUARANTINED), 6);
    expect(lost(null)).toBeCloseTo(e.stake, 6);
    // The quarantine's stop: no one born while it lasts, where the treated city grows.
    const stop = substepsFor(ON.OUTBREAK_QUARANTINE_SECONDS, ON);
    const start = play(town(), e, "quarantine", at);
    const quarantined = birthsAfter(start, play(town(), e, "quarantine", at + stop));
    expect(quarantined.samples).toBeGreaterThanOrEqual(8);
    expect(quarantined.births).toBe(0);
    expect(birthsAfter(start, play(town(), e, "treat", at + stop)).births).toBeGreaterThan(0);
    expect(dominates(measures(play(town(), e, "quarantine", at)), measures(play(town(), e, null, at)))).toBe(true);
    // A Medical Center sheltering the city's people leaves far fewer at risk.
    const sheltered: Settlement = { ...c, buildings: [...c.buildings, { type: "medical_center", tx: 1, ty: 1, level: 1 }] };
    expect(outbreakAtRisk(sheltered, ON)).toBe(Math.round(ON.OUTBREAK_SHARE * Math.max(0, c.population - ON.MEDICAL_SHELTER)));
    expect(outbreakAtRisk(sheltered, ON)).toBeLessThan(e.stake);
  });

  it("a supply ship, early, late and lost: each choice lands its share of the cargo, the default less", () => {
    // The town given three Storage Depots more, so the cargo has room to land: its own store of 400 is full by the
    // deadline (measured; Batch 30 found a growing city's full from about 15 minutes in).
    const t0 = town();
    const roomy: SimState = { ...t0, settlements: t0.settlements.map((c, i) => (i === 0 ? { ...c, buildings: [...c.buildings, ...[0, 3, 6].map((x) => ({ type: "storage_depot" as const, tx: x, ty: 0, level: 1 }))], stores: { ...c.stores, materials: ON.SHIP_PAD_MATERIALS * 2 } } : c)) };
    const cases: { variant: DecisionVariant; choices: Record<string, number> }[] = [
      { variant: "early", choices: { pad: 1, rough: ON.SHIP_ROUGH } },
      { variant: "late", choices: { rush: 1, wait: ON.SHIP_WAIT } },
      { variant: "lost", choices: { search: ON.SHIP_FOUND, writeoff: 0 } },
    ];
    const unattended: Record<string, number> = { early: ON.SHIP_UNATTENDED_EARLY, late: ON.SHIP_UNATTENDED_LATE, lost: 0 };
    for (const { variant, choices } of cases) {
      const e = event(roomy, "ship", variant);
      const at = toDeadline(e);
      const control = play(roomy, null, null, at);
      const landed = (choice: string | null) => {
        const s = play(roomy, e, choice, at);
        return { materials: cityOf(s).stores.materials - cityOf(control).stores.materials, people: cityOf(s).population - cityOf(control).population, credits: s.economy.credits - control.economy.credits, s };
      };
      for (const [choice, share] of [...Object.entries(choices), ["", unattended[variant]!] as const]) {
        const got = landed(choice === "" ? null : choice);
        const cost = choice === "" ? { credits: 0, materials: 0 } : decisionChoices(e, ON).find((x) => x.id === choice)!;
        expect(got.materials, `${variant} ${choice || "default"}: materials`).toBeCloseTo(Math.floor(ON.SHIP_MATERIALS * share) - cost.materials, 6);
        expect(got.people, `${variant} ${choice || "default"}: settlers`).toBeCloseTo(Math.min(Math.floor(ON.SHIP_SETTLERS * share), 1e9), 6);
        const insurance = variant === "lost" && choice === "writeoff" ? ON.SHIP_INSURANCE_CREDITS : 0;
        expect(got.credits, `${variant} ${choice || "default"}: credits`).toBeCloseTo(insurance - cost.credits, 6);
      }
      const free = variant === "early" ? "rough" : variant === "late" ? "wait" : "writeoff";
      expect(dominates(measures(landed(free).s), measures(landed(null).s)), `${variant}: ${free} beats the default`).toBe(true);
    }
  });

  it("a discovery: studying pays its research, selling its price, and the default nothing", () => {
    const e = event(town(), "discovery", "meteorite");
    const at = toDeadline(e);
    const control = play(town(), null, null, at).economy.credits;
    const credits = (choice: string | null) => play(town(), e, choice, at).economy.credits - control;
    expect(credits("study")).toBeCloseTo(ON.DISCOVERY_RESEARCH_CREDITS - ON.DISCOVERY_STUDY_CREDITS, 6);
    expect(credits("sell")).toBeCloseTo(ON.DISCOVERY_SELL_CREDITS, 6);
    expect(credits(null)).toBeCloseTo(0, 6);
    expect(dominates(measures(play(town(), e, "sell", at)), measures(play(town(), e, null, at)))).toBe(true);
  });
});


describe("answering (Batch 33)", () => {
  const town = banked;
  const open = (s: SimState, e: OpenDecision): SimState => ({ ...s, decisions: { open: [e], log: [] } });

  it("pays a choice's cost when it is made, and refuses what cannot be paid, twice, or is not offered", () => {
    const e = event(town(), "meteor");
    const s = open(town(), e);
    const out = chooseDecision(s, e.id, "shields", ON);
    expect(out.ok).toBe(true);
    expect(out.state.economy.credits).toBe(s.economy.credits - ON.METEOR_SHIELD_CREDITS);
    expect(out.state.decisions.open[0]!.chosen).toBe("shields");
    expect(chooseDecision(out.state, e.id, "shelter", ON).reason).toMatch(/decided already/);
    expect(chooseDecision(s, e.id, "dance", ON).reason).toMatch(/offers no "dance"/);
    expect(chooseDecision(s, e.id + 1, "shelter", ON).reason).toMatch(/over/);
    const broke = { ...s, economy: { ...s.economy, credits: 10 } };
    expect(chooseDecision(broke, e.id, "shields", ON).reason).toMatch(/needs 150 credits; the bank holds 10/);
    expect(chooseDecision(s, e.id, "shields", OFF).reason).toMatch(/not part of this world/);
    // A refusal changes nothing.
    expect(chooseDecision(broke, e.id, "shields", ON).state).toBe(broke);
  });

  it("states every choice and the default in words with the event's own figures", () => {
    for (const kind of ["meteor", "failure", "outbreak", "ship", "discovery"] as const) {
      const e = event(town(), kind, kind === "ship" ? "late" : kind === "discovery" ? "ice" : null);
      const choices = decisionChoices(e, ON);
      expect(choices.length).toBeGreaterThanOrEqual(2);
      expect(choices.length).toBeLessThanOrEqual(3);
      for (const c of choices) expect(CHOICE_TITLES[c.id]).toBe(c.title);
      expect(defaultWords(e, ON).length).toBeGreaterThan(10);
    }
    const outbreak = event(town(), "outbreak");
    expect(decisionChoices(outbreak, ON).find((c) => c.id === "quarantine")!.words).toContain(`${Math.round(outbreak.stake * ON.OUTBREAK_QUARANTINED)} people lost`);
  });

  it("keeps an open event, its answer and what it left on the city through a save, exactly", () => {
    const e = event(town(), "failure");
    const chosen = chooseDecision(open(town(), e), e.id, "degraded", QUIET).state;
    const mid = advance(chosen, toDeadlineOf(e) + 5, cfg(QUIET));
    expect(cityOf(mid).effects.length).toBe(1);
    const back = fromSave(JSON.parse(JSON.stringify(toSave(mid, QUIET, AT))), QUIET);
    expect(back).toEqual(mid);
    expect(advance(back, 90, cfg(QUIET))).toEqual(advance(mid, 90, cfg(QUIET)));
    // And with one still open and answered.
    expect(fromSave(JSON.parse(JSON.stringify(toSave(chosen, QUIET, AT))), QUIET)).toEqual(chosen);
  });

  it("loads a save from before it (v17): no event, nothing on any city", () => {
    const s = town();
    const v18 = toSave(s, OFF, AT) as unknown as Record<string, unknown>;
    const v17: Record<string, unknown> = { ...v18, schema_version: 17, settlements: (v18["settlements"] as Record<string, unknown>[]).map((raw) => {
      const { effects: _gone, ...rest } = raw;
      return rest;
    }) };
    delete v17["decisions"];
    // Nor Earth (v19, Batch 34): a world from before it loads with Earth as a world starts it.
    delete v17["earth"];
    const loaded = fromSave(v17, OFF);
    expect({ ...loaded, earth: s.earth }).toEqual(s);
    expect(loaded.decisions).toEqual({ open: [], log: [] });
    expect(loaded.earth).toEqual(emptyEarth(OFF));
  });
});

const toDeadlineOf = (e: OpenDecision): number => e.deadline - e.opened;
