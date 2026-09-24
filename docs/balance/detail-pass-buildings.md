# Detail pass — the ten buildings, much more detailed

An intermediate task between Batches 23 and 24, at the user's request: *"highen the details and
complexity, especially on solar panels … make them much much more detailed."*

Every building was rebuilt with far more parts, in the spirit of the detail doc's §2: complex, not
detailed. Many more masses, still flat-shaded.

| Building | Now has |
|---|---|
| Solar array | Four tables, each a framed module of 6×4 cells in slightly different blues, on two tall back legs and two short front legs with a cross brace and a torque tube. A cable tray, an inverter box with a louvre and a status light. Sunlight sweeps across the glass while it runs. |
| Habitat dome | A two-tier base ring; glass with 16 meridian ribs and 3 latitude rings; a crown hub, a mast and a blinking beacon; corridor stubs front and back; 14 window lights for occupancy; an airlock with a door and a hazard stripe. |
| Reactor | Two banded cooling towers with rims, piped into the containment. Bolt collars and ribs on the containment, a hatch, the glowing core band, a switchyard of transformers with insulators, and a turbine hall with vents and a lit strip. |
| Geothermal plant | Two wellheads with valve collars and a brine header; a waisted cooling tower with a band and rim; a turbine hall with roof plant, railings and lit windows; a condensate drum on saddles. |
| Water extractor | A lattice derrick with braces and a crown block; a walking beam with a counterweight; a banded tank with a cone roof and a ladder; a pump house with a vent and a lit window. |
| Atmosphere processor | Grilled intakes with caps; panel seams and an accent stripe on the body; roof vents and railings; a banded stack with a beacon; three gas drums piped in. |
| Greenhouse | See-through glass with 9 arches and a ridge; four rows of crops on benches; grow lights while it runs; a plant room with a turning fan. |
| Regolith mine | A terraced pit; an excavator with tracks, cab and swinging boom; a conveyor on posts into the processing plant and its stack; a spoil heap; the ore store. |
| Storage depot | A bunded slab; three banded tanks with domed tops and ladders; the pipework; a pump skid. |
| Spaceport | Pad markings (a touchdown ring, a target, a cross); 16 chasing lights; a lattice service gantry with an arm to the lander; the lander on four legs with an engine bell, bands, windows, fins and a nose; fuel tanks on saddles; the control tower with a lit cab, a mast and a dish. |

A close-up of all ten, running, is `docs/frames/city-buildings.png` (`npm run sim:city`).

## What went wrong

- **Every ring band drew its top cap.** Bands reused `frustum()`, which closes the top with a disc,
  so each band painted a flat coloured ellipse across the tower, tank or drum it wrapped. The first
  render showed it. Bands now draw their sides only.
- **The accent bands were then too thin to see** at city zoom (0.03 tiles). They are now 0.06.
- **The render wall caught the word `phase` again,** this time in the solar glint's sweep, as in
  Batch 20. The variable was renamed; the wall was not loosened.
- **My first draft carried three meaningless parts** (near-zero-radius bands and a degenerate
  frustum), found by reading it back and removed before the first render.

## Cost

Each building's static parts are now built once and kept, like the ground since Batch 22. Only the
live parts (lights, the beam, the boom, the fan, the glint) are rebuilt every frame and slotted
back in at their place in the painter's order. Measured in Node, on the reference city:

| | Before the detail pass | After |
|---|---|---|
| Shapes per frame | 4,166 | 7,276 |
| Building the scene, every later frame | 3.2 ms | 1.55 ms |
| The first frame | 77.4 ms | 77.5 ms |

The browser's fill of about 7,300 polygons per frame is unmeasured; I can't open a browser to
profile it.

## Held to account

- **Both golden city frames were re-rendered on purpose** and looked at. Their tolerances were
  re-measured against the new scene, and both still hold. The close-up's smallest measured change is
  now 0.0046% (tolerance 0.003%), and the terrain frame's smallest single-tile change is 0.0015%
  (tolerance 0.001%).
- **A new cache test:** a building switching off or on must give the same frame as one built from
  scratch.
- **Injections:** 4 of 5 caught.
  - Caught: the cache ignoring whether a building runs, live parts dropped from cached frames, caps
    back on the bands, and the solar cells lost.
  - Missed: the cache key ignoring where a building stands. That mutant is equivalent today, because
    moving a building changes the layout and clears the whole cache.
