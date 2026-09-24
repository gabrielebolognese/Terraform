# Terraforming Game, Macro World Design Document

Version 0.1 (design draft). Scope: the planetary (macro) simulation for a single world (Mars as the first planet). This document defines the state model, the physics/math, the feedback loops, the progression phases, the update loop, the save schema, and a full tuning table. The micro (city / Clash-of-Clans) layer is out of scope here and is only referenced where the macro state feeds it.

---

## 0. Design goals and pacing philosophy

Three hard constraints drive every decision below.

1. **The simulation is pure calculation.** All state is a small vector of floating point numbers advanced by deterministic difference equations. The renderer is a read-only consumer of that state. Nothing visual ever writes back into the sim. This is what makes saving, offline progression, and the later city layer trivial: the whole world is `(state, dt) -> state`.

2. **Growth must be long, steady, and visible.** The pacing target is an S-curve, not a straight line and not a wall. Slow, legible start. An accelerating middle once feedback loops ignite. A long tail as the world settles toward Earth-like. At no point should the player stare at a frozen bar, and at no point should the planet flip from dead to alive in one step.

3. **The state must be visibly legible at all times.** The single biggest failure mode of terraforming games (Per Aspera is the cited example) is that the terraforming becomes cosmetic, a set of "colored keys" gating progress while the planet barely changes on screen. We avoid this by defining an explicit contract (section 9) mapping every sim variable to a visual channel, so that every tick of numeric progress produces a proportional, continuous change the player can see.

### Why an S-curve, and why feedback loops give it to us for free

The natural shape of coupled positive-feedback systems is logistic. On Mars this is not a game contrivance, it is the real physics (Zubrin and McKay, 1993): the CO2 sitting frozen in the polar caps and adsorbed in the regolith is released *as a function of temperature*. Warm the planet a little, some CO2 comes out, that CO2 thickens the atmosphere, the thicker atmosphere traps more heat, which warms the planet more, which releases more CO2. Past a tipping point the caps run away and dump their reservoir. That runaway is exactly the accelerating middle of our S-curve, and it is the emotional core of the macro game: the moment the player's early, patient investment suddenly pays off and the planet starts terraforming itself.

We therefore do not script the S-curve. We build the feedback loops and let the curve emerge. Tuning (section 10) sets where the tipping point sits and how violent the runaway is.

---

## 1. Reference models (what we borrow)

- **TerraGenesis.** Five global parameters (temperature, pressure, oxygen, water/sea level, biomass), each moved by per-time-unit rates from facilities, with habitability defined as threshold bands per parameter. We take the five-parameter spine and the "facilities apply rates" model.
- **Per Aspera.** Terraforming as ordered stages (warm, thicken, liquid water, ecopoiesis / seed life, oxygenate, buffer with nitrogen), with real feedback (warming releases CO2, water vapor adds greenhouse, too much O2 causes fires). We take the staged progression and the feedback coupling, and we deliberately fix its "cosmetic" weakness.
- **Terraforming Mars (board game).** Clean discrete global parameters with milestone steps (temperature track, oxygen %, ocean tiles). We take the idea of legible milestones the player is climbing toward.
- **Real science (Zubrin/McKay, Jakosky, McKay/Toon/Kasting).** Mars baseline numbers, the temperature-driven CO2 reservoir dynamics, and the honest ordering of what has to happen. We follow the physics in *shape* and diverge in *magnitude* where playability demands it (see the note in section 3).

---

## 2. Core state model

The planet's entire physical state is the vector below. Everything else (temperature, total pressure, habitability, all visuals) is *derived* from these each tick.

### 2.1 Reservoirs (the true state, all conserved quantities)

Gases are tracked as the pressure they would contribute if fully in the atmosphere (units: mbar; Earth sea level is ~1013 mbar). Tracking gas as pressure-equivalent means "how much CO2 is frozen in the caps" and "how much CO2 is in the air" use the same unit and can simply move between reservoirs.

| Symbol | Meaning | Unit | Mars start (example) |
|---|---|---|---|
| `co2_atm` | CO2 in the atmosphere | mbar | 6 |
| `co2_cap` | CO2 frozen in polar caps | mbar-eq | 40 |
| `co2_reg` | CO2 adsorbed in regolith | mbar-eq | 300 (TUNED from 120) |
| `n2` | Nitrogen (inert buffer) in atmosphere | mbar | 0.2 |
| `n2_reg` | Nitrate locked in regolith | mbar-eq | 20 (added: §3.6's "slow trickle" had no source) |
| `o2` | Oxygen in the atmosphere | mbar | 0.01 |
| `h2o_ice` | Water locked as ice (caps + subsurface) | m sea-level-eq | 40 |
| `h2o_liq` | Liquid water on the surface | m sea-level-eq | 0 |
| `h2o_vap` | Water vapor in the atmosphere | mbar | 0.0 |
| `ghg` | Engineered super-greenhouse gases (PFCs etc.) | mbar | 0 |
| `biomass` | Biosphere density | 0..1 index | 0 |

Notes:
- Water is tracked in "metres of sea-level equivalent" so that liquid water maps directly to ocean fill in the renderer. The split ice / liquid / vapor is the water cycle.
- `biomass` is a normalized index, not a mass, because gameplay only ever cares about it relative to a fully colonized biosphere (1.0).
- The three CO2 reservoirs are the heart of the runaway. Their sum is fixed unless the player imports or sequesters carbon — **or the biosphere fixes it**, which it does at scale: reaching the §2.3 oxygen target costs 288.8 mbar of carbon, and that price is set by stoichiometry and cannot be tuned. `co2_reg` was raised from 120 to 300 so the budget closes with room for the player to be wrong. The live start vector is `src/sim/planets/mars.ts`.

### 2.2 Derived quantities (recomputed every tick, never stored as truth)

| Symbol | Formula (see section 3) | Meaning |
|---|---|---|
| `P` | `co2_atm + n2 + o2 + h2o_vap + ghg` | Total surface pressure (mbar) |
| `albedo` | weighted by surface cover | Fraction of sunlight reflected |
| `T` | greenhouse model | Global mean surface temperature (K) |
| `ice_frac` | from `h2o_ice` and `co2_cap` | Fraction of surface under bright ice |
| `ocean_frac` | from `h2o_liq` | Fraction of surface under liquid water |
| `veg_frac` | from `biomass` | Fraction of land greened |
| `cloud_frac` | from `h2o_vap`, `T` | Cloud cover |
| `progress` | composite (section 8) | Overall terraform completion 0..1 |
| `phase` | thresholds (section 7) | Current progression stage |

### 2.3 Targets (Earth-like victory band)

| Quantity | Min habitable | Earth-like target |
|---|---|---|
| `T` | 273 K (liquid water) | 288 K (15 C) |
| `P` | 100 mbar | ~1013 mbar |
| `o2` partial | 100 mbar | ~210 mbar (about 21% of total) |
| `co2_atm` | below toxicity (< ~10 mbar) | ~1 mbar |
| `ocean_frac` | > 0 | 0.3 to 0.7 |
| `biomass` | > 0.2 | > 0.8 |

---

## 3. The physics and math

All equations are written as continuous rates. Section 6 discretizes them into the tick loop. Every constant in caps (like `C_GH`) lives in the tuning table (section 10).

> **Science vs playability note.** Real analyses (Jakosky and Edwards, 2018) conclude Mars very likely does *not* hold enough accessible CO2 to self-terraform to 1 bar, topping out near 15 to 30 mbar from caps plus regolith. The game keeps the *mechanism* (temperature-driven release, runaway feedback) but sets the reservoirs and import rates generously so the player can actually reach a living world. This is a deliberate, documented divergence.

### 3.1 Temperature (the greenhouse model)

Start from the airless radiative-equilibrium temperature, then add greenhouse warming on top.

**Radiative equilibrium (no atmosphere):**

```
T_eq = ( S * (1 - albedo) / (4 * SIGMA) ) ^ 0.25
```

- `S` = solar flux at the planet (Mars ~590 W/m^2; orbital mirrors raise the *effective* S).
- `SIGMA` = Stefan-Boltzmann constant, 5.67e-8.
- Sanity check with Mars start values: `S=590, albedo=0.25` gives `T_eq ~= 210 K`, which is Mars' real mean temperature. The model is self-consistent at t=0 with near-zero greenhouse.

**Greenhouse warming (added on top):**

```
dT_gh = C_GH * ln(1 + P / P_REF) * (1 + G_GHG * f_ghg)
```

- `P` = total pressure. Warming rises with the log of pressure, which is the physically correct diminishing-returns shape (each doubling adds a similar increment, not a runaway to infinity). This is what stops the late game from cooking itself.
- `f_ghg = ghg / P` = fraction of the atmosphere that is engineered super-greenhouse gas. `G_GHG` is large, so a tiny amount of PFC gives strong early warming when total pressure is still low. This is the player's kickstart lever before the caps ignite.
- Example constants that hit the targets: `P_REF = 50`, `C_GH = 25`. At `P = 1000` with no engineered GHG, `dT_gh = 25 * ln(21) ~= 76 K`, giving `T ~= 210 + 76 ~= 286 K`. Close to the 288 K target, the rest comes from albedo dropping as ice melts.

**Final temperature:**

```
T = T_eq + dT_gh
```

### 3.2 Albedo (the ice-melt feedback)

Albedo is the area-weighted reflectivity of the surface. Bright ice reflects, dark rock and ocean absorb. As the world warms and ice retreats, albedo drops, absorbing more sunlight, warming further. Positive feedback, folded straight into `T_eq`.

```
albedo = A_ICE   * ice_frac
       + A_OCEAN * ocean_frac
       + A_VEG   * veg_frac
       + A_BARE  * (1 - ice_frac - ocean_frac - veg_frac)
```

Example: `A_ICE = 0.6, A_OCEAN = 0.08, A_VEG = 0.18, A_BARE = 0.17`.

### 3.3 CO2 reservoir exchange (the runaway engine)

This is the single most important loop. CO2 moves from frozen reservoirs into the atmosphere at a rate that ramps up sharply once temperature crosses a sublimation threshold. Use a logistic (sigmoid) ramp so the transition is smooth but decisive.

```
sig(x) = 1 / (1 + exp(-x))

release_cap = R_CAP * sig( (T - T_SUBL_CAP) / W_CAP ) * step(co2_cap > 0)
release_reg = R_REG * sig( (T - T_SUBL_REG) / W_REG ) * step(co2_reg > 0)

d(co2_cap)/dt = -release_cap
d(co2_reg)/dt = -release_reg
d(co2_atm)/dt = +release_cap + release_reg  (plus player terms, minus biomass uptake, section 3.5)
```

- The caps have a lower threshold and smaller reservoir (they ignite first, fast). The regolith has a higher threshold and a much larger reservoir (a slower second wave that sustains the mid game).
- Example: `T_SUBL_CAP = 216 K, W_CAP = 6, R_CAP = 0.8 mbar/yr`; `T_SUBL_REG = 240 K, W_REG = 12, R_REG = 0.4 mbar/yr`.
- Because `co2_atm` feeds `P` feeds `dT_gh` feeds `T` feeds `release`, this closes the loop. The player's job early is to nudge `T` up to `T_SUBL_CAP` by any means (mirrors, GHG factories). After that, the planet takes over.

### 3.4 Water cycle

Ice melts to liquid above freezing, liquid evaporates to vapor as a function of temperature, vapor is itself a greenhouse gas (it contributes to `h2o_vap` inside `P`), and vapor rains back. All three feed the visuals (ice caps, oceans, clouds).

```
melt      = M_RATE * clamp01((T - 273) / W_MELT) * step(h2o_ice > 0) * gate_P
freeze    = F_RATE * clamp01((273 - T) / W_MELT) * step(h2o_liq > 0)
evaporate = E_RATE * sat(T) * step(h2o_liq > 0)
condense  = C_RATE * excess_vapor(T)

d(h2o_ice)/dt = -melt + freeze
d(h2o_liq)/dt = +melt - freeze - evaporate + condense
d(h2o_vap)/dt = +evaporate - condense   (converted to mbar via H2O_MBAR_PER_M)
```

- `gate_P` blocks melt when pressure is below the triple point (liquid water is not stable in near-vacuum). Below ~6 mbar, ice sublimates straight to vapor instead of melting. Simplify by gating melt on `P > P_TRIPLE (= 6.1 mbar)`.
- `sat(T)` is a saturation curve (a cheap Clausius-Clapeyron stand-in, monotonic increasing in T). Keep it a simple exponential; it does not need to be exact.

### 3.5 Biomass (ecopoiesis, the composition shifter)

Biomass cannot grow from nothing. The player must *seed* it (a facility/action that sets `biomass` to a small positive value). Once seeded, it grows logistically, but only to the extent the environment is suitable. Suitability is a product of per-factor gates, so any single unmet factor stalls life.

```
G_temp  = bell(T,  T_LIFE_LO, T_LIFE_HI)         // 1 in the comfortable band, 0 outside
G_water = clamp01(ocean_frac / OCEAN_FOR_LIFE)   // needs liquid water present
G_press = clamp01((P - P_LIFE_MIN) / (P_LIFE_OK - P_LIFE_MIN))
G_tox   = 1 - clamp01((o2/P - O2_FIRE_FRAC) / O2_FIRE_W)  // too much O2 -> fire risk penalty

G = G_temp * G_water * G_press * G_tox

d(biomass)/dt = R_BIO * biomass * (1 - biomass) * G   -   D_BIO * biomass * (1 - G)
```

- The first term is logistic growth scaled by suitability. The second is die-off when conditions are hostile (so a heat spike or an O2 fire can set the biosphere back, which the player sees as the planet browning).
- `bell(...)` is any smooth hump (Gaussian or raised cosine) that peaks inside the comfortable temperature band and falls off outside it.

**Composition exchange from biomass** (photosynthesis: consume CO2, emit O2):

```
photo = (positive part of d(biomass)/dt) + M_PHOTO * biomass   // growth + maintenance
d(o2)/dt      += Y_O2  * photo
d(co2_atm)/dt -= Y_CO2 * photo
```

This is what turns a thick CO2 atmosphere into a breathable one, and what turns the sky from butterscotch to blue over the long tail.

### 3.6 Nitrogen (the buffer, mostly imported)

You cannot make a 1 bar breathable atmosphere out of CO2 and O2 alone (both are toxic or combustible at those partial pressures). You need an inert buffer. Mars has almost none, so nitrogen is primarily a *player import* megaproject (redirected comets/asteroids rich in nitrates, or shipped N2).

```
d(n2)/dt = import_n2   // player-driven, plus a slow trickle from regolith nitrate processing
```

Nitrogen raises `P` (helping `dT_gh` via pressure broadening) without adding greenhouse forcing of its own and without toxicity. It is the main lever for the final pressure push to ~1 bar.

### 3.7 Atmospheric loss (the reason for the magnetic shield)

Mars has no magnetosphere, so the solar wind strips the atmosphere. Model a slow leak proportional to pressure, cancelled by an orbital magnetic-shield megaproject.

```
d(P_components)/dt -= LOSS_LAMBDA * P * (1 - shield_strength)
```

- `LOSS_LAMBDA` is small (loss is geologically slow), so early game the player ignores it. It exists to give the late game a maintenance concern and to justify the shield project. Distribute the loss across gas components proportionally.

---

## 4. The feedback loop map

Reading the loops as a graph (arrows are "increases"):

Positive (the engine, drives the accelerating middle):
- `T` -> CO2 release -> `co2_atm` -> `P` -> `dT_gh` -> `T`  (the runaway)
- `T` -> ice melt -> lower `albedo` -> higher `T_eq` -> `T`  (ice-albedo)
- `T` -> evaporation -> `h2o_vap` -> `P` and greenhouse -> `T`  (water vapor)

Negative (the brakes, produce the plateau and keep it stable):
- `P` -> `dT_gh` via `ln(1+P/P_REF)`  (logarithmic saturation, warming per unit pressure falls off)
- `biomass` -> consumes `co2_atm` -> less greenhouse -> slight cooling  (the biosphere self-regulates)
- high `o2` fraction -> fire penalty -> biomass die-off -> less O2  (oxygen self-limits)
- atmospheric loss -> lowers `P`  (slow bleed)

The design intent: the player manually pushes the system toward the first tipping point (get `T` to `T_SUBL_CAP`). The positive loops then take over and the planet visibly runs away. The negative loops catch it before it overshoots into a Venus, and settle it into the Earth-like band.

---

## 5. Player levers (macro facilities and megaprojects)

Each lever is a forcing function: it adds or subtracts a rate on one or more state variables. This mirrors TerraGenesis's model and keeps the sim uniform (facilities are just extra terms in the same difference equations). Facilities have a `count`, a `level`, and an `enabled` flag; their contribution scales with count and level.

| Lever | Primary effect | Notes |
|---|---|---|
| Orbital mirror array | raises effective `S` (so `T_eq`, `T`) | The main early warming lever. Can be dialed down later. |
| Solar shade / dust | lowers effective `S` | Cooling, for overshoot correction. |
| GHG factory (PFCs) | `+ghg` | Potent early kickstart; small mass, big `dT_gh`. |
| Atmospheric processor | `+co2_atm` (venting regolith directly) | Speeds thickening without waiting on temperature. |
| Comet redirect (water) | `+h2o_ice` | Imports volatiles; watch the flooding when it melts. |
| Nitrogen import | `+n2` | The late-game pressure/buffer push. |
| Cyanobacteria / lichen seeding | sets `biomass` > 0, boosts `R_BIO` locally | Ecopoiesis trigger. Cannot run below the temp/water gates. |
| Carbon scrubbers | `-co2_atm`, sequester | For drawing CO2 down once biomass and O2 are up. |
| Orbital magnetic shield | raises `shield_strength` | Cancels atmospheric loss; a capstone megaproject. |

Design rule: no lever should trivialize a whole axis instantly. Each moves a *rate*, so the planet still changes over time, preserving "visible steady growth." Costs and unlocks come from the economy/tech layer (out of scope here) but the levers themselves are defined above.

---

## 6. The update loop (tick algorithm)

Order matters because of the positive feedback. Compute all derived values from the *current* state first, compute all rates, then integrate once. Do not update a reservoir and then read it again in the same tick.

```
function tick(state, dt):
    # 1. Derive from current state
    P       = state.co2_atm + state.n2 + state.o2 + state.h2o_vap + state.ghg
    albedo  = computeAlbedo(state)
    T_eq    = (S_eff * (1 - albedo) / (4 * SIGMA)) ** 0.25
    f_ghg   = state.ghg / max(P, EPS)
    dT_gh   = C_GH * ln(1 + P / P_REF) * (1 + G_GHG * f_ghg)
    T       = T_eq + dT_gh

    # 2. Natural rates (functions of T, P, reservoirs)
    rates = {}
    rates += co2ReservoirExchange(state, T)     # section 3.3
    rates += waterCycle(state, T, P)            # section 3.4
    rates += biomass(state, T, P, ocean_frac)   # section 3.5
    rates += atmosphericLoss(state, P)          # section 3.7

    # 3. Player facility rates (sum over enabled facilities)
    rates += facilityRates(state.facilities)    # section 5

    # 4. Integrate (semi-implicit Euler with sub-stepping for stability)
    for i in 1..SUBSTEPS:
        state = integrate(state, rates, dt / SUBSTEPS)
        clampReservoirs(state)                  # no negative reservoirs, conserve totals

    # 5. Recompute visuals from new state
    state.visual = deriveVisuals(state, T, P)   # section 9

    # 6. Phase transitions
    state.phase = evaluatePhase(state, T, P)    # section 7
    state.progress = computeProgress(state, T, P)  # section 8

    return state
```

**Stability warning.** The runaway loop is a stiff positive feedback. A large `dt` with plain Euler will overshoot and oscillate or explode. Two cheap defenses: (a) sub-step the integration (`SUBSTEPS` inner steps per tick), and (b) clamp each rate to a sane per-tick maximum. RK4 is available if needed but Euler with 4 to 8 substeps is usually enough. This matters specifically for offline fast-forward (section 8.2).

---

## 7. Progression phases (the visible milestones)

Phases are derived from thresholds, not scripted. Each phase entry unlocks tech and, critically, changes what the player sees. This is the backbone of "visible growth."

| Phase | Name | Entry condition (approx) | What the player sees |
|---|---|---|---|
| 0 | Barren | start | Butterscotch dusty sky, large bright CO2 frost caps, red-ochre dead surface, no water. |
| 1 | Warming | `T > 200 K` and rising | Mirrors/GHG online. Caps begin to shrink at the edges. Faint haze thickening. |
| 2 | Runaway thickening | `T > T_SUBL_CAP` (caps igniting) | Caps visibly retreat fast, dust storms, sky darkens/deepens as pressure climbs. The "it's happening" moment. |
| 3 | First water | `T > 273 K` and `P > 100 mbar` | Liquid pools appear in the low basins, first thin lakes, first clouds forming over them. |
| 4 | Ecopoiesis | `biomass > 0.05` after seeding | First green-brown tint spreading from water edges. O2 begins its slow climb. |
| 5 | Oxygenation and buffer | `o2 > 50 mbar` and N2 import active | Sky shifts butterscotch -> pale -> blue, oceans fill and connect, cloud decks thicken, green spreads across land. |
| 6 | Living world | `T`,`P`,`o2`,`ocean_frac`,`biomass` all in target band | Earth-like: blue sky, white clouds, blue oceans, green continents, weather. Micro-scale cities become inspectable (hook to the city layer). |

The phase order intentionally matches the real scientific ordering (warm, thicken, liquid water, seed life, oxygenate, buffer) so the science and the game teach the same thing.

---

## 8. Progress metric, time, and offline catch-up

### 8.1 Composite progress

A single 0..1 number for the main progress bar and for pacing checks. Use a weighted geometric mean of the normalized sub-goals so that the player cannot ignore an axis (a zero on any axis tanks the whole score, which is realistic: a warm planet with no water is not habitable).

```
n_T     = clamp01((T - 210) / (288 - 210))
n_P     = clamp01(P / 1013)
n_O2    = clamp01(o2 / 210)
n_water = clamp01(ocean_frac / 0.4)
n_bio   = clamp01(biomass / 0.8)

progress = ( n_T^wT * n_P^wP * n_O2^wO2 * n_water^wW * n_bio^wB ) ^ (1 / (wT+wP+wO2+wW+wB))
```

Weights let you decide how much each axis counts. Start them all equal, then tune so the bar climbs at a satisfying, near-constant visual pace across a full playthrough.

### 8.2 Time mapping and offline progression

- The sim advances in **sim-years**. One real second maps to `TIME_SCALE` sim-years (a player-facing speed control: pause, 1x, fast). All rates above are per sim-year.
- Because the sim is a deterministic pure function, **offline progression is free**: on load, compute `elapsed_real = now - last_saved`, convert to sim-years, and advance the sim by that much before showing the planet. For long absences do not loop millions of tiny ticks; use a coarser `dt` with more substeps, or cap the catch-up and show a "while you were away" summary. Determinism is the requirement that makes this correct and cheap: you save a state vector plus a timestamp, never an event log.
- Guard the catch-up against the stiffness warning in section 6: a coarse offline `dt` is exactly where the runaway loop can overshoot, so keep substep count high during fast-forward.

Pacing target to tune toward: a full Barren -> Living World run should take on the order of tens of real hours of active/idle play (adjust `TIME_SCALE` and the rate constants together), with a visible change to the planet at least every few real minutes at 1x. The geometric progress bar should never sit still for more than a few minutes.

---

## 9. Visualization contract (sim state -> renderer)

The renderer reads only these derived channels. This is the wall between simulation and graphics: change the sim internals freely as long as this contract holds, and the city layer later reads the same channels.

| Visual channel | Source | Mapping |
|---|---|---|
| Polar ice cap size | `co2_cap`, `h2o_ice` | cap radius scales with reservoir remaining |
| Ocean coverage | `ocean_frac` (from `h2o_liq`) | water shader fills basins from low elevation up |
| Surface greenness | `veg_frac` (from `biomass`) | green tint blended onto land, spreading from water edges |
| Atmosphere thickness / rim glow | `P` | thicker atmosphere = brighter limb, more haze |
| Sky / atmosphere color | composition: `co2_atm`,`h2o_vap` vs `o2+n2` | interpolate butterscotch (dusty CO2) -> pale -> blue (clear O2/N2), driven by clear-fraction |
| Cloud cover | `cloud_frac` (from `h2o_vap`, `T`) | cloud layer opacity and extent |
| Surface warmth tint | `T` | subtle frost-blue (cold) to warm-neutral (temperate) |
| Dust storm intensity | rate of `co2` release, low `ocean_frac` | particle/haze bursts during rapid thickening (phase 2) |

All of these are continuous functions of continuous state, which is what makes the growth look *slow and alive* rather than snapping between discrete looks at phase boundaries. Phases change tech and UI; the visuals move continuously underneath them.

---

## 10. Tuning table (all constants in one place)

Balance the whole game from here. **These are the tuned values**, produced by the balance batch and
measured — see `docs/balance/batch3-balance.md` for what each change bought. Values marked `TUNED`
differ from the v0.1 draft; the reasoning for each lives in the comment beside it in
`src/sim/tuning.ts`, which is the normative copy. A test asserts every constant exported there
appears here, so this table cannot silently go stale.

The three initial reservoir amounts the draft listed here (`co2_cap0`, `co2_reg0`, `h2o_ice0`) are
the planet's start vector and live in `src/sim/planets/mars.ts`, not the tuning table.

**Constants (physical):**

```
SIGMA = 5.67e-8        # Stefan-Boltzmann
S_MARS = 590           # W/m^2 baseline solar flux
P_TRIPLE = 6.1         # mbar, water triple point gate
P_TRIPLE_W = 2         # mbar, smoothstep width above it
T_FREEZE = 273.15      # K
```

**Temperature / greenhouse:**

```
C_GH = 25              # greenhouse strength
P_REF = 50             # mbar, greenhouse pressure reference
C_GHG = 6              # TUNED, replaces G_GHG: engineered-GHG forcing, additive in its own log
GHG_REF = 0.1          # mbar, column reference for that term
GHG_DECAY = 0.0005     # /yr, photolysis of engineered gases
N2_GREENHOUSE_WEIGHT = 0.6   # TUNED from 1.0 - section 3.6's prose against section 3.1's equation
A_ICE = 0.6  A_OCEAN = 0.08  A_VEG = 0.18  A_BARE = 0.17  A_CLOUD = 0.45
ALBEDO_MIN = 0.02  ALBEDO_MAX = 0.95  ALBEDO_ABSORB_MIN = 0.05
S_EFF_MIN = 1          # W/m^2 floor
T_FLOOR_K = 3  T_CEIL_K = 1000
```

**Surface cover maps** (the four fractions section 2.2 names and never defines):

```
ICE_FRAC_MAX = 0.85  ICE_M_REF = 270  CO2_CAP_REF = 400
OCEAN_FRAC_MAX = 0.75  OCEAN_M_REF = 60
VEG_EXP = 0.7
CLOUD_FRAC_MAX = 0.85  CLOUD_VAP_REF = 1.7
```

**CO2 reservoirs (the runaway):**

```
T_SUBL_CAP = 216   W_CAP = 10   R_CAP = 0.8    # W_CAP TUNED from 6
T_SUBL_REG = 230   W_REG = 12   R_REG = 1.0    # both TUNED - the two waves did not overlap
SIG_CUT = 0.5          # renormalised sigmoid cut; at 0.5 the ramp is exactly tanh
CO2_DEPLETE_SCALE = 2  # mbar, depletion ramp
```

**Water cycle:**

```
M_RATE = 0.5   F_RATE = 0.5   W_MELT = 5
H2O_MBAR_PER_M = 37.11       # TUNED from 0.1 - rho*g/100, the draft was wrong by 371x
E_SAT_REF = 6.112  L_OVER_RV = 5420  SAT_MAX_MBAR = 1e6
VAP_COL_FRAC = 0.2   K_VAP = 4        # TUNED, replaces E_RATE/C_RATE: saturation relaxation
SUBL_RATE = 0.05   T_SUBL_H2O = 190   W_SUBL_H2O = 30
H2O_DEPLETE_SCALE = 1        # TUNED from 0.2 - a depleting reservoir gave up 62% per substep
```

**Biomass:**

```
R_BIO = 0.75   D_BIO = 0.1          # R_BIO TUNED from 0.15: b* = 1 - M_PHOTO/R_BIO
OCEAN_FOR_LIFE = 0.05
T_LIFE_LO = 278  T_LIFE_HI = 313  T_LIFE_EDGE_W = 8
P_LIFE_MIN = 100  P_LIFE_OK = 300
O2_FIRE_FRAC = 0.3  O2_FIRE_W = 0.1
Y_CO2 = 2.5   Y_O2 = 1.818182       # Y_O2 TUNED: Y_CO2 * 32/44, fixed by stoichiometry
M_PHOTO = 0.11                      # TUNED from 0.05
MAINTENANCE_GATE = 1                # NEW - closes the carbon loop; see section 3.5
CO2_FOR_LIFE = 0.5   CO2_FLOOR = 0.01
BIOMASS_REFUGIA = 0.0001   SEED_AMOUNT = 0.02
```

**Nitrogen:**

```
R_N2 = 0.02   T_NITRATE = 255   W_N2 = 15
```

**Player levers (section 5):**

```
FACILITY_MAX_COUNT = 50   FACILITY_MAX_LEVEL = 5
FACILITY_BUILD_RATE = 0.5      # units/yr; what makes section 5's design rule true of the env levers
MIN_PHASE_CROSS_YEARS = 25     # the design rule, as a number a test can check
MIRROR_S_PER_UNIT = 0.004   SHADE_S_PER_UNIT = 0.004
GHG_FACTORY_PER_UNIT = 0.0004  ATMO_PROCESSOR_PER_UNIT = 0.02
COMET_ICE_PER_UNIT = 0.004     N2_IMPORT_PER_UNIT = 0.035
SCRUBBER_PER_UNIT = 0.02
FACILITY_DEPLETE_SCALE = 6     # facility draws are far larger than natural ones
S_MULTIPLIER_MIN = 0.05        # a shade stack may cool the planet, not switch the sun off
SHIELD_PER_UNIT = 0.004   SHIELD_BUILD_RATE = 0.05
P_FLOOR = 8   P_FLOOR_W = 2    # under any lever that removes atmosphere
```

**Atmospheric loss:**

```
LOSS_LAMBDA = 5e-5     # TUNED from 5e-4 - at the draft value the bleed was the dominant term
```

**Progress metric (section 8.1):**

```
W_T = 1  W_P = 1  W_O2 = 1  W_WATER = 1  W_BIO = 1
W_CO2 = 1              # NEW sixth axis - section 2.3 has six rows, section 8.1 had five
CO2_PROG_HI = 1013     # mbar; the axis measures composition, not absolute amount
PROGRESS_FLOOR = 0.1   # TUNED from 0.02
```

**Phase thresholds (section 7):**

```
PHASE3_P_MIN = 100   PHASE4_BIO = 0.05
PHASE5_O2 = 50       PHASE5_N2 = 50    # PHASE5_N2 NEW - the buffer half of the Phase 5 condition
```

**Integration and time:**

```
SUBSTEP_YEARS = 0.25          # TUNED, replaces SUBSTEPS = 4..8: fix the SIZE, derive the COUNT
MAX_SUBSTEPS_PER_TICK = 2048
CATCHUP_MAX_SIM_YEARS = 100000   # WORK cap: bounds load-screen milliseconds
OFFLINE_CAP_HOURS = 8            # DESIGN cap: only the first stretch of an absence counts
OFFLINE_RATE_FACTOR = 0.15       # the world runs slower while nobody is watching
FLUX_ASSERT_MAX_FRAC = 0.25   FACILITY_ASSERT_HEADROOM = 0.9
RESERVOIR_ZERO_EPS = 1e-12    P_EPS = 1e-9
TIME_SCALE = 0.03             # TUNED from "to taste": 15.8 real hours for a full playthrough
```

**Seeded world events (section 12.2) — NEW in Batch 8:**

Off by default. Enabling them perturbs every trajectory, so the golden frames, the Batch 3 balance
sweep and a dozen exactness tests all run with `EVENTS_ENABLED = 0`; a driver opts in by passing a
tuning variant. None of these constants existed when this table was written — section 12.2 asked for
seeded events without saying how often or how hard.

```
EVENTS_ENABLED = 0         # 0/1; a driver opts in, defaultConfig() does not

DUST_STORM_RATE = 0.067    # per year, ~1 in 15. Mars' real rate would leave a storm always running
DUST_STORM_YEARS_MIN = 0.5    DUST_STORM_YEARS_MAX = 3
DUST_STORM_ALBEDO = 0.08   # peak albedo added by the strongest storm; a few K of cooling

COMET_IMPACT_RATE = 0.004     # per year, ~1 in 250
COMET_DELIVERY_YEARS = 1      # an impulse has no rate; every flow here is a rate
COMET_WATER_METRES = 0.4      # metres SLE delivered by the largest impact
COMET_VAPOUR_FRACTION = 0.25  # arrives as vapour, not ice - section 12.2's "heat pulse", DERIVED
COMET_DUST_ALBEDO = 0.03      # ejecta, briefly

SOLAR_VARIABILITY = 0.005     # peak fractional deviation; the order of the real solar cycle
SOLAR_CYCLE_SHORT = 11   SOLAR_CYCLE_MID = 87   SOLAR_CYCLE_LONG = 413   # incommensurable, sim-years
```

**The macro → micro habitat contract (section 12.3) — NEW in Batch 9:**

The gates that decide where a settlement stands without a pressure dome. Deliberately *not* the
section 2.3 victory band: that describes an Earth-like planet, this describes a survivable one, and
they are different questions. Two of these are real physical thresholds rather than tuned ones.

```
HAB_T_MIN = 271     HAB_T_WIDTH = 3     # ramps are NARROW: `ramp` reaches only ~0.74 one width out
HAB_P_MIN = 62      HAB_P_WIDTH = 6     # the Armstrong limit: below ~60 mbar body fluids boil
HAB_O2_MIN = 120    HAB_O2_WIDTH = 12   # partial pressure a person can work in, ~4 km altitude
HAB_CO2_MAX = 10    HAB_CO2_WIDTH = 2   # section 2.3's toxicity ceiling, with a soft edge
HAB_WATER_MIN = 0.12   HAB_WATER_WIDTH = 0.06
HAB_SEALED_BASE = 0.12   # what sealed habitats support with no open air - never zero
HAB_MASK_WEIGHT = 0.48   # the mid-game tier: outside in a mask. The largest of the three
```

**Economy and tech (section 11's `economy`, filled) — NEW in Batch 9:**

Both off by default. Costs change what a player can build and when, so enabling them silently would
invalidate the Batch 3 balance, the golden frames and the reference trajectory. Income is proportional
to `supportIndex` from the habitat contract above, which is what makes the macro → micro bridge
load-bearing rather than decorative.

```
ECONOMY_ENABLED = 0     TECH_GATE_ENABLED = 0

ECON_STARTING_CREDITS = 3000   # a serious first move; nowhere near the build-out
ECON_INCOME_PER_SUPPORT = 360  # TUNED: a saving player wins at 1860 vs 1710 without costs
ECON_COST_GROWTH = 1.06        # each unit dearer than the last; doubles by about the twelfth
ECON_LEVEL_COST = 1.6          # multiplier per level above 1
ECON_UPKEEP_FRACTION = 0.005   # per DEPLOYED unit; the ceiling on how much can be kept running

COST_MIRROR = 240          COST_SHADE = 260        COST_GHG_FACTORY = 300
COST_ATMO_PROCESSOR = 520  COST_COMET_REDIRECT = 1400
COST_N2_IMPORT = 900       COST_SEEDING = 400      COST_SCRUBBER = 700
COST_SHIELD = 1800         # the capstone megaproject, priced like one

# Micro layer geometry (micro-world.md sections 1.3 and 3.3; Batch 17)
TILE_METRES = 10           # one build tile; a 32-tile city is 320 m across
CITY_GRID_TILES = 32       # a city starts on a 32 x 32 grid
OUTPOST_GRID_TILES = 16    # an outpost on 16 x 16
METROPOLIS_GRID_TILES = 96 # a metropolis: 3 x 3 a city's ground
TERRAIN_RELIEF_M = 0       # Batch 22: local relief, metres either side of the base; OFF (flat) by default, the browser opts in
TERRAIN_FEATURE_TILES = 10 # hill size, tiles per noise cell; at 12 m relief, 16.1% of ground too steep (measured)
TERRAIN_CLEAR_TILES = 4    # half-width of the levelled landing zone at the centre
TERRAIN_MAX_SLOPE = 0.15   # steepest buildable ground, rise over run to a neighbouring tile

# The planet's hypsometry (detail §1.1, §4.1; Batch 22). Metres at rank k/8 of the shared elevation field.
HYPSO_ELEV_0 = -8200       HYPSO_ELEV_1 = -4600       HYPSO_ELEV_2 = -4100
HYPSO_ELEV_3 = -3000       HYPSO_ELEV_4 = -1000       HYPSO_ELEV_5 = 500
HYPSO_ELEV_6 = 1600        HYPSO_ELEV_7 = 3000        HYPSO_ELEV_8 = 8000

# Flooding (detail §4.2, §4.3; Batch 24). OFF by default; the browser opts in with the forecast.
FLOODING_ENABLED = 0
FLOOD_WARN_MARGIN_M = 20     # warning begins with the sea this far below the base
FLOOD_THRESHOLD_M = 10       # the sea this far above the base declares the settlement lost
FLOOD_BUILDING_LOSS_M = 2    # a building is lost with this much water over its highest tile

# Roads and the settlement network (micro §6, §7.1). OFF by default; the browser opts in.
NETWORK_ENABLED = 0          # a building runs only if its network holds a producer of what it draws
COST_CORRIDOR = 1            # materials per corridor tile (carries water, oxygen, food, materials)
COST_CABLE = 1               # materials per power cable tile (carries power)

# Headquarters, rovers and rockets. OFF by default; the browser opts in. Sim-years (0.03 = 1 real second at 1x).
HEADQUARTERS_ENABLED = 0     # found each settlement with a 5x5 headquarters, and a city with one spaceport
HQ_OXYGEN = 5                HQ_WATER = 3                ROVERS_PER_HQ = 3
ROVER_YEARS_PER_TILE = 0.015 ROVER_WORK_YEARS_LOOSE = 0.09  ROVER_WORK_YEARS_CRAG = 0.3
ROCK_LOOSE_MATERIALS = 1     ROCK_CRAG_MATERIALS = 5     ROCK_LOOSE_SHARE = 0.08
ROCKET_TRIP_YEARS = 1.8      ROCKET_MATERIALS = 20

# The settlement simulation (micro-world.md sections 5-7; Batch 18). Per sim-year.
SETTLEMENTS_ENABLED = 0    # OFF by default; the browser opts in when there is UI for it
MICRO_GROWTH_RATE = 0.1    MICRO_DECLINE_RATE = 0.2   MICRO_SEED_POPULATION = 4
MICRO_CAP_POWER = 5        MICRO_CAP_WATER = 40       MICRO_CAP_OXYGEN = 40
MICRO_CAP_FOOD = 40        MICRO_CAP_MATERIALS = 400
FOUND_MATERIALS = 250      FOUND_LIFE_SUPPORT = 30
COST_HABITAT_DOME = 60     COST_SOLAR_ARRAY = 20      COST_GEOTHERMAL_PLANT = 50
COST_REACTOR = 150         COST_WATER_EXTRACTOR = 30  COST_ATMOSPHERE_PROCESSOR = 60
COST_GREENHOUSE = 30       COST_REGOLITH_MINE = 25    COST_STORAGE_DEPOT = 10
COST_SPACEPORT = 80
DOME_HOUSING = 40          DOME_POWER = 3             DOME_WATER = 2
DOME_OXYGEN = 2            DOME_FOOD = 2              DOME_OPEN_RELIEF = 0.75
SOLAR_POWER = 6            GEOTHERMAL_POWER = 8       REACTOR_POWER = 24
EXTRACTOR_POWER = 2        EXTRACTOR_WATER = 5
PROCESSOR_POWER = 5        PROCESSOR_OXYGEN = 4
PROCESSOR_CO2_DRAW = 0.05  # mbar/yr of planetary CO2 per building; MOXIE, O2 at 32/88 of it
PROCESSOR_MIN_CO2 = 1      PROCESSOR_MAX_DRAW_FRAC = 0.1
MOXIE_O2_PER_CO2 = 32/88   # 2 CO2 -> 2 CO + O2, by mass
GREENHOUSE_POWER = 2       GREENHOUSE_WATER = 1       GREENHOUSE_FOOD = 4
MINE_POWER = 3             MINE_MATERIALS = 5
DEPOT_POWER = 10           DEPOT_WATER = 60           DEPOT_OXYGEN = 60
DEPOT_FOOD = 60            DEPOT_MATERIALS = 200
SPACEPORT_POWER = 2        SPACEPORT_MATERIALS = 3    SPACEPORT_LIFE_SUPPORT = 1
```

---

## 11. Save / serialization schema

Because the sim is deterministic, a save is just the state vector, the facilities, some meta, and a timestamp. No event log. One JSON blob per planet maps cleanly to one row (local-first: IndexedDB or a single SQLite row; the shape is the same).

```json
{
  "schema_version": 1,
  "planet_id": "mars",
  "seed": 123456,
  "sim_year": 184.5,
  "last_saved_real": "2026-09-21T10:00:00Z",
  "phase": 3,
  "reservoirs": {
    "co2_atm": 210.4, "co2_cap": 2.1, "co2_reg": 88.0,
    "n2": 30.0, "o2": 4.2, "ghg": 1.1,
    "h2o_ice": 22.0, "h2o_liq": 15.5, "h2o_vap": 3.0,
    "biomass": 0.12
  },
  "facilities": [
    { "type": "orbital_mirror", "count": 4, "level": 2, "enabled": true },
    { "type": "ghg_factory",    "count": 2, "level": 1, "enabled": true }
  ],
  "shield_strength": 0.0,
  "tech_unlocked": ["mirrors", "ghg", "atmo_processor"],
  "economy": { "credits": 12500, "materials": 3400 }
}
```

Design notes:
- `sim_year` + `last_saved_real` together drive offline catch-up (section 8.2).
- Store *only* reservoirs. Never store derived values (`T`, `P`, visuals); recompute them on load so a tuning change to constants retroactively applies to old saves instead of baking in stale numbers.
- `schema_version` gates migrations when the state shape changes.
- `economy` is a placeholder; the economy/tech layer is a separate document.

---

## 12. Open questions and next steps

Decisions to lock before implementation:
1. **Spatial resolution.** This document models the planet as a single well-mixed cell (all quantities are global averages). That is enough for the macro visuals (a sphere whose global look changes) and is far simpler and more stable. A regional grid (per-latitude bands or a coarse hex map) would let ice retreat from the equator first and oceans fill specific basins, at real cost in complexity and tuning. Recommendation: ship single-cell first, add banding later purely as a visual embellishment driven by the same globals.
2. **Determinism of "random" events** (dust storms, comet impacts). Keep them seeded from `seed` + `sim_year` so offline catch-up stays reproducible.
3. **How the city (micro) layer reads the macro state.** Suggested: cities consume the same derived channels (local `T`, `P`, `o2`, water access) as environmental inputs, so a city's viable footprint grows as the planet terraforms. That keeps the two layers coupled through the one contract in section 9.

Suggested build order from here:
1. Implement the state vector, the derived functions (section 3), and the tick loop (section 6) as pure TypeScript with zero rendering. Log the numbers.
2. Write a headless "fast-forward N years" harness and plot `T`, `P`, `progress` over time. Tune the constants until the S-curve looks right and a full run lands in the target duration. This is where the game is actually balanced, before any pixels exist.
3. Wire the save schema (section 11) and offline catch-up.
4. Only then build the macro renderer against the section 9 contract.

---

## References (for the science and the game models)

- Zubrin, R. and McKay, C. (1993). *Technological Requirements for Terraforming Mars.* (CO2 vapor-pressure feedback, reservoir dynamics, Mars baseline.)
- McKay, C., Toon, O., Kasting, J. (1991). *Making Mars Habitable.* Nature 352.
- Jakosky, B. and Edwards, C. (2018). *Inventory of CO2 available for terraforming Mars.* Nature Astronomy. (The "not enough native CO2" finding the game deliberately relaxes.)
- TerraGenesis (Edgeworks/Tilting Point). Five-parameter model, facility rates, habitability bands.
- Per Aspera (Raw Fury). Staged terraforming, feedback loops, O2 fire and flooding hazards.
- Terraforming Mars (board game, FryxGames). Discrete global-parameter milestone tracks.
