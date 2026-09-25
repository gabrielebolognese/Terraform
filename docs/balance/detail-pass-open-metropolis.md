# Detail pass: opening a metropolis without crashing the browser

The user: "critical performance issue: when opening the metropolis, the app crashes because you are
trying to load the whole city in one go, making the whole browser crash. Please fix this deeply."

## What went wrong, and what it cost

### The crash

**What happened.** The renderer's first step on any view built its whole scene:
- an occupant for every tile, a million of them;
- each ordered against every other occupant sharing its column of the screen. `depthOrder` sweeps
  the scene left to right, and on a 992-tile map every tile has about 2,000 such neighbours.
- That is billions of comparisons, and ordering edges kept in memory.

**Measured.** Reproduced headlessly, opening the metropolis as the city screen does (its first camera,
the chunked picture cache):
- the heap passed 3.5 GB before the first frame, and Node died out of memory;
- the planet itself held 218 MB.

**Why the tests missed it.** Every test that drew the metropolis whole used tunings where it was 352
tiles, or ran in Node with room to spare. On the old 352-tile metropolis the same sweep was slow but
fit.

### Found on the way

- **Nothing drawn was ever let go.**
  - The shapes kept for ground and buildings lived per view and were never dropped. Panning over the
    whole city would have grown them without limit.
  - The first bounded version kept 900 chunks' scenes. At about 1 MB each close up, panning reached
    1.4 GB (measured).
- **Every frame did whole-city work:**
  - it walked the whole claimed boundary (a million tiles) and rebuilt its shapes;
  - rail drawing scanned all 20,000 buildings for every side of every rail tile, looking for stations;
  - every visible chunk's signature was rebuilt from all its buildings;
  - zoomed out, the city was 18,000 chunks of 8 tiles.
- **Opening froze the page for 4 to 7 seconds**, making the terrain, rocks and the view's million-tile
  lists in one go. After the crash was fixed, this was the next thing a player would see.
  - The first incremental version still had a 456 ms frame and a 933 ms view build after it: the
    slopes, caves, world rocks and natural rocks still ran in one go, and so did the view's lists.
- **The terrain cache was bounded by count only** (24 grounds and worlds). With three metropolises
  opened, that could hold about 250 MB of terrain.

### Tests that measured the wrong thing

- An injection that failed to keep the prepared world heights passed at first: the view's time bound
  (1 s) was loose. It was measured instead: 170 ms kept, 530 to 570 ms not. The bound is now 400 ms,
  and it catches the fault.
- I wrote "about 2,500 steps" in a test before measuring. It is 5,422.

## Built

### Per-chunk scenes

Each chunk's scene is made the first time the chunk is drawn:
- its buildings (by their front corner);
- its ground tiles and patches;
- its own small depth order;
- its piece of the world beyond the grid.

It is kept among the most recently drawn, and let go past 120 chunks close up and at medium, 240 far
away. What the chunks share is made per layout:
- which building stands on each tile;
- the buildings by chunk;
- the connection points.

Nothing is made for the whole city.

### Drawing

- A view larger than 400 tiles, drawn whole, is its chunks back to front. Smaller views are drawn the
  old way, so the golden frames are unchanged.
- Chunks are 8 tiles up close, 16 at medium, and 32 far away. A zoomed-out metropolis is about 1,200
  pictures, not 18,000.
- The picture memory budget is 24 million pixels (was 48).
- The boundary is kept per claimed land.
- Stations are indexed by tile once per building list.
- Chunk signatures are kept per view, except up close, where rockets change them.

### Opening

The city's first view is prepared a frame at a time, with "Surveying the ground" and a progress bar:
- the ground and world a row of heights at a time;
- the rocks a row of tiles at a time;
- the view's lists (world heights in tiles, claimed tiles, links, heights).

Everything goes into the same caches `cityView` reads. A city already made finishes at the first step.

### Terrain cache

The cache now holds at most 12 million heights as well as at most 24 entries.

## Measured (Node, the browser's tuning, the largest metropolis, 1600 × 900)

| What | Before | After |
|---|---|---|
| First frame | Out of memory past 3.5 GB | 274 ms |
| Frames after, up close | Never reached | 6 to 14 ms |
| Heap while panning (planet + view + terrain + pictures) | Never reached | Steady at 430 to 630 MB, every detail level |
| Opening | 4.8 s in one frozen go, plus 0.9 s for the view | 5,422 steps, the longest 175 ms, then the view in 170 ms |

### Tests (`city-open.test.ts`)

- The metropolis opens without making the whole-city scene. Fewer than 100 chunks are made for the
  first view, and the first frame takes under 2 s (measured: 274 ms).
- A 300-frame pan keeps at most 120 chunk scenes.
- Preparation takes more than 500 steps, none over 400 ms, ending at 1. The view afterwards is under
  400 ms and equals what it would have made itself.
- The city screen, on a metropolis never opened, shows "Surveying the ground: N%" over many frames,
  then the city and its palette.
- A city 400 tiles wide or less is made in its first frame, as before: the city view's own tests
  expect that, and caught the first version preparing every city.

### Injections: 5, all caught

- Chunks built from the whole city first: the test itself ran out of memory, as the browser did.
- Chunk scenes kept without bound.
- Terrain made in one go.
- The prepared world heights not kept for the view (after tightening the bound, above).
- The screen making the ground in one go.
