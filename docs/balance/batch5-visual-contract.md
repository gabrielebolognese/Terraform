# Batch 5 note — the visualization contract

Design doc §9, built *before* the graphics. What the eight channels are, and how the continuity claim
became something that can fail.

Run `npm run sim:run -- --years 2000 --every 10 --channels` to see them over a full playthrough;
[`batch5-channels.csv`](batch5-channels.csv) has the numbers.

---

## 1. The channels

`deriveVisuals(reservoirs, derived, flows, tuning) -> VisualChannels`. All eight §9 rows, plus
`clearFraction` exposed because the sky is driven from it and a renderer will want it for scattering.

| §9 row | Channel | Notes |
|---|---|---|
| Polar ice cap size | `capRadius` | angular radius, 0..1 of a quarter turn |
| Ocean coverage | `oceanCoverage` | |
| Surface greenness | `surfaceGreen` | |
| Atmosphere / rim glow | `atmosphereThickness` | saturating in `P` |
| Sky colour | `skyColour` | butterscotch → pale → blue, faded toward vacuum |
| Cloud cover | `cloudCover` | |
| Surface warmth tint | `surfaceTint` | frost-blue → warm-neutral |
| Dust storm intensity | `dustIntensity` | from the release **rate**, damped by wet ground |

**Colours are values, not strings.** A renderer should not be parsing `#rrggbb` to interpolate, and a
test should not be asserting on text. `toHex` exists as a convenience on top; the contract is numeric.

**Cap radius is geometry, not another invented curve.** §9 asks for "cap radius scales with reservoir
remaining", and `ice_frac` already carries both `h2o_ice` and `co2_cap`. Turning a surface *fraction*
into a *radius* is `acos(1 - f)`: two polar caps subtending angle θ cover `1 - cos θ` between them.
That is what a renderer wants, and a second saturating curve invented here would only approximate it.

**Dust reads the flows, not a net rate.** This is the payoff for the Batch 1 decision to make rate
contributions `Flow` objects carrying a `FlowId` rather than per-reservoir nets: §9 sources dust from
"rate of co2 release" specifically, and a net rate on `co2_atm` would already have the biosphere's
uptake and the solar wind's bleed mixed in. A test pins that adding a photosynthesis sink and an
escape sink to the flow list leaves dust unchanged.

**The sky fades toward vacuum.** §9's three stops are driven by clear fraction alone, which would make
a 6 mbar Mars and a 1 bar Mars of the same composition equally skyful. Blending toward a near-black
vacuum colour by pressure is the one thing a limb must not get wrong.

## 2. `phase` is not an input, and that is enforced structurally

§9: *"the visuals move continuously underneath them. Phases change tech and UI"* — and §0.3 names the
failure this prevents: Per Aspera's terraforming reading as "colored keys" gating progress while the
planet barely changes. The moment a channel branches on phase, the planet snaps between discrete
looks and the contract is decorative.

So `visuals.ts` never mentions `phase` or `progress`, and `boundary.test.ts` asserts it. A continuity
test can only sample; this cannot be got round.

## 3. The continuity test was wrong three times

This was the substance of the batch, and each wrong version taught something.

**First: it only checked phase boundaries.** That is what the plan specified and what §9 talks about
— but the visuals do not read phase, so a threshold hidden in a mapping fires at whatever *state
value* crosses it, which has nothing to do with where a boundary happens to fall. Proof: injecting
`iceFrac > 0.1 ? capRadiusFrom(iceFrac) : 0` **passed**. The scan is now run-wide; the
boundary-specific assertion survives as a named sub-case because it is the claim the doc makes.

**Second: it compared each delta to a local median.** That is a *smoothness* test, not a continuity
one. It flagged `dustIntensity` at year 106, where dust comes off its `clamp01` ceiling as the
release rate falls below `DUST_RELEASE_REF` — the value is perfectly continuous, the derivative has a
corner. Every channel is `clamp01`, so every channel saturates, so that test would eventually have
flagged all of them.

**Third: the driver mapping for dust was a reservoir level.** A level is smooth exactly where the rate
off it is not: `co2_cap` glides to zero while the cap term collapses over the last 2 mbar of its
`avail` ramp.

**What it is now** is the criterion §0 and §9 actually state, in the units they state it in: *no
channel may change more than 25% of its range per real minute*. §0's "visible change at least every
few real minutes" is the lower bound on the same quantity; this is the upper one. At `TIME_SCALE =
0.03` that allows about 14% of a channel between one-sim-year samples. The dust fade that the median
version flagged is 9%/min. A genuine step — a whole channel in one substep — is above 400%/min.

Verified by injection: the `iceFrac > 0.1` snap now fails with *"capRadius snapped 1 time(s) — year
306: moved 0.2876 of its range in 0.56 real minutes"*.

## 4. The one real discontinuity, and why it is fine

Ecopoiesis. §3.5 and §5 both define seeding as a one-shot edit that "sets biomass to a small positive
value" rather than a rate, so biomass genuinely steps from exactly 0 to `SEED_AMOUNT`. §9 promises
the visuals are continuous functions of *continuous state* — a continuous function of a discontinuous
input is the contract working, not failing.

So a channel is only in trouble if it jumps when **its driver did not**, and the test carries an
explicit driver per channel to check that.

The pleasant finding: at one-sim-year resolution the seed step does not stand out from its
neighbourhood at all, because the growth immediately after it is just as fast. The green arrives
without a pop.

Liquid water also leaves zero during a run, and it **creeps** off it as the first ice melts — its
first positive value is under 1% of its final. Distinguishing a step from a creep is the whole point,
and both are asserted.

## 5. What the run looks like

From `--channels` over 2000 sim-years:

- **cap radius** starts near 0.55, retreats to 0 by about year 300
- **dust** spikes to its ceiling through the early thickening and is gone by year 150 — §9's "bursts
  during rapid thickening (phase 2)", falling out of the model rather than being scripted
- **atmosphere** climbs steadily to about 0.95
- **ocean** appears around year 250 and settles near 0.36
- **greenness** is flat at zero until seeding, then climbs to about 0.6

## 6. For the renderer (Batch 6)

- Import `VisualChannels` and nothing else from `src/sim/`. `boundary.test.ts` enforces the direction.
- `deriveVisuals` is deliberately **not** called inside `tick`: a substep does not need it. The
  browser calls it at readout rate (10 Hz), the harness once per sample.
- `VISUAL_TUNING` and `PALETTE` live in `visuals.ts`, not the balance table — deliberately, so the
  Batch 3 sweep cannot reach them. Varying a sky colour to change a pacing score is meaningless.
- The channels carry no notion of *where* anything is. Basin shapes, cap placement and the
  hypsometric curve are §12's deferred "spatial resolution" question; the contract stays global.
