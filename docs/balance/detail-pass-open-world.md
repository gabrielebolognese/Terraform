# Detail pass: the open world, smooth ground, foundations, and a greening biosphere

At the user's request:
- *"make it open world, but with building boundaries; different scales, so high mountains,
  canyons, rock pits, caves … procedurally generated"*;
- *"the tiles shouldn't [show as steps], they should be smoothed out so the different level is
  visible but it doesn't look fake"*;
- *"building on a slope terrain builds concrete foundations under it"*;
- *"the amount of green spreads as the biosphere grows"*.

## What was built

**One continuous height function per site** (`terrainHeight`), sampled at tile corners:
- The rules read the buildable grid (`groundOf`): a tile's height is the mean of its corners, its
  slope the steepest rise along its edges.
- The picture reads the world round it (`worldOf`): the grid plus `TERRAIN_WORLD_MARGIN` 48 tiles
  on every side.
- The same function feeds both, and a test checks they agree corner for corner.

**Features**, all multiples of `TERRAIN_RELIEF_M`, so 0 is flat as before:

| Feature | Scale | At the browser's 12 m |
|---|---|---|
| Rolling ground | ± relief | ±12 m |
| Ridged mountain ranges | `TERRAIN_MOUNTAIN_SCALE` 8 | up to 96 m |
| Canyons winding along a noise contour | `TERRAIN_CANYON_SCALE` 3.5 | 42 m deep |
| Craters (rock pits) with raised rims | `TERRAIN_PIT_SCALE` 2.5 | 15–30 m deep |
| Cave mouths | in faces rising over 6 m per tile | — |

- The big features stand back from the buildable grid: a tenth of their strength inside it, full
  strength beyond its corners.
- The landing zone stays flat.
- Every site gets its own world, seeded by where it stands. A new game does not reshuffle a site:
  saves reload the same ground.

**Smooth ground.** Every tile is two lit triangles through its four corners; no flat tops, no steps.

**Colour:**
- dark regolith in canyon floors, dusty on the heights;
- bare rock on anything steep;
- slight variation throughout.

**Foundations.**
- A building stands at the highest corner under it.
- If the ground falls away, a concrete foundation fills down to the lowest.
- The buildable slope became `TERRAIN_MAX_SLOPE` 0.3 (3 m over 10 m), up from 0.15: moderate slopes
  now take a foundation, and cliffs are still refused.

**The open world.**
- The camera pans across the whole world and zooms out to `CITY_ZOOM_MIN` 0.15, which fits a city's
  128-tile world on a laptop screen.
- The building boundary is a dashed survey line on the ground.
- The world fades into haze over its last 16 tiles.
- The world's near edges stand on a rock skirt.
- Terrain in front of the grid is drawn after the buildings, so a mountain nearer the viewer hides
  what is behind it.

**The biosphere.**
- The habitat channels carry `greenery`: the globe's own green as a share of land
  (`vegFrac / landFrac`).
- The ground greens in patches as it rises: valleys a little ahead, heights behind, never cliffs.
- The threshold for each greenery value is a measured quantile, so at greenery *g* about a share *g*
  of level ground is green.
- Green never flickers back as the biosphere grows; this is tested.

## What went wrong

- **The first generator made cities unbuildable.**
  - 42–60% of the buildable grid was too steep, against 16% on Batch 22's hills. The big features
    reached a quarter of their strength into the grid. Now a tenth, fading in over a round distance
    from the centre, and the slope limit rose with foundations: 5.2% on average over 100 sites.
- **The first map also looked wrong:**
  - **straight creases:** a square distance measure (the largest of four) kinked along straight
    lines;
  - **polka-dot craters** and **pipe-like canyons**;
  - **mountains that barely appeared.**
- **Value noise left straight creases and square-edged mesas** once mountains stood 90 m tall on
  it. The big features now use gradient noise, each layer on a plane turned away from the tile axes.
- **The green ran ahead of the planet, then vanished.**
  - A guessed threshold greened 70% of the ground at 50% greenery.
  - A quantile of the noise alone gave 67%: the valley bonus had been left out.
  - The quantile table's ends were ±Infinity, and the smoothstep across them turned the ground
    completely bare at 100% greenery.
  - Now it measures 13.6% green at 0.1, 55.6% at 0.5, and 100% at 1.
- **The level-of-detail gates caught the ground three times:**
  - **Low-detail patches through their four corners flattened hills.** The ground differed from the
    full drawing by 0.027 (gate 0.004). Patches now merge only where their corners lie within 0.15
    of a tile of height: back to 0.0012.
  - **The open world in coarse cells lost its mountains.** Low's likeness was 54% of the bare-ground
    difference (gate 45%).
    - I first coloured each coarse triangle with the mean of its small tiles, each lit by its own
      slope. That reached 49%, not enough.
    - 2-tile cells at low, not 8, brought it to 40%.
    - With 2-tile cells, the mean-colour code was worth only one point (41% without it). An
      injection that removed it went uncaught, which is how this surfaced. It was removed.
    
    Cost fully zoomed out: 35,392 shapes for a metropolis and its whole world (21,491 before, for
    the grid alone).
  - Cables blocked low-detail patches again, a bug fixed once before and reintroduced by the
    patch-rule rewrite.
- **The ground cache key hashed tile heights, but the ground is now drawn from corners.** A change
  to corners alone would have left stale ground. Found while writing fixtures; the key and a test
  now cover it.
- **Test fixtures that were no longer flat.** "Flat" views zeroed tile heights, but the ground is
  drawn through corners now. A shared `flatten` helper replaces them.
- **Far colours moved.** The per-building calibration fixture had to change, and a foundation
  under a dipped fixture moved the dome's far colour by 4%. All eleven far colours were recalibrated
  on the new fixture: within 0.7%.
- **Tests rewritten because the rule changed, not the code:**
  - the "step to any side" placement test was about tile-to-tile height differences; the rule is
    now the rise along a tile's own edges;
  - the flood test's "every tile under water when the city falls" is now 997 of 1,024: the new
    ground's knolls stand higher.

## Measured

| | |
|---|---|
| Buildable grid too steep | 5.2% average over 100 sites (this site: 88 of 1,024 tiles) |
| World height range | −56 m to +98 m on average; this site −48.7 to +102.1 |
| Caves per world | 15.3 average |
| Metropolis and world, shapes | 396,375 high (whole world, unculled) · 58,550 medium · 35,392 low |
| Likeness at the widest zoom (8×8 blocks) | bare 0.0407 · medium 0.0145 (36%) · low 0.0165 (41%) |
| Far colours | within 0.7% of their full drawing |

## Open

- **The buildable grid is still 32 tiles** (96 for a metropolis). The world round it is open;
  widening the buildable area itself would shift existing saves' coordinates.
- Rovers can break crags on the grid only; the open world is to look at.
- Green is a colour, not plants: no trees or shrubs yet.

## The height function was nine times too slow (found before tripling the grid)

Tripling the boundaries means a 96-tile city and a 288-tile metropolis. Measured first: the height
function cost **8.7 µs a sample**, so a 96-tile city's world (148,225 half-tile samples plus rocks)
took **1.46 s** to lay out and a metropolis **6.2 s** - a freeze on every visit.

- The obvious suspects were wrong. A 256-direction gradient table (no trig per corner) and a crater
  cache (string keys) gained **nothing** (8.69 µs).
- A CPU profile showed why: **33% in `__name`** - the dev transform's wrapper for every inner arrow
  function, re-created on every call (`dot` and `quintic` inside `gradNoise`, four corners each, for
  every layer of every sample). The string keys of the crater cache were another 7%.
- Hoisted to top-level functions, with numeric crater keys (exact, per seed) and each layer's
  turn cached: **0.97 µs a sample; 96-tile world 0.31 s; metropolis 0.82 s**.
- Cost: the gradient table picks one of 256 directions instead of any angle, so the landscape
  shifted slightly. The terrain golden moved (2.75e-5 > its 1e-5 tolerance) and was regenerated
  after review; every measured number quoted in `terrain.test.ts` was measured again (steep ground
  2.9% of a 32 grid on average, was 3.4%; beyond the boundary 12.1%, was 13.5%; clusters 4.2 a
  city's world, was 3.9) - all inside the thresholds, none of which moved.
