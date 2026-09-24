/**
 * Micro §1.4: "Player selects a marker and confirms travel." The confirm.
 *
 * One small dialog over the globe: where the player is about to go, a button
 * to go down, and a way back out (the button, or Escape).
 */

export class TravelPrompt {
  readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private readonly go: HTMLButtonElement;
  private pending: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "travel-prompt";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Travel");
    this.root.hidden = true;
    this.text = document.createElement("p");
    this.text.className = "travel-prompt-text";
    this.go = document.createElement("button");
    this.go.type = "button";
    this.go.className = "travel-prompt-go";
    this.go.textContent = "Go down";
    this.go.addEventListener("click", () => this.confirm());
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "travel-prompt-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => this.close());
    const row = document.createElement("div");
    row.className = "travel-prompt-actions";
    row.append(this.go, cancel);
    this.root.append(this.text, row);
    host.append(this.root);
    globalThis.addEventListener?.("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && !this.root.hidden) this.close();
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Ask whether to travel to `label`; `onGo` runs only if the player confirms. */
  ask(label: string, where: string, onGo: () => void): void {
    this.pending = onGo;
    this.text.textContent = `Travel down to ${label}? (${where})`;
    this.root.hidden = false;
    this.go.focus?.();
  }

  close(): void {
    this.pending = null;
    this.root.hidden = true;
  }

  private confirm(): void {
    const go = this.pending;
    this.close();
    go?.();
  }
}
