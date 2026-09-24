/**
 * Design doc section 3.5 - ecopoiesis, and the composition shift that turns a
 * thick CO2 atmosphere into a breathable one.
 *
 * Biomass is the one reservoir that is not advanced by a flow. It is an index,
 * not a mass, and its logistic update is integrated in closed form, so this
 * module returns the next value directly alongside the carbon and oxygen flows
 * that value implies.
 */

import { invariant } from "../dev.js";
import { avail, bell, clamp01, lerp, safeDiv } from "../math.js";
import type { Tuning } from "../tuning.js";
import type { Derived, Flow, Reservoirs } from "../types.js";

export interface Suitability {
  readonly gTemp: number;
  readonly gWater: number;
  readonly gPress: number;
  readonly gTox: number;
  readonly gCarbon: number;
  /** The product. Any single unmet factor stalls life, as section 3.5 intends. */
  readonly g: number;
}

/**
 * The environmental suitability gates.
 *
 * Five, not section 3.5's four: life also needs a carbon source. Without
 * `gCarbon`, a mature biosphere that has drawn the atmosphere down to its
 * 1 mbar CO2 target keeps photosynthesising at full rate against nothing, and
 * the carbon limiter below has to silently absorb the difference every
 * substep.
 */
export function suitability(r: Reservoirs, d: Derived, t: Tuning): Suitability {
  const gTemp = bell(d.T, t.T_LIFE_LO, t.T_LIFE_HI, t.T_LIFE_EDGE_W);
  // `avail` rather than a bare division: it degrades a non-positive scale to a
  // hard step instead of computing 0/0. This was the single unguarded
  // denominator left in src/sim - and a NaN here propagates into biomass, then
  // T, then the progress bar, and `JSON.stringify` writes it to the save as
  // `null`, all without tripping a single non-negativity assertion (every
  // comparison against NaN is false).
  const gWater = avail(d.oceanFrac, t.OCEAN_FOR_LIFE);
  const gPress = clamp01((d.P - t.P_LIFE_MIN) / (t.P_LIFE_OK - t.P_LIFE_MIN));

  // Section 3.5 writes this as o2/P with no guard, while section 6 carefully
  // guards the structurally identical ghg/P. A fallback of 0 is the correct
  // reading: no atmosphere means nothing to burn.
  const o2Frac = safeDiv(Math.max(0, r.o2), d.P, 0, t.P_EPS);
  const gTox = 1 - clamp01((o2Frac - t.O2_FIRE_FRAC) / t.O2_FIRE_W);

  const gCarbon = clamp01(Math.max(0, r.co2_atm) / t.CO2_FOR_LIFE);

  return { gTemp, gWater, gPress, gTox, gCarbon, g: gTemp * gWater * gPress * gTox * gCarbon };
}

export interface BiomassStep {
  readonly next: number;
  readonly flows: readonly Flow[];
  readonly suitability: Suitability;
}

/**
 * Advance biomass and emit the gas exchange it drives.
 *
 * The logistic step uses the Mickens nonstandard discretisation - growth
 * explicit, crowding implicit:
 *
 *     b' = b (1 + r h) / (1 + r h b + d h)
 *
 * Explicit Euler on `r b (1 - b)` is the logistic MAP, which period-doubles
 * above r h = 2 and diverges above 3. At a 1000-year offline catch-up step
 * that product reaches 19.75 and the biomass goes to -Infinity. The Mickens
 * form is unconditionally positive and bounded for any step size, and agrees
 * with Euler to O(h) for the small steps the online loop actually uses.
 */
export function biomassStep(
  r: Reservoirs,
  d: Derived,
  t: Tuning,
  h: number,
  seeded: boolean,
  cFixed = 0,
): BiomassStep {
  const s = suitability(r, d, t);
  const flows: Flow[] = [];

  // Section 3.5: life cannot grow from nothing. Once seeded, a refugium
  // persists so a recovered climate can regrow a biosphere that a heat spike
  // or an oxygen fire knocked down.
  const b0 = Math.max(0, r.biomass);
  const b = seeded ? Math.max(b0, t.BIOMASS_REFUGIA) : b0;

  if (b <= 0 || h <= 0) {
    return { next: b, flows, suitability: s };
  }

  const growth = t.R_BIO * s.g;
  const death = t.D_BIO * (1 - s.g);
  let next = clamp01((b * (1 + growth * h)) / (1 + growth * h * b + death * h));

  // --- photosynthesis: growth plus the maintenance draw of a standing biosphere
  //
  // The maintenance draw is scaled by suitability, blended by MAINTENANCE_GATE.
  // At 0 it is ungated, which is section 3.5 as literally written; at 1 it is
  // fully gated on `g`.
  //
  // This is the single term that decides whether a living world is STABLE.
  // Ungated, the biosphere fixes carbon at M_PHOTO*b whatever the conditions,
  // so it drains the atmosphere to the CO2_FLOOR and then starves - measured:
  // every raised M_PHOTO reached 99% of the oxygen target with the biosphere
  // dead and 298 of 306 mbar of carbon locked in `c_fixed`. There is no carbon
  // return path anywhere in the model (no volcanism, no weathering), so the
  // pump only stops when the tank is empty.
  //
  // Gated, the draw falls as conditions worsen and the system has a fixed
  // point: carbon settles where M_PHOTO*g = D_BIO*(1-g), and biomass settles
  // at b* = 1 - M_PHOTO/R_BIO. That second identity is what lets the biomass
  // target of section 2.3 be hit on purpose rather than by luck.
  const maintenance = t.M_PHOTO * b * lerp(1, s.g, clamp01(t.MAINTENANCE_GATE));
  const photo = Math.max(0, (next - b) / h) + maintenance;
  // A NaN here produced NO flow at all - `NaN > 0` is false - so Batch 10's
  // finite-rate check in `applyFluxes` never saw it and photosynthesis simply
  // stopped (Batch 14: M_PHOTO = NaN, no error anywhere). Loud instead.
  invariant(Number.isFinite(photo), () => `photosynthesis demand is not finite: ${photo}`);
  if (photo > 0) {
    // Hard-limited by the carbon actually in the air, so photosynthesis can
    // never drive co2_atm negative and the oxygen it yields always
    // corresponds to carbon that really moved.
    const wanted = t.Y_CO2 * photo;
    const available = Math.max(0, r.co2_atm - t.CO2_FLOOR) / h;
    const applied = Math.min(wanted, available);

    // Growth that the carbon could not pay for does not happen. Without this,
    // a carbon-starved biosphere keeps growing on an atmosphere it never
    // actually consumed.
    if (applied < wanted && next > b) {
      next = b + (next - b) * (applied / wanted);
    }

    if (applied > 0) {
      const realised = applied / t.Y_CO2;
      flows.push({ id: "bio.photosynthesis", from: "co2_atm", to: "c_fixed", rate: applied, conversion: 1 });
      // `scaleWith` ties this leg to the carbon leg's rationing. It has no
      // source of its own, and a null-sourced flow is exempt from rationing by
      // construction - so without the tie, any competing sink on co2_atm
      // (Batch 2's carbon scrubber) would scale the carbon down while oxygen
      // kept being released at full rate, breaking the stoichiometry.
      flows.push({
        id: "bio.o2_release",
        from: null,
        to: "o2",
        rate: t.Y_O2 * realised,
        conversion: 1,
        scaleWith: "co2_atm",
      });
    }
  }

  // --- die-off: respiration and decay, the reverse reaction at the same
  // stoichiometry, so a full grow/die cycle is carbon-neutral.
  //
  // Limited by BOTH reagents up front. The two legs draw on different accounts
  // (oxygen and fixed carbon), and `applyFluxes` rations per source - so if
  // only one leg is limited, the other still runs at full rate and half a
  // reaction happens. Concretely: a biosphere seeded into a world whose
  // climate then turned has `c_fixed` near zero, so the carbon leg rationed to
  // nothing while the oxygen leg consumed oxygen at 100% and returned no CO2.
  // Oxygen has no ledger identity, so nothing caught it.
  const cFixedAvailable = Math.max(0, cFixed) / h;
  const o2Available = Math.max(0, r.o2) / h;
  const decay = Math.min(
    t.D_BIO * b * (1 - s.g),
    cFixedAvailable / t.Y_CO2,
    o2Available / t.Y_O2,
  );
  if (decay > 0) {
    flows.push({ id: "bio.decay_o2", from: "o2", to: null, rate: t.Y_O2 * decay, conversion: 1 });
    // Tied to the OXYGEN leg's rationing. Batch 13: limiting both reagents up
    // front was not enough, because `bio.decay_o2` shares `o2` with the
    // atmospheric-loss sink - together they can over-request it, `applyFluxes`
    // then scales the oxygen leg down, and this leg (whose only competitor on
    // `c_fixed` is nobody) ran in full. Half a reaction again, created oxygen
    // at 1.25e-8 per substep in a 0.001 mbar world. `c_fixed` itself is never
    // rationed - the up-front limit above guarantees it - so following `o2`
    // loses nothing.
    flows.push({
      id: "bio.decay_carbon",
      from: "c_fixed",
      to: "co2_atm",
      rate: t.Y_CO2 * decay,
      conversion: 1,
      scaleWith: "o2",
    });
  }

  return { next, flows, suitability: s };
}
