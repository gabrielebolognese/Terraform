# Progress

Where the build stands, for `scripts/run-batches.sh` and each unattended session. The fields at the
top are read by the script; keep them one per line, `name: value`. The status table in
`GAME_PLAN.md` stays the source of truth for what each batch is; this file is the run's state.

last_completed_batch: 37
in_progress_batch: none
final_batch: 40
skipped_batches: none
needs_human: none

## Known red

Failures already recorded in a balance note. They do not block a batch; a new failure does.

- `src/web/city-open.test.ts`, the metropolis timing test: 440-505 ms against its 400 ms limit on
  this machine, failing on the commit before Batch 28 as well. Batch 26's finding, assigned to
  Batch 40 ([note](balance/batch28-build-times.md)).
- The full `npx vitest run` can be killed for low memory on this machine. If it is, run it again
  with fewer workers rather than skipping it: `npx vitest run --maxWorkers=2 --minWorkers=1` (with
  `--maxWorkers=2` alone this vitest refuses to start: "minThreads and maxThreads must not
  conflict").
- The city-open timing test passed in Batch 29's full run (under load from another project); it is
  still recorded as red.
- Batch 34's full run: the city-open timing test failed at 513 ms against 400 (the only failure);
  no code it runs changed in Batch 34.

## Batches

### Batch 26 - Procedural structures (finish)
- status: complete
- note: docs/balance/batch26-structures.md
- review: accepted (by the user, before the unattended runner)

### Batch 27 - The front door: title screen and worlds
- status: complete
- note: docs/balance/batch27-worlds.md
- review: accepted (by the user, before the unattended runner)

### Batch 28 - Time that means something: real build and upgrade times
- status: complete
- note: docs/balance/batch28-build-times.md
- commits: 964c218, 3b0d532, f716cf8
- review: accepted (by the user, before the unattended runner)

### Batch 29 - Vehicles that use the city: rovers on the ground, trains on the line
- status: complete
- note: docs/balance/batch29-vehicles.md
- manual: docs/manual/update-notes.md (Update 29, known issues), docs/manual/cities.md (building,
  how rovers drive, trains), docs/manual/getting-started.md (leave a way for rovers),
  docs/manual/buildings.md (the drive in the build times), docs/manual/README.md (contents)
- commits: 0fd25dd (started), c04c6aa, 4792b6b, ae8a3e3, bc577b7, and the completing commit
- sessions: 2. The first built the batch and was cut off after c04c6aa with the rail bend, a test
  and the note uncommitted and 23 scratch scripts in src/harness (moved to the temp directory). The
  second ran the injections, fixed the depth defect they found, and wrote the manual.
- decisions:
  - Rovers on corridors and open ground, corridors first (2x quicker): corridors only would leave
    a new headquarters' rovers nowhere to go.
  - Routes do not change old saves' trip times: ROVER_ROUTES_ENABLED is on in every new world and
    off in the worlds before; a job under way keeps its time.
  - (Corrected by review 1.) The steep-ground fault was first left as an equivalent mutant, on the
    claim that every steep tile carries a crag (0 of 15 rough sites without one). That was wrong:
    levelling makes steep tiles with no crag. It is now tested, and the injection is caught.
  - The redraw over a vehicle clipped to its outlines, not its box: the box blended a dome's glass
    twice (786 px), worse than no redraw (104 px); about 1 ms more shape generation at medium.
- verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 102 files, 1,196
  tests, all passed (374 s); build:web green (471.7 kB JS, 162.1 kB gzip); build green; the built
  page served and its bundle fetched over HTTP
- injections: 48, one at a time (41 in the batch, 7 more in review 1's round); 46 caught, 2 change
  no behaviour (the v15 version stamp, the clip box now that outlines decide). Steep ground, first
  counted as changing nothing, is caught since review 1.
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch29-vehicles.md
  docs/design/macro-world.md docs/manual/README.md docs/manual/buildings.md docs/manual/cities.md
  docs/manual/getting-started.md docs/manual/update-notes.md src/harness/metropolis.ts
  src/harness/pacing.ts src/harness/vehicles.ts src/render/city-chunks.test.ts
  src/render/city-trains.test.ts src/render/city.ts src/render/raster.ts
  src/render/vehicles.test.ts src/render/vehicles.ts src/sim/index.ts
  src/sim/micro/drive.test.ts src/sim/micro/drive.ts src/sim/micro/rocks.ts
  src/sim/micro/settlement.ts src/sim/micro/view.ts src/sim/planets/mars.ts src/sim/save.ts
  src/sim/tuning.ts src/sim/types.ts src/web/build-time.ts src/web/city-chunks.ts src/web/city.ts
  src/web/fill-shapes.test.ts src/web/game-tuning.ts src/web/game.ts src/web/pace.test.ts
  src/web/worlds.test.ts
- review 1: rejected
  1. The rule against driving up steep ground has no test, and the reason given for that is
     wrong. `src/sim/micro/drive.ts:116` (`ground.steep[i] !== true`) is not an equivalent
     mutant. `siteGround` re-judges the neighbours of a levelled tile
     (`src/sim/micro/rocks.ts:55-61`), and those neighbours can turn steep, but crags are laid
     only from the natural ground's steepness (`rocks.ts:138`). So levelling makes steep tiles
     with no crag on them. Measured on drive.test.ts's ROUGH ground (city at 0.31, -1.2):
     levelling 60 tiles there made crag-free steep tiles. With the steep check removed, 445 of
     1,344 routes to tiles beside them drove over steep ground; as committed, 0. Needed: a test
     that levels a tile so that a neighbour turns steep, then asserts no route crosses it, with
     the injection recorded. Also correct the claim where it appears:
     `docs/balance/batch29-vehicles.md:178-181` and `:292` (injection table), the `:286` total,
     and this entry's `decisions:` and `injections:` lines.
  2. Several new tests have no injection in the note's table, so nothing shows they were ever
     broken by a fault:
     - `src/sim/micro/drive.test.ts:223` (the same route every time, and on a copy)
     - `src/sim/micro/drive.test.ts:424` (chunk-independent)
     - `src/render/vehicles.test.ts:131` (two rovers on one stretch kept apart, scripted day)
     - `src/render/vehicles.test.ts:189` (metropolis: no rover inside a building)
     - `src/render/vehicles.test.ts:151` and `:207` (no train car inside a building or off its
       rails)
     - `src/render/city-chunks.test.ts:63` (the whole scene and nothing else, with what covers
       the vehicles drawn again; three qualities)

     Spot-checked in this review: TRAIN_LANE 0.22 -> 0.45 does fail both train tests (`:151`,
     `:207`), so those two work and only their record is missing. Break each of the others once,
     and add every one to the table.
  3. Minor: in `GAME_PLAN.md:314-331` all five Batch 29 deliverables are still `- [ ]`, though the
     batch is marked COMPLETE. Batches 27 and 28 tick theirs. Tick the ones that were built.

  Checked and sound:
  - Typecheck, `build:web` (471.7 kB) and `build` are green.
  - Full suite: 1,195 of 1,196 pass. The one failure is the Known-red metropolis opening test
    (2.6 s, with this review's scratch scripts running alongside it).
  - Two injections from the note's table were caught by the tests it names:
    - the corridor no quicker: "sets the trip" and "takes the corridors first";
    - the dwell cut to 1 s: the station test, 0.95 s against 3.9.
  - The tree was clean after each injection.
  - The save goes to v15, with a migration and a test loading a v14 save.
  - Routes are behind ROVER_ROUTES_ENABLED: 0 by default, 1 only for new worlds. The constant
    is in tuning.ts and §10.
  - `src/sim/` imports nothing from `src/web/` or `src/render/`.
  - 240 settlements founded on new-world tuning: no garage door starts blocked.
  - Three statements in the manual match the code: half a second a tile at 1x, a 4 s stand at
    a platform, white maglevs and orange freight.
  - No decision deletes or overwrites player data.
- fix 1: done
  1. Steep ground: a test levels a row of seven tiles south of the garage, a rover at a time. That
     leaves 14 steep tiles with no crag, and it checks the 164 ways to the tiles round them. With
     the steep check removed, 97 of the 164 drove up steep ground; as committed, none. The wrong
     claim is corrected in the note (what went wrong, the injection table and total), in GAME_PLAN
     and in this entry's decisions and injections.
  2. Every listed test broken once, one fault at a time, the tree checked clean after each. Three
     could not see their fault and were strengthened:
     - the same route every time: missed random ties; now 81 sites, flat and rough, asked in both
       orders and on a copy (7 and 3 routes differ);
     - two rovers kept apart: missed the wait removed (no two follow each other on the scripted
       day); now the metropolis too (23 touching);
     - the chunked drawing as the whole scene: missed everything redrawn (1% bound); now the
       measured count plus a quarter (1,885 against 1,128).
     Caught as they were: chunk-independent (the queue sent once a call), metropolis rovers (lane
     0.3 out; stopping 0.6 into the site), both train tests (tracks 0.45 out, as off the rails),
     and the chunked drawing's vacuity check and missing shapes. One fault no test caught (rovers
     down the middle of the way) has a new test. 48 faults in all: 46 caught, 2 change no
     behaviour.
  3. GAME_PLAN's five Batch 29 deliverables ticked.
  - Also recorded (note's Open, manual's known issues): levelling leaves steep tiles with no crag,
    where laying a corridor, cable or railway says to break a crag that is not there. The message
    predates Batch 29; no game code changed in this fix.
  - verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 102 files, 1,198
    tests, all passed (331 s; the Known-red opening test passed this run); build:web green
    (471.7 kB JS, 162.1 kB gzip); build green
  - manual: docs/manual/update-notes.md (Update 29's known issues and the current list: the steep
    ground message)
  - changed: src/sim/micro/drive.test.ts src/render/vehicles.test.ts
    src/render/city-chunks.test.ts docs/balance/batch29-vehicles.md GAME_PLAN.md
    docs/manual/update-notes.md docs/PROGRESS.md
- review 2: accepted
  Review 1's three problems are fixed. The fix changed tests and documents only (`git diff 897a162`:
  no game code).
  1. Steep ground is tested at `src/sim/micro/drive.test.ts:186`. The wrong claim is corrected in
     the note, its injection table and total, GAME_PLAN, and this entry.
  2. Every test review 1 listed has a row in the note's injection table, and so does the new
     two-ways test (`src/render/vehicles.test.ts`, "passes one coming the other way"). The three
     strengthened bounds each carry their measured value.
  3. GAME_PLAN's five Batch 29 deliverables are ticked.

  Checked in this round:
  - Typecheck, `build:web` (471.72 kB JS, 162.10 kB gzip) and `build` are green.
  - Full suite (`--maxWorkers=2 --minWorkers=1`): 102 files, 1,198 tests, all passed (344 s).
  - Three injections, one at a time, each caught as the note records, and the tree was clean
    after each:
    - steep ground driveable (`drive.ts:116`): the new steep test, "the way to 42,56 drives up
      steep ground at 44,56";
    - `ROVER_LANE` set to 0: "passes one coming the other way", held back 0.45 tiles (463.45
      against 463.90);
    - the wait behind another removed: the spacing test, "rovers touching in the metropolis:
      expected 23 to be 0", and "waits behind another".
  - The new known issue matches the code:
    - steep ground refuses a corridor, cable or railway with "send a rover to break the crag";
    - sending a rover there is refused with "there is no rock there to break";
    - **Level ground** is the card's name on screen.
  - Two more manual statements match the code:
    - a corridor is twice as quick (`ROVER_CORRIDOR_SPEEDUP` 2);
    - nothing goes up on a rover's way until it is home, because a job's route is kept until the
      job ends.

### Batch 30 - The first hour: onboarding and objectives
- status: complete
- note: docs/balance/batch30-first-hour.md
- manual: docs/manual/goals.md (new: the guide, objectives and rewards, milestones),
  docs/manual/update-notes.md (Update 30, known issues), docs/manual/getting-started.md (the guide),
  docs/manual/cities.md (found a metropolis, rewarded rovers), docs/manual/controls.md (Objectives,
  Skip the guide), docs/manual/the-planet.md (Found a metropolis), docs/manual/README.md (contents)
- commits: a6788ed (started), 91e7adc, c94de37, 7f8b532, 21f5f24, and the completing commit
- found: the metropolis gate broke the vehicles harness's metropolis scene (founding refused,
  unchecked); the scene's world now holds the claim and the harness throws on a refusal
- sessions: 1
- decisions:
  - The objective list, written out before building and tuned by measurement: city (100 people:
    50 settlers; 20 clean city-years at 200+ people: 75 settlers; 500 people: 2 rovers; 1,000
    people: 2,000 credits and the metropolis), planet (Phase 2: 1,000; 100 mbar: 2,000; Phase 3:
    3,000 credits), network (a railway: 200 materials; three cities joined: 2,000 credits and gold
    markers). Each opens when the one before it in its chain is claimed.
  - "A week without a shortage" is 20 city-years in a row (about 11 min at 1x): the city's record
    is kept a year a sample; a week is no unit the game has.
  - City goals pay settlers and rovers, not materials: measured, a growing city's materials store is
    full from about 15 min in (the first claims landed 9 of 150).
  - The guide's progress is a latch in the world, set in `advance` every substep from the state;
    the shell may not write the world, and a step's condition can stop holding.
  - On in new Standard worlds only: off by default, in a sandbox (the spec), a Terraformed start
    (every goal already met) and every world made before.
  - Claims are the player's (a Claim button); rewards go to the largest city, as far as it has homes
    and room.
  - The unlock is founding a metropolis (the browser never offered one); the cosmetic is gold
    markers; the sound is a procedural Web Audio chime (no files; Batch 35 brings sound proper).
  - The guided steps' measured time (42 min) is recorded as it is, not met: claiming land waits for
    200 people, the user's own rule; shortening it is the user's call.
- verification: typecheck green; build green; build:web green (496.1 kB JS, 169.6 kB gzip);
  npx vitest run --maxWorkers=2 --minWorkers=1: 105 files, 1,235 tests, 1,220 passed, one file
  (src/render/vehicles.test.ts, 15 tests) failed to start - the vehicles harness founded a
  metropolis in a Standard world without the unlock; fixed, and that file then passed 15 of 15
  (373 s for the run; the Known-red opening test passed); the built page served and its bundle
  fetched over HTTP
- injections: 45, one at a time, the tree checked clean after each: 44 caught at once; the guide
  latched once a call (not every substep) was missed, and is caught since a test drowns a city
  within one call.
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch30-first-hour.md
  docs/design/macro-world.md docs/manual/README.md docs/manual/cities.md docs/manual/controls.md
  docs/manual/getting-started.md docs/manual/goals.md docs/manual/the-planet.md
  docs/manual/update-notes.md src/harness/pacing.ts src/harness/vehicles.ts src/sim/index.ts
  src/sim/integrate.ts
  src/sim/micro/registry.ts src/sim/micro/rocks.ts src/sim/micro/settlement-save.test.ts
  src/sim/micro/settlement.ts src/sim/objectives.test.ts src/sim/objectives.ts
  src/sim/planets/mars.ts src/sim/save.ts src/sim/tuning.ts src/sim/types.ts src/web/chime.ts
  src/web/city.ts src/web/first-hour.test.ts src/web/game-tuning.ts src/web/game.ts
  src/web/globe.ts src/web/hud.ts src/web/milestones.ts src/web/onboarding.test.ts
  src/web/onboarding.ts src/web/pace.test.ts src/web/style.css src/web/world-map.ts
  src/web/worlds.test.ts
- review 1: rejected
  1. The record says a target was met when the measurement shows it was not. `GAME_PLAN.md:469-470`
     and `docs/balance/batch30-first-hour.md:255-257` say Batch 28's open item, "the first upgrade
     at 4-8 minutes", is met for a taught player, at 1.8 minutes. 1.8 minutes is outside 4-8
     minutes. Measured in this review: the taught player's first upgrade is done at 108 s
     (`playPacing(worldTuning("standard", 0, "standard"), 600, false, undefined, { guided: true,
     claim: true }).moments.firstUpgrade`). The guide orders it at 42 s and the step latches at
     50 s. Needed: record the item as still missed, with the measurement and the reason (the guide
     now brings the first upgrade too early, the untaught script too late), in both places.
  2. The planet objectives' progress bars do not show how far along the goal is (the deliverable:
     "Each says exactly what counts and how far along it is"). "The caps let go" and "First water"
     report the planet's absolute temperature as their progress (`src/sim/objectives.ts:278-281`,
     `:298-302`). The panel fills the bar and sets the meter's `aria-valuenow` as now / target
     from 0 K (`src/web/onboarding.ts:322`, `:325`). Measured on a new Standard world with a city
     founded:
     - "The caps let go": 213.18 of 216 K, so the bar is **98.7% full at the start**, for a goal the
       scripted runs reach at 78.5 min to 1.65 h;
     - "First water": 213.18 of 273.15 K, 78.0% full at the start, for a goal 28 h away.

     A player reads the bar as nearly done. Needed: a bar measured from a meaningful start (the
     temperature the world began at, or the phase's own measure), and a test that a new world's
     planet bars start near empty, with its injection recorded.
  3. Minor: `src/sim/objectives.test.ts:11-13` says the scripted playthroughs are in
     `src/harness/first-hour.test.ts`. That file does not exist; they are in
     `src/web/first-hour.test.ts`.

  Checked and sound:
  - Typecheck, `build` and `build:web` (496.10 kB JS, 169.62 kB gzip) are green.
  - Full suite (`--maxWorkers=2 --minWorkers=1`): 105 files, 1,235 tests, 1,234 passed (593 s).
    The one failure is the Known-red metropolis opening test (423 ms against 400). The batch's own
    files pass: objectives 18, first-hour 7, onboarding 12, and vehicles 15 since the harness fix.
  - Two injections, one at a time, each caught as the note records, and the tree was clean after
    each:
    - the guide latched once a call, after the substep loop (`integrate.ts`): "latched every
      substep", 0 against 2;
    - an objective announced on every look (`milestones.ts`): "once each", and the assembled
      game's "nothing announced on opening the world".
  - The latch is in `advance`, every substep, and chunk-independent (tested). `GUIDE_ENABLED`,
    `OBJECTIVES_ENABLED` and every `GOAL_*` / `REWARD_*` are 0 or inert by default, set only by
    `MODE_OVERRIDES.standard`, and listed in `tuning.ts` and §10. The metropolis gate and
    `extraRovers` change nothing with objectives off.
  - Save v16 has a v15 migration and a test that loads a v15 save; a corrupt record is refused by
    name.
  - `src/sim/` imports nothing from `src/web/` or `src/render/`.
  - Milestones and the chime only read the state. Skip and Claim go through simulation actions.
  - The 42-minute guide (against the plan's 10-20) is recorded as missed, with its measurement and
    reason (claiming land waits for 200 people).
  - Three manual statements match the code:
    - a milestone card stays about six seconds (`CARD_MS` 6,500);
    - rewarded rovers sit on top of the Headquarters' 3 and its Rover Posts (`roverCount`);
    - the Objectives button sits just above Menu in orbit and just under it in a city (the CSS).
  - No decision deletes or overwrites player data. Older worlds keep their recorded tuning, with
    both features off.
- fix 1: done
  1. The first upgrade is recorded as still missed, in GAME_PLAN and the note (what went wrong, a
     measurement table, Open). Measured again with review 1's command: the taught player's first
     upgrade is done at 108.3 s (asked at 42 s, latched at 50 s), too early; the untaught script's
     at 1,291.7 s (21.5 min), too late. An upgrade's worth is unchanged.
  2. The planet bars: an objective's progress now says where its bar starts (`from`). The two
     temperature goals start at the planet's temperature as the world began, 213.04 K (Mars's
     start, no weather). The panel fills from there, the meter's minimum is that start, and the
     words say how far the planet has come: "0.1 of 3.0 K up from the start (213.2 now, 216
     needed)". A new Standard world with a city founded: The caps let go 4.7% (was 98.7%), Thicker
     air 6.2% (unchanged), First water 0.2% (was 78.0%). Two new tests in
     `src/web/onboarding.test.ts`:
     - near empty on a new world, each planet goal opened in turn, with the meter's minimum and the
       words;
     - fills as the planet warms (90.2% after the planet played alone for 90 minutes), full once
       the phase is reached.

     The sim test checks `from` too. Six injections, one at a time, the file checked against its
     backup after each, all caught:
     - the bars from 0 K again;
     - the panel's fill ignoring the start;
     - the start at the target;
     - the words ignoring the start;
     - the meter's minimum at 0;
     - the bar standing at the start until done.

     The last was first caught only by the words check ahead of the fill guard, so the guard got a
     test of its own, and it fails too (0% against more than 50).
  3. `src/sim/objectives.test.ts`'s header names `src/web/first-hour.test.ts`.
  - decisions:
    - The bar keeps the weather: the HUD shows and the phases judge the temperature with it
      (Batch 13). On the first goal's 3 K span it swings: 48% at 45 min, 0% at 60, 90% at 90 in
      the planet played alone. Recorded in the note's Open and the manual's known issues.
    - Both temperature goals are measured from the world's start, not First water from 216 K: one
      rule, and both read near empty on a new world. First water opens about 68% full, the
      warming already done.
    - Thicker air stays measured from 0 mbar: 6.2% on a new world, and review 1 did not flag it.
  - verification: typecheck green; build green; build:web green (496.4 kB JS, 169.7 kB gzip); npx
    vitest run --maxWorkers=2 --minWorkers=1: 105 files, 1,237 tests, all passed (403 s; the
    Known-red opening test passed this run)
  - manual: docs/manual/goals.md (the planet's bars, measured from the start, and the weather),
    docs/manual/update-notes.md (Update 30's objectives and known issues; the current known issues)
  - changed: src/sim/objectives.ts src/sim/objectives.test.ts src/web/onboarding.ts
    src/web/onboarding.test.ts docs/balance/batch30-first-hour.md GAME_PLAN.md
    docs/manual/goals.md docs/manual/update-notes.md docs/PROGRESS.md
- review 2: accepted
  Review 1's three problems are fixed. The fix changed the planet bars' code and tests, and
  documents (`git diff 24ea708`: `src/sim/objectives.ts`, `src/web/onboarding.ts` and their tests).
  1. The first upgrade is recorded as still missed, with the measurement and the reason (taught
     108 s, too early; untaught 21.5 min, too late), in `GAME_PLAN.md`'s Batch 30 changes and the
     note's measurements and Open.
  2. The planet's temperature goals carry where their bar starts (`Progress.from`, Mars's start
     temperature, 213.04 K). The panel's fill, the meter's minimum and the words all count from
     there. Two new tests in `src/web/onboarding.test.ts`: the bars start near empty on a new world,
     and they fill as the planet warms. The six injections are in the note's table.
  3. `src/sim/objectives.test.ts`'s header names `src/web/first-hour.test.ts`.

  Checked in this round:
  - Typecheck, `build` and `build:web` (496.42 kB JS, 169.74 kB gzip) are green.
  - Full suite (`--maxWorkers=2 --minWorkers=1`): 105 files, 1,237 tests, all passed (388 s).
  - Two of the fix round's injections, one at a time, each caught as the note records, and the
    tree was clean after each:
    - the panel's fill ignoring where the bar starts (`barFraction`): "start near empty on a new
      world", 98.69 against less than 10;
    - the bar standing at its start until the phase is reached (`warmedTo`): "fill as the planet
      warms", 0 against more than 50, and the words check ("0 of 3.0 K ...").
  - A new world's start does not depend on its seed or tuning (`marsStart` copies
    `MARS_START_RESERVOIRS`), so one start temperature serves every Standard world.
  - `from` is derived, never saved: no save change in this round.
  - Three manual statements match the code:
    - "0.1 of 3.0 K up from the start (213.2 now, 216 needed)" is the panel's exact text on a new
      world (tested);
    - the bars start nearly empty (4.7% and 0.2%, measured);
    - the bars follow the weather, and a dust storm cools the planet: the goal reads the
      temperature through `eventEnv`, where a dust storm raises the albedo, and the browser turns
      events on (`EVENTS_ENABLED` 1).
  - The fix's three decisions (the bar keeps the weather; both temperature goals count from the
    world's start; Thicker air stays counted from 0 mbar) are ones a bare "Go" would accept. None
    deletes or overwrites player data.

### Batch 31 - Knowing what is happening: alerts, notifications and statistics
- status: complete
- note: docs/balance/batch31-alerts.md
- manual: docs/manual/alerts-and-statistics.md (new: alerts, pop-ups, the Alerts button,
  statistics, each city at a glance), docs/manual/update-notes.md (Update 31, known issues),
  docs/manual/controls.md (Alerts, Statistics, dismissing a pop-up), docs/manual/the-planet.md
  (the Settlements line), docs/manual/cities.md (the planner's charts, the world map's line),
  docs/manual/README.md (contents, the game in one minute)
- commits: 281d523 (started), 82410d1, 3310b7c, 256c57c, 6a77255, c8d102b, 1637c2d, bef0403,
  6e7abce, 2af1638, 25a3b8a, c4e8bba, b017d63, and the completing commit
- sessions: 1
- found: the first alert look took 2.8 s over the example planet (42 settlements, 246,095
  buildings); the look's budget and kept conditions bring it to 4-24 ms after a step and 0.1-1.6 ms
  between steps. The budget's first version starved (nothing worked out after the first look with
  no time to spare); its test found it.
- decisions:
  - The planet's record is in the simulation (`SimState.history`, save v17), sampled in `advance`
    every 4 substeps and halved when it holds 240, so it spans the whole game in a bounded size.
    It only records, so it is on in every world; old worlds start recording on their next load.
  - A city's record adds made and drawn per resource; samples from before are left without them,
    nothing made up.
  - Alerts are derived in the browser, two looks a second, never saved; the record of what
    happened lasts the session; the first look on opening a world takes its bearings.
  - Priorities: urgent (blackout; water, oxygen or food short; flood), notice (offline for its own
    reason; materials short; a storm coming), record only (built, upgraded, objective done - the
    milestone card already interrupts for an objective).
  - A storm is forecast from the seeded weather two real minutes ahead; a condition back within a
    minute of ending is not announced again.
  - An alert names a building by its corner on the ground as founded, which a claim west or north
    does not move.
  - The planner's charts and the statistics are one module; the planner gains the made and used
    charts.
  - A look works out new steps for 4 ms at most, settlements in turn, at least one a look; the
    overview cards read the alerts' shortages rather than stepping each city again.
  - The flood alert is built and tested with flooding on (Batch 24's fixture); the browser leaves
    flooding off until Batch 38, so the manual does not mention it.
- verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 109 files, 1,277 tests, all passed (460 s) (an earlier
  run of the batch, before the last two small edits: 109 files, 1,277 tests, all passed, 454 s;
  the Known-red opening test passed both runs); build:web green (519.9 kB JS, 177.1 kB gzip - past
  Vite's 500 kB warning, recorded as Open); build green; the built page, its script and its styles
  served and fetched over HTTP
- injections: 47, one at a time, the tree checked clean after each: 43 caught at once; 4 only after
  a new or stronger test (the planet's sample without the weather; buildings dark for a shortage
  also listed offline; a blackout pointing at no building; the round never moving on under fast
  play).
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch31-alerts.md
  docs/design/macro-world.md docs/manual/README.md docs/manual/alerts-and-statistics.md
  docs/manual/cities.md docs/manual/controls.md docs/manual/the-planet.md
  docs/manual/update-notes.md src/sim/history.test.ts src/sim/history.ts src/sim/index.ts
  src/sim/integrate.ts src/sim/micro/settlement.ts src/sim/planets/mars.ts src/sim/save.ts
  src/sim/tuning.ts src/sim/types.ts src/web/alert-centre.test.ts src/web/alert-centre.ts
  src/web/alerts.test.ts src/web/alerts.ts src/web/charts.ts src/web/city-overview.test.ts
  src/web/city-overview.ts src/web/city.ts src/web/config.ts src/web/game.ts src/web/hud.ts
  src/web/offline-words.ts src/web/planner.ts src/web/statistics.ts src/web/style.css
  src/web/world-map.ts
- review 1: accepted
  Every deliverable is built and the exit gate is met by tests:
  - each alert type fires in a scripted run that causes it and not in one beside it
    (`src/web/alerts.test.ts`; the flood on Batch 24's fixture with flooding on, recorded);
  - the alerts are derived at the readout and never saved;
  - the planet's record survives the save exactly and is bounded: 125 samples, 25.2-26.3 kB after
    1,000 sim-years, measured and tested;
  - in the assembled game, an alert clicked opens Ares with the right building selected, from
    orbit and from inside the city (`src/web/alert-centre.test.ts`).

  Checked in this round:
  - Typecheck, `build` and `build:web` (519.88 kB JS, 177.12 kB gzip, past Vite's 500 kB warning
    as the note records) are green.
  - Full suite (`--maxWorkers=2 --minWorkers=1`): 109 files, 1,277 tests, all passed (369 s; the
    Known-red opening test passed).
  - Two of the note's injections, one at a time. Each was caught as the note records, and the tree
    was clean after each:
    - buildings dark for a shortage also listed offline (`src/web/alerts.ts` line 193): the blackout
      test, "expected [ …(2) ] to deeply equal []";
    - the v16 to v17 migration making up made and drawn for a sample under way
      (`src/sim/save.ts`, `migrateV16toV17`): "loads a save from before it (v16)", "expected
      [0, 0, 0, 0, 0] to be null".
  - Simulation rules:
    - the planet's record is taken in `advance` on the substep grid, and is the same in any chunks
      (tested);
    - it changes nothing else in the world (tested with `PLANET_HISTORY_EVERY` 0);
    - `PLANET_HISTORY_EVERY` and `PLANET_HISTORY_SAMPLES` are in `tuning.ts` and the §10 table;
    - `src/sim/history.ts` imports only the simulation;
    - the alerts, centre, toasts, statistics and overviews read the state and never write it;
    - save v17 has a migration and a test that loads a v16 save.
  - The browser's alert timings sit in `src/web/config.ts` beside `READOUT_HZ`, as earlier
    batches' display constants do. They are not simulation tuning.
  - Measured in this round: the planet's sample costs a little in `advance` on a bare planet
    (4,000 substeps: 165-178 ms with it, 125-172 ms without, noisy). With a city, the city's step
    is the larger cost. This is not a gate.
  - Three manual statements match the code:
    - "a reading about every half minute at 1x": 4 substeps of 8.33 s in both paces;
    - "a city's charts cover its last 150 years, about 80 minutes of play at 1x":
      `HISTORY_SAMPLES` 150, one sample every 4 substeps, 82.5 min;
    - pop-ups "up to three at a time", urgent "about 12 seconds", notice "about 6 seconds":
      `TOASTS_SHOWN`, `TOAST_URGENT_MS` and `TOAST_NOTICE_MS`.

    The changed pages carry no file names, code names, constants or "sim-years". Update 31 has no
    Fixed section because nothing was fixed (as in Updates 28 and 30).
  - Small points, not grounds for rejection:
    - "A new city shows Spaceport offline" is in Update 31's known issues but not in the current
      known-issues list at the bottom of the page.
    - The chart readout under the pointer is the reverse: in the bottom list, not in Update 31's.
  - The eleven decisions are ones a bare "Go" would accept. None deletes or overwrites player data:
    the migration keeps every city sample and makes nothing up.

### Batch 32 - People, not a number: needs, services and happiness
- status: complete
- note: docs/balance/batch32-people.md
- manual: docs/manual/people.md (new: needs, reach, happiness, seeing it), docs/manual/update-notes.md
  (Update 32, known issues, and the missing "Spaceport offline" line Batch 31's review noted),
  docs/manual/cities.md (the status line, People, the planner's Coverage, the example cities),
  docs/manual/buildings.md (what each service meets, its reach), docs/manual/controls.md (the
  Coverage row), docs/manual/getting-started.md (a Terraformed start takes about 45 s),
  docs/manual/README.md (contents, the game in one minute)
- commits: 26ba419 (started), 550d294, 7e38d23, 1016324, c95abce, 6a65ee6, dfca0fe, and the
  completing commit
- sessions: 1 (started 2026-10-15)
- found:
  - the example planet failed the needs outright (metropolis mood -0.74, 13 of 27 cities short
    with needs on); rebuilt with its services among its homes (src/harness/services.ts), every city
    perfect with needs on and off. The pass first ran over ten minutes and was killed; it now takes
    16.7 s, and the example builds in 45.0 s (21.9 s without it).
  - stations had to board the railway (the user's rule for the metropolis): transport is met for
    0.9-65% of the example's homes; moods 0.55-0.78.
  - two measured first-hour tests moved with needs on in new worlds (the routes' cost measured
    the needs too; the first reward's worth); both hold their new measurements, with the reasons.
  - docs/AUTO_BATCH_SETUP.md (untracked, not this batch's) was committed by mistake in 6a65ee6 and
    taken out of the index again in dfca0fe; the file on disk is untouched and untracked.
- decisions:
  - Six needs above life support, in two tiers: comfort (green space, food variety) asked from 500
    people; services (medical care, research, transport, shops) from 2,000. A need is never asked
    before its building may be built: transport from 5,000 (a station's), shops from 10,000 (a
    mega mall's). "Space per person" is left out: people never outnumber homes and growth fills
    every home, so spare room would be unmet in every settled city whatever the player built.
  - Jobs (people working buildings) not now: a labour model reprices every building and every
    measured gate; happiness's output factor stands in for how well people work.
  - The mood: each asked need adds its weight met, takes it away unmet (-1 to 1, 0 asking
    nothing); growth x(1 + 0.5 mood), output x(1 + 0.1 mood) - what buildings make and research
    earns, not the planet's CO2 draw (as the command centre's boost). Unhappy people do not leave.
  - Reach: the square 33 tiles a side about a running provider, 6 more a level, over the
    corridors (rails join); homes weighted by the people they house.
  - Derived inside the substep's brownout passes, never stored: no save change.
  - On in every new world (Standard, Sandbox, Terraformed start); worlds before keep their tuning.
  - The example rebuilt (src/harness/services.ts) with its services among the homes, keeping the
    user's layout rules; a station only beside a rail, so transport is met in part (0.9-65%).
  - The scripted pacing player still builds no services (the instrument); a `needs` option
    measures one who does. Measured tests that moved with needs on hold the new measurements,
    with the reasons beside them.
  - The crowd is display (2% of the people a station or park reaches, a figure per 5, at most 16);
    towers lit by occupancy with needs on only, so the golden frames keep theirs.
  - In the example, green space is a park on a terraformed world and a biosphere before one.
- verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 112 files, 1,310
  tests, all passed (456 s; the Known-red opening test passed); build:web green (538.8 kB JS,
  184.2 kB gzip - past Vite's 500 kB warning, as recorded since Batch 31); build green; the built
  page, its script and its styles served and fetched over HTTP (the script holds the People
  section, the coverage row and the needs' words). With needs off: the golden run, the golden
  frames, the Batch 3 score, visuals and offline, 8 files, 111 tests, all passed.
- injections: 43 faults (40 in the batch, 3 in review 1's fixes), one at a time, the file checked
  against its copy after each:
  - the simulation, 16: 13 caught at once; research credits not scaled was missed until every test
    city earned research (now caught); the mood held for a whole call was missed by the chunk test
    until its city's mood moved during the run (now caught); the fallback after the brownout
    passes changes nothing (unreachable: the passes always settle);
  - the browser, 16: all caught at once;
  - the example's services, 11: 10 caught by a named test (8 by the example's own, 2 by the quick
    services test); with the replace-the-port fault the example's run died twice before any test
    reported, so the quick test gained a town where only the headquarters has room, which catches
    it; the quick test also missed the leftover-links fault at first (the example's tests caught
    it) and now checks the links directly.
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch32-people.md
  docs/design/macro-world.md docs/manual/README.md docs/manual/buildings.md docs/manual/cities.md
  docs/manual/controls.md docs/manual/getting-started.md docs/manual/people.md
  docs/manual/update-notes.md src/harness/example.test.ts src/harness/example.ts
  src/harness/pacing.ts src/harness/services.test.ts src/harness/services.ts src/render/city.ts
  src/render/people.ts src/sim/index.ts src/sim/micro/needs.test.ts src/sim/micro/needs.ts
  src/sim/micro/settlement.ts src/sim/micro/view.ts src/sim/tuning.ts src/web/city.ts
  src/web/first-hour.test.ts src/web/game-tuning.ts src/web/needs-words.ts src/web/pace.test.ts
  src/web/people.test.ts src/web/planner.ts src/web/style.css
- review 1: rejected
  1. The game now tells the player the wrong waiting time, and so does the manual. The services
     pass runs for the Example planet as well as for a Terraformed start. `examplePlanet` runs
     `serveCities` unless `services: false`, and `src/web/main.ts:47` builds the Example planet
     without that option. Measured in this review, one process each: the Example planet takes
     34.9 s with the pass and 20.0 s without it; a Terraformed start (seed 12345) takes 39.1 s.
     What the player reads:
     - `src/web/app.ts:51` (New world, Terraformed start: "about twenty seconds to make") and
       `src/web/app.ts:359` ("Making a living planet - about twenty seconds...") are both still
       twenty seconds. The manual now says about 45 (`docs/manual/getting-started.md:32`).
     - `src/web/app.ts:431` ("Building the example planet - about twenty seconds...") and
       `docs/manual/getting-started.md:13` ("It takes about twenty seconds to build") are both
       wrong. getting-started.md is a page this batch changed.
     - Update 32's known issue (`docs/manual/update-notes.md:41`, and `:261` in the current list)
       names only the Terraformed start.

     Needed: the on-screen words, the code comments that repeat them (`src/web/app.ts:36`,
     `src/web/worlds.ts:100-102`, `src/web/game.ts:543`, `:653`) and the manual all giving the
     measured times; the Example planet added to the known issue.
  2. `docs/manual/cities.md:156-157` says a city wants "medical care, research, transport and shops
     from 2,000 on". Transport is asked from 5,000 and shops from 10,000 (`needAskedFrom`, tested
     in `src/sim/micro/needs.test.ts:158`; `people.md` says so correctly).
  3. Two new tests have no row in the note's injection table, so the table does not show either
     was ever broken by a fault:
     - `src/sim/micro/needs.test.ts:148` (the same in any chunks): no fault recorded at all. Needed:
       a fault it catches, or the note's reason why no fault in this feature can break it.
     - `src/sim/micro/needs.test.ts:139` (no needs with them off, nor for an outpost). It does see a
       fault: probed in this review, `needsOn` ignoring `NEEDS_ENABLED` (`settlement.ts`) fails it
       and the seven exit-gate tests. Needed: the row, in the table and in the count.
  4. The note does not lead with what went wrong. `docs/balance/batch32-people.md` opens with
     "What was built" (`:5-43`), and "What went wrong, and what it cost" starts at `:45`. Batches
     29 to 31 put it first, as the rule asks.

  Checked and sound:
  - Typecheck, `build` and `build:web` (538.83 kB JS, 184.18 kB gzip, past Vite's 500 kB warning,
    as recorded) are green.
  - Full suite (`--maxWorkers=2 --minWorkers=1`): 112 files, 1,310 tests, all passed (425 s; the
    Known-red opening test passed).
  - The exit gate is met by `src/sim/micro/needs.test.ts`:
    - each need, met against unmet, through one substep of the real `advance`, moves growth by
      2 x weight x `HAPPINESS_GROWTH` and materials and research credits by
      2 x weight x `HAPPINESS_OUTPUT`, to nine decimals. This is measured from population and
      stores, not from the mood the code reports.
    - `NEEDS_ENABLED` is 0 in `tuning.ts` and in `BROWSER_TUNING`, and only `NEW_WORLD_OVERRIDES`
      turns it on. Old worlds keep it off, because `fromRecord` gives a constant added since the
      world was made its default.
    - The example passes "perfect with needs on" (`src/harness/example.test.ts`).
  - Two of the note's injections, one at a time. Each was caught as the note records, and
    `git status` was clean after each:
    - a provider counted whether it runs or not (`needs.ts:207`): "a provider that is not running"
      and "browned out", expected 1 to be 0;
    - the crowd always 0 (`render/people.ts`): "the crowd there now" and "the crowd drawn",
      expected 0 to be 16.
  - Simulation rules:
    - the mood is found inside `settlementStep`'s brownout passes, in `advance`, on the substep
      grid;
    - the fallback after the passes cannot be reached (each pass switches a building off or ends
      the loop);
    - all 14 new constants are in `tuning.ts`, in `validateTuning` and in the §10 table;
    - `needs.ts` imports only the simulation;
    - the crowd constants are display constants in `src/render/`;
    - the panel, inspector and planner only read the view;
    - nothing is stored, so there is no save change.
  - The reach cache hits from one substep to the next: `networkOf` and `withRails` are cached, so
    the step and the view pass the same network object.
  - Three manual statements match the code:
    - "green space and research: 7.5 points ... medical care, transport and shops: 10": the weights
      0.15, 0.1 and 0.2, with happiness at 50% + 50% x mood;
    - "Happiness 70%: growth +20%, buildings make +4%.": `happinessWords` with mood 0.4;
    - "a Biosphere costs 800 materials ... a new city's stores hold 400 ... about 45 minutes":
      `COST_BIOSPHERE`, `MICRO_CAP_MATERIALS`, `BUILD_SECONDS_BIOSPHERE` 2,700.
  - Measured thresholds carry their measurements: 0.899 and 0.553 in the example, 56.4 and 8.3
    minutes in the first hour, 1.069 and 1.048 for pacing.
  - The decisions are ones a bare "Go" would accept, including leaving out space per person, for
    the reason given. None deletes or overwrites player data. Saved Terraformed-start worlds keep
    their layout; only new ones are rebuilt.
- fix 1: done (session 2, 2026-10-16)
  1. Waiting times: measured again, one process each - the Example planet 34.9-49.7 s with the
     services pass (102.4 s on a cold first run), 21.0-25.9 s without; a Terraformed start 40.9 s
     (seed 12345) and 47.8 s (seed 7). The New world hint, both "Making..." / "Building..." lines
     (`src/web/app.ts`), the comments repeating them (`app.ts`, `worlds.ts`, `game.ts`,
     `app.test.ts`) and the manual (`getting-started.md`, both entries) now say about forty
     seconds; Update 32's known issue and the current list name the Example planet too, and
     Update 32's "Changed" says the Example planet's cities have the services as well.
  2. `docs/manual/cities.md`: medical care and research from 2,000, transport from 5,000, shops
     from 10,000 (checked against `needAskedFrom` and its test).
  3. Injections, one at a time, `git diff` clean after each:
     - `needsOn` not reading `NEEDS_ENABLED`: fails "reports no needs with them off, nor for an
       outpost" and the seven exit-gate tests (as the review probed);
     - outposts asked like cities (both guards; either alone changes nothing): fails that test
       alone;
     - the mood found on a call's first substep and held for the rest of the call: the chunk
       test **passed** it - its city of 11,000 asked every need from the first substep, with
       bottomless stores and nothing going up, so its mood was one value all run. The test's city
       is now 1,990 people (about 40 more a substep, measured): its mood goes 0.25, -0.10, -0.30
       during the run. With the fault it fails (5,541 people in 16 calls against 6,325 in one);
       it compares the city first, so the failure names what moved, and checks the mood moved
       (put back at 11,000 people, that check fails: -0.5, not 0.25). The note's table has the
       three rows; the count is 43 (the simulation 16).
  4. The note leads with "What went wrong, and what it cost", with review 1's findings as its
     ninth item; the timings table and "Open" updated.
  - checks: typecheck green; the touched tests (needs, app, worlds) 3 files, 43 tests, passed;
    npx vitest run --maxWorkers=2 --minWorkers=1: 112 files, 1,310 tests, all passed (672 s; the
    Known-red opening test passed); build:web green (538.83 kB JS, 184.18 kB gzip, past Vite's
    500 kB warning as recorded); build green; the built script holds "about forty seconds" three
    times and "twenty seconds" none.
  - commits: 4ee3158, and the commit recording this
- review 2: accepted
  Review 1's four problems are fixed:
  1. Waiting times.
     - The New world hint and both "Making..." / "Building..." lines say about forty seconds
       (`src/web/app.ts:51`, `:359`, `:431`), and so do the comments that repeat them.
     - `getting-started.md:13` and `:32` say forty too. Measured: the Example planet 34.9-49.7 s,
       a Terraformed start 39.1-47.8 s.
     - Update 32's known issue and the current list name the Example planet.
     - Nothing under `src/` or `docs/manual/` still says twenty or 45 seconds for either.
  2. `docs/manual/cities.md:156-157` gives 2,000 / 5,000 / 10,000, as `needAskedFrom` and its test
     do.
  3. The note's table has the three rows, and the chunk test can now fail. Its city of 1,990 moves
     its mood during the run: 0.25 at the start, -0.30 at the end, both asserted.
  4. The note leads with "What went wrong, and what it cost".

  Checked in this review:
  - Typecheck, `build` and `build:web` are green (538.83 kB JS, 184.18 kB gzip, past Vite's
    500 kB warning, as recorded).
  - Full suite (`--maxWorkers=2 --minWorkers=1`): 112 files, 1,310 tests, all passed (504 s; the
    Known-red opening test passed).
  - Two injections, one at a time, `git status` clean after each:
    - the mood found once per `advance` call and held for the rest of it (a call counter in
      `advance`, a latch in `settlementStep`'s `feel`): the chunk test fails, 6,325 people in one
      call against 5,541 in 16, as the note records;
    - the planner's coverage counting a dark provider's homes as reached (`needs.ts:282`): "a
      service that is not running ... every home a gap" fails, the pixel reached green, not the
      gap's red.
  - Three manual statements match the code:
    - the Coverage row's Off, Green space, Medical care, Research, Transport, Shops
      (`COVERAGE_NEEDS`, the needs that reach);
    - at a Station or a Park the inspector says how many people are there now (`crowdAt`, station
      and park only);
    - the Cities page's thresholds, as above.
  - "Their people are happy" (`cities.md:216`) is said of a Terraformed start alone, and rightly:
    the Example planet is built with `BROWSER_TUNING`, needs off.
  - The walls still hold: nothing in `src/sim/` imports from `src/web/` or `src/render/`.
  - All 14 new constants are in `tuning.ts` and the §10 table. Only `NEW_WORLD_OVERRIDES` turns
    `NEEDS_ENABLED` on.

  One slip, not grounds for rejecting the batch: to correct in passing. The note's decision 10
  (`docs/balance/batch32-people.md`, "The scripted pacing player unchanged") says the `needs`
  script option "measures one who does not". It measures a player who does meet the needs
  (`src/harness/pacing.ts:79-84`), as this entry's own decisions say.

### Batch 33 - Events that ask for decisions
- status: complete
- note: docs/balance/batch33-events.md
- manual: docs/manual/events.md (new: when events come, the card, every event's choices and
  default, what lasts, alerts and the history, while away), docs/manual/update-notes.md (Update 33,
  known issues), docs/manual/alerts-and-statistics.md (the event alerts, Event history),
  docs/manual/cities.md (the status line), docs/manual/worlds-and-saving.md (events while away),
  docs/manual/getting-started.md (events from half an hour in), docs/manual/README.md (contents,
  the game in one minute)
- commits: d8d603f (started), 3eb9779, be1d378, c3c48e9, 2413076, 43b798e, and the completing commit
- sessions: 1 (2026-10-16)
- found:
  - "runs at half" holds only over the first sample after the deadline (0.500); later a broken-down
    machine's shortages lower the mood and every building makes less (0.466): a cascade, measured
    as such.
  - "the default is never the best" judged on every store failed: a wrecked consumer stops
    drawing. Judged at the deadline on the bank, people, levels, buildings, materials and a
    fault's output, a choice dominates the default in every event.
  - a supply ship's materials land in a full store (a growing city's is full); settlers matter.
    Settlers tried at 40, measured, kept at 20.
  - unanswered events bring the scripted city of 1,000 sooner at Standard (2.16 h to 2.04 h;
    answered 1.98 h), later at Classic (1.74 h to 1.82 h; answered 1.81 h); each kind alone moves
    it 2.11-2.29 h. The script answers a shock by building what is short.
  - five measured tests that priced one feature on new-world tuning broke with events on; they
    now run with events off in both runs, and the events have pacing tests of their own.
  - the boundary test forbids a sim test importing src/web: the gate test lives in
    src/web/decisions-gate.test.ts.
  - two of 44 injected faults were missed, each a test missing (the deck's off-switch at a
    substep that deals; a world opened with past events); both tests added, both faults caught.
  - the note's draft gave a count (151 cards dealt) before measuring it; measured 141, corrected.
- decisions:
  - The deck's timing is a pure hash of the seed and the card's number (a 20-minute slot from
    30 minutes, chance 0.75); the open events, choices and the latest 40 resolved are world
    state (save v18) - a choice cannot be derived.
  - Costs are paid when a choice is made (refused, with the reason, when they cannot be); every
    outcome, and the default, lands at the deadline (3 min at 1x) inside `advance`.
  - The default is the worst choice made worse (twice the meteor's hits, broken down rather than
    degraded, the whole toll and the quarantine's stop, less cargo than waiting);
    `validateTuning` refuses a tuning that would let it catch up.
  - What lasts (shelter, quarantine, a fault) goes on the settlement and counts down in its own
    substep, so the city view and the alerts see it; a fault follows its building through claims
    and goes with it.
  - Earth's request left to Batch 34 (contracts and reputation).
  - On in new Standard and Terraformed worlds (MODE_OVERRIDES), never in a sandbox ("no losses")
    or a world made before.
  - The outbreak's medical capacity is the city's built Medical Centers (400 people a level),
    the shelter the shortage rule already gives them.
  - The scripted pacing player answers no event unless told to (`answer`: the first choice it
    can pay).
- verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 115 files, 1,347
  tests, all passed (452 s; the Known-red opening test passed); build:web green (567.98 kB JS,
  193.34 kB gzip - past Vite's 500 kB warning, as recorded since Batch 31; 45.35 kB CSS); build
  green; the built page, its script and its styles served and fetched over HTTP (the script holds
  "Decide within", "Event history", "If you do nothing", "came to a head"; the styles the card).
  With events off the golden run, the golden frames, the Batch 3 score and determinism are in the
  suite, unchanged.
- injections: 44 faults, one at a time, each file restored byte for byte and checked: 42 caught at
  once, 2 only after a new test (the table is in the note).
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch32-people.md
  docs/balance/batch33-events.md docs/design/macro-world.md docs/manual/README.md
  docs/manual/alerts-and-statistics.md docs/manual/cities.md docs/manual/events.md
  docs/manual/getting-started.md docs/manual/update-notes.md docs/manual/worlds-and-saving.md
  src/harness/pacing.ts src/sim/decisions.test.ts src/sim/decisions.ts src/sim/index.ts
  src/sim/integrate.ts src/sim/micro/settlement-save.test.ts src/sim/micro/settlement.ts
  src/sim/micro/view.ts src/sim/offline.ts src/sim/planets/mars.ts src/sim/save.ts
  src/sim/tuning.ts src/sim/types.ts src/web/alert-centre.ts src/web/alerts.ts src/web/city.ts
  src/web/decision-words.ts src/web/decisions-gate.test.ts src/web/decisions.test.ts
  src/web/decisions.ts src/web/first-hour.test.ts src/web/game-tuning.ts src/web/game.ts
  src/web/offline-words.ts src/web/pace.test.ts src/web/style.css
- review 1: rejected
  1. The note gives the wrong length for the run behind one of its measurements.
     `docs/balance/batch33-events.md:174-175` says "In four hours at Standard the scripted world met
     4 events (a failure, a ship, an outbreak, a meteor), the first at 33 minutes." The run that
     gives those four is `playPacing(STANDARD, 4 * HOUR)` as `src/web/pace.test.ts` calls it, and
     with `stopWhenDone` (the default) it stops once every moment is reached, at 2.03 h, not four
     hours. Measured in this review (`worldTuning("standard", 0, "standard")`):
     - stopping when done: 2.03 h, 4 resolved (failure at 33 min, ship 56, outbreak 96, meteor
       111);
     - the full four hours (`stopWhenDone` false): 6 resolved (the same four, then outbreaks at
       139 and 160 min).
     Read as written, the line says about one event an hour. The note's own design figure, the
     manual and GAME_PLAN all say about one every 25 minutes. Needed: correct the line to say
     what was measured (4 events in the 2.03 h the run lasts, or 6 in four hours, or both, with
     their times).

  Checked in this round, and sound:
  - Typecheck, `build:web` (567.97 kB JS, 193.34 kB gzip; Vite's 500 kB warning, as recorded
    since Batch 31) and `build` are green.
  - Full suite (`--maxWorkers=2 --minWorkers=1`): 115 files, 1,347 tests, all passed (565 s; the
    Known-red opening test passed).
  - Every deliverable is built. Earth's request is left to Batch 34, as the plan's own deliverable
    says. The exit gate is met by tests in `src/web/decisions-gate.test.ts`:
    - the same world is `toEqual` in one call, in ragged chunks, offline from a save, and with the
      player's answers given at the same substeps;
    - each choice is measured through a real `advance` against the town alone;
    - per event, a choice dominates the default at the deadline;
    - `DECISIONS_ENABLED` is 0 by default, and new Standard and Terraformed worlds turn it on.
  - Two injections re-run, one at a time, each file restored and `git status` checked clean
    after each:
    - #6, the deck's off-switch removed from `stepDecisions`, is caught by "changes nothing with
      events off";
    - #21, the quarantine no longer stopping growth, is caught by the gate's outbreak test (76.7
      births where 0 are allowed).
  - The note's 141 cards dealt in 200 slots of seed 7 is re-measured: 141.
  - Simulation rules hold:
    - deck and outcomes are in `advance`, per substep, after the cities' own;
    - effects count down in `settlementStep`;
    - `src/sim/` imports nothing from the browser;
    - the card writes only through `chooseDecision`, an action like claiming an objective;
    - every new constant is in `tuning.ts` and the section 10 table;
    - save v18 has its migration and a test loading a v17 save;
    - worlds made before keep their recorded tuning, so events stay off in them.
  - The manual was checked against the code:
    - the Spaceport can fail (it makes water, oxygen and food);
    - a Medical Center shelters 400 people a level;
    - **Show** *city* selects the failing building (`game.ts:816`);
    - Standard worlds offer 2x and 3x;
    - a Terraformed start's planet is already old, so cards can come at once.
  - Every decision is one a bare "Go" would accept, and none deletes or overwrites player data.
  - Seen, not a ground for rejection: in `src/web/city.ts:112` the doc comment of `seconds` was
    left above `effectWords`'s own.
- fix 1: done (session 2, 2026-10-16)
  1. The note's line re-measured with `playPacing(worldTuning("standard", 0, "standard"), 4 h)`,
     both ways, the same as the review: stopping when done, 2.035 h, 4 events (opening at 33.3,
     55.7, 96.3 and 110.7 min: a failure, an early ship, an outbreak, a meteor); the full four
     hours, 6 (the same four, then outbreaks at 139.0 and 159.9 min) and none after - the seed's
     deck slots 7 to 10 (170-250 min) hold no card, a 1-in-256 draw at chance 0.75, not a fault.
     `docs/balance/batch33-events.md` now says both, with their times, and that from the first
     to the sixth it is one every 25 minutes; "What went wrong" has the review's finding as its
     tenth item. No other file repeats the claim (searched the docs and the manual); nothing the
     player sees changed, so the manual is unchanged.
  - Also, from "Seen": `seconds`'s doc comment moved back above it in `src/web/city.ts`.
  - checks: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 115 files, 1,347
    tests, all passed (356 s; the Known-red opening test passed); build:web green (567.97 kB JS,
    193.34 kB gzip, past Vite's 500 kB warning as recorded since Batch 31; 45.34 kB CSS); build
    green.
  - commits: the commit recording this
- review 2: accepted
  - Review 1's problem is fixed. `docs/balance/batch33-events.md` now gives both lengths of run,
    and both re-measure exactly in this review (`playPacing(worldTuning("standard", 0,
    "standard"), 4 h)`):
    - stopping when done: 2.035 h, 4 events (failure 33.3 min, ship 55.7, outbreak 96.3, meteor
      110.7);
    - the full four hours: 6 (the same four, then outbreaks at 139.0 and 159.9).
    - The seed's slots 7 to 10 (170-250 min) hold no card; slot 2 is empty too, and slot 11 holds
      one at 260.7 min.
    - From the first event to the sixth is 126.6 min over 5 gaps: 25.3 min, "one every 25".
    - The finding is the note's tenth "What went wrong". `seconds`'s doc comment is back above
      it in `src/web/city.ts`.
  - Checks in this round:
    - typecheck green;
    - `npx vitest run --maxWorkers=2 --minWorkers=1`: 115 files, 1,347 tests, all passed (423 s;
      the Known-red opening test passed);
    - `build:web` green (567.97 kB JS, 193.34 kB gzip; Vite's 500 kB warning, as recorded since
      Batch 31);
    - `build` green.
  - Two injections re-run that review 1 did not try, one at a time. Each file was restored byte
    for byte, and `git status` was clean after each:
    - #13, the outbreak's toll taken from the city at the deadline rather than its stake, is
      caught by the gate's outbreak test (15 lost where 14 are due);
    - #36, past resolutions announced on the first look, is caught by "takes its bearings on
      opening a world".
  - The exit gate, the simulation rules, the save's migration, the decisions and the manual
    were checked again; review 1's findings on them still hold.
    - Every new constant is in `tuning.ts` and the section 10 table.
    - `stepDecisions` runs in `advance`, per substep, after the cities.
    - Effects count down in `settlementStep`.
    - No action removes a settlement, so a record's city check in `readDecisions` cannot strand
      a save.
  - Manual statements checked against the code in this round:
    - the countdown, 3 min 4 s at 1x (22 substeps);
    - a meteor never hits the Headquarters or a building going up, and can hit one twice;
    - the status line's "about 1 min at 1x" under cover;
    - a refused choice's "Cannot: it needs 150 credits; the bank holds ...";
    - the away summary's "3 events came to a head, 2 unanswered".
  - Seen, not a ground for rejection:
    - "about one every 25 minutes" rounds 26.7 (20 min / 0.75), but the measured gap is 25.3;
    - `pace.test.ts`'s title says "a twentieth or so" where it bounds an eighth (its measured
      values are beside it).

### Batch 34 - Earth: shipments, contracts and the market
- status: complete
- note: docs/balance/batch34-earth.md
- manual: docs/manual/earth.md (new: the Earth button, launch windows, buying and selling, prices,
  contracts, alerts, while away, the Spaceport), docs/manual/update-notes.md (Update 34, known
  issues), docs/manual/README.md (contents, the game in one minute), docs/manual/alerts-and-statistics.md
  (Earth's alerts), docs/manual/buildings.md (the Spaceport), docs/manual/cities.md (the Spaceport and
  rockets), docs/manual/controls.md (the Earth button), docs/manual/getting-started.md (the first
  window), docs/manual/the-planet.md (credits from Earth), docs/manual/worlds-and-saving.md (Earth
  while away)
- commits: 1d307ad (started), 24c495f, 72f4370, aae07be, 73ea9ab, 8a9359f, a278138, 7a961db, 0bd4232,
  and the completing commit
- sessions: 1 (2026-10-16)
- found:
  - contracts sized in units were eight times harder at Classic, whose windows (the planet's
    calendar) are eight times as close for the cities: the scripted trader failed 23 in its first
    Classic hour. Now sized per city-year of a window's span (150 to 310 materials at Standard, 20 to
    40 at Classic).
  - an offer announced in the alerts every window broke Batch 31's "a quiet, healthy city says
    nothing at all"; the test was right, and offers are the Earth button's to say.
  - the bank is the wrong measure of trade (the scripted player spends it on the planet): measured
    on Earth's own totals and the moments instead.
  - the invariant #2 gate bans the word `window` in simulation code; three refusal strings were
    reworded, the gate unchanged.
  - 71 faults injected (54 in the batch's run, 17 in review 1's fix round): 62 caught at once, 4
    only after a test was added or strengthened (a sale that found nothing closed, orders not
    saved, contracts sized by Standard's clock, and in the fix round a materials contract paying a
    tenth), 2 masked by a second guard and caught as coherent faults, 1 (a save's sale of
    settlers, found by reading the code) caught at once.
  - review 1: seven tests had no injection on record. The fix round broke each (17 faults, 53 to
    69, all seven failed) and found nothing saying a contract pays better than the market: a
    materials contract at 0.4 credits a unit, less than Earth pays for a sale, passed every Earth
    test. A test now holds it (measured: at least 1.71 times Earth's best price).
  - two earlier tests needed Earth adding: the v17-load test strips v19's field too, and the pinned
    mode overrides list EARTH_ENABLED.
- decisions:
  - Windows by the planet's calendar, k x 2.135 of its years from year 0, from k alone: "by sim time"
    is the planet's, and the orbit is.
  - The spaceport's own rocket carries the shipment both ways, a rocket job with the flight's number:
    the view draws it and a supply run holds it, so a window can be missed. The trip is a third of a
    window, always home before the next.
  - A purchase is paid when placed and refundable until it goes; a sale is paid as it goes up, at the
    window's prices. What does not fit is sold back; a settler with no home refunded.
  - A rocket never takes a store below a quarter of its room (sales and contracts alike).
  - One offer each window, dealt from the seed and the world, due three windows on; research goes to
    Earth instead of the bank while its contract is open.
  - The unlocks are Earth's goods: settlers after 1 contract met, rovers after 3. Reputation moves
    prices (+-25%); failing costs 20, meeting gains 10.
  - Earth never pays more than it asks: validateTuning refuses a tuning that would let it.
  - On in new Standard and Terraformed worlds (MODE_OVERRIDES), never a sandbox or a world made
    before; the free supply run unchanged.
  - Earth's request (Batch 33's sixth event) is a contract, not an event card.
  - "The economy panel" is a panel of its own from the bar, with the bank and the trade so far: the
    HUD's economy is one line of the orbit view, and trade is wanted from a city too.
  - An offer is said by the Earth button, not the alerts: one comes every window.
- verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 118 files, 1,393
  tests, 1,392 passed (454 s); the one failure is the Known-red metropolis opening test
  (src/web/city-open.test.ts, 513 ms against 400; no code it runs changed in this batch); build:web
  green (602.24 kB JS, 203.45 kB gzip - past Vite's 500 kB warning, as recorded since Batch 31; 48.67
  kB CSS); build green; the built page, its script and its styles served and fetched over HTTP (the
  script holds "Next launch window in", "Earth (an offer)", "Launch window missed in"; the styles the
  panel). With Earth off the golden run, the golden frames, the Batch 3 score and determinism are in
  the suite, unchanged.
- injections: 71 faults, one at a time, each file restored byte for byte and checked: 62 caught at
  once, 4 after a new or stronger test, 2 changing no behaviour as written (a second guard) and
  caught as coherent faults, 1 added after the run and caught (the table is in the note; 53 to 69
  are review 1's fix round).
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch34-earth.md
  docs/design/macro-world.md docs/manual/README.md docs/manual/alerts-and-statistics.md
  docs/manual/buildings.md docs/manual/cities.md docs/manual/controls.md docs/manual/earth.md
  docs/manual/getting-started.md docs/manual/the-planet.md docs/manual/update-notes.md
  docs/manual/worlds-and-saving.md src/harness/pacing.ts src/sim/earth.test.ts src/sim/earth.ts
  src/sim/index.ts src/sim/integrate.ts src/sim/micro/settlement.ts src/sim/offline.ts
  src/sim/planets/mars.ts src/sim/save.ts src/sim/tuning.ts src/sim/types.ts src/web/alerts.ts
  src/web/city.ts src/web/decisions-gate.test.ts src/web/earth-gate.test.ts src/web/earth-words.ts
  src/web/earth.test.ts src/web/earth.ts src/web/first-hour.test.ts src/web/game-tuning.ts
  src/web/game.ts src/web/pace.test.ts src/web/style.css
- review 1: rejected
  1. Seven new tests have no injection in the note's table (`docs/balance/batch34-earth.md:239-292`).
     Nothing shows they were ever broken by a fault. This is the rule Batch 29's review 1 rejected
     on. The "Caught by" column names one or two tests a fault, and none of these is named in any
     row:
     - `src/sim/earth.test.ts:232`: "misses it too with no finished spaceport: the city's orders
       wait";
     - `src/web/earth-gate.test.ts:65`: "is the orbit's period in the browser's tuning";
     - `src/web/earth-gate.test.ts:155`: "at Standard, a player who trades has the city of 1,000
       sooner ...". This is the Standard half of the fun measurement; only the Classic test has
       rows (27, 50);
     - `src/web/earth.test.ts:77`: "is not there in a world without Earth";
     - `src/web/earth.test.ts:83`: "shows the standing, the next launch window and Earth's prices,
       settlers and rovers locked";
     - `src/web/earth.test.ts:129`: "shows the rocket away and when it is home, then what it
       landed";
     - `src/web/earth.test.ts:143`: "offers Earth's contract with what it pays, and shows it under
       way once accepted".

     Spot-checked in this review: forcing `this.toggle.hidden = false` in `EarthPanel.update`
     (`src/web/earth.ts:180`) does fail `:77` ("expected false to be true"). That test works and
     only its record is missing. Break each of the others once, one fault at a time. Add every one
     to the table and correct the totals: the note's `:60` and `:228-235`, and this entry's
     `found:` and `injections:` lines.
  2. Minor: the comment on the contract sizes in `src/sim/tuning.ts:1285` says "150 to 300
     materials at the Standard pace". As tuned, the measurement is 150 to 310, and that is what the
     note, the manual and `src/web/earth-gate.test.ts:94` say.

  Checked in this round, and sound:
  - Typecheck green.
  - `npx vitest run --maxWorkers=2 --minWorkers=1`: 118 files, 1,393 tests, all passed (402 s).
    The Known-red opening test passed this time.
  - `build:web` green: 602.24 kB JS, 203.45 kB gzip (past Vite's 500 kB warning, as recorded since
    Batch 31), 48.67 kB CSS. `build` green.
  - Every deliverable is built:
    - shipments by launch windows on the spaceport's own rocket, which the view draws, with a
      missed window waiting for the next;
    - contracts for materials, water and research, paying credits and unlocks, and costing
      reputation when failed;
    - a market moved by supply and reputation;
    - trade in the Earth panel, tied to the bank.
  - The exit gate is met by tests:
    - 50 windows at both paces, each at most a substep late;
    - a contract met against the same run failed differs by its reward and by 10 + 20 reputation;
    - `EARTH_ENABLED` is 0 by default and in `BROWSER_TUNING`, with the golden run, the golden
      frames and the Batch 3 score in the suite on the default tuning.
  - Two injections from the note's table were re-run, one at a time. Each file was restored byte
    for byte, and `git status` was clean after each:
    - #17, a purchase priced at its first unit: "costs the same bought in one order or in two"
      fails, 393 credits apart against at most 1;
    - #41, a lost city's orders not refunded: "refunds the orders of a city lost to the sea" fails.
  - Simulation rules:
    - `stepEarth` and `divertResearch` run inside `advance`, every substep;
    - a ragged-chunk test covers windows, landings and contracts;
    - all 31 `EARTH_*` constants are in `tuning.ts` and the section 10 table;
    - `src/sim/` imports nothing from `src/web/` or `src/render/`;
    - the panel's actions go through `orderFromEarth`, `cancelEarthOrder` and `acceptContract`, as
      Batch 33's choices do;
    - save v19 has a v18 -> v19 migration and a test loading a v18 save.
  - GAME_PLAN's row is COMPLETE, with the note linked, the deliverables ticked and the changes
    from the plan recorded. README has the batch.
  - The manual has Update 34 at the top (New, Changed and Known issues; nothing fixed) and a new
    Earth page, and the pages it touches are updated. Statements checked against the code:
    - the trip is 3 min 12 s at Standard (23 substeps of 0.03125 planet-years);
    - a contract is due by the third window after its offer (`due = k + EARTH_CONTRACT_WINDOWS`);
    - contracts pay 4, 6 and 2 credits a unit;
    - water contracts are 40 to 80 at Standard and 10 at Classic;
    - a new world starts at reputation 50, "Neutral".
  - Every decision is one a bare "Go" would accept, and none deletes or overwrites player data.
  - Not grounds for rejection, recorded for later:
    - **Buying a contract's materials from Earth can pay at high reputation.** Measured on seed 7:
      at reputation 100, buying a materials contract's whole amount from Earth costs up to 230
      credits less than the contract pays at Standard (53 at Classic). At 50 it loses 217 on
      average at Standard; 2 of 50 windows gain.
    - **A rocket landing at a lost city loses its cargo unrefunded** (`landFlights`,
      `src/sim/earth.ts:476-503`). The orders still waiting are refunded. No city can be lost in
      the browser until flooding is turned on (Batch 38).
- fix 1: done (session 2, 2026-10-16)
  1. The seven tests broken, one fault at a time, each file restored byte for byte and `git status`
     checked after each: 17 faults (53 to 69 in the note's table), every one run against the Earth
     tests (the simulation's, the panel's and the exit gate's). All seven tests failed:
     - `src/sim/earth.test.ts` "misses it too with no finished spaceport": a missed window recorded
       only for a spaceport going up (53), the orders of a city with none dropped unrefunded (54);
     - `src/web/earth-gate.test.ts` "is the orbit's period": the period a round 2 years (55, caught
       by five other tests too);
     - the Standard trading measurement: Earth's credits never reaching the bank (56; the city of
       1,000 at 7,767 s both ways). A materials contract paying a tenth (57, 0.4 credits a unit,
       less than Earth pays for a sale) passed every Earth test: nothing said a contract pays
       better than the market. A test now does ("what a contract pays", in the gate file: at
       least 1.71 times Earth's best price at full reputation over 40 windows at both paces,
       research more than the bank), and it catches 57 and research at half pay (58);
     - `src/web/earth.test.ts` "is not there in a world without Earth": the button in every world
       (59, as the review's spot check);
     - "shows the standing, the next launch window and Earth's prices": the window one late (60),
       settlers and rovers priced while locked (61), "Earth pays" showing what Earth asks (62);
     - "shows the rocket away": "home in" counted to the launch (63), the record oldest first (64),
       the list redrawn only as the orders change (65; it failed on a null, so the test now checks
       first that the rocket is listed, and says so);
     - "offers Earth's contract": the button never saying an offer waits (66), the offer's
       reputation gain and loss swapped (67), the bar full from the start (68), Accept never
       reaching the simulation (69).
     The note's totals (`docs/balance/batch34-earth.md` item 10, the new item 11 and "Injection
     run") and this entry's `found:` and `injections:` lines now say 71 faults: 62 caught at once,
     4 after a new or stronger test, 2 masked and caught as coherent faults, 1 the save check.
  2. `src/sim/tuning.ts`: the contract sizes' comment says 150 to 310 materials at Standard.
  - Nothing the player sees changed, so the manual is unchanged.
  - checks: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 118 files, 1,394
    tests, all passed (384 s; the Known-red opening test passed); build:web green (602.24 kB JS,
    203.45 kB gzip, past Vite's 500 kB warning as recorded since Batch 31; 48.67 kB CSS); build
    green.
  - commits: the commit recording this
- review 2: accepted
  - Both of review 1's problems are fixed:
    1. Every new test is in the injection table now. Each of the batch's 47 Earth tests (28 in
       `src/sim/earth.test.ts`, 10 in `src/web/earth-gate.test.ts`, 9 in `src/web/earth.test.ts`)
       was checked against the "Caught by" column, and every one is named in at least one row. The
       seven review 1 listed are rows 53 to 69. The test the fix round added ("what a contract
       pays") is rows 57 and 58, and its measurement (at least 1.71 times Earth's best price) sits
       beside its threshold.
    2. `src/sim/tuning.ts:1285` says 150 to 310 materials at Standard.
  - Checks in this round:
    - typecheck green;
    - `npx vitest run --maxWorkers=2 --minWorkers=1`: 118 files, 1,394 tests, all passed (434 s;
      the Known-red opening test passed);
    - `build:web` green (602.24 kB JS, 203.45 kB gzip, past Vite's 500 kB warning as recorded
      since Batch 31; 48.67 kB CSS);
    - `build` green.
  - Two injections from the fix round, one at a time. Each file was restored byte for byte, and
    `git status` was clean after each:
    - #57, `EARTH_CONTRACT_PAY_MATERIALS` at 0.4: "what a contract pays" fails (0.179 against more
      than 1);
    - #63, the panel's "home in" counted to the launch (`f.launched` for `f.arrives`): "shows the
      rocket away and when it is home" fails on its "home in 3 min 1x s".
  - Checked again, and review 1's findings still hold:
    - the exit gate;
    - the simulation rules (`stepEarth` and `divertResearch` in `advance`, every substep, the
      research sum the same expression with Earth off);
    - the panel's actions, which go through `orderFromEarth`, `cancelEarthOrder` and
      `acceptContract`;
    - save v19 and its migration;
    - the decisions;
    - GAME_PLAN's row and README.
  - Manual statements checked against the code in this round:
    - the button reads "Earth (an offer)" when one stands (`src/web/earth.ts:188`);
    - the reputation words, with 50 "Neutral" (`src/web/earth-words.ts:29-35`);
    - the market is "about double after 2,000 credits' worth" and forgets half each window
      (`EARTH_MARKET_DEPTH`, `EARTH_MARKET_RECOVERY`);
    - a settler with no home is refunded what was paid (`landFlights`);
    - water contracts are always 10 at Classic (2.4 x 2.135 x 1 to 2, rounded to tens, at least
      10);
    - the away line reads "Earth: a contract met, a contract failed - see Earth"
      (`src/sim/offline.ts:215`).
  - Seen, not a ground for rejection:
    - The injection totals say 71 faults, and the table has 69 rows. The other two are #30 and #35
      injected again as coherent faults, and the note says so. "62 + 4 + 2 + 1" counts rows.
    - "What a contract pays" checks research on a world one second old, which earns no research.
      Every research contract there is the floor of 10, so its half checks only the ratio of pay
      to amount. That is what it is for, and #58 shows it catches half pay.

### Batch 35 - Sound: music, ambience and effects
- status: complete
- note: docs/balance/batch35-sound.md
- manual: docs/manual/sound.md (new: when sound starts, the music by phase, ambience, effects,
  alerts and buttons, the sound settings), docs/manual/update-notes.md (Update 35, the current known
  issues), docs/manual/README.md (contents, the game in one minute), docs/manual/getting-started.md
  (Settings, silent until the first click), docs/manual/controls.md (the menu's Settings),
  docs/manual/alerts-and-statistics.md (the pop-ups' sounds), docs/manual/events.md (the card's
  sound), docs/manual/goals.md (the chime), docs/manual/earth.md (the rocket's roar),
  docs/manual/worlds-and-saving.md (settings kept apart from worlds); docs/credits.md (new)
- commits: 8310ca6 (started), 5fd646e, 7497e34, b0eec95, 7a0fc24, 09c4f00, and the completing commit
- sessions: 1 (2026-10-16)
- found:
  - the title's music stopped after half a second: only a world's frame loop asked the engine to
    write notes, and the title has none. Every test drove `frame` itself. The injection run found
    it (the game's call removed changed no test); the engine keeps its own 200 ms clock now.
  - the injection run found five weak or missing tests (a claim's false finish heard at the wrong
    time; the world from the title never checked to use the title's engine; a refused placement
    never reaching the place hook because the card was chosen twice; leaving for orbit from
    silence) and one of its own faults that did not compile; all fixed and caught.
  - the music's first test was vacuous: Cold Ground's notes all lie in First Water's mode; it now
    follows each note to the piece it feeds.
  - a rocket test passed with no rocket (refused: the stores were full); launches now assert.
  - docs/AUTO_BATCH_SETUP.md (untracked, not this batch's) left as it is.
- decisions:
  - Every sound made by the game (oscillators and generated noise), no files: "self-made", nothing to
    license or download; recorded in docs/credits.md with Lexend's licence.
  - No AudioContext at all before the first pointerdown, keydown or touchend; effects asked for
    before are dropped, the music and beds asked for start at the gesture.
  - The music follows the phase reached (only goes forward), not the current phase: never flips at
    a boundary. The title plays Phase 0's piece.
  - Rain derived from clouds over open water above freezing (the simulation has no rain); a dust
    storm blows the wind harder.
  - Alerts, objectives, milestones and buttons on the interface channel; the world's effects on the
    effects channel, placed in the city view by the camera's ear.
  - While the Instruments drawer's example planet shows, its happenings (built, upgraded, rockets) are
    not heard; its music and beds are. The title's Example planet (a look-only world, its alerts and
    cards shown) is heard in full. Corrected to the browser in review 1 (see fix 1).
  - Sound constants are browser constants in src/web, not tuning.ts and section 10: they change
    nothing the simulation computes, like config.ts's.
  - Settings kept per player as a "settings" record in the store's index beside the worlds list;
    the rest of the record kept for Batch 36. A master volume and mute beside the four channels.
  - At most three of one effect a look (a high speed finishes dozens of buildings a second).
  - Batch 30's chime.ts removed: it made its own AudioContext outside any gesture.
- verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 120 files, 1,428
  tests, all passed (454 s; the Known-red opening test passed); build:web green (623.88 kB JS,
  210.56 kB gzip - past Vite's 500 kB warning, as recorded since Batch 31; 49.29 kB CSS); build
  green; the built page, its script and its styles served and fetched over HTTP (the script holds
  "Master volume" and "Cold ground", the styles the sound panel). The simulation is unchanged: the
  golden run, golden frames, Batch 3 score and determinism are in the suite as they were.
- injections: 80 faults, one at a time, each file restored byte for byte and checked: 73 caught at
  once; 4 caught once a test was added or strengthened (35, 65, 69, 75); 1 showed a defect (72, the
  title's music; fixed, its replacement faults 79 and 80 caught); 1 changes nothing as written (44,
  a second guard; caught coherent as 75); 1 was no fault (55, did not compile; redone as 76, caught).
  The table is in the note.
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch35-sound.md
  docs/credits.md docs/manual/README.md docs/manual/alerts-and-statistics.md
  docs/manual/controls.md docs/manual/earth.md docs/manual/events.md
  docs/manual/getting-started.md docs/manual/goals.md docs/manual/sound.md
  docs/manual/update-notes.md docs/manual/worlds-and-saving.md src/web/app.ts src/web/chime.ts
  (deleted) src/web/city.ts src/web/fake-audio.ts src/web/game.ts src/web/main.ts
  src/web/milestones.ts src/web/onboarding.test.ts src/web/sound-ambience.ts src/web/sound-cues.ts
  src/web/sound-director.ts src/web/sound-engine.ts src/web/sound-gate.test.ts
  src/web/sound-music.ts src/web/sound-panel.ts src/web/sound-recipes.ts src/web/sound-settings.ts
  src/web/sound.test.ts src/web/style.css
- review 1: rejected
  1. The manual and the batch's decision say the Example planet's buildings finishing and rockets
     lifting off are not heard. On the Example planet a player reaches (the title's **Example
     planet** button, the only one the manual names) they are heard. Nothing tests the game's
     wiring of that decision.
     - The game silences the happenings only while the Instruments drawer's "See example planet"
       shows: `src/web/game.ts:929` passes `cues: !example.active`. The title's Example planet is
       launched as a look-only world (`src/web/app.ts:484`, `lookOnly`). That never enters
       `ExampleMode` (`example.enter` is called only at `src/web/game.ts:737`), so `example.active`
       is false and every cue plays.
     - Measured in this review: `src/web/sound-gate.test.ts`'s assembled-game test, run with
       `lookOnly: { banner: "Example planet" }` added to `startGame`'s options, still passes. On a
       look-only world, a greenhouse finished at 1000x plays "built" once, and the objective
       chime plays as well.
     - Statements that are false as written:
       - `docs/manual/sound.md:79-80`: "On the **Example planet** you hear its music, its wind and
         its cities, but not its buildings finishing or its rockets lifting off";
       - `docs/manual/update-notes.md:46` and `:410` (known issues): "On the Example planet,
         buildings finishing and rockets lifting off make no sound";
       - the decision as recorded: `docs/balance/batch35-sound.md:147`, `GAME_PLAN.md:811` and
         this entry's `decisions:` (`:1157`). Its reason, "as its milestones and alerts are not
         shown", does not hold for the title's Example planet either: there `mine` and the alerts
         go by `!example.active` too, so they are shown.
     - Untested: replacing `cues: !example.active` with `cues: true` at `src/web/game.ts:929`
       fails none of `sound.test.ts`, `sound-gate.test.ts` or `onboarding.test.ts` (48 tests
       passed). The "example's happenings" tests and injection 49 reach only the director called
       with `cues: false`. The note's item 7 (`docs/balance/batch35-sound.md:58-62`) says this
       wiring now has a test; it does not.
     - Needed, either way:
       - Make the browser and the record agree. Either the title's Example planet silences its
         happenings as decided (for example `cues` false for a look-only world too), or the
         manual, the known issues and the decision say what the browser does: the title's Example
         planet heard in full, and only the Instruments drawer's example silent, named as it is
         on screen.
       - Add a test through the assembled game for the behaviour chosen, with its injection
         recorded (the wiring at `game.ts:929` broken), and correct the note's item 7.

  Checked in this round, and sound:
  - Typecheck green. `npx vitest run --maxWorkers=2 --minWorkers=1`: 120 files, 1,428 tests, all
    passed (379 s; the Known-red opening test passed). `build:web` green (623.88 kB JS, 210.56 kB
    gzip, past Vite's 500 kB warning as recorded since Batch 31; 49.29 kB CSS). `build` green.
  - Every deliverable is built:
    - one engine with four channels and a master, and no `AudioContext` before a gesture;
    - music by the phase reached, crossfaded over 8 s;
    - wind, rain, sea and machinery beds;
    - the seven effects, placed in the city view;
    - volumes kept per player in the store's index.
  - Each of the exit gate's points has a test:
    - a scripted run heard every substep on deep-frozen states `toEqual` the run not heard;
    - each effect once per event, against the fake context;
    - each bed following its driver;
    - the music changing with the phase and never cut;
    - no context before a gesture, for the engine, the title and the assembled game.
  - `docs/credits.md` lists Lexend's licence (loaded from Google Fonts by `index.html`) and the
    game's own sounds.
  - Every one of the 34 new tests (24 in `sound.test.ts`, 10 in `sound-gate.test.ts`) is named in
    the note's injection table. The note leads with what went wrong and carries its measurements.
  - Two injections re-run, one at a time. Each file was restored from its backup, and
    `git status` was clean after each:
    - #16, the old piece writing on after its fade (`sound-music.ts:232`): the crossfade test
      fails ("expected [ FakeOscillator ... ] to deeply equal []");
    - #79, the engine's clock never started (`sound-engine.ts:209`): the title test fails
      ("notes written 20 s on: expected 0 to be greater than 0").
  - Simulation rules:
    - nothing in `src/sim/` changed;
    - the sound reads the state and never writes it;
    - no save change: the settings are a separate `settings` meta record, distinct from
      `worlds`;
    - the sound constants live in `src/web/`, as decision 7 records.
  - `GAME_PLAN.md`'s row is COMPLETE with the note linked and the changes from the plan recorded;
    `README.md` has the batch's paragraph; `update-notes.md` has Update 35 at the top.
  - Manual statements that match the code:
    - a building finished, an upgrade done and a contract met make no alert sound: their alerts
      are `record` priority, and the director skips those;
    - **Mute all sound** keeps the levels: it sets only the master gain to 0;
    - the sea is not heard from about 1,500 m above it (`SEA_HEARD_M` 1500);
    - a missed launch window and a failed contract sound as an alert (`notice` priority);
    - the Earth rocket roars: it is a `rocket` job, which the cue watch hears.
  - Seen, not grounds for rejection: some lower bounds in `src/web/sound.test.ts` do not have
    their measured value beside them. Measured here:
    - the machinery near the camera is 0.19, bounded at more than 0.05 (`:460`);
    - First water writes 75 notes, bounded at more than 10 (`:555`), over 20 distinct pitches,
      bounded at more than 3 (`:562`).
- fix 1: done
  1. The Example planet heard: the record now follows the browser, not the other way. The title's
     Example planet shows its alerts, objectives and milestone cards and lets the player build, so
     it is heard in full. While the Instruments drawer's **See example planet** shows, none of those
     show, and its built, upgraded and rocket sounds do not play either. That is where the decision's
     own reason ("as its milestones and alerts are not shown") holds. No game code changed.
     - decision: the browser's behaviour kept (the reviewer's second option). Silencing the title's
       look-only world would have left its alert and objective sounds playing beside unheard
       buildings, and its player's own builds unheard.
     - tests: two through the assembled game in `src/web/sound-gate.test.ts`. The title's look-only
       world (`lookOnly`, `mayPersist` false, its banner shown) hears its greenhouse finish once at
       1000x. The drawer's example is entered by its button, the example's build replaced by a
       stand-in world (`vi.mock` of `examplePlanet`) so it takes no forty seconds. It does not hear
       its greenhouse finish, which its city's line in the list shows went from "going up" to done.
       Its music and wind still play.
     - injections, one at a time, `game.ts` restored from a backup and `git diff` clean after each:
       81, `cues: true` at `game.ts:929`: the drawer test fails ("the drawer's example heard
       finishing a building: expected 1 to be +0"); 82, `cues: !example.active &&
       !options.lookOnly`: the title test fails ("the title's Example planet heard finishing its
       building: expected undefined to be 1"). Each passes the other test.
     - record corrected: `docs/manual/sound.md` (both examples, the drawer's named as on screen);
       `docs/manual/update-notes.md` (the false known issue gone from Update 35 and from the current
       list); `docs/balance/batch35-sound.md` (item 7 corrected, item 12 the review's finding,
       decision 6, injections 81 and 82 in the table); `GAME_PLAN.md` decision 6; this entry's
       `decisions:`.
  - not changed: the lower bounds the review saw without their measurements beside them (not a
    rejection item).
  - verification: typecheck green; the three sound files (`sound.test.ts`, `sound-gate.test.ts`,
    `onboarding.test.ts`) 50 tests passed; `npx vitest run --maxWorkers=2 --minWorkers=1`: 120
    files, 1,430 tests, all passed (426 s; the Known-red opening test passed); build:web green
    (623.88 kB JS, 210.56 kB gzip, unchanged; 49.29 kB CSS); build green.
  - files: GAME_PLAN.md docs/PROGRESS.md docs/balance/batch35-sound.md docs/manual/sound.md
    docs/manual/update-notes.md src/web/sound-gate.test.ts
- review 2: accepted
  - Review 1's problem is fixed. The record now says what the browser does:
    - the title's **Example planet** (a look-only world, its alerts, objectives and cards shown)
      is heard in full;
    - only while the Instruments drawer's **See example planet** shows (`cues: !example.active`,
      `src/web/game.ts:929`) are its built, upgraded and rocket sounds silent.
    - Checked against the code: in the drawer's example `mine` is false, so no alerts, objectives
      or cards show (`game.ts:1020-1027`); trains, machinery and placement are not gated by
      `cues`. That matches `docs/manual/sound.md:79-86` and decision 6 as now recorded.
    - The false known issue is gone from both lists in `update-notes.md`.
  - The two new tests in `src/web/sound-gate.test.ts` go through the assembled game. The drawer's
    test enters the example by its button and has its own vacuity guard: the greenhouse is seen
    finished in the city's line.
  - Re-run in this round, one at a time, `game.ts` restored from a backup, `git status` clean
    after each:
    - #81, `cues: true`: the drawer test fails ("the drawer's example heard finishing a building:
      expected 1 to be +0"), the other 11 pass;
    - #82, `cues: !example.active && !options.lookOnly`: the title test fails ("the title's
      Example planet heard finishing its building: expected undefined to be 1"), the other 11 pass.
  - Typecheck green. `npx vitest run --maxWorkers=2 --minWorkers=1`: 120 files, 1,430 tests, all
    passed (500 s; the Known-red opening test passed). `build:web` green (623.88 kB JS, 210.56 kB
    gzip, past Vite's 500 kB warning as recorded since Batch 31; 49.29 kB CSS). `build` green.
  - Manual statements checked against the code:
    - the default levels 80/60/70/80/70% (`DEFAULT_SOUND`);
    - quiet on another tab (`visibilitychange` suspends the context);
    - **Credits** on the title (`app.ts:201`);
    - the drawer's button named as on screen ("Instruments", "See example planet").
  - Seen, not grounds for rejection: the note's measurements still say `sound-gate.test.ts` has
    10 tests (`docs/balance/batch35-sound.md:199`); it has 12 since fix 1.

### Batch 36 - Settings, controls and accessibility
- status: complete
- note: docs/balance/batch36-settings.md
- manual: docs/manual/settings.md (new: every setting), docs/manual/controls.md (rewritten: every
  keyboard shortcut, the mouse, a trackpad and touch in every view, the menu's last save and
  Settings), docs/manual/update-notes.md (Update 36, the current known issues),
  docs/manual/README.md (contents, the game in one minute), docs/manual/worlds-and-saving.md
  (autosave interval, Ctrl+S, last saved and where the worlds are kept, settings kept apart),
  docs/manual/alerts-and-statistics.md (pop-up alerts setting, "Alerts (3, 1 urgent)", N),
  docs/manual/cities.md (claimable land's edges, the planner's patterns, legend and the line under
  the map, palettes), docs/manual/sound.md (the Settings panel), docs/manual/getting-started.md
  (Settings), docs/manual/the-planet.md (the keys)
- commits: 781211a (started), ccca07b, 089106a, dfa068b, 94b072e, 9e6d258, 2969e9f, and the
  completing commit
- sessions: 1 (2026-10-16)
- found:
  - binding Esc from the world's menu would have closed the menu: the game's key handler hears keys
    before the panel's; the panel now says when it waits for a key and the game stands aside.
  - a wheel with no position (happy-dom's) set the city camera to NaN for good; it now zooms about
    the middle.
  - an autosave is written once per frame until the first write lands (Autosaver.due reads the
    last finished write) - older than this batch, recorded under the note's Open for Batch 40.
  - the register of colour rules found two colour-only cues: the Alerts button's "urgent" (only in
    its spoken label) and a milestone in the planet's news; both now say it on screen.
  - moving details off would have frozen a rocket in mid-air; a rocket in flight stays live, in the
    chunk its spaceport is drawn with.
  - in a city, Esc did not close the game menu (older); it does now, and the city under it does not
    hear the key.
  - the injection run found two weak tests: the cue test read spoken labels (40), and the page
    colours were bounded by their closest pair only (51); both strengthened.
  - docs/AUTO_BATCH_SETUP.md (untracked, not this batch's) left as it is.
- decisions:
  - A store of their own: a third IndexedDB object store, `player` (database v3), the v1 record
    in the worlds' index read once, written there, never deleted; the store closes on
    versionchange so a newer page is not blocked.
  - Shortcuts made, then made rebindable: the game had one key (Esc). 21 actions by physical key
    (`code`, Cmd as Ctrl), two slots each; a key taken is swapped, never lost; any key binds, Esc
    too (Cancel and Clear are buttons); Reset keys.
  - Edge scrolling off by default (the pointer crosses the window's edge on its way elsewhere);
    camera speed 0.5x-3x for the keys and the edge.
  - Invert zoom on every wheel; a wheel with Ctrl (a trackpad's pinch) zooms 6x as strongly and is
    never inverted; two fingers pan by choice; two touches pinch, in every view.
  - Frame time measured on the player's machine, per level and per effects on or off, and shown:
    an unattended run cannot time a browser.
  - "Effects" are the city's moving details; off, drawn still into the pictures; vehicles and a
    rocket in flight still move. The globe's weather is the planet's state and is left alone.
  - Panels scaled with CSS `zoom`, never a canvas or the countdown labels: pointer sums unchanged.
  - Palettes swap the zones' first colours at drawing, never in the world; a colour the player
    picked is kept; networks keep their colours (they differ in lightness for every kind of colour
    blindness) and gain patterns.
  - Autosave never off: 15 s (Batch 4's), 30 s, 1 min, 5 min.
  - Batch 31's open item taken: which alerts pop up (all, urgent only, none); one that does not pop
    up is not heard; the Alerts panel keeps every one.
  - Batch 33's open item (no events while away) declined: it would change the simulation.
  - Settings constants are browser constants in src/web, not tuning.ts and section 10: they change
    nothing the simulation computes.
- verification: typecheck green; npx vitest run --maxWorkers=2 --minWorkers=1: 123 files, 1,473
  tests, all passed (542.7 s; the Known-red opening test passed); build:web green (655.03 kB JS,
  221.53 kB gzip - past Vite's 500 kB warning, as recorded since Batch 31; 52.14 kB CSS); build
  green; the built page, its script and its styles served and fetched over HTTP (the script holds
  the settings' words, the styles the palettes, --ui-scale, reduced motion and high contrast).
  Nothing in src/sim changed; the golden run, golden frames, Batch 3 score and determinism are in
  the suite as they were.
- injections: 56 faults, one at a time, each file restored from a backup and checked: 54 caught at
  once; 40 (the Alerts button's urgent in colour only) caught once the cue test read only what is
  on screen; 51 (the page's red-green "good" left green) changes nothing the test can call wrong -
  still 93.1-103.4 apart for deuteranopes, measured - and 54, two of the standard's colours put
  back, is caught. The table is in the note.
- review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch36-settings.md
  docs/manual/README.md docs/manual/alerts-and-statistics.md docs/manual/cities.md
  docs/manual/controls.md docs/manual/getting-started.md docs/manual/settings.md
  docs/manual/sound.md docs/manual/the-planet.md docs/manual/update-notes.md
  docs/manual/worlds-and-saving.md src/render/city.ts src/web/alert-centre.test.ts
  src/web/alert-centre.ts src/web/app.ts src/web/city-chunks.ts src/web/city.ts
  src/web/frame-costs.ts src/web/game.ts src/web/gestures.ts src/web/globe.ts src/web/hud.test.ts
  src/web/hud.ts src/web/interface.ts src/web/journey.ts src/web/keys.ts src/web/orbit.ts
  src/web/palette.ts src/web/planner.ts src/web/settings-cues.test.ts
  src/web/settings-gate.test.ts src/web/settings-panel.ts src/web/settings.test.ts
  src/web/settings.ts src/web/sound-gate.test.ts src/web/sound-settings.ts src/web/storage.ts
  src/web/style.css src/web/test-frames.ts src/web/travel-prompt.ts src/web/travel.ts
  src/web/world-map.ts
- review 1: rejected
  1. The exit gate's second cue is not checked for a railway laid in a city, on the planner's map.
     The legend says "Railway (striped)" and the manual says a railway is striped, but no test lays
     one.
     - `src/web/settings-cues.test.ts:403` is titled "tells a power line, a railway, a plan, a gap
       and a zone's edge from their neighbours by pattern". Its city (`planned()`, line 390) only
       *plans* a railway (line 399, `planLinks`); it lays none, so `view.rails` is empty and the
       stripe is never looked at. `describeTile`'s "railway" (`src/web/planner.ts:449`) is never
       reached by a test either.
     - Measured in this review: with `src/web/planner.ts:165` changed to `set(i, RAIL_RGB)` (a
       railway drawn solid), `settings-cues.test.ts` and `planner.test.ts` pass, 15 of 15. No other
       test calls `plannerPixels` on a laid railway (`people.test.ts`, `planner.test.ts` checked).
     - Wanted: lay a railway in the test's city, assert its two lightnesses in every palette and
       that the line under the map names it "railway"; break each once.
  2. Nothing tests that a shortcut cannot act under the open game menu. `src/web/game.ts:399`
     (`if (pausedFrom !== null && action !== "menu" && action !== "save") return;`) is the only thing
     between a key and a world the menu is holding still: without it, Space or 1-4 call `setSpeed`
     (`src/web/game.ts:311`) and the world runs behind the open menu, and M, B and P move the view
     under it. The manual states the rule (`docs/manual/controls.md:32`: "While the game menu is
     open, only Esc (to close it) and Ctrl+S work").
     - Measured in this review: with that line removed, `src/web/settings-gate.test.ts` passes, 22
       of 22.
     - Wanted: a test that opens the menu (`setPaused(true)`), presses the pause, a speed and a panel
       key, and finds the world still held and nothing opened; break the guard once.
  3. The world map's settlements are a colour code the batch did not register or check. On the map
     a metropolis is yellow, a city blue and an outpost grey (`src/web/world-map.ts:118`, drawn at
     line 451); their second cue (the mark's size, 5, 3.5 and 2.5 px further out, the land held up
     close) is in no test, and they are not among the cue test's elements. The exit gate asks for
     every colour-coded element, checked in the happy-dom harness; the note and README say every
     colour code has a second cue.
     - Wanted: register the world map's marks with their cue (or give them one that is checked),
       and test it.
  - Otherwise as recorded: typecheck green; `npx vitest run --maxWorkers=2 --minWorkers=1` 123
    files, 1,473 tests, all passed (464.0 s; the Known-red opening test passed); `build:web` green
    (655.03 kB JS, 221.53 kB gzip; 52.14 kB CSS); `build` green. Injections 10 (no swap on a taken
    key) and 36 (the game takes the key the panel waits for) re-run one at a time in a separate
    worktree: both caught as the table says; tree clean after each. Nothing in `src/sim/` changed;
    the walls hold; Batch 35's record is moved and never deleted; the manual's statements checked
    against the code (the pictures' 48/96/144 MB, the speed keys per pace, the line under the
    planner's map, a landing rocket still moving with moving details off) hold.
- fix 1: done
  1. A railway laid in the cue test's city (`settings-cues.test.ts`, `planned()`): the pattern
     test asserts its two lightnesses in every palette, and the pointer test that the line under
     the map names it "railway" (not "railway planned"). Review 1's fault (`planner.ts:165` drawn
     solid) caught: "standard: railway striped: expected 1 to be 2"; the word taken out caught:
     "Here: open ground.".
  2. `settings-gate.test.ts`, "under the open game menu no shortcut acts but its own key and
     Save": in orbit, `setPaused(true)`, then Space, 1-4, N, C, E, O and M - the world still held
     (speed 0, no steps), no panel and no map open; Ctrl+S still saves; closed, the same keys act.
     In a city, B, P, U, = and - and a camera key held from before the menu opened - still in the
     city, no planner, the camera unmoved; closed, P opens the planner. The guard at
     `game.ts:399` taken out: caught ("the world is still held: expected 10 to be 0"); the held
     camera keys' guard (`game.ts:472`) taken out: caught (286.7 px moved).
  3. The world map's settlements given shapes by kind (`world-map.ts`, `drawMark`): an outpost a
     square, a city a disc, a metropolis a larger diamond, a ruin crossed out, outlined dark, at
     every zoom (up close over the land held). `settings-cues.test.ts`, "the world map's marks":
     a recording context, each mark's path taken about its point and scaled to one size (so size
     alone is not a shape), far out and up close, in the kinds' colours and in gold (where a city
     and a metropolis are one colour). Five faults, one at a time, all caught: the map as it was
     (three discs one shape), every kind a disc, a ruin not crossed, a metropolis a square, the
     mark only far out.
  - Player documentation: docs/manual/cities.md (the world map's marks), docs/manual/update-notes.md
    (Update 36, Changed). Note: item 10, the injection table (57-65, 65 faults in all), the
    verification after the fixes. GAME_PLAN.md and README.md: the world map's shapes.
  - verification: typecheck green; `npx vitest run --maxWorkers=2 --minWorkers=1`: 123 files,
    1,475 tests, all passed (533.1 s; the Known-red opening test passed); `build:web` green
    (655.42 kB JS, 221.67 kB gzip; 52.14 kB CSS); `build` green. Nothing in `src/sim/` changed.
  - commits: 449c73b (fix 1), 51c70d9 (fix 2), adfdf68 (fix 3), and the review 1 fixes commit.
  - review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch36-settings.md
    docs/manual/cities.md docs/manual/update-notes.md src/web/settings-cues.test.ts
    src/web/settings-gate.test.ts src/web/world-map.ts
- review 2: rejected
  1. The charts (Statistics and the planner's Charts tab) tell their lines apart by colour alone.
     They are a colour code that is not registered, not covered by the colour-blind palettes and not
     checked. The exit gate asks for a second, non-colour cue on every colour-coded element, checked
     in the happy-dom harness. The player's notes say "Colour is never the only way the game tells
     you something" (`docs/manual/update-notes.md:11`). README.md:186 and GAME_PLAN.md:867 say
     every colour code has a second cue.
     - `src/web/charts.ts:175` strokes every series as a solid 1.5 px line, differing only in
       colour. The key (`charts.ts:128-135`) links a name to its line only by a colour swatch
       (`:132`). The charts with more than one series are: Population (People and Homes, `:47-50`),
       Growth and deaths (Born `#6fd08c` and Lost `#ef6b6b`, `:52-53`), Shortages (four bars side
       by side, each under a pixel wide, `:55-59`), Stores and Made less drawn (five lines each,
       `:61-62`), and the five "made and used" charts (Made in the resource's colour, Used always
       `#ef6b6b`, `:71-72`). The key's latest values do not say which line is which, and they
       cannot help when the two values are close, as made and used are in a balanced city.
     - Measured in this review with the cue test's own simulation (Machado et al.,
       `settings-cues.test.ts:653-680`): Food made `#e38b4f` and used `#ef6b6b` are 44.2 apart for
       normal sight, 30.1 for deuteranopes and 40.7 for tritanopes. Materials made and used are
       38.0 apart for deuteranopes, and Born and Lost 52.5. The batch's own tests treat anything
       under 45 as a failure for a palette's closest kinds (`settings-cues.test.ts:721-722`). No
       palette changes these colours: `src/web/palette.ts` has no chart colours. The cue test
       never draws a chart, and its register has no entry for one, either with a cue or with a
       reason it needs none.
     - Wanted: give every series of a chart with more than one a cue besides its colour, for
       example a dash pattern repeated in its key swatch, or its name at the end of its line.
       Register the charts among the canvases' colour codes, test from what the chart's canvas
       draws that the series differ without their colours, and break that test once.
  - Review 1's three problems are fixed. A railway is now laid in the cue test, striped in every
    palette and named under the pointer. A test holds every shortcut back under the open game menu,
    in orbit and in a city, a held camera key included. The world map's settlements have shapes by
    kind at every zoom, tested from what the map draws (scaled to one size), in gold as well.
    Injections 59 (the menu guard at `game.ts:399` commented out: "the world is still held:
    expected 10 to be +0") and 63 (a ruin not crossed out: "far out: a ruin and a city") were
    re-run one at a time in a separate worktree. Both were caught as the table says, and the tree
    was clean after each.
  - Otherwise as recorded: typecheck green; `npx vitest run --maxWorkers=2 --minWorkers=1` 123
    files, 1,475 tests, all passed (510.0 s; the Known-red opening test passed); `build:web` green
    (655.42 kB JS, 221.67 kB gzip; 52.14 kB CSS); `build` green. Nothing in `src/sim/` changed
    across the batch, and the walls hold.
  - Manual checked against the code, all true: the world map's marks (an outpost a grey square, a
    city a blue disc, a metropolis a larger yellow diamond, `world-map.ts:118-157`); a settlement
    lost to the sea grey and crossed out; gold for cities and metropolises but not outposts
    (`:488`); up close, the mark in the middle of the land held; under the open menu only Esc and
    Ctrl+S (`game.ts:399`).
- fix 2: done
  1. The charts' lines told apart without their colours (`src/web/charts.ts`): in a chart of more
     than one line each line has a pattern by its place - solid, dashed, dotted, dash-dot, long
     dashes - and its key draws a sample of the line in its colour and pattern and names it
     ("Homes (dashed): 320"); Made solid and Used dashed on all five made-and-used charts. The
     shortages a strip each, top to bottom in the key's order, its name over its bars, where four
     bars to a year were each under a pixel wide. `settings-cues.test.ts`, "the charts": Statistics
     on a city and on the planet and the planner's Charts tab, each chart's canvas recorded; all 19
     charts registered by how their series are told apart (patterns, strips, one line), checked
     both ways; lines no two alike without their colours, the key's sample the line's dash, the
     pattern's name true of it; each strip named, its bars inside it. Nine faults, one at a time,
     all caught, `cmp` against the backup after each (66-74): every line solid (review 2's fault:
     "Population: lines told apart without colour: 1 looks for 2 lines"), the key's sample solid,
     the pattern not named, dashed and dotted named the wrong way round, the shortages side by side
     again, the strips not named, every strip in one place, a chart renamed (not registered), the
     fifth line given the first's pattern. Drawn to a PNG by a scratch software context and looked
     at: the five patterns distinct at 1.5 px, Made and Used apart where they nearly meet.
  - Every other canvas read in the code (not tested): sparklines one line beside a named metric,
    the city's badges shapes, the world map's railways one colour, the globe and pictures no code.
    The palettes reach the page, the city and the planner's map only: GAME_PLAN's "every canvas
    colour code" and README's "the canvases" corrected to that.
  - Player documentation: docs/manual/alerts-and-statistics.md (the charts' patterns and the
    shortages' strips), docs/manual/cities.md (the planner's Charts), docs/manual/settings.md (the
    charts and the world map keep their colours), docs/manual/update-notes.md (Update 36, Changed).
    Note: item 11, the injection table (66-74, 74 faults in all), the verification after the fix.
    GAME_PLAN.md (review 2's fix, the palettes' reach) and README.md (the charts' cue).
  - verification: typecheck green; `npx vitest run --maxWorkers=2 --minWorkers=1`: 123 files,
    1,476 tests, all passed (451.8 s; the Known-red opening test passed); `build:web` green
    (656.72 kB JS, 222.17 kB gzip; 52.19 kB CSS); `build` green. Nothing in `src/sim/` or
    `src/render/` changed.
  - commits: c030a4b (the fix), and the review 2 fixes commit.
  - review request: GAME_PLAN.md README.md docs/PROGRESS.md docs/balance/batch36-settings.md
    docs/manual/alerts-and-statistics.md docs/manual/cities.md docs/manual/settings.md
    docs/manual/update-notes.md src/web/charts.ts src/web/settings-cues.test.ts src/web/style.css
- review 3: accepted
  - Review 2's problem is fixed. Every chart with more than one line now gives each line a
    pattern by its place: solid, dashed, dotted, dash-dot, long dashes (`src/web/charts.ts:116-124`,
    drawn at `:220`). Its key draws the same pattern in the line's colour and names it, e.g.
    "Homes (dashed): 320" (`:167-176`). Made is solid and Used dashed on all five made-and-used
    charts. The four shortages each get a strip with their name on it (`drawStrips`, `:229`), where
    before they were bars under a pixel wide. All 19 charts are registered in `settings-cues.test.ts`
    ("the charts"), checked both ways, and tested from what each canvas draws in Statistics (a city
    and the planet) and in the planner's Charts tab. The test checks a pattern's name against the
    dash's own shape, not against the code's table.
  - Injections 69 (dashed and dotted named the wrong way round) and 72 (every strip drawn in the
    same place) were re-run one at a time in a separate worktree. Both were caught as the table says
    ("the key says "Homes (dotted): 322", the line is drawn [6,4]"; "bars outside its strip"). The
    file was restored and the tree was clean after each; the worktree was then removed.
  - Other canvases read in the code: sparklines are one line each beside their metric's name;
    world-map railways are one colour; the land held up close sits under the settlement's mark and
    name; building-card pictures and inspector swatches carry no code (the swatches print their hex
    value). The palettes' reach is stated as the page, the city and the planner's map, and the
    manual says the charts and the world map keep their colours.
  - Manual checked against the code, all true: the pattern order and "Homes (dashed)"
    (`charts.ts:116-124`, Homes second of two); made solid and used dashed; the shortage strips run
    blackouts first, then water, oxygen and food, top to bottom (`top = 2 + k * band`, in series
    order, `:58-63`).
  - Verification: typecheck green; `npx vitest run --maxWorkers=2 --minWorkers=1`: 123 files,
    1,476 tests, all passed (405.2 s; the Known-red opening test passed). `build:web` green
    (656.72 kB JS, 222.17 kB gzip; 52.19 kB CSS) and `build` green, both exit 0. Nothing in
    `src/sim/` changed across the batch, and the walls hold. The note's items skip from 8 to 10
    (no 9), a numbering slip only.

### Batch 37 - Terrain resource deposits
- status: complete
- note: docs/balance/batch37-deposits.md
- manual: docs/manual/cities.md (new section: Deposits; the tools), docs/manual/buildings.md (the
  four boosted buildings), docs/manual/getting-started.md (the first half hour: deposits marked
  while placing), docs/manual/controls.md (select a deposit, the Deposits tool),
  docs/manual/update-notes.md (Update 37, the current known issues), docs/manual/README.md
  (contents, the game in one minute)
- commits: 62b74c6 (started), 0bf5de4, 5ebf08f, 1d9fbc2, 92fce03, c51d875, 93748bc, 98c52be,
  3586c09, 9014e3a, 4ab7ada, and the completing commit
- sessions: 1 (2026-10-16)
- found:
  - chasing deposits starves a city: the scripted player that sited every extractor on its deposit,
    however far, never reached 1,000 people in 4 h (its far buildings' corridors and cables took
    the founding stock); it now sites within a reach, and the manual says to take the near ones.
  - the first thresholds (1.5 m) marked 30% of the ground ore and 33% ice, and no sun; measured,
    6 m and 7 m: 5.8%, 7.5%, vents 2.7%, sun 1.5%, every kind at every one of 100 sites.
  - Batch 34's "a trader has the city of 1,000 sooner" and Batch 30's "two rovers bring it 8.3 min
    sooner" moved with deposits on (83 s later; 5.1 min): the greedy script's chaos (one extractor
    on ice at 4,800 s changes every placement after it). Both now measured on the world they were
    measured on, with a deposits-on check beside each. The second was missed in my first read of
    a log and found by the full suite.
  - a Terraformed start's first step took 6.2 s against 0.7 s (each boosted building's tiles
    sampled one at a time); batched, 1.9 s against 0.6 s - 1.3 s once, under Open for Batch 40.
  - a metropolis's map took 120 ms (more than its ground); a padded array, 52 ms, made a band at
    a time while the city opens.
  - looked at as PNG: the ore's diamond drew as a flat bar, and marks covered the buildings on them;
    both fixed and tested.
  - six tests weaker than they looked, found by injection and strengthened (15, 28, 34, 35, 38 and
    the chunk test's first fault); one injection run left a fault in the tree (the runner restored
    two edits to one file in the wrong order) - seen in git diff, restored from the commit, the
    runner fixed.
  - docs/AUTO_BATCH_SETUP.md (untracked, not this batch's) left as it is.
- decisions:
  - Behind its own DEPOSITS_ENABLED (0), on only in new worlds (NEW_WORLD_OVERRIDES), not behind
    SETTLEMENTS_ENABLED alone (conflict 9): that is on in every browser world, so old worlds' mines
    would change under them.
  - A bonus only: bare ground keeps today's output, a deposit adds to it - today's balance stays
    the floor and the bootstrap cannot get slower.
  - The bonus by the share of the footprint on the matching deposit.
  - Deposits a pure function of the terrain at site coordinates (a claim never moves one): ore
    above a ring's mean (ridges, hilltops, rims), ice below it (easing poleward), vents along the
    fault the canyons' course follows, sun on flat high ground nothing near stands over.
  - The ice bonus fades as liquid water comes in reach (section 3.2: extractors "no longer need a
    deposit").
  - No depletion: nothing stored, no save change.
  - Shown by an overlay with a shape per kind (Batch 36's second cue), on while placing a building
    a deposit boosts and by a Deposits toggle; in words under the pointer, in the ground
    inspector and in the placement hint with the factor.
  - The pacing script gains `siting`; three runs measured (off, on and placed by spiral, on and
    sited); the bootstrap replayed on the browser's terrain.
  - The scripted player's `siting` is a reach in tiles (unbounded, it starved its city).
  - Batch 34's trade test and Batch 30's rover reward are kept on the worlds they measured, each
    with a deposits-on check beside it: the change is the script's chaos, not trade or rovers.
  - "Unshadowed" read as nothing near standing over the tile: the city view has no sun direction.
  - No keyboard shortcut for the Deposits tool: Batch 36's 21 actions left as they are.
  - A tile with a deposit and no rock can be selected (to say what it is); no rover is offered there.
- verification: typecheck green; build green; build:web green (667.63 kB JS, 226.18 kB gzip,
  52.19 kB CSS); the built page, script and styles served and fetched over HTTP (the script holds
  the deposits' words); npx vitest run --maxWorkers=2 --minWorkers=1: 125 files, 1,510 tests, all
  passed (435 s; the Known-red opening test passed). The first full run had one failure (Batch
  30's rover reward, above), fixed before this run. Deposits are off by default: the golden run,
  golden frames, reference cities and Batch 3 score are in the suite as they were.
- measured: Batch 18's bootstrap with deposits off to the year (last building at 48), with the
  four boosted buildings on their deposits done at 35, 80 people both ways; Batch 28's targets with
  deposits on (spiral) - first building 33 s / 8 s, first upgrade 21.5 / 19.9 min (still missing
  4-8), city of 1,000 2.11 h / 1.80 h (2.03 / 1.82 without), phases unchanged.
- injections: 39 faults, one at a time, each file restored from a copy and checked: 32 caught at
  once, 5 caught once their test was strengthened (15, 28, 34, 35, 38), 2 change nothing a test
  can see (29, the ring summed in reverse; 33's first form, a one-to-one shift of a memo). The
  table is in the note.
- review request: BUILD_PLAN.md GAME_PLAN.md README.md docs/PROGRESS.md
  docs/balance/batch37-deposits.md docs/design/macro-world.md docs/manual/README.md
  docs/manual/buildings.md docs/manual/cities.md docs/manual/controls.md
  docs/manual/getting-started.md docs/manual/update-notes.md src/harness/pacing.ts
  src/render/city.ts src/sim/index.ts src/sim/micro/deposits.test.ts src/sim/micro/deposits.ts
  src/sim/micro/settlement.ts src/sim/micro/terrain.ts src/sim/micro/view.ts src/sim/tuning.ts
  src/web/city-cards.ts src/web/city.ts src/web/deposit-words.ts src/web/deposits.test.ts
  src/web/earth-gate.test.ts src/web/first-hour.test.ts src/web/game-tuning.ts src/web/pace.test.ts
  src/web/settings-cues.test.ts
