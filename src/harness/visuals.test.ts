/**
 * §9's continuity claim, checked against a real trajectory.
 *
 * "All of these are continuous functions of continuous state, which is what
 * makes the growth look slow and alive rather than snapping between discrete
 * looks at phase boundaries. Phases change tech and UI; the visuals move
 * continuously underneath them."
 *
 * The unit tests in src/sim/visuals.test.ts sweep each input and bound the
 * step. This one asks the question the design cares about: over an actual
 * playthrough, does anything happen to the picture AT a phase boundary?
 *
 * The comparison is deliberately LOCAL. Phase 2 lands at sim-year 18, in the
 * middle of the cap ignition, so the deltas around it are legitimately among
 * the largest in the run - comparing them to a run-wide median would fail for
 * the right reasons and prove nothing. What must not happen is a delta that
 * stands out from its own immediate neighbourhood.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_TUNING, VISUAL_TUNING, makeTuning } from "../sim/index.js";
import { REFERENCE_POLICY } from "./policy.js";
import { runTrajectory } from "./run.js";
import type { RunResult } from "./run.js";

const t = DEFAULT_TUNING;

/** One sim-year, so a single-substep step cannot hide inside a sample interval. */
const EVERY = 1;
const run: RunResult = runTrajectory(REFERENCE_POLICY, 2000, EVERY, t);

/** The channels a renderer actually draws. */
const CHANNELS = [
  "capRadius",
  "oceanFrac",
  "vegFrac",
  "atmoThickness",
  "cloudFrac",
  "dustIntensity",
  "skyR",
  "skyG",
  "skyB",
  "tintR",
  "tintG",
  "tintB",
] as const;

type Channel = (typeof CHANNELS)[number];

/**
 * What each channel is a function OF.
 *
 * §9 promises the visuals are "continuous functions of continuous state". The
 * model has exactly one discontinuous state change - ecopoiesis, which §3.5
 * and §5 both define as a one-shot edit that "sets biomass to a small positive
 * value" rather than a rate - and a channel faithfully following a step in its
 * input is the contract working, not failing. So a channel is only in trouble
 * if it jumps when its DRIVER did not.
 */
const DRIVER: Readonly<Record<Channel, (s: RunResult["samples"][number]) => number>> = {
  capRadius: (s) => s.iceFrac,
  oceanFrac: (s) => s.h2o_liq,
  vegFrac: (s) => s.biomass,
  atmoThickness: (s) => s.P,
  cloudFrac: (s) => s.h2o_vap,
  // Dust is a function of the RELEASE RATE, not of a reservoir level - which
  // is the whole reason §9 sources it from "rate of co2 release" and the
  // reason rate contributions are flows carrying an id. A reservoir level is
  // smooth exactly where the rate off it is not: the cap term collapses over
  // the last 2 mbar of an `avail` ramp while `co2_cap` itself glides to zero.
  dustIntensity: (s) => s.releaseRate,
  skyR: (s) => s.clearFraction,
  skyG: (s) => s.clearFraction,
  skyB: (s) => s.clearFraction,
  tintR: (s) => s.T,
  tintG: (s) => s.T,
  tintB: (s) => s.T,
};

function seriesOf(channel: Channel): readonly number[] {
  return run.samples.map((s) => s[channel]);
}

function deltas(values: readonly number[]): readonly number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) out.push(Math.abs((values[i] ?? 0) - (values[i - 1] ?? 0)));
  return out;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/**
 * How much of a channel's range may change per REAL minute.
 *
 * This is the criterion §0 and §9 actually state, in the units they state it
 * in: "visible change to the planet at least every few real minutes" is the
 * lower bound, and "rather than snapping between discrete looks" is this
 * upper one.
 *
 * An earlier version compared each delta to a local median instead, which
 * turned out to be a SMOOTHNESS test rather than a continuity one - it flagged
 * `dustIntensity` coming off its clamp at year 106, where the value is
 * perfectly continuous but the derivative has a corner. Every channel is
 * `clamp01`, so every channel saturates, so that test would eventually have
 * flagged all of them.
 *
 * At TIME_SCALE 0.03 one sim-year is 0.56 real minutes, so this allows a
 * channel to cross about 14% of its range between samples. The dust fade the
 * old test caught is 9%/min; a genuine step - the whole channel in one substep
 * - is above 400%/min.
 */
const MAX_CHANGE_PER_REAL_MINUTE = 0.25;

function realMinutesPerSample(): number {
  return EVERY / t.TIME_SCALE / 60;
}

function anomalous(delta: number, _neighbourhood: number): boolean {
  return delta / realMinutesPerSample() > MAX_CHANGE_PER_REAL_MINUTE;
}

/** Reported alongside a snap, so a failure shows how far the step stands out from its neighbours. */
function localMedian(steps: readonly number[], index: number): number {
  return median(steps.slice(Math.max(0, index - 10), Math.min(steps.length, index + 11)));
}

/**
 * Did the channel's INPUT jump at step `i`? Batch 5's rule: the step against
 * the driver's span over the whole run.
 *
 * Batch 12 added a second, "local" reading - a driver step 20x its local
 * median also counted as a jump - because this rule's verdict about a comet at
 * year 7 depended on the vapour peak in year 1621 under a rebalance that was
 * never shipped. Batch 13's review showed the local reading excused channel
 * snaps of any size whenever the driver moved just 1-2% of its span: eleven
 * injected hidden thresholds (clouds at year 33, dust at 405-407, tint at 310,
 * among others) that this rule catches, it let through. It was removed.
 *
 * The trade is deliberate. A span measured over the whole run can make a
 * future rebalance trip a false alarm here, and a false alarm gets
 * investigated - Batch 12 did exactly that. A false pass on the gate that
 * guards §0.3 does not get noticed at all.
 */
function driverJumped(driverSteps: readonly number[], i: number, driverSpan: number): boolean {
  return Math.abs(driverSteps[i] ?? 0) / driverSpan / realMinutesPerSample() > MAX_CHANGE_PER_REAL_MINUTE;
}

interface Snap {
  readonly year: number;
  readonly delta: number;
  readonly local: number;
}

/**
 * Every place a channel jumps without its driver jumping.
 *
 * Scanned across the WHOLE run, not only at phase boundaries. Boundaries are
 * where §9 says a snap would be most visible, but they are not where one would
 * necessarily occur: the visuals do not read phase, so a threshold hidden in a
 * mapping fires at whatever state value crosses it. Checking boundaries alone
 * let an injected `iceFrac > 0.1 ? r : 0` through untouched.
 */
function unexplainedSnaps(channel: Channel): readonly Snap[] {
  const steps = deltas(seriesOf(channel));
  const driverValues = run.samples.map(DRIVER[channel]);
  const driverSteps = deltas(driverValues);
  const driverSpan = Math.max(...driverValues) - Math.min(...driverValues) || 1;

  const found: Snap[] = [];
  // From 0: `steps[0]` is the move from year 0 to year 1, where the opening
  // facility orders land. Starting at 1 left it unchecked in both scans until
  // Batch 13 - a +0.9 dust snap there passed.
  for (let i = 0; i < steps.length; i += 1) {
    const delta = steps[i] ?? 0;
    const local = localMedian(steps, i);
    if (!anomalous(delta, local)) continue;

    // The channel jumped. That is only a contract violation if its input did
    // not - otherwise the visuals are faithfully following a step the STATE
    // took, which is what ecopoiesis is.
    if (!driverJumped(driverSteps, i, driverSpan)) found.push({ year: run.samples[i]?.year ?? -1, delta, local });
  }
  return found;
}

describe("nothing in the picture snaps", () => {
  it("crosses every phase during the run, so there is something to check", () => {
    expect(run.phaseTimes.filter((y) => y !== null && y > 0).length).toBeGreaterThanOrEqual(5);
  });

  for (const channel of CHANNELS) {
    it(`${channel} never jumps without its driver jumping`, () => {
      const snaps = unexplainedSnaps(channel);
      const described = snaps
        .slice(0, 3)
        .map(
          (s) =>
            `year ${s.year}: moved ${s.delta.toFixed(4)} of its range in ` +
            `${realMinutesPerSample().toFixed(2)} real minutes`,
        )
        .join("; ");
      expect(snaps.length, `${channel} snapped ${snaps.length} time(s) - ${described}`).toBe(0);
    });
  }

  it("and in particular nothing happens AT a phase boundary", () => {
    // §9's own framing. Subsumed by the scan above, kept because it is the
    // claim the design doc actually makes.
    for (const channel of CHANNELS) {
      const boundaryYears = run.phaseTimes.filter((y): y is number => y !== null && y > 0);
      const snapYears = new Set(unexplainedSnaps(channel).map((s) => s.year));
      for (const year of boundaryYears) {
        expect(snapYears.has(year), `${channel} snapped at the phase boundary at year ${year}`).toBe(false);
      }
    }
  });

  it("the one discontinuity in the run is ecopoiesis, and it comes from the state", () => {
    /**
     * Seeding is the model's single discrete state change - §3.5 and §5 both
     * define it as a one-shot edit that "sets biomass to a small positive
     * value" rather than a rate. The green pop that follows is the contract
     * working: a continuous function of a discontinuous input.
     */
    // The claim is a STEP, not a statistical outlier: biomass is exactly zero
    // and then it is not. The step does not stand out from its neighbourhood,
    // because the growth immediately after is just as fast - which is the
    // happy finding here, since it means the green arrives without a pop.
    const index = run.samples.findIndex((s) => s.biomass > 0);
    expect(index).toBeGreaterThan(0);
    expect(run.samples[index - 1]?.biomass).toBe(0);

    // It happens when the policy asked for it, not at a phase boundary.
    const seededAt = run.samples[index]?.year ?? -1;
    expect(seededAt).toBeGreaterThanOrEqual(REFERENCE_POLICY.seedAt);
    expect(seededAt).toBeLessThan(REFERENCE_POLICY.seedAt + 5);

    // Biomass STEPS off zero - straight to the seeded amount in one sample.
    expect(run.samples[index]?.biomass ?? 0).toBeGreaterThanOrEqual(t.SEED_AMOUNT);

    // Liquid water also leaves zero during the run, but it CREEPS off it as
    // the first ice melts. Distinguishing the two is the whole point: a
    // quantity growing continuously from nothing is not a discontinuity.
    const firstWet = run.samples.findIndex((s) => s.h2o_liq > 0);
    const finalWater = run.samples[run.samples.length - 1]?.h2o_liq ?? 1;
    expect(firstWet).toBeGreaterThan(0);
    expect((run.samples[firstWet]?.h2o_liq ?? 0) / finalWater).toBeLessThan(0.01);
  });
});

describe("the channels move over the whole run", () => {
  it("every scalar channel actually changes, or the contract is decorative", () => {
    // A channel pinned at a constant would pass every continuity test ever
    // written and show the player nothing.
    for (const channel of ["capRadius", "oceanFrac", "vegFrac", "atmoThickness", "cloudFrac", "dustIntensity"] as const) {
      const values = seriesOf(channel);
      expect(Math.max(...values) - Math.min(...values), `${channel} never moves`).toBeGreaterThan(0.01);
    }
  });

  it("both colours travel, judged as colours rather than per component", () => {
    /**
     * Per-component is the wrong unit for a colour. The surface tint runs
     * frost-blue to warm-neutral, and it does that by RAISING red and green
     * while leaving blue almost alone - so its blue component moves 0.007
     * across the whole run while the colour itself clearly changes. Asserting
     * on components would have demanded a palette that shifts blue for no
     * reason other than to satisfy a test.
     */
    const travel = (get: (s: RunResult["samples"][number]) => readonly [number, number, number]): number => {
      const first = get(run.samples[0]!);
      const last = get(run.samples[run.samples.length - 1]!);
      return Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]);
    };
    expect(travel((s) => [s.skyR, s.skyG, s.skyB]), "the sky never travels").toBeGreaterThan(0.2);
    expect(travel((s) => [s.tintR, s.tintG, s.tintB]), "the tint never travels").toBeGreaterThan(0.1);
  });

  it("no channel leaves 0..1 anywhere in a real run", () => {
    for (const channel of CHANNELS) {
      for (const value of seriesOf(channel)) {
        expect(value, `${channel} left range`).toBeGreaterThanOrEqual(0);
        expect(value, `${channel} left range`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("the sky really does travel butterscotch to blue", () => {
    const first = run.samples[0];
    const last = run.samples[run.samples.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    // Starts warm-dominant and near-vacuum dark; ends blue-dominant.
    expect((first?.skyR ?? 0) - (first?.skyB ?? 0)).toBeGreaterThan(0);
    expect((last?.skyB ?? 0) - (last?.skyR ?? 0)).toBeGreaterThan(0);
  });

  it("the caps retreat and the ocean arrives, in that order", () => {
    const capAt = (year: number): number => run.samples.find((s) => s.year >= year)?.capRadius ?? 0;
    const oceanAt = (year: number): number => run.samples.find((s) => s.year >= year)?.oceanFrac ?? 0;
    expect(capAt(0)).toBeGreaterThan(capAt(400));
    expect(oceanAt(400)).toBeGreaterThan(oceanAt(0));
  });

  it("dust peaks during the thickening, not at the end", () => {
    // §9: "particle/haze bursts during rapid thickening (phase 2)".
    const peakYear =
      run.samples.reduce((best, s) => (s.dustIntensity > best.dustIntensity ? s : best), run.samples[0]!).year;
    const phase3 = run.phaseTimes[3] ?? Infinity;
    expect(peakYear).toBeLessThan(phase3);
  });
});

/**
 * The same contract, with §12.2's weather running.
 *
 * THE CONFLICT, STATED. A dust storm takes the dust channel from 0 to ~0.9 in
 * about a sim-year, which at TIME_SCALE 0.03 is 1.9 of its range per real
 * minute - roughly eight times the bound above. Making a storm slow enough to
 * satisfy that bound would mean stretching it to about twenty-two sim-years,
 * which is not a storm, it is a climate.
 *
 * THE RESOLUTION IS THE TEST'S OWN RULE, not an exemption. The bound above was
 * never "no channel may move fast"; it is "no channel may move faster than its
 * DRIVER", which is why `unexplainedSnaps` takes a driver per channel. §0.3's
 * failure mode is a mapping with a hidden threshold in it, and weather is not
 * that: a storm is a raised cosine in time, continuous and with a continuous
 * first derivative, and the dust channel follows it faithfully.
 *
 * So the only thing that changes here is that the storm joins dust's driver.
 * If the MAPPING ever snaps, this still catches it - which the injection note
 * in the Batch 8 doc records.
 */
describe("nothing in the picture snaps, with weather running", () => {
  const stormy = makeTuning({ EVENTS_ENABLED: 1 });
  const stormyRun = runTrajectory(REFERENCE_POLICY, 2000, EVERY, stormy);

  /** The same normaliser `deriveVisuals` uses, so the two driver terms are comparable. */
  const DUST_DRIVER_REF = VISUAL_TUNING.DUST_RELEASE_REF;

  const STORMY_DRIVER: Readonly<Record<Channel, (s: RunResult["samples"][number]) => number>> = {
    ...DRIVER,
    /**
     * Dust now has two drivers, so the composite is what it must follow -
     * and the composite is CLAMPED, because that is literally the argument
     * `deriveVisuals` applies: `clamp01(release/REF + storm) * (1 - ocean)`.
     *
     * Leaving it unclamped made the driver's span the early outgassing
     * transient, which is many times its own reference, so a storm moving
     * half the channel registered as a rounding error against it and 61
     * perfectly explained storms were reported as snaps.
     */
    dustIntensity: (s) => Math.min(1, s.releaseRate / DUST_DRIVER_REF + s.stormDust),
  };

  function stormySnaps(channel: Channel): readonly { year: number; delta: number }[] {
    const series = stormyRun.samples.map((s) => s[channel]);
    const steps = deltas(series);
    const driverValues = stormyRun.samples.map(STORMY_DRIVER[channel]);
    const driverSteps = deltas(driverValues);
    const driverSpan = Math.max(...driverValues) - Math.min(...driverValues) || 1;

    const found: { year: number; delta: number }[] = [];
    // From 0: `steps[0]` is the move from year 0 to year 1, where the opening
  // facility orders land. Starting at 1 left it unchecked in both scans until
  // Batch 13 - a +0.9 dust snap there passed.
  for (let i = 0; i < steps.length; i += 1) {
      const delta = steps[i] ?? 0;
      if (delta / realMinutesPerSample() <= MAX_CHANGE_PER_REAL_MINUTE) continue;
      if (!driverJumped(driverSteps, i, driverSpan)) found.push({ year: stormyRun.samples[i]?.year ?? -1, delta });
    }
    return found;
  }

  it("actually has weather in it, or this proves nothing", () => {
    const stormed = stormyRun.samples.filter((s) => s.stormDust > 0.1).length;
    expect(stormed, "no storms in the whole run").toBeGreaterThan(20);
    expect(Math.max(...stormyRun.samples.map((s) => s.stormDust))).toBeGreaterThan(0.5);
  });

  for (const channel of CHANNELS) {
    it(`${channel} still never jumps without its driver jumping`, () => {
      const snaps = stormySnaps(channel);
      const described = snaps
        .slice(0, 3)
        .map((s) => `year ${s.year}: moved ${s.delta.toFixed(4)} of its range`)
        .join("; ");
      expect(snaps.length, `${channel} snapped ${snaps.length} time(s) with weather - ${described}`).toBe(0);
    });
  }

  it("leaves the storm itself smooth, not a step", () => {
    // The envelope is a raised cosine, so consecutive samples of a storm can
    // never differ by the whole thing however the run is sampled.
    const steps = deltas(stormyRun.samples.map((s) => s.stormDust));
    expect(Math.max(...steps.map(Math.abs))).toBeLessThan(0.8);
  });
});
