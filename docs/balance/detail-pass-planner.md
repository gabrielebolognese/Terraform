# Detail pass: the city planner

The user: "HUGE feature, the city planner. First off: when creating a city, I can name it. Then I
can see the planimetry of the city in 2D, I can assign zones and colour zones, I can assign robots to
flatten out an entire zone without me manually clicking each. I can draw roads and power lines, and
they get built. I need to be able to see population charts, blackouts, food shortages, population
growth and deaths - everything, in a professional city planner, the second mode after the city view."

## What went wrong, and what it cost

- **Levelling a zone tile by tile came out as a staircase.** The first version queued each tile to
  "the nearby level", as a single rover click does. With three rovers out at once, each took whatever
  was flat beside its own tile, and a 6 x 3 zone on the hills finished with every tile flat and 1.7 m
  between its highest and lowest - measured. A zone is now one plane: the mean height of its tiles, to
  ten centimetres, carried by each queued tile (the save's `level_queue` holds the level with the tile).
- **The zone test would not have caught that staircase.** It checked each tile was flat, not that the
  zone was one plane. Injecting the old per-tile level passed. It now checks the whole zone's corners
  lie within a centimetre. It also levels two neighbouring tiles by hand first, so that each one is
  the other's "nearby level". Only then did injecting "queue only tiles not level by the old rule"
  fail. With a single hand-levelled tile, that injection passed, because `levelFor` looks at a tile's
  neighbours, not the tile itself.
- **The crew-rate test was vacuous.** It gave 60 materials, which is exactly one substep's crews
  (240 a year x 0.25). So removing the crew cap changed nothing, and the test passed. It now has 80
  materials, with a guard that the crews, not the materials, bound the first substep.
- **The planner's messages lagged a frame.** "Planned 7 tiles of power line" was only written at the
  panel's next refresh. The component test caught it; messages now show at once.
- **The chart test's first city was already short of power** before its blackout. A single geothermal
  plant does not carry three domes. Its guard ("no blackout before") caught this. It now uses the same
  powered city as the simulation's record test.
- One injection is still missed, and by design: dropping the pointer-up "not the Move tool" check.
  `apply` already ignores the Move tool, so the behaviour is pinned either way ("the Move tool plans
  nothing").

## Built

- **Names.** A name field sits beside "Found a city" in the HUD and goes to `foundSettlement`. It is
  trimmed, spaces are collapsed, and it is at most `NAME_MAX` = 40 letters. It can be renamed in the
  planner. A named settlement is listed and titled by its name; an unnamed one keeps "City 3".
- **The planner** is a second mode, opened by "City planner" in the city view. It has a top-down map,
  one tile a pixel, scaled with the wheel and moved by dragging:
  - the ground is shaded by height, darker where steep, with crags, and land the city does not hold is
    dimmed;
  - zones are washed in their colour;
  - corridors, cables and rails are drawn;
  - buildings are coloured by what they do (homes and life support, power, industry, research, port,
    headquarters), each with an outline, so blocks built wall to wall still read as separate
    buildings;
  - planned links and tiles queued for levelling are marked.
- **Tools:**
  - Paint zone: drag a rectangle. Without a zone selected, it makes a new one; a tile belongs to one
    zone at most.
  - Erase zone.
  - Road (corridor), power line and railway: drag an L from one tile to another.
  - Cancel plans.
- **Zones panel:** colour picker, name, tile count, select, "Level it" (queues the whole zone for the
  rovers; one goes out whenever a rover is free) and delete.
- **Charts** (a sample every sim-year, the last 150):
  - people and homes;
  - born and lost a year;
  - shortages as the share of each year short: blackout, water, oxygen, food;
  - the stores;
  - made less drawn.
- **Overview:**
  - people and homes;
  - needs met or short;
  - last year's births, deaths, blackout and hunger;
  - buildings, by kind;
  - link tiles, and planned tiles;
  - rovers out;
  - zones.
- **Simulation.** Planned links are laid in the order drawn: up to `LINK_BUILD_PER_YEAR` = 240 tiles a
  year, while materials last. A tile a building now stands on is dropped. The save is schema v12, and a
  v11 save migrates with no name, zones, queue, plan or record.

## Measured

- Tests:
  - simulation: `planner.test.ts`, 8 tests;
  - component: `planner.test.ts` (web), 6 tests;
  - the name field and the city view's planner button: 2 more.
- Injections, 21 in all:
  - simulation, 10, all caught (two only after the fixes above);
  - web, 11, of which 10 caught and 1 missed by design (above).
