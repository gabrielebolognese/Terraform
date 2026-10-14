# Batch 27: the front door - title screen and worlds

"A loader menu, a new game like minecraft worlds." The game opens on a title screen; the player keeps
any number of worlds, each its own planet and its own save.

## What went wrong, and what it cost

### The first injection run said every fault was caught, and none had run

The injection script ran each test through `npx` in a Windows shell. `npx` failed to start
("Cannot find module ...npx-cli.js") and exited non-zero, and the script counted a non-zero exit as
a caught fault. All 21 injections came back "CAUGHT", which was false. It showed only because the
script printed the failing lines, and every one was the same launcher error.

The script now runs vitest directly and calls a run "NOT RUN" unless vitest printed its test
summary. It starts with two no-fault baselines that must pass. **Cost:** one wasted run, about ten
minutes. Without the printed lines it would have cost the whole verification.

### A failed load used to start a fresh planet that the first autosave then wrote over

Before this batch, `boot` started a fresh planet in the same slot when a save failed to read or
validate. It set the problem aside as a message, and the 15-second autosave then wrote the fresh
planet over the save it had failed to read. A save from a newer version (opened in an older tab),
or one damaged by a bad write, was lost to the first autosave.

Worlds remove the path. `WorldLibrary.load` records the reason against the world and starts
nothing, so nothing exists to save over it. The list shows "Will not load: ... It is kept as it is."
The same holds for:
- the save from before worlds, when it is corrupt;
- an index that cannot be read, which is set aside under `worlds-unreadable-<time>` and never
  overwritten.

All of these are tested and injected.

### The example planet takes 19 seconds, not 3

The comment on the example planet said "about three seconds". It measured 19 s here, and has done
since the example's cities grew in Batches 22-26; nobody re-measured. It matters now because
"Terraformed start" builds it to make a world: about 21 s to create, and the UI says "about twenty
seconds".

Its determinism test builds it three times and plays ten sim-years: 71 s, the slowest test in the
suite. It stays in the full run, because the exit gate asks for every mode. The ten sim-years
(against a hundred for Standard and Sandbox) are because a hundred would add about 26 s per world
on its 42 settlements.

Speeding up the build is Batch 40's performance pass.

### `main.ts` had never been stopped, so nothing in it knew how to stop

The game was a module that ran once per page load. Making it a world that starts and stops meant
everything it set up had to be taken down. The city, the travel prompt and the world map each added
a `window` keydown listener that was never removed. With one world per page that was harmless.
Entering five worlds would have left five cities answering every key.

Each now keeps its handler and removes it in a `dispose()`. `startGame` hangs its own window
listeners on one `AbortController`, cancels its frame, releases the globe's WebGL context and
removes its page. The happy-dom test checks that leaving a world takes it off the page, and that
coming back leaves one world, not two. Both are injected.

### happy-dom has no `Option` constructor

The first run of the page test failed in the new-world form on `new Option(...)`. The form now uses
`createElement("option")`, which every DOM has.

## What was built

| Piece | What it does |
|---|---|
| `TERRAIN_SEED` (tuning, 0) | Turns the planet's elevation field by a uniform rotation drawn from the seed. The simulation (`siteElevation`), the globe shader (`uTerrain`) and the software renderer read the same rotation; at 0 it is the original planet. |
| `SANDBOX_ENABLED` (tuning, 0) | Nothing costs materials or credits, no population gate, lock or tech gate, no floods, no shortages; stores stand full. Read where each cost or gate is decided (`sandbox.ts`). |
| `storage.ts` | IndexedDB version 2: a `meta` store for the worlds index, apart from the saves. |
| `worlds.ts` | `WorldLibrary`: one slot per world; the old save carried in as "My planet" in place; create, load, verify, record, rename, duplicate, remove, export, import. Each world records its full tuning. |
| `game-tuning.ts` | The browser's tuning (moved from `main.ts`) and each mode's: Standard is it plus the seed; Sandbox adds `SANDBOX_ENABLED` and turns the tech gate and flooding off; Terraformed start is Standard on the example planet laid out from the seed. |
| `game.ts` | What `main.ts` was, as `startGame(...)` returning a handle that pauses, reports and stops. Escape opens the menu only when nothing else is open; a Menu button is always there. |
| `app.ts` | The title screen over a turning Mars, the worlds list (thumbnails, playtime, phase, year, last played; Play, Rename, Duplicate, Export, Delete by typing the name; Import), New world (name, seed or Random, mode, pace fixed at Standard), Settings and Credits placeholders, and the in-game menu: Resume, Save, Settings, Save and quit to title. |
| `thumbnail.ts` | The software renderer's planet at 96 px, turned to where the player left the globe, on the world's terrain. |

Old saves:
- a save from before this batch opens as "My planet", `toEqual` to loading it the old way;
- no save schema changed.

## Measurements

| Thing | Measured | Threshold set |
|---|---|---|
| A seed moves the continents: share of the sphere whose elevation rank moved | 0.975-0.983 | `MOVED_LEAST = 0.9` |
| Seeded planet: land share, simulation against shader | worst 0.0158 | `SHARE_TOLERANCE = 0.025` |
| Neighbouring seeds: of 60 places, how many moved more than 100 m | 59-60 (four pairs) | `GROUND_LEAST = 45` |
| Example planet build | 19 s | - |
| Terraformed world, create | about 21 s | - |
| Terraformed determinism test | 71 s | - |
| Page test (5 cases, real `App` and `startGame`) | 0.6 s | - |

## Injections

21 faults, one at a time, each against the test meant to catch it, after two no-fault baselines
that pass. **All 21 caught**, each on its own assertion. The tree was checked byte-identical
afterwards.

| Fault | Caught by |
|---|---|
| Sandbox charges materials | builds with no materials |
| Sandbox keeps the population gate | lifts the population gates |
| Sandbox keeps the planet's locks | lifts the planet's locks (park) |
| Sandbox stores not held full | the stores stand full ("power: expected 0 to be 5") |
| Sandbox keeps the tech gate | opens the tech tree |
| Sandbox charges credits | charges no credits |
| `siteElevation` ignores `TERRAIN_SEED` | two seeds are two worlds ("expected 0 to be greater than 45") |
| The rotation ignored | a seed moves the continents |
| "My planet" carried in with the wrong tuning | identical to loading it the old way |
| `load` ignores the world's recorded tuning | two seeds are two worlds |
| A failed load writes a fresh planet over the save | never deleted or written over |
| An unreadable index not set aside | set aside, never overwritten |
| Export loses part of the save | comes back exactly |
| Quit to title leaves the game running | the page test (one world, never two) |
| Delete without the name typed | delete waits for the name |
| A broken world starts anyway | nothing starts over a world that will not load |
| Rename does nothing | rename from the list |
| The example saves | look only |
| The typed seed ignored | create (seed 1234 recorded) |
| Continue opens nothing | continue |
| Stopping a world leaves its page | leaving a world takes it off the page |

## Open

- Building the example planet in 19 s is Batch 40's. It is now on the path of a player making a
  Terraformed world, not only of the look-only example.
- The pace is fixed at Standard until Batch 28 brings the presets. The control is shown, disabled.
- Settings is a placeholder until Batch 36.
- Earlier test files (`city-open.test.ts`, `journey.test.ts`) keep their own copy of the browser
  tuning rather than importing `game-tuning.ts`, so their measured thresholds do not move. Fold them
  in when they are next re-measured.
- The title's planet is Mars as every world begins it. Showing the last world played would need its
  look stored in the index; the thumbnail is the start of that.
