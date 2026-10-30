# Batch 40 - Playtest pass: performance, polish and an adversarial review

Built unattended (`/next-batch auto`), one session, 2026-10-30. GAME_PLAN: "The game survives being
played: fast where it must be, clear where it was confusing, right where it was wrong" - the
metropolis-opening timing test made load-proof, a performance budget measured on a stated machine,
an adversarial review of Batches 26-39, and a polish list fixed in order of how often it is met.

**The machine:** AMD Ryzen 7 5700U (8 cores, 16 threads), 16 GB, Windows 11 Home, Node 22.16.0. No
browser is opened in this project's runs (the user's standing rule), so everything is measured in
Node through the code the browser runs (`src/web/budget.ts`). What only a browser can time - the
canvas's own filling, the GPU, the globe's WebGL - is counted, not timed.

## What went wrong, and what it cost

1. **Every tile key the game read was born on a deprecated map once a big world was built.**
   Profiling the opening test's slowest step (185 ms) found 177,796 broken rocks read through
   `keyTile` at 1 us each, against 0.04 us for a fresh copy of the same two lines. Every
   `{ tx, ty }` object literal in the program shares one hidden class in V8; once something widened
   what `tx` held, every object `keyTile` made was born on the deprecated map and migrated where it
   was read (V8's own debug print: `deprecated_map`). `keyTile` has 36 call sites across the
   simulation and the views; the cliff applied to all of them for the rest of the session after the
   example planet or a Terraformed start was built. The tile is now an object of its own class:
   5.4 ms against 175 for the 177,796. The cliff could not be made in a small script (4.6 against 5.1
   ms), only after the example's build, so its test sits in the opening test's file, where the
   example is built anyway. Cost: two hours of profiling before the fix was one class.
2. **The process's CPU time was the wrong load-proof measure.** The plan was to time the opening
   test's steps by CPU time instead of the wall clock. Measured: it counts the collector's threads
   running beside the step (a 51 ms step read 157 ms), it ticks in 15.6 ms on Windows, and with
   twenty busy processes on the sixteen threads it grew as much as the wall clock (203 to 282 ms
   against 211 to 287). Node 22 has no per-thread CPU clock. The test now times each step as a share
   of the whole making, timed in the same run: load slows both alike. And the work was cut first, so
   the shares are small (below).
3. **The city screen re-derived a metropolis's view five times a second whether anything had
   changed or not.** Its own comment said "~15 ms"; measured, 70-145 ms in a metropolis of 40,539
   buildings: 149 of the 203 frames over 33 ms in 30 s of panning. A view is a pure function of the
   settlement, the planet's channels and the tuning, and between substeps (8.3 s apart at 1x) none
   changes. It is now derived when the settlement or the channels have changed (the channels are
   made afresh every frame, so compared by value), at most every 200 ms, and at once on a click's
   change as before: 4 views in 30 s at 1x, 11 at 3x. The planner did the same once a second; fixed
   alike. Inside the view, its 18,000-40,000 buildings were each built with four object spreads:
   65 ms of the 95-140 ms (example's metropolis) before, 19-30 ms after.
4. **A Terraformed start ten hours away froze the page for five minutes**, and the budget's "a world
   opening in under 3 s" is not met for it. Its 83,589 buildings make a substep about 87 ms, the
   catch-up must equal live play exactly (events, the score, the ending all depend on it), and ten
   hours away at the Standard pace is 4,320 substeps: 302 s; an hour, 37.5 s; with no time away, 2.7 s
   to read its 43 MB save and 3.3 s for the first substep (its deposits, Batch 37's open item). Not
   fixable in this batch. What was fixed is the frozen page: the world library catches up a substep
   at a time, hands the page back every 50 ms of work, and says how far it is ("Catching up on the
   time you were away: 34%"); the same world, to the bit, as caught up at once.
5. **The chunked city let a frame spend 40 ms painting new pictures**, more than a 30 fps frame
   holds by itself. A chunk at high detail is 10-15 ms to make before the canvas fills it (2,745
   shapes median); 16 ms a frame took the slowest 1% of panning frames from 60 to 38 ms. The first
   screen of a metropolis fills in over about twice as many frames (about 0.6 s).
6. **A failing store was written to on every frame**, found while fixing Batch 36's open item (an
   autosave written once a frame until the first write landed): `Autosaver.due` counted from the last
   write to *land*, so a write that failed never landed and every frame asked again - 3,600 writes a
   minute. Both fixed by counting from when a save was asked for; a failed write is tried again an
   interval later.
7. **Three tests from Batches 26-39 did not catch the fault they claim to guard** (the review's
   injections, below): a save that lost every building's level drew the same city (its three
   buildings were all level 1); the words for treating an outbreak were never checked, so words
   giving 2.5 times the toll passed; a sign slipped in the terrain's rotation stretched the world by
   1.5% at the tests' seed, inside their tolerance. Each test is strengthened and its fault now
   caught.
8. **A test comment said the opposite of what it measured**: the meteor shower's shelter test said
   "no materials made" under cover; measured, a quarter as many as a city with no shower (31.4
   against 125.7). The comment is corrected; the bound (under half) holds.
9. **My own premises, wrong four times:**
   - the opening test's comment said "the fine heights made in one step would be a fifth of it";
     injected, the conversion is cheap now and nothing failed - the costly part is sampling the
     heights in the terrain, which is the injection kept (54% of the whole);
   - the first bound on the view made again (2%) caught the old code by a hair (2.34%); tightened
     to 1.5%, 1.8 times the worst measured;
   - the old-save test read the save's time from a field that does not exist (`saved_at_iso`, not
     `last_saved_real`), so its clock was NaN and nothing was caught up; found because the
     catch-up assertion failed for all eight;
   - a comment claimed a measured worst of 4.4e-16 for the rotation before it was measured (1.3e-15);
     caught before the commit.

   And two vacuity guards of new tests fired on their first run (a building that could not be placed
   where the test asked): each guard did its job.

## What was built

- **The opening test load-proof** (`src/web/city-open.test.ts`): each time a share of the whole
  making - the longest step under 10% (measured 1.3-3.8%), the first view under 8% (2.0-2.9%), the
  view made again under 1.5% (0.47-0.82%) - alone and with twenty processes keeping every core busy.
  The work behind it cut: the steps of four conversions and a route split (255 ms in one step), the
  world's corners a band at a time, the rovers' grid two steps of its own, `keyTile` a class, the
  view's buildings without spreads.
- **The performance budget** (`src/web/budget.ts`), measured below, with three fixes it found: the
  view derived when its inputs change (`src/web/view-inputs.ts`), 16 ms a frame for new pictures,
  and the catch-up between frames.
- **Real old saves** (`src/web/old-saves/`, `src/web/old-saves.test.ts`): one for each schema from
  v13 to v20, written by its own era's game - its source taken from git at the commit before the
  schema moved on, a Standard world made through that era's own world library and store, a city and
  an outpost founded, built, connected, upgraded and queued, played on, saved as the app saves, and
  exported (`scripts/old-save.ts`). Today's library opens each as the browser does: listed, checked,
  two hours away caught up, played, saved as v21 and opened again; and each era's export imported.
  Every one loads, and nothing it held is lost. Before this, every migration test made its "old"
  save from a new one with fields removed.
- **The review** of Batches 26-39 (below): a fault in a test no batch's table names, one a batch,
  and an audit of every numeric threshold in the batches' tests.
- **The polish list**, in the order a player meets it:
  1. every player, at every autosave: saved once, not once a frame until the write lands (and a
     failing store no longer written to every frame);
  2. every player in a big city: panning without a stutter five times a second;
  3. every player panning into a metropolis: no frame spending 40 ms on new pictures;
  4. everyone, after a big world was built in the session: tile keys read at full speed;
  5. a player opening a Terraformed start after time away: a page that keeps working and says how
     far it is, instead of minutes frozen;
  6. a player levelling ground: steep ground with no crag says to level it, not to break a crag that
     is not there.

## Decisions

- No browser is opened; the budget is measured in Node through the browser's code, the canvas
  counted (paths, points, pictures) and not timed. Recorded as such.
- The opening test is load-proof by shares of the whole, not by CPU time (item 2 above).
- `keyTile` returns an instance of its own class: same values, same contract; a performance fix
  only.
- The view is derived when the settlement or the planet's channels change, at most every 200 ms;
  the channels compared by value. A view is a pure function of them, so nothing drawn changes.
- 16 ms a frame for pictures never drawn, not 40: smoother panning against a slower first fill.
- The catch-up runs a substep a time between frames in the browser; `resume` keeps its chunks.
  `advance` is chunk-independent (an invariant with its own tests), and a new test holds the sliced
  catch-up to the chunked one, to the bit, on a city with builds, events and Earth.
- The Terraformed start's opening is recorded as missing the budget, not worked around: a cheaper
  catch-up would break live-equals-offline, which the events, the score and the ending stand on.
- The script was not split (708 kB, Vite's 500 kB warning since Batch 31): splitting the city, the
  globe or the panels behind dynamic imports is a change to how the page loads that could not be
  checked in a browser here. Recorded under Open.
- Real old saves are kept as test files (about 360 kB for the eight) with their generator, so the
  next schema can add its own.

## Measurements

### The budget

| Target | Measured | Met |
|---|---|---|
| 60 fps in the reference city | the scripted player's city two hours in (111 buildings, 3 rovers out), 20 s at its first camera: median 2.45 ms, p95 4.78, p99 11.7, max 60.3; 10 of 1,199 frames over 16.7 ms (9 painting a picture, 1 deriving the view); the first frame 228 ms; a frame fills 2,110 paths (10,036 points) and draws 42 pictures | yes, on the script's side; the canvas's fill of 2,110 paths a frame is not timed |
| 30 fps panning a metropolis | 40,539 buildings, held keys (600 px/s) for 30 s at 60 frames a second: at 1x median 6.79 ms, p95 12.9, p99 30.6, max 112; 11 of 1,799 over 33 ms (3 at a substep's new view, 78-80 ms; 8 painting); at 3x, the fastest a Standard world goes, p95 19.2, p99 44.8, 31 over (10 at a view, 69-104 ms). A frame fills 2,965 paths and draws 43 pictures | yes for 99.4% (1x) and 98.3% (3x) of frames; the rest are a substep's view and a picture's paint, recorded |
| a world opening in under 3 s | see the next table | Standard worlds yes, at every absence; a Terraformed start no |
| memory bounded | the JS heap: 13 MB, 85 MB with the metropolis, then 285, 272 and 288 MB after three laps panning across it (600 frames each); pictures capped at 24 million pixels (about 96 MB) by the chunk budget; the planet's record bounded by halving (Batch 31: 125 samples, 25 kB after 1,000 sim-years) | yes |

Before the fixes, panning the metropolis: median 14.0 ms, p95 110.8, p99 160.8, 203 of 1,799 frames
over 33 ms (149 deriving the view). The machine is noisy: the same scene's median was 6.8-14 ms across
the runs; the numbers above are from the last run, after every fix.

### Opening a world

As the library opens a world: the tuning from its record, the save read and migrated, the absence
caught up a substep at a time (the page handed back every 50 ms of work), then the first substep
played. "The first slice" is the read, the migration and the first substep of the catch-up: the
longest the page stops; "longest after" the slowest single substep after it.

| World | Save | Away | Opened | The first slice | Longest after | First substep played |
|---|---|---|---|---|---|---|
| a new Standard world | 1 kB | none | 7 ms | 7 ms | - | 4 ms |
| | | 1 h | 42 ms | 2 ms | 1 ms | 0 ms |
| | | 10 h | 164 ms | 1 ms | 1 ms | 0 ms |
| the scripted player's world, five hours in | 108 kB | none | 10 ms | 10 ms | - | 2 ms |
| | | 1 h | 128 ms | 11 ms | 1 ms | 1 ms |
| | | 10 h | 938 ms | 10 ms | 2 ms | 1 ms |
| a Terraformed start | 43 MB | none | 2.25 s | 2.25 s | - | 2.3 s |
| | | 1 h | 31.1 s | 4.6 s | 277 ms | 545 ms |
| | | 10 h | 290.3 s | 4.1 s | 370 ms | 459 ms |

Under 3 s for every Standard world at every absence up to the 10 h cap. A Terraformed start misses:
4.6 s with no time away (its read, and the first substep's deposits for 83,589 buildings), 31 s an
hour away, 290 s after ten. Caught up at once, before this batch, the page stopped for all of it
(37.5 s and 302 s measured that way).

### The opening test's steps (one metropolis, `prepareCity`)

| | before | after |
|---|---|---|
| longest step alone | 203-254 ms (four conversions and a route; 185 ms of broken rocks) | 51-114 ms (the rovers' reach) |
| longest step, every core busy | 282-287 ms | 134-195 ms |
| as a share of the whole | 6.4% | 1.3-3.8% |
| first view from what was made | 257 ms | 104-129 ms |
| the view made again | 95-144 ms | 19-29 ms alone, 25-67 busy |

### The review

- **Thresholds**: 613 numeric assertions in 51 test files from Batches 26-39 examined; 33 found with
  no measurement beside them (23 from these batches, 10 older lines in the same files), and about 30
  vacuity floors set at a tuned-looking number. Traced now, the measured value beside each: the
  build curve's nine (the plan's ranges; the curve's own numbers to a substep), the contract sizes,
  the pace ratio (1.135 against 1.2), the shelter's share (25% against 50%), six of sound's. One
  "never" test had no guard that its limit was reachable (the rovers sent): guarded, and the guard
  caught a garage of six rovers where the scene sends five. One flagged as missing a guard was not:
  "the band is never left on the way" holds because the victory comes exactly the hold after the
  first entry, which a band left and re-entered would push later.
- **Injections**: 14 faults, one a batch, each in a test that batch's table does not name, run alone
  with the tree checked clean after each: 11 caught; the 3 not caught are item 7 above, each fixed.

| Batch | Test | Fault | Caught |
|---|---|---|---|
| 26 | structures: a city loaded from its save draws as before | a building's level not read back | no - fixed: a level-3 reactor; now 224,562 shapes against 224,603 |
| 27 | elevation agreement: each ocean fraction's share, the turned field | a sign in the rotation matrix | no - near-harmless at the seed (1.5%); a rotation now checked as one: det 1.00026 at seed 1 |
| 28 | build queue: more at once with more rover posts | rover posts left out of the count | yes, "expected 3 to be 5" |
| 29 | fill-shapes: a list with no clip unclipped throughout | restore without a save | yes, "restore with nothing saved" |
| 30 | objectives: off by default and in every world before | the guide's switch dropped | yes |
| 31 | history: starts empty, nothing at PLANET_HISTORY_EVERY 0 | the switch dropped | yes |
| 32 | needs: a need not yet asked counts for nothing | `>=` to `>` | yes |
| 33 | decisions: every choice in words with the event's figures | treating's words with quarantine's figure | no - fixed: each choice's words against what it loses, played out: "expected '35 people lost.' to match /^14/" |
| 34 | earth: refuses, changing nothing | an amount of 0 accepted | yes, "expected true to be false" |
| 35 | sound: let start by a pointerdown | the first gesture skipped | yes |
| 36 | settings: untrusted, anything out of range | any camera speed accepted | yes |
| 37 | deposits: differ from place to place | the longitude dropped from the cache key | yes, "expected 0 to be greater than 500" |
| 38 | defences: a raised building lost later | the ground's grades ignored in the flood | yes |
| 39 | ending: stays won once won | the victory not latched | yes, "expected null to be 40" |

## Verified by injection

Every new or strengthened test was broken once by a fault in the code it guards, one fault at a time,
each file restored from a copy and checked identical after.

| # | Test | Fault | Result |
|---|---|---|---|
| 1 | opening: the longest step a share of the whole | the world's fine heights sampled in one step | caught: 1,981 of 3,681 ms, 54% against 10% |
| 2 | opening: the view made again | the buildings with their four spreads again | caught: 144 of 6,151 ms, 2.34% (bound then 2%; now 1.5%) |
| 3 | opening: the first view | the world's heights in tiles not kept by the preparation | caught: 852 of 6,875 ms, 12.4% against 8% |
| 4 | opening: a tile's key as fast as a copy | `keyTile` an object literal again | caught: 1,159 ms against 81, 14x against 4 |
| - | opening: the longest step | the fine heights converted in one step | not caught: the conversion is cheap (my premise); replaced by 1 |
| 5 | old saves: nothing lost | the v13 migration dropping levels | caught (v13: the upgraded solar array) |
| 6 | old saves: features from after stay off | old worlds given today's tuning | caught: "the ending, off in a world made before it" |
| 7 | old saves: caught up by two hours away | an old save's absence not caught up | caught: "expected 63 to be greater than 63" |
| 8 | old saves: the export imports | the import not writing the save | caught: "its save is missing" (v13-v19) |
| 9 | view: once while nothing changes | the old rule, every 200 ms | caught: "expected 25 to be 1"; "and then held: expected 6 to be 2" |
| 10 | view: again when the channels change | the channels ignored | caught: "expected 1 to be 2" |
| 11 | view: at once on a click | a click waiting for the 200 ms | caught: "expected 1 to be 2" |
| 12 | planner: once while nothing changes | the old rule, every second | caught: "expected 5 to be 1" |
| 13 | autosave: asked once while the write is on its way; a failing store an interval later | `due` from the last write to land | caught both: "expected 10 to be 1"; "expected 3600 to be 2" |
| 14 | steep ground: what makes it buildable | always "break the crag" | caught |
| 15 | catch-up: the same world a substep at a time | Earth's step once per `advance` call | caught: the saves differ |
| 16 | library: hands the page back while it catches up | never yielding | caught: "the page ran between slices: expected 0 to be greater than 0" |
| 17 | build queue: never more rovers than the city has (guard) | six rovers where the scene sends five | caught by the new guard: "expected 5 to be 6" |
| 18 | outbreak: each choice's words name what it loses | treating's words with quarantine's figure | caught |
| 19 | structures: a city loaded draws as before | a building's level not read back | caught: 224,562 shapes against 224,603 |
| 20 | terrain rotation: a rotation for every seed | a sign in the matrix | caught: det 1.00026 at seed 1 |
| 21 | front door: says how far it has got while a world catches up | the progress never said | caught: no "Catching up" among what the notice said |

21 faults, 21 caught; one premise of mine replaced (the row without a number). With the review's 14:
35 faults, 32 caught at once, the 3 not caught fixed and caught as 18-20.

One run of the front door's new test (21) did not finish in ten minutes and was stopped; three runs
after, and the full run, finished it in about a second. Not explained.

## Verification

VERIFICATION

## Open

The project's last batch: these are left with their evidence for whoever takes it on.

- **A Terraformed start's opening** (item 4): 4.6 s at once, 31 s an hour away, 290 s ten hours
  away, against 3 s. The page keeps working and says how far it is, but its first slice - reading
  the 43 MB save and the first substep - still stops it for about 4 s. A cheaper substep for a world of
  83,589 buildings, or deposits worked out a city at a time (Batch 37's open item), are the ways;
  a coarser catch-up is not (live must equal offline).
- **Making a Terraformed start, and the example planet**, 30-42 s (Batch 27's open item, longer since
  Batch 32's services): unchanged.
- **Nothing was timed in a browser**: the canvas's fill (2,110 paths a frame in the reference city,
  2,965 in a metropolis), the globe's WebGL, the page's first load. The frame meter in Settings
  (Batch 36) measures them on the player's machine; its numbers last the page.
- **The script is 708 kB** (Vite warns past 500 kB): not split (decisions).
- **A metropolis's view at a substep is 70-104 ms**, a frame over 33 ms every 8.3 s at 1x (2.8 s at
  3x); and one chunk's picture can take a frame on its own. Making the view's settlement step once
  per substep for the city screen and the simulation alike, and smaller chunks at high detail, are
  the ways.
- **Thresholds still untraced**: 22 of the audit's 33 (the loosest-looking were traced first), and
  about 30 vacuity floors at tuned-looking numbers. From these batches: vehicles.test.ts:385 and :403
  (a queued rover's gap; the next line pins the place), ending.test.ts:95 (web; drift under reduced
  motion), settings-cues.test.ts:455, settings-gate.test.ts:408 and :748 (globe turns), sim
  ending.test.ts:100 and :114, harness ending.test.ts:95, pace.test.ts:205 (a rocket's trip over
  55 s), deposits.test.ts:257, flood-golden.test.ts:171-172; older lines in the same files:
  metropolis.test.ts:177, :210, :212, example.test.ts:169, :415, :597, build.test.ts:124,
  city-chunks.test.ts:60, flood-forecast.test.ts:93-94, hud.test.ts:117, :244, :382. Each is a floor
  or bounds something tested exactly nearby; none was found loose by an injection.
- **Design questions recorded by earlier batches, still open**: events while the game is closed
  (Batch 33), an offer every 71 s at Classic (34), choosing which city sends a contract's goods
  (34), an event's supply ship losing what a full store cannot take (33, 34), half the ore on steep
  ground (37), old worlds turning the sea on (38), relocation (38). Each is a change to what the
  game does that its owner should choose.
- **Not looked at, listened to or felt in a browser** (every batch since 26 recorded it): the
  panels, the palettes, the sound's levels, a trackpad's pinch.
