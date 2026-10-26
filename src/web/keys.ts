/**
 * The keyboard (Batch 36): every shortcut the game has, its default keys,
 * and the player's own.
 *
 * A key is named by where it sits on the keyboard (`KeyboardEvent.code`), not
 * by the letter it types, so W-A-S-D are the same four keys on any layout;
 * Ctrl, Alt and Shift go in front ("Ctrl+KeyS"). On a Mac, Cmd counts as
 * Ctrl. Each action has two slots, a key and another, and a key belongs to
 * one action at most: giving it to a second swaps the two.
 *
 * Shortcuts read the state and call what a button would; none of them
 * changes the simulation except through the same actions the buttons take.
 */

export interface ActionDef {
  readonly id: ActionId;
  /** What the player reads in the Controls list. */
  readonly name: string;
  readonly group: ActionGroup;
  /** Its two keys out of the box; null for an empty slot. */
  readonly keys: readonly [string | null, string | null];
}

export type ActionGroup = "Everywhere" | "Camera" | "Panels" | "In a city";

export const ACTION_IDS = [
  "menu",
  "pause",
  "speed1",
  "speed2",
  "speed3",
  "speed4",
  "save",
  "panUp",
  "panLeft",
  "panDown",
  "panRight",
  "zoomIn",
  "zoomOut",
  "objectives",
  "alerts",
  "statistics",
  "earth",
  "worldMap",
  "orbit",
  "planner",
  "upgrade",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const ACTIONS: readonly ActionDef[] = [
  { id: "menu", name: "Cancel, close, or open the menu", group: "Everywhere", keys: ["Escape", null] },
  { id: "pause", name: "Pause or resume", group: "Everywhere", keys: ["Space", null] },
  { id: "speed1", name: "First speed (1x)", group: "Everywhere", keys: ["Digit1", null] },
  { id: "speed2", name: "Second speed", group: "Everywhere", keys: ["Digit2", null] },
  { id: "speed3", name: "Third speed", group: "Everywhere", keys: ["Digit3", null] },
  { id: "speed4", name: "Fourth speed", group: "Everywhere", keys: ["Digit4", null] },
  { id: "save", name: "Save now", group: "Everywhere", keys: ["Ctrl+KeyS", null] },
  { id: "panUp", name: "Move up (in orbit: turn the planet)", group: "Camera", keys: ["KeyW", "ArrowUp"] },
  { id: "panLeft", name: "Move left", group: "Camera", keys: ["KeyA", "ArrowLeft"] },
  { id: "panDown", name: "Move down", group: "Camera", keys: ["KeyS", "ArrowDown"] },
  { id: "panRight", name: "Move right", group: "Camera", keys: ["KeyD", "ArrowRight"] },
  { id: "zoomIn", name: "Zoom in", group: "Camera", keys: ["Equal", "NumpadAdd"] },
  { id: "zoomOut", name: "Zoom out", group: "Camera", keys: ["Minus", "NumpadSubtract"] },
  { id: "objectives", name: "Objectives", group: "Panels", keys: ["KeyO", null] },
  { id: "alerts", name: "Alerts", group: "Panels", keys: ["KeyN", null] },
  { id: "statistics", name: "Statistics", group: "Panels", keys: ["KeyC", null] },
  { id: "earth", name: "Earth", group: "Panels", keys: ["KeyE", null] },
  { id: "worldMap", name: "World map", group: "Panels", keys: ["KeyM", null] },
  { id: "orbit", name: "Back to orbit", group: "In a city", keys: ["KeyB", null] },
  { id: "planner", name: "City planner, or back to the city", group: "In a city", keys: ["KeyP", null] },
  { id: "upgrade", name: "Upgrade the selected building", group: "In a city", keys: ["KeyU", null] },
];

export const ACTION_BY_ID: Readonly<Record<ActionId, ActionDef>> = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ActionId, ActionDef>;

/** The two keys of every action. */
export type KeyBindings = Readonly<Record<ActionId, readonly [string | null, string | null]>>;

export const DEFAULT_KEYS: KeyBindings = Object.freeze(Object.fromEntries(ACTIONS.map((a) => [a.id, a.keys])) as Record<ActionId, readonly [string | null, string | null]>);

/** The keys that only qualify another: pressed alone they bind nothing. */
const MODIFIER_CODES = new Set(["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight", "CapsLock", "Fn", "OSLeft", "OSRight"]);

/** A key as the game names it, from a key press; null for a modifier pressed alone or a key with no code. */
export function chordOf(e: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  if (typeof e.code !== "string" || e.code === "" || MODIFIER_CODES.has(e.code)) return null;
  return `${e.ctrlKey || e.metaKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.code}`;
}

/** The key under the modifiers: what a key's release lets go of. */
export function baseCode(chord: string): string {
  const parts = chord.split("+");
  return parts[parts.length - 1]!;
}

const CHORD = /^(Ctrl\+)?(Alt\+)?(Shift\+)?[A-Za-z][A-Za-z0-9]*$/;

const NAMED: Readonly<Record<string, string>> = {
  Escape: "Esc",
  Space: "Space",
  Enter: "Enter",
  Backspace: "Backspace",
  Tab: "Tab",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ArrowUp: "Up arrow",
  ArrowDown: "Down arrow",
  ArrowLeft: "Left arrow",
  ArrowRight: "Right arrow",
  Equal: "=",
  Minus: "-",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Backquote: "`",
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad -",
  NumpadMultiply: "Numpad *",
  NumpadDivide: "Numpad /",
  NumpadEnter: "Numpad Enter",
  NumpadDecimal: "Numpad .",
};

/** A key as the player reads it: "Ctrl+S", "Esc", "Up arrow", "1". */
export function keyName(chord: string | null): string {
  if (chord === null) return "none";
  const parts = chord.split("+");
  const code = parts.pop()!;
  let name = NAMED[code];
  if (name === undefined) {
    if (/^Key[A-Z]$/.test(code)) name = code.slice(3);
    else if (/^Digit\d$/.test(code)) name = code.slice(5);
    else if (/^Numpad\d$/.test(code)) name = `Numpad ${code.slice(6)}`;
    else name = code;
  }
  return [...parts, name].join("+");
}

/** The action a key is bound to, or null. */
export function actionFor(bindings: KeyBindings, chord: string | null): ActionId | null {
  if (chord === null) return null;
  for (const id of ACTION_IDS) {
    const k = bindings[id];
    if (k[0] === chord || k[1] === chord) return id;
  }
  return null;
}

/**
 * Give `chord` to `action`'s `slot` (null clears it). A key already bound to
 * another action is swapped: that action takes this slot's old key, so no
 * key is lost and none is bound twice. Says which action moved, if any.
 */
export function rebind(bindings: KeyBindings, action: ActionId, slot: 0 | 1, chord: string | null): { readonly bindings: KeyBindings; readonly swapped: ActionId | null } {
  const next: Record<ActionId, [string | null, string | null]> = Object.fromEntries(ACTION_IDS.map((id) => [id, [bindings[id][0], bindings[id][1]]])) as Record<ActionId, [string | null, string | null]>;
  const old = next[action][slot];
  let swapped: ActionId | null = null;
  if (chord !== null) {
    for (const id of ACTION_IDS) {
      for (const s of [0, 1] as const) {
        if ((id !== action || s !== slot) && next[id][s] === chord) {
          next[id][s] = id === action ? null : old;
          if (id !== action) swapped = id;
        }
      }
    }
  }
  next[action][slot] = chord;
  return { bindings: next, swapped };
}

/** The player's keys from their record: untrusted, like a save. A key that is not a key, or bound twice, is dropped; an action missing is its default. */
export function readKeys(raw: unknown): KeyBindings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return DEFAULT_KEYS;
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const out = {} as Record<ActionId, [string | null, string | null]>;
  for (const id of ACTION_IDS) {
    const v = r[id];
    const pair: [string | null, string | null] = Array.isArray(v) && v.length === 2 ? [null, null] : [DEFAULT_KEYS[id][0], DEFAULT_KEYS[id][1]];
    if (Array.isArray(v) && v.length === 2) {
      for (const s of [0, 1] as const) {
        const k = v[s];
        pair[s] = typeof k === "string" && CHORD.test(k) ? k : null;
      }
    }
    out[id] = pair;
  }
  // A key bound twice keeps the first action that has it.
  for (const id of ACTION_IDS) {
    for (const s of [0, 1] as const) {
      const k = out[id][s];
      if (k === null) continue;
      if (seen.has(k)) out[id][s] = null;
      else seen.add(k);
    }
  }
  return out;
}

/** Whether a key press is the player typing, or working a control, rather than a shortcut. */
export function typing(target: EventTarget | null, chord: string | null): boolean {
  const t = target as (Element & { isContentEditable?: boolean }) | null;
  if (t === null || typeof t.tagName !== "string") return false;
  const tag = t.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select" || t.isContentEditable === true) return true;
  if (tag === "input") {
    const type = ((t as HTMLInputElement).type ?? "text").toLowerCase();
    // A slider or a box takes its own keys; a text field takes every key but Esc.
    if (type === "range" || type === "checkbox" || type === "radio") return chord !== "Escape";
    return chord !== "Escape";
  }
  // Space and Enter on a button press the button: not a shortcut as well.
  if (tag === "button" || t.getAttribute?.("role") === "button") return chord === "Space" || chord === "Enter";
  return false;
}
