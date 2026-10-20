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
   - **`auto`** (the argument starts with `auto`): an unattended run, started by
     `scripts/run-batches.sh`. Nobody is watching and nobody will answer, for hours. The batches
     are already specified in `GAME_PLAN.md`; your job is to implement them. Read
     `docs/PROGRESS.md` first; it, not this conversation, is where the run stands. The second word
     of the argument is the **mode** (`build`, `fix`, `recover` or `close-out`; none means
     `build`); the rest says which batch, which session, and why the last one ended.
     - **A previous session may have been cut off** (turn limit, usage limit, a time limit, a
       closed window, a crash). The working tree is its work. **Never** `git reset`,
       `git checkout -- <file>`, `git clean`, `git stash` or `git restore` it away. Read
       `git status`, `git diff --stat`, `git log --oneline -10`, the batch's entry, its note if one
       exists, and `docs/auto/` (below), work out what is built and what is left, and carry on.
     - **`docs/auto/`** holds the runner's record: `errors-batchNN.md` (every session on the batch
       that ended without finishing it: how long it ran, its last output, whether typecheck passed)
       and, once a recovery session has run, `recovery-batchNN.md` (what is left, as small steps).
       If `recovery-batchNN.md` exists, follow its steps in order and tick each one off as you
       commit it.
     - **Commit as you go**, not only at the end: each piece that typechecks and passes its own
       tests gets a `Batch NN: <piece>` commit and a push. A session cut off then loses minutes,
       not hours.
     - **`auto build`**: target `in_progress_batch` if it is not `none`. If it is `none`, target
       `last_completed_batch + 1`, and before writing code set `in_progress_batch` to it, add the
       batch's entry under `## Batches`, and commit `Batch NN: started`. Phases 1 and 2 run back
       to back: write the Phase 1 presentation (step 6) as text, then go straight on to Phase 2.
       Do not stop at step 7.
     - **`auto fix`** (after a review rejected the batch): the argument names the review round R.
       Fix every problem listed under `review R: rejected` in the batch's entry, re-run the checks
       each problem names and the four verification commands, update the player documentation if
       a fix changes what the player sees, add `fix R: done` to the entry, commit
       `Batch NN: review R fixes`, push, and end the run.
     - **`auto recover`**: sessions on this batch keep ending without finishing it. Do not carry on
       the feature work in this session. Read `docs/auto/errors-batchNN.md` and `git log`, and find
       out why: work too big for one session, a red typecheck or build every session spends itself
       on, a test that hangs or runs out of memory, scratch files breaking the build, a design dead
       end. Fix the cause if this session can (get typecheck green, make a hanging test finish,
       delete scratch). Then write `docs/auto/recovery-batchNN.md`: what is built, what is left as
       small numbered steps that one session can each finish and commit, and what to avoid. Commit
       `Batch NN: recovery plan`, push, and end the run.
     - **`auto close-out`**: the batch has failed many sessions. Do not start new work. Finish
       what is half done only if it is minutes away; otherwise put it behind its tuning constant
       at 0 or take it out. Get typecheck and both builds green, write or complete the note (what
       was built, what was not, why), write the player documentation for what was built, mark the
       batch "COMPLETE (partial)" in `GAME_PLAN.md` with the unbuilt deliverables listed, and
       finish as below.
     - **Never ask a question and never stop for a human.** Every decision you would have put to
       the user, take your own recommendation, the one a bare "Go" would accept, and record it
       under the entry's `decisions:` with its reason in one line. When something blocks you:
       - the spec contradicts the code or an earlier result: follow the cross-batch invariants
         first, then the code's recorded behaviour, then the spec; record the choice;
       - the batch wants something only the user could supply (an account, a paid service,
         licensed assets): build the nearest thing that needs none (procedural sound, generated
         art, a local stand-in) and record the gap under the note's "Open";
       - never delete or overwrite player data or saves; take the path that keeps them;
       - a deliverable that cannot be made to work: put it behind its tuning constant at 0, keep
         the rest, and record it under the note's "Open" for Batch 40.
     - **Memory is short on this machine.** Run the full suite once, at the end, with
       `npx vitest run --maxWorkers=2`; during the work run only the test files you touch. Never
       start a watcher (`vitest` without `run`, `vite`, `--watch`): nothing would end it.
     - **Scratch scripts** go in the system temp directory, not in `src/`. Any `src/harness/_*.ts`
       left by an earlier session is scratch: delete it before committing.
     - **Never mark a batch COMPLETE** while typecheck, `build:web` or `build` is red. A suite
       failure that is new must be fixed; if after a real attempt it cannot be, record it with its
       cause under `## Known red` and in the note, assigned to Batch 40, and go on.
     - **A push that fails** (no network) does not stop you: commit locally and carry on.
     - **Finishing in auto mode** (after the usual Finishing steps below, the player
       documentation included): in `docs/PROGRESS.md` set `last_completed_batch` to NN and
       `in_progress_batch` to `none`, and complete the entry with `status: complete` (or
       `complete (partial)`), `note:`, `manual:` (the manual pages you changed), the real
       verification numbers, and a `review request:` line listing the files the batch changed.
       Commit, push the current branch (`git push -u origin HEAD`), and end the run.

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
- **Write the player documentation, in this same session.** `docs/manual/` is the game's manual,
  for players, not developers - what professional games ship as a manual and update notes:
  - Add an entry at the top of `docs/manual/update-notes.md`, in the style of a game's patch
    notes: a version heading (`Update NN - <the batch's name in player words>`), two lines on
    what the update means for the player, then **New**, **Changed**, **Fixed** and
    **Known issues** as short plain-English bullets about what a player sees and does.
  - Update every manual page the batch changes (how to play, controls, buildings, cities, ...) so
    the manual describes the game as it now is, and add a page when the batch adds a whole new part
    of the game. Keep the contents list in `docs/manual/README.md` current, and the
    "Known issues in the current game" list at the bottom of `update-notes.md`: add what the batch
    leaves broken, remove what it fixed.
  - Write for someone who has never seen the code: no file names, function names, tuning constants,
    test names or "sim-years"; real times at 1x ("about 2 minutes"), the names on the screen, the
    keys and buttons. Describe only what the browser game does: a feature behind a switch the
    browser leaves off is not in the manual.
  - Check every statement against the code or a test, never against the plan.
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
