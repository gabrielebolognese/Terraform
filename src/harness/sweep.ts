/**
 * The balance sweep.
 *
 * `npm run sim:sweep -- --axis M_PHOTO --values 0.05,0.1,0.25`
 * `npm run sim:sweep -- --candidates`
 *
 * Build-order step 2: "this is where the game is actually balanced, before any
 * pixels exist". Every variant runs BOTH trajectories and is scored on both -
 * see score.ts for why the null-policy control is the one that matters.
 *
 * Variants are a parameter, not a module reload, because tuning is a frozen
 * object threaded through calls. That was the whole point of building it that
 * way in Batch 1.
 */

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import type { Reservoirs, Tuning, TuningOverrides } from "../sim/index.js";
import { DEFAULT_TUNING, makeTuning } from "../sim/index.js";
import { NULL_POLICY, REFERENCE_POLICY } from "./policy.js";
import { runTrajectory } from "./run.js";
import type { PacingScore } from "./score.js";
import { formatScore, score } from "./score.js";

export interface Variant {
  readonly label: string;
  readonly tuning?: TuningOverrides;
  readonly start?: Partial<Reservoirs>;
  /** Why this variant exists. Printed with the result so a sweep reads as an argument. */
  readonly rationale?: string;
}

export interface VariantResult {
  readonly label: string;
  readonly rationale: string;
  readonly tuning: Tuning;
  readonly score: PacingScore;
}

const SWEEP_YEARS = 4000;
/**
 * Sampling interval for scored runs.
 *
 * Fine enough that the stall detector can resolve the 5 real-minute limit: at
 * TIME_SCALE 0.025 that limit is 7.5 sim-years, so a 2-year sample spacing
 * gives roughly four samples inside it. Sampling does not change the
 * trajectory - the substep grid is fixed - only what the scorer can see.
 */
const SWEEP_EVERY = 2;

export function evaluate(variant: Variant, years = SWEEP_YEARS, every = SWEEP_EVERY): VariantResult {
  const tuning = makeTuning(variant.tuning ?? {});
  const start = variant.start ?? {};
  const reference = runTrajectory(REFERENCE_POLICY, years, every, tuning, start);
  const nullRun = runTrajectory(NULL_POLICY, years, every, tuning, start);
  return {
    label: variant.label,
    rationale: variant.rationale ?? "",
    tuning,
    score: score(reference, nullRun, tuning),
  };
}

export function sweep(variants: readonly Variant[], years = SWEEP_YEARS): readonly VariantResult[] {
  return variants.map((v) => evaluate(v, years));
}

/** One-dimensional sweep over a single tuning constant, for finding where a knob bites. */
export function axisVariants(key: keyof Tuning, values: readonly number[]): readonly Variant[] {
  return values.map((value) => ({
    label: `${key}=${value}`,
    tuning: { [key]: value } as TuningOverrides,
  }));
}

function report(results: readonly VariantResult[]): void {
  const ranked = [...results].sort((a, b) => b.score.total - a.score.total);
  for (const r of ranked) {
    console.log("");
    console.log(formatScore(r.label, r.score));
    if (r.rationale !== "") console.log(`  why: ${r.rationale}`);
    const m = r.score.metrics;
    console.log(
      `  phases: ${m.phaseYears.map((y, i) => (y === null ? `${i}:-` : `${i}:${y.toFixed(0)}`)).join(" ")}`,
    );
    console.log(
      `  carbon: ${m.carbon.total.toFixed(1)} total, ${m.carbon.fixedInBiosphere.toFixed(1)} fixed, ` +
        `${m.carbon.lostToSpace.toFixed(1)} lost, ${m.carbon.sequestered.toFixed(1)} sequestered, ` +
        `${m.carbon.inReservoirs.toFixed(2)} left (oxygen target costs ${m.carbon.costOfOxygenTarget.toFixed(1)})`,
    );
  }
  console.log("");
  console.log("ranking:");
  ranked.forEach((r, i) => {
    console.log(`  ${(i + 1).toString().padStart(2)}. ${r.score.total.toFixed(4)}  ${r.label}`);
  });
}

function main(): void {
  const { values } = parseArgs({
    options: {
      axis: { type: "string" },
      values: { type: "string" },
      years: { type: "string", default: String(SWEEP_YEARS) },
      candidates: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const years = Number(values.years);
  if (!Number.isFinite(years) || years <= 0) throw new RangeError("--years must be a positive number");

  const started = process.hrtime.bigint();

  if (values.axis !== undefined) {
    const raw = values.values;
    if (raw === undefined) throw new RangeError("--axis requires --values");
    const parsed = raw.split(",").map((v) => {
      const n = Number(v.trim());
      if (!Number.isFinite(n)) throw new RangeError(`--values entry "${v}" is not a number`);
      return n;
    });
    const key = values.axis as keyof Tuning;
    if (!(key in DEFAULT_TUNING)) throw new RangeError(`--axis "${values.axis}" is not a tuning constant`);
    console.log(`sweeping ${values.axis} over ${parsed.join(", ")} (${years} sim-years each)`);
    report(sweep([{ label: "baseline", rationale: "the shipped table" }, ...axisVariants(key, parsed)], years));
  } else {
    console.log(`scoring ${CANDIDATES.length} candidate tunings (${years} sim-years each)`);
    report(sweep(CANDIDATES, years));
  }

  console.log(`\n(${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s)`);
}

/**
 * Hand-designed candidates.
 *
 * Coordinate sweeps say where a knob bites; these say whether a combination
 * actually lands. Each one is an argument, and its `rationale` is the argument.
 */
export const CANDIDATES: readonly Variant[] = [
  { label: "baseline", rationale: "the shipped table, for comparison" },
  {
    label: "A: b*=0.85",
    rationale: "b* = 1 - M_PHOTO/R_BIO, so R_BIO 0.15->0.333 puts the biomass fixed point at 0.85, past the 0.8 target",
    tuning: { R_BIO: 0.333 },
  },
  {
    label: "B: b*=0.85, 1.5x pump",
    rationale: "same fixed point, faster: raising both keeps the ratio and shortens the oxygen tail",
    tuning: { R_BIO: 0.5, M_PHOTO: 0.075 },
  },
  {
    label: "C: b*=0.85, 2.2x pump",
    rationale: "faster still - finding where the tail stops being the longest phase",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11 },
  },
  {
    label: "D: C + carbon slack",
    rationale: "306 mbar leaves 17 after the oxygen target; the scrubber alone spends 18. 346 gives the player room to be wrong",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11 },
    start: { co2_reg: 300 },
  },
  {
    label: "E: D + weak N2 greenhouse",
    rationale: "section 3.6 says nitrogen raises P without greenhouse forcing of its own; the equation reads full weight and lands 8 K hot",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6 },
    start: { co2_reg: 300 },
  },
  {
    label: "F: E + stronger regolith wave",
    rationale: "section 3.3 calls the regolith a second wave that sustains the mid game; at R_REG 0.4 it is a crawl",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0 },
    start: { co2_reg: 300 },
  },
  {
    label: "G: F + higher progress floor",
    rationale: "three of five axes sit at the floor until first water, so the geometric mean compresses all early movement",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.1 },
    start: { co2_reg: 300 },
  },
  {
    label: "H: G + faster clock",
    rationale: "a real-time stall shrinks with TIME_SCALE; 0.04 keeps the run inside the tens-of-hours band",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.1, TIME_SCALE: 0.04 },
    start: { co2_reg: 300 },
  },
  {
    label: "I: G + floor 0.18",
    rationale: "how far the floor can be pushed before a dead axis stops being punished",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.18 },
    start: { co2_reg: 300 },
  },
  {
    label: "J: I + 16h clock",
    rationale: "16 real hours reads as tens-of-hours more honestly than 12, and still shrinks the stall",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.18, TIME_SCALE: 0.03 },
    start: { co2_reg: 300 },
  },
  {
    label: "K: J + overlapping waves",
    rationale: "the caps top out near 229 K and the regolith does not start until 240, so the two waves do not overlap and the bar goes flat between them",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.18, TIME_SCALE: 0.03, T_SUBL_REG: 230 },
    start: { co2_reg: 300 },
  },
  {
    label: "L: K + gentler cap ramp",
    rationale: "W_CAP 6 dumps the caps in 60 years; a wider ramp spreads the same mass over a longer stretch",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.18, TIME_SCALE: 0.03, T_SUBL_REG: 230, W_CAP: 10 },
    start: { co2_reg: 300 },
  },
  {
    label: "M: K + floor 0.25",
    rationale: "how much more the floor buys before a dead axis stops being punished",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.25, TIME_SCALE: 0.03, T_SUBL_REG: 230 },
    start: { co2_reg: 300 },
  },
  {
    label: "N: L + floor 0.10",
    rationale: "section 8.1 wants a dead axis to tank the bar; at floor 0.18 with six axes it still reads 0.75, so this checks what a lower floor costs in stall",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.1, TIME_SCALE: 0.03, T_SUBL_REG: 230, W_CAP: 10 },
    start: { co2_reg: 300 },
  },
  {
    label: "O: L + floor 0.06",
    rationale: "lower still - the Batch 1 floor was 0.02 for five axes, which is 0.52 for a dead axis at six",
    tuning: { R_BIO: 0.75, M_PHOTO: 0.11, N2_GREENHOUSE_WEIGHT: 0.6, R_REG: 1.0, PROGRESS_FLOOR: 0.06, TIME_SCALE: 0.03, T_SUBL_REG: 230, W_CAP: 10 },
    start: { co2_reg: 300 },
  },
];

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
