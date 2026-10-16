# Batch 38 - Flood defences and the rising water; flooding on

Built unattended (`/next-batch auto`), one session, 2026-10-16. Detail doc §6 step 7: "Add
mitigation: dikes, terracing, evacuation, and the macro throttle-for-time link (section 4.5), plus
the rising water-plane visualization (4.6)." The spec is `BUILD_PLAN.md` §Batch 28, and GAME_PLAN
adds: turn flooding on in the browser, with a guard for old saves - "a city found already under the
sea on loading is given a grace period, warned, not lost on the first substep".

## What went wrong, and what it cost

1. **The throttle link as the plan reads it would have said nothing.** §4.4 and §4.5 put the
   throttle in the rate: slow the water and the forecast "at current rate" moves. Measured on the
   reference arc, switching every machine off leaves this substep's net liquid-water rate the same
   to three places (0.193, 0.402 and 0.500 m of water a year with or without, at years 290, 310
   and 330). The
   water comes from ice melting as the planet warms; the machines change the warming to come, not
   the melt now. So the forecast at current rate would have shown no time bought, however many
   machines were switched off.
   - **Built instead: a projection.** The planet alone is run on 100 years from now as it stands,
     and again with every machine switched off, and each warned city's total loss read off both.
   - **It is a real lever.** From year 290, the sea stands 1,190 m lower 80 years on with the
     machines off (-4,452 m against -3,263 m).
2. **A Seawall the water could take collapsed the dike.** The first probe let the wall be lost
   like any building, 2 m of water over its own ground. On ground at -0.5 m, a level-1 wall was
   taken with the sea at +5.6 m: the dike went with it, and the city fell at substep 37, exactly as
   with no wall. On high ground (+6 to +8 m) it made no difference. A wall whose worth
   depends on where it stands within the city is a trap the player cannot read. **The Seawall now
   stands until the city falls**: it is what the water is held against.
3. **Three tests passed with their rule removed** (injections 5, 19 and 25), each strengthened:
   - the wall's "stands while its ground is under water" test had the wall on high ground (+6 to
     +8 m), where the water reached it only as the city fell. The wall moved to -0.5 m ground: the
     fault now costs the city 6 substeps;
   - evacuation's "never into a threatened city" had no threatened city with room to refuse. A
     second city held by a grace is now offered and refused;
   - the throttle's "a city the sea has passed is left out" used a city already lost, which another
     rule leaves out. It now uses one still standing, held by its grace.
4. **Five of my test premises were wrong**, found when the tests first ran:
   - "walled 8 m, the city is dry" at the sea 0.97 m under its base: it is "warning" - the warning
     margin is 20 m. The test now takes the sea 3.3 m over the base: partial undefended, warning
     walled;
   - the "saved by good play" city lost its people with the wall standing. Batch 24's fixture
     makes no life support, so every city's people died within 40 years, sea or none. The scenario
     now has the decline off, so the sea is all that takes people;
   - its domes were first placed over the wall's site, so the wall was silently refused and the
     city fell. The scenario now asserts the wall's 8 m before the sea rises;
   - the grace (144 substeps at Classic) outlasted the 2 hours away the offline cap grants (130
     substeps). The offline part runs with a 20-year grace;
   - the first check of the water plane against the simulation sampled pixels, and 3 of 1,000
     tiles disagreed: two on the grid's edge, where the boundary is drawn over everything, and one
     low tile hidden behind a steep rise in front of it - a correct picture. It now reads the scene's
     water shapes back to their tiles; then one tile within the 2.5 cm the picture rounds the
     waterline to disagreed, and the band is counted as shoreline.
5. **Founding under the sea was possible.** Nothing refused a city founded where the sea already
   stood; with flooding on it would have been lost on its first substep. Found reading the founding
   code for the grace. It is refused now: "The sea covers that place."
6. **The Seawall looked like a building, then was off colour far away.** The structure generator
   put antennas, barrels and boxes along its top (2 greebles, plus 3 a level); a wall carries none
   now. Its far-away block was 3.6% off its close-up colour; measured and matched (within 0.6%).
7. **The burst outruns any wall.** A city at -6,000 m falls 17.5 years after year 290 undefended,
   and 17.75 with a full 32 m wall: one substep. While the sea climbs 80-140 m a year, metres buy
   weeks. The defences that matter there are the early ones: placement, evacuation and throttling.
8. **The first full run found two things my own runs did not.**
   - Batch 29's vehicles scene founds its metropolis at a fixed place on the terraformed planet,
     with a new world's tuning - and that place is under the planet's sea. With the sea on in new
     worlds, founding there is refused, and the whole file failed. The scene is kept on the world
     it was measured on (the sea off), as Batch 37 kept Batch 34's trade test.
   - "The example's metropolises have every structure a metropolis may build" now lacked the
     Seawall. The example's settlements stand 300 m or more above the sea, where a wall holds
     nothing back: the Seawall is left out of that test, with the reason.
9. **The warning's words said "facilities"** where the planet's panel and the manual say machines,
   with a **Switch off** button. Changed to "Switching off the planet's machines would buy ~8 yr."

## What was built

- **The Seawall** (§4.2, §4.5): a 3 x 1 building, 200 materials, any settlement, one a
  settlement. `dike_height` is derived from it, never stored: `DIKE_M_PER_LEVEL` (4 m) for each
  level of the settlement's Seawall, standing and built - a worksite holds nothing, an upgrade
  counts once its rover is home. Every flood rule reads the effective base, `base + dike`: the
  tiles under water, the four states, a building's loss, the city's fall and the forecast. §4.2
  writes the tile rule against the bare base; a dike that kept no tile dry would hold nothing back,
  so the tiles read it too. With no wall every comparison is the one Batch 24 made, to the bit.
  The wall stands until the city falls (finding 2). Locked, and off the build bar, where the sea
  floods nothing. Drawn as a concrete wall with buttresses, a hazard band and a mark a level, higher
  a level at a time (0.42 tiles at level 1, 1.26 at level 8).
- **Terracing** (§1.3, §4.5): **Raise its ground** on a selected building. A rover raises the whole
  footprint to `TERRACE_STEP_M` (2 m) over its highest corner, to the tenth of a metre, for
  `TERRACE_MATERIALS_PER_M` (4) materials a metre each tile is raised, `ROVER_WORK_YEARS_LEVEL` a
  tile at the site. Recorded as grades, as levelling is (a rover job's `area`, v20), so the flood,
  placement and drawing all follow it. The building runs meanwhile.
- **Evacuation** (§4.5, conflict 8): **Evacuate its people** in a city the sea threatens - warned as
  the HUD warns it, or held by a grace. Its people go to the nearest standing cities the sea does
  not threaten, as many as each has empty homes for, nearest first; the rest stay. The city is left
  `evacuated` (v20): no settlers, no growth, its people's decline as before. Refused for a city out
  of the sea's way (moving people is the flood's lever, not a way to fill a new city).
- **The throttle link** (§4.5): `throttleForecast`, the projection of finding 1, on a grid of
  `THROTTLE_STEP_YEARS` (0.25) over `THROTTLE_HORIZON_YEARS` (100), the planet alone (no
  settlements, decisions, Earth or guide in either run). The words: "Switching off the planet's
  machines would buy ~8 yr." The browser asks it once a sim-year of the world, or when the
  machines, the warned cities or their walls change, and never while no city is warned.
- **The water plane** (§4.6): the city view carries the waterline - behind the wall (`inner`, what
  its wet tiles are judged by) and the open sea beyond (`outer`). Each ground triangle the mesh
  draws is clipped where it lies under the plane and drawn flat at it, translucent: the shoreline
  is the plane meeting the ground, and moves inland as the plane rises. The grid's water is drawn
  at the inner level, the world beyond at the outer, so a walled city reads as a dry square held
  below the sea round it. A building in the water stands on it (its body drawn over). Water is
  kept per tile while the waterline stands, drawn to the 200th of a tile (5 cm), and a chunk's
  kept picture is redrawn when its waterline moves.
- **Flooding on in the browser**: in `NEW_WORLD_OVERRIDES`, for every Standard and Terraformed
  world made from now; a Sandbox keeps it off. A world made before keeps the tuning it recorded.
- **The guard for old saves**: save v20. A settlement carried forward from v19 or older is given
  `FLOOD_GRACE_YEARS` (36 city-years, 20 real minutes at 1x in either pace): the sea takes nothing
  of it until they are spent, counted down a substep at a time like an event's effect, and the
  warning says so ("Nothing is lost to the sea for ~5 yr." at the Standard pace, where 36
  city-years are 4.5 of the planet's). A ruin gets none.
- **No founding under the sea** where the sea floods (finding 5).
- **The browser**: **The sea** panel in a threatened city (the HUD's words, and Evacuate); Raise its
  ground in the inspector; the Seawall's card, tip ("Each level holds the sea back 4 m more: 32 m at
  level 8. It stands until the city falls.") and inspector line ("Holds the sea back 8 m - 4 m a
  level."); the grace and the throttle in the warning's words.

## Decisions

Taken unattended, each the recommendation a bare "Go" would accept:

1. **Flooding in new worlds only**, not in old ones with the grace. Batch 27 records a world's
   tuning so a later change never changes it under its player; every feature since (routes, needs,
   deposits) followed that, and the auto rules say never to take the path that loses player data.
   The grace is built and tested in the simulation - loading a v19 save under a flooding tuning,
   exactly the exit gate - and guards any path that brings an old city under the sea.
2. **The grace given to every standing city of an old save** by the v19 -> v20 migration, not only
   to those already under: no physics in a migration, and a city in an old world was never warned
   under rules where the sea took nothing.
3. **The dike as a building** (BUILD_PLAN: "a building that raises `dike_height`"), its height
   derived from the wall's level and never stored; one a settlement, so its level is its height.
4. **The dike lifts the datum for the tiles too** (above).
5. **The Seawall stands until the city falls** (finding 2).
6. **Terracing raises a building's footprint**, the one thing levelling could not do (it refuses
   ground under a building), by a fixed step over its highest corner, paid by the metre.
7. **Evacuation to the nearest safe cities with homes**; relocation (§4.5's "pay to relocate the
   city") not built (Open).
8. **The throttle as a projection with every machine off** (finding 1), not a rate.
9. **No city founded where the sea stands**, in a world that floods.
10. **"Machines"** in the words, as the planet's panel says.

## Measurements

- **The Seawall, on Batch 24's drowning fixture** (the sea climbing 0.706 m a substep): the low
  city falls at substep 37 undefended, 43, 49 and 60 with its wall at levels 1, 2 and 4 - 5.67
  substeps (1.42 sim-years) a level, the forecast's shift the same to a substep.
- **The Seawall, on the reference arc** from year 290 (the sea at -7,612 m; the machines as they
  stand; the sea settles at -3,090 m 300 years on):

  | City's base | No wall | Level 2 (8 m) | Level 4 (16 m) | Level 8 (32 m) |
  |---|---|---|---|---|
  | -6,000 m | falls at +17.5 yr | +17.5 | +17.5 | +17.75 |
  | -3,105.5 m (15 m under the final sea) | +88.75 | saved | saved | saved |
  | -3,120.2 m (30 m under) | +86.25 | +87.25 | +89.25 | saved |
  | -3,134.7 m (45 m under) | +85.25 | +85.75 | +86.5 | +90 |

- **Terracing**: the fixture's depot at -11 m, raised 2.27 m, is lost at substep 14 against 11.
- **The throttle**, from year 290, three cities, through a real `advance` with them in it:

  | City | Falls as is | Machines off | Bought | Forecast |
  |---|---|---|---|---|
  | -6,000 m | +17.5 yr | +25.25 | 7.75 | 7.75 (17.25 / 25) |
  | -5,000 m | +25.25 | +45 | 19.75 | 19.75 (25 / 44.75) |
  | -4,400 m | +38.75 | +86.75 | 48 | 48 (38.5 / 86.5) |

  The projection names the substep the sea crosses; the city falls on the next. At the Standard
  pace's eighth-year substeps the real runs give 7.84, 19.94 and 48.31 years bought: the forecast
  within 0.31 years. A projection takes 29-33 ms.
- **The grace**: a city 10 m under the sea in a v19 save stands every one of its 144 substeps at
  Classic, warned on each, and falls on the 145th; the same city with no grace falls on its first.
- **The water plane's reference frame** (`city-flood.png`, 384 x 240): unmodified 0.0000%; the
  waterline 1 cm higher 0.0000% (under the 5 cm grain); behind the wall 10 cm higher 0.0351%, the
  open sea 0.1142%; 1 m higher 0.5321%; no wall 4.0488%; no sea 9.2108%. Tolerance 0.003%.
- **The picture against the simulation**: on the drowning city 14 and 22 substeps up, every tile
  the shoreline does not cross (1,000 and 890) has water drawn exactly where the simulation says
  wet: 42 and 596 wet, 958 and 294 dry.
- **Pacing**: Batch 28's targets are unchanged with flooding in the new-world tuning (the pace
  tests pass as they were): on the reference arc the planet has no liquid water before about year
  275 - some 20 hours of Standard play at 1x, 2.5 hours at Classic.

## Verified by injection

47 faults, one at a time, each file restored from a copy and checked after each:
- 44 caught at once;
- 3 missed at first and caught once their test was strengthened (5, 19, 25; finding 3).

| # | Broken on purpose | Caught by |
|---|---|---|
| 1 | the dike always 0 | the wall's fall times, its dry tiles, its forecast, the worksite test (5 tests) |
| 2 | a worksite counts as a wall | the worksite test |
| 3 | the wet tiles ignore the dike | the dry-tiles test |
| 4 | a building's loss ignores the dike | "saved by good play": its people 0 against 80 |
| 5 | the wall taken by the water over its ground | missed (the wall on high ground); with it on -0.5 m, 4 tests: level 1 bought 0 substeps |
| 6 | no grace in the flood's consequences | the grace exit-gate tests |
| 7 | the grace never counts down | "falls after its grace" |
| 8 | the migration gives no grace | the grace tests |
| 9 | a terrace raises its corner tile only | the 3 x 3 footprint test |
| 10 | a terrace without its step | the plan test |
| 11 | an evacuated city takes settlers again | "leaves the city to the sea" |
| 12 | evacuate a city out of the sea's way | the refusal test |
| 13 | evacuation ignores the homes free | the half-room test |
| 14 | a city founded under the sea | the founding test |
| 15 | the forecast ignores the wall | the forecast-shift test |
| 16 | the grace not saved | "a save made since keeps what it had" |
| 17 | evacuated not read from a save | "keeps an evacuated city evacuated" |
| 18 | a second Seawall allowed | "one a city" |
| 19 | evacuation into a threatened city | missed (no such city offered); a held city with room now refused |
| 20 | a terrace charges nothing | the plan test |
| 21 | the throttled run keeps the machines on | "forecasts it": 8 against 0.25 |
| 22 | the loss read at the base, not 10 m over it | "forecasts it" |
| 23 | the throttle ignores the wall | the walled-city test |
| 24 | a projection with nothing to throttle | "says nothing": 3 against 0 |
| 25 | a city the sea has passed kept | missed (a lost city used); a held one now |
| 26 | no water over the grid | the frame (1.3%) and the tile-by-tile test (42 tiles) |
| 27 | the grid's water at the open sea's level | the frame: 3.4% |
| 28 | the triangles clipped above the plane | the frame and the tile-by-tile test |
| 29 | the view's plane ignores the wall | the view test: 0.8 tiles off |
| 30 | the waterline out of the chunk signature | the redraw test |
| 31 | the world beyond at the inner level | the frame: 4.0% |
| 32 | no water under a building in it | the building-in-water test |
| 33 | water kept across waterlines | the frame's 10 cm test, the tile-by-tile test (530 tiles) |
| 34 | the game asks no throttle forecast | both assembled-game tests |
| 35 | the sea's panel never shown | the panel tests |
| 36 | Evacuate never offered | the panel tests |
| 37 | the game never lets a city be evacuated | the assembled-game evacuation |
| 38 | Raise its ground never offered | the inspector test |
| 39 | the terrace's price misread | the inspector test |
| 40 | the Seawall's card where the sea floods nothing | the card test |
| 41 | the Seawall's tip says +10% a level | the card test |
| 42 | flooding left off in new worlds | the worlds test |
| 43 | the grace left out of the words | the words test |
| 44 | the time bought the wrong way round | the words tests and both assembled-game tests |
| 45 | the inspector silent on the Seawall | the inspector test |
| 46 | the projection asked for every city | "asks for the warned cities only" |
| 47 | the evacuation's words lose where the people went | the assembled-game evacuation |

## Verification

- **typecheck**: green.
- **build**: green.
- **build:web**: green, 682.79 kB JS (231.21 kB gzip), 52.54 kB CSS. Past Vite's 500 kB warning, as
  recorded since Batch 31.
- **The built page over HTTP**: the page, its script and its styles served and fetched (all 200);
  the script holds "Seawall", "Raise its ground", "Evacuate its people", "Switching off the
  planet's machines" and "The sea covers that place", the styles `.city-flood`.
- **The full suite** (`npx vitest run --maxWorkers=2 --minWorkers=1`): 129 files, 1,555 tests, all
  passed (650 s). The Known-red opening test passed this run.
  - The first full run had two failures (finding 8): the vehicles scene's file (its metropolis
    refused under the sea) and the example's metropolises without a Seawall. Both fixed; the second
    run is the one reported.
- **Gates with flooding off by default**: the golden run, the planet's golden frames, the city's
  reference and terrain frames and the Batch 3 score are in the suite as they were. The structures
  sheet was re-rendered deliberately, with the Seawall added, and looked at.
  `src/sim/micro/defences.test.ts` holds the grace chunk-independent and offline-exact.
- **Looked at**: the Seawall at levels 1, 4 and 8, the structures sheet, the reference city with the
  sea in it (whole and up close) and walled, rendered by the software rasteriser to PNG and read.

## Open

- **Old worlds cannot turn the sea on.** A world made before this batch keeps the tuning it
  recorded: no flooding, no Seawall. An opt-in in the world's settings, with the grace already
  built, would give them the feature; it is a menu writing a world's tuning, so it is a decision
  for the user.
- **Relocation** (§4.5's "pay to relocate the city") is not built: a city cannot be moved, only its
  people.
- **An evacuated city cannot be resettled**, even if the sea stops short of it.
- **A building in the water is drawn standing on it**, not partly under it; the open sea beyond a
  walled city's land is drawn over the near edge of its ground, where a wall's face is not drawn;
  rocks under the water in the world beyond the grid are tinted with it.
- **The forecast "at current rate" is still late in the burst** (Batch 25's open item). The
  throttle's projection gives the accelerated year; the warning's main words could use it.
- **Production penalties with depth** (§4.3) are still not built (recorded for later since
  Batch 24).
- **Terracing raises the edge of the ground beside a footprint** (shared corners), which can leave
  a neighbour too steep, as levelling can (a known issue since the levelling pass).
- **Nothing was looked at in a browser.** The water and the wall were rendered by the software
  rasteriser and looked at as PNG; the panels were checked in happy-dom. Batch 40's playtest.
