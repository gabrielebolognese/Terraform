# Batch 11 — Endgame legibility

Picked from the recorded backlog after Batch 10, as "endgame pacing": four open items that looked
like one problem. They weren't, and the diagnosis turned out to matter more than the fix:

| Open item | Recorded as | What it actually was |
|---|---|---|
| The last third barely changes on screen (Batch 6, 9, 10) | a **pacing** problem: "the channels themselves are flat there" | a **renderer** gap. The sky channel travels most of its palette in that stretch, and was drawn only on the limb |
| Progress reads 87% at victory (Batch 7, 9, 10) | §8.1 vs §2.3 normalisation | the bar and the win measure **different columns** of §2.3. A presentation problem, not a formula one |
| Worst bar stall 8.9 real min (Batch 3, 10) | "the stretch after the caps finish dumping" | still true, at years 230–246 — early, not endgame. **Not changed by this batch** |
| (new) The planet itself froze for **55.6 real minutes** | never measured | the real §8.2 failure, and six times worse than the bar's |

**No simulation change.** The golden run, the Batch 3 score (0.9589), the determinism gate and the
ledger are exactly as they were. What changed: two art-direction constants, one renderer term, the
golden frames, the HUD, and a new instrument.

---

## 1. What went wrong, and what it cost

### The Phase 1 framing was wrong in two places

The batch was proposed as "four items, one cause: the pressure/oxygen tail". Measuring before
building killed that. The 8.9-minute bar stall is at **years 230–246**, before first water: T and P
creep linearly while four of six axes sit on the floor. The late flatness isn't in the sim at all.
If I'd built from the plan I would have retuned the oxygen tail, moved every calibrated gate, and
left both real defects in place.

### Batch 6's diagnosis was wrong, and it stayed wrong for five batches

`golden-frames.test.ts` quarantined steps 7→8, 8→9 and 9→10 with this comment: "by year 482 … the
only channel still moving is `atmosphereThickness` … the channels themselves are flat there, and no
amount of drawing fixes a planet that has stopped changing".

Printing the channels shows otherwise:

| Frame | Year | `skyColour` | `clearFraction` | Step (old) |
|---|---|---|---|---|
| 7 | 944 | (0.75, 0.75, 0.75) grey | 0.635 | — |
| 8 | 1226 | (0.58, 0.67, 0.80) | 0.824 | 0.0094 |
| 9 | 1548 | (0.47, 0.62, 0.83) | 0.943 | 0.0083 |
| 10 | 1756 | (0.43, 0.60, 0.85) blue | 0.991 | 0.0042 |

That is §7's Phase 5 caption, "The sky shifts butterscotch to pale to blue", happening on schedule.
The renderer drew sky colour only as `air * (1 - z)^2 * 0.9`. That weight is under 0.1 over most of
the disc, so the whole shift landed in a thin ring. It also never reads `clearFraction`, and never
applied §9's "more haze" to the disc.

The quarantine then did what quarantines do: it made the test pass, and every later batch note
repeated its conclusion. Four notes carried "the last third barely changes" forward as a balance item
nobody could fix, because it wasn't one.

### The instrument measured the bar and never the planet

§8.2 asks for two things: "a visible change to the planet at least every few real minutes" and "the
geometric progress bar should never sit still for more than a few minutes". `score.ts` measured only
the second. The new `planetStall` in `frames.ts` measures the first, using the golden-frames
`TOLERANCE` (0.2%) as the visibility threshold, because that file already established 0.2% as "the
smallest change that is actually visible".

**Before this batch: 55.6 real minutes, years 1584–1684.** The worst stall in the project was six
times the recorded one, and nothing had ever looked.

### The fix I proposed for 87% measured worse than the problem

Phase 1 floated "score pressure from the habitable minimum". I measured the fully consistent version,
with every axis normalised to §2.3's minimum column:

| | Status quo | Habitable-normalised |
|---|---|---|
| Progress on the winning year | 0.870 | **0.988**, still not 1.0 |
| Worst bar stall | 8.9 min | **17.8 min** |

T and P saturate by year 300 and the bar has almost nothing left to move on. It doesn't even reach
1.0 at victory: Phase 6 checks absolute CO₂ < 10 mbar, while the axis measures CO₂ *composition*
(scaled to 1 bar), and at 701 mbar those differ. Rejected. The other option, making victory require
the Earth-like column, is unreachable: the reference ocean settles at 0.365 against a 0.4 target, so
it would mean a full rebalance.

### Haze as a veil broke the greening

The first haze mixed the sky colour over the surface. Enough of it to show the late sky took the
ecopoiesis step (3→4, the greening) from 0.0114 to **0.0091**, and the 10→11 step to 0.0084. Both
failed the 0.01 gate that step had cleared by only 14%. The fix was physical: haze is light scattered
*into* the line of sight, so it **adds** instead of mixing. Added haze left every other channel's
response exactly where it was on the mid-run fixture (`planet.test.ts`'s spans are identical to four
decimals). *Batch 13 correction:* not in the late game, where added light clips 8.2–11.6% of the
disc and costs the cap channel 10–14% of its response. A screen blend was measured and rejected
because it damps everything more. See the [Batch 13 note](batch13-review.md). Either way the haze
carries the sky, and injection C below re-proves why it has to add rather than mix.

### Haze alone was not enough

With the linear sky mapping, even strong haze left step 9→10 at 0.0064. The last ~6% of the
composition change (CO₂ 41 → 10 mbar, the atmosphere becoming breathable) is 0.943 → 0.986 in
`clearFraction`, which is the last 4% of the palette. `SKY_CLEAR_GAMMA` reshapes the curve to
`1 - (1 - cf)^0.45`, so more of the palette goes to the dirty tail. Now the sky reaches pale around
year 1230 instead of 940, and it is still visibly clearing on the day the player wins.

### The shell's own test fixture hid the 87%

`hud.test.ts`'s "finished" world reads `progress: 0.98`. The real game never shows that number on the
day it's won. The new tests build their views from real states off the reference run (years 1600
and 1710) instead.

### Tooling: two self-inflicted costs

- **Encoding.** Python on Windows rewrote five edited files as cp1252 with CRLF endings. Existing
  UTF-8 bytes survived the round-trip, but every `§` I inserted became a lone `0xA7`. It was caught
  by eye in a test title before anything shipped, and fixed with a byte-level repair plus an
  `iconv` validation. Edit files with the editor tools, not a Windows Python.
- **`tsx -e` with dynamic imports hung** and cost five minutes of wall clock before being killed.
  Script files work.

---

## 2. What was built

| Change | Where | Gates it moves |
|---|---|---|
| Disc-wide in-scattered haze: `air * (0.15 + 0.20 * (1 - z))`, lit, **added** | `src/render/planet.ts` (`SCENE.haze*`) | golden frames (re-baselined) |
| Sky curve `1 - (1 - clearFraction)^0.45` | `src/sim/visuals.ts` (`VISUAL_TUNING.SKY_CLEAR_GAMMA`) | golden frames |
| `KNOWN_FLAT` quarantine **deleted**; every step held to `VISIBLE_STEP` | `golden-frames.test.ts` | — |
| `planetStall` instrument + pinned test | `frames.ts`, `golden-frames.test.ts` | new |
| `livingWorldShortfall`; `inLivingWorldBand` is now built on it | `src/sim/phase.ts` | none (golden run identical) |
| Bar relabelled "Progress toward Earth-like"; a status line gives the win in words ("Living world: 5 of 6 minimums met - still short on carbon dioxide.") | `src/web/hud.ts` | — |

**Why no tuning constant defaulting to 0.** The rule exists for features that perturb the *balance*.
None of this does: the haze and the sky curve are art direction, and they sit in `VISUAL_TUNING` and
`SCENE` for Batch 5's stated reason (the balance sweep must not be able to reach them). The only
calibrated gate they move is the golden frames, which exist to force exactly this kind of change to
be looked at. They were re-rendered with `npm run sim:frames` and the contact sheet was inspected.

**Look change worth a human eye:** frames 7–9 are now noticeably paler and milkier (the "pale" sky
stop across the whole disc), and the blue arrives at frames 10–11. That is the §7 caption played
straight, but it is a change in how the late game looks.

---

## 3. Measurements

Golden-frame steps (mean absolute pixel difference, 128 px; gate is 0.01):

| Step | 0→1 | 1→2 | 2→3 | 3→4 | 4→5 | 5→6 | 6→7 | 7→8 | 8→9 | 9→10 | 10→11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | .0499 | .0279 | .0216 | .0114 | .0512 | .0233 | .0173 | **.0094** | **.0083** | **.0042** | .0110 |
| After | .0648 | .0284 | .0217 | .0113 | .0497 | .0235 | .0244 | .0182 | .0120 | .0110 | .0110 |

The first-to-last difference goes from 0.162 to 0.190. The tightest remaining margins are 3→4 at
0.0113 and 9→10 and 10→11 at 0.0110, about 10% over the gate.

| Pacing | Before | After |
|---|---|---|
| Planet stall (new instrument) | **55.6 min**, years 1584–1684 | **31.1 min**, years 1386–1442 |
| Visible planet changes, year 0 to Phase 6 | — | 113 |
| Bar stall | 8.9 min, years 230–246 | 8.9 min (unchanged, sim untouched) |
| Batch 3 score | 0.9589 | 0.9589 |
| Phase years | 0, 2, 18, 274, 362, 610, 1710 | identical |

The sweep that chose the constants (haze base/limb, veil fraction, gamma) is recorded in this batch's
session. The deciding rows at γ = 0.45:

| Haze (base, limb, veil) | Min step | Planet stall |
|---|---|---|
| 0, 0, — | 0.0085 (9→10) | 36.7 min |
| 0.25, 0.25, mixed | 0.0084 (10→11) | 25.6 min |
| **0.15, 0.20, added** | **0.0110** | **31.1 min** |
| 0.20, 0.25, added | 0.0111 | 28.9 min |

The last row is marginally better on both numbers. It was not taken because it bleaches frames 8–9
further, and the gain is two minutes on a stall that is still six times over the limit.

### Every new test was verified by injection

| Injection | Caught by |
|---|---|
| Status line never written | both victory HUD tests |
| Old "percent terraformed" wording | `expected '87 percent terraformed' to match /Earth-like/` |
| Shortfall forgets the CO₂ row | the HUD test, plus the golden run (Phase 6 at **864**) and the Batch 3 floor (0.939) |
| Haze off and linear sky (the old look) | the step test naming all three old steps, and `planet frozen from year 1584 to 1684: 55.6` |
| Instrument compares the anchor with itself | vacuity guard `expected 0 to be greater than 50`, and `frozen from year 0 to 1710` |
| Haze mixed instead of added | `frame-03 -> frame-04: 0.0095; frame-10 -> frame-11: 0.0092` |

---

## 4. Open

- **The planet still stalls for 31.1 real minutes**, pinned in `golden-frames.test.ts` above the
  §8.2 limit, like the bar's stall. What's left is genuinely pacing. Across years ~1000–1700 the
  atmosphere's composition changes over centuries, and at `TIME_SCALE` 0.03 even a planet that
  shows all of it crosses the visibility threshold only about every half hour. The levers are the
  oxygen tail's length (Batch 1 and 2's "oxygen tail is most of the run") or the clock, and both
  move the Batch 3 balance. That is a real balance batch.
- **The bar still stalls for 8.9 minutes at years 230–246**, pre-first-water. During that same
  stretch `dustIntensity` is clamped at 1.000 for ~190 years (`DUST_RELEASE_REF` 0.9 against a
  ~0.92 mbar/yr release), which hides the ground under the dust haze. The new haze lets the
  thickening show through, but a saturating curve in place of the clamp is worth trying.
- **The bar reads 87% on the winning year, by design now.** It measures the Earth-like targets, and
  the HUD says so and gives the win condition in words beside it.
- The golden frames still don't cover weather (Batch 8), and Batches 1–2 still haven't been
  re-reviewed (Batch 10).
