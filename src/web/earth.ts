/**
 * The Earth panel (Batch 34): interplanetary trade, tied to the bank.
 *
 * Where the player stands with Earth and when the next launch window opens;
 * Earth's prices; an order for a city's rocket - to buy, paid now, or to
 * sell, paid as it goes up; the orders waiting and the rockets away; Earth's
 * offer and the contracts taken; and the record.
 *
 * Every action goes through the simulation (`orderFromEarth`,
 * `cancelEarthOrder`, `acceptContract`), as a claim or an event's choice
 * does: a button the world would refuse is shown, disabled, with the reason.
 * The panel reads the state and never writes it.
 */

import type { EarthGood, SimState, Tuning } from "../sim/index.js";
import { EARTH_GOODS, SELLABLE, buyCost, capacities, earthPrices, exportable, goodUnlocked, goodWords, hasSpaceport, orderFromEarth, saleEstimate, tripSubsteps, windowStep } from "../sim/index.js";
import type { AlertTarget } from "./alerts.js";
import { contractAmount, contractHow, credits, goodsWords, recordWords, reputationWord, untilWords, windowWords } from "./earth-words.js";
import { settlementLabel } from "./settlement-label.js";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const GOOD_TITLES: Readonly<Record<EarthGood, string>> = {
  materials: "Materials",
  water: "Water",
  food: "Food",
  oxygen: "Oxygen",
  settlers: "Settlers",
  rovers: "Rovers",
};

/** A price to show: two places under ten credits, whole above. */
function price(n: number): string {
  return n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en");
}

export interface EarthHooks {
  /** Place an order through the simulation. */
  readonly onOrder: (settlement: string, good: EarthGood, side: "buy" | "sell", amount: number) => { ok: boolean; reason: string | null };
  readonly onCancel: (order: number) => { ok: boolean; reason: string | null };
  readonly onAccept: () => { ok: boolean; reason: string | null };
  /** Show a city. */
  readonly onGo: (target: AlertTarget) => void;
  /** The panel opened: what else shares its place closes. */
  readonly onOpen?: () => void;
}

export class EarthPanel {
  readonly toggle: HTMLButtonElement;
  readonly panel: HTMLElement;
  private readonly status: HTMLElement;
  private readonly bank: HTMLElement;
  private readonly market: HTMLElement;
  private readonly citySelect: HTMLSelectElement;
  private readonly goodSelect: HTMLSelectElement;
  private readonly amount: HTMLInputElement;
  private readonly buy: HTMLButtonElement;
  private readonly sell: HTMLButtonElement;
  private readonly room: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly waiting: HTMLElement;
  private readonly offer: HTMLElement;
  private readonly contracts: HTMLElement;
  private readonly record: HTMLElement;
  private state: SimState | null = null;
  private speed = 1;
  private keys = { market: "", cities: "", waiting: "", offer: "", contracts: "", record: "" };

  constructor(
    host: HTMLElement,
    private readonly tuning: Tuning,
    private readonly hooks: EarthHooks,
    /** Where the toggle goes (the game bar); the panel itself goes in `host`. */
    bar: HTMLElement = host,
  ) {
    this.toggle = el("button", "earth-toggle", "Earth");
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.hidden = !tuning.EARTH_ENABLED;
    this.toggle.addEventListener("click", () => this.setOpen(this.panel.hidden));
    this.panel = el("section", "earth-panel");
    this.panel.setAttribute("aria-label", "Earth: trade, shipments and contracts");
    this.panel.hidden = true;

    const head = el("div", "earth-head");
    const close = el("button", "earth-close", "Close");
    close.type = "button";
    close.addEventListener("click", () => this.setOpen(false));
    head.append(el("h2", "earth-title", "Earth"), close);
    this.status = el("p", "earth-status");
    this.status.setAttribute("role", "status");
    this.bank = el("p", "earth-bank");

    this.market = el("table", "earth-market");
    this.market.setAttribute("aria-label", "Earth's prices, credits a unit");

    // The order: a city with a spaceport, a good, how many - Buy or Sell.
    const form = el("div", "earth-order");
    this.citySelect = el("select", "earth-city");
    this.citySelect.setAttribute("aria-label", "City");
    this.goodSelect = el("select", "earth-good");
    this.goodSelect.setAttribute("aria-label", "Good");
    for (const g of EARTH_GOODS) {
      const option = el("option", "", GOOD_TITLES[g]);
      option.value = g;
      this.goodSelect.append(option);
    }
    this.amount = el("input", "earth-amount");
    this.amount.type = "number";
    this.amount.min = "1";
    this.amount.step = "1";
    this.amount.value = "50";
    this.amount.setAttribute("aria-label", "How many");
    this.buy = el("button", "earth-buy", "Buy");
    this.buy.type = "button";
    this.sell = el("button", "earth-sell", "Sell");
    this.sell.type = "button";
    const place = (side: "buy" | "sell"): void => {
      const out = this.hooks.onOrder(this.citySelect.value, this.goodSelect.value as EarthGood, side, this.amountValue());
      this.say(out.ok ? (side === "buy" ? "Ordered: it goes up at the next launch window." : "To be sold at the next launch window, at Earth's price then.") : `Not ordered: ${out.reason ?? "refused"}.`, out.ok);
      this.refresh();
    };
    this.buy.addEventListener("click", () => place("buy"));
    this.sell.addEventListener("click", () => place("sell"));
    for (const input of [this.citySelect, this.goodSelect, this.amount]) input.addEventListener("input", () => this.refresh());
    const row = el("div", "earth-order-row");
    row.append(this.citySelect, this.goodSelect, this.amount);
    const buttons = el("div", "earth-order-row");
    buttons.append(this.buy, this.sell);
    this.room = el("p", "earth-room");
    this.notice = el("p", "earth-notice");
    this.notice.setAttribute("role", "status");
    this.notice.hidden = true;
    form.append(el("h3", "earth-heading", "Order for the next launch window"), row, buttons, this.room, this.notice);

    this.waiting = el("div", "earth-waiting");
    this.offer = el("div", "earth-offer");
    this.contracts = el("div", "earth-contracts");
    this.record = el("ul", "earth-record");

    this.panel.append(
      head,
      this.status,
      this.bank,
      el("h3", "earth-heading", "Earth's prices"),
      this.market,
      form,
      this.waiting,
      el("h3", "earth-heading", "Contracts"),
      this.offer,
      this.contracts,
      el("h3", "earth-heading", "Record"),
      this.record,
    );
    bar.append(this.toggle);
    host.append(this.panel);
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      this.hooks.onOpen?.();
      this.refresh();
    }
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** The world as it stands (null: the example planet, no trade). */
  update(state: SimState | null, speed: number): void {
    const on = state !== null && this.tuning.EARTH_ENABLED > 0;
    this.toggle.hidden = !on;
    this.state = on ? state : null;
    this.speed = speed;
    if (!on) {
      this.setOpen(false);
      return;
    }
    // The toggle says when Earth has something waiting: an offer to answer.
    const label = state.earth.offer !== null ? "Earth (an offer)" : "Earth";
    if (this.toggle.textContent !== label) this.toggle.textContent = label;
    this.toggle.toggleAttribute("data-offer", state.earth.offer !== null);
    if (!this.panel.hidden) this.refresh();
  }

  private amountValue(): number {
    const n = Number(this.amount.value);
    return Number.isFinite(n) ? n : 0;
  }

  private say(text: string, ok: boolean): void {
    this.notice.hidden = false;
    this.notice.textContent = text;
    this.notice.dataset["state"] = ok ? "ok" : "refused";
  }

  /** Everything shown, from the state; lists rebuilt only when what they show changes (a button rebuilt under the pointer loses its click). */
  private refresh(): void {
    const s = this.state;
    if (s === null) return;
    const t = this.tuning;
    const e = s.earth;
    this.status.textContent = `Reputation ${Math.round(e.reputation)} of 100: ${reputationWord(e.reputation)}. ${windowWords(s, t, this.speed)} A rocket's trip there and back takes ${untilWords(tripSubsteps(t), 0, t, this.speed)}.`;
    this.bank.textContent = `Bank: ${credits(Math.floor(s.economy.credits))}. Trade so far: ${credits(e.spent)} spent, ${credits(e.earned)} earned, ${credits(e.rewards)} from contracts.`;

    const prices = earthPrices(s, t);
    const marketKey = JSON.stringify([prices, e.fulfilled]);
    if (marketKey !== this.keys.market) {
      this.keys.market = marketKey;
      const head = el("tr", "");
      head.append(el("th", "", "Good"), el("th", "", "Earth asks"), el("th", "", "Earth pays"));
      const rows = EARTH_GOODS.map((g) => {
        const tr = el("tr", "earth-price");
        tr.dataset["good"] = g;
        const open = goodUnlocked(s, g, t);
        const need = g === "settlers" ? t.EARTH_UNLOCK_SETTLERS : t.EARTH_UNLOCK_ROVERS;
        tr.append(
          el("td", "", GOOD_TITLES[g]),
          el("td", "", open ? price(prices[g].buy) : `After ${need} ${need === 1 ? "contract" : "contracts"} met`),
          el("td", "", SELLABLE.includes(g) ? price(prices[g].sell) : "-"),
        );
        return tr;
      });
      this.market.replaceChildren(head, ...rows);
    }

    // The cities with a spaceport, keeping the one chosen.
    const ports = s.settlements.filter((c) => c.lostAtSeaLevelM === null && hasSpaceport(c));
    const citiesKey = ports.map((c) => `${c.id}:${settlementLabel(c)}`).join("|");
    if (citiesKey !== this.keys.cities) {
      this.keys.cities = citiesKey;
      const chosen = this.citySelect.value;
      this.citySelect.replaceChildren(
        ...ports.map((c) => {
          const option = el("option", "", settlementLabel(c));
          option.value = c.id;
          return option;
        }),
      );
      // The one chosen if it is still there, else the first: said outright, not left to the browser.
      this.citySelect.value = ports.some((c) => c.id === chosen) ? chosen : (ports[0]?.id ?? "");
    }
    const good = this.goodSelect.value as EarthGood;
    const amount = this.amountValue();
    const city = ports.find((c) => c.id === this.citySelect.value);
    // Dry runs of exactly what each button would place: the simulation decides.
    const buyTry = city === undefined ? null : orderFromEarth(s, city.id, good, "buy", amount, t);
    const sellTry = city === undefined ? null : orderFromEarth(s, city.id, good, "sell", amount, t);
    const whole = Number.isInteger(amount) && amount >= 1;
    this.buy.textContent = whole && goodUnlocked(s, good, t) ? `Buy for ${credits(buyCost(s, good, amount, t))}` : "Buy";
    this.buy.disabled = buyTry === null || !buyTry.ok;
    this.buy.title = buyTry?.reason ?? (city === undefined ? "No city has a spaceport" : "");
    this.sell.textContent = whole && SELLABLE.includes(good) ? `Sell (about ${credits(saleEstimate(s, good, amount, t))} today)` : "Sell";
    this.sell.disabled = sellTry === null || !sellTry.ok;
    this.sell.title = sellTry?.reason ?? (city === undefined ? "No city has a spaceport" : "");
    if (city === undefined) this.room.textContent = "Trade needs a city with a spaceport: every city is founded with one.";
    else if (good === "settlers" || good === "rovers") this.room.textContent = good === "settlers" ? "Settlers move into homes with room as they land; one with no home is refunded." : "A rover joins the city's own as it lands.";
    else {
      const r = good;
      const room = Math.max(0, Math.floor(capacities(city, t)[r] - city.stores[r]));
      this.room.textContent = `${settlementLabel(city)} has room for ${goodWords(good, room)} now; what does not fit as it lands is sold back. A rocket could send ${goodWords(good, exportable(city, r, t))}.`;
    }

    // Orders waiting for the window, and the rockets away.
    const waitingKey = JSON.stringify([e.orders, e.flights.map((f) => f.id)]);
    if (waitingKey !== this.keys.waiting) {
      this.keys.waiting = waitingKey;
      const parts: HTMLElement[] = [];
      if (e.orders.length > 0) {
        parts.push(el("h3", "earth-heading", "Waiting for the launch window"));
        const list = el("ul", "earth-orders");
        for (const o of e.orders) {
          const c = s.settlements.find((x) => x.id === o.settlement);
          const li = el("li", "earth-order-line");
          li.dataset["id"] = String(o.id);
          const what = o.side === "buy" ? `Buy ${goodWords(o.good, o.amount)} for ${c === undefined ? "a city" : settlementLabel(c)}: ${credits(o.paid)} paid` : `Sell up to ${goodWords(o.good, o.amount)} from ${c === undefined ? "a city" : settlementLabel(c)}`;
          const cancel = el("button", "earth-cancel", o.side === "buy" ? "Cancel (refund)" : "Cancel");
          cancel.type = "button";
          cancel.addEventListener("click", () => {
            const out = this.hooks.onCancel(o.id);
            this.say(out.ok ? "Cancelled." : `Not cancelled: ${out.reason ?? "refused"}.`, out.ok);
            this.refresh();
          });
          li.append(el("span", "earth-line", what), cancel);
          list.append(li);
        }
        parts.push(list);
      }
      if (e.flights.length > 0) {
        parts.push(el("h3", "earth-heading", "Rockets away"));
        const list = el("ul", "earth-flights");
        for (const f of e.flights) {
          const c = s.settlements.find((x) => x.id === f.settlement);
          const li = el("li", "earth-flight");
          li.dataset["id"] = String(f.id);
          li.dataset["arrives"] = String(f.arrives);
          li.append(el("span", "earth-line", `${c === undefined ? "A city" : settlementLabel(c)}'s rocket, bringing ${goodsWords(f.cargo)}`), el("span", "earth-when", ""));
          list.append(li);
        }
        parts.push(list);
      }
      this.waiting.replaceChildren(...parts);
    }
    for (const li of this.waiting.querySelectorAll<HTMLElement>(".earth-flight")) {
      const when = li.querySelector<HTMLElement>(".earth-when");
      if (when !== null) when.textContent = `: home in ${untilWords(Number(li.dataset["arrives"]), s.steps, t, this.speed)}`;
    }

    // Earth's offer, and the contracts taken.
    const offerKey = JSON.stringify(e.offer);
    if (offerKey !== this.keys.offer) {
      this.keys.offer = offerKey;
      if (e.offer === null) this.offer.replaceChildren(el("p", "earth-none", "Earth makes an offer at each launch window, once a city has people."));
      else {
        const o = e.offer;
        const box = el("section", "earth-contract");
        box.dataset["kind"] = o.kind;
        box.dataset["offer"] = "";
        const accept = el("button", "earth-accept", "Accept");
        accept.type = "button";
        accept.addEventListener("click", () => {
          const out = this.hooks.onAccept();
          this.say(out.ok ? "Accepted: it counts from now." : `Not accepted: ${out.reason ?? "refused"}.`, out.ok);
          this.refresh();
        });
        box.append(
          el("p", "earth-contract-title", `Earth asks for ${contractAmount(o.kind, o.amount)}`),
          el("p", "earth-contract-pay", `Pays ${credits(o.reward)} and reputation +${t.EARTH_REP_FULFIL}. Failing costs reputation ${t.EARTH_REP_FAIL}.`),
          el("p", "earth-contract-how", contractHow(o.kind, t)),
          el("p", "earth-contract-when", ""),
          accept,
        );
        this.offer.replaceChildren(box);
      }
    }
    const when = this.offer.querySelector<HTMLElement>(".earth-contract-when");
    if (when !== null && e.offer !== null) when.textContent = `Due by the launch window in ${untilWords(windowStep(e.offer.due, t), s.steps, t, this.speed)}; the offer stands until the next window (${untilWords(windowStep(e.offer.id + 1, t), s.steps, t, this.speed)}).`;

    const contractsKey = JSON.stringify(e.contracts.map((c) => [c.id, c.kind, Math.floor(c.delivered)]));
    if (contractsKey !== this.keys.contracts) {
      this.keys.contracts = contractsKey;
      this.contracts.replaceChildren(
        ...e.contracts.map((c) => {
          const box = el("section", "earth-contract");
          box.dataset["kind"] = c.kind;
          const bar = el("div", "earth-bar");
          bar.setAttribute("role", "meter");
          bar.setAttribute("aria-valuemin", "0");
          bar.setAttribute("aria-valuemax", String(Math.round(c.amount)));
          bar.setAttribute("aria-valuenow", String(Math.floor(c.delivered)));
          bar.setAttribute("aria-label", `${contractAmount(c.kind, c.amount)} for Earth`);
          const fill = el("div", "earth-bar-fill");
          fill.style.width = `${Math.min(100, (100 * c.delivered) / c.amount).toFixed(1)}%`;
          bar.append(fill);
          box.append(el("p", "earth-contract-title", `${contractAmount(c.kind, c.delivered)} of ${contractAmount(c.kind, c.amount)} sent`), bar, el("p", "earth-contract-when", ""), el("p", "earth-contract-pay", `Pays ${credits(c.reward)} when met.`));
          box.dataset["id"] = String(c.id);
          return box;
        }),
      );
    }
    for (const box of this.contracts.querySelectorAll<HTMLElement>(".earth-contract")) {
      const line = box.querySelector<HTMLElement>(".earth-contract-when");
      const c = e.contracts.find((x) => String(x.id) === box.dataset["id"]);
      if (line !== null && c !== undefined) line.textContent = `Due by the launch window in ${untilWords(windowStep(c.due, t), s.steps, t, this.speed)}. ${contractHow(c.kind, t)}`;
    }

    const recordKey = e.log.length === 0 ? "" : String(e.log.at(-1)!.id);
    if (recordKey !== this.keys.record) {
      this.keys.record = recordKey;
      const lines = e.log.slice(-8).reverse();
      this.record.replaceChildren(
        ...(lines.length === 0
          ? [el("li", "earth-none", "Nothing yet.")]
          : lines.map((r) => {
              const words = recordWords(r, s);
              const li = el("li", "earth-record-line");
              li.dataset["kind"] = r.kind;
              li.append(el("span", "earth-record-title", words.title), el("span", "earth-record-text", words.text));
              if (r.settlement !== null) {
                const go = el("button", "earth-go", "Show");
                go.type = "button";
                const id = r.settlement;
                go.addEventListener("click", () => this.hooks.onGo({ kind: "city", id, at: null }));
                li.append(go);
              }
              return li;
            })),
      );
    }
  }

  clear(): void {
    this.keys = { market: "", cities: "", waiting: "", offer: "", contracts: "", record: "" };
    this.notice.hidden = true;
    this.state = null;
  }
}
