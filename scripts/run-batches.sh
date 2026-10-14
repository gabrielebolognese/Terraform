#!/usr/bin/env bash
# Unattended batch runner: one fresh Claude Code session builds a batch, a second one reviews it,
# then the next batch starts. State lives in docs/PROGRESS.md and git, never in a conversation.
#
# Usage: scripts/run-batches.sh [--until N] [--max-turns T] [--model M]
# Exit codes: 0 done, 3 a session asked for the user (needs_human), 4 a batch did not complete
# after a retry, 5 a batch was rejected by review twice. Rerunning resumes where it stopped.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2

UNTIL=""
MAX_TURNS=1000
MODEL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --until) UNTIL="$2"; shift 2;;
    --max-turns) MAX_TURNS="$2"; shift 2;;
    --model) MODEL=(--model "$2"); shift 2;;
    *) echo "unknown arg $1"; exit 2;;
  esac
done

PROGRESS=docs/PROGRESS.md
LOG=docs/auto-run.log # *.log is gitignored
field() { grep -E "^$1:" "$PROGRESS" | head -1 | sed -E "s/^$1:[[:space:]]*//" | tr -d '\r'; }
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
run_claude() {
  claude -p "$1" "${MODEL[@]}" --dangerously-skip-permissions --max-turns "$MAX_TURNS" --output-format text 2>&1 | tee -a "$LOG"
}
stop_if_needed() {
  local needs; needs="$(field needs_human)"
  if [[ -n "$needs" && "$needs" != "none" ]]; then log "STOP: needs_human: $needs"; exit 3; fi
}
# The verdict: the review's last line, or failing that the batch entry's own review line.
verdict_of() {
  local out="$1" batch="$2"
  if grep -q "REVIEW: REJECTED" <<<"$out"; then echo rejected; return; fi
  if grep -q "REVIEW: ACCEPTED" <<<"$out"; then echo accepted; return; fi
  sed -n "/^### Batch $batch /,/^### /p" "$PROGRESS" | grep -Eo "review: (accepted|rejected)" | tail -1 | sed 's/review: //'
}

[[ -z "$UNTIL" ]] && UNTIL="$(field final_batch)"
[[ -n "$(git status --porcelain --untracked-files=no)" ]] && { log "STOP: the working tree has uncommitted changes"; exit 2; }
log "runner started on $(git rev-parse --abbrev-ref HEAD), until batch $UNTIL"

while true; do
  stop_if_needed
  last="$(field last_completed_batch)"
  if (( last >= UNTIL )); then log "DONE: batch $last reached"; exit 0; fi
  next=$((last + 1))

  log "=== build batch $next ==="
  run_claude "/next-batch auto" > /dev/null
  stop_if_needed
  if [[ "$(field last_completed_batch)" != "$next" ]]; then
    log "batch $next did not complete; one more session to finish it"
    run_claude "/next-batch auto" > /dev/null
    stop_if_needed
    [[ "$(field last_completed_batch)" == "$next" ]] || { log "STOP: batch $next incomplete after retry"; exit 4; }
  fi

  log "=== review batch $next ==="
  out="$(run_claude "/review-batch")"
  if [[ "$(verdict_of "$out" "$next")" != "accepted" ]]; then
    log "batch $next rejected; one fix session"
    run_claude "/next-batch auto" > /dev/null
    stop_if_needed
    out="$(run_claude "/review-batch")"
    if [[ "$(verdict_of "$out" "$next")" != "accepted" ]]; then log "STOP: batch $next rejected twice"; exit 5; fi
  fi
  log "batch $next accepted"
done
