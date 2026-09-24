/**
 * Design doc section 2.3 - the Earth-like victory band - as one table.
 *
 * Section 8.1 hardcodes six normaliser endpoints (210, 288, 1013, 210, 0.4,
 * 0.8) that duplicate this table's columns with no link between them, and
 * section 7's Phase 6 condition is a pointer into section 2.3 that section 7
 * does not itself contain. Retuning one of those silently desynchronises the
 * progress bar from the victory condition. Both now read from here.
 */

export interface TargetBand {
  /** Minimum habitable value, where one is defined. */
  readonly min?: number;
  /** The Earth-like target. */
  readonly target: number;
}

export const TARGETS = Object.freeze({
  /** K. `progLo` is the progress-bar zero point (Mars' baseline), not a habitability bound. */
  T: Object.freeze({ min: 273, target: 288, progLo: 210 }),
  /** mbar total surface pressure. */
  P: Object.freeze({ min: 100, target: 1013 }),
  /** mbar partial pressure of oxygen. */
  o2: Object.freeze({ min: 100, target: 210 }),
  /** mbar of CO2. Above `toxMax` the atmosphere is not breathable however good the rest looks. */
  co2_atm: Object.freeze({ toxMax: 10, target: 1 }),
  /** Fraction of the surface under liquid water. */
  ocean: Object.freeze({ bandLo: 0.3, bandHi: 0.7, target: 0.4 }),
  /** Biosphere density index. */
  biomass: Object.freeze({ min: 0.2, target: 0.8 }),
});
