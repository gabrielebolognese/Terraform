# Game plan: from simulation to game

`BUILD_PLAN.md` built the simulation and its views, Batches 1 to 25: a planet that terraforms, cities
on its ground, flooding, a world map. This document is what turns that into **a game someone sits
down to play**. It is the source of truth from Batch 26 on; `/next-batch` reads it.

What is missing, in the user's words (2026-10-11):

> "a loader menu, a new game like minecraft worlds, real times (right now we have a few minutes but
> that's far too low for buildings - we do start with a few dozen of seconds and minutes but as
> structures get bigger or upgrades get bigger, we should have more and more of a time). Also right
> now some things are far too low quality: for example the trains, the rovers, they skin through
> buildings. We should have more of a gameplay."

## Where the game stands (measured, 2026-10-11)

- **No front door.** The browser boots straight onto one planet. There is no title screen, no menu,
  no way to start over or keep two games. Saves go to IndexedDB through `SaveStore`, which already
  takes a slot name; the game only ever uses one slot.
- **One clock, and it runs fast.** At 1× a sim-year is 33 real seconds (`TIME_SCALE` 0.03), and the
  whole terraforming arc is about 2,860 sim-years: about 26 real hours. A building takes
  `BUILD_YEARS_*` sim-years: 0.1 for a depot (3.3 s) up to 2 for a mega mall (66 s).
  - **An upgrade takes exactly as long as the first build** (`buildJob` reads `buildYears(type)`,
    never the level). Levels go to 5, 8 or 10.
  - Speeds of 1×, 10×, 100× and 1000× make even those seconds vanish.
- **Vehicles ignore the city.**
  - Rovers drive in a straight line from the headquarters' garage to their job, through every
    building between (`roversAt` in `src/render/city.ts`; their trip time, `roverYears`, is the same
    straight distance).
  - Trains keep to their rails, but cars visibly cut through buildings. Where (turns, car length,
    draw order) is undiagnosed.
- **No sound at all**: no audio code, no audio files.
- **Gameplay is a sandbox with a long goal.** The pieces exist:
  - planet levers, an economy with credits, the tech gate and phases;
  - 28 building types with levels and networks;
  - claims, a planner, railways between settlements, flooding with a forecast.

  What a game would add on top is missing: a first hour that teaches, objectives and rewards,
  decisions under pressure, consequences you can see coming, an ending, a reason to start again.
- **Batch 26** (procedural structures) is built, tested and looked at, but not committed. Its draw
  cost is measured.

## Status

| Batch | Name | Status |
|---|---|---|
| 26 | Procedural structures (finish) | **COMPLETE** - [note](docs/balance/batch26-structures.md) - seeded signatures and greebles on the shape pipeline; +4-5% shapes up close, next frame +1 ms |
| 27 | The front door: title screen and worlds | **COMPLETE** - [note](docs/balance/batch27-worlds.md) - title screen, worlds with their own saves and seeds, Standard / Sandbox / Terraformed start; a world that will not load is kept, never saved over |
| 28 | Time that means something: real build and upgrade times | **COMPLETE** - [note](docs/balance/batch28-build-times.md) - the curve (20 s to 8 h), a build queue, a Standard pace (planet 8x slower, cities on their own clock) beside Classic; first upgrade misses 4-8 min |
| 29 | Vehicles that use the city: rovers on the ground, trains on the line | **COMPLETE** - [note](docs/balance/batch29-vehicles.md) - rovers drive routes round the city (new worlds; their length sets the trip), trains ride car by car on a track each way and stop at stations; every vehicle drawn behind what stands in front of it; no vehicle inside a building, measured |
| 30 | The first hour: onboarding and objectives | **COMPLETE** - [note](docs/balance/batch30-first-hour.md) - a guide through seven first steps, driven by the state; nine objectives in three chains with rewards (settlers, rovers, materials, credits, the metropolis, gold markers); milestone cards and a chime; the guide takes 42 min (claiming land waits for 200 people) |
| 31 | Knowing what is happening: alerts, notifications and statistics | **COMPLETE** - [note](docs/balance/batch31-alerts.md) - alerts derived at the readout, each type fired by a run that causes it and not by one beside it; toasts by priority and the alert centre, each clicking through to its city and building; the planet's record in the save, bounded by halving (125 samples, 25 kB after 1,000 sim-years); statistics; each city at a glance |
| 32 | People, not a number: needs, services and happiness | **COMPLETE** - [note](docs/balance/batch32-people.md) - six needs above life support in two tiers, met by running services in reach of the homes over the corridors; happiness from them moves growth (x0.5 to x1.5) and output (x0.9 to x1.1), each need by its tuned factor through a real `advance`; coverage overlays, crowds, towers lit by occupancy; the example rebuilt with its services among the homes, every city perfect with needs on |
| 33 | Events that ask for decisions | **COMPLETE** - [note](docs/balance/batch33-events.md) - a deck dealt from the seed brings an event about every 25 min from 30 min in: meteor shower, equipment failure, outbreak, supply ship early/late/lost, discovery; choices paid when made, outcomes at the deadline inside `advance`, the default the worst choice made worse; identical live, chunked and offline; the card, alerts and an event history kept in the world (save v18); Earth's request left to Batch 34 |
| 34 | Earth: shipments, contracts and the market | **COMPLETE** - [note](docs/balance/batch34-earth.md) - launch windows every 2.135 planet-years from the window's number (50 measured, at most a substep late, no drift); each city's spaceport rocket flies at a window with sales and contract goods and lands a third of a window later with the order, a rocket away missing the window; a market by supply (seeded), trade and reputation that never pays more than it asks; contracts for materials, water or research, met for credits and reputation, failed for reputation; settlers and rovers unlocked; the Earth panel; save v19 |
| 35 | Sound: music, ambience and effects | **COMPLETE** - [note](docs/balance/batch35-sound.md) - one Web Audio engine, four channels and the player's volumes, no context before the first gesture; every sound made by the game: music written as it plays by the phase reached, crossfaded over 8 s; wind by pressure and storm, rain, sea, the machinery near the city camera; effects as crossings in the state, placed in the city view; the same world to the bit heard or not; settings kept per player; licences in docs/credits.md |
| 36 | Settings, controls and accessibility | **COMPLETE** - [note](docs/balance/batch36-settings.md) - every setting in one panel, kept per player in a store of their own (Batch 35's record moved, never deleted); detail held or Auto, pictures kept, moving details off, each level's frame time measured on the player's machine; 21 shortcuts by physical key, two rebindable slots each; camera speed, edge scrolling, invert zoom, trackpad and touch in every view; panel size, colour-blind palettes measured under simulated colour blindness, reduced motion, high contrast, pop-ups; autosave interval, Ctrl+S, where the worlds are kept; a second cue for every colour code, held to a register of the stylesheet's rules; the same world to the bit whatever the settings |
| 37 | Terrain resource deposits (was `BUILD_PLAN` 27) | NOT STARTED |
| 38 | Flood defences and the rising water; flooding on (was `BUILD_PLAN` 28) | NOT STARTED |
| 39 | The ending: victory, scores and achievements | NOT STARTED |
| 40 | Playtest pass: performance, polish and an adversarial review | NOT STARTED |

The order is by what the player meets first, and by what later batches stand on:
- worlds before time, so a re-paced game can be started fresh;
- time before vehicles, because trip times feed build times;
- objectives before events, so events have something to threaten.

## How every batch here is held

Everything in `BUILD_PLAN.md`'s **Cross-batch invariants** still holds: purity, the one-way walls,
reservoirs as the only truth, every constant in `tuning.ts` and the §10 table, exact determinism,
the ledger identity, strict TypeScript, flows not net rates. So do the working rules in
`.claude/commands/next-batch.md`.

Three more, specific to turning this into a game:

1. **A game feature must still pass the simulation's gates.** Anything that changes what the
   simulation computes either keeps the golden run, the Batch 3 score and the golden frames where
   they are, or ships behind a tuning constant at 0 with the browser opting in. Menus, sound and
   alerts read the state; they never write it.
2. **Fun is measured too.** Every batch that changes pacing states its targets in real minutes at
   1×, and measures them on a scripted playthrough before and after: time to the first building,
   the first upgrade, the first city of 1,000 people, the first phase. "Feels better" is not an
   exit gate; "the first upgrade lands at 4 to 8 minutes, measured" is.
3. **Old saves keep working.** Every save change carries a migration and a test that loads the
   previous schema. A player's world is never lost to an update.

---

## Batch 26 - Procedural structures (finish)

**Goal.** Close the batch in flight. Its spec, exit gate and decisions are `BUILD_PLAN.md`
§Batch 26 and the Phase 1 already agreed (option B: the shape pipeline, the generator on top).

**Built (uncommitted on 2026-10-11):**
- `src/render/structures.ts`: seeded variation of the signatures, and greebles on the signatures'
  own flat faces.
- Complexity by level.
- `structures-sheet.png` with its golden test.
- Six structure tests.
- Re-baked city frames and re-measured far colours.

**Measured draw cost** (a 64 × 64-tile area, through the browser's chunks, against Batch 25):

| City, high detail | Shapes | Next frame |
|---|---|---|
| Largest city | +5% | 20 → 21 ms |
| Metropolis | +4% | 18 → 19 ms |

The first build of each chunk costs 12-17% more. Medium and low detail are unchanged.

**Left:**
- [ ] Finish the injection run, one fault at a time (the session ended mid-run; every file was
  checked restored).
- [ ] Full verification.
- [ ] Delete the scratch scripts (`src/harness/_look*.ts`, `src/harness/_cost.ts`) and the
  `../game-base` worktree. Remove its `node_modules` junction with `rmdir`, never a recursive delete.
- [ ] Note `docs/balance/batch26-structures.md`; mark COMPLETE here and in `BUILD_PLAN.md`;
  README row; commit; push.

**Exit gate.** `BUILD_PLAN.md` §Batch 26, verbatim.

**Done** - see [the note](docs/balance/batch26-structures.md).
- All 12 injections caught.
- One finding: the metropolis-opening timing test failed under a full run's load (403.7 ms against
  400; 145-148 ms alone). It is simulation code this batch does not touch, so it was left at its
  limit and is assigned to Batch 40.

---

## Batch 27 - The front door: title screen and worlds

**Goal.** "A loader menu, a new game like minecraft worlds." The game opens on a title screen. The
player keeps any number of worlds, each its own planet with its own save, and starts, continues,
renames, copies, exports and deletes them.

**Deliverables:**
- [x] **A title screen** before anything loads:
  - Continue (the last world played);
  - Worlds;
  - New world;
  - Example planet (today's "See example planet");
  - Settings (a stub until Batch 36);
  - Credits.

  Over a slowly turning planet, drawn by the existing globe.
- [x] **The worlds list.** One row per world:
  - its name, a thumbnail (the globe as last seen), the phase reached;
  - its playtime, sim-year and last played;
  - Play, Rename, Duplicate, Export (a file), Delete (confirmed by typing the name);
  - Import a world from a file.
- [x] **New world.**
  - Name; seed (random, or typed - the same seed gives the same world).
  - Mode:
    - **Standard**, today's game;
    - **Sandbox**: unlimited materials and credits, everything unlocked, no losses;
    - **Terraformed start**: the example planet as a starting point that saves.
  - Pace (Batch 28's presets once they exist).
  - Each world records the tuning it was made with, so a later rebalance never silently changes an
    existing world.
- [x] **Storage:**
  - one `SaveStore` slot per world;
  - a world index (name, metadata, thumbnail) kept apart from the saves, so the list opens without
    loading a world.
  - The existing single save becomes the first world on first launch, by migration.
- [x] **Leaving a world:** an in-game menu (Esc) with Resume, Save, Settings, and Quit to title
  (saving first). Autosave keeps its 15-second rhythm per world.

**Exit gate:**
- An existing save from before this batch opens as a world called "My planet", identical to the
  last bit (`toEqual`) to loading it the old way.
- Two worlds made from the same seed and mode are identical. Two seeds differ.
  - Measured on the start state.
  - Measured after 100 sim-years of the reference policy.
- Export, delete, then import gives back the world exactly.
- The title screen, the worlds list and the new-world dialog are covered through the real
  components in happy-dom: create, play, quit to title, continue, rename, delete.
- A world that fails to load (corrupt, or a future schema) is listed with the reason. It is never
  deleted, and never stops the others from opening.

**Decisions for Phase 1:**
1. **What a seed changes.**
   - Today the planet's elevation field is fixed, and `state.seed` drives only the weather.
   - Seeding the terrain moves base elevations, sea level and the globe, all three of which must
     agree (Batch 22, conflict 1).
   - The decision: seed terrain too, or weather and events only for now.
2. **Sandbox and the gates.** Sandbox must not leak into Standard: a mode is a tuning, recorded in
   the world.
3. **Where the example planet lives.** Today it is a mode that never saves. A "Terraformed start"
   world does save. Both, or one?

**Done** - see [the note](docs/balance/batch27-worlds.md). All 21 injections caught.

**Decisions taken:**
1. The seed turns the terrain (`TERRAIN_SEED`): a uniform rotation of the elevation field, read
   alike by the simulation, the shader and the software renderer. At 0 it is the original planet.
2. Sandbox is `SANDBOX_ENABLED` at 0, set only in a Sandbox world's recorded tuning.
3. Both: the look-only Example planet from the title, and "Terraformed start" worlds that save.

**What changed from the plan, and why:**
- Pace is shown but fixed at Standard: Batch 28 brings the presets.
- A defect was fixed on the way. Before, a save that failed to load was replaced by a fresh planet
  at the first autosave. Now nothing starts over a world that will not load.
- The example planet takes 19 s to build, not the 3 s its comment claimed. That puts about 21 s on
  creating a Terraformed world, and 71 s on its test. Speeding it up is Batch 40's.
- The game moved out of `main.ts` into `game.ts` as a world that can be started and stopped. The
  city, travel prompt and world map gained `dispose()`: their window listeners had never been
  removed.

---

## Batch 28 - Time that means something: real build and upgrade times

**Goal.** "We start with a few dozen seconds and minutes, but as structures get bigger or upgrades
get bigger, there should be more and more time." Building has the rhythm of a builder game:
- a first structure in under a minute;
- an hour into the game, builds of several minutes;
- the great structures and the top levels take hours, and finish while the player is away.

**Deliverables:**
- [x] **A build-time curve**, in real time at 1×: `time(type, level) = BASE[type] × GROWTH^(level - 1)`.
  - `BASE` is set by size and tier, and `GROWTH` per tier. All in `tuning.ts` and the §10 table.
  - Proposed starting targets, to be measured and tuned:

    | Building | Level 1 | Top level |
    |---|---|---|
    | Depot | 20 s | about 20 min |
    | Solar array | 30 s | |
    | Reactor | 4 min | 3 h |
    | Habitat dome | 2 min | |
    | Spaceport | 15 min | |
    | Mega mall | 1 h | 8 h |
    | Biosphere | 45 min | |

- [x] **Upgrades follow the curve.** Each level takes longer than the one before, never the first
  build's time again.
- [ ] **Rover trips** (deferred to Batch 29: there are no roads to follow yet) add the drive along their real route (Batch 29), not the straight line.
- [x] **A build queue per city:**
  - jobs wait for a free rover;
  - the queue is shown, reorderable and cancellable (with a refund);
  - more rover posts mean more builds at once.
- [x] **Offline:** long builds keep going while the game is closed. Coming back says what finished
  ("While you were away: the reactor reached level 4, the mega mall is half built").
- [x] **Speed:**
  - The 100× and 1000× speeds move to Sandbox (and to a debug setting).
  - Standard runs at 1×, with a pause and a 2× or 3× for the planet's slow stretches. Decided in
    Phase 1.
- [x] **The countdown shown everywhere a build is:** over the worksite, in the city panel, in the
  queue, in real time ("3 min 20 s").

**Exit gate:**
- The curve, measured through a real `advance`: each build and upgrade takes its tuned real time
  at 1× to within one substep.
- Each level takes strictly longer than the last.
- A scripted Standard playthrough meets its targets, measured before and after. Proposed targets,
  to be agreed in Phase 1:
  - first building done before 1 min;
  - first upgrade done at 4-8 min;
  - first city of 1,000 people at 1-3 h;
  - first phase reached at 6-12 h of play.
- Offline equals live play through a long build's completion, exactly.
- The golden run and the Batch 3 score are unchanged, or deliberately re-baselined with the reason
  recorded.

**Decisions for Phase 1:**
1. **One clock or two.** The planet and the cities share one deterministic sim clock; that is what
   makes offline catch-up exact. Real build times then come from either:
   - **(a) Re-pacing the clock.** `TIME_SCALE` slows so a sim-year is several real minutes, and the
     arc takes days or weeks of real time with offline doing the heavy lifting. The build curve is
     stated in real seconds and converted.
   - **(b) Build times far longer in sim-years**, on today's clock. Then the planet terraforms
     visibly during a single build.

   Two clocks would break determinism and is not offered. Recommendation: (a), with the arc's real
   length chosen from measurement.
2. **Everything per sim-year slows with (a).** Production, consumption, income and the city
   economy all move per real second. The city economy needs re-measuring; the planet's balance in
   sim-years does not move.
3. **Pay to hurry?** Spending credits or materials to finish a build early: a builder-game staple,
   but a design choice.

**Done** - see [the note](docs/balance/batch28-build-times.md).

**Decisions taken:**
1. **(a), as the world's pace.** "Standard" slows the planet 8x (`TIME_SCALE` 0.00375) with the
   substep shrunk to match (1/32 sim-year, still 8.3 real seconds). A new `CITY_CLOCK` (8) keeps the
   cities' real-time rhythm. "Classic" is everything before, and every existing world, read from
   its recorded tuning. The default tuning is unchanged, so the golden run, the Batch 3 score and
   the golden frames do not move.
2. The city economy was left per sim-year, with the cities on their own clock. Measured, a city of
   1,000 people comes at 1.79 h.
3. No pay to hurry.

**What changed from the plan, and why:**
- **"First phase at 6-12 h"** was impossible: Phase 1 is at sim-year 2. It became Phase 1 within
  15 min (8 s) and Phase 2 at 1-3 h (1.65 h).
- **The first upgrade misses 4-8 min** (19.9 min; 19.3 at Classic). An upgrade's +10% for a full
  building's price is the cause, not build times.
- **Rover trips along the real route** wait for Batch 29.
- **Offline runs at the live rate for 10 hours** in a Standard world, so builds finish while away.
  Ten 48-hour absences still stay short of the arc (1,350 of 1,710 sim-years).
- **Found:** a Terraformed world catches up at 39 s per hour away (Classic 11 s). Left for
  Batch 40, with the example's build time.

---

## Batch 29 - Vehicles that use the city: rovers on the ground, trains on the line

**Goal.** "The trains, the rovers: they skin through buildings." Every vehicle moves the way a real
one would: rovers on corridors and open ground around buildings, trains along their rails with
their cars, nothing through anything.

**Deliverables:**
- [x] **Rover routes.** A path from the garage to the job:
  - over corridors first, then open buildable ground, never under a building, never over hard rock
    or steep ground;
  - turning where the path turns.

  The route is computed once per job, in the simulation (it sets the trip time Batch 28 uses), and
  deterministic. No reachable path means the job is refused, with the reason.
- [x] **Rover motion.** The rover follows its route at a steady speed, faces where it drives, and
  works at the site with its arm animated. More than one rover on a stretch keep apart.
- [x] **Trains.**
  - Diagnose where cars cross buildings: turns, car length, the order they are drawn in.
  - Fix it: cars follow the rail's curve car by car; slow for turns; stop at stations and dwell;
    never leave the rail.
  - Junctions are taken by the existing permutation rule.
  - Maglev and freight look different.
- [x] **Depth.** Vehicles are sorted with the buildings, so one passing behind a building is hidden
  by it.
- [x] **The cost is measured.** Pathfinding for every job in a metropolis, and drawing hundreds of
  vehicles, inside the frame budget.

**Exit gate:**
- **No vehicle inside a building.** Over a scripted day in the reference city and in a metropolis,
  at every frame sampled, no rover or train car's footprint overlaps a building's footprint.
  - Vacuity: the same check on today's code finds overlaps, counted.
- Every rover route stays on corridors, open ground or its own job site, and its trip time equals
  its route's length at the tuned speed.
- Every train car stays on rail tiles. A train passes through a station, stopping, within the tuned
  dwell.
- The frame time in the metropolis with vehicles moving is measured and stated, against the frame
  before this batch.

**Decisions for Phase 1:**
1. **Rovers on open ground or only on corridors.** Corridors only is cleaner, and gives the player
   a reason to build roads; open ground is more forgiving.
2. **Do routes change trip times on old saves?** A job already under way keeps its old time.

**Done** - see [the note](docs/balance/batch29-vehicles.md). Built unattended (`/next-batch auto`), in two
sessions: the first was cut off after its main commit, the second ran the injections, fixed what they
found and wrote the manual. The first review rejected it: the steep-ground rule had been called
untestable, wrongly (levelling leaves steep ground with no crag), and seven tests had never been broken
by a fault. A fix session tested both, and strengthened three tests that could not fail: 46 of 48
faults caught, the other 2 change nothing.

**Decisions taken:**
1. **Both, corridors first.** Rovers drive corridors and open ground the city holds, and a corridor
   is twice as quick (`ROVER_CORRIDOR_SPEEDUP`). Corridors only would leave a new headquarters'
   rovers nowhere to go: it is founded with none.
2. **No.** A world keeps the tuning it was made with: routes are `ROVER_ROUTES_ENABLED`, on in every
   new world and off in the worlds before, whose trips stay the straight line. A job under way
   keeps its time (a v14 job loads without a route). Every rover in every world is still drawn
   round the buildings, on a route found for it.

**What changed from the plan, and why:**
- **The trains' fault was the draw order, not their geometry.** A car's footprint was in a
  building 17 times in 268,800, but the browser drew each chunk's moving layer over its still
  picture: 17% of cars were painted over a building in front of them. The moving layer now draws
  again, clipped to each vehicle's own outlines, what stands in front of it. (Clipped to a box, the
  first version blended a dome's glass twice round a train: 786 pixels, worse than nothing. The
  injections found it in the second session, after the depth test was shown to look at a moment
  where nothing covered the car.)
- **Three placement rules the plan did not have**, because with routes the scripted player walled in
  its own garage after 13 buildings:
  - a building that would wall others in is refused;
  - the garage door is kept clear;
  - nothing goes up where a rover is driving.
- **Each way of a line has its own track,** drawn double and curved at bends. On one track, trains
  each way ran through each other. Cars are 0.56 tiles long, five a train: the longest that pass on
  every shape a line takes.
- **Freight runs on lines past no station, maglevs on the rest.**
- **Trains of different lines still cross through each other at junctions** (no signals). Left open.
- **Pacing:** in the scripted city, packed without streets, rovers drive 4x the straight line. The
  city of 1,000 comes at 2.02 h at Standard (1.79 before), still inside 1-3 h.
- **Found on the way:** the frame's visibility loop over a metropolis's 13,000 chunks, and
  `rocksOf`'s half-million-key set, both slowed by this batch's code around them, were rewritten. A
  frame and a metropolis's opening are back at or under their old times.

---

## Batch 30 - The first hour: onboarding and objectives

**Goal.** "More of a gameplay." A new player is taught by doing, and every player always has a
next goal worth reaching and a reward for reaching it.

**Deliverables:**
- [x] **Guided first steps** in Standard, on a new world. Skippable, and never shown again once
  done. In order:
  1. found a city;
  2. place power;
  3. place a dome;
  4. connect them;
  5. raise a building a level;
  6. claim land;
  7. lay a railway to a second settlement.

  Each step highlights what to press and waits for the player to do it. Driven by the state, not by
  a script that can fall out of step.
- [x] **Objectives.** A chain of goals with rewards (materials, credits, an unlock, a cosmetic),
  shown in a panel.
  - **City:** reach 500 people; run a week without a shortage.
  - **Planet:** raise the pressure to 100 mbar; first liquid water.
  - **Network:** three cities joined.
  - Later goals open as earlier ones finish. Each says exactly what counts and how far along it is.
- [x] **Milestones:** a moment, a card and a sound when a phase is reached, a city is founded, a
  great structure is finished.
- [x] **Rewards that matter.** What an objective pays is tuned against Batch 28's pacing: a reward
  must shorten the road to the next goal by a stated amount.

**Exit gate:**
- A scripted new player (the reference policy plus the guided steps) finishes the guided steps in
  a measured time, proposed 10-20 minutes. No step can deadlock: each is reachable from the state
  the step before leaves.
- Every objective is reachable in Standard (a scripted run reaches it) and none is reachable by
  accident in the first minute.
- Objective progress is derived from the state, never stored, except the record of which are
  claimed. It survives the save exactly.
- Objectives and rewards are off in Sandbox, and no reward breaks the golden run (rewards are game
  state, behind the mode).

**Decisions for Phase 1:** the objective list itself and its rewards, written out in full before
building.

**Done** - see [the note](docs/balance/batch30-first-hour.md). Built unattended (`/next-batch auto`)
in one session. All 45 injected faults caught, one only after a new test (the guide latched once a call
rather than every substep: seen only when a city is lost to the sea within one call). Review 1 found
two faults in the record and the panel. The planet's two temperature goals counted their bars from
absolute zero, so a new world showed them 98.7% and 78.0% full. The first upgrade was recorded as
meeting Batch 28's 4-8 minutes at 1.8 minutes. Both are fixed, with six more injections, all caught.

**Decisions taken:**
1. **The list,** measured and tuned, each opening when the one before it in its chain is claimed:
   - City: a hundred people (50 settlers); steady supply, 20 city-years in a row at 200+ people with
     nothing short (75 settlers); a town of 500 (2 rovers for good); a city of 1,000 (2,000 credits
     and the metropolis unlocked).
   - Planet: the caps let go, Phase 2 (1,000 credits); thicker air, 100 mbar (2,000); first water,
     Phase 3 (3,000).
   - Network: joined by rail (200 materials); three cities joined (2,000 credits and gold markers).
2. **The guide's progress is a latch in the world,** set in `advance` from the state like the
   phase; the card shows it carried forward through what the state shows now. Skip is an action.
3. **On in new Standard worlds only** (`GUIDE_ENABLED`, `OBJECTIVES_ENABLED`, 0 by default): not in
   a sandbox (the spec), a Terraformed start (every goal met) or any world made before.
4. **Claims are the player's** (a Claim button); rewards land in the largest city, as far as it has
   homes and room. The unlock is founding a metropolis, which the browser never offered; the
   cosmetic is gold markers; the sound is a procedural chime.

**What changed from the plan, and why:**
- **The guided steps take 42 minutes, not 10-20.** Claiming land waits for 200 people (the user's
  rule), and a city grows from 4 settlers at a tenth a year: 22 minutes at the very least. The first
  five steps take 50 seconds.
- **"A week without a shortage" became 20 city-years in a row** (about 11 minutes at 1x): the
  city's record is kept a year a sample, and a week is no unit the game has.
- **City goals pay settlers and rovers, not materials.** A growing city's materials store is full
  from about 15 minutes in; the first claims landed 9 of 150 materials. Two rovers bring the city of
  1,000 ten minutes sooner; one, a minute.
- **A rover reward is saved state** (`extraRovers` on the settlement), so the save change is wider
  than the claims alone. Save v16.
- **Milestones include an objective done,** so a reward waiting is never missed.
- **The metropolis gate broke Batch 29's vehicle tests** (their scene founded a metropolis in a new
  Standard world, unchecked); the scene's world now holds the unlock.
- **Batch 28's open item, the first upgrade at 4-8 minutes, is still missed.** It was first
  recorded here as met at 1.8 minutes, which is outside the window; review 1 corrected it. The
  guide brings the first upgrade too early: it asks for one at 42 s, the step latches at 50 s, and
  the level is done at 108 s (1.8 minutes). The untaught script brings it too late, at 21.5 minutes.
  An upgrade's worth is unchanged.
- **The planet's temperature goals are measured from the planet as the world began** (review 1).
  Counted from absolute zero, "The caps let go" showed 213.2 of 216 K, 98.7% full on a new world,
  for a goal 1.65 hours away. Its bar now runs from 213.0 K (Mars's start, no weather) to 216 K,
  and "First water"'s to 273.15 K. A new world shows them 4.7% and 0.2% full. The bar follows the
  temperature the HUD shows and the phases judge, weather included. On the first goal's 3 K that
  moves it a lot: 48% at 45 minutes, 0% at 60, 90% at 90 in the planet played alone.

---

## Batch 31 - Knowing what is happening: alerts, notifications and statistics

**Goal.** The player is told what needs them, when it needs them, without hunting for it.

**Deliverables:**
- [x] **An alert centre:**
  - shortages and blackouts;
  - a building offline and why;
  - builds and upgrades finished;
  - a flood warning (Batch 25's words);
  - a storm coming;
  - an objective done.

  Each clicks through to where it happened (the city, the building, the planet). Grouped, so a
  hundred offline depots are one line.
- [x] **Toasts** for the moment, the centre for the record. Priority decides which interrupt.
- [x] **Statistics:**
  - per city and per planet, over time: population, each resource's production and use, power
    balance, credits, the planet's axes;
  - charts from the planner's existing ones, unified;
  - the history kept as samples in the save, bounded.
- [x] **A city overview card on the world map and the HUD:** people, shortages, builds in progress.

**Exit gate:**
- Every alert type fires in a scripted run that causes it, and does not fire in one that does not
  (vacuity both ways).
- Alerts are derived from state changes inside the readout, never stored as truth. The history the
  charts show survives the save and is bounded (measured size after 1,000 sim-years).
- Through the real components: an alert clicked opens the right city with the right building
  selected.

**Done** - see [the note](docs/balance/batch31-alerts.md). Built unattended (`/next-batch auto`) in
one session. Every alert type fires in a scripted Standard run that causes it and not in one beside
it. The flood warning fires on Batch 24's drowning-city fixture with flooding on, which the browser
leaves off until Batch 38. The planet's record measured 125 samples and 25.2-26.3 kB of JSON after
1,000 sim-years, and can never pass 239 samples. In the assembled game, an alert clicked from orbit
opens Ares with the offline Greenhouse selected, and one clicked from inside the city selects the
Water Extractor. 47 injected faults: 43 caught at once, 4 only after a new or stronger test.

**Decisions taken** (none were set for Phase 1; each recorded with its reason in the note):
1. **The planet's record lives in the simulation,** sampled in `advance` every 4 substeps, halved
   when full (240), so it spans the whole game in a bounded size. It records and is never read back,
   so it is on in every world, old ones from their next load. Save v17.
2. **A city's record adds made and drawn** per resource; older samples are left without.
3. **Alerts are derived in the browser** two looks a second; the record of what happened lasts the
   session; the first look on opening takes its bearings.
4. **Priorities:** urgent (blackout, water, oxygen or food short, flood); notice (offline, materials
   short, a storm coming); record only (built, upgraded, objective done - the milestone card already
   interrupts for an objective).
5. **A storm is forecast** two real minutes ahead from the seeded weather; a condition back within a
   minute of ending is not announced again.

**What changed from the plan, and why:**
- **A look had to be given a budget.** Over the example planet (42 settlements, 246,095 buildings)
  the first version took 2.8 s a look; with each settlement's conditions kept per step it still cost
  a second step of every settlement after each step (160 ms). A look now works out new steps for
  4 ms at most, settlements in turn, and the overview cards read the alerts' shortages: 4-24 ms a
  look for about 5 s after a step, then 0.1-0.5 ms.
- **Flood warnings are built but not seen in the browser,** where flooding is off until Batch 38.
- **The planner's charts and the statistics became one module,** so the planner gains the made and
  used charts too.

---

## Batch 32 - People, not a number: needs, services and happiness

**Goal.** Population is something the player looks after, not a counter that fills the homes. What
people need beyond survival decides how fast a city grows and how well it works.

**Deliverables:**
- [x] **Needs in tiers:**
  - life support, as today;
  - comfort: parks, food variety, ~~space per person~~ (left out: see below);
  - services: medical, research, shops, transport.

  Each from the buildings that provide it, within a reach, over the city's networks.
- [x] **Happiness**, derived from the needs met. It changes growth (as the research forum's bonus
  does now) and productivity: a building runs a little better or worse.
- [x] **Coverage overlays in the planner:** where medical, parks or transport reach, and the gaps.
- [x] **People in the view:** a crowd count at stations and parks; lights by occupancy.

**Exit gate:**
- Each need, met against unmet in otherwise identical cities through a real `advance`, moves growth
  and output by its tuned factor, measured.
- Behind a tuning constant at 0 (it changes settlement balance). The browser opts in; the Batch 3
  score and golden run are unchanged with it off.
- The example planet's cities are re-measured. Their stats stay "perfect" with the needs on, or the
  example is rebuilt to meet them.

**Decisions for Phase 1:** how many needs, and whether jobs (people working buildings) come in now
or never.

**Done** - see [the note](docs/balance/batch32-people.md). Built unattended (`/next-batch auto`) in
one session. Each need, met against unmet in otherwise identical cities through one substep of the
real `advance`, moves growth by twice its weight times `HAPPINESS_GROWTH` and output (materials
and research credits) by twice its weight times `HAPPINESS_OUTPUT`, to nine decimals. Behind
`NEEDS_ENABLED` (0); the golden run, the golden frames, the Batch 3 score and determinism are
unchanged with it off (111 tests). Every new world turns it on; worlds made before keep their
recorded tuning. The example planet, laid out before needs, measured a metropolis mood of -0.74 and
13 of its 27 cities short with needs on; rebuilt with services among its homes, every city is
perfect with needs on and off, every asked need but transport met for 89.9% of homes or more.

**Decisions taken** (each recorded with its reason in the note):
1. **Six needs above life support, two tiers.** Comfort from 500 people: green space (a Park or a
   Biosphere) and food variety (two kinds grown). Services from 2,000: medical care, research,
   transport (a Station, from 5,000) and shops (a Mega Mall, from 10,000) - never asked before
   their building may be built. **Space per person is left out:** people never outnumber homes and
   growth fills every home, so spare room is unmet in every settled city whatever the player
   builds: a tax, not a decision.
2. **Jobs: not now.** A labour model reprices every building and every measured gate; happiness's
   output factor stands in for how well people work. Recorded for later.
3. **The mood:** each asked need adds its weight met and takes it away unmet (-1 to 1, 0 for a city
   asking nothing). Growth x(1 + 0.5 x mood), output x(1 + 0.1 x mood); unhappy people do not
   leave. Output means what buildings make and research earns, not the planet's CO2 draw (as the
   Industrial Command Center's boost).
4. **Reach:** a running provider reaches the homes whose middle is in the square 33 tiles across
   about its own (6 more a level), on the same corridors (rails join stations' districts); homes
   weighted by the people they house.
5. **Derived inside the substep's brownout passes, never stored:** no save change.
6. **On in every new world** (Standard, Sandbox and Terraformed start alike).

**What changed from the plan, and why:**
- **The example had to be rebuilt** (`src/harness/services.ts`). Its districts kept homes, services
  and farms apart: a metropolis's homes were 1-10% in reach of each service, and green space reached
  5% even with a 121-tile square. Each city is now given providers among its homes, over buildings it
  can spare, keeping the example's own rules (streets, 16 to 50 a chunk, zones, stations on the
  railway). It costs the example 10.6% of its people and 16.7 s more to build, measured.
- **Transport is the one need the example meets in part** (0.9% to 65% of a city's homes): a
  station goes only beside the railway, and the example's railways are a few lines. The cities'
  moods are 0.55 to 0.78 for it, the metropolises 0.64 to 0.67.
- **Needs move the first hours' pacing.** The scripted player builds no services: its city of
  1,000 comes at 2.16 h, not 2.02 h (Standard), still inside the 1-3 h target. The first comfort
  need wants a Biosphere, 800 materials against a new city's 400 and 45 minutes to build: a player
  meeting it by 1,000 people is not faster (2.14 h).

---

## Batch 33 - Events that ask for decisions

**Goal.** The planet and the cities throw problems the player must answer: choices with costs, not
only weather that happens.

**Deliverables:**
- [x] **A deterministic event deck,** seeded by the world as storms already are:
  - a meteor shower (shelter, or risk damage);
  - equipment failure (pay to repair now, or run degraded);
  - an outbreak (medical capacity matters);
  - a supply ship early, late or lost;
  - a discovery (spend to study, for research);
  - an Earth request (Batch 34) - left to Batch 34, with Earth's contracts.
- [x] **Each event** gives two or three choices with stated outcomes, a deadline, and a default if
  ignored. Resolved inside `advance`, chunk-independent, and caught up offline like everything else.
- [x] **Event log and history in the alert centre.**

**Exit gate:**
- The same world seed gives the same events at the same sim-years, live or offline, chunked any way
  (`toEqual`).
- Each choice's outcome is measured through a real `advance` against the other choices.
- An ignored event resolves to its default, and the default is never the best choice (checked per
  event).
- Behind a tuning constant at 0. The browser opts in.

**Done** - see [the note](docs/balance/batch33-events.md). Built unattended (`/next-batch auto`) in
one session. A deck dealt from the world's seed brings an event to one of the player's cities from
30 minutes in, about every 25 minutes at 1x: a meteor shower, an equipment failure, an outbreak,
Earth's supply ship early, late or lost, a discovery. Each gives two or three choices paid for when
chosen, and its outcome lands at its deadline three minutes on, inside `advance`. The same seed gives
the identical world (`toEqual`) in one call, in ragged chunks, caught up offline from a save, and
with the player's answers given at the same moments. Each choice is measured against the town alone
and the others. The default is the worst choice made worse, and some choice dominates it in every
event, measured. Behind `DECISIONS_ENABLED` (0); new Standard and Terraformed worlds turn it on.

**Decisions taken** (none were set for Phase 1; each recorded with its reason in the note):
1. **The deck's timing is a function of the seed; the events are state.** The open events, the
   player's choices and the latest 40 resolved are kept in the world (save v18).
2. **Costs when chosen, outcomes at the deadline.**
3. **The default is the worst choice made worse:** twice the meteor's hits, broken down rather
   than degraded, the outbreak's whole toll and the quarantine's stop, less of the ship's cargo.
4. **What lasts goes on the settlement** (sheltering, quarantine, a faulty building), counted down
   in its own substep, so the city view and the alerts see it.
5. **Earth's request waits for Batch 34** (contracts and reputation).
6. **On in new Standard and Terraformed worlds**, never a sandbox's, nor a world made before.

**What changed from the plan, and why:**
- **Earth's request is not in the deck:** it belongs with Batch 34's contracts.
- **"The default is never the best" is judged at the deadline on what the event is about** - the
  bank, the people, the levels and buildings standing, the materials stored, a fault's output - not
  on every store: a wrecked consumer stops drawing, and some stores ended higher for it.
- **The supply ship's materials mostly land in a full store** (Batch 30's finding: a growing
  city's are full from 15 minutes in). The settlers matter; the materials are a known issue for
  Batch 34.
- **Unanswered events bring the scripted city of 1,000 sooner at Standard** (2.16 h to 2.04 h;
  answered 1.98 h) and later at Classic (1.74 h to 1.82 h; answered 1.81 h). The script answers a
  shock by building what is short. The first half hour is unchanged to the second.
- **Five measured tests that priced one feature on new-world tuning** now run with events off in
  both runs; the events' own effect is measured by tests of its own.

---

## Batch 34 - Earth: shipments, contracts and the market

**Goal.** Earth is part of the game: it sends supplies, asks for exports, and pays for them. The
spaceport gets a job.

**Deliverables:**
- [x] **Shipments:**
  - rockets bring ordered goods on a schedule set by the launch windows (every 26 months, by sim
    time);
  - the spaceport's rocket is the one in the view;
  - a missed window waits for the next.
- [x] **Contracts:** Earth asks for amounts of materials, research or water by a date, and pays in
  credits and unlocks. Failing costs reputation.
- [x] **A market:** what goods cost and what Earth pays moves with supply, and with the player's
  reputation.
- [x] **Interplanetary trade** in the economy panel, tied to the existing credits.

**Exit gate:**
- Launch windows land on the dates the orbit gives (synodic period 2.135 years), measured over 50
  windows.
- A contract fulfilled, against the same run failed, changes credits and reputation by the tuned
  amounts.
- Behind a constant at 0 (it moves the economy). The browser opts in, and the Batch 3 score and
  golden run hold with it off.

**Done** - see [the note](docs/balance/batch34-earth.md). Built unattended (`/next-batch auto`) in
one session. The k-th launch window opens at the first substep on or after the planet's year
k x 2.135, worked out from k: over 50 windows, measured through a real `advance` in chunks blind to
them, every one is at most a substep late (0.030 of a 0.03125-year substep at Standard, 0.245 of 0.25
at Classic) and the mean gap is 2.1346 and 2.1327 years. That is about 9.5 minutes at 1x at
Standard, 71 seconds at Classic. At a window each city's rocket - a rocket job on its first finished
spaceport whose rocket is home, the one the view draws - lifts off with what is sold and what the
contracts take, never a store below a quarter of its room, and lands a third of a window later (3
min 12 s at Standard) with what was ordered; what does not fit is sold back, settlers with no home
refunded. A rocket away (a supply run) or a spaceport still going up misses the window, and the
orders wait. Prices are each good's base x Earth's supply that window (seeded, +-20%) x the
player's buying or selling (remembered, half forgotten each window) x reputation (+-25%), and Earth
never pays more than it asks (`validateTuning`). Each window Earth offers a contract for materials,
water or research, due three windows on: met, it pays and reputation rises 10; failed, it falls 20;
settlers are for sale after one met, rovers after three. A contract met against the same run failed
differs by its reward in credits and by 30 in reputation, measured in the scripted player's world
at 60 minutes. Behind `EARTH_ENABLED` (0); new Standard and Terraformed worlds turn it on. A player
who does not trade plays the same to the bit.

**Decisions taken** (none were set for Phase 1; each recorded with its reason in the note):
1. **Windows by the planet's calendar**, k x 2.135 of its years from the start, not the cities'
   clock: the orbit is the planet's.
2. **The spaceport's own rocket carries it**, both ways, as a rocket job: the view draws it, and a
   supply run holds it, which is what makes a window missable.
3. **Paid when ordered, refunded if cancelled; sold as it goes up.** What does not fit as it lands is
   sold back; a settler with no home refunded.
4. **One offer each window, dealt from the seed and the world, due three windows on.** Research goes
   to Earth instead of the bank while its contract is open: a contract is credits later for credits
   now.
5. **Unlocks are Earth's goods**: settlers after one contract met, rovers after three.
6. **On in new Standard and Terraformed worlds**, never a sandbox's or a world made before. The free
   supply run is unchanged.
7. **An offer is said by the Earth button, not the alerts**: one comes every window.

**What changed from the plan, and why:**
- **"The economy panel" is the Earth panel**, opened from the bar beside Statistics and Alerts: the
  HUD's economy is one line of the orbit view, and trade is wanted from a city too. The panel shows
  the bank and the trade so far.
- **Contracts are sized by a window's span in a city's years**, not in units: the planet's calendar
  runs eight times faster than the cities' at Classic, and a fixed 150 materials made the scripted
  trader fail 23 contracts in its first Classic hour.
- **Earth's request is a contract, not an event card**: Batch 33 left it here, and the contracts are
  Earth's requests.
- **Fun, measured**: a scripted player who sells spare materials and takes the materials contracts it
  can send at once had the city of 1,000 at 2.05 h against 2.16 h and Phase 2 at 78.5 min against
  99.2 min at Standard, with 3 contracts met and none failed; at Classic the city of 1,000 came 25 s
  later (0.4%), 14 met and 1 failed.

---

## Batch 35 - Sound: music, ambience and effects

**Goal.** The game is heard: a score that follows the planet's arc, the city's hum, and every
action answered.

**Deliverables:**
- [x] **An audio engine** over the Web Audio API: channels for music, ambience, effects and
  interface; volumes; muted until the first user gesture (as browsers require).
- [x] **Music by phase:** sparse and cold at the start, warmer as the planet greens. Crossfaded,
  never cut. CC0 or self-made, with the licence recorded.
- [x] **Ambience:** wind by pressure; the city's machinery by what runs nearby; rain once there is
  weather; the sea once there is a sea.
- [x] **Effects:** place, build done, upgrade done, a train passing, a rocket launch, an alert, an
  objective done. Positional in the city view (louder near the camera).
- [x] **Settings:** a volume per channel, saved per player rather than per world.

**Exit gate:**
- The audio layer reads the state and never writes it. The simulation is identical with sound on
  and off.
- In a headless harness with a fake `AudioContext`: each effect fires once per event, ambience
  follows its driver, music changes with the phase.
- No audio starts before a user gesture, checked.
- The asset licences are listed in `docs/credits.md`.

**Done** - see [the note](docs/balance/batch35-sound.md). Built unattended (`/next-batch auto`) in
one session. One Web Audio engine for the session (`src/web/sound-engine.ts`), four channels into a
master, each with the player's volume; no `AudioContext` is made before the first click, key or
touch, and what is asked for before then is dropped, never saved up. Every sound is made by the
game: the music is written as it plays from a piece per phase reached (Cold Ground, 40 beats a
minute in a minor mode with glassy glints, to Living World, 68 in a major key with a bass;
tempo, brightness and notes rise every phase), crossfaded over 8 s from wherever the old piece
stood; the wind follows the pressure and the dust storms, rain the clouds over open water above
freezing, the sea the ocean and how near a city is to its shore, the machinery what runs near the
city camera. Effects are crossings seen between two looks at the state (built, upgraded, a rocket
up), a train coming near the camera, a building placed, an alert that pops up and a milestone
card; in the city view they are placed by where they happen. Tested against a fake `AudioContext`
that writes everything down: no context before a gesture (the engine, the title, the assembled
game); each effect once per event; each bed following its driver; the music changing with the
phase and never cut; and a scripted run heard every substep, its states frozen, the same to the bit
as the run not heard. The settings are kept per player in the store's index beside the worlds list
and survive a reload through the real title screen. Licences in `docs/credits.md`.

**Decisions taken** (none were set for Phase 1; each recorded with its reason in the note):
1. **Every sound made by the game**, no files: "self-made", nothing to license or download.
2. **No context at all before the first gesture**, rather than one left suspended.
3. **The music follows the phase reached**, which only goes forward, so it never flips at a
   boundary.
4. **Rain is derived** (clouds over open water above freezing): the simulation has no rain. A dust
   storm blows the wind harder.
5. **Alerts, objectives, milestones and buttons on the interface channel**; the world's effects
   on the effects channel.
6. **While the Instruments drawer's example planet shows, its happenings are not heard** (its
   alerts and cards are not shown either); its music and beds are. The title's Example planet, a
   look-only world showing all of those, is heard in full (corrected in review 1).
7. **Sound constants are browser constants in `src/web/`**: they change nothing the simulation
   computes.
8. **The settings record in the store's index**, the player's own until Batch 36 decides its home.
9. **At most three of one effect a look**.

**What changed from the plan:**
- **A master volume and mute** beside the four channels.
- **The title's Settings screen has its sound section** ahead of Batch 36, and the world menu's
  **Settings** opens the same sliders.
- **A tick for every button** on the interface channel.
- **Not listened to**: an unattended run cannot hear; the levels are set by reasoning, and Batch 40's
  polish pass should listen.

---

## Batch 36 - Settings, controls and accessibility

**Goal.** The player sets the game up for their machine and themselves.

**Deliverables:**
- [x] **Graphics:** the detail level (auto, or high, medium or low, from Batch 26's levels); chunks
  kept; effects on or off. Shown with the frame time they cost.
- [x] **Controls:**
  - every keyboard shortcut listed and rebindable;
  - camera speed and edge scrolling;
  - invert zoom;
  - touch and trackpad gestures.
- [x] **Interface:** UI scale; colour-blind palettes for every colour-coded thing (zones, networks,
  alerts); reduced motion; a high-contrast HUD.
- [x] **Autosave interval**, a manual save, and the save's location shown.
- [x] **Kept per player, not per world,** in their own store.

**Exit gate:**
- Every setting changes what it says and survives a reload, through the real components.
- Every colour-coded element has a second, non-colour cue, checked in the happy-dom harness.
- No setting changes the simulation.

**Done** - see [the note](docs/balance/batch36-settings.md). Built unattended (`/next-batch auto`)
in one session. One **Settings** panel - Sound, Graphics, Controls, Interface, Saving - on the
title screen and in the world menu, every change at work at once. The settings are the player's,
in an IndexedDB object store of their own (`player`, database v3); Batch 35's sound record in the
worlds' index is read once and left where it was. Graphics: the city's detail held at High,
Medium or Low or left on Auto; how many of its pictures are kept (12, 24 or 36 million pixels);
its moving details off, each building's moving parts drawn still into its picture while vehicles
and a rocket in flight still move; each level's frame time measured on the player's machine and
shown beside it. Controls: 21 shortcuts named by physical key, each with two slots, rebound by
pressing the key (any key, Esc too), a key taken from another action swapped; camera speed for
the keys and the screen's edge; edge scrolling in a city; invert zoom on every wheel; a trackpad's
pinch zooming everywhere and, by choice, two fingers moving the view; two fingers pinching on a
touch screen. Interface: the panels' size (never the canvases'), red-green and blue-yellow
colour-blind palettes for the page and every canvas colour code, reduced motion (the interface
still, the flight down a cut, the planet not turning), high contrast, and which alerts pop up.
Saving: an autosave interval, Ctrl+S, and the menu saying when the world was last saved and where
the worlds are kept. Every colour code has a second cue, and a test holds the stylesheet's colour
rules to a register of them, each state put on screen by the real components; the planner's map
carries patterns and names what is under the pointer.

**Decisions taken** (none were set for Phase 1; each recorded with its reason in the note):
1. **A store of their own**: a third IndexedDB object store, `player`; the v1 record moved on first
   read and never deleted.
2. **Shortcuts made, then made rebindable**: the game had one key (Esc). 21 actions, by physical
   key (`code`), two slots each; a key taken is swapped, never lost.
3. **Edge scrolling off by default**; camera speed 0.5x to 3x for the keys and the edge.
4. **Invert zoom on every wheel**; a trackpad's pinch (the wheel with Ctrl) always zooms, uninverted.
5. **Frame time measured on the player's machine**, per level and per effects on or off: an
   unattended run cannot time a browser.
6. **"Effects" are the city's moving details**; off, they are drawn still into the pictures. A
   rocket in flight is information, not decoration: it still rises.
7. **The panels are scaled with CSS `zoom`, never a canvas**, so a click lands where it did.
8. **Palettes swap the zones' first colours at drawing**, never in the world: a colour the player
   picked is kept, and no setting writes the save.
9. **Autosave never off**: 15 s, 30 s, 1 min or 5 min.
10. **Batch 31's open item taken**: which alerts pop up (all, urgent only, none); an alert that does
    not pop up makes no sound.
11. **Batch 33's open item declined**: no events while away would change the simulation, which no
    setting may.

**What changed from the plan:**
- **Keyboard shortcuts were added**, not only listed: there was one.
- **Pop-up alerts** setting (Batch 31's open item).
- **The planner names what is under the pointer**, and **Alerts** and a milestone say their state
  in words: found by the register of colour rules.
- **In a city, Esc closes the game menu** (it did not).
- **Review 1's fixes**: a railway laid in the cue test (it was only planned there), a test that no
  shortcut acts under the open game menu, and the world map's settlements given shapes by kind (an
  outpost a square, a city a disc, a metropolis a diamond, a ruin crossed out) at every zoom: they
  were a colour code the batch had not registered, and with gold markers a city and a metropolis
  differed only in size.

---

## Batch 37 - Terrain resource deposits

**Goal and exit gate:** `BUILD_PLAN.md` §Batch 27, unchanged: ore on ridges, ice in basins, vents on
faults, high flats for solar; siting bonuses through `efficiency`; deposits visible before placing.
Re-measure the bootstrap, and Batch 28's pacing targets, with them on.

---

## Batch 38 - Flood defences and the rising water; flooding on

**Goal and exit gate:** `BUILD_PLAN.md` §Batch 28: dikes, terracing, evacuation, the throttle link,
and the water plane.

Plus:
- [ ] **Turn flooding on in the browser** (Batch 25's open item), with a guard for old saves. A city
  found already under the sea on loading is given a grace period, warned, not lost on the first
  substep.

**Exit gate (added):** loading a pre-flooding save with a city 10 m under the sea never loses it
before its grace period ends, tested.

---

## Batch 39 - The ending: victory, scores and achievements

**Goal.** A game that can be won, and a reason to play again.

**Deliverables:**
- [ ] **Victory:** a breathable, temperate, watered planet - the arc's last phase, sustained for a
  stated time. Then:
  - a victory sequence over the globe;
  - the world's story in numbers (years, cities, people, losses to the sea);
  - the choice to keep playing.
- [ ] **A score per world:** speed, people, cities lost and saved, pressure on the planet; shown on
  the worlds list.
- [ ] **Achievements:** about thirty, each with an exact condition and checked from state. The rare
  ones reward a style of play, not a grind.
- [ ] **New game plus:** a new world with a chosen bonus unlocked by a victory.

**Exit gate:**
- The reference policy, scripted to the end, reaches victory at a measured real time under Batch
  28's pacing.
- The score is derived, and identical for the same world live or offline.
- Every achievement is earned in some scripted run, and none in the first minute.

---

## Batch 40 - Playtest pass: performance, polish and an adversarial review

**Goal.** The game survives being played: fast where it must be, clear where it was confusing,
right where it was wrong.

**Deliverables:**
- [ ] **Make the metropolis-opening timing test load-proof** (Batch 26's finding): it times the wall
  clock, and failed at 403.7 ms in a full run against a 145-148 ms quiet measurement.
- [ ] **A performance budget:**
  - 60 fps in the reference city;
  - 30 fps or better panning a metropolis;
  - a world opening in under 3 s;
  - memory bounded.

  Measured on a stated machine. Every overrun fixed or recorded with its cause.
- [ ] **An adversarial review of Batches 26-39**, to the standard of Batches 10, 13 and 14: every
  test injection-checked, every threshold traced to a measurement, every save migration loaded
  from a real old save.
- [ ] **A polish list** from a scripted playthrough and the user's own play, fixed in order of how
  often it is met.

**Exit gate:**
- The budget met, numbers stated.
- The review's findings all fixed, or each recorded with a reason it waits.
- A clean full run of every gate: typecheck, the suite, both builds, the golden frames.

---

## Recorded for later (not scheduled)

- Multiplayer or shared worlds.
- A second planet: `src/sim/planets/` is ready for it.
- Mod support.
- Steam or desktop packaging.
- A real GPU instancing renderer: Batch 26's option A, if the shape pipeline's budget runs out in
  Batch 40.
- Production penalties with flood depth (detail §4.3).
- A forecast that sees the sea's acceleration (Batch 25's open item).
- Jobs: people working buildings, a labour model (Batch 32's decision: not now).
- Space per person as a need: wants a growth model where people choose a city - jobs or
  migration - before spare room can be a choice (Batch 32).
- Rail spurs to the example's new stations, so transport reaches all its homes (Batch 32).
