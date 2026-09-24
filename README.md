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
| [`BUILD_PLAN.md`](BUILD_PLAN.md) | The build order, batched, with exit gates and cross-batch invariants. |
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

`npm run dev` opens the shell: the current phase and what it looks like, the composite progress bar,
the six section 2.3 target bands, a derived milestone log, and **what the planet needs next** —
which is computed from section 8.1's own weighted geometric mean rather than scripted, then resolved
through its prerequisites to something you can actually do today. A **Build** panel lists every
lever with its price, what is ordered and what is online, and lets you order, dismantle or switch
each one off. Under **Settlements** you can found a city or an outpost by clicking the planet;
each gets a marker that stays on its spot as the globe turns. Click a marker (or **Open** in the
list) and the camera flies down to it, into its
2.5D view: build from the palette on the ground (rough outcrops refuse), click a building to see
what it is doing and why it might be offline (the settlement layer, Batches 17-21,
is being built from `docs/design/micro-world.md`). The planet fills the whole
window behind it, shaded on the GPU at full resolution: drag to turn it, scroll to zoom. The
instruments open as a drawer from the top right, with a scrubber that drags the planet through the
whole reference playthrough in seconds. See
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
| `npm run sim:city` | Re-render the golden city frame and its two larger previews |
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
