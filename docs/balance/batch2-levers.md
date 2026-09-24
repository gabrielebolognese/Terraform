# Batch 2 note — player levers

What the nine levers of §5 do, what the reference playthrough does with them, and what the balance
batch inherits. Measured from [`batch2-facilities.csv`](batch2-facilities.csv)
(`npm run sim:run -- --years 4000 --every 10`).

---

## 1. The levers as implemented

All nine of §5, in `src/sim/facilities/registry.ts`. Each declares *what* it does; nothing about how
it is applied. §5's framing — "facilities are just extra terms in the same difference equations" — is
literal: `computeStep` gained one summand and nothing else in the engine changed.

| Lever | Kind | Effect per deployed unit |
|---|---|---|
| Orbital mirror array | env | ×1.004 effective solar flux |
| Solar shade | env | ×0.996 effective solar flux |
| Greenhouse factory | flow | +0.0004 mbar/yr engineered GHG |
| Atmospheric processor | flow | 0.02 mbar/yr, **co2_reg → co2_atm** |
| Comet redirect | flow | +0.004 m SLE/yr ice (double-entry) |
| Nitrogen import | flow | +0.035 mbar/yr N2 (double-entry) |
| Cyanobacteria seeding | action | one-shot, gated |
| Carbon scrubber | flow | 0.02 mbar/yr, co2_atm → `c_sequestered` |
| Orbital magnetic shield | shield | +0.004 shield strength |

Two readings worth stating plainly, because both are places the implementation could have drifted
from the doc without anyone noticing:

- **The atmospheric processor moves carbon, it does not create it.** §5 describes it as "+co2_atm
  (venting regolith directly)". Venting is a transfer, so it is implemented as `co2_reg → co2_atm`
  and the regolith reservoir runs out. Read as a bare `+co2_atm` it would have been a carbon
  fountain that the ledger assertion would have caught on the first tick.
- **The shield is not a state you set, it is hardware you build.** `shieldStrength` follows the
  deployed `magnetic_shield` facilities every substep, so a hand-set value with no hardware behind it
  decays back to zero at `SHIELD_BUILD_RATE`. `setShieldStrength` survives as a save-loading and test
  affordance and is documented as such.

## 2. The design rule, and what it cost

> §5: "no lever should trivialize a whole axis instantly. Each moves a *rate*, so the planet still
> changes over time, preserving visible steady growth."

The flow levers satisfy this for free — a flow *is* a rate. The environment levers do not: the
orbital mirror moves effective solar flux, which moves temperature with **no lag at all**, so a
fully-funded array would cross the Phase 2 boundary on the very first tick and delete the moment §0
calls the core of the game.

So facilities carry a `deployed` figure distinct from `count × level`: capacity is *ordered*, and
comes online at `FACILITY_BUILD_RATE` units/yr. Dismantling ramps too — letting an array snap to zero
would hand back an instant *cooling* lever, which the rule forbids just as much.

The rule is now a test, one case per lever: **no lever at maximum can reach Phase 2 in under
`MIN_PHASE_CROSS_YEARS` = 25 sim-years.** Phase 1 is exempt and deliberately so — its entry condition
*is* "the player has built something", making it an acknowledgement rather than an achievement. A
companion test asserts the levers are not merely slow but actually work: mirrors at maximum do ignite
the caps, given 200 years.

`FACILITY_BUILD_RATE = 0.5` is set to the smallest value that satisfies the rule, not a comfortable
margin: the ~14 mirror units that push the Mars start over the cap threshold take 28 sim-years, three
years clear of the limit. Batch 3 owns the final number.

## 3. The reference playthrough

Now driven by real facilities rather than Batch 1's hand-rolled forcing function, so what the harness
measures is what a player would get.

| Phase | Entry |
|---|---|
| 0 Barren | 0 y |
| 1 Warming | 10 y |
| 2 Runaway thickening | 20 y |
| 3 First water | 470 y |
| 4 Ecopoiesis | 610 y |
| 5 Oxygenation and buffer | 1170 y |
| 6 Living world | 2710 y |

Final state at year 4000: **T 296.0 K, P 1006.9 mbar, o2 195.1 mbar, ocean 36.5%, biomass 0.333,
shield 100%, progress 0.816.** The null-policy control is unchanged and still ends Phase 0 — building
the lever layer did not accidentally give the planet a way to terraform itself.

## 4. What the first playthrough taught us

The scripted player's first attempt reached Phase 6 at year 2440 and then **ended with biomass 0.000
and 1430 mbar of pressure**. Two separate self-inflicted wounds, both instructive:

1. **The scrubber starved the biosphere.** Run to exhaustion it takes `co2_atm` to zero, and
   `CO2_FOR_LIFE` is 0.5 mbar — so §2.3's endgame CO2 target of ~1 mbar sits *barely above* the point
   where life runs out of carbon. "Breathable" and "habitable" are a fraction of an mbar apart. The
   fix in the policy was to run the scrubber in a window rather than forever; the fix in the *game*
   is a Batch 3 balance question, because as it stands a reasonable player can wipe their own
   biosphere with a correct-looking action.
2. **Nitrogen import never stopped.** It sailed to 1430 mbar and 302 K. The lever has no notion of a
   target, which is right — it is a rate, not a controller — but it means the pressure overshoot is
   now something the *player* can cause as well as something the tuning causes.

Both are recorded here rather than patched in the engine: they are exactly the kind of hazard §5
intends to exist, and neither is a correctness bug.

## 5. The pressure floor

§5's carbon scrubber subtracts `co2_atm` directly, and the melt gate sits at `P_TRIPLE` = 6.1 mbar
with the Mars start only 0.11 mbar above it. Without a guard, a player who scrubs early pushes
pressure under the triple point and **locks liquid water out of the run permanently**, with nothing
on screen explaining why.

`P_FLOOR = 8.0` mbar (1.3× the triple point) fades the scrubber out over `P_FLOOR_W`, and
`scrubberThrottled()` tells the inspector to say so in words. Measured: with a maxed scrubber running
for 2000 sim-years from the Mars start, `c_sequestered` is exactly 0 and pressure is
bit-identical to a run with no scrubber at all — the fall is entirely the §3.7 bleed.

It is worth being precise about what this floor does and does not cover. It protects the **melt
gate**. It does not protect the **biosphere**, which starves at a far higher pressure (see §4 above).

## 5a. Defects found by the post-implementation review

Four independent reviewers, then three skeptics per finding: 22 candidates, 14 confirmed (several
were the same defect found by different lenses), 8 refuted. All fixed.

**One blocker, and it was a repeat of a Batch 1 lesson.** The atmospheric processor and the carbon
scrubber draw through the same `avail(x, scale)` depletion ramp as the natural rates — which
surrenders `rate · h / scale` of whatever remains every substep, *however little is left*. At maximum
order each asks for 5 mbar/yr against a tripwire ceiling of 2, so both threw `SimInvariantError`
partway through a run, killing the browser loop as well as the harness. **A 400-trial sweep over
legal `count`/`level` settings crashed 24% of the time.**

Batch 1 added `validateTuning`'s depletion-ramp guard for exactly this failure, with a comment
claiming it covered "every rate sharing each scale". Batch 2 then added two new draws and did not
extend it. The guard now covers the facility rates too, the levers use their own wider
`FACILITY_DEPLETE_SCALE = 6.0`, and a 120-trial fuzz is a test. Measured after the fix: **0/400**.

The existing tests did construct 250-unit levers of every type — they just never ran them long enough
to drain a reservoir. That is the gap the fuzz closes.

The other thirteen, deduplicated:

| Defect | Fix |
|---|---|
| The lever panel captioned a *retiring* lever "coming online", and showed "5 of 0 units online", because `ordered` ignored `enabled` while the sim's `orderedUnits` does not. | Mirror the sim's rule; add a "retiring" branch. |
| Phase 5's comment called its missing buffer clause a deferral "until Batch 2 gives it a facility registry" — Batch 2 did, and the clause was still missing, so the comment read as resolved history. | Closed it: `PHASE5_N2`, read as *the buffer exists* rather than *an importer is switched on*, keeping phase evaluation out of the facility graph. |
| `--mirror`, `--ghg` and `--n2` were still parsed, validated, and written to `Policy` fields nothing reads. A balance sweep over them returned identical numbers with no warning. | Deleted, along with the unused `num()` helper and a stale import. |
| "Mirrors warm the planet and shades cool it" compared against the **t=0** state, not a matched run. The planet cools 0.12 K on its own from the bleed — enough to pass for a shade contributing nothing (the real shade contributes −4.3 K, a 36× miss). | Compare against a matched no-facility run. |
| A bare `0.05` solar-multiplier floor sat in `facilities/index.ts`, outside `tuning.ts` and outside the invariant-#4 guard, which only scanned `rates/`. It is load-bearing: a full shade deck is exactly `delta = −1`. | `S_MULTIPLIER_MIN` in tuning; the guard now scans `facilities/` too. |
| `InspectorView.env` and `.phase` were computed and passed every readout and never rendered; `setShieldStrength` was exported and called nowhere. | Render both — the solar multiplier is the one player input nothing else showed, and the instantaneous phase can fall below the latch. `setShieldStrength` now backs the decay test. |

## 6. For the balance batch

- `FACILITY_BUILD_RATE` is at its minimum viable value. Anything faster breaks the §5 design rule;
  the test will say so.
- The per-unit rates were chosen to reproduce Batch 1's reference trajectory at plausible counts
  (30 mirrors, 10 greenhouse factories, 10 nitrogen importers), not derived from anything.
- `FACILITY_MAX_COUNT = 50` and `FACILITY_MAX_LEVEL = 5` are one uniform cap rather than nine
  per-lever ones. Without an economy there is nothing to make one lever scarcer than another, so
  nine numbers would be nine arbitrary numbers. Batch 9 is where per-lever limits get meaning.
- The three problems from the Batch 1 note are unchanged and still open: biomass plateaus at 0.33
  (carbon-starved), the endgame runs ~8 K hot, and the oxygen tail is most of the run. The solar
  shade now exists as the intended fix for the second, and the reference policy uses it.
