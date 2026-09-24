# Batch 21 — Micro: travel between orbit and a city

Micro doc §12 step 5: *"Wire the travel transition (orbit marker -> load city scene -> back),
keeping macro ticking underneath."*

**What was built:**
- Clickable settlement markers with a confirm step ("Travel down to City 1? Go down / Cancel").
- A camera move on the way down: the globe turns the site to face you and zooms in, then the city
  view loads.
- The reverse on the way back: save, unload, then the camera pulls back to where you left it.
- City to city goes through orbit, never a direct warp.
- One travel state machine (`travel.ts`), a journey that applies it to the page (`journey.ts`), and
  a `WorldDriver` (`driver.ts`): the one piece of the frame loop that advances the world.

**Exit gate met, and checked by injection:**
- Two worlds, driven by the same timestamps: one stays in orbit, the other goes down to a city,
  hops to the outpost through orbit, and comes back. They end exactly equal (`toEqual`), with a
  real `CityScreen` drawing every city visited.
- No city scene is open while the camera moves, and the screen shows only the resident settlement
  on every frame.

**Numbers:** 743 tests pass, up from 728. The web bundle grew from 156.6 kB to 161.5 kB of JS. The
simulation did not change, so no golden frame or balance gate moved.

## Decisions taken (defaults, on a bare "go")

1. **No per-city deserialize.** §1.4 says arriving "deserializes" the city's saved state and
   leaving "flushes" it. Here the settlement lives in the one world state the whole time, so a
   separate copy on arrival would be a second source of truth. Arriving derives the view from the
   live state; the flush writes the whole save through the existing autosaver, once on arrival and
   once on departure.
2. **The frame loop's world-advancing part moved out of `main.ts`**, into `WorldDriver`, so the gate
   could be driven with fixed timestamps. The milestone latch moved with it: it was the one place
   the loop wrote to the world besides the clock.
3. **1.2 seconds each way** (`TRAVEL_MS`), zooming in to 3.5× (`TRAVEL_ZOOM`). These are web
   constants, not simulation tuning.
4. **The HUD's "Open" button starts the journey without a confirm**, because the button is itself
   the choice. A marker click on the globe asks first, as §1.4 says.

## What went wrong

**I wrote a measurement before measuring it, again, and the test caught it.** The vacuity guard on
the exactness test said "Measured: 1,800 substeps (450 sim-years)" with a threshold of 1,000. The
real run is **119 substeps, about 30 sim-years**, over the test's 10 seconds at speed 100. The
guard failed on its first run. Batch 20's note recorded five of these comments; this is the sixth.
The measured number is now the comment, and the threshold is 100.

**My first "only one scene" check could not fail.** It took the maximum over frames of "is a scene
resident", which is 0 or 1 by construction. It was replaced with a check that can fail: no scene is
open during any frame the camera is moving, with a guard that four journeys' worth of moving frames
really happened. The new check catches the "resident while still descending" injection, which the
old one would have passed.

**One test relied on floating-point luck.** The pull-back test compared the final pose with
`toEqual`, but easing from `a` to `b` computes `a + (b − a) · 1`, which need not equal `b` exactly.
It passed because of these particular numbers. An injection's failure message (0.2999…98 against
0.3) showed it. The ease now lands exactly on the end pose at its end, and the test compares to 12
decimal places.

**The exactness gate has a blind spot, and this batch does not close it.** Both worlds in the test
go through the same `WorldDriver`, so a bug inside the driver breaks both identically and the
equality still holds. What the gate catches is the view leaking into the world. The injection that
makes the city view write to the settlement it draws is caught by the equality alone. And
`main.ts`'s own wiring is still untested: the test copies its frame order (advance, travel, draw)
rather than running it, because `main.ts` is a script with side effects. If `main.ts` ever stops
calling the driver while a city is open, no test will notice.

## Measurements

- Over the test's 10 seconds at speed 100, 119 substeps ran. The traveller was away from orbit
  from frame 30 until about frame 492 of 600, about three quarters of the run.
- The trip made four journeys (down, up, down, up), with 1.2 s of camera movement each.
- Arrival waits for the full 1.2 s: a test checks the city is not loaded one frame short of it,
  and is loaded one frame after.

## Verified by injection

| Broken on purpose | Caught by |
|---|---|
| The city view writes to the settlement it draws | the exact world comparison |
| Arriving never loads the scene | the arrival test, the city-to-city test, the resident check, the flush order |
| City to city warps directly | the hop test, the phase sequence, the resident check |
| Unload before flush on leaving | the leaving order, the flush log |
| No flush on arrival | the arrival test, the hop test, the flush log |
| Arrives in half the time | the arrival test, the in-transit check, the timing test |
| Resident while still descending | the arrival test, the in-transit check, the timing test |
| A new destination hijacks a journey mid-flight | the mid-flight test |
| Aim uses the wrong sign | the aim test, checked against `projectToScreen` |
| Aim goes the long way round | the short-way test |
| The pull-back does not return the player home | the pose test |
| A marker reports the wrong settlement | the marker test |
| A cancelled journey fires on a later confirm | the cancel test |
| The prompt travels without confirming | both prompt tests |

## Open

- **`main.ts`'s wiring is not under test** (see above). Moving the whole frame loop into a class
  would close it.
- **There are no speed controls inside a city.** They live in the HUD, which the city view hides.
- **The camera move is untested in a real browser.** In particular, the globe at 3.5× zoom was
  never looked at, and the fallback globe's markers still draw at a fixed tilt (Batch 17's open
  item), so clicking one there could pick a spot the marker isn't over.
- **Nothing reads "while travelling" in the HUD.** During the 1.2 s descent, the HUD is still
  showing and its buttons still work; orders placed then do go through.
