# Batch 26: procedural structures

Detail §6 step 5: "Build the procedural structure generator and the primitive-instancing renderer
(section 2). Start with three signatures (dome, reactor, extractor) to validate the look, then fill
in the rest."

## What went wrong, and what it cost

### Looking at it found two faults no test would have

The three first signatures were rendered to PNG and looked at, then all 28 types. Two faults were
plain in the picture:

- **Greebles hid under the solar panels.** The clearance check against the signature's solids only
  blocked a solid at the greeble's own height. A tilted panel 0.2 tiles up let crates and tanks stand
  in its shade, which read as clutter. Anything overhead now blocks.
- **The dome barely changed from level 1 to 5.** Its only flat surfaces are the ring's narrow wedges,
  under the generator's minimum area, so almost no greeble found a place: 0.3 at level 1. §2.4's
  "extra towers" is the answer here. The dome's signature gained a level parameter, a service hut and
  tank in a free corner of the footprint at level 3 and a second at level 5.

### The animated tips re-ran the generator every frame

Antenna tips blink, so they are a live part, rebuilt every frame. The first version found its
antennas by generating the whole building again, every frame, for every building in view. Measured
on the largest city, the next frame went from 20 ms (Batch 25) to 29 ms, +45%. Each building's
structure is now kept, keyed by everything that makes it, up to 60,000 (more than a metropolis's
41,000 buildings): 21 ms.

### The first cost measurement crashed the session

The first attempt built the whole high-detail scene of a 13,000-building city at once. The browser
never does that: above 400 tiles a side it draws in chunks. The session ended before the result came
back. The measurement was redone through the chunks the browser draws (`cityScene` with its `chunk`
option), over a 64 × 64-tile area, against Batch 25 in a separate worktree.

### Smaller things

- **The far-away colour of the water extractor drifted 1% past its test's limit.** `FAR_COLOUR` is
  each type's mean colour up close, and greebles and the seeded second tank moved it. A first attempt
  to re-measure wrote the near view's mean straight into the table, which is a different quantity
  (the far view paints its block colour; the measure includes the building's ground). Every entry was
  instead scaled by its measured near-to-far ratio: the extractor by 0.95 to 0.97, the dome by 1.02,
  the rest within 2%.
- **A level-ratio threshold was written before it was measured** ("at least 1.3 times"). The
  measured least is 2.29 (a 1 × 1 depot, whose roof fills up) and the most 7.2 (the dome). The test
  asks for 2.
- **The static-shape cache key did not hold the level.** An upgraded building would have kept
  drawing its old shapes. A test now raises a building a level with the cache warm.
- **The structure test's city put its reactor on the headquarters.** The fixture now searches for
  free ground.

## Built

### The generator (`src/render/structures.ts`)

`generateStructure(type, seed, level, hosts, solids)` gives `{ variant, instances }`:

- **The variant: the signature's seeded parameters.** The signatures themselves stay the hand-built
  archetypes Batch 20 and the detail passes made, which already read at a glance (§2.3).
  - **Reactor:** one or two cooling towers, a second always from level 3; tower height 1.10 to 1.42
    tiles; one or two transformers.
  - **Water extractor:** derrick height 1.0 to 1.4 tiles, rising with level; one or two tanks, a
    second always from level 4; the main tank's height.
  - **Habitat dome:** the glass's radius, 12, 16 or 20 ribs, the mast's height, and annexes at
    levels 3 and 5.
- **The instances: §2.2's layer 3.** Greebles from a palette of seven: pipe, tank, vent, crate,
  panel, strut, antenna.
  - **How many:** `GREEBLE_BASE[type] + level × 3`. No greebles at all for parks and wind turbines.
  - **Where:** scattered over the signature's own flat, upward-facing faces (its hosts), weighted
    three to one toward roofs over the ground pad.
  - **Clearance:** each greeble keeps clear of the others and of every solid it would stand inside or
    under.
- **Pure and seeded** with mulberry32. The seed is the building's settlement, type and place
  measured from the founding square. Claims to the west or north move tile indices, never this. So
  nothing about the geometry is stored; it is made again from the save.

### In the renderer (`src/render/city.ts`)

- **Up close (high):** the signature, its greebles as still parts kept with the rest, and the
  antennas' blinking tips live, lit only while the building runs.
- **Medium:** the same seeded signature masses, no greebles, so a building does not change shape as
  the camera pulls back.
- **Low:** unchanged.
- **Hosts and solids** are read off the drawn signature (any rocket away) and kept per type,
  footprint and the parameters that shape it.

### Changed from the plan

- **The signatures are not rebuilt from generic primitives.** §2.2 has the generator assemble every
  layer. Here it varies the hand-built signatures and adds layer 3. Rebuilding 28 detailed signatures
  from a dozen primitives would have made them worse.
- **Conflict 6, the renderer:** the shape pipeline, not GPU instancing (agreed in Phase 1). The
  golden frames stay exact, and every existing feature (chunks, detail levels, trains, picking,
  flood water) keeps working. "Draw calls" are shapes: each is one canvas fill.
- **"Ten types" is all 28**, and the sheet holds each at level 1 and at its top level.
- **Conflict 7 was already resolved:** upgrades exist (levels to 5, 8 or 10), so §2.4 is live.

## Measured

- **Draw cost**, a 64 × 64-tile area through the browser's chunks, against Batch 25:

  | City, detail | Shapes | First build | Next frame |
  |---|---|---|---|
  | Largest city, high | 162,761 → 171,012 (+5%) | 421 → 493 ms | 20 → 21 ms |
  | Metropolis, high | 225,272 → 233,789 (+4%) | 521 → 585 ms | 18 → 19 ms |
  | Either, medium and low | unchanged | unchanged | unchanged |

  The heap for the high-detail area rose by 28 MB on the city and 3 MB on the metropolis.
- **Greebles at the top level against level 1:** 2.29 to 7.2 times, every type that carries any.
- **The reference sheet's tolerance:** 0.0002%, against measured changes:

  | Change | Difference |
  |---|---|
  | Unmodified | 0.0000% |
  | A water tank 8 → 7 | 0.0000% |
  | A depot 8 → 7 | 0.0001% |
  | The geothermal plant 8 → 1 | 0.0012% |
  | The dome 5 → 4 | 0.0016% |
  | Half a second of animation | 0.0457% |
  | Every building re-seeded | 0.1858% |

  A single level step on the smallest buildings is below it, a pixel at this scale; the structure
  tests hold it instead.
- **Tests:**
  - `structures.test.ts`, 6: the same structure for the same seed and level with `Math.random`
    poisoned; each building its own; complexity by level; a city drawn the same after a save and
    load, with no geometry in the save; a raised building redrawn with the cache warm; a structure
    kept through a claim to the west.
  - `structures-golden.test.ts`, 3: every type at both levels; the sheet within its tolerance; the
    tolerance not vacuous.
- **Injections: 12, all caught**, run one at a time with every file checked restored afterwards:
  - greebles the same for every seed;
  - the signature drawn from `Math.random`;
  - greebles blind to level;
  - no second tower by level;
  - no dome annexes;
  - the seed from the tile index (which moves with claims);
  - greebles never drawn;
  - the level missing from the kept shapes' key;
  - the level missing from the structure cache's key;
  - greebles inside the signature;
  - roofs not favoured over the pad;
  - the city drawing every building with one seed.
- **Verification:**
  - typecheck, `build:web` and `build` clean;
  - 1,087 of 1,088 tests in 91 files pass (202 s).
  - The one failure is the metropolis-opening timing test (see Open): one step of preparing a
    metropolis's ground took 403.7 ms against its 400 ms limit. That step is simulation code this
    batch does not touch (`git diff` shows no change under `src/sim` or `src/web`). Alone the test
    passes three runs of three, and the longest step measures 145-148 ms (median 0.6 ms).

## Open

- **The signatures' variety is in three types.** The other 25 vary by their greebles alone.
  Parameters for the rest (tank counts on depots, stack heights on processors) would follow the same
  pattern.
- **Small buildings carry few greebles** at level 1 (a dome 0.3, a water tank 0.2): little flat roof.
  Their signatures carry the complexity.
- **The first build of a chunk** costs 12-17% more up close.
- **The metropolis-opening timing test fails under load, now in a full run on its own.**
  - In Batch 24 it failed once with builds running alongside the suite. Here it failed with nothing
    else running.
  - Its longest `prepareCity` step is 145-148 ms alone, and reached 404 ms with 91 test files
    running on parallel workers: 2.7 times.
  - It times the wall clock, so load decides it. It needs a load-proof measure (the work per step,
    or the step run in isolation), not a looser limit. Assigned to `GAME_PLAN.md` Batch 40's
    performance pass.
