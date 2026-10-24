# Unattended build: all batches in sequence

Goal: start once, walk away, come back to a finished (or cleanly stopped) build.

How it works: a shell script runs one batch per fresh Claude Code session. Each session reads `docs/PROGRESS.md` to know where it is, builds the next batch, commits, and exits. A second, separate session reviews the batch against its acceptance list. If the review passes, the script starts the next batch immediately. The loop stops only when all batches are done, when a batch is rejected twice, or when a session writes `needs_human` into `PROGRESS.md`.

Why fresh sessions: 50 batches cannot share one context window. State lives in `docs/PROGRESS.md` and git, not in the conversation.

This document is applied by Claude Code once, after `docs/NEXT_BATCH_SETUP.md`. Prompt: "Read `docs/AUTO_BATCH_SETUP.md` and do everything in it. Do not start any batch."

---

## 1. Add `auto` mode to `.claude/commands/next-batch.md`

Insert this bullet in **Step 1** (argument interpretation):

```
- `auto`: unattended run, used by scripts/run-batches.sh. First check the entry of `last_completed_batch` in PROGRESS.md: if it contains `review: rejected` and no `fix-attempt: done` line, target that batch again and fix every problem listed in the review (re-run its acceptance checks, add `fix-attempt: done` to the entry, commit `batch-NN: fixes`, end the run). Otherwise target `last + 1` (or resume `in_progress_batch`). In auto mode:
  - Write the plan (Step 3) as text but do not stop; continue straight into Step 4.
  - Never ask a question. Any choice you would have asked about: decide it using the functional defaults in docs/EDITOR_SPEC.md and the Batch rules, log the decision under the batch entry's `deviations` (or `notes`), continue.
  - Stop without building, writing `needs_human: <one-line reason>` as the top-level field in docs/PROGRESS.md, only when: DESIGN_SYSTEMS.md is missing; the batch's Spec refs contradict the current code in a way the spec does not resolve; `npm run check` is still red after two fix attempts; the previous batch has a `pending manual checks` item marked `blocking`.
  - Never mark a batch done with a red `npm run check`.
```

Insert this point in **Step 4** after point 7 (commit):

```
7b. Append a `review request:` line to the batch entry in PROGRESS.md listing the changed files (`git diff --name-only HEAD~1 | tr '\n' ' '`), then commit again with `batch-NN: progress`.
```

Add this top-level field to `docs/PROGRESS.md`, under `skipped_batches`:

```
needs_human: none
```

## 2. Create `.claude/commands/review-batch.md`

```markdown
---
description: Independent review of the last completed batch against its acceptance list. Used by scripts/run-batches.sh.
---

You are reviewing code you did not write. Read `docs/PROGRESS.md`; let NN = `last_completed_batch`. Extract Batch NN from `docs/BATCHES.md` with a grep/sed line range (never the whole file) and read its `Spec refs` sections from `docs/EDITOR_SPEC.md` plus `## 0` and `## 4`. Read `DESIGN_SYSTEMS.md`.

Inspect the files named in the batch entry's `review request:` line (`git diff HEAD~2 -- <files>` or `git show` on the batch commit). Run `npm run check`.

Verify, in order:
1. Every `Acceptance` item is covered by a test, verified by a command you ran, or listed under `pending manual checks` with exact reproduction steps.
2. Nothing from `Do not build yet` was built.
3. No color, font or size literal outside the tokens file.
4. The new code respects EDITOR_SPEC §3 and §4: React only for chrome, one command per gesture, integer time, media work in workers, canvases drawn through the scheduler.
5. Every TODO has a `(batch NN)` tag.

Write the verdict into the batch entry in `docs/PROGRESS.md`: `review: accepted` or `review: rejected` followed by a numbered list of concrete problems with file paths and line numbers. Commit `batch-NN: review`. The very last line of your output must be exactly `REVIEW: ACCEPTED` or `REVIEW: REJECTED`.
```

## 3. Create `scripts/run-batches.sh`

```bash
#!/usr/bin/env bash
# Unattended batch runner. Usage: scripts/run-batches.sh [--until N] [--max-turns T]
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

UNTIL=50; MAX_TURNS=500
while [[ $# -gt 0 ]]; do
  case "$1" in
    --until) UNTIL="$2"; shift 2;;
    --max-turns) MAX_TURNS="$2"; shift 2;;
    *) echo "unknown arg $1"; exit 2;;
  esac
done

LOG=docs/auto-run.log
field() { grep -E "^$1:" docs/PROGRESS.md | head -1 | sed -E "s/^$1:[[:space:]]*//" | tr -d '\r'; }
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
run_claude() { claude -p "$1" --dangerously-skip-permissions --max-turns "$MAX_TURNS" --output-format text 2>&1 | tee -a "$LOG"; }

while true; do
  last="$(field last_completed_batch)"
  needs="$(field needs_human)"
  if [[ -n "$needs" && "$needs" != "none" ]]; then log "STOP: needs_human: $needs"; exit 3; fi
  if (( last >= UNTIL )); then log "DONE: batch $last reached"; exit 0; fi

  next=$((last + 1))
  log "=== build batch $next ==="
  run_claude "/next-batch auto" > /dev/null

  needs="$(field needs_human)"
  if [[ -n "$needs" && "$needs" != "none" ]]; then log "STOP: needs_human: $needs"; exit 3; fi
  if [[ "$(field last_completed_batch)" != "$next" ]]; then
    if grep -q "fix-attempt: done" docs/PROGRESS.md; then :; else
      log "batch $next did not complete; retrying once"
      run_claude "/next-batch auto" > /dev/null
      [[ "$(field last_completed_batch)" == "$next" ]] || { log "STOP: batch $next incomplete after retry"; exit 4; }
    fi
  fi

  log "=== review batch $next ==="
  verdict="$(run_claude "/review-batch" | tail -1)"
  if [[ "$verdict" == *REJECTED* ]]; then
    log "rejected; one fix attempt"
    run_claude "/next-batch auto" > /dev/null
    verdict="$(run_claude "/review-batch" | tail -1)"
    if [[ "$verdict" == *REJECTED* ]]; then log "STOP: batch $next rejected twice"; exit 5; fi
  fi
  log "batch $next accepted"
done
```

Make it executable: `chmod +x scripts/run-batches.sh`. On Windows run it from Git Bash (the shell Claude Code uses) or WSL.

## 4. Verify the setup, then stop

Confirm these exist and commit them: `.claude/commands/next-batch.md` (with the `auto` bullet), `.claude/commands/review-batch.md`, `scripts/run-batches.sh`, `docs/PROGRESS.md` (with `needs_human: none`). Commit message: `batch-00: unattended runner`. Do not run any batch.

---

## Notes for the user

- Everything the runner did is in `docs/auto-run.log`, `docs/PROGRESS.md` (one entry per batch with notes, deviations, review verdicts, pending manual checks) and `git log --oneline` (three commits per batch: build, progress, review).
- Exit codes: 0 done, 3 a session asked for you (`needs_human`), 4 a batch could not complete twice (usually `--max-turns` too low for a heavy batch; raise it and rerun), 5 a batch failed review twice. In every case rerunning the script resumes from where it stopped once you fixed the cause (clear `needs_human` back to `none` after acting on it).
- If a `claude -p` run does not accept a slash command as its prompt, replace the two prompts in `run_claude` calls with `"$(cat .claude/commands/next-batch.md) ARGUMENTS: auto"` and `"$(cat .claude/commands/review-batch.md)"`.
- Run on a branch. `--dangerously-skip-permissions` means no prompts for edits or commands, which is what makes it unattended.
