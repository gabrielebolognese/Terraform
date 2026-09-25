# Detail pass: a metropolis 24 wide, trains, and the later buildings

The user: "the cities need more railways, and working trains. The metropolis has an 8x8 grid, far too
small: do it 24x24, clear of all the stones. Keep the centre 8x8 as it is, with stations and railways;
in the outer parts, more 2x2, 3x3 and 4x4 clusters, at least one or two big land claims, spaced, with
many corridors in the spaces. One zone for solar panels. Add wind turbines that unlock only when the
pressure is enough (so the example planet has them), mega-malls (8x6, at 10k people: tons of food, a
ton of power), storage beyond the basic depot - water tank, battery, freezer, materials depot - and
very interconnected cities. In the sample planet, the cities and metropolises get deep city planning:
zones with colours and purposes. Giant railways that interconnect the extremes of the city, with trains
passing, bridges for rails over corridors, maglev trains on top. The world is terraformed, so parks.
And a biosphere: a 6x4 mega greenhouse giving food and oxygen, for power and water."

## What went wrong, and what it cost

### The layout

- **The first outer districts were built in pockets walled in by slopes.**
  - What happened: I built on any flat claimed ground, rather than only on ground a corridor can
    reach from the headquarters, as the quarters do.
  - Result: about 160 groups of buildings per metropolis that no corridor could join. 800 to 1,000
    buildings were switched off, and water ran at up to 5,300 a year short, living off full stores.
  - Fix: building only on ground reachable from the headquarters. Now there is one network per
    metropolis, and 8 buildings off in each: the atmosphere processors, idle in the example's air
    as before.
- **Clearing the rocks last left crags under buildings.**
  - `rocksOf` does not report a rock under a building, so the rocks were cleared at the end, after
    the districts had been built on crags.
  - The replay test, which places every building again through `placeBuilding`, refused them: "Solar
    Array would stand on hard rock".
  - Fix: every rock in the frame is now cleared before anything is built.
- **Steep ground cut the avenue railways into pieces.** The stations stood on 9 separate lines. A
  joining pass now reconnects the pieces over the shortest open ground.

### Speed

- **A simulation step went from 34 to 127 ms**, with 3.3× the buildings.
  - The per-building work was repeated needlessly:
    - each building asked its definition for its rates, though there are only 28 types;
    - the totals were summed twice;
    - capacity and housing were summed over 21,000 buildings, housing twice.
  - Now: rates once per type per step, the last pass's totals reused, and capacity and housing
    cached per building list while nothing is under construction.
  - The sums are the same numbers in the same order. **A step is now 20 ms** for the whole planet,
    below the old 34 ms.
- **Building a metropolis's city view took 7 s the first time and 0.42 s each rebuild after**, and
  the city screen rebuilds several times a second.
  - The million-tile lists (claimed, heights, corridors, cables, rails, water, rocks, bases) were
    rebuilt every time. They are now kept per the lists they come from.
  - A rebuild now takes **45 to 50 ms**.
  - The first opening now takes **4.8 s** (was 5.6):
    - the crater lookups reuse the last 3×3 block (samples come in rows);
    - the world's corner heights reuse the ground's million.
  - What remains is the terrain noise itself: about 4.7 million height samples. That is the one
    cost I did not bring down, and the first thing to look at if opening a metropolis feels slow.
- **The example build went from 6.4 to 13.3 s, now 10.6 s.** Filtering 21,000 buildings for each of
  1,000 blocks was replaced by one pass.

### Trains

- **The first rule for trains** (straight on at every junction) **never turned into a branch met from
  the side.**
  - 38% of a metropolis's railway saw no train, and 46 to 98% of a city's.
  - The rule is now: straight on across a four-way crossing, keep right at a three-way junction, the
    only way round a bend, and turn back at a dead end.
  - That gives exactly one way out for each way in, so every stretch of line, each way, lies on one
    loop: **100% of every railway has trains**.
- **The cities' loops came out doubled.** Each leg was laid over the ones before, making up to 27
  squares of rail per city that trains ran round in fours. Each leg now keeps off the line already
  laid, except where it meets its stops: at most 4 per city.

### Tests that measured the wrong thing

- **The first bridge test could not tell a bridge from a flat rail.** An injection that laid the rail
  flat passed it, because the top of the picture came from the far ends of the long test lines. It
  now looks at the crossing tile alone: the bridge's top is 3 rows above the corridor's roof, and a
  flat rail is level with it.
- **Two thresholds were written before being measured** ("5 rows", "0.1% of the picture"). Both were
  wrong, and are replaced by measurements.

### Pictures and zones

- **Far away, a wind turbine was a block 2.4× its real area on screen.** At low detail it is now a
  slim column, 1.10×.
- **The eight new buildings' far-away colours were estimated, not measured.** They are now calibrated
  against their full-detail drawings, and each is within 0.8%.
- **A single turbine filled only 11% of its build card.** It is mostly sky. The card now shows a row
  of three.
- **Parks sprinkled through every district lowered the zoning score** (how often a building's
  neighbours are its own kind) to 0.645. Parks now go in the parkland districts.

### A slip in my own process

During an injection I ran `git checkout` on `src/render/city.ts`, which reverts every uncommitted
change in it. I restored it at once from a copy made a moment before, and checked it: all 538 added
lines were still there. Injections now restore files from memory only.

## Built

### The metropolis

**Why 992 tiles, not 24 × 44.** Tile keys are `ty * 1024 + tx`, so a frame can be at most 1,024
tiles a side. 24 of the old 44-tile quarters would need 1,056.

**The shape.**
- The metropolis is **992 tiles, 31 claim chunks, a side**. That is 2.8× as wide and 7.9× the area
  of the 352-tile city it was.
- The quarters are unchanged in the middle, 11 chunks a side, with their stations and railways.
- Around them lie 10 more chunks each side. A lattice of **avenues**, one chunk wide, runs through
  them: a ring at the edge, a ring round the quarters, and radials between.
- Each avenue carries:
  - a double railway;
  - four corridors, with cross-links every 16 tiles over the rails (on bridges);
  - power along its outer corridors.

**The districts**, between the avenues:
- 26 to 29 per metropolis: 2×2, 3×3 and 4×4 chunks, plus a 6×6 **solar farm** (about 1,400 arrays)
  and a 6×6 **wind farm** (about 940 turbines).
- 272 of the 840 outer chunks are left as wild, unclaimed land.
- Each district is blocks wall to wall, filled for its purpose: commerce (mega malls), agriculture
  (biospheres), industry, port, research, suburb, storage, parkland.
- Stations stand in the commerce, agriculture, industry and port districts, joined to the avenue
  railway.
- The land between the districts carries corridor on 15% of its ground; the districts carry 2.2%.

**Clean and joined.**
- No rock is left anywhere in the frame.
- Everything is on one corridor network and one cable network.
- Every station is on one railway, which reaches all four edges and bridges corridors about 1,750
  times.
- Water, power, food and oxygen are made good.

**Planned.** 94 zones in 13 colours: every quarter, every district, and the avenues.

**Scale.** About 20,500 buildings and about 310,000 people per metropolis.

### The ordinary cities

- Every city of four homes or more has a railway loop round its districts (86 to 343 tiles).
- Its districts are zones of the planner in their colours (Centre, Homes, Power, Industry, Port).
- They also have the new stores, wind turbines, parks, and a biosphere from twelve homes up.

### The buildings

| Building | Size | What it does | Gate |
|---|---|---|---|
| Wind turbine | 2×2 | 10 power a year at 1,000 mbar, in proportion to pressure, up to 1.5× | 300 mbar (a new game has 6; the example 1,044) |
| Mega mall | 8×6 | 90 food a year, for 70 power | 10,000 people |
| Water tank | 2×2 | Room for 400 more water | none |
| Battery bank | 2×2 | Room for 150 more power | none |
| Freezer | 2×2 | Room for 400 more food, for 1 power a year | none |
| Materials depot | 3×3 | Room for 1,500 more materials | none |
| Park | 4×4 | 2 oxygen a year, for 1 water | Open air over half the planet (0 at the start; 0.998 on the example) |
| Biosphere | 6×4 | 40 food and 30 oxygen a year, for 20 power and 12 water | none |

- A locked building's card says what it waits for ("at 300 mbar", "when terraformed"), and
  placement refuses it with the reason.
- Every one has a full-detail model, a medium one, and a measured far colour.

### Railways and trains

- **Bridges.** Where a railway crosses a corridor, it rides a deck 0.42 tiles up, on four pillars.
  The tiles either side ramp half-way up.
- **Maglev trains.** Four cars each: a blue glow under a white body, a band of lit windows, and a
  nose on the lead car.
- **Where they run.** One train per 56 tiles of loop, at 2.2 tiles a second, over every tile of every
  railway.
- **When they're drawn.** Up close and from middle distance, not from far away. They are worked out
  once a frame, not once per chunk.

## Measured

- **Tests:**
  - new buildings: `wind-stores.test.ts`, 9;
  - bridges and trains: `city-trains.test.ts`, 9;
  - `metropolis.test.ts`, rewritten for the new city: 11;
  - two new tests in `example.test.ts`: city railways, their trains, doubled rail and zones; and
    that no settlement draws more than it makes;
  - the palette's locks, in `city.test.ts`;
  - a claim filling a hole in the frame, in `claims.test.ts`;
  - heights asked for two places in turn, in `terrain.test.ts`.
- **Injections: 29.**
  - 26 caught, 5 of them only after I added or fixed a test:
    - A claim filling a hole inside the frame left the view's claimed tiles stale. No test covered
      it, so there is now one.
    - A crater memo kept across two places could return the wrong height. There is now a direct
      test that asks two places in turn.
    - "Straight on at every junction" passed, because the test layout's scan order hid it. A spur
      met first in the scan now shows it.
    - A water deficit behind full stores passed "every need met". It is now caught by "makes what it
      draws".
    - The bridge picture test first passed a flat rail (above).
  - 3 missed, each because the code it breaks never runs:
    - The brownout's stale-totals guard: every pass switches a building off, so the pass limit is
      never reached.
    - Trains on merged ground: ground with rail on it never merges; the same line draws rovers there.
    - The metropolis's "water anywhere" fallback: after the reachability fix, the water districts
      have room.
