/**
 * Batch 37 - terrain resource deposits (detail §3.1), in the player's words:
 * what each is called, the mark it is drawn with, what it gives, and what a
 * building about to be placed would make for it. Read from the same rules
 * the simulation pays by (`sitingPreview`), never worked out again here.
 */

import { DEPOSIT_MARKS } from "../render/city.js";
import type { BuildingType, DepositKind, HabitatChannels, MicroResource, Tuning } from "../sim/index.js";
import { BUILDING_DEFS, DEPOSIT_BOOSTS, DEPOSIT_KINDS, depositBonus } from "../sim/index.js";

/** What each deposit is called on screen. */
export const DEPOSIT_NAMES: Readonly<Record<DepositKind, string>> = {
  ore: "Ore vein",
  ice: "Ice lens",
  vent: "Geothermal vent",
  sun: "Sunny high flat",
};

/** Many of each, as the placement hint names them: "Ice lenses are marked with ...". */
const DEPOSIT_PLURALS: Readonly<Record<DepositKind, string>> = {
  ore: "Ore veins",
  ice: "Ice lenses",
  vent: "Geothermal vents",
  sun: "Sunny high flats",
};

/** The colour each mark is drawn in, in words, beside its shape. */
const MARK_COLOURS: Readonly<Record<DepositKind, string>> = {
  ore: "copper",
  ice: "pale blue",
  vent: "red",
  sun: "yellow",
};

/** What a boosted building makes, in words. */
const MAKES: Readonly<Record<DepositKind, MicroResource>> = { ore: "materials", ice: "water", vent: "power", sun: "power" };

/** "x2", "x1.5", "x1.75": a factor as the words show it. */
export function factorWords(factor: number): string {
  return `x${Number(factor.toFixed(2))}`;
}

/** How a deposit is marked on the ground: "a copper diamond". */
export function markWords(kind: DepositKind): string {
  return `a ${MARK_COLOURS[kind]} ${DEPOSIT_MARKS[kind].shape}`;
}

/** How a deposit's marks are drawn, many of them: "copper diamonds". */
export function marksWords(kind: DepositKind): string {
  const shape = DEPOSIT_MARKS[kind].shape;
  return `${MARK_COLOURS[kind]} ${shape === "cross" ? "crosses" : `${shape}s`}`;
}

/** One line for a deposit: its name, its mark, and what it gives the building on it as the planet stands. */
export function depositLine(kind: DepositKind, env: HabitatChannels | null, t: Tuning): string {
  const type = DEPOSIT_BOOSTS[kind];
  const full = env === null ? null : 1 + depositBonus(kind, env, t);
  const gives = full === null ? "makes more" : full > 1 ? `makes ${factorWords(full)} ${MAKES[kind]}` : `makes no more now that water is in reach everywhere`;
  return `${DEPOSIT_NAMES[kind]} (${markWords(kind)}): a ${BUILDING_DEFS[type].name} standing wholly on it ${gives}.`;
}

/** The deposit a building type is boosted by, or null. */
export function depositOfType(type: BuildingType): DepositKind | null {
  return DEPOSIT_KINDS.find((k) => DEPOSIT_BOOSTS[k] === type) ?? null;
}

/** The placement hint's words for a building about to go down: how much of it would stand on its deposit, and what it would make. */
export function sitingWords(p: { readonly kind: DepositKind; readonly on: number; readonly of: number; readonly factor: number }): string {
  const name = DEPOSIT_NAMES[p.kind].toLowerCase();
  if (p.on === 0) return ` No ${name} under it: it would make ${factorWords(1)}. ${DEPOSIT_PLURALS[p.kind]} are marked with ${marksWords(p.kind)}.`;
  const share = p.on === p.of ? `all ${p.of} of its tiles` : `${p.on} of its ${p.of} tiles`;
  return ` On ${name}, ${share}: it would make ${factorWords(p.factor)} ${MAKES[p.kind]}.`;
}
