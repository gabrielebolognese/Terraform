# Progress

Where the build stands, for `scripts/run-batches.sh` and each unattended session. The fields at the
top are read by the script; keep them one per line, `name: value`. The status table in
`GAME_PLAN.md` stays the source of truth for what each batch is; this file is the run's state.

last_completed_batch: 28
in_progress_batch: 29
final_batch: 40
skipped_batches: none
needs_human: none

## Known red

Failures already recorded in a balance note. They do not block a batch; a new failure does.

- `src/web/city-open.test.ts`, the metropolis timing test: 440-505 ms against its 400 ms limit on
  this machine, failing on the commit before Batch 28 as well. Batch 26's finding, assigned to
  Batch 40 ([note](balance/batch28-build-times.md)).
- The full `npx vitest run` can be killed for low memory on this machine. If it is, run it again
  with fewer workers (`npx vitest run --maxWorkers=2`) rather than skipping it.

## Batches

### Batch 26 - Procedural structures (finish)
- status: complete
- note: docs/balance/batch26-structures.md
- review: accepted (by the user, before the unattended runner)

### Batch 27 - The front door: title screen and worlds
- status: complete
- note: docs/balance/batch27-worlds.md
- review: accepted (by the user, before the unattended runner)

### Batch 28 - Time that means something: real build and upgrade times
- status: complete
- note: docs/balance/batch28-build-times.md
- commits: 964c218, 3b0d532, f716cf8
- review: accepted (by the user, before the unattended runner)

### Batch 29 - Vehicles that use the city: rovers on the ground, trains on the line
- status: in progress
