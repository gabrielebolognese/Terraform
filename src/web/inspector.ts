/**
 * The live sim inspector.
 *
 * This is a DEBUG INSTRUMENT, not the game's UI. It reads simulation state and
 * never writes to it (invariant #2), and it exists so the numbers can be
 * watched moving.
 *
 * It feeds the planet - the full-screen globe behind it - through a
 * `PlanetSink` that is handed nothing but the section 9 channels, live or
 * from the arc scrubber. The two stay strictly separate: this file reaches
 * into reservoirs freely because that is its job; the globe never sees one.
 *
 * The DOM is built once; updates only ever set `textContent` and a few inline
 * widths, at READOUT_HZ rather than at frame rate.
 */

import type {
  Derived,
  Env,
  FacilityKind,
  FacilityType,
  Phase,
  ProgressAxes,
  SimState,
  Tuning,
} from "../sim/index.js";
import type { FacilityDef } from "../sim/index.js";
import type { VisualChannels } from "../sim/index.js";
import { FACILITY_LIST, PHASE_INFO, RESERVOIR_KEYS, TARGETS, toHex } from "../sim/index.js";
import { P_AXIS_HI, P_AXIS_LO, SPEEDS, T_AXIS_HI, T_AXIS_LO } from "./config.js";
import type { Speed } from "./config.js";
import type { Ring } from "./ring.js";
import type { ArcSample } from "./arc.js";
import { recordArc } from "./arc.js";
import type { PlanetSink } from "./globe.js";

const NO_PLANET: PlanetSink = { update: () => undefined };
import { Sparkline } from "./sparkline.js";
import { formatMetres } from "./settlement-label.js";

/** One row of the facility panel: what is ordered, and what is online. */
export interface LeverView {
  readonly type: FacilityType;
  readonly name: string;
  readonly summary: string;
  readonly caution: string;
  readonly kind: FacilityKind;
  readonly unit: string;
  readonly ordered: number;
  readonly deployed: number;
  readonly enabled: boolean;
  /** Set when the lever is present but being held back, e.g. the scrubber at the pressure floor. */
  readonly throttled: boolean;
}

export interface InspectorView {
  readonly simYear: number;
  readonly state: SimState;
  readonly derived: Derived;
  readonly progress: number;
  readonly progressRaw: number;
  readonly axes: ProgressAxes;
  readonly phase: Phase;
  readonly phaseReached: Phase;
  readonly dTdt: number;
  readonly droppedYears: number;
  readonly env: Env;
  readonly levers: readonly LeverView[];
  readonly shieldStrength: number;
  readonly speed: Speed;
  readonly seedMessage: string | null;
  /** "While you were away", when a save was resumed. */
  readonly awayMessage: string | null;
  /** Set when persistence is unavailable or failing, so progress is not silently lost. */
  readonly storageWarning: string | null;
  /** The section 9 channels. This is everything a renderer is allowed to read. */
  readonly visuals: VisualChannels;
  /** Detail §4.1 (Batch 23): the waterline and how fast it moves. */
  readonly seaLevel: { readonly m: number; readonly ratePerYear: number };
}

export interface InspectorHooks {
  readonly onSpeed: (speed: Speed) => void;
  /** Order `delta` more (or fewer) units of a lever. */
  readonly onOrder: (type: FacilityType, delta: number) => void;
  readonly onToggleLever: (type: FacilityType) => void;
  readonly onSeed: () => void;
  readonly onReset: () => void;
}

interface LeverRow {
  readonly status: HTMLElement;
  readonly fill: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly note: HTMLElement;
  /** The whole row, so the shell can scroll to the lever it just recommended. */
  readonly root: HTMLElement;
}

interface ReservoirMeta {
  readonly label: string;
  readonly unit: string;
  readonly digits: number;
  readonly scale: number;
}

const RESERVOIR_META: Readonly<Record<(typeof RESERVOIR_KEYS)[number], ReservoirMeta>> = {
  co2_atm: { label: "CO2 atmosphere", unit: "mbar", digits: 2, scale: 1013 },
  co2_cap: { label: "CO2 polar caps", unit: "mbar-eq", digits: 2, scale: 40 },
  co2_reg: { label: "CO2 regolith", unit: "mbar-eq", digits: 1, scale: 260 },
  n2: { label: "Nitrogen", unit: "mbar", digits: 2, scale: 800 },
  n2_reg: { label: "Nitrate regolith", unit: "mbar-eq", digits: 2, scale: 20 },
  o2: { label: "Oxygen", unit: "mbar", digits: 2, scale: 210 },
  h2o_ice: { label: "Water ice", unit: "m SLE", digits: 2, scale: 40 },
  h2o_liq: { label: "Liquid water", unit: "m SLE", digits: 2, scale: 40 },
  h2o_vap: { label: "Water vapour", unit: "mbar", digits: 3, scale: 20 },
  ghg: { label: "Engineered GHG", unit: "mbar", digits: 3, scale: 5 },
  biomass: { label: "Biomass", unit: "index", digits: 4, scale: 1 },
};



function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Inspector {
  private readonly phaseName: HTMLElement;
  private readonly phaseCaption: HTMLElement;
  private readonly phasePips: readonly HTMLElement[];
  private readonly progressFill: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly yearLabel: HTMLElement;
  private readonly droppedLabel: HTMLElement;
  private readonly seedNote: HTMLElement;
  private readonly awayNote: HTMLElement;
  private readonly storageNote: HTMLElement;
  private readonly derivedValues = new Map<string, HTMLElement>();
  private readonly reservoirValues = new Map<string, HTMLElement>();
  private readonly reservoirBars = new Map<string, HTMLElement>();
  private readonly axisFills = new Map<string, HTMLElement>();
  private readonly axisValues = new Map<string, HTMLElement>();
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();
  private readonly visualFills = new Map<string, HTMLElement>();
  private readonly visualValues = new Map<string, HTMLElement>();
  private readonly swatches = new Map<string, { chip: HTMLElement; value: HTMLElement }>();
  private readonly leverRows = new Map<FacilityType, LeverRow>();
  private readonly shieldLabel: HTMLElement;
  private readonly planet: PlanetSink;
  private readonly scrubToggle: HTMLButtonElement;
  private readonly scrubRange: HTMLInputElement;
  private readonly scrubLabel: HTMLElement;
  /** Recorded on first use, then kept - it costs about 160 ms to make. */
  private arc: readonly ArcSample[] | null = null;
  private scrubbing = false;
  /** The most recent live channels, so leaving the scrubber can restore them. */
  private lastLive: VisualChannels | null = null;
  private readonly sparkT: Sparkline;
  private readonly sparkP: Sparkline;
  private readonly sparkProgress: Sparkline;

  /**
   * `planet` is where the channels go: the full-screen globe in the browser.
   * The inspector used to own a 260 px canvas of its own; the planet now fills
   * the page behind it, and the scrubber drives that instead.
   */
  constructor(root: HTMLElement, hooks: InspectorHooks, tuning: Tuning, planet: PlanetSink = NO_PLANET) {
    root.textContent = "";
    const app = el("div", "app");

    // ---- header: phase, progress, clock -----------------------------------
    const header = el("header", "header");
    const titleRow = el("div", "title-row");
    titleRow.append(el("h1", "title", "Terraform"), el("span", "subtitle", "macro sim inspector"));
    header.append(titleRow);

    this.phaseName = el("div", "phase-name", "Barren");
    this.phaseCaption = el("div", "phase-caption", "");
    header.append(this.phaseName, this.phaseCaption);

    const pipRow = el("div", "pips");
    this.phasePips = [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const pip = el("span", "pip");
      pip.title = PHASE_INFO[i as Phase].name;
      pipRow.append(pip);
      return pip;
    });
    header.append(pipRow);

    const bar = el("div", "progress");
    this.progressFill = el("div", "progress-fill");
    bar.append(this.progressFill);
    this.progressLabel = el("div", "progress-label", "0.0%");
    this.yearLabel = el("div", "year", "year 0");
    this.droppedLabel = el("div", "dropped", "");
    const barRow = el("div", "bar-row");
    barRow.append(bar, this.progressLabel);
    header.append(barRow, this.yearLabel, this.droppedLabel);
    app.append(header);

    // ---- controls ---------------------------------------------------------
    const controlPanel = el("section", "panel controls");
    controlPanel.append(el("h2", "panel-title", "Controls"));

    const speedRow = el("div", "row speeds");
    speedRow.append(el("span", "row-label", "Speed"));
    for (const speed of SPEEDS) {
      const button = el("button", "chip", speed === 0 ? "pause" : `${speed}x`);
      button.addEventListener("click", () => hooks.onSpeed(speed));
      speedRow.append(button);
      this.speedButtons.set(speed, button);
    }
    controlPanel.append(speedRow);

    const actionRow = el("div", "row actions");
    const seedButton = el("button", "action primary", "Seed biosphere");
    seedButton.addEventListener("click", hooks.onSeed);
    const resetButton = el("button", "action", "Reset planet");
    resetButton.addEventListener("click", hooks.onReset);
    actionRow.append(seedButton, resetButton);
    this.seedNote = el("div", "note", "");
    this.shieldLabel = el("div", "note", "");
    this.awayNote = el("div", "note away", "");
    this.storageNote = el("div", "note warn", "");
    controlPanel.append(actionRow, this.seedNote, this.shieldLabel, this.awayNote, this.storageNote);
    app.append(controlPanel);

    // ---- levers (section 5) -----------------------------------------------
    const leverPanel = el("section", "panel wide levers-panel");
    leverPanel.append(el("h2", "panel-title", "Levers"));
    for (const def of FACILITY_LIST) {
      if (def.kind === "action") continue;
      leverPanel.append(this.buildLeverRow(def, hooks));
    }
    app.append(leverPanel);

    // ---- derived ----------------------------------------------------------
    const derivedPanel = el("section", "panel");
    derivedPanel.append(el("h2", "panel-title", "Derived"));
    const grid = el("div", "stat-grid");
    const stats: readonly [string, string][] = [
      ["T", "temperature"],
      ["P", "pressure"],
      ["albedo", "albedo"],
      ["ice", "ice cover"],
      ["ocean", "ocean cover"],
      ["veg", "vegetation"],
      ["cloud", "cloud cover"],
      ["dTdt", "warming rate"],
      ["solar", "solar flux"],
      ["sea", "sea level"],
    ];
    for (const [key, label] of stats) {
      const cell = el("div", "stat");
      const value = el("div", "stat-value", "-");
      cell.append(value, el("div", "stat-label", label));
      grid.append(cell);
      this.derivedValues.set(key, value);
    }
    derivedPanel.append(grid);

    const sparkGrid = el("div", "sparks");
    const makeSpark = (label: string, note: string): Sparkline => {
      const wrap = el("div", "spark");
      wrap.append(el("div", "spark-label", label));
      const canvas = el("canvas", "spark-canvas");
      wrap.append(canvas, el("div", "spark-note", note));
      sparkGrid.append(wrap);
      return new Sparkline(canvas);
    };
    this.sparkT = makeSpark("temperature", `${T_AXIS_LO}-${T_AXIS_HI} K`);
    this.sparkP = makeSpark("pressure", `${P_AXIS_LO}-${P_AXIS_HI} mbar, log`);
    this.sparkProgress = makeSpark("progress", "0-1");
    derivedPanel.append(sparkGrid);
    app.append(derivedPanel);

    // ---- the section 9 visual contract ------------------------------------
    const visualPanel = el("section", "panel");
    visualPanel.append(el("h2", "panel-title", "Visual channels (section 9)"));
    visualPanel.append(
      el("div", "panel-note", "Everything a renderer is allowed to read. None of it knows about phases."),
    );

    // The planet itself is the page behind this panel; these numbers are what
    // it is drawn from, so a channel that looks wrong can be checked here.
    this.planet = planet;

    /**
     * The arc scrubber.
     *
     * The planet changes over sim-millennia, so at any watchable speed the
     * whole visual arc takes hours to see. This drags through a recorded
     * reference playthrough in seconds, which is the only practical way to
     * review whether §0.3 is actually satisfied end to end.
     *
     * The recording is lazy: it blocks the main thread for about 160 ms, and
     * most sessions never touch this control.
     */
    const scrub = el("div", "scrub");
    this.scrubToggle = el("button", "scrub-toggle", "Review arc");
    this.scrubRange = el("input", "scrub-range");
    this.scrubRange.type = "range";
    this.scrubRange.min = "0";
    this.scrubRange.max = "1000";
    this.scrubRange.value = "0";
    this.scrubRange.disabled = true;
    this.scrubLabel = el("div", "scrub-label", "live");
    scrub.append(this.scrubToggle, this.scrubRange, this.scrubLabel);
    visualPanel.append(scrub);

    this.scrubToggle.addEventListener("click", () => {
      if (this.arc !== null) {
        this.scrubbing = !this.scrubbing;
        this.applyScrub();
        return;
      }
      // Recording blocks; say so before it starts, not after.
      this.scrubLabel.textContent = "recording arc...";
      this.scrubToggle.disabled = true;
      setTimeout(() => {
        this.arc = recordArc(tuning);
        this.scrubToggle.disabled = false;
        this.scrubbing = true;
        this.applyScrub();
      }, 0);
    });

    this.scrubRange.addEventListener("input", () => {
      if (!this.scrubbing) return;
      this.applyScrub();
    });

    const swatchRow = el("div", "swatches");
    for (const [key, label] of [
      ["skyColour", "sky"],
      ["surfaceTint", "surface tint"],
    ] as const) {
      const cell = el("div", "swatch");
      const chip = el("div", "swatch-chip");
      const value = el("div", "swatch-value", "-");
      cell.append(chip, el("div", "swatch-label", label), value);
      swatchRow.append(cell);
      this.swatches.set(key, { chip, value });
    }
    visualPanel.append(swatchRow);

    for (const [key, label] of [
      ["capRadius", "polar cap radius"],
      ["oceanCoverage", "ocean coverage"],
      ["surfaceGreen", "surface greenness"],
      ["atmosphereThickness", "atmosphere / rim glow"],
      ["cloudCover", "cloud cover"],
      ["dustIntensity", "dust storms"],
      ["clearFraction", "clear fraction"],
    ] as const) {
      const row = el("div", "axis");
      const value = el("span", "axis-value", "0%");
      row.append(el("span", "axis-label", label), value);
      const track = el("div", "axis-track");
      const fill = el("div", "axis-fill visual");
      track.append(fill);
      row.append(track);
      visualPanel.append(row);
      this.visualFills.set(key, fill);
      this.visualValues.set(key, value);
    }
    app.append(visualPanel);

    // ---- progress axes ----------------------------------------------------
    const axisPanel = el("section", "panel");
    axisPanel.append(el("h2", "panel-title", "Progress axes"));
    const axisMeta: readonly [string, string][] = [
      ["nT", `temperature -> ${TARGETS.T.target} K`],
      ["nP", `pressure -> ${TARGETS.P.target} mbar`],
      ["nO2", `oxygen -> ${TARGETS.o2.target} mbar`],
      ["nWater", `ocean -> ${TARGETS.ocean.target}`],
      ["nBio", `biomass -> ${TARGETS.biomass.target}`],
      ["nCO2", `CO2 composition -> ${TARGETS.co2_atm.target} mbar at 1 bar`],
    ];
    for (const [key, label] of axisMeta) {
      const row = el("div", "axis");
      const value = el("span", "axis-value", "0%");
      row.append(el("span", "axis-label", label), value);
      const track = el("div", "axis-track");
      const fill = el("div", "axis-fill");
      track.append(fill);
      row.append(track);
      axisPanel.append(row);
      this.axisFills.set(key, fill);
      this.axisValues.set(key, value);
    }
    app.append(axisPanel);

    // ---- reservoirs -------------------------------------------------------
    const reservoirPanel = el("section", "panel wide");
    reservoirPanel.append(el("h2", "panel-title", "Reservoirs"));
    for (const key of RESERVOIR_KEYS) {
      const meta = RESERVOIR_META[key];
      const row = el("div", "res");
      const value = el("span", "res-value", "-");
      row.append(el("span", "res-label", meta.label), value);
      const track = el("div", "res-track");
      const fill = el("div", "res-fill");
      track.append(fill);
      row.append(track);
      reservoirPanel.append(row);
      this.reservoirValues.set(key, value);
      this.reservoirBars.set(key, fill);
    }
    app.append(reservoirPanel);

    const footer = el("footer", "footer");
    footer.textContent =
      `substep ${tuning.SUBSTEP_YEARS} yr · ${tuning.TIME_SCALE} sim-yr per real second at 1x · ` +
      "this is an instrument, not the renderer";
    app.append(footer);

    root.append(app);
  }

  /**
   * One lever row: name, what is online out of what is ordered, and the
   * order/dismantle controls.
   *
   * The ordered-vs-online split is the section 5 design rule made visible.
   * A player who presses "+10" and sees nothing happen on the temperature
   * readout needs to see WHY, and "3 of 13 units online" says it.
   */
  private buildLeverRow(def: FacilityDef, hooks: InspectorHooks): HTMLElement {
    const row = el("div", "lever-row");
    row.title = `${def.summary}

${def.caution}`;

    const head = el("div", "lever-head");
    const name = el("span", "lever-name", def.name);
    const status = el("span", "lever-status", "-");
    head.append(name, status);

    const track = el("div", "lever-track");
    const fill = el("div", "lever-fill");
    track.append(fill);

    const buttons = el("div", "lever-buttons");
    for (const delta of [-10, -1, 1, 10]) {
      const button = el("button", "chip tiny", delta > 0 ? `+${delta}` : `${delta}`);
      button.addEventListener("click", () => hooks.onOrder(def.type, delta));
      buttons.append(button);
    }
    const toggle = el("button", "chip tiny toggle", "on");
    toggle.addEventListener("click", () => hooks.onToggleLever(def.type));
    buttons.append(toggle);

    const note = el("div", "lever-note", "");

    row.append(head, track, buttons, note);
    this.leverRows.set(def.type, { status, fill, toggle, note, root: row });
    return row;
  }

  update(view: InspectorView, rings: { T: Ring; P: Ring; progress: Ring }): void {
    const { derived: d, state } = view;
    const info = PHASE_INFO[view.phaseReached];

    // Section 7's phases latch, but the instantaneous value can fall - an
    // oxygen fire really does un-make a biosphere - and a player who has just
    // broken something should see that rather than only the high-water mark.
    this.phaseName.textContent =
      view.phase < view.phaseReached
        ? `Phase ${view.phaseReached} — ${info.name} (now at ${view.phase})`
        : `Phase ${view.phaseReached} — ${info.name}`;
    this.phaseCaption.textContent = info.caption;
    this.phasePips.forEach((pip, i) => {
      pip.classList.toggle("on", i <= view.phaseReached);
    });

    const pct = view.progress * 100;
    this.progressFill.style.width = `${pct.toFixed(2)}%`;
    this.progressLabel.textContent = `${pct.toFixed(1)}%`;
    this.progressLabel.title = `raw (unfloored) ${(view.progressRaw * 100).toFixed(2)}%`;
    this.yearLabel.textContent = `sim-year ${view.simYear.toFixed(1)} · ${view.speed === 0 ? "paused" : `${view.speed}x`}`;
    this.droppedLabel.textContent =
      view.droppedYears > 0 ? `dropped ${view.droppedYears.toFixed(2)} sim-years this frame (frame budget)` : "";

    this.setStat("T", `${d.T.toFixed(1)} K`);
    this.setStat("P", `${d.P.toFixed(1)} mbar`);
    this.setStat("albedo", d.albedo.toFixed(3));
    this.setStat("ice", `${(d.iceFrac * 100).toFixed(1)}%`);
    this.setStat("ocean", `${(d.oceanFrac * 100).toFixed(1)}%`);
    this.setStat("veg", `${(d.vegFrac * 100).toFixed(1)}%`);
    this.setStat("cloud", `${(d.cloudFrac * 100).toFixed(1)}%`);
    this.setStat("dTdt", `${view.dTdt >= 0 ? "+" : ""}${(view.dTdt * 100).toFixed(2)} K/century`);
    // The mirror/shade multiplier is the one player input nothing else shows.
    this.setStat("solar", `x${view.env.sMultiplier.toFixed(3)}`);
    // Before any ocean the curve's floor is the lowest point on the planet, not a waterline.
    const sea = view.seaLevel;
    this.setStat(
      "sea",
      d.oceanFrac <= 0
        ? "no sea yet"
        : `${formatMetres(sea.m)} (${sea.ratePerYear >= 0 ? "+" : "\u2212"}${Math.abs(sea.ratePerYear).toFixed(2)} m/yr)`,
    );

    const axes: readonly [string, number][] = [
      ["nT", view.axes.nT],
      ["nP", view.axes.nP],
      ["nO2", view.axes.nO2],
      ["nWater", view.axes.nWater],
      ["nBio", view.axes.nBio],
      ["nCO2", view.axes.nCO2],
    ];
    for (const [key, value] of axes) {
      const fill = this.axisFills.get(key);
      const label = this.axisValues.get(key);
      if (fill) fill.style.width = `${(value * 100).toFixed(2)}%`;
      if (label) label.textContent = `${(value * 100).toFixed(0)}%`;
    }

    for (const key of RESERVOIR_KEYS) {
      const meta = RESERVOIR_META[key];
      const amount = state.reservoirs[key];
      const value = this.reservoirValues.get(key);
      const fill = this.reservoirBars.get(key);
      if (value) value.textContent = `${amount.toFixed(meta.digits)} ${meta.unit}`;
      if (fill) fill.style.width = `${Math.min(100, (amount / meta.scale) * 100).toFixed(2)}%`;
    }

    for (const [speed, button] of this.speedButtons) {
      button.classList.toggle("on", speed === view.speed);
    }

    for (const lever of view.levers) {
      const row = this.leverRows.get(lever.type);
      if (!row) continue;
      const online = lever.deployed.toFixed(lever.deployed % 1 === 0 ? 0 : 1);
      row.status.textContent =
        lever.ordered === 0 && lever.deployed === 0 ? "not built" : `${online} of ${lever.ordered} units online`;
      row.fill.style.width = `${Math.min(100, (lever.deployed / Math.max(1, lever.ordered)) * 100).toFixed(1)}%`;
      row.toggle.textContent = lever.enabled ? "on" : "off";
      row.toggle.classList.toggle("on", lever.enabled);
      row.note.textContent = lever.throttled
        ? "held back: scrubbing further would push pressure under the triple point and lock liquid water out"
        : lever.deployed < lever.ordered
          ? "coming online"
          : lever.deployed > lever.ordered
            ? "retiring"
            : "";
    }

    this.lastLive = view.visuals;
    if (!this.scrubbing) this.planet.update(view.visuals);

    for (const [key, colour] of [
      ["skyColour", view.visuals.skyColour],
      ["surfaceTint", view.visuals.surfaceTint],
    ] as const) {
      const swatch = this.swatches.get(key);
      if (!swatch) continue;
      const hex = toHex(colour);
      swatch.chip.style.background = hex;
      swatch.value.textContent = hex;
    }

    for (const key of [
      "capRadius",
      "oceanCoverage",
      "surfaceGreen",
      "atmosphereThickness",
      "cloudCover",
      "dustIntensity",
      "clearFraction",
    ] as const) {
      const amount = view.visuals[key];
      const fill = this.visualFills.get(key);
      const label = this.visualValues.get(key);
      if (fill) fill.style.width = `${(amount * 100).toFixed(1)}%`;
      if (label) label.textContent = `${(amount * 100).toFixed(1)}%`;
    }

    this.seedNote.textContent = view.seedMessage ?? "";
    this.awayNote.textContent = view.awayMessage ?? "";
    this.storageNote.textContent = view.storageWarning ?? "";
    this.shieldLabel.textContent =
      view.shieldStrength > 0 ? `magnetic shield at ${(view.shieldStrength * 100).toFixed(0)}%` : "";

    this.sparkT.draw(rings.T, { lo: T_AXIS_LO, hi: T_AXIS_HI, log: false, colour: "#e3b46e" });
    this.sparkP.draw(rings.P, { lo: P_AXIS_LO, hi: P_AXIS_HI, log: true, colour: "#82b4ff" });
    this.sparkProgress.draw(rings.progress, { lo: 0, hi: 1, log: false, colour: "#7fd49a" });
  }

  private setStat(key: string, text: string): void {
    const node = this.derivedValues.get(key);
    if (node) node.textContent = text;
  }
  /**
   * Draw whatever the scrubber is pointing at, or hand the planet back to the
   * live simulation.
   *
   * The live channels keep arriving at READOUT_HZ the whole time this is
   * engaged - `update` simply stops forwarding them - so leaving the scrubber
   * never leaves the planet showing a stale world.
   */
  private applyScrub(): void {
    if (this.arc === null) return;

    if (!this.scrubbing) {
      this.scrubToggle.textContent = "Review arc";
      this.scrubRange.disabled = true;
      this.scrubLabel.textContent = "live";
      if (this.lastLive !== null) this.planet.update(this.lastLive);
      return;
    }

    this.scrubToggle.textContent = "Back to live";
    this.scrubRange.disabled = false;

    const t = Number(this.scrubRange.value) / Number(this.scrubRange.max);
    const index = Math.min(this.arc.length - 1, Math.round(t * (this.arc.length - 1)));
    const sample = this.arc[index];
    if (sample === undefined) return;

    this.planet.update(sample.channels);
    this.scrubLabel.textContent = `year ${sample.year.toFixed(0)} - ${(sample.progress * 100).toFixed(0)}% done`;
  }


  /**
   * Bring a lever into view and mark it, for when the shell has just acted on
   * the player's behalf.
   *
   * Without this, clicking "Order one" in the guidance panel changes a number
   * somewhere off-screen and reads as nothing having happened.
   */
  focusLever(type: FacilityType): void {
    const row = this.leverRows.get(type);
    if (row === undefined) return;
    row.root.scrollIntoView({ behavior: "smooth", block: "center" });
    row.root.classList.remove("lever-flash");
    // Force a reflow so the class re-applies even on consecutive clicks.
    void row.root.offsetWidth;
    row.root.classList.add("lever-flash");
  }

}
