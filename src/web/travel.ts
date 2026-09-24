/**
 * Micro §1.4 - travel between orbit and a city, as a small state machine.
 *
 *   orbit --goTo--> descending --(TRAVEL_MS)--> city
 *   city --goToOrbit--> ascending --(TRAVEL_MS)--> orbit
 *   city --goTo(other)--> ascending --(TRAVEL_MS)--> descending(other) --> city(other)
 *
 * "No direct city-to-city warp in the basic version; the orbit hop reinforces
 * the sense of a planet." And §9.2: "Only the settlement the player has
 * traveled into is fully loaded" - a scene is resident only in `city`. It is
 * loaded on arrival and unloaded the moment the player leaves, before the
 * camera pulls back ("flushed to the save, the scene unloads, the camera
 * pulls back").
 *
 * Pure: time comes in as an argument, and what the host must do comes back
 * as effects. Nothing here touches the simulation - travel is a change of
 * view, and the world advances identically underneath it (Batch 21's gate).
 */

import { TRAVEL_MS, TRAVEL_ZOOM } from "./config.js";

export type Travel =
  | { readonly phase: "orbit" }
  | { readonly phase: "descending"; readonly id: string; readonly start: number }
  | { readonly phase: "city"; readonly id: string }
  | { readonly phase: "ascending"; readonly id: string; readonly start: number; readonly next: string | null };

/** What the host must do as a result of a transition. */
export type TravelEffect =
  | { readonly type: "load"; readonly id: string }
  | { readonly type: "unload"; readonly id: string }
  /** Write the save now (§1.4: "The city's state is flushed to the save"). */
  | { readonly type: "flush" };

export interface Transition {
  readonly travel: Travel;
  readonly effects: readonly TravelEffect[];
}

export const IN_ORBIT: Travel = { phase: "orbit" };

const stay = (travel: Travel): Transition => ({ travel, effects: [] });

/**
 * Head for a settlement. From orbit, start down. From another city, go up
 * first and come down again. Requests made mid-flight are ignored: the
 * journey already under way finishes first.
 */
export function goTo(t: Travel, id: string, now: number): Transition {
  switch (t.phase) {
    case "orbit":
      return stay({ phase: "descending", id, start: now });
    case "city":
      if (t.id === id) return stay(t);
      return { travel: { phase: "ascending", id: t.id, start: now, next: id }, effects: [{ type: "flush" }, { type: "unload", id: t.id }] };
    default:
      return stay(t);
  }
}

/** Leave the city for orbit: flush, unload, then pull back. */
export function goToOrbit(t: Travel, now: number): Transition {
  if (t.phase !== "city") return stay(t);
  return { travel: { phase: "ascending", id: t.id, start: now, next: null }, effects: [{ type: "flush" }, { type: "unload", id: t.id }] };
}

/** Advance the clock: finish a descent (load the scene) or an ascent. */
export function step(t: Travel, now: number): Transition {
  if (t.phase === "descending" && now - t.start >= TRAVEL_MS) {
    return { travel: { phase: "city", id: t.id }, effects: [{ type: "load", id: t.id }, { type: "flush" }] };
  }
  if (t.phase === "ascending" && now - t.start >= TRAVEL_MS) {
    return stay(t.next === null ? IN_ORBIT : { phase: "descending", id: t.next, start: now });
  }
  return stay(t);
}

/** The settlement whose scene is loaded - never more than one, and none while moving. */
export function residentCity(t: Travel): string | null {
  return t.phase === "city" ? t.id : null;
}

// ---------------------------------------------------------------------------
// The camera move
// ---------------------------------------------------------------------------

export interface Pose {
  readonly yaw: number;
  readonly pitch: number;
  readonly zoom: number;
}

/** Keep the pole from tipping past where the globe allows it. */
const MAX_PITCH = 1.35;

/**
 * The pose that puts (lat, lon) at the centre of the disc, facing the viewer.
 *
 * With the shader's rotation (`toViewJs`), a surface point faces the viewer
 * when yaw = lon - pi/2 and pitch = lat. The yaw is taken as the equivalent
 * angle nearest `fromYaw`, so the planet turns the short way round.
 */
export function aimAt(lat: number, lon: number, fromYaw: number): { yaw: number; pitch: number } {
  const target = lon - Math.PI / 2;
  const turn = target - fromYaw;
  const shortest = turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI));
  return { yaw: fromYaw + shortest, pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, lat)) };
}

function ease(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
}

function mixPose(a: Pose, b: Pose, u: number): Pose {
  // Land exactly on the end pose: a + (b - a) * 1 need not equal b in floating point.
  if (u >= 1) return b;
  const k = ease(u);
  return { yaw: a.yaw + (b.yaw - a.yaw) * k, pitch: a.pitch + (b.pitch - a.pitch) * k, zoom: a.zoom + (b.zoom - a.zoom) * k };
}

/** The close pose over a site: aimed at it and zoomed right in. */
export function overSite(site: { lat: number; lon: number }, fromYaw: number): Pose {
  return { ...aimAt(site.lat, site.lon, fromYaw), zoom: TRAVEL_ZOOM };
}

/**
 * Where the globe's camera is during a journey, or null when the player has
 * it (in orbit) or it is hidden (in a city). `home` is the orbit the player
 * left from, so the pull-back returns them to where they were.
 */
export function travelPose(t: Travel, now: number, home: Pose, siteOf: (id: string) => { lat: number; lon: number } | null): Pose | null {
  if (t.phase === "descending") {
    const site = siteOf(t.id);
    if (site === null) return null;
    return mixPose(home, overSite(site, home.yaw), (now - t.start) / TRAVEL_MS);
  }
  if (t.phase === "ascending") {
    const site = siteOf(t.id);
    if (site === null) return null;
    return mixPose(overSite(site, home.yaw), home, (now - t.start) / TRAVEL_MS);
  }
  return null;
}
