# Batch 8 note — seeded events & determinism hardening

Design doc §12.2. Weather that is reproducible by construction rather than by bookkeeping, and the
conflict it exposed with Batch 5's continuity contract.

Run `npm run sim:run -- --years 600 --every 10 --events --channels` to see it.

---

## 1. There is no event queue, and that is the whole design

§12.2 asks for events "seeded from `seed` + `sim_year` so offline catch-up stays reproducible". That
one sentence rules out almost every conventional approach.

A normal PRNG is a **cursor**: each call advances it, so the stream depends on how many times it was
called. §8.2 runs catch-up in whatever chunks the load screen can afford and the browser runs in
whatever chunks a frame allows — so with a cursor, the same absence produces different weather
depending on how the work was split. The save would be reproducible and the world would not.

So there is no generator, no cursor, no queue, and nothing in the save:

```
rand01(seed, year, salt)      // a pure hash of its coordinates
activeEvents(seed, simYear)   // a pure function of time
```

Ask what is happening at year 812.5 and the answer is the same whether you arrived in one 812-year
jump, in 3250 substeps, or across four sessions with two reloads. The timeline is a property of the
seed, not of how the simulation was driven. A queue would need serialising, migrating, and keeping
consistent with arbitrary chunking; a function of time has none of those failure modes because there
is nothing to keep consistent.

Two things make this work, and both were already in place from earlier batches:

- `SimState.steps` is an **integer** substep counter and `simYear = steps × SUBSTEP_YEARS` is never
  accumulated. An accumulated clock would drift by a different amount per chunking, and the weather
  would drift with it.
- `Env` already had `sMultiplier` and `albedoDelta`, and `ForcingFn` was already the flow injection
  point. §12.2's hooks were designed in Batch 1 and sat unused until now.

**The timeline is bit-identical across engines, unlike the physics.** Invariant #5 only promises 1e-6
between engines because ECMA-262 leaves `exp`/`log`/`pow` implementation-approximated. Every operation
in `rng.ts` is a 32-bit integer op (`Math.imul`, `^`, `>>>`), which the spec pins exactly. So two
machines disagreeing in the last ulp of a temperature still get the *same storms on the same days* —
which is the distinction the exit gate draws.

## 2. The exit gate, and the proof it is not vacuous

*The same save fast-forwarded three different ways yields identical event timelines.* Four ways, in
fact — one 4000-substep jump, 1000 four-substep calls, a deliberately ragged `[1,7,3,64,2,128,11,5]`
split, and `catchUp` — and the assertion is stronger than the gate asks: the resulting **worlds** are
`toEqual` identical, not merely the timelines, because invariant #5 makes the same substep grid exact.

Two guards keep it honest:

- The span is asserted to contain **more than 100 event samples**, so the agreement cannot be the
  agreement of nothing happening.
- A separate test asserts events-on differs from events-off, so the whole system cannot be a no-op.

**Verified by injection.** Keying events on the per-call substep index instead of absolute time — the
exact bug the design prevents, and the natural way to write it wrong — fails "yields the identical
world". Dropping the lookback to zero fails "finds an event for its whole duration".

## 3. Three modelling decisions worth stating

**A comet impact is spread over a fixed year, not delivered as an impulse.** A real impact *is* an
impulse, but an impulse has no well-defined rate and every flow in this engine is a rate. A fixed
delivery window makes the mass exact and independent of substep size, which is the point of the batch.

**The "heat pulse" is derived, not injected.** §12.2 asks for one, and the obvious implementation is
an energy channel — but §2.2 says temperature is derived, and a bespoke energy input would be a second
way for temperature to happen. Instead a quarter of the delivered water arrives as **vapour**, which
is a greenhouse gas in this model: the impact warms the planet through the same term everything else
does, and the warming fades as the vapour condenses. Ejecta simultaneously raise albedo, so an impact
is a brief competition between warming and cooling rather than a one-way nudge.

**Solar variability is not an event.** It is a wander, always present, so it is a sum of three
sinusoids on incommensurable periods with seed-derived phases — smooth, bounded, reproducible, and
needing no lookback or bookkeeping at all.

## 4. Storms conflict with Batch 5's continuity contract. Resolved, not ignored.

Batch 5 established that **no channel may change more than 25% of its range per real minute**. A dust
storm takes §9's dust channel from 0 to ~0.9 in about a sim-year, which at `TIME_SCALE = 0.03` is
**1.9 of its range per real minute — roughly eight times the bound.**

Making a storm slow enough to satisfy it would mean stretching it to about **22 sim-years**. That is
not a storm, it is a climate, and tuning physics to satisfy a UI smoothness rule is the wrong way
round.

**The resolution is Batch 5's own rule, not an exemption.** That bound was never "no channel may move
fast"; the note says plainly that *a channel is only in trouble if it jumps when its driver did not*,
which is why the test carries a driver per channel. §0.3's failure mode is a **mapping with a hidden
threshold**, and weather is not that: a storm is a raised cosine in time, continuous with a continuous
first derivative, and dust follows it faithfully. So the storm simply joins dust's driver, and the
test runs a second time with weather on.

That still catches real faults, verified by injection:

| injected | caught by |
|---|---|
| a hidden threshold in the dust **mapping** | both scans — 2 snaps without weather, 20 with |
| storms become a **step function** (envelope removed) | "leaves the storm itself smooth, not a step" |

One thing that did **not** work first time: the composite driver has to be **clamped**, because
`clamp01(release/REF + storm)` is literally the argument `deriveVisuals` applies. Left unclamped, the
driver's span became the early outgassing transient — many times its own reference — so a storm moving
half the channel registered as a rounding error against it and **61 perfectly explained storms were
reported as snaps**.

## 5. Tuning set by how it reads, not by Mars

Mars has a planet-encircling storm roughly every three Martian years. At that rate, in a game played
over millennia, a storm would be running essentially always and would read as a constant rather than
an event. One per fifteen years leaves the sky clear most of the time.

Duration went **0.5–3 → 2–8 sim-years** during the batch for the same reason: at `TIME_SCALE = 0.03`
a sim-year is 33 real seconds at 1×, so a half-year storm was a 17-second flicker, over before a
player could look up. Two years is about a real minute — long enough to arrive, be noticed, and pass.

That change had a consequence worth recording: storms now **overlap routinely**, which broke a test
that asked whether *any* dust storm was running just after a given one ended. It was — a different
one had begun. The test identifies events by start year now.

**Measured effect of a major storm** (magnitude 0.79, at year 134):

| | |
|---|---|
| albedo | 0.252 → 0.321 |
| temperature | **−5.2 K**, recovering over ~3 years |
| dust channel | 0 → 0.87, smooth ramp both ways |

**Measured effect on the balance**, reference playthrough:

| | events off | events on |
|---|---|---|
| victory | year 1710 | year 1712 |
| final ocean | 0.365 | 0.374 |
| final progress | 0.975 | 0.978 |

Visible weather, negligible drift: +2 sim-years, 0.1%. Tripling the storm rate changes nothing
further, because storms are transient and cancel over a 1700-year run.

## 6. Off by default, and deliberately

`EVENTS_ENABLED = 0` in the shipped tuning. Turning events on perturbs every trajectory, which would
churn the twelve golden frames, move the balance the Batch 3 sweep measured, and make a dozen
exactness tests depend on the weather. The browser opts in; `defaultConfig()` does not; the harness
takes `--events`.

It is a **tuning constant rather than a config flag** so the balance sweep could measure its effect if
it ever needed to, and so enabling it is `makeTuning({ EVENTS_ENABLED: 1 })` rather than a new field
on `SimConfig`.

## 7. Three existing guards fired during this batch

Worth recording because all three were written in earlier batches and all three earned their keep:

- **Invariant #2's host-global scan** rejected a local variable named `window` in `tuning.ts`. Petty
  on its face, correct in substance: a local called `window` is one careless edit from resolving to
  the real one.
- **The unit-bridge guard** rejected `events.ts` naming `H2O_MBAR_PER_M` directly. The comet's
  metres→mbar conversion goes through `metresToVapourFactor` like every other flow — the guard that
  would have caught §3.4's factor-of-371 error.
- **The §10 drift guard** (Batch 1) demanded all 14 new constants be documented in the design doc
  before it would pass.

## 8. Open

- Events are off in the golden frames, so the contact sheet shows no weather. A storm's dust is very
  visible; a "weather" frame set would be worth having.
- The dust channel is the only §9 channel weather touches. A comet's vapour shows up in `cloudCover`
  indirectly, but an impact has no distinct look.
- Batches 3–8 have had no adversarial review.
