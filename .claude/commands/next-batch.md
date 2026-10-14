---
description: Load the next batch from GAME_PLAN.md and present it for approval. Say "Go" to implement it.
argument-hint: "[batch number, or blank for the next incomplete one]"
---

# Load the next batch

You are working on the terraforming game in this repository.

- **`GAME_PLAN.md` is the source of truth for what gets built and in what order**, from Batch 26 on:
  the batches that turn the simulation into a game.
- **`BUILD_PLAN.md`** is the record of Batches 1 to 25, and holds the **Cross-batch invariants**
  that every batch is still held to. Some `GAME_PLAN.md` batches (26, 37, 38) take their spec from a
  `BUILD_PLAN.md` section; read it when they say so.

**This command has two phases. Do not merge them.**

---

## Phase 1 — now: load and present. Write no code.

Batch requested: `$ARGUMENTS` (empty means "the next incomplete one").

1. **Read `GAME_PLAN.md`.** Find the status table near the top and pick the target batch:
   - If `$ARGUMENTS` names a number, use that batch: `GAME_PLAN.md` for 26 and up, `BUILD_PLAN.md`
     for 1 to 25.
   - Otherwise take the first row not marked **COMPLETE**. A row marked **IN PROGRESS** comes first:
     check `git status` and say what is already built and what is left.
   - **If every batch is COMPLETE**, do not invent scope. Read `GAME_PLAN.md`'s "Recorded for later"
     section and the **final section of every** `docs/balance/batch*.md` — the heading varies
     ("Open", "For the next batch", "Where the project stands"), so go by position, not by title.
     Those are the recorded backlog. Present them as candidates with the evidence already written
     against each, recommend one, and ask which to take. Stop there.
   - **`auto`**: an unattended run, started by `scripts/run-batches.sh`. Nobody is watching and
     nobody will answer. Read `docs/PROGRESS.md` first; it, not this conversation, is where the run
     stands.
     - **Fix run.** If the entry of `last_completed_batch` has `review: rejected` and no
       `fix-attempt: done` line, target that batch again. Fix every problem the review lists, re-run
       the checks each problem names and the four verification commands, add `fix-attempt: done` to
       the entry, commit `Batch NN: review fixes`, push, and end the run.
     - **Otherwise** target `in_progress_batch` if it is not `none`, check `git status` and the
       entry's notes for what is already built, and carry on from there. If it is `none`, target
       `last_completed_batch + 1`. Before writing code, set `in_progress_batch` to it, add the
       batch's entry under `## Batches`, and commit `Batch NN: started`.
     - **Phases 1 and 2 run back to back.** Write the Phase 1 presentation (step 6) as text, then
       go straight on to Phase 2. Do not stop at step 7.
     - **Never ask a question.** Every decision you would have put to the user, take your own
       recommendation, the one a bare "Go" would accept. Record each one under the entry's
       `decisions:`, with its reason in one line.
     - **Stop without building only for one of these.** Write
       `needs_human: <batch NN: one-line reason>` as the top-level field in `docs/PROGRESS.md`,
       commit, push, and end the run:
       - the batch's spec contradicts the code or an earlier batch's recorded result, and neither
         the spec nor a design doc says which wins;
       - the batch needs something only the user can supply: an account, a paid service, assets
         whose licence you cannot check, or a decision to delete or overwrite player data;
       - a verification command is still red after two fix attempts, and the failure is new, not
         one listed under `## Known red` in `docs/PROGRESS.md`.
     - **Never mark a batch COMPLETE** while typecheck, `build:web` or `build` is red, or while the
       suite has a failure not listed under `## Known red`.
     - **Finishing in auto mode** (after the usual Finishing steps below): in `docs/PROGRESS.md`
       set `last_completed_batch` to NN and `in_progress_batch` to `none`, and complete the entry
       with `status: complete`, `note:`, the real verification numbers, and a `review request:`
       line listing the files the batch changed. Commit, push the current branch
       (`git push -u origin HEAD`), and end the run. A new known-red failure you recorded in the
       balance note goes under `## Known red` too.

2. **Read the batch's own section** in `GAME_PLAN.md` — goal, deliverables, exit gate and its
   **Decisions for Phase 1** — plus `GAME_PLAN.md`'s "How every batch here is held" and
   `BUILD_PLAN.md`'s **Cross-batch invariants**.

3. **Read what the batch is built against.** Where it cites design doc sections (`§7`, `§4.5`, …),
   read them in `docs/design/macro-world.md`, `docs/design/micro-world.md`,
   `docs/design/micro-detail.md`, or `docs/design/economy.md` if it touches the economy, the tech
   tree or the city bridge. Quote the spec rather than paraphrasing it from memory.

4. **Read the recorded open items** — the "Open" section of each `docs/balance/batch*.md`. Some will
   be this batch's problem; say which.

5. **Look at the code the batch will touch** enough to know what exists already. Do not start
   changing it. `GAME_PLAN.md`'s facts were measured on the date it gives; check the ones the batch
   leans on still hold, and say so if one has moved.

6. **Present, concisely:**
   - What the batch is, and its **exit gate**, verbatim
   - The deliverables as a checklist
   - The batch's **Decisions for Phase 1**, each with a recommendation and the reason
   - Which **cross-batch invariants** are at risk, and how
   - Which **existing gates** this work could break — the golden frames, the Batch 3 balance score,
     the determinism gate, the continuity bound, the pacing targets of earlier batches — and whether
     the feature should therefore ship behind a tuning constant defaulting to off (see below)
   - Any recorded open item this batch should close or will collide with
   - Anything in the batch's own spec you think is wrong, with the reason

7. **Stop.** Ask for "Go". Do not write code, do not create files, do not start "just the first
   part". A bare "Go" accepts the recommendations you gave on the decisions. (In `auto` mode, do
   not stop: carry straight on into Phase 2.)

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
  the measured value was 0.2%. `GAME_PLAN.md`'s pacing numbers are proposals until measured.
- **A test must not restate the implementation's reasoning.** If the code decides X by checking Y,
  the test must not also check Y — it will pass while both are wrong together. That happened in
  Batch 7 and let the shell advise 1,346 sim-years of self-harm.
- **Do not grep source as a substitute for behaviour.** Source-text tests pass when an unrelated
  occurrence of the word survives, or when only the import is left. Poison a real run instead.
- **Guard against vacuity explicitly.** If a test asserts "X never happens", add a second test
  asserting X was reachable at all.
- Test *enforcement*, not just *completeness*. A registry can be complete while the gate that reads
  it is never consulted.
- **Inject one fault at a time, and check the tree is clean afterwards.** An injection run that is
  cut off can leave a fault in the source; `git diff` before carrying on.

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
- **Menus, sound, alerts and settings read the state; they never write it.** A world's mode and
  pace are tuning, recorded in the world.
- **Old saves keep working.** Every save change carries a migration and a test that loads the
  previous schema.

### Finishing

- Write `docs/balance/batchN-<name>.md` recording **what went wrong and what it cost**, not only what
  was built. Include the measurements. The failures are the valuable part.
- Update **`GAME_PLAN.md`** (mark the row COMPLETE, link the note, record under the batch what
  changed from the plan and why) and `README.md`. For Batch 26, mark `BUILD_PLAN.md`'s row too.
- **Verify everything:** `npm run typecheck`, `npx vitest run`, `npm run build:web`, `npm run build`.
  Report real numbers.
- If a pre-existing gate now fails, that is a finding — investigate it, do not weaken the gate to
  make it pass.

### Reporting

- Lead with what went wrong and what it cost. Skip the throat-clearing.
- **State the dev server port and URL in the recap**, every time.
- **Never open a browser.** The user opens it manually. Verify web work over HTTP — fetch the page,
  check the module graph resolves, run `build:web` — or with a happy-dom harness rendering the real
  components, which is what caught the inspector wiping the entire HUD. Look at rendered frames
  yourself by writing them to PNG and reading the image.
