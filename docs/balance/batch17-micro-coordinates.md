# Batch 17 — Micro: coordinate spaces and settlement markers

The first batch of the settlement layer ([`docs/design/micro-world.md`](../design/micro-world.md), its
§12 step 1). Three things were built:
- the three nested coordinate spaces of micro §1, with the transforms between them;
- a settlement registry (§9.1), saved in the game file;
- founding from orbit (§2.3 step 1), with markers on the Batch 15 globe that stay on their spot as it
  turns and hide round the back.

Settlements are **inert**: they don't touch the planet until Batch 18 couples them. A test holds
them to that. The golden run, the golden frames and the Batch 3 score are unchanged. 650 tests pass,
up from 620.

## Decisions taken

The user said "go" without choosing, so the defaults I proposed at Phase 1 stand:
1. **The registry is saved now** (schema v4, with a v3 migration). Otherwise every settlement
   founded in the browser would have silently disappeared on reload until Batch 19. Only `id`, `kind`,
   `lat` and `lon` are saved; Batch 19 adds stores, buildings and offline catch-up.
2. **Readings of the doc's inconsistencies:**
   - ten building types, as in §5's table;
   - the Spaceport is #10;
   - each placed building counts once, since §2.2's `b.count` doesn't fit individual placements;
   - "`terraforming-macro-design.md`" means `macro-world.md` here.
3. **Tile size is 10 m** (`TILE_METRES`). The doc leaves it open; a 32-tile city is 320 m across.

One more, not asked: **no terrain elevation in the sim.** §1.1 wants "an elevation sample from the
terrain", but that noise lives in `src/render/`, which the sim may not import. The globe is a unit
sphere, and markers sit on its surface.

## What went wrong

- **The first local frame pointed south.** I wrote `north = up × east`; in this y-up planet space that
  gives south. It was caught before any test by working the case lat 0, lon 0 by hand. The frame test
  now checks *behaviour*: a small step along "north" must increase latitude, and a step along "east"
  must increase longitude. It doesn't re-derive the cross product.
- **Wrapping a longitude moved it.** `wrapLongitude(1.2)` returned 1.2000000000000002: the modular
  arithmetic loses an ulp even for a value already in range. The founding test caught it because a
  founded settlement didn't equal the coordinate it was founded at. It would also have nudged every
  saved longitude on every load. In-range values now pass through exactly.
- **An empty settlement list never drew.** The HUD rebuilds the list only when a key changes. The key
  for an empty registry is `""`, and so was the initial value, so with no settlements the list was
  never drawn and "None yet" never appeared. The HUD test caught it.
- **Test fixtures that weren't testing anything.** One compared two runs that both started with no
  settlements. Another hard-coded a founding site that was round the back of the globe at that
  camera. Both were fixed: the site is now chosen by depth, and the comparison now founds a city on a
  real mid-game world.

## Measurements (each tolerance set from these, with a margin)

| Transform | Worst error | Tolerance |
|---|---|---|
| lat/lon → 3D → lat/lon (pole excluded) | 6.4e-15 rad | 1e-13 |
| world → planet → world, at Mars's radius (3,389,500 m) | 5.5e-10 m | 1e-8 m |
| tile → world → tile, both grid sizes | exact | exact |
| planet → view → planet | 4.0e-16 | 1e-14 |
| marker screen position → back through the globe's rotation | 9.0e-14 | 1e-11 |

**The exit gate** is checked by `globe-geometry.test.ts`, at 4 camera angles × 312 sites:
- a marker's pixel, fed back through `toPlanetJs` (the TypeScript mirror of the shader's rotation),
  lands on the marker's own surface point;
- a marker is hidden exactly when its point is on the far side, which is checked against an
  independent fact: the point faces away from the point at the centre of the disc.

Both halves are guarded against vacuity: over 500 visible checks, and over 100 hidden.

## Verified by injection

| Broken on purpose | Caught by |
|---|---|
| The inverse rotation forgets the tilt | all four geometry tests |
| Screen y not flipped | marker placement, and picking |
| Markers never hidden | the far-side test |
| `advance` reacts to settlements being present, as a default-on coupling would | the inertness test (for Batch 18) |
| The founding buttons swapped | the HUD founding test |
| The Cancel button rebuilt every readout (which steals keyboard focus) | two HUD tests |
| The empty-list bug put back | the list test |

## Open

- **Markers rest on `toPlanetJs`, the TypeScript copy of the shader's rotation.** No test can compare
  it with the GPU shader itself. If they ever diverge, markers slide off their spots while every test
  stays green (Batch 15's open item, now load-bearing).
- **The software fallback** (used only without WebGL2) draws at a fixed tilt, so markers drift from
  the terrain there after a vertical drag.
- **Founding has no rules beyond "a real place"**: no minimum distance between settlements and no
  cost. The micro doc doesn't set any; Batch 18 or the economy can.
- **Conflicts 1–4** in `BUILD_PLAN.md` are Batch 18's to resolve before it starts.
