# Batch 33 - Events that ask for decisions

Built unattended (`/next-batch auto`), one session, 2026-10-16.

## What went wrong, and what it cost

1. **"Runs at half" could not be measured over the fault's whole time.** The first test compared
   what the city made of the failing building's resource over the fault's ten minutes, three ways:
   whole, degraded and broken down. Degraded should lose half of what breaking down loses. It lost
   0.474 of it. Per sample, the first sample after the deadline was 0.500 and most later ones
   0.466. The cause is a cascade, not a defect. The broken-down run's shortages brown out the
   buildings that meet the people's needs, the mood falls, and every building makes less, the
   failing one's resource included (Batch 32's output factor). The test now measures the ratio
   over the first sample, where the fault is all that differs: 0.5 to six places. Over the whole
   fault it asserts the order (whole > degraded > broken). It cost a test rewritten, and the
   finding that a broken-down machine costs a city more than its own output.
2. **"The default is never the best" was first judged on every store, and failed.** Keeping
   working against the default (twice the hits) did not dominate: the default wrecked more
   buildings, and a wrecked consumer stops drawing, so some stores ended higher. That is no reason
   to be glad of a wreck. "Best" is now judged at the deadline the outcome lands, on what each
   event is about and what the choices cost: the bank, the people, the building levels and
   buildings standing, the materials stored, and a fault's output. On that, a choice dominates the
   default in every event, by construction (the default is always the worst choice made worse)
   and by measurement.
3. **A supply ship's materials land in a full store.** The test town's store of 400 was full by
   the deadline, so every ship choice landed 0 materials and the measurement could not tell them
   apart. Batch 30 found the same: a growing city's materials are full from about 15 minutes in.
   The settlers were raised from 20 to 40 so the ship would still matter, then measured on the
   scripted playthrough and put back to 20 (below). The materials stay mostly wasted in a growing
   city: recorded as a known issue. The test gives its town three Storage Depots more, so the
   shares can be measured.
4. **Unanswered events bring the scripted city of 1,000 sooner at Standard.** With every event
   left to its default (the script answers none), the city of 1,000 came at 2.04 h against 2.16 h
   without events. Answered with the first choice it can pay, it came at 1.98 h. At Classic it came
   later, 1.82 h against 1.74 h. The 40-settler ship was suspected first. Cut back to 20, Standard
   moved not at all (2.04 h both ways) and Classic from 1.91 to 1.82 h, so the cut was kept. Then
   each kind was measured alone at Standard:

   | Kind alone | City of 1,000 |
   |---|---|
   | none | 2.16 h |
   | meteor | 2.19 h |
   | failure | 2.11 h |
   | outbreak | 2.29 h |
   | ship | 2.14 h |
   | discovery | 2.16 h |
   | all five | 2.04 h |

   The scripted city answers a shock by building what is short: a broken-down Solar Array brings a
   new one, which outlasts the fault. It is an instrument, so a loss can bring its 1,000 sooner and
   five losses together sooner still. The pacing test bounds the move at an eighth either way and
   keeps the 1-3 h target. It does not claim events slow the game.
5. **Five measured tests broke when new worlds took events on.** Each priced one feature by
   comparing new-world tuning with and without it. With events on, the defaulted events perturbed
   both runs differently:
   - the rovers' routes' cost: 1.144 against its bound of 1.1;
   - the needs' cost: 0.978 against its floor of 1.03;
   - the first-hour reward test: 367 s against its floor of 3,000 s;
   - the two mode tests, which list what each mode adds.

   Each comparison now runs with events off in both (Batch 32's new world, `STANDARD_32`), as
   measured before. The events' own effect has two new tests of its own. The guided first steps
   measured with events on finish at 43.8 min unanswered and 42.4 min answered (42.4 without).
6. **The boundary test forbids even a simulation test from importing the browser.** The gate test
   uses the browser's new-world tuning and was first written in `src/sim/`. It moved to
   `src/web/decisions-gate.test.ts`, beside the other measurements of the new world. The tests
   that need only the simulation stayed in `src/sim/decisions.test.ts`.
7. **The scripted player has no credits to answer with.** It spends its bank down to tens of
   credits (42 at 100 minutes). The choice tests give their town 5,000; the answering script takes
   the first choice it can pay, which for credit choices is usually the free one.
8. **Two of the first 44 injected faults changed nothing a test could see**, and each found a
   test missing, not a defect:
   - the deck's own off-switch, removed: the test called it at a substep with nothing to deal or
     resolve, where on and off do the same. It now calls it at the substep the first card falls
     on, with an event due, and checks on that it does both;
   - announcing, on opening a world, every event already past: no test opened a world with a
     record. One does now, and checks the next event is still announced.
9. **A number was written before it was measured.** The note's draft gave 151 cards dealt in 200
   slots of seed 7; measured, 141. The rule is to measure first; the draft broke it, the check
   before finishing caught it.
10. **A measurement was given the wrong length of run.** The note said the scripted world met 4
    events "in four hours"; the run behind it stops when every moment is reached, at 2.03 h, so
    it read as one event an hour against a design of one every 25 minutes. The check before
    finishing did not catch this one; review 1 did, and rejected the batch on it. Re-measured
    both ways (4 in 2.03 h, 6 in four hours) and corrected.

## What was built

- **The deck** (`src/sim/decisions.ts`). From 30 minutes of real time at 1x (216 substeps), a card
  slot every 20 minutes (144 substeps). A slot's card is dealt with chance 0.75, at a substep in it
  drawn by hash of the seed and the card's number, never a cursor (`cardAt`). The card falls on a
  standing city with people, drawn by hash. Its kind is drawn by weight from those that can happen
  there: a meteor needs a building it can hit, a failure a life-support producer, an outbreak 200
  people. Its particulars are fixed as it opens (`cardFor`): the failing building, the repair's
  materials, the outbreak's people at risk.
- **Five kinds, two or three choices each**, every cost paid when chosen (`chooseDecision`), every
  outcome landing at the deadline, 22 substeps (3 min 3 s) after opening, inside `advance`
  (`stepDecisions`, every substep, after the cities' own). The default is always the worst choice
  made worse:

  | Event | Choices (cost) | Default |
  |---|---|---|
  | Meteor shower | shelter (no materials or research for 1 min); shields (150 credits); keep working (3 hits, a level each, wrecking at level 1) | 6 hits, the first 3 the same draws as keeping working's |
  | Equipment failure | repair (half the cost x level, materials); degraded (50% of its output, 10 min) | broken down, offline 10 min |
  | Outbreak (200+ people) | treat (5 credits a person at risk; a fifth lost); quarantine (half lost, no growth 5 min) | all at risk lost, no growth 5 min |
  | Supply ship early (2 in 5) | land rough (3/4 of the cargo); clear the pad (30 materials, all) | half |
  | Supply ship late (2 in 5) | rush (100 credits, all); wait (half) | a quarter |
  | Supply ship lost (1 in 5) | search (100 credits, half); write off (60 credits' insurance) | nothing |
  | Discovery | study (100 credits now, 400 at the deadline); sell (150) | nothing |

  At risk in an outbreak: 10% of the people the city's built Medical Centers cannot shelter (400 a
  level, as the shortage rule counts them). The cargo is 150 materials and 20 settlers, as the
  city's stores and homes have room.
- **What lasts goes on the settlement** (`Settlement.effects`: shelter, quarantine, a fault by its
  building's tile). Each is counted down in the settlement's own substep, as a rover's job is. The
  city view and the alerts take that same substep, so they see it too. A fault follows its
  building through a claim (`shiftContent`) and goes with it when it is removed or wrecked.
- **The record**: the open events, each with the player's choice, and the latest 40 resolved
  (`SimState.decisions`), in the save as v18. When a card is dealt is never kept: it is a
  function of the seed.
- **On screen**: the event card (`src/web/decisions.ts`), at the top left. It shows what is waiting
  and where, the countdown at the world's speed, each choice with its cost and outcome, and the
  default. A choice the world cannot pay for is disabled, with the reason. **Show** *city* goes
  there, to the failing building. An event waiting is an urgent alert condition until answered.
  Its resolution is a record, or a notice when nothing was chosen. The alert centre gains the
  world's **Event history**, read from the world's own record, so it survives a reload. The city's
  status line says when its people are under cover or quarantined. The inspector says what a fault
  leaves, and a broken-down building's offline reason says why. Coming back says how many events
  came to a head and how many were unanswered.

## Measurements

### Each choice against the town alone, at the deadline

The scripted Standard city at 100 minutes (713 people, 90 buildings, 141 levels), with 5,000
credits. The ships' town has three Storage Depots more and 60 materials, so the cargo has room.
Measured as the difference from the same town run the same 22 substeps with no event.

| Event | Choice | Credits | People | Levels | Buildings | Materials | Left on the city |
|---|---|---|---|---|---|---|---|
| Meteor | shelter | 0 | 0 | 0 | 0 | 0 | shelter, 1 min |
| | shields | -150 | 0 | 0 | 0 | 0 | |
| | work | 0 | 0 | -3 | -2 | 0 | |
| | default | 0 | 0 | -6 | -3 | 0 | |
| Failure (a Solar Array, repair 10) | repair | 0 | 0 | 0 | 0 | 0 (10 paid, refilled) | |
| | degraded | 0 | 0 | 0 | 0 | 0 | fault 50%, 10 min |
| | default | 0 | 0 | 0 | 0 | 0 | fault 0%, 10 min |
| Outbreak (71 at risk) | treat | -355 | -14 | 0 | 0 | 0 | |
| | quarantine | 0 | -36 | 0 | 0 | 0 | quarantine, 5 min |
| | default | 0 | -71 | 0 | 0 | 0 | quarantine, 5 min |
| Ship early | rough | 0 | +15 | 0 | 0 | +112 | |
| | pad | 0 | +20 | 0 | 0 | +120 (150 - 30) | |
| | default | 0 | +10 | 0 | 0 | +75 | |
| Ship late | rush | -100 | +20 | 0 | 0 | +150 | |
| | wait | 0 | +10 | 0 | 0 | +75 | |
| | default | 0 | +5 | 0 | 0 | +37 | |
| Ship lost | search | -100 | +10 | 0 | 0 | +75 | |
| | write off | +60 | 0 | 0 | 0 | 0 | |
| | default | 0 | 0 | 0 | 0 | 0 | |
| Discovery | study | +300 | 0 | 0 | 0 | 0 | |
| | sell | +150 | 0 | 0 | 0 | 0 | |
| | default | 0 | 0 | 0 | 0 | 0 | |

Over the fault's first sample, degraded lost 0.500 of what breaking
down lost. During the shelter's minute the town made no materials. During the quarantine's
5 minutes, 8 samples of the city's record held no births.

### The scripted playthrough, events on

| | First building | First upgrade | City of 1,000 | Phase 2 |
|---|---|---|---|---|
| Standard, no events | 33 s | 21.5 min | 2.16 h | 1.65 h |
| Standard, events never answered | 33 s | 21.5 min | 2.04 h | 1.65 h |
| Standard, events answered | 33 s | 21.5 min | 1.98 h | 1.65 h |
| Classic, no events | 8 s | 19.9 min | 1.74 h | 12.4 min |
| Classic, events never answered | 8 s | 19.9 min | 1.82 h | 12.4 min |
| Classic, events answered | 8 s | 19.9 min | 1.81 h | 12.4 min |

The scripted run stops once every moment is reached: at Standard, at 2.03 h. In that time it met
4 events, opening at 33 minutes (a failure), 56 (a ship), 96 (an outbreak) and 111 (a meteor).
Played the full four hours, it met 6: the same four, then outbreaks at 139 and 160 minutes, and
none after - this seed's deck holds no card in the four slots from 170 to 250 minutes (each slot
is empty with chance 0.25, four in a row 1 in 256). Over the 127 minutes from the first to the
sixth, one every 25 minutes. The guided first steps end at 42.4 min without events, 43.8 min
with them unanswered, 42.4 min answered.

### The deck

- 200 slots of seed 7: 141 cards dealt (0.75 x 200 = 150; the test asserts 130 to 170); none
  before substep 216.
- Three hours from the scripted city at 100 minutes, defaults only: 5 events of 3 kinds (a meteor,
  two outbreaks, a meteor, a discovery; the test asserts at least 5 of at least 3 kinds), identical (`toEqual`) in one call, in ragged chunks, and caught up offline from a save.
  With the player answering every event as it opens, the same answers at the same substeps give
  the identical world in ragged chunks.

## Decisions (each taken as a bare "Go" would accept)

1. **The deck's timing is a function of the seed; the events are state.** When a card is dealt is
   a pure hash of the seed and the card's number, as storms are. But a choice cannot be derived,
   so the open events, the choices and the record are kept in the world (save v18).
2. **Costs when chosen, outcomes at the deadline.** A choice is paid for at once, so it can be
   refused when the world cannot pay, and cannot be taken back. Everything lands when the time
   runs out, inside `advance`, so the countdown means something and the outcome is on the substep
   grid.
3. **The default is the worst choice made worse:** twice the meteor's hits (the first half the
   same draws), broken down rather than degraded, the whole toll and the quarantine's stop, less
   cargo than waiting. So a choice always beats doing nothing, by construction.
   `validateTuning` refuses a tuning that would let a default catch up.
4. **What lasts goes on the settlement** and counts down in its own substep, so every reader of
   that substep (the city view, the alerts) sees it without being told.
5. **Earth's request waits for Batch 34**, which brings Earth's contracts and reputation; the
   deck has room for a sixth kind.
6. **On in new Standard and Terraformed worlds, off in a sandbox** ("no losses") and in every world
   made before (`MODE_OVERRIDES`; a world keeps the tuning it was made with).
7. **First event at 30 minutes, a slot every 20, chance 0.75, 3 minutes to decide**: after the
   guide's first five steps (50 s) and the first upgrade (21.5 min), about one event every
   25 minutes on average.
8. **The outbreak's medical capacity is the city's built Medical Centers** (400 people a level),
   the same shelter the shortage rule already gives them, rather than the need's reach (which is
   off in worlds without needs).
9. **The scripted pacing player answers no event** unless told to (`answer`): the instrument
   measures what events cost a player who ignores them. The answering script takes the first
   choice it can pay.
10. **Measured tests that price one feature run with events off in both runs**; the events'
    effect is measured by tests of its own.

## Injection run

44 faults, one at a time, each file restored byte for byte and checked after each; 42 caught at
once, 2 only after a new test (above). `git status` was clean after the run.

| # | Fault | Caught by |
|---|---|---|
| 1 | the deck ignores DECISION_CHANCE | the deck's slots (cards dealt) |
| 2 | the deck's first slot at 0 | the deck's slots; one call, chunked, offline |
| 3 | the deck ignores the seed | the deck's slots; another seed deals others |
| 4 | the deck stepped only on a call's first substep | one call, chunked, offline; with answers; the seed's sim-years; each choice; off by default |
| 5 | the deck stepped only on a call's last substep | the same, the save test aside |
| 6 | the deck steps with events off | **missed**; caught after the off-switch test was rewritten |
| 7 | resolved a substep late | each choice (all five); the assembled game |
| 8 | the record's bound ignored | the record's bound |
| 9 | the meteor's default no worse than keeping working | the meteor shower |
| 10 | shelter leaves nothing on the city | the meteor shower |
| 11 | the failure's default only degraded | the equipment failure |
| 12 | the outbreak's default as quarantine | the outbreak |
| 13 | the outbreak's toll from the people at the deadline, not its stake | the outbreak |
| 14 | the outbreak ignores the Medical Centers | the outbreak |
| 15 | the early ship's default as landing rough | the supply ship |
| 16 | the discovery's default pays as selling | the discovery; the default as a notice |
| 17 | a wreck's refund dropped | the wreck |
| 18 | a choice's credits not taken | paying when chosen; the meteor shower; the card |
| 19 | a choice not refused for want of credits | the refusals; the card's disabled choice |
| 20 | shelter does not stop materials | the meteor shower |
| 21 | quarantine does not stop growth | the outbreak |
| 22 | a fault does not cut output | breaks down or runs at its share; the equipment failure |
| 23 | a broken building still runs | breaks down or runs at its share |
| 24 | effects never run out | counts down a substep at a time; the equipment failure |
| 25 | a claim leaves the fault behind | follows its building |
| 26 | a removed building's fault stays | goes with its building |
| 27 | effects not saved | the save tests; Batch 19's settlement round trip |
| 28 | the open events and the record not read back | the save |
| 29 | the v17 migration gives no effects | loads a v17 save |
| 30 | the away line counts the whole record | coming back |
| 31 | the card: a choice it cannot pay for not disabled | the card's disabled choice |
| 32 | the card's countdown ignores the speed | the card |
| 33 | the card's fold does nothing | the card hides and folds |
| 34 | an answered event still waiting in the alerts | the alerts |
| 35 | a missed event only a record | the default as a notice |
| 36 | resolutions announced on the first look | **missed**; caught after the bearings test was added |
| 37 | the history oldest first | the history |
| 38 | the game never updates the card | the assembled game; the fault in the city |
| 39 | the game drops the player's choice | the assembled game |
| 40 | no history in the alert centre | the assembled game |
| 41 | a city's shelter not said | the city's words |
| 42 | a broken-down building's reason as "browned out" | the fault in the city |
| 43 | the inspector says nothing of a fault | the fault in the city |
| 44 | Standard worlds without events | the two mode tests (pace and first hour) |

## Open

- **Events while away come to their worst.** Live must equal offline, so an absence meets its
  events as an unattended game would: at Standard, about 20 events in a 10-hour absence. Whether
  a world should deal no cards while closed (a tuning that would change offline catch-up) is a
  design question for Batch 36's settings or Batch 40's playtest.
- **A supply ship's materials are mostly wasted** in a growing city whose store is full.
  Counting cargo that does not fit as credits sold back, or into a spaceport's own hold, is
  Batch 34's (Earth trade).
- **Earth's requests**: Batch 34.
- **Events make no sound**: Batch 35.
- **The card's place on screen** (top left; under the tool bar in a city) was checked only in the
  happy-dom harness, not looked at: no rendered frame of the HUD exists in this project. Batch 40's
  playtest.
