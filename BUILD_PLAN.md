# Terraforming Game — Batched Build Plan

Source of truth for *what* we are building: [`docs/design/macro-world.md`](docs/design/macro-world.md) (Macro World Design Document v0.1). The settlement layer is specified in [`docs/design/micro-world.md`](docs/design/micro-world.md) (Batches 17-21).
This file is the source of truth for *in what order* we build it, and for what "done" means at each step.

**Rule: one batch at a time.** A batch is not started until the previous batch's exit gate is green. Every batch ends with `npm run typecheck` and `npm test` passing, and with something the developer can see or measure.

| Batch | Name | Status |
|---|---|---|
| 1 | Sim core + live inspector | **COMPLETE** — [calibration note](docs/balance/batch1-calibration.md) |
| 2 | Player levers (facilities & megaprojects) | **COMPLETE** — [levers note](docs/balance/batch2-levers.md) |
| 3 | Balance & pacing calibration | **COMPLETE** — [balance report](docs/balance/batch3-balance.md) |
| 4 | Persistence & offline catch-up | **COMPLETE** — [persistence note](docs/balance/batch4-persistence.md) |
| 5 | Visualization contract | **COMPLETE** — [contract note](docs/balance/batch5-visual-contract.md) |
| 6 | Macro renderer (the planet) | **COMPLETE** - [renderer note](docs/balance/batch6-renderer.md) |
| 7 | Game shell UI | **COMPLETE** - [shell note](docs/balance/batch7-shell.md) |
| 8 | Seeded events & determinism hardening | **COMPLETE** - [events note](docs/balance/batch8-events.md) |
| 9 | Economy / tech layer + city-layer bridge | **COMPLETE** - [economy design](docs/design/economy.md), [batch note](docs/balance/batch9-economy.md) |
| 10 | Adversarial review of Batches 3-9 | **COMPLETE** - [review](docs/balance/batch10-review.md) - 5 defects found and fixed |
| 11 | Endgame legibility | **COMPLETE** - [batch note](docs/balance/batch11-endgame-legibility.md) - the "flat last third" was a renderer gap, not pacing |
| 12 | The oxygen tail | **COMPLETE (negative result)** - [batch note](docs/balance/batch12-oxygen-tail.md) - no rebalance shipped; every faster tail breaks §0.3 at the end |
| 13 | Adversarial review of Batches 1-2, 11, 12 | **COMPLETE** - [review](docs/balance/batch13-review.md) - 8 defects fixed; the worst was Batch 12's own test change |
| 14 | Review of Batch 13's fixes | **COMPLETE** - [review](docs/balance/batch14-review.md) - 3 of Batch 13's fixes were themselves defective; all fixed, plus 3 latent sim items |
| 15 | Full-screen globe | **COMPLETE** - [note](docs/balance/batch15-globe.md) - graphics only; overrides Batch 6's "the planet does not rotate" at the user's request |
| 16 | Build panel | **COMPLETE** - [note](docs/balance/batch16-build-panel.md) - every lever in the HUD; one definition of "order one more" |
| 17 | Micro: coordinate spaces + settlement markers | **COMPLETE** - [note](docs/balance/batch17-micro-coordinates.md) - founding from orbit; registry saved as schema v4 |
| 18 | Micro: one settlement as pure TypeScript + the two-way coupling | **COMPLETE** - [note](docs/balance/batch18-settlement-sim.md) - behind SETTLEMENTS_ENABLED=0; a city bootstraps and grows, processors move the planet |
| 19 | Micro: settlement save schema + offline progression | **COMPLETE** - [note](docs/balance/batch19-settlement-save.md) - schema v5; round trip and offline catch-up exact; capacities and grid deliberately not stored |
| 20 | Micro: the 2.5D city view | NOT STARTED - micro §3, §8 |
| 21 | Micro: travel between orbit and a city | NOT STARTED - micro §1.4, §9.2, §9.3 |

> **Batch 10 was not in the original plan.** Every batch note from 6 onward closed with "Batches 3-N
> have had no adversarial review". Batches 1 and 2 got one and it paid - 18 defects and a blocker.
> Batch 10 is that review for 3-9: **five confirmed defects, all fixed**, including a free-level-upgrade
> exploit that made the economy optional and a NaN flow rate that had been silently dropped since
> Batch 1. Details in [`docs/balance/batch10-review.md`](docs/balance/batch10-review.md).

> **Note on the design doc.** All numbers in §3 through §9 of `macro-world.md` are illustrative.
> §10 and `src/sim/tuning.ts` are normative. Several §3 constants turned out to be wrong in ways that
> no later tuning could reach — see Batch 1 below — and §7 and §8.1 contain normative-looking numbers
> that are not in §10 at all, so they cannot be superseded by it. They now live in `tuning.ts` and
> `targets.ts`.

---

## Cross-batch invariants

These hold from Batch 1 onward and every batch's review checks them. They come straight from design goal #1 ("the simulation is pure calculation").

1. **Purity.** `tick(state, dt) -> state` is a pure function. No `Date.now()`, no `Math.random()`, no I/O, no mutation of the input state inside `src/sim/`. Enforced by `src/sim/boundary.test.ts`.
2. **One-way dependency.** `src/sim/` imports nothing from `src/web/`, `src/render/`, or `src/ui/`. The renderer is a read-only consumer. Nothing visual ever writes back into the sim.
3. **Reservoirs are the only truth.** `T`, `P`, `albedo`, all fractions, `progress` and `phase` are derived every tick and never stored as authoritative state (§2.2, §11).
4. **All tunable constants live in `src/sim/tuning.ts`.** No magic numbers anywhere else in `src/sim/`. Structural literals (`RESERVOIR_KEYS`, the `Phase` const object, the 0 and 1 in a clamp) are not tuning and do not belong there. Balance is changed in exactly one file, and tuning is a **frozen object threaded through calls**, never module-level constants — otherwise the balance batch cannot run N variants in one process and Batch 1's own conservation tests are inexpressible.
5. **Determinism.** Same engine and same substep grid is **exact** — `advance(s, 4000)` equals a thousand chained `advance(s, 4)` calls under `toEqual`, not within a tolerance. Across engine versions the guarantee is weaker and deliberately stated: ECMA-262 specifies `Math.exp`, `Math.log` and `Math.pow` as implementation-approximated (only `Math.sqrt` is IEEE-mandated), and this architecture spans Node and the browser, so cross-engine agreement is to `DETERMINISM_REL_TOL = 1e-6`. "The same result on any machine" was unachievable as originally written.
6. **Physical sanity, as a LEDGER identity.** No reservoir ever goes negative, and mass never disappears — it moves to a named account:

   ```
   co2_atm + co2_cap + co2_reg + c_fixed + c_lost + c_sequestered - c_imported   is invariant
   h2o_ice + h2o_liq + h2o_vap/H2O_MBAR_PER_M + h2o_lost - h2o_imported          is invariant
   ```

   Stated the original way ("total CO2 across the three reservoirs is conserved except through player import or sequestration") the invariant is **false on the first tick**, because photosynthesis and atmospheric escape are both *natural* terms that remove carbon. A test written that way fails immediately and the tempting response is to weaken it — which deletes the only guard against exactly the reservoir bugs it exists to catch. Asserted every `advance` call to `1e-12` relative to the **gross** size of the identity's terms. Batch 13 moved it off the net value, where an exactly double-entry ledger threw on float cancellation. Batch 14 tightened it from 1e-9, which let a dropped escape leg through; the measured honest worst is 6.7e-14.
7. **Strict TypeScript.** The strictness flags (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) stay as-is; `lib`, `types` and `include` may grow, and the config may be **split by target**. The split is what makes invariant #2 compiler-enforced: `src/sim/` compiles against `lib: ["ES2023"]` with no DOM, so `document` and `performance.now()` are not merely discouraged there, they are not in scope. Relative imports end in `.js` (ESM, per `CLAUDE.md`).
8. **Flows, not net rates.** Every rate contribution names both of its endpoints. Integrating a per-reservoir net rate and clamping the result afterwards is a mass fountain — see the §6 note at the top of `src/sim/integrate.ts`.

---

## Batch 1 — Sim core + live inspector — COMPLETE

**Delivered.** The whole macro world as pure TypeScript with zero rendering, a headless fast-forward harness, and a live browser inspector. Design doc §2, §3, §4, §6, §7, §8.1, plus §3.6 (the nitrogen term, which the original scoping missed — §3.6 had an unassigned natural term and no source reservoir).

**Exit gate — all green:**

- [x] `npm run typecheck` clean across both programs (`tsconfig.json` for the sim and harness, `tsconfig.web.json` for the browser).
- [x] `npm test` — 194 tests across 14 files, including a regression test for every defect the post-implementation review confirmed.
- [x] `npm run sim:run` prints both trajectories with an ASCII S-curve and writes `docs/balance/batch1-baseline.csv` (401 rows) in well under a second.
- [x] `npm run dev` serves the inspector — all 28 modules resolve with no 404s — and `npm run build:web` exits 0.
- [x] Calibration note written: [`docs/balance/batch1-calibration.md`](docs/balance/batch1-calibration.md).

**The two controls, which are the real gate:**

| Run | Result |
|---|---|
| Null policy, 4000 sim-years | T 212.5 K, caps still full at 40.0 mbar, **Phase 0**. An untouched Mars stays dead. |
| Reference policy | **Phase 6 at year 2860**, P 1013 mbar, o2 187 mbar, ocean 36.4%. The arc is reachable. |

### What Batch 1 found in the spec

Nine issues, none of which any amount of later tuning could have reached. Full arithmetic in the calibration note.

1. **§6's substep loop is an arithmetic no-op.** It computes the rates once, *outside* the loop, then integrates N times at `dt/N` — and `Σ rate·(dt/N) ≡ rate·dt`. The advertised stiffness defence did nothing at all. Rates are now recomputed every substep, which is what the doc's own prose means.
2. **§6's `clampReservoirs` is a mass fountain.** The release term is zeroth-order in the reservoir, so an overdrawn cap keeps delivering CO2 and the clamp then lifts the cap back to zero afterwards — carbon from nothing. Flows are now mass-limited *before* they are applied, with proportional rationing per source, and the post-hoc clamp degrades to a pure assertion.
3. **Albedo could exceed 1.** Three independently-derived cover fractions were never constrained to sum to 1, giving a negative radiative base and `Math.pow(negative, 0.25)` = NaN — which no non-negativity assertion catches, because every comparison against NaN is false, and which `JSON.stringify` then writes into the save as `null`. Cover is now allocated by priority and is disjoint by construction.
4. **`H2O_MBAR_PER_M` was wrong by 371×**, making §4's water-vapour feedback — one of its three named positive loops — a literal no-op, and evaporating the ocean permanently.
5. **The planet self-terraformed with zero player input.** §3.3's bare sigmoid is 0.5 at the threshold and never zero below it, so the caps released at 38% of maximum on turn one and emptied in ~130 years.
6. **The §8.1 progress bar read exactly 0.00000 for half the run**, including the entire runaway — one zero axis kills a geometric mean.
7. **The victory condition was arithmetically unreachable** at `co2_reg0 = 120`: 166 mbar of native carbon yields at most 120.7 mbar of oxygen against a 210 mbar target.
8. **`Y_O2/Y_CO2` was 0.8, not 32/44.** Pressure is column weight, so an mbar is proportional to *mass*.
9. **A raised-cosine `bell` scores 0.61 at the game's own 288 K victory temperature**, capping biomass below its target whatever the player does. The plateau form is what §3.5's own prose describes.

Both of the doc's stated sanity anchors hold exactly and are now tests (`T_eq(590, 0.25) = 210.1685 K`; `25·ln(21) = 76.1131 K`), plus a third the doc never states — `albedo(marsStart) ≈ 0.25` — which is the one that actually catches a miscalibration, since the first passes for *any* `ice_frac` mapping.

### What the post-implementation review found

An adversarial pass over the ~2,500 new lines (four independent reviewers by dimension, then three
skeptics per finding, majority refutation) produced 23 candidates; 18 survived and are fixed, with a
regression test each. Four mattered, and two were defects in the fixes above rather than in the spec:

1. **Respiration split into a half-reaction.** Die-off emitted two flows drawing on *different*
   accounts, and `applyFluxes` rations per source — so with `c_fixed` empty the carbon leg rationed to
   nothing while the oxygen leg ran at full rate. Oxygen destroyed, no CO2 returned, and no assertion
   caught it because oxygen has no ledger identity. It fired in the shipped reference trajectory.
2. **Sublimation had no saturation ceiling** — exactly the bug the liquid path was rewritten to avoid.
   A barren Mars sat at 25× saturation behind a spurious cloud deck, 2.5 K colder, with the ignition
   gap 84% wider.
3. **The ledger assertion never ran on any path that drives the sim**, because it lived only in
   `tick()` while the harness and browser loop both call `advance()`. Moved into `advance()`.
4. **`OCEAN_FOR_LIFE = 0` was the one unguarded denominator left**, and a NaN there reaches the save
   file without failing a single non-negativity check.

Details and the remaining 14 in the calibration note.

### Spec gaps closed

All seven from the original list, plus the nitrogen reservoir, `SEED_AMOUNT`, the five §7 phase thresholds, the six §8.1 normaliser endpoints, `EPS`, the phase latch semantics, the substep policy and `TIME_SCALE` — each now a named constant in `src/sim/tuning.ts` or `src/sim/targets.ts`.

**Gap 7 (per-rate clamp ceilings) was closed by deletion.** Clamping a per-reservoir net rate is finding #2 wearing a different hat. Production has mass-limited flows; dev has a loud fraction-of-source tripwire that throws rather than silently clipping. The only genuine ceilings are on the *inputs* to the rate functions (T, `sat(T)`, `S_eff`, albedo), where they are physics statements rather than conservation-breaking edits.

### Deliberately deferred

The ~3 K greenhouse double-count at t=0; the one-way cap release (a ratchet, not a saddle-node, so there is no "you didn't push hard enough and it slid back" failure state); water consumption by photosynthesis; species-selective atmospheric escape; and the offline-catch-up *design* cap. All recorded with numbers in the calibration note.

---

## Batch 2 — Player levers (facilities & megaprojects) — COMPLETE

**Delivered.** All nine levers of design doc §5, a facility-driven reference playthrough replacing
Batch 1's hand-rolled forcing, and a lever panel in the inspector.

> **Reordered ahead of balance.** The original plan balanced first, but the balance batch's own text
> asks to tune so that "player action is required to reach the tipping point" — while having no
> player actions to tune against. Every trajectory a levers-free balance pass could produce would be
> degenerate, and its golden-run regression would lock in one no player ever experiences.

**Exit gate — all green:**

- [x] `npm run typecheck` clean across both programs.
- [x] `npm test` — 235 tests across 15 files (41 new), including one design-rule case per lever and a fuzz over legal lever combinations.
- [x] A full playthrough is drivable end to end: mirrors and greenhouse to ignition, seed at first water, nitrogen to pressure, shield, scrubber, shade. **Phase 6 at year 2710**, ending at 296.0 K / 1006.9 mbar / biomass 0.333 / shield 100%.
- [x] The null-policy control is unchanged and still ends Phase 0 — the lever layer did not hand the planet a way to terraform itself.
- [x] `npm run build:web` exits 0; the lever panel shows ordered-vs-online for every lever.
- [x] Levers note written: [`docs/balance/batch2-levers.md`](docs/balance/batch2-levers.md).

### The design rule cost a mechanism

§5: *"no lever should trivialize a whole axis instantly. Each moves a rate, so the planet still
changes over time."* The flow levers satisfy this for free — a flow **is** a rate. The environment
levers do not: the orbital mirror moves effective solar flux, which moves temperature with **no lag**,
so a fully-funded array would cross the Phase 2 boundary on the first tick and delete the moment §0
calls the core of the game.

So `Facility` carries `deployed` as distinct from `count × level`: capacity is *ordered*, and comes
online at `FACILITY_BUILD_RATE`. Dismantling ramps too — an array snapping to zero would hand back an
instant *cooling* lever, which the rule forbids just as much. The rule is now a test, one case per
lever, at `MIN_PHASE_CROSS_YEARS = 25`. Phase 1 is exempt, deliberately: its entry condition *is*
"the player has built something".

### Two readings that could have drifted silently

- **The atmospheric processor moves carbon rather than creating it.** §5 says "+co2_atm (venting
  regolith directly)"; venting is a transfer, so it is `co2_reg → co2_atm` and the reservoir runs
  out. Read as a bare `+co2_atm` it would have been a carbon fountain.
- **The shield is hardware, not a field.** `shieldStrength` follows the deployed facilities every
  substep, so a hand-set value decays back to zero. `setShieldStrength` is now documented as a
  save-loading and test affordance.

### What the playthrough exposed

The scripted player's first attempt reached Phase 6 and then ended with **biomass 0.000 and 1430
mbar**: the scrubber ran to exhaustion and starved the biosphere of carbon, and nitrogen import never
stopped. Neither is a correctness bug — both are hazards §5 intends to exist — but the first one
matters for Batch 3, because §2.3's CO2 target of ~1 mbar sits barely above `CO2_FOR_LIFE = 0.5`.
**Breathable and habitable are a fraction of an mbar apart.**

### What the post-implementation review found

22 candidates, 14 confirmed, 8 refuted. **One blocker, and it repeated a Batch 1 lesson:** the
processor and scrubber draw through the same `avail()` depletion ramp as the natural rates, and at
maximum order asked 2.5× the flux tripwire — throwing mid-run and killing the browser loop. A
400-trial sweep over legal settings crashed 24% of the time.

Batch 1 added `validateTuning`'s ramp guard for exactly this, with a comment claiming it covered
"every rate sharing each scale". Batch 2 added two new draws and did not extend it. **A guard is only
as good as the last person who added a term.** Now covered, with a fuzz test; 0/400 after.

Also closed: Phase 5's buffer clause (whose comment named Batch 2 as its unblocker), a lever panel
that captioned retiring levers "coming online", three dead CLI flags, a test that could not fail, and
a bare constant outside `tuning.ts` in a directory the invariant-#4 guard did not scan.

### Pressure floor

`P_FLOOR = 8.0` mbar fades the scrubber out before it can push pressure under the triple point and
lock liquid water out of the run permanently. Verified: a maxed scrubber running 2000 sim-years from
the Mars start sequesters exactly 0 and leaves pressure bit-identical to a run with no scrubber. It
protects the melt gate; it does **not** protect the biosphere, which starves far higher.

---

## Batch 3 — Balance & pacing calibration — COMPLETE

**Delivered.** A pacing score encoding §0, a sweep harness, a tuned table, and a golden-run
regression test. **Pacing score 0.5961 → 0.9646**, every hard gate passing.

**Exit gate — all green:**

- [x] Tuned `tuning.ts`, every changed constant carrying its arithmetic.
- [x] Golden-run test green (`src/harness/golden.test.ts`, 11 cases).
- [x] Balance report written: [`docs/balance/batch3-balance.md`](docs/balance/batch3-balance.md).
- [x] §10 rewritten with the tuned values and §2.1's start vector corrected, with a test asserting every constant in `tuning.ts` appears there — and that the retired ones do not.
- [x] `npm test` — 249 tests across 16 files; `npm run typecheck` clean.

**The playthrough:** Phase 6 at year 1710, **15.8 real hours** at 1x, ending at T 288.4 K, P 936 mbar,
o₂ 233 mbar, ocean 36.5%, biomass 0.853, progress 0.975 — every §2.3 axis at or past target. The null
control ends at 212.6 K with its caps untouched.

### The instrument was wrong twice before it was right

Both corrections mattered more than any constant. It measured pacing over the *observation* window
rather than the *playthrough*, counting post-victory idle as a 679-minute stall; and it penalised the
final phase for being long, scoring directly against §0's stated wish for "a long tail as the world
settles". A balance batch's first job is an instrument you can trust.

### Two findings the sweep forced out

1. **The biosphere had no carbon fixed point.** Maintenance photosynthesis drew carbon regardless of
   conditions and nothing in the model returns it — no volcanism, no weathering — so it was a one-way
   pump that stopped only when the tank was empty. Every raised `M_PHOTO` hit 99% of the oxygen
   target **with the biosphere dead**. Gating the draw on suitability closes the loop and yields
   `b* = 1 − M_PHOTO/R_BIO`, making endgame biomass a ratio you choose. `Y_CO2` could never have
   fixed it: the oxygen target's 288.8 mbar carbon bill is set by stoichiometry.
2. **The progress bar could not see the endgame.** From year 1550 four axes were maxed while
   `co2_atm` fell 36 → 5 mbar — the atmosphere becoming breathable — invisible to the metric. §8.1
   has five axes, §2.3 has six rows. Closed with a sixth axis measuring **composition** rather than
   absolute amount, which is why the linear version Batch 1 feared does not work.

### What is still wrong

The §8.2 stall limit is **not met**: 8.9 real minutes against "a few", down from 679. It is pinned in
the golden test rather than papered over. It is also not fully tunable — "tens of real hours" and
"movement every few minutes" both route through `TIME_SCALE` and pull against each other, and a
geometric mean is inherently back-loaded early. Raising `PROGRESS_FLOOR` to 0.18 scored three
ten-thousandths higher and was **rejected**, because it lets a dead axis read 0.75 and §8.1's intent
is that a zero on any axis tanks the score.

Where the bar cannot carry the sense of change, §9's continuous visual channels must. That is now a
stated dependency on Batch 5 rather than an assumption.

---

## Batch 4 — Persistence & offline catch-up — COMPLETE

**Delivered.** The §11 save schema with a real v1 migration, the §8.2 design cap, an IndexedDB store
behind a contract, and a "while you were away" summary.

**Exit gate — all green:**

- [x] An injected-clock test proves a save round-trips, advances correctly over a simulated absence, and reports the right delta (`src/web/session.test.ts`, 15 cases).
- [x] `npm test` — 299 tests across 19 files (50 new); `npm run typecheck` clean; `build:web` clean.
- [x] Persistence note written: [`docs/balance/batch4-persistence.md`](docs/balance/batch4-persistence.md).

### §8.2 read literally would have given the game away

At `TIME_SCALE = 0.03` a 48-hour absence is worth **5184 sim-years** against a **1710** sim-year
playthrough — one weekend away finishes the game three times over, contradicting design goal #2
outright. There are now **two caps and they are different things**: the *work* cap bounds load-screen
milliseconds; the *design* cap bounds how much of the game an absence is worth.

A 48-hour absence now buys 129.6 sim-years (~7.6% of a playthrough), and **ten consecutive 48-hour
absences come to 1295 sim-years — short of one arc**, which is the test the plan asked for by name.
Active play beats idle by 6.7×.

### The migration is real

§11's shape genuinely predates the nitrate reservoir, the ledger, the `seeded` flag and the facility
deployment ramp — all added in Batches 1–2. So v1 → v2 needed four *decisions*: `n2_reg` becomes 0
rather than the Mars default (a v1 world never had one); the ledger zeroes (conservation is checked
as drift, so it is harmless); `seeded` is inferred from biomass; and facilities come back **fully
deployed**, because v1 predates the ramp and starting them at zero would silently switch off a loaded
player's entire industry.

### The property that matters

**A save in the middle of a run is invisible to the result** — save, load, continue is bit-identical
to running straight through. That is why `steps` is stored as an integer alongside §11's `sim_year`:
recovering the grid position from a rounded float would let it drift by a substep per save/load cycle.

### Other decisions worth knowing

- **Opening storage never rejects.** IndexedDB is unavailable in private windows and some webviews;
  the fallback is an in-memory store whose `durable: false` makes the UI say progress will not
  survive a reload, rather than throwing on first autosave.
- **Writes are serialised** through one in-flight promise — autosave, tab-hide and `pagehide` can all
  fire within a frame, and overlapping writes to one slot race for which lands last.
- **A backwards clock costs nothing.** DST, NTP, a changed system date: none should brick a world.
- **A corrupt save starts fresh and says so.** Refusing to start is worse than losing a save; quietly
  resetting is worst.
- `src/sim/` still has no clock. Every entry point takes the time as a parameter, which is the only
  reason the exit gate's test can run in CI at all.

---

## Batch 5 — Visualization contract — COMPLETE

**Delivered.** All eight §9 channels as `deriveVisuals`, a live panel in the inspector, a
`--channels` plot over a full run, and a continuity test that can actually fail.

**Exit gate — all green:**

- [x] Channels plotted over a full run (`npm run sim:run -- --channels`) and shown live in the inspector.
- [x] The discontinuity test is green **and verified by injection** — an injected `iceFrac > 0.1 ? r : 0` fails it with a named year and magnitude.
- [x] `npm test` — 340 tests across 21 files (41 new); typecheck and `build:web` clean.
- [x] Contract note written: [`docs/balance/batch5-visual-contract.md`](docs/balance/batch5-visual-contract.md).

### `phase` is not an input, enforced structurally

§0.3 names the failure this prevents: terraforming that reads as "colored keys" while the planet
barely changes. `visuals.ts` never mentions `phase` or `progress`, and `boundary.test.ts` asserts it.
A continuity test can only sample; this cannot be got round.

### The continuity test was wrong three times

Each wrong version taught something, and the first is the one that matters:

1. **It only checked phase boundaries** — which is what the plan specified. But the visuals do not
   read phase, so a hidden threshold fires at whatever *state value* crosses it, wherever that falls.
   An injected snap **passed**. The scan is now run-wide.
2. **It compared deltas to a local median**, which is a *smoothness* test. It flagged dust coming off
   its `clamp01` ceiling — continuous value, cornered derivative. Every channel is clamped, so that
   test would eventually have flagged all of them.
3. **Dust's driver was a reservoir level.** A level is smooth exactly where the rate off it is not.

What it is now is §0 and §9's own criterion in their own units: **no channel may change more than 25%
of its range per real minute**. §0's "visible change every few real minutes" is the lower bound on
the same quantity; this is the upper one.

### The one real discontinuity

Ecopoiesis — §3.5 and §5 both define seeding as a one-shot edit, so biomass genuinely steps from 0 to
`SEED_AMOUNT`. A continuous function of a discontinuous input is the contract working, so a channel
is only in trouble if it jumps when **its driver did not**. Pleasant finding: at one-sim-year
resolution the seed step does not stand out at all, because the growth right after is just as fast.
The green arrives without a pop.

### Payoff for an earlier decision

Dust reads the release **flows**, not a net rate — which is why rate contributions have been `Flow`
objects carrying a `FlowId` since Batch 1. A net rate on `co2_atm` would already have the biosphere's
uptake and the solar wind's bleed mixed in.

---

## Batch 6 — Macro renderer (the planet) — COMPLETE

**Goal.** Design doc §9 consumed for real.

- [x] A planet renderer in `src/render/`, importing **only** `VisualChannels` — no sim internals (invariant #2, enforced from the renderer's side by `boundary.test.ts`, each guard verified by injection).
- [x] Layers: surface (rock/greenness/warmth tint), ice caps, ocean basin fill, atmosphere shell (thickness, rim glow, sky colour), cloud layer, dust haze.
- [x] Continuous response, measured rather than asserted: `planet.test.ts` sweeps every channel across its range and requires every tenth to move the image, monotonically, with no tenth carrying more than 40% of the range.
- [x] A scrubber driving the renderer from a recorded trajectory — `recordArc` in the browser, held sample-for-sample EQUAL to the harness's reference run by `arc.test.ts`.
- [x] Renderer note written: [`docs/balance/batch6-renderer.md`](docs/balance/batch6-renderer.md).

**Changed from the plan — software, not WebGL.** The exit gate is per-pixel comparison against committed PNGs, and WebGL cannot render in Node. A GPU path would need headless GL or a browser in CI, and every driver bump would churn the goldens for no change in the picture. The software rasteriser is bit-exact in both Node and the browser; a GPU backend can slot in behind the same signature later, with the frames keeping it honest.

**Exit gate:** 12 reference PNGs at fixed progress values, per-pixel mean absolute difference within tolerance of the checked-in goldens. **The plan's 2% was wrong by 10x** — three injected regressions (a 3% colour shift, a moved ocean threshold, a softened cloud edge) measured 0.068%, 0.077% and 0.356%, so all three passed at 2%. An unmodified render reproduces the goldens *exactly*, so the tolerance only has to absorb last-ulp trig differences across platforms (~0.0004%). Corrected to **0.2%**, and verified to fail on injection.

**Open, recorded in the note.** The last third of the run barely changes on screen — ocean, greenness and caps all saturate by year 482 while the run continues to 2140, leaving only the limb glow moving. That is pacing, not drawing. Three frame pairs are a named quarantine in `golden-frames.test.ts`, guarded so the list cannot grow and the listed pairs cannot get flatter.

---

## Batch 7 — Game shell UI — COMPLETE

**Goal.** The §7 milestones and §8.1 progress made legible to a player.

- [x] HUD: the §2.3 target bands, the composite progress bar, the current phase with its §7 name and caption. **Six bands, not five** — CO2 has a toxicity ceiling in §2.3 and is the one row that runs backwards, which is exactly what a player misreads as going the wrong way.
- [x] Phase-transition moments get real feedback: a banner for every headline beat, including §7's Phase 2 "it's happening" moment.
- [x] Speed controls and a derived event feed in the shell; the Batch 2 lever panel stays in the instrument section, reached from the advice button, which orders the lever and scrolls to it.
- [x] Accessibility, asserted rather than eyeballed: every bar carries its number, every state a word, every meter `role="meter"` with a spoken `aria-valuetext`. The central test renders three different worlds and requires the TEXT alone to tell them apart.
- [x] Shell note written: [`docs/balance/batch7-shell.md`](docs/balance/batch7-shell.md).

**Exit gate — met, and made falsifiable.** "What the planet needs next" is DERIVED, not scripted: §8.1's progress is a weighted geometric mean, so differentiating it makes the limiting axis simply the largest `w_i / n_i`, and the bottleneck is then resolved through its prerequisites to the first actionable step. `guidance.test.ts` holds it at 1201 samples of the reference run — never recommends a gated action, never points at the scrubber trap, never asks for warming on an already-warm planet, and recommends seeding at year 274, ahead of the schedule's 360.

**Three defects worth recording.** (1) The scrubber guard tested total pressure, so at year 364 — 301 mbar, of which 297 was CO2 — it advised stripping the atmosphere, for 1346 sim-years; **the test asserted the same wrong criterion as the code**, which is why it passed. (2) It then nagged for scrubbers across the long tail, where the reference run wins without ever building one. (3) `Inspector` clears the element it is handed, so it **deleted the entire HUD**; every unit test passed because each mounts its component alone. `shell.test.ts` now assembles the page the way `main.ts` does.

**Open.** Progress reads 87% at victory — every §2.3 band is satisfied at year 1710 while the composite is still climbing toward a 1013 mbar pressure target. The bar and the victory condition disagree about "done". That is a §8.1-vs-§2.3 question for a balance batch.

---

## Batch 8 — Seeded events & determinism hardening — COMPLETE

**Goal.** Design doc §12.2.

- [x] A seeded PRNG keyed on coordinates, not on call order. There is **no generator, no cursor, no queue and nothing in the save**: `rand01(seed, year, salt)` is a pure hash and `activeEvents(seed, simYear)` is a pure function of time, so chunking cannot matter because there is nothing to keep consistent.
- [x] Dust storms (`Env.albedoDelta`), comet impacts (double-entry through `h2o_imported`), solar variability (`Env.sMultiplier`, modelled as a continuous wander rather than as occurrences).
- [x] Events surface in the §9 dust channel, the Batch 7 feed, and `sim:run --events`.
- [x] Events note written: [`docs/balance/batch8-events.md`](docs/balance/batch8-events.md).

**Exit gate — met, and stronger than asked.** Four drivers, not three (one big jump, many small, a ragged split, and `catchUp`), and the assertion is that the resulting **worlds** are `toEqual` identical rather than just the timelines — invariant #5 makes the same substep grid exact. Guarded against vacuity two ways: the span must contain >100 event samples, and events-on must differ from events-off. Verified by injecting the exact bug the design prevents (keying on the per-call substep index instead of absolute time), which fails it.

**The timeline is bit-identical across engines even though the physics is not.** Invariant #5 caps cross-engine agreement at 1e-6 because `exp`/`log`/`pow` are implementation-approximated; every operation in `rng.ts` is a 32-bit integer op, which the spec pins exactly. Two machines disagreeing in the last ulp of a temperature still get the same storms on the same days.

**A conflict with Batch 5, resolved rather than ignored.** A dust storm moves the §9 dust channel at ~1.9 of its range per real minute, about eight times Batch 5's 25%/minute continuity bound; satisfying that bound would mean a 22-sim-year storm, which is a climate, not weather. The resolution is Batch 5's *own* rule — a channel is only in trouble if it jumps when its **driver** did not — so the storm joins dust's driver and the continuity suite runs a second time with weather on. Still catches a hidden threshold in the mapping (20 snaps) and a step-function storm, both verified by injection.

**Off by default.** `EVENTS_ENABLED = 0` ships, so the golden frames, the balance sweep and a dozen exactness tests are never at the mercy of the weather. It is a tuning constant rather than a `SimConfig` field so the sweep could measure it. Measured cost of enabling: victory moves from year 1710 to 1712, 0.1%.

---

## Batch 9 — Economy / tech layer + city-layer bridge — COMPLETE

**Goal.** Close §12.3 and replace the §11 `economy` placeholder.

- [x] Credits, escalating facility costs, upkeep, and a tech tree gated on latched phase.
- [x] The macro → micro contract: `habitat(reservoirs, derived, tuning) -> HabitatChannels`, the same shape as §9's visual contract and with the same rule - it is the whole interface, and nothing else crosses.
- [x] The separate design document: [`docs/design/economy.md`](docs/design/economy.md).
- [x] Save schema v3, with a v2 migration.
- [x] Batch note written: [`docs/balance/batch9-economy.md`](docs/balance/batch9-economy.md).

**Exit gate — met on all three.** A facility costs something (and a refused order changes nothing, all-or-nothing, with the reason surfaced in the shell). The tech tree gates on phase, with every facility behind exactly one tech - asserted, because a lever behind none would be silently always available. The city layer's interface is documented and tested across a whole playthrough: finite everywhere, fractions really in 0..1, `supportIndex` strictly positive even on a dead planet, and growing gradually rather than jumping.

**The bridge is load-bearing, not decorative.** Income is proportional to `supportIndex` from the §12.3 contract, so terraforming funds terraforming and a real city layer can replace the stand-in without the loop changing shape.

**Two bugs worth recording.** (1) The habitat contract first had a single all-or-nothing gate, which needed breathable oxygen and so left `supportIndex` at its floor for the entire game before jumping - §12.3 asks for a footprint that *grows*, so it became three tiers, guarded by a test that fails at 3e-12 of range if they are collapsed back. (2) Tech unlocking was put in `tick()` only, so it never fired for either production driver - the exact mistake Batch 1 found with the ledger assertion. Moving it into `advance` then broke Batch 8's determinism gate, because latching once per CALL depends on chunking; it has to be per substep. **Batch 8's gate caught a Batch 9 regression**, which is the best argument for it.

**Both halves ship off** (`ECONOMY_ENABLED = 0`, `TECH_GATE_ENABLED = 0`), so the Batch 3 balance, the golden frames and a dozen exactness tests keep meaning what they meant. The browser enables both. Measured cost of enabling: a saving player wins at sim-year 1860 against 1710 without costs, about 9% slower - the economy costs time, it does not rebalance the game.

---

## Batch 11 — Endgame legibility — COMPLETE

**Not in the original plan.** Taken from the recorded backlog after Batch 10 as "endgame pacing": the
flat last third (Batch 6), progress at 87% on victory (Batch 7), and the 8.9-minute stall (Batch 3).

- [x] Measure before building. The stall is at years 230–246, not in the endgame. The flat stretch is not flat in the sim.
- [x] Disc-wide in-scattered haze in the renderer (§9 "more haze"), and a reshaped sky curve (`VISUAL_TUNING.SKY_CLEAR_GAMMA`).
- [x] `KNOWN_FLAT` quarantine deleted; all eleven golden-frame steps clear `VISIBLE_STEP`.
- [x] A planet-side stall instrument (`planetStall`), since §8.2 asks for visible change to the *planet*, not only the bar.
- [x] The HUD says what the bar measures ("toward Earth-like") and gives the win condition in words.
- [x] Batch note: [`docs/balance/batch11-endgame-legibility.md`](docs/balance/batch11-endgame-legibility.md).

**Exit gate - met, with one pinned residual.** Every golden-frame step is visible, with no quarantine
(the old steps 0.0094/0.0083/0.0042 are now 0.0182/0.0120/0.0110). The shell no longer says "87%
terraformed" beside "Living world". The planet stall went from 55.6 to 31.1 real minutes and is
**pinned above the §8.2 limit, not passed**. What remains is the oxygen tail's length, which is
balance.

**What changed from the plan, and why.** The plan was a balance retune of the oxygen tail. Measuring
first showed that Batch 6's "the channels themselves are flat" was false: `skyColour` travels from grey
to blue across frames 7–10, and the renderer drew it only in a `(1 - z)^2` limb band. Four batch notes
carried that misdiagnosis forward. The fix for 87% I floated at planning time, normalising to the
habitable minimum, measured **worse**: the bar stall doubles to 17.8 minutes and still reads 0.988 at
victory. So the 87% became a labelling fix and not a formula change. **The simulation is untouched**:
same phase years, same Batch 3 score (0.9589), same determinism. Only the golden frames were
re-baselined, and they were inspected before committing.

---

## Batch 12 — The oxygen tail — COMPLETE (negative result)

**Not in the original plan.** Taken from the backlog after Batch 11: Phase 5 → 6 is 64% of the run,
and the planet's worst visible stall (31.1 real minutes) sits inside it.

- [x] Find what paces the tail. It isn't photosynthesis. Tripling `M_PHOTO` moved the win 190 years and made the stall worse. It's the oxygen-fire gate (`O2_FIRE_FRAC`), which the nitrogen buffer's rate controls.
- [x] Search the reference player's schedule: ~25 variants, plus 3 physics variants.
- [x] Fix the continuity test whose verdict about year 7 depended on the vapour peak in year 1621.
- [x] Make the Batch 11 HUD tests read the win year off the run instead of hardcoding it.
- [x] Batch note: [`docs/balance/batch12-oxygen-tail.md`](docs/balance/batch12-oxygen-tail.md).

**Exit gate - a faster tail without breaking a gate - not met, by measurement.** 16–24 nitrogen
importers win at 1534 instead of 1710 and cut the planet stall from 31.1 to 22.2 minutes, with no
change to the score. But they fill pressure before the win, so the last 6% of the bar becomes the
CO₂ axis's final log-decade. That takes 74 sim-years and changes the planet by under 1%: golden-frame
step 10 → 11 fell to 0.0073, the §0.3 failure. Easing the buffer after the oxygen race fixes that and
brings the stall straight back. **The shipped policy is the only point measured that passes every
gate, so nothing was rebalanced.**

**What changed from the plan, and why.** The plan was a balance retune. It became a measurement, a
revert and one test fix, because the gate that failed guards the game's central promise and the
rule is to investigate a failing gate, not loosen it. Two of my own hypotheses were wrong along the
way: that photosynthesis paces the tail, and that the shell's scrubber advice was misleading
(measured: scrubbers win 340 years sooner). Both are recorded. **The next attempt needs a decision
about the CO₂ progress axis first.** That's a design call, since it changes what the bar means.

---

## Batch 13 — Adversarial review of Batches 1–2, 11 and 12 — COMPLETE

**Not in the original plan.** Batches 1–2 hadn't been re-reviewed since their own review, and 11–12
had had none. Three independent reviews ran in parallel under a no-edit rule, and every finding was
reproduced here before it was fixed.

- [x] Revert Batch 12's relaxed continuity rule. It excused 11 injected hidden-threshold snaps.
- [x] Scale the ledger tolerance by the gross size of the identity's terms. The net-value scale crashed a correct game.
- [x] One `worldEnv` for every reader of the world, and a testable browser readout. The browser latched phases from a weather-free planet.
- [x] Reject or normalise an oversized `deployed`; refuse NaN orders and saturate infinite ones; keep decay a whole reaction under oxygen rationing.
- [x] Scan the year 0→1 step; make the three CO₂-ceiling voices agree with the win; make `planetStall` report a truncated window.
- [x] Correct the Batch 11 and 12 notes where the review disproved them.
- [x] Review note: [`docs/balance/batch13-review.md`](docs/balance/batch13-review.md).

**Exit gate - met.** Every reproduced defect is fixed, or resolved by a measured decision (haze
clipping: the screen blend was measured and was worse). Each fix is pinned by a test that was broken
on purpose to prove it bites. No existing gate moved: same golden run, golden frames and Batch 3
score. 578 tests pass, up from 559.

**What changed from the plan, and why.** The plan was "review Batches 1–2, 11 and 12". The largest
finding was in my own Batch 12 work: a loosened gate, justified by an injection that couldn't
exercise the failure it permitted. Reverting it brings back one known false alarm on an unshipped
seed (seed 120). That's the right side to err on for the gate that guards §0.3.

## Batch 14 — Review of Batch 13's fixes — COMPLETE

**Not in the original plan.** Batch 13 recorded that its own fixes were unreviewed, and two of them
had the shape of Batch 12's defect: a loosened gate and a rewire of every environment reader.

- [x] Clamp an over-cap `deployed` on load instead of rejecting it, and read every `deployed` through one clamped `liveUnits`. Rejection wiped saves on a retune.
- [x] Tighten the ledger tolerance to 1e-12 on the gross scale (measured honest worst 6.7e-14). At 1e-9 a dropped escape leg passed the browser's 1-substep calls.
- [x] A tied flow respects its own source's rationing too. The tie-only rule drove `c_fixed` to −0.0017.
- [x] Readout test checks the environment against `advance`'s own, via a spy forcing, at every substep.
- [x] Refuse order levels below 1.
- [x] Batch 13's latent items: growth cut with rationed carbon; NaN biomass and NaN photosynthesis now loud.
- [x] Review note: [`docs/balance/batch14-review.md`](docs/balance/batch14-review.md).

**Exit gate - met.** Every reproduced defect is fixed and pinned by a test broken on purpose to
prove it bites. No existing gate moved: same golden run, golden frames and Batch 3 score. 590 tests
pass, up from 578.

**What changed from the plan, and why.** The plan was to review Batch 13 and close two latent items.
Chasing the second latent item turned up a third: a NaN photosynthesis demand emitted no flow at all,
so Batch 10's finite-rate check could never see it. Two findings are recorded, not fixed: the
continuity gate's inherent 13.9%-per-sample floor, and hand-edited saves that can blind the ledger
check. The note recommends ending the review cycle here.

## Batch 15 — Full-screen globe — COMPLETE

**A direct request, not from the backlog.** The planet was a 260 px canvas in the instrument panel on
a scrolling page. It now fills the viewport, turns on drag and zooms on the wheel, shaded per pixel
on the GPU, with the HUD and the instruments floating over it. Graphics only: no simulation, tuning
or contract change, and the golden run, golden frames and Batch 3 score are unmoved. 604 tests pass.

**What changed from earlier decisions.** Batch 6 decided the planet would not rotate. You asked for
rotation, and the GPU removes the per-angle cost Batch 6 was avoiding. **Known limit:** the golden
frames pin the software renderer, not the GPU globe. The shader is a port with its constants written
in from `planet.ts`; it compiles under `glslangValidator`, but no rendered frame of it has been seen
by the build. Details in the [note](docs/balance/batch15-globe.md).

## Batch 16 — Build panel — COMPLETE

**From the backlog** (Batch 7: "a player-facing build panel is a better home for it"). After Batch 15,
the only way to build most levers was a debug drawer.

- [x] A Build section in the HUD listing every lever: what it does, ordered vs online, the next unit's price, +1 / −1 / switch off, and seeding.
- [x] One definition of "order one more" (`orderDelta`), used by the order, the panel's dry run and the advice button's dry run. Before, `main.ts` built it inline twice.
- [x] The advice brings its lever's build row into view instead of opening the debug drawer.
- [x] Batch note: [`docs/balance/batch16-build-panel.md`](docs/balance/batch16-build-panel.md).

**Exit gate - met.** Every button the panel offers is an order the simulation accepts, and every
refused one says why in words. This is tested through the real HUD in four situations, with the world
itself as the oracle, and each claim was broken on purpose. UI only: the golden run, golden frames and
Batch 3 score are unmoved. 620 tests pass.

**What changed from the plan, and why.** The plan named "cost, owned and deployed counts, order,
dismantle and switch-off". All of that shipped. Level upgrades did not: the panel orders at a lever's
current level, and that's recorded as the next step. One test defect was found and fixed: the first
scenarios couldn't catch a dry run priced at the wrong level, because none sat at the money margin.

---

# The micro (settlement) layer — Batches 17 to 21

Source of truth: [`docs/design/micro-world.md`](docs/design/micro-world.md) (Micro World Design Document v0.1),
added after Batch 16. The batches follow its §12 build order one-to-one, and its §12 rule holds:
"Only after all five does adding a tenth building type or any section-11 feature make sense." The
eight cross-batch invariants apply to this layer as they do to the macro sim. The micro doc's §0.1
("Settlements are small pure simulations… deterministic… No settlement stores anything it can
recompute") is the same rule as invariants 1, 3 and 5.

## Conflicts to resolve before building (recorded, not decided)

The micro doc was written against the macro design, not against this codebase. Where they disagree,
the disagreement is recorded here and belongs to the Phase 1 of the batch named, **for the user to
decide**:

1. **"Nothing is built at macro, ever" (micro §2.3) vs what exists.** Since Batch 2 the section 5
   levers are facilities ordered from the planet view, and Batch 16 just gave the HUD a build panel for
   them. Under micro §0.2 and §2.2 those levers become buildings inside settlements, and their macro
   rates become sums over settlements. *Batch 18* must decide the migration: replace the facility
   system, or run both behind a tuning constant, `SETTLEMENTS_ENABLED`, defaulting to 0 as events
   and the economy did. The golden run, Batch 3 score and golden frames are all calibrated on the
   facility system.
2. **The city-layer wall.** Invariant-level rule since Batch 9: "a city layer sees only
   `HabitatChannels`". Micro §2.1 has settlements sample `T`, `P`, `o2` and `ocean_frac` directly.
   *Batch 18* must either extend `HabitatChannels` or route the sample through it.
3. **Two currencies.** Batch 9's credits and upkeep vs the micro doc's `materials` resource and
   Earth imports (§2.3 step 2, §6). *Batch 18* decides whether they merge, coexist, or one replaces the
   other.
4. **The micro to macro terms must stay double-entry.** A building's planetary output (§2.2) is a flow
   into macro reservoirs, so it has to carry ledger legs, or invariant 6 fails on the first tick.
   *Batch 18*.
5. **Internal inconsistencies in the micro doc:**
   - §5 says "Ten types" while §0.3 and §12 say "nine".
   - §2.3 calls the Spaceport "building #9" where §5 numbers it 10.
   - §2.2's formula multiplies by `b.count`, but buildings are individual placements (§10).
   - "Companion to `terraforming-macro-design.md`" means `docs/design/macro-world.md` here.

   *Batch 17's* Phase 1 should confirm the intended reading.

## Batch 17 — Micro: coordinate spaces + settlement markers — COMPLETE

**Goal.** Micro §12 step 1: "Implement the three coordinate spaces and the transforms (section 1),
plus a placeholder marker on the existing macro globe."

- [x] Planetary space (§1.1): `(lat, lon)` to a 3D point on the sphere, and back.
- [x] Settlement world space (§1.2): a flat local plane tangent at the settlement's coordinate.
- [x] Tile space (§1.3): integer `(tx, ty)`, rectangular footprints of 1x1, 2x2 and 3x3.
- [x] Settlement registry (§9.1): a list of settlements with `(lat, lon)` and kind; founding adds one
  and builds nothing (§2.3 step 1).
- [x] A placeholder marker per settlement on the Batch 15 globe that stays on its spot as the globe
  turns, and hides on the far side.
- [x] Batch note: [`docs/balance/batch17-micro-coordinates.md`](docs/balance/batch17-micro-coordinates.md).

**Exit gate - met.**
- Every transform round-trips to measured tolerances: 6.4e-15 rad, 5.5e-10 m at Mars's radius, and
  tiles exactly.
- Markers land on their surface point through the globe's own rotation (9.0e-14), at 4 camera angles
  × 312 sites, and are hidden exactly on the far side, checked against an independent test.
- Settlements are proven inert: the golden run is unmoved, and a city on a mid-game world changes
  nothing over 200 years.
- 650 tests pass.

**What changed from the plan, and why.**
- **The registry is saved now** (schema v4, with a v3 migration), moved forward from Batch 19;
  otherwise founded settlements would vanish on reload. Batch 19 still owns stores, buildings and
  offline catch-up.
- **Defaults taken on a bare "go":** the conflict 5 readings, and 10 m tiles.
- **No terrain elevation in the sim**, because that noise is presentation.
- **Founding needs picking**, so the screen-to-planet inverse was added; the doc implies it but
  doesn't list it.

**Exit gate.**
- Every transform round-trips (planetary to 3D to planetary; world to tile to world), to a tolerance
  measured and recorded, not planned.
- A marker at `(lat, lon)` is drawn exactly where the globe's own rotation (`toPlanetJs`) puts that
  surface point, at several yaw and pitch values, and is hidden when that point faces away.

**Gates at risk.** None in the sim: this is geometry and a UI overlay. The marker must not change the
globe's rendering of the planet itself.

## Batch 18 — Micro: one settlement as pure TypeScript + the coupling — COMPLETE

**Goal.** Micro §12 step 2: "Implement one settlement as pure TypeScript: grid, the nine building
definitions, the tick (section 7), the two-way macro coupling (section 2). No rendering."

- [x] The building set of §5, with footprint, consumes, produces, planetary output,
  `canOperate(macro)` and `efficiency(macro)`.
- [x] The resources of §6 (networked vs stored), and the serviced-area boolean. No pipe routing.
- [x] The micro tick of §7.1 to §7.4: operability, per-resource balance, the shortfall brownout and
  stress state, logistic population for cities.
- [x] Macro to micro (§2.1): gating and efficiency from the macro state, through the city-layer wall
  (conflict 2).
- [x] Micro to macro (§2.2): the summed planetary outputs feed the macro rates, double-entry
  (conflict 4).
- [x] Every new constant in `tuning.ts` and the §10 table (macro doc), as the tuning test enforces.
- [x] Batch note: [`docs/balance/batch18-settlement-sim.md`](docs/balance/batch18-settlement-sim.md).

**Exit gate - met.**
- A city bootstrapped in the doc's own order from the founding stock is supported in every year
  and grows to fill its housing (80.00 at year 150).
- Growth is logistic: fastest at half housing, year 23.
- Removing its power browns out every powered building, and the population falls at the 0.2/yr
  rate.
- 4 processors put exactly 0.2 mbar/yr into the macro flows, and O₂ appears at exactly 32/88 of
  that. Removing them removes it.
- Over a century they sequester 20.000 mbar, with the carbon ledger drifting 8.8e-12.
- Chunk-independence holds with cities ticking.
- Off by default, so no calibrated gate moved. 663 tests pass.

**Conflicts 1-4 resolved, as defaults on a bare "go":**
- **Conflict 1:** settlements coexist with facilities behind `SETTLEMENTS_ENABLED`.
- **Conflict 2:** settlements see the planet through `HabitatChannels`, which gained `insolation`.
- **Conflict 3:** materials are separate from credits.
- **Conflict 4:** MOXIE carbon is booked to `c_sequestered`, and its O₂ is tied to that carbon
  leg's rationing.

**What changed from the plan, and why.**
- **§7.2 and §7.3 read literally together made a shortfall harmless**, measured: a powerless city
  stayed "supported". A life-support shortage now counts as stress, as §7.2 says it must.
- **A seed population fills the spec's gap:** a city that starts empty could never grow.
- **The processor draws nothing from a bare Mars**, because of the pressure floor. That's correct,
  and pinned by a test.

**Exit gate - from the doc.** "Verify a city survives, grows, and that an Atmosphere Processor's
planetary output shows up in the macro sim's rate." Held to this project's standards:
- a seeded city survives and grows along a logistic S-curve, and the growth is measured, not
  assumed;
- a shortfall browns out the dependent buildings and makes the population decline;
- an Atmosphere Processor's output appears in the macro sim's rate for that term, and removing it
  removes it (checked by injection);
- the carbon, water and nitrogen ledgers still close;
- chunk-independence: `advance(s, 4000)` equals a thousand `advance(s, 4)` calls, exactly, with
  settlements present.

**Gates at risk.** Every one, if settlements feed the macro sim by default. Per the project rule
this ships behind `SETTLEMENTS_ENABLED = 0` unless the Batch 18 Phase 1 decides otherwise
(conflict 1).

## Batch 19 — Micro: settlement save schema + offline progression — COMPLETE

**Done** - see [the note](docs/balance/batch19-settlement-save.md). Changed from the plan: the
bullet below lists capacities and the grid as saved fields. Both are derived (buildings + tuning,
kind + tuning), and §10's own rule forbids storing derived values, so they are recomputed on load.
Offline progression needed no new code - catch-up already runs through `advance` - only proof.

**Goal.** Micro §12 step 3: "Wire the save schema (section 10) and prove offline progression on a
settlement."

- [x] Settlements in the save (§10), storing only true state. Never `operable`, `efficiency`,
  production totals or visuals. (Batch 17 already saves `id`, `kind`, `lat` and `lon` at schema v4;
  this batch adds stores, capacities, buildings and the grid.)
- [x] A schema version bump with a migration from the current version, like Batch 4 and Batch 9 did.
- [x] Hostile-save handling for the new fields, to Batch 10 and 14's standard: sanitise or reject
  with a named field, and never wipe a legitimate save because of a retune.
- [x] Offline catch-up (§9.4) advances every settlement under the existing §8.2 caps.

**Exit gate.**
- A world with settlements round-trips through the save exactly.
- Offline catch-up equals live play over the same sim-time, exactly, with settlements present.
- The offline design cap still bounds what an absence is worth.

## Batch 20 — Micro: the 2.5D city view — NOT STARTED

**Goal.** Micro §12 step 4: "Build the 2.5D renderer against the tile/instancing model (section 8):
ground grid, placement, procedural buildings, selection/inspector."

- [ ] Isometric projection and depth sort (§3.1); pan and clamped zoom, no rotation (§3.2).
- [ ] Placement validity (§3.3): the footprint fits, the tiles are buildable and empty, and any
  connectivity requirement is met.
- [ ] Procedural parametric buildings (§8); render-time "aliveness" driven by settlement state and
  never stored.
- [ ] Selection and an inspector panel. Readable without colour, as Batch 7 requires of the HUD.

**Exit gate.**
- Placement rules proven by tests that try every rejection case and at least one acceptance.
- A deterministic reference render of a fixed city, committed and compared per pixel like Batch 6's
  golden frames, with a tolerance that is measured.
- The city view reads settlement state only: the render walls, as for `VisualChannels`.

## Batch 21 — Micro: travel between orbit and a city — NOT STARTED

**Goal.** Micro §12 step 5: "Wire the travel transition (orbit marker -> load city scene -> back),
keeping macro ticking underneath."

- [ ] Orbit to city (§1.4): select a marker, confirm, the camera move, the city scene loads.
- [ ] City to orbit: flush, unload, pull back. City to city goes via orbit.
- [ ] Only the active settlement's scene is resident (§9.2); every settlement keeps ticking (§9.3).

**Exit gate.**
- The macro sim and every settlement advance identically whether the player is in orbit or in any
  city. Measured by running the same sim-time both ways and comparing exactly.
- Only one city scene is ever resident.

---

## Deferred decisions (from §12)

- **Spatial resolution.** Single well-mixed cell ships first, as the doc recommends. Per-latitude banding, if it happens, is a Batch 6 visual embellishment driven by the same globals — never a second source of truth.
- **Regional basins.** `ocean_frac` uses a smooth hypsometric stand-in (`OCEAN_FRAC_MAX`, `OCEAN_M_REF`) until a heightmap exists.
- **Multi-planet.** `src/sim/planets/` has been a directory since Batch 1, so a second world is a data file rather than a refactor. `G_MARS` lives there; `H2O_MBAR_PER_M` becomes per-planet when the second world arrives.

## Known environment risk

The project root is inside a live OneDrive sync folder. OneDrive rewrites file metadata and can
re-materialise Files-On-Demand placeholders, which the Vite watcher sees as change events — in the
worst case a reload loop that resets the inspector to t=0 every few seconds and looks exactly like a
simulation bug. If that appears, it is not the sim. Moving the repo outside the synced folder is the
real fix.
