---
description: Load the next batch from BUILD_PLAN.md and present it for approval. Say "Go" to implement it.
argument-hint: "[batch number, or blank for the next incomplete one]"
---

# Load the next batch

You are working on the terraforming game in this repository. `BUILD_PLAN.md` is the source of truth
for what gets built and in what order.

**This command has two phases. Do not merge them.**

---

## Phase 1 — now: load and present. Write no code.

Batch requested: `$ARGUMENTS` (empty means "the next incomplete one").

1. **Read `BUILD_PLAN.md`.** Find the status table near the top and pick the target batch:
   - If `$ARGUMENTS` names a number, use that batch.
   - Otherwise take the first row not marked **COMPLETE**.
   - **If every batch is COMPLETE**, do not invent scope. Read the **final section of every**
     `docs/balance/batch*.md` — the heading varies ("Open", "For the next batch", "Where the project
     stands"), so go by position, not by title. Those sections are the recorded backlog. Present them
     as candidates with the evidence already written against each, recommend one, and ask which to
     take. Stop there.

2. **Read the batch's own section** in `BUILD_PLAN.md` — goal, bullets, and exit gate — plus the
   **Cross-batch invariants** section, which every batch is held to.

3. **Read what the batch is built against.** The bullets cite design doc sections (`§7`, `§12.3`, …).
   Read those in `docs/design/macro-world.md`, and `docs/design/economy.md` if the batch touches the
   economy, tech tree or the city bridge. Quote the spec rather than paraphrasing it from memory.

4. **Read the recorded open items** — the "Open" section of each `docs/balance/batch*.md`. Some will
   be this batch's problem; say which.

5. **Look at the code the batch will touch** enough to know what exists already. Do not start
   changing it.

6. **Present, concisely:**
   - What the batch is, and its **exit gate**, verbatim
   - The deliverables as a checklist
   - Which **cross-batch invariants** are at risk, and how
   - Which **existing gates** this work could break — the golden frames, the Batch 3 balance score,
     the determinism gate, the continuity bound — and whether the feature should therefore ship
     behind a tuning constant defaulting to off (see below)
   - Any recorded open item this batch should close or will collide with
   - Anything in the batch's own spec you think is wrong, with the reason

7. **Stop.** Ask for "Go". Do not write code, do not create files, do not start "just the first
   part".

---

## Phase 2 — on "Go": implement it

Build the batch. The following are this project's hard-won working rules; they are not style
preferences and each one exists because ignoring it cost a defect.

### Testing

- **Verify every new test by injection.** Break the thing the test protects, watch the test fail with
  a sensible message, restore. A test that has never failed has never been tested. This is the single
  technique that found every defect in the Batch 10 review — *including two of that review's own
  tests being worthless*.
- **Never write a threshold from a plan.** Measure first, then set it with the measurement in the
  comment. Batch 6's exit gate was specified at 2% and three real regressions passed at that number;
  the measured value was 0.2%.
- **A test must not restate the implementation's reasoning.** If the code decides X by checking Y,
  the test must not also check Y — it will pass while both are wrong together. That happened in
  Batch 7 and let the shell advise 1,346 sim-years of self-harm.
- **Do not grep source as a substitute for behaviour.** Source-text tests pass when an unrelated
  occurrence of the word survives, or when only the import is left. Poison a real run instead.
- **Guard against vacuity explicitly.** If a test asserts "X never happens", add a second test
  asserting X was reachable at all.
- Test *enforcement*, not just *completeness*. A registry can be complete while the gate that reads
  it is never consulted.

### Architecture

- Anything that must happen for the game to be correct goes in **`advance`**, not `tick`. Both
  production drivers and `catchUp` call `advance` directly; `tick` is on no production path. Logic
  left in `tick` has rotted there three times.
- Anything per-substep must stay **chunk-independent**: `advance(s, 4000)` must equal a thousand
  `advance(s, 4)` calls exactly. Latching or accruing once per *call* breaks this.
- **A feature that perturbs the balance ships behind a tuning constant defaulting to 0**, and the
  browser opts in. Events and the economy both do. This keeps the golden frames, the Batch 3 score
  and the exactness tests pointed at the world they were calibrated against.
- All tunable constants live in `src/sim/tuning.ts` **and** must be added to the §10 table in
  `docs/design/macro-world.md` — a test enforces it.
- Respect the walls: `src/render/` sees only `VisualChannels`; a city layer sees only
  `HabitatChannels`; `src/sim/` imports nothing from `src/web/` or `src/render/`.

### Finishing

- Write `docs/balance/batchN-<name>.md` recording **what went wrong and what it cost**, not only what
  was built. Include the measurements. The failures are the valuable part.
- Update `BUILD_PLAN.md` (mark COMPLETE, link the note, record what changed from the plan and why)
  and `README.md`.
- **Verify everything:** `npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run build`.
  Report real numbers.
- If a pre-existing gate now fails, that is a finding — investigate it, do not weaken the gate to
  make it pass.

### Reporting

- Lead with what went wrong and what it cost. Skip the throat-clearing.
- **State the dev server port and URL in the recap**, every time.
- **Never open a browser.** The user opens it manually. Verify web work over HTTP — fetch the page,
  check the module graph resolves, run `build:web` — or with a happy-dom harness rendering the real
  components, which is what caught the inspector wiping the entire HUD.
