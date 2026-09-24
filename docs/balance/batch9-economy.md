# Batch 9 note — economy, tech, and the city bridge

The last batch. §11's `economy` placeholder filled, §12.3's open question closed, and the three
things that went wrong on the way.

The design itself is in [`docs/design/economy.md`](../design/economy.md); this is the record of how it
got there and what it cost.

---

## 1. What the exit gate asked for, and where each part is

| Gate | Where |
|---|---|
| a facility costs something | `economy.ts` — escalating costs, upkeep, all-or-nothing purchase |
| the tech tree gates on phase | `tech.ts` — eight techs, every facility behind exactly one |
| the city layer has a documented, tested interface | `habitat.ts` + `habitat.test.ts` + the design doc |

**The bridge is load-bearing rather than decorative**, which was the design decision that shaped
everything else. Income is proportional to `supportIndex` — the §12.3 contract's headline number — so
the loop is: terraform → the planet supports more people → more income → more facilities → terraform
faster. A real city layer can replace the stand-in population model without that loop changing shape,
because both read the same contract.

## 2. One gate was the wrong model, and the run proved it

The first `habitat` had a single all-or-nothing `openAirFraction`: warm enough, above the Armstrong
limit, breathable oxygen, non-toxic CO2, water in reach — all at once.

It looked reasonable and it was wrong. Breathable oxygen only arrives in the last third of a
playthrough, so `supportIndex` **never left its 0.12 floor** across a 3000-year run. Income never
grew, the feedback loop never started, and the whole premise of the batch failed silently — nothing
crashed, the numbers were all finite, the game just quietly did not work.

§12.3 asks for a footprint that *grows as the planet terraforms*. So: three tiers.

- **Sealed** — always, low capacity
- **Mask** — warmth, pressure, water. No oxygen needed; a mask carries it. Opens mid-game, carries
  the largest weight, funds the second half of the terraforming
- **Open air** — the mask tier plus breathable, non-toxic air

The guard is a test, not a comment: *support must cover a quarter of its range by the halfway point*.
Collapsing the tiers back into one gate leaves it at **3×10⁻¹² of its span**, and the test fails.

A second, smaller finding in the same area: the gate ramps were far too wide. `ramp` is a
renormalised tanh, so it reaches only ~0.74 one width past its threshold — with an 8 K temperature
width the gate was still a quarter shut at 288 K, a finished Earth-like planet, and three such gates
multiplied left `supportIndex` at 0.74 on a won game. Widths are narrow now.

## 3. Tech unlocking broke two batches' contracts before it worked

**First it was in `tick()` only.** Both production drivers — the headless harness and the browser
loop — call `advance()` directly, so the unlock never fired for either. A scripted player banked
**189,000 credits and still could not buy an atmospheric processor**, because the tech gating it had
never been granted.

This is *precisely* the mistake Batch 1 found with the ledger assertion, described in `integrate.ts`
in those words: "an assertion that lived only in `tick()` never ran on any path that actually drives
the simulation". Same file, same shape, eight batches later.

**Then the fix broke Batch 8.** Moving the latch-and-unlock into `advance` but running it *once per
call* made the result depend on chunking: `evaluatePhase` is instantaneous and can go down, while the
latch is a high-water mark, so many small calls catch a transient phase peak that one big call steps
straight over. Batch 8's exit gate — the same save fast-forwarded four ways — failed immediately.

The correct place is **inside the substep loop**, on the `derive` already computed there. Chunk-
independent, and free.

That Batch 8's gate caught a Batch 9 regression is the best argument anyone could make for having
written it.

## 4. Upkeep was the constant that mattered, and it was 2.4× too high

Upkeep is the brake on unlimited over-building: it grows with the estate while income is capped by
habitability, so there is a ceiling on what can be kept running. That is a good mechanic and it very
nearly killed the batch.

At `ECON_UPKEEP_FRACTION = 0.012`, upkeep reached ~194 credits/year against an income of 191 — the
whole income went on maintenance, credits sat at exactly zero, and **the game stalled at 68% progress
forever** despite the player having earned 594,000 credits over the run. Nothing errored; it just
never finished.

Measured against a saving player (`ECONOMY_PLAN` + `spendDown` in the harness), all at 3000 starting
credits:

| income | upkeep | wins at | shield units built |
|---|---|---|---|
| 320 | 0.012 | **never** — stalls at 68% | 0 |
| 320 | 0.005 | 1905 | 5 |
| **360** | **0.005** | **1860** | 6 |
| 360 | 0.006 | 1890 | 4 |
| 400 | 0.005 | 1830 | 7 |

Shipped at 360 / 0.005: **sim-year 1860, against 1710 with the economy off — about 9% slower.** The
intent was that the economy cost *time* rather than becoming a different game, and that is what the
number says.

## 5. The instrument had to be built before the tuning could be

`REFERENCE_POLICY` is a fixed schedule of orders by year. It is the right instrument for balancing
physics and the wrong one for balancing an economy, because it buys thirty mirrors on day one —
exactly what costs exist to prevent.

`spendDown` is the replacement: a priority list and a bank balance, which **saves**. It stops at the
first thing it cannot afford rather than skipping to something cheaper, because a player who always
buys the cheapest available thing is not a player, it is a leak. The gaps where it waits for money
*are* the economy's pacing.

Worth stating plainly: the first three tuning sweeps measured a game nobody would play, because the
greedy version of this instrument spent every credit the moment it had it and never saved for
anything.

## 6. Off by default, for the fourth time and the same reason

`ECONOMY_ENABLED = 0`, `TECH_GATE_ENABLED = 0`. Costs change what a player can build and when, so
enabling them silently would invalidate the Batch 3 balance, the twelve golden frames, and the
reference trajectory a dozen exactness tests are written against. A test asserts that with the economy
off a full run leaves the wallet byte-identical to its starting state.

This is now the established pattern in this project — Batch 8's weather did the same — and it is worth
naming as a pattern: **a feature that perturbs the balance ships behind a tuning constant, the game
opts in, and the measurement instruments stay pointed at the world they were calibrated against.**

## 7. Save schema v3

`economy` stops being `unknown`. Two migration decisions:

- A v2 world arrives with the **starting balance**, not zero. It was played without costs; an empty
  wallet would strand a player who did nothing wrong, and there is no honest way to reconstruct what
  they would have banked.
- `tech_unlocked` is **rebuilt from the latched phase** — v2 never wrote one, and an empty list would
  leave a phase-5 world unable to build levers it already owns. It gets exactly what that phase
  earned and not one node further, which is asserted.

## 8. Where the project stands

All nine batches complete. 535 tests across 31 files.

**Open, and honestly open:**

- **Batches 3–9 have had no adversarial review.** This is the largest untested claim in the project
  and has been said at the end of four batches now.
- The economy has been balanced against **one scripted player on one seed**. A sweep over plans and
  seeds is the obvious next instrument, and `spendDown` is the thing to point it with.
- The progress bar still reads 87% at victory (§8.1 normalises pressure against 1013 mbar while §2.3
  requires 100) — recorded in Batch 7 and still true.
- The last third of the run still barely changes on screen — recorded in Batch 6, quarantined in
  `golden-frames.test.ts`, still true.
- There is no city layer. The bridge is built and tested; what crosses it is a stand-in where
  `supportIndex` *is* the population model. §12.1's spatial-resolution question is still open, and
  the contract stays global until it is answered.
