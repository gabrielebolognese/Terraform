/**
 * One world, playing (Batch 27: what `main.ts` was before there were worlds).
 *
 * Owns the simulation state, the animation frame loop and the player-facing
 * controls, and hands a read-only view to the inspector. The simulation itself
 * knows nothing about any of this.
 *
 * A world is started and stopped: the title screen opens one, Quit to title
 * closes it. Stopping takes everything down - the frame loop, the window
 * listeners, the globe's GPU context, the city's caches - so going in and out
 * of worlds never piles up what earlier ones held. Saving is the caller's
 * (`hooks.save`): this file decides when, never where.
 */

import { readWorld } from "./readout.js";
import { buildRows, orderDelta } from "./build.js";
import { Globe } from "./globe.js";
import { CityScreen } from "./city.js";
import { PlannerScreen } from "./planner.js";
import { WorldMapScreen } from "./world-map.js";
import { WorldDriver } from "./driver.js";
import { Journey } from "./journey.js";
import { TravelPrompt } from "./travel-prompt.js";
import { ExampleMode } from "./example-mode.js";
import { examplePlanet } from "../harness/example.js";
import type { TerrainRotation } from "../shared/planet-terrain.js";
import { formatLatLon, formatMetres, settlementLabel } from "./settlement-label.js";
import { floodWarnings } from "./flood-warning.js";
import type { FacilityType, HabitatChannels, MicroResource, SettlementKind, SimConfig, SimState, Tuning, VisualChannels } from "../sim/index.js";
import {
  BUILDING_DEFS,
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
  scrubberThrottled,
  seedBiosphere,
  setFacilityEnabled,
  simYear,
  stormIntensity,
  foundSettlement,
  connectAll,
  claimLand,
  connectTwice,
  upgradeBuilding,
  moveQueuedBuild,
  cancelQueuedBuild,
  launchRocket,
  levelGround,
  placeBuilding,
  checkPlacement,
  placeLink,
  removeBuilding,
  removeLink,
  sendRover,
  siteElevation,
  liquidWaterRate,
  nextSubstepFlows,
  seaLevel,
  renameSettlement,
  connectSettlements,
  editZone,
  deleteZone,
  levelZone,
  planLinks,
  cancelPlans,
  chooseDecision,
  acceptContract,
  cancelEarthOrder,
  orderFromEarth,
  claimObjective,
  hasCosmetic,
  hasUnlock,
  objectiveStatus,
  skipGuide,
} from "../sim/index.js";
import type { BuildingType } from "../sim/index.js";
import { ALERT_BUDGET_MS, ALERT_HZ, READOUT_HZ, SPARK_CAPACITY, SPARK_HZ, speedsFor } from "./config.js";
import type { Speed } from "./config.js";
import { EventLog } from "./events.js";
import { advise, withAffordability } from "./guidance.js";
import { Hud } from "./hud.js";
import type { LeverView } from "./inspector.js";
import { Inspector } from "./inspector.js";
import { SimClock } from "./loop.js";
import { Ring } from "./ring.js";
import { GuidePanel, ObjectivesPanel, guideHint, rewardWords } from "./onboarding.js";
import type { GuideContext } from "./onboarding.js";
import { MilestoneCards, MilestoneWatch } from "./milestones.js";
import { AlertWatch, buildingAt, shortagesOf } from "./alerts.js";
import type { AlertTarget } from "./alerts.js";
import { AlertCentre, AlertToasts } from "./alert-centre.js";
import { DecisionPanel } from "./decisions.js";
import { EarthPanel } from "./earth.js";
import { historyLines } from "./decision-words.js";
import { StatisticsScreen } from "./statistics.js";
import { cityOverview, overviewWords } from "./city-overview.js";
import { SoundDirector } from "./sound-director.js";
import { SoundEngine } from "./sound-engine.js";
import { trainCars } from "../render/city.js";
import type { Settings } from "./settings.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import type { FrameCosts } from "./frame-costs.js";
import type { ActionId } from "./keys.js";
import { actionFor, baseCode, chordOf, isWaitingForKey, typing } from "./keys.js";
import { reducedMotion } from "./interface.js";
import { TRAVEL_MS } from "./config.js";

/**
 * The keys' camera (Batch 36), at a camera speed of 1x: screen pixels a
 * second in a city, the planner and the map; radians a second in orbit; and
 * a zoom key's step.
 */
export const KEY_PAN_PX = 600;
export const KEY_TURN_RAD = 1.2;
export const KEY_ZOOM_STEP = 1.25;
/** How long "Saved." stays after the Save key, ms. */
const SAVED_NOTE_MS = 2500;

export interface GameOptions {
  readonly state: SimState;
  /** The world's own tuning, as it was made (`worlds.ts`). */
  readonly tuning: Tuning;
  /** Shown once in the instruments: what happened while away; a storage problem. */
  readonly awayMessage?: string | null;
  readonly storageWarning?: string | null;
  /** A world that never saves - the example planet from the title - and what its banner says. */
  readonly lookOnly?: { readonly banner: string } | null;
  /** The world's own start, for the instruments' Reset. */
  readonly fresh: () => SimState;
  /** The debug setting: every speed, whatever the world's pace (Batch 28). */
  readonly debugSpeeds?: boolean;
  /** The session's sound (Batch 35). Absent, the world is silent. */
  readonly sound?: SoundEngine;
  /** The player's settings (Batch 36), read as the world plays: a change counts at once. Absent, the defaults. */
  readonly settings?: { readonly current: Settings };
  /** Where each city frame's cost is kept, for the graphics settings to show. */
  readonly frameCosts?: FrameCosts;
}

export interface GameHooks {
  /** Write the world. Never called for a look-only world, nor while the instruments' example shows. */
  save(state: SimState): void;
  /** True when the autosave interval has passed. */
  saveDue(): boolean;
  /** Consecutive failed writes: non-zero means the game must stop promising persistence. */
  saveFailures(): number;
  /** Escape with nothing open, or the Menu button. */
  onMenu(): void;
  /** A look-only world's way back. */
  onBackToTitle(): void;
  /** Save now (Batch 36: the Save key), and the words for how it went. Absent, nothing is saved. */
  saveNow?(): Promise<string>;
}

export interface GameHandle {
  /** The player's world - never the instruments' example, while it shows. */
  readonly state: SimState;
  readonly mayPersist: boolean;
  /** The planet's look at the last readout, for a thumbnail. Null before the first. */
  readonly visuals: VisualChannels | null;
  readonly yaw: number;
  readonly terrain: TerrainRotation;
  /** Real milliseconds played since this world was opened. */
  readonly playedMs: number;
  readonly speed: Speed;
  /** Hold the world still behind the menu, and let it go again at the speed it had. */
  setPaused(paused: boolean): void;
  stop(): void;
  /** The views, read-only, for a test to look at (Batch 36): the city, the planner, the map, the planet. */
  readonly views: { readonly city: CityScreen; readonly planner: PlannerScreen; readonly worldMap: WorldMapScreen; readonly globe: Globe };
}

export function startGame(app: HTMLElement, options: GameOptions, hooks: GameHooks): GameHandle {
  const tuning = options.tuning;
  let state: SimState = options.state;
  let speed: Speed = 1;
  /** The player's settings, as they are now (Batch 36): every view reads them as it goes. */
  const prefs = (): Settings => options.settings?.current ?? DEFAULT_SETTINGS;
  /** The menu key: Esc, unless the player moved it - never while typing. */
  const isMenuKey = (e: KeyboardEvent): boolean => {
    const chord = chordOf(e);
    return actionFor(prefs().controls.keys, chord) === "menu" && !typing(e.target, chord) && !isWaitingForKey();
  };
  /** The speed the menu held the world from: non-null while the menu is open. */
  let pausedFrom: Speed | null = null;
  /** The speed the Pause key goes back to. */
  let resumeSpeed: Speed = 1;
  /** What this world offers (Batch 28): a Standard world's are slow, a sandbox's all. */
  const speeds = speedsFor(tuning, options.debugSpeeds === true);
  let droppedYears = 0;
  let seedMessage: string | null = null;
  let orderMessage: string | null = null;
  let awayMessage: string | null = options.awayMessage ?? null;
  let storageWarning: string | null = options.storageWarning ?? null;
  /** Real time played this session, from frame to frame (a hidden tab draws no frames, so counts none). */
  let playedMs = 0;
  let lastFrameAt: number | null = null;
  let stopped = false;
  let frameId = 0;
  let visuals: VisualChannels | null = null;
  const listening = new AbortController();
  const signal = listening.signal;

  /** The example planet, and the player's own world while it is showing. */
  const example = new ExampleMode();
  /** Every save goes through here: nothing is written while the example is showing. */
  function persist(): void {
    if (!example.mayPersist || options.lookOnly) return;
    hooks.save(state);
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

  /** Everything this world puts on the page, in one container: leaving the world removes it whole. */
  const root = document.createElement("div");
  root.className = "game";
  app.append(root);

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
  globe.prefs = prefs;
  globe.setTerrain(tuning.TERRAIN_SEED);
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
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncInset) : null;
  resizeObserver?.observe(hudRoot);
  window.addEventListener("resize", syncInset, { signal });

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
    city.speed = next;
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
   * Sound (Batch 35): the music by the phase, the planet's and the city's
   * beds, and every action answered. It only reads the world; the engine is
   * the session's, and silent until the player's first gesture.
   */
  const sound = new SoundDirector(options.sound ?? new SoundEngine(() => null), tuning);

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
  /**
   * Escape, first (capture, so it is judged before any screen's own handler
   * closes something): it closes what is open, and only with nothing open does
   * it bring up the world's menu (Batch 27). In a city, Escape is the city's
   * (it clears a selection); the Menu button is there for the menu.
   */
  /** The camera keys held down (Batch 36): each frame moves the view while they are. */
  const held = new Set<ActionId>();
  /** The bound key each held action came from, so its release lets go. */
  const heldBy = new Map<ActionId, string>();
  const CAMERA_KEYS: readonly ActionId[] = ["panUp", "panLeft", "panDown", "panRight"];
  window.addEventListener(
    "keydown",
    (e) => {
      const chord = chordOf(e);
      const action = actionFor(prefs().controls.keys, chord);
      // The Settings panel waiting for a key to bind takes this one.
      if (action === null || typing(e.target, chord) || isWaitingForKey()) return;
      // The menu over the world takes no shortcut but its own key and Save.
      if (pausedFrom !== null && action !== "menu" && action !== "save") return;
      if (action === "menu") {
        if (founding !== null) {
          cancelFounding();
          return;
        }
        const idle = !travelPrompt.open && journey.phase === "orbit" && journey.resident === null && !worldMap.busy;
        if (idle) hooks.onMenu();
        return;
      }
      e.preventDefault();
      if (CAMERA_KEYS.includes(action)) {
        held.add(action);
        heldBy.set(action, baseCode(chord!));
        return;
      }
      if (action === "zoomIn" || action === "zoomOut") {
        zoomKey(action === "zoomIn" ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP);
        return;
      }
      if (e.repeat) return;
      command(action);
    },
    { signal, capture: true },
  );
  window.addEventListener(
    "keyup",
    (e) => {
      for (const [action, code] of heldBy) {
        if (code === e.code) {
          held.delete(action);
          heldBy.delete(action);
        }
      }
    },
    { signal },
  );
  // A key let go while the page was elsewhere is never heard: nothing stays held.
  window.addEventListener(
    "blur",
    () => {
      held.clear();
      heldBy.clear();
    },
    { signal },
  );

  /** Where the camera keys go: the city, the planner, the map, or the planet. */
  function cameraTarget(): { nudge(dx: number, dy: number): void; zoomStep(f: number): void } | "globe" | null {
    const resident = journey.resident;
    if (resident !== null) return planner.openId === resident ? planner : city;
    if (worldMap.isOpen) return worldMap;
    return journey.phase === "orbit" ? "globe" : null;
  }

  function zoomKey(factor: number): void {
    const target = cameraTarget();
    if (target === "globe") globe.zoomStep(factor);
    else target?.zoomStep(factor);
  }

  /** Each frame: the held camera keys move the view, at the player's camera speed. */
  let lastCameraAt: number | null = null;
  function cameraKeys(now: number): void {
    const last = lastCameraAt;
    lastCameraAt = now;
    if (held.size === 0 || last === null || pausedFrom !== null) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    const x = (held.has("panRight") ? 1 : 0) - (held.has("panLeft") ? 1 : 0);
    const y = (held.has("panDown") ? 1 : 0) - (held.has("panUp") ? 1 : 0);
    if (x === 0 && y === 0) return;
    const k = prefs().controls.cameraSpeed * dt;
    const target = cameraTarget();
    if (target === "globe") globe.turnBy(x * KEY_TURN_RAD * k, y * KEY_TURN_RAD * k);
    else target?.nudge(x * KEY_PAN_PX * k, y * KEY_PAN_PX * k);
  }

  /** A key's action, as its button would do it. */
  function command(action: ActionId): void {
    const resident = journey.resident;
    const moving = journey.phase !== "orbit" && resident === null;
    switch (action) {
      case "pause":
        if (speed !== 0) {
          resumeSpeed = speed;
          setSpeed(0);
        } else setSpeed(speeds.includes(resumeSpeed) && resumeSpeed !== 0 ? resumeSpeed : speeds.find((s) => s !== 0) ?? 1);
        return;
      case "speed1":
      case "speed2":
      case "speed3":
      case "speed4": {
        const next = speeds.filter((s) => s !== 0)[Number(action.slice(5)) - 1];
        if (next !== undefined) setSpeed(next);
        return;
      }
      case "save":
        void hooks.saveNow?.().then((said) => sayBriefly(said));
        return;
      case "objectives":
        objectives.toggle.click();
        return;
      case "alerts":
        alertCentre.toggle.click();
        return;
      case "statistics":
        statistics.toggle.click();
        return;
      case "earth":
        earth.toggle.click();
        return;
      case "worldMap":
        if (moving) return;
        if (worldMap.isOpen) worldMap.close();
        else {
          if (resident !== null) journey.goToOrbit(performance.now());
          worldMap.open();
        }
        return;
      case "orbit":
        if (resident !== null) journey.goToOrbit(performance.now());
        return;
      case "planner":
        if (resident === null) return;
        if (planner.openId === resident) {
          planner.close();
          city.root.hidden = false;
        } else {
          planner.open(resident);
          city.root.hidden = true;
        }
        return;
      case "upgrade":
        if (resident !== null && planner.openId !== resident) city.upgradeSelection();
        return;
      default:
        return;
    }
  }

  /** A word that comes and goes (the Save key's "Saved."). */
  const savedNote = document.createElement("p");
  savedNote.className = "game-saved-note";
  savedNote.setAttribute("role", "status");
  savedNote.hidden = true;
  let savedNoteTimer: ReturnType<typeof setTimeout> | null = null;
  function sayBriefly(words: string): void {
    if (words === "" || stopped) return;
    savedNote.textContent = words;
    savedNote.hidden = false;
    if (savedNoteTimer !== null) clearTimeout(savedNoteTimer);
    savedNoteTimer = setTimeout(() => {
      savedNote.hidden = true;
    }, SAVED_NOTE_MS);
  }

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
      onWorldMap: () => worldMap.open(),
    },
    tuning,
    speeds,
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
        const outcome = placeBuilding(state, id, type, tx, ty, tuning, cityEnv ?? undefined);
        state = outcome.state;
        if (outcome.ok) sound.placed(id, tx, ty, BUILDING_DEFS[type].footprint, BUILDING_DEFS[type].depth);
        return outcome;
      },
      // A dry run of the same call: the returned state is dropped.
      canPlace: (id: string, type: BuildingType, tx: number, ty: number) => checkPlacement(state, id, type, tx, ty, tuning, cityEnv ?? undefined),
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
      onMoveQueued: (id, from, to) => {
        const outcome = moveQueuedBuild(state, id, from, to);
        state = outcome.state;
        return outcome;
      },
      onCancelQueued: (id, index) => {
        const outcome = cancelQueuedBuild(state, id, index);
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
      // Up to orbit, and the map over it.
      onWorldMap: () => {
        journey.goToOrbit(performance.now());
        worldMap.open();
      },
    },
    tuning,
    prefs,
    options.frameCosts ?? null,
    isMenuKey,
  );

  /**
   * The world map (at the user's request): the middle game between orbit and a
   * city - every settlement at its place, and the railways between them.
   */
  const worldMap = new WorldMapScreen(
    root,
    {
      onOpen: (id) => {
        worldMap.close();
        journey.goTo(id, performance.now());
      },
      onConnect: (a, b) => {
        const outcome = connectSettlements(state, a, b, tuning);
        state = outcome.state;
        return outcome;
      },
      onClose: () => worldMap.close(),
    },
    tuning,
  );
  worldMap.prefs = prefs;
  worldMap.isMenuKey = isMenuKey;

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
  planner.prefs = prefs;

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
    // Batch 36: with reduced motion, no flight down and up - a cut.
    () => (reducedMotion(prefs().ui) ? 0 : TRAVEL_MS),
  );

  // Micro §1.4: "Player selects a marker and confirms travel."
  const travelPrompt = new TravelPrompt(root);
  travelPrompt.isMenuKey = isMenuKey;
  globe.onMarker = (id: string) => {
    const s = state.settlements.find((x) => x.id === id);
    if (s === undefined || s.lostAtSeaLevelM !== null || journey.phase !== "orbit" || founding !== null) return;
    travelPrompt.ask(settlementLabel(s), formatLatLon(s.lat, s.lon), () => journey.goTo(id, performance.now()));
  };

  /**
   * "See example planet": the banner says what is showing and that nothing is
   * saved, and the way back. Building the example takes about forty seconds; the
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
  exampleBack.addEventListener("click", () => (options.lookOnly ? hooks.onBackToTitle() : leaveExample()));
  exampleBanner.append(exampleText, exampleBack);
  root.append(exampleBanner);

  /**
   * The first hour (Batch 30): the guide's card, the objectives, and the
   * milestones. Skip and Claim are the player's actions, through the
   * simulation like every other; the cards and the chime only watch.
   */
  const guide = new GuidePanel(root, root, () => {
    state = skipGuide(state);
  });
  const objectives = new ObjectivesPanel(root, tuning, (id) => {
    const outcome = claimObjective(state, id, tuning);
    state = outcome.state;
    const words = rewardWords({ materials: outcome.materials, people: Math.floor(outcome.people), rovers: outcome.rovers, credits: outcome.credits, unlock: null, cosmetic: null });
    return { ok: outcome.ok, reason: outcome.reason, words: words === "" ? "the reward" : words };
  });
  const milestones = new MilestoneWatch();
  const cards = new MilestoneCards(root, (m) => sound.milestone(m.kind));
  /**
   * Events that ask for decisions (Batch 33): the card of those waiting, a
   * choice taken through the simulation like a claim. The history goes in
   * the alert centre, from the world's own record.
   */
  const decisions = new DecisionPanel(root, tuning, (id, choice) => {
    const outcome = chooseDecision(state, id, choice, tuning);
    state = outcome.state;
    return { ok: outcome.ok, reason: outcome.reason };
  }, (target) => goToAlert(target));
  let historyOf: SimState["decisions"]["log"] | null = null;
  /**
   * Knowing what is happening (Batch 31): the alerts, worked out from the
   * state at the readout; the toasts that interrupt; the centre that keeps
   * the record; and the statistics. Each clicks through to where it happened.
   * None of them writes the world.
   */
  const alertWatch = new AlertWatch();
  /** An alert clicked through to a city: the building to select once the city is down. */
  let pendingShow: { readonly id: string; readonly at: { readonly x: number; readonly y: number } | null } | null = null;
  function goToAlert(target: AlertTarget): void {
    if (target.kind === "objectives") {
      statistics.setOpen(false);
      alertCentre.setOpen(false);
      earth.setOpen(false);
      objectives.setOpen(true);
      return;
    }
    if (target.kind === "earth") {
      statistics.setOpen(false);
      alertCentre.setOpen(false);
      earth.setOpen(true);
      return;
    }
    if (worldMap.isOpen) worldMap.close();
    if (target.kind === "planet") {
      pendingShow = null;
      if (journey.resident !== null) journey.goToOrbit(performance.now());
      return;
    }
    const s = state.settlements.find((x) => x.id === target.id);
    if (s === undefined || s.lostAtSeaLevelM !== null) return;
    pendingShow = { id: target.id, at: target.at };
    if (journey.resident !== target.id) journey.goTo(target.id, performance.now());
  }
  const alertCentre = new AlertCentre(root, goToAlert, () => {
    objectives.setOpen(false);
    statistics.setOpen(false);
    earth.setOpen(false);
  });
  const toasts = new AlertToasts(root, goToAlert);
  const statistics = new StatisticsScreen(root, tuning, () => {
    objectives.setOpen(false);
    alertCentre.setOpen(false);
    earth.setOpen(false);
  });
  /** Beside the Menu button: the statistics and the alerts - and Earth. */
  const bar = document.createElement("div");
  bar.className = "game-bar";
  bar.append(statistics.toggle, alertCentre.toggle);
  root.append(bar);
  /**
   * Earth (Batch 34): trade with Earth, its contracts and the rockets, in a
   * panel from the bar. An order, a cancel and an acceptance go through the
   * simulation, as a claim does; the panel only reads.
   */
  const earth = new EarthPanel(
    root,
    tuning,
    {
      onOrder: (id, good, side, amount) => {
        const outcome = orderFromEarth(state, id, good, side, amount, tuning);
        state = outcome.state;
        return outcome;
      },
      onCancel: (order) => {
        const outcome = cancelEarthOrder(state, order, tuning);
        state = outcome.state;
        return outcome;
      },
      onAccept: () => {
        const outcome = acceptContract(state, tuning);
        state = outcome.state;
        return outcome;
      },
      onGo: (target) => goToAlert(target),
      onOpen: () => {
        objectives.setOpen(false);
        statistics.setOpen(false);
        alertCentre.setOpen(false);
      },
    },
    bar,
  );
  // Objectives open where Earth does: one at a time.
  objectives.toggle.addEventListener("click", () => {
    if (objectives.isOpen) earth.setOpen(false);
  });
  let lastAlerts = -Infinity;
  /** What each settlement is short of at the last look: the overview cards read it. */
  let shortBy: ReadonlyMap<string, readonly MicroResource[]> = new Map();

  /** Where the player is looking, for the guide's words. */
  function guideContext(): GuideContext {
    const resident = journey.resident;
    if (resident !== null) return planner.openId === resident ? "planner" : "city";
    return worldMap.isOpen ? "map" : "orbit";
  }

  function freshViews(): void {
    milestones.reset();
    sound.reset();
    cards.clear();
    decisions.clear();
    earth.clear();
    historyOf = null;
    alertWatch.reset();
    alertCentre.clear();
    toasts.clear();
    pendingShow = null;
    lastAlerts = -Infinity;
    shortBy = new Map();
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
    // Let the banner paint before the build (about forty seconds).
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
        state = options.fresh();
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
        alertWatch.reset();
        alertCentre.clear();
        toasts.clear();
        sound.reset();
        pendingShow = null;
        clock.resync();
      },
    },
    tuning,
    globe,
    speeds,
  );

  // The tab stops receiving animation frames when hidden, so the first frame
  // back would otherwise carry the whole absence as one enormous delta.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        // Hiding is the moment a tab is most likely never to come back.
        persist();
      } else {
        clock.resync();
      }
    },
    { signal },
  );

  // `pagehide` fires on close and on bfcache eviction, where `beforeunload` does
  // not. The write is best-effort: the browser may not wait for it.
  window.addEventListener(
    "pagehide",
    () => {
      persist();
    },
    { signal },
  );

  let lastReadout = 0;
  /** Net flow into liquid water at the last readout, m/yr: the sea level's rate reads it (Batch 23). */
  let liquidRate = 0;
  /** The planet as the cities see it this frame: what wind turbines and parks wait for (the same the city view shows). */
  let cityEnv: HabitatChannels | null = null;
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
    if (stopped) return;
    if (lastFrameAt !== null) playedMs += Math.min(1000, Math.max(0, timestamp - lastFrameAt));
    lastFrameAt = timestamp;
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
    cityEnv = habitat(state.reservoirs, d, tuning, liquidRate);
    const throttled = scrubberThrottled(state, d, tuning);
    const progress = world.progress;
    const phase = world.phase;
    const reached = advanced.reached;

    const year = simYear(state, tuning);

    journey.frame(timestamp);
    const resident = journey.resident;
    // An alert clicked through: once its city is down, its building selected and brought into view.
    if (pendingShow !== null && resident === pendingShow.id) {
      const here = state.settlements.find((x) => x.id === pendingShow!.id);
      if (planner.openId === pendingShow.id) {
        planner.close();
        city.root.hidden = false;
      }
      const index = here === undefined || pendingShow.at === null ? -1 : buildingAt(here, pendingShow.at, tuning);
      if (index >= 0) city.show(index);
      pendingShow = null;
    }
    if (resident !== null) {
      const here = state.settlements.find((s) => s.id === resident);
      if (here === undefined) journey.abort();
      else if (planner.openId === resident) planner.frame(here, habitat(state.reservoirs, d, tuning, liquidRate), timestamp);
      else city.frame(here, habitat(state.reservoirs, d, tuning, liquidRate), timestamp, clock.pendingYears * tuning.CITY_CLOCK);
    }
    if (worldMap.isOpen) worldMap.frame(state, habitat(state.reservoirs, d, tuning, liquidRate), timestamp);
    // Sound (Batch 35): in the city view the camera hears the city; anywhere else, the planet from afar.
    const ear = resident !== null && planner.openId !== resident ? city.ear() : null;
    if (ear !== null) sound.city(ear, timestamp, () => trainCars(ear.view, timestamp / 1000));
    else sound.orbit();

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
      /** The planet as the cities see it at this readout: what the flood words, the overviews and the alerts read. */
      const hab = habitat(state.reservoirs, d, tuning, liquidRate);
      // §9's dust channel carries the weather as well as the outgassing.
      const storm = stormIntensity(state.seed, year, tuning);
      visuals = deriveVisuals(state.reservoirs, d, flows, tuning, storm);
      // The music by the phase, the planet's beds, and what the world did - nothing of it while the example shows.
      sound.readout({ state, derived: d, storm, seaLevelM: hab.seaLevelM, cues: !example.active });

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
        // Batch 25: the flood forecast, asked of the simulation - with flooding off, none.
        floodWarnings: floodWarnings(state, hab, liquidRate, tuning),
        // Batch 31: each city at a glance, from the same substep the alerts read.
        overviews: new Map(
          state.settlements
            .filter((s) => s.lostAtSeaLevelM === null)
            .map((s) => {
              const o = cityOverview(s, shortBy.get(s.id) ?? [], tuning);
              return [s.id, { words: overviewWords(o, s), short: o.short.length > 0 }] as const;
            }),
        ),
        founding,
        foundingSite: founding === null ? null : foundingSite,
        canFoundMetropolis: tuning.SANDBOX_ENABLED > 0 || hasUnlock(state, "metropolis", tuning),
      });

      globe.setSettlements(state.settlements);
      globe.setGold(hasCosmetic(state, "gold_markers", tuning));
      // The first hour (Batch 30): nothing of it while the example planet shows - that is not the player's world.
      const mine = !example.active;
      guide.update(mine ? guideHint({ state, tuning, context: guideContext(), founding: founding !== null, selected: city.hasSelection }) : null);
      objectives.update(mine ? objectiveStatus(state, tuning) : []);
      if (mine) cards.push(milestones.observe(state, tuning));
      decisions.update(mine ? state : null, speed);
      earth.update(mine ? state : null, speed);
      statistics.update(state);
      // The alerts, a couple of times a second (`ALERT_HZ`); none while the example planet shows.
      if (mine && timestamp - lastAlerts >= 1000 / ALERT_HZ) {
        lastAlerts = timestamp;
        const look = alertWatch.observe({ state, env: hab, liquidRatePerYear: liquidRate, tuning, now: timestamp, speed, budgetMs: ALERT_BUDGET_MS, clock: () => performance.now() });
        alertCentre.update(look.now, look.fresh, year);
        if (historyOf !== state.decisions.log) {
          historyOf = state.decisions.log;
          alertCentre.setHistory(historyLines(state, tuning));
        }
        // Batch 36: what pops up (and is heard) is the player's choice; the centre keeps every one.
        const popups = prefs().ui.popups;
        const popping = popups === "all" ? look.fresh : popups === "urgent" ? look.fresh.filter((a) => a.priority === "urgent") : [];
        toasts.push(popping);
        sound.alerts(popping);
        shortBy = shortagesOf(look.now);
        worldMap.shortages = shortBy;
      }
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

    cards.frame(timestamp);
    toasts.frame(timestamp);
    cameraKeys(timestamp);

    if (example.mayPersist && !options.lookOnly && hooks.saveDue()) {
      hooks.save(state);
      const failures = hooks.saveFailures();
      if (failures > 0) {
        storageWarning = `saving is failing (${failures} attempts) - progress may not survive a reload`;
      }
    }

    frameId = requestAnimationFrame(render);
  }

  // A world that never saves (the example planet from the title) says so, and the way back.
  if (options.lookOnly) {
    exampleText.textContent = options.lookOnly.banner;
    exampleBack.textContent = "Back to title";
    exampleBack.hidden = false;
    exampleBanner.hidden = false;
  }

  /** The Menu button: the world's menu from any view, the city's included. */
  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "game-menu-button";
  menuButton.textContent = "Menu";
  menuButton.setAttribute("aria-haspopup", "dialog");
  menuButton.addEventListener("click", () => hooks.onMenu());
  root.append(menuButton, savedNote);

  frameId = requestAnimationFrame(render);

  return {
    get state(): SimState {
      return example.mine(state);
    },
    get mayPersist(): boolean {
      return !options.lookOnly;
    },
    get visuals(): VisualChannels | null {
      return visuals;
    },
    get yaw(): number {
      return globe.currentPose().yaw;
    },
    get terrain(): TerrainRotation {
      return globe.terrainRotation;
    },
    get playedMs(): number {
      return playedMs;
    },
    get speed(): Speed {
      return speed;
    },
    views: { city, planner, worldMap, globe },
    setPaused(paused: boolean): void {
      if (paused && pausedFrom === null) {
        pausedFrom = speed;
        setSpeed(0);
      } else if (!paused && pausedFrom !== null) {
        setSpeed(pausedFrom);
        pausedFrom = null;
      }
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frameId);
      listening.abort();
      if (savedNoteTimer !== null) clearTimeout(savedNoteTimer);
      resizeObserver?.disconnect();
      journey.abort();
      sound.stop();
      globe.dispose();
      city.dispose();
      worldMap.dispose();
      travelPrompt.dispose();
      guide.dispose();
      root.remove();
    },
  };
}
