# Progress

Where the build stands, for `scripts/run-batches.sh` and each unattended session. The fields at the
top are read by the script; keep them one per line, `name: value`. The status table in
`GAME_PLAN.md` stays the source of truth for what each batch is; this file is the run's state.

last_completed_batch: 30
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
