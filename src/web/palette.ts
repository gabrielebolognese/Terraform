/**
 * The colours that mean something on the game's canvases, for each of the
 * player's palettes (Batch 36): the planner's buildings by what they do,
 * its coverage overlay, its zones' first colours, and the land a city can
 * claim. The page's own colours are swapped by the stylesheet
 * (`data-palette`); these are what a canvas reads.
 *
 * Standard is the game's colours exactly, as they were. The red-green one is
 * Okabe and Ito's set, made to stay apart for deuteranopes and protanopes;
 * the blue-yellow one keeps to reds, cyans, pinks and greys, which stay
 * apart for tritanopes. None of them is the only cue: every colour-coded
 * thing also has a pattern, a mark or a word (`settings-cues.test.ts`).
 */

import type { Palette } from "./settings.js";

export type Rgb8 = readonly [number, number, number];

export type MapKind = "home" | "green" | "power" | "industry" | "civic" | "commerce" | "port" | "hq";

export interface MapPalette {
  /** The planner's buildings, by what they do. */
  readonly kinds: Readonly<Record<MapKind, Rgb8>>;
  /** The coverage overlay: the reach, homes reached, homes not reached (the gaps), a provider. */
  readonly coverage: { readonly reach: Rgb8; readonly reached: Rgb8; readonly gap: Rgb8; readonly provider: Rgb8 };
  /** A zone's first colours, in the order the game gives them - drawn in place of those colours, never stored. */
  readonly zones: readonly string[];
  /** Land a city can claim now (0 to 1, for the city's renderer). */
  readonly claimReady: { readonly r: number; readonly g: number; readonly b: number };
}

export const MAP_PALETTES: Readonly<Record<Palette, MapPalette>> = {
  standard: {
    kinds: {
      home: [92, 156, 230],
      green: [86, 186, 96],
      commerce: [226, 96, 90],
      power: [236, 200, 64],
      industry: [214, 124, 60],
      civic: [176, 110, 214],
      port: [80, 196, 186],
      hq: [245, 245, 245],
    },
    coverage: { reach: [120, 230, 140], reached: [80, 200, 110], gap: [232, 72, 60], provider: [255, 255, 255] },
    zones: ["#4f9dde", "#e0a33b", "#5fbf6a", "#c46ad6", "#e0605a", "#48c2b5", "#d6c24a", "#8a8fe8"],
    claimReady: { r: 0.45, g: 0.95, b: 0.55 },
  },
  "red-green": {
    kinds: {
      home: [86, 180, 233],
      green: [0, 158, 115],
      commerce: [213, 94, 0],
      power: [240, 228, 66],
      industry: [230, 159, 0],
      civic: [204, 121, 167],
      port: [0, 114, 178],
      hq: [245, 245, 245],
    },
    coverage: { reach: [86, 180, 233], reached: [86, 180, 233], gap: [230, 159, 0], provider: [255, 255, 255] },
    zones: ["#56b4e9", "#e69f00", "#009e73", "#cc79a7", "#d55e00", "#0072b2", "#f0e442", "#bbbbbb"],
    claimReady: { r: 0.34, g: 0.71, b: 0.91 },
  },
  "blue-yellow": {
    kinds: {
      home: [64, 196, 196],
      green: [0, 120, 120],
      commerce: [235, 60, 60],
      power: [255, 170, 190],
      industry: [150, 40, 60],
      civic: [180, 180, 180],
      port: [110, 110, 110],
      hq: [245, 245, 245],
    },
    coverage: { reach: [64, 196, 196], reached: [64, 196, 196], gap: [235, 60, 60], provider: [255, 255, 255] },
    zones: ["#40c4c4", "#eb3c3c", "#ffaabe", "#007878", "#b4b4b4", "#962838", "#6e6e6e", "#f0f0f0"],
    claimReady: { r: 0.25, g: 0.77, b: 0.77 },
  },
};

/** A zone's colour as the player's palette draws it: one of the game's first colours swapped for the palette's; a colour the player picked, as it is. */
export function zoneColour(stored: string, palette: Palette): string {
  const i = MAP_PALETTES.standard.zones.indexOf(stored.toLowerCase());
  return i < 0 ? stored : MAP_PALETTES[palette].zones[i]!;
}
