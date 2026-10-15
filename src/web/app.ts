/**
 * The front door (Batch 27): the title screen, the worlds, and the way in
 * and out of a world.
 *
 * "A loader menu, a new game like minecraft worlds." The game opens here,
 * over a slowly turning planet, and nothing is loaded until the player
 * chooses: Continue (the last world played), Worlds, New world, the Example
 * planet (look only), Settings (a stub until Batch 36) and Credits.
 *
 * Menus read the state and never write it. Everything that changes a world
 * goes through `WorldLibrary` (moving saves) or the running game (playing).
 */

import type { SimState, Tuning } from "../sim/index.js";
import { NAME_MAX, NEUTRAL_ENV, PHASE_INFO, marsStart } from "../sim/index.js";
import type { Phase } from "../sim/index.js";
import { Globe } from "./globe.js";
import type { GameHandle, GameOptions, GameHooks } from "./game.js";
import { Autosaver } from "./session.js";
import type { GameStore } from "./storage.js";
import { AUTOSAVE_INTERVAL_MS } from "./config.js";
import type { WorldMode, WorldPace } from "./game-tuning.js";
import { BROWSER_TUNING, MODE_NAMES, PACE_NAMES, WORLD_MODES, WORLD_PACES } from "./game-tuning.js";
import type { Clock, WorldMeta } from "./worlds.js";
import { WorldLibrary, parseSeed, startState } from "./worlds.js";
import { drawThumbnail, planetLook } from "./thumbnail.js";

export interface AppDeps {
  readonly root: HTMLElement;
  readonly store: GameStore;
  readonly now: Clock;
  /** A random seed for a new world (the player may type their own). */
  readonly randomSeed: () => number;
  /** Start a world on the page: `startGame`, or a stand-in in a test. */
  readonly launch: (app: HTMLElement, options: GameOptions, hooks: GameHooks) => GameHandle;
  /** The look-only example planet (about forty seconds to build, measured). */
  readonly buildExample: () => { readonly state: SimState; readonly tuning: Tuning };
  /** Hand the player a file. */
  readonly download: (filename: string, text: string) => void;
  /** Draw the title's planet. Off in a test, where there is no GPU to draw it with. */
  readonly titleGlobe?: boolean;
  /** The debug setting (`?debug` on the page): every speed in every world (Batch 28). */
  readonly debugSpeeds?: boolean;
}

type View = "title" | "worlds" | "new" | "settings" | "credits" | "game";

const MODE_ABOUT: Readonly<Record<WorldMode, string>> = {
  standard: "Today's game: earn what you build, unlock it as the planet changes.",
  sandbox: "Unlimited materials and credits, everything unlocked, nothing lost.",
  terraformed: "Start on a living planet with cities already built (about forty seconds to make).",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function button(text: string, onClick: () => void, className = "front-button"): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export function formatPlaytime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : `${h} h ${m} min`;
}

function phaseName(phase: number): string {
  return PHASE_INFO[phase as Phase]?.name ?? `phase ${phase}`;
}

export class App {
  readonly library: WorldLibrary;
  private readonly front: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly notice: HTMLElement;
  private view: View = "title";
  private globe: Globe | null = null;
  private game: { handle: GameHandle; world: WorldMeta | null; autosaver: Autosaver | null; playedBefore: number } | null = null;
  private menu: HTMLElement | null = null;
  /** Serialises everything that writes: two clicks never race for one slot. */
  private busy: Promise<void> = Promise.resolve();

  constructor(private readonly deps: AppDeps) {
    this.library = new WorldLibrary(deps.store, deps.now);
    this.front = el("div", "front");
    this.front.setAttribute("role", "main");
    this.screen = el("div", "front-screen");
    this.notice = el("p", "front-notice");
    this.notice.setAttribute("role", "status");
    this.front.append(this.screen, this.notice);
    deps.root.append(this.front);
  }

  /** Read the worlds, show the title, then check every world's save in the background. */
  async start(): Promise<void> {
    await this.library.open();
    if (this.library.problem !== null) this.say(this.library.problem);
    if (!this.deps.store.durable) this.say("This browser has no durable storage: worlds will not survive a reload.");
    this.showTitle();
    await this.library.verify();
    if (this.view === "worlds") this.showWorlds();
  }

  get currentView(): View {
    return this.view;
  }

  private say(text: string): void {
    this.notice.textContent = text;
  }

  private queue(work: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(work).catch((error: unknown) => {
      this.say(error instanceof Error ? error.message : String(error));
    });
    return this.busy;
  }

  // ---- the planet behind the menus -------------------------------------------

  private showPlanet(): void {
    if (this.deps.titleGlobe === false || this.globe !== null) return;
    const stage = el("div", "stage front-stage");
    this.front.prepend(stage);
    this.globe = new Globe(stage);
    // Mars as every world begins it, turning slowly.
    this.globe.update(planetLook(marsStart(undefined, BROWSER_TUNING), BROWSER_TUNING));
  }

  private hidePlanet(): void {
    this.globe?.dispose();
    this.globe = null;
    this.front.querySelector(".front-stage")?.remove();
  }

  // ---- the screens --------------------------------------------------------------

  private render(view: View, ...children: HTMLElement[]): void {
    this.view = view;
    this.front.hidden = false;
    this.screen.replaceChildren(...children);
    this.screen.dataset["view"] = view;
  }

  showTitle(): void {
    this.showPlanet();
    const last = this.library.last;
    const panel = el("section", "front-panel front-title");
    panel.append(el("h1", "front-logo", "Terraform"), el("p", "front-tagline", "Make Mars a living world."));
    const nav = el("nav", "front-nav");
    const cont = button(last === null ? "Continue" : `Continue - ${last.name}`, () => {
      if (last !== null) void this.play(last.id);
    });
    cont.disabled = last === null;
    cont.classList.add("primary");
    nav.append(
      cont,
      button("Worlds", () => this.showWorlds()),
      button("New world", () => this.showNewWorld()),
      button("Example planet", () => void this.playExample()),
      button("Settings", () => this.showSettings()),
      button("Credits", () => this.showCredits()),
    );
    panel.append(nav);
    this.render("title", panel);
  }

  private back(): HTMLButtonElement {
    return button("Back", () => this.showTitle(), "front-button front-back");
  }

  showWorlds(): void {
    const panel = el("section", "front-panel front-worlds");
    const head = el("header", "front-head");
    const input = el("input", "front-file");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file !== undefined) void this.importFile(file);
      input.value = "";
    });
    head.append(this.back(), el("h2", "", "Worlds"), button("Import a world", () => input.click()), input);
    panel.append(head);

    const worlds = this.library.worlds;
    if (worlds.length === 0) {
      const empty = el("p", "front-empty", "No worlds yet.");
      empty.append(" ", button("Make one", () => this.showNewWorld(), "front-link"));
      panel.append(empty);
    }
    const list = el("ul", "world-list");
    for (const w of worlds) list.append(this.row(w));
    panel.append(list);
    this.render("worlds", panel);
  }

  private row(w: WorldMeta): HTMLLIElement {
    const li = el("li", "world-row");
    li.dataset["world"] = w.id;
    const thumb = el("div", "world-thumb");
    if (w.thumbnail !== null) {
      const img = el("img");
      img.src = w.thumbnail;
      img.alt = "";
      thumb.append(img);
    }
    const info = el("div", "world-info");
    const name = el("h3", "world-name", w.name);
    const facts = el(
      "p",
      "world-facts",
      `${MODE_NAMES[w.mode]}${w.pace === "classic" ? " (Classic pace)" : ""} - ${phaseName(w.phase)} - year ${Math.floor(w.simYear).toLocaleString("en")} - played ${formatPlaytime(w.playtimeMs)}`,
    );
    const when = el("p", "world-when", w.lastPlayedAt > 0 ? `Last played ${new Date(w.lastPlayedAt).toLocaleString()} - seed ${w.seed}` : `Seed ${w.seed}`);
    info.append(name, facts, when);
    if (w.problem !== null) {
      const p = el("p", "world-problem", `Will not load: ${w.problem}. It is kept as it is.`);
      p.setAttribute("role", "alert");
      info.append(p);
    }
    const actions = el("div", "world-actions");
    const play = button("Play", () => void this.play(w.id), "front-button primary");
    actions.append(
      play,
      button("Rename", () => this.renameRow(li, w)),
      button("Duplicate", () => void this.queue(async () => {
        const copy = await this.library.duplicate(w.id);
        this.say(typeof copy === "string" ? `Cannot duplicate ${w.name}: ${copy}` : `Made ${copy.name}.`);
        this.showWorlds();
      })),
      button("Export", () => void this.queue(async () => {
        this.deps.download(`${w.name.replace(/[^\w-]+/g, "_") || "world"}.terraform.json`, await this.library.exportWorld(w.id));
        this.say(`Exported ${w.name}.`);
      })),
      button("Delete", () => this.deleteRow(li, w), "front-button danger"),
    );
    li.append(thumb, info, actions);
    return li;
  }

  private renameRow(li: HTMLLIElement, w: WorldMeta): void {
    const form = el("form", "world-inline");
    const input = el("input", "world-rename");
    input.value = w.name;
    input.maxLength = NAME_MAX;
    input.setAttribute("aria-label", "New name");
    const save = el("button", "front-button primary", "Save");
    save.type = "submit";
    form.append(input, save, button("Cancel", () => this.showWorlds()));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.queue(async () => {
        await this.library.rename(w.id, input.value);
        this.showWorlds();
      });
    });
    li.querySelector(".world-actions")?.replaceWith(form);
    input.focus();
  }

  /** Delete, confirmed by typing the world's name: a world is the one thing here that cannot be made again. */
  private deleteRow(li: HTMLLIElement, w: WorldMeta): void {
    const form = el("form", "world-inline world-confirm");
    const label = el("label", "", `Type "${w.name}" to delete it for good:`);
    const input = el("input", "world-confirm-name");
    input.setAttribute("aria-label", `Type ${w.name} to confirm`);
    label.append(input);
    const go = el("button", "front-button danger", "Delete for good");
    go.type = "submit";
    go.disabled = true;
    input.addEventListener("input", () => {
      go.disabled = input.value !== w.name;
    });
    form.append(label, go, button("Cancel", () => this.showWorlds()));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (input.value !== w.name) return;
      void this.queue(async () => {
        await this.library.remove(w.id);
        this.say(`Deleted ${w.name}.`);
        this.showWorlds();
      });
    });
    li.querySelector(".world-actions")?.replaceWith(form);
    input.focus();
  }

  private importFile(file: File): Promise<void> {
    return this.queue(async () => {
      const meta = await this.library.importWorld(await file.text());
      this.say(`Imported ${meta.name}.`);
      this.showWorlds();
    });
  }

  showNewWorld(): void {
    const panel = el("section", "front-panel front-new");
    const head = el("header", "front-head");
    head.append(this.back(), el("h2", "", "New world"));
    const form = el("form", "new-world");

    const nameLabel = el("label", "front-field", "Name");
    const name = el("input", "new-world-name");
    name.maxLength = NAME_MAX;
    name.value = `World ${this.library.worlds.length + 1}`;
    nameLabel.append(name);

    const seedLabel = el("label", "front-field", "Seed - the same seed makes the same world");
    const seedRow = el("div", "front-row");
    const seed = el("input", "new-world-seed");
    seed.placeholder = "random";
    seed.value = String(this.deps.randomSeed());
    seedRow.append(seed, button("Random", () => (seed.value = String(this.deps.randomSeed()))));
    seedLabel.append(seedRow);

    const modes = el("fieldset", "front-field new-world-modes");
    modes.append(el("legend", "", "Mode"));
    for (const mode of WORLD_MODES) {
      const opt = el("label", "front-option");
      const radio = el("input");
      radio.type = "radio";
      radio.name = "mode";
      radio.value = mode;
      radio.checked = mode === "standard";
      opt.append(radio, el("strong", "", MODE_NAMES[mode]), el("span", "front-about", MODE_ABOUT[mode]));
      modes.append(opt);
    }

    const paceLabel = el("label", "front-field", "Pace");
    const pace = el("select", "new-world-pace");
    for (const p of WORLD_PACES) {
      const option = el("option", "", PACE_NAMES[p]);
      option.value = p;
      pace.append(option);
    }
    pace.value = "standard";
    paceLabel.append(pace, el("span", "front-about", "Standard: builds take real minutes, then hours, and finish while you are away. Classic: the fast game from before."));

    const create = el("button", "front-button primary", "Create world");
    create.type = "submit";
    form.append(nameLabel, seedLabel, modes, paceLabel, create);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const chosen = (form.querySelector('input[name="mode"]:checked') as HTMLInputElement | null)?.value as WorldMode | undefined;
      const mode = chosen ?? "standard";
      const s = parseSeed(seed.value) ?? this.deps.randomSeed();
      create.disabled = true;
      this.say(mode === "terraformed" ? "Making a living planet - about forty seconds..." : "Making the world...");
      // Let the message paint before a long build.
      setTimeout(() => {
        void this.queue(async () => {
          const meta = await this.library.create({ name: name.value, seed: s, mode, pace: (WORLD_PACES as readonly string[]).includes(pace.value) ? (pace.value as WorldPace) : "standard" });
          this.say("");
          await this.playNow(meta.id);
        });
      }, 30);
    });
    panel.append(head, form);
    this.render("new", panel);
    name.focus();
  }

  showSettings(): void {
    const panel = el("section", "front-panel");
    const head = el("header", "front-head");
    head.append(this.back(), el("h2", "", "Settings"));
    panel.append(head, el("p", "", "Settings - sound, graphics, controls - arrive in a later update."));
    this.render("settings", panel);
  }

  showCredits(): void {
    const panel = el("section", "front-panel");
    const head = el("header", "front-head");
    head.append(this.back(), el("h2", "", "Credits"));
    panel.append(
      head,
      el("p", "", "Terraform - a planet-scale simulation of making Mars habitable."),
      el("p", "", "Made by Gabriele B., built with Claude."),
      el("p", "", "Typeface: Lexend. Everything else is drawn by the game itself."),
    );
    this.render("credits", panel);
  }

  // ---- playing ------------------------------------------------------------------------

  /** Open a world. One that fails to load stays on the list with its reason - nothing is started over it. */
  play(id: string): Promise<void> {
    return this.queue(() => this.playNow(id));
  }

  private async playNow(id: string): Promise<void> {
    const loaded = await this.library.load(id);
    const world = this.library.find(id);
    if (!loaded.ok || world === undefined) {
      this.say(`${world?.name ?? "That world"} will not load: ${loaded.ok ? "it is gone" : loaded.reason}. It has been kept as it is.`);
      this.showWorlds();
      return;
    }
    await this.library.markLast(id);
    const tuning = loaded.tuning;
    const autosaver = new Autosaver(this.deps.store, { tuning, env: NEUTRAL_ENV, forcing: null }, this.deps.now, world.slot);
    const away = loaded.summary === null ? null : `While you were away: ${loaded.summary.headline}`;
    this.enter(
      {
        state: loaded.state,
        tuning,
        awayMessage: away,
        storageWarning: this.deps.store.durable ? null : "this browser has no durable storage available, so progress will not survive a reload",
        debugSpeeds: this.deps.debugSpeeds === true,
        fresh: () => startState({ name: world.name, seed: world.seed, mode: world.mode === "terraformed" ? "standard" : world.mode, pace: world.pace }, tuning),
      },
      world,
      autosaver,
    );
  }

  /** The example planet: look only, nothing saved. */
  playExample(): Promise<void> {
    return this.queue(async () => {
      this.say("Building the example planet - about forty seconds...");
      await new Promise((r) => setTimeout(r, 30));
      const example = this.deps.buildExample();
      this.say("");
      const counts = { city: 0, metropolis: 0, outpost: 0 };
      for (const s of example.state.settlements) counts[s.kind] += 1;
      this.enter(
        {
          state: example.state,
          tuning: example.tuning,
          lookOnly: {
            banner: `Example planet: fully terraformed, with ${counts.city + counts.metropolis} cities (${counts.metropolis} of them metropolises) and ${counts.outpost} outposts. Nothing here is saved.`,
          },
          fresh: () => example.state,
        },
        null,
        null,
      );
    });
  }

  private enter(options: GameOptions, world: WorldMeta | null, autosaver: Autosaver | null): void {
    this.hidePlanet();
    this.front.hidden = true;
    this.view = "game";
    const handle = this.deps.launch(this.deps.root, options, {
      save: (state) => void this.saveWorld(state, false),
      saveDue: () => autosaver?.due(AUTOSAVE_INTERVAL_MS) ?? false,
      saveFailures: () => autosaver?.failureCount ?? 0,
      onMenu: () => (this.menu === null ? this.openMenu() : this.closeMenu()),
      onBackToTitle: () => void this.quitToTitle(),
    });
    this.game = { handle, world, autosaver, playedBefore: world?.playtimeMs ?? 0 };
  }

  /** Write the world and what the list shows of it. The thumbnail is drawn when asked, or when there is none. */
  private async saveWorld(state: SimState, withThumbnail: boolean): Promise<void> {
    const g = this.game;
    if (g === null || g.world === null || g.autosaver === null || !g.handle.mayPersist) return;
    await g.autosaver.save(state);
    if (g.autosaver.failureCount > 0) return;
    const current = this.library.find(g.world.id);
    let thumbnail: string | null | undefined;
    if (withThumbnail || current?.thumbnail === null) {
      const look = g.handle.visuals;
      thumbnail = look === null ? undefined : drawThumbnail(look, g.handle.terrain, g.handle.yaw) ?? undefined;
    }
    await this.library.record(g.world.id, state, { playtimeMs: g.playedBefore + g.handle.playedMs, thumbnail });
  }

  /** The in-game menu: the world stands still behind it. */
  openMenu(): void {
    if (this.game === null || this.menu !== null) return;
    this.game.handle.setPaused(true);
    const overlay = el("div", "game-menu");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Menu");
    const panel = el("div", "front-panel game-menu-panel");
    const status = el("p", "front-notice");
    status.setAttribute("role", "status");
    const mayPersist = this.game.handle.mayPersist;
    const save = button("Save", () => {
      const g = this.game;
      if (g === null) return;
      void this.queue(async () => {
        await this.saveWorld(g.handle.state, true);
        status.textContent = (g.autosaver?.failureCount ?? 0) > 0 ? "Saving failed - progress may not survive a reload." : "Saved.";
      });
    });
    save.disabled = !mayPersist;
    const settings = button("Settings", () => {
      status.textContent = "Settings arrive in a later update.";
    });
    panel.append(
      el("h2", "", this.game.world?.name ?? "Example planet"),
      button("Resume", () => this.closeMenu(), "front-button primary"),
      save,
      settings,
      button(mayPersist ? "Save and quit to title" : "Quit to title", () => void this.quitToTitle()),
      status,
    );
    overlay.append(panel);
    this.deps.root.append(overlay);
    this.menu = overlay;
    (panel.querySelector("button") as HTMLButtonElement | null)?.focus();
  }

  closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
    this.game?.handle.setPaused(false);
  }

  /** Save first, then leave: the world stops, and the title comes back. */
  quitToTitle(): Promise<void> {
    return this.queue(async () => {
      const g = this.game;
      if (g === null) return;
      await this.saveWorld(g.handle.state, true);
      this.menu?.remove();
      this.menu = null;
      g.handle.stop();
      this.game = null;
      this.showTitle();
    });
  }

  /** Wait for every queued write: what a test (and a page closing) needs. */
  settled(): Promise<void> {
    return this.busy;
  }
}
