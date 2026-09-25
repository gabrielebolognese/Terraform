# Detail pass: a smooth metropolis, and the example's metropolises rebuilt

The user: "in a huge metropolis there are still heavy performance issues. Without lowering the quality,
find a way to make sure the city works very very smooth - when a building is built, to not render
each individual building but a standalone object, or whatever you choose. Also change the metropolis
in the sample planet: make them 3x bigger; a little more order, in quarters; after the zones, suburbs
like 8 domes or smaller clusters; in general the city full besides some parts, very very wide, with
ALL structures, including a railway station, rovers going back and forth, an alive city; right now
there are just blobs connected with one corridor - they should be connected with many; the zones are
very busy."

## What went wrong, and what it cost

- **The first chunked frame was slower than the old whole one - 14 seconds a frame.** Each chunk's
  drawing began by computing the scene's layout key, which strings together every corridor, cable and
  rock of the city, and the ground's height range over every tile: once a chunk, 2,300 chunks a frame.
  Both are now kept per view (a view is re-derived five times a second and never changes). Then every
  chunk scanned all ~50,000 of the world's cells for its own: now indexed by chunk, behind and before
  the grid. Measured on the browser's metropolis (352 tiles a side, ~3,700 buildings), whole, at low
  detail: a repeat frame **5.5 ms and 32 shapes filled, against 141-169 ms and 394,697 shapes filled
  every frame before**; medium 3.0 ms and 874 shapes (was 61-78 ms, 53,246); high 4.0 ms and 1,450
  (was 29-30 ms, 53,063).
- **The first frame is still seconds of work** (3.6 s at low for a whole metropolis - about what the old
  scene cost when first built). It no longer freezes: chunks never drawn get 40 ms a frame, the ones
  nearest the middle of the view first, and the city fills in.
- **The example took 13 seconds to build.** The metropolis's quarters were filled by scanning each from
  its corner at every try, and what the city draws was summed afresh after each producer added (1.2 s a
  metropolis); each suburb and each loose building left a network of its own for "connect all" to join,
  a whole-grid search apiece (80 a metropolis, 2.3 s). Scans now resume where the footprint last fitted
  (and a footprint that found no room never looks again), the sum is kept running, and streets run two
  deep round every building, so they meet across the gaps the rows leave: **3.9 s**, the browser's
  banner showing meanwhile.
- **A test took 4 minutes 42 seconds**: the "no two buildings closer than two tiles" check compared every
  pair (40 million assertions a metropolis), the zoning check sorted the whole city for each building,
  and the link replay re-sorted a growing list for each of 40,000 tiles. Now a grid of owners, cells of
  neighbours, and each tile checked on the settlement as built: 25 s. The replay's cost pointed at the
  rules themselves: `placeLink` and `placeBuilding` built a set of every building's tiles and scanned
  every link list on each call - now kept per list, which the game's placement preview gains from too.
- **"Take any corridor tile up and the city is still one" was too strong a test**: a suburb beside a
  ridge has one way in. Measured instead: the share of corridor tiles that are the only link somewhere
  (articulation points, Tarjan's method) - **0.64-0.93%** now, against **6.6-9.5%** in the layout before
  (blobs joined by one corridor). Each suburb has two roads in; "connect twice" runs over the whole city.
- **The first layout filled half of each quarter** - its recipe ran out before the land did. Quarters now
  fill until full; power quarters keep room for what the city draws, then take solar.
- **Two of "ALL structures" were missing**: the geothermal plant (power quarters filled with reactors and
  solar first) and the Atmosphere Processor, left out on purpose - on a finished planet the air holds
  too little CO2 for it. Both are in; the processors stand idle with a badge, as the simulation says,
  and the "every building runs" test excepts them by name.
- **Railways**: a rail lane cut by rough ground left one metropolis with two of six stations on a line.
  Where the lane is cut, the rail now goes over any open ground: every station on one line.

## Built

- **The city in chunks** (`src/web/city-chunks.ts`, `cityScene`'s `chunk` and `layer`): the still part
  of each 8 x 8 square of tiles is a picture, drawn once at the zoom it is seen at (the half-octave at or
  above it, so a picture is only ever shrunk on screen), and kept; a frame draws the pictures back to
  front, what moves over each (lights, rockets in flight, rovers), then the overlays. A chunk is drawn
  again only when its signature changes - the scene's layout, and each of its buildings as its still
  parts are keyed - or the zoom moves half an octave; those redraws take 8 ms a frame, the old picture
  standing in. Pictures past 48 million pixels are dropped, longest unseen first. Tested: the chunks'
  still and moving parts and the overlays are the whole scene, every shape once, at every level of
  detail; a dome filling up changes one chunk's signature.
- **The example's metropolises**: claimed land round the founding square (352 tiles a side, from 288),
  cut into an 8 x 8 grid of quarters with 4-tile boulevards. A civic heart (skyscrapers, the
  observatory, the forum, medical centers, laboratories, a command center), homes round it, then
  industry, power, the port (six spaceports in a line) and mixed quarters by the side of the city they
  face, and suburbs in the outer ring. 3,685-3,734 buildings each (were 648-1,068): every structure a
  metropolis may build, 6-7 stations on one railway, 7 rovers out, 7-8 rockets away. Every boulevard
  two lanes of corridor and cable and one of rail; streets two deep round every building.

## Measured

- Cover of the frame by buildings: 21-23% of every inner ring (the streets take most of the rest), 10%
  of the suburbs' ring.
- 14 injections, 13 caught at once. The fourteenth: removing any one of the three things that give the
  city second routes - streets two deep, lanes down the boulevards, "connect twice" - leaves enough of
  the other two that no tile's loss cuts more than 1.5% off; removing all three is caught (32,846 tiles
  of corridor, against the test's 40,000 floor). The share of sole links is what separates this layout
  (0.64-0.93%) from the one before (6.6-9.5%).
