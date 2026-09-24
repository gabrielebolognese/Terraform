/**
 * The scrubber has to show the playthrough the goldens came from.
 *
 * `recordArc` mirrors `runTrajectory` rather than calling it, because that
 * module is a CLI and pulls in `node:fs`. A mirror is a second implementation,
 * and a second implementation drifts - so the agreement is pinned here rather
 * than asserted in a comment.
 */

import { describe, expect, it } from "vitest";

import { DEFAULT_TUNING } from "../sim/index.js";
import { REFERENCE_POLICY } from "../harness/policy.js";
import { runTrajectory } from "../harness/run.js";
import { channelsOf } from "../harness/frames.js";
import { ARC_SAMPLE_YEARS, ARC_YEARS } from "./config.js";
import { recordArc } from "./arc.js";

const arc = recordArc(DEFAULT_TUNING);
const reference = runTrajectory(REFERENCE_POLICY, ARC_YEARS, ARC_SAMPLE_YEARS, DEFAULT_TUNING);

describe("recordArc", () => {
  it("covers the whole reference playthrough", () => {
    expect(arc.length).toBe(ARC_YEARS / ARC_SAMPLE_YEARS + 1);
    expect(arc[0]?.year).toBe(0);
    expect(arc[arc.length - 1]?.year).toBeCloseTo(ARC_YEARS, 6);
  });

  it("advances in time and never goes backwards", () => {
    for (let i = 1; i < arc.length; i += 1) {
      expect(arc[i]!.year).toBeGreaterThan(arc[i - 1]!.year);
    }
  });

  /**
   * EXACT, not approximate. The engine's determinism guarantee says one long
   * run equals many short ones bit for bit, so any difference here is a
   * difference in what the two consider "the reference playthrough" - which is
   * precisely the drift this test exists to catch.
   */
  it("agrees with the harness sample for sample, exactly", () => {
    expect(arc.length).toBe(reference.samples.length);
    for (let i = 0; i < arc.length; i += 1) {
      const mine = arc[i]!;
      const theirs = reference.samples[i]!;
      expect(mine.year, `year at sample ${i}`).toEqual(theirs.year);
      expect(mine.progress, `progress at sample ${i}`).toEqual(theirs.progress);
      expect(mine.channels, `channels at sample ${i}`).toEqual(channelsOf(theirs));
    }
  });

  it("records an arc that actually goes somewhere", () => {
    const first = arc[0]!;
    const last = arc[arc.length - 1]!;
    expect(first.progress).toBeLessThan(0.15);
    expect(last.progress).toBeGreaterThan(0.9);
    // A dead Mars becomes a living one: the two ends must not be the same planet.
    expect(last.channels.surfaceGreen - first.channels.surfaceGreen).toBeGreaterThan(0.3);
    expect(last.channels.atmosphereThickness - first.channels.atmosphereThickness).toBeGreaterThan(0.5);
  });

  it("is deterministic - two recordings are identical", () => {
    const again = recordArc(DEFAULT_TUNING);
    expect(again).toEqual(arc);
  });
});
