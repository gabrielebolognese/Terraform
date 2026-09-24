/**
 * Architecture guards.
 *
 * Cross-batch invariants #1 (purity), #2 (one-way dependency) and #4 (all
 * constants in tuning.ts) are properties of the SOURCE, not of any single
 * function's behaviour, so they are tested by reading the source. The
 * tsconfig split catches half of this - `src/sim/` compiles without the DOM
 * library, so `document` is not even in scope there - but it cannot see the
 * direction of an import, and it cannot see `Date.now()`.
 *
 * These read as pedantic until the first time a renderer reaches back into the
 * simulation and offline progression quietly stops being reproducible.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { advance, simYear } from "./integrate.js";
import { tick } from "./tick.js";
import { derive } from "./derive.js";
import { effectiveEnv } from "./facilities/index.js";
import { buildFacility } from "./actions.js";
import { marsStart } from "./planets/mars.js";
import { eventEnv, stormIntensity } from "./events.js";
import { DEFAULT_TUNING, makeTuning } from "./tuning.js";
import { NEUTRAL_ENV } from "./types.js";
import type { ForcingFn } from "./rates/index.js";

const SIM_DIR = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (extname(full) === ".ts") {
      out.push(full);
    }
  }
  return out;
}

const ALL = sourceFiles(SIM_DIR);
const PRODUCTION = ALL.filter((f) => !f.endsWith(".test.ts"));

const RENDER_DIR = join(SIM_DIR, "..", "render");
const RENDER_PRODUCTION = sourceFiles(RENDER_DIR).filter((f) => !f.endsWith(".test.ts"));

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Source with comments stripped.
 *
 * Every check below is about what the code DOES, and these files document
 * precisely the traps they avoid - `dev.ts` explains why it does not read
 * `process.env`, `planets/mars.ts` explains where `H2O_MBAR_PER_M` comes
 * from. Scanning raw text would flag each of those explanations as the very
 * violation it is warning about.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function relative(file: string): string {
  return file.slice(SIM_DIR.length + 1).replace(/\\/g, "/");
}

function renderRelative(file: string): string {
  return `render/${file.slice(RENDER_DIR.length + 1).replace(/\\/g, "/")}`;
}

describe("the simulation has no host dependencies (invariant #2)", () => {
  it("imports nothing from a rendering or UI layer", () => {
    for (const file of ALL) {
      const offending = /from\s+["'][^"']*\/(web|render|ui)\//.exec(code(file));
      expect(offending, `${relative(file)} reaches into a host layer`).toBeNull();
    }
  });

  it("touches no browser or Node global", () => {
    const banned = /\b(document|window|localStorage|sessionStorage|navigator|performance\.now)\b/;
    for (const file of PRODUCTION) {
      expect(banned.exec(code(file)), `${relative(file)} touches a host global`).toBeNull();
    }
  });
});

describe("the simulation is deterministic (invariant #1, invariant #5)", () => {
  it("contains no wall-clock or randomness", () => {
    // Both would make offline catch-up irreproducible, which is the one thing
    // section 8.2's whole design depends on.
    const banned = /\b(Date\.now|Math\.random|new Date)\b/;
    for (const file of PRODUCTION) {
      expect(banned.exec(code(file)), `${relative(file)} is not deterministic`).toBeNull();
    }
  });

  it("performs no I/O", () => {
    const banned = /\b(readFileSync|writeFileSync|fetch|require\(|process\.env)\b/;
    for (const file of PRODUCTION) {
      expect(banned.exec(code(file)), `${relative(file)} performs I/O`).toBeNull();
    }
  });
});

describe("the visualization contract does not know about phases", () => {
  /**
   * §9's whole claim is that "the visuals move continuously underneath"
   * the phases - phases change tech and UI, not what the planet looks like.
   * The moment a channel branches on phase, the planet starts snapping between
   * discrete looks at boundaries, which is precisely the "colored keys"
   * failure §0.3 names Per Aspera for.
   *
   * This is structural, so it is checked structurally. A continuity test can
   * only sample; this cannot be got round.
   */
  it("visuals.ts never mentions phase", () => {
    const file = PRODUCTION.find((f) => relative(f) === "visuals.ts");
    expect(file, "visuals.ts not found").toBeDefined();
    const body = code(file ?? "");
    expect(/phase/i.test(body), "visuals.ts refers to phase").toBe(false);
    expect(/progress/i.test(body), "visuals.ts refers to progress").toBe(false);
  });
});

/**
 * Invariant #2 from the other side.
 *
 * The rest of this file checks that the simulation does not reach out to the
 * host. This checks that the renderer does not reach INTO the simulation -
 * because the §9 contract is only worth having if it is the whole interface.
 * A renderer that can read `reservoirs.h2o_ice` will read it the first time a
 * channel is inconvenient, and from then on the contract documents an
 * interface that is no longer the real one.
 */
describe("the renderer sees only the visual contract (invariant #2)", () => {
  it("has renderer sources to check", () => {
    // Without this the three checks below pass vacuously if the directory
    // is ever moved or renamed.
    expect(RENDER_PRODUCTION.length).toBeGreaterThan(0);
  });

  it("imports nothing from the simulation but the two view contracts", () => {
    // Matches a value import as well as a type-only one, so smuggling a
    // constant across by dropping `type` is caught too.
    const simImport = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']*sim[^"']*)["']/g;
    for (const file of RENDER_PRODUCTION) {
      for (const match of code(file).matchAll(simImport)) {
        const named = (match[1] ?? "")
          .split(",")
          .map((n) => n.replace(/\btype\b/, "").trim())
          .filter(Boolean);
        for (const name of named) {
          // The planet's contract, and since Batch 20 the city's - both
          // derived views, never the state behind them.
          expect(
            ["VisualChannels", "CityView", "CityBuildingView"],
            `${renderRelative(file)} imports ${name} from ${match[2]} - only VisualChannels and CityView may cross`,
          ).toContain(name);
        }
      }
    }
  });

  it("never names a reservoir, a phase or the progress metric", () => {
    const forbidden = [/\bphase\b/i, /\bprogress\b/i, /\bco2_atm\b/, /\bh2o_ice\b/, /\bbiomass\b/, /\breservoir/i];
    for (const file of RENDER_PRODUCTION) {
      const body = code(file);
      for (const pattern of forbidden) {
        expect(pattern.test(body), `${renderRelative(file)} names ${pattern}`).toBe(false);
      }
    }
  });

  it("does not reach for the DOM, a canvas or a clock", () => {
    // The tsconfig split already takes the DOM out of scope here, but it does
    // not stop `globalThis.document`, and it says nothing about Date.now().
    // The renderer has to stay runnable in Node for the golden frames to mean
    // anything.
    const forbidden = [/\bdocument\b/, /\bcanvas\b/i, /\bwindow\b/, /Date\.now/, /Math\.random/, /\bperformance\./];
    for (const file of RENDER_PRODUCTION) {
      const body = code(file);
      for (const pattern of forbidden) {
        expect(pattern.test(body), `${renderRelative(file)} reaches for ${pattern}`).toBe(false);
      }
    }
  });
});

describe("the unit bridge is held in one place", () => {
  it("only units.ts and tuning.ts may name H2O_MBAR_PER_M", () => {
    // The doc's factor-of-371 error survived because the conversion is spelled
    // out in three different terms in section 3.4, each of which could apply
    // it once, twice, or not at all. One owner, one direction each way.
    const allowed = new Set(["units.ts", "tuning.ts"]);
    for (const file of PRODUCTION) {
      if (allowed.has(relative(file))) continue;
      expect(code(file).includes("H2O_MBAR_PER_M"), `${relative(file)} names the unit bridge directly`).toBe(false);
    }
  });
});

describe("relative imports carry the .js extension (CLAUDE.md, ESM)", () => {
  it("every relative import ends in .js", () => {
    const importPattern = /from\s+["'](\.[^"']*)["']/g;
    for (const file of ALL) {
      for (const match of code(file).matchAll(importPattern)) {
        const specifier = match[1] ?? "";
        expect(specifier.endsWith(".js"), `${relative(file)} imports "${specifier}" without .js`).toBe(true);
      }
    }
  });
});

describe("balance lives in tuning.ts (invariant #4)", () => {
  it("the rate modules declare no numeric constants of their own", () => {
    // Structural literals (0, 1, array indices) are fine; a tunable magnitude
    // hiding in a rate module is not, because it makes the balance batch's
    // sweep silently incomplete.
    // facilities/ emits flows exactly like a rate module does, so it belongs
    // in the same scan. It was outside it, and a bare solar-multiplier floor
    // sat there where neither makeTuning nor the balance sweep could see it.
    const rateFiles = PRODUCTION.filter(
      (f) => relative(f).startsWith("rates/") || relative(f).startsWith("facilities/"),
    );
    expect(rateFiles.length).toBeGreaterThan(0);
    for (const file of rateFiles) {
      // Catch exponential (5e-4) and multi-digit integer (216) literals too,
      // not only ones with a decimal point. Single digits are structural -
      // array indices, the 0 and 1 in a clamp, `1 - x` - and are allowed.
      const suspicious = (code(file).match(/[^\w.]-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? [])
        .map((m) => m.slice(1))
        .filter((literal) => !/^-?[01]$/.test(literal));
      expect(suspicious, `${relative(file)} contains a bare tunable number`).toEqual([]);
    }
  });
});

/**
 * Findings 4 and 5 of the Batch 10 review: logic that lives only in `tick`.
 *
 * This class of defect has now occurred three times - the ledger assertion
 * (Batch 1), the tech unlock (Batch 9), and reservoir finiteness (found here).
 * Every time the cause is the same: `tick` is not on any path that drives the
 * game. Both production drivers call `advance` directly, and `catchUp` calls
 * `advance` too.
 *
 * So rather than fixing the third instance and waiting for the fourth, this
 * asserts the structural fact that causes it.
 */
describe("advance is the path that actually runs (Batch 10)", () => {
  it("is what the drivers call - tick is on no production path", () => {
    const callers = PRODUCTION.filter((f) => relative(f) !== "tick.ts")
      .filter((f) => /tick\s*\(/.test(code(f)));
    expect(callers.map(relative), "something in src/sim now calls tick - re-check what lives only there").toEqual(
      [],
    );
  });

  /**
   * BEHAVIOURAL, not a source grep.
   *
   * The first version of these grepped integrate.ts for `isFinite` and tick.ts
   * for `eventEnv`. Both passed with the logic removed - the first because the
   * word still appeared in an unrelated argument check, the second because the
   * IMPORT was still there. Same trap this project hit in `tuning.test.ts`: a
   * test that reads source text tests the source text.
   */
  it("catches a NaN reservoir on the path the drivers use", () => {
    const poison: ForcingFn = () => [
      { id: "forcing.ghg_import", from: null, to: "ghg", rate: Number.NaN, conversion: 1 },
    ];
    expect(() =>
      advance(marsStart(), 8, { tuning: DEFAULT_TUNING, env: NEUTRAL_ENV, forcing: poison }),
    ).toThrow(/ghg/);
  });

  /**
   * The wallet is NOT a reservoir, so it goes through none of `applyFluxes`.
   * Without this it reached the save as NaN, silently.
   */
  it("catches a NaN in the wallet, which no reservoir check covers", () => {
    const priced = makeTuning({ ECONOMY_ENABLED: 1 });
    const base = marsStart(123456, priced);
    const broke = { ...base, economy: { credits: Number.NaN, earned: 0, spent: 0 } };
    expect(() => advance(broke, 8, { tuning: priced, env: NEUTRAL_ENV, forcing: null })).toThrow(/credits/);
  });

  it("does not throw for the same runs without the poison", () => {
    // Or the two above would pass on any exception at all.
    expect(() => advance(marsStart(), 8, { tuning: DEFAULT_TUNING, env: NEUTRAL_ENV, forcing: null })).not.toThrow();
    const priced = makeTuning({ ECONOMY_ENABLED: 1 });
    expect(() =>
      advance(marsStart(123456, priced), 8, { tuning: priced, env: NEUTRAL_ENV, forcing: null }),
    ).not.toThrow();
  });

  it("reports the world it integrated, weather included", () => {
    const stormy = makeTuning({ EVENTS_ENABLED: 1 });
    const cfg = { tuning: stormy, env: NEUTRAL_ENV, forcing: null };
    let state = buildFacility(marsStart(), "orbital_mirror", 30, 1, stormy);

    // Walk until a storm is actually blowing, or this proves nothing.
    let stormYear = -1;
    for (let i = 0; i < 400 && stormYear < 0; i += 1) {
      state = advance(state, 4, cfg);
      const year = simYear(state, stormy);
      if (stormIntensity(state.seed, year, stormy) > 0.3) stormYear = year;
    }
    expect(stormYear, "no storm found to test against").toBeGreaterThan(0);

    const reported = tick(state, 0, cfg).derived.T;
    const calm = derive(state.reservoirs, effectiveEnv(NEUTRAL_ENV, state.facilities, stormy), stormy).T;
    const stormyT = derive(
      state.reservoirs,
      effectiveEnv(eventEnv(NEUTRAL_ENV, state.seed, simYear(state, stormy), stormy), state.facilities, stormy),
      stormy,
    ).T;

    expect(Math.abs(reported - stormyT), "tick reported the calm planet").toBeLessThan(1e-9);
    expect(Math.abs(calm - stormyT), "the storm made no difference, so this proves nothing").toBeGreaterThan(0.1);
  });
});
