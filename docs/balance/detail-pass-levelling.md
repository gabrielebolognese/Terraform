# Detail pass: levelling ground with a rover

The user: "allow users to also flat out the terrain for better aesthetics - right now there are the
levels where the structure goes up with concrete foundations, but also there has to be the
possibility to send a rover and flat out the terrain to the nearby level."

## What went wrong, and what it cost

- **The first test's premise was wrong.** I wrote "a tile beside the landing zone levels to the
  landing zone's 0 m" - but the ground rises out of the landing zone over eight tiles on a gentle
  ease, so the tiles beside it are themselves almost level, and a rover rightly levelled to one of
  them (-0.05 m). A tighter search for "only the landing zone is level nearby" found no such tile
  at all. The rule is now tested with level ground the test makes: level one tile, and its neighbour
  levels to it.
- **-0 again.** A tile's own height, rounded, came out as -0 for a small negative - the same trap
  the terrain's `clean` exists for; saves compare it. Normalised.
- **The rock test could skip itself** (`return` when the rock's tile was already level). It now
  picks a rock on sloping ground and fails if there is none.

## Built

- **Level ground**, a tool in the top-right toolbar: click a tile of open ground the city holds, and
  a rover drives out from the headquarters, levels it, and comes back. It counts as one of the
  settlement's rovers (`ROVERS_PER_HQ`, one more per Rover Post); `ROVER_WORK_YEARS_LEVEL` (0.2
  sim-years) at the tile, plus breaking any rock there - which it brings back, as a rover sent to
  break it would.
- **"The nearby level"**: the height of the nearest level ground within 4 tiles - a tile whose
  corners lie within 0.25 m of each other: the landing zone, a levelled tile, a natural flat -
  nearest first; with none near, the tile's own height to the nearest 10 cm. So a player levels a
  terrace outward tile by tile, each to the one before. The level is fixed when the rover sets out.
- **Stored** as grades (save v10): each levelled tile's key and height, in the order they were
  levelled (a later grade wins a shared corner). The ground the rules read (`siteGround`) sets each
  graded tile's four corners and re-judges the tile and its eight neighbours - height, slope,
  steepness - so placement, links, foundations and floods all follow it. The view levels the world's
  half-tile samples too, which the ground is drawn through up close. Grades move with everything
  else when a claim moves the frame's corner.
- A building on levelled ground needs no foundation (tested: the drop from its base to its lowest
  corner goes from positive to 0).

## Measured

- 10 injections, all caught: grades not applied, slope not re-judged, the nearby level ignored, the
  grade not recorded when the rover is home, the picture not levelled, levelling under a building,
  grades not saved, grades left behind by a claim, no rock broken, the tool's click doing nothing.
- Chunk-independent: a levelling job advanced a substep at a time equals the same time in one call;
  a save mid-job reloads exactly and carries on the same.
