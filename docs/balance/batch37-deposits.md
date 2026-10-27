# Batch 37 - Terrain resource deposits

Built unattended (`/next-batch auto`), one session, 2026-10-16. Detail doc §6 step 6: "Add terrain
resource deposits (section 3.1) and siting bonuses." The spec is `BUILD_PLAN.md` §Batch 27, and
Batch 28's pacing targets are re-measured with deposits on.

## What went wrong, and what it cost

1. **Chasing deposits starves a city.** The first scripted player that "reads the terrain" put
   every mine, extractor, geothermal plant and solar array on the nearest square wholly on its
   deposit, however far away. Its first three solar arrays went up to 30 tiles out. The corridor
   and cable to each cost a material a tile, so the founding stock was gone by the 17th minute.
   The far buildings never joined the network and never ran, water ran short, and the people fell
   from 46 to 4. It **never reached a city of 1,000 in four hours**, where the plain script took
   2.1 hours. The script was given a reach: it goes at most N tiles further than its nearest
   place for a deposit. Measured at N = 2, 4, 8 and 16:
   - up to 8 tiles, the city of 1,000 stays within a tenth of the spiral's, either way;
   - at 16 tiles at the Standard pace, it comes at 3.76 h against 2.11 h, and the first upgrade
     at 2 hours.

   This is a property of the game, not of the script: a deposit's bonus is paid back only if the
   building can be reached and connected. The manual says to take the deposits near the city.
2. **The first thresholds were guesses, and wrong by a factor of five.**
   - At `ORE_RISE_M` and `ICE_DIP_M` of 1.5 m, picked before any measurement, 30% of the ground
     was ore and 33% ice, and there was no sun at all: ore took every flat hilltop first.
   - Measured (rise above the ring: 90th percentile 4.3 m, 95th 6.6 m), they are now 6 m and 7 m,
     with `SUN_HIGH_M` at 3 m.
   - Result: ore 5.8% of tiles, ice 7.5%, vents 2.7%, sun 1.5%. Every one of 100 city sites has
     a buildable 2 x 2 wholly on each kind.
3. **Batch 34's measured claim no longer held with deposits on.** "A player who trades has the
   city of 1,000 sooner" failed: the trader came 83 s later (7,650 s against 7,567 s).
   - **The cause is the scripted player, not trade.** Its spiral is chaotic: one water extractor
     lands on ice at 4,800 s, and every placement after it changes. The same deposits brought the
     city of 1,000 200 s sooner to the player who does not trade (7,767 s to 7,567 s), and 267 s
     later to the trader (7,383 s to 7,650 s).
   - **What changed in the test.** Batch 34's test now runs on the world it measured (deposits
     off), unchanged. A second test holds the game as it now ships: a trader still has Phase 2
     20.7 minutes sooner (4,708 s against 5,950 s), and the city of 1,000 within 2% (measured
     1.1%).
4. **Batch 30's measured reward moved, and I missed it at first.** "Two rovers: the city of 1,000
   8.3 minutes sooner" (more than 7) failed with deposits on: 5.1 minutes. It failed in the first
   run of the world tests too, but I read that log for the two failures I expected and missed it,
   and the full suite found it.
   - **The other four rewards are worth what they were**, to the tenth of a minute (56.7, 3.2,
     13.1 and 20.7 minutes).
   - **The cause is the same chaos as finding 3.** The deposits made the rewarded run 2.5 minutes
     slower (102.5 against 100.0) and the run without it 0.7 minutes faster.
   - **What changed in the test.** Batch 30's check now runs on the world it measured (deposits
     off), still more than 7 minutes. A check beside it holds the shipped world: more than 4
     minutes, measured 5.1.
5. **A Terraformed start's first step took ten times as long.** With deposits on, four substeps
   of the example planet took 6.2 s against 0.7 s.
   - **The cause:** working out what each of its 83,589 mines, extractors, geothermal plants and
     solar arrays stands on, one tile at a time, at 16 terrain samples a tile (5.3 million
     samples).
   - **The fix:** a city's tiles are now worked out together, sharing their corners' heights in
     one array, and kept a byte a tile per frame. That brings it to 1.9 s against 0.6 s.
   - **What is left:** 1.3 s, once, when a Terraformed world is opened. It is under Open, for
     Batch 40's performance budget (a world opening in under 3 s).
6. **The whole-frame map cost more than the ground it is read from.** A metropolis's (288 tiles)
   took 120 ms, against the ground's 90 ms. The corners were read through a closure, and those
   past the frame's edge through a Map. Read from one padded array instead, it takes 52 ms. It is
   also made a band of rows at a time while a city opens (`prepareDeposits`, inside
   `prepareCity`), so it never freezes a frame.
7. **The first look at the marks found two faults** (rendered to PNG and read):
   - **The ore's "diamond" drew as a flat bar.** A square turned 45 degrees on the ground is
     square to the screen in the isometric view. It is now square to the tiles, so it reads as a
     diamond, as a tile does.
   - **Marks were drawn over the buildings standing on them.** A vent's rings covered its
     geothermal plant. A building's own tiles now carry no mark; its panel says what is under it.
     Both are tested, and both injections are caught (31, 32).
8. **The injection run found six tests weaker than they looked**, each strengthened:
   - The siting was kept per building list whatever the tuning (15). A balance sweep runs
     variants on the same state, so a variant with no ore would have been paid for the first
     tuning's ore. A test now runs the same city under a tuning where no ore is found.
   - The first chunk-independence injection disabled the bonus "after the first substep of a
     length" (14), not per call. Other tests caught it, but the chunk test did not, because it was
     not a per-call fault. The real per-call fault (a flag set in `advance`) is caught by the chunk
     test.
   - The view's factor without its share (28): tested only on a whole share, where the two agree.
     The half-on test now places the mine and reads its view and its panel: x1.5.
   - The siting's codes in local tiles instead of site tiles (34), and kept across a claim that
     moves the frame (35): the agreement test's city had no claims, so local was site. It now
     claims west and north, and asks before and after the claim: 521 and 548 mines differ.
   - The deposits read from the levelled ground instead of the natural one (38): the manual says
     levelling keeps a deposit, but the test's map was already made and kept for its place. It now
     levels 40 ore tiles at a place nothing has asked about, then makes the view: all 40 were lost
     with the fault.
9. **Two faults change nothing a test can see**, recorded as such:
   - The map's ring summed in reverse order (29): the sums differ in the last bit, and no tile of
     the tested sites lies that close to a threshold.
   - A one-to-one shift of the batch's corner memo (33): every corner still has its own slot.

   Keeping a whole row in one slot (33') is caught.

## What was built

- **`src/sim/micro/deposits.ts`.** Four deposits, derived from the site's natural terrain at site
  coordinates and never stored. A tile is judged against a ring of twelve corners,
  `DEPOSIT_RING_TILES` (5) round its centre:
  - **ore** where the tile stands `ORE_RISE_M` (6 m) above the ring's mean: ridges, hilltops,
    crater rims;
  - **ice** where it lies `ICE_DIP_M` (7 m) x cos(latitude) below it: basins, crater bowls,
    canyon floors, and shallower hollows poleward;
  - **a vent** within `VENT_FAULT_WIDTH` of the 0.5 contour of the canyons' own course field (the
    site's fault line, `faultCourse` in `terrain.ts`), on the stretches a slow noise picks
    (`VENT_STRETCH_MIN`);
  - **sun** on flat ground (slope at most `SUN_FLAT_SLOPE`, 0.08) `SUN_HIGH_M` (3 m) above the
    base, with no ring corner above it.

  One a tile, in that order: vent, ore, ice, sun.
- **The bonus, through efficiency.** In `settlementStep`, a building's output is multiplied by
  1 + bonus x share. The share is the part of its footprint on its own deposit. The bonuses are
  `ORE_BONUS` 1, `ICE_BONUS` 1 (faded by water access: section 3.2's "no longer need a deposit"),
  `VENT_BONUS` 1 and `SUN_BONUS` 0.5. Bare ground keeps today's output.
- **Behind `DEPOSITS_ENABLED`** (0 by default), on in `NEW_WORLD_OVERRIDES` only. Old worlds keep
  playing as they did, and the golden run, golden frames and Batch 3 score are where they were.
- **The view.** `CityView.deposits` holds a code a tile, and `CityBuildingView.deposit` the kind,
  share and factor. The renderer marks each kind by its own shape and colour: ore a copper
  diamond, ice a pale blue disc, a vent a red ring, sun a yellow cross. It derives the kind's
  type from the view (the wall: only the view crosses), and draws no mark under a building.
- **The city screen.** Choosing a mine, an extractor, a geothermal plant or a solar array marks
  its own deposit while it is placed. A **Deposits** card among the tools marks all four. Each
  card's tip says what its deposit gives. The hint under the pointer names the deposit there and
  says what the building would make: "On ore vein, all 4 of its tiles: it would make x2
  materials." A tile on a deposit can be clicked to see what it is and what it gives. A
  building's panel says "On ore vein (all of it): x2 output."
- **The scripted player's `siting`**: how many tiles further it will go for a place wholly on a
  deposit.

## Decisions

1. **Its own switch, not `SETTLEMENTS_ENABLED`** (conflict 9 said the latter). Settlements are on
   in every browser world, so the old worlds' mines would have changed under them.
2. **A bonus only**: bare ground keeps today's output, so the bootstrap cannot get slower.
3. **By the share of the footprint**, so a building half on a vein makes half the bonus.
4. **Site coordinates, the natural ground**: a claim never moves a deposit, and levelling a tile
   does not remove the ore under it.
5. **The ice's bonus fades with water access** (§3.2, §3.3: deposits matter less as the planet
   supplies water).
6. **No depletion**, so nothing is stored and the save does not change.
7. **"Unshadowed" is read as nothing near standing over it.** The city view has no sun
   direction, and the spec's "high flats" needs none to be useful.
8. **The marks are an overlay, never the ground's own colour.** They show while a boosted
   building is being placed, or with the Deposits card on. The golden frames, the chunk pictures
   and their caches are untouched.
9. **No keyboard shortcut**: Batch 36's 21 rebindable actions are left as they are; the card is
   one click.
10. **The scripted player sites within a reach**, after the unbounded version starved its city
    (finding 1).
11. **Batch 34's trade test and Batch 30's rover reward are measured on the worlds they were
    measured on**, each with a deposits-on check beside it (findings 3 and 4).

## Measurements

**Deposit shares**, 100 random city sites (`|lat| <= 1.2`) on the browser's ground (12 m relief,
96-tile founding square):

| Kind | Share of tiles | Buildable (not steep) | Sites with a whole 2 x 2 buildable | Nearest such square from the middle (median, 10%-90%) |
|---|---|---|---|---|
| Ore | 5.82% | 49% | 100 of 100 | 17.3 tiles (11.2-28.2) |
| Ice | 7.45% | 57% | 100 of 100 | 15.8 tiles (10.0-25.6) |
| Vent | 2.69% | 88% | 100 of 100 | 11.2 tiles (5.0-25.5) |
| Sun | 1.50% | 100% | 100 of 100 | 14.8 tiles (11.2-22.8) |

**Outposts** (48 tiles), 100 sites: ore 3.9%, ice 5.6%, vents 2.5%, sun 1.3%. A buildable 2 x 2
wholly on each kind is found at 83, 91, 97 and 87 of the 100.

**By latitude** (eight cities each):

| Latitude | Ice | Mean height on ice | Ore | Mean height on ore | Ground mean |
|---|---|---|---|---|---|
| 0 | 3.9% | -15.2 m | 5.1% | 17.5 m | 0.2 m |
| 0.6 rad | 8.5% | -4.8 m | 7.7% | 26.5 m | 2.6 m |
| 1.1 rad | 14.6% | -5.8 m | 4.9% | 19.2 m | 0.6 m |
| -1.1 rad | 18.0% | 1.4 m | 7.3% | 40.7 m | 4.8 m |

- 99.5-99.7% of vent tiles have another vent beside them (scattered at the same share, about 20%
  would).
- No tile within five tiles of a sun tile stands higher on average.

**The bonus through a real `advance`** (one substep, stores full of what each draws):

| Building | Wholly on its deposit, against bare ground |
|---|---|
| Regolith Mine on ore | x2 (exact to 1e-9) |
| Water Extractor on ice | x2 on a dry planet |
| Water Extractor on ice, water access 0.487 | x1.513 |
| Geothermal Plant on a vent | x2 |
| Solar Array on sun | x1.5 |
| Mine with half its tiles on ore | x1.5 |

**Batch 18's bootstrap, re-measured** on the browser's ground, the same squares both ways. Each
boosted building goes on the nearest square wholly on its deposit:

| | Years each of the 13 buildings was placed | People at year 150 |
|---|---|---|
| Deposits off | 0, 0, 0, 0, 0, 7, 15, 22, 29, 30, 38, 42, 48 (Batch 18's, to the year) | 80.00 |
| Deposits on | 0, 0, 0, 0, 0, 7, 15, 19, 24, 25, 29, 32, 35 | 80.00 |

- The first seven are bought with the founding stock.
- After them, the mine on ore and the second geothermal plant on a vent pay for the rest sooner:
  the build-out is done 13 years sooner.
- The city is supported every year both ways, and full both ways.

**Batch 28's pacing targets, re-measured** (the scripted player, 4 hours at 1x):

| Pace, events | Deposits | First building | First upgrade | City of 1,000 | Phase 1 | Phase 2 |
|---|---|---|---|---|---|---|
| Standard, on | off (Batch 36) | 33 s | 21.5 min | 2.03 h | 8 s | 99.2 min |
| Standard, on | on, spiral | 33 s | 21.5 min | 2.11 h | 8 s | 99.2 min |
| Standard, on | sited, reach 8 | 33 s | 21.9 min | 2.17 h | 8 s | 99.2 min |
| Standard, on | sited, reach 16 | 42 s | 2.00 h | 3.76 h | 8 s | 99.2 min |
| Standard, off | off | 33 s | 21.5 min | 2.16 h | 8 s | 99.2 min |
| Standard, off | on, spiral | 33 s | 21.5 min | 2.10 h | 8 s | 99.2 min |
| Standard, off | sited, reach 2 | 33 s | 21.5 min | 2.06 h | 8 s | 99.2 min |
| Standard, off | sited, reach 8 | 33 s | 21.9 min | 2.00 h | 8 s | 99.2 min |
| Standard, off | sited, reach 16 | 42 s | not within 4 h | not within 4 h | 8 s | 99.2 min |
| Classic, on | off | 8 s | 19.9 min | 1.82 h | 8 s | 12.4 min |
| Classic, on | on, spiral | 8 s | 19.9 min | 1.80 h | 8 s | 12.4 min |
| Classic, on | sited, reach 8 | 8 s | 22.8 min | 1.80 h | 8 s | 12.4 min |
| Classic, off | off | 8 s | 19.9 min | 1.74 h | 8 s | 12.4 min |
| Classic, off | sited, reach 2 | 8 s | 19.9 min | 1.67 h | 8 s | 12.4 min |

Read across:
- **The spiral player puts only 2 or 3 of its 50-66 boosted buildings on a deposit, by chance.**
  Deposits move its city of 1,000 by 4% or less, and leave the first building, the first upgrade
  and the phases where they were. The scripted city of 1,000 waits on its people's growth and its
  builds, not on what it makes.
- **Siting within 2 to 8 tiles moves it by up to a tenth either way.** The gain is given back to
  longer drives and to the corridor and cable each far building needs.
- **The first upgrade's target (4-8 min) is still missed**, as Batches 28 and 30 recorded. Deposits
  change nothing about an upgrade's worth.

**What deposits cost to work out:**

| Work | Time |
|---|---|
| A 96-tile city's map | 11 ms |
| A metropolis's map (288 tiles) | 52 ms (was 120 ms) |
| A metropolis's map with claims (416 tiles) | 62 ms |
| A metropolis's ground, for comparison | 90 ms |
| The Terraformed start, made | 32.6 s, against 32.0 s off |
| The Terraformed start's first four substeps | 1.9 s, against 0.63 s off (was 6.2 s) |

## Verified by injection

39 faults, one at a time, each file restored from a copy and checked byte for byte after each:
- 32 caught at once;
- 5 missed at first and caught once their test was strengthened (15, 28, 34, 35, 38);
- 2 change nothing a test can see (29, and 33's first form; its second form is caught).

One injection run left a fault in the tree: the runner restored two edits to the same file in the
wrong order, putting fault 38 back. `git diff` after the run showed the one changed line; the file
was restored from the commit and the runner fixed before any other work.

| # | Broken on purpose | Caught by |
|---|---|---|
| 1 | the bonus never applied in the step | the four "wholly on" tests, the share test and the ice fade (6 of 18) |
| 2 | any share counts as the whole footprint | the share test: 2 against 1.5 |
| 3 | any deposit boosts any of the four (and re-run on the batched siting) | "boosts only its own building": 9 against 6; the siting-against-map test |
| 4 | the ice's bonus never fades | the ice fade: 2 against 1.513 |
| 5 | `DEPOSITS_ENABLED` ignored by the siting | "with deposits off": 10 against 5 |
| 6 | the map judged in local tiles, not site tiles (and re-run on the banded map) | the claims test: 464 tiles moved |
| 7 | the map's corners past the frame read as level (and re-run) | the map-against-terrain test (197 tiles), the claims test |
| 8 | ore and ice swapped | the high-and-low test: ore at -12.8 m |
| 9 | ice the same at every latitude | the poleward test: 4.0% against the 7.7% needed |
| 10 | vents scattered, not on the fault | the lines test: 75.5% against 95%; the vent factor test |
| 11 | sun with no check for ground above it | the sun test: the ground round it at 45.3 m against the tile's 41.2 m |
| 12 | sun on any slope | the sun test: slope 0.236 |
| 13 | sun on low ground | the sun test: -1.33 m |
| 14 | the bonus on the first substep of each `advance` call only | the chunk test (a first version of this fault was not per-call; see above) |
| 15 | the siting kept for a building list whatever the tuning | missed; the variant-tuning test added: 2 against 1 |
| 16 | the deposits never passed to the drawing | "choosing a mine marks the ore", the Deposits card test: 0 against 56 |
| 17 | placing a mine marks every kind | "only the ore": 2 ice marks |
| 18 | the hint's factor ignores the share | the half-on hint test |
| 19 | the hint judges a footprint a tile off | both hint tests |
| 20 | the ice's mark a diamond, like the ore's | the cue register: 3 shapes for 4 kinds |
| 21 | the vent's ring filled in | the cue register: 1 outline against 2 |
| 22 | a deposit tile not selectable | the ground panel test |
| 23 | a rover offered for a deposit with no rock | the ground panel test |
| 24 | the tip's factor the bonus, not 1 + bonus | the tip test (sun x0.5) |
| 25 | the Deposits card in a world without deposits | the off test |
| 26 | the renderer's codes in another order | the order test, the marks tests |
| 27 | the view's deposits left out | five of eight |
| 28 | the view's factor without its share | missed; the half-on test now places the mine: factor 2 against 1.5 |
| 29 | the map's ring summed in reverse order | not caught: the sums differ in the last bit only |
| 30 | the ore boosts a storage depot, not the mine | five, the bootstrap among them |
| 31 | marks drawn over the buildings standing on them | the hint test: 56 marks against 52 |
| 32 | the ore's diamond drawn as a disc | the cue register |
| 33 | the batch's corner memo shifted a column / kept a row to one slot | the shift not caught (one-to-one); the row: the siting-against-map test, 402 differ |
| 34 | the siting's codes in local tiles | missed by the unclaimed city; the claimed one: 521 differ |
| 35 | the siting's codes kept across a claim | missed; asked before and after the claim: 548 differ |
| 36 | new worlds without deposits | the pace test's switches, the deposits pace test (vacuity: 7,325 s both ways), the siting test |
| 37 | the scripted player never sites | the siting pace test: the far player no longer an hour later |
| 39 | the town's reward gives no rovers | the reward test: 0 against more than 7 minutes |
| 38 | the map read from the levelled ground, not the natural | missed: the place's map was already made and kept; the test now makes a fresh place's map with 40 ore tiles levelled first: all 40 lost |

## Verification

- **typecheck**: green.
- **build**: green.
- **build:web**: green, 667.63 kB JS (226.18 kB gzip), 52.19 kB CSS. Past Vite's 500 kB warning, as
  recorded since Batch 31.
- **The built page over HTTP**: the page, its script and its styles were served and fetched (all
  200), and the script holds the deposits' words.
- **The full suite** (`npx vitest run --maxWorkers=2 --minWorkers=1`): 125 files, 1,510 tests, all
  passed (435 s). The Known-red opening test passed this run.
  - The first full run had one failure, Batch 30's rover reward (finding 4). It is fixed, and the
    second run is the one reported.
- **Gates with deposits off by default:** the golden run, the golden frames, the city's and the
  structures' reference frames, and the Batch 3 score are in the suite as they were.
  `src/sim/micro/deposits.test.ts` holds chunk-independence with deposits on.
- **The marks, looked at**: rendered by the software rasteriser to PNG (a 48-tile city with every
  kind, whole and up close), and read.

## Open

- **A Terraformed start's first step after opening is 1.3 s slower** (1.9 s against 0.6 s for
  four substeps, measured in Node). Its 83,589 boosted buildings' deposits are worked out on the
  first step. For Batch 40's budget (a world opening in under 3 s). Working them out a city at a
  time, between frames, or from the ground where it is already made, are the ways.
- **Half the ore and 43% of the ice lie on ground too steep to build on.** Levelling a tile makes
  it buildable and keeps its deposit. Whether that is a puzzle or a nuisance is for Batch 40's
  playtest.
- **Nothing was looked at in a browser.** The marks were rendered by the software rasteriser and
  looked at as PNG files. The city screen was checked in happy-dom. Batch 40's playtest.
- **The guide does not teach deposits**, and no objective asks for one. A step "build a mine on
  ore" would make the first hour's choices richer; it is for the first hour's owner (Batch 30's
  open items) to weigh.
- **Outposts' deposits are fewer**: the founding site's level ground fills more of a 48-tile
  square, which is Batch 22's open item (the ease does not scale with the grid).
- **The world map and the founding prompt do not show deposits.** A site's deposits are seen once
  it is founded.
