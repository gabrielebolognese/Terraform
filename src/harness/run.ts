/**
 * The headless fast-forward harness.
 *
 * `npm run sim:run -- --years 3000 --every 10 --csv docs/balance/run.csv`
 *
 * Build-order step 2 says the game is balanced HERE, before any pixels exist.
 * So this ships in Batch 1 even though the tuning work is the next batch: the
 * instrument comes before the measurement.
 *
 * It always runs TWO trajectories. The reference run is the one to look at.
 * The null-policy run is the control, and the thing that would have caught the
 * original spec's worst balance bug: with the section 10 sigmoid, an untouched
 * Mars terraforms itself to 166 mbar in about 600 years while the player
 * watches, which deletes the moment section 0 calls the emotional core of the
 * game.
 */

import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type { Reservoirs, SimConfig, SimState, Tuning } from "../sim/index.js";
import {
  DEFAULT_TUNING,
  makeTuning,
  PHASE_INFO,
  Phase,
  advance,
  derive,
  worldEnv,
  evaluatePhase,
  computeProgress,
  co2ReleaseRate,
  computeStep,
  deriveVisuals,
  latchPhase,
  NEUTRAL_ENV,
  marsStart,
  seedBiosphere,
  simYear,
  stormIntensity,
  validateTuning,
} from "../sim/index.js";
import { channelSeries, plot, pressureSeries, progressSeries, tempSeries } from "./plot.js";
import type { Policy } from "./policy.js";
import { NULL_POLICY, REFERENCE_POLICY, applyOrdersDue } from "./policy.js";

interface Sample {
  readonly year: number;
  readonly T: number;
  readonly P: number;
  readonly albedo: number;
  readonly co2_atm: number;
  readonly co2_cap: number;
  readonly co2_reg: number;
  readonly n2: number;
  readonly o2: number;
  readonly h2o_ice: number;
  readonly h2o_liq: number;
  readonly h2o_vap: number;
  readonly ghg: number;
  readonly biomass: number;
  readonly iceFrac: number;
  readonly oceanFrac: number;
  readonly vegFrac: number;
  readonly cloudFrac: number;
  readonly progress: number;
  readonly progressRaw: number;
  readonly phase: number;
  // --- the section 9 visual channels, so a full run can be plotted and the
  // continuity claim checked against a real trajectory rather than a sweep.
  /** The section 9 source for dust: total CO2 outgassing, mbar/yr. */
  readonly releaseRate: number;
  /** §12.2 weather, 0..1. Zero unless the tuning enables events. */
  readonly stormDust: number;
  readonly capRadius: number;
  readonly atmoThickness: number;
  readonly dustIntensity: number;
  readonly clearFraction: number;
  readonly skyR: number;
  readonly skyG: number;
  readonly skyB: number;
  readonly tintR: number;
  readonly tintG: number;
  readonly tintB: number;
}

export interface RunResult {
  readonly samples: readonly Sample[];
  readonly finalState: SimState;
  /** First sim-year each phase was reached, or null if never. */
  readonly phaseTimes: readonly (number | null)[];
}

export function runTrajectory(
  policy: Policy,
  years: number,
  everyYears: number,
  tuning: Tuning = DEFAULT_TUNING,
  /**
   * Overrides on the starting reservoirs.
   *
   * Section 10 lists `co2_cap0`, `co2_reg0` and `h2o_ice0` as tuning
   * constants, but they are the planet's start vector and live in
   * planets/mars.ts, so the balance sweep needs a way to vary them without
   * pretending they belong to `Tuning`.
   */
  startReservoirs: Partial<Reservoirs> = {},
): RunResult {
  validateTuning(tuning);

  const base = marsStart();
  let state: SimState = { ...base, reservoirs: { ...base.reservoirs, ...startReservoirs } };
  let year = 0;
  const samples: Sample[] = [];
  const phaseTimes: (number | null)[] = [null, null, null, null, null, null, null];
  const ordersApplied = new Set<number>();

  const stepsPerSample = Math.max(1, Math.round(everyYears / tuning.SUBSTEP_YEARS));
  const totalSamples = Math.max(1, Math.round(years / everyYears));

  let previousReached = -1;

  const record = (): void => {
    const env = worldEnv(state, NEUTRAL_ENV, tuning);
    const d = derive(state.reservoirs, env, tuning);
    const p = computeProgress(state.reservoirs, d, tuning);
    const phase = evaluatePhase(state.reservoirs, d, env, tuning);
    state = { ...state, phaseReached: latchPhase(state.phaseReached, phase) };

    // Fill EVERY slot up to the new high-water mark, not just the current one.
    // The latch can advance by more than one between samples, and recording
    // only the slot it landed on left the skipped phases as null forever -
    // which `phaseTimes` documents as "never reached". At --every 50 the
    // reference run reported Phase 1 as never reached despite passing through
    // it, and the balance batch's pacing score reads those nulls as "never".
    for (let ph = previousReached + 1; ph <= state.phaseReached; ph += 1) {
      if (phaseTimes[ph] === null || phaseTimes[ph] === undefined) phaseTimes[ph] = year;
    }
    previousReached = Math.max(previousReached, state.phaseReached);

    const r = state.reservoirs;
    // Visuals are NOT computed inside the tick - a substep does not need them.
    // The flows are what the dust channel reads, which is why they are
    // recomputed here rather than approximated from a net rate.
    const flows = computeStep(state, d, tuning, tuning.SUBSTEP_YEARS, null).flows;
    // The weather is part of §9's dust channel once events are on, and the
    // continuity test needs it as dust's DRIVER - a storm is a fast driver,
    // not a snap in the mapping.
    const storm = stormIntensity(state.seed, year, tuning);
    const vis = deriveVisuals(r, d, flows, tuning, storm);
    const release = co2ReleaseRate(flows);
    samples.push({
      year,
      T: d.T,
      P: d.P,
      albedo: d.albedo,
      co2_atm: r.co2_atm,
      co2_cap: r.co2_cap,
      co2_reg: r.co2_reg,
      n2: r.n2,
      o2: r.o2,
      h2o_ice: r.h2o_ice,
      h2o_liq: r.h2o_liq,
      h2o_vap: r.h2o_vap,
      ghg: r.ghg,
      biomass: r.biomass,
      iceFrac: d.iceFrac,
      oceanFrac: d.oceanFrac,
      vegFrac: d.vegFrac,
      cloudFrac: d.cloudFrac,
      progress: p.progress,
      progressRaw: p.progressRaw,
      phase: state.phaseReached,
      releaseRate: release,
      stormDust: storm,
      capRadius: vis.capRadius,
      atmoThickness: vis.atmosphereThickness,
      dustIntensity: vis.dustIntensity,
      clearFraction: vis.clearFraction,
      skyR: vis.skyColour.r,
      skyG: vis.skyColour.g,
      skyB: vis.skyColour.b,
      tintR: vis.surfaceTint.r,
      tintG: vis.surfaceTint.g,
      tintB: vis.surfaceTint.b,
    });
  };

  record();

  for (let i = 0; i < totalSamples; i += 1) {
    // Orders are placed by the schedule; the environment then follows from the
    // facilities themselves, exactly as it does for a player in the inspector.
    state = applyOrdersDue(state, policy, year, ordersApplied, tuning);
    const env = worldEnv(state, NEUTRAL_ENV, tuning);
    const cfg: SimConfig = { tuning, env: NEUTRAL_ENV, forcing: null };

    if (policy.seedAt >= 0 && !state.seeded && year >= policy.seedAt) {
      const outcome = seedBiosphere(state, tuning, env);
      state = outcome.state;
    }

    state = advance(state, stepsPerSample, cfg);
    year = simYear(state, tuning);
    record();
  }

  return { samples, finalState: state, phaseTimes };
}

function toCsv(samples: readonly Sample[]): string {
  const first = samples[0];
  if (first === undefined) return "";
  const keys = Object.keys(first) as readonly (keyof Sample)[];
  const rows = [keys.join(",")];
  for (const s of samples) {
    rows.push(keys.map((k) => formatNumber(s[k])).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";
  return Math.abs(value) >= 1e-4 && Math.abs(value) < 1e7 ? value.toFixed(6) : value.toExponential(6);
}

function summarise(label: string, result: RunResult, tuning: Tuning): string {
  const last = result.samples[result.samples.length - 1];
  if (last === undefined) return `${label}: no samples`;

  const lines: string[] = [];
  lines.push(`--- ${label} ---`);
  lines.push(
    `final  year=${last.year.toFixed(0)}  T=${last.T.toFixed(1)}K  P=${last.P.toFixed(1)}mbar  ` +
      `o2=${last.o2.toFixed(1)}  ocean=${(last.oceanFrac * 100).toFixed(1)}%  bio=${last.biomass.toFixed(3)}`,
  );
  lines.push(
    `       progress=${last.progress.toFixed(4)} (raw ${last.progressRaw.toFixed(4)})  ` +
      `phase=${last.phase} ${PHASE_INFO[last.phase as Phase].name}`,
  );
  lines.push(
    `       reservoirs: co2_atm=${last.co2_atm.toFixed(1)} cap=${last.co2_cap.toFixed(1)} ` +
      `reg=${last.co2_reg.toFixed(1)} n2=${last.n2.toFixed(1)} ice=${last.h2o_ice.toFixed(1)}m ` +
      `liq=${last.h2o_liq.toFixed(1)}m vap=${last.h2o_vap.toFixed(2)}mbar ghg=${last.ghg.toFixed(2)}`,
  );

  const times = result.phaseTimes
    .map((t, i) => (t === null ? null : `${i}:${t.toFixed(0)}y`))
    .filter((s): s is string => s !== null);
  lines.push(`       phase entry: ${times.join("  ")}`);
  lines.push(`       carbon total: ${(last.co2_atm + last.co2_cap + last.co2_reg).toFixed(1)} mbar in reservoirs`);
  const deployed = result.finalState.facilities
    .filter((f) => f.deployed > 0)
    .map((f) => `${f.type}:${f.deployed.toFixed(0)}u`);
  lines.push(`       levers online: ${deployed.length > 0 ? deployed.join("  ") : "none"}`);
  lines.push(`       shield: ${(result.finalState.shieldStrength * 100).toFixed(0)}%`);
  lines.push(`       (tuning: SUBSTEP_YEARS=${tuning.SUBSTEP_YEARS}, H2O_MBAR_PER_M=${tuning.H2O_MBAR_PER_M.toFixed(2)})`);
  return lines.join("\n");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      years: { type: "string", default: "3000" },
      every: { type: "string", default: "10" },
      csv: { type: "string" },
      channels: { type: "boolean", default: false },
      "null-only": { type: "boolean", default: false },
      // §12.2's seeded weather. Off in the default tuning, so the golden
      // frames and the balance sweep are never at the mercy of it.
      events: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const years = Number(values.years);
  const every = Number(values.every);
  if (!Number.isFinite(years) || years <= 0) throw new RangeError("--years must be a positive number");
  if (!Number.isFinite(every) || every <= 0) throw new RangeError("--every must be a positive number");

  // The playthrough is a schedule of build orders now, not a handful of
  // scalars - see src/harness/policy.ts. The old --mirror/--ghg/--n2 flags
  // were parsed into fields no code read, so a sweep over them returned the
  // identical trajectory every time, silently.
  const policy: Policy = REFERENCE_POLICY;
  const tuning: Tuning = values.events === true ? makeTuning({ EVENTS_ENABLED: 1 }) : DEFAULT_TUNING;
  if (values.events === true) console.log("       --events: section 12.2 seeded weather is ON");

  const started = process.hrtime.bigint();

  const nullRun = runTrajectory(NULL_POLICY, years, every, tuning);
  console.log(summarise("NULL POLICY (control: nobody touches the planet)", nullRun, tuning));
  const nullLast = nullRun.samples[nullRun.samples.length - 1];
  if (nullLast !== undefined) {
    const verdict =
      nullLast.phase <= Phase.Warming
        ? "PASS - an untouched Mars stays dead, so reaching the tipping point is the player's job"
        : `FAIL - an untouched Mars reached phase ${nullLast.phase} on its own`;
    console.log(`       ${verdict}`);
  }
  console.log("");

  if (values["null-only"] === true) return;

  const refRun = runTrajectory(policy, years, every, tuning);
  console.log(summarise("REFERENCE POLICY (scripted stand-in for a player)", refRun, tuning));
  console.log("");
  console.log(
    plot(
      [
        pressureSeries(refRun.samples.map((s) => s.P)),
        tempSeries(refRun.samples.map((s) => s.T)),
        progressSeries(refRun.samples.map((s) => s.progress)),
      ],
      years,
    ),
  );

  if (values.channels === true) {
    // Section 9's channels over the whole run. The claim they have to satisfy
    // is continuity, which src/harness/visuals.test.ts checks falsifiably -
    // this is for looking at.
    console.log("");
    console.log("       section 9 visual channels");
    console.log(
      plot(
        [
          channelSeries("cap radius", "C", refRun.samples.map((s) => s.capRadius)),
          channelSeries("atmosphere", "A", refRun.samples.map((s) => s.atmoThickness)),
          channelSeries("dust", "D", refRun.samples.map((s) => s.dustIntensity)),
          channelSeries("ocean", "O", refRun.samples.map((s) => s.oceanFrac)),
          channelSeries("green", "G", refRun.samples.map((s) => s.vegFrac)),
          ...(values.events === true
            ? [channelSeries("weather", "W", refRun.samples.map((s) => s.stormDust))]
            : []),
        ],
        years,
      ),
    );
  }

  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`\n       ${refRun.samples.length} samples, both runs in ${elapsedMs.toFixed(0)} ms`);

  const csvPath = values.csv;
  if (csvPath !== undefined) {
    mkdirSync(dirname(csvPath), { recursive: true });
    writeFileSync(csvPath, toCsv(refRun.samples), "utf8");
    console.log(`       wrote ${refRun.samples.length} rows to ${csvPath}`);
  }
}

/**
 * Only run when invoked directly, not when a test imports `runTrajectory`.
 * Importing a module should never print a 4000-year trajectory as a side effect.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
