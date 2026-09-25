# Detail pass: bigger founding ground, and claiming land

The user: "make the initial boundaries at LEAST 3x bigger ... after a city reaches 200 habitats, I can
claim new terrain, then at 300, I can claim new one, etc, indefinitely, the more I expand, the more
terrain it generates in that direction." "Habitats" is read as inhabitants: 200 habitat domes would
house 8,000 people.

## What went wrong, and what it cost

- **The height function was nine times too slow for the new sizes** (see the open-world note): 8.7 µs a
  sample, 1.5 s to lay out a 96-tile city's world. Found by measuring before switching the sizes on;
  fixed first (0.97 µs, 0.31 s).
- **The view was re-derived at 78 ms (city) and 567 ms (metropolis)** five times a second once the
  sizes tripled - the picture would have stuttered at every refresh and a metropolis would have
  frozen. A profile put 51% in the hard-rock clusters: a string key built for each of nine cells on
  every tile, and a list searched for each. Now numeric cell keys and Sets, nature's rocks kept with
  the ground they belong to (they never change), and the world converted to tiles once per world:
  **3 ms and 26 ms**. The first derivation - laying out the terrain - is still 0.4 s for a city and
  1.1 s for a metropolis, once on opening and once after a claim.
- **Picking the ground under the pointer, off the grid**, was first a damped fixed-point iteration: on
  a slope near 1 it had not settled after 24 rounds (0.19 tile out). Then, correct but tested wrongly:
  the test asked for the exact point it projected, and one point lay behind a hill - the solver was
  right to return the hill (12.6 tiles nearer). Now a march down from above the highest ground and a
  bisection, tested as a property: the answer is on the ground, draws at the same pixel, and nothing
  lies in front of it.
- **Two claims tests were wrong, not the code**: I counted three new chunks round a claim where one was
  new (the other two were already beside the square), and a round-trip failed because the fixture's
  population and materials exceeded what the city had room for - a load clamps them.
- **A routing test was vacuous at first**: the headquarters of the chosen site was walled in by a range,
  so nothing connected at all and "no cable crosses unclaimed land" held trivially. The vacuity guard
  caught it; the test now runs on flat ground, since the rule is about land, not hills.

## The model

- **Three coordinates.** *Site*: the founding square is [0, base) for ever, and the terrain, its rocks
  and clusters are functions of site coordinates - a claim never moves the ground. *Chunk*: land is
  claimed `CLAIM_CHUNK_TILES` (32) square at a time, chunk (i, j) covering site [32i, 32i + 32).
  *Local*: what everything stored and every array uses, 0..n.
- **The frame is a square**: the smallest holding the founding square and every claim, padded on its
  far sides. Every grid in the game stays n x n (about a hundred sites index `ty * n + tx`); tiles of
  the frame outside the claims are ground to look at, not to build on - placement, corridors, cables,
  rovers and "connect all" all refuse them.
- **A claim west or north moves the frame's corner**, and every building, corridor, cable, broken rock
  and job moves with it: they stay on the same ground (tested: the height under every building and
  the rock on every tile are unchanged). The view says where the corner is (`origin`), and the city
  screen moves its camera by the change, so nothing jumps on screen.
- **Rules**: a claim must share an edge with the city's land; the first opens at
  `CLAIM_FIRST_POPULATION` (200) people and one more with every `CLAIM_STEP_POPULATION` (100); free;
  only a city (an outpost has no people). Reach is capped at 1,024 tiles a side (the tile key's stride):
  about 1,000 claims, 100,000 people.
- **The world** is the frame plus `TERRAIN_WORLD_MARGIN` on every side: claim east, and the world
  reaches further east.

## The save (v9)

Two new fields: `base`, the founding square as founded, and `claims`, sorted chunk keys. `base` is
stored though the tuning names it: a retune of the grid sizes must not move the ground under a city,
and claims are counted from it. A v8 save gets the sizes every build had until now (32, 16, 96). On
load under a tuning that founds larger squares, a settlement with no claims is re-centred in the
larger square - everything shifted half the difference, so the headquarters is at the centre again;
a smaller tuning never shrinks a city.

## Measured

- View re-derivation: city 3 ms, metropolis 26 ms (were 78 and 567). First derivation: 0.39 s, 1.1 s.
- 21 injections, all caught: thresholds, adjacency, the claimed mask, content moving with the corner,
  rocks/ground/world in site coordinates, routing on claimed land, migration re-centring, the
  retune-never-shrinks rule, save fields, the offers' positions, the boundary following claims, the
  overlay and its colours, the ground picker (two ways), the camera shift, the chunk under the
  pointer after a shift, the land card.

## Open

- Every tile a metropolis shows at full detail up close is still a cold 3 s to build the first time
  the whole of it is on screen (it rarely is: the camera culls to what is visible).
- The example planet was laid out for 32-tile cities; it is being rebuilt with zones next.
