/**
 * Batch 22's exit gate: "A settlement's `base_elev_m` agrees with the
 * elevation the globe draws at its marker (one field, not two)."
 *
 * The oracle is the globe's own coastline rule (`globeCoastRankJs`, the
 * shader's rule in TypeScript, as `toPlanetJs` mirrors its rotation): the
 * globe draws a point as sea where that jittered rank is below the ocean
 * fraction. The simulation says a site is under the sea where its elevation
 * is below the curve's elevation at the ocean fraction. If the two used
 * different fields, different tables, different coordinates or a curve that
 * ever fell, they would disagree far from the shore. They may only disagree
 * inside the globe's coastline jitter.
 */

import { describe, expect, it } from "vitest";

import { COAST_DETAIL, globeCoastRankJs } from "../render/globe-shader.js";
import { elevationCdf } from "../shared/planet-terrain.js";
import { DEFAULT_TUNING, elevationAtRank, siteElevation } from "../sim/index.js";

const t = DEFAULT_TUNING;

describe("one elevation field: the settlements and the globe agree about the sea", () => {
  let s = 12345;
  const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const sites = Array.from({ length: 5000 }, () => ({ lat: Math.asin(2 * rnd() - 1), lon: (rnd() * 2 - 1) * Math.PI }));
  const OCEANS = [0.05, 0.2, 0.364, 0.5, 0.75];

  function survey(): { checks: number; wet: number; disagree: number; worstMetres: number } {
    let checks = 0;
    let wet = 0;
    let disagree = 0;
    let worstMetres = 0;
    for (const { lat, lon } of sites) {
      const p: [number, number, number] = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
      const globeRank = globeCoastRankJs(p, elevationCdf());
      const base = siteElevation(lat, lon, t);
      for (const ocean of OCEANS) {
        checks += 1;
        const sea = elevationAtRank(ocean, t);
        const simWet = base < sea;
        if (simWet) wet += 1;
        if (simWet !== globeRank < ocean) {
          disagree += 1;
          worstMetres = Math.max(worstMetres, Math.abs(base - sea));
        }
      }
    }
    return { checks, wet, disagree, worstMetres };
  }

  it("disagrees only at the shore, inside the globe's coastline jitter", () => {
    // Measured: 43 of 25,000 checks (0.17%), all within 125 m of sea level.
    // The jitter spans COAST_DETAIL/2 = 0.011 of rank either way; the largest
    // rank gap of a disagreement was 0.0043.
    const r = survey();
    expect(r.disagree / r.checks).toBeLessThan(0.01);
    // A disagreement far from the shore means two fields: at the steepest part
    // of the curve, 0.011 of rank is 0.011 * 8 * 5000 m = 440 m.
    expect(r.worstMetres).toBeLessThan(COAST_DETAIL * 0.5 * 8 * (t.HYPSO_ELEV_8 - t.HYPSO_ELEV_7));
  });

  it("had both land and sea to agree about - the survey is not vacuous", () => {
    const r = survey();
    expect(r.wet).toBeGreaterThan(r.checks * 0.2);
    expect(r.checks - r.wet).toBeGreaterThan(r.checks * 0.2);
  });
});
