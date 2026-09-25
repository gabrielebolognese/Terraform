/**
 * Entry point for the Vite dev server.
 *
 * Owns the simulation state, the animation frame loop and the player-facing
 * controls, and hands a read-only view to the inspector. The simulation itself
 * knows nothing about any of this.
 */

import { readWorld } from "./readout.js";
import { buildRows, orderDelta } from "./build.js";
import { Globe } from "./globe.js";
import { CityScreen } from "./city.js";
import { PlannerScreen } from "./planner.js";
import { WorldDriver } from "./driver.js";
import { Journey } from "./journey.js";
import { TravelPrompt } from "./travel-prompt.js";
import { ExampleMode } from "./example-mode.js";
import { examplePlanet } from "../harness/example.js";
import { formatLatLon, formatMetres, settlementLabel } from "./settlement-label.js";
import type { FacilityType, SettlementKind, SimConfig, SimState } from "../sim/index.js";
import {
  makeTuning,
  DEFAULT_TUNING,
  FACILITY_LIST,
  NEUTRAL_ENV,
  buildFacility,
  habitat,
  incomeRate,
  upkeepRate,
  orderCost,
  computeStep,
  deriveVisuals,
  facilityOf,
  marsStart,
  scrubberThrottled,
  seedBiosphere,
  setFacilityEnabled,
  simYear,
  stormIntensity,
  validateTuning,
  foundSettlement,
  connectAll,
  claimLand,
  connectTwice,
  upgradeBuilding,
  launchRocket,
  levelGround,
  placeBuilding,
  placeLink,
  removeBuilding,
  removeLink,
  sendRover,
  siteElevation,
  liquidWaterRate,
  nextSubstepFlows,
  seaLevel,
  renameSettlement,
  editZone,
  deleteZone,
  levelZone,
  planLinks,
  cancelPlans,
} from "../sim/index.js";
import type { BuildingType } from "../sim/index.js";
import { AUTOSAVE_INTERVAL_MS, READOUT_HZ, SPARK_CAPACITY, SPARK_HZ } from "./config.js";
import type { Speed } from "./config.js";
import { EventLog } from "./events.js";
import { advise, withAffordability } from "./guidance.js";
import { Hud } from "./hud.js";
import type { LeverView } from "./inspector.js";
import { Inspector } from "./inspector.js";
import { SimClock } from "./loop.js";
import { Ring } from "./ring.js";
import { Autosaver, boot } from "./session.js";
import { openSaveStore } from "./storage.js";
import "./style.css";

/**
 * The game runs WITH §12.2's seeded events; the default tuning does not.
 *
 * They are off by default so the golden frames, the balance sweep and a dozen
 * exactness tests are not at the mercy of the weather. The game is the one
 * place they belong, and enabling them is a tuning variant rather than a
 * config flag precisely so the balance sweep could measure their effect if it
 * ever needed to.
 *
 * Settlements tick and push the planet here (Batch 18's promise, kept in
 * Batch 20 now that there is a view to build them in), and their ground has
 * hills (Batch 22): 12 m either side of the base elevation. Measured over 100
 * sites, 16.1% of the ground is too steep to build on, and at least 439 of
 * the 900 places a 3 x 3 building could start are open.
 *
 * And roads (at the user's request): a building runs only when its network -
 * the buildings it touches and the roads it is on - holds a producer of what
 * it draws. Older saves are given the roads that connect what they had.
 */
const tuning = makeTuning({
  EVENTS_ENABLED: 1,
  ECONOMY_ENABLED: 1,
  TECH_GATE_ENABLED: 1,
  SETTLEMENTS_ENABLED: 1,
  TERRAIN_RELIEF_M: 12,
  NETWORK_ENABLED: 1,
  HEADQUARTERS_ENABLED: 1,
  ROCK_CLUSTER_CHANCE: 0.65,
  // Three times the founding ground (the user: "make the initial boundaries at
  // least 3x bigger"); a city claims more as it grows.
  // Buildings take a rover and time to build (at the user's request).
  BUILD_TIME_ENABLED: 1,
  CITY_GRID_TILES: 96,
  OUTPOST_GRID_TILES: 48,
  METROPOLIS_GRID_TILES: 288,
});
validateTuning(tuning);

let state: SimState = marsStart(undefined, tuning);
let speed: Speed = 1;
let droppedYears = 0;
let seedMessage: string | null = null;
let orderMessage: string | null = null;
let awayMessage: string | null = null;
let storageWarning: string | null = null;
let autosaver: Autosaver | null = null;

/** The example planet, and the player's own world while it is showing. */
const example = new ExampleMode();
/** Every save goes through here: nothing is written while the example is showing. */
function persist(): void {
  if (!example.mayPersist) return;
  void autosaver?.save(state);
}

/**
 * The environment the player has produced.
 *
 * Derived from the deployed facilities rather than tracked separately - the
 * simulation does the same thing internally every substep, and a second copy
 * here would be a second source of truth that drifts.
 */
/** The world's environment now, weather included - see `readout.ts`. */
function currentEnv() {
  return readWorld(state, tuning).env;
}

function config(): SimConfig {
  // The external environment is neutral: dust storms and solar variability are
  // Batch 8. Everything the player does reaches the sim through facilities.
  return { tuning, env: NEUTRAL_ENV, forcing: null };
}

const clock = new SimClock(config, speed);
/** The one thing that advances the world, whatever view is showing (Batch 21). */
const driver = new WorldDriver(state, clock, tuning);

const rings = {
  T: new Ring(SPARK_CAPACITY),
  P: new Ring(SPARK_CAPACITY),
  progress: new Ring(SPARK_CAPACITY),
};

const root = document.getElementById("app");
if (root === null) throw new Error("no #app element to mount into");

/**
 * The shell and the instruments get their own containers.
 *
 * Not tidiness: `Inspector` clears the element it is given, so mounting both
 * into #app deleted the entire HUD the moment the inspector was built. Every
 * unit test still passed, because each one mounts its component alone - the
 * collision only exists when the two are put on one page, which is what
 * `shell.test.ts` now does.
 */
const hudRoot = document.createElement("div");
hudRoot.className = "shell-hud";
const inspectorRoot = document.createElement("div");
inspectorRoot.className = "shell-instruments";

/**
 * The planet fills the page, and everything else floats over it.
 *
 * The stage comes first so it sits behind the panels; the HUD is a panel on
 * the left, and the instruments are a drawer on the right that opens on
 * demand - they are a debug view, not the game.
 */
const stage = document.createElement("div");
stage.className = "stage";
const globe = new Globe(stage);
const instrumentsToggle = document.createElement("button");
instrumentsToggle.type = "button";
instrumentsToggle.className = "instruments-toggle";
instrumentsToggle.textContent = "Instruments";
instrumentsToggle.setAttribute("aria-expanded", "false");
function setInstrumentsOpen(open: boolean): void {
  inspectorRoot.classList.toggle("open", open);
  instrumentsToggle.setAttribute("aria-expanded", String(open));
  instrumentsToggle.textContent = open ? "Close instruments" : "Instruments";
}
instrumentsToggle.addEventListener("click", () => setInstrumentsOpen(!inspectorRoot.classList.contains("open")));
const hint = document.createElement("div");
hint.className = "globe-hint";
hint.textContent = "drag to turn the planet - scroll to zoom";
root.append(stage, hudRoot, inspectorRoot, instrumentsToggle, hint);

// The disc centres in the space the HUD panel leaves free.
function syncInset(): void {
  const box = hudRoot.getBoundingClientRect();
  globe.setInsetLeft(box.width > 0 ? box.right : 0);
}
if (typeof ResizeObserver === "function") new ResizeObserver(syncInset).observe(hudRoot);
window.addEventListener("resize", syncInset);

/**
 * The player's actions, in one place.
 *
 * Both the shell and the instrument panel can order a facility or seed the
 * biosphere, and two copies of "order one more" would eventually disagree
 * about what that means.
 */
function setSpeed(next: Speed): void {
  speed = next;
  clock.speed = next;
  if (next !== 0) clock.resync();
}

function order(type: FacilityType, delta: number): void {
  // The same function the build panel dry-runs, so a button it offers is an
  // order that goes through.
  const outcome = orderDelta(state, type, delta, tuning);
  state = outcome.state;
  // A refused order must SAY so. Silently doing nothing is how a player
  // learns the buttons are unreliable.
  orderMessage = outcome.ok ? null : `Cannot order: ${outcome.reason ?? "refused"}`;
}

/** Switch a lever off (it keeps its order and ramps down) or back on. Both panels use this. */
function toggle(type: FacilityType): void {
  const existing = facilityOf(state, type);
  if (existing === undefined) return;
  state = setFacilityEnabled(state, type, !existing.enabled);
}

function seed(): void {
  const outcome = seedBiosphere(state, tuning, currentEnv());
  state = outcome.state;
  seedMessage = outcome.seeded ? "Biosphere seeded. Watch the oxygen." : `Cannot seed: ${outcome.reason ?? ""}`;
}

const events = new EventLog();

/**
 * The player-facing shell goes first in the DOM; the debug inspector stays
 * below it. Batch 7's gate is that a new player can tell what to do next, and
 * a reservoir table is not that - but the instruments are still how the
 * simulation gets debugged, so they are kept rather than replaced.
 */
/**
 * Founding (micro §2.3 step 1): choose a kind, then the next click on the
 * planet founds it there. The globe owns the click; the simulation owns the
 * rules - `foundSettlement` refuses what is not a place, and says why.
 */
let founding: SettlementKind | null = null;
/** Detail §1.3: "Elevation is shown at founding" - the site under the cursor, in words. */
let foundingSite: string | null = null;
globe.onPickHover = (site) => {
  foundingSite = site === null ? null : `${formatLatLon(site.lat, site.lon)}, ${formatMetres(siteElevation(site.lat, site.lon, tuning))} on the planet`;
};
function startFounding(kind: SettlementKind, name = ""): void {
  founding = kind;
  globe.beginPick(({ lat, lon }) => {
    const outcome = foundSettlement(state, kind, lat, lon, tuning, name);
    state = outcome.state;
    orderMessage = outcome.ok ? null : `Cannot found: ${outcome.reason ?? "refused"}`;
    founding = null;
  });
}
function cancelFounding(): void {
  founding = null;
  globe.cancelPick();
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && founding !== null) cancelFounding();
});

const hud: Hud = new Hud(
  hudRoot,
  {
    onSpeed: (next) => setSpeed(next),
    onOrder: (type: FacilityType, delta: number) => order(type, delta),
    onToggleLever: (type: FacilityType) => toggle(type),
    onSeed: () => seed(),
    // The advised lever now has a row in the HUD's own build panel; the
    // instruments are a debug view and stay closed.
    onFocusLever: (type: FacilityType) => hud.focusLever(type),
    onFound: (kind: SettlementKind, name: string) => startFounding(kind, name),
    onCancelFound: () => cancelFounding(),
    // The HUD's button is itself the confirmation: straight into the journey.
    onOpenSettlement: (id: string) => journey.goTo(id, performance.now()),
  },
  tuning,
);

/**
 * The city view (Batch 20). Going down is a plain switch for now; Batch 21
 * makes it a journey. The simulation keeps running either way - the frame
 * loop below advances it whichever view is showing.
 */
const city = new CityScreen(
  root,
  {
    onPlace: (id: string, type: BuildingType, tx: number, ty: number) => {
      const outcome = placeBuilding(state, id, type, tx, ty, tuning);
      state = outcome.state;
      return outcome;
    },
    // A dry run of the same call: the returned state is dropped.
    canPlace: (id: string, type: BuildingType, tx: number, ty: number) => placeBuilding(state, id, type, tx, ty, tuning),
    onRemove: (id: string, tx: number, ty: number) => {
      const outcome = removeBuilding(state, id, tx, ty);
      state = outcome.state;
      return outcome;
    },
    onLink: (id, layer, tx, ty) => {
      const outcome = placeLink(state, id, layer, tx, ty, tuning);
      state = outcome.state;
      return outcome;
    },
    canLink: (id, layer, tx, ty) => placeLink(state, id, layer, tx, ty, tuning),
    onUnlink: (id, layer, tx, ty) => {
      const outcome = removeLink(state, id, layer, tx, ty);
      state = outcome.state;
      return outcome;
    },
    onSendRover: (id, tx, ty) => {
      const outcome = sendRover(state, id, tx, ty, tuning);
      state = outcome.state;
      return outcome;
    },
    onLaunch: (id, tx, ty) => {
      const outcome = launchRocket(state, id, tx, ty, tuning);
      state = outcome.state;
      return outcome;
    },
    onUpgrade: (id, tx, ty) => {
      const outcome = upgradeBuilding(state, id, tx, ty, tuning);
      state = outcome.state;
      return outcome;
    },
    onConnectTwice: (id) => {
      const outcome = connectTwice(state, id, tuning);
      state = outcome.state;
      return outcome;
    },
    onLevel: (id, tx, ty) => {
      const outcome = levelGround(state, id, tx, ty, tuning);
      state = outcome.state;
      return outcome;
    },
    canLevel: (id, tx, ty) => levelGround(state, id, tx, ty, tuning),
    onClaim: (id, i, j) => {
      const outcome = claimLand(state, id, i, j, tuning);
      state = outcome.state;
      return outcome;
    },
    onConnect: (id: string) => {
      const outcome = connectAll(state, id, tuning);
      state = outcome.state;
      return outcome;
    },
    onBack: () => journey.goToOrbit(performance.now()),
    onPlanner: () => {
      const id = journey.resident;
      if (id === null) return;
      planner.open(id);
      city.root.hidden = true;
    },
  },
  tuning,
);

/**
 * The city planner (at the user's request), the second mode after the city
 * view: the settlement from above, zones, drawn links, and its record. It
 * stands in for the city view while open; the world runs on beneath both.
 */
const plannerAct = <O extends { state: SimState }>(outcome: O): O => {
  state = outcome.state;
  return outcome;
};
const planner = new PlannerScreen(
  root,
  {
    onRename: (id, name) => plannerAct(renameSettlement(state, id, name)),
    onZone: (id, edit) => plannerAct(editZone(state, id, edit, tuning)),
    onDeleteZone: (id, zone) => plannerAct(deleteZone(state, id, zone)),
    onLevelZone: (id, zone) => plannerAct(levelZone(state, id, zone, tuning)),
    onPlan: (id, layer, tiles) => plannerAct(planLinks(state, id, layer, tiles, tuning)),
    onCancelPlans: (id) => plannerAct(cancelPlans(state, id)),
    onCityView: () => {
      planner.close();
      city.root.hidden = false;
    },
  },
  tuning,
);

/**
 * Travel between orbit and a city (micro §1.4, Batch 21). The journey owns
 * the sequence - camera down, load, and on the way back flush, unload, camera
 * up - and this is what each step does to the page. None of it touches the
 * world: `driver` advances it the same whichever view is showing.
 */
const journey = new Journey(
  {
    load: (id: string) => {
      if (founding !== null) cancelFounding();
      city.open(id);
      globe.setPaused(true);
      for (const node of [stage, hudRoot, inspectorRoot, instrumentsToggle, hint]) node.hidden = true;
    },
    unload: () => {
      city.close();
      planner.close();
      globe.setPaused(false);
      for (const node of [stage, hudRoot, inspectorRoot, instrumentsToggle, hint]) node.hidden = false;
    },
    flush: () => persist(),
    pose: (p) => globe.setPose(p),
    currentPose: () => globe.currentPose(),
  },
  (id: string) => {
    const s = state.settlements.find((x) => x.id === id);
    // A settlement lost to the sea is a ruin: there is nothing to go down to.
    return s === undefined || s.lostAtSeaLevelM !== null ? null : { lat: s.lat, lon: s.lon };
  },
);

// Micro §1.4: "Player selects a marker and confirms travel."
const travelPrompt = new TravelPrompt(root);
globe.onMarker = (id: string) => {
  const s = state.settlements.find((x) => x.id === id);
  if (s === undefined || s.lostAtSeaLevelM !== null || journey.phase !== "orbit" || founding !== null) return;
  travelPrompt.ask(settlementLabel(s), formatLatLon(s.lat, s.lon), () => journey.goTo(id, performance.now()));
};

/**
 * "See example planet": the banner says what is showing and that nothing is
 * saved, and the way back. Building the example takes about three seconds; the
 * banner says so first, so the click never seems to do nothing.
 */
const exampleBanner = document.createElement("div");
exampleBanner.className = "example-banner";
exampleBanner.setAttribute("role", "status");
exampleBanner.hidden = true;
const exampleText = document.createElement("span");
const exampleBack = document.createElement("button");
exampleBack.type = "button";
exampleBack.textContent = "Back to my planet";
exampleBack.addEventListener("click", () => leaveExample());
exampleBanner.append(exampleText, exampleBack);
root.append(exampleBanner);

function freshViews(): void {
  journey.abort();
  travelPrompt.close();
  seedMessage = null;
  awayMessage = null;
  droppedYears = 0;
  rings.T.clear();
  rings.P.clear();
  rings.progress.clear();
  events.clear();
  hud.clear();
  clock.resync();
}

function enterExample(): void {
  if (example.active) return;
  exampleText.textContent = "Building the example planet...";
  exampleBack.hidden = true;
  exampleBanner.hidden = false;
  // Let the banner paint before the build (about three seconds).
  setTimeout(() => {
    state = example.enter(state, () => examplePlanet(DEFAULT_TUNING, tuning).state);
    freshViews();
    const counts = { city: 0, metropolis: 0, outpost: 0 };
    for (const s of state.settlements) counts[s.kind] += 1;
    exampleText.textContent =
      `Example planet: fully terraformed, with ${counts.city + counts.metropolis} cities ` +
      `(${counts.metropolis} of them metropolises) and ${counts.outpost} outposts. Nothing here is saved.`;
    exampleBack.hidden = false;
  }, 30);
}

function leaveExample(): void {
  const mine = example.leave();
  if (mine !== null) state = mine;
  freshViews();
  exampleBanner.hidden = true;
}

const inspector = new Inspector(
  inspectorRoot,
  {
    onSpeed: (next) => setSpeed(next),
    onOrder: (type: FacilityType, delta: number) => order(type, delta),
    onToggleLever: (type: FacilityType) => toggle(type),
    onSeed: () => seed(),
    onExample: () => enterExample(),
    onReset: () => {
      journey.abort();
      travelPrompt.close();
      state = marsStart(undefined, tuning);
      // Clear the slot too. Resetting the planet and then reloading into the
      // old save would look like the reset silently failed. (Not while the
      // example is showing: that reset is of the example, never of the save.)
      persist();
      seedMessage = null;
      awayMessage = null;
      droppedYears = 0;
      rings.T.clear();
      rings.P.clear();
      rings.progress.clear();
      events.clear();
      hud.clear();
      clock.resync();
    },
  },
  tuning,
  globe,
);

// The tab stops receiving animation frames when hidden, so the first frame
// back would otherwise carry the whole absence as one enormous delta.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Hiding is the moment a tab is most likely never to come back.
    persist();
  } else {
    clock.resync();
  }
});

// `pagehide` fires on close and on bfcache eviction, where `beforeunload` does
// not. The write is best-effort: the browser may not wait for it.
window.addEventListener("pagehide", () => {
  persist();
});

let lastReadout = 0;
/** Net flow into liquid water at the last readout, m/yr: the sea level's rate reads it (Batch 23). */
let liquidRate = 0;
let lastSample = 0;

/** Trailing window for the warming-rate readout, so it is not a per-frame jitter. */
let dTdt = 0;
let windowT: number | null = null;
let windowYear = 0;

/** Project the facility state into rows the inspector can render. */
function leverViews(throttled: boolean): readonly LeverView[] {
  return FACILITY_LIST.filter((def) => def.kind !== "action").map((def) => {
    const built = facilityOf(state, def.type);
    return {
      type: def.type,
      name: def.name,
      summary: def.summary,
      caution: def.caution,
      kind: def.kind,
      unit: def.unit,
      // Mirrors `orderedUnits` in the sim, which returns 0 for a disabled
      // facility. Computing it without `enabled` made a retiring lever read
      // "5 of 0 units online" and captioned it "coming online".
      ordered: built !== undefined && built.enabled ? built.count * built.level : 0,
      deployed: built?.deployed ?? 0,
      enabled: built?.enabled ?? true,
      throttled: def.type === "carbon_scrubber" && throttled,
    };
  });
}

function render(timestamp: number): void {
  // The world advances here and only here, whichever view is showing. `state`
  // stays the one copy the player's actions change; the driver takes it,
  // advances it and hands it back.
  driver.state = state;
  const advanced = driver.frame(timestamp);
  state = driver.state;
  droppedYears = advanced.droppedYears;

  const world = advanced.world;
  const env = world.env;
  const d = world.derived;
  const throttled = scrubberThrottled(state, d, tuning);
  const progress = world.progress;
  const phase = world.phase;
  const reached = advanced.reached;

  const year = simYear(state, tuning);

  journey.frame(timestamp);
  const resident = journey.resident;
  if (resident !== null) {
    const here = state.settlements.find((s) => s.id === resident);
    if (here === undefined) journey.abort();
    else if (planner.openId === resident) planner.frame(here, habitat(state.reservoirs, d, tuning, liquidRate), timestamp);
    else city.frame(here, habitat(state.reservoirs, d, tuning, liquidRate), timestamp, clock.pendingYears);
  }

  if (timestamp - lastSample >= 1000 / SPARK_HZ) {
    lastSample = timestamp;
    rings.T.push(d.T);
    rings.P.push(d.P);
    rings.progress.push(progress.progress);

    // Warming rate over the sampling window rather than over one frame, so
    // the readout is legible instead of flickering.
    if (windowT !== null && year > windowYear) {
      dTdt = (d.T - windowT) / (year - windowYear);
    }
    windowT = d.T;
    windowYear = year;
  }

  if (timestamp - lastReadout >= 1000 / READOUT_HZ) {
    lastReadout = timestamp;
    // Visuals are computed at READOUT rate, not substep rate and not frame
    // rate. A substep does not need them and `deriveVisuals` is deliberately
    // outside `tick` for exactly that reason.
    const flows = computeStep(state, d, tuning, tuning.SUBSTEP_YEARS, null).flows;
    // The flows the next substep of `advance` will integrate - weather included,
    // which `flows` above (built with no forcing) leaves out.
    liquidRate = liquidWaterRate(nextSubstepFlows(state, config()));
    // §9's dust channel carries the weather as well as the outgassing.
    const storm = stormIntensity(state.seed, year, tuning);
    const visuals = deriveVisuals(state.reservoirs, d, flows, tuning, storm);

    // The shell's two derived views. Both are pure functions of the world, so
    // neither can drift from it and neither needs a place in the save.
    const fresh = events.observe({
      year,
      state,
      reservoirs: state.reservoirs,
      derived: d,
      phaseReached: reached,
      tuning,
    });
    const bareAdvice = advise({
      state,
      reservoirs: state.reservoirs,
      derived: d,
      axes: progress.axes,
      tuning,
      dTdt,
    });

    // What the advised lever would actually cost right now, asked of the sim
    // rather than re-derived here - the shell must never recommend something
    // the simulation would refuse.
    const advice = withAffordability(
      bareAdvice,
      bareAdvice.lever === null || bareAdvice.lever === "biosphere_seeding"
        ? null
        : {
            cost: orderCost(
              bareAdvice.lever,
              facilityOf(state, bareAdvice.lever)?.count ?? 0,
              (facilityOf(state, bareAdvice.lever)?.count ?? 0) + 1,
              facilityOf(state, bareAdvice.lever)?.level ?? 1,
              tuning,
            ),
            credits: state.economy.credits,
          },
    );

    hud.update({
      simYear: year,
      phase,
      phaseReached: reached,
      progress: progress.progress,
      axes: progress.axes,
      derived: d,
      reservoirs: state.reservoirs,
      advice,
      events: events.log,
      fresh,
      speed,
      // Asking the sim rather than re-deriving the gates here: the shell must
      // never offer a button the simulation would refuse.
      canSeed: !state.seeded && seedBiosphere(state, tuning, env).seeded,
      // Ask the sim, do not guess: a dry run of the exact order the button
      // would place.
      canOrder:
        advice.lever === null || advice.lever === "biosphere_seeding"
          ? false
          : orderDelta(state, advice.lever, 1, tuning).ok,
      economy: tuning.ECONOMY_ENABLED
        ? {
            credits: state.economy.credits,
            income: incomeRate(habitat(state.reservoirs, d, tuning, liquidRate), tuning),
            upkeep: upkeepRate(state.facilities, tuning),
          }
        : null,
      notice: orderMessage,
      build: buildRows(state, tuning),
      seeded: state.seeded,
      settlements: state.settlements,
      founding,
      foundingSite: founding === null ? null : foundingSite,
    });

    globe.setSettlements(state.settlements);
    inspector.update(
      {
        simYear: year,
        state,
        derived: d,
        progress: progress.progress,
        progressRaw: progress.progressRaw,
        axes: progress.axes,
        phase,
        phaseReached: reached,
        dTdt,
        droppedYears,
        env,
        levers: leverViews(throttled),
        shieldStrength: state.shieldStrength,
        speed,
        seedMessage,
        awayMessage,
        storageWarning,
        visuals,
        seaLevel: seaLevel(state.reservoirs, tuning, liquidRate),
      },
      rings,
    );
  }

  if (autosaver !== null && example.mayPersist && autosaver.due(AUTOSAVE_INTERVAL_MS)) {
    void autosaver.save(state);
    if (autosaver.failureCount > 0) {
      storageWarning = `saving is failing (${autosaver.failureCount} attempts) - progress may not survive a reload`;
    }
  }

  requestAnimationFrame(render);
}

/**
 * Boot, then start the loop.
 *
 * The inspector is built first so the page is never blank while storage is
 * opening, and the world is swapped in when the save has been read and
 * advanced by whatever the absence was worth.
 */
async function start(): Promise<void> {
  const store = await openSaveStore();
  const booted = await boot(store, config(), () => Date.now());

  state = booted.state;
  autosaver = new Autosaver(store, config(), () => Date.now());

  if (booted.summary !== null) awayMessage = `While you were away: ${booted.summary.headline}`;
  if (booted.problem !== null) storageWarning = `Could not load the previous save - ${booted.problem}`;
  if (!store.durable) {
    storageWarning = "this browser has no durable storage available, so progress will not survive a reload";
  }

  requestAnimationFrame(render);
}

void start();
