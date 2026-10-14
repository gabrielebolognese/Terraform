/**
 * Entry point for the Vite dev server.
 *
 * Batch 27: the game opens on its title screen (`app.ts`). Each world is
 * started and stopped by it (`game.ts`); nothing loads until the player
 * chooses.
 */

import { DEFAULT_TUNING } from "../sim/index.js";
import { examplePlanet } from "../harness/example.js";
import { App } from "./app.js";
import { startGame } from "./game.js";
import { BROWSER_TUNING } from "./game-tuning.js";
import { openSaveStore } from "./storage.js";
import "./style.css";

const root = document.getElementById("app");
if (root === null) throw new Error("no #app element to mount into");

/** A new world's seed: 1 to 2^32 - 1 (0 is the original planet, kept for the worlds from before seeds). */
function randomSeed(): number {
  const out = new Uint32Array(1);
  do crypto.getRandomValues(out);
  while (out[0] === 0);
  return out[0] ?? 1;
}

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function start(app: HTMLElement): Promise<void> {
  const store = await openSaveStore();
  const front = new App({
    root: app,
    store,
    now: () => Date.now(),
    randomSeed,
    launch: startGame,
    buildExample: () => ({ state: examplePlanet(DEFAULT_TUNING, BROWSER_TUNING).state, tuning: BROWSER_TUNING }),
    download,
    debugSpeeds: new URLSearchParams(location.search).has("debug"),
  });
  await front.start();
}

void start(root);
