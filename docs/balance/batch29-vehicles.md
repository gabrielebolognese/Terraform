# Batch 29: vehicles that use the city - rovers on the ground, trains on the line

"The trains, the rovers: they skin through buildings." Every rover now drives a route round the city,
and every train rides its rails car by car. Each is drawn behind whatever stands in front of it.

## What went wrong, and what it cost

### The plan blamed the trains' geometry; the fault was the order they were drawn in

The plan listed three suspects for the trains: turns, car length and draw order. Measured on the
last commit, over ten minutes of a metropolis's trains (268,800 car-frames), a car's footprint
overlapped a building 17 times. All 17 were the lead car's nose, 0.06 tiles into a station or a
building at the end of a line.

What a player sees was the draw order:
- The browser draws each chunk's still picture, then the chunk's moving layer on top of it.
- A train passing behind a tower in the same chunk was therefore painted over the tower.
- 9,273 of 53,760 car-frames (17%) were behind a building of their own 8-tile chunk.

Rovers were plainly through buildings: on the straight line from the garage, 426 of 1,200 frames
(35.5%) were inside one.

### With routes on, the scripted player walled in its own garage after 13 buildings

The scripted player puts each building on the nearest free tile, in a spiral round the
headquarters. Its first 13 buildings closed every way out of the garage door. From then on,
every placement and upgrade was refused with "no rover can get there". The first upgrade and the
city of 1,000 never came (measured).

A player would do the same. There are now three rules, all only with routes on:
- **Walling in is refused.** A building that would leave a rover no way to a building it reaches
  now is refused with the count ("it would wall in 2 buildings ... leave a way through").
  - The first version only checked the ground the new building cuts off, so it missed a building
    whose only free side was the new footprint itself. The test written for walling in caught it.
- **The garage door and the tile in front of it stay clear.**
- **Nothing goes up on a tile a rover is driving over** until it has passed.

The check costs little:
- It looks first at whether the tiles round the new building still reach each other.
- Only when they don't does it work out each piece, and check the buildings beside the pieces
  that are cut off.

### A rover 0.3 tiles out from its way clipped a building at a diagonal-to-square turn

Rovers drive on the right of their way, so two going opposite ways pass. At 0.3 tiles out, where a
diagonal stretch turns square, the nose reached 0.012 tiles past the corner tile, into a building
beside it: 2 of the scripted day's 8,610 rover-frames.

The lane now has two bounds:
- at least 0.28, to clear a corridor's walls (0.17 from its middle, plus the rover's own 0.11);
- at most 0.288, to keep the nose on its tile at that turn.

It is 0.285. Sharp turns (over about 114°) are cut across instead of mitred.

### Trains each way on one track ran through each other; sizing the cars took three tries

Each way of a line is a loop of its own, so on a single track trains coming the other way passed
straight through each other. Each way now has its own track, drawn as a double track. On bends the
first sizes did not fit:
- Cars 0.88 long on tracks 0.15 out touched on every bend where two trains passed.
- Cars 0.64 long on tracks 0.2 out (found against a single bend) touched on every S-bend.

The final sizes come from trying every car against every car passing it, over the four shapes a
line of tiles takes: a bend, an S, a staircase and a U. The longest that keep passing cars apart
and every car on its tiles: **0.56 long, 0.22 wide, tracks 0.22 out**. Trains have five cars, so a
train keeps about its old length. At a line's end the two tracks come together over 1.5 tiles,
where the train runs back.

Trains of *different* lines still cross through each other at junctions. There are no signals, and
it is not in the exit gate. Recorded below.

### Redrawing what covers a vehicle: four versions to get it right at the old frame time

The moving layer has to redraw, over each vehicle, whatever stands in front of it. Four versions,
measured in the depth test's region of the metropolis and in the frame below (the fourth found by
the injections, below):

| Version | Pixels differing from the whole scene | Shapes a frame, medium |
|---|---|---|
| Moving parts only (before) | the cars drawn over the tower | 3,489 |
| Covering buildings and ground drawn again, whole | 484 (a ground tile drawn again over the dome in front of it) | - |
| ... and everything overlapping what was drawn again, in turn | 0 | 10,783 |
| Drawn again only inside the vehicle's own patch (clipped to a box) | 0 where the test looked; 786 where a dome's glass covers a train (the glass blended twice) | 5,467 |
| Drawn again only inside the vehicle's own outlines | **0** at every moment the old drawing is wrong | the same shapes |

The box needed a clip box on shapes: the software rasteriser restricts its rows and columns to it,
and the browser's canvas clips each run of shapes that share one. Outside a vehicle's patch the
still picture is already right, so nothing beyond the patch needs drawing again. But inside the
box and outside the vehicle, the picture already had the glass in it. Only inside the vehicle's
outlines, where the vehicle has just been drawn, is drawing again exact.

### The first metropolis view took 3 seconds, and the next metropolis's opening got 3x slower

Route searching hit several separate costs:

- **The search heap.** It swapped through destructured arrays: twelve routes in a metropolis took
  0.9 s. A typed-array heap, sifted with a hole and reused between searches, brought it down. A
  metropolis route now takes 0.38 ms at the median and 3.8 ms at most.
- **The first view.** Old jobs have no route, so the view finds one to draw them on. The example's
  twelve rovers made a metropolis's first view take 2.8-3.5 s, against 0.26 s before. Now:
  - the example builds its rovers with their routes;
  - a world's old jobs are routed during `prepareCity`, a job a step.

  The first view is back to 0.2-0.36 s.
- **The next metropolis's opening.** After routes had been found for one metropolis, the next one's
  rock step took 600-990 ms, against 107-350 ms before, with that step's code unchanged. Run alone
  it varied, so it was collector and compiler state, not work. `rocksOf` rebuilt half a million
  tile keys into a Set and made an object for each, every time a metropolis opened. It now marks
  covered tiles straight into its copy. The result is identical on all 42 example settlements
  (5.6 million tiles), and the step takes 51-235 ms, faster than before this batch. The opening test
  (known red) passes alone two runs in three, and once took 454 ms, inside the range already recorded.
- **The frame's chunk loop.** The browser's chunked frame tests every one of a metropolis's 13,456
  chunks for visibility each frame. With the module grown, that loop ran 10x slower (JIT), and a
  frame took 27-30 ms against 8-9 ms. `cityChunksInView` works out the city's reach once and tests
  each chunk with arithmetic alone.

### A closure inside the step test cost 70 seconds of the pacing run

`canStep` built a small closure on every call. Under tsx, each one costs a property definition. Two
hours of scripted play took 78.9 s; without the closure, 5.8 s.

### The routes cost the scripted city an eighth of its growth at the Standard pace

A* returns the quickest way: checked against a plain Dijkstra on all 118 buildings of the scripted
city, they agree to 1.4e-14. But that city packs its buildings edge to edge with 13 tiles of
corridor, so a rover's way round them averages 50 tiles against 12 in a straight line. At the
Standard pace rovers are what the city waits for (its builds are long), so it grows more slowly.
Every target still holds (table below).

Batch 28's guard that Standard's cities keep within a fifth of Classic's now measures the paces as
Batch 28 made them, without routes; its subject is the cities' clock. With routes the ratio is 1.22.
The routes' own cost is a test of its own.

### The injection runner said the first fault was missed, and had tested the wrong line

The first injection (a route cutting a corner past two buildings) was "missed". It had removed the
site check, not the corner rule, which is the line before it. Corrected, it was still missed: no
route in any scenario squeezed between buildings touching at a corner, and none passed hard rock.
A test now builds a staircase of depots, corner to corner, across the way, and routes past the rock
clusters of rough ground.

The runner also crashed on vitest's output in the Windows code page after the first fault. Like
Batch 27's, it now counts a fault caught only if vitest printed its summary with a failure, and
runs two no-fault baselines first.

### The first session ran out before the injections; they found the depth fix wrong behind glass

The session that built this batch was cut off after its main commit. It left the rail bend
drawing, a test and this note uncommitted, the injections not run, and 23 scratch scripts in
`src/harness/`. The next session (unattended) moved the scratch to the temp directory, kept the
rest, and ran 36 faults. Five were missed. Each miss is a gap in the tests, and one was a defect:

- **The depth test could not see the depth fix fail.** It chose its moment by geometry: a car
  with a tall building of its own chunk in front of it. At the moment it chose, the building did
  not cover the car on screen. So removing the redraw over vehicles altogether still gave 0
  pixels differing.
  - Chosen instead by the picture, at moments where the old drawing really is wrong, the fix was
    wrong too. The building was a dome, and its glass is see-through. Drawn again inside the
    train's box over a picture that already had the glass in it, the glass was blended twice:
    786 pixels at medium and 735 at high, against 104 and 131 for the old drawing. It was
    *worse than doing nothing*. In the browser, a darker rectangle of glass would have followed
    every train passing behind a dome.
  - **The fix:** what is drawn again over a vehicle is clipped to the vehicle's own outlines, not
    to its box. Inside them the vehicle has just been drawn, so drawing what stands in front of
    it again is exactly the whole scene. Outside them nothing changes.
  - This needed a new `clipTo` on a shape: the software rasteriser fills a mask of the outlines,
    and the browser clips its canvas to the outlines. The browser traces each outline the same way
    round, so that under the canvas's non-zero rule two overlapping outlines never cut a hole in
    each other.
  - The test now checks every moment where the old drawing is wrong: 6 of 24 at medium, 9 at
    high. All agree with the whole scene to the pixel.
- **Drawing a vehicle with the wrong tile was invisible** to every test, because the whole scene
  and the chunked drawing share that rule. A new test checks that a train on open ground is drawn
  whole: 0 of 55,595 car pixels wrong, and 4,320 with the tile furthest from the viewer.
- **Refusing a rock or ground to level that no rover can reach was untested.** The test called
  "a building, an upgrade, a rock" never sent a rover to a rock. A test now walls in three rocks
  on rough ground.
- **One fault no test can catch, because nothing changes:** the v14 to v15 migration only stamps
  the version, and nothing reads it after.
  - Letting rovers drive up steep ground was put here too, as changing nothing: every steep tile
    was said to carry a crag (0 of 15 rough sites without one). That was wrong. Levelling makes
    steep tiles with no crag on them, and the first review found it (below).
- **The browser's own fill of clipped shapes had no test.** A fake canvas now works out the
  canvas's clip rules for itself, and a test checks that what is drawn again is filled inside the
  box or the outlines and nowhere else.

### The first review: the steep-ground rule was called untestable, and three tests could not fail

The first review rejected the batch. It cost a review round and a fix session. Its findings:

- **"Every steep tile carries a crag" was wrong.**
  - Crags are laid from nature's ground alone. But levelling a tile judges the tiles round it
    again, because their shared corners moved, and some turn steep with no crag on them. There,
    only the steepness check keeps a rover off.
  - The claim was measured on 15 rough sites where nothing had been levelled. There it holds.
  - The review measured it on the drive tests' rough ground: levelling 60 tiles made such tiles,
    and with the check removed 445 of 1,344 routes to the tiles beside them drove up steep ground.
  - The test written for it levels a row of seven tiles six tiles south of the garage, a rover at
    a time, as a player would. That leaves 14 steep tiles with no crag. 164 ways run to the tiles
    round them. With steep ground driveable, 97 of them drive up it; as built, none.
  - Its first try levelled the tiles nearest the garage, on the landing zone. That ground is flat
    already, so levelling it turned nothing steep, and the test found nothing.
- **Seven tests had never been broken by a fault.** Each was broken once, and three of them could
  not see the fault they exist for:
  - *The same route every time it is asked.* It asked for one route, once on the city and once on
    a copy. With ties in the search broken at random it still passed: exact ties are rare, and
    that route had none that mattered. It now asks for 81 routes round the garage, on flat ground
    and on rough, in one order, again, and in the other order on a copy. With random ties, 7 of
    the 81 flat routes and 3 of the 81 rough come out different.
  - *Two rovers on one stretch kept apart (the scripted day).* It passed with the wait behind
    another taken out. The scripted player sends its rovers out at different moments, so no two
    ever follow each other there (0 times, measured), and there was nothing to see. It now also
    runs over the metropolis with every rover out of one garage at once. There a rover is close
    behind another 38 times, and without the wait 23 frames have two touching.
  - *The chunked drawing is the whole scene and nothing else.* It bounded what is drawn again at
    1% of the whole scene: 12,690 shapes at high detail. Drawing again everything after a vehicle
    in its chunk, whether it overlaps the vehicle or not, doubled the count and still passed:
    902 to 1,885 at high, 233 to 448 at medium. The bound is now the measured count plus a quarter.
- **And a fault no test caught at all.** Probing the spacing test, rovers driven down the middle
  of their way (no lane) passed every test. Two rovers meeting then wait for each other instead
  of passing: the wait does not ask which way the other is going. A new test sends a rover out
  and home along one way, at the moments the two are at the same point of it. It checks that the
  one coming home is drawn where it would be alone. Down the middle, it is held back 0.45 tiles.

## What was built

| Piece | What it does |
|---|---|
| `src/sim/micro/drive.ts` | The route: A* over the tiles from the garage door to a tile beside the job, on corridors (`ROVER_CORRIDOR_SPEEDUP` 2x quicker) and open ground the city holds. Never under a building, over hard rock or up steep ground; no corner cut past a building. Deterministic, kept per ground and site. Also walling in, the garage apron, the tiles being driven. |
| `ROVER_ROUTES_ENABLED` | 0 by default and in every world made before; every new world 1 (`NEW_WORLD_OVERRIDES`). The route is found once, kept with the job (save v15), and sets the drive: twice the route's time at the tuned speeds, plus the work. A job no route reaches is refused, with the reason. A queued build walled in keeps its place. |
| The view | Each rover job carries its path and how far through the drive each point is. A job without a route (an old save's, Batch 21-28's) is drawn on a route found for it, in the time it set out with. |
| `src/render/vehicles.ts` | Rovers follow their path on the right of the way, face where they drive, keep a gap behind another, work with the arm at their site. Trains ride the curve car by car on their bogies, a track each way, slow for bends and into stops, stand 4 s at platforms and at line ends, then run back with the last car leading. Freight on lines past no station, maglevs on the rest. |
| Depth | Each vehicle is drawn with the nearest tile it is over. The moving layer draws again everything later that overlaps a vehicle, clipped to the vehicle's own outlines. Clip boxes and outlines (`clip`, `clipTo`) on `Shape`, in both rasterisers. |
| Rails | A double track, laid round a bend's quarter circle. |
| `checkPlacement` | The placement preview: the same rules as placing, with reachability in place of the route search. |
| `harness/vehicles.ts` | The scripted day in the reference city (two hours of the scripted player, a railway laid round it) and a metropolis with every rover out. |

## Measurements

**The exit gate:**

| Check | Reference city (2 h, every substep, 4 moments each) | Metropolis |
|---|---|---|
| Rover-frames inside a building | 0 of 8,610 | 0 of 3,446 |
| ... on the straight line (vacuity) | 7,379 of 7,578 | 2,549 of 3,192 |
| Car-frames inside a building or off the rails | 0 of 48,000 | 0 of 330,000 |
| ... Batch 28's trains (vacuity) | | 17 |
| Driving rovers touching | 0 (14 within 1.5 tiles) | 0 (142 within 1.5 tiles) |
| Trains of one line passing, touching | | 0, away from junctions |

- **Trip time:** every job's drive equals its route's time worked out tile by tile from the route,
  to 1e-12. A corridor shortens it.
- **Stations:** every stop on the way through is at a platform and lasts 3.95 s, sampled every
  0.05 s against a 4 s dwell. There were 88 stops in four minutes.
- **Depth:** the browser's chunked drawing equals the whole scene, 0 pixels differing, at medium and
  high, at every moment a building of a car's own chunk covers it on screen (6 at medium, 9 at
  high, the most 104 and 131 pixels covered). A train on open ground is drawn whole: 0 of 55,595
  pixels wrong.
- **Rails:** a car's middle is 0.028 tiles at most from its drawn rails, round bends too (0.079
  with a bend drawn as two straight halves).

**Frame time,** a screen's worth of the metropolis where its trains are busiest, through
`ChunkedCity` (shape generation; canvas fills not included). Same script before and after, from an
esbuild bundle:

| Detail | Next frame, median (p90) | Shapes a frame |
|---|---|---|
| High, 32 tiles across | 8.3-9.4 ms (12.5-16.0) -> 7.9 ms (11.0-11.6) | 3,845 -> 4,977 |
| Medium, 64 tiles across | 4.0-4.6 ms (6.2-8.4) -> 4.9-5.0 ms (6.5-6.9) | 3,489 -> 5,467 |

The extra shapes are the clipped redraws, five cars a train instead of four, and freight wagons
with their containers.

The redraw clipped to the vehicles' outlines (found by the injections, below) was measured
against the box-clipped version, with the same script and bundle. Another project's tests had
three cores busy on the machine throughout, so the times are higher and noisy. Six runs of each,
interleaved:

| Detail | Box clip, median of six medians (best) | Outline clip | Shapes a frame |
|---|---|---|---|
| High | 11.2 ms (7.9) | 11.0 ms (9.1) | 4,977 -> 4,976 |
| Medium | 6.3 ms (5.0) | 7.3 ms (5.5) | 5,474 -> 5,474 |

About 1 ms more at medium, for gathering each vehicle's outlines. The first version copied every
outline on each merge of two patches and allocated a box for every vertex. Under a heavier load it
measured 8.7 ms against the box's 7.9 ms: no worse than this, within the noise. It was rewritten
anyway. The browser's own cost, a canvas clipped to many outlines rather than one rectangle, cannot
be timed in Node. It is left for Batch 40's profiling in the browser.

**Route search:** a metropolis route takes 0.38 ms at the median and 3.8 ms at most. The first view
of a metropolis takes 0.2-0.36 s, as before.

**Pacing:** the scripted playthrough, the same script, before (Batch 28) and after (a new world,
routes on):

| Moment | Classic | Standard | Target |
|---|---|---|---|
| First building stands | 8 s -> 8 s | 33 s -> 33 s | under 1 min - met |
| First upgrade done | 19.3 -> 19.9 min | 19.9 -> 21.5 min | 4-8 min - missed, as in Batch 28 |
| City of 1,000 | 1.57 -> 1.66 h | 1.79 -> 2.02 h | 1-3 h - met |
| Phase 1 | 8 s | 8 s | under 15 min - met |
| Phase 2 | 12.4 min | 1.65 h | 1-3 h - met |

With routes off, every number is Batch 28's to the second.

The golden run, the Batch 3 score and the golden frames are unchanged. The default tuning has
routes off and no headquarters, and the reference city has no rails or rovers. The example planet
draws the same random numbers as before.

## Injections

48 faults, one at a time, each against the tests meant to catch it: 41 in the batch's own two
passes, after two no-fault baselines that pass, and 7 more in the first review's round. The runner
restores each file and checks it byte for byte before the next fault.

The first pass ran 36: **31 caught, 5 missed**.
- Three misses were gaps, closed with new tests: a rock no rover reaches, the redraw over a
  vehicle, and the tile a vehicle is drawn with. The second was the depth defect described above.
- Two misses were taken to change nothing a test can see: steep ground, said always to carry a
  crag, and the v15 migration, which only stamps the version. The first was wrong (the first
  review, above).

The second pass re-ran the three gaps against their new tests and added five faults in the outline
clip and in levelling. All were caught, except that ignoring the clip box is now also invisible:
the outlines decide which pixels are filled, and the box only bounds the work. That pass counted
38 of 41 caught and 3 changing no behaviour. One of the three, steep ground, was wrong.

The first review's round ran 12 faults one at a time, against the tests the review named. It ran
after a no-fault baseline of the three test files (41 tests passing), and the tree was checked
clean after each fault:
- 5 re-runs: steep ground, the wait behind another, the rover's lane 0.3 out, cars 0.88 long, and
  nothing drawn again over a vehicle;
- 7 new faults.

Four were missed, and each now has a test that catches it: steep ground, random ties, the wait
behind another on the scripted day, and drawing everything again. A fifth, rovers down the middle
of the way, was missed by every test (above).

**Final: 46 of 48 caught; the other 2 change no behaviour** (the v15 version stamp, and the clip
box now that the outlines decide).

| Fault | Caught by |
|---|---|
| The corner rule gone (a diagonal step between two buildings) | goes round a building; stays on open ground (rough city); never squeezes between two buildings |
| Hard rock driveable | never squeezes ... nor crosses hard rock |
| Steep ground driveable | first said to change nothing (every steep tile carrying a crag); review 1 found levelling makes steep tiles without one. Now: never drives up ground too steep, where levelling has left steep ground with no crag (97 of 164 ways up it) |
| Buildings not in the way | 7 tests: the route, refusals, walling in, the queue |
| A corridor no quicker | sets the trip; takes the corridors first |
| The trip leaves out the drive through the headquarters | sets the trip |
| A build's trip one way only | sets the trip; a world made before routes |
| Routes ignore `ROVER_ROUTES_ENABLED` | is refused (routes off places it); a world made before routes |
| A building no rover reaches is placed | is refused, with the reason; the placement preview |
| An upgrade no rover reaches is accepted | is refused, with the reason |
| A rock no rover reaches is sent for | missed, then: is refused - a rock, and ground to level |
| Levelling ground no rover reaches is accepted | is refused - a rock, and ground to level |
| Walling in not refused | refuses a building that would wall others in; never lets the scripted player wall in its garage |
| The garage door not kept clear | keeps the garage door clear |
| A building goes up on a rover's way | keeps a building off the way a rover is driving |
| A walled-in queued build loses its place | keeps its place in the queue |
| Ties in the route search broken at random | missed, then: the same every time it is asked, and on a copy (7 of 81 flat routes and 3 of 81 rough differ) |
| Rovers sent out of the queue once a call, not every substep | chunk-independent |
| The preview skips the reachability check | the placement preview |
| A route left behind when a claim moves the frame | move with the land |
| The save drops the route | survive the save exactly |
| No v14 -> v15 migration | *no behaviour: it only stamps the version* |
| New worlds without routes | the paces' tuning; the routes' cost on the scripted playthrough |
| An old save's rover drawn the straight line | a world made before routes: drawn round the buildings |
| A rover's lane 0.3 out | never has a rover inside a building (the scripted day, and the metropolis); faces, works, waits |
| Rovers driving down the middle of the way (no lane) | missed by every test, then: passes one coming the other way (held back 0.45 tiles) |
| A rover stopping 0.6 past the middle of its tile, into its site | never has a rover inside a building (the scripted day, the metropolis); a world made before routes |
| A rover facing across its way | faces where it drives |
| Rovers on one stretch drive through each other | waits behind another; keeps two rovers on one stretch apart - missed on the scripted day (no two follow each other there), then caught in the metropolis (23 frames touching) |
| The arm still at work | works at its site, the arm hammering |
| No dwell at a stop | stops each passing train at a platform for the tuned dwell |
| One track for both ways | two trains passing never touch |
| Cars 0.88 long (Batch 28's) | two trains passing never touch (the two tests of cars inside a building or off their rails do not see it: the cars stay on their rails) |
| Each way's track 0.45 out, not 0.22 | never has a train car inside a building or off its rails, the scripted day's railway and the metropolis (both as off the rails) |
| Freight on every line | maglevs past a station, freight on the rest |
| No slowing for bends | trains run ... and move along it (a lap longer than at full speed) |
| A bend's rails drawn as two straight halves | ride on the rails drawn (0.079 against 0.05) |
| Nothing drawn again over a vehicle | missed, then: the chunked drawing as the whole scene (104 and 131 pixels); the scene in chunks, whole and nothing else (its vacuity check, high and medium) |
| Vehicles left out of the moving layer | the scene in chunks, whole and nothing else (231 shapes missing, high and medium) |
| Everything after a vehicle in its chunk drawn again, overlapping it or not | missed at a bound of 1%, then: the scene in chunks, whole and nothing else (1,885 drawn again against at most 1,128 at high; 448 against 292 at medium) |
| The redraw clipped to the box alone | the chunked drawing as the whole scene (786 and 735) |
| The rasteriser ignores the outlines | the chunked drawing as the whole scene (786 and 735) |
| The rasteriser ignores the clip box | *no behaviour now: the outlines decide (caught in the first pass, before them)* |
| A vehicle drawn with the tile furthest from the viewer | missed, then: drawn whole on open ground (4,320 pixels) |
| The browser's clip not restored between patches | the browser's fill: inside that box alone |
| The browser fills a patch's run unclipped | the browser's fill: inside that box alone |
| The browser traces outlines as they run | the browser's fill: inside any one of them ("inside both") |
| The browser clips outlines to their box | the browser's fill: nowhere else in its box |

## Open

- **Trains of different lines cross through each other at junctions.** There are no signals: trains
  are drawn from each loop's own timetable. Signalling would need trains simulated, not drawn.
- **A rover passing one at work** beside its site can drive through it. Only rovers driving the
  same stretch keep apart.
- **A dense city of rovers' detours.** In a city packed edge to edge, rovers drive 4x the straight
  line. A player who leaves streets, or lays corridors (twice as quick), fares much better. The
  first-hour guidance (Batch 30) could teach it.
- **Old worlds keep the straight-line times** (their recorded tuning), drawn on a route. Turning
  routes on for them would be a migration of the player's choosing.
- **The browser's cost of clipping to outlines** (a canvas clip path of many outlines, where it
  was one rectangle) cannot be timed in Node. For Batch 40's profiling in the browser.
- **The metropolis opening timing test** stays red on this machine, as recorded. It is no worse
  after this batch, once `rocksOf` was rewritten.
- **The first upgrade at 4-8 minutes** (Batch 28's miss) is unchanged in kind: 21.5 min.
- **Steep ground with no crag, and a message that names one.** Found with the first review's
  finding: levelling a tile can leave the tiles beside it too steep, with no crag on them. Laying a
  corridor, cable or railway there is refused with "send a rover to break the crag", and sending
  one is refused with "there is no rock there to break". Levelling that tile does make it no
  longer steep (checked). The message predates this batch. For Batch 40, or the next batch that
  touches levelling.
- **Batch 28's open item, rover trips along the real route,** is closed.
