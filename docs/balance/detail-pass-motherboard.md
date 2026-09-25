# Detail pass: a settlement like a motherboard

The user: "the metropolis and cities have far, far too many corridors. Please make a more realistic
BIG Mars settlement in the metropolis in the example planet, not a huge clump of corridors - some
parts can also be aggregated together. Think of it like a huge motherboard: there aren't roads
everywhere."

## What went wrong, and what it cost

- **The last pass answered "connected with many corridors" by laying corridor almost everywhere**:
  streets two deep round every building, two lanes down every boulevard, and "connect twice" over the
  whole city - 2.97 tiles of corridor for every tile under a building in a metropolis, 1.66 in a city.
  The measure it was built to (few tiles anywhere's only link) rewarded exactly that. The user's
  picture was a network of trunks and spurs, not a mesh.
- **Packing blocks wall to wall nearly doubled the metropolises** (~7,200 buildings each), and a
  simulation substep went to 93 ms for the planet. Profiled: every substep asked each building's
  definition again for what it makes and draws on every brownout pass (a third), tested every building
  against every command center's square (a quarter), keyed the network rule with a string per building
  per pass (a fifth), and rebuilt the railway merge over the whole grid. All four now reuse what does not
  change within a substep or between them: **34 ms**. One block in three is open ground; ~6,400
  buildings a metropolis.
- **The first rewrite of the tests failed on line endings**: git had turned the files CRLF on commit, and
  the edit script's search text did not match. It stopped half way, having deleted a helper the test
  still imported.

## Built

- **Metropolis**: each quarter is two by three blocks, three tiles of open ground between, one block in
  three left open. A block's buildings stand wall to wall - they share its corridors and cables by
  touching, and need none of their own. One trunk trace of corridor and cable runs down each boulevard
  beside the rail lane; each block has one spur, straight from its nearest building to the nearest
  trunk; each suburb, a packed cluster, one road in. "Connect all" joins what is left. Measured: **0.19
  tiles of corridor per tile under a building** (was 2.97); **every building wall to wall with another**
  (was none); one network of each.
- **Cities**: no street round every building - the shortest traces that join them all, power along the
  same: **0.49** (was 1.66).
- The rule "no two buildings closer than two tiles" now holds for cities only: a metropolis builds in
  blocks.

## Measured

- 6 injections, all caught (two after sharpening them): streets round every building again (0.52
  corridor per building tile), blocks with gaps (0.53), no spurs (66 networks), city streets back
  (1.78), the command center's square blind to its level, and the network rule's bits colliding. Two
  first tries were equivalent mutations that changed nothing - a bit no building draws on, and two
  resources on different layers, which keep separate bits.
