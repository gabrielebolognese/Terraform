#!/usr/bin/env bash
# Unattended batch runner: fresh Claude Code sessions build each batch, a second session reviews it,
# then the next batch starts. State lives in docs/PROGRESS.md and git, never in a conversation.
#
# Usage: scripts/run-batches.sh [--until N] [--max-turns T] [--model M] [--attempts A]
#
# It never stops to ask. A session that ends without finishing is retried with the work it left in
# the tree (up to --attempts, then a close-out session); a usage limit is waited out until it
# resets (or 30 minutes at a time when the reset time cannot be read); an API error is waited out
# 5 minutes. Before every session the tree is snapshotted under refs/auto/ (see `git for-each-ref
# refs/auto`), so no work can be lost. Every 5 minutes it says what it is doing.
# Log: logs/auto-run/runner.log, one file per session beside it.
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' # Git Bash: never turn "/next-batch" into a path
cd "$(git rev-parse --show-toplevel)" || exit 2

UNTIL=""
MAX_TURNS=1000
MODEL=()
ATTEMPTS=5
HEARTBEAT=${RUNNER_HEARTBEAT:-300}
LIMIT_WAIT=${RUNNER_LIMIT_WAIT:-1800}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --until) UNTIL="$2"; shift 2;;
    --max-turns) MAX_TURNS="$2"; shift 2;;
    --model) MODEL=(--model "$2"); shift 2;;
    --attempts) ATTEMPTS="$2"; shift 2;;
    *) echo "unknown arg $1"; exit 2;;
  esac
done

PROGRESS=docs/PROGRESS.md
LOGDIR=logs/auto-run # *.log is gitignored
LOG="$LOGDIR/runner.log"
mkdir -p "$LOGDIR"
# Read only from a session that failed or printed almost nothing: a finished session's summary can
# mention limits and numbers like 500 in its own right.
LIMIT_RE='usage limit|limit reached|hit your limit|out of (extra )?usage|rate_limit_error|resets( at)? [0-9]'
TRANSIENT_RE='API Error|overloaded_error|Internal server error|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed'
MAX_WAITS=30 # waits in a row before a session counts as failed anyway (a misread limit)

now() { date +%s; }
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
field() { grep -E "^$1:" "$PROGRESS" | head -1 | sed -E "s/^$1:[[:space:]]*//" | tr -d '\r'; }
set_field() { sed -i -E "s/^$1:.*/$1: $2/" "$PROGRESS"; }
entry() { sed -n "/^### Batch $1 /,/^### Batch /p" "$PROGRESS"; }
last_done() { local v; v="$(field last_completed_batch)"; [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo 0; }

# The tree's work, kept as a commit object under refs/auto/. Touches neither the tree nor the index.
# New files too (all but the gitignored), through a throwaway index.
snapshot() {
  local idx tree sha
  idx="$(git rev-parse --git-dir)/auto-snapshot-index"; cp "$(git rev-parse --git-path index)" "$idx"
  GIT_INDEX_FILE="$idx" git add -A -- . 2>/dev/null
  tree="$(GIT_INDEX_FILE="$idx" git write-tree)"; rm -f "$idx"
  [[ -z "$tree" || "$tree" == "$(git rev-parse 'HEAD^{tree}')" ]] && return 0
  sha="$(git commit-tree "$tree" -p HEAD -m "auto snapshot: $1")" || return 0
  git update-ref "refs/auto/$1" "$sha" && log "work in the tree saved as refs/auto/$1"
}

# Seconds until the usage limit resets, read from a session's output; 0 when it cannot be read.
reset_wait() {
  local f="$1" epoch t target
  epoch="$(tail -30 "$f" | grep -oE '\|[0-9]{10}' | tail -1 | tr -d '|')"
  if [[ -n "$epoch" ]]; then echo $(( epoch - $(now) + 120 )); return; fi
  t="$(tail -30 "$f" | grep -oiE 'resets( at)? [0-9]{1,2}(:[0-9]{2})? ?(am|pm)?' | tail -1 | sed -E 's/^[Rr]esets( at)? //')"
  if [[ -n "$t" ]] && target="$(date -d "today $t" +%s 2>/dev/null)"; then
    (( target <= $(now) )) && target=$(( target + 86400 ))
    echo $(( target - $(now) + 120 )); return
  fi
  echo 0
}

pause_for() { # seconds, reason
  local until=$(( $(now) + $1 ))
  log "waiting $(( $1 / 60 )) min for $2 (until $(date -d "@$until" '+%H:%M'))"
  while (( $(now) < until )); do
    sleep $(( until - $(now) < HEARTBEAT ? until - $(now) : HEARTBEAT ))
    (( $(now) < until )) && log "still waiting for $2 - $(( (until - $(now)) / 60 )) min left"
  done
}

# After a session that did not do its job: wait out a usage limit or an API error and return 0
# (the attempt does not count), or return 1 (a real failure).
WAITS=0
waited_out() {
  local out="$1" w
  (( SESSION_CODE != 0 )) || (( $(grep -c . "$out") <= 5 )) || return 1
  (( WAITS >= MAX_WAITS )) && { log "waited $MAX_WAITS times in a row; counting it as a failed session"; WAITS=0; return 1; }
  WAITS=$(( WAITS + 1 ))
  if tail -30 "$out" | grep -qiE "$LIMIT_RE"; then
    w="$(reset_wait "$out")"
    if (( w <= 0 || w > 6 * 3600 )); then w=$LIMIT_WAIT; log "usage limit reached; reset time not readable, retrying every $(( LIMIT_WAIT / 60 )) min"; fi
    pause_for "$w" "the usage limit to reset"
    return 0
  fi
  if tail -30 "$out" | grep -qiE "$TRANSIENT_RE"; then pause_for "${RUNNER_API_WAIT:-300}" "the API to recover"; return 0; fi
  return 1
}

SESSION_OUT=""
SESSION_CODE=0
run_session() { # label, prompt, file tag
  local label="$1" prompt="$2" start pid code next
  SESSION_OUT="$LOGDIR/$(date +%Y%m%d-%H%M%S)-$3.log"
  start=$(now); next=$(( start + HEARTBEAT ))
  log "start: $label"
  claude -p "$prompt" "${MODEL[@]}" --dangerously-skip-permissions --max-turns "$MAX_TURNS" --output-format text >"$SESSION_OUT" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 10
    if (( $(now) >= next )); then
      log "still $label - $(( ($(now) - start) / 60 )) min, $(git status --porcelain | wc -l) files changed, last commit: $(git log -1 --format='%s (%ar)')"
      next=$(( next + HEARTBEAT ))
    fi
  done
  wait "$pid"; code=$?
  SESSION_CODE=$code
  (( code == 0 )) && (( $(git log -1 --format=%ct) >= start )) && WAITS=0 # it worked: the waits in a row are over
  log "end: $label after $(( ($(now) - start) / 60 )) min (exit $code); last lines:"
  tail -5 "$SESSION_OUT" | sed 's/^/    | /' | tee -a "$LOG"
}

# A needs_human left by a session does not stop the run: the next session is told to decide it.
needs_note() {
  local needs; needs="$(field needs_human)"
  if [[ -n "$needs" && "$needs" != "none" ]]; then
    log "a session asked for a human ($needs); not stopping - the next session decides it" >&2
    set_field needs_human none
    echo " A session wrote needs_human: \"$needs\". Do not stop for it: decide it yourself as auto mode says, record the decision, and carry on."
  fi
}

build_batch() {
  local n=$1 attempt=1 closeouts=0 why="first session for this batch" prompt label
  while (( $(last_done) < n )); do
    why="$why$(needs_note)"
    if (( attempt <= ATTEMPTS )); then
      label="building batch $n (attempt $attempt/$ATTEMPTS)"
      prompt="/next-batch auto (batch $n, attempt $attempt of $ATTEMPTS: $why)"
    else
      label="closing out batch $n (close-out $(( closeouts + 1 ))/3)"
      prompt="/next-batch auto close-out (batch $n: $ATTEMPTS sessions did not finish it; $why)"
    fi
    snapshot "batch$n-$(date +%Y%m%d-%H%M%S)"
    run_session "$label" "$prompt" "build$n-$attempt"
    (( $(last_done) >= n )) && { log "batch $n built"; return 0; }
    if waited_out "$SESSION_OUT"; then
      why="the last session was stopped by a usage limit or an API error; the work in the tree is its work, continue it"
      continue
    fi
    why="the last session ended without finishing the batch; the work in the tree is its work, continue it"
    if (( attempt > ATTEMPTS )); then
      closeouts=$(( closeouts + 1 ))
      if (( closeouts >= 3 )); then
        log "batch $n: $ATTEMPTS attempts and 3 close-outs did not finish it; committing what is there and moving on"
        snapshot "batch$n-abandoned-$(date +%Y%m%d-%H%M%S)"
        set_field last_completed_batch "$n"
        set_field in_progress_batch none
        printf -- '- status: left unfinished by the runner after %s attempts and 3 close-outs; the next batch must get typecheck and both builds green first\n' "$ATTEMPTS" >>"$PROGRESS"
        git add -A -- . ':!docs/AUTO_BATCH_SETUP.md' && git commit -q -m "Batch $n: unfinished, left by the runner" && git push -q -u origin HEAD
        return 1
      fi
    else
      attempt=$(( attempt + 1 ))
    fi
  done
}

verdict_of() { # session output, batch
  local v
  v="$(grep -oE 'REVIEW: (ACCEPTED|REJECTED)' "$1" | tail -1)"
  [[ -z "$v" ]] && v="$(entry "$2" | grep -oiE 'review: (accepted|rejected)' | tail -1)"
  case "${v,,}" in *accepted) echo accepted;; *rejected) echo rejected;; *) echo "";; esac
}

fix_batch() {
  local n=$1 attempt=1
  while ! entry "$n" | grep -q "fix-attempt: done"; do
    (( attempt > ATTEMPTS )) && { log "batch $n: fixes not finished after $ATTEMPTS sessions; moving on"; return 1; }
    snapshot "batch$n-fix-$(date +%Y%m%d-%H%M%S)"
    run_session "fixing batch $n after review (attempt $attempt/$ATTEMPTS)" "/next-batch auto (fix run for batch $n, attempt $attempt of $ATTEMPTS$(needs_note))" "fix$n-$attempt"
    entry "$n" | grep -q "fix-attempt: done" && return 0
    waited_out "$SESSION_OUT" || attempt=$(( attempt + 1 ))
  done
}

review_batch() {
  local n=$1 failed=0 fixed=0 v
  while true; do
    run_session "reviewing batch $n" "/review-batch" "review$n"
    v="$(verdict_of "$SESSION_OUT" "$n")"
    if [[ -z "$v" ]]; then
      waited_out "$SESSION_OUT" && continue
      failed=$(( failed + 1 ))
      (( failed >= 3 )) && { log "batch $n: review gave no verdict 3 times; moving on unreviewed"; return 0; }
      continue
    fi
    if [[ "$v" == accepted ]]; then log "batch $n accepted"; return 0; fi
    if (( fixed )); then log "batch $n rejected again after its fixes; moving on (the review is in docs/PROGRESS.md for Batch 40)"; return 0; fi
    log "batch $n rejected; fixing"
    fix_batch "$n"
    fixed=1
  done
}

[[ -z "$UNTIL" ]] && UNTIL="$(field final_batch)"
if [[ -f /proc/$$/winpid ]] && command -v powershell.exe >/dev/null; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/keep-awake.ps1 -Watch "$(cat /proc/$$/winpid)" >/dev/null 2>&1 &
fi
log "runner started on $(git rev-parse --abbrev-ref HEAD), batches $(( $(last_done) + 1 )) to $UNTIL; in progress: $(field in_progress_batch)"

while (( $(last_done) < UNTIL )); do
  next=$(( $(last_done) + 1 ))
  build_batch "$next" && review_batch "$next"
done
log "DONE: batch $(last_done) reached"
