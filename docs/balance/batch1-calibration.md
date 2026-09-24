# Batch 1 calibration note

Where the current constants actually put the curve, measured from
[`batch1-baseline.csv`](batch1-baseline.csv) (401 rows, `npm run sim:run -- --years 4000 --every 10`).

**This is Batch 1's output, not its problem to fix.** Batch 1's job was a correct engine with
defensible defaults. Tuning the numbers below is the balance batch's job, and this note is its input.

---

## 1. The two controls

| Run | Final state | Verdict |
|---|---|---|
| **Null policy** (nobody touches the planet, 4000 sim-years) | T 212.5 K, P 5.1 mbar, caps still full at 40.0 mbar, Phase 0 | **PASS.** An untouched Mars stays dead. Reaching the tipping point is the player's job. |
| **Reference policy** (scripted stand-in for a player) | T 296.9 K, P 1013.0 mbar, o2 187 mbar, ocean 36.4%, biomass 0.333, Phase 6 | **PASS.** The full arc is reachable. |

The null run is the one that matters. With the design doc's bare sigmoid (§3.3), `release_cap` at the
Mars start is `0.8 × sig(-0.488) = 0.304 mbar/yr` — 38% of maximum — and an untouched Mars empties its
polar caps in about 130 sim-years while the player watches. §0 calls the moment the player pushes the
planet past its tipping point "the emotional core of the macro game", and the documented constants hand
it over for free. The renormalised ramp fixes this without changing `T_SUBL_CAP` or `W_CAP`.

## 2. Phase timing, reference run

| Phase | Entry | Gap |
|---|---|---|
| 0 Barren | 0 y | — |
| 1 Warming | 10 y | 10 y |
| 2 Runaway thickening | 20 y | 10 y |
| 3 First water | 520 y | 480 y |
| 4 Ecopoiesis | 620 y | 100 y |
| 5 Oxygenation and buffer | 1200 y | 580 y |
| 6 Living world | 2860 y | 1660 y |

The S-curve shape is there — slow start, accelerating middle, long settling tail. Two pacing
observations for the balance batch:

- **Phase 2 arrives at year 20**, which is very early for "the it's-happening moment". It is an artifact
  of the scripted policy ramping mirrors from year 0, not of the engine.
- **Phase 6 takes 58% of the run**, almost all of it the oxygen tail. See §4.

## 3. Where the run lands vs. the §2.3 targets

| Quantity | Final | Target | Status |
|---|---|---|---|
| T | 296.9 K | 288 K | **+8.9 K over.** |
| P | 1013.0 mbar | 1013 mbar | On target (the policy stops importing N2 there). |
| o2 | 187.0 mbar | 210 mbar | 89% — carbon ran out first. |
| ocean_frac | 0.364 | 0.3–0.7 | In band. |
| biomass | 0.333 | > 0.8 | **42% — the binding axis.** |
| co2_atm | 0.2 mbar | ~1 mbar | Below target, i.e. over-drawn. |
| **progress** | **0.810** | 1.0 | Capped by biomass and oxygen. |

## 4. The three things the balance batch has to fix

1. **Biomass plateaus at 0.33 because carbon runs out.** The biosphere draws `co2_atm` down to 0.2 mbar,
   at which point the `G_carbon` gate (`co2_atm / CO2_FOR_LIFE`) falls to 0.4 and growth stalls against
   die-off. The carbon budget is the constraint: 306 mbar of native CO2, of which ~289 mbar would be
   needed to make the full 210 mbar of O2, leaves nothing for a standing biosphere and a 1 mbar
   atmosphere. `Y_CO2 = 2.5` is the constant converting biology to chemistry and the doc gives no
   derivation for it — it should be **back-solved from the carbon budget**, not guessed.

2. **The endgame overshoots to 296.9 K.** This is the nitrogen overshoot: the ~820 mbar buffer the
   pressure target requires adds roughly 35 K of greenhouse through the total-P term, and §3.6's prose
   ("nitrogen raises P without adding greenhouse forcing of its own") contradicts §3.1's equation, which
   reads total P including N2. Two levers are already in place and untouched: `N2_GREENHOUSE_WEIGHT`
   (1.0 now, ~0.3 for pressure-broadening only) and the §5 solar shade. Batch decision needed.

3. **The oxygen tail is most of the run.** At `M_PHOTO = 0.05` with the corrected `Y_O2 = 1.818`, a full
   biosphere produces 0.091 mbar/yr, so 210 mbar takes ~2300 sim-years against a ~500-year CO2 runaway.
   Raising `M_PHOTO` shortens it, but it is pacing, not correctness.

`A_CLOUD = 0.45` is now the most sensitive constant in the temperature model — each 0.05 moves the
endgame about 1.5 K. It is kept at a physically defensible value rather than tuned to hit 288 K.

## 5. Divergences from the §10 table, and why

Seven. Each is a correctness fix, not a balance preference; the arithmetic is in `src/sim/tuning.ts`.

| Constant | Doc | Now | Reason |
|---|---|---|---|
| `H2O_MBAR_PER_M` | 0.1 | **37.11** | Wrong by 371×. ρgh on Mars is 1000 × 3.711 = 3711 Pa = 37.11 mbar/m. At 0.1 the water-vapour feedback — one of §4's three named positive loops — contributes under 0.1 K, and the ocean evaporates permanently. |
| `co2_reg0` | 120 | **260** | At 120 the victory condition is arithmetically unreachable: 166 mbar of native carbon yields at most 120.7 mbar of O2 against a 210 mbar target. |
| `Y_O2` | 2.0 | **Y_CO2 × 32/44** | §2.1's reservoirs are pressure-equivalent and pressure is column weight, so an mbar is proportional to mass. One mole of O2 per mole of CO2 is 32/44 = 0.727 by mass, not 0.8. |
| `LOSS_LAMBDA` | 5e-4 | **5e-5** | §3.7 says the bleed is small enough to ignore early. At 5e-4 it removes 39% of the atmosphere by year 1000 and is the dominant term. |
| `G_GHG = 30` | — | **removed** | Replaced by `C_GHG`/`GHG_REF`. The multiplicative form makes PFC potency a function of mixing ratio, so the player's investment loses value exactly as it works, and a pure-PFC atmosphere reaches 471 K. |
| `E_RATE`/`C_RATE` | 0.3/0.3 | **removed** | Replaced by `K_VAP`/`VAP_COL_FRAC`. §3.4's evaporation has no saturation ceiling, so it boils the ocean dry regardless of humidity. |
| `SUBSTEPS = 4..8` | — | **removed** | Replaced by `SUBSTEP_YEARS = 0.25`. A fixed COUNT gives h = 125 at a 1000-year offline step, which sends the logistic biomass map to −∞. |

Plus `TIME_SCALE = 0.025` (§10 leaves it undefined), and `H2O_DEPLETE_SCALE` 0.2 → 1.0, which the flux
tripwire caught during the first run: a reservoir on an `avail(x, S)` ramp surrenders `R·h/S` of what
remains each substep regardless of how little is left, which was 62%. `validateTuning` now enforces
`S ≥ R_max · SUBSTEP_YEARS / FLUX_ASSERT_MAX_FRAC` for every rate sharing each scale.

## 5a. Defects found by the post-implementation review

An adversarial review (four independent reviewers, then three skeptics per finding) produced 23
candidates, of which 18 survived a majority refutation vote. All 18 are fixed. The four that mattered:

| Defect | Effect | Fix |
|---|---|---|
| **Respiration split into a half-reaction.** Die-off emitted two flows drawing on *different* accounts — oxygen and fixed carbon — and `applyFluxes` rations per source. With `c_fixed` near empty the carbon leg rationed to nothing while the oxygen leg ran at 100%. | Oxygen destroyed with no CO2 returned, and nothing caught it: oxygen has no ledger identity. It fired in the shipped reference run at year 600. | Limit the reaction by **both** reagents before emitting either leg. |
| **Sublimation had no saturation ceiling** — precisely the bug the liquid path was rewritten to avoid. Its only sink is relaxation toward `equilibriumVapour`, which is identically zero without an ocean. | A barren Mars sat at 25× saturation behind a spurious cloud deck: albedo 0.287, 2.5 K colder, and the ignition gap the player must close 84% wider. | Cap the **amount** at the saturation deficit. Scaling the rate is not enough — one substep overshoots saturation 18×, producing a limit cycle at 10×. |
| **The ledger assertion never ran on any path that drives the sim.** It lived only in `tick()`, but the harness and the browser loop both call `advance()` directly. | `npm run sim:run`, the checked-in CSV and the live inspector all ran with no conservation checking at all — and Batch 2's facility work was banking on it firing. | Moved into `advance()`, one snapshot pair per call. |
| **`OCEAN_FOR_LIFE = 0` was the one unguarded denominator in `src/sim`.** Its sibling `CO2_FOR_LIFE` was in `validateTuning`'s positive list; it was not. | 0/0 puts NaN into biomass, then T, then the progress bar, and `JSON.stringify` writes it to the save as `null` — without failing one non-negativity check, since every comparison against NaN is false. | Added to `validateTuning`, and the gate now routes through `avail()`. |

The remaining 14 were minor: a null-sourced flow escaping rationing, an unreachable frame-budget path,
harness `phaseTimes` reporting a phase crossed between samples as never reached, three tests that
passed vacuously, and an invariant guard that only matched decimal-point literals. Five candidates
were refuted and dropped.

Each fix has a regression test naming the failure it prevents.

## 6. Anchors that are now tests

The doc's two stated sanity checks hold exactly, and a third — which the doc never states but which is
the one that actually catches a miscalibration — was added:

| Anchor | Value | Where |
|---|---|---|
| `T_eq(590 W/m², albedo 0.25)` | 210.1685 K | `derive.test.ts` |
| `dT_gh(1000 mbar, no GHG)` = 25·ln(21) | 76.1131 K | `derive.test.ts` |
| `albedo(marsStart)` | 0.2503 | `derive.test.ts` |
| `albedo` still ≈ 0.25 after 1000 sim-years idle | 0.2516 | `rates/water.test.ts` |

The fourth was added by the review: the t=0 anchor cannot see a cloud deck that accumulates over the
following two sim-years, which is exactly how the supersaturation defect hid.

The third matters because the first passes for *any* `ice_frac` mapping. §3.1's albedo of 0.25 plus
§3.2's formula with `A_ICE = 0.60` and `A_BARE = 0.17` force `ice_frac(marsStart) = 0.186`; the cover
constants reproduce 0.1868. If the fraction maps drift, only this anchor fails.

## 7. Known residual, deferred deliberately

- **The ~3 K greenhouse double-count at t=0.** §3.1 asserts `T_eq(albedo 0.25) = 210 K` is "Mars' real
  mean temperature", but that value already *is* the observed surface temperature, so adding
  `dT_gh(6.21 mbar) = 2.93 K` gives T(0) = 213.07 K — 3 K hotter than the Mars it claims to match. The
  fix (`A_BARE` 0.17 → 0.25 with a recalibrated ice fraction) weakens the ice-albedo feedback and
  abandons the doc's own reproducible albedo anchor. Harmless now that ignition requires player action.
- **The cap release is one-way**, so there is no restoring cold equilibrium and no "you didn't push hard
  enough, it slid back" failure state. The ramp makes the planet provably inert below `T_SUBL_CAP`,
  which is all Batch 1 needs, but it is a ratchet rather than a saddle-node.
- **Photosynthesis does not consume water.** Real enough to note, negligible against a 40 m ocean.
- **Offline catch-up has a work cap but no design cap.** At `TIME_SCALE = 0.025` a 48-hour absence is
  worth 4320 sim-years — more than a full playthrough. The persistence batch needs a separate rate
  factor and per-absence cap, or an absent player finishes the game.
