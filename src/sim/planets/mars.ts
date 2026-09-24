/**
 * Mars - the first world.
 *
 * The start vector is the "Mars start" column of design doc section 2.1, with
 * one documented change: `co2_reg` 120 -> 260.
 *
 * Why: at 120 the victory condition is arithmetically unreachable. Total
 * native carbon is 6 + 40 + 120 = 166 mbar, which at the mass-correct
 * stoichiometry (32/44) yields at most 120.7 mbar of oxygen against section
 * 2.3's 210 mbar target - so the oxygen axis ceilings at 0.575 and Phase 6 is
 * structurally out of reach no matter what the player does. 260 gives a 306
 * mbar inventory: 288.75 consumed to make 210 mbar of O2, leaving ~17 mbar,
 * of which ~16 is exactly the job section 5's carbon scrubbers exist to do and
 * ~1 is the section 2.3 endgame target. The budget closes at both ends.
 *
 * Section 3's science-vs-playability note already licenses generous
 * reservoirs, and section 3.3 already casts the regolith as "a much larger
 * reservoir, a slower second wave".
 */

import { startingEconomy } from "../economy.js";
import { unlockedFor } from "../tech.js";
import { DEFAULT_TUNING } from "../tuning.js";
import type { Tuning } from "../tuning.js";
import { Phase } from "../types.js";
import type { Reservoirs, SimState } from "../types.js";

/** Mars surface gravity, m/s^2. Sets H2O_MBAR_PER_M = rho * g / 100 = 37.11. */
export const G_MARS = 3.711;

export const MARS_START_RESERVOIRS: Reservoirs = Object.freeze({
  /** mbar. The present-day Martian atmosphere is ~6 mbar of CO2. */
  co2_atm: 6,
  /** mbar-eq frozen in the polar caps. Ignites first, fast. */
  co2_cap: 40,
  /**
   * mbar-eq adsorbed in the regolith. The slower second wave.
   *
   * TUNED 260 -> 300. The oxygen target costs 288.8 mbar of carbon at the
   * model's stoichiometry, and that price cannot be tuned away. At a 306 mbar
   * inventory the whole budget was 17 mbar of slack, and the reference
   * playthrough's carbon scrubber spent 18 of it - so a correct-looking player
   * action cost the oxygen target outright. 346 leaves ~40 mbar of room to be
   * wrong in.
   */
  co2_reg: 300,
  /** mbar. Mars has almost no nitrogen buffer; this is the whole problem. */
  n2: 0.2,
  /** mbar-eq of nitrate locked in the regolith. Section 3.6's "slow trickle". */
  n2_reg: 20,
  o2: 0.01,
  /** metres sea-level-equivalent, caps plus subsurface. */
  h2o_ice: 40,
  h2o_liq: 0,
  h2o_vap: 0,
  ghg: 0,
  biomass: 0,
});

export const MARS_ZERO_LEDGER = Object.freeze({
  c_fixed: 0,
  c_lost: 0,
  c_sequestered: 0,
  c_imported: 0,
  h2o_lost: 0,
  h2o_imported: 0,
  n2_lost: 0,
  n2_imported: 0,
  o2_lost: 0,
  ghg_lost: 0,
});

/** Mean radius of Mars, metres. Scales micro doc §1.1 and a settlement's plane (§1.2). */
export const MARS_RADIUS_M = 3_389_500;

/** A fresh, unplayed Mars. */
export function marsStart(seed = 123456, t: Tuning = DEFAULT_TUNING): SimState {
  return {
    schemaVersion: 7,
    planetId: "mars",
    seed,
    steps: 0,
    reservoirs: { ...MARS_START_RESERVOIRS },
    ledger: { ...MARS_ZERO_LEDGER },
    shieldStrength: 0,
    seeded: false,
    phaseReached: Phase.Barren,
    facilities: [],
    /**
     * Phase 0's tech, granted up front.
     *
     * A fresh world is already at `Phase.Barren`, so `unlockedFor` would grant
     * these on the first tick anyway - doing it here means a player who has
     * not ticked yet still sees the levers they can actually build.
     */
    techUnlocked: unlockedFor(Phase.Barren, []),
    economy: startingEconomy(t),
    settlements: [],
  };
}
