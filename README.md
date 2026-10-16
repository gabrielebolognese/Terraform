# Terraforming game — macro simulation

Mars terraforming test game, to test my skills in game development and procedural generation.

A planetary terraforming simulation. Mars is the first world: you warm it, thicken its atmosphere,
melt its water, seed life, and oxygenate it into somewhere people can stand outside.

The whole world is a small vector of floating-point numbers advanced by deterministic difference
equations — `(state, dt) -> state`. Everything else, including every pixel, is a read-only consumer of
that state.

## Documents

| File | What it is |
|---|---|
| [`docs/design/macro-world.md`](docs/design/macro-world.md) | The design doc. What we are building, and the physics. |
| [`docs/design/economy.md`](docs/design/economy.md) | The economy, the tech tree, and the contract the city layer reads the planet through. |
| [`docs/design/micro-world.md`](docs/design/micro-world.md) | The settlement (micro) layer: cities, outposts, the 2.5D view, and the two-way coupling to the planet. Queued as Batches 17-21. |
| [`docs/design/micro-detail.md`](docs/design/micro-detail.md) | The detailed micro layer: terrain with depth, procedural structures, resource deposits, and flooding from the rising sea. Queued as Batches 22-28. |
| [`GAME_PLAN.md`](GAME_PLAN.md) | From Batch 26 on: the batches that turn the simulation into a game - title screen and worlds, real build times, vehicles that use the city, objectives, events, sound, an ending. `/next-batch` reads it. |
| [`BUILD_PLAN.md`](BUILD_PLAN.md) | Batches 1 to 25: the build order that made the simulation, with exit gates and the cross-batch invariants every batch is still held to. |
| [`docs/balance/batch1-calibration.md`](docs/balance/batch1-calibration.md) | Where the current constants actually put the curve, measured. |
| [`docs/balance/batch2-levers.md`](docs/balance/batch2-levers.md) | What the nine player levers do, and what the playthrough exposed. |
| [`docs/balance/batch3-balance.md`](docs/balance/batch3-balance.md) | How the S-curve was tuned, and what is still wrong with it. |
| [`docs/balance/batch4-persistence.md`](docs/balance/batch4-persistence.md) | The save schema, the v1 migration, and the offline caps. |
| [`docs/balance/batch5-visual-contract.md`](docs/balance/batch5-visual-contract.md) | The eight visual channels, and how continuity became falsifiable. |
| [`docs/balance/batch6-renderer.md`](docs/balance/batch6-renderer.md) | The planet renderer, and the four defects that measuring §0.3 exposed. |
| [`docs/balance/batch7-shell.md`](docs/balance/batch7-shell.md) | The game shell, and how "what next" became a derivation rather than a script. |
| [`docs/balance/batch8-events.md`](docs/balance/batch8-events.md) | Seeded weather with no queue and no cursor, and a conflict with Batch 5 resolved. |
| [`docs/balance/batch9-economy.md`](docs/balance/batch9-economy.md) | How the economy got built, and the three things that went wrong doing it. |
| [`docs/balance/batch10-review.md`](docs/balance/batch10-review.md) | The adversarial review of Batches 3-9: five defects, and what they say about the tests. |
| [`docs/balance/batch11-endgame-legibility.md`](docs/balance/batch11-endgame-legibility.md) | Why the "flat" late game was a renderer gap, and the first measurement of the planet's own stalls. |
| [`docs/balance/batch12-oxygen-tail.md`](docs/balance/batch12-oxygen-tail.md) | A negative result: what paces the oxygen tail, and why every faster version breaks §0.3. |
| [`docs/balance/batch13-review.md`](docs/balance/batch13-review.md) | The adversarial review of Batches 1–2, 11 and 12: eight defects, the worst in a test I had loosened. |
| [`docs/balance/batch14-review.md`](docs/balance/batch14-review.md) | The review of Batch 13's own fixes: three were defective, including the ledger gate it loosened. |
| [`docs/balance/batch15-globe.md`](docs/balance/batch15-globe.md) | The full-screen, rotatable GPU globe, and what could not be verified without a browser. |
| [`docs/balance/batch16-build-panel.md`](docs/balance/batch16-build-panel.md) | The HUD's build panel, and the test scenario that had to exist before it could catch a mispriced button. |
| [`docs/balance/batch17-micro-coordinates.md`](docs/balance/batch17-micro-coordinates.md) | The settlement layer's first batch: coordinate spaces, founding from orbit, markers on the globe. |
| [`docs/balance/batch18-settlement-sim.md`](docs/balance/batch18-settlement-sim.md) | A settlement as a pure simulation: ten buildings, brownouts, population, and CO2-to-oxygen processors that move the planet. |
| [`docs/balance/batch19-settlement-save.md`](docs/balance/batch19-settlement-save.md) | Settlements in the save (schema v5): exact round trip, retune-safe loading, and offline progression proven exact. |
| [`docs/balance/batch20-city-view.md`](docs/balance/batch20-city-view.md) | The 2.5D city view: procedural buildings, rough ground, placement, the inspector, and a golden city render. |
| [`docs/balance/batch21-travel.md`](docs/balance/batch21-travel.md) | Travel between orbit and a city: markers, the camera move, and proof the world advances the same in either view. |
| [`docs/balance/batch22-terrain.md`](docs/balance/batch22-terrain.md) | Terrain with depth: one elevation field for the globe and the settlements, metres on the planet, hills and slope, exact picking. |
| [`docs/balance/batch23-sea-level.md`](docs/balance/batch23-sea-level.md) | Sea level from the ocean, and how fast it rises: the input the flooding batches build on. |
| [`docs/balance/batch24-flood.md`](docs/balance/batch24-flood.md) | The flood model: a low city drowns from its lowest ground inward and is lost at +10 m, exact through offline catch-up - and the six weak tests found closing it. Off by default. |
| [`docs/balance/batch25-flood-forecast.md`](docs/balance/batch25-flood-forecast.md) | When the sea will reach each settlement, forecast in water rather than metres (the spec's line was 58 years wrong across a kink), and the warnings in the orbit HUD. |
| [`docs/balance/batch26-structures.md`](docs/balance/batch26-structures.md) | Procedural structures: each building's signature varied by a seed from where it stands, and greebles that multiply with its level - all 28 types on a reference sheet, for 4-5% more drawing up close. |
| [`docs/balance/batch27-worlds.md`](docs/balance/batch27-worlds.md) | The front door: a title screen, any number of worlds each with its own save and seed (the seed turns the terrain), Standard / Sandbox / Terraformed start, export and import - and a world that will not load is kept, never saved over. |
| [`docs/balance/batch28-build-times.md`](docs/balance/batch28-build-times.md) | Real build times: a curve from 20 seconds to 8 hours, a build queue, and a Standard pace where the planet runs 8x slower while the cities keep their rhythm - measured on a scripted playthrough, with the one target it misses and why. |
| [`docs/balance/batch29-vehicles.md`](docs/balance/batch29-vehicles.md) | Vehicles that use the city: rovers on routes round the buildings (their length sets the trip), trains car by car on a track each way with stations and freight, every vehicle drawn behind what stands in front of it, glass too - no vehicle inside a building over a scripted day and a metropolis, measured; about 1 ms more a frame at medium detail. |
| [`docs/balance/batch30-first-hour.md`](docs/balance/batch30-first-hour.md) | The first hour: a guide through seven first steps driven by the state, nine objectives with rewards each measured to shorten the road to the next goal, milestones; the guide takes 42 min, claiming land waiting for 200 people. |
| [`docs/balance/batch31-alerts.md`](docs/balance/batch31-alerts.md) | Knowing what is happening: alerts derived at the readout (each type fired by a scripted run that causes it, and not by one beside it), toasts by priority, the alert centre, the planet's bounded record in the save (125 samples, 25 kB after 1,000 sim-years), statistics, each city at a glance; a look over the example planet cut from 2.8 s to a few ms. |
| [`docs/balance/detail-pass-buildings.md`](docs/balance/detail-pass-buildings.md) | The ten buildings rebuilt with far more detail; a close-up of all ten is `docs/frames/city-buildings.png`. |
| [`docs/balance/detail-pass-lod.md`](docs/balance/detail-pass-lod.md) | Three levels of detail, so a zoomed-out metropolis stays smooth, and loose rocks on open ground. |
| [`docs/balance/detail-pass-roads.md`](docs/balance/detail-pass-roads.md) | Roads, connection points and rovers: a building runs only when its network holds a producer of what it draws. |
| [`docs/balance/detail-pass-colony.md`](docs/balance/detail-pass-colony.md) | Corridors and power cables, the headquarters, rock-breaking rovers and supply rockets. |
| [`docs/balance/detail-pass-world-map.md`](docs/balance/detail-pass-world-map.md) | Cities grown to 3-17 chunks across as blobs, railways between settlements that carry water, oxygen, food and materials, and the world map - 2,048 x 1,024 world tiles - with every settlement, its chunks up close, and the railways and their trains. |
| [`docs/balance/detail-pass-city-lines.md`](docs/balance/detail-pass-city-lines.md) | The avenues taken out of the grown cities; every settlement named and marked small, medium or large city; twice the buildings on the same land; and each railway to another settlement laid straight across the city, edge to edge. |
| [`docs/balance/detail-pass-metropolis-blob.md`](docs/balance/detail-pass-metropolis-blob.md) | Metropolises shaped as towns grow - a blob with lobes and arms, the same space - with avenues and railways following the shape, every chunk of land holding 3 to 25 works (no homes), and a camera that zooms out to the whole city. |
| [`docs/balance/detail-pass-open-metropolis.md`](docs/balance/detail-pass-open-metropolis.md) | Opening a metropolis no longer crashes the browser: the scene is made chunk by chunk as it comes into view and let go past a bound (it had ordered a million tiles at once, past 3.5 GB), bigger chunks further out, and the ground prepared a frame at a time behind a progress bar. |
| [`docs/balance/detail-pass-metropolis-24.md`](docs/balance/detail-pass-metropolis-24.md) | Metropolises 992 tiles a side - the quarters in the middle, districts, a solar and a wind farm, avenues of corridor and double railway round them - with maglev trains on every railway and bridges over corridors; wind turbines, mega malls, stores of every kind, parks and the biosphere; cities with railway loops and planning zones; a step 5x cheaper per building. |
| [`docs/balance/detail-pass-planner.md`](docs/balance/detail-pass-planner.md) | The city planner, the second mode after the city view: name a city, a 2D map, zones painted, coloured and levelled by rovers, corridors, power lines and railways drawn and built, and charts of people, births and deaths, blackouts and shortages. |
| [`docs/balance/detail-pass-motherboard.md`](docs/balance/detail-pass-motherboard.md) | Settlements laid out like a motherboard: blocks wall to wall, trunk traces and spurs - a sixth of the corridors - and a metropolis's substep made three times cheaper. |
| [`docs/balance/detail-pass-metropolis.md`](docs/balance/detail-pass-metropolis.md) | The city drawn in chunks - still parts kept as pictures, only what moves drawn each frame - and the example's metropolises rebuilt in quarters, wider, with suburbs, railways and every structure. |
| [`docs/balance/detail-pass-later-buildings.md`](docs/balance/detail-pass-later-buildings.md) | Eight later buildings - laboratory, algae reactor, skyscraper, observatory, station and railways, research forum, medical center, industrial command center - and buildings that are not square. |
| [`docs/balance/detail-pass-build.md`](docs/balance/detail-pass-build.md) | Building mode (see-through buildings, no hitbox), build times with rovers and worksites, building levels, and "connect twice". |
| [`docs/balance/detail-pass-levelling.md`](docs/balance/detail-pass-levelling.md) | Levelling ground with a rover, tile by tile, to the level beside it - for looks, and so buildings need no foundation. |
| [`docs/balance/detail-pass-zones.md`](docs/balance/detail-pass-zones.md) | The example planet's cities in zones - homes, power, industry, a port of spaceports in a line, mixed districts - spread from centre to corners; "connect all" kept off hard rock; the level-of-detail gate split into the city and the ground round it. |
| [`docs/balance/detail-pass-rover-post.md`](docs/balance/detail-pass-rover-post.md) | Four times the hard-rock clusters, the Rover Post (one more rover per 100 people), and the connective tools moved to the top right. |
| [`docs/balance/detail-pass-claims.md`](docs/balance/detail-pass-claims.md) | Founding ground three times larger, and claiming land as a city grows: the frame, the save (v9), and the view kept fast at the new sizes. |
| [`docs/balance/detail-pass-open-world.md`](docs/balance/detail-pass-open-world.md) | The open world round every city: mountains, canyons, craters and caves; smooth ground, foundations on slopes, and ground that greens with the biosphere. |
| [`docs/frames/contact-sheet.png`](docs/frames/contact-sheet.png) | The whole visual arc, twelve frames at fixed progress values. |

## Status

**All nine batches are complete, plus adversarial reviews of Batches 1-12 and an endgame legibility pass**: the simulation core, a headless harness, all nine player levers of
design doc section 5, a tuned S-curve, persistence with offline catch-up, the section 9 visual
contract, the planet renderer that consumes it, a game shell, seeded weather, and a credit economy
with a tech tree and the macro → micro bridge. A full playthrough
reaches a living world at sim-year 1710 — about 16 real hours at 1x — with every section 2.3
minimum met, and it survives closing the tab. The Earth-like targets beyond those minimums take
longer; the progress bar measures those, so it reads about 87% on the winning year, and the shell
says so.

`npm run dev` opens on the **title screen** (Batch 27): Continue, Worlds, New world, Example planet,
Settings, Credits, over a turning Mars. Each world is its own planet and save, made from a seed (the
same seed, the same world) in one of three modes - Standard, Sandbox, or Terraformed start - and can
be renamed, copied, exported to a file, imported and deleted. A save from before worlds opens as
"My planet". In a world, Esc or **Menu** pauses it: Resume, Save, Save and quit to title.

A world's **pace** (Batch 28): **Standard** has real build times - a solar array in 30 seconds, a
reactor in 4 minutes and its top level in about 3 hours, a mega mall in an hour - with the planet
eight times slower than before and the cities at the rhythm they had. Builds queue for a free rover,
count down in real time over the worksite and in the city's Builds list, and keep going while you
are away. Speeds are pause, 1x, 2x and 3x (every speed in a Sandbox, or with `?debug`). **Classic**
is the fast game from before, and every world made before it.

**Vehicles that use the city** (Batch 29). A rover leaves by the headquarters' garage door and drives
round the city - over corridors (twice as quick: build them) and open ground, never under a building,
over hard rock or up a cliff - and its route sets how long the trip takes. A building no rover can get
to is refused with the reason, and so is one that would wall others in, cover the garage door or go
up where a rover is driving. Trains run a track each way, ride the curve of the line car by car, slow
for bends and stand at station platforms and at the end of a line; a line past no station carries
freight. Every vehicle is drawn behind whatever stands in front of it. A world made before keeps its
straight-line trip times, but its rovers are drawn round the buildings too.

**The first hour** (Batch 30). A new Standard world has a guide: a card at the top of the screen that
takes the player through seven first steps (found a city, place power, a dome, connect them, raise a
level, claim land, a railway to a second settlement), with the control to press glowing. A step counts
when the world shows it done - the simulation latches it every substep - so the guide cannot fall out
of step. **Objectives** hold three chains of goals (the city, the planet, the network) with derived
progress and rewards claimed by the player: settlers, rovers, materials, credits, the right to found a
metropolis, gold markers. Milestones (a phase, a city, a great structure, an objective done) bring a
card, a moment of light and a chime. None of it is in a sandbox, a Terraformed start or an older world.

**Knowing what is happening** (Batch 31). Alerts are derived from the state at the readout, never
stored: a blackout, a shortage, buildings offline and why (grouped, so a hundred offline for one
reason in one city are one line), a dust storm forecast from the seeded weather, builds and upgrades
finished, an objective done. Urgent and notice alerts pop up as toasts, the urgent first; the
**Alerts** centre lists what holds now and what happened. Every alert clicks through: down to the
city, its building selected and centred. **Statistics** chart the planet (its six axes, progress,
credits, people) over the whole game from a record the simulation keeps in the save, bounded by
halving, and each city's record, now with what it made and used of each resource. Each city's line in
the HUD and the world map says its people, what is short and what is being built.

**People, not a number** (Batch 32). In a new world a growing city's people want more than life
support: green space and varied food from 500 people; medical care, research, transport and shops
from 2,000 (transport from a station's 5,000, shops from a mall's 10,000). A running service reaches
the homes in a square about it, on the same corridors, and each need met or unmet moves the city's
mood, which multiplies its growth (x0.5 to x1.5) and what its buildings make (x0.9 to x1.1) -
derived every substep inside `advance`, never stored, behind `NEEDS_ENABLED`. The city panel has a
**People** section, the planner a **Coverage** overlay of where each service reaches and the gaps;
crowds gather at stations and parks, and towers light as their homes fill. The example planet was
rebuilt with its services among its homes, and every one of its cities stays perfect with needs on.

**Events that ask for decisions** (Batch 33). From half an hour into a new world, a deck dealt from
the world's seed (as the storms are) brings an event to one of the player's cities about every 25
minutes at 1x: a meteor shower, a machine failing, an outbreak (the Medical Centers shelter people
from it), Earth's supply ship early, late or lost, a discovery. Each offers two or three choices,
paid for when chosen, and lands at its deadline, three minutes on, inside `advance`; left alone, its
default - always the worst choice made worse - lands instead. What lasts (people under cover, a
quarantine, a faulty building) is counted down in the city's own substep. The open events, the
choices and a record of the last 40 are world state (save v18); the deck is the same live, offline
or chunked any way. A card shows what is waiting; an event is an urgent alert until answered, and
the **Alerts** centre keeps the world's event history. Behind `DECISIONS_ENABLED`; new Standard and
Terraformed worlds have it, a sandbox and the worlds before do not.

**Earth: shipments, contracts and the market** (Batch 34). Launch windows open on the planet's
calendar, every 2.135 years (the synodic period: about 9.5 minutes at 1x at the Standard pace),
worked out from the window's number so fifty on they still fall on their dates. At each one a city's
own spaceport rocket - the one the view draws - lifts off with what is sold and what Earth's
contracts take (never a store below a quarter of its room) and lands a third of a window later with
what was ordered; a rocket away on a supply run misses the window and the orders wait. Earth's
market prices each good by its supply that window (from the seed), the player's trade (remembered,
half forgotten each window) and their reputation, and never pays more than it asks. Each window
Earth offers a contract for materials, water or research (research earned goes to Earth instead of
the bank until it is met): met, it pays and reputation rises; failed, it falls. Settlers and rovers
go on sale as contracts are met. All of it inside `advance`, every substep; save v19. An **Earth**
panel trades, and Earth's news comes in the alerts. Behind `EARTH_ENABLED`; new Standard and
Terraformed worlds have it, a sandbox and the worlds before do not.

**Sound: music, ambience and effects** (Batch 35). One Web Audio engine for the session, with
channels for music, ambience, effects and the interface, each with the player's volume, and no
`AudioContext` at all until the first click, key or touch. Nothing is loaded: the music is written
as it plays from a piece per phase (a key, chords, a tempo, a timbre - cold, minor and sparse on
bare Mars, warm, major and full on a living world), crossfaded over 8 seconds when the planet
reaches a new phase; the wind follows the pressure and the dust storms, rain the clouds over warm
water, the sea the ocean and how near a city is to its shore, the machinery what runs near the
city camera. Effects - placed, finished, upgraded, a train going by, a rocket up, an alert, an
objective - are crossings seen between two looks at the state (the first look takes its bearings),
placed by where they happen in the city view. The sound reads the state and never writes it: a run
heard and a run not are the same to the bit. The volumes are the player's, kept beside the worlds
list, and set on the title's **Settings** and the world menu's. The licences are in
[`docs/credits.md`](docs/credits.md): the font's, and the game's own for every sound.

**Settings, controls and accessibility** (Batch 36). Every setting in one panel, on the title and
in the world menu, kept per player in an IndexedDB store of its own (Batch 35's sound record moved
there and left where it was). Graphics: the city's detail held or Auto, the pictures of the city
kept, and its moving details off (each building held still in its picture; vehicles and a rocket
in flight still move), each level's frame time measured on the player's machine. Controls: 21
shortcuts by physical key, each with two rebindable slots that swap on conflict; camera speed;
edge scrolling; invert zoom; trackpad pinch and two-finger panning, and pinch on touch, in every
view. Interface: the panels' size (never the canvases'), red-green and blue-yellow colour-blind
palettes for the page and the canvases (measured under simulated colour blindness), reduced
motion (a cut for the flight down, a still planet), high contrast, and which alerts pop up.
Saving: the autosave interval, Ctrl+S, and where the worlds are kept. Every colour code has a
second cue - a word, a sign, a shape, on the planner's map a pattern, on the world map a shape for
each kind of settlement - and a test holds the stylesheet's colour rules to a register of them. No setting changes the simulation: the same
frames with every setting moved come out the same.

In a world, the shell shows the current phase and what it looks like, the composite progress bar,
the six section 2.3 target bands, a derived milestone log, and **what the planet needs next** —
which is computed from section 8.1's own weighted geometric mean rather than scripted, then resolved
through its prerequisites to something you can actually do today. A **Build** panel lists every
lever with its price, what is ordered and what is online, and lets you order, dismantle or switch
each one off. Under **Settlements** you can found a city or an outpost by clicking the planet;
each gets a marker that stays on its spot as the globe turns. Click a marker (or **Open** in the
list) and the camera flies down to it, into its
2.5D view: build from the palette on its hills (ground too steep refuses, and every elevation is
given in metres), click a building to see
what it is doing and why it might be offline (the settlement layer, Batches 17-21,
is being built from `docs/design/micro-world.md`). The planet fills the whole
window behind it, shaded on the GPU at full resolution: drag to turn it, scroll to zoom. The
instruments open as a drawer from the top right, with a scrubber that drags the planet through the
whole reference playthrough in seconds, and **See example planet** - Mars fully terraformed, with
27 cities (three of them metropolises, 3 x 3 a city's ground) and 15 outposts; your own planet
is kept aside, never saved over, and comes back with **Back to my planet**. A metropolis steps down to lighter
detail as you zoom out (three levels, chosen by how much of the city is on screen), so it stays
smooth to move around. Every settlement is founded around a 5x5 **headquarters** (and a city with one spaceport). Buildings
join up by **corridors** (water, oxygen, food, materials) and yellow **power cables**: a mine needs a
cable to a power plant, a dome a corridor to a greenhouse. Click a rock or crag to send a **rover** to
break it for materials (a **Rover Post** adds a rover, one post per 100 people); select a spaceport to launch a **supply rocket**. Corridors, cables,
"connect all", "claim land" and "level ground" (a rover levels a tile to the level beside it) sit in
their own toolbar at the top right. Each city stands in its own open world - smooth hills, mountain ranges, canyons,
craters and caves, 48 tiles of it beyond the dashed building boundary - and its ground greens as the
planet's biosphere grows. A city is founded on 96 x 96 tiles (an outpost 48, a metropolis 288); at
200 people it can **claim land** beside its own, 32 x 32 tiles at a time, and one more with every 100
people after - the world reaches further in every direction it grows. See
[`docs/frames/contact-sheet.png`](docs/frames/contact-sheet.png) for the visual arc at a glance.

Dust storms, cometary impacts and solar variability run in the browser. They are **seeded on
coordinates rather than on call order** — there is no generator, no queue and nothing in the save — so
the same absence produces the same weather however the catch-up was chunked, and the timeline is
bit-identical across engines even though the physics is not.

Facilities cost credits, income comes from how much of the planet can support people, and the tech
tree opens as the planet crosses section 7's phases. The economy and the weather both ship **off** in
the default tuning and **on** in the browser, so the balance instruments stay pointed at the world
they were calibrated against.

**Known gaps.** Section 8.2 asks for a visible change to the planet every few real minutes. The worst
wait is 31.1 real minutes (down from 55.6), in the oxygen tail, where the atmosphere's composition
changes over centuries. It is pinned in `golden-frames.test.ts` above the limit, not passed, and
Batch 12 established why it can't simply be tuned away. The tail is paced by the oxygen-fire gate
and the nitrogen buffer, and every faster schedule makes the bar's last stretch outrun the planet.
The next step is a design decision about the CO₂ progress axis. The progress bar's own worst stall
is still 8.9 minutes, before first water. See `BUILD_PLAN.md`.

## Setup

```bash
npm install
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with the live sim inspector |
| `npm run sim:run` | Headless fast-forward, ASCII S-curve plot, optional CSV |
| `npm run sim:sweep` | Score tuning variants against the section 0 pacing goals |
| `npm run sim:frames` | Re-render the twelve golden frames and the contact sheet |
| `npm run sim:city` | Re-render the golden city frames, the larger previews and the building close-up sheet |
| `npm run sim:run -- --events` | Same, with section 12.2's seeded weather turned on |
| `npm run dev:node` | One-shot summary of the starting world |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Tests in watch mode |
| `npm run typecheck` | Type check both programs (sim and web) |
| `npm run build` | Compile the sim to `dist/` |
| `npm run build:web` | Bundle the inspector to `dist-web/` |

### Watching a run

```bash
npm run sim:run -- --years 4000 --every 10 --csv docs/balance/run.csv
```

Always runs two trajectories. The **reference** run is a scripted stand-in for a player. The
**null-policy** run is the control, and it is the more important of the two: an untouched Mars must
stay dead, because the moment the player pushes the planet past its own tipping point is the heart of
the game. If the null run ever reaches Phase 2 on its own, the balance is broken no matter how good
the reference run looks.

Flags: `--years`, `--every`, `--csv`, `--channels`, `--null-only`.

The reference run is a schedule of facility build orders (`src/harness/policy.ts`), so what the
harness measures is what a player driving the same levers would get.

## Publishing on Netlify

The game is a static site: everything runs in the browser, and saves live in the browser's
IndexedDB. `netlify.toml` tells Netlify to typecheck, build with `npm run build:web` on Node 22,
and publish `dist-web/`.

- **From GitHub (redeploys on every push):** in Netlify, *Add new site -> Import an existing
  project -> GitHub*, pick this repository; the build settings come from `netlify.toml`. Deploy.
- **From this machine:** `npx netlify-cli login`, then `npx netlify-cli deploy --build --prod`
  (the first time it asks to create or link a site).
- **By hand:** `npm run build:web`, then drag the `dist-web` folder onto
  <https://app.netlify.com/drop>.

## Layout

```
src/sim/        the simulation — pure, deterministic, no I/O, no host dependencies
  types.ts      the full type surface: reservoirs, flows, ledger, derived, phases
  tuning.ts     every tunable constant, as a frozen object threaded through calls
  targets.ts    the Earth-like victory band (design doc section 2.3)
  math.ts       every transcendental the sim uses, each guarded once
  units.ts      the metres <-> mbar water bridge, and the only file allowed to name it
  derive.ts     pressure, albedo, temperature, surface cover
  rates/        one module per feedback loop: co2, water, biomass, nitrogen, loss
  facilities/   the nine player levers of section 5, as terms in the same equations
  integrate.ts  mass-limited flow application and the substep loop
  tick.ts       the public entry point, plus offline catch-up
  save.ts       the section 11 schema (v5, settlements included), validation and migrations
  offline.ts    the design cap on absence, and "while you were away"
  visuals.ts    the section 9 channels — the wall between sim and graphics
  rng.ts        randomness keyed on coordinates, so chunking cannot change it
  events.ts     section 12.2 weather, as a pure function of (seed, sim-year)
  habitat.ts    the macro -> micro contract: the ONLY thing a city layer reads
  economy.ts    credits, escalating costs and upkeep
  tech.ts       the tech tree, gated on latched phase
src/render/     the planet — imports VisualChannels and nothing else from the sim
  noise.ts      deterministic value noise and fbm on the sphere
  planet.ts     channels -> pixels; pure, no canvas, runs in Node and the browser
src/harness/    headless runner, ASCII plotting, build-order policies
  score.ts      section 0's pacing paragraph, as metrics a sweep can rank
  sweep.ts      the balance sweep and its candidate ladder
  png.ts        a minimal PNG codec, so the goldens never churn on a dependency
  frames.ts     the twelve reference frames and the contact sheet
  golden.test.ts  the recorded trajectory a retune has to argue with
  golden-frames.test.ts  the committed PNGs a renderer change has to argue with
src/web/        the browser — reads sim state, never writes to it
  hud.ts        the game shell: phase, progress, target bands, advice, log
  guidance.ts   "what the planet needs next", derived from section 8.1's own maths
  events.ts     milestones, noticed as state crosses a threshold
  inspector.ts  the debug instrument: reservoirs, sparklines, levers, channels
  planet-view.ts  the only file that knows the renderer draws onto a canvas
  arc.ts        records the reference playthrough so the scrubber can seek it
  storage.ts    IndexedDB, with an in-memory fallback when it is unavailable
  session.ts    boot, autosave, and the one place a clock is read
src/testkit/    shared test helpers and tolerances
```

## Conventions

- ESM only (`"type": "module"`), so relative imports need the `.js` extension even in `.ts` files.
- Tests are colocated as `*.test.ts` next to the code they cover.
- The tsconfig is split by target: `tsconfig.json` builds the sim with **no DOM library**, so a stray
  `document` or `performance.now()` inside `src/sim/` is a compile error rather than a convention.
  `tsconfig.web.json` builds the browser code. `npm run typecheck` runs both.
- `src/sim/boundary.test.ts` enforces what the compiler cannot: no imports from a host layer, no
  wall-clock, no randomness, no I/O, and one owner for the water unit conversion.
