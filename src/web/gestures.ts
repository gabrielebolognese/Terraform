/**
 * The wheel, the trackpad and touch (Batch 36), the same in every view: the
 * globe, the city, the planner and the world map.
 *
 * - A mouse wheel zooms - the other way with Invert zoom.
 * - A trackpad's pinch reaches the page as a wheel with Ctrl held: it zooms,
 *   fingers apart to come closer, whatever Invert zoom says (it is the
 *   fingers, not a wheel, that the player moves).
 * - With "Trackpad: two fingers move the map", a plain wheel - two fingers
 *   sliding - moves the view instead of zooming it.
 * - On a touch screen one finger drags, as a mouse does, and two pinch.
 */

import type { ControlSettings } from "./settings.js";

/** A trackpad pinch's steps are small: this makes one feel like a wheel's notch. */
export const PINCH_GAIN = 6;

/** A wheel's lines and pages in pixels, for a wheel that counts in them. */
function pixels(delta: number, mode: number): number {
  return mode === 1 ? delta * 16 : mode === 2 ? delta * 400 : delta;
}

/**
 * What a wheel event asks: a zoom (`zoom`, wheel units, positive is out, as a
 * wheel reads) or a move (`pan`, screen pixels the view's content follows).
 */
export function wheelIntent(e: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">, controls: Pick<ControlSettings, "invertZoom" | "scrollPans">): { readonly zoom: number } | { readonly pan: { readonly dx: number; readonly dy: number } } {
  const dy = pixels(e.deltaY, e.deltaMode);
  if (e.ctrlKey) return { zoom: dy * PINCH_GAIN };
  if (controls.scrollPans) return { pan: { dx: -pixels(e.deltaX, e.deltaMode), dy: -dy } };
  return { zoom: controls.invertZoom ? -dy : dy };
}

/**
 * Two fingers on a view: how far apart they move (a zoom about the point
 * between them) and how far that point moves (a pan). One finger is left to
 * the view's own drag.
 */
export class Pinch {
  private readonly points = new Map<number, { x: number; y: number }>();
  private last: { d: number; x: number; y: number } | null = null;

  /** A finger (or the mouse) down. True while two or more are down: the view should not drag. */
  down(e: Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "pointerType">): boolean {
    if (e.pointerType === "mouse") return false;
    this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.last = this.measure();
    return this.points.size >= 2;
  }

  /** A finger moved: the zoom factor and the pan since the last move, about the point between the two; null with fewer than two down. */
  move(e: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">): { readonly factor: number; readonly x: number; readonly y: number; readonly dx: number; readonly dy: number } | null {
    if (!this.points.has(e.pointerId)) return null;
    this.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = this.measure();
    const before = this.last;
    this.last = now;
    if (now === null || before === null || before.d <= 0) return null;
    return { factor: now.d / before.d, x: now.x, y: now.y, dx: now.x - before.x, dy: now.y - before.y };
  }

  up(e: Pick<PointerEvent, "pointerId">): void {
    this.points.delete(e.pointerId);
    this.last = this.measure();
  }

  /** Whether two fingers are down. */
  get active(): boolean {
    return this.points.size >= 2;
  }

  private measure(): { d: number; x: number; y: number } | null {
    if (this.points.size < 2) return null;
    const [a, b] = [...this.points.values()];
    return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  }
}
