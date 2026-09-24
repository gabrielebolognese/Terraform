/**
 * Design doc section 3.4 - the water cycle.
 *
 * All five terms are computed in metres of sea-level-equivalent per year. The
 * conversion to mbar happens exactly once, via the `conversion` factor on the
 * two vapour flows. See units.ts for the contract.
 */

import { avail, clamp01, smoothstep } from "../math.js";
import type { Tuning } from "../tuning.js";
import type { Derived, Flow, Reservoirs } from "../types.js";
import { metresFromVapourMbar, metresToVapourFactor, vapourToMetresFactor } from "../units.js";

/**
 * Saturation vapour pressure over water, mbar.
 *
 * A one-term Clausius-Clapeyron, anchored at the triple point: sat(273.15 K)
 * = 6.112 mbar and sat(288 K) = 17.0 mbar, which matches Earth. Section 3.4
 * asks only for "a cheap exponential, monotonic in T"; the ceiling exists so
 * that a runaway temperature cannot hand an Infinity to a subtraction and
 * produce Infinity - Infinity = NaN.
 */
export function sat(T: number, t: Tuning): number {
  const value = t.E_SAT_REF * Math.exp(t.L_OVER_RV * (1 / t.T_FREEZE - 1 / Math.max(T, 1)));
  return Math.min(value, t.SAT_MAX_MBAR);
}

/**
 * The triple-point gate on melting (section 3.4).
 *
 * Liquid water is not stable below ~6.1 mbar; ice sublimates straight to
 * vapour instead. Smoothed over P_TRIPLE_W rather than section 3.4's hard cut,
 * because the start state sits 0.11 mbar above the threshold and a hard cut
 * there is a coin toss that flickers every substep.
 */
export function pressureGate(P: number, t: Tuning): number {
  return smoothstep(t.P_TRIPLE, t.P_TRIPLE + t.P_TRIPLE_W, P);
}

/** The equilibrium vapour column the atmosphere relaxes toward, mbar. */
export function equilibriumVapour(d: Derived, t: Tuning): number {
  return t.VAP_COL_FRAC * sat(d.T, t) * d.oceanFrac;
}

/**
 * The five water flows.
 *
 * Evaporation and condensation are a single saturation-relaxation exchange,
 * integrated EXACTLY over the substep: `e_new = e_eq + (e - e_eq) * exp(-k h)`.
 * Section 3.4's separate unbounded `evaporate = E_RATE * sat(T)` term has no
 * saturation ceiling at all, so it runs at full rate however much vapour is
 * already aloft, boils the ocean dry and leaves ocean_frac permanently at
 * zero. The relaxation form is also unconditionally stable at any step size,
 * which is what keeps the stiffest term in the model out of the substep
 * budget.
 *
 * `h` is the substep size, which this module needs because the exchange is
 * integrated rather than differentiated; the resulting amount is divided back
 * out into a rate so it composes with every other flow.
 */
export function waterFlows(r: Reservoirs, d: Derived, t: Tuning, h: number): readonly Flow[] {
  const flows: Flow[] = [];
  const gate = pressureGate(d.P, t);

  // --- melting: ice -> liquid, only above freezing and above the triple point
  const melt =
    t.M_RATE * clamp01((d.T - t.T_FREEZE) / t.W_MELT) * avail(r.h2o_ice, t.H2O_DEPLETE_SCALE) * gate;
  flows.push({ id: "h2o.melt", from: "h2o_ice", to: "h2o_liq", rate: melt, conversion: 1 });

  // --- freezing: liquid -> ice
  const freeze = t.F_RATE * clamp01((t.T_FREEZE - d.T) / t.W_MELT) * avail(r.h2o_liq, t.H2O_DEPLETE_SCALE);
  flows.push({ id: "h2o.freeze", from: "h2o_liq", to: "h2o_ice", rate: freeze, conversion: 1 });

  // --- sublimation: ice -> vapour, the path section 3.4 describes and never writes.
  // Active precisely where melting is gated off, so a thin-atmosphere world
  // still cycles water instead of locking every molecule in the caps forever.
  //
  // The saturation deficit is load-bearing, not decoration. Without it this
  // term reintroduces exactly the bug the liquid path was rewritten to avoid:
  // an unbounded source with no reference to how much vapour is already aloft.
  // Its only sink is the relaxation toward `equilibriumVapour`, which is
  // identically zero when there is no ocean - so on a barren world (the whole
  // opening of every playthrough, and the entire null-policy control) the
  // vapour column parked at 25x saturation, raising cloud cover to 0.19,
  // albedo to 0.287 and cooling the planet 2.5 K within two sim-years. That
  // also widened the ignition gap the player has to close by 84%.
  //
  // The limit is on the AMOUNT, not a scaling of the rate. Scaling by a
  // saturation deficit is not enough, because one substep of unrestricted
  // sublimation delivers 0.34 mbar against a saturation ceiling of 0.0185 mbar
  // at these temperatures - an 18x overshoot - so the deficit factor just
  // alternates between 0 and 1 and the column settles into a limit cycle
  // averaging 10x saturation. Capping the amount at "however much it takes to
  // reach saturation this step" is both the physical statement and the stable
  // one: sublimation is limited by how much vapour the air can hold.
  const satT = sat(d.T, t);
  const vapourDeficit = Math.max(0, satT - Math.max(0, r.h2o_vap));
  const sublimateDemand =
    t.SUBL_RATE *
    (1 - gate) *
    clamp01((d.T - t.T_SUBL_H2O) / t.W_SUBL_H2O) *
    avail(r.h2o_ice, t.H2O_DEPLETE_SCALE);
  const step = h > 0 ? h : t.SUBSTEP_YEARS;
  const sublimate = Math.min(sublimateDemand, metresFromVapourMbar(vapourDeficit, t) / step);
  flows.push({
    id: "h2o.sublimate",
    from: "h2o_ice",
    to: "h2o_vap",
    rate: sublimate,
    conversion: metresToVapourFactor(t),
  });

  // --- the vapour exchange, integrated exactly
  const e = Math.max(0, r.h2o_vap);
  const eEq = equilibriumVapour(d, t);
  const eNew = eEq + (e - eEq) * Math.exp(-t.K_VAP * step);
  const dVapMbar = eNew - e;

  if (dVapMbar > 0) {
    // Net evaporation. Source is the ocean, so the rate is in metres/yr.
    const metresPerYear = metresFromVapourMbar(dVapMbar, t) / step;
    flows.push({
      id: "h2o.evaporate",
      from: "h2o_liq",
      to: "h2o_vap",
      rate: metresPerYear * avail(r.h2o_liq, t.H2O_DEPLETE_SCALE),
      conversion: metresToVapourFactor(t),
    });
  } else if (dVapMbar < 0) {
    // Net condensation. Source is the vapour column, so the rate is in mbar/yr.
    // Below freezing it deposits as snow onto the ice sheet rather than rain.
    const mbarPerYear = -dVapMbar / step;
    const freezing = d.T < t.T_FREEZE;
    flows.push({
      id: freezing ? "h2o.snow" : "h2o.condense",
      from: "h2o_vap",
      to: freezing ? "h2o_ice" : "h2o_liq",
      rate: mbarPerYear,
      conversion: vapourToMetresFactor(t),
    });
  }

  return flows;
}
