---
description: Independent review of the last completed batch against its exit gate and the project's rules. Used by scripts/run-batches.sh.
---

# Review the last batch

You are reviewing code you did not write. Nobody is watching; do not ask questions.

1. Read `docs/PROGRESS.md`; let NN = `last_completed_batch`. Read Batch NN's section in
   `GAME_PLAN.md` (goal, deliverables, exit gate, decisions), `GAME_PLAN.md`'s "How every batch here
   is held", `BUILD_PLAN.md`'s **Cross-batch invariants**, and the working rules in
   `.claude/commands/next-batch.md` (Phase 2).
2. Read the batch's entry in `docs/PROGRESS.md` (its `decisions:` and `review request:` lines) and
   its note `docs/balance/batchNN-*.md`. Inspect the batch's commits (`git log --oneline`,
   `git show` on each, or `git diff` from the commit before `Batch NN: started`).
3. Run `npm run typecheck`, `npx vitest run` (if it is killed for low memory, rerun with
   `--maxWorkers=2`), `npm run build:web` and `npm run build`. Never open a browser and do not start
   the dev server.

Verify, in order:

1. Every deliverable is built, and the exit gate is met by a test or by a measurement recorded in
   the note. A target missed is acceptable only if the note says so, with the measurement and the
   reason.
2. No failure outside `## Known red` in `docs/PROGRESS.md`; typecheck and both builds green.
3. The note leads with what went wrong, carries measurements, and has an injection table: every new
   test was broken once by a fault and caught it. Spot-check two injections yourself, one fault at a
   time, and check `git status` is clean afterwards.
4. Thresholds were measured (the measured value sits beside each), no test restates the
   implementation, no source-grep tests, vacuity guards where a test asserts something never
   happens.
5. Simulation rules: logic in `advance` and chunk-independent; balance-perturbing features behind a
   tuning constant at 0 with the browser opting in; every new constant in `tuning.ts` and the §10
   table of `docs/design/macro-world.md`; the walls (`src/sim/` imports nothing from `src/web/` or
   `src/render/`); menus, sound, alerts and settings read the state and never write it; a save
   change has a migration and a test loading the previous schema.
6. `GAME_PLAN.md`'s row is COMPLETE with the note linked and changes from the plan recorded;
   `README.md` has the batch's row.
7. Every decision under `decisions:` is one a bare "Go" would have accepted, and none deletes or
   overwrites player data.

Write the verdict into the batch's entry in `docs/PROGRESS.md`: `review: accepted`, or
`review: rejected` followed by a numbered list of concrete problems with file paths and line
numbers. Commit `Batch NN: review` and push the current branch (`git push -u origin HEAD`). The very
last line of your output must be exactly `REVIEW: ACCEPTED` or `REVIEW: REJECTED`.
