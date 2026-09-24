# Batch 22 — Detail: terrain with depth

Detail doc §6 step 1: *"Add the two-layer elevation to the settlement model (section 1):
`base_elev_m` sampled from the planet, `local_height` from a stored seed. Render the grid with
height. No new buildings yet."*

**What was built:**
- **One planetary elevation field** (`src/shared/planet-terrain.ts`), moved out of the renderer so
  the simulation and the globe read the same one.
- **A hypsometric curve** (`src/sim/hypsometry.ts`) that turns a site's elevation rank into metres:
  `base_elev_m`.
- **A local heightmap and slope per tile** (`src/sim/micro/terrain.ts`), derived from the place and
  never stored. Buildings are refused on ground that is too steep, and the refusal says so in words.
- **The city view drawn with height:** tile columns, a plinth under each building, and buildings
  lifted onto their own ground.
- **Exact picking over the heightmap.**
- **Elevation shown in words:** under the cursor while founding, on each settlement's row, and for
  the ground under the pointer while placing.
- **A second golden city frame of the whole grid**, because the close-up turned out to be blind to
  the terrain (below).

The browser runs with hills of 12 m either side of the base. Batch 20's
`TERRAIN_ROUGH_FRACTION` is retired: steep ground is now the blocked terrain.

**Exit gate met, and checked by injection:**
- **Same place, same terrain.** The same coordinate always gives the same ground, and nothing about
  terrain is saved; the schema is unchanged at v5.
- **One field.** A settlement's elevation agrees with the globe's coastline everywhere except
  inside the globe's own shore jitter.
- **Placement.** It refuses a too-steep footprint and accepts a flat one.
- **The golden city frame** was re-rendered on purpose, looked at, and its tolerance re-measured.

**Numbers:** 764 tests pass, up from 743. The web bundle grew from 161.5 kB to 166.6 kB of JS. The planet's twelve golden frames, the Batch 3 score and
the determinism gate did not move.

## Decisions taken (defaults, on a bare "go")

1. **One field, shared, not mirrored.** The noise, the elevation field and the sphere-area table
   moved to `src/shared/`, which both sides import. It is pure geometry, not state. The renderer
   still imports no simulation state. The planet's golden frames came through the move unchanged.
2. **Elevation in metres is a curve over rank.** The globe draws water wherever a point's rank (the
   share of the planet lower than it) is below the ocean fraction. So a monotonic rank-to-metres
   curve makes settlements, the globe and Batch 23's sea level agree by construction.
   - Nine control points: −8.2 km (Hellas), −4.1 km (the northern plains), up to +8 km.
   - The noise has no Olympus, so the top is 8 km, not 21.
3. **Nothing about terrain is stored** (conflict 4). `seed_terrain` and `base_elev_m` both follow
   from the coordinate, and the planet's terrain never changes.
4. **The local terrain is seeded by place alone**, not by `hash(planet_seed, lat, lon)`, so a place
   always looks the same, as the planet does.
5. **Rough ground retired** (conflict 3). Steep ground is the blocked terrain. `TERRAIN_RELIEF_M`
   defaults to 0 (flat), because every fixture places buildings on fixed tiles; the browser uses 12.

## What went wrong

**My landing zone came with a cliff round it, and the reference city found it.** The first version
levelled the centre square to its average height and eased the hills in over 3 tiles. At the edge,
that step was up to a third of the full relief, so the ring of tiles round the landing site was too
steep to build on. The reference city's spaceport, at the zone's corner, was refused ("slope 0.26,
limit 0.15"). The zone now sits at height 0 (the settlement's own base elevation), and the hills
are scaled up from it over 8 tiles. A test pins the zone and the ring round it as buildable.

**The first relief I tried made most of the ground unbuildable.** With 5-tile hills, 57.3% of the
ground was too steep at 12 m of relief. I measured before choosing: 10-tile hills at 12 m leave
16.1% too steep (the mean over 100 sites), and at least 439 of the 900 places a 3×3 building could
start are clear.

**Picking by marching the line of sight missed corners.** The first version stepped down the line
of sight 0.02 tiles at a time. Against an exact box-by-box oracle it agreed on only **99.15%** of
screen points: it clipped column corners between steps and picked the tile behind. Picking is now
exact (about 1,000 slab tests, 0.019 ms per pick). It agrees with a march 20× finer on
**99.989%**, and the two disagreements left are that march's own corner clips.

**The close-up golden frame could not see the terrain.** It frames the flat landing zone. Lowering
a hill tile by a metre, marking a steep tile buildable, and leaving the hilltop building unlifted
all changed it by exactly **0.0000%**. A second committed frame of the whole grid now does that job:

| Change | Terrain frame |
|---|---|
| Reactor load halved (small at this scale) | 0.0005% |
| Tile 26,25 one metre lower | 0.0015% |
| Tile 6,4 one metre lower | 0.0029% |
| Steep tile 2,0 drawn as buildable | 0.0036% |
| Solar array at 19,12 switched off | 0.0054% |
| Hilltop solar array not lifted onto its hill | 0.0394% |
| Tile 10,28 one metre lower | 0.0994% |
| **Unmodified** | **0.0000%** |

Its tolerance is **0.001%**, about one full-contrast pixel at 384×240. Every single-tile change
measured exceeds it. To give that frame a building off the flat zone, the reference city gained a
solar array 8 m up a hill.

**The scene cost 9 ms a frame to build, before the browser filled a single shape.** About 1,000
tile columns became part of every frame. That ground never animates, so its shapes are now built
once per layout and kept with the draw order. Measured in Node, on the reference city's 4,166
shapes (single runs, not averages; the first-frame figures include the JIT warming up):

| | Before the cache | After |
|---|---|---|
| First frame | 47.7 ms | 77.4 ms (the draw order plus every column) |
| Every later frame | 9.0 ms | 3.2 ms |

**Two of my tests were weaker than they looked, and the injections showed it.**
- **Slope was only ever checked through its own verdict.** Every steep-ground test found its tile
  through `isSteep`, or only counted steep tiles, so a slope that looked east only still passed all
  of them. A new test judges from the heights alone: for each side, a tile whose only big step is
  that way must be refused.
- **The cache test compared two cached histories with each other.** A ground store carried over
  from layout to layout makes every history equally stale, and that version passed. The test now
  compares against a frame built from an empty cache (`resetSceneCache`).

**Smaller things:**
- **Heights in the landing zone came out as −0**: a negative hill times a zero weight. It is
  harmless in arithmetic but not the "exactly flat" I wrote, and a test caught it.
- **Heredoc quoting mangled a `−` minus sign** on its way into a Python edit, so the edit
  couldn't find its anchor. Edits with escapes now go through script files.
- **Two comments stated a direction or a count before I checked.** The ray test said flat picking
  would name a tile "nearer the viewer" when it is farther, and the zone comment quoted a 5-tile
  figure measured on the buggy zone. Both were corrected against measurements.

## Measurements

| What | Measured |
|---|---|
| Settlements vs the globe's coastline, 5,000 random sites × 5 ocean fractions | 43 of 25,000 disagree (0.17%), all at most 0.0043 of rank from the shore (the jitter band is ±0.011), all within 125 m of sea level |
| Hypsometry against 8,000 random sites | the share below `HYPSO_ELEV_k` is k/8 to within 0.0051 (binomial σ at the median is 0.0056) |
| Building the shared elevation table | 35 ms, once |
| Terrain at 12 m relief, 10-tile hills, over 100 sites | 16.1% too steep; at least 439 of 900 3×3 placements clear (mean 613) |
| The test site (0.31, −1.2) | 277 of 1,024 tiles too steep (27%); heights −9.29 to +11.49 m; base elevation 1,734 m |
| An outpost at (−0.4, 2.2) | **0** steep tiles of 256 (see Open) |
| Exact picking | 0.019 ms per pick |

## Verified by injection

25 injections, all caught. Two only after the tests they exposed were rewritten (marked).

| Broken on purpose | Caught by |
|---|---|
| Settlements read the planet with longitude's sine and cosine swapped | the globe agreement survey |
| Settlements rank a slightly different field (5% higher frequency) | the globe agreement survey |
| The curve runs backwards inside each segment | the curve test, the agreement survey |
| A falling curve accepted by `validateTuning` | the refusal test |
| Hills run straight into the landing zone | the landing-zone test |
| The zone levelled to its mean, as first written | the landing-zone test (the ring round it) |
| −0 in the landing zone | the landing-zone test |
| Relief ignored: always flat | terrain, placement, city screen and ray tests |
| Slope looks east only | the any-side test (**missed at first**) |
| The slope limit ignored | terrain, placement, city screen |
| Placement ignores steep ground | the placement tests |
| Buildings stand on the lowest ground under them | the base-height test, the golden frames |
| Heights reach the renderer in metres, not tiles | view, golden, ray and city screen tests |
| Picking ignores ground height | the ray and city screen tests |
| Picking takes the farthest solid, not the nearest | the ray and city screen tests |
| Buildings not lifted onto their ground | the terrain golden frame |
| Cliff sides never drawn | both golden frames |
| Steep ground drawn like any other | both golden frames |
| The city screen picks the flat ground under the pointer | the hill placement test |
| The hint never names the ground | the hill and steep-warning tests |
| The founding prompt never names the site | the founding prompt test |
| Local heights print a negative zero | the formatter test |
| The cache key ignores the buildings | the cache tests |
| The cache key ignores the ground | the cache tests |
| Ground shapes carried across layouts | the from-scratch cache test (**missed at first**) |

## Open

- **Outposts barely have terrain.** On a 16-tile grid the 8×8 landing zone plus the 8-tile ease
  leaves almost no room for hills: the measured outpost had no steep ground at all. The ease could
  scale with grid size.
- **The mirror of the shader's coastline is a mirror.** `globeCoastRankJs` is checked against the
  simulation, not against the GPU. If the shader's coastline and the mirror diverge, the agreement
  test stays green (the same standing risk as Batch 17's `toPlanetJs`).
- **The city view's frame cost is measured in Node, not in a browser.** Building the scene takes
  3.2 ms a frame. The browser's fill of about 4,000 polygons on top of that is unmeasured; I can't
  open a browser to profile it.
- **Terracing waits for Batch 28.** Until then a steep tile stays unbuildable for ever.
- **Elevation is not yet shown on the globe itself**, only in the founding prompt's words.
