# Batch 31 - Knowing what is happening: alerts, notifications and statistics

Built unattended (`/next-batch auto`), in one session. "The player is told what needs them, when it
needs them, without hunting for it": an alert centre, toasts that interrupt by priority, statistics
for the planet and every city, and each city at a glance in the HUD and on the world map.

## What went wrong, and what it cost

- **The first alert look took 2.8 seconds on the example planet, every half second.** The watch
  worked out each building's corner on the ground as founded with `frameOf`, 19 µs a call, once
  per building per look: 42,249 buildings in the largest metropolis alone. It also looked each
  rover job's building up with a linear search. Nothing in the tests noticed, because no test world
  has more than a few dozen buildings. Measured with a scratch run over the example planet (42
  settlements, 246,095 buildings): 2,833 ms for a look after a step, and 2,798 ms for a look at a
  world that had not changed. Fixed with:
  - one ground frame a settlement;
  - a tile-to-building map kept per building list;
  - the happenings passed over for a settlement whose buildings, jobs, queue and claims are the
    same objects as at the last look;
  - each settlement's conditions kept per settlement object and planet, like its step.

  An unchanged look now costs 0.1 to 1.6 ms.
- **Even then, every new step cost a second step of every settlement.** The alerts read each
  settlement's next substep (`settlementStep`, the one the city view draws from), and a new step
  makes every settlement a new object. A look after a step cost 160 to 180 ms over the example
  planet, about as much as the simulation's own step (57 to 180 ms on this machine, under load).
  The HUD's overview lines, at the readout's 10 Hz, would have paid it again. Fixed in two parts:
  - **A look's budget (`ALERT_BUDGET_MS`, 4 ms).** A look works out new steps only while it has
    time, at least one a look, starting where the last look stopped. The other settlements keep
    what they showed until their turn.
  - **The overview cards read the alerts' shortages** (`shortagesOf`), never a step of their own.

  Measured after the fix, six steps of the example planet, 20 looks after each: looks after a step
  cost 4 to 24 ms for about 5 seconds (median 4.3 ms, 95th percentile 15.8, worst 24.3). Above the
  budget is one metropolis alone, which cannot be split. Every settlement is fresh in about 10
  looks, well before the next step at 1x (8.3 s). The first look on opening the world costs 561 ms:
  the biggest metropolis's first step, cold, which the simulation's own first step would otherwise
  pay.
- **The budget's first version starved.** With no time to spare, it worked out nothing at all after
  the first look: a settlement with something kept was always given its old result, and nothing
  ensured one was worked out. The budget test found it before any fault was injected (3 offline
  where 2 were expected). Now at least one settlement is worked out every look. A second fault (the
  round always starting at the first settlement) passed that test, because settlements already
  worked out are passed over for free. It starves only when every look is a new step, at a fast
  speed. The test now has that case too.
- **The first look on opening would have announced what was already so.** Once the opening look
  is spread over several looks, a settlement whose turn comes later would have toasted its
  conditions as new. A settlement worked out for the first time now takes its bearings, like the
  first look.
- **Four faults no test caught at first** (Injections, below):
  - the planet's sample taken without the weather;
  - buildings dark for a shortage listed again, each as "offline";
  - a blackout that points at no building;
  - the round that never moves on.

  Each has a test now, and each fault fails it.
- **Flood warnings are built but cannot be seen in the game.** The browser plays with flooding off
  until Batch 38. The flood alert, with Batch 25's words, is tested on Batch 24's drowning-city
  fixture with flooding on, and fires there for the low city only. It is not in the manual.
- **My scenarios were wrong four times before the alert tests passed.** That cost four rounds of
  test rework and no game code.
  - Storage depots draw nothing, so they are never offline.
  - The power store carries a deficit for a while, so the blackout came late: a run's store is now
    set dry as its cause.
  - The headquarters makes 3 water a year, which covers one dome: three domes make the thirst.
  - `connectAll` joined the buildings meant to stand alone.

## Decisions (taken unattended; a bare "Go" would accept them)

1. **The planet's record lives in the simulation.** `SimState.history`, a sample every
   `PLANET_HISTORY_EVERY` (4) substeps, taken in `advance` so it is the same played, offline or
   chunked. A sample holds the six axes the HUD shows, progress, the bank and the people. Once it
   holds `PLANET_HISTORY_SAMPLES` (240) samples, it keeps those on multiples of twice the gap and
   samples half as often. So it always reaches back to the start, in a bounded size. It only
   records, and nothing reads it back, so it is on by default and in every world. Old worlds start
   recording when they load. Save v17.
2. **A city's record gains what was made and what was drawn**, per resource per year (`made`,
   `drawn`). Samples from before them stay without them: nothing is made up. A sample gathering at
   the moment an old world loads goes without, and the next has them.
3. **Alerts are derived in the browser** at the readout, two looks a second (`ALERT_HZ`), from the
   state. The watch keeps only its bearings between looks. The centre's record lasts the session
   and is never saved ("never stored as truth"). The first look on opening a world takes its
   bearings: what is already so is listed in the centre, not announced.
4. **Three priorities:**
   - Urgent (toast for 12 s): a blackout; a shortage of water, oxygen or food; a flood warning.
   - Notice (toast for 6 s): buildings offline for a reason of their own (not connected, or not
     allowed by the planet); materials short; a dust storm coming.
   - Record (centre only, no toast): a build finished, an upgrade finished, an objective done.

   At most three toasts show at once. An urgent one puts out a notice rather than waiting behind it.
5. **An objective done goes in the centre without a toast**: the milestone card (Batch 30) already
   interrupts for it.
6. **"A storm coming" is forecast from the seeded weather**, two real minutes ahead at the speed
   played (`STORM_WARN_SECONDS`, 120). The weather is a pure function of the seed and time, so it
   is known ahead.
7. **A condition that comes back within a minute of ending is not announced again**
   (`ALERT_QUIET_MS`): a store at its limit flickers short and back every few substeps.
8. **An alert names a building by its corner on the ground as founded** (its tile plus the frame's
   corner), which a claim west or north does not move. A tile index would move.
9. **Grouping:** offline buildings are one line per settlement, type and reason ("3 Greenhouses
   offline in Ares"). Buildings dark for a shortage are counted in the shortage's own line, not
   listed again. In the record, the same alert again in one place is one line that counts up.
10. **The planner's charts and the statistics are one module** (`charts.ts`). The planner's
    Charts tab gains the production and use charts.
11. **The look's budget is 4 ms**, the round going on where the last look stopped. The overview
    cards read the alerts' shortages.

## What was built

- `src/sim/history.ts`: the planet's record, sampled in `advance` (`samplesAt`, `planetSample`,
  `recordPlanet`), halved when full. Two constants in `tuning.ts` and §10.
- `src/sim/micro/settlement.ts`: a city's record adds `made` and `drawn` per resource.
- `src/sim/save.ts`: save v17 with the planet's record, made and drawn, and the v16 to v17
  migration. A corrupt record is refused by name: a gap that is not a whole number of at least 1,
  samples out of order, or a sample after the world's own time.
- `src/web/alerts.ts`: the conditions (blackout, shortage, offline grouped, flood, storm) and the
  watch (conditions begun, builds and upgrades finished, objectives done), within a look's budget.
- `src/web/alert-centre.ts`: the centre (button, count, Now and What happened) and the toasts.
- `src/web/statistics.ts` and `src/web/charts.ts`: the statistics screen and the shared charts.
- `src/web/city-overview.ts`: a city at a glance, in the HUD's Settlements list and the world
  map's panel.
- `src/web/offline-words.ts`: why a building is offline, in one place for the city's inspector and
  the alerts.
- `src/web/city.ts`: `show(index)` selects a building and brings it to the middle of the view.
- `src/web/game.ts`: everything wired. An alert clicked goes down to its city, selects its
  building, closes the planner if it is open, or goes up to the planet, or opens Objectives.

## Measurements

The planet's record after 1,000 sim-years (a Standard-mode world with a city founded and left; the
reference policy on the default tuning):

| Run | Samples | Gap (substeps) | First / last sample | JSON |
|---|---|---|---|---|
| Classic pace | 125 | 32 | 32 / 4,000 | 25,203 B |
| Standard pace | 125 | 256 | 256 / 32,000 | 25,331 B |
| Reference, default tuning | 125 | 32 | 32 / 4,000 | 26,258 B |

About 202 to 210 bytes a sample. Full, the record holds at most 239 samples, under 51 kB, however
long the game. A city's record (150 samples, with made and drawn) is 25,046 B and 25,196 B in the
first two runs. The whole save of the Classic run is 51,628 B.

The alerts on the example planet (42 settlements, 246,095 buildings), on this machine:

| | Before | After |
|---|---|---|
| A look at an unchanged world | 2,798 ms | 0.1-1.6 ms |
| A look after a step | 2,833 ms | 4-24 ms each, for about 5 s |
| The first look on opening | - | 561 ms (the largest metropolis's first step) |
| The HUD's overview lines, 10 a second | a step of every settlement after each step | 0.2 ms (reads the alerts) |

## Tests

- `src/sim/history.test.ts` (12):
  - the record's sampling, halving and bound after 1,000 sim-years in both paces, with the
    measured size;
  - the same in any chunks;
  - nothing it records changes the world;
  - the save exactly, the v16 migration, corrupt records refused by name;
  - two more solar arrays make twice `SOLAR_POWER` more in a city's record.
- `src/web/alerts.test.ts` (14). Each alert type fires in a scripted Standard run that causes it,
  and not in one beside it:
  - a blackout (and what it points at, and no duplicate offline lines);
  - a blackout begun while watched against one already so on opening;
  - water short;
  - three greenhouses offline as one line;
  - a build finished;
  - an upgrade finished;
  - a flood warning in Batch 25's words, on the drowning-city fixture with flooding on;
  - a storm coming and gone, and none with the weather off;
  - an objective done once, not at 90 people, not in a Sandbox.

  Then: alerts come back the same from a reloaded world and a fresh watch; the planet is read
  afresh for the same city; the quiet spell; the look's budget, opening and under fast play; a
  healthy city says nothing for 200 substeps.
- `src/web/alert-centre.test.ts` (11):
  - the centre's count and urgent mark in words;
  - the record merging repeats of the same alert (not a different building in the same city), and
    the click-through;
  - the toasts' priorities, time and limit;
  - the planet's record as the instruments showed it, weather included, at every sample through a
    storm;
  - the statistics' charts;
  - the exit gate in the assembled game: an alert clicked opens the right city with the right
    building selected, from orbit (3 Greenhouses offline: the Greenhouse) and again from in the
    city (Water Extractor offline: the Water Extractor);
  - the HUD's overview line.
- `src/web/city-overview.test.ts` (3): builds going up, waiting and upgrading counted; what is
  short and the homes; the world map's panel.

## Injections

47 injections, one at a time, each against the tests meant to catch it. Each file was restored
from a copy and checked clean against git after each. **43 caught at once; 4 caught only after a
new or stronger test.** One fault, the sample taken without the weather, was injected twice: missed
by the simulation's tests, then caught by the statistics test written for it.

| Fault | Caught by |
|---|---|
| The planet sampled once a call, not every substep | the same in any chunks; samples every 4 substeps |
| Halving keeps the latest half | halves when full; begins at the beginning (1,936 against 32) |
| Never halves | stays bounded (1,000 against 125) |
| The gap not doubled | halves when full; stays bounded |
| The save drops the planet's samples | survives the save exactly; the measured size |
| The migration leaves no planet record | loads a save from before it (v16): "history must be an object" |
| The migration makes up made and drawn for a sample under way | loads a save from before it |
| Samples out of order accepted | refuses a corrupt record |
| Made recorded as drawn | two more solar arrays make twice SOLAR_POWER more |
| The record read back into the bank | changes nothing it records |
| The sample taken without the weather | missed by the sim's tests; then the statistics test, "as the instruments showed it, weather included" (212.96 against 213.08 K) |
| A power shortage never called a blackout | the blackout tests (5 failed) |
| Water, oxygen and food short only a notice | a shortage of water |
| Offline buildings not grouped | three greenhouses are one line of three (3 lines) |
| Buildings dark for a shortage also listed offline | missed; then the blackout test, "not each an offline line of its own" |
| The first look announces | one already so on opening is only listed |
| No quiet spell | the quiet spell; the blackout begun while watched |
| A build still going up reported finished | a build finished (5 titles against 1) |
| Upgrades never reported | an upgrade finished |
| An objective announced every look | an objective done once |
| The storm's look-ahead in substeps, not real time | a storm coming ("too far off") |
| A storm already risen still coming | a storm coming ("risen") |
| A flood warning only a notice | the flood warning |
| The step kept whatever the planet | the planet read afresh (half the sunlight) |
| The click-through selects the first building | the assembled game (Headquarters against Greenhouse) |
| The click-through forgets the building on the way down | the assembled game |
| A record toasts | a record never toasts |
| An urgent toast waits behind notices | an urgent one puts out a notice |
| The record never merges | the same thing again is one line counting up |
| Urgent not marked on the button | says when something is urgent |
| Production and use left out of the charts | the statistics' city charts |
| A city's statistics show the planet | the statistics' city charts |
| Upgrades counted as nothing in the overview | builds going up, waiting and upgrading |
| Waiting builds counted as nothing | builds going up, waiting and upgrading |
| The HUD's overview line never written | the HUD's overview line |
| The world map shows no overview | the world map's panel |
| The sample without the weather, again | the statistics, "weather included" |
| A shortage that points at no building | missed; then the blackout test, "a building to show" |
| An offline group that points at no building | the grouping test; the assembled game |
| The budget ignored | the look's budget (3 against 1 on opening) |
| No progress when out of time | the look's budget (3 against 2) |
| A settlement's first turn announced as new | the look's budget, "nothing announced that was already so" |
| The round always at the first settlement | missed; then the look's budget under fast play |
| Conditions kept whatever the planet | the planet read afresh |
| The happenings passed over when only the jobs changed | a build finished |
| The overview's shortages from the wrong settlement | what is short, and the homes |
| The record merges different buildings finished in one city | the same thing again is one line counting up (2 lines against 3) |

## Verification

To be filled in at the end of the session (typecheck, the full suite, both builds).

## Open

- **Flood warnings and "under water" are unseen in the browser** until Batch 38 turns flooding on.
  Both are built and tested with flooding on.
- **The record of what happened lasts the session.** It is not saved, by the exit gate's rule.
  What holds now is always shown, on opening as at any time.
- **No sound for an alert.** Batch 35 brings sound; Batch 36 brings settings, including a way to
  quiet alerts.
- **A city's record is its last 150 years** (about 80 minutes of play at 1x). The planet's covers
  the whole game, coarser as it goes. A long record of a city is not kept.
- **On a world as large as the example planet, an alert can come up to about 5 seconds late**
  after a step, the cost of the look's budget. The first look on opening such a world takes about
  half a second.
- **The charts have no readout under the pointer.** Each line's latest value is in its key and
  the canvas's label.
- **In a city, the toasts can sit over the Objectives panel** when both are open.
- **A new city shows "Spaceport offline in ..."** from its founding until power reaches it. It is
  true, and it is the guide's next steps.
