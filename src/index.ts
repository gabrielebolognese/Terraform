/**
 * Node entry point - a one-shot summary of the world's starting state.
 *
 * For the full trajectory use the harness: `npm run sim:run`.
 * For the live dashboard use the inspector: `npm run dev`.
 */

import { pathToFileURL } from "node:url";

import {
  DEFAULT_TUNING,
  NEUTRAL_ENV,
  PHASE_INFO,
  RESERVOIR_KEYS,
  computeProgress,
  derive,
  evaluatePhase,
  marsStart,
  totalCarbonMbar,
  totalWaterMetres,
  validateTuning,
} from "./sim/index.js";

export function describeStart(): string {
  const tuning = DEFAULT_TUNING;
  validateTuning(tuning);

  const state = marsStart();
  const d = derive(state.reservoirs, NEUTRAL_ENV, tuning);
  const progress = computeProgress(state.reservoirs, d, tuning);
  const phase = evaluatePhase(state.reservoirs, d, NEUTRAL_ENV, tuning);

  const lines = [
    `${state.planetId} — phase ${phase} ${PHASE_INFO[phase].name}`,
    PHASE_INFO[phase].caption,
    "",
    `T        ${d.T.toFixed(2)} K   (freezing ${tuning.T_FREEZE}, target 288)`,
    `P        ${d.P.toFixed(2)} mbar   (target 1013)`,
    `albedo   ${d.albedo.toFixed(4)}   ice cover ${(d.iceFrac * 100).toFixed(1)}%`,
    `progress ${(progress.progress * 100).toFixed(2)}%   (raw ${(progress.progressRaw * 100).toFixed(2)}%)`,
    "",
    `carbon inventory ${totalCarbonMbar(state.reservoirs).toFixed(1)} mbar`,
    `water inventory  ${totalWaterMetres(state.reservoirs, tuning).toFixed(1)} m sea-level-equivalent`,
    "",
    "reservoirs:",
    ...RESERVOIR_KEYS.map((key) => `  ${key.padEnd(9)} ${state.reservoirs[key]}`),
    "",
    `cap ignition needs T > ${tuning.T_SUBL_CAP} K; the planet is ${(tuning.T_SUBL_CAP - d.T).toFixed(2)} K short.`,
    "Nothing happens until the player closes that gap - which is the point.",
  ];
  return lines.join("\n");
}

export function main(): void {
  console.log(describeStart());
}

// Only when run directly, so importing `describeStart` from a test is quiet.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
