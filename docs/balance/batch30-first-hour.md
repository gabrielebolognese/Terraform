# Batch 30 - The first hour: onboarding and objectives

Built unattended (`/next-batch auto`), in one session. "More of a gameplay": a new player is taught
by doing, and every player always has a next goal worth reaching and a reward for reaching it.

## What went wrong, and what it cost

- **The plan's 10-20 minutes for the guided steps cannot be met under the game's own rules.** The
  sixth step, claim land, waits for 200 people (`CLAIM_FIRST_POPULATION`, the user's own number:
  "at 200 I can claim new terrain"). A city's people grow from 4 settlers at a tenth a city-year
  (33 s at 1x), so 200 takes at least ln(50)/0.1 = 39 city-years, 22 minutes, before housing or a
  single shortage slows it. Measured on the taught scripted player: the first five steps in 50 s,
  claim land at 42.2 min, the railway at 42.4 min (49.9 min without claiming rewards). The exit
  gate's time is recorded as measured, 42 minutes, and the reason. Shortening it would mean
  changing the user's claim rule, which this batch does not do.
- **Materials rewards were worth nothing.** The first design paid every city goal in materials.
  Measured, the scripted city's materials store sits at its cap from about 15 minutes in: rovers,
  not materials, are what a growing city waits on (Batch 29 said as much). The first claims landed
  9 of 150 and 9 of 200 materials. The city goals now pay settlers (they shorten the road to the
  next people goal), and the town's pays **rovers**: one rover brought the city of 1,000 only
  1.2 minutes sooner (it arrives at 69 minutes), two bring it 10 minutes sooner. Settlers for the
  town did nothing at all for the city of 1,000 (1.83 h either way): at 500 people the city is
  short of homes, not of people.
- **A rover reward needed a new piece of saved state.** `roverCount` reads only the settlement
  (it is asked inside a settlement's own substep, where there is no world), so the reward's rovers
  live on the settlement: `extraRovers`, saved as `extra_rovers`. That widened the v16 save change
  beyond the goals record.
- **"Steady supply" is fragile for the scripted player.** It reacts to a blackout only after one
  happens, so a clean run of 20 years at 200 people is easily broken. With the first goal's 50
  settlers it comes at 52.8 minutes; without them, at 2.30 hours. Both measured and stated, but the
  scripted player's shortages are its own; a player who builds power ahead of need does better.
- **The "three cities joined" goal is quick once the network's first goal is claimed** (12 seconds
  later for the scripted player): founding is free and two short railways cost a full city 324
  materials. It is a deliberate act, so it passes "not by accident in the first minute"; making it
  ask for grown cities would need a scripted player that grows three cities, which this one does
  not.
- **A Terraformed start is left without objectives.** It begins with every goal met; claiming
  nine rewards at once would be free credits, not a goal.
- **The metropolis gate broke Batch 29's vehicle tests, and only the full run showed it.** The
  vehicles harness builds its metropolis scene with a new Standard world's tuning, which now
  refuses a metropolis until "A city of 1,000" is claimed. The harness never checked that founding
  worked: it took the last settlement in the list (the terraformed planet's own) as its metropolis
  and failed on `undefined.id`, skipping all 15 of that file's tests. The scene's world now has the
  claim, as a player would, and the harness throws if founding is refused.
- **The guide's way back from the planner was wrong in two steps** ("found a city" and "a second
  settlement" pointed at the city's Back to orbit button, which the planner does not show). The
  test that every hint names a control that exists found it.

## Decisions (taken unattended; a bare "Go" would accept them)

1. **The objective list and rewards**, written out in full before building (the batch's Phase 1
   decision), then tuned by measurement. Three chains; each objective opens when the one before it
   in its chain is claimed; the first of each is open from the start:

   | Chain | Objective | What counts | Reward |
   |---|---|---|---|
   | City | A hundred people | 100 people in one city | 50 settlers |
   | City | Steady supply | 20 city-years in a row, one city of 200+ people, nothing short | 75 settlers |
   | City | A town of 500 | 500 people in one city | 2 rovers, for good |
   | City | A city of 1,000 | 1,000 people in one city | 2,000 credits; the metropolis unlocked |
   | Planet | The caps let go | Phase 2, Runaway thickening | 1,000 credits |
   | Planet | Thicker air | 100 mbar at the surface | 2,000 credits |
   | Planet | First water | Phase 3, First water | 3,000 credits |
   | Network | Joined by rail | a railway between two settlements | 200 materials |
   | Network | Three cities joined | 3 cities on one rail network | 2,000 credits; gold markers |

   The plan's "a week without a shortage" became 20 city-years in a row (about 11 minutes at 1x):
   the city's record, which the planner already shows, is kept a year a sample, and a week is no
   unit the game has.
2. **Where the guide's progress lives:** a latch in the world (`goals.guide`), set in `advance`
   every substep from the state, like the phase. The shell may not write the world, and a step's
   condition can stop holding (a building removed), so a latch is needed and the simulation owns
   it. The card shows the latch carried forward through what the state shows done now, so it moves
   the moment the player acts, not a substep later.
3. **On in new Standard worlds only** (`MODE_OVERRIDES.standard`): off by default
   (`GUIDE_ENABLED`, `OBJECTIVES_ENABLED` at 0), off in every world made before, in a sandbox (the
   spec) and in a Terraformed start (every goal already met).
4. **Claims are the player's** (a Claim button), not paid automatically: the record of which are
   claimed is the only stored part of the objectives, and a claim is an action like placing a
   building. Rewards land in the largest city, as far as it has homes and room.
5. **The unlock is founding a metropolis.** The browser could never found one; the simulation
   now refuses one in a world with objectives on until "A city of 1,000" is claimed. A sandbox
   gets the button too (everything is open there). Worlds without objectives keep the rule they
   were made with: the simulation never refused one.
6. **The cosmetic is gold markers** for every city, on the planet and on the world map.
7. **The milestone's sound is made, not loaded:** a three-note chime from the Web Audio API
   (four for a phase), quiet, and silent where the browser has no audio. Batch 35 brings sound
   proper, with a volume.
8. **Milestones include "an objective done"** besides the plan's three, so a waiting reward is
   never missed. Nothing is announced on opening a world.

## What was built

| Where | What |
|---|---|
| `src/sim/objectives.ts` | The seven guided steps (each a condition on the state), the latch, Skip; the nine objectives with derived progress, the claim and its refusals, the rewards; the metropolis gate; steady years; cities joined |
| `src/sim/integrate.ts` | The guide latched every substep in `advance` (with the guide off, never) |
| `src/sim/types.ts`, `save.ts`, `planets/mars.ts` | `SimState.goals` (guide, skipped, claimed) and `Settlement.extraRovers`; save v16 with a v15 migration |
| `src/sim/micro/rocks.ts`, `registry.ts` | Rewarded rovers counted; a metropolis refused until unlocked (objectives on) |
| `src/sim/tuning.ts`, §10 | `GUIDE_ENABLED`, `OBJECTIVES_ENABLED`, `GOAL_*`, `REWARD_*` |
| `src/web/game-tuning.ts` | `MODE_OVERRIDES`: Standard worlds get both |
| `src/harness/pacing.ts` | The taught scripted player (follows the guide, claims rewards, can withhold one), and the planet played alone |
| `src/harness/vehicles.ts` | Batch 29's metropolis scene: its world holds the claim that unlocks a metropolis, and founding is checked |
| `src/web/onboarding.ts` | The guide's hint (words and the control to press, by view), its card and glow; the objectives panel |
| `src/web/milestones.ts`, `chime.ts` | The milestone watch, the cards and the moment of light; the chime |
| `src/web/game.ts`, `hud.ts`, `city.ts`, `globe.ts`, `world-map.ts`, `style.css` | Wiring; Found a metropolis; gold markers |

Old saves: a v15 save loads with nothing of the first hour done and no rewarded rovers (tested).
The golden run, the Batch 3 score and the golden frames do not move: the default tuning has both
features off, and `roverCount` adds a settlement's `extraRovers`, 0 in every world without
objectives.

## Measurements

The taught scripted player: Batch 28's pacing script, plus what the guide asks (an upgrade, land
claimed, an outpost and a railway, then two more cities joined), claiming each reward when it is
done. A new Standard world, seed 0. Real time at 1x.

| Moment | Taught, claiming | Taught, not claiming |
|---|---|---|
| Steps 1-5 (found, power, dome, connect, upgrade) | 8 s, 8 s, 42 s, 42 s, 50 s | the same |
| Claim land | 42.2 min | 49.7 min |
| Railway to a second settlement (guide done) | 42.4 min | 49.9 min |
| A hundred people | 34.9 min | 34.9 min |
| Steady supply | 52.8 min | 68.3 min |
| A town of 500 | 69.4 min | 86.7 min |
| A city of 1,000 | 1.66 h | 1.97 h |
| Joined by rail | 42.4 min | 49.9 min |
| Three cities joined | 42.6 min | 58.3 min |

The planet played alone (no city; the bank spent down the reference priorities):

| Moment | Claiming | Not claiming |
|---|---|---|
| The caps let go (Phase 2) | 1.65 h | 1.65 h |
| Thicker air (100 mbar) | 16.7 h | 17.8 h |
| First water (Phase 3) | 28.3 h | 30.9 h |

What each reward is worth: every reward taken but that one, against every reward taken.

| Reward | Next goal | Without it | With it |
|---|---|---|---|
| 50 settlers (a hundred people) | Steady supply | 2.30 h | 52.8 min |
| 75 settlers (steady supply) | A town of 500 | 72.6 min | 69.4 min |
| 2 rovers (a town of 500) | A city of 1,000 | 1.83 h | 1.66 h |
| 200 materials (joined by rail) | Three cities joined | 55.7 min | 42.6 min |
| 2,000 credits (three cities joined) | The caps let go | 1.65 h | 78.5 min |
| 1,000 credits (the caps let go) | Thicker air | 17.8 h | 16.7 h |
| 2,000 credits (thicker air) | First water | 29.2 h | 28.3 h |

Not measured against a next goal: "A city of 1,000" (its chain ends; its reward is the metropolis,
with 2,000 credits for the planet) and "First water" (the planet's chain ends in this batch).

The first minute: no objective is done in a new world's first minute, played by the taught player
or left alone with a city founded. The earliest is "A hundred people" at 34.9 minutes.

The pacing script's own moments (`pace.test.ts`) do not move: it claims nothing and follows no
guide, and the latch changes nothing it reads.

## Tests

- `src/sim/objectives.test.ts`, 18:
  - the guide counts each step from the state, in order, a substep after; never walks back;
    skipped for good; off by default (advance leaves the goals as they were); latched every
    substep (a city drowned within one call); chunk-independent;
  - objectives open down each chain; progress derived; every refusal changes nothing; the pay
    (settlers to the homes, materials to the room, credits as earned, rovers for good); the
    metropolis gate; cities joined; steady years; off without objectives;
  - the save: exact, a v15 save loads with nothing done, a corrupt record named.
- `src/web/first-hour.test.ts`, 7: the exit gate's scripted runs (above).
- `src/web/onboarding.test.ts`, 12: the guide's hint step by step and view by view; every
  control it names exists in the real HUD, city view, world map and planner; the card's glow;
  the objectives panel; milestones (nothing on the first look; each kind once); the cards in turn
  with the chime; and the assembled game: the guide pointing, Skip, Claim into the world and the
  card it brings, the metropolis button and the gold markers.

## Injections

45 faults, one at a time, each against the tests meant to catch it; the tree was checked clean after
each (`git diff --stat`). **44 caught at once; the 45th - the guide latched once a call rather than
every substep - was missed** by every test: within one call a step's condition only ever comes to
hold and stays. It does not when a city is lost to the sea, which can happen inside a call; a test
now drowns Batch 24's low city within one call, and the fault is caught (2 steps counted against 0).

| Fault | Caught by |
|---|---|
| The guide's latch not in `advance` | counts each step from the state, in order; never walks back |
| Steps counted out of order (any later step done moves it on) | counts each step from the state, in order |
| The latch derived from step 0 each time (walks back) | never walks back when a step's condition stops holding |
| Skip ignored by the latch | never shown again once skipped, and the latch stops with it |
| "Connect them" with the networks ignored | counts each step from the state, in order |
| "Raise a level" counting only a finished level | counts each step from the state, in order |
| The guide latched once a call, at its end | missed, then: latched every substep - a city lost to the sea within one call has its steps counted (2 against 0) |
| The save drops the claims | survives the save exactly |
| The save drops the skip | survives the save exactly |
| No v15 -> v16 migration | loads a save from before it (v15) |
| A claim named twice accepted on load | refuses a save whose record is corrupt |
| Rewarded rovers not read back | survives the save exactly |
| A claim before it is open | refuses a claim ... changing nothing |
| A claim before it is done | refuses a claim ... changing nothing |
| Claimed twice | refuses a claim ... changing nothing |
| Settlers not held to the homes | pay once: settlers as many as there are homes |
| Materials not held to the room | pay once: materials as much as there is room |
| Credits not counted as earned | pay once: credits to the bank |
| Rovers never landed | lands rovers for good |
| The rover count ignores rewarded rovers | lands rovers for good |
| The metropolis never gated | unlocks the metropolis with a city of 1,000 |
| Outposts counted as cities joined | counts cities on one line |
| Steady years ignore the people | counts steady years back from the latest |
| Every objective open from the start | open one at a time down each chain |
| Objectives and the guide on in a sandbox | Standard's alone |
| 100 mbar done from the start | every one reached (the planet's at its measured time); none in the first minute |
| The first reward pays nobody | the guided steps at 42 minutes; every one reached |
| One rover for the town, not two | each reward shortens the road (1.2 min against more than 9) |
| The withheld reward claimed anyway | each reward shortens the road |
| The taught player skips the claim step | the guided steps at 42 minutes; never deadlock |
| The hint names the wrong card | follows the world; names controls that exist |
| The hint asks for Upgrade before a building is chosen | follows the world |
| The old glow left on | the card's glow; the assembled game (Skip takes every glow away) |
| Milestones on the first look | nothing on the first look; each kind once |
| A great structure announced when begun | each kind once ("when it stands, not when it is begun") |
| An objective announced every look | each kind once; the assembled game's card |
| Outposts announced as cities | each kind once |
| Cards overwrite one another | one card at a time; the assembled game |
| No chime | one card at a time with the chime |
| Claim does nothing | the objectives panel; the assembled game |
| The game never updates the guide | the assembled game: the guide pointing |
| Skip not wired | the assembled game: Skip |
| A metropolis offered to all | the assembled game: not before it is unlocked |
| Gold markers never shown | the assembled game: gold once three cities joined is claimed |
| Milestones never watched in the game | the assembled game: the card a claim brings |

## Verification

- `npm run typecheck`: green.
- `npm run build`: green. `npm run build:web`: green, 496.1 kB JS (169.6 kB gzip), 38.7 kB CSS
  (against 471.7 kB JS before the batch).
- `npx vitest run --maxWorkers=2 --minWorkers=1`: 105 files, 1,235 tests; 1,220 passed and one
  file failed to start (`src/render/vehicles.test.ts`, its 15 tests skipped: the metropolis gate,
  above), 373 s. After the fix that file alone: 15 of 15 pass. The Known-red metropolis opening
  timing test passed in this run.
- The built page served (`vite preview`), and its bundle (496,117 bytes) and stylesheet fetched over
  HTTP, with the guide's, the objectives' and the milestones' code and styles in them.

## Open

- **The guide takes 42 minutes**, not the plan's 10-20, because claiming land waits for 200
  people. If the user wants the first hour shorter, the claim threshold for a first city is the
  lever, and it is theirs to move.
- **"Three cities joined" asks only for cities on one line**, not grown ones: it comes a few
  seconds after "Joined by rail" for a player who founds two more cities at once.
- **The chime has no volume control** until Batch 35 (sound) and Batch 36 (settings).
- **A reward can be partly lost** to a full city (no empty homes, no room in its stores). It lands
  in the largest city; choosing the city is not offered.
- **Batch 28's open item, the first upgrade at 4-8 minutes, is met for a taught player:** the
  guide's fifth step asks for one, and the taught player's first upgrade is at 1.8 minutes. The
  untaught script still upgrades first at 21.5 minutes; an upgrade's worth is unchanged.
- **Batch 29's open item, the city packed without streets, is not taught by the guide.** Its
  power step says a rover drives out to build, and the manual says to leave streets; no step asks
  for a corridor.
- **World map gold markers** are drawn on its canvas and have no test of their own (the planet's
  markers do).
