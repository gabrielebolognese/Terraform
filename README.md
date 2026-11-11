# Terraform

*Make Mars a living world.*

Terraform is a browser game about turning Mars, a cold and airless desert, into a planet people can
live on in the open. From orbit you order the machines that change a world: mirrors that warm it,
factories that thicken its air, comets that bring it water. On the ground you found cities, build
them one structure at a time, and link them by rail. It was written as a personal project to
practise game development and procedural generation.

Under the game sits a deterministic planetary simulation. The whole world is a small vector of
floating-point numbers advanced by difference equations, `(state, dt) -> state`. Everything else,
including every pixel and every sound, is a read-only consumer of that state. The simulation also
runs headless in Node, which is how the game is balanced and tested.

The game runs entirely in the browser: no server, no account, no backend. Saves live in the
browser's IndexedDB.

## Features

### The planet (orbit view)

- A full-screen, rotatable globe shaded on the GPU with WebGL2, with a software renderer as the
  fallback when WebGL2 is unavailable.
- Seven phases, from **Barren** through Warming, Runaway thickening, First water, Ecopoiesis and
  Oxygenation and buffer to **Living world**, each latched from the simulated state.
- Nine planet-scale machines to order, dismantle or switch off: Orbital mirror array, Solar shade,
  Greenhouse factory, Atmospheric processor, Comet redirect, Nitrogen import, Cyanobacteria seeding,
  Carbon scrubber and Orbital magnetic shield.
- A credit economy with escalating costs and upkeep, and a tech tree that opens as the planet
  crosses each phase.
- "What the planet needs next": advice derived from the progress maths itself and resolved through
  prerequisites to something you can do now, not scripted.
- Seeded weather: dust storms, cometary impacts and solar variability, keyed on coordinates rather
  than call order, so the same absence always produces the same weather.
- A procedurally generated planet per seed: the same seed (a number, word or phrase) always makes
  the same continents and basins.

### Cities (surface view)

- Found cities, outposts and, later, metropolises by clicking the globe; the camera flies down
  into a 2.5D view of the settlement on its own terrain of hills, ranges, canyons, craters and
  caves.
- Place buildings for homes, power, water, oxygen, food, materials, storage, transport, research
  and services, joined by corridors and power cables. A building that cannot run says why.
- Rovers drive real routes out of the headquarters to build, break rocks and level ground; builds
  queue, count down in real time and continue while the game is closed.
- Upgradable buildings, land claims as the population grows, and a city planner with overlays.
- Terrain resource deposits (ore, ice, geothermal vents, sunny flats) that boost the matching
  building placed on them.
- People with needs beyond life support: green space, varied food, medical care, research,
  transport and shops. Service coverage sets a city's mood, which changes its growth and output.
- Railways between settlements, with trains that follow the line, slow for bends and stop at
  stations.
- A rising sea late in the game that floods low cities, with a decades-ahead forecast and three
  answers: a Seawall, raising a building's ground, or evacuating.

### The game around them

- A title screen with several worlds, each its own planet and save: play, rename, duplicate,
  export to a file, import, delete.
- Three modes (Standard, Sandbox, Terraformed start) and two paces (Standard with real build
  times, Classic with speeds up to 1000x).
- A first-steps guide, three chains of objectives with rewards, and milestones.
- Events that ask for decisions (meteor showers, failing machines, outbreaks, supply ships,
  discoveries), dealt from the world's seed, each with a deadline and a default if ignored.
- Trade with Earth on recurring launch windows: a market, contracts and reputation.
- Alerts derived from the state that click through to the place they concern, and statistics
  charts for the planet and each city.
- An ending: victory once the living-world targets have held for 10 years, a score per world,
  30 achievements and new game plus.
- An Example planet: a fully terraformed Mars with cities and metropolises to look around.
- Offline progression: the world catches up on the time you were away.
- Sound made entirely in code with the Web Audio API: generative music per phase, ambience
  (wind, rain, sea, machinery) and effects. No audio files ship with the game.
- Settings for sound, graphics, controls, 21 rebindable shortcuts, interface size, colour-blind
  palettes, reduced motion, high contrast and autosave. Mouse, trackpad and touch are supported.

### Under the hood

- A pure simulation core with no I/O, no wall clock and no DOM, enforced by a separate tsconfig
  without the DOM library and by a boundary test.
- A versioned save schema (currently v21) with migrations; saves written by earlier schema
  versions are kept as fixtures and opened by today's code in tests.
- Golden tests: recorded trajectories and committed reference PNGs that the simulation and the
  renderers are compared against per pixel, using a small in-repo PNG codec and software
  rasteriser.
- A headless harness for fast-forwarding, plotting and sweeping tuning values.

## Getting started

### Prerequisites

- Node.js 20 or newer (`engines` in `package.json`; the Netlify build uses Node 22)
- npm (a `package-lock.json` is committed)
- A modern browser; WebGL2 is used for the globe when available

### Download and install

```bash
git clone https://github.com/gabrielebolognese/Terraform.git
cd Terraform
npm install
```

### Configuration

None is required. The game reads no environment variables. `.env.example` is a leftover of the
project scaffold and contains only a commented-out placeholder.

### Run in development

```bash
npm run dev
```

This starts the Vite dev server on port 5173. Open `http://localhost:5173` and the game opens on
its title screen. Adding `?debug` to the URL makes every game speed available in every world.

## Build and deploy

```bash
npm run typecheck
npm run build:web
```

`npm run build:web` bundles the game with Vite into `dist-web/`, a static site that any static
host can serve. `npm run preview` serves that build locally.

`netlify.toml` configures a Netlify deploy: it runs `npm run typecheck && npm run build:web` on
Node 22, publishes `dist-web/`, and sets cache and security headers. To deploy:

- **From GitHub:** in Netlify, import this repository; the build settings come from
  `netlify.toml`.
- **By hand:** run `npm run build:web` and upload the `dist-web` folder to a static host.

`npm run build` is a separate target: it compiles the simulation and the Node entry point with
`tsc` into `dist/`, and `npm start` runs that output, which prints a summary of the starting
world.

## Usage

### Playing

1. From the title screen choose **Play**, then **New world**; pick a name, a seed, a mode and a
   pace, and press **Create world**.
2. You start in orbit over a bare Mars. Follow "What the planet needs next" and order an
   **Orbital mirror array** to begin warming it.
3. Press **Found a city**, click the planet, then **Open** the city and build power, a mine,
   habitats, food and water.
4. Keep both layers going: the planet's machines cost credits, and your cities earn them.

The full player's manual is in [`docs/manual/`](docs/manual/README.md), including
[controls](docs/manual/controls.md) and [every building](docs/manual/buildings.md).

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with the game |
| `npm run build:web` | Bundle the game into `dist-web/` |
| `npm run preview` | Serve the built `dist-web/` locally |
| `npm run typecheck` | Type-check both programs (simulation and web) |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Tests in watch mode |
| `npm run sim:run` | Headless fast-forward with an ASCII plot and optional CSV |
| `npm run sim:sweep` | Score tuning variants against the pacing goals |
| `npm run sim:frames` | Re-render the reference planet frames and contact sheet into `docs/frames/` |
| `npm run sim:city` | Re-render the reference city frames into `docs/frames/` |
| `npm run dev:node` | Watch-run the Node entry point (a summary of the starting world) |
| `npm run build` | Compile the simulation to `dist/` |
| `npm start` | Run the compiled Node entry point |
| `npm run clean` | Delete `dist/` and `dist-web/` |

### The headless harness

```bash
npm run sim:run -- --years 4000 --every 10 --csv docs/balance/run.csv
```

It always runs two trajectories: a **reference** run, a scripted stand-in for a player
(`src/harness/policy.ts`), and a **null-policy** control in which nothing is built. An untouched
Mars must stay dead; if the control terraforms itself, the balance is broken.

Flags: `--years`, `--every`, `--csv`, `--channels`, `--null-only`, `--events` (seeded weather on).

```bash
npm run sim:sweep -- --axis M_PHOTO --values 0.05,0.1,0.25
npm run sim:sweep -- --candidates
```

### Tests

`npm test` runs the whole suite. `docs/PROGRESS.md` records that the full run can be killed for
low memory on a small machine; in that case run
`npx vitest run --maxWorkers=2 --minWorkers=1`.

## Project structure

| Path | What it holds |
| --- | --- |
| `src/sim/` | The simulation: pure, deterministic, no I/O. Planet physics (`rates/`, `derive.ts`, `integrate.ts`, `tick.ts`), planet machines (`facilities/`), economy, tech, events, Earth trade, objectives, achievements, the ending, saves and migrations |
| `src/sim/micro/` | The settlement layer: buildings, networks, rovers and routes, terrain, deposits, needs, flooding and defences |
| `src/sim/planets/` | Planet definitions (Mars) |
| `src/render/` | Renderers that turn state into shapes and pixels: the planet, the globe shader, the 2.5D city, structures, vehicles, people, and a software rasteriser |
| `src/web/` | The browser game: app shell, HUD, globe and city views, planner, world map, panels, settings, sound, storage (IndexedDB) and the worlds library |
| `src/harness/` | Headless runner, balance sweep, scoring, reference-frame generators and golden tests |
| `src/shared/` | Noise and planet terrain shared by the simulation and the renderers |
| `src/testkit/` | Shared test helpers |
| `docs/manual/` | The player's manual |
| `docs/design/` | Design documents for the planet, the economy and the settlement layer |
| `docs/balance/` | One note per build batch: what was built, measured and found |
| `docs/frames/` | Committed reference renders used by the golden tests |
| `scripts/` | Development tooling: an unattended batch runner for Claude Code sessions, a keep-awake helper for Windows, and a generator for old-save fixtures |
| `.claude/commands/` | The `/next-batch` and `/review-batch` commands used to build the project in batches |
| `index.html`, `vite.config.ts` | The page and the Vite configuration |
| `netlify.toml` | Netlify build and header configuration |

Conventions: ESM only, so relative imports end in `.js` even from `.ts` files; tests are colocated
as `*.test.ts`; `tsconfig.json` builds the simulation without the DOM library, and
`tsconfig.web.json` builds the browser code.

## Tech stack

- TypeScript (strict, ESM), with no runtime dependencies
- Vite for the dev server and the production bundle
- Vitest with happy-dom for tests; tsx for running the Node tools
- WebGL2 for the globe, the Canvas 2D API for the city view, Web Audio for all sound
- IndexedDB for saves and settings, with an in-memory fallback
- Chakra Petch and VT323 typefaces, loaded from Google Fonts

## Further documentation

- [`docs/manual/README.md`](docs/manual/README.md) - the player's manual, with
  [update notes](docs/manual/update-notes.md)
- [`docs/design/macro-world.md`](docs/design/macro-world.md) - the planet design and its physics
- [`docs/design/economy.md`](docs/design/economy.md) - the economy and the tech tree
- [`docs/design/micro-world.md`](docs/design/micro-world.md) and
  [`docs/design/micro-detail.md`](docs/design/micro-detail.md) - the settlement layer
- [`BUILD_PLAN.md`](BUILD_PLAN.md) - batches 1 to 25, which built the simulation
- [`GAME_PLAN.md`](GAME_PLAN.md) - batches 26 to 40, which turned it into a game
- [`docs/PROGRESS.md`](docs/PROGRESS.md) - the state of the build, batch by batch
- [`docs/balance/`](docs/balance/) - a note for each batch and detail pass
- [`docs/credits.md`](docs/credits.md) - third-party assets and their licences
- [`docs/frames/contact-sheet.png`](docs/frames/contact-sheet.png) - the planet's visual arc at a
  glance

## Status

A personal project, built to practise game development and procedural generation. All 40 planned
batches are recorded as complete in `docs/PROGRESS.md`, followed by further detail passes, and the
game is playable from the title screen to the ending. It is at version 0.1.0 and has not had a
public release; the manual's update notes list known issues. Much of it was built in batches by
Claude Code sessions driven by `scripts/run-batches.sh`, with a review session after each batch.

The repository has no licence file. The two typefaces it loads are under the SIL Open Font License
1.1 (see [`docs/credits.md`](docs/credits.md)).
