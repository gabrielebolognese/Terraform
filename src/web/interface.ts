/**
 * The interface settings, put on the page (Batch 36): the size of the
 * panels, the colours, motion and contrast.
 *
 * They go on the page's root as attributes and one variable, and the
 * stylesheet does the rest: `--ui-scale` sizes the panels (never the planet
 * or the city, so a click lands where it always did); `data-palette` swaps
 * the colours that mean something; `data-motion="reduced"` stills the
 * interface; `data-contrast="high"` makes the panels solid. What is drawn on
 * a canvas reads the palette through `paletteOf`.
 */

import type { InterfaceSettings, Palette } from "./settings.js";

/** The system's own wish for less motion, where the browser can say. */
export function systemReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Whether motion is reduced: chosen, or (on Auto) the system's. */
export function reducedMotion(ui: Pick<InterfaceSettings, "motion">, system = systemReducedMotion()): boolean {
  return ui.motion === "reduced" || (ui.motion === "auto" && system);
}

/** Put the interface settings on `root` (the page's `<html>`). */
export function applyInterface(root: HTMLElement, ui: InterfaceSettings, system = systemReducedMotion()): void {
  root.style.setProperty("--ui-scale", String(ui.scale));
  root.dataset["palette"] = ui.palette;
  root.dataset["contrast"] = ui.contrast ? "high" : "normal";
  root.dataset["motion"] = reducedMotion(ui, system) ? "reduced" : "full";
}

/** The palette on the page, for what is drawn on a canvas. */
export function pagePalette(): Palette {
  const p = typeof document === "undefined" ? undefined : document.documentElement.dataset["palette"];
  return p === "red-green" || p === "blue-yellow" ? p : "standard";
}

/** Whether the page asks for reduced motion, as `applyInterface` left it. */
export function pageReducedMotion(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset["motion"] === "reduced";
}
