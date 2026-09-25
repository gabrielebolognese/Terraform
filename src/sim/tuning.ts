/**
 * The tuning table - design doc section 10, plus the constants the spec uses
 * but never names.
 *
 * Invariant #4: no magic numbers anywhere else in `src/sim/`. Balance is
 * changed here and nowhere else.
 *
 * Tuning is a FROZEN OBJECT THREADED THROUGH CALLS, not module-level
 * `export const C_GH = 25`. Two reasons, both of which bite immediately:
 * Batch 1's own conservation test is only meaningful with the carbon sinks
 * dialled to zero, which is inexpressible against an ES module singleton; and
 * the balance batch has to run N tuning variants in one process, which module
 * constants would turn into a cache-busting dynamic-import hack.
 *
 * Values marked DIVERGENCE differ from the section 10 table. Each one is a
 * correctness fix with the arithmetic in the comment, recorded in
 * docs/balance/batch1-calibration.md.
 */

/** Density of liquid water, kg/m^3. */
const WATER_DENSITY = 1000;

/** Mars surface gravity, m/s^2. Also exported from planets/mars.ts. */
const G_MARS = 3.711;

/** Molar masses, g/mol. Used only to derive the photosynthesis stoichiometry. */
const M_O2 = 32;
const M_CO2 = 44;

const Y_CO2 = 2.5;

export const BASE_TUNING = Object.freeze({
  // -------------------------------------------------------------------------
  // Physical constants (section 10, "Constants")
  // -------------------------------------------------------------------------
  /** Stefan-Boltzmann constant, W/m^2/K^4. */
  SIGMA: 5.67e-8,
  /** Baseline solar flux at Mars, W/m^2. Mirrors multiply this via Env.sMultiplier. */
  S_MARS: 590,
  /** Water triple point, mbar. Below this, ice sublimates rather than melting. */
  P_TRIPLE: 6.1,
  /** Smoothstep width above P_TRIPLE, mbar. Section 3.4 specifies a hard cut; a hard
   *  cut on a quantity that starts 0.11 mbar above it is a coin toss every substep. */
  P_TRIPLE_W: 2.0,
  /** Freezing point of water, K. Spelled as a bare 273 in three places in the doc. */
  T_FREEZE: 273.15,

  // -------------------------------------------------------------------------
  // Temperature / greenhouse (sections 3.1, 3.2)
  // -------------------------------------------------------------------------
  /** Greenhouse strength, K per e-fold of (1 + P/P_REF). */
  C_GH: 25,
  /** Greenhouse pressure reference, mbar. */
  P_REF: 50,
  /**
   * DIVERGENCE (replaces G_GHG = 30). Engineered-greenhouse forcing is ADDITIVE
   * in its own log, not a multiplier on the whole greenhouse term.
   *
   * Section 3.1's `(1 + G_GHG * ghg/P)` makes the PFC boost a function of
   * mixing ratio rather than column amount. That is backwards as a game lever:
   * the player's first mbar of PFC is worth a 5.2x multiplier at the Mars
   * start and only 1.3x once P reaches 100 mbar, so the investment loses most
   * of its value exactly as it starts working. It is also unbounded - a 20 mbar
   * pure-PFC atmosphere gives f_ghg = 1 and T = 471 K, Venus in one project.
   */
  C_GHG: 6.0,
  /** Column reference for the engineered-GHG term, mbar. */
  GHG_REF: 0.1,
  /** Photolytic destruction of PFCs, /yr. They are not actually forever. */
  GHG_DECAY: 5e-4,
  /**
   * Weight of N2 inside the pressure that feeds the greenhouse term.
   *
   * 1.0 reproduces section 3.1 exactly and is the Batch 1 default. Naming it
   * lets the balance batch test a composition-aware greenhouse (~0.3, pressure
   * broadening only) without touching the equation - which matters because
   * section 3.6's prose claims nitrogen adds no greenhouse forcing while
   * section 3.1's equation gives its ~790 mbar about 35 K of it.
   */
  N2_GREENHOUSE_WEIGHT: 0.6,

  // Albedos (section 3.2)
  A_ICE: 0.6,
  A_OCEAN: 0.08,
  A_VEG: 0.18,
  A_BARE: 0.17,
  /** Bond albedo of a mixed water-cloud deck. Real decks span 0.4 to 0.7 by type. */
  A_CLOUD: 0.45,

  ALBEDO_MIN: 0.02,
  ALBEDO_MAX: 0.95,
  /** Floor on (1 - albedo) so the fourth root always has a positive base. */
  ALBEDO_ABSORB_MIN: 0.05,
  /** Floor on effective solar flux, W/m^2, so stacked solar shades cannot reach zero. */
  S_EFF_MIN: 1.0,
  /** Hard bounds on T, K. Every downstream exp() argument is bounded because these are. */
  T_FLOOR_K: 3,
  T_CEIL_K: 1000,

  // -------------------------------------------------------------------------
  // Surface cover maps (the four fractions section 2.2 names and never defines)
  // -------------------------------------------------------------------------
  /**
   * ice_frac = ICE_FRAC_MAX * (1 - exp(-(h2o_ice/ICE_M_REF + co2_cap/CO2_CAP_REF)))
   *
   * These are CALIBRATED, not chosen. Section 3.1's sanity anchor (albedo 0.25
   * at the Mars start) plus section 3.2's albedo formula with A_ICE = 0.60 and
   * A_BARE = 0.17 force ice_frac(40 m, 40 mbar) = (0.25 - 0.17)/(0.60 - 0.17)
   * = 0.1860. These values give 0.1868, so albedo(marsStart) = 0.2503.
   */
  ICE_FRAC_MAX: 0.85,
  ICE_M_REF: 270,
  CO2_CAP_REF: 400,
  /** ocean_frac = OCEAN_FRAC_MAX * (1 - exp(-h2o_liq/OCEAN_M_REF)). Hypsometric stand-in. */
  OCEAN_FRAC_MAX: 0.75,
  OCEAN_M_REF: 60,
  /** veg_frac = landFrac * biomass^VEG_EXP. Sub-linear so early life is visible. */
  VEG_EXP: 0.7,
  /** cloud_frac = CLOUD_FRAC_MAX * (1 - exp(-h2o_vap/CLOUD_VAP_REF)). */
  CLOUD_FRAC_MAX: 0.85,
  CLOUD_VAP_REF: 1.7,

  // -------------------------------------------------------------------------
  // CO2 reservoirs - the runaway engine (section 3.3)
  // -------------------------------------------------------------------------
  T_SUBL_CAP: 216,
  /**
   * TUNED (§10: 6). A wider ramp spreads the same 40 mbar of cap over a longer
   * stretch instead of dumping it in 60 years and leaving a flat patch behind.
   */
  W_CAP: 10,
  R_CAP: 0.8,
  /**
   * TUNED (§10: 240). The two CO2 waves did not overlap.
   *
   * Dumping the caps takes pressure to ~46 mbar, which is worth about 13 K of
   * greenhouse and tops the planet out near 229 K - short of the 240 K the
   * regolith needed. So the first wave ended, the second had not started, and
   * the progress bar went flat for 60 sim-years in between. §3.3 describes the
   * regolith as "a slower second wave that sustains the mid game", which means
   * overlapping the first, not waiting for it to finish.
   */
  T_SUBL_REG: 230,
  W_REG: 12,
  /**
   * TUNED (§10: 0.4). At 0.4 the "second wave" released 0.16 mbar/yr, a crawl
   * rather than a wave, and the mid-game was the longest stall in the run.
   */
  R_REG: 1.0,
  /**
   * Sigmoid tail cut. At 0.5, `ramp` is exactly `clamp01(tanh((T-T0)/(2W)))`:
   * identically zero at and below the threshold.
   */
  SIG_CUT: 0.5,
  /** Depletion scale for `avail()` on CO2 reservoirs, mbar. */
  CO2_DEPLETE_SCALE: 2.0,

  // -------------------------------------------------------------------------
  // Water cycle (section 3.4)
  // -------------------------------------------------------------------------
  M_RATE: 0.5,
  F_RATE: 0.5,
  W_MELT: 5,
  /**
   * DIVERGENCE: 0.1 -> 37.11, a factor of 371.
   *
   * A hydrostatic column's pressure is rho*g*h, so one metre of sea-level-
   * equivalent water on Mars is 1000 * 3.711 = 3711 Pa = 37.11 mbar.
   * At 0.1 the entire 40 m inventory would be 4 mbar - 0.4% of a 1 bar
   * atmosphere - so section 4's water-vapour feedback, one of the three named
   * positive loops, contributes under 0.1 K and is a literal no-op. Worse, the
   * vapour reservoir is then effectively bottomless in metres, so condensation
   * never fires and the ocean evaporates permanently.
   */
  H2O_MBAR_PER_M: (WATER_DENSITY * G_MARS) / 100,
  /** Saturation vapour pressure at the triple point, mbar. */
  E_SAT_REF: 6.112,
  /** L/Rv for water, K. Clausius-Clapeyron slope. */
  L_OVER_RV: 5420,
  /** Ceiling on sat(T), mbar, so a vapour subtraction can never be Infinity - Infinity. */
  SAT_MAX_MBAR: 1e6,
  /**
   * DIVERGENCE (replaces E_RATE / C_RATE = 0.3 / 0.3). Evaporation and
   * condensation are one saturation-relaxation exchange, integrated exactly.
   *
   * Section 3.4's `evaporate = E_RATE * sat(T)` has no saturation ceiling: it
   * runs at full rate however much vapour is already aloft, so every drop of
   * liquid boils off and ocean_frac goes permanently to zero. The relaxation
   * form is also unconditionally stable at any step size, which removes what
   * would otherwise be the stiffest term in the model from the substep budget.
   */
  VAP_COL_FRAC: 0.2,
  K_VAP: 4.0,
  /** The ice -> vapour path section 3.4 describes in prose and never writes. */
  SUBL_RATE: 0.05,
  T_SUBL_H2O: 190,
  W_SUBL_H2O: 30,
  /**
   * Depletion scale for `avail()` on water reservoirs, m SLE.
   *
   * Not free: near exhaustion a reservoir on an `avail(x, S)` ramp gives up
   * `R * h / S` of what remains every substep, independent of how little is
   * left. At S = 0.2 that is 62% per substep for melting, which trips the
   * flux tripwire. `validateTuning` now enforces the relationship
   * S >= R_max * SUBSTEP_YEARS / FLUX_ASSERT_MAX_FRAC, so a future retune
   * cannot quietly reintroduce it.
   */
  H2O_DEPLETE_SCALE: 1.0,

  // -------------------------------------------------------------------------
  // Biomass (section 3.5)
  // -------------------------------------------------------------------------
  /**
   * TUNED (§10: 0.15). With the maintenance gate on, the biomass fixed point
   * is `b* = 1 - M_PHOTO/R_BIO`, so this ratio IS the endgame biomass. At
   * 0.05/0.15 it is 0.667, which is 83% of the §2.3 target of 0.8 and caps the
   * progress bar below 1 no matter what the player does. At 0.11/0.75 it is
   * 0.853, comfortably past.
   */
  R_BIO: 0.75,
  D_BIO: 0.1,
  OCEAN_FOR_LIFE: 0.05,
  T_LIFE_LO: 278,
  T_LIFE_HI: 313,
  /** Shoulder half-width on the plateau band, K. */
  T_LIFE_EDGE_W: 8,
  P_LIFE_MIN: 100,
  P_LIFE_OK: 300,
  O2_FIRE_FRAC: 0.3,
  O2_FIRE_W: 0.1,
  /** mbar of CO2 consumed per unit of photosynthetic activity. */
  Y_CO2,
  /**
   * DIVERGENCE: 2.0 -> 1.8182.
   *
   * Section 2.1 defines gas reservoirs as the pressure they would contribute,
   * and pressure is column weight, so an mbar is proportional to MASS.
   * Photosynthesis is CO2 + H2O -> CH2O + O2: one mole of O2 per mole of CO2,
   * which in mass-equivalent pressure units is 32/44 = 0.7273, not the table's
   * 2.0/2.5 = 0.8. Written as an expression so a retune of Y_CO2 cannot
   * silently break the stoichiometry - and the die-off reverse reaction uses
   * the same ratio backwards, so a full grow/die cycle is carbon-neutral.
   */
  Y_O2: (Y_CO2 * M_O2) / M_CO2,
  /**
   * Maintenance photosynthesis of a standing biosphere, /yr.
   *
   * TUNED (§10: 0.05). Raised with R_BIO to keep `b*` past target while
   * shortening the oxygen tail, which was 58% of the run. Raising it ALONE is
   * fatal: at 0.2 with R_BIO 0.15 the fixed point goes negative and the
   * biosphere dies at 99% of the oxygen target, which the sweep measured.
   */
  M_PHOTO: 0.11,
  /**
   * How far the maintenance draw is gated on suitability. 0 = section 3.5 as
   * written, 1 = fully gated.
   *
   * Ungated, the biosphere has no carbon fixed point: it fixes at M_PHOTO*b
   * regardless of conditions, drains the air, and starves. Gated, carbon
   * settles where `M_PHOTO*g = D_BIO*(1-g)` and biomass settles at
   * `b* = 1 - M_PHOTO/R_BIO`. See rates/biomass.ts and the Batch 3 report.
   */
  MAINTENANCE_GATE: 1.0,
  /** Fifth suitability gate: life needs a carbon source, mbar. */
  CO2_FOR_LIFE: 0.5,
  /** Floor under co2_atm that photosynthesis may not draw below, mbar. */
  CO2_FLOOR: 0.01,
  /** Once seeded, biomass never quite reaches zero, so a recovered climate can regrow. */
  BIOMASS_REFUGIA: 1e-4,
  /** Section 3.5's unspecified "small positive value". Below the Phase 4 threshold on purpose. */
  SEED_AMOUNT: 0.02,

  // -------------------------------------------------------------------------
  // Nitrogen (section 3.6)
  // -------------------------------------------------------------------------
  /** Regolith nitrate release, mbar/yr. Section 3.6's "slow trickle". */
  R_N2: 0.02,
  T_NITRATE: 255,
  W_N2: 15,

  // -------------------------------------------------------------------------
  // Player levers (section 5)
  // -------------------------------------------------------------------------
  /**
   * A facility's contribution scales with `count * level`, capped here.
   *
   * One uniform cap rather than nine per-facility ones: without an economy
   * (Batch 9) there is nothing to make one lever scarcer than another, so
   * nine separate numbers would be nine arbitrary numbers. The economy batch
   * is where per-lever limits become meaningful.
   */
  FACILITY_MAX_COUNT: 50,
  FACILITY_MAX_LEVEL: 5,
  /**
   * How fast ordered capacity comes online, effective units per sim-year.
   *
   * This is what makes section 5's design rule true of the ENV levers, which
   * otherwise move temperature with no lag. At 0.5, the ~14 mirror units
   * needed to push the Mars start over the cap-sublimation threshold take 28
   * sim-years to deploy - just past MIN_PHASE_CROSS_YEARS. Deliberately tight:
   * the balance batch owns the final value, and this one is set to the
   * smallest number that satisfies the rule rather than a comfortable margin.
   */
  FACILITY_BUILD_RATE: 0.5,
  /** The design rule, as a number a test can check. */
  MIN_PHASE_CROSS_YEARS: 25,

  /** Fractional change in effective solar flux per deployed unit. */
  MIRROR_S_PER_UNIT: 0.004,
  SHADE_S_PER_UNIT: 0.004,
  /** PFC production, mbar/yr per deployed unit. */
  GHG_FACTORY_PER_UNIT: 0.0004,
  /** Regolith venting, mbar/yr per deployed unit. Moves co2_reg -> co2_atm; it does not create carbon. */
  ATMO_PROCESSOR_PER_UNIT: 0.02,
  /** Cometary water delivery, m SLE/yr per deployed unit. */
  COMET_ICE_PER_UNIT: 0.004,
  /** Nitrogen delivery, mbar/yr per deployed unit. */
  N2_IMPORT_PER_UNIT: 0.035,
  /** Carbon sequestration, mbar/yr per deployed unit. */
  SCRUBBER_PER_UNIT: 0.02,
  /**
   * Depletion scale for facility draws on a CO2 reservoir, mbar.
   *
   * Separate from CO2_DEPLETE_SCALE because facility draws are far larger than
   * natural ones: a maxed atmospheric processor or scrubber pulls
   * 0.02 * 50 * 5 = 5 mbar/yr, against 0.8 for the polar caps. A reservoir on
   * an `avail(x, S)` ramp gives up `rate * h / S` of what remains every
   * substep however little is left, so sharing the natural scale of 2.0 put
   * both levers 2.5x over the flux tripwire and threw mid-run at legal
   * settings. `validateTuning` now enforces this one too.
   */
  FACILITY_DEPLETE_SCALE: 6.0,
  /** Floor on the solar multiplier the env levers may produce. */
  S_MULTIPLIER_MIN: 0.05,
  /** Shield strength at full deployment, per deployed unit. */
  SHIELD_PER_UNIT: 0.004,
  /** How fast shield strength follows its deployed target, per sim-year. */
  SHIELD_BUILD_RATE: 0.05,
  /**
   * Floor under any lever that REMOVES atmosphere, mbar.
   *
   * The melt gate sits at P_TRIPLE = 6.1 and the Mars start is 6.21 - a margin
   * of 0.11 mbar. Section 5's carbon scrubber subtracts co2_atm directly, so a
   * player who scrubs early can push pressure under the triple point and
   * permanently lock liquid water out of the run, with nothing on screen
   * explaining why. 8.0 mbar is 1.3x the triple point.
   */
  P_FLOOR: 8.0,
  P_FLOOR_W: 2.0,

  // -------------------------------------------------------------------------
  // Atmospheric loss (section 3.7)
  // -------------------------------------------------------------------------
  /**
   * DIVERGENCE: 5e-4 -> 5e-5.
   *
   * Section 3.7 says the bleed "is small, so early game the player ignores
   * it". Its own number says otherwise: at 5e-4 it removes 39% of the
   * atmosphere by sim-year 1000 and 63% by 2000, which over a run whose oxygen
   * axis alone needs ~2300 years makes it the dominant term and turns the
   * magnetic shield from section 5's capstone into a hidden prerequisite.
   * At 5e-5 it is 4.9% and 9.5%, while still demanding sustained N2 import to
   * hold 1 bar unshielded - which is the maintenance concern 3.7 asks for.
   */
  LOSS_LAMBDA: 5e-5,

  // -------------------------------------------------------------------------
  // Progress weights (section 8.1)
  // -------------------------------------------------------------------------
  W_T: 1.0,
  W_P: 1.0,
  W_O2: 1.0,
  W_WATER: 1.0,
  W_BIO: 1.0,
  /**
   * Weight of the SIXTH axis, carbon dioxide drawdown.
   *
   * Section 8.1 lists five axes; section 2.3 lists six rows. That mismatch is
   * why the bar crawled through the entire final approach: from year 1550 the
   * other four axes were maxed and only pressure crept, while the actual event
   * - co2_atm falling 36 -> 5 mbar, the atmosphere becoming breathable - was
   * invisible to the metric. Batch 1 recorded this and deferred the decision
   * to the balance batch, on the grounds that a linear axis would read 0
   * through the whole mid-game and pin the bar. A LOGARITHMIC axis does not:
   * it moves continuously from the 300 mbar peak down to the 1 mbar target.
   */
  W_CO2: 1.0,
  /**
   * Where the CO2 composition axis reads zero, mbar.
   *
   * 1013 is a pure-CO2 atmosphere at the section 2.3 pressure target, which is
   * exactly the worst case the axis has to describe.
   */
  CO2_PROG_HI: 1013,
  /**
   * Per-axis affine floor applied before the geometric mean.
   *
   * Section 8.1's geometric mean is exactly 0.00000 for the first half of the
   * run - through the entire runaway - because oxygen, water and biomass are
   * all identically zero and one zero factor kills a product. That breaks the
   * section 8.2 pacing requirement that the bar never sit still. The floor
   * moves it monotonically from 0.026 to 1.0 while still capping any
   * state with a dead axis at 0.457, so the design intent survives.
   */
  PROGRESS_FLOOR: 0.1,

  // -------------------------------------------------------------------------
  // Phase thresholds (section 7, absent from the section 10 table)
  // -------------------------------------------------------------------------
  PHASE3_P_MIN: 100,
  PHASE4_BIO: 0.05,
  PHASE5_O2: 50,
  /**
   * The buffer half of section 7's Phase 5, "o2 > 50 mbar AND N2 import active".
   *
   * Read as "the buffer exists" rather than "a facility is switched on": the
   * phase is named "Oxygenation and buffer", an inert buffer is the thing
   * section 3.6 says the phase is about, and a state-only condition keeps the
   * phase evaluation out of the facility graph - which matters, because phase
   * is evaluated per TICK while rates run per SUBSTEP, and coupling the two
   * would make tick granularity path-dependent.
   */
  PHASE5_N2: 50,

  // -------------------------------------------------------------------------
  // Integration (section 6) and time (section 8.2)
  // -------------------------------------------------------------------------
  /**
   * DIVERGENCE (replaces SUBSTEPS = 4..8). The step SIZE is fixed and the
   * COUNT is derived.
   *
   * A fixed count is the wrong quantity: at dt = 1 it gives h = 0.25, but at a
   * 1000-year offline catch-up it gives h = 125, which drives the logistic
   * biomass map to -Infinity. Fixing the size also makes every decomposition
   * of the same elapsed time execute the identical sequence of operations, so
   * the determinism test is an equality rather than a tolerance.
   */
  SUBSTEP_YEARS: 0.25,
  /** Work bound per advance() call - a chunk size, never an accuracy knob. */
  MAX_SUBSTEPS_PER_TICK: 2048,
  /**
   * Section 8.2's WORK cap on offline catch-up, sim-years. Bounds how long the
   * load screen can take. Not the same thing as the design cap below.
   */
  CATCHUP_MAX_SIM_YEARS: 100000,
  /**
   * DESIGN cap on offline progression: only the first this-many hours of an
   * absence count at all.
   *
   * §8.2 read literally hands the game to someone who does not play it - at
   * TIME_SCALE 0.03 a 48-hour absence is worth 5184 sim-years against a 1710
   * sim-year playthrough, so one weekend finishes the game three times over.
   */
  OFFLINE_CAP_HOURS: 8,
  /**
   * How fast the world runs while nobody is watching, as a fraction of live.
   *
   * Together with the cap: a 48-hour absence is worth
   * `8 * 3600 * 0.03 * 0.15 = 129.6` sim-years, about 7.6% of a playthrough.
   * Ten consecutive 48-hour absences come to 1296 sim-years, still short of
   * one full arc - which is the property the test asserts. Eight hours of
   * ACTIVE play is worth 864 sim-years over the same window, so playing beats
   * not playing by about 6.7x.
   */
  OFFLINE_RATE_FACTOR: 0.15,
  /** Dev-only tripwire: no single flux may request more than this share of its source. */
  FLUX_ASSERT_MAX_FRAC: 0.25,
  /** Safety factor `validateTuning` demands of a facility depletion scale, so the cap is not the edge. */
  FACILITY_ASSERT_HEADROOM: 0.9,
  /** Below this magnitude a negative reservoir is float noise and snaps to zero. */
  RESERVOIR_ZERO_EPS: 1e-12,
  /** The single epsilon for every pressure-ratio denominator, mbar. */
  P_EPS: 1e-9,
  /**
   * Sim-years per real-second at 1x.
   *
   * TUNED 0.025 -> 0.03. §8.2 asks for two things at once - "tens of real
   * hours" for a full run, and no stall longer than a few minutes - and they
   * pull against each other through this one constant. 0.03 puts the
   * playthrough at 15.8 real hours and the worst stall at 8.9 real minutes.
   * Faster clocks score better on stalls and worse on duration: 0.04 gives
   * 11.9 hours, which stops reading as "tens".
   */
  TIME_SCALE: 0.03,

  // -------------------------------------------------------------------------
  // Seeded world events (section 12.2)
  //
  // Off by default, and deliberately so. Turning them on perturbs every
  // trajectory, which would churn the golden frames, move the balance the
  // Batch 3 sweep measured, and make a dozen existing exactness tests depend
  // on the weather. A driver opts in; `defaultConfig()` does not.
  // -------------------------------------------------------------------------
  EVENTS_ENABLED: 0,

  /**
   * Probability that a dust storm begins in any given year.
   *
   * Mars has a planet-encircling storm roughly every three Martian years, but
   * this is a terraforming game played over millennia, not a weather sim: at
   * that rate a storm would be running essentially always and would read as a
   * constant, not an event. One per fifteen years leaves the sky clear most of
   * the time and makes a storm something a player notices.
   */
  DUST_STORM_RATE: 0.067,
  /**
   * How long a storm runs, sim-years.
   *
   * Set by how it READS, not by Mars. At TIME_SCALE 0.03 a sim-year is 33 real
   * seconds at 1x, so the original 0.5-year minimum was a 17-second flicker -
   * over before a player could look up. Two years is about a real minute:
   * long enough to arrive, be noticed, and pass.
   *
   * It is still far faster than the 22 years a storm would need to respect
   * Batch 5's 25%-per-real-minute continuity bound. That conflict is real and
   * is resolved in `visuals.test.ts` rather than by stretching weather into
   * climate - see the Batch 8 note.
   */
  DUST_STORM_YEARS_MIN: 2,
  DUST_STORM_YEARS_MAX: 8,
  /**
   * Peak albedo added by the strongest storm.
   *
   * 0.08 on a base albedo near 0.25 is a large perturbation in relative terms
   * and a few kelvin of cooling - enough to see on the temperature trace and
   * in the sky, not enough to undo a century of mirrors.
   */
  DUST_STORM_ALBEDO: 0.08,

  /** Probability that a cometary impact occurs in any given year. */
  COMET_IMPACT_RATE: 0.004,
  /** Sim-years over which an impact's water is delivered. See the note in events.ts. */
  COMET_DELIVERY_YEARS: 1,
  /** Metres of ice-equivalent delivered by the largest impact. */
  COMET_WATER_METRES: 0.4,
  /** Fraction arriving as vapour rather than ice - section 12.2's "heat pulse", derived. */
  COMET_VAPOUR_FRACTION: 0.25,
  /** Peak albedo added by impact ejecta. */
  COMET_DUST_ALBEDO: 0.03,

  /**
   * Peak fractional deviation of solar flux.
   *
   * 0.5% is the order of the real solar cycle's irradiance swing. Larger
   * values start to compete with the player's mirrors, which turns a texture
   * into a mechanic.
   */
  SOLAR_VARIABILITY: 0.005,
  /** Three incommensurable periods, sim-years, so the sum does not visibly repeat. */
  SOLAR_CYCLE_SHORT: 11,
  SOLAR_CYCLE_MID: 87,
  SOLAR_CYCLE_LONG: 413,

  // -------------------------------------------------------------------------
  // The macro -> micro habitat contract (section 12.3)
  //
  // The gates that decide where a settlement can stand without a pressure
  // dome. Not the section 2.3 victory band: that is about an Earth-like
  // planet, this is about a survivable one, and they are different questions.
  // -------------------------------------------------------------------------

  /** Open air needs liquid water at the surface, so this tracks section 2.3's minimum. */
  HAB_T_MIN: 271,
  /**
   * Ramp widths are NARROW on purpose.
   *
   * `ramp` is a renormalised tanh, so it reaches only ~0.74 at one width past
   * its threshold. With an 8 K width the temperature gate was still a quarter
   * shut at 288 K - a finished, Earth-like planet - and the three gates
   * multiplied together left `supportIndex` at 0.74 on a won game.
   */
  HAB_T_WIDTH: 3,
  /**
   * The Armstrong limit, near enough: below about 60 mbar body fluids boil at
   * body temperature, and no amount of oxygen helps. A real threshold, not a
   * tuned one, which is why the ramp around it is narrow.
   */
  HAB_P_MIN: 62,
  HAB_P_WIDTH: 6,
  /** Partial pressure of oxygen a person can work in. Roughly 4 km of altitude. */
  HAB_O2_MIN: 120,
  HAB_O2_WIDTH: 12,
  /** Section 2.3's toxicity ceiling, with a soft edge rather than a cliff. */
  HAB_CO2_MAX: 10,
  HAB_CO2_WIDTH: 2,
  /** Some water within reach, well below the section 2.3 band's lower edge. */
  HAB_WATER_MIN: 0.12,
  HAB_WATER_WIDTH: 0.06,
  /**
   * What sealed habitats can support with no open air at all.
   *
   * Not zero: somebody has to be there to order the mirrors. Twelve percent
   * makes the early game slow without making it static, and leaves the index
   * room to grow about eightfold across a playthrough.
   */
  HAB_SEALED_BASE: 0.12,
  /**
   * The share of capacity the mask tier carries.
   *
   * The largest of the three, because it is the one that opens mid-game and
   * therefore the one that funds the second half of the terraforming.
   */
  HAB_MASK_WEIGHT: 0.48,

  // -------------------------------------------------------------------------
  // Economy and tech (section 11's `economy`, and the Batch 9 gate)
  //
  // Both off by default. Costs change what a player can build and when, so
  // enabling them silently would invalidate the Batch 3 balance, the golden
  // frames, and the reference trajectory every other test is written against.
  // -------------------------------------------------------------------------
  ECONOMY_ENABLED: 0,
  TECH_GATE_ENABLED: 0,

  /**
   * Opening balance.
   *
   * Enough for a serious first move - about a dozen mirrors - and nothing
   * like enough for the build-out. The early game is the bootstrap: the
   * planet cannot support many people, so it does not earn much, so it
   * terraforms slowly, so it cannot support many people. Breaking out of that
   * is the first thing a player does.
   */
  ECON_STARTING_CREDITS: 3000,
  /**
   * Credits per sim-year at `supportIndex` 1. TUNED against a saving player.
   *
   * Set so the economy costs TIME rather than rebalancing the game: a scripted
   * player who buys in priority order and waits for money wins at sim-year
   * 1860, against 1710 with the economy off. About 9% slower - felt, but not
   * a different game. See the Batch 9 note for the sweep.
   */
  ECON_INCOME_PER_SUPPORT: 360,
  /**
   * Each successive unit costs this much more than the last.
   *
   * A flat price means the right play is always "buy the maximum of whatever
   * is cheapest per unit of effect", which is not a decision. 1.06 doubles the
   * price by roughly the twelfth unit.
   */
  ECON_COST_GROWTH: 1.06,
  /** Multiplier per level above 1. Higher-level units are strictly better, so strictly dearer. */
  ECON_LEVEL_COST: 1.6,
  /**
   * Annual upkeep as a fraction of base cost, per DEPLOYED unit.
   *
   * This is the constant that stops unlimited over-building: upkeep grows with
   * the estate while income is capped by how habitable the planet is, so there
   * is a ceiling on what can be kept running. At 0.012 the ceiling bound so
   * hard that a player with 189,000 credits banked could not fund a single
   * extra processor - the whole income went on maintenance and the game
   * stalled at 68% forever. 0.005 leaves the ceiling real but reachable.
   */
  ECON_UPKEEP_FRACTION: 0.005,

  /** Base price of the first unit of each lever, credits. */
  COST_MIRROR: 240,
  COST_SHADE: 260,
  COST_GHG_FACTORY: 300,
  COST_ATMO_PROCESSOR: 520,
  COST_COMET_REDIRECT: 1400,
  COST_N2_IMPORT: 900,
  /** Ecopoiesis is a one-shot action, and cheap: the barrier is the planet, not the budget. */
  COST_SEEDING: 400,
  COST_SCRUBBER: 700,
  /** The capstone megaproject, priced like one. */
  COST_SHIELD: 1800,

  // -------------------------------------------------------------------------
  // Micro layer geometry (micro-world.md sections 1.3 and 3.3, Batch 17)
  //
  // Not balance: nothing here moves the planet. They live here because
  // invariant #4 allows no numbers anywhere else in src/sim/.
  // -------------------------------------------------------------------------
  /** Edge of one build tile, metres. The doc leaves it open; 10 m makes a 32-tile city 320 m across. */
  TILE_METRES: 10,
  /** Micro §3.3: "start 32x32 for a city, 16x16 for an outpost". */
  CITY_GRID_TILES: 32,
  OUTPOST_GRID_TILES: 16,
  /** A metropolis: 3 x 3 a city's ground. */
  METROPOLIS_GRID_TILES: 96,
  /**
   * Claiming land (at the user's request): a city claims ground a chunk of
   * this many tiles square at a time, beside what it holds. The first claim
   * opens at CLAIM_FIRST_POPULATION people, and one more with every
   * CLAIM_STEP_POPULATION after - "at 200 I can claim new terrain, then at
   * 300, etc, indefinitely". Only a player's action claims land: nothing
   * here changes a settlement that does not ask.
   */
  CLAIM_CHUNK_TILES: 32,
  CLAIM_FIRST_POPULATION: 200,
  CLAIM_STEP_POPULATION: 100,
  /**
   * Detail §1 (Batch 22): the local heightmap's relief, metres either side of
   * the settlement's base elevation. OFF (0, flat ground) by default - every
   * fixture places buildings on fixed tiles, and hills appearing under them
   * would refuse placements that were legal. The browser opts in. Replaces
   * Batch 20's rough outcrops: steep ground is now the blocked terrain.
   */
  TERRAIN_RELIEF_M: 0,
  /**
   * Size of a hill, in tiles per noise cell. Measured over 100 sites (Batch
   * 22), at the browser's 12 m of relief: 16.1% of the ground is too steep at
   * 10 tiles, and 57.3% at 5.
   */
  TERRAIN_FEATURE_TILES: 10,
  /** Half-width of the square levelled at the grid's centre, where the settlement was founded. */
  TERRAIN_CLEAR_TILES: 4,
  /**
   * The open world (at the user's request): tiles of terrain drawn round the
   * buildable grid on every side, and the scale of its big features as
   * multiples of TERRAIN_RELIEF_M - mountains, canyons, rock pits.
   */
  TERRAIN_WORLD_MARGIN: 48,
  TERRAIN_MOUNTAIN_SCALE: 8,
  TERRAIN_CANYON_SCALE: 3.5,
  TERRAIN_PIT_SCALE: 2.5,
  /** Detail §1.3: the steepest ground a building may stand on, rise over run along a tile edge. 3 m in 10: a building on a slope stands on a concrete foundation (the user). */
  TERRAIN_MAX_SLOPE: 0.3,

  // -------------------------------------------------------------------------
  // The planet's hypsometry (detail §1.1 and §4.1, Batch 22)
  //
  // Elevation in metres against the areoid, at evenly spaced RANKS of the
  // shared elevation field: HYPSO_ELEV_k is the height below which k/8 of the
  // planet's surface lies. Piecewise linear between them, so the curve is
  // monotonic by construction when these are (validateTuning checks). A
  // designer curve for Mars: the Hellas floor at -8.2 km, the northern plains
  // near -4 km covering the lower third, the southern highlands above the
  // datum. The noise field has no Olympus, so the top is 8 km, not 21.
  // Sea level (Batch 23) is this curve at the ocean fraction.
  // -------------------------------------------------------------------------
  HYPSO_ELEV_0: -8200,
  HYPSO_ELEV_1: -4600,
  HYPSO_ELEV_2: -4100,
  HYPSO_ELEV_3: -3000,
  HYPSO_ELEV_4: -1000,
  HYPSO_ELEV_5: 500,
  HYPSO_ELEV_6: 1600,
  HYPSO_ELEV_7: 3000,
  HYPSO_ELEV_8: 8000,

  // -------------------------------------------------------------------------
  // Flooding (detail doc §4.2 and §4.3, Batch 24)
  //
  // OFF by default: a flood destroys buildings and settlements, which moves
  // the balance. The browser opts in once the forecast can warn (Batch 25).
  // -------------------------------------------------------------------------
  FLOODING_ENABLED: 0,
  /** §4.3: how far below a settlement's base the sea may be before its warning begins, metres. */
  FLOOD_WARN_MARGIN_M: 20,
  /** §4.3: the sea this far above a settlement's base declares it flooded - lost, metres. */
  FLOOD_THRESHOLD_M: 10,
  /**
   * §4.3's "go offline, then are lost": a building is offline while water
   * covers any tile of its footprint, and lost once the water stands this far
   * over the highest one, metres. Measured in the Batch 24 note.
   */
  FLOOD_BUILDING_LOSS_M: 2,

  // -------------------------------------------------------------------------
  // Roads and the settlement network (micro §6, §7.1; at the user's request)
  //
  // OFF by default: with it on, a building runs only when a road (or a wall
  // it shares) joins it to what it needs - which switches buildings off, and
  // so moves the balance. The browser opts in.
  // -------------------------------------------------------------------------
  NETWORK_ENABLED: 0,
  /** Materials per tile of corridor, and of power cable. A Storage Depot is 10, a Solar Array 20. */
  COST_CORRIDOR: 1,
  COST_CABLE: 1,

  // -------------------------------------------------------------------------
  // The headquarters, rovers and rockets (at the user's request)
  //
  // OFF by default: founding with a headquarters and a spaceport hands every
  // settlement free oxygen, water and a supply rocket, which moves the
  // balance. The browser opts in. Times are sim-years; the clock runs
  // TIME_SCALE (0.03) sim-years a real second at 1x.
  // -------------------------------------------------------------------------
  HEADQUARTERS_ENABLED: 0,
  /** Made by the headquarters, per year; it draws no power. */
  HQ_OXYGEN: 5,
  HQ_WATER: 3,
  /** Rovers the headquarters keeps; one job each. */
  ROVERS_PER_HQ: 3,
  /** A rover's drive, per tile each way: 0.5 real seconds at 1x. */
  ROVER_YEARS_PER_TILE: 0.015,
  /** Breaking loose rocks, and a crag: 3 and 10 real seconds at 1x. */
  ROVER_WORK_YEARS_LOOSE: 0.09,
  ROVER_WORK_YEARS_CRAG: 0.3,
  /** Materials a rover brings back from loose rocks, and from a crag. */
  ROCK_LOOSE_MATERIALS: 1,
  ROCK_CRAG_MATERIALS: 5,
  /** Share of open, buildable tiles with loose rocks on. */
  ROCK_LOOSE_SHARE: 0.08,
  /**
   * Hard rock comes in rare clusters of 7 to 23 connected tiles (the user):
   * the chance that one lies in each ROCK_CLUSTER_CELL-tile square of the
   * lattice. Clusters block building until a rover breaks them. 0 by
   * default: they change where anything can be built, and every layout the
   * tests were written for. The browser uses 0.65: with 32-tile cells, 10 to
   * 22 in a 96-tile city's world, 17.7 on average - four times the 64-tile
   * cells' 4.2, at the user's request (a cell loses its cluster to a cliff
   * or the founding site).
   */
  ROCK_CLUSTER_CHANCE: 0,
  ROCK_CLUSTER_CELL: 32,
  /** A supply rocket's round trip: one real minute at 1x (60 x 0.03). */
  ROCKET_TRIP_YEARS: 1.8,
  /** Materials a rocket brings back, or as many as the stores have room for. */
  ROCKET_MATERIALS: 20,

  // -------------------------------------------------------------------------
  // The settlement simulation (micro-world.md sections 5 to 7, Batch 18)
  //
  // OFF by default, for the reason events and the economy are: a settlement's
  // Atmosphere Processor pushes the planet, and turning that on would move the
  // golden run, the Batch 3 score and the golden frames. The micro doc gives
  // its values as "abstract per-tick units, tuned later"; these are per SIM-
  // YEAR, chosen so the doc's bootstrap order (section 2.3) plays out, and
  // calibrated by measurement in the Batch 18 note.
  // -------------------------------------------------------------------------
  SETTLEMENTS_ENABLED: 0,

  /** Section 7.3: logistic growth toward housing, per year, while every life-support need is met. */
  MICRO_GROWTH_RATE: 0.1,
  /** Section 7.3: decline per year while any life-support store is empty. */
  MICRO_DECLINE_RATE: 0.2,
  /**
   * The first settlers. Section 7.3's growth is proportional to population, so
   * a city that starts empty stays empty for ever; this many arrive once a
   * city has housing and every need met - a gap in the doc, filled.
   */
  MICRO_SEED_POPULATION: 4,

  /** Store capacity every settlement has before any Storage Depot. */
  MICRO_CAP_POWER: 5,
  MICRO_CAP_WATER: 40,
  MICRO_CAP_OXYGEN: 40,
  MICRO_CAP_FOOD: 40,
  MICRO_CAP_MATERIALS: 400,

  /**
   * What a new settlement starts with - section 2.3 step 2's "shipped materials,
   * and early life-support stock". Enough for a Spaceport and one power source.
   */
  FOUND_MATERIALS: 250,
  FOUND_LIFE_SUPPORT: 30,

  /** Construction cost of each building, in materials (section 5: "the construction resource"). */
  COST_HABITAT_DOME: 60,
  COST_SOLAR_ARRAY: 20,
  COST_GEOTHERMAL_PLANT: 50,
  COST_REACTOR: 150,
  COST_WATER_EXTRACTOR: 30,
  COST_ATMOSPHERE_PROCESSOR: 60,
  COST_GREENHOUSE: 30,
  COST_REGOLITH_MINE: 25,
  COST_STORAGE_DEPOT: 10,
  COST_SPACEPORT: 80,
  /**
   * The Rover Post (at the user's request: "a structure called rover post,
   * that allows you to have an additional rover, costs 300 materials,
   * occupies a 5x5, max 1 per 100 people").
   */
  COST_ROVER_POST: 300,
  ROVER_POST_PEOPLE: 100,

  /** Habitat Dome: people housed, and life support drawn per year. */
  DOME_HOUSING: 40,
  DOME_POWER: 3,
  DOME_WATER: 2,
  DOME_OXYGEN: 2,
  DOME_FOOD: 2,
  /** Share of a dome's life-support draw that falls away once the air outside is breathable (section 5: domes "can open"). */
  DOME_OPEN_RELIEF: 0.75,

  /** Power per year: solar at Mars's natural insolation (it scales with mirrors), geothermal, reactor. */
  SOLAR_POWER: 6,
  GEOTHERMAL_POWER: 8,
  REACTOR_POWER: 24,

  /** Water Extractor: power in, water out - doubled once liquid water is in reach (section 5). */
  EXTRACTOR_POWER: 2,
  EXTRACTOR_WATER: 5,

  /** Atmosphere Processor: power in, oxygen out for the settlement. */
  PROCESSOR_POWER: 5,
  PROCESSOR_OXYGEN: 4,
  /**
   * Its PLANETARY output, section 2.2: CO2 drawn from the planet's air, mbar
   * per year per building. MOXIE-style (2 CO2 -> 2 CO + O2), so the carbon is
   * booked as sequestered and oxygen is released at 32/88 of the mass drawn.
   */
  PROCESSOR_CO2_DRAW: 0.05,
  /** Needs CO2 in the air to work on at all, mbar. */
  PROCESSOR_MIN_CO2: 1,
  /**
   * Most of the planet's CO2 any one substep of processors may take. Keeps the
   * whole player-scaled draw inside the flux tripwire however many are built;
   * `applyFluxes` rations below it regardless.
   */
  PROCESSOR_MAX_DRAW_FRAC: 0.1,
  /**
   * MOXIE's oxygen yield by mass: 2 CO2 -> 2 CO + O2, so 88 g of CO2 give 32 g
   * of O2 (the carbon leaves as CO, booked as sequestered). Written from the
   * molar masses so it cannot drift from the chemistry, like Y_O2.
   */
  MOXIE_O2_PER_CO2: M_O2 / (2 * M_CO2),

  /** Greenhouse: power and water in, food out. */
  GREENHOUSE_POWER: 2,
  GREENHOUSE_WATER: 1,
  GREENHOUSE_FOOD: 4,

  /** Regolith Mine: power in, materials out. */
  MINE_POWER: 3,
  MINE_MATERIALS: 5,

  /** Storage Depot: extra capacity per depot. */
  DEPOT_POWER: 10,
  DEPOT_WATER: 60,
  DEPOT_OXYGEN: 60,
  DEPOT_FOOD: 60,
  DEPOT_MATERIALS: 200,

  /** Spaceport: power in; imports from Earth per year (section 2.3 step 2). */
  SPACEPORT_POWER: 2,
  SPACEPORT_MATERIALS: 3,
  SPACEPORT_LIFE_SUPPORT: 1,
});

export type TuningScalarKey = keyof typeof BASE_TUNING;
export type Tuning = Readonly<Record<TuningScalarKey, number>>;
export type TuningOverrides = { readonly [K in TuningScalarKey]?: number | undefined };

export const TUNING_SCALAR_KEYS = Object.keys(BASE_TUNING) as readonly TuningScalarKey[];

/**
 * Build a tuning variant.
 *
 * The explicit loop is not stylistic: under `exactOptionalPropertyTypes`,
 * `{ ...BASE, ...overrides }` lets a present-but-undefined key widen the
 * merged field to `number | undefined`, which then flows into arithmetic as
 * NaN at runtime while type-checking cleanly.
 */
export function makeTuning(overrides: TuningOverrides = {}): Tuning {
  const out = { ...BASE_TUNING } as Record<TuningScalarKey, number>;
  for (const key of TUNING_SCALAR_KEYS) {
    const value = overrides[key];
    if (value !== undefined) out[key] = value;
  }
  return Object.freeze(out);
}

export class TuningError extends Error {}

/** Fails loudly on a tuning variant that would divide by zero or invert a band. */
export function validateTuning(t: Tuning): void {
  const fail = (msg: string): never => {
    throw new TuningError(`invalid tuning: ${msg}`);
  };

  for (const key of TUNING_SCALAR_KEYS) {
    if (!Number.isFinite(t[key])) fail(`${key} is not a finite number (${String(t[key])})`);
  }

  const positive: readonly TuningScalarKey[] = [
    "W_CAP",
    "W_REG",
    "W_MELT",
    "W_N2",
    "W_SUBL_H2O",
    "O2_FIRE_W",
    "T_LIFE_EDGE_W",
    "P_REF",
    "GHG_REF",
    "SUBSTEP_YEARS",
    "H2O_MBAR_PER_M",
    "CO2_DEPLETE_SCALE",
    "H2O_DEPLETE_SCALE",
    "FACILITY_DEPLETE_SCALE",
    "S_MULTIPLIER_MIN",
    "CO2_FOR_LIFE",
    "OCEAN_FOR_LIFE",
    "TIME_SCALE",
    "P_EPS",
    "S_MARS",
    "SIGMA",
  ];
  for (const key of positive) {
    if (!(t[key] > 0)) fail(`${key} must be > 0, got ${t[key]}`);
  }

  if (!(t.T_LIFE_HI > t.T_LIFE_LO)) fail("T_LIFE_HI must exceed T_LIFE_LO");
  // A hypsometric curve that ever falls would put higher ground lower.
  const hypso = [t.HYPSO_ELEV_0, t.HYPSO_ELEV_1, t.HYPSO_ELEV_2, t.HYPSO_ELEV_3, t.HYPSO_ELEV_4, t.HYPSO_ELEV_5, t.HYPSO_ELEV_6, t.HYPSO_ELEV_7, t.HYPSO_ELEV_8];
  for (let k = 1; k < hypso.length; k += 1) {
    if (!((hypso[k] ?? 0) > (hypso[k - 1] ?? 0))) fail(`HYPSO_ELEV_${k} must exceed HYPSO_ELEV_${k - 1}`);
  }
  if (!(t.TERRAIN_RELIEF_M >= 0)) fail("TERRAIN_RELIEF_M must be >= 0");
  if (!(t.TERRAIN_MAX_SLOPE > 0)) fail("TERRAIN_MAX_SLOPE must be > 0");
  if (!(t.FLOOD_WARN_MARGIN_M >= 0)) fail("FLOOD_WARN_MARGIN_M must be >= 0");
  if (!(t.FLOOD_THRESHOLD_M > 0)) fail("FLOOD_THRESHOLD_M must be > 0");
  if (!(t.FLOOD_BUILDING_LOSS_M >= 0)) fail("FLOOD_BUILDING_LOSS_M must be >= 0");
  if (!(t.COST_CORRIDOR >= 0)) fail("COST_CORRIDOR must be >= 0");
  if (!(t.COST_CABLE >= 0)) fail("COST_CABLE must be >= 0");
  if (!(t.ROVERS_PER_HQ >= 0)) fail("ROVERS_PER_HQ must be >= 0");
  if (!(t.ROVER_POST_PEOPLE > 0)) fail("ROVER_POST_PEOPLE must be > 0");
  if (!(t.ROCKET_TRIP_YEARS > 0)) fail("ROCKET_TRIP_YEARS must be > 0");
  if (!(t.ROCK_LOOSE_SHARE >= 0 && t.ROCK_LOOSE_SHARE <= 1)) fail("ROCK_LOOSE_SHARE must be in [0, 1]");
  if (!(t.ROCK_CLUSTER_CHANCE >= 0 && t.ROCK_CLUSTER_CHANCE <= 1)) fail("ROCK_CLUSTER_CHANCE must be in [0, 1]");
  if (!(t.ROCK_CLUSTER_CELL >= 24)) fail("ROCK_CLUSTER_CELL must be >= 24 (a cluster reaches at most 22 tiles from its seed)");
  if (!(Number.isInteger(t.CLAIM_CHUNK_TILES) && t.CLAIM_CHUNK_TILES >= 8)) fail("CLAIM_CHUNK_TILES must be a whole number >= 8");
  if (!(t.CLAIM_FIRST_POPULATION >= 0)) fail("CLAIM_FIRST_POPULATION must be >= 0");
  if (!(t.CLAIM_STEP_POPULATION > 0)) fail("CLAIM_STEP_POPULATION must be > 0");
  if (!(t.P_LIFE_OK > t.P_LIFE_MIN)) fail("P_LIFE_OK must exceed P_LIFE_MIN");
  if (!(t.T_CEIL_K > t.T_FLOOR_K)) fail("T_CEIL_K must exceed T_FLOOR_K");
  if (!(t.ALBEDO_MAX > t.ALBEDO_MIN)) fail("ALBEDO_MAX must exceed ALBEDO_MIN");
  if (!(t.SIG_CUT >= 0 && t.SIG_CUT < 1)) fail("SIG_CUT must be in [0, 1)");
  if (!(t.PROGRESS_FLOOR >= 0 && t.PROGRESS_FLOOR < 1)) fail("PROGRESS_FLOOR must be in [0, 1)");

  // --- seeded events (section 12.2) ---------------------------------------
  //
  // These are probabilities per year and fractions, and none of them is
  // self-correcting: a rate above 1 silently means "always", which would turn
  // an event into a permanent offset without any error anywhere.
  for (const key of ["DUST_STORM_RATE", "COMET_IMPACT_RATE", "COMET_VAPOUR_FRACTION"] as const) {
    if (!(t[key] >= 0 && t[key] <= 1)) fail(`${key} must be a probability in [0, 1], got ${t[key]}`);
  }
  if (!(t.DUST_STORM_YEARS_MIN > 0)) fail("DUST_STORM_YEARS_MIN must be > 0");
  if (t.DUST_STORM_YEARS_MAX < t.DUST_STORM_YEARS_MIN) {
    fail(`DUST_STORM_YEARS_MAX (${t.DUST_STORM_YEARS_MAX}) is below DUST_STORM_YEARS_MIN (${t.DUST_STORM_YEARS_MIN})`);
  }
  if (!(t.COMET_DELIVERY_YEARS > 0)) fail("COMET_DELIVERY_YEARS must be > 0");
  for (const key of ["SOLAR_CYCLE_SHORT", "SOLAR_CYCLE_MID", "SOLAR_CYCLE_LONG"] as const) {
    if (!(t[key] > 0)) fail(`${key} must be > 0`);
  }
  /**
   * The one bug the event design can still have.
   *
   * `activeEvents` looks back a bounded number of whole years, so an event
   * that could outlive that window would simply vanish partway through -
   * silently, and only for long events, which is the hardest kind of bug to
   * notice. The window is derived from these same constants, so this checks
   * the derivation still covers them.
   */
  const longest = Math.max(t.DUST_STORM_YEARS_MAX, t.COMET_DELIVERY_YEARS);
  // Named `lookback`, not `window`: the invariant #2 scan bans host globals in
  // src/sim/ by name, and it is right to - a local called `window` is one
  // careless edit away from resolving to the real one.
  const lookback = Math.ceil(longest) + 1;
  // Events start at a fractional offset of up to one year past their year.
  if (lookback < longest + 1) {
    fail(`the event lookback (${lookback} y) cannot cover the longest event (${longest} y plus its start offset)`);
  }
  if (!(t.SOLAR_VARIABILITY >= 0 && t.SOLAR_VARIABILITY < 1)) {
    fail(`SOLAR_VARIABILITY must be in [0, 1), got ${t.SOLAR_VARIABILITY}`);
  }
  if (!(t.MAX_SUBSTEPS_PER_TICK >= 1)) fail("MAX_SUBSTEPS_PER_TICK must be >= 1");

  const sumW = t.W_T + t.W_P + t.W_O2 + t.W_WATER + t.W_BIO;
  if (!(sumW > 0)) fail("progress weights must sum to > 0");

  // A reservoir on an `avail(x, S)` depletion ramp surrenders R*h/S of what
  // remains every substep, however little that is. If that exceeds the flux
  // tripwire the run dies partway through with a confusing error, so the
  // relationship is checked up front where the fix is obvious.
  const maxDrawFraction = (rate: number, scale: number): number => (scale > 0 ? (rate * t.SUBSTEP_YEARS) / scale : Infinity);
  // R_N2 shares CO2_DEPLETE_SCALE, and SUBL_RATE shares H2O_DEPLETE_SCALE, so both
  // belong in their respective maxima - otherwise half the rate/scale pairs are unchecked.
  const co2Draw = maxDrawFraction(Math.max(t.R_CAP, t.R_REG, t.R_N2), t.CO2_DEPLETE_SCALE);
  // The section 5 levers draw on the same kind of ramp with their own scale.
  // Omitting them is exactly the hole this check exists to close: the guard
  // was added in Batch 1 and then not extended when Batch 2 added two new
  // draws, so a maxed processor or scrubber threw mid-run at legal settings.
  const facilityMaxUnits = t.FACILITY_MAX_COUNT * t.FACILITY_MAX_LEVEL;
  const facilityRate = Math.max(t.ATMO_PROCESSOR_PER_UNIT, t.SCRUBBER_PER_UNIT) * facilityMaxUnits;
  const facilityDraw = maxDrawFraction(facilityRate, t.FACILITY_DEPLETE_SCALE);
  if (facilityDraw > t.FACILITY_ASSERT_HEADROOM * t.FLUX_ASSERT_MAX_FRAC) {
    fail(
      `FACILITY_DEPLETE_SCALE ${t.FACILITY_DEPLETE_SCALE} is too small: a maxed lever would draw ` +
        `${(facilityDraw * 100).toFixed(0)}% of a depleting reservoir per substep ` +
        `(limit ${(t.FLUX_ASSERT_MAX_FRAC * 100).toFixed(0)}%). ` +
        `Needs >= ${((facilityRate * t.SUBSTEP_YEARS) / t.FLUX_ASSERT_MAX_FRAC).toFixed(3)}`,
    );
  }
  if (co2Draw > t.FLUX_ASSERT_MAX_FRAC) {
    fail(
      `CO2_DEPLETE_SCALE ${t.CO2_DEPLETE_SCALE} is too small: a depleting reservoir would give up ` +
        `${(co2Draw * 100).toFixed(0)}% per substep (limit ${(t.FLUX_ASSERT_MAX_FRAC * 100).toFixed(0)}%). ` +
        `Needs >= ${((Math.max(t.R_CAP, t.R_REG, t.R_N2) * t.SUBSTEP_YEARS) / t.FLUX_ASSERT_MAX_FRAC).toFixed(3)}`,
    );
  }
  const h2oDraw = maxDrawFraction(Math.max(t.M_RATE, t.F_RATE, t.SUBL_RATE), t.H2O_DEPLETE_SCALE);
  if (h2oDraw > t.FLUX_ASSERT_MAX_FRAC) {
    fail(
      `H2O_DEPLETE_SCALE ${t.H2O_DEPLETE_SCALE} is too small: a depleting reservoir would give up ` +
        `${(h2oDraw * 100).toFixed(0)}% per substep (limit ${(t.FLUX_ASSERT_MAX_FRAC * 100).toFixed(0)}%). ` +
        `Needs >= ${((Math.max(t.M_RATE, t.F_RATE, t.SUBL_RATE) * t.SUBSTEP_YEARS) / t.FLUX_ASSERT_MAX_FRAC).toFixed(3)}`,
    );
  }
}

export const DEFAULT_TUNING: Tuning = makeTuning();
