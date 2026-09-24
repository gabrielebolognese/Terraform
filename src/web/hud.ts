/**
 * The game shell - Batch 7.
 *
 * `inspector.ts` is a debug instrument: it shows everything, equally, because
 * that is what debugging needs. This is the opposite. It shows a player where
 * they are (§7's phase), how far along (§8.1's composite), how each §2.3 band
 * is doing, and - the batch's exit gate - what the planet needs next.
 *
 * ACCESSIBILITY IS LOAD-BEARING HERE, not a pass at the end. In this game
 * colour IS the progress signal: the planet goes rust to blue, the sky goes
 * butterscotch to pale, and §9's whole contract is a set of colours. A shell
 * that also signalled state through colour alone would leave a colourblind
 * player with no channel at all. So every bar carries its number, every state
 * carries a word, and every meter carries its ARIA value. `hud.test.ts`
 * asserts it rather than trusting this paragraph.
 */

import type { Derived, FacilityType, Phase, ProgressAxes, Reservoirs, Settlement, SettlementKind, Tuning } from "../sim/index.js";
import { FACILITY_LIST, livingWorldShortfall, PHASE_INFO, TARGETS, siteElevation } from "../sim/index.js";
import type { Advice } from "./guidance.js";
import type { BuildRow } from "./build.js";
import { formatLatLon, formatMetres, settlementLabel } from "./settlement-label.js";
import type { GameEvent } from "./events.js";
import type { Speed } from "./config.js";
import { READOUT_HZ, SPEEDS } from "./config.js";

export interface HudView {
  readonly simYear: number;
  readonly phase: Phase;
  readonly phaseReached: Phase;
  readonly progress: number;
  readonly axes: ProgressAxes;
  readonly derived: Derived;
  readonly reservoirs: Reservoirs;
  readonly advice: Advice;
  readonly events: readonly GameEvent[];
  /** Headline events since the last update, for the transition banner. */
  readonly fresh: readonly GameEvent[];
  readonly speed: Speed;
  readonly canSeed: boolean;
  /**
   * Whether the advised lever could actually be ordered right now.
   *
   * Asked of the simulation by `main.ts`, not re-derived here. `canSeed`
   * covered only seeding, so once costs existed the shell offered an "Order
   * one" button for a lever there was no money for - the same failure
   * `canSeed` was added to prevent, one lever over.
   */
  readonly canOrder: boolean;
  /** Batch 9. Null when the economy is off, so the shell simply shows nothing. */
  readonly economy: { readonly credits: number; readonly income: number; readonly upkeep: number } | null;
  /** A refused order, to be shown until the next one succeeds. */
  readonly notice: string | null;
  /** Batch 16: every buildable lever, asked of the simulation - see build.ts. */
  readonly build: readonly BuildRow[];
  readonly seeded: boolean;
  /** Batch 17: the settlement registry, and whether the player is choosing a founding site. */
  readonly settlements: readonly Settlement[];
  readonly founding: SettlementKind | null;
  /** Batch 22: while founding, the site under the cursor and its elevation, in words - or null. */
  readonly foundingSite?: string | null;
}

export interface HudHooks {
  readonly onSpeed: (speed: Speed) => void;
  readonly onOrder: (type: FacilityType, delta: number) => void;
  readonly onSeed: () => void;
  /** Switch a lever off or back on. */
  readonly onToggleLever: (type: FacilityType) => void;
  /** Start choosing a site for a new settlement (micro §2.3 step 1), or stop. */
  readonly onFound: (kind: SettlementKind) => void;
  readonly onCancelFound: () => void;
  /** Go down to a settlement's city view (Batch 20; Batch 21 makes it a journey). */
  readonly onOpenSettlement: (id: string) => void;
  /** Bring the matching lever into view - the HUD's own build row since Batch 16. */
  readonly onFocusLever: (type: FacilityType) => void;
}

/** How long a phase-transition banner stays up, in readout ticks. */
const BANNER_TICKS = READOUT_HZ * 8;

type MetricKey = "T" | "P" | "o2" | "ocean" | "biomass" | "co2";

interface MetricSpec {
  readonly key: MetricKey;
  readonly label: string;
  readonly unit: string;
  /** Where the bar starts and ends. */
  readonly lo: number;
  readonly hi: number;
  /** Minimum habitable, as a fraction of the bar. Null when §2.3 defines none. */
  readonly min: number | null;
  readonly target: number;
  /** Upper edge of the band, for the quantities that have one. */
  readonly bandHi: number | null;
  /** True when LOWER is better - CO2 is the one row that runs backwards. */
  readonly inverted: boolean;
  readonly value: (r: Reservoirs, d: Derived) => number;
  readonly format: (v: number) => string;
}

/**
 * The headline parameters, straight from §2.3.
 *
 * Six rows, not the brief's five: CO2 has a toxicity ceiling in §2.3 and it is
 * the one axis that has to come DOWN, which is exactly the thing a player will
 * otherwise misread as going backwards.
 */
const METRICS: readonly MetricSpec[] = [
  {
    key: "T",
    label: "Temperature",
    unit: "K",
    lo: 210,
    hi: 300,
    min: TARGETS.T.min,
    target: TARGETS.T.target,
    bandHi: null,
    inverted: false,
    value: (_r, d) => d.T,
    format: (v) => v.toFixed(1),
  },
  {
    key: "P",
    label: "Pressure",
    unit: "mbar",
    lo: 0,
    hi: TARGETS.P.target,
    min: TARGETS.P.min,
    target: TARGETS.P.target,
    bandHi: null,
    inverted: false,
    value: (_r, d) => d.P,
    format: (v) => v.toFixed(0),
  },
  {
    key: "o2",
    label: "Oxygen",
    unit: "mbar",
    lo: 0,
    hi: TARGETS.o2.target,
    min: TARGETS.o2.min,
    target: TARGETS.o2.target,
    bandHi: null,
    inverted: false,
    value: (r) => r.o2,
    format: (v) => v.toFixed(0),
  },
  {
    key: "ocean",
    label: "Ocean cover",
    unit: "%",
    lo: 0,
    hi: 1,
    min: TARGETS.ocean.bandLo,
    target: TARGETS.ocean.target,
    bandHi: TARGETS.ocean.bandHi,
    inverted: false,
    value: (_r, d) => d.oceanFrac,
    format: (v) => (v * 100).toFixed(1),
  },
  {
    key: "biomass",
    label: "Biosphere",
    unit: "index",
    lo: 0,
    hi: 1,
    min: TARGETS.biomass.min,
    target: TARGETS.biomass.target,
    bandHi: null,
    inverted: false,
    value: (r) => r.biomass,
    format: (v) => v.toFixed(2),
  },
  {
    key: "co2",
    label: "Carbon dioxide",
    unit: "mbar",
    lo: 0,
    hi: 400,
    min: null,
    target: TARGETS.co2_atm.target,
    bandHi: TARGETS.co2_atm.toxMax,
    inverted: true,
    value: (r) => r.co2_atm,
    format: (v) => v.toFixed(1),
  },
];

/** The word a screen reader and a colourblind player both get. */
function statusWord(spec: MetricSpec, value: number): string {
  if (spec.inverted) {
    if (value <= spec.target) return "at target";
    // Strict: CO2 at exactly the ceiling is not safe - the Phase 6 gate says so.
    if (spec.bandHi !== null && value < spec.bandHi) return "safe";
    return "too high";
  }
  if (spec.bandHi !== null && value > spec.bandHi) return "above band";
  if (value >= spec.target) return "at target";
  if (spec.min !== null && value >= spec.min) return "habitable";
  return "below minimum";
}

/**
 * The win condition in words, beside the bar that does not measure it.
 *
 * Reads the CURRENT state for what is missing, and the latched phase for
 * whether the world has been won - a won world that drifts out of a band is
 * still won (phases latch), but the player should see which band slipped.
 */
function livingWorldLine(view: HudView): string {
  const missing = livingWorldShortfall(view.reservoirs, view.derived);
  const met = 6 - missing.length;
  if (view.phaseReached >= 6) {
    return missing.length === 0
      ? "Living world reached: all 6 minimums met. The bar measures the Earth-like targets beyond it."
      : `Living world reached. Now outside its band: ${missing.join(", ")}.`;
  }
  // Phase is latched at tick rate and this reads at readout rate, so for a
  // moment the bands can all be met before the phase has caught up.
  if (missing.length === 0) return "Living world: all 6 minimums met.";
  return `Living world: ${met} of 6 minimums met - still short on ${missing.join(", ")}.`;
}

interface BuildRowDom {
  readonly root: HTMLElement;
  readonly name: string;
  readonly status: HTMLElement;
  readonly less: HTMLButtonElement;
  readonly more: HTMLButtonElement;
  readonly toggle: HTMLButtonElement;
  readonly reason: HTMLElement;
}

/** Deployment ramps continuously; whole units read better than 12.375. */
function formatUnits(units: number): string {
  return units >= 10 || Number.isInteger(units) ? Math.round(units).toString() : units.toFixed(1);
}

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

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

interface MetricRow {
  readonly spec: MetricSpec;
  readonly fill: HTMLElement;
  readonly meter: HTMLElement;
  readonly value: HTMLElement;
  readonly status: HTMLElement;
}

export class Hud {
  private readonly phaseLabel: HTMLElement;
  private readonly phaseName: HTMLElement;
  private readonly phaseCaption: HTMLElement;
  private readonly yearLabel: HTMLElement;
  private readonly bankLabel: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressMeter: HTMLElement;
  private readonly progressValue: HTMLElement;
  private readonly livingWorld: HTMLElement;
  private readonly metricRows: MetricRow[] = [];
  private readonly adviceTitle: HTMLElement;
  private readonly adviceProblem: HTMLElement;
  private readonly adviceAction: HTMLElement;
  private readonly adviceBecause: HTMLElement;
  private readonly adviceButton: HTMLButtonElement;
  private readonly adviceState: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly speedButtons = new Map<Speed, HTMLButtonElement>();
  private readonly buildRows = new Map<FacilityType, BuildRowDom>();
  private readonly seedRow: { readonly status: HTMLElement; readonly button: HTMLButtonElement; readonly root: HTMLElement };
  private readonly settlementList: HTMLElement;
  private readonly foundPrompt: HTMLElement;
  private readonly foundPromptText: HTMLElement;
  private readonly foundButtons: readonly HTMLButtonElement[];
  /** null until first drawn: an empty registry keys to "", which must still draw "None yet". */
  private renderedSettlements: string | null = null;

  private bannerTicks = 0;
  private renderedEvents = 0;
  private currentLever: FacilityType | null = null;

  private readonly openSettlement: (id: string) => void;

  constructor(parent: HTMLElement, hooks: HudHooks, private readonly tuning: Tuning) {
    this.openSettlement = hooks.onOpenSettlement;
    const shell = el("section", "hud");

    // ---- phase and year -------------------------------------------------
    const header = el("header", "hud-header");
    const phaseBox = el("div", "hud-phase");
    this.phaseLabel = el("div", "hud-phase-index", "Phase 0");
    this.phaseName = el("h1", "hud-phase-name", "Barren");
    this.phaseCaption = el("p", "hud-phase-caption", "");
    phaseBox.append(this.phaseLabel, this.phaseName, this.phaseCaption);

    const clock = el("div", "hud-clock");
    const clockExtras: HTMLElement[] = [];
    this.yearLabel = el("div", "hud-year", "year 0");
    // The bank. Hidden entirely when the economy is off rather than showing
    // a meaningless zero.
    this.bankLabel = el("div", "hud-bank", "");
    this.bankLabel.hidden = true;
    clockExtras.push(this.bankLabel);
    const speedRow = el("div", "hud-speeds");
    speedRow.setAttribute("role", "group");
    speedRow.setAttribute("aria-label", "Simulation speed");
    for (const s of SPEEDS) {
      const button = el("button", "hud-speed", s === 0 ? "pause" : `${s}x`);
      button.type = "button";
      button.addEventListener("click", () => hooks.onSpeed(s));
      speedRow.append(button);
      this.speedButtons.set(s, button);
    }
    clock.append(this.yearLabel, ...clockExtras, speedRow);
    header.append(phaseBox, clock);
    shell.append(header);

    // The transition beat. §7 singles out Phase 2 as the "it's happening"
    // moment; every headline event gets the same treatment.
    // A refused order - unaffordable, or not yet unlocked.
    this.notice = el("div", "hud-notice");
    this.notice.setAttribute("role", "status");
    this.notice.hidden = true;
    shell.append(this.notice);

    this.banner = el("div", "hud-banner");
    this.banner.setAttribute("role", "status");
    this.banner.hidden = true;
    shell.append(this.banner);

    // ---- composite progress ---------------------------------------------
    const progressBox = el("div", "hud-progress");
    const progressHead = el("div", "hud-row-head");
    // "Toward Earth-like", not "terraformed": the bar measures section 2.3's
    // TARGET column and the win needs only its MINIMUM column, so it reads
    // about 87% on the year the player wins. Calling that "87% terraformed"
    // beside a "Living world" heading told the player two contradictory
    // things (Batch 7's open item). The label now says what the number is,
    // and the line under it says what the win is.
    progressHead.append(el("span", "hud-row-label", "Progress toward Earth-like"));
    this.progressValue = el("span", "hud-row-value", "0%");
    progressHead.append(this.progressValue);
    this.progressMeter = el("div", "hud-bar hud-bar-wide");
    this.progressMeter.setAttribute("role", "meter");
    this.progressMeter.setAttribute("aria-valuemin", "0");
    this.progressMeter.setAttribute("aria-valuemax", "100");
    this.progressFill = el("div", "hud-bar-fill");
    this.progressMeter.append(this.progressFill);
    progressBox.append(progressHead, this.progressMeter);
    this.livingWorld = el("p", "hud-living", "");
    this.livingWorld.setAttribute("role", "status");
    progressBox.append(this.livingWorld);
    progressBox.append(
      el(
        "p",
        "hud-note",
        "A weighted geometric mean of six Earth-like targets: a zero on any one of them holds the whole score down. " +
          "A living world needs only the six minimums, so the bar keeps climbing after you have won.",
      ),
    );
    shell.append(progressBox);

    // ---- what next -------------------------------------------------------
    const advice = el("div", "hud-advice");
    advice.setAttribute("aria-live", "polite");
    const adviceHead = el("div", "hud-row-head");
    adviceHead.append(el("span", "hud-advice-eyebrow", "What the planet needs next"));
    this.adviceState = el("span", "hud-advice-state", "");
    adviceHead.append(this.adviceState);
    this.adviceTitle = el("h2", "hud-advice-title", "");
    this.adviceProblem = el("p", "hud-advice-problem", "");
    this.adviceAction = el("p", "hud-advice-action", "");
    this.adviceBecause = el("p", "hud-advice-because", "");
    this.adviceButton = el("button", "hud-advice-button", "");
    this.adviceButton.type = "button";
    this.adviceButton.hidden = true;
    this.adviceButton.addEventListener("click", () => {
      const lever = this.currentLever;
      if (lever === null) return;
      if (lever === "biosphere_seeding") hooks.onSeed();
      else {
        hooks.onOrder(lever, 1);
        hooks.onFocusLever(lever);
      }
    });
    advice.append(adviceHead, this.adviceTitle, this.adviceProblem, this.adviceAction, this.adviceBecause, this.adviceButton);
    shell.append(advice);

    // ---- build: every lever, where the player can reach it (Batch 16) ----
    // The instruments drawer is a debug view. Everything a player needs to
    // play - order, dismantle, switch off, and what each costs - lives here.
    const build = el("details", "hud-build");
    build.open = true;
    const buildSummary = el("summary", "hud-section-title", "Build");
    build.append(buildSummary);
    build.append(
      el("p", "hud-note", "Orders come online over years, not instantly. Dismantling is free; switching off keeps the order."),
    );
    for (const def of FACILITY_LIST) {
      if (def.kind === "action") continue;
      const row = el("div", "hud-lever");
      row.dataset["lever"] = def.type;
      const head = el("div", "hud-row-head");
      const name = el("span", "hud-lever-name", def.name);
      const status = el("span", "hud-lever-status", "");
      head.append(name, status);
      const summary = el("p", "hud-lever-summary", def.summary);
      const controls = el("div", "hud-lever-controls");
      const less = el("button", "hud-lever-less", "-1");
      less.type = "button";
      less.addEventListener("click", () => hooks.onOrder(def.type, -1));
      const more = el("button", "hud-lever-more", "+1");
      more.type = "button";
      more.addEventListener("click", () => hooks.onOrder(def.type, 1));
      const toggle = el("button", "hud-lever-toggle", "Switch off");
      toggle.type = "button";
      toggle.addEventListener("click", () => hooks.onToggleLever(def.type));
      controls.append(less, more, toggle);
      const reason = el("p", "hud-lever-reason", "");
      reason.setAttribute("aria-live", "polite");
      row.append(head, summary, controls, reason);
      build.append(row);
      this.buildRows.set(def.type, { root: row, status, less, more, toggle, reason, name: def.name });
    }
    {
      // Ecopoiesis is a one-shot, not a lever with a count.
      const row = el("div", "hud-lever");
      row.dataset["lever"] = "biosphere_seeding";
      const head = el("div", "hud-row-head");
      const status = el("span", "hud-lever-status", "");
      head.append(el("span", "hud-lever-name", "Cyanobacteria seeding"), status);
      const button = el("button", "hud-lever-more", "Seed the biosphere");
      button.type = "button";
      button.addEventListener("click", () => hooks.onSeed());
      const controls = el("div", "hud-lever-controls");
      controls.append(button);
      row.append(head, el("p", "hud-lever-summary", "One-shot. Starts life once there is liquid water and warmth."), controls);
      build.append(row);
      this.seedRow = { status, button, root: row };
    }
    shell.append(build);

    // ---- settlements (micro layer, Batch 17) ------------------------------
    // Founding is the one thing done from orbit, and it builds nothing (micro
    // §2.3 step 1): choose a kind, then click the planet where it should stand.
    const places = el("section", "hud-settlements");
    places.append(el("h2", "hud-section-title", "Settlements"));
    const foundRow = el("div", "hud-found-row");
    const foundCity = el("button", "hud-found", "Found a city");
    foundCity.type = "button";
    foundCity.addEventListener("click", () => hooks.onFound("city"));
    const foundOutpost = el("button", "hud-found", "Found an outpost");
    foundOutpost.type = "button";
    foundOutpost.addEventListener("click", () => hooks.onFound("outpost"));
    foundRow.append(foundCity, foundOutpost);
    this.foundButtons = [foundCity, foundOutpost];
    this.foundPrompt = el("div", "hud-found-prompt");
    this.foundPrompt.setAttribute("role", "status");
    this.foundPrompt.hidden = true;
    this.foundPromptText = el("span", "hud-found-text", "");
    // Built once: rebuilding it at readout rate would steal keyboard focus.
    const cancel = el("button", "hud-found-cancel", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => hooks.onCancelFound());
    this.foundPrompt.append(this.foundPromptText, cancel);
    this.settlementList = el("ul", "hud-settlement-list");
    places.append(foundRow, this.foundPrompt, this.settlementList);
    shell.append(places);

    // ---- the §2.3 target bands -------------------------------------------
    const metrics = el("div", "hud-metrics");
    metrics.append(el("h2", "hud-section-title", "Target bands (section 2.3)"));
    for (const spec of METRICS) {
      const row = el("div", "hud-metric");
      const head = el("div", "hud-row-head");
      head.append(el("span", "hud-row-label", spec.label));
      const value = el("span", "hud-row-value", "-");
      head.append(value);

      const meter = el("div", "hud-bar");
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-valuemin", String(spec.lo));
      meter.setAttribute("aria-valuemax", String(spec.hi));
      const fill = el("div", "hud-bar-fill");
      meter.append(fill);

      // Band markers. They carry a title so hovering explains them, and they
      // are never the only way a value's state is communicated.
      if (spec.min !== null) {
        const mark = el("div", "hud-bar-mark hud-bar-mark-min");
        mark.style.left = `${clamp01((spec.min - spec.lo) / (spec.hi - spec.lo)) * 100}%`;
        mark.title = `minimum habitable: ${spec.min}${spec.unit === "%" ? "%" : ` ${spec.unit}`}`;
        meter.append(mark);
      }
      const targetMark = el("div", "hud-bar-mark hud-bar-mark-target");
      targetMark.style.left = `${clamp01((spec.target - spec.lo) / (spec.hi - spec.lo)) * 100}%`;
      targetMark.title = `target: ${spec.target}`;
      meter.append(targetMark);

      const status = el("div", "hud-metric-status", "-");
      row.append(head, meter, status);
      metrics.append(row);
      this.metricRows.push({ spec, fill, meter, value, status });
    }
    shell.append(metrics);

    // ---- event feed -------------------------------------------------------
    const feedBox = el("div", "hud-feed-box");
    feedBox.append(el("h2", "hud-section-title", "Log"));
    this.feed = el("ol", "hud-feed");
    this.feed.setAttribute("aria-live", "polite");
    feedBox.append(this.feed);
    shell.append(feedBox);

    parent.append(shell);
  }

  update(view: HudView): void {
    const info = PHASE_INFO[view.phaseReached];
    this.phaseLabel.textContent = `Phase ${view.phaseReached}`;
    this.phaseName.textContent = info?.name ?? "";
    this.phaseCaption.textContent = info?.caption ?? "";
    this.yearLabel.textContent = `year ${view.simYear.toFixed(0)}`;

    if (view.economy === null) {
      this.bankLabel.hidden = true;
    } else {
      this.bankLabel.hidden = false;
      const net = view.economy.income - view.economy.upkeep;
      this.bankLabel.textContent =
        `${Math.floor(view.economy.credits).toLocaleString()} credits ` +
        `(${net >= 0 ? "+" : ""}${net.toFixed(0)}/yr)`;
      // The sign is in the text, not only in the colour.
      this.bankLabel.dataset["state"] = net >= 0 ? "earning" : "losing";
    }

    this.notice.hidden = view.notice === null;
    if (view.notice !== null) this.notice.textContent = view.notice;

    for (const [speed, button] of this.speedButtons) {
      const active = speed === view.speed;
      button.classList.toggle("on", active);
      // Not colour alone: the pressed state is in the accessibility tree too.
      button.setAttribute("aria-pressed", String(active));
    }

    const percent = clamp01(view.progress) * 100;
    this.progressFill.style.width = `${percent.toFixed(1)}%`;
    this.progressValue.textContent = `${percent.toFixed(1)}%`;
    this.progressMeter.setAttribute("aria-valuenow", percent.toFixed(1));
    this.progressMeter.setAttribute("aria-valuetext", `${percent.toFixed(0)} percent of the way to Earth-like`);
    this.livingWorld.textContent = livingWorldLine(view);

    for (const row of this.metricRows) {
      const raw = row.spec.value(view.reservoirs, view.derived);
      const fraction = clamp01((raw - row.spec.lo) / (row.spec.hi - row.spec.lo));
      const word = statusWord(row.spec, raw);
      row.fill.style.width = `${(fraction * 100).toFixed(1)}%`;
      row.value.textContent = `${row.spec.format(raw)} ${row.spec.unit}`;
      row.status.textContent = word;
      row.status.dataset["state"] = word.replace(/\s+/g, "-");
      row.meter.setAttribute("aria-valuenow", raw.toFixed(3));
      row.meter.setAttribute("aria-valuetext", `${row.spec.format(raw)} ${row.spec.unit}, ${word}`);
    }

    this.updateAdvice(view);
    this.updateBuild(view);
    this.updateSettlements(view);
    this.updateBanner(view);
    this.updateFeed(view);
  }

  private updateAdvice(view: HudView): void {
    const a = view.advice;
    this.adviceTitle.textContent = a.title;
    this.adviceProblem.textContent = a.problem;
    this.adviceAction.textContent = a.action;
    this.adviceBecause.textContent = a.because ?? "";
    this.adviceBecause.hidden = a.because === null;

    // The state word is the accessible half of what the panel's styling says.
    this.adviceState.textContent = a.waiting ? "in progress" : "needs you";
    this.adviceState.dataset["state"] = a.waiting ? "waiting" : "action";

    this.currentLever = a.lever;
    const seedable = a.lever === "biosphere_seeding";
    const show = a.lever !== null && (seedable ? view.canSeed : view.canOrder);
    this.adviceButton.hidden = !show;
    if (show && a.lever !== null) {
      this.adviceButton.textContent = seedable ? "Seed the biosphere" : "Order one";
    }
  }

  private updateBanner(view: HudView): void {
    const headline = view.fresh.find((e) => e.headline);
    if (headline !== undefined) {
      this.banner.textContent = headline.text;
      this.banner.hidden = false;
      this.bannerTicks = BANNER_TICKS;
      return;
    }
    if (this.bannerTicks > 0) {
      this.bannerTicks -= 1;
      if (this.bannerTicks === 0) this.banner.hidden = true;
    }
  }

  private updateFeed(view: HudView): void {
    // The log only ever grows at the front, so redraw only what is new rather
    // than rebuilding the list at READOUT_HZ.
    if (view.events.length === this.renderedEvents) return;
    const added = view.events.length - this.renderedEvents;
    for (let i = added - 1; i >= 0; i -= 1) {
      const event = view.events[i];
      if (event === undefined) continue;
      const item = el("li", "hud-feed-item");
      item.dataset["tone"] = event.tone;
      /**
       * The separators are real text nodes, not CSS gaps.
       *
       * A flex `gap` puts space on the screen and nothing in the accessibility
       * tree, so this line read as "year 280Mean temperature has passed" to
       * anything consuming text - which is precisely the reader this batch's
       * accessibility requirement is for.
       */
      item.append(el("span", "hud-feed-year", `year ${event.year.toFixed(0)}`));
      item.append(document.createTextNode(" "));
      // The tone word, so "warning" is not carried by colour alone.
      if (event.tone === "warning") {
        item.append(el("span", "hud-feed-tone", "warning"));
        item.append(document.createTextNode(" "));
      }
      item.append(el("span", "hud-feed-text", event.text));
      this.feed.prepend(item);
    }
    this.renderedEvents = view.events.length;
    while (this.feed.childElementCount > 60) this.feed.lastElementChild?.remove();
  }

  private updateBuild(view: HudView): void {
    const money = view.economy !== null;
    for (const row of view.build) {
      const dom = this.buildRows.get(row.type);
      if (dom === undefined) continue;
      // Every state in words: a colourblind player gets the same information.
      const units =
        row.count === 0
          ? "none ordered"
          : `${formatUnits(row.online)} of ${row.target} units online${row.level > 1 ? ` - level ${row.level}` : ""}`;
      dom.status.textContent = row.running ? units : `switched off - ${units}`;
      dom.root.dataset["state"] = row.count === 0 ? "none" : row.running ? "running" : "off";

      const price = money && row.next.cost > 0 ? ` - ${Math.ceil(row.next.cost).toLocaleString()} cr` : "";
      dom.more.textContent = `+1${price}`;
      dom.more.disabled = !row.next.ok;
      dom.more.setAttribute("aria-label", `Order one more ${dom.name}${price ? `, ${Math.ceil(row.next.cost)} credits` : ""}`);
      dom.less.disabled = !row.canDismantle;
      dom.less.setAttribute("aria-label", `Dismantle one ${dom.name}`);
      dom.toggle.disabled = row.count === 0;
      dom.toggle.textContent = row.running ? "Switch off" : "Switch on";
      dom.toggle.setAttribute("aria-pressed", String(!row.running));
      dom.reason.textContent = row.next.ok ? "" : `Cannot order: ${row.next.reason ?? "refused"}`;
      dom.reason.hidden = row.next.ok;
    }
    this.seedRow.status.textContent = view.seeded ? "seeded" : view.canSeed ? "ready" : "not yet possible";
    this.seedRow.button.disabled = view.seeded || !view.canSeed;
    this.seedRow.root.dataset["state"] = view.seeded ? "running" : "none";
  }

  private updateSettlements(view: HudView): void {
    const choosing = view.founding !== null;
    for (const b of this.foundButtons) b.disabled = choosing;
    this.foundPrompt.hidden = !choosing;
    if (choosing) {
      const site = view.foundingSite ?? null;
      this.foundPromptText.textContent =
        `Click the planet where the new ${view.founding} should stand. Esc cancels.` + (site === null ? "" : ` Under the cursor: ${site}.`);
    }
    // The list only changes when the registry does; rebuild it only then.
    const key = view.settlements.map((s) => `${s.id}:${s.lat}:${s.lon}:${s.lostAtSeaLevelM}`).join("|");
    if (key === this.renderedSettlements) return;
    this.renderedSettlements = key;
    if (view.settlements.length === 0) {
      this.settlementList.replaceChildren(el("li", "hud-settlement-empty", "None yet. Found one to claim a place on the planet."));
      return;
    }
    this.settlementList.replaceChildren(
      ...view.settlements.map((s) => {
        const item = el("li", "hud-settlement");
        item.dataset["kind"] = s.kind;
        if (s.lostAtSeaLevelM !== null) {
          // A ruin (Batch 24): named, with where the sea stood when it fell, and nothing to open.
          item.dataset["lost"] = "true";
          const gone = el("span", "hud-settlement-text");
          gone.append(
            el("span", "hud-settlement-name", settlementLabel(s)),
            el("span", "hud-settlement-where", `Lost to the sea at ${formatMetres(s.lostAtSeaLevelM)}`),
          );
          item.append(gone);
          return item;
        }
        const open = el("button", "hud-settlement-open", "Open");
        (open as HTMLButtonElement).type = "button";
        open.setAttribute("aria-label", `Open ${settlementLabel(s)}`);
        open.addEventListener("click", () => this.openSettlement(s.id));
        const text = el("span", "hud-settlement-text");
        text.append(
          el("span", "hud-settlement-name", settlementLabel(s)),
          el("span", "hud-settlement-where", `${formatLatLon(s.lat, s.lon)} - ${formatMetres(siteElevation(s.lat, s.lon, this.tuning))}`),
        );
        item.append(text, open);
        return item;
      }),
    );
  }

  /** Bring a lever's build row into view and mark it briefly - used by the advice button. */
  focusLever(type: FacilityType): void {
    const row = type === "biosphere_seeding" ? this.seedRow.root : this.buildRows.get(type)?.root;
    if (row === undefined) return;
    if (typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("focused");
    void row.offsetWidth;
    row.classList.add("focused");
  }

  /** After a reset, the feed and the banner have to go with it. */
  clear(): void {
    this.feed.replaceChildren();
    this.renderedEvents = 0;
    this.banner.hidden = true;
    this.bannerTicks = 0;
  }
}
