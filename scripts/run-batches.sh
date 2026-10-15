#!/usr/bin/env bash
# Unattended batch runner: fresh Claude Code sessions build each batch (and write its player
# documentation), a second session reviews it, then the next batch starts. State lives in
# docs/PROGRESS.md, docs/auto/ and git, never in a conversation.
#
# Usage: scripts/run-batches.sh [--until N] [--max-turns T] [--model M] [--max-errors E]
#                               [--max-reviews R] [--session-hours H]
#
# It stops for a human only when a batch has had more than --max-errors (20) failed sessions, or
# --max-reviews (10) reviews without being accepted. Everything short of that it handles itself:
# - a session that ends without finishing: recorded in docs/auto/errors-batchNN.md (its output,
#   whether typecheck passes) and the next session continues the work left in the tree;
# - every third failure: a recovery session diagnoses the record and writes a step-by-step plan
#   (docs/auto/recovery-batchNN.md) that the following sessions follow; from 12 failures on, the
#   sessions close the batch out with what works;
# - a usage limit: waited out until it resets (30 minutes at a time when the time is unreadable);
#   an API or login error: waited out; neither counts as a failure;
# - a session that runs past --session-hours: stopped, recorded, retried;
# - before every session: a stale git lock removed, the branch put back, memory waited for, and
#   the tree snapshotted under refs/auto/ so no work can be lost;
# - the runner itself crashing: restarted by its supervisor;
# - Windows kept awake while it runs.
# Every 5 minutes it says what it is doing. Log: logs/auto-run/runner.log (one file per session
# beside it); one-line state: logs/auto-run/status.txt.
# Exit codes: 0 all done, 2 bad arguments or already running, 3 stopped for a human.
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' # Git Bash: never turn "/next-batch" into a path
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "Run this from inside the game's folder."; exit 2; }
cd "$ROOT" || exit 2
SCRIPT="$ROOT/scripts/run-batches.sh"
LOGDIR=logs/auto-run # *.log is gitignored
LOG="$LOGDIR/runner.log"
mkdir -p "$LOGDIR" docs/auto
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# --- The supervisor: runs the runner, and starts it again if it ever crashes. ---
if [[ "${RUNNER_CHILD:-}" != 1 ]]; then
  if [[ -f /proc/$$/winpid ]] && command -v powershell.exe >/dev/null; then
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/keep-awake.ps1 -Watch "$(cat /proc/$$/winpid)" >/dev/null 2>&1 &
  fi
  restarts=0
  while true; do
    RUNNER_CHILD=1 RUNNER_RESTARTED="$restarts" bash "$SCRIPT" "$@"; code=$?
    case $code in 0|2|3) exit $code;; esac
    restarts=$(( restarts + 1 ))
    if (( restarts > 50 )); then log "STOP: the runner crashed 50 times; see the log above"; exit 1; fi
    log "the runner crashed (exit $code); starting it again in 60 s (restart $restarts)"
    sleep 60
  done
fi

UNTIL=""
MAX_TURNS=1000
MODEL=()
MAX_ERRORS=20
MAX_REVIEWS=10
SESSION_SECS=${RUNNER_SESSION_SECS:-21600}
HEARTBEAT=${RUNNER_HEARTBEAT:-300}
LIMIT_WAIT=${RUNNER_LIMIT_WAIT:-1800}
API_WAIT=${RUNNER_API_WAIT:-300}
MIN_FREE_MB=${RUNNER_MIN_FREE_MB:-1500}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --until) UNTIL="$2"; shift 2;;
    --max-turns) MAX_TURNS="$2"; shift 2;;
    --model) MODEL=(--model "$2"); shift 2;;
    --max-errors) MAX_ERRORS="$2"; shift 2;;
    --max-reviews) MAX_REVIEWS="$2"; shift 2;;
    --session-hours) SESSION_SECS=$(( $2 * 3600 )); shift 2;;
    *) echo "unknown arg $1"; exit 2;;
  esac
done

PROGRESS=docs/PROGRESS.md
LOCK="$(git rev-parse --git-dir)/auto-runner.pid"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
# Read only from a session that failed or printed almost nothing: a finished session's summary can
# mention limits, logins and numbers like 500 in its own right.
LIMIT_RE='usage limit|limit reached|hit your limit|out of (extra )?usage|rate_limit_error|resets( at)? [0-9]'
TRANSIENT_RE='API Error|overloaded_error|Internal server error|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|Request timed out'
LOGIN_RE='/login|not logged in|Invalid API key|authentication_error|OAuth token|token (has )?expired|Please log in'
MAX_WAITS=30 # waits in a row before a session counts as failed anyway (a misread limit)

if [[ -f "$LOCK" ]] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "The runner is already running (process $(cat "$LOCK")). Watch it with: tail -f $LOG"; exit 2
fi
echo $$ >"$LOCK"
trap 'rm -f "$LOCK"' EXIT

now() { date +%s; }
field() { grep -E "^$1:" "$PROGRESS" | head -1 | sed -E "s/^$1:[[:space:]]*//" | tr -d '\r'; }
set_field() { sed -i -E "s|^$1:.*|$1: $2|" "$PROGRESS"; }
entry() { sed -n "/^### Batch $1 /,/^### Batch /p" "$PROGRESS"; }
last_done() { local v; v="$(field last_completed_batch)"; [[ "$v" =~ ^[0-9]+$ ]] && echo "$v" || echo 0; }
errfile() { echo "docs/auto/errors-batch$1.md"; }
status() { echo "$(date '+%H:%M') $*" >"$LOGDIR/status.txt"; }
# Failed sessions on a batch since the last budget reset (each restart by hand gives a fresh 20).
errs() { local f; f="$(errfile "$1")"; [[ -f "$f" ]] || { echo 0; return; }; awk '/^# budget reset/{n=0} /^## /{n++} END{print n+0}' "$f"; }

# The tree's work, new files too (all but the gitignored), kept as a commit under refs/auto/
# through a throwaway index. Touches neither the tree nor the real index.
snapshot() {
  local idx tree sha
  idx="$(git rev-parse --git-dir)/auto-snapshot-index"; cp "$(git rev-parse --git-path index)" "$idx" 2>/dev/null
  GIT_INDEX_FILE="$idx" git add -A -- . 2>/dev/null
  tree="$(GIT_INDEX_FILE="$idx" git write-tree 2>/dev/null)"; rm -f "$idx"
  [[ -z "$tree" || "$tree" == "$(git rev-parse 'HEAD^{tree}')" ]] && return 0
  sha="$(git commit-tree "$tree" -p HEAD -m "auto snapshot: $1")" || return 0
  git update-ref "refs/auto/$1" "$sha" && log "work in the tree saved as refs/auto/$1"
}

push() { git push -q -u origin HEAD >/dev/null 2>&1 || log "push failed (will try again after the next session)"; }

# Before every session: nothing left over from a killed one may stop the next.
health_check() {
  local lock free waited=0
  lock="$(git rev-parse --git-dir)/index.lock"
  if [[ -f "$lock" ]] && [[ -n "$(find "$lock" -mmin +5 2>/dev/null)" ]]; then rm -f "$lock"; log "removed a stale git lock left by a killed session"; fi
  if [[ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ]]; then
    log "a session left the branch $BRANCH; going back to it"
    git checkout -q "$BRANCH" 2>>"$LOG" || log "could not go back to $BRANCH; carrying on where it is"
  fi
  while true; do
    free=$(( $(awk '/MemFree/{print $2}' /proc/meminfo 2>/dev/null || echo 9999999) / 1024 ))
    (( free >= MIN_FREE_MB || waited >= 1800 )) && break
    (( waited % 300 == 0 )) && log "only $free MB of memory free; waiting for $MIN_FREE_MB MB (at most 30 min) - close other programs if you can"
    sleep 60; waited=$(( waited + 60 ))
  done
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
  status "waiting for $2 until $(date -d "@$until" '+%H:%M')"
  while (( $(now) < until )); do
    sleep $(( until - $(now) < HEARTBEAT ? until - $(now) : HEARTBEAT ))
    (( $(now) < until )) && log "still waiting for $2 - $(( (until - $(now)) / 60 )) min left"
  done
}

# After a session that did not do its job: wait out a usage limit, an API error or a lost login
# and return 0 (it does not count as a failure), or return 1 (a real failure).
WAITS=0
waited_out() {
  local out="$1" w
  (( SESSION_CODE != 0 )) || (( $(grep -c . "$out") <= 5 )) || return 1
  (( WAITS >= MAX_WAITS )) && { log "waited $MAX_WAITS times in a row; counting it as a failed session"; WAITS=0; return 1; }
  if tail -30 "$out" | grep -qiE "$LIMIT_RE"; then
    WAITS=$(( WAITS + 1 ))
    w="$(reset_wait "$out")"
    if (( w <= 0 || w > 6 * 3600 )); then w=$LIMIT_WAIT; log "usage limit reached; reset time not readable, trying again every $(( LIMIT_WAIT / 60 )) min"; fi
    pause_for "$w" "the usage limit to reset"; return 0
  fi
  if tail -30 "$out" | grep -qiE "$LOGIN_RE"; then
    WAITS=$(( WAITS + 1 ))
    log "Claude is not logged in (or the login expired). If you are here, run 'claude' in another window and log in."
    pause_for "$LIMIT_WAIT" "a login"; return 0
  fi
  if tail -30 "$out" | grep -qiE "$TRANSIENT_RE"; then
    WAITS=$(( WAITS + 1 ))
    pause_for "$API_WAIT" "the API to recover"; return 0
  fi
  return 1
}

kill_tree() { # an MSYS pid: its whole Windows process tree (claude and every test it started)
  local w; w="$(cat "/proc/$1/winpid" 2>/dev/null)"
  [[ -n "$w" ]] && taskkill /F /T /PID "$w" >/dev/null 2>&1
  kill "$1" 2>/dev/null
}

SESSION_OUT=""
SESSION_CODE=0
SESSION_MIN=0
run_session() { # label, prompt, file tag
  local label="$1" prompt="$2" start pid next
  health_check
  SESSION_OUT="$LOGDIR/$(date +%Y%m%d-%H%M%S)-$3.log"
  start=$(now); next=$(( start + HEARTBEAT ))
  log "start: $label"
  status "$label, since $(date '+%H:%M')"
  claude -p "$prompt" "${MODEL[@]}" --dangerously-skip-permissions --max-turns "$MAX_TURNS" --output-format text >"$SESSION_OUT" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 10
    if (( $(now) - start >= SESSION_SECS )); then
      log "$label has run $(( SESSION_SECS / 60 )) min (its limit); stopping it (its work stays in the tree)"
      kill_tree "$pid"; echo "RUNNER: session stopped after its time limit of $(( SESSION_SECS / 60 )) min" >>"$SESSION_OUT"
      break
    fi
    if (( $(now) >= next )); then
      log "still $label - $(( ($(now) - start) / 60 )) min, $(git status --porcelain 2>/dev/null | wc -l) files changed, last commit: $(git log -1 --format='%s (%ar)')"
      next=$(( next + HEARTBEAT ))
    fi
  done
  wait "$pid" 2>/dev/null; SESSION_CODE=$?
  SESSION_MIN=$(( ($(now) - start) / 60 ))
  (( SESSION_CODE == 0 )) && WAITS=0
  log "end: $label after $SESSION_MIN min (exit $SESSION_CODE); last lines:"
  tail -5 "$SESSION_OUT" | sed 's/^/    | /' | tee -a "$LOG"
  push
}

# A failed session, written down for the sessions after it: what it was, how it ended, and whether
# the code still typechecks.
record_error() { # batch, label, why
  local f tc out; f="$(errfile "$1")"
  [[ -f "$f" ]] || printf '# Batch %s: sessions that ended without finishing\n\nWritten by scripts/run-batches.sh for the sessions that follow. Each entry is one failed session.\n\n' "$1" >"$f"
  out="$(mktemp 2>/dev/null || echo "$LOGDIR/tc.tmp")"
  if timeout 900 npm run typecheck >"$out" 2>&1; then tc="passes"; else tc="FAILS - first errors:"$'\n'"$(grep -E 'error TS' "$out" | head -15 | sed 's/^/    /')"; fi
  rm -f "$out"
  {
    printf '## %s - %s (exit %s, %s min)\n' "$(date '+%Y-%m-%d %H:%M')" "$2" "$SESSION_CODE" "$SESSION_MIN"
    printf -- '- why it counts as failed: %s\n' "$3"
    printf -- '- typecheck after it: %s\n' "$tc"
    printf -- '- tree: %s files changed; last commit: %s\n' "$(git status --porcelain | wc -l)" "$(git log -1 --format='%h %s (%ar)')"
    printf -- '- session log: %s\n- last output:\n\n' "$SESSION_OUT"
    tail -25 "$SESSION_OUT" | sed 's/^/    /'
    printf '\n'
  } >>"$f"
  log "batch $1: failed session recorded ($(errs "$1") of $MAX_ERRORS) in $f"
}

stop_for_human() { # reason
  set_field needs_human "runner: $1"
  snapshot "stopped-$(date +%Y%m%d-%H%M%S)"
  git add -- "$PROGRESS" docs/auto 2>/dev/null && git commit -q -m "Runner: stopped for a human - $1" -- "$PROGRESS" docs/auto 2>/dev/null
  push
  log "STOP: $1"
  log "Read docs/PROGRESS.md and docs/auto/, then start the runner again: it clears needs_human and gives the batch a fresh budget."
  status "STOPPED: $1"
  exit 3
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
  local n=$1 session=0 e mode why="first session on this batch" prompt label recovered=-1 rec before
  rec="docs/auto/recovery-batch$n.md"
  while (( $(last_done) < n )); do
    e=$(errs "$n")
    (( e >= MAX_ERRORS )) && stop_for_human "batch $n: $e sessions failed to finish it (see $(errfile "$n"))"
    session=$(( session + 1 ))
    if (( e > 0 && e % 3 == 0 && recovered != e )); then mode=recover; recovered=$e
    elif (( e >= 12 )); then mode=close-out
    else mode=build; fi
    why="$why$(needs_note)"
    label="${mode/build/building} batch $n (session $session, $e of $MAX_ERRORS failures so far)"
    label="${label/recover /recovering }"; label="${label/close-out /closing out }"
    prompt="/next-batch auto $mode (batch $n, session $session; $e failed sessions so far, recorded in $(errfile "$n"). $why)"
    before="$( [[ -f "$rec" ]] && git hash-object "$rec")"
    snapshot "batch$n-$(date +%Y%m%d-%H%M%S)"
    run_session "$label" "$prompt" "batch$n-$mode-$session"
    (( $(last_done) >= n )) && { log "batch $n built"; return 0; }
    if [[ "$mode" == recover && -f "$rec" && "$(git hash-object "$rec")" != "$before" ]]; then
      log "batch $n: recovery plan written ($rec)"; why="a recovery session wrote $rec: follow its steps"; continue
    fi
    if waited_out "$SESSION_OUT"; then
      why="the last session was stopped by a usage limit, a login or an API error; the work in the tree is its work, continue it"; continue
    fi
    record_error "$n" "$label" "it ended without finishing the batch (turn limit, time limit, crash, or it stopped early)"
    why="the last session ended without finishing the batch; the work in the tree is its work, continue it"
  done
}

verdict_of() { # session output, batch, round
  local v
  v="$(grep -oE 'REVIEW: (ACCEPTED|REJECTED)' "$1" | tail -1)"
  [[ -z "$v" ]] && v="$(entry "$2" | grep -oiE "review $3: (accepted|rejected)" | tail -1)"
  case "${v,,}" in *accepted) echo accepted;; *rejected) echo rejected;; *) echo "";; esac
}

fix_batch() { # batch, round
  local n=$1 r=$2 session=0
  while ! entry "$n" | grep -q "fix $r: done"; do
    (( $(errs "$n") >= MAX_ERRORS )) && stop_for_human "batch $n: $(errs "$n") failed sessions while fixing review $r"
    session=$(( session + 1 ))
    snapshot "batch$n-fix$r-$(date +%Y%m%d-%H%M%S)"
    run_session "fixing batch $n after review $r (session $session)" "/next-batch auto fix (batch $n, review round $r: fix what 'review $r: rejected' lists in docs/PROGRESS.md$(needs_note))" "batch$n-fix$r-$session"
    entry "$n" | grep -q "fix $r: done" && return 0
    waited_out "$SESSION_OUT" && continue
    record_error "$n" "fixing after review $r" "it ended without writing 'fix $r: done'"
  done
}

review_batch() {
  local n=$1 r v
  r=$(( $(entry "$n" | grep -cE "review [0-9]+: (accepted|rejected)") + 1 ))
  while true; do
    (( r > MAX_REVIEWS )) && stop_for_human "batch $n: $MAX_REVIEWS reviews without being accepted (see its entry in $PROGRESS)"
    (( $(errs "$n") >= MAX_ERRORS )) && stop_for_human "batch $n: $(errs "$n") failed sessions during its review"
    run_session "reviewing batch $n (review $r of at most $MAX_REVIEWS)" "/review-batch round $r (batch $n)" "batch$n-review$r"
    v="$(verdict_of "$SESSION_OUT" "$n" "$r")"
    if [[ -z "$v" ]]; then
      waited_out "$SESSION_OUT" && continue
      record_error "$n" "review $r" "it gave no verdict"
      continue
    fi
    if [[ "$v" == accepted ]]; then log "batch $n accepted (review $r)"; return 0; fi
    log "batch $n rejected by review $r; fixing"
    fix_batch "$n" "$r"
    r=$(( r + 1 ))
  done
}

[[ -z "$UNTIL" ]] && UNTIL="$(field final_batch)"
if [[ "${RUNNER_RESTARTED:-0}" == 0 ]]; then
  # Started by hand: whatever stopped it before has been seen to, so a fresh budget.
  n=$(( $(last_done) + 1 ))
  if [[ -f "$(errfile "$n")" ]] && (( $(errs "$n") > 0 )); then printf '# budget reset %s (the runner was started again)\n\n' "$(date '+%Y-%m-%d %H:%M')" >>"$(errfile "$n")"; fi
  needs="$(field needs_human)"
  [[ -n "$needs" && "$needs" != "none" ]] && { log "clearing needs_human ($needs): the runner was started again"; set_field needs_human none; }
fi
log "runner started on $BRANCH, batches $(( $(last_done) + 1 )) to $UNTIL; in progress: $(field in_progress_batch)"

while (( $(last_done) < UNTIL )); do
  next=$(( $(last_done) + 1 ))
  build_batch "$next"
  review_batch "$next"
  push
done
log "DONE: batch $(last_done) reached"
status "DONE: batch $(last_done) reached"
