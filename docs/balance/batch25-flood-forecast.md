# Batch 25: flood forecast and warnings

Detail §6 step 4: "Add the forecast (4.4) and wire warnings into the macro overview."

## What went wrong, and what it cost

### The spec's formula would have been 58 years wrong

§4.4 gives `years_to_base = (effective_base − sea_level_m) / d(sea_level_m)/dt`: a straight line in
metres. On the drowning fixture it names substep 692 for the high city's base going under; the
simulation crosses at 460. That is 58 sim-years late, because a kink of the sea-level curve lies
between the sea and the city. Batch 23 had warned of exactly this ("Batch 25's forecast must handle a
crossing rather than extrapolate straight through it").

The forecast works in liquid water instead: what arrives at a steady rate. It finds:
- the share of the planet the sea must cover to stand at the height (the curve, inverted);
- the water that makes that share (the saturation, inverted);
- the water still to come at the current net rate.

Every crossing on the fixture falls within 0.069 sim-years of the forecast, a quarter of a substep.
As an injection, the straight line at the target's own slope failed five tests.

### "At current rate" is late while the sea accelerates

The exit gate asks for a run at a steady rate, and there the forecast is exact. The reference
playthrough is not steady: nearly all of the sea's 5,100 m of rise comes in a burst between about
year 280 and year 370, peaking at 142 m a year near year 317, and the water rate climbs through it.
A forecast at current rate is therefore optimistic. For a city at −7,000 m, the forecast at the moment
of warning named year 327.8; the sea arrived in 297.75. That is honest to its words ("at current
rate"), but it means the forecast year moves earlier as the burst builds.

### Which is why the warning needed its own horizon

§4.3 raises the warning 20 m below the base. On the burst's steepest stretch that is 0.14 sim-years:
about seven weeks. A new constant, `FLOOD_ALERT_YEARS` = 50, also warns whenever the forecast says the
sea is 50 years off or less.

Measured on the reference playthrough, the warning came this far ahead of the sea for cities at five
heights:

| Base | Notice |
|---|---|
| −7,000 m | 19.25 yr |
| −6,000 m | 23.75 yr |
| −5,000 m | 27.25 yr |
| −4,000 m | 39.25 yr |
| −3,300 m | 49.5 yr |

On the steady fixture, the high city is warned 49.88 years out; the margin alone would have given 4.1.

### Smaller things

- **One of my probes wrote a threshold before measuring it.** The comments in the forecast tests were
  first written from an earlier table (0.18 years, "2 sim-years off"), not from the quantities the
  tests compare. A probe printed the real ones (0.069, 0.179, 4.1) and the thresholds were set from
  those.
- **The ocean's ceiling was first tested where it did not matter.** The test for an ocean that can
  never reach the city used a saturation below the city's share. There the arithmetic gives NaN and
  falls through to "not coming" with or without the ceiling, so removing the ceiling passed. What the
  ceiling uniquely guards is ice: at 85% ice cover the sea can hold only 15% of the planet. An icy
  world is now tested, and removing the ceiling is caught.
- **One expected warning was my arithmetic, not the code's.** At substep 26 the loss is 2.4 years off:
  "~2 yr", not "~3".

## Built

- **`floodForecast`** (`src/sim/micro/flood.ts`): `yearsToBase` and `yearsToDestroy` in sim-years.
  - 0 once crossed.
  - Null when the sea is still or falling, or can never rise that far (its saturation, or the ice).
  - Null for a ruin, and with flooding off.
  - Derived, never stored.
- **`rankAtElevation`** (`hypsometry.ts`): the curve, inverted.
- **`floodAlert`**: a settlement is warned inside `FLOOD_WARN_MARGIN_M`, or within `FLOOD_ALERT_YEARS`
  of the sea's forecast arrival.
- **`FLOOD_ALERT_YEARS` = 50**, in `tuning.ts` and the §10 table.
- **The orbit HUD:**
  - Each warned settlement's row reads "Flood warning: submersion begins in ~5 yr, total loss in ~9 yr
    at current rate.", or once under water "Flooding: under water, total loss in ~2 yr at current
    rate."
  - It is words first; the warning colour and weight only repeat them.
  - The line is updated in place every readout. The list is not rebuilt, so a click in flight is not
    lost.
  - `main.ts` asks the simulation through `floodWarnings`; the HUD only shows the words.

### Changed from the plan

- **The formula:** the forecast works in water, not §4.4's metres, for the reason above. The words are
  §4.4's.
- **The city view has no warning.** It sees only the habitat channels, which carry no water rate, and
  the spec asks for the macro overview.
- **Flooding is still off in the browser.** See Open.

## Measured

- **The forecast against the sim** (the drowning fixture, a steady import):

  | Crossing | Forecast | Sea crossed |
  |---|---|---|
  | Low city, base under | substep 21.5 | 22 |
  | Low city, lost | 35.7 | 36 |
  | High city, base under | 459.8 | 460 |
  | High city, lost | 468.4 | 469 |

  - With half the water: 43.0, 71.5, 919.8 and 936.9, against 44, 72, 921 and 938.
  - Asked again every 50 substeps on the way up, the high city's forecast year stays between 114.94
    and 115.00, against a crossing at 114.875.
- **Tests:**
  - `flood-forecast.test.ts`, 6: each crossing to within half a substep; the same year however close
    the sea; half the water later and still right; nothing when not coming; nothing for a ruin, with
    flooding off, or past the ocean's reach; the warning's horizon;
  - `flood-warning.test.ts`, 3, through the real HUD: the words; the countdown on the same row; nothing
    with flooding off.
- **Injections: 16, all caught** (one only after the icy-world case):
  - the metres line;
  - the curve inverse wrong;
  - the saturation not inverted;
  - a crossed sea forecasting nothing;
  - the ceiling removed;
  - a falling sea forecast as coming;
  - total loss at the base;
  - warned only inside the margin;
  - warned however far off;
  - a ruin forecast;
  - a forecast with flooding off;
  - every settlement warned;
  - the list rebuilt every readout;
  - the warning never counting down;
  - years floored;
  - under water still called a warning.
- **Verification:** 1,079 tests in 89 files pass (203 s); typecheck, `build:web` and `build` are clean.

## Open

- **Turning flooding on in the browser is the user's call.** Everything is in place: set
  `FLOODING_ENABLED: 1` in `main.ts`. Two things follow.
  - On the reference arc, a third of the planet (everything below −3,090 m) drowns in the burst
    around year 300. That is the placement decision the feature exists to create.
  - A save made before flooding existed may already hold a city 10 m or more under the sea. It would
    be lost on the first substep after loading, with no warning. That is why this was not switched on
    unasked.
- **The forecast during the burst** is late by up to 30 years for the lowest cities, because the water
  rate accelerates. A forecast of the rate's own trend could close that gap, measured first.
- **The metropolis-opening timing test** (Batch 24's open item) is still load-sensitive.
