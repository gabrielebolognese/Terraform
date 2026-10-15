# Progress

Where the build stands, for `scripts/run-batches.sh` and each unattended session. The fields at the
top are read by the script; keep them one per line, `name: value`. The status table in
`GAME_PLAN.md` stays the source of truth for what each batch is; this file is the run's state.

last_completed_batch: 29
in_progress_batch: 30
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
- status: in progress
- sessions: 1 (this one, started 2026-10-15)
