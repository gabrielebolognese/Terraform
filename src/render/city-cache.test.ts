/**
 * The scene keeps its draw order and its ground shapes between frames
 * (Batch 22: rebuilding ~1,000 tile columns cost most of a 9 ms frame; with
 * the cache a frame costs 3.2 ms in Node). A cache is only safe if it is
 * thrown away exactly when the scene changes - checked here against a frame
 * built from an empty cache. Comparing two cached histories with each other
 * is not enough: a store carried over from layout to layout makes every
 * history equally stale, and that version passed such a test.
 */

import { describe, expect, it } from "vitest";

import { referenceCity } from "../harness/city-frames.js";
import type { CityView } from "../sim/index.js";
import { cityScene, resetSceneCache } from "./city.js";

const { view, options } = referenceCity();

/** The reference city with one more building: a depot on flat ground in the landing zone. */
const withDepot: CityView = {
  ...view,
  buildings: [
    ...view.buildings,
    { index: view.buildings.length, type: "storage_depot", tx: 19, ty: 19, size: 1, operable: true, activity: 1, baseZ: 0 },
  ],
};

/** A different settlement altogether: the same buildings on flat ground. */
const flat: CityView = { ...view, id: "elsewhere", groundZ: view.groundZ.map(() => 0), steep: view.steep.map(() => false) };

describe("the scene cache", () => {
  /** The scene built from an empty cache - the oracle. */
  const scratch = (v: CityView): ReturnType<typeof cityScene> => {
    resetSceneCache();
    return cityScene(v, options);
  };

  it("matches a frame built from scratch, whatever was drawn before", () => {
    for (const target of [view, withDepot, flat]) {
      const truth = scratch(target);
      for (const before of [view, withDepot, flat]) {
        resetSceneCache();
        cityScene(before, options);
        expect(cityScene(target, options), `${target.id} with ${target.buildings.length} buildings, after ${before.id}`).toEqual(truth);
      }
    }
  });

  it("rebuilds a building's kept shapes when it switches off or on", () => {
    // A building's static parts are kept per building; switching it off
    // changes their colours (a dark greenhouse, dull solar cells).
    const off: CityView = { ...view, buildings: view.buildings.map((b) => ({ ...b, operable: false, activity: 0 })) };
    const truthOff = scratch(off);
    const truthOn = scratch(view);
    resetSceneCache();
    cityScene(view, options);
    expect(cityScene(off, options)).toEqual(truthOff);
    expect(cityScene(view, options)).toEqual(truthOn);
    expect(truthOff).not.toEqual(truthOn);
  });

  it("gives the same frame twice in a row", () => {
    cityScene(flat, options); // leave something else in the cache
    const fresh = cityScene(view, options);
    const cached = cityScene(view, options);
    expect(cached).toEqual(fresh);
  });

  it("is rebuilt when a building is added - whatever was drawn before", () => {
    cityScene(view, options);
    const afterReference = cityScene(withDepot, options);
    cityScene(flat, options);
    const afterFlat = cityScene(withDepot, options);
    expect(afterReference).toEqual(afterFlat);
    // And the new building really changed the scene: its tile is no longer bare ground.
    expect(afterReference).not.toEqual(cityScene(view, options));
  });

  it("is rebuilt when the ground changes under the same settlement id", () => {
    cityScene(view, options);
    const hillsGone = { ...view, groundZ: view.groundZ.map(() => 0), steep: view.steep.map(() => false) };
    const viaCache = cityScene(hillsGone, options);
    cityScene(withDepot, options);
    expect(cityScene(hillsGone, options)).toEqual(viaCache);
    expect(viaCache).not.toEqual(cityScene(view, options));
  });
});
