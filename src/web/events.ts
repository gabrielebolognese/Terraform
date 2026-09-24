/**
 * The event feed - §7's milestones, noticed as they happen.
 *
 * §7's phases are "the backbone of visible growth", and §0.3 warns that
 * terraforming games fail when progress becomes an abstraction. A number that
 * quietly ticks past 273 K is an abstraction; a line that says the ice has
 * started melting is an event.
 *
 * Everything here is DERIVED from watching state cross a threshold. Nothing is
 * scripted and nothing is stored in the save: the feed is a view of the
 * simulation, so it cannot drift from it, and a reloaded game simply starts a
 * fresh feed rather than replaying a stale one.
 *
 * Deliberately not in `src/sim/`. These are presentation decisions - which
 * crossings are worth a line, and what the line says - and the simulation has
 * no business holding them.
 */

import type { Derived, Phase, Reservoirs, SimState, Tuning } from "../sim/index.js";
import { PHASE_INFO, TARGETS, activeEvents, describeEvent } from "../sim/index.js";

export type EventTone = "milestone" | "warning" | "note";

export interface GameEvent {
  readonly year: number;
  readonly text: string;
  readonly tone: EventTone;
  /**
   * The big beats. §7 calls Phase 2 "the 'it's happening' moment", and the
   * shell gives those a transition banner rather than just a feed line.
   */
  readonly headline: boolean;
}

export interface EventSnapshot {
  readonly year: number;
  readonly state: SimState;
  readonly reservoirs: Reservoirs;
  readonly derived: Derived;
  readonly phaseReached: Phase;
  /** Present once §12.2's seeded events are enabled. Omitted, nothing weather-related is reported. */
  readonly tuning?: Tuning;
}

/** One watched crossing. */
interface Watch {
  readonly id: string;
  /** True once the thing has happened. */
  readonly test: (s: EventSnapshot) => boolean;
  readonly text: (s: EventSnapshot) => string;
  readonly tone: EventTone;
  readonly headline: boolean;
}

const WATCHES: readonly Watch[] = [
  {
    id: "first-melt",
    test: (s) => s.derived.oceanFrac > 0,
    text: () => "The first liquid water in three billion years is standing on the surface.",
    tone: "milestone",
    headline: true,
  },
  {
    id: "seeded",
    test: (s) => s.state.seeded,
    text: () => "Cyanobacteria released. Something is alive down there.",
    tone: "milestone",
    headline: true,
  },
  {
    id: "temp-habitable",
    test: (s) => s.derived.T >= TARGETS.T.min,
    text: (s) => `Mean temperature has passed ${TARGETS.T.min} K - above freezing, planet-wide.`,
    tone: "milestone",
    headline: false,
  },
  {
    id: "temp-target",
    test: (s) => s.derived.T >= TARGETS.T.target,
    text: () => `Mean temperature has reached the Earth-like target of ${TARGETS.T.target} K.`,
    tone: "milestone",
    headline: false,
  },
  {
    id: "pressure-habitable",
    test: (s) => s.derived.P >= TARGETS.P.min,
    text: () => `Surface pressure has passed ${TARGETS.P.min} mbar - thick enough to hold liquid water.`,
    tone: "milestone",
    headline: false,
  },
  {
    id: "pressure-target",
    test: (s) => s.derived.P >= TARGETS.P.target,
    text: () => "Surface pressure has reached one bar.",
    tone: "milestone",
    headline: false,
  },
  {
    id: "ocean-band",
    test: (s) => s.derived.oceanFrac >= TARGETS.ocean.bandLo,
    text: (s) => `Oceans now cover ${(s.derived.oceanFrac * 100).toFixed(0)}% of the surface.`,
    tone: "milestone",
    headline: false,
  },
  {
    id: "o2-climbing",
    test: (s) => s.reservoirs.o2 >= 1,
    text: () => "Free oxygen is accumulating in the atmosphere.",
    tone: "note",
    headline: false,
  },
  {
    id: "o2-breathable",
    test: (s) => s.reservoirs.o2 >= TARGETS.o2.min,
    text: () => `Oxygen has passed ${TARGETS.o2.min} mbar. The air is breathable.`,
    tone: "milestone",
    headline: true,
  },
  {
    id: "co2-safe",
    // Strict, like the Phase 6 gate: at exactly the limit the win is not granted, so
    // neither is this (Batch 13).
    test: (s) => s.reservoirs.co2_atm < TARGETS.co2_atm.toxMax && s.reservoirs.o2 > 1,
    text: () => `Carbon dioxide is below the ${TARGETS.co2_atm.toxMax} mbar toxicity limit.`,
    tone: "milestone",
    headline: false,
  },
  {
    id: "biosphere-established",
    test: (s) => s.reservoirs.biomass >= TARGETS.biomass.min,
    text: () => "The biosphere is self-sustaining.",
    tone: "milestone",
    headline: false,
  },
  {
    id: "ocean-flood",
    test: (s) => s.derived.oceanFrac > TARGETS.ocean.bandHi,
    text: (s) =>
      `Oceans cover ${(s.derived.oceanFrac * 100).toFixed(0)}% - past the top of the target band. ` +
      "Too much water is as far from Earth-like as too little.",
    tone: "warning",
    headline: false,
  },
  {
    id: "overheating",
    test: (s) => s.derived.T > TARGETS.T.target + 10,
    text: (s) => `Mean temperature is ${s.derived.T.toFixed(0)} K, well over target. The planet is overshooting.`,
    tone: "warning",
    headline: false,
  },
];

/**
 * Watches the world and emits a line when something crosses.
 *
 * Latching, not sampling: each watch fires once and never again, so a quantity
 * wobbling across its threshold cannot spam the feed. The cost is that a
 * milestone lost again is not announced - deliberately, because "the oceans
 * have retreated below 30%" is a warning about a trend, not a milestone, and
 * the warning watches cover that case on their own terms.
 */
export class EventLog {
  private readonly fired = new Set<string>();
  private lastPhase: Phase | null = null;
  private readonly entries: GameEvent[] = [];

  constructor(private readonly capacity = 60) {}

  /** Feed the current world; returns any events that are new this call. */
  observe(snapshot: EventSnapshot): readonly GameEvent[] {
    const fresh: GameEvent[] = [];

    // Phase changes first, so "Runaway thickening" lands above the individual
    // crossings that triggered it rather than under them.
    if (this.lastPhase === null) {
      this.lastPhase = snapshot.phaseReached;
    } else if (snapshot.phaseReached > this.lastPhase) {
      for (let p = this.lastPhase + 1; p <= snapshot.phaseReached; p += 1) {
        const info = PHASE_INFO[p as Phase];
        if (info === undefined) continue;
        fresh.push({
          year: snapshot.year,
          text: `Phase ${p}: ${info.name}. ${info.caption}`,
          tone: "milestone",
          // §7 names Phase 2 the "it's happening" moment; every phase entry is
          // a beat, but that one is the one the doc singles out.
          headline: true,
        });
      }
      this.lastPhase = snapshot.phaseReached;
    }

    /**
     * Weather, from §12.2's seeded events.
     *
     * Reported differently from everything else in this file. A milestone is
     * latched - it happens once and is true forever - but a dust storm happens
     * again and again, so it is keyed on the event's START YEAR instead. That
     * fires each storm exactly once while still letting the hundredth storm be
     * reported, which a `fired` set keyed on the kind would not.
     */
    if (snapshot.tuning !== undefined) {
      for (const event of activeEvents(snapshot.state.seed, snapshot.year, snapshot.tuning)) {
        const id = `${event.kind}@${event.start.toFixed(4)}`;
        if (this.fired.has(id)) continue;
        this.fired.add(id);
        fresh.push({
          year: snapshot.year,
          text: describeEvent(event, snapshot.tuning),
          // A storm is weather, not a setback: it is a "note" unless it is a
          // big one, and never a milestone.
          tone: event.magnitude > 0.67 ? "warning" : "note",
          headline: false,
        });
      }
    }

    for (const watch of WATCHES) {
      if (this.fired.has(watch.id)) continue;
      if (!watch.test(snapshot)) continue;
      this.fired.add(watch.id);
      fresh.push({
        year: snapshot.year,
        text: watch.text(snapshot),
        tone: watch.tone,
        headline: watch.headline,
      });
    }

    for (const event of fresh) {
      this.entries.unshift(event);
    }
    if (this.entries.length > this.capacity) this.entries.length = this.capacity;

    return fresh;
  }

  /** Newest first. */
  get log(): readonly GameEvent[] {
    return this.entries;
  }

  clear(): void {
    this.fired.clear();
    this.entries.length = 0;
    this.lastPhase = null;
  }
}
