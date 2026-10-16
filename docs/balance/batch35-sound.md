# Batch 35 - Sound: music, ambience and effects

Built unattended (`/next-batch auto`), one session, 2026-10-16.

## What went wrong, and what it cost

1. **The title's music stopped after half a second.** The engine wrote the music's notes only when
   asked, and only a world's frame loop asked. The title screen has no world, so after the first
   gesture it wrote 0.6 s of notes - a chord and perhaps a note - and then nothing, for as long as
   the player stayed on the title. Every test passed: each drove the music by calling `frame`
   itself, and the title's test checked only that the piece was chosen. Found by the injection
   run: removing the game's `frame` call (72) changed no test, and asking why showed nothing else
   wrote the music anywhere. The engine now keeps its own clock (`SCHEDULE_MS` 200, inside the
   0.6 s lookahead), started at the gesture; the game's call is gone; the title's test moves the
   fake clock 25 s on and checks notes were written there. Its faults (79: the clock never started;
   80: started before a gesture) are caught. It cost a constructor parameter, a test, and a defect
   that would have shipped.
2. **Five more gaps in the tests, found by the injection run.**
   - **A claim's false finish, heard at the wrong time (35).** The claim test checked the cues heard
     over the whole run, and with the grid's numbers in place of the ground's the false "finished"
     came at the claim and the real one was then lost - the same list. The test now checks the
     claim's own look is silent; caught (73, and 74 with every lookup on the grid's numbers).
   - **The world from the title, untested (65).** No test opened a world from the title screen and
     checked it used the title's engine; a world given none played on its own silent one. A new
     test opens a new world from the title and hears its music follow the world's phase (Phase 1
     from its first moments: Thin Light); caught (77).
   - **A refused placement, never refused (69).** The test chose the building's card again before
     its second click, and choosing a chosen card puts it down, so the second click selected the
     building rather than placing one: the refusal path never ran. It now keeps the card and checks
     the refusal's words ("Cannot build: ..."); caught (78).
   - **Leaving for orbit from silence (75).** The check that orbit has no machinery left the city
     from a spot 85 tiles from every building, where the machinery was already 0. It now leaves
     from beside the running solar arrays (0.19); caught.
   - **A fault that was not one (55).** Removing the settings' `try` left its `catch`, and the file
     did not load: "no tests", counted as not caught. Redone with both removed (76); caught.
3. **The music's first test could not see the old piece playing on.** It checked that after the
   crossfade every note written was in First Water's mode. But Cold Ground's notes (D minor
   pentatonic: D F G A C) all lie inside First Water's (F Lydian: F G A B C D E), so a player that
   kept writing the old piece after its fade passed. Found when the check that the fade wrote both
   pieces' notes (added as a vacuity guard) could not tell them apart. The test now follows each
   note through the fake's connections to the piece it feeds, and asserts the old piece writes
   nothing after its fade. Injection 16 (the old piece writing on) is caught by it. Cost: the test
   rewritten once.
4. **A fade read the gain's `value`.** The first crossfade took its starting point from the old
   piece's gain `value`. While a parameter ramps, browsers differ on what `value` reads, and the
   fake reads the last value set (0, the start of its fade-in), so a fade-out begun during a
   fade-in would have started with a jump to silence: the cut the spec forbids. Seen while writing
   the "never cut" check; the fade now works out where the fade-in is from its own start time.
5. **A rocket test passed with no rocket.** The test of a rocket landing and going up again
   between two looks first passed its "still away, nothing heard" check vacuously: the launch had
   been refused, because the test city's stores were full ("the stores are full of materials"). It
   failed only at the second launch. Every launch in the tests now asserts it was accepted, and the
   city starts with room.
6. **The first train test did not test the hysteresis.** Its train never wavered about the near
   edge, so an ear without the second, wider edge passed it. Found while writing the injection
   plan, before the run; the train now wavers at 5.9, 6.2, 5.8, 6.3 tiles of a 10-tile ear, and
   lingers out to 8.9. Injection 37 is caught by it.
7. **Two wirings had no test at all, found by the injection plan.** Nothing checked that the
   example planet's happenings are not heard, nor that the assembled game passes its alerts to the
   sound. Both now have tests (the director with `cues` off over a run with a build, and in the
   assembled game a greenhouse placed through the canvas, finished at 1000x, and offline on no
   network: its built sound once, and the alert's).
8. **A claim west renumbers every tile, worksites' included.** Keyed on the grid's numbers, a
   worksite whose building stands a claim's width east of another would be heard as that one
   finishing the moment the land is claimed. The cue watch keys on the ground's corners (as Batch
   31's alerts do), and a test claims land west under a worksite with a standing building 32 tiles
   west of it. The test as first written missed injection 35 (item 2): it is caught as 73 and 74.
9. **The assembled test's first expectation of the music was wrong.** It expected Cold Ground; the
   test city's world had reached Phase 1 by the time it was opened (Phase 1 comes within seconds
   at Standard), so the music was Thin Light. The test now expects the piece for the world's phase
   reached. Not a defect.
10. **No Python on this machine.** Scripted edits were written in Node instead; the shell's quoting
   ate two template strings in a test along the way (caught by the typecheck, fixed by hand).

11. **The injection run.** 80 faults, one at a time, each file restored byte for byte and checked
    after each (the table is below). 73 were caught at once: 66 of the first round's 72 and 7 of
    the second round's 8. Of the other seven, four were missed for want of a test or with a weak one
    (35, 65, 69, and 75 the first time) and are caught since; one (72) was missed because it showed
    a defect (item 1); one (44) changes nothing as written, a second guard covering it, and is
    caught as a coherent fault (75); one (55) was no fault at all, and redone (76) is caught.

## What was built

- **An engine** (`src/web/sound-engine.ts`): one per session, made in `main.ts` and passed to the
  title (`App`) and every world (`startGame`). Four channels - music, ambience, effects, interface
  - each a gain into a master gain, each with the player's volume and mute. **No `AudioContext` is
  made before the first gesture** (`pointerdown`, `keydown` or `touchend` on the window, caught
  first); effects asked for before then are dropped and counted, never saved up; the music and the
  beds asked for before then start at the gesture. A browser with no Web Audio is tried once and
  stays silent. A hidden tab suspends the context, and coming back resumes it.
- **Effects** (`src/web/sound-recipes.ts`), made on the spot from oscillators and noise: place (a
  thump), built (two bell notes), upgraded (three rising notes), train (air swelling and falling,
  its note dropping), rocket (a deep roar building and fading), alert (two notes down), urgent
  (three pairs of pulses), objective and milestone (Batch 30's chime), phase (the chime with the
  octave), click (a tick). The world's on the effects channel, the rest on the interface's.
- **Music** (`src/web/sound-music.ts`): a piece per phase - a mode, chords, a tempo, a pad, a tune,
  a bass, glints - written 0.6 s ahead, every 200 ms on the engine's own clock, from a small
  seeded generator, each piece through its own echo and fade. Cold Ground (Phase 0) is 40 beats a minute in D minor pentatonic,
  a sine pad under a 650 Hz filter, a note on 12% of beats, glassy glints on 8%; Living World
  (Phase 6) is 68 a minute in D major, a sawtooth pad under 2,500 Hz, a note on 40% of beats, a
  bass, no glints. Tempo, brightness and notes rise every phase; glints only fall (tested). A new
  piece fades in over 8 s while the old fades out from where it was, and the old one stops writing
  at the end of its fade.
- **Ambience** (`src/web/sound-ambience.ts`): four beds, each always running and gliding (a 1.2 s
  time constant) to its level. Wind: 0.18 at 6 mbar to 0.75 at a bar, 1,500 Hz to 380 Hz, a dust
  storm adding up to 0.25. Rain: clouds x 1.5, times above freezing (273-280 K), times open water
  (5% of the surface for full). Sea: the ocean's share (0.5% to 25%) times, in a city, its
  nearness to the shore (1 at it, 0 from 1,500 m up). Machinery: what runs near the camera, by how
  hard and how near, saturating. From orbit the planet is heard at half (wind), 0.4 (rain) and
  0.45 (sea), with no machinery.
- **What is heard** (`src/web/sound-cues.ts`): built, upgraded and rocket are crossings between
  two looks at the state, keyed on the ground's corners; the first look takes its bearings. A
  train is heard as its front comes within 0.6 of the ear's radius, and not again until it has
  gone past 0.9.
- **The director** (`src/web/sound-director.ts`): at each readout, the music by the phase reached,
  the planet's beds, and the cues; in the city view, every 100 ms, the camera's ear - the ground
  under the middle of the view, hearing as far as the side of the screen - for the machinery, the
  shore and the trains. An effect in the city in view is placed: 1 / (1 + (d / (r/3))^2), never
  below 0.12, quieter zoomed far out, panned by its screen x. Another city's, or from orbit, at
  0.4 and centred. At most three of one kind a look.
- **Settings** (`src/web/sound-settings.ts`, `src/web/sound-panel.ts`): Master, Music, Ambience,
  Effects, Interface (80/60/70/80/70% to start) and Mute, on the title's **Settings** and in the
  world menu's. Kept per player as a `settings` record in the store's index beside the worlds list
  (not in any world's save), read when the game opens; anything else in the record (Batch 36's
  settings) is written back untouched; a record that cannot be read or written leaves the
  defaults.
- **The title** plays Cold Ground and bare Mars's thin wind from afar; every button ticks.
- **The milestone chime** (`chime.ts`, Batch 30) is gone: it made its own `AudioContext` on first
  use, outside any gesture. The milestone card's sound goes through the engine.
- `docs/credits.md` lists the licences: Lexend's (SIL OFL 1.1), and every sound and the music as
  the game's own.

## Decisions (auto mode; the recommendation a bare "Go" would accept)

1. **Every sound made by the game, no files.** "CC0 or self-made": self-made has no licence to
   check, nothing to download, and nothing the build needs to fetch.
2. **No context before the first gesture**, rather than one made early and left suspended: Chrome
   warns of a context made before a gesture ("not allowed to start"), and "none made" is the
   simplest thing to check.
3. **The music follows the phase reached**, not the current phase: the reached phase only goes
   forward (Batch 13's ratchet), so the music never flips back and forth at a boundary.
4. **Rain "once there is weather"**: the simulation has no rain, so it is derived from what there
   is - clouds over open water above freezing. The game's existing weather, the dust storm, blows
   the wind harder.
5. **Alerts, objectives, milestones and buttons on the interface channel**; the world's effects on
   the effects channel, placed in the city view.
6. **The example planet's happenings are not heard** (as its milestones and alerts are not shown);
   its music, beds and the player's own clicks are.
7. **Sound constants are browser constants in `src/web/`**, not `tuning.ts` and §10: they change
   nothing the simulation computes, as `config.ts`'s do not.
8. **The settings record lives in the store's index** under `settings`, the player's own store
   until Batch 36 decides its home ("kept per player, not per world, in their own store").
9. **At most three of one effect a look**: at a high speed a city can finish dozens of buildings in
   a second.

## Measurements

- **The music**, notes a minute (oscillators, from a fake context over 60 s): Cold Ground 74,
  Thin Light 93, Pressure 104, First Water 124, Green 132, Breath 143, Living World 151; nodes a
  minute 219 to 415. Each is short-lived, stopped at its scheduled end and let go.
- **The wind** by pressure: 6 mbar (Mars starts at 6.21) level 0.18 at 1,500 Hz; 20 mbar 0.31,
  1,236 Hz; 100 mbar 0.49, 884 Hz; 300 mbar 0.62, 644 Hz; 600 mbar 0.69, 492 Hz; 1,000 mbar 0.75,
  380 Hz. From orbit, half that.
- **What it costs, on the Example planet** (42 settlements, 240,815 buildings, built in 29.6 s):
  - the cue watch's first look 1.33 ms; a look after a substep 0.113 ms median, 0.838 ms worst
    (40 substeps; nothing finished - the example builds nothing);
  - the city ear on the largest metropolis (41,074 buildings, 928 tiles, 410 train cars), every
    100 ms over 5 minutes at 1x, the ear on its railway: 1.76 ms median, 3.26 ms at the 99th
    percentile, 7.83 ms worst - with the train cars worked out afresh each look, where the browser's
    drawing has already worked them out for the frame. 20 trains heard in the 5 minutes; machinery
    0.96.
  - On the vehicles harness's metropolis (2,296 buildings) the ear costs 0.10 ms median.
- **The bundle**: 623.88 kB JS, 210.56 kB gzip (Batch 34: 602.24 and 203.45; +21.6 and +7.1), past
  Vite's 500 kB warning as recorded since Batch 31; 49.29 kB CSS (+0.62).
- **Verification**: typecheck green; `npx vitest run --maxWorkers=2 --minWorkers=1`: 120 files,
  1,428 tests, all passed (454 s; the Known-red city-opening test passed this run); `build:web` and
  `build` green; the built page, its script and its styles served and fetched over HTTP (the script
  holds "Master volume" and "Cold ground", the styles the sound panel).
- **The tests**: `src/web/sound.test.ts` 24 tests, `src/web/sound-gate.test.ts` 10 (one opening a
  city and finishing a building at 1000x through the assembled game, about 6 s).

## The injection run

| # | Where | Fault | Caught by |
|---|---|---|---|
| 1 | engine | music unlocks the context | "makes no AudioContext and plays nothing until a gesture, and drops what was asked rather t"; "move with their sliders on the Settings screen, are heard at once, and survive a reload" (and 2 more) |
| 2 | engine | an effect before a gesture makes the context | "makes no AudioContext and plays nothing until a gesture, and drops what was asked rather t"; "the title's music waits for the first gesture, then starts, and every button ticks" |
| 3 | engine | only the first gesture listened for | "is let start by a keydown"; "is let start by a touchend" |
| 4 | engine | no Web Audio tried at every click | "stays silent, without an error, in a browser with no Web Audio" |
| 5 | engine | mute ignored | "set each channel's gain and the master, and mute silences everything" |
| 6 | engine | volumes not applied when sound starts | "set each channel's gain and the master, and mute silences everything" |
| 7 | engine | every effect on the effects channel | "each makes its sound on its channel, from now, with every ramp a sound one" |
| 8 | engine | what was asked before the gesture not started | "makes no AudioContext and plays nothing until a gesture, and drops what was asked rather t"; "the title's music waits for the first gesture, then starts, and every button ticks" (and 1 more) |
| 9 | engine | the context never resumed | "makes no AudioContext and plays nothing until a gesture, and drops what was asked rather t" |
| 10 | effects | an envelope ramps to 0 (the browser refuses) | "makes no AudioContext and plays nothing until a gesture, and drops what was asked rather t"; "each makes its sound on its channel, from now, with every ramp a sound one" (and 8 more) |
| 11 | effects | no panning | "each makes its sound on its channel, from now, with every ramp a sound one" |
| 12 | effects | the effect's loudness ignored | "each makes its sound on its channel, from now, with every ramp a sound one" |
| 13 | effects | an alert routed to the effects channel | "each makes its sound on its channel, from now, with every ramp a sound one" |
| 14 | effects | a train makes no sound | "each makes its sound on its channel, from now, with every ramp a sound one" |
| 15 | music | a change of piece cuts the old one | "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " |
| 16 | music | the old piece keeps writing after its fade | "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " |
| 17 | music | the new piece starts at full | "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " |
| 18 | music | the tune a semitone out of its mode | "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " |
| 19 | music | the piece one phase late | "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " |
| 20 | music | the same piece started again | "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " |
| 21 | music | Green darker than First water | "is colder and sparser at the start, warmer and fuller as the planet greens" |
| 22 | music | a faded piece never let go | "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " |
| 23 | ambience | the wind higher in thicker air | "the wind by pressure, louder and deeper in thicker air, harder in a storm" |
| 24 | ambience | a storm adds no wind | "the wind by pressure, louder and deeper in thicker air, harder in a storm" |
| 25 | ambience | rain on a frozen world | "rain only with clouds over liquid water above freezing; the sea only with a sea, louder at" |
| 26 | ambience | the sea as loud far from it | "rain only with clouds over liquid water above freezing; the sea only with a sea, louder at" |
| 27 | ambience | machinery from what does not run | "the machinery by what runs near the camera" |
| 28 | ambience | a worksite hums | "the machinery by what runs near the camera" |
| 29 | ambience | machinery heard the same from anywhere | "the machinery by what runs near the camera" |
| 30 | ambience | a bed's level not scaled to its loudness | "through the director and the engine: the planet's beds from the world, the machinery from " |
| 31 | cues | a worksite taken down heard as finished | "hears two buildings finished in one look twice, and takes its bearings on a world already " |
| 32 | cues | an upgrade never heard | "hears a building finished, a building raised and a rocket up, each once, where it happened"; "leaves the world the same to the bit with sound on and off, through a run it heard" |
| 33 | cues | a rocket heard at every look while away | "hears a building finished, a building raised and a rocket up, each once, where it happened"; "hears a rocket that landed and went up again between two looks" (and 1 more) |
| 34 | cues | a rocket away again between looks not heard | "hears a rocket that landed and went up again between two looks" |
| 35 | cues | the grid's numbers, not the ground's | **missed**: the claim test checked what was heard, not when - the false finish came at the claim itself. The test now checks the claim's own look; caught as 73 and 74 |
| 36 | cues | no bearings on a world under way | "through the director and the engine: the planet's beds from the world, the machinery from " |
| 37 | cues | a train heard again wavering at the edge | "hears a train once as it comes near, not again until it has gone and come back" |
| 38 | cues | no bearings in a new city | "hears a train once as it comes near, not again until it has gone and come back" |
| 39 | director | the music by the start, not the phase reached | "plays nothing of what the world does while the example planet shows, but keeps its music a"; "plays only its piece's notes, crossfades to the next phase's over the crossfade and never " (and 1 more) |
| 40 | director | no cap on alerts in a look | "plays at most a few of one effect in a look, spaced, and hears every event up to that" |
| 41 | director | urgent and notice swapped | "plays at most a few of one effect in a look, spaced, and hears every event up to that" |
| 42 | director | a record alert sounds | "plays a place where it was set down, an alert for what interrupts, and the objective's chi" |
| 43 | director | orbit heard as from the ground | "through the director and the engine: the planet's beds from the world, the machinery from " |
| 44 | director | machinery heard from orbit | **changes nothing as written**: leaving for orbit already sets the machinery to 0. Both guards removed together (75) are caught, once the test leaves for orbit from beside running machines |
| 45 | director | left and right swapped | "is louder near the camera, and left or right as on screen" |
| 46 | director | distance ignored | "is louder near the camera, and left or right as on screen" |
| 47 | director | another city's placed as if here | "hears another city's from afar, as from orbit" |
| 48 | director | the ear worked out every frame | "plays a train for each that comes near the camera in the city view, placed where it is" |
| 49 | director | the example's happenings heard | "plays nothing of what the world does while the example planet shows, but keeps its music a" |
| 50 | director | the director writes the world | "leaves the world the same to the bit with sound on and off, through a run it heard" |
| 51 | director | the milestone's chime for an objective | "plays a place where it was set down, an alert for what interrupts, and the objective's chi"; "chimes for an objective done, with its card" |
| 52 | director | trains not looked for | "plays a train for each that comes near the camera in the city view, placed where it is"; "leaves the world the same to the bit with sound on and off, through a run it heard" |
| 53 | settings | a volume over 1 accepted | "read only what is sound in a record: anything missing, out of range or of the wrong kind i" |
| 54 | settings | the rest of the record dropped | "are kept per player beside the worlds, and keep what this does not know of the record" |
| 55 | settings | a record that will not load stops the game | **not a fault**: the edit left a stray `catch`, and the file did not load. Redone as 76, caught |
| 56 | settings | a failed write left rejected | "play on the defaults when the record cannot be read or written" |
| 57 | panel | a slider's value read wrong | "move with their sliders on the Settings screen, are heard at once, and survive a reload"; "open in a world's menu too, the same settings" |
| 58 | panel | mute ignored | "move with their sliders on the Settings screen, are heard at once, and survive a reload" |
| 59 | title | settings not read at the start | "move with their sliders on the Settings screen, are heard at once, and survive a reload" |
| 60 | title | settings not written | "move with their sliders on the Settings screen, are heard at once, and survive a reload" |
| 61 | title | the title silent | "the title's music waits for the first gesture, then starts, and every button ticks" |
| 62 | title | no tick for a button | "the title's music waits for the first gesture, then starts, and every button ticks" |
| 63 | title | the title starts sound itself | "move with their sliders on the Settings screen, are heard at once, and survive a reload"; "the title's music waits for the first gesture, then starts, and every button ticks" |
| 64 | title | the menu's settings not shown | "open in a world's menu too, the same settings" |
| 65 | title | the game given no sound | **missed**: no test opened a world from the title with the title's engine. A new test does; caught as 77 |
| 66 | game | no readout for sound | "is silent until a gesture, then plays the phase's music, the wind, the city's machinery, a" |
| 67 | game | the city never heard | "is silent until a gesture, then plays the phase's music, the wind, the city's machinery, a" |
| 68 | game | a building placed is silent | "is silent until a gesture, then plays the phase's music, the wind, the city's machinery, a" |
| 69 | game | a refused placement sounds | **missed**: the test chose the card again before the second click, which put it down, so the click selected rather than placed. It now keeps the card and checks the refusal's words; caught as 78 |
| 70 | game | alerts silent | "is silent until a gesture, then plays the phase's music, the wind, the city's machinery, a" |
| 71 | game | the milestone card silent | "chimes for an objective done, with its card" |
| 72 | game | the music never written | **missed - and a defect**: nothing wrote the music on the title screen, so the title played half a second of notes and stopped. The engine keeps its own clock now and the game's call is gone; the clock's faults are 79 and 80 |
| 73 | cues | the grid's numbers, not the ground's (again) | "hears no finish when land claimed west renumbers the ground under a worksite" |
| 74 | cues | the grid's numbers throughout (coherent: the keys and the lookup) | "hears no finish when land claimed west renumbers the ground under a worksite" |
| 75 | director | machinery heard from orbit (coherent: kept on leaving, and not gated) | "through the director and the engine: the planet's beds from the world, the machinery from " |
| 76 | settings | a record that will not load stops the game (the whole guard) | "play on the defaults when the record cannot be read or written" |
| 77 | title | the game given no sound (again) | "are the session's in a world opened from the title: its music follows that world's phase" |
| 78 | game | a refused placement sounds (again) | "is silent until a gesture, then plays the phase's music, the wind, the city's machinery, a" |
| 79 | engine | the engine's clock never started | "the title's music waits for the first gesture, then starts, plays on, and every button tic" |
| 80 | engine | the clock started before a gesture | "is silent until a gesture, then plays the phase's music, the wind, the city's machinery, a" |


## What changed from the plan

- **A master volume and mute** beside the four channel volumes.
- **The title's Settings screen gained its sound section** ahead of Batch 36, and the world menu's
  **Settings** opens the same sliders; graphics and controls still say they come later.
- **A tick for every button** on the interface channel ("every action answered").
- **Rain is derived** from clouds, temperature and open water: the simulation has no rain.

## Open

- **A rocket coming home is silent**; only its lift-off is heard. A landing could be a crossing
  like the launch.
- **A train dwelling at a station near the camera** is heard as it comes, not as it leaves.
- **The settings record** is in the store's index beside the worlds list; Batch 36 may move all
  the player's settings to a store of their own (its deliverable).
- **No listening test in a real browser**: the unattended run cannot hear. The levels (peaks of
  0.32 wind, 0.22 machinery, 0.2 rain, 0.28 sea; effects at 0.05-0.9 before the channel) were set
  by reasoning, not by ear. Batch 40's polish pass should listen.
- **Many audio nodes** are made and let go: each note and effect is a few short-lived nodes, left
  to the browser's collector once stopped (measured above).
