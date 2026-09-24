# Batch 3 balance report

What the tuning does now, what changed, and what it cost. Measured with
`npm run sim:sweep -- --candidates`; the tuned trajectory is
[`batch3-tuned.csv`](batch3-tuned.csv).

**Pacing score: 0.5961 → 0.9646.** Every hard gate passes.

---

## 1. The instrument

Batch 3's first output is not a number, it is `src/harness/score.ts`: design doc §0's pacing
paragraph turned into metrics a sweep can rank. §0 asks for "an S-curve, not a straight line and not
a wall. Slow, legible start. An accelerating middle once feedback loops ignite. A long tail as the
world settles. At no point should the player stare at a frozen bar."

Every variant scores **two** trajectories, not one. The reference playthrough must reach Phase 6 in
the target window; the null-policy run must still be dead. The second is the one that matters —
without it a retune can quietly hand the game back to the planet and every headline number still
looks fine.

**The instrument was wrong twice before it was right**, and both corrections mattered more than any
constant:

- It measured pacing over the *observation* window rather than the *playthrough*. The harness runs
  past Phase 6 on purpose, to check the end state settles — and that post-victory idle was being
  counted as a 679-minute stall. Pacing is now measured over `[0, Phase 6]`; settling over the tail.
- It penalised the final phase for being long, which scores directly against §0's stated wish for
  "a long tail as the world settles". Phase spacing now covers the climb only.

## 2. Where it landed

| Phase | Entry (sim-years) |
|---|---|
| 0 Barren | 0 |
| 1 Warming | 2 |
| 2 Runaway thickening | 18 |
| 3 First water | 274 |
| 4 Ecopoiesis | 362 |
| 5 Oxygenation and buffer | 610 |
| 6 Living world | 1710 |

A full playthrough is **15.8 real hours** at 1x (§8.2 asks for "tens of real hours"), ending at
**T 288.4 K, P 936 mbar, o₂ 233 mbar, ocean 36.5%, biomass 0.853, progress 0.975** — every §2.3 axis
at or past target. The null control ends at 212.6 K with its caps untouched, still Phase 0.

| Score part | Before | After |
|---|---|---|
| duration | 30.1 h | 15.8 h |
| no-stall | 679 min | **8.9 min** |
| phase-spacing | 57% | 15% |
| slow-start | 64% in first fifth | 18% |
| accelerating-middle | failed | passes |
| lands-in-band | o₂ 93%, bio 42% | o₂ 100%, bio 100%, CO₂ 100% |
| final-progress | 0.816 | 0.986 |

## 3. The finding that mattered: the biosphere had no carbon fixed point

The plan asked to "back-solve `Y_CO2` from the carbon budget". The sweep showed `Y_CO2` **cannot**
fix it: reaching the §2.3 oxygen target costs `210 × 44/32 = 288.8` mbar of carbon, and that price is
set by stoichiometry, not by tuning. `Y_CO2` sets the rate, not the bill.

The real defect was structural. Maintenance photosynthesis drew carbon at `M_PHOTO · b` **regardless
of conditions**, and nothing anywhere in the model returns carbon to the air — no volcanism, no
weathering. So the biosphere was a one-way pump that only stopped when the tank was empty. Measured:
every raised `M_PHOTO` reached 99% of the oxygen target **with the biosphere dead**, 298 of 306 mbar
of carbon locked in `c_fixed` and 0.01 mbar left in the air. Faster pump, faster suicide.

Gating the maintenance draw on suitability closes the loop, and gives two identities worth keeping:

```
carbon settles where   M_PHOTO · g = D_BIO · (1 − g)
biomass settles at     b* = 1 − M_PHOTO / R_BIO
```

The second is now a design handle: the endgame biomass is a **ratio you choose**. At the draft's
0.05/0.15 it was 0.667 — 83% of the §2.3 target of 0.8, capping the progress bar below 1 no matter
what the player did. At 0.11/0.75 it is 0.853.

This is a change to §3.5's equation, not just its constants. It ships as `MAINTENANCE_GATE`, a
tunable blend (0 = §3.5 as literally written, 1 = fully gated) so the decision stays visible and
reversible rather than being buried in a rewrite.

## 4. The second finding: the bar could not see the endgame

From year 1550 the run's last stretch looked like this: four of five progress axes maxed, pressure
creeping, and `co2_atm` falling 36 → 5 mbar — *the atmosphere becoming breathable*, which the metric
could not see at all. §8.1 has five axes; §2.3 has six rows. Batch 1 recorded the mismatch and
deferred it here.

A **linear** CO₂ axis is why it was deferred, and it deserves the reputation: it reads 0.69 on a dead
6 mbar Mars — a bare planet scoring high on breathability — and then *falls* through the entire
runaway, because thickening the air with CO₂ is progress on pressure and regress on carbon. The two
cancel and the bar goes flat across the most dramatic stretch of the game. Measured: adding it that
way moved the worst stall to years 232–340.

The axis that works measures **composition**: what the CO₂ partial pressure would be if the
atmosphere were brought to the 1 bar target, on a log scale. That is what §2.3's toxicity row is
actually about, and it improves as the nitrogen buffer and the biosphere's oxygen dilute the carbon,
then as the carbon is drawn down outright. It is not monotone in `co2_atm` alone — adding carbon to
a thin atmosphere does make its composition marginally worse — but across the real trajectory it
never drops by more than 6e-4, which `golden.test.ts` asserts.

## 5. The two CO₂ waves did not overlap

§3.3 describes the regolith as "a slower second wave that sustains the mid game". It was not
sustaining anything. Dumping the caps takes pressure to ~46 mbar, worth about 13 K of greenhouse,
which tops the planet out near **229 K** — short of the 240 K the regolith needed. So the first wave
ended, the second had not begun, and the bar sat flat for 60 sim-years in between. That was the
original 41-minute early stall.

`T_SUBL_REG` 240 → 230 makes the waves overlap; `R_REG` 0.4 → 1.0 makes the second one a wave rather
than a crawl (it was releasing 0.16 mbar/yr); `W_CAP` 6 → 10 spreads the first over a longer stretch
instead of dumping it in 60 years. Together these moved first water from year 480 to 274 and removed
the stall.

## 6. Everything that changed

| Constant | Draft | Now | Why |
|---|---|---|---|
| `MAINTENANCE_GATE` | — | **1.0** | new; closes the carbon loop (§3) |
| `R_BIO` | 0.15 | **0.75** | `b* = 1 − M_PHOTO/R_BIO`, so this ratio is the endgame biomass |
| `M_PHOTO` | 0.05 | **0.11** | shortens the oxygen tail; fatal if raised without `R_BIO` |
| `T_SUBL_REG` | 240 | **230** | the two CO₂ waves did not overlap (§5) |
| `R_REG` | 0.4 | **1.0** | the "second wave" was releasing 0.16 mbar/yr |
| `W_CAP` | 6 | **10** | spreads the cap dump instead of leaving a flat patch behind it |
| `N2_GREENHOUSE_WEIGHT` | 1.0 | **0.6** | §3.6's prose against §3.1's equation; the endgame was 8.9 K hot |
| `PROGRESS_FLOOR` | 0.02 | **0.10** | the early bar was frozen |
| `W_CO2`, `CO2_PROG_HI` | — | **1.0, 1013** | the sixth axis (§4) |
| `PHASE5_N2` | — | **50** | the buffer half of §7's Phase 5 condition |
| `TIME_SCALE` | "to taste" | **0.03** | 15.8 real hours |
| `co2_reg0` (mars.ts) | 260 | **300** | the oxygen target costs 288.8 mbar and the scrubber alone spent the slack |

## 7. What is still wrong

**The stall limit is not met.** §8.2 asks for no stall longer than "a few minutes"; the worst is
**8.9 real minutes**, in the stretch after the caps finish dumping. It came down from 679, and it is
pinned in `golden.test.ts` rather than papered over — if it grows, that is a regression.

It is also not fully fixable by tuning. Two things fight:

- §8.2 wants both "tens of real hours" for a full run *and* movement every few minutes, and both
  route through `TIME_SCALE`. Faster clocks improve stalls and shorten the run: 0.04 gives a
  7.8-minute stall and 11.9 hours, which stops reading as "tens". 0.03 is where that trade was made.
- A geometric mean is inherently back-loaded early, when several axes sit at the floor. Raising the
  floor buys movement and costs §8.1's "a zero on any axis tanks the whole score": at floor 0.18 a
  world with one dead axis reads 0.75. **0.18 scored three ten-thousandths higher than 0.10 and was
  rejected** — the design intent is worth more than the fourth decimal place.

Where the bar cannot carry the sense of change, §9's continuous visual channels have to. That is
Batch 5's problem and it is now a stated dependency rather than an assumption.

**The carbon budget is still the binding constraint.** 346 mbar against a 288.8 mbar bill leaves ~40
mbar of slack. That is enough for a player to make mistakes in, but the carbon scrubber remains a
trap: it competes for exactly the carbon the oxygen target needs, and the biosphere draws CO₂ down on
its own anyway. The scrubber's honest use is correcting an overshoot, not reaching the target. The UI
should probably say so.

**Phase 2 at year 18** is still very early for the "it's happening" moment — 1% into the run. The
phase fires when temperature crosses the cap threshold, which is the right trigger; what is early is
that a competent player gets there almost immediately. A cost model (Batch 9) is the natural brake,
since right now mirrors are free.

## 8. For later batches

- `src/harness/sweep.ts` holds the candidate ladder A–O with each one's rationale. A future retune
  should start by re-running it, not by editing constants.
- The golden run is `src/harness/golden.test.ts`. When it fails, read the diff before touching the
  expectation: if the phase years moved, the pacing moved.
- A test now asserts every constant in `tuning.ts` appears in §10 of the design doc, and that the
  retired ones (`G_GHG`, `E_RATE`, `C_RATE`, `SUBSTEPS`) do not. The doc's table had already drifted
  from the code in eight places by the end of Batch 1.
