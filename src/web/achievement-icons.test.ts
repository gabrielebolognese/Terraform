// @vitest-environment happy-dom
/**
 * The achievement icons: one for every achievement and the map's own three,
 * each a clean 16x16 grid of its own, and the svg each draws covering exactly
 * its inked pixels - one rect to a run of equal ink, half ink at 45%.
 */

import { describe, expect, it } from "vitest";

import { ACHIEVEMENTS } from "../sim/index.js";
import { ACHIEVEMENT_ICONS, ICON_SIZE, iconSvg } from "./achievement-icons.js";

const UTILITY = ["_start", "_lock", "_tick"];
const ALL = [...ACHIEVEMENTS.map((a) => a.id), ...UTILITY];
const SVG_NS = "http://www.w3.org/2000/svg";

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly ink: "#" | "+";
}

/** An svg's rects, read back: where each is and which ink it draws. */
function rectsOf(svg: SVGSVGElement, id: string): Rect[] {
  return [...svg.querySelectorAll("rect")].map((r) => {
    expect(r.getAttribute("fill"), `${id}: a rect's fill`).toBe("currentColor");
    expect(r.getAttribute("height"), `${id}: a rect's height`).toBe("1");
    const opacity = r.getAttribute("fill-opacity");
    expect([null, "0.45"], `${id}: a rect's fill-opacity`).toContain(opacity);
    return { x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), width: Number(r.getAttribute("width")), ink: opacity === "0.45" ? "+" : "#" };
  });
}

/** The grid the rects draw, rebuilt: a pixel two rects cover shows as `!`, so it never matches. */
function gridOf(rects: readonly Rect[], id: string): string[] {
  const cells = Array.from({ length: ICON_SIZE }, () => Array<string>(ICON_SIZE).fill("."));
  for (const r of rects) {
    expect(r.width, `${id}: a rect's width`).toBeGreaterThan(0);
    for (let x = r.x; x < r.x + r.width; x++) {
      const row = cells[r.y];
      expect(row !== undefined && x >= 0 && x < ICON_SIZE, `${id}: a rect at (${x}, ${r.y}) is inside the box`).toBe(true);
      if (row) row[x] = row[x] === "." ? r.ink : "!";
    }
  }
  return cells.map((row) => row.join(""));
}

describe("the achievement icons", () => {
  it("has one for every achievement, and for the map's start, lock and tick", () => {
    const missing = ALL.filter((id) => !Object.hasOwn(ACHIEVEMENT_ICONS, id));
    expect(missing, "achievements with no icon").toEqual([]);
    const strays = Object.keys(ACHIEVEMENT_ICONS).filter((id) => !ALL.includes(id));
    expect(strays, "icons for no achievement (a misspelt id?)").toEqual([]);
  });

  it("draws each in 16 rows of 16 pixels, from . # and + only, with ink enough to see", () => {
    for (const id of ALL) {
      const grid = ACHIEVEMENT_ICONS[id] ?? [];
      expect(grid.length, `${id}: rows`).toBe(ICON_SIZE);
      grid.forEach((row, y) => expect(row, `${id}: row ${y} (${row.length} wide)`).toMatch(/^[.#+]{16}$/));
      const inked = grid.join("").replace(/\./g, "").length;
      expect(inked, `${id}: inked pixels`).toBeGreaterThanOrEqual(20);
    }
  });

  it("gives no two achievements the same icon", () => {
    const seen = new Map<string, string>();
    for (const id of ALL) {
      const key = (ACHIEVEMENT_ICONS[id] ?? []).join("\n");
      expect(seen.get(key), `${id}'s icon is the same as another's`).toBeUndefined();
      seen.set(key, id);
    }
  });
});

describe("an icon as an svg", () => {
  it("is a crisp, hidden 16 px svg in the SVG namespace", () => {
    const svg = iconSvg("caps");
    expect(svg.namespaceURI).toBe(SVG_NS);
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("class")).toBe("pixel-icon");
    for (const rect of svg.querySelectorAll("rect")) expect(rect.namespaceURI).toBe(SVG_NS);
  });

  it("covers exactly the icon's inked pixels, half ink at 45%", () => {
    for (const id of ALL) {
      const rects = rectsOf(iconSvg(id, document), id);
      expect(gridOf(rects, id), `${id}: the grid its rects draw`).toEqual(ACHIEVEMENT_ICONS[id]);
    }
  });

  it("draws a run of equal ink as one rect, never a rect a pixel", () => {
    for (const id of ALL) {
      const rects = rectsOf(iconSvg(id), id);
      for (let y = 0; y < ICON_SIZE; y++) {
        const row = rects.filter((r) => r.y === y).sort((a, b) => a.x - b.x);
        for (let i = 1; i < row.length; i++) {
          const [a, b] = [row[i - 1]!, row[i]!];
          const touching = a.x + a.width === b.x && a.ink === b.ink;
          expect(touching, `${id} row ${y}: two rects of the same ink meet at x=${b.x}; one run, one rect`).toBe(false);
        }
      }
    }
  });

  it("still draws something for an id with no icon, an inherited name among them", () => {
    for (const id of ["no_such_achievement", "toString", ""]) {
      const svg = iconSvg(id);
      expect(svg.getAttribute("class"), id).toBe("pixel-icon");
      const rects = rectsOf(svg, id);
      expect(rects.length, `${JSON.stringify(id)}: rects`).toBeGreaterThan(0);
      expect(gridOf(rects, id).join("").replace(/\./g, "").length, `${JSON.stringify(id)}: inked pixels`).toBeGreaterThanOrEqual(20);
    }
  });
});
