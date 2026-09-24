# Batch 16 — The build panel

From the backlog: Batch 7 recorded that "the levers panel still lives in the instrument section… a
player-facing build panel is a better home for it". Batch 15 made that sharper by turning the
instruments into a hidden drawer. From the HUD, a player could only use the one "Order one" button
under the current advice.

The HUD now has a **Build** section listing every lever: what it does, how much is ordered and how
much is actually online, the price of the next unit, and **+1**, **−1** and **Switch off / on**
buttons. Cyanobacteria seeding is there as its one-shot. When the advice points at a lever, the HUD
now scrolls to that lever's row and highlights it, where before it opened the debug drawer.

**UI only.** No simulation, tuning or balance code changed; the golden run, golden frames and
Batch 3 score are untouched. 620 tests pass, up from 610.

---

## The one structural decision

**There is exactly one definition of "order one more".** `main.ts` had built that request inline in
two places: the order itself, and the advice button's dry run. A build panel would have been a third
copy. Batch 10's first finding was the shell offering a button the simulation then refused, which is
exactly what drifting copies produce. `orderDelta` in `src/web/build.ts` is now the only definition,
and the panel's dry run, the real click, and the advice button's dry run all go through it. Each
row's enabled state, price and refusal reason come from the simulation's own `orderFacility`. The
panel doesn't restate the tech gate or the wallet check.

## What went wrong

**The first version of the tests could not catch a wrongly priced dry run.** They ran the panel in
three situations: the browser opening, a rich world, and the economy off. I then injected a dry run
that priced the next unit at the wrong **level**, and all nine tests passed. In none of those
situations did the price difference change the answer: 3,000 credits covers one mirror at either
level, and a rich world covers everything. A fourth scenario now holds exactly the price of one
level-1 mirror and not a credit more. At that margin the wrong-level dry run greys out a mirror that
would really go through, and the test says so ("orbital_mirror was greyed out but would go through").

## Tests (`src/web/build.test.ts`), each broken on purpose

The oracle is the **world**, not the panel. A click goes through `orderDelta`, as in `main.ts`, and
the test checks what happened to the planet's facilities.

| Claim | Injection that fails it |
|---|---|
| Every enabled **+1** grows that lever; every disabled one says why, in words, and really would be refused. Checked in four situations, with a vacuity guard that the mixed ones have both kinds | disabled state inverted; +1 wired to −1; dry run at the wrong level (caught only after the fourth scenario was added); refusal shown with no reason |
| One row per buildable lever, plus seeding | — (completeness) |
| The price appears on the button with the economy on, and not with it off | — |
| You can't dismantle or switch off what isn't ordered; you can once it is | — |
| Switching off is stated in words ("switched off") and in `aria-pressed`, not only in style | status line left unchanged |
| Ordered and online are reported separately while it ramps ("0 of 1 units online") | — |
| The advice brings its lever's row into view | — |

## Open

- **No upgrade (level) control in the panel.** Levels exist in the simulation and in the debug
  instruments; the panel orders at the lever's current level. Levels up to 5 are a real lever, so an
  "upgrade" control is the natural next step.
- Still open from earlier:
  - **The CO₂ progress axis decision** (Batch 12): the only route to the 31.1-minute planet stall.
  - **What Batch 15 left unverified:** no test compares the GPU globe's pixels, the shader's
    rotation and its TypeScript copy are kept in step by hand, and GPU performance hasn't been
    measured.
  - **The dust clamp** (Batch 11), and **golden frames with weather on** (Batch 8).
