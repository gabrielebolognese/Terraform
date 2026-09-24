# Terraforming Game, Micro World Design Document

Version 0.1 (design draft). Scope: the settlement (micro) layer. What a city or outpost is, how you travel into one, the 2.5D build view, the grounded set of basic infrastructure, how a settlement simulates itself, and how it couples both ways to the macro planet simulation. This is the foundation layer only. It defines the skeleton and deliberately leaves the flesh (combat, deep economy, colonist individuals, disasters) for later documents. See section 11.

Companion to `terraforming-macro-design.md`. Where that doc says "macro", this doc reads from and writes to it through one explicit contract (section 2).

---

## 0. Design goals and scope

Same discipline as the macro doc. Three constraints.

1. **Settlements are small pure simulations.** Each city or outpost is its own tiny authoritative state (stored resources, population, a list of buildings) advanced by a deterministic per-tick balance. No settlement stores anything it can recompute. This keeps saving trivial and identical in spirit to the macro rule "store only the true state, re-derive the rest."

2. **The micro layer IS the macro layer's hands.** The macro doc lists planetary "player levers" (orbital mirrors, GHG factories, atmosphere processors, nitrogen import, seeding). Those are not abstract buttons. They are buildings the player physically places inside settlements. The macro sim's lever terms are the sum of the matching buildings across every settlement. Build ten atmosphere processors across your cities and the macro CO2-to-O2 rate is the sum of their outputs. This single idea is what makes the two layers one game instead of two.

3. **Basics solid before breadth.** A short, grounded building set (ten building types, section 5) that each map to a real Mars-colony technology. Everything works end to end with those nine before anything else is added. No feature is included here just because the genre usually has it.

### What this layer is, in one paragraph

The planet (macro) is a sphere you view from orbit. Settlements sit on its surface at fixed coordinates and appear as markers. Selecting a settlement and traveling to it transitions the camera down to a **2.5D isometric city view** (the Clash of Clans perspective): a tile grid on an open terrain patch where the player places and inspects buildings. Two kinds of settlement exist: **cities** (populated, general purpose, they grow) and **outposts** (small, specialized, placed for resource access or planetary coverage). The world is open in the sense that settlements are points on a continuous planet with expandable terrain around each, not instanced walled arenas.

---

## 1. Coordinate systems (three nested spaces)

The whole "travel from orbit into a city" experience is three coordinate spaces and the transitions between them. Get these right first; everything else sits on top.

### 1.1 Planetary space (macro)
A point on the sphere: `(lat, lon)` in radians, plus an elevation sample from the terrain. Used to place settlement markers on the macro globe and to sample the macro environment at that location (section 2). Convert to a 3D position for the orbital renderer:
```
x = R * cos(lat) * cos(lon)
y = R * sin(lat)
z = R * cos(lat) * sin(lon)
```

### 1.2 Settlement world space
Each settlement owns a local terrain patch: a bounded region of ground the city sits on. Origin at the settlement's planetary coordinate, local axes tangent to the sphere. For a single-planet game this can be a flat local plane (the curvature over a city-sized patch is negligible), which keeps the 2.5D math simple. The patch has a size (it can grow, section 4.3), and the buildable region is a subset of it.

### 1.3 Tile space (the build grid)
Integer tile coordinates `(tx, ty)` on the settlement's grid. Buildings occupy rectangular footprints in tiles (1x1, 2x2, 3x3). All placement, adjacency, and connectivity logic lives here. This is the only space gameplay logic needs; the other two are for placing and rendering.

### 1.4 The transitions (what "travel" means)
- **Orbit to city.** Player selects a marker and confirms travel. The camera animates from the globe down toward `(lat, lon)`, the city scene loads (its saved state deserializes, section 10), and control hands to the 2.5D camera. This is a scene load plus a camera move, not teleportation into a separate game. The macro sim keeps ticking underneath.
- **City to orbit.** Reverse. The city's state is flushed to the save, the scene unloads, the camera pulls back to the globe.
- **City to city.** Go to orbit, then into another marker. No direct city-to-city warp in the basic version; the orbit hop reinforces the sense of a planet.

Keep only the active settlement's full scene resident in memory. Inactive settlements are just their small state vectors, still ticking (section 9.3), never rendered.

---

## 2. The macro-micro coupling contract

This is the most important section. Two directions, both explicit, both cheap.

### 2.1 Macro to micro (environment gates and modifiers)
Each settlement samples the macro state at its `(lat, lon)` and gets the local environment. In the single-cell macro model (macro doc section 12), the sample is just the global values: `T`, `P`, `o2`, `ocean_frac` (water access), and the derived visuals. These do two things to the micro layer:

- **Gating.** A building type may require a macro condition to be buildable or operable. Example: an open-air farm is impossible until pressure and temperature are high enough; before that the player must use an enclosed greenhouse instead. Expressed as `building.canOperate(macro) -> bool`.
- **Efficiency modifiers.** Even when operable, output scales with the environment. A solar array's output scales with insolation (which the macro mirrors raise). A water extractor gets cheaper and stronger once liquid water exists nearby. Expressed as `building.efficiency(macro) -> multiplier`.

The payoff: as the planet terraforms, the player's existing cities visibly change. Domes can open up, life support demand falls, farms move outdoors, new building types unlock. The macro progress is felt directly at the micro scale. This is the emotional link between the two halves of the game.

### 2.2 Micro to macro (aggregated planetary output)
Some buildings produce a **planetary output**, a contribution to a macro forcing term. Every macro "player lever" from macro doc section 5 is realized this way:

| Macro forcing term (macro doc) | Realized as | Aggregates into macro term |
|---|---|---|
| GHG factory | GHG Factory building (ground) | `ghg` rate |
| Atmospheric processor | Atmosphere Processor building (ground) | `co2_atm` / `o2` rate |
| Cyanobacteria seeding | Biolab / seeder building (ground, later) | seeds `biomass` |
| Orbital mirror, solar shade, magnetic shield | orbital project launched from a Spaceport building | effective `S`, `shield_strength` |
| Nitrogen import, comet redirect | orbital project launched from a Spaceport building | `n2`, `h2o_ice` |

Each tick the macro sim asks the micro layer for the sum, across all settlements, of each planetary output type, and plugs those sums into its `facilityRates(...)` step. Formally:
```
macro.facilityRates[term] = sum over settlements s, over buildings b in s
                              of b.planetaryOutput[term] * b.count * b.efficiency(macro)
```
A building can have both a local output (feeds its own city) and a planetary output (feeds the planet), or just one. Most basic buildings are local-only; only a couple push the planet. That is deliberate: early cities are about surviving locally, and only later do they become terraforming engines.

Note the units bridge: micro building outputs that feed macro must be expressed in the macro's units (mbar/yr etc., macro doc section 3). The building definition carries the conversion.

### 2.3 The core game loop (nothing is built at macro, ever)

This is the intended flow of play, and it is a strict rule, not a suggestion: **the player never places a structure on the planet from the macro view.** The macro view is orbit. You look at the planet, you read its global state, you coordinate. All construction happens after you travel down into a settlement. The macro layer is a control room, the settlements are the factory floor.

A new settlement bootstraps in a fixed dependency order, because each step depends on the one before it. This chain is the moment-to-moment gameplay of the micro layer.

1. **Found the settlement.** From orbit, the player picks a site `(lat, lon)` and founds a city or an outpost. This is the one macro-initiated action, and it builds nothing: it drops an empty settlement (a claimed patch of grid) that the player then travels into. Site choice matters (resource access, later terraforming coverage), which is why founding is a macro decision even though construction is not.

2. **Seed from Earth (import phase).** A brand-new settlement produces nothing yet, so it cannot sustain itself. It survives on **imports from Earth** through its Spaceport link: shipped materials, and early life-support stock. The settlement is a net importer, dependent on Earth. This is the fragile opening every city passes through, and it is where the Spaceport (building #9) earns its place as the first thing that matters.

3. **Build energy (power phase).** Nothing else runs without power, so the first real construction is an energy source: a Solar Array, a Geothermal Plant, or a Reactor (building set, section 5). Geothermal is the workhorse mid-game baseload; solar is cheap but environment-dependent; the reactor is the heavy, steady backbone. Once power is flowing locally, the settlement can run production instead of importing everything.

4. **Build production and life support.** With power up, the player builds the local economy: Water Extractor, Greenhouse, Regolith Mine, Habitat Dome. Now the settlement feeds and houses itself and stops leaning on Earth. It has become **self-sufficient**: a net-zero colony that survives on its own output.

5. **Build the terraforming structures (planetary phase).** Only now, with a stable self-sufficient base and spare power, does the player build the structures that push the planet: Atmosphere Processors, GHG Factories, later Biolabs and Spaceport-launched orbital projects. These are the buildings whose output aggregates up into the macro sim (section 2.2). The city has graduated from surviving to terraforming.

The arc of a single city is therefore: **Earth-dependent -> self-sufficient -> planetary contributor.** Multiply that across many cities and outposts, each at a different point on the arc, and you get the texture of the whole game. Early cities are still importing while your veteran cities are running processor banks that visibly move the global gauges.

### 2.4 The macro layer's job during all of this

Because the macro layer builds nothing, its role is orchestration, and it becomes richer the more settlements exist. Concretely, from orbit the player:

- reads the global state and the aggregate of every settlement's planetary output (the sum in section 2.2),
- decides which settlements to prioritize for the limited Earth-import bandwidth (step 2 competes across all young cities at once),
- throttles whole subsystems up or down at the planetary scale (all Atmosphere Processors together, the mirror array together), without visiting each city,
- sets planetary targets and watches the aggregate work toward them,
- and catches overshoot on the global gauges before a runaway browns the biosphere.

This is exactly the "management and synergy layer" defined in macro doc section 5. The two docs describe the same seam from the two sides: the micro doc says *where the outputs are built*, the macro doc says *how their aggregate is managed*. Neither layer builds at the other's scale.

---

## 3. The 2.5D view (camera, grid, projection)

### 3.1 Projection
Standard isometric (2:1 dimetric). Tile to screen:
```
screenX = (tx - ty) * (TILE_W / 2)
screenY = (tx + ty) * (TILE_H / 2)
```
with `TILE_W = 2 * TILE_H` for the classic look. Depth sort by `(tx + ty)` so nearer tiles draw over farther ones. This is enough for a Clash-of-Clans read. True 3D with an isometric-locked camera is an option later if the WebGPU path (section 8) makes it free, but the tile logic stays identical either way.

### 3.2 Camera
Pan (drag), zoom (clamped range), no rotation in the basic version (fixed isometric angle, which is what the genre expects and what keeps art and sorting simple). Tap or click a building to select and open its inspector panel.

### 3.3 The grid and footprints
- A settlement grid is `W x H` tiles (start 32x32 for a city, 16x16 for an outpost).
- Each tile has a type (buildable ground, blocked terrain, reserved). Buildings place only on contiguous buildable tiles matching their footprint.
- A building occupies its footprint; those tiles become blocked. Removing it frees them.
- Placement validity: footprint fits, all tiles buildable and empty, and (section 6) any connectivity requirement met.

---

## 4. Cities and outposts

### 4.1 City
A populated, general-purpose settlement that grows.
- Has **population**, which needs housing, life support (power, water, oxygen, food) supplied every tick.
- Large grid, wide range of buildable types.
- Grows when there is surplus housing and a life-support surplus; stagnates or declines under shortfall.
- Purpose: the player's home bases, the places that both sustain people and (later) host the big planetary-output buildings.

### 4.2 Outpost
A small, specialized settlement, minimal or no permanent population.
- Small grid, restricted building set (usually one job: mining, atmosphere processing, research, relay).
- Cheaper and faster to establish than a city, and placeable in hostile spots a city could not survive, because it does not carry a population to keep alive.
- Purpose: reach resources and extend planetary coverage. An atmosphere-processor outpost near a polar cap, a mining outpost on an ore deposit, a relay outpost to extend grid/logistics range.

### 4.3 Open-world framing and expansion
Settlements are points on a continuous planet, not closed levels. The buildable region starts as a small area of the settlement's terrain patch and **expands** as the player claims more ground (a claim cost, or gated by population/tech). Beyond the claimed region the terrain is still visible, reinforcing that the city sits in a real place rather than a boxed arena. Expansion is the basic-version stand-in for "open world"; free-roam traversal of the full surface is out of scope for now (section 11).

---

## 5. The basic building set (grounded)

Ten types. Each maps to a real Mars-colony technology. This is the whole starting set; the game must work with only these. Values are abstract per-tick units, tuned later.

| # | Building | Real basis | Footprint | Consumes | Produces (local) | Planetary output | Notes / macro gating |
|---|---|---|---|---|---|---|---|
| 1 | Habitat Dome | Pressurized regolith-shielded habitat | 3x3 | power, water, oxygen, food | housing (population capacity) | none | Early: sealed. Late (`P`,`o2` high): needs far less life support, can "open". |
| 2 | Solar Array | Photovoltaic field | 2x2 | none | power | none | Cheap early power. Efficiency scales with effective insolation (macro mirrors raise it). Day/night later. |
| 3 | Geothermal Plant | Geothermal borehole heat | 2x2 | none | power (steady baseload) | none | The mid-game power workhorse. Independent of daylight; stronger where subsurface heat is high. The player's second bootstrap step after imports. |
| 4 | Reactor | Fission surface power | 2x2 | (fuel, later) | power (large, steady) | none | The heavy steady backbone; the "performative complexity" showpiece (macro doc follow-up). |
| 5 | Water Extractor | Subsurface ice / regolith water mining (MISWE-style) | 2x2 | power | water | none | Cheaper and stronger once liquid water exists (`ocean_frac` > 0). |
| 6 | Atmosphere Processor | MOXIE-style CO2 to O2, Sabatier | 2x2 | power, (CO2 from air) | oxygen (local) | `co2_atm` down, `o2` up | The main dual-output building: feeds the city AND terraforms the planet. |
| 7 | Greenhouse | Enclosed hydroponic agriculture | 2x2 | power, water | food | none | Later replaced/supplemented by open-air farms once macro allows. |
| 8 | Regolith Mine | ISRU excavation, regolith to materials | 2x2 | power | materials | none | Materials are the construction/upkeep resource. Best on ore-rich tiles. |
| 9 | Storage Depot | Water / O2 / material tanks and buffers | 1x1 | none | +capacity for stored resources | none | Buffers against shortfall; no production, raises the caps in section 7. |
| 10 | Spaceport | Landing pad, Earth/orbit link | 3x3 | power | imports (materials, life-support stock, later N2) | orbital projects it launches (mirror, shade, shield, N2, comet) | The Earth link that keeps a young city alive (loop step 2), the launch point for all orbital megaprojects, and the travel anchor. One per major city. |

Category coverage: housing (1), power (2,3,4), life support water/air/food (5,6,7), materials (8), buffering (9), external link and orbital launch (10). That is a closed, survivable loop, with the Reactor (4) carrying the visual showpiece and the Atmosphere Processor (6) plus the Spaceport (10) carrying the planetary coupling.

---

## 6. Micro resources and distribution

Keep the resource list short and the distribution model light. Solidity over realism here.

**Resources (per settlement):** `power`, `water`, `oxygen`, `food`, `materials`, `population`.

**Two classes, as in the reference games:**
- **Networked** (`power`, `water`, `oxygen`): distributed within the settlement. Basic-version model: a building is served if it is inside the settlement's serviced area (within range of the producing/relay network). Do not build a full pipe-routing puzzle now; a simple "connected to the settlement network" boolean per building is enough for the foundation. Pipe/cable routing can be added later without touching the sim.
- **Stored/hauled** (`materials`, `food`): accumulate in the settlement's stores up to a capacity (raised by Storage Depots), drawn down by consumers. No per-building transport logic in the basic version.

`population` is not produced or hauled; it is a state variable that changes via the growth rule (section 7.3).

---

## 7. The settlement simulation (the micro tick)

Mirror the macro tick discipline: derive, sum rates, integrate, clamp. One settlement per call; deterministic; serializable.

### 7.1 Per-resource balance
For each networked/stored resource `r`:
```
production_r  = sum over operable buildings of b.produces[r] * b.efficiency(macro)
consumption_r = sum over operable buildings of b.consumes[r]
net_r         = production_r - consumption_r
stored_r      = clamp(stored_r + net_r * dt, 0, capacity_r)
```
A building is **operable** this tick only if it is connected to the network (section 6) and its inputs are actually available (see 7.2) and it passes its macro gate (`canOperate`).

### 7.2 Shortfall handling
If a resource's store is empty and `net_r < 0`, there is a shortfall. Basic-version rule: buildings depending on the missing resource go non-operable this tick (a rolling brownout), and if the missing resource is a life-support one (`power`, `water`, `oxygen`, `food`) the settlement enters a **stress** state that harms population (7.3). No cascading disasters in the basic version; just clean, legible degradation the player can see and fix.

### 7.3 Population (cities only)
```
support = min over life-support resources of (stored_r > 0 ? 1 : 0)   // 1 if all supplied, else 0
housing = sum of Habitat Dome capacity
growth  = GROWTH_RATE * population * (1 - population / housing) * support
decline = DECLINE_RATE * population * (1 - support)
population = clamp(population + (growth - decline) * dt, 0, housing)
```
Logistic growth toward housing capacity while fully supported; decline while unsupported. Same S-curve philosophy as macro. Outposts skip this (population fixed at 0 or a small constant crew).

### 7.4 Tick order
```
function tickSettlement(s, macro, dt):
    env = sampleMacro(macro, s.lat, s.lon)          # 2.1
    for b in s.buildings: b.operable = isOperable(b, s, env)
    for r in RESOURCES: updateStore(s, r, env, dt)   # 7.1, 7.2
    if s.kind == CITY: updatePopulation(s, dt)        # 7.3
    s.planetaryOut = aggregatePlanetaryOutputs(s, env) # 2.2, read by macro
    return s
```
The macro sim reads `s.planetaryOut` from every settlement during its own tick. Micro and macro can tick at the same slow rate; neither needs the render framerate.

---

## 8. Rendering the 2.5D view

Kept deliberately light for the foundation, but aligned with the WebGPU/instancing direction from the presentation-layer discussion so nothing has to be thrown away.

- **Tiles and buildings are instanced.** One draw call for the ground grid, batched draws per building type. Per-instance data (tile position, status color, animation phase) in a storage buffer. This is what lets a dense city stay cheap.
- **Buildings are procedural parametric assemblies**, not hand-modeled meshes: a dome is a hemisphere plus a base ring; a reactor is a core plus towers plus pipes. A function builds each type, so new types are code, not art. Matches the macro follow-up on procedural buildings.
- **Aliveness is render-time, driven by state.** Reactor core brightness = load, coolant plumes = throughput, extractor arms move when operable. All read from the settlement state; none of it is stored or simulated. This is the "performative complexity" layer, and it stays purely presentation, so the sim and the save never grow.
- **Render frame is decoupled from sim tick.** The sim ticks slowly; the renderer interpolates and animates at 60fps. Same decoupling as the macro renderer.

Sprites-first is a valid shortcut for a very early prototype, but the instanced procedural path is the target because it scales to the density this genre wants.

---

## 9. Multiple settlements and time

### 9.1 Registry
The planet holds a list of settlements, each with its `(lat, lon)`, kind, and state. The macro globe renders one marker per settlement.

### 9.2 Active vs inactive
Only the settlement the player has traveled into is fully loaded and rendered. All others exist only as their small state vectors.

### 9.3 Everyone still ticks
Inactive settlements still run `tickSettlement` (they are cheap: no rendering, just arithmetic), so a mining outpost keeps producing and a city keeps growing while the player is elsewhere. Their `planetaryOut` keeps feeding the macro sim. This is what makes the planet feel like one running system rather than a set of separate levels.

### 9.4 Offline progression
Identical approach to macro doc section 8.2. On load, advance every settlement by the elapsed sim-time before showing anything. Because each settlement tick is a deterministic pure function, this is exact and cheap, and the save is just the state vectors plus the shared timestamp.

---

## 10. Save / serialization schema

Settlements are a list under the planet save (which already holds the macro state, macro doc section 11). Store only true state; recompute derived values and visuals on load.

```json
{
  "settlements": [
    {
      "id": "new-hellas",
      "kind": "city",
      "lat": -0.72, "lon": 1.31,
      "grid": { "w": 32, "h": 32, "claimed": [/* claimed tile rects */] },
      "population": 240.0,
      "stores": { "power": 0, "water": 1800, "oxygen": 900, "food": 1200, "materials": 5400 },
      "capacities": { "water": 3000, "oxygen": 2000, "food": 2000, "materials": 8000 },
      "buildings": [
        { "type": "habitat_dome",        "tx": 4,  "ty": 4,  "level": 1 },
        { "type": "solar_array",         "tx": 8,  "ty": 4,  "level": 1 },
        { "type": "atmosphere_processor","tx": 12, "ty": 6,  "level": 2 }
      ]
    },
    {
      "id": "cap-north-1",
      "kind": "outpost",
      "lat": 1.34, "lon": 0.10,
      "grid": { "w": 16, "h": 16, "claimed": [] },
      "population": 0,
      "stores": { "power": 0, "oxygen": 0, "materials": 400 },
      "capacities": { "oxygen": 1000, "materials": 1000 },
      "buildings": [
        { "type": "atmosphere_processor", "tx": 6, "ty": 6, "level": 3 }
      ]
    }
  ]
}
```

Notes:
- `power` is a flow, not really a store, but keeping a small buffer field keeps the resource loop uniform. Set its capacity from Storage Depots or to a small default.
- Never store `operable`, `efficiency`, production totals, or any visual. All re-derived from buildings + macro on load, so a tuning change applies to old saves.
- Building `level` is included now (cheap) even though upgrades are lightly specified, so the schema does not churn later.

---

## 11. Explicitly out of scope (for now)

Named so the foundation stays clean and the doc stays honest. Each is a later document.
- Combat, wars, raiding (the Clash-of-Clans attack loop). The view is inspired by that genre; the aggression is not in the basic game.
- Deep economy: trade, currency markets, supply chains between cities beyond the simple planetary aggregation.
- Individual named colonists and their needs/traits (the Surviving Mars model). Population is a scalar here.
- Full pipe/cable routing puzzles. Basic version uses a serviced-area boolean.
- Disasters, weather events at the city scale, random failures.
- Free-roam surface traversal between arbitrary points; travel is orbit-mediated marker-to-marker.
- Tech tree and detailed upgrade paths (the `level` field is a stub for it).
- Multiplayer.

---

## 12. Build order and next steps

1. Implement the three coordinate spaces and the transforms (section 1), plus a placeholder marker on the existing macro globe.
2. Implement one settlement as pure TypeScript: grid, the nine building definitions, the tick (section 7), the two-way macro coupling (section 2). No rendering. Verify a city survives, grows, and that an Atmosphere Processor's planetary output shows up in the macro sim's rate.
3. Wire the save schema (section 10) and prove offline progression on a settlement.
4. Build the 2.5D renderer against the tile/instancing model (section 8): ground grid, placement, procedural buildings, selection/inspector.
5. Wire the travel transition (orbit marker -> load city scene -> back), keeping macro ticking underneath.

Only after all five does adding a tenth building type or any section-11 feature make sense. Basics solid first.

---

## References (grounding for the building set)

- NASA / JPL ISRU work (MOXIE oxygen from CO2, MISWE and MARRS water extraction, Sabatier propellant/water). Water and oxygen infrastructure.
- Surviving Mars (Haemimont/Paradox). Domes, power grid, water/oxygen pipe networks, extractors, storage tanks, drones. Game-ified basic building set and grid/dome structure.
- Per Aspera (Raw Fury). Settlement buildings feeding a planetary terraforming layer (the micro-to-macro coupling model).
- Mars settlement architecture literature (regolith-shielded and 3D-printed habitats, HabNet life support, Starship base architecture: power, water extraction, radiation shielding, landing pads). Grounding for habitats, materials, and the spaceport.
