# Economy, tech, and the macro → micro bridge

Version 1.0. Scope: the credit economy, the tech tree, and the contract the city (micro) layer reads
the planet through. Companion to [`macro-world.md`](macro-world.md), which this assumes throughout —
section references without a document name refer to that one.

This is the document the build plan reserved for Batch 9, written last on purpose: everything above it
had to be balanced *without* an economy first, or the economy would have been used to paper over a
pacing problem instead of fixing it.

---

## 1. The shape of the thing

Three pieces, and one loop that connects them:

```
          §12.3 habitat contract              economy                tech tree
   planet ──────────────────────▶ supportIndex ──▶ credits ──▶ facilities ──▶ planet
                                                      ▲            │
                                                      └── upkeep ──┘
                                        phase ─────────────────▶ what may be built at all
```

Terraform the planet → it supports more people → they generate more income → you can build more →
you terraform faster. That is §4's feedback structure expressed economically, and it is why the
macro → micro bridge is **load-bearing rather than decorative**: income is a function of the same
contract a city layer will read, so a real city layer can replace the stand-in without the loop
changing shape.

Two brakes stop it running away: **upkeep** scales with the estate while income is capped by
habitability, and the **tech tree** refuses to sell you a lever the planet is not ready for.

## 2. The macro → micro contract (§12.3)

§12.3's open question is *"how the city (micro) layer reads the macro state"*, and its recommendation
is that cities "consume the same derived channels (local `T`, `P`, `o2`, water access) as
environmental inputs, so a city's viable footprint grows as the planet terraforms".

`habitat(reservoirs, derived, tuning) -> HabitatChannels` is that contract. It is deliberately the
**same shape as §9's visual contract**: a small struct of numbers, derived fresh every read, never
stored, never written back. §9 is the wall between the simulation and the graphics; this is the wall
between the simulation and the city layer. Neither wall has a door.

**Why not just hand cities `Derived`?** Because `Derived` is the simulation's own working set — it
carries `pGreenhouse`, `iceFrac`, `albedo`, things a city has no business knowing and that would pin
the macro internals the moment a city read one. A separate, smaller contract lets the physics be
rewritten underneath, exactly as §9 promises for the renderer.

### 2.1 The channels

| Field | Meaning |
|---|---|
| `temperature`, `pressure`, `oxygen`, `carbonDioxide` | §12.3's readings, in the doc's own units |
| `waterAccess` | 0..1, liquid water within reach |
| `insolation` | sunlight at the ground relative to bare Mars: 1 untouched, higher under mirrors (Batch 18, for the Solar Array) |
| `maskFraction` | 0..1, where you can go outside in a breathing mask |
| `openAirFraction` | 0..1, where you can go outside with nothing |
| `supportIndex` | 0..1, what a city scales its capacity by |

### 2.2 Three tiers, and why one gate was wrong

The first version had a single all-or-nothing `openAirFraction`: warm enough, above the Armstrong
limit, breathable oxygen, non-toxic CO2, water in reach — all at once. It was wrong, and measurably
so. Breathable oxygen only arrives in the last third of a playthrough, so `supportIndex` **sat at its
floor for the whole game and then jumped**, and §12.3 asks for a footprint that *grows*.

So there are three tiers:

- **Sealed** — always available, low capacity. `HAB_SEALED_BASE = 0.12`.
- **Mask** — warmth, pressure above the Armstrong limit, and water. No oxygen needed, because a mask
  carries it. Opens mid-game, and carries the largest weight (`HAB_MASK_WEIGHT = 0.48`) because it is
  the tier that funds the second half of the terraforming.
- **Open air** — the mask tier plus breathable oxygen and CO2 under §2.3's toxicity ceiling.

The guard against regressing to one gate is a test, not a comment: *support must have covered a
quarter of its range by the halfway point of a run*. Collapsing the tiers back into one gate leaves it
at 3×10⁻¹² of its span, and the test fails.

### 2.3 Two real thresholds, not tuned ones

`HAB_P_MIN = 62` mbar is the **Armstrong limit**: below roughly 60 mbar, body fluids boil at body
temperature and no amount of oxygen helps. `HAB_O2_MIN = 120` mbar is about the partial pressure a
person can work in, roughly four kilometres of altitude. Neither is a balance knob, which is why the
ramps around them are narrow.

### 2.4 Water access is a band, not a level

A planet that is 90% ocean is not twice as good to live on as one that is 45% — it is worse, because
the land is gone. `waterAccess` peaks inside §2.3's ocean band and falls away on both sides, using the
same band the victory condition does.

### 2.5 What a city layer may assume

Every field finite. Every 0..1 field genuinely in 0..1. `supportIndex` **strictly positive even on a
dead planet** — there are colonists on day one, under domes, or there is nobody to order the mirrors,
and a city layer may divide by it. All four are asserted across a full playthrough in
`habitat.test.ts` rather than promised here.

**Weather is deliberately excluded.** A dust storm is a §9 visual and a few kelvin, not a reason to
evacuate. If it reached this contract a city's capacity would wobble every time the wind got up, and
any city layer would have to smooth it back out.

## 3. The economy

### 3.1 Income

`income = ECON_INCOME_PER_SUPPORT × supportIndex` credits per sim-year, accrued **per substep**. Per
substep rather than per call for the same reason the environment is: a planet that becomes more
habitable halfway through a chunk should earn more for the second half, and charging once per call
would make the balance depend on how the caller split the time. `advance(s, 4000)` must equal a
thousand `advance(s, 4)` calls exactly, and the wallet is part of the state that has to match.

### 3.2 Costs escalate

`orderCost` charges `baseCost × ECON_COST_GROWTH^unit`, on the **delta** from what is already owned.

Escalation, not a flat price, because a flat price means the right play is always "buy the maximum of
whatever is cheapest per unit of effect", which is not a decision. At 1.06 the price doubles by about
the twelfth unit, which turns "how much of this, versus some of that" into the actual question.

Scaling **down** is always free and never refused — a player must be able to retire a lever they can
no longer afford to run. Nothing is refunded: mirrors already under construction are not resaleable.

### 3.3 Upkeep is the ceiling

`ECON_UPKEEP_FRACTION` of base cost per year, per **deployed** unit — you pay for what is running, so
a half-built array is cheaper than a finished one.

This is the constant that stops unlimited over-building: upkeep grows with the estate while income is
capped by habitability, so there is a ceiling on what can be kept running. It is also the constant
this batch got most wrong. At 0.012 the ceiling bound so hard that a scripted player with **189,000
credits banked could not fund a single extra processor** — the entire income went on maintenance — and
the game stalled at 68% progress forever. 0.005 leaves the ceiling real but reachable.

Credits can be driven to zero by upkeep but never below. A debt mechanic would need a debt *system*,
and a negative balance that silently blocks every order is worse than an upkeep that cannot be paid.

### 3.4 Tuned against a player who saves

`REFERENCE_POLICY` is a fixed schedule of orders by year — the right instrument for balancing physics
and the wrong one for balancing an economy, since it buys thirty mirrors on day one, which is exactly
what costs exist to prevent.

`ECONOMY_PLAN` and `spendDown` in the harness are the instrument for this: a priority list and a bank
balance, that **saves** rather than spending down to the cheapest available item. A player who always
buys the cheapest thing is not a player, it is a leak. The gaps where it waits for money *are* the
economy's pacing, and an instrument that ignored them would measure a game nobody plays.

Sweep, all at `ECON_STARTING_CREDITS = 3000`:

| income | upkeep | wins at | shield units |
|---|---|---|---|
| 320 | 0.012 | **never** (stalls at 68%) | 0 |
| 320 | 0.005 | 1905 | 5 |
| 360 | 0.005 | **1860** | 6 |
| 360 | 0.006 | 1890 | 4 |
| 400 | 0.005 | 1830 | 7 |

Shipped: **360 / 0.005**, for a win at sim-year 1860 against **1710** with the economy off. About 9%
slower — the economy costs *time*, and does not become a different game. That is the intent: it adds
decisions, not a rebalance.

## 4. The tech tree

Every lever sits behind exactly one tech, and every tech is granted by reaching a **latched phase**.
`economy.test.ts` asserts the "exactly one" part — a facility behind no tech would be silently always
available, and one behind two would have an ambiguous gate.

| Phase | Tech | Unlocks |
|---|---|---|
| 0 Barren | Orbital optics | mirrors, shades |
| 0 Barren | Halocarbon synthesis | greenhouse factory |
| 1 Warming | Regolith processing | atmospheric processor |
| 2 Runaway thickening | Volatile capture | comet redirect |
| 3 First water | Ecopoiesis | biosphere seeding |
| 4 Ecopoiesis | Buffer gas logistics | nitrogen import |
| 5 Oxygenation | Carbon sequestration | carbon scrubber |
| 5 Oxygenation | Magnetospheric engineering | magnetic shield |

**Why phase and not credits.** A research tree where credits buy nodes lets a player bank money
through the early game and unlock the endgame levers before the planet is anywhere near ready for
them — which is precisely what §7's phase ordering exists to prevent. The doc is explicit that the
phases "intentionally match the real scientific ordering… so the science and the game teach the same
thing". So the economy decides *how much* you can build, the tech tree decides *what*, and the planet
decides *when*.

**Unlocks never reverse**, because they follow `phaseReached` rather than the instantaneous phase. A
dust storm cooling the planet out of a phase must not confiscate a technology.

**The gate reads `techUnlocked`, not the phase.** A world loaded from an older save must behave as it
did when it was written; deriving the gate fresh would quietly re-gate it against whatever the tree
says today.

## 5. Both halves ship off

`ECONOMY_ENABLED = 0` and `TECH_GATE_ENABLED = 0` in the default tuning. Costs change what a player
can build and when, so enabling them silently would invalidate the Batch 3 balance, the twelve golden
frames, and the reference trajectory that a dozen exactness tests are written against.

The browser enables both. They are **tuning constants rather than `SimConfig` fields** so the balance
sweep can reach them, and so enabling is `makeTuning({ ECONOMY_ENABLED: 1 })` rather than a new
config surface. A test asserts that with the economy off, a full run leaves the wallet byte-identical
to its starting state — this batch is invisible unless asked for.

## 6. Save schema v3

`economy` stops being §11's `unknown` placeholder and becomes `{ credits, earned, spent }`.

A **v2 → v3 migration** handles worlds played before this batch. Two decisions in it are worth
stating:

- A v2 world arrives with the **starting balance**, not with zero. It was played without costs;
  dropping it into a priced world with an empty wallet would strand a player who did nothing wrong,
  and there is no honest way to reconstruct what they would have banked.
- `tech_unlocked` is **rebuilt from the latched phase**, because v2 never wrote one and an empty list
  would leave a phase-5 world unable to build the levers it already owns. It is granted exactly the
  tech that phase has earned, and not one node more.

## 7. What a city layer should do next

The bridge exists; the city layer does not. When it is built:

- Read `HabitatChannels` and nothing else from the macro sim. The wall is the point.
- Replace the stand-in population model — right now `supportIndex` *is* the population model, and
  income is linear in it. A real city layer owns that curve; the macro side should keep providing
  only the environment.
- Do not write back. Cities consume the planet's state; if a city ever needs to change it, that is a
  facility, and facilities already have a path through `Flow`.
- `openAirFraction` and `maskFraction` are the two numbers a build-placement rule wants. They are
  global fractions, not maps — §12.1's "spatial resolution" question is still open, and the contract
  stays global until it is answered.
