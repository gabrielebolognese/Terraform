// @vitest-environment happy-dom

/**
 * Batch 27's exit gate, the page half: the title screen, the worlds list and
 * the new-world form, driven through the real components - the real `App`,
 * the real `startGame` - the way a player clicks through them.
 *
 * The unit is the assembly. `worlds.test.ts` proves the library keeps worlds
 * apart; this proves the buttons reach it, that a world started from the
 * title is the one written when the player quits, and that leaving a world
 * takes the whole game off the page.
 */

import { afterEach, describe, expect, it } from "vitest";

import { marsStart } from "../sim/index.js";
import { App } from "./app.js";
import { startGame } from "./game.js";
import { BROWSER_TUNING } from "./game-tuning.js";
import { MemorySaveStore } from "./storage.js";

const T0 = Date.parse("2026-10-01T12:00:00.000Z");

let mounted: HTMLElement | null = null;
let apps: App[] = [];

afterEach(async () => {
  // Leave no world running into the next test.
  for (const a of apps) {
    if (a.currentView === "game") await a.quitToTitle();
  }
  apps = [];
  mounted?.remove();
  mounted = null;
});

function page(store = new MemorySaveStore(true)): { app: App; root: HTMLElement; store: MemorySaveStore; downloads: string[] } {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  mounted = root;
  let at = T0;
  const downloads: string[] = [];
  const app = new App({
    root,
    store,
    now: () => (at += 1000),
    randomSeed: () => 4242,
    launch: startGame,
    // The look-only example's build is twenty seconds; its plumbing is what is tested here.
    buildExample: () => ({ state: marsStart(7, BROWSER_TUNING), tuning: BROWSER_TUNING }),
    download: (_name, text) => downloads.push(text),
    titleGlobe: false,
  });
  apps.push(app);
  return { app, root, store, downloads };
}

function buttonNamed(root: ParentNode, text: string | RegExp): HTMLButtonElement {
  const all = [...root.querySelectorAll("button")];
  const found = all.find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")));
  if (found === undefined) throw new Error(`no button "${String(text)}" among: ${all.map((b) => b.textContent).join(" | ")}`);
  return found;
}

function row(root: ParentNode, name: string): HTMLElement {
  const rows = [...root.querySelectorAll<HTMLElement>(".world-row")];
  const found = rows.find((r) => r.querySelector(".world-name")?.textContent === name);
  if (found === undefined) throw new Error(`no world row "${name}" among: ${rows.map((r) => r.querySelector(".world-name")?.textContent).join(" | ")}`);
  return found;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

/** The form's short paint-first delay, then every queued write. */
async function created(app: App): Promise<void> {
  await new Promise((r) => setTimeout(r, 60));
  await app.settled();
}

function notice(root: ParentNode): string {
  return root.querySelector(".front-notice")?.textContent ?? "";
}

describe("the front door, through the real components", () => {
  it("create, play, quit to title, continue: the world made is the world written and the world reopened", async () => {
    const { app, root, store } = page();
    await app.start();
    expect(app.currentView).toBe("title");
    expect(buttonNamed(root, "Continue").disabled, "nothing to continue on a first launch").toBe(true);

    buttonNamed(root, "New world").click();
    expect(app.currentView).toBe("new");
    type(root.querySelector<HTMLInputElement>(".new-world-name")!, "Ares");
    type(root.querySelector<HTMLInputElement>(".new-world-seed")!, "1234");
    submit(root.querySelector<HTMLFormElement>(".new-world")!);
    await created(app);

    expect(app.currentView).toBe("game");
    expect(root.querySelector(".game"), "the world is on the page").not.toBeNull();
    expect(root.querySelector<HTMLElement>(".front")!.hidden).toBe(true);
    const world = app.library.worlds[0]!;
    expect(app.library.worlds.map((w) => [w.name, w.seed, w.mode])).toEqual([["Ares", 1234, "standard"]]);

    // The Menu button opens the menu, which names the world.
    buttonNamed(root, "Menu").click();
    const menu = root.querySelector<HTMLElement>(".game-menu");
    expect(menu).not.toBeNull();
    expect(menu!.querySelector("h2")?.textContent).toBe("Ares");
    buttonNamed(menu!, "Save and quit to title").click();
    await app.settled();

    expect(app.currentView).toBe("title");
    expect(root.querySelector(".game"), "leaving a world takes it off the page").toBeNull();
    expect(root.querySelector(".game-menu")).toBeNull();
    expect(store.raw(world.slot), "the quit wrote the world").toBeDefined();
    const cont = buttonNamed(root, "Continue - Ares");
    expect(cont.disabled).toBe(false);

    cont.click();
    await app.settled();
    expect(app.currentView).toBe("game");
    expect(root.querySelectorAll(".game"), "one world on the page, never two").toHaveLength(1);
    buttonNamed(root, "Menu").click();
    expect(root.querySelector(".game-menu h2")?.textContent).toBe("Ares");
  });

  it("rename and delete from the worlds list; delete waits for the name typed exactly", async () => {
    const { app, root, store } = page();
    await app.start();
    const keep = await app.library.create({ name: "Keep", seed: 1, mode: "standard", pace: "standard" });
    const doomed = await app.library.create({ name: "Doomed", seed: 2, mode: "standard", pace: "standard" });
    buttonNamed(root, "Worlds").click();
    expect(app.currentView).toBe("worlds");

    buttonNamed(row(root, "Keep"), "Rename").click();
    const renaming = row(root, "Keep").querySelector<HTMLFormElement>(".world-inline")!;
    type(renaming.querySelector<HTMLInputElement>(".world-rename")!, "Kept");
    submit(renaming);
    await app.settled();
    row(root, "Kept");
    expect(app.library.find(keep.id)?.name).toBe("Kept");

    buttonNamed(row(root, "Doomed"), "Delete").click();
    const confirm = row(root, "Doomed").querySelector<HTMLFormElement>(".world-confirm")!;
    const go = buttonNamed(confirm, "Delete for good");
    const name = confirm.querySelector<HTMLInputElement>(".world-confirm-name")!;
    expect(go.disabled).toBe(true);
    type(name, "doomed");
    expect(go.disabled, "the name typed exactly, not near enough").toBe(true);
    submit(confirm);
    await app.settled();
    expect(app.library.find(doomed.id), "a submit with the wrong name deletes nothing").toBeDefined();
    type(name, "Doomed");
    expect(go.disabled).toBe(false);
    submit(confirm);
    await app.settled();

    expect([...root.querySelectorAll(".world-name")].map((n) => n.textContent)).toEqual(["Kept"]);
    expect(store.raw(doomed.slot), "the save is gone with the world").toBeUndefined();
    expect(store.raw(keep.slot)).toBeDefined();

    // What the next launch reads: the index on disk, not this page's memory.
    const again = page(store);
    await again.app.start();
    expect(again.app.library.worlds.map((w) => w.name)).toEqual(["Kept"]);
  });

  it("a world that will not load is listed with the reason, kept as it is, and the others still play", async () => {
    const store = new MemorySaveStore(true);
    const first = page(store);
    await first.app.start();
    const good = await first.app.library.create({ name: "Good", seed: 1, mode: "standard", pace: "standard" });
    const bad = await first.app.library.create({ name: "Bad", seed: 2, mode: "standard", pace: "standard" });
    store.putRaw(bad.slot, { schema_version: 13, reservoirs: "rubbish" });
    const onDisk = store.raw(bad.slot);
    first.root.remove();

    const { app, root } = page(store);
    await app.start();
    buttonNamed(root, "Worlds").click();
    expect(row(root, "Bad").querySelector(".world-problem")?.textContent).toMatch(/Will not load: .*corrupt save/);
    expect(row(root, "Good").querySelector(".world-problem")).toBeNull();

    buttonNamed(row(root, "Bad"), "Play").click();
    await app.settled();
    expect(app.currentView, "nothing starts over a world that will not load").toBe("worlds");
    expect(notice(root)).toMatch(/Bad will not load/);
    expect(store.raw(bad.slot), "never written over").toBe(onDisk);
    expect(app.library.find(bad.id)).toBeDefined();

    buttonNamed(row(root, "Good"), "Play").click();
    await app.settled();
    expect(app.currentView).toBe("game");
    expect(app.library.find(good.id)?.problem).toBeNull();
  });

  it("the example planet is look only: nothing is saved and no world is made", async () => {
    const { app, root, store } = page();
    await app.start();
    buttonNamed(root, "Example planet").click();
    await app.settled();
    expect(app.currentView).toBe("game");
    buttonNamed(root, "Menu").click();
    const menu = root.querySelector<HTMLElement>(".game-menu")!;
    expect(buttonNamed(menu, "Save").disabled).toBe(true);
    buttonNamed(menu, "Quit to title").click();
    await app.settled();
    expect(app.currentView).toBe("title");
    expect(app.library.worlds).toEqual([]);
    expect(store.slotNames()).toEqual([]);
  });

  it("export, delete, then import through the list gives the world back", async () => {
    const { app, root, downloads } = page();
    await app.start();
    const w = await app.library.create({ name: "Traveller", seed: 99, mode: "sandbox", pace: "standard" });
    const before = await app.library.load(w.id);
    buttonNamed(root, "Worlds").click();
    buttonNamed(row(root, "Traveller"), "Export").click();
    await app.settled();
    expect(downloads).toHaveLength(1);
    await app.library.remove(w.id);

    const input = root.querySelector<HTMLInputElement>(".front-file")!;
    Object.defineProperty(input, "files", { value: [new File([downloads[0]!], "traveller.terraform.json")], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    await app.settled();

    row(root, "Traveller");
    const back = app.library.worlds.find((x) => x.name === "Traveller")!;
    const after = await app.library.load(back.id);
    expect(after.ok && before.ok).toBe(true);
    if (after.ok && before.ok) {
      expect(after.state).toEqual(before.state);
      expect(after.tuning).toEqual(before.tuning);
    }
  });
});
