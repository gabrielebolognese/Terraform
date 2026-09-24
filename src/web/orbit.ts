/**
 * How the globe turns under the player's hand: drag, inertia, idle spin, zoom.
 *
 * Pure numbers, no DOM, so it can be tested without a browser. `globe.ts`
 * feeds it pointer deltas and frame times and reads the angles back.
 */

import { SCENE } from "../render/planet.js";

export interface Orbit {
  /** Rotation about the pole, radians. */
  readonly yaw: number;
  /** Tilt of the pole toward the viewer, radians. Starts at the renderer's own tilt. */
  readonly pitch: number;
  /** Radians per second, carried after a release. */
  readonly yawVelocity: number;
  readonly pitchVelocity: number;
  /** Disc size multiplier. */
  readonly zoom: number;
  /** Seconds since the player last touched it. */
  readonly idle: number;
}

export const ORBIT = {
  /** Never tip past the pole: the planet would turn upside down under the cursor. */
  maxPitch: 1.35,
  /** Fraction of inertial velocity kept per second. */
  friction: 0.06,
  /** The slow spin a planet gets when nobody is holding it, radians per second. */
  idleSpin: 0.035,
  /** Seconds of stillness before the idle spin starts, and how long it takes to ease in. */
  idleDelay: 2.5,
  idleEase: 3,
  minZoom: 0.55,
  maxZoom: 1.75,
} as const;

export function initialOrbit(): Orbit {
  return { yaw: 0, pitch: SCENE.tilt, yawVelocity: 0, pitchVelocity: 0, zoom: 1, idle: ORBIT.idleDelay };
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * A drag of (dx, dy) screen pixels on a disc of `radius` pixels.
 *
 * One radius of drag turns the globe by one radian, so the surface under the
 * cursor moves with it near the centre of the disc. Dragging down tips the
 * north pole toward the viewer.
 */
export function drag(o: Orbit, dx: number, dy: number, radius: number, dt: number): Orbit {
  const r = Math.max(radius, 1);
  const dYaw = dx / r;
  const dPitch = dy / r;
  const pitch = clamp(o.pitch + dPitch, -ORBIT.maxPitch, ORBIT.maxPitch);
  const step = Math.max(dt, 1 / 240);
  return {
    ...o,
    yaw: o.yaw + dYaw,
    pitch,
    // Velocity from this move, so a flick keeps turning after release.
    yawVelocity: dYaw / step,
    pitchVelocity: (pitch - o.pitch) / step,
    idle: 0,
  };
}

/** Advance by `dt` seconds with nobody holding it: inertia decays, then the idle spin eases in. */
export function coast(o: Orbit, dt: number): Orbit {
  const keep = Math.pow(ORBIT.friction, dt);
  const idle = o.idle + dt;
  const ease = clamp((idle - ORBIT.idleDelay) / ORBIT.idleEase, 0, 1);
  const pitch = clamp(o.pitch + o.pitchVelocity * dt, -ORBIT.maxPitch, ORBIT.maxPitch);
  return {
    ...o,
    yaw: o.yaw + (o.yawVelocity + ORBIT.idleSpin * ease) * dt,
    pitch,
    yawVelocity: o.yawVelocity * keep,
    pitchVelocity: pitch === o.pitch + o.pitchVelocity * dt ? o.pitchVelocity * keep : 0,
    idle,
  };
}

/** Held still under the cursor: no inertia, no idle spin. */
export function hold(o: Orbit): Orbit {
  return { ...o, yawVelocity: 0, pitchVelocity: 0, idle: 0 };
}

/** A wheel step; positive `delta` zooms out, as a scroll wheel reads. */
export function zoomBy(o: Orbit, delta: number): Orbit {
  return { ...o, zoom: clamp(o.zoom * Math.exp(-delta * 0.0012), ORBIT.minZoom, ORBIT.maxZoom) };
}
