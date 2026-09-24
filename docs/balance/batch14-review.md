# Batch 14 — Review of Batch 13's fixes, and its two latent items

Not in the build plan. Batch 13 closed with "Batch 13's own fixes have had no review. The reviewers
found my Batch 12 fix wrong within an hour, which is the argument for reviewing this batch too."
Two of those fixes were exactly the kind that produced Batch 12's defect: a loosened gate (the ledger
tolerance) and a rewire of every environment reader (`worldEnv`).

The argument held. **Three of Batch 13's fixes were themselves defective, and one of its tests was
weak.** An independent reviewer found them under a no-edit rule. I reproduced each one, fixed it,
and broke each fix on purpose to prove its test catches it. I also closed Batch 13's two latent sim
items, and found a third on the way. The golden run, the golden frames and the Batch 3 score are all
unchanged. 590 tests pass, up from 578.

---

## What was wrong with Batch 13's fixes

| # | Batch 13 fix | What was wrong with it | Severity |
|---|---|---|---|
| 1 | Reject a save whose `deployed` exceeds the cap | A retune that lowers a cap wipes legitimate saves | moderate, latent |
| 2 | Scale the ledger tolerance by the gross size of the terms | At 1e-9 that is 1,100× to 17,000× looser on the browser's 1-substep calls, so an undeclared escape leg passes | low–moderate |
| 3 | Tie decay's carbon leg to oxygen's rationing | Ignores its own source's rationing, so `c_fixed` can go negative | low, latent |
| 4 | `readout.test.ts` | One sample carries the whole test, so a readout one substep late (0.93 K off) passes | test weakness |
| 5 | Refuse a NaN level | A level of 0, −1 or −Infinity still silently downgrades a paid level | low |

### 1. Rejecting an oversized save wiped legitimate ones

A save is read under the tuning **of the build that loads it**. A 250-unit mirror array written
honestly under today's caps raised a `SaveError` under any build with `FACILITY_MAX_LEVEL: 4`. Boot
answers a `SaveError` with a fresh Mars, and the autosaver then writes over the slot: 1,024 sim-years
gone. The check was also inconsistent, since `count` and `level` above the new cap loaded fine.

Batch 13's own ramp normalisation already repaired an oversized value, so rejecting was strictly
worse than accepting.

**Fixed:** the value is clamped on load. The reviewer also found the ramp runs *after* the
environment is built, so the first substep still integrated 1000 units. Every reader of `deployed`
(environment, shield, flow levers, upkeep) now goes through one `liveUnits` helper that clamps to the
cap. A world holding 1000 units is now exactly a world holding 250, from the first substep.

### 2. The gate I loosened, loosened too far

The gross-magnitude scale was right; the 1e-9 tolerance sitting on it wasn't. Measured honest drift
per `advance` call:

| Run | Worst honest drift |
|---|---|
| Reference, events on, **1-substep** calls (the browser), 3000 y | 4.9e-16 |
| Reference, events on, 2048-substep calls | **6.7e-14** |
| Maxed imports, 2048-substep calls, 20,000 y | 6.2e-15 |

1e-9 was 15,000× above the worst of those. The reviewer measured what that allowed through
**1-substep** calls, which is how the browser calls `advance` at every speed up to 100×: nitrogen
leaks 1,100× larger than the old rule allowed at year 1536, and 17,000× larger by year 20,000. An
undeclared water-escape leg at the rate measured at year 1710 **passed forever**.

**Fixed:** the tolerance is now 1e-12, about 15× over the measured honest worst. The dropped escape
leg now fails at 700× the limit in a single substep. Injection: at 1e-9 the test fails.

One hole stays open. A hand-edited save with offsetting ledger values of 1e12 still blinds the carbon
check, because the magnitude swamps any leak. It needs a hand-edited save, and bounding ledger values
on load is recorded below.

### 3. A tied flow ignored its own account

Batch 13 made decay's carbon leg follow oxygen's rationing. The claim "`c_fixed` is never rationed,
so following `o2` loses nothing" is true today, because decay is the only consumer of `c_fixed`. A
second consumer breaks it. The reviewer added a burial flow and `c_fixed` went to **−0.001667** with
no error that substep.

**Fixed in `applyFluxes`, not in biomass:** a tied flow now takes whichever cut is deeper, its tie's
or its own source's. That's the general rule, and it's why the photosynthesis oxygen leg (tied to
CO₂, with no source) behaves exactly as before. Injection: the tie-only rule reproduces −0.001667.

### 4. The readout test rested on one sample

The only phase change in its window is first water, so every broken readout was caught, or missed,
by one sample at year 275.75. A readout one substep late was 0.93 K off in temperature and passed.

**Fixed without restating the implementation.** `advance` hands every forcing the derived state it's
really using, so a spy forcing reads the simulation's own temperature at each substep and the test
requires the readout to match it exactly. Injection: one substep late now fails at **all 196**
samples, and a wrong seed fails too.

### 5. Levels below 1

Batch 13 refused a NaN level because it silently downgraded a paid level 2 to level 1. A level of 0,
−1 or −Infinity did exactly the same. A level below 1 means nothing and is now refused.

A negative **count** is left as it is: Batch 2 made "order fewer than none" mean dismantle, on
purpose, and pinned it in a test. −Infinity count follows the same rule.

---

## Batch 13's latent items

**Biomass grew on carbon it wasn't given.** When `applyFluxes` rations `co2_atm` (a scrubber and the
biosphere over-requesting it together), the carbon leg of photosynthesis was cut and the growth it
paid for wasn't. At the reported tuning, carbon was cut 0.83% and biomass grew the full 0.01504.

**Fixed:** `applyFluxes` now reports the scales it applied, and `advance` cuts growth by the CO₂ scale,
the same rule `biomassStep` already applies to its own carbon limit. It's still unreached at the
shipped tuning (the sweep found no rationed substep), so the golden run is unmoved. The test guards
against vacuity by asserting the scenario really does ration.

**A NaN biomass could leave `advance`.** Confirmed: with `R_BIO` = NaN, a 1-substep call returned NaN.
Chasing it found a worse one: **with `M_PHOTO` = NaN no error happened at all.** `Math.min(NaN, x)` is
NaN, `NaN > 0` is false, so no photosynthesis flow was emitted, and Batch 10's finite-rate check can't
see a flow that doesn't exist. Photosynthesis simply stopped. That's Batch 10's Finding 5 in a new
place.

**Fixed twice:** a finiteness check on the photosynthesis demand, and one on biomass at the end of
every call. Each was verified to hold the `R_BIO` case on its own by removing the other. The
`M_PHOTO` case needs the first.

Both NaN cases need a non-finite tuning, and the browser and the harness both validate the tuning at
startup. Production can't reach either; these are defence in depth.

---

## What held

- **`advance` is unchanged by `worldEnv`**: same year, same substep grid, bit-identical.
- **Chunk-independence with an out-of-range `deployed`**: one 3000-step call equals the ragged split
  and 3000 single steps.
- **Seeding**: the shell's `canSeed` and the seed action use the same weathered environment.
- **The pinned planet stall** runs with events off, so `run.ts` gaining weather can't move it.
- **The remaining no-weather environment sites** are harmless: the start-up summary at year 0 with
  events off, and flow lists that feed only the dust channel.
- **`co2-edge.test.ts`** reaches the feed rule, whose `o2 > 1` condition is met by the fixture.

## Recorded, not fixed

- **The continuity gate has a floor.** Any hidden step up to 13.9% of a channel's range per sample
  passes the original Batch 5 rule. That's inherent in the 25%-per-real-minute bound, not new here.
  It's also why Batch 13's +0.5 injections were caught so easily.
- **Hand-edited saves can blind the ledger check** with enormous offsetting ledger values. Bounding
  ledger values on load would close it.

## Open

- **The CO₂ progress axis decision** (Batch 12) is still the only route to the remaining §8.2
  failure, the 31.1-minute planet stall.
- The dust clamp (Batch 11), weather golden frames (Batch 8), the build panel and scrubber copy
  (Batch 7, 3), and the city layer (Batch 9) are unchanged. The economy sweep stays deferred.
- **Reviews are now finding their own previous fixes wrong, at shrinking severity.** Batch 13's worst
  finding was serious; this batch's worst is a latent save wipe. I'd stop reviewing here and move on
  to player-facing work.
