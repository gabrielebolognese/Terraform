# Batch 20 — Micro: the 2.5D city view

Micro doc §12 step 4: *"Build the 2.5D renderer against the tile/instancing model (section 8): ground
grid, placement, procedural buildings, selection/inspector."*

**What was built:**
- Rough ground (§3.3's "blocked terrain"), derived from where the settlement stands, with its
  placement rule.
- The `CityView` contract: everything the city renderer may know.
- The isometric projection (§3.1) and a drawing order that replaces the doc's sort key.
- A small software rasteriser.
- Ten procedural buildings with render-time "aliveness" (§8).
- A pan and zoom camera (§3.2).
- The city screen: a build palette, a placement preview, selection and an inspector.
- An "Open" button for each settlement in the HUD.
- A committed reference render of a fixed city.

The browser now runs settlements (`SETTLEMENTS_ENABLED`, promised since Batch 18) and rough ground
at 12%.

**Exit gate met, and checked by injection:**
- **Placement:** every rejection case and the acceptances are tested.
- **Reference render:** compared per pixel, with a tolerance measured at 0.003%.
- **Render wall:** widened to admit `CityView` and nothing else, and a deliberate breach is caught.

**Numbers:** 728 tests pass, up from 674. The web bundle grew from 130.3 kB to 156.6 kB of JS. With the defaults, the planet's golden frames, the Batch 3
score and the determinism gate are unchanged.

## Decisions taken (defaults, on a bare "go")

1. **A list of flat shapes, not GPU instancing.** §8's target is instanced WebGPU, but a GPU's
   pixels differ between drivers, so a GPU render cannot be a golden frame. The renderer emits
   polygons from `CityView` alone:
   - a software rasteriser fills them for the reference render;
   - the browser's 2D API fills the same list on screen.

   This is §8's allowed "sprites-first" shortcut. Moving to instancing later replaces only the fill.
2. **Rough ground is derived, not stored.**
   - Value noise is seeded by the settlement's coordinate, so the save needs no terrain.
   - Exactly `TERRAIN_ROUGH_FRACTION` of the ground outside an 8×8 landing zone is rough.
   - The default is 0, because every existing fixture places buildings on fixed tiles. The browser
     opts in at 0.12.
3. **The drawing order is topological**, not §3.1's `tx + ty` (see below).
4. **Connectivity has no rejection case.** §6's basic version puts every building on the network,
   so nothing can fail it. That's recorded rather than faked.
5. **Going down to a city is a plain switch** (the "Open" and "Back to orbit" buttons). Batch 21
   makes it a journey. The simulation keeps running underneath either way.

## What went wrong

**§3.1's sort key draws buildings in the wrong order.** The doc says to sort by `tx + ty`. That is
right for single tiles and wrong for anything bigger: a 3×3 dome sorted by its origin tile draws
under a depot standing behind its far half. Measured against an independent ray-cast oracle over 40
random cities:
- the doc's key draws **3,820 of 66,915** overlapping screen samples wrong (5.7%);
- the topological order draws **0** wrong.

**My first order for the parts inside a building was wrong too, and only looking at the picture
caught it.** I sorted each building's solids by their centroid depth. That fails for exactly what
the assemblies are made of:
- the lights on the spaceport's wide pad have centroids behind the pad's, so they drew under it;
- the reactor's glowing band sits inside its containment's centroid, so it vanished.

No test caught it; the first preview PNG did. Each assembly now lists its parts in its own
painter's order, and the reactor wall is three stacked rings with the glow band in the middle.

**The planet's golden tolerance would have been worthless here.** Batch 6's 0.2% was measured for
the planet. Measured for this city:

| Change | Mean difference |
|---|---|
| Reactor load halved (core glow dimmer) | 0.0052% |
| One rock removed | 0.0439% |
| Render time +0.5 s (animation phase) | 0.0668% |
| Solar array switched off (badge, panels) | 0.1064% |
| One depot moved by one tile | 0.2107% |
| Selection ring removed | 0.2444% |
| Refused ghost shown as allowed | 0.2607% |
| **Unmodified render** | **0.0000%** |

At 0.2%, a building switching off would pass. The tolerance is **0.003%**: about three
full-contrast pixel flips at 384×240, and below the smallest real change measured. A test checks
that the smallest change still fails it.

**I wrote numbers into comments before measuring them — five times.** The rule is to measure first;
I broke it and then caught it in review:

| Comment | I wrote | Measured |
|---|---|---|
| Tiles differing between two nearby sites | 164 | 210 |
| Rough tiles with a rough neighbour | 111 of 115 | 113 of 115 |
| The same share, if rough tiles were scattered at random | "about 12%" | about 40% (1 − 0.88⁴) |
| Overlapping samples / samples the doc's key draws wrong | 88,433 / 1,187 | 66,915 / 3,820 |
| Power made by one geothermal plant | 10/yr | 8/yr (`GEOTHERMAL_POWER`) |

None of them changed a test's outcome, but each would have misled the next reader.

**Three of the 30 injections got through the first time.**
- **A scanline that isn't half-open.** The shared-edge test used a diagonal, where no pixel centre
  lands on a vertex. A new test uses a diamond with its side vertices exactly on a pixel-centre row;
  counted twice, the row cancels to nothing.
- **Picking that ignores building height.** Every click test hit a tile centre on the ground. A new
  test clicks a dome's upper back, which is drawn over bare ground outside its footprint.
- **The depth order dropping the "behind on both axes" case.** This looks like an *equivalent
  mutant*: the tie-break (smallest `tx + ty` first) already puts such a pair right. 200,000 random
  layouts (2 to 5 footprints on a 7×7 grid, heights up to 4.2 tiles) found no picture it changes. The explicit rule is kept, so correctness does not rest on an
  incidental tie-break, and a direct test of the geometric fact now pins it.

After those tests, all 30 are caught.

**Smaller things:**
- The render wall caught the word `phase` in my steam-plume code. The variable was renamed; the
  wall was not loosened.
- The HUD's settlement-list test broke when the "Open" button's text joined each row's text. The
  test now reads the text span, and a new test checks each button opens its own settlement.
- The reference city's first layout put the spaceport on rough ground and was refused, which was
  the new rule working. The city was laid out again around the site's outcrops.

**The first check of the app over HTTP proved nothing.** After a restart, port 5173 was answering,
but it was another project's Vite server (`Desktop\project`, a "FlashFX" editor), and it returned
200 for this game's module paths. Port 5174 was the same project, and 5175 to 5177 were taken too (by what, unchecked). Only checking the page
title and grepping the served modules for this batch's code showed the difference. This game now
runs on 5178. A later low-memory notice said the server had been stopped; it had not. Only the
shell that launched it was stopped, and Vite kept serving on 5178, which was confirmed by process
and by fetching the modules.

## Measurements

**Terrain**, at 12% (the browser's setting):
- 115 of the 960 tiles outside the landing zone are rough, exactly `round(0.12 × 960)`.
- 113 of the 115 touch another rough tile, so they form outcrops rather than a scatter.
- Over 200 sites, at least **599 of the 900** places a 3×3 building could start are clear (mean
  651). Every building type has room.

**The reference city** (`npm run sim:city`) shows nine building types (the water extractor is
missing on purpose, because a dry city is what browns out the domes and the greenhouse). It also
shows rough ground and outcrops, three offline badges, a selection ring and a refused, crossed-out
placement.

## Verified by injection

| Broken on purpose | Caught by |
|---|---|
| Placement ignores rough ground | the rough-ground rejection |
| Off-grid check removed | four edge rejections |
| Overlap check removed | the overlap rejection, and the city-screen refusal |
| Kind check removed | the wrong-kind rejection |
| Cost check off by one | the exact-materials case |
| Landing zone not kept clear | the landing-zone test |
| Rough share floored instead of rounded | the exact-share test |
| Terrain ignores the place | the different-place test |
| Noise per tile, no outcrops | the clumping test |
| Depth order is the doc's `tx + ty` | the ray-cast oracle |
| Depth order drops the behind-on-both-axes case | the direct geometric test (after the first miss) |
| Raster scanline inclusive at both ends | the vertex-row test (after the first miss) |
| Raster fills nonzero instead of even-odd | the hole test |
| Raster ignores alpha | the blend tests |
| View shows everything running | the view tests, the inspector, the golden frame |
| Power load inverted | the load test, the golden frame |
| View mutates the settlement | the derived-view test |
| Reactor glow ignores load | the golden frame |
| Offline badge never drawn | the golden frame |
| Zoom unclamped | the zoom-clamp test |
| Pan unclamped | the pan-clamp test |
| Zoom about the centre, not the pointer | the zoom-about-pointer test |
| Footprint anchored at a corner | the footprint-origin test |
| Palette ignores settlement kind | the palette test |
| Refusal not shown | the refusal-in-words test |
| Inspector ignores shortages | the offline-reason test |
| Picking ignores building height | the upper-part click test (after the first miss) |
| Escape does nothing | the Escape test |
| HUD "Open" opens the wrong settlement | the HUD open test |
| Renderer imports `Settlement` | the render wall |

## Open

- **Only the scene is golden, not the browser's fill.** The reference render is the software
  rasteriser. The browser fills the same shapes with antialiasing, so screen pixels differ at edges,
  as the planet's GPU view differs from its golden frames.
- **The per-frame cost in a real browser is unmeasured.** The whole scene is rebuilt and filled
  every frame, and I can't open a browser to profile it. A 32×32 city with about 115 rocks and a few
  dozen buildings is a few thousand polygons.
- **Picking uses a height per building type** (one table the renderer also uses), not the exact
  silhouettes.
- **The outcrops look blocky**, because the noise is two octaves at 5-tile cells. This is cosmetic.
- **Connectivity (§6)** is still "every building is connected", so it has no rejection case.
- **The name clash from Batch 18** is still open: "Atmospheric processor" (the planet-level
  facility) versus "Atmosphere Processor" (the building).
- **Travel between orbit and a city** is Batch 21. It replaces the Open and Back switch.
