# Detail pass: bigger cities, railways between them, and the world map

The user: "Even normal cities should be way bigger in the perfect planet: at least 3x3 tiles, a max of
17x17, still blob shaped. Then we also need interconnected cities, therefore also add a middle game
where the full map of the world is visible in 2D with all the cities extremely zoomed out. You decide
how big in tiles the world is."

## What went wrong, and what it cost

### Growing the cities

- **Every city came out two chunks narrower than intended, and the 5-chunk ones did not grow at all.**
  The outline stopped 0.6 of a chunk inside the frame, which a small frame cannot spare. Frames under
  21 chunks now stop a quarter chunk in; a 17 reaches 16 × 17.
- **The 3 × 3 cities were left as they were**: 7 buildings on 9 chunks. Growth now runs for them too,
  so their bare chunks are filled with works.
- **A building swapped for a smaller one (see Built) was cut off.** The old footprint's spare ground
  stayed marked as taken, so no corridor could reach the smaller building: one city ended on two
  networks, with one building off and food short. Swaps now free the old ground.
- **Growth cleared every city of its rocks.** Only the metropolis was meant to be stone-free; the
  rocks are the user's own earlier request. Ordinary cities now keep their crags, and growth builds
  round them.
- **The biggest cities housed 648 to 936 people.** Homes were one district in eight, and the swaps
  took the skyscrapers away. Suburbs are now a third of the rotation: the 17-chunk cities house 11,000
  to 23,000.

### Tests that measured the wrong thing

- **Name clash.** Checking a city's own layout, the test threw out the city's industry and port
  zones, because the districts it grows share the names "Industry" and "Port". The city's own are now
  "Old works" and "Spaceport".
- **Works swallowed the core's homes.** When a works chunk took a whole chunk of a city's core, the
  core's own buildings in it (a habitat dome) counted as works. Inside the core, "Works and stores" is
  now the works' own footprints only.
- **Lone rail tiles.** Three rail tiles in one city had no train: single pieces of lane stranded
  between slopes and buildings, beyond any join. A rail tile with no rail beside it is now taken up.
  Short loops count as lines, but carry no train.
- **"Room" had to be ground the city can reach.** One city's chunk, walled off by crags and slopes,
  was counted as having room: nothing could ever be built there.
- **Old checks scoped to the old layout.** A city's own layout on its founding square is still spaced
  out, zoned and sparse in corridor, as those tests ask. The land it grew is full, wall to wall, with
  corridor-rich avenues, as asked since. The corridor measure now leaves out the avenues: 0.20 corridor
  tiles per tile built on, over every city.
- **Two thresholds were guessed before being measured**: water "50 apart" and green "10 more". Both
  are now measured.

## Built

### Cities 3 to 17 chunks across, blobs

The example's 24 cities grow round their founding square with the same builder as the metropolises,
given each city's own geometry:
- **Sizes:** 3, 5, 7 … 17 chunks across, three cities of each, the bigger to those with more homes.
- **Outline:** a blob over about 70% of its box.
- **Avenues and railways** once a city is 13 chunks or more.
- **Districts** in proportion to the land, and filled works land on every chunk with room.

Only what the city's people allow is built. Below 5,000 people a station becomes a research forum;
below 1,000 a skyscraper becomes a greenhouse; and so on, each swap onto the same ground. The swaps are
repeated until the people left allow everything that stands.

Measured:
- 98,000 buildings on the planet;
- the example builds in 15 s (it was 12);
- a step takes 29 ms (it was 17).

### Railways between settlements

**Rules** (`routes.ts`, save v13):
- A railway joins two settlements, laid for 5 materials a kilometre, paid half by each end.
- Along it, water, oxygen, food and materials flow every substep from the fuller city to the emptier,
  until both are as full as each other against their own room. It carries up to 300 of each a year.
  Power stays where it is made.
- It is behind INTERCITY_ENABLED, off by default, because it moves stores between cities. The browser
  turns it on.

**The example planet's network:** the shortest set of lines that joins everything, then each city and
metropolis to its nearest settlement not yet joined, so no single cut leaves a city alone.

### The world map

- **Size:** 2,048 × 1,024 world tiles, 10.4 km each at the equator (Mars is 21,300 km round).
- **The picture:** the ground by height, green with the planet's green, the sea below its level, the
  poles under ice. It is made a row at a time, over frames.
- **Settlements:** far out, a mark and a name; closer in, the very chunks each holds.
- **Railways** are drawn with a train on each.
- **Choosing a settlement** shows its people, buildings and railways, with buttons to open it or to
  lay a railway to another, priced before it is laid.
- **Zoom:** from the whole planet in to 256 pixels a world tile.
- **Access:** from the HUD, and from the city view.

## Measured

- **Tests:**
  - `routes.test.ts`, 7 tests: cost, refusals, the carry, never power, off, chunked time, the save, a
    v12 save loading;
  - `world-map.test.ts`, 6 tests: projection, picture, choosing, opening, laying a railway, zoom;
  - two example tests: cities 3 to 17 across as blobs and full, and one railway network with loops;
  - the two map buttons.
- **Injections: 12, all caught:**
  - a line carrying without limit;
  - power carried;
  - one end paying the whole cost;
  - the map never laying a railway;
  - the map zooming out past the world;
  - cities not grown;
  - cities square;
  - no loops in the network;
  - no railways between settlements at all;
  - no swaps for a small city (caught by the replay through the game's own placement);
  - lone rail tiles kept;
  - short loops not counted as lines.
