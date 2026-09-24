# Batch 13 — Adversarial review of Batches 1–2, 11 and 12

Not in the build plan. Batches 1–2 had not been re-reviewed since their own review (Batch 10's
Finding 5 was a Batch 1 defect), and Batches 11–12 had had none. Batch 10 set the method: attack by
running things, confirm every finding by injection, and record what held as well as what broke.

Three independent reviews ran in parallel, one per area, and were barred from editing any tracked
file so their concurrent test runs couldn't corrupt each other. I reproduced every finding myself
before fixing it, and every injection was done one at a time afterwards.

**Result: 8 defects fixed, 2 findings resolved as corrections to my own notes, each fix pinned by a
test that was broken on purpose to prove it bites.** The worst finding was in my own Batch 12 work.
The golden run, the golden frames, the Batch 3 score and the determinism gate are all unchanged.
578 tests pass, up from 559.

> **Corrected by Batch 14's review ([note](batch14-review.md)).** Three of the fixes below were
> themselves defective:
> - **Finding 4:** rejecting an over-cap `deployed` made any retune that lowers a cap wipe old saves. It now clamps on load.
> - **Finding 2:** the gross-magnitude scale at 1e-9 let an undeclared water-escape leg through on the browser's 1-substep calls. The tolerance is now 1e-12.
> - **Finding 6:** tying decay's carbon leg to oxygen alone let a rationed `c_fixed` go negative. A tied flow now respects both.
>
> The readout test also rested on one sample. The text below is left as written.

---

## The findings

| # | Defect | Severity | Batch | Outcome |
|---|---|---|---|---|
| 1 | My relaxed continuity rule excused real snaps | **serious** (a guard gate) | 12 | reverted |
| 2 | Ledger tolerance scaled by net value, so false `SimInvariantError` in production | moderate | 1 | fixed |
| 3 | The browser read and latched a weather-free world | moderate | 8 → 11 | fixed |
| 4 | An oversized `deployed` from a save was never corrected | low–moderate | 2 / 4 | fixed |
| 5 | NaN/Infinity orders dismantled paid units and reported success | low | 2 / 9 | fixed |
| 6 | Decay ran as half a reaction when oxygen was rationed | low, latent | 1 | fixed |
| 7 | Continuity scans never checked the year 0→1 step | low | 5 | fixed |
| 8 | CO₂ at exactly 10 mbar: HUD row, feed and guidance disagreed with the win | cosmetic | 7 / 11 | fixed |
| 9 | Additive haze clips late frames; the Batch 11 note overclaimed | low | 11 | note corrected, code kept |
| 10 | Batch 12 note: comet-ratio and injection-count claims false | — | 12 | note corrected |
| + | `planetStall` silently measured a truncated window | hardening | 11 | fixed |

### 1. My own gate-loosening was the worst defect

Batch 12 added a second "did the driver jump?" reading to the continuity test: a driver step 20× its
local median, and at least 1% of span, also counted. It excused any channel snap in that sample,
whatever its size. The reviewer applied hidden **+0.5** steps keyed on pressure crossing a threshold
(real, state-keyed mapping thresholds, each crossed once), and **11 of them** passed that the
original rule catches:
- clouds at year 33
- dust at years 405–407
- with weather on, dust at 189 (where the local median is exactly 0), and tint at 310 and 1784

My Batch 12 injection only tried thresholds keyed on the driver's *own* value. Those are nearly
always crossed again somewhere the driver is smooth, so they were caught, and the rule looked safe.

**Reverted** to Batch 5/8's rule. The trade is written into the test. A whole-run span can make a
future rebalance trip a false alarm, and a false alarm gets investigated (Batch 12 did exactly
that). A false pass on the gate that guards §0.3 gets noticed by nobody.

**Verified by injection:** the year-33 cloud snap is now caught ("moved 0.4874 of its range in 0.56
real minutes").

**What the revert costs, measured by the reviewer:** across seeds 1–200 with weather on, the
original rule raises one false alarm, on **seed 120** (clouds, year 245, a comet). The game ships
one seed, and that seed passes. If the seed ever changes, that alarm is the first thing to
investigate, not a reason to loosen the rule again.

The same review found two false claims in my Batch 12 note. On the shipped seed, three comets sit at
5.6×, 8.2× and 18× their local median, not "76× to 10¹¹×", so there was no "~4× margin". And the
"3 / 5 snaps" injection counts couldn't be reproduced. Both are corrected in place, with the
original text left as written, because the reasoning error is the useful part.

### 2. The ledger check could crash a correct game

`relativeDrift` divided by the identity's **net** value, but rounding error scales with its
**terms**.
- The nitrogen identity sits at about 20 while `n2` and `n2_imported` grow without bound, so after
  about 211,000 sim-years of maxed imports pure cancellation error crossed 1e-9.
- A world whose identity is exactly 0 (a save with no nitrogen) threw on its **first substep** at
  3.5e-18.

`setDevChecks` is never called in production and `loop.ts` doesn't catch, so both would have
stopped the shipped game.

**Fixed:** the scale is now the gross sum of the absolute values of the terms. Three tests:
- the zero identity is accepted;
- a 1e9-magnitude identity is accepted;
- a **small** leak (0.01 mbar/yr) is still caught, so the new scale can't go loose unnoticed.

Injected both ways: reverting to the net scale fails the first two, and a 1e9× looser scale fails
all three leak tests.

### 3. The browser was describing a different planet

`main.ts` derived its readout, and **latched the phase**, from `effectiveEnv(NEUTRAL_ENV, …)`, with
no weather. The browser runs with events on, and `advance` integrates against them.
- During a storm at year 397 the HUD's living-world line counted temperature as met at 273.0 K while
  the sim was integrating 269.2 K.
- The browser latched Phase 3 1.5 sim-years early.
- `offline.ts`, `arc.ts` and `run.ts` had the same pattern.

This is Batch 10's Finding 4, where `tick` left out the weather, reappearing in the production
driver. That makes it the **fourth** instance of the "two paths, one world, two answers" shape.

**Fixed** at the root:
- `worldEnv(state, base, t)` in `integrate.ts` is now the single definition, used by `advance`,
  `tick`, the offline summary, the arc and the harness.
- The browser's readout moved into `src/web/readout.ts`, so it can be tested without booting
  `main.ts`.
- The test steps a weathered world across first water one substep at a time and requires the
  readout's phase to equal the phase the simulation latches from the same state.
- Guarded against vacuity: the weather moves T by 2.76 K in that window.
- Injected: the old readout fails at "year 275.75: readout 2, simulation 3".

### 4. A save could hold a lever above its cap forever

`save.ts` rejected a negative `deployed` and nothing above it. `stepFacilities` then clamped 1000 to
250, found that equal to the target, and returned the facility **untouched**, so the raw 1000 kept
feeding `effectiveEnv`. Measured: sMultiplier 5 and 350 K, indefinitely.

**Fixed twice**, because they're two claims:
- the save rejects `deployed` above the facility cap, with a named field. Above `count × level` is
  still legal, because a dismantled lever ramps down through it, and a test says so.
- the ramp normalises any out-of-range value it sees.

Each half was injected separately and caught separately.

### 5. NaN meant "dismantle", and Infinity meant zero

`clampInt` mapped every non-finite value to the lower bound.
- `orderFacility(s, mirror, NaN)` zeroed ten paid level-2 mirrors and returned `ok: true, cost: 0`.
- `Infinity` did the same, contradicting the "oversized orders saturate" rule.
- A NaN level silently downgraded level 2 to level 1, which cost 1,898 credits to buy back.

**Fixed:** NaN is refused, and ±Infinity saturates like any other out-of-range number.

My first test of the Infinity case failed with the fix in place. Forty more level-2 mirrors cost
more than the wallet held, so the order was refused for a reason unrelated to the test. That was a
bad premise on my part, and I moved the test to the economy-off world where only saturation is in
question.

### 6. Half a reaction, again

`biomass.ts` says decay was fixed to limit both reagents up front. But `bio.decay_o2` shares `o2`
with atmospheric loss, and together they can over-request it. `applyFluxes` then rationed the oxygen
leg while the carbon leg ran in full. Oxygen was created at 1.25e-8 per substep in a 0.001 mbar
world.

**Fixed:** the carbon leg is now tied to the oxygen leg's rationing (`scaleWith: "o2"`). Drift fell
to 4.4e-16. The test includes a vacuity guard that oxygen really was exhausted.

### 7. The first step was never checked

Both continuity scans looped from `i = 1`, so `steps[0]`, the move from year 0 to year 1 where the
opening orders land, was never scanned. A +0.9 dust snap there passed. **Fixed and injected.**

### 8. Exactly 10 mbar

The win needs CO₂ **below** 10. The HUD's CO₂ row, the event feed and the guidance all used `<=`.
Unreachable in practice, but three voices contradicted the fourth.

The test compares each voice with the simulation's own `livingWorldShortfall`, not with a restated
`<`. Each voice, broken alone, is caught.

Its vacuity guard caught my first fixture: biomass at 0.5 made biomass the bottleneck, so the
guidance never reached its CO₂ branch and the advice check proved nothing.

### 9. Haze clipping, and a claim I made too broadly

Batch 11 said the added haze "left every other channel's response exactly where it was". That's true
on the mid-run fixture only. Late frames clip: 8.2% and 11.6% of the disc on frames 8 and 11, against
3.2% and 4.7% with no haze. That costs the cap channel 10–14% of its response there.

The reviewer's suggested screen blend was measured and **rejected**:

| | Additive (kept) | Screen |
|---|---|---|
| Clipped, frames 5 / 8 / 11 | 3.0 / 8.2 / 11.6% | 1.1 / 4.6 / 6.6% |
| Cloud response, frame 8 | 0.01147 | 0.01049 |
| Smallest golden step | 0.0110 | 0.0101 |
| Planet stall | 31.1 min | 33.3 min |

Screening damps every change beneath it, not just the clipped ones. The code comment and the Batch 11
note are corrected.

### + `planetStall` could measure half a game

If the run ends before the win, the instrument measured a truncated window. A 1000-year run read
17.8 minutes, **inside** the pin's bounds. It now reports `reachedWin`, and the test requires it.
Injected: the shortened run fails only the new test.

---

## What was attacked and held

- **The live inspector** (Batch 1), which had no test of its own. I rendered the real component under
  happy-dom at 11 states from year 0 to 4000, with everything off and with economy, tech and events
  on. There were no NaN, undefined, Infinity, null or `[object` strings and no bar outside 0–100%.
  The probe was proven by poisoning one state with NaN, which it found 16–17 times.
- **O₂ stoichiometry, per substep, over 4000 years:** 1.5e-11. That includes a maxed scrubber and a
  forced die-off with 7,805 substeps on the refugium floor.
- **Chunk-independence**, events on, with a shield ramp and a mirror level change mid-ramp. The single
  call equals 5000×1, 2048+2048+904, a ragged split, `catchUp`, and a save/load at step 1234, all
  under `isDeepStrictEqual`.
- **Offline catch-up:** future timestamps, NaN and ±Infinity `now`, and garbage dates all grant 0 or
  cap correctly. The 8-hour boundary (±1 ms) grants 129.6 sim-years.
- **`P_FLOOR`:** a maxed scrubber stops at 8.06 mbar.
- **Long-run carbon and water identities:** at most 5.9e-15 and 5.5e-12 over 102k years.
- **The sky gamma curve's infinite slope at clearFraction 1** is never approached, because vapour and
  GHG hold `1 − cf ≥ 0.002`. The worst sky rate across 10 hostile policies is 0.05 of range per real
  minute, against a limit of 0.25.
- **`livingWorldShortfall` at every band edge.** Inclusive where §2.3 is inclusive, strict at CO₂,
  and NaN fails closed.
- **The HUD test's win−110 offset:** CO₂ is the only missing row from 300 years before the win to 2
  years before, under both policies.

## Open

- **`biomassNext` isn't rescaled when `applyFluxes` rations `co2_atm`.** Biomass grew in full while
  carbon was cut 0.83%. It was reproduced only with a non-default tuning (`CO2_FOR_LIFE` 0.005,
  `R_BIO` 3); latent at the shipped values.
- **A NaN biomass on the last substep of an `advance` call** would escape that call before the next
  call's reservoir scan. Suspected; I couldn't produce one from finite inputs.
- **The CO₂ progress axis decision** (Batch 12), the dust clamp (Batch 11), weather golden frames
  (Batch 8) and the city layer (Batch 9) are unchanged. The economy sweep stays deferred.
- Batch 13's own fixes have had no review. The reviewers found my Batch 12 fix wrong within an hour,
  which is the argument for reviewing this batch too.
