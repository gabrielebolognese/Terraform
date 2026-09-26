# Detail pass: no avenues, names and sizes, twice the buildings, and the line across each city

The user: "In big cities and metropolis you make these highways and corridors at the centre and at
the borders, but they feel so unnatural for a city development: erase them. And in the example
planet, 1) name all cities, 2) mark them as small city, medium city or large city. Without changing
the number of tiles and space, double the number of structures in each city - since you remove the
railways, this is going to unlock much more space. Plus, that railway you do: it's the rail that
connects cities, so in the cities that have it, it passes left to right or up to down through the
city, to the very extremes of the terrain, because it's the city interconnection line."

## What went wrong, and what it cost

### Twice the buildings broke three things that had scaled with them unseen

- **The placement check froze the test suite.** The example test replays every building through
  `placeBuilding`, the call a player's click makes. At 40,000 buildings a metropolis, a placement took
  27 ms, so each metropolis took 9 to 18 minutes and the suite ran past 25 minutes before it was
  stopped.
  - The cause: `rockAt` rebuilt the set of every tile built on, for every new list of buildings,
    before it even asked whether nature had put a rock there.
  - It now asks about the rock first, and looks at the buildings only where there is one: 27 ms went
    to 5.
  - The overlap check is now rectangles, not that same set.
  - A player's click in a big city no longer pays for it either.
- **The replay was still quadratic.** At 3.4 ms a placement, 120,000 metropolis placements is minutes.
  The rules that look at other buildings look under the footprint, and the only others are the rover
  posts and the people. So the test now places each building against what was built earlier within
  16 tiles, plus every earlier rover post: the same answers, in 37 s for the planet.
- **Opening a metropolis hitched for half a second.** After its ground is made over frames, the view
  still took 446 ms at once (170 at half the buildings). `commandCover` checked every building against
  every industrial command, and the doubled works hold hundreds. The commands are now bucketed by their
  reach, the same result in the same order: 257 ms.
- **A substep of the planet went from 30 ms to 68 ms.** `settlementStep` remade each building's
  definition, level and type every substep, and asked every building for its CO2 and research. Those
  are now kept per list of buildings and asked once a type: 51 ms for 246,000 buildings (30 for 98,000
  before). At 100× that is still about 60% of a second; 1000× drops time, as it did before.

### Filling the land

- **"Twice" first came out 0.9 to 1.5 times in the small cities.** The fillers only topped up a chunk
  holding fewer than three buildings, and a small city's chunks were mostly its core, already past that
  count. Every chunk is now topped up.
- **A random 10 to 50 a chunk left two small cities at 1.84×.** With 9 chunks, luck decides. The range
  is now 16 to 50 a chunk, and the least any city reaches is 2.06×.
- **The first metropolis ran 10,400 water a year short.** The districts are now built full, so the
  producers the balance pass adds had nowhere to go, and it gave up. It now puts them on the works'
  own land as a last resort.
- **The fallback then put 228 extractors in a single chunk.** It filled the first chunk with room. It
  now stops at 50 a chunk, as the works do.
- **A chunk already at its count went unzoned.** It skipped the works zone along with the filling.
  Every works chunk is now zoned.

### The lines across the cities

- **Doubled track in one city.** The crossing line took the row through the founding square with the
  fewest buildings, which ran alongside a leg of the city's own loop: 7 doubled squares where 5 is
  allowed. The row choice now counts rail beside it as half a building.
- **"To the city's extremes" was the wrong test for a blob.** The old check looked for rail near each
  edge of the city's box. A blob's easternmost chunk is rarely on the line's row. The line is now
  checked edge to edge along its own row: it covers 69 to 100% of that row's land (a city keeps its
  crags and slopes) and reaches within 39 tiles of each end.
- **One of my test edits cut five tests out of `metropolis.test.ts`.** A text match meant for one test
  found an earlier one first, and everything between them was deleted. The file was restored from git
  and the edit made again by line number.

## Built

### No avenues

The double railway, the four corridors, the cables and the cleared strip, 14 tiles wide, that ran
through and round every city of 13 chunks or more and every metropolis are gone, with the "Avenues"
zone. The districts no longer keep stations; only the metropolis quarters do (6 to 7 each).

### Names and sizes

- **Names:** every settlement is named at founding: the metropolises Olympus, Tharsis and Hellas;
  the cities after the places of Mars, smallest first (Gale ... Schiaparelli); the outposts after those
  who looked at it (Huygens ... Zhurong).
- **Size classes** (`sizeClass`, by the chunks a city holds, the founding square's included):
  - up to 40 chunks: small city (3 to 7 across, nine cities);
  - up to 125: medium city (9 to 13 across, nine);
  - more: large city (15 to 17 across, six).
- **Where it shows:** the HUD's list of settlements, the city view's header and the world map's panel.

### Twice the buildings

Every chunk of a grown city is filled to between 16 and 50 works: twice the old 3 to 25, wall to wall.
The districts' blocks are built full, with none left open.

Measured against a95870a, on the same seed and the same land:
- the metropolises: 2.13 to 2.21 times (40,500 to 41,500 each);
- the cities: 2.06 to 3.84 times;
- the planet: 98,142 buildings before, 246,095 now;
- the example builds in 16 s (it was 15).

### The line across each city

- **Planned first:** the network between settlements is now worked out before anything is built.
  Each settlement knows which ways its lines leave: more east-west than north-south means across,
  otherwise up and down.
- **Laid across:** each such way is a straight row or column right across the settlement's land,
  through its founding square. For a city or metropolis it is laid before the districts and kept clear
  of buildings; an outpost gets it over what it has.
- **In play:** `connectSettlements` lays the same line through both ends when a player joins two
  settlements.
- **On the example planet:** 34 settlements have lines both ways; no two long railways run side by
  side anywhere.

## Measured

- **Tests:**
  - `routes.test.ts`, 2 new tests: the line straight across each end, edge to edge, and the way the
    other lies; size classes at their bounds;
  - `example.test.ts`, 3 new tests: names and sizes; twice the buildings; the line across every
    settlement, with no avenues and no double track;
  - `metropolis.test.ts`: 16 to 50 a chunk, reach-based room, the avenue tests gone;
  - `world-map.test.ts`: the panel says "Small city";
  - `step-cache.test.ts`, 2 new tests: a kept list of buildings stepped under another tuning gives what a
    fresh one gives; a crag is none once a building stands over it.
- **Two injections were missed at first**, both in the speed-ups: the kept buildings ignoring a change of
  tuning, and a rock reported under a building. No test looked at either (the second not before this
  pass either). `step-cache.test.ts` was written for them, and both are now caught.
- **Injections: 17, all caught** (the last two only once `step-cache.test.ts` was written):
  - a railway laid with no line across either end;
  - the line crossing the wrong way;
  - the size classes swapped;
  - the map saying "City" with no size;
  - the overlap check missing a building a row up;
  - the settlements unnamed;
  - two settlements with one name;
  - the fillers as before (3 to 25);
  - no crossing line in the grown cities;
  - a second line alongside (a highway);
  - the outposts without their line;
  - producers not put on the works;
  - producers piled in one chunk;
  - the crossing line laid beside the loop;
  - command squares seen from their own bucket only;
  - the kept buildings ignoring the tuning;
  - a rock reported under a building.
- **Verification:** 1,067 tests in 87 files pass (161 s); typecheck, `build:web` and `build` are clean.
