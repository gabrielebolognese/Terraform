/**
 * Travel, wired to a host (Batch 21): runs the `travel.ts` state machine and
 * turns its effects into calls on whatever shows the orbit and the city.
 *
 * The host is an interface so the whole journey - descents, arrivals,
 * city-to-city hops, flushes - can be driven in a test beside a real
 * `WorldDriver`, and the world compared with one that never travelled.
 */

import type { Pose, Travel } from "./travel.js";
import { IN_ORBIT, goTo, goToOrbit, residentCity, step, travelPose } from "./travel.js";
import type { Transition } from "./travel.js";

export interface JourneyHost {
  /** Load a settlement's scene and show it; the orbit view steps aside. */
  load(id: string): void;
  /** Unload it; the orbit view comes back. */
  unload(id: string): void;
  /** Write the save now. */
  flush(): void;
  /** Drive the globe's camera during a journey, or hand it back (null). */
  pose(p: Pose | null): void;
  /** The globe's camera as the player left it - where a pull-back returns to. */
  currentPose(): Pose;
}

export class Journey {
  private travel: Travel = IN_ORBIT;
  private home: Pose | null = null;

  constructor(
    private readonly host: JourneyHost,
    private readonly siteOf: (id: string) => { lat: number; lon: number } | null,
  ) {}

  get phase(): Travel["phase"] {
    return this.travel.phase;
  }

  /** The settlement whose scene is resident, or null. */
  get resident(): string | null {
    return residentCity(this.travel);
  }

  /** Where the journey is heading, for the UI. */
  get destination(): string | null {
    const t = this.travel;
    return t.phase === "orbit" ? null : t.phase === "ascending" ? t.next : t.id;
  }

  goTo(id: string, now: number): void {
    if (this.siteOf(id) === null) return;
    if (this.travel.phase === "orbit") this.home = this.host.currentPose();
    this.apply(goTo(this.travel, id, now));
  }

  goToOrbit(now: number): void {
    this.apply(goToOrbit(this.travel, now));
  }

  /** Once per animation frame: finish whatever finished, and pose the camera. */
  frame(now: number): void {
    this.apply(step(this.travel, now));
    if (this.home === null) return;
    const pose = travelPose(this.travel, now, this.home, this.siteOf);
    if (pose !== null) this.host.pose(pose);
    else if (this.travel.phase === "orbit") {
      // Back where the player left it: the globe is theirs again.
      this.host.pose(this.home);
      this.host.pose(null);
      this.home = null;
    }
  }

  /** The settlement vanished (a reset): drop everything, back to orbit at once. */
  abort(): void {
    const id = this.resident;
    if (id !== null) this.host.unload(id);
    this.travel = IN_ORBIT;
    if (this.home !== null) {
      this.host.pose(this.home);
      this.host.pose(null);
    }
    this.home = null;
  }

  private apply(t: Transition): void {
    this.travel = t.travel;
    for (const e of t.effects) {
      if (e.type === "load") this.host.load(e.id);
      else if (e.type === "unload") this.host.unload(e.id);
      else this.host.flush();
    }
  }
}
