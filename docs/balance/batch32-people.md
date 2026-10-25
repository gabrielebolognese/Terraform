# Batch 32 - People, not a number: needs, services and happiness

Built unattended (`/next-batch auto`), one session, 2026-10-15; review 1's fixes in a second,
2026-10-16.

## What went wrong, and what it cost

1. **The example planet failed the needs outright.** Laid out before needs, by purpose - homes in
   suburbs and quarters, malls in commerce, laboratories in research, biospheres on the farms - a
   metropolis's homes were 1-10% in reach of each service. With needs on: mood -0.74 in the
   metropolises, 21 of 27 cities below 0, and 13 no longer "perfect" (a deficit of water, oxygen
   or food once output fell 7.5%). No reach fixes a layout like that: swept from 25 to 121 tiles,
   green space in a metropolis rose from 1% to 5% (its 644 parks and biospheres stand apart from its
   homes), and 19 cities stayed below 0 at 121.
2. **The first services pass ran over ten minutes** and was killed: every home no provider could be
   put in reach of still made the whole grid afresh (owners, five 2-D prefix sums). Made only after
   a placement, a city of 13,000 buildings took 6 s; with the grids kept up to date placement by
   placement, 1.4 s.
3. **Whole buildings only was too strict.** A provider first took only rectangles of whole
   buildings (whose footprint then covers all they touched, keeping every network joined). Among
   2 x 2 and 3 x 3 blocks a 4 x 4 park found room for 58% of a city's homes. Now every building
   under the rectangle goes, and its ground beyond it carries a corridor and a cable: a building
   joins both networks by touching, so those links keep every network as it was. Green space went
   to 100%; the example's network tests pass unchanged.
4. **The prefix sums were most of a metropolis's 15 s**: 6.4 s in the function that made them again
   for every placement (3 ms a call, 2,100 calls, CPU-profiled). The blocked test moved into the
   loop that already walks a candidate's tiles, and the homes not yet reached are kept as running
   sums along each row, updated only on the rows a placement touches: 5.7 s.
5. **Four of the example's layout tests failed** at first, each a rule the user had asked for: a
   street of two tiles round a building on a city's founding square, sixteen buildings at least on
   a grown chunk, every building in a zone, "zoned, not a jumble". The pass learnt the rules rather
   than the tests loosening: the street is kept on a founding square, a chunk keeps its sixteen,
   a provider joins the zone of what it replaced. All 21 example tests pass unchanged.
6. **Two metropolis tests failed next**: a chunk held 51 works (the user's limit is 50), and 118 new
   stations stood on no railway (the user asked for every station on the line). A chunk now holds
   no more than 50 or what it had, and **a station goes only beside a rail**, which it boards. That
   cost transport: the example's railways are a few lines across each city, so its stations reach
   0.9% to 65% of a city's homes (the metropolises 10-19%), and the moods fell from 0.80-1.00 to
   0.55-0.78. Still perfect, with needs on and off. Rail spurs to new stations are recorded for
   later.
7. **Needs move the first hours.** Two measured tests broke when new worlds took needs on:
   - the rovers' routes' cost (Batch 29) measured the routes and the needs together; it now compares
     like with like, needs off in both (1.128 and 1.057, as measured then);
   - the first-hour reward test: without the first reward, the steady supply came at 1.82 h, where
     with needs off it never came within the 2.2 h run. Past 500 people the needs slow that city
     (1,095 people at the end, not 1,205), and growing slower it found its 20 clean years. The
     reward is still worth 57 minutes; the two rovers' reward is worth 8.3 minutes to a city of
     1,000, not 10. Both assertions now hold the new measurements, with the reasons beside them.
8. **The comfort tier is dear.** Its first need wants a Biosphere: 800 materials against a new
   city's store of 400, and 45 minutes to build. The scripted player taught to meet needs built a
   Materials Depot at 5,500 s and no biosphere before its city reached 1,000 (2.14 h against the
   plain script's 2.16 h). Meeting comfort pays later, not in the first two hours. It is in the
   manual's tips; whether to cheapen green space early (a smaller park before open air) is the
   user's call.

9. **Review 1 rejected the batch, for four things**, fixed in a second session (2026-10-16). It
   cost a review round and a session:
   - **The game gave the wrong waiting time.** The services pass runs for the Example planet as
     well as for a Terraformed start, and the screen still said "about twenty seconds" for both,
     while the manual said 45 for one and 20 for the other. Measured again (see Measurements),
     both take 35 to 50 s: the screen, the comments that repeat it and the manual now say about
     forty seconds for both, and the known issue names both.
   - **The Cities page asked for transport and shops from 2,000 people**; they are asked from
     5,000 and 10,000, as the People page said.
   - **The chunk test could not fail for a per-call fault.** Its city of 11,000 asked for every
     need from the first substep, with bottomless stores and nothing going up, so its mood was the
     same on all 64 substeps: the mood found on a call's first substep and held for the rest of
     the call passed it. Its city now has 1,990 people, whose mood moves during the run (0.25;
     -0.10 from the first substep; -0.30 from about the 55th). With that fault in it fails (5,541
     people in 16 calls against 6,325 in one), and the test checks the mood did move.
   - **Two tests had no injection on record, and this note did not lead with what went wrong.**
     Both tests now have rows in the table (three faults, run in the fix session), and the note
     is in the order the rule asks.

## What was built

- **Needs in tiers** (`src/sim/micro/needs.ts`). Life support stays section 7.3's. Above it, six
  needs:

  | Need | Tier | Met by | Asked from | Weight |
  |---|---|---|---|---|
  | Green space | comfort | Park, Biosphere | 500 | 0.15 |
  | Food variety | comfort | kinds grown: Greenhouse, Biosphere, Mega Mall (2 for full) | 500 | 0.10 |
  | Medical care | services | Medical Center | 2,000 | 0.20 |
  | Research | services | Laboratory, Observatory, Research Forum | 2,000 | 0.15 |
  | Transport | services | Station | 5,000 (a station's people) | 0.20 |
  | Shops | services | Mega Mall | 10,000 (a mall's people) | 0.20 |

  A need is asked from its tier's people, never before one of its buildings may be built. A running
  provider reaches the homes whose middle is in the square `NEED_REACH_TILES` (33) a side about its
  own, `NEED_REACH_PER_LEVEL` (6) more a level, and - with the network on - on the same corridors
  (rails join stations' districts, as they join everything else). A need is met by the share of
  the city's homes, by the people they house, that a running provider reaches; food variety is the
  city's (food is hauled). Homes still going up house no one and count for nothing.
- **Happiness.** The mood is the sum over asked needs of `weight x (2 x met - 1)`: -1 to 1, 0 for a
  city asking nothing. Growth runs x(1 + `HAPPINESS_GROWTH` x mood) = x0.5 to x1.5, and every
  building makes x(1 + `HAPPINESS_OUTPUT` x mood) = x0.9 to x1.1 - resources and research credits,
  not the planet's CO2 draw (as the Industrial Command Center's boost). Shown to the player as
  50% + 50% x mood.
- **In the step.** The mood is found inside `settlementStep`'s brownout passes, after the network,
  on every pass: a pass only switches buildings off, so the mood only falls and the passes still
  settle. Derived every substep, never stored: no save change. Behind `NEEDS_ENABLED` (0); every
  new world turns it on (`NEW_WORLD_OVERRIDES`), every world made before keeps its recorded tuning.
- **The city panel's People section**, the inspector's "Reaches the homes of N people" and the
  crowd at a station or park, the planner's **Coverage** row (Off, Green space, Medical care,
  Research, Transport, Shops: the ground a running provider reaches washed green, the provider
  white, homes reached green, homes not reached red) and the Overview's needs
  (`src/web/needs-words.ts`, `city.ts`, `planner.ts`).
- **People in the view** (`src/render/people.ts`): at a running station or park, 2% of the people
  it reaches are there, drawn a figure for every 5, at most 16, along the platforms or paths, live.
  Skyscrapers' windows light by occupancy, as a dome's always did - with needs on only, so the
  golden frames keep their towers.
- **The example rebuilt** (`src/harness/services.ts`): see below.

## Measurements

**The exit gate** (`src/sim/micro/needs.test.ts`): 70 towers (11,200 homes), 11,000 people, a mine
and an observatory far from the homes; each need's provider in reach against out of reach (food
variety: two kinds grown against none), one substep of the real `advance`, against the same city
with needs off. Each need moved growth by `2 x weight x HAPPINESS_GROWTH` and output (materials, and
research credits) by `2 x weight x HAPPINESS_OUTPUT`, to nine decimals:

| Need | Weight | Growth moved | Output moved |
|---|---|---|---|
| Green space | 0.15 | 0.15 | 0.03 |
| Food variety | 0.10 | 0.10 | 0.02 |
| Medical care | 0.20 | 0.20 | 0.04 |
| Research | 0.15 | 0.15 | 0.03 |
| Transport | 0.20 | 0.20 | 0.04 |
| Shops | 0.20 | 0.20 | 0.04 |

Every need met: growth x1.5, output x1.1; none: x0.5, x0.9. A city of 400 (asking nothing) with
needs on takes exactly the state it takes with them off, over 8 substeps (`toEqual`). 64 substeps
at once equal 16 calls of 4, for a city of 1,990 whose mood moves during the run (0.25, -0.10,
-0.30: it grows about 40 people a substep, through 2,000 and 5,000).

**Off, nothing moved:** the golden run, the golden frames (planet, city, structures), the Batch 3
score, the visual continuity and offline tests: 8 files, 111 tests, all passed.

**The example planet** (needs on, after the services pass):

| | Before | After |
|---|---|---|
| Metropolis mood | -0.73 to -0.74 | 0.637 to 0.672 |
| Cities below mood 0 | 21 of 27 | none (the smallest 6 ask for nothing: 0) |
| Not perfect (supported, no deficit, nothing idle) | 13 | 0, with needs on and with them off |
| Least met of an asked need, but transport | 0.00 | 0.899 (research, the city of 10,764) |
| Transport met | 0 to 0.01 | 0.009 to 0.654 |
| People in its cities | 1,912,752 | 1,710,360 (-10.6%; a city at most -14.2%) |

The pass: 16.7 s for the 27 cities on this machine (shared with other sessions), the metropolises
about 3 s each. Built whole, one process each, this machine:

| Built | With the pass | Without it |
|---|---|---|
| Example planet (the batch) | 45.0 s | 21.9 s |
| Example planet (review 1) | 34.9 s | 20.0 s |
| Example planet (the fix session) | 102.4 s (the first, cold), 49.7 s, 37.5 s | 25.9 s, 21.0 s |
| Terraformed start (review 1, seed 12345) | 39.1 s | - |
| Terraformed start (the fix session, seeds 12345 and 7) | 40.9 s, 47.8 s | - |

Both are made about twice as slowly as before; the game and the manual say about forty seconds.

**Pacing** (`src/web/pace.test.ts`, the plain script, which builds no services):

| | Needs off | Needs on |
|---|---|---|
| Standard: first building / first upgrade / Phase 2 | 33 s / 21.5 min / 1.65 h | the same, to the second |
| Standard: a city of 1,000 | 2.02 h | 2.16 h (x1.069) |
| Classic: a city of 1,000 | 1.66 h | 1.74 h (x1.048) |

A city of 1,000 at 1-3 h (Batch 28's target) still holds. Before 500 people nothing changes. The
taught first-hour player (guide and claims): every goal within 0.6 minutes of before; a city of
1,000 at 1.67 h (1.66).

**The step's cost** (`settlementStep`, needs off against on, medians of 8 interleaved on this shared
machine): the largest metropolis (41,074 buildings) 155 against 147 ms; a city of 12,871 buildings
53 against 71 ms; a city of 1,161 buildings 6.0 against 4.2 ms. Within the machine's noise; the
needs' reach is kept per building list, and only what runs is read each substep.

## Injections

One fault at a time, the file restored after each and checked against its copy.

| Fault | Caught by |
|---|---|
| Output not multiplied by the mood | the six exit-gate tests, every-need-met |
| Growth not multiplied by the mood | the six exit-gate tests, every-need-met |
| The mood found once, before the brownout passes | a provider browned out reaches no one |
| A provider counted whether it runs or not | not running; browned out |
| The corridors not asked | over the city's networks |
| A home going up counted | a home still going up counts for nothing |
| Asked from the tier alone, not the building's people | asks for comfort from 500... |
| Reach the same at every level | every-need-met (three levels up); further a level up |
| Food kinds counted whether running or not | browned out (variety) |
| An unasked need counted | too small to ask; NEEDS 0 equals a city asking nothing |
| Unmet costs nothing (mood from met alone) | the exit-gate tests |
| Research credits not multiplied by the mood | first missed: no test read research. Every test city now has an observatory out of reach; caught by the exit-gate tests |
| The fallback after the passes without the mood found again | changes nothing: unreachable (the passes always settle before running out) |
| Needs on in every world (`needsOn` not reading `NEEDS_ENABLED`; review 1's probe, run again) | no needs with them off, nor for an outpost; the six exit-gate tests, every-need-met |
| Outposts asked like cities (both guards gone: either alone changes nothing, the other holds) | no needs with them off, nor for an outpost (alone) |
| The mood found on a call's first substep and held for the rest of the call | first missed: the chunk test's city had one mood all run. Its city now grows through two thresholds; caught by the chunk test (alone) |
| Happiness words: the sign flipped | People section; the words |
| People section never shown / shown with needs off | the People section's two tests |
| The inspector's reach line dropped | a station's reach; a dark station |
| The crowd always 0 | a station's crowd; the crowd drawn |
| The crowd drawn nowhere | the crowd drawn |
| Towers lit as ever / by occupancy with needs off | lights by occupancy |
| People reached counted for a dark provider | a dark station reaches no one |
| Coverage: a dark provider's homes counted reached | a dark station: every home a gap |
| Planner: overlay never painted / gaps painted as reached | the coverage paint; a dark station |
| Planner: coverage bar shown with needs off / its button doing nothing | coverage offered with needs on |
| The view never carrying `reaches` | the station's reach, the crowd, a dark station |
| New worlds without needs | the pace tests (overrides, the needs' cost) |
| Example: no services pass at all | the example's needs test (perfect with needs on, every need met) |
| Services: no street on a founding square | zoned, not a jumble; room round every building |
| Services: chunks thinned below sixteen | zoned; every chunk with room full |
| Services: chunks filled past fifty | the metropolises' works, 50 at most a chunk |
| Services: a provider in no zone | zoned; every city planned in zones |
| Services: no corridor or cable where a cut building stood | runs every building; the needs test; joins every settlement into one network; and, quick, the services test's links |
| Services: a station anywhere, off the railway | every station on one line |
| Services: nothing made good | makes what it draws; the needs test |
| Services: green space always a park, even before open air | the services test (green space by a biosphere) |
| Services: the target's square ignored (a provider placed anywhere) | the services test (every need met) |
| Services: a port or the headquarters may be replaced | the example's test run dies with it (its worker exits, twice); the quick test "never takes the headquarters or a spaceport" |

The quick services test (`src/harness/services.test.ts`, a 6,240-home metropolis built by hand)
was added for faults the example takes minutes to show, or cannot show at all: with the
replace-the-port fault in, the example's own test run died both times (its worker exited) before
any test could report. Built once, the example then had 2 headquarters and 4 spaceports replaced
(none as committed). The quick test missed two faults at first: its homes did not crowd the
headquarters, and its wall-to-wall domes stayed joined without the leftover links. It now has a
town where only the headquarters' ground has room, and checks the leftover links directly.

## Decisions

Each taken in the run, where a bare "Go" would have accepted it.

1. **Six needs above life support, two tiers; space per person left out.** People never outnumber
   homes (section 7.3 clamps them) and growth fills every home, so spare room is unmet in every
   settled city whatever the player builds: a tax, not a choice.
2. **Jobs not now.** A labour model reprices every building and every measured gate; happiness's
   output factor stands in for how well people work.
3. **A need is never asked before its building may be built:** asked from the larger of its tier's
   people and the least of its providers' (a station 5,000, a mall 10,000).
4. **Mood symmetric about content:** met adds, unmet takes away, half met is neither; growth
   x0.5-1.5 and output x0.9-1.1. A city asking nothing is exactly as before. Unhappy people do not
   leave: growth only (section 7.3's decline is life support's).
5. **Output is what buildings make and research earns,** not the planet's CO2 draw - as the
   Industrial Command Center's boost.
6. **Reach is the command centre's square, 33 + 6 a level,** home middle to provider middle, over
   the corridors (rails join), running providers only, homes weighted by the people they house.
   Upgrading a service widens its reach: a reason to upgrade.
7. **Derived inside the brownout passes, never stored:** no save change, nothing to migrate.
8. **On in every new world**, Standard, Sandbox and Terraformed start alike; the Terraformed start
   is the example, so the example had to meet the needs.
9. **The example rebuilt, its rules kept** (streets, 16 to 50 a chunk, zones, stations on the
   railway), transport met in part for it.
10. **The scripted pacing player unchanged** (it builds no services): the instrument measures what
    the needs cost a player who ignores them. A `needs` script option measures one who meets them (corrected after review 2: it read "one who does
    not").
11. **The crowd is display:** 2% of the people a station or park reaches, a figure per 5, at most
    16 (render constants, not simulation tuning).
12. **Towers lit by occupancy with needs on only,** so worlds before, and the golden frames, are
    drawn as they were.

## Open

- **Transport in the example** reaches 0.9% to 65% of a city's homes: its stations must board a
  railway, and it has a few lines. Rail spurs to new stations would serve the rest (recorded for
  later in `GAME_PLAN.md`).
- **The Example planet and a Terraformed start take about forty seconds to make**, twice as long
  as before (the services pass). For Batch 40's performance pass, with the example's own 20 s.
- **The comfort tier's first need is dear:** a Biosphere (800 materials, 45 minutes) at 500 people,
  or a Park only on a terraformed world. A cheaper early green space is the user's call.
- **Happiness is not on the overview cards, in Alerts or in Statistics.** An alert for an unhappy
  city, and the mood in a city's record (a save change), would be the next steps.
- **Food variety counts kinds, not amounts:** one greenhouse beside a hundred makes two kinds.
- **The layout of the People section and the Coverage row was not looked at in a browser** (none is
  opened in an unattended session); checked against the CSS and in happy-dom only.
- **Jobs** and **space per person**: recorded for later in `GAME_PLAN.md`.
