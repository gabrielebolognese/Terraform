/**
 * The alert centre and the toasts (Batch 31): "toasts for the moment, the
 * centre for the record. Priority decides which interrupt."
 *
 * - The **centre** is a button with the count of what needs the player now,
 *   and a panel: what holds now, most pressing first, and what happened,
 *   newest first. A happening that repeats in one place (a city finishing
 *   build after build) is one line that counts up.
 * - A **toast** is an alert that interrupts: urgent and notice ones, at most
 *   TOASTS_SHOWN at once, urgent first; a record (a build finished, an
 *   objective done) never toasts - it waits in the centre.
 *
 * Every line and toast clicks through to where it happened. Both read what
 * the alerts derived; neither writes anything.
 */

import type { Alert, AlertTarget } from "./alerts.js";
import { PRIORITY_ORDER } from "./alerts.js";
import { ALERT_LOG, TOASTS_SHOWN, TOAST_NOTICE_MS, TOAST_URGENT_MS } from "./config.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A line in the record: an alert, how many times it came, and when (the world's year). */
export interface LogLine {
  readonly alert: Alert;
  readonly times: number;
  readonly year: number;
}

const PRIORITY_WORDS: Readonly<Record<Alert["priority"], string>> = { urgent: "Urgent", notice: "Notice", record: "Done" };

export class AlertCentre {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  private readonly nowList: HTMLElement;
  private readonly logList: HTMLElement;
  private now: readonly Alert[] = [];
  private readonly lines: LogLine[] = [];
  private key = "";

  constructor(
    host: HTMLElement,
    private readonly onGo: (target: AlertTarget) => void,
    private readonly onOpen: () => void = () => {},
  ) {
    this.toggle = el("button", "alerts-toggle", "Alerts");
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.addEventListener("click", () => this.setOpen(this.panel.hidden));
    this.panel = el("section", "alerts-panel");
    this.panel.setAttribute("aria-label", "Alerts");
    this.panel.hidden = true;
    const head = el("div", "alerts-head");
    const close = el("button", "alerts-close", "Close");
    close.type = "button";
    close.addEventListener("click", () => this.setOpen(false));
    head.append(el("h2", "", "Alerts"), close);
    this.nowList = el("ul", "alerts-now");
    this.logList = el("ul", "alerts-log");
    this.panel.append(head, el("h3", "alerts-section", "Now"), this.nowList, el("h3", "alerts-section", "What happened"), this.logList);
    host.append(this.toggle, this.panel);
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      this.onOpen();
      this.key = "";
      this.render();
    }
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** What holds now, and what is new since the last look (added to the record). */
  update(now: readonly Alert[], fresh: readonly Alert[], year: number): void {
    this.now = now;
    for (const a of fresh) {
      const top = this.lines[0];
      // The same alert in the same words: a Solar Array then a Dome finished in one city are two lines, not one.
      if (top !== undefined && top.alert.key === a.key && top.alert.title === a.title) this.lines[0] = { alert: a, times: top.times + 1, year };
      else this.lines.unshift({ alert: a, times: 1, year });
    }
    if (this.lines.length > ALERT_LOG) this.lines.length = ALERT_LOG;
    const pressing = now.filter((a) => a.priority === "urgent").length;
    this.toggle.textContent = now.length === 0 ? "Alerts" : `Alerts (${now.length})`;
    this.toggle.toggleAttribute("data-urgent", pressing > 0);
    this.toggle.setAttribute("aria-label", now.length === 0 ? "Alerts: nothing needs you" : `Alerts: ${now.length} need${now.length === 1 ? "s" : ""} you${pressing > 0 ? `, ${pressing} urgent` : ""}`);
    if (this.isOpen) this.render();
  }

  /** The record, newest first. */
  get log(): readonly LogLine[] {
    return this.lines;
  }

  clear(): void {
    this.now = [];
    this.lines.length = 0;
    this.key = "";
    this.toggle.textContent = "Alerts";
    this.toggle.removeAttribute("data-urgent");
    this.setOpen(false);
  }

  private render(): void {
    const key = JSON.stringify([this.now.map((a) => [a.key, a.title, a.text]), this.lines.map((l) => [l.alert.key, l.times, l.alert.title])]);
    if (key === this.key) return;
    this.key = key;
    this.nowList.replaceChildren(
      ...(this.now.length === 0 ? [el("li", "alerts-empty", "Nothing needs you right now.")] : this.now.map((a) => this.line(a, null))),
    );
    this.logList.replaceChildren(
      ...(this.lines.length === 0 ? [el("li", "alerts-empty", "Nothing yet this session.")] : this.lines.map((l) => this.line(l.alert, l))),
    );
  }

  private line(a: Alert, l: LogLine | null): HTMLElement {
    const item = el("li", "alert-line");
    item.dataset["kind"] = a.kind;
    item.dataset["priority"] = a.priority;
    const go = el("button", "alert-go");
    go.type = "button";
    const more = l !== null && l.times > 1 ? ` (${l.times} times)` : "";
    go.append(el("span", "alert-tag", PRIORITY_WORDS[a.priority]), el("span", "alert-title", `${a.title}${more}`), el("span", "alert-text", l === null ? a.text : `Year ${Math.floor(l.year).toLocaleString("en")}. ${a.text}`));
    go.addEventListener("click", () => {
      this.setOpen(false);
      this.onGo(a.target);
    });
    item.append(go);
    return item;
  }
}

interface Shown {
  readonly alert: Alert;
  readonly node: HTMLElement;
  readonly until: number;
}

/** The toasts: what interrupts, a few at a time, urgent first, each for its priority's time. */
export class AlertToasts {
  readonly root: HTMLElement;
  private shown: Shown[] = [];
  private readonly queue: Alert[] = [];

  constructor(host: HTMLElement, private readonly onGo: (target: AlertTarget) => void) {
    this.root = el("div", "alert-toasts");
    this.root.setAttribute("role", "status");
    this.root.setAttribute("aria-live", "polite");
    host.append(this.root);
  }

  /** New alerts: those that interrupt wait their turn, urgent ones first; a record never toasts. */
  push(fresh: readonly Alert[]): void {
    for (const a of fresh) if (a.priority !== "record") this.queue.push(a);
    this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  /** Called every frame: what has had its time goes, and the next takes its place. */
  frame(now: number): void {
    const before = this.shown.length;
    this.shown = this.shown.filter((s) => {
      if (now < s.until) return true;
      s.node.remove();
      return false;
    });
    // An urgent toast waiting puts out a notice showing, rather than waiting behind it.
    const next = this.queue[0];
    if (next !== undefined && next.priority === "urgent" && this.shown.length >= TOASTS_SHOWN) {
      const notice = this.shown.findIndex((s) => s.alert.priority !== "urgent");
      if (notice >= 0) {
        this.shown[notice]!.node.remove();
        this.shown.splice(notice, 1);
      }
    }
    while (this.shown.length < TOASTS_SHOWN && this.queue.length > 0) {
      const a = this.queue.shift()!;
      // The same alert already up is not shown twice.
      if (this.shown.some((s) => s.alert.key === a.key)) continue;
      this.shown.push({ alert: a, node: this.toast(a), until: now + (a.priority === "urgent" ? TOAST_URGENT_MS : TOAST_NOTICE_MS) });
    }
    if (this.shown.length !== before || this.root.childElementCount !== this.shown.length) this.root.replaceChildren(...this.shown.map((s) => s.node));
  }

  /** What is up now, top first. */
  get showing(): readonly Alert[] {
    return this.shown.map((s) => s.alert);
  }

  clear(): void {
    this.queue.length = 0;
    for (const s of this.shown) s.node.remove();
    this.shown = [];
  }

  private toast(a: Alert): HTMLElement {
    const node = el("div", "alert-toast");
    node.dataset["priority"] = a.priority;
    node.dataset["kind"] = a.kind;
    const go = el("button", "alert-toast-go");
    go.type = "button";
    go.append(el("span", "alert-tag", PRIORITY_WORDS[a.priority]), el("span", "alert-title", a.title), el("span", "alert-text", a.text));
    go.addEventListener("click", () => {
      this.dismiss(node);
      this.onGo(a.target);
    });
    const close = el("button", "alert-toast-close", "x");
    close.type = "button";
    close.setAttribute("aria-label", `Dismiss: ${a.title}`);
    close.addEventListener("click", () => this.dismiss(node));
    node.append(go, close);
    return node;
  }

  private dismiss(node: HTMLElement): void {
    this.shown = this.shown.filter((s) => s.node !== node);
    node.remove();
  }
}
