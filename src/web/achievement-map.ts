/**
 * The achievements as a map (at the user's request): a start on the left, a
 * lane for each group running right, and every achievement a box on its lane
 * joined to the one before - like Minecraft's advancements. A box shows only
 * its icon and title; held under the pointer, or focused from the keyboard,
 * it opens to say exactly what earns it and where it was first earned.
 *
 * Earned boxes are green, the rest grey - and never by colour alone: an
 * earned box carries a tick where the others carry a lock, and its details
 * say "Earned". Reads the player's record; writes nothing.
 */

import type { Tuning } from "../sim/index.js";
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, GROUP_NAMES } from "../sim/index.js";
import type { AchievementDef } from "../sim/index.js";
import { iconSvg } from "./achievement-icons.js";
import type { PlayerRecord } from "./profile.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

/** One achievement's box: icon and title, and the details that open under them. */
function node(a: AchievementDef, record: PlayerRecord, t: Tuning): HTMLLIElement {
  const first = record.achievements[a.id];
  const earned = first !== undefined;
  const li = el("li", "ach-node achievement" + (earned ? " earned" : "") + (a.rare ? " rare" : ""));
  li.dataset["achievement"] = a.id;
  const card = el("div", "ach-card");
  card.tabIndex = 0;
  const face = el("div", "ach-face");
  const icon = el("span", "ach-icon");
  icon.append(iconSvg(a.id));
  const badge = el("span", "ach-badge");
  badge.append(iconSvg(earned ? "_tick" : "_lock"));
  badge.setAttribute("aria-label", earned ? "Earned" : "Not earned yet");
  face.append(icon, el("strong", "ach-title achievement-title", a.title), badge);
  const detail = el("div", "ach-detail");
  const inner = el("div", "ach-detail-inner");
  inner.append(el("p", "ach-state", earned ? "Earned" : "Not earned yet"), el("p", "ach-counts achievement-counts", a.counts(t)));
  if (first !== undefined) inner.append(el("p", "ach-where achievement-where", "First in " + first.name));
  if (a.rare) inner.append(el("p", "ach-rare achievement-rare", "Rare - a style of play"));
  detail.append(inner);
  card.append(face, detail);
  li.append(card);
  return li;
}

/** The whole map: the start, and each group's lane in the order the groups are given. */
export function achievementMap(record: PlayerRecord, t: Tuning): HTMLElement {
  const map = el("div", "ach-map");
  map.setAttribute("aria-label", "Achievements map");
  const board = el("div", "ach-board");
  const start = el("div", "ach-start");
  const startIcon = el("span", "ach-icon");
  startIcon.append(iconSvg("_start"));
  start.append(startIcon, el("span", "ach-start-name", "Landing"));
  const lanes = el("div", "ach-lanes");
  for (const group of ACHIEVEMENT_GROUPS) {
    const lane = el("section", "ach-lane");
    lane.dataset["group"] = group;
    lane.setAttribute("aria-label", GROUP_NAMES[group]);
    const items = ACHIEVEMENTS.filter((a) => a.group === group);
    const done = items.filter((a) => record.achievements[a.id] !== undefined).length;
    const name = el("h3", "ach-lane-name", GROUP_NAMES[group]);
    name.append(el("span", "ach-lane-count", `${done}/${items.length}`));
    const list = el("ol", "ach-list");
    for (const a of items) list.append(node(a, record, t));
    lane.append(name, list);
    lanes.append(lane);
  }
  board.append(start, lanes);
  map.append(board);
  // A mouse wheel turned over the map moves it sideways: it is a long map and a short one.
  map.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY) || map.scrollWidth <= map.clientWidth) return;
      map.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
  return map;
}
