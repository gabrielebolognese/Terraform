// @vitest-environment happy-dom

/**
 * Micro §1.4: "Player selects a marker and confirms travel." The marker is a
 * real button on the globe, and the journey starts only on "Go down".
 */

import { beforeEach, describe, expect, it } from "vitest";

import { foundSettlement, marsStart } from "../sim/index.js";
import { Globe } from "./globe.js";
import { TravelPrompt } from "./travel-prompt.js";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("choosing a settlement on the globe", () => {
  it("makes each marker a button that names its settlement and reports a click", () => {
    const globe = new Globe(document.body);
    let s = foundSettlement(marsStart(), "city", 0.3, 1.0).state;
    s = foundSettlement(s, "outpost", -0.4, 2.2).state;
    globe.setSettlements(s.settlements);
    const clicked: string[] = [];
    globe.onMarker = (id) => clicked.push(id);
    const markers = [...document.querySelectorAll<HTMLButtonElement>("button.globe-marker")];
    expect(markers.map((m) => m.getAttribute("aria-label"))).toEqual(["Travel to City 1", "Travel to Outpost 2"]);
    markers[1]!.click();
    markers[0]!.click();
    expect(clicked).toEqual(["settlement-2", "settlement-1"]);
  });
});

describe("the travel confirm", () => {
  it("travels only when the player confirms", () => {
    const prompt = new TravelPrompt(document.body);
    const went: string[] = [];
    prompt.ask("City 1", "17.2°N 57.3°E", () => went.push("go"));
    expect(prompt.open).toBe(true);
    expect(prompt.root.textContent).toContain("Travel down to City 1? (17.2°N 57.3°E)");
    expect(went).toEqual([]);
    prompt.root.querySelector<HTMLButtonElement>(".travel-prompt-go")!.click();
    expect(went).toEqual(["go"]);
    expect(prompt.open).toBe(false);
  });

  it("goes nowhere on Cancel or Escape", () => {
    const prompt = new TravelPrompt(document.body);
    const went: string[] = [];
    prompt.ask("City 1", "", () => went.push("go"));
    prompt.root.querySelector<HTMLButtonElement>(".travel-prompt-cancel")!.click();
    prompt.ask("City 1", "", () => went.push("go"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(prompt.open).toBe(false);
    // A confirm after a cancel must not fire the cancelled journey.
    prompt.root.querySelector<HTMLButtonElement>(".travel-prompt-go")!.click();
    expect(went).toEqual([]);
  });
});
