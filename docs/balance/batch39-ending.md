# Batch 39 - The ending: victory, scores and achievements

Built unattended (`/next-batch auto`), one session, 2026-10-30. GAME_PLAN: "A game that can be
won, and a reason to play again" - victory (the arc's last phase, sustained for a stated time; a
sequence over the globe; the world's story in numbers; the choice to keep playing), a score per
world on the worlds list, about thirty achievements checked from state, and new game plus.

## What went wrong, and what it cost

1. **The first list of achievements could be earned in a minute.** It was written from what a
   player does - found three cities, found an outpost, raise a building to level 2, build a Seawall,
   finish a great structure, put a mine on its deposit. Measured against the game's rules:
   - founding is free and instant, and a railway is instant and paid from the 3,000 starting
     credits (65 km at 5 a km): three cities on one network can stand in seconds;
   - at the Classic pace every build takes its flat time whatever the level: a depot's three levels
     are 10 s, a Seawall 13 s, a Medical Center 20 s;
   - the headquarters, the spaceport and the Seawall are great structures that ask for nobody.

   The first scripted run with sites founded on the first substep earned "A great structure",
   "Three cities" and "Against the sea" at 8 s. **Every achievement now waits on something a minute
   cannot bring**: people (who come at a city's growth), a great structure that asks for a city of
   1,000 or more, the planet's years, Earth's windows (the first a player can meet is 2.135 planet
   years in, 70 s at Classic), the first event (half an hour in), the sea, or the victory. "Three
   cities", "An outpost", "Higher" and "On the seam" were dropped; "A network" asks for a city of 500
   besides; "Against the sea" asks for the sea within 20 m of the city's ground. Three were added to
   keep about thirty: "An ocean", "A fortune", "A thousand years". The soonest any comes in a scripted
   run is 1,708 s (the first rocket).
2. **The walled city's site was searched on the wrong planet.** The sites were found with one
   world's terrain (seed 7) and the run used another's (the flood fixture's): the city "12 m under the
   sea's last level" really stood near -7,160 m and fell at year 296, earning "Held the line" on its
   way down. Moving the run to seed 7 brought a second surprise: the sea's level at the victory is a
   property of the world's terrain - -3,091 m on the default planet, -3,020.5 m on seed 7. The walled
   city now stands 11.3 m under the latter, behind a first-level wall (4 m), with 2.5 m to spare.
3. **People lost to the sea counted only at the fall gave 0.** The low city's people go with their
   domes: as the water takes the homes, the city's people fall to its homes, and by the substep the
   city is declared lost there is no one left in it. A count at the fall reported a city of 35.7
   people lost with nobody in it. The count now takes everyone in a settlement the sea takes, and
   everyone who leaves or dies in one the water stands over (its ground under water as the substep
   began); evacuation, the player's, between substeps, is never counted. Measured: 35.68 people when
   the water reached the city's lowest ground, 35.68 lost.
4. **One test passed with its rule removed** (injection 13): the score's total leaving out the cities
   held. The test checked the part (250 for the walled city) and never the total; it now checks that
   the total is the sum of the parts the card shows, for five scored worlds: "expected 615 to be 865".
5. **Four of my test premises were wrong**, each found when the test first ran:
   - the hold measured from "A living world" was one substep short (319 for 320): the phase, and so
     that achievement, is latched on the substep after the one whose start first read the band;
   - "Held the line" was expected a substep after the sea first stood 10 m over the city's ground;
     the achievements latch from the state each substep leaves, so it is the same substep;
   - the low city's lost people were compared with its peak (37.72) - the peak was earlier, before
     the sea; the count is its people when the water came (35.68);
   - the achievement card test dropped an achievement from the middle of the list, where the card
     reads the list as it grows (append-only): it now drops the last.
6. **Batch 30's milestone test changed.** In a Standard world the substeps that finish its second
   Spaceport also latch "The caps let go" (the test had set Phase 2 by hand), and its card shares
   the look. The test now looks past achievement cards; theirs are this batch's tests.
7. **The latch cost a quarter of a planet substep at first**: 7.3 us against a 29 us substep (a new
   set of earned ids built every substep, and the network check allocating with no cities at all).
   Keeping the ids per list and asking the network only with three cities standing brought it to
   2.25 us (2.08 us in the scripted five-hour city of 4,165 people).

## What was built

- **Victory** (`src/sim/ending.ts`): every §2.3 minimum - Phase 6 as it stands - held
  VICTORY_HOLD_YEARS (10) in a row, counted a substep at a time in `advance` from the same reading
  the phase is latched from; a substep out of the band starts the count again; once won, won
  (`ending.victory`, the substep). 44 minutes at 1x at the Standard pace, 5.5 at Classic.
- **The tallies** kept beside it, only what cannot be derived: the most people at once, the people
  lost to the sea and moved to safety, the events answered (the record of resolved events keeps
  only the latest 40), the machine-years. Kept by `advance` (and, for evacuations and answers, by
  the player's action) with ENDING_ENABLED on.
- **The score** (`worldScore`), derived from the state: speed (1,000 x 1,720 / years to victory, 0
  before), people (0.1 a person at the most), cities standing only by their Seawall (+250: the sea
  10 m or more over the ground, where a city with no wall is lost), cities lost (-250), pressure on
  the planet (-0.004 a machine-year); never below 0. **The world's story** (`worldStory`) in numbers.
- **30 achievements** (`src/sim/achievements.ts`) in six groups, each a condition on the state,
  latched with its substep; five rare ones (how the world was won, and a city held by its wall).
- **Save v21**: the ending, its reader (counts never negative, the victory and every achievement no
  later than the save, each achievement once), and the v20 -> v21 migration (an empty ending).
- **The browser**: the victory's sequence once a world (the panels step aside, the camera swings a
  turn and a quarter round the planet over 12 s, the card after 4 s with the story and the score,
  **Keep playing** or **Save and back to the title**; with reduced motion, the card at once); a card
  for each achievement earned; each world's score, year won and achievements on the worlds list; the
  title's **Achievements** from the player's record across worlds (kept in the player's store, so a
  deleted world takes nothing back); new game plus - four bonuses, recorded in the new world's
  tuning; the away summary's line for a win and the achievements earned while away.
- **The scripted runs** (`src/harness/ending.ts`): to the victory by a fixed schedule (reference,
  lean, swift), the walled cities, the evacuation; the pacing player gained "found a metropolis once
  allowed".

## Decisions

- **Victory held, not touched**, for 10 years: the world must stay living. The reference run enters
  the band once and never leaves it, so the hold costs it exactly 10 years.
- **The ending is a new Standard world's only** (ENDING_ENABLED 0 by default; MODE_OVERRIDES): a
  sandbox has nothing to win and a Terraformed start begins won; old worlds keep the tuning they
  recorded (Batch 27), as every feature since Batch 29.
- **Pressure on the planet as machine-years**: exact, only grows, so a style achievement can be asked
  of it at the victory and can never come true later.
- **Cities are cities and metropolises**; outposts count in neither losses nor saves.
- **The victory's "seen" is the worlds list's**, not the world's: menus never write the state.
- **The player's record is the player's** (beside the settings): victories and the first world each
  achievement was earned in. New game plus opens with any victory in it.
- **Four bonuses**: 9,000 starting credits, five rovers a headquarters, cities founded with full
  stores (400 materials - a new city's store holds 400, so 750 would have been clamped), Earth's
  regard from 80. A Standard world's only.

## Measurements

The reference policy, scripted to the end:

| Pace | Phase 6 | Won | Real time to the win at 1x |
|---|---|---|---|
| Standard (Batch 28) | 1,709.75 | substep 55,032, year 1,719.75 | 458,600 s, 127.39 h (42.5 h at 3x) |
| Standard, weather on | 1,710.22 | year 1,720.22 | 127.42 h |
| Classic | 1,710 | year 1,720 | 57,333 s, 15.93 h |

The band, measured every substep to year 2,800: entered once (1,710, 1,709.75 at Standard, 1,710.22
with weather) and never left.

Schedules to the victory (Classic, the planet as calibrated):

| Schedule | Won | Machine-years | Score (speed / pressure) |
|---|---|---|---|
| Reference | 1,720 | 96,176 | 1,000 / -385 |
| 16 nitrogen importers (swift) | 1,543.5 | 82,793 | 1,114 / -331 |
| 20 nitrogen importers | 1,543.5 | 87,222 | |
| No magnetic shield | 1,719.75 | 84,078 | |
| Shields at level 1 | 1,720 | 92,584 | |
| Mirrors down at year 1,000 | 1,721.25 | 75,640 | |
| No shield, mirrors down at 1,000 (lean) | 1,721 | 63,412 | 999 / -254 |

So "Swift" (by year 1,600) and "A light touch" (under 70,000 machine-years) each sit between the
reference and a playthrough that plays that way.

When each achievement came, real seconds at 1x, in each scripted run that earned it (the city: a new
Standard world, seed 7, the scripted player guided, claiming, meeting needs, answering, trading,
siting, founding a metropolis, 5 hours; the others at the Classic pace except the reference):

| Achievement | | Earned in |
|---|---|---|
| The caps let go | | reference 4,400; city 4,658; walled 592; evacuation 592; lean 558; swift 558 |
| Open water | | reference 72,692; walled 9,200; evacuation 9,525; lean 9,108; swift 9,108 |
| Green at the water's edge | | reference 96,358; walled 12,058; evacuation 12,067; lean 12,058; swift 12,058 |
| Blue sky | | reference 162,125; walled 20,300; lean 20,292; swift 20,292 |
| Half an atmosphere | | reference 261,708; walled 32,758; lean 32,717; swift 24,642 |
| A breath of air | | reference 230,058; walled 28,783; lean 28,775; swift 28,775 |
| An ocean | | reference 95,150; walled 12,275; evacuation 12,592; lean 11,908; swift 11,908 |
| A living world | | reference 455,942; walled 57,025; lean 57,042; swift 51,125 |
| Home | | reference 458,600; walled 57,350; lean 57,367; swift 51,450 |
| A hundred people | | city 2,317 |
| A thousand people | | city 7,133 |
| A people | | city 17,633 |
| A great structure | | city 15,200 |
| Room to grow | | city 3,100 |
| A network | | city 4,967 |
| A metropolis | | city 7,142 |
| A thousand years | | walled 33,333 |
| A fortune | | city 14,233 |
| Lift-off | | city 1,708 |
| Delivered | | city 2,283 |
| Trusted by Earth | | city 5,125 |
| Decisive | | city 2,008 |
| Steady hands | | city 8,350 |
| Against the sea | | walled 24,633 |
| Everyone out | | evacuation 10,258 |
| Held the line | rare | walled 54,108 |
| Nobody lost to the sea | rare | walled 57,350 |
| A light touch | rare | lean 57,367 |
| Swift | rare | swift 51,450 |
| Self-reliant | rare | reference 458,600; walled 57,350; lean 57,367; swift 51,450 |

The reference playthrough earns none of the rare ones but "Self-reliant" (it never buys from Earth).
A world that loses its low city to the sea, run on to the victory, does not earn "Nobody lost to the
sea". The score of the scripted city world moved from its first hour to its third, live and offline
alike (two hours away at the Standard pace, inside the 10-hour cap): the same score, the same ending.

The ending's cost: 2.25 us a substep on a planet substep of about 23 us. The scripted city takes
32.3 s for its 5 hours of play (an empty metropolis among its settlements costs it most); the exit
gate's test file about 30 s in all.

## Verified by injection

Each fault put into the source alone, its test run, the file restored from a copy and `git status`
checked after each: 23 faults, 22 caught at once, 1 caught once its test was strengthened (13).

| # | Fault | Caught by | Message |
|---|---|---|---|
| 1 | The hold not started again on leaving the band | the victory's hold | expected 41 to be 80 |
| 2 | `advance` never counts the ending | the reference victory | expected null to be 55032 |
| 3 | Achievements never latched | the hold; each earned in a run | (no "living" achievement to read) |
| 4 | Machine-years not counted | the ending off; the machines counted | expected 0 to be greater than 0 |
| 5 | People who go with their homes not counted | the people lost | expected 0 to be >= 35.678 |
| 6 | Evacuated people not counted | the people moved | expected +0 to be 37.06 |
| 7 | Answers not counted | each earned in a run; every answer counted | "answered", "steady_hands" never earned |
| 8 | The victory not written to the save | kept whole | the endings differ |
| 9 | No v20 -> v21 migration | a v20 save | corrupt save: ending must be an object |
| 10 | A great structure that asks for no one counts | none in the first minute | three earned at 8 s |
| 11 | "Nobody lost to the sea" ignoring the losses | a world that lost a city | expected 57350 to be undefined |
| 12 | A city held with the sea anywhere over its ground | the held city's threshold | expected 1 to be +0 |
| 13 | The score's total leaving out the cities held | the score (after strengthening) | expected 615 to be 865 |
| 14 | The game never plays the victory | the victory in the game | the sequence begins at the first look |
| 15 | The victory played at every look | the victory in the game | expected 3 to be 1 |
| 16 | The card never comes | the victory in the game | expected true to be false |
| 17 | The player's record never noted | the title | expected false to be true |
| 18 | The list keeps no score | the title | "Score 0 - not won yet - 0 achievements" |
| 19 | The bonus not made into the tuning | the title | expected 3 to be 5 |
| 20 | A Standard world without the ending | the victory in the game | the sequence begins at the first look |
| 21 | No card for an achievement | the achievement card | expected [] to equal ["Achievement: Self-reliant"] |
| 22 | The away summary quiet about the win | coming back to a world won | the headline lacks the line |
| 23 | The score's speed not scaled by the years | the score | expected 1000 to be greater than 1000 |

## Verification

- `npm run typecheck`, `npm run build` and `npm run build:web` green (708.02 kB JS, 238.96 kB gzip;
  54.94 kB CSS). The built page, script and styles served over HTTP and fetched: the script holds the
  ending's words ("A living world", "New game plus", "Save and back to the title"), the styles the
  victory's card.
- `npx vitest run --maxWorkers=2 --minWorkers=1`: 132 files, 1,586 tests, 1,582 passed (742 s). The
  four failures:
  - the Known-red metropolis opening test, 400.5 ms against its 400 ms limit (recorded 440-545 ms);
  - three tests of earlier batches that pinned what a Standard world is, each now told of the
    ending: Batch 30's and Batch 28's exact list of a Standard world's rules (`first-hour.test.ts`,
    `pace.test.ts`), which now include ENDING_ENABLED (and a sandbox and a Terraformed start are
    checked to be without it); and Batch 33's v17 save (`decisions-gate.test.ts`), made by removing
    the newer fields from a new save, which kept the new `ending` - the migration rightly put an
    empty one in its place. Re-run, the three files pass (39 tests).
- Off by default: ENDING_ENABLED is 0 in the default tuning, so the golden run, the Batch 3 score,
  the golden frames and the exactness tests see the world they were calibrated against; the ending,
  on, changes no reservoir (tested: 2,000 substeps on and off, the planet the same to the bit).

## Open

For Batch 40:

- **"A light touch" and the score's pressure part are set from schedules that order the planet's
  machines without paying.** A player paying as they go builds slower and may run fewer
  machine-years; no paying script reaches the victory (the economy's spending plan stops at the
  shields and never buys the scrubbers or shades the late game needs), so it is unmeasured.
- **The score's weights** (1,000 for speed, 0.1 a person, 250 a city, 0.004 a machine-year) are a
  first proposal, measured only to the extent above: the reference scores 615 with no cities.
- **Old worlds, sandboxes and Terraformed starts have no ending**, by the decision above.
- **The player's record is per browser**, like the settings; an exported world carries its own
  achievements but not the record, and new game plus opens only with a victory in this browser.
- **Achievements earned while away get no card** (the away summary counts them).
- The scripted five-hour city crosses "A people" (4,000) 1,367 s before its end: a change that slows
  growth by a fifth would drop it from the run. The gate would say so.
