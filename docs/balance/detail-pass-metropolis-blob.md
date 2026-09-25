# Detail pass: the metropolis as a town grows, and no empty land

The user: "In the metropolis there are many empty tiles: in each empty tile there have to be between 3
and 25 structures, none of them homes - many factories, standalone storage depots - so the city feels
full. Allow zooming out even more, to look at all the city from above. And make it less square, more
like a normal city development: a blob, the same space, a more natural shape. This will change the
railways, etc."

## What went wrong, and what it cost

- **Only 8 to 11 of the 29 districts found a place at first.** The rule that an avenue may not run
  through more than 15% of a district was written for the square lattice, where avenues ran between
  districts. Curved rings and eight radials cross most of the land, and the rest had nowhere to go. At
  35% (an avenue may skirt a district, not cut it), 14 to 18 of them fit.
- **The filling skipped the quarters.** The quarters' open blocks had left whole chunks bare (up to 10
  chunks per city under three buildings). The filler now fills them too, with works only, and those
  chunks stay in their quarter's zone.
- **The filling could have stood on the quarters' own corridors and railways.** The builder never
  checked links placed before it, because it had never built inside the quarters. The game's own
  placement replay caught it at once when injected: those tiles are now kept clear.
- **A district's station was on no railway.** It stood in a flat pocket walled in by slopes, and its
  block's buildings closed the one way in, so no rail could reach it.
  - Stations now get a one-tile apron nothing may be built on.
  - A station still unreachable becomes a research forum. It has the same 4 × 6 footprint, so
    everything it touches stays joined. One metropolis had one.
- **A step measured 38 ms once, against 17 to 21 ms every other time.** It was noise.
- **A test threshold was guessed before being measured**: "500 chunks with room". The measurement is
  455 to 463, and the bound is now 400.

## Built

### The outline

Each metropolis now has an outline that grows as a town grows, from its own seed:
- a radius that wanders slowly round the angle (lobes);
- three or four arms reaching out along the roads it grew by;
- scaled to about 620 chunks (the square held 689), within a frame of at most 31 chunks.

Measured, for the three metropolises:
- 76 to 82% of the box round each is held (a square holds 100%);
- none of the box's four corners is held;
- 13 to 16 different widths from row to row;
- no two share a shape.

### Avenues, following the shape

- A ring round the quarters.
- A ring round the city, a chunk and a half inside its outline.
- Eight radials between them, diagonals included.

Each avenue carries a double railway, four corridors, cross-links every 16 tiles (the rails bridge
them), and power. Its whole strip is kept clear of buildings. The railway runs round the edge and out
along every radial, and so reaches the city's extremes on every side.

### Districts

- Placed where they fit: inside the outline, clear of the quarters, a chunk apart from each other.
- The farms step down to 5 or 4 chunks a side if they must; so far both are always 6 × 6.
- Result: 14 to 18 districts per city, plus the two farms.

### No empty land

Every chunk left with fewer than three buildings is filled to between 3 and 25, in one to three clusters
wall to wall:
- mines, depots, water extractors, materials depots, tanks, batteries, geothermal plants, freezers,
  reactors, algae, solar, wind, now and then a laboratory or a command centre;
- never a home.

Measured:
- 251 to 277 chunks of "Works and stores" (a zone of its own colour);
- 3,559 to 4,841 works per city;
- every chunk with at least a third of its ground off the avenues and not steep holds three or more.

The chunks left thinner are 73% or more avenue or slope.

### Zoom

The camera may zoom out until the whole world round the city fits 1,440 pixels:
- for a metropolis, zoom 0.021, down from 0.15;
- an ordinary city's limit is unchanged, as its world already fits at 0.15.

## Measured

- **Build and step:** the example builds in 10.7 to 12.5 s, and a step stays at 17 to 21 ms.
- **Tests:**
  - `metropolis.test.ts`, rewritten: 12 tests, including the outline (not a square, all different),
    the filling (at least 3 per chunk with room, at most 25, no homes, mostly factories and stores),
    districts, farms, avenues, and a railway reaching all round;
  - a camera test: a metropolis zooms out until the whole world fits, and an ordinary city no further
    than ever.
- **Injections: 7, all caught:**
  - empty land left empty;
  - homes among the works;
  - up to 42 works in a chunk;
  - a square again;
  - unreachable stations kept;
  - the zoom floor fixed again;
  - works on the quarters' links.
