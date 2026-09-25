# Detail pass: building mode, build times, levels, and "connect twice"

The user: "building behind structures is not possible because of the structure hitbox ... when I'm
building, put the opacity of the buildings at 30%, delete their hitbox, only leave the 2D tiles red on
the ground." "Each structure has a build time ... mines 1m, hab domes 5m, where 10m is 1y ... building
takes 1 rover, rover posts ... a small build time ... just the foundation and some worksite
equipment." "Hab dome up to level 5, mines to 10, everything else 8, every level +10%, incremental."
"A redundancy connection button next to connect all, where each structure is connected to two
structures, two that are NOT the same, if possible."

## What went wrong, and what it cost

- **"10m is 1y" cannot be real minutes.** At 1x a sim-year is 33 real seconds (a rocket's 1.8-year
  trip is the one real minute the user asked for earlier). Read as months, ten to the year: a mine
  0.1 sim-years (3.3 s at 1x), a dome 0.5 (17 s). All eleven times are tuning constants.
- **A job's time resolves to a substep: a quarter year.** A one-month build finishes at the first
  substep boundary after its time - the fixed step every exactness test rests on. The first test
  checked "a substep after", by which time the dome was up too; it now checks at the boundaries,
  with a guard that the two fall on different substeps.
- **Three test bugs, no code bugs among them**: the planet's forcing constant passed where the
  city's view of the planet belongs (efficiency NaN); a closure capturing a variable the test then
  reassigned (every level "x1.0"); and a test file that only typechecked wrong - vitest does not
  typecheck, and a check piped through `tail` hid tsc's exit code. The Netlify build command runs the
  typecheck and caught it.
- **The renderer may not say "progress"** (the planet's progress metric is not the city's to see;
  a boundary test enforces it): the worksite's parameter is `done`.
- **"Connect twice" was first tested only on flat, rock-free ground**, so an injection routing it
  over hard rock passed. The hard-rock routing test now covers it too.

## Built

- **Building mode** - with a building, corridor, cable or the level tool armed: every building drawn
  at 30% opacity, its footprint red on the ground, and no building has a hitbox: the pointer finds
  the ground under it, even behind a dome. With no tool armed, clicking a building selects it as
  before.
- **Build times** (behind `BUILD_TIME_ENABLED`; the browser on): placing a building sends a rover
  from the headquarters; it counts as one of the settlement's rovers. Until the rover's work is done
  the building is a worksite - slab, a frame rising with the work, stacked materials, a crane up
  close - and it does not run, house or store. Removing it calls the rover home. A Rover Post goes up
  in a month; a spaceport takes six.
- **Levels**: an upgrade costs the building's price and (with build times) a rover and its build
  time; the level comes when the rover is home, and the building runs meanwhile. Each level
  multiplies what it makes, houses and stores by 1.1, compounding; what it draws stays. Dome 5,
  mine 10, everything else 8; the headquarters is founded, not built, and does not upgrade.
- **Connect twice**, next to "connect all": for each building, a search by fewest new tiles (a link
  already laid costing none, never through a third building) to its two nearest distinct buildings,
  laying what is missing of the route to each - by corridor and by cable. With only one other
  building to reach, it joins that one.

## Measured

- 17 injections, all caught (one after widening a test): running, housing while going up; no rover
  needed; removal keeping the rover; +20% levels; levels not housing; domes to 8; upgrades at once or
  never; redundancy to one, to the same building twice, over hard rock; the hitbox kept when building
  (render and web); buildings opaque; no red footprints; no worksite.
