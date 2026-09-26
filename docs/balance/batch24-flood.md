# Batch 24: the flood model, headless

Detail §6 step 3: "Implement the flood model (section 4.2 to 4.3) headless: compute `flood_depth`,
tile flooding, state, and building loss, and assert a low test city drowns as sea level rises. This
is the highest-value feature; prove it in numbers before rendering."

## What went wrong, and what it cost

### The batch was left half-closed, and its status said it was never started

The model was built and committed (5e2e760) with its tests passing, and that commit said: "Its tests
pass but three were shown weak by injection; the fixes and the batch note are still to come." The
status table still read NOT STARTED, and no record said which three tests were weak. Closing the
batch meant finding them again from scratch: every behaviour in `flood.ts` was broken in turn (14
faults), and the offline summary was broken in four more ways.

### Six of those faults passed every test

- **A building judged by its lowest tile, not its highest, passed.** Every building in the fixture
  stood on a single tile or on the flat landing zone, so its lowest and highest ground were one
  height. The two rules could not be told apart. The new test places a 2 × 2 water extractor on the
  slope at 5,21, spanning −1.43 m to +1.37 m. It must stand, offline, while it is partly under water
  (4 substeps, measured). It must be lost only once the water stands `FLOOD_BUILDING_LOSS_M` over its
  highest tile: lost at 3.85 m, against 3.37 m.
- **"Everything is destroyed" was tested on a city with nothing left.** By the time the fixture's city
  was declared flooded, the water had taken all its buildings one by one, and it had never had people
  (no homes). Keeping its buildings, keeping its people, and recording the fall at the threshold
  rather than at the sea all passed. The new test takes the substep before the fall, puts back a
  depot on the high ground and forty people, and steps once through `advance`. Everything must go,
  and the record must be exactly the sea level that substep saw.
- **Two faults removed one of two guards that do the same job.** "A ruin read by the flood again" and
  "flooding on by default" each took out one of two layers: `settlementStep` checks, and so do
  `floodReading` and `applyFlood`. These were not weak tests; with either layer left, the behaviour
  holds. Removing both layers at once, both faults are caught.
- **In the offline summary, an old ruin reported lost again passed.** So did lost buildings leading
  over a lost settlement. The test had a fall and a building loss, but never both in one absence,
  and never a city already lost before the player left. Both cases are now tested and both faults
  caught.

### The exit gate's chunk test was not the one the gate names

The gate reads "`advance(s, 4000)` equals a thousand `advance(s, 4)` calls", and the test ran 64
substeps against sixteen 4s. That was enough to cross the low city's fall, but it is not what the
gate says. The gate's own form is now a test too: a thousand years of the import, 4,000 substeps
against a thousand 4s, exactly equal. Both cities fall inside it, the low one at substep 37 and the
high one at 470.

Nothing in the flood keeps state between calls, so a chunk-dependent flood can only come from
`advance`'s own loop. The injection that proves the test was exactly that: settlements stepped on the
first substep of each call only. Both chunk tests caught it.

## Built

- **The model** (`src/sim/micro/flood.ts`), §4.2 and §4.3:
  - `flood_depth = sea_level_m − base`, and per-tile flooding `sea_level_m > base + local_height`,
    over the ground as the rovers have levelled it.
  - The four states: dry, warning (within `FLOOD_WARN_MARGIN_M` = 20 m below the base), partial and
    flooded (at `FLOOD_THRESHOLD_M` = 10 m).
  - All derived every substep and never stored. No ocean means no flooding: on a dry planet the sea
    level is only the curve's floor.
- **Consequences, as true state** (§4.7):
  - a building with any tile under water is offline;
  - it is lost once the water stands `FLOOD_BUILDING_LOSS_M` (2 m) over its highest tile;
  - a settlement at +10 m loses everything and records the sea level it fell at;
  - a ruin stays a ruin, and its processor draws no more CO2 from the planet.
- **Off by default:** `FLOODING_ENABLED` = 0 in `tuning.ts` and the §10 table. The browser does not
  turn it on yet (see Open).
- **Saved:** `lost_at_sea_level_m`, with the v5 → v6 migration bringing every settlement forward as
  standing.
- **Offline:** crossings while away are applied by the same `advance`. The "while you were away" line
  leads with a lost settlement ("The sea rose over a settlement - lost."), or else names the buildings
  the water took.

### Changed from the plan

- **"Save schema v6"** is history: the schema is v13, and v6 is where the loss was added.
- **§4.3's "production penalties climb with depth"** is not built. Buildings are offline or lost,
  nothing in between. It was not in the batch's bullets, and a penalty curve with no measurement
  behind it would be a guess.

## Measured

- **The drowning city** (the reference world 1,200 years in, the sea at −3,091 m; the low city 15.15 m
  above it, the high one 473 m):
  - It passes warning, then partial, then flooded, from its lowest ground inward. Every wet tile is
    below every dry one, and water never recedes.
  - 997 of its 1,024 tiles are under water when it falls, at 10.17 m over its base.
  - Buildings are lost lowest first: the −11 m depot at substep 10, the landing zone at 26, the +4 m
    depot at 32.
  - The high city loses nothing until the sea reaches it, at substep 470.
- **Tests:** `flood.test.ts` 13, three of them new (the slope, the fall with something to lose, the
  gate's own chunk form); `offline.test.ts`, two more cases in the flood test.
- **Injections: 21, all caught:**
  - 14 in the model. 6 passed at first: 4 needed the new tests, and 2 had hit one of two guards;
  - those 2 guards, removed together;
  - 1 in `advance`: settlements stepped once a call;
  - 4 in the offline summary, 2 of which needed the new cases.
- **Verification:** 1,070 tests in 87 files pass (177 s); typecheck, `build:web` and `build` are clean.

## Open

- **Turn flooding on in the browser only after Batch 25.** §4.4 calls flooding "a planned-for event,
  not a gotcha": until the forecast and the warnings exist, it would drown a player's city with no
  warning.
- **Batch 23's sea-level rate is within 0.104% of `advance` away from the curve's kinks, and worse at
  them.** Offline and live play both call `advance`, so the flood itself is exact. The forecast
  (Batch 25) will extrapolate that rate, and must measure its error near a kink.
- **Production penalties with depth** (§4.3), if wanted, measured first.
- **The metropolis-opening timing test fails under load.** It measures 257 ms alone against its
  400 ms limit, but reached 468 ms once, when the full suite ran alongside typecheck and both builds.
  It passed on a rerun with nothing else running. The flood touches none of it; the test times the
  wall clock. It needs a load-proof measure, not a looser limit.
