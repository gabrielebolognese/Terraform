# Batch 28: time that means something - real build and upgrade times

"We start with a few dozen seconds and minutes, but as structures get bigger or upgrades get bigger,
there should be more and more time."

## What went wrong, and what it cost

### Two of the plan's targets could not be met as written

- **"First phase reached at 6-12 h of play."** Phase 1 begins at sim-year 2 in the reference run,
  eight seconds of play. Holding it to 6-12 hours would mean slowing the game 300-600x and a
  playthrough of thousands of hours. It was replaced at Phase 1 with **Phase 1 within 15 minutes and
  Phase 2 at 1-3 hours** (Phase 2 is at sim-year 18).
- **"First upgrade done at 4-8 min."** Missed: 19.9 minutes at the Standard pace, 19.3 at Classic.
  The cause is not build times. An upgrade costs the building's full price for +10% output, so the
  scripted player, like a sensible one, builds new until it needs nothing else. The upgrade's value
  (`LEVEL_BONUS`, costs) is not this batch's to set. The test holds the number where it is as a
  regression guard and says why.

### A job finishes on a substep boundary, so slowing the clock broke "under a minute" before any tuning

The plan's option (a) slows the clock. At 10x slower a substep is 83 real seconds, and every build
finishes on the next boundary: no build could take less than 83 s. The Standard pace therefore
shrinks the substep with the clock (0.25 to 1/32 sim-year). A substep stays 8.3 real seconds, and
the planet's step count per real second, its CPU cost, is unchanged.

The planet's path at the smaller step was measured on the default tuning before anything was
built on it:
- every phase lands on the same sim-year except Phase 5, at 608 against 610;
- the final pressure is within 0.05 mbar.

### Slowing the planet would have slowed the cities eightfold too

Slowing the clock slows everything measured per sim-year: city production, growth, rovers and
rockets. Measured at the first try, a city of 1,000 would have taken about 80 hours. Re-tuning
dozens of city constants per pace would have been error-prone, so there is now one constant:
- `CITY_CLOCK`: the cities live that many of their years for each of the planet's. The Standard
  pace sets 8.
- There is still one clock: every planet substep steps every city by exactly eight substeps' worth,
  so offline stays exact.
- A city's step is the same quarter-year it always was, so every city constant keeps its meaning.
- A rocket's trip is still the real minute the user asked for. A test checks this at both paces.

### The scripted player, the instrument, was wrong twice before it measured anything

- It counted "first building" only once every build had finished.
- It never built a mine. Every wait in its log was for materials, and a player would answer that
  with a mine.

Fixed, the City-of-1,000 time at Classic went from 9.9 h to 1.57 h. The instrument has to be right
before any target means anything. Both runs, before and after, use the same script.

### The away summary took 68 seconds to load a Terraformed world

"While you were away" learned what the cities built. The first version found each building's old
self with a search through the old list, which is quadratic. A metropolis has 41,000 buildings, so
loading a Terraformed world took 68 s. The full test suite took 665 s and the worlds test 639 s,
which is how it showed. Indexing by tile brought the load back to 5.3 s.

The same pattern was in the new countdown UI: the example planet has 666 builds under way, each
looked up among 41,000 buildings on every refresh. It is indexed too, and the panel lists the first
24.

### A Terraformed world catches up much more slowly at the Standard pace (not fixed)

At Standard, offline runs at the live rate for up to 10 hours, so a long build finishes while the
player is away. That is 6.7x more substeps per hour away than Classic, which ran at 15% for 8 hours.

| Catch-up | Classic | Standard |
|---|---|---|
| A player's city (137-205 buildings), 10 h away | 0.16 s | 0.57 s |
| Terraformed start (42 settlements, 3 metropolises), 1 h away | 11 s | 39 s |

A Terraformed world left for ten hours would take minutes to load. The cost is the example
planet's 130 ms per substep, which, like its 19-40 s build, belongs to Batch 40's performance
pass.

### The metropolis timing test fails, on the last commit as well

`city-open.test.ts`'s longest preparation step measured 440-505 ms against its 400 ms limit, run
alone. On the last commit, with this batch stashed, it measured 462 ms. The machine is slower
today: the example planet builds in 40 s, against 19 s last batch. This is Batch 26's recorded
finding, already assigned to Batch 40. The limit was left alone.

### The suite caught three changed words and one deliberate behaviour change

- The rocket now reads "about 1 min" rather than "about 60 s". The first version said "1 min 1 s",
  because 1.8 sim-years at 0.03 is 60.000000001 s and the countdown rounds up. "About" phrases now
  round to the nearest second; countdowns still round up, so they never show 0 s early.
- A build with every rover out is now queued, not refused. That changed one Batch 21 test, and the
  save's key list (v14).

## What was built

| Piece | What it does |
|---|---|
| The curve | `BUILD_SECONDS_<TYPE> x BUILD_GROWTH_<TIER>^(level - 1)` real seconds at 1x, for all 27 buildable types; tiers small 1.8, medium 1.72, great 1.35. Behind `BUILD_CURVE_ENABLED` (0). |
| `CITY_CLOCK` | The cities' years per planet year (1 by default). |
| The build queue | A build or upgrade with every rover out waits, paid for; a rover goes to the next whenever one is free, builds before levelling; reorder, cancel with a full refund; removing a waiting worksite refunds it. Save v14, with a migration. |
| Paces | Standard (planet 8x slower, city clock 8, the curve, offline at the live rate for 10 h) and Classic (everything before; every existing world, read from its tuning). New world offers both, Standard first. |
| Speeds | Standard: pause, 1x, 2x, 3x. Sandbox and the `?debug` setting: every speed. Classic: as before. |
| Countdowns | In real time at the world's speed: over each worksite, in the inspector, in the city panel's Builds list with its queue controls, and on the Upgrade button and the build cards. |
| Away | "While you were away: ... In the cities, the reactor reached level 5, the spaceport is half built." |
| `harness/pacing.ts` | The scripted player: the moments a player notices, in real time at 1x. |

## Measurements

The scripted playthrough, the same script before (Classic) and after (Standard):

| Moment | Classic | Standard | Target |
|---|---|---|---|
| First building stands | 8 s | 33 s | under 1 min - met |
| First upgrade done | 19.3 min | 19.9 min | 4-8 min - **missed** (see above) |
| City of 1,000 | 1.57 h | 1.79 h | 1-3 h - met |
| Phase 1 | 8 s | 8 s | under 15 min - met |
| Phase 2 | 12.4 min | 1.65 h | 1-3 h - met |

The curve, through a real `advance` with the drive taken out: every type at every level within one
substep (8.3 s) of its tuned time, never early, each level strictly longer. Against the plan's
table:

| Building | Level 1 | Top level | Plan |
|---|---|---|---|
| Storage depot | 20 s | 20.4 min (8) | 20 s, about 20 min |
| Solar array | 30 s | 30.6 min (8) | 30 s |
| Habitat dome | 2 min | 17.5 min (5) | 2 min |
| Reactor | 4 min | 2.97 h (8) | 4 min, 3 h |
| Spaceport | 15 min | 2.04 h (8) | 15 min |
| Biosphere | 45 min | 6.1 h (8) | 45 min |
| Mega mall | 1 h | 8.2 h (8) | 1 h, 8 h |

Offline: ten 48-hour absences at the Standard pace come to 1,350 sim-years, 79% of the 1,710-year
arc. Classic gives 1,296.

The golden run, the Batch 3 score and the golden frames are unchanged: the default tuning has the
curve off and `CITY_CLOCK` 1.

## Injections

25 faults, one at a time, after two no-fault baselines that pass. **All 25 caught**; the tree was
checked byte-identical after each run.

Getting there took three passes:
- **The first run found a gap.** Reading a world's pace from a Batch 27 index entry (labelled
  "standard", with no curve in its tuning) was **missed**. A new "My planet" gets its pace set
  directly, so no test ever read a pace back from a stored index. A test now does.
- **Eight faults never ran.** Their patterns did not match because a `git stash` round trip (to time
  the metropolis test on the last commit) had rewritten every changed file with CRLF line endings.
  The files went back to LF and the eight ran again.
- **One planned fault had no test at all:** an upgrade that waited in the queue being sent with
  level 1's time. That test was written before the run.

| Fault | Caught by |
|---|---|
| The curve ignores the level | the curve, through a real advance |
| Growth off by a level | the curve, through a real advance |
| `CITY_CLOCK` not applied | the scripted playthrough (city of 1,000) and the rocket's real minute |
| An upgrade's job at level 1's time | the curve, through a real advance |
| A queued upgrade sent at level 1's time | a waiting upgrade takes its own level's time |
| The queue never sends a rover | holds what no rover is free for |
| The queue ignores the rover count | holds what no rover is free for; never more rovers than the city has |
| Cancel refunds nothing | cancellable with the whole cost back |
| Removing a waiting worksite refunds nothing | refunds a waiting worksite that is removed |
| A waiting worksite runs | holds what no rover is free for (houses nobody) |
| Reorder does nothing | reorderable |
| The queue not saved | survives the save exactly |
| No v14 migration | a v13 save loads with nothing waiting |
| The away line says nothing of builds | says what finished |
| "Half built" misread | says what finished and how far the rest has got |
| Pace read as a label | a world's pace is its tuning |
| Standard offers the fast speeds | slow speeds only |
| Offline at the old 15% | ten hours away is ten hours of the world |
| Offline cap of 48 h | ten 48-hour absences stay short of the arc |
| The planet not slowed | the scripted playthrough (Phase 2 8x later) |
| Countdown ignores the speed | counts down twice as fast at 2x |
| The queue listed in reverse | lists the work, then the queue in order |
| The Down button moves up | moves and cancels through the queue's buttons |
| A Batch 27 world read as Standard | reads a world Batch 27 made as Classic |
| New world ignores the pace chosen | offers both paces, and the world keeps the one chosen |

## Open

- **The first upgrade at 4-8 minutes** needs upgrades to be worth doing early: their value or cost,
  or an objective that asks for one (Batch 30, onboarding).
- **Catch-up for a Terraformed world** (39 s per hour away) and the example's build: Batch 40.
- **Rover trips along the real route** wait for Batch 29's roads; the drive is still the straight
  line.
- **Pay to hurry** was declined at Phase 1. It can be revisited with Earth's market (Batch 34).
- A Standard world's offline rate is the live rate, so ten hours away equals ten hours played.
  Classic made playing 6.7x better than leaving. The cap (10 h) keeps the game from playing itself,
  but "playing beats not playing" no longer holds per hour. It is a choice for builds to finish
  while away, and is recorded here.
