# Detail pass: four times the hard rock, the Rover Post, and the tools on top

The user: "4x the generation of rock clusters, because right now there are very little. Also add a
structure called rover post, that allows you to have an additional rover, costs 300 materials,
occupies a 5x5, max 1 per 100 people. Then place the corridors, power cables, connect all, and claim
land buttons at the top right, not in the main bar, so connective things are on top and always
available."

## What went wrong, and what it cost

- **My first measurement of the smaller cell measured the old one.** Lowering `ROCK_CLUSTER_CELL` to
  32 changed nothing (4.2 -> 6.6 clusters, not 4x), because the code clamped the cell to at least 46
  - "twice the largest cluster" - independently of the tuning's own validation. The clamp now matches
  the rule that actually matters: a cluster reaches at most 22 tiles from its seed, so a cell of 24 or
  more keeps it within the neighbouring cells the lookup checks. At 32 no two clusters grew into one
  (none over 23 tiles in 12 worlds).
- **The Rover Post's far colours were first guessed** from its paint (0.66, 0.64, 0.60) - the LOD gate
  failed at medium (20.06% against 20%). Measured instead: the full-detail drawing averages
  (0.494, 0.447, 0.392); the far colour is now (0.607, 0.560, 0.496), drawn within 1% of it, and
  medium detail gained the hangar's dark rib, its door and the hut's band (13% off, the reactor's 15%
  is the widest).

## Built

- **Hard rock**: the cluster lattice's cell went from 64 tiles to 32 - four cells where there was one,
  at the same chance (0.65). Measured over 12 worlds of a 96-tile city: 10 to 22 clusters, 17.7 on
  average (was 4.2: 4.2x); on the 96-tile grid itself 2 to 5, 3.3 on average (was 0.8).
- **Rover Post**: 5 x 5, `COST_ROVER_POST` 300 materials, cities only, one for every
  `ROVER_POST_PEOPLE` (100) people. Each adds a rover to the `ROVERS_PER_HQ` at the headquarters;
  rovers still set out from the headquarters. A vaulted hangar with its door to the front, a rover on
  the apron, a crew hut, a charging pad with chasing lights, and a radio mast; medium and low detail
  calibrated against it.
- **Connective tools top right**: corridor, power cable, connect all and claim land live in their own
  toolbar, fixed at the top right, always shown - with no materials, and in an outpost (whose claim
  tool says "cities only"). The build bar holds only buildings. A tool's tooltip opens below it.

## Measured

- 9 injections, all caught: the cell back at 64, the old clamp, no people limit, no extra rover, the
  wrong cost, a 3 x 3 footprint, the tools back in the bar, the toolbar not fixed top right, the claim
  tool hidden for outposts.
