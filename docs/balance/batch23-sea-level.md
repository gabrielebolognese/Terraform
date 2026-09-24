# Batch 23 — Detail: sea level from the macro simulation

Detail doc §6 step 2: *"Add `seaLevelCurve` to the macro layer and expose `sea_level_m` and its
rate as derived outputs."*

**What was built:**
- **`seaLevel`** (`src/sim/sea-level.ts`): the planet's hypsometric curve from Batch 22, evaluated at
  the ocean fraction. Its rate uses the chain rule through the curve and the ocean formula, from the
  net flow into liquid water.
- **`HabitatChannels.seaLevelM` and `seaLevelRateMPerYear`**, so the city layer sees sea level
  through its wall.
- **`nextSubstepFlows(state, cfg)`**: the flows the next substep of `advance` will integrate,
  weather and forcing included.
- **A "sea level" stat in the instruments panel**, which reads "no sea yet" before there is one.

**Exit gate met, and checked by injection:**
- **Monotonic, and it matches the globe:** against 8,000 random places, the share of the planet
  below sea level equals the ocean fraction to within 0.008.
- **The rate:** each substep's predicted rise matches the real `advance` to within 0.104%, except
  the two substeps that cross a kink in the curve.
- **No existing gate moved:** the golden run, the Batch 3 score, determinism, the golden frames
  and the economy all passed untouched.

**Numbers:** 771 tests pass, up from 764. The web bundle is 167.7 kB of JS (166.6 kB before).

## What went wrong

**The browser's rates had been leaving out the weather.** `main.ts` built its readout flows with
`computeStep(…, null)`, which has no forcing. `advance` composes the seeded weather's flows inside
itself, so every rate the browser showed was the weather-free one. My first survey had the same
blind spot. `nextSubstepFlows` now gives every reader the exact flows `advance` will integrate.
Other readouts built from those forcing-free flows (the visual channels' flows, for instance) were
not changed in this batch; see Open.

**My first survey could not see the one water flow that crosses units.** Condensation (vapour in
mbar, into the sea in metres) is the only flow into liquid water with a unit conversion. With the
weather off, it doesn't fire until **year 2,200**, and the survey ended at 1,200. So an injection
that dropped the conversion passed. With the weather on, which is how the browser runs, it fires
from **year 275**, on 1,475 of the survey's 4,800 substeps. The survey now runs with the weather on
and requires condensation to have happened.

**The first water predicted no rise.** At exactly zero liquid water I set the ocean's slope to 0,
so the substep where the first water arrives (year 273) predicted no rise while the ocean actually
grew at its full initial rate: 100% off. The slope is now one-sided: an empty sea starts rising at
once, and draining an empty sea moves nothing.

**My isolation test used a dead planet.** "The water rate changes nothing but the sea" was checked
where every habitat gate sits flat at zero, so a leak of the rate into support passed it. It now
runs on a living world 1,200 years into the reference run, with a large rate.

**A −0 again,** from zero times a falling rate: the same small wart as Batch 22's landing zone.

## Measurements

| What | Measured |
|---|---|
| Share of 8,000 random places below sea level vs the ocean fraction, at nine fractions | at most 0.008 off (sampling σ near 0.36 is 0.0054) |
| Predicted vs actual rise per substep, away from kinks, reference run | worst 0.104% with the weather on (year 365.25) and off (year 320) |
| Substeps crossing a kink in the curve | 2 (at ranks 1/8 and 2/8): the only ones more than 1% off, 18.8 m at worst |
| The cap at 1 − ice fraction, reference run | never applies (0 of 12,000 substeps) |
| Rationing of liquid water | never (0 substeps, weather on or off) |
| Sea level at the end of the reference run (ocean 36.46%) | **−3,091.5 m** |
| Fastest rise in the reference run | **143 m per sim-year**, at year 317, the tail of the curve's steepest segment |
| The rate survey, 1,200 years with the weather on | 429 ms |

The 143 m/yr figure matters for Batch 24. On the steepest part of the curve, the sea rises tens of
metres in a single sim-year, which passes a city's whole 10 m flooding margin in about a month of sim
time.

## Verified by injection

| Broken on purpose | Caught by |
|---|---|
| Water flows lose their unit conversion | the weather-on survey (**missed at first**, weather off) |
| Water leaving the sea not counted | the survey |
| The slope read from the next segment | the survey |
| The first water predicts no rise (the first version) | the survey, the first-water test |
| The ocean's slope forgets it saturates | the survey |
| Sea level read from the land fraction | the monotonic and share tests |
| A drained sea's rate is −0 | the first-water test |
| The contract drops the water rate | the isolation test |
| The water rate leaks into support | the isolation test (**missed at first**, dead planet) |
| The sea level channel is not finite | the habitat playthrough test |
| The panel shows a waterline before there is a sea | the readout test |
| The panel loses a falling sea's sign | the readout test |

## Open

- **The kinks.** The curve is piecewise linear, so its rate jumps at every eighth of the ocean
  fraction: from 28,800 to 4,000 m per unit at the first kink. Batch 25's forecast must handle a
  crossing rather than extrapolate straight through it.
- **The settlements' copy of the rate is untested.** `computeStep` hands the settlements a rate
  from the macro and forcing flows. Nothing reads it until Batch 24, so no test can observe it yet.
- **`main.ts`'s wiring is untested** (Batch 21's standing open item). Its readout now uses
  `nextSubstepFlows`; the other readouts built from the forcing-free flows were not changed here.
