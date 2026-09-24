# Terraforming Game, Micro World Detailed Design

Version 0.1. Scope: the detailed micro layer. This adds the four systems that make the city view real: **terrain with depth** (a heightmap), **procedural 3D structures** (complex, not detailed), **resource acquisition** (tied to the terrain), and **flooding** (the headline feature, driven by macro sea level rise). It extends the foundational `terraforming-micro-design.md`; the coordinate systems, the settlement tick, the macro-micro coupling, and the save discipline from that doc all still hold and are only added to here, never replaced.

The load-bearing new idea: **the map has elevation.** Everything below depends on it. Structures sit on it, resources are distributed across it, and flooding is water rising up it. So terrain comes first.

---

## 1. Terrain and depth

The old micro doc treated the settlement grid as flat tiles with a type. That is upgraded to a heightmap: every tile has an elevation. This is what gives the 2.5D view its depth and what makes placement, resources, and flooding into real decisions.

### 1.1 Two elevation layers (this distinction is critical for flooding)

- **Planetary base elevation** `base_elev_m`: the absolute elevation of the settlement's origin on the planet's global datum (the areoid, Mars' equivalent of sea level zero). Sampled from the planetary terrain at the settlement's `(lat, lon)` when it is founded. This single number decides how flood-prone the whole city is. A city founded in a basin has a low `base_elev_m`; one on a plateau has a high one.
- **Local heightmap** `local_height[tx][ty]`: the elevation of each tile *relative to* `base_elev_m`, within the settlement's patch. Gives the city its own hills, slopes, and low corners. Small range (tens of metres across a city patch), unlike the planetary range (kilometres).

Absolute elevation of any tile:
```
tile_abs_elev(tx, ty) = base_elev_m + local_height[tx][ty]
```
Flooding (section 4) compares the global sea level to these absolute elevations. Nothing else needs the absolute frame; placement and rendering use the local frame.

### 1.2 Procedural generation, stored as a seed

Both layers are generated procedurally and deterministically, so they are stored as a seed plus a few parameters, not as a grid of numbers. Regenerated identically on load. This keeps the save tiny and matches the project rule "store only the true state, re-derive the rest."

```
seed_terrain = hash(planet_seed, lat, lon)
base_elev_m  = samplePlanetaryTerrain(lat, lon)          // from the macro planet's terrain
local_height = generateHeightmap(seed_terrain, W, H)     // e.g. layered value/simplex noise
```
`generateHeightmap` is layered noise (a few octaves) plus optional features (a crater rim, a central basin, a subsurface-ice lens that also seeds a water resource, section 3). Keep the local relief modest so the grid stays buildable; dramatic relief is the planetary layer's job.

### 1.3 Tiles, slope, and placement

Each tile now carries `{ local_height, slope, type, resource? }`. Placement rules extend the foundational ones:
- A building footprint must fit on tiles whose slope is below a buildable maximum, OR the player terraces first (a cheap flatten action that averages the footprint's tiles to one height and costs materials). Terracing is the local, manual counterpart to planetary terraforming and gives the player something to do with a lumpy site.
- Elevation is shown at founding and at placement (a contour or color ramp), because after flooding exists, elevation is the single most important thing about a site.

### 1.4 Save additions

Add to each settlement (foundational doc section 10):
```json
{
  "seed_terrain": 774411,
  "base_elev_m": -1850.0,
  "terraces": [ /* explicit height overrides where the player flattened */ ]
}
```
`local_height` itself is never stored (regenerated from `seed_terrain`); only player edits (`terraces`) are, since those are true state the seed cannot reproduce.

---

## 2. Procedural structures (complex, not detailed)

The requirement: buildings must **look at least 3D** and read as **complex, but not detailed**. Those are two different axes and the distinction is the whole design.

- **Complexity** is part count and silhouette variety. Many distinct masses, pipes, tanks, struts, vents. This is what says "advanced machine."
- **Detail** is surface fidelity: high-poly curves, fine textures, normal maps. Expensive, and not what this genre or this art direction needs.

We maximize complexity and deliberately keep detail low. The technique that does this is **greebling**: covering a simple form with many small mechanical bits to imply a complex machine. High part count, low per-part fidelity. Cheap, procedural, and exactly the look asked for.

### 2.1 Approach: real 3D, isometric-locked camera

Build actual 3D low-poly geometry and view it through an **orthographic camera locked to a fixed isometric angle**. This gives the Clash of Clans read while being genuinely 3D (so buildings can have real height, real occlusion, animated moving parts), which is what "at least look 3D" means. The tile logic from the foundational doc is unchanged; only the render is 3D instead of sprite.

### 2.2 Parametric assembly (how a building is generated)

Every building is assembled by a function from three layers, driven by a seeded PRNG so each instance varies deterministically:

```
generateBuilding(type, seed, level):
    rng = mulberry32(seed)
    parts = []

    # Layer 1: foundation. A slab matching the footprint, terraced to the tile heights.
    parts.push(slab(footprintTiles))

    # Layer 2: signature masses. The readable identity of the type (section 2.3).
    #          3 to 6 primitive masses (box, cylinder, cone, hemisphere) composed.
    parts.push(...SIGNATURE[type](rng, level))

    # Layer 3: greebles. Many small bits scattered on the signature masses' surfaces.
    #          Count scales with level, so upgrades visibly accrete complexity.
    greebleBudget = GREEBLE_BASE[type] + level * GREEBLE_PER_LEVEL
    for i in 0..greebleBudget:
        host = rng.pick(signatureMasses)
        parts.push(greeble(rng, host))     # pipe, tank, vent, strut, panel, antenna, ladder

    return assemble(parts)                  # -> instance list (section 2.5), not a baked mesh
```

Greeble primitives are a tiny fixed palette: short pipe segment, small cylinder tank, box vent, thin strut, flat panel, antenna rod. Six or seven meshes. Scattering dozens of them across a form is what produces "complex." None of them are detailed.

### 2.3 Per-type signatures (the readable silhouettes)

Each of the ten buildings (foundational doc section 5) gets a signature so the player reads type at a glance despite procedural variation. Signature = the 3 to 6 primitive masses in Layer 2. Examples:

| Building | Signature masses |
|---|---|
| Habitat Dome | large hemisphere on a low cylinder ring, airlock box, a couple of radial corridor stubs |
| Solar Array | a field of thin tilted panel quads on short posts, one control box |
| Geothermal Plant | squat cylinder body, two lean pipe stacks, a vented cap, condensation drum |
| Reactor | central cylinder core (emissive), two tapered cooling towers, ringed pipework |
| Water Extractor | tall drill/derrick tower over a pump housing, holding drum |
| Atmosphere Processor | wide intake cylinder, tall exhaust stack, gas drum cluster |
| Greenhouse | long low vaulted (half-cylinder) glass hall, end equipment box |
| Regolith Mine | angled conveyor ramp into a hopper, excavator arm, spoil pile |
| Storage Depot | one to three tanks (cylinders/spheres) on a bund slab |
| Spaceport | flat circular landing pad, gantry tower, fuel tanks, blast trench |

Signatures are still parametric (the reactor's tower count, height, and pipe routing vary by seed), but the archetype is fixed, so silhouettes stay legible.

### 2.4 Complexity scales with level

`greebleBudget` grows with building level, so an upgraded building literally becomes more complex: more pipes, more tanks, taller stacks, extra towers. This ties the visual complexity directly to progression, so the player sees their base grow more elaborate as it matures, at zero art cost.

### 2.5 Rendering: primitive-instancing (the performance crux)

Do not bake one mesh per building. Instead keep a small **palette of primitive meshes** (box, cylinder, cone, hemisphere, quad, plus the greeble set: roughly 12 to 15 meshes total) and represent every building as a list of instances:

```
Instance = { primitiveId, transform (mat4), colorId, animId }
```
Render by iterating the palette and drawing all instances of each primitive across the entire city in one instanced draw call, with per-instance data (transform, color, anim phase) in a GPU storage buffer. A whole dense city then costs on the order of 12 to 15 draw calls regardless of building count. This is the same instancing architecture from the performative-complexity discussion, and it is what lets you scatter tens of thousands of greeble instances and stay at 60fps.

Determinism and caching: a given `(type, level, seed)` always produces the same instance list, so generate it once and cache it. Store only the seed in the save (section 1.4 style); regenerate the geometry on load. The building's look is reproducible without storing any geometry.

Materials: a small flat palette (brushed metal, painted panel, concrete, glass/emissive, warning-accent) indexed by `colorId`, lit with simple directional light plus ambient. No textures required for v1. Emissive parts (reactor core, window glow) and animated parts (rotating vents, moving drill, pulsing core, particle flow along pipes) are driven at render time from the settlement's live state (load, throughput), adding aliveness and yet more apparent complexity for free.

### 2.6 Where to get the (art) resources

Because generation is procedural, you need almost no external art assets. The full asset requirement for v1 is: the ~15 primitive meshes (all authored in code or trivially in any modeler) and a color palette. That is it. If you later want richer props without modeling them yourself, Kenney's CC0 low-poly space/city kits (glTF, no licensing strings) drop straight into the same instance system as extra palette entries. But the design does not depend on any of that; the buildings are code.

---

## 3. Resources (where to get them)

"Where to get resources" resolves into three sources, and the terrain from section 1 is what makes the first one a real decision.

### 3.1 Terrain deposits (siting matters)

Resource deposits are scattered across the settlement's heightmap procedurally (seeded, so deterministic and save-cheap). A tile may carry a deposit that boosts the matching extractor placed on it:

| Deposit | Boosts | Typical location |
|---|---|---|
| Ore / metal vein | Regolith Mine (materials) | ridges, crater rims |
| Subsurface ice lens | Water Extractor (water) | low basins, poleward sites |
| Geothermal vent | Geothermal Plant (power) | fault lines, volcanic tiles |
| High-insolation flat | Solar Array (power) | flat, high, unshadowed tiles |

This makes placement a real choice: a Regolith Mine on a bare ridge yields far more than one on a plain, so the player reads the terrain and sites deliberately. It also sets up the central tension with flooding (section 4): the richest ice and the easiest water sit in the low basins, which are exactly the tiles that drown first.

Deposits are stored as part of the terrain seed (regenerated, not enumerated in the save) unless depletion is modeled, in which case only the depleted amount is stored (true state).

### 3.2 Imports (the opening) and ambient (the payoff)

- **Imports** through the Spaceport (Earth link) are the bootstrap source before local extraction is running, per the game loop (foundational doc section 2.3, step 2). Costly, finite bandwidth, and competed for across young cities (managed from the macro layer).
- **Ambient / macro-derived** sources grow as the planet terraforms. Once liquid water exists, Water Extractors get cheaper and stronger everywhere (they no longer need a deposit); once insolation rises from orbital mirrors, Solar Arrays produce more. The macro-to-micro efficiency modifiers (foundational doc section 2.1) are this channel. So terraforming gradually frees the player from both imports and deposit-hunting, which is the economic reward arc that parallels the environmental one.

### 3.3 The arc

Early: import everything, then chase deposits and site carefully on the terrain. Late: the terraformed planet supplies water and light ambiently, deposits matter less, and cities run on their surroundings. Resource strategy loosens exactly as the environment improves, which is the same shape as every other system in the game.

---

## 4. Flooding (the headline feature)

Terraforming raises water. That is the goal. But raising water raises the sea, and the sea drowns low ground. So the player's own success threatens the cities they built early, when the smart move was to build low near ice and water. Flooding turns that early convenience into a long-term liability, and forces the player to read elevation and plan for a coastline that keeps rising. It is the sharpest link between the macro and micro layers.

### 4.1 Sea level from macro (hypsometry)

The macro sim tracks `ocean_frac` (fraction of the planet's surface under liquid water) and its rate. Convert that to an absolute sea level elevation through the planet's **hypsometric curve**, the mapping from "how much of the surface is submerged" to "what elevation the waterline sits at." Mars' real hypsometry is bimodal (northern lowlands, southern highlands); for the game a monotonic designer curve is enough:

```
sea_level_m = seaLevelCurve(ocean_frac)     // monotonic, from deepest basin up
```
`seaLevelCurve` is a few control points over the planet's elevation range (for Mars, roughly the -8 km basins up through the datum and beyond; tunable). As `ocean_frac` climbs during terraforming, `sea_level_m` climbs with it. Its rate follows directly:
```
d(sea_level_m)/dt = seaLevelCurve'(ocean_frac) * d(ocean_frac)/dt
```
This rate is what powers the flood forecast (section 4.4).

### 4.2 The flood model

For each settlement, the water's height above its ground datum is:
```
effective_base = base_elev_m + dike_height          // dikes raise the datum, section 4.5
flood_depth    = sea_level_m - effective_base
```
Per tile, a tile is underwater when the sea is above its absolute elevation:
```
tile_flooded(tx,ty) = sea_level_m > (base_elev_m + local_height[tx][ty])
```
Low tiles flood first, so a city drowns from its low corner inward, visibly, over time, not all at once.

### 4.3 City flood states and the +10 m destruction threshold

Four states, driven by `flood_depth`. The +10 m total-loss threshold is the requested hard rule; the states before it are the visible, fair ramp up to it.

| State | Condition | Effect |
|---|---|---|
| Dry | `flood_depth < -WARN_MARGIN` | Normal. Sea safely below the city. |
| Warning | `-WARN_MARGIN <= flood_depth < 0` | Sea approaching the base. Alert raised, forecast shown (4.4). Nothing flooded yet. |
| Partial flood | `0 <= flood_depth < FLOOD_THRESHOLD` | Water is above the base. Low tiles submerge one by one; buildings on submerged tiles go offline, then are lost. Production penalties climb with depth. Player can still act. |
| Declared flooded | `flood_depth >= FLOOD_THRESHOLD (= 10 m)` | The city is declared flooded. Everything is destroyed and the settlement is lost. |

`WARN_MARGIN` (for example 20 m) is how far below the base the sea can be before warnings begin. `FLOOD_THRESHOLD = 10 m` is the point of no return, per your spec. Between 0 and 10 m the player watches the water rise through the city and lives with escalating damage, which is where the drama and the agency both live.

### 4.4 Forecasting (fair because the sim is deterministic)

Because the sim is a deterministic function of state, the game can extrapolate exactly when each city crosses each threshold, and warn well ahead:
```
years_to_base    = (effective_base           - sea_level_m) / d(sea_level_m)/dt
years_to_destroy = (effective_base + 10      - sea_level_m) / d(sea_level_m)/dt
```
Surface these on the macro overview ("New Hellas: submersion begins in ~14 yr, total loss in ~31 yr at current rate"). The forecast updates as the player throttles terraforming, so slowing the water buys measured time. This makes flooding a planned-for event, not a gotcha, which fits the whole "visible, legible" philosophy.

### 4.5 Mitigation and agency

Flooding must be survivable through good play, not purely punitive. The levers:
- **Placement.** The primary defense, chosen at founding. Elevation is shown; building high trades resource convenience for safety. This is the core strategic decision the whole feature exists to create.
- **Dikes / seawall (building).** Raises `dike_height`, lifting the effective base and buying height (and therefore years). A finite, material-costly holding action, not a permanent fix, since the sea keeps rising. Good for protecting a valuable mature city long enough to extract its worth.
- **Terracing.** Raising individual tiles (section 1.3) can lift key buildings above the early waterline, delaying their loss during partial flood.
- **Relocation / evacuation.** Before total loss, evacuate population (preserve the people, abandon the structures) or pay to relocate the city. Losing the buildings but saving the colonists is a legitimate, cheaper outcome than losing everything.
- **Throttle the planet.** From the macro layer, slowing water-raising subsystems slows `d(sea_level_m)/dt` globally, buying time for all threatened cities at once, at the cost of terraforming pace. This is a genuine macro-scale decision the flood system creates: how fast do you dare terraform when your own cities are in the flood path.

### 4.6 Visualization

The map's depth makes this render itself. Draw a translucent water plane at `sea_level_m` (in the settlement's absolute frame) intersecting the heightmap. Tiles below the plane read as submerged; the shoreline is simply the plane-terrain intersection and moves inland as the plane rises. Buildings on flooded tiles show rising water, then damage, then are gone. A slowly, continuously rising plane over many minutes is precisely the "slow, visible growth" aesthetic applied to a threat instead of to progress.

### 4.7 Save and state changes

- Flood *state* is derived every tick from `sea_level_m` vs elevations; it is never stored.
- Flood *consequences* are true state and are persisted: buildings removed by flooding, `dike_height`, terraces, and a `destroyed` flag (with the sea level at which it fell, for the record) when a settlement is declared flooded.
- On offline catch-up, run the sea level forward and apply any threshold crossings that occurred while away, so a player who ignored a warning can return to a lost city. The "while you were away" summary should call this out prominently.

---

## 5. How it ties together (the strategic arc)

The four systems compose into one loop. The **terrain** gives the map elevation and scatters **resources**, so the player sites early cities low, near ice and ore, for a fast economic start. Those cities build the **procedural structures** that (via the coupling) terraform the planet. Terraforming raises `ocean_frac`, which raises `sea_level_m`, which begins **flooding** the very low cities that started the whole thing. The player, warned by the deterministic forecast, decides city by city whether to wall it, terrace it, evacuate it, or let it go, and whether to throttle the planet to buy time. Success and self-inflicted loss come from the same rising water. That is the game.

---

## 6. Build order for these features

1. Add the two-layer elevation to the settlement model (section 1): `base_elev_m` sampled from the planet, `local_height` from a stored seed. Render the grid with height. No new buildings yet.
2. Add `seaLevelCurve` to the macro layer and expose `sea_level_m` and its rate as derived outputs.
3. Implement the flood model (section 4.2 to 4.3) headless: compute `flood_depth`, tile flooding, state, and building loss, and assert a low test city drowns as sea level rises. This is the highest-value feature; prove it in numbers before rendering.
4. Add the forecast (4.4) and wire warnings into the macro overview.
5. Build the procedural structure generator and the primitive-instancing renderer (section 2). Start with three signatures (dome, reactor, extractor) to validate the look, then fill in the rest.
6. Add terrain resource deposits (section 3.1) and siting bonuses.
7. Add mitigation: dikes, terracing, evacuation, and the macro throttle-for-time link (section 4.5), plus the rising water-plane visualization (4.6).

Numbers first (steps 1 to 4), then the look (5 to 7), same as every other part of this project.

---

## References

- Mars hypsometry and the crustal dichotomy (northern lowlands vs southern highlands; elevation range from the Hellas basin to Olympus Mons). Grounding for `seaLevelCurve` and the elevation range.
- Greebling as a procedural technique for implied mechanical complexity at low fidelity (film-model and demoscene practice).
- Kenney.nl CC0 low-poly space/city asset kits, optional palette extensions for the instancing system.
- Surviving Mars, Per Aspera: terrain siting and environmental hazards to colonies, as gameplay reference.
