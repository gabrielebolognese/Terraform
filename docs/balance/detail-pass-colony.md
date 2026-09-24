# Detail pass: corridors and cables, the headquarters, rovers and rockets

An intermediate task after roads and the build bar, at the user's request:
- *"roads are not like earth city road, here they are thin corridors … differentiate between
  connective roads … for people, greenhouses, and space stations, and energy, that are thinner
  cables, yellow coloured"*;
- rocks and crags a rover can break, *"normal rocks give 1 material, the big ones 5; it takes time
  depending on how far the rover is"*;
- a 5×5 headquarters at the centre, *"the first structure … where the rovers start"*, making
  +5 oxygen and +3 water with no power;
- *"ONE spaceport"* at founding;
- supply rockets: *"20 material (or if there is 140/150, just 10) … one minute."*

## What was built

**Two networks** (`NETWORK_ENABLED`):
- **Corridors** carry water, oxygen, food and materials: white pressurised walkways with a glass roof
  strip and an airlock collar where they meet a building.
- **Power cables** carry power: thin yellow lines on short posts, with a terminal at the building.
- A building runs only if the network that carries each thing it draws holds a running producer of
  it: a mine needs a cable to a power plant, a dome a corridor to a greenhouse.
- Shared walls join both networks, and one tile may carry both.
- **Connect all** lays the shortest corridor and cable joins over buildable ground.

**The headquarters** (`HEADQUARTERS_ENABLED`):
- Founded at the centre of every settlement, with one spaceport sharing its wall in a city or
  metropolis.
- It can't be built or removed.
- Makes `HQ_OXYGEN` 5 and `HQ_WATER` 3 a year; draws no power.
- Keeps `ROVERS_PER_HQ` 3 rovers.

**Rocks.** Derived from the ground and never stored; only the broken ones are saved:
- **Loose rocks** lie on 8% of open, buildable tiles and yield 1 material.
- **Crags** cover every steep tile and yield 5. A broken crag leaves buildable ground (`siteGround`).

**Rovers.** Click a rock, then **Send rover**:
- The trip is `2 × distance × 0.015` sim-years plus the work (0.09 for loose rocks, 0.3 for a
  crag): half a real second a tile each way at 1×.
- Materials land when the rover is home.

**Rockets.** Select a spaceport, then **Launch rocket**:
- Back after `ROCKET_TRIP_YEARS` 1.8, which is one real minute at 1× (60 × `TIME_SCALE` 0.03).
- Brings `ROCKET_MATERIALS` 20, or what fits.
- One per spaceport at a time.
- **Rockets carry their own fuel**, so an unpowered spaceport can launch. The founding spaceport
  has no power until the player builds some, and a new city would otherwise have no use for it.

**Jobs count down one substep at a time.** That keeps them chunk-independent (tested) and makes
them finish offline exactly as live. They move smoothly on screen because the clock tells the
picture how far it is into the current substep (`SimClock.pendingYears`); the simulation never
reads that.

**Save v8.**
- v7 roads become both a corridor and a cable, so nothing disconnects.
- A settlement without a headquarters gets one at the centre, or on the nearest free 5×5 ground if
  the player built there.

## What went wrong

- **Loose rocks were invisible where the simulation said they were.** The old pebble function kept
  its own "is there a rock here" hash, so it drew on almost none of the sim's rock tiles. The first
  render showed an empty selection ring. It now draws exactly the view's rocks, as 2–3 boulders big
  enough to click.
- **The level-of-detail gates caught corridors, twice.** The example metropolis has 2,815 corridor
  tiles.
  - Drawn as a hub plus four arms, they took medium detail to 22% of high (gate 20%). They are now
    at most two bars, and at medium only the roof: medium is back to 16.4%.
  - Drawn far away as a flat trace on the ground, they covered 60% of the pixels the tube does, and
    low's likeness to the full picture went from 38% to 47% of the bare-ground difference (gate 45%).
    They are now a roof at the tube's height, in a measured colour: 39%.
- **Cables changed the far picture while not being drawn there.** Cable tiles blocked flat-ground
  patches, so they were drawn tile by tile. Fixed; and the test that should have caught it had been
  run on flat ground, where a patch hid even a drawn cable. It now checks on hills.
- **The Power cable card's yellow could have been the mine's excavator.** The card test now
  compares against the same scene without the cable: 23 extra yellow pixels.
- **Fixtures, not code:**
  - the screen harness gives every city 1,000 materials, above the store's capacity, so the rocket
    was rightly refused ("stores are full");
  - a depot at the centre blocks every headquarters origin within two rings, not one;
  - the example planet's placement replay tried to build its headquarters.
- **Scripts:**
  - `git stash pop` rewrote files with CRLF line endings, and edit scripts matching `\n` failed,
    safely, since they assert before writing. The scripts now keep each file's own line endings.
  - One heredoc wrote real line breaks into a Python script's string literals.
- **Injections:** 27 run, all caught; one needed the hills fix above.

## Measured

Example metropolis at the widest zoom:

| | High | Medium | Low |
|---|---|---|---|
| Shapes | 278,453 | 45,734 | 21,491 |
| Likeness (8×8 blocks; bare ground 0.0250) | — | 0.0082 | 0.0098 |

**Far colours:**
- **Headquarters:** within 0.4% per channel of its full drawing.
- **Corridors:** within 0.3%.

## Open

- Separate stores per network, as recorded with roads.
- Rovers drive straight over open ground and through buildings, and ignore each other.
- The rocket animation shows at high detail only.
