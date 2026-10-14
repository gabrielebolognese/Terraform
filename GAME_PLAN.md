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
| 28 | Time that means something: real build and upgrade times | NOT STARTED |
| 29 | Vehicles that use the city: rovers on the ground, trains on the line | NOT STARTED |
| 30 | The first hour: onboarding and objectives | NOT STARTED |
| 31 | Knowing what is happening: alerts, notifications and statistics | NOT STARTED |
| 32 | People, not a number: needs, services and happiness | NOT STARTED |
| 33 | Events that ask for decisions | NOT STARTED |
| 34 | Earth: shipments, contracts and the market | NOT STARTED |
| 35 | Sound: music, ambience and effects | NOT STARTED |
| 36 | Settings, controls and accessibility | NOT STARTED |
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
- [ ] **A build-time curve**, in real time at 1×: `time(type, level) = BASE[type] × GROWTH^(level - 1)`.
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

- [ ] **Upgrades follow the curve.** Each level takes longer than the one before, never the first
  build's time again.
- [ ] **Rover trips** add the drive along their real route (Batch 29), not the straight line.
- [ ] **A build queue per city:**
  - jobs wait for a free rover;
  - the queue is shown, reorderable and cancellable (with a refund);
  - more rover posts mean more builds at once.
- [ ] **Offline:** long builds keep going while the game is closed. Coming back says what finished
  ("While you were away: the reactor reached level 4, the mega mall is half built").
- [ ] **Speed:**
  - The 100× and 1000× speeds move to Sandbox (and to a debug setting).
  - Standard runs at 1×, with a pause and a 2× or 3× for the planet's slow stretches. Decided in
    Phase 1.
- [ ] **The countdown shown everywhere a build is:** over the worksite, in the city panel, in the
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

---

## Batch 29 - Vehicles that use the city: rovers on the ground, trains on the line

**Goal.** "The trains, the rovers: they skin through buildings." Every vehicle moves the way a real
one would: rovers on corridors and open ground around buildings, trains along their rails with
their cars, nothing through anything.

**Deliverables:**
- [ ] **Rover routes.** A path from the garage to the job:
  - over corridors first, then open buildable ground, never under a building, never over hard rock
    or steep ground;
  - turning where the path turns.

  The route is computed once per job, in the simulation (it sets the trip time Batch 28 uses), and
  deterministic. No reachable path means the job is refused, with the reason.
- [ ] **Rover motion.** The rover follows its route at a steady speed, faces where it drives, and
  works at the site with its arm animated. More than one rover on a stretch keep apart.
- [ ] **Trains.**
  - Diagnose where cars cross buildings: turns, car length, the order they are drawn in.
  - Fix it: cars follow the rail's curve car by car; slow for turns; stop at stations and dwell;
    never leave the rail.
  - Junctions are taken by the existing permutation rule.
  - Maglev and freight look different.
- [ ] **Depth.** Vehicles are sorted with the buildings, so one passing behind a building is hidden
  by it.
- [ ] **The cost is measured.** Pathfinding for every job in a metropolis, and drawing hundreds of
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

---

## Batch 30 - The first hour: onboarding and objectives

**Goal.** "More of a gameplay." A new player is taught by doing, and every player always has a
next goal worth reaching and a reward for reaching it.

**Deliverables:**
- [ ] **Guided first steps** in Standard, on a new world. Skippable, and never shown again once
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
- [ ] **Objectives.** A chain of goals with rewards (materials, credits, an unlock, a cosmetic),
  shown in a panel.
  - **City:** reach 500 people; run a week without a shortage.
  - **Planet:** raise the pressure to 100 mbar; first liquid water.
  - **Network:** three cities joined.
  - Later goals open as earlier ones finish. Each says exactly what counts and how far along it is.
- [ ] **Milestones:** a moment, a card and a sound when a phase is reached, a city is founded, a
  great structure is finished.
- [ ] **Rewards that matter.** What an objective pays is tuned against Batch 28's pacing: a reward
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

---

## Batch 31 - Knowing what is happening: alerts, notifications and statistics

**Goal.** The player is told what needs them, when it needs them, without hunting for it.

**Deliverables:**
- [ ] **An alert centre:**
  - shortages and blackouts;
  - a building offline and why;
  - builds and upgrades finished;
  - a flood warning (Batch 25's words);
  - a storm coming;
  - an objective done.

  Each clicks through to where it happened (the city, the building, the planet). Grouped, so a
  hundred offline depots are one line.
- [ ] **Toasts** for the moment, the centre for the record. Priority decides which interrupt.
- [ ] **Statistics:**
  - per city and per planet, over time: population, each resource's production and use, power
    balance, credits, the planet's axes;
  - charts from the planner's existing ones, unified;
  - the history kept as samples in the save, bounded.
- [ ] **A city overview card on the world map and the HUD:** people, shortages, builds in progress.

**Exit gate:**
- Every alert type fires in a scripted run that causes it, and does not fire in one that does not
  (vacuity both ways).
- Alerts are derived from state changes inside the readout, never stored as truth. The history the
  charts show survives the save and is bounded (measured size after 1,000 sim-years).
- Through the real components: an alert clicked opens the right city with the right building
  selected.

---

## Batch 32 - People, not a number: needs, services and happiness

**Goal.** Population is something the player looks after, not a counter that fills the homes. What
people need beyond survival decides how fast a city grows and how well it works.

**Deliverables:**
- [ ] **Needs in tiers:**
  - life support, as today;
  - comfort: parks, food variety, space per person;
  - services: medical, research, shops, transport.

  Each from the buildings that provide it, within a reach, over the city's networks.
- [ ] **Happiness**, derived from the needs met. It changes growth (as the research forum's bonus
  does now) and productivity: a building runs a little better or worse.
- [ ] **Coverage overlays in the planner:** where medical, parks or transport reach, and the gaps.
- [ ] **People in the view:** a crowd count at stations and parks; lights by occupancy.

**Exit gate:**
- Each need, met against unmet in otherwise identical cities through a real `advance`, moves growth
  and output by its tuned factor, measured.
- Behind a tuning constant at 0 (it changes settlement balance). The browser opts in; the Batch 3
  score and golden run are unchanged with it off.
- The example planet's cities are re-measured. Their stats stay "perfect" with the needs on, or the
  example is rebuilt to meet them.

**Decisions for Phase 1:** how many needs, and whether jobs (people working buildings) come in now
or never.

---

## Batch 33 - Events that ask for decisions

**Goal.** The planet and the cities throw problems the player must answer: choices with costs, not
only weather that happens.

**Deliverables:**
- [ ] **A deterministic event deck,** seeded by the world as storms already are:
  - a meteor shower (shelter, or risk damage);
  - equipment failure (pay to repair now, or run degraded);
  - an outbreak (medical capacity matters);
  - a supply ship early, late or lost;
  - a discovery (spend to study, for research);
  - an Earth request (Batch 34).
- [ ] **Each event** gives two or three choices with stated outcomes, a deadline, and a default if
  ignored. Resolved inside `advance`, chunk-independent, and caught up offline like everything else.
- [ ] **Event log and history in the alert centre.**

**Exit gate:**
- The same world seed gives the same events at the same sim-years, live or offline, chunked any way
  (`toEqual`).
- Each choice's outcome is measured through a real `advance` against the other choices.
- An ignored event resolves to its default, and the default is never the best choice (checked per
  event).
- Behind a tuning constant at 0. The browser opts in.

---

## Batch 34 - Earth: shipments, contracts and the market

**Goal.** Earth is part of the game: it sends supplies, asks for exports, and pays for them. The
spaceport gets a job.

**Deliverables:**
- [ ] **Shipments:**
  - rockets bring ordered goods on a schedule set by the launch windows (every 26 months, by sim
    time);
  - the spaceport's rocket is the one in the view;
  - a missed window waits for the next.
- [ ] **Contracts:** Earth asks for amounts of materials, research or water by a date, and pays in
  credits and unlocks. Failing costs reputation.
- [ ] **A market:** what goods cost and what Earth pays moves with supply, and with the player's
  reputation.
- [ ] **Interplanetary trade** in the economy panel, tied to the existing credits.

**Exit gate:**
- Launch windows land on the dates the orbit gives (synodic period 2.135 years), measured over 50
  windows.
- A contract fulfilled, against the same run failed, changes credits and reputation by the tuned
  amounts.
- Behind a constant at 0 (it moves the economy). The browser opts in, and the Batch 3 score and
  golden run hold with it off.

---

## Batch 35 - Sound: music, ambience and effects

**Goal.** The game is heard: a score that follows the planet's arc, the city's hum, and every
action answered.

**Deliverables:**
- [ ] **An audio engine** over the Web Audio API: channels for music, ambience, effects and
  interface; volumes; muted until the first user gesture (as browsers require).
- [ ] **Music by phase:** sparse and cold at the start, warmer as the planet greens. Crossfaded,
  never cut. CC0 or self-made, with the licence recorded.
- [ ] **Ambience:** wind by pressure; the city's machinery by what runs nearby; rain once there is
  weather; the sea once there is a sea.
- [ ] **Effects:** place, build done, upgrade done, a train passing, a rocket launch, an alert, an
  objective done. Positional in the city view (louder near the camera).
- [ ] **Settings:** a volume per channel, saved per player rather than per world.

**Exit gate:**
- The audio layer reads the state and never writes it. The simulation is identical with sound on
  and off.
- In a headless harness with a fake `AudioContext`: each effect fires once per event, ambience
  follows its driver, music changes with the phase.
- No audio starts before a user gesture, checked.
- The asset licences are listed in `docs/credits.md`.

---

## Batch 36 - Settings, controls and accessibility

**Goal.** The player sets the game up for their machine and themselves.

**Deliverables:**
- [ ] **Graphics:** the detail level (auto, or high, medium or low, from Batch 26's levels); chunks
  kept; effects on or off. Shown with the frame time they cost.
- [ ] **Controls:**
  - every keyboard shortcut listed and rebindable;
  - camera speed and edge scrolling;
  - invert zoom;
  - touch and trackpad gestures.
- [ ] **Interface:** UI scale; colour-blind palettes for every colour-coded thing (zones, networks,
  alerts); reduced motion; a high-contrast HUD.
- [ ] **Autosave interval**, a manual save, and the save's location shown.
- [ ] **Kept per player, not per world,** in their own store.

**Exit gate:**
- Every setting changes what it says and survives a reload, through the real components.
- Every colour-coded element has a second, non-colour cue, checked in the happy-dom harness.
- No setting changes the simulation.

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
