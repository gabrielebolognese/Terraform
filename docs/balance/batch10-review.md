# Batch 10 — adversarial review of Batches 3–9

Not a batch in the build plan. The plan ends at nine, and every batch note from 6 onward closed with
the same line: *"Batches 3–N have had no adversarial review."* This is that review.

Batches 1 and 2 were reviewed adversarially and it paid — 18 defects and a blocker that crashed 24% of
a fuzz run. Seven batches went in without one.

**Result: five confirmed defects, all fixed, each pinned by a regression test verified by injection.**
Plus one defect in the review's own tests.

---

## The findings

| # | Defect | Severity | Batch |
|---|---|---|---|
| 1 | Guidance recommends levers the player cannot afford | moderate | 7 × 9 |
| 2 | Levelling up a facility was **free** | serious | 9 |
| 3 | The tech gate was not enforced on seeding | moderate | 9 |
| 4 | `tick()` reports a calm planet during a storm | low | 8 |
| 5 | NaN flow rates were **silently dropped** | moderate | 1 (found now) |
| 6 | Two of this review's own tests were vacuous | — | 10 |

### 1. Advice the player cannot act on

The shell said *"Import nitrogen first"* and put an **Order one** button under it, with 563 credits
against a 900 credit price. `guidance.test.ts` already calls this class *"the single worst failure
available to this feature"* — for seeding. The guidance predates Batch 9 and never learned about
money, and `canSeed` guarded exactly one lever.

Found by walking a full economy playthrough and dry-running every piece of actionable advice against
the simulation: 2 of 138 actionable samples were unactionable.

**Fixed** in two places, because they are two different claims. `withAffordability` changes the
*advice* — the planet still needs nitrogen, but the action becomes saving for it and `waiting`
becomes true, because waiting for money is honestly what the player is doing. And `canSeed` became
`canSeed` + `canOrder`, each a dry run of the exact action its button would take.

### 2. Levelling up was free

Buy five mirrors at level 1 for 1,353 credits. Upgrade all five to level 5 for **zero**. Solar
multiplier goes 1.02 → 1.10.

`orderCost` looped over the **count** and returned early when the count had not changed, so
`ECON_LEVEL_COST` — documented as "higher-level units are strictly better, so they are strictly
dearer" — was being applied to nothing. Optimal play became "buy one unit, then max its level for
free", which made the entire economy optional.

**Fixed:** two charges, not one. New units pay in full at the target level; units already owned pay
the *difference* between their old level's price and the new one's. Upgrading is now dearer than
doing nothing and cheaper than rebuying.

**Why nothing caught it.** The 500-trial fuzz never found it and neither did `spendDown`, because
`spendDown` always orders *new* units at the target level and never upgrades existing ones. Only a
player would take this line. A hand-built probe asking "what is the cheapest way to get the most
effect?" found it immediately.

The documented economy pacing survived the fix unchanged — still sim-year 1860 — for the same reason.

### 3. A gate that was advertised and not enforced

`TECH` lists `ecopoiesis` as unlocking `biosphere_seeding`. `techGate` correctly returned
`allowed: false`. `seedBiosphere` seeded anyway: it has its own entry point and never asked. A
phase-0 world could start a biosphere.

`economy.test.ts`'s *"covers every facility exactly once"* passed throughout — it checks the **tree's
completeness**, not the **gate's enforcement**, and the difference is invisible until you look. Same
shape as an assertion that only lives in `tick`.

### 4. Two paths, one world, two answers

`tick()` computed its reported `derived`, `phase`, `progress` and `flows` from `cfg.env` — without
the §12.2 weather that `advance` had just integrated against. During a storm it reported a planet
several kelvin from the one the simulation was actually running.

Low severity because **nothing in production calls `tick`** — both drivers and `catchUp` call
`advance`. But it is an exported API that lies, and "nothing calls it" is exactly the condition that
let the ledger assertion (Batch 1) and the tech unlock (Batch 9) rot there.

### 5. A silent repair, in a function that refuses silent repairs

All three passes of `applyFluxes` filter on `!(flow.rate > 0)`. `NaN > 0` is false — so **a flow with
a NaN rate was silently skipped**. No error, no effect, and a planet that quietly stopped responding
to one of its own physics terms.

Pass 4 of the same function says, in a comment: *"a bug in a rate module must be loud rather than
quietly repaired."* A silent skip is a quiet repair, twenty lines above the sentence refusing it.

**Fixed** with a Pass 0 asserting every rate is finite and non-negative before any of it runs. Zero
stays legitimate — a facility with no units emits zero — so only NaN and negatives are errors.

This is a Batch 1 defect that survived nine batches, two adversarial reviews of neighbouring code, and
555 tests.

### 6. This review's own tests were vacuous

The first version of the guards for findings 4 and 5 grepped the source: `integrate.ts` for
`isFinite`, `tick.ts` for `eventEnv`. **Both passed with the logic removed** — the first because the
word still appeared in an unrelated argument check twenty lines away, the second because the *import*
was still there.

That is precisely the trap this project already hit in `tuning.test.ts`, recorded in the Batch 1 note,
and I walked into it anyway. Caught by injecting against my own new tests before trusting them.
Replaced with behavioural tests that poison a real run.

**A test that reads source text tests the source text.**

---

## What was attacked and held

Findings are the point of a review, but so is the list of things that turned out to be sound.

- **500-trial fuzz, everything enabled** — random tunings, random illegal orders, random enable
  toggles, 1–200 substep jumps. Zero failures on: reservoir finiteness and non-negativity, wallet
  non-negativity, habitat contract bounds, `supportIndex > 0`, mask ≥ open-air, and save round-trip.
  Coverage reached phase 5, progress 0.82, 35,237 credits spent, 3,779 refusals, 8 techs granted.
- **Hostile saves** — `Infinity`, `NaN`, negative and string credits, array and missing economy,
  duplicated and garbage tech ids, out-of-range phases, unknown facility types, `__proto__`
  pollution. Every one either sanitised or rejected with a named field. No prototype pollution.
- **Determinism with events + economy + tech all on** — one jump, 600 small calls, a ragged
  `[1,17,3,64,2,128,11]` split, and `catchUp` all produce byte-identical worlds.
- **Offline caps** — 48 h and 720 h away are worth exactly what 8 h is worth. The §8.2 design cap
  holds with the economy on; an absence does not bank free credits beyond it.
- **Batch 3's pacing claims** — re-measured after six further batches and **exactly** intact: 15.8
  real hours, 8.9 min worst stall, victory at 1710, score 0.96. Weather moves it by 2 sim-years.
- **Mothballing** — disabling a facility to dodge upkeep banks 16% more credits but costs 1.64 K of
  warming. A trade-off, not an exploit.

## What this says about the project's test suite

Four of the five defects were invisible to 555 passing tests, and the shapes repeat:

1. **Completeness tested, enforcement not.** Finding 3's tree was complete and its gate unenforced.
2. **Logic on a path nothing runs.** Findings 4 and 5 both live in code reachable only from `tick` or
   only in a branch a filter had already skipped. Third and fourth instances of this class.
3. **Instruments that cannot express the bug.** `spendDown` never upgrades, so it could not find
   Finding 2 however many seeds it ran.
4. **Tests that restate the implementation.** Finding 6, and the Batch 8 scrubber test before it.

The one technique that found or confirmed everything here was **injection**: break the fix, watch the
test fail, restore. It caught all five defects' regression tests *and* caught two of my own tests
being worthless.

## Still open

- The city layer still does not exist; the §12.3 bridge is built and tested with a stand-in.
- Progress reads 87% at victory — §8.1 and §2.3 disagree about "done" (Batch 7).
- The last third of the run barely changes on screen (Batch 6, quarantined).
- The economy is balanced against one scripted player on one seed (Batch 9).
- §8.2's "no stall longer than a few minutes" is still 8.9 (Batch 3).
- **Batches 1 and 2 have not been re-reviewed since**, and Finding 5 was a Batch 1 defect.
