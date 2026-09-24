# Batch 7 note — the game shell

§7's milestones and §8.1's progress made legible to a player. What the shell shows, how "what next"
is derived rather than scripted, and the three defects that only showed up when the pieces were put
together.

---

## 1. The exit gate is a function, not a screenshot

The gate was *"a new player can tell, without documentation, what the planet needs next."* That is a
claim about every moment of a playthrough, so it is answered by code and checked at 1201 of them.

**The answer falls out of §8.1's own maths.** Progress is a weighted geometric mean of six normalised
axes, chosen precisely so that "a zero on any axis tanks the whole score". Differentiate it and the
marginal gain from lifting axis `i` is

```
d(ln G)/d(n_i) = (w_i / Σw) · (1 / n_i)
```

so the axis worth the most attention is simply the largest `w_i / n_i`. No tutorial script, no
hand-authored quest chain, and nothing that drifts from the balance the next time it is retuned — the
guidance reads the same weights the progress bar does.

**Naming the lowest axis is not yet advice, though.** For most of the early game the lowest axis is
*biomass*, and "raise biomass" is useless on a frozen airless rock. So the bottleneck is resolved
through its prerequisites to the first thing the player can act on today, and the chain is shown:

> **Temperature** — 213 K, and not warming. Liquid water needs 273 K.
> → Order orbital mirrors - the main early warming lever.
> *Breathable oxygen is what is holding progress back, but it needs temperature first.*

The whole reference playthrough, as the shell narrates it:

| year | advice | state |
|---|---|---|
| 0 | Order orbital mirrors | needs you |
| 2 | Warming is under way; more would speed it up | in progress |
| 272 | The ice is melting; keep the temperature climbing | in progress |
| 274 | **Seed cyanobacteria** | needs you |
| 362 | It grows on its own now | in progress |
| 364 | Import nitrogen first — a buffer to hold pressure when the carbon leaves | needs you |
| 402 | Nitrogen is arriving | in progress |
| 560 | The biosphere is fixing the CO2; scrubbers would speed it up | in progress |
| 1710 | Nothing. The planet is finished | in progress |

Seeding is recommended at year 274 — **ahead of** the reference schedule's year 360, which is the
point: the shell has to lead the player, not report on them. That is asserted.

## 2. Three defects, and what found each

**The shell told the player to strip their own atmosphere, for 1346 sim-years.** The scrubber guard
asked whether total pressure was high enough. At year 364 pressure was 301 mbar — of which 297 was
CO2. The guard cleared, and the advice pointed at carbon scrubbers for more than half the game.

The right criterion is the **buffer**: what would still be standing once the carbon is gone. Found by
dumping the advice timeline and reading it, not by a test — **the test was asserting the same wrong
thing the code was**, which is why it passed. A test that restates the implementation's reasoning
cannot check it. Both now use `P - co2_atm ≥ 100 mbar`, and the fixed test fails on 98 samples when
the old criterion is put back.

**The shell invented homework for the long tail.** With the buffer fixed, the advice still said "run
carbon scrubbers" from year 560 to 1710. But the reference run *wins without ever building one* —
photosynthesis carries CO2 from 291 mbar to 6 across those twelve centuries. Recommending a lever the
winning path never uses, and one this project has already documented as a trap, is worse than saying
nothing. The scrubber is now offered as an accelerator with the state "in progress", and a test
asserts the shell spends 40–95% of the run admitting there is nothing to do. §0 asked for a long tail;
the shell should say so rather than nag through it.

**The inspector deleted the entire HUD.** `Inspector`'s constructor does `root.textContent = ""`, and
`main.ts` mounted the shell into that same element first. Every unit test passed — each mounts its own
component alone — and the page was blank of everything this batch built.

This one is worth dwelling on, because no amount of component testing finds it. It only exists in the
*assembly*. `shell.test.ts` now builds the page exactly as `main.ts` does and asserts both survive;
mounting them into one container again fails three of its six tests. It also caught that this project
cannot check a browser directly, so a happy-dom harness rendering the real components is the
substitute — and it earned its keep on the first run.

## 3. Accessibility is load-bearing here, not a pass at the end

The brief says the game must be "readable without relying on colour alone, since colour *is* the
progress signal here" — and in this project that is literal. §9's entire contract is a palette, the
planet goes rust to blue, the sky butterscotch to pale to blue. A UI that *also* signalled through
colour would leave a colourblind player with no channel at all.

So: every bar carries its number, every state carries a word, every meter carries `role="meter"` with
`aria-valuenow` and a spoken `aria-valuetext`, the selected speed carries `aria-pressed`, and a
warning prints the word "warning".

The central test renders the HUD at three very different worlds and requires the **text alone** to
distinguish them. A stylesheet can neither pass nor fail it. Verified by injection three ways: blanking
the status word, dropping `aria-valuetext`, and — the interesting one — returning a single constant
word for every state. That third one **passed** the first version of the test, because with one
uniform word there is only one state and so no two states can collide. The test now also requires the
words to vary with the world, and catches it.

**One real defect it found:** the feed's year and message were separated by a flex `gap`. It looked
correct and read as `"year 280Mean temperature has passed"` to anything consuming text — which is
exactly the reader the requirement is for. Separators are real text nodes now.

## 4. What the shell shows

- **Phase** — §7's number, name and caption, from `PHASE_INFO`.
- **Transition banner** — every headline beat, including §7's Phase 2 "it's happening" moment.
- **Composite progress** — §8.1's bar, with a line explaining that it is a geometric mean and why a
  single zero holds it down.
- **What next** — §1 above, with an inline button that orders the lever and scrolls to it.
- **Six target bands** — §2.3's table. Six, not the brief's five: **CO2 has a toxicity ceiling and is
  the one row that runs backwards**, which is exactly the thing a player otherwise misreads as going
  the wrong way. Its bar is inverted and 0.8 mbar reads "at target".
- **Log** — derived milestones, latched so a wobbling quantity cannot spam it, and asserted to
  announce every phase without skipping (the same bug Batch 1 found in the harness's phase recording).

The debug inspector is unchanged and now sits below the shell, keeping the reservoir tables,
sparklines, §9 channels, the planet and the arc scrubber.

## 5. Open

- **Progress reads 87% at victory.** Phase 6 is reached at year 1710 with every §2.3 band satisfied,
  but the composite is still climbing because pressure is 701 mbar against a 1013 target. The bar and
  the victory condition disagree about what "done" means. That is a §8.1-vs-§2.3 question, not a shell
  one, and it belongs with the balance items.
- **The levers panel still lives in the instrument section**, reached from the advice button rather
  than presented as the primary control surface. It works and the loop closes, but a player-facing
  build panel is a better home for it.
- `happy-dom` is a new devDependency. Nothing ships with it; `npm audit --omit=dev` is clean.
- Batches 3–7 have had no adversarial review.
