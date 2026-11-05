#!/bin/sh
# Wakes a seat once when a pull request's CI (or merge) reaches a final state,
# so the seat can end its turn instead of polling (#5897). It starts one
# detached, finite process per wait and returns at once. That process polls
# GitHub's REST API (never GraphQL) every <interval> seconds plus jitter, stops
# at the first final state, and sends exactly one anonymous, urgent
# `tmt talk <self>` with the outcome. A failed send is logged and never retried.
#
# usage: ci-wake.sh <pr> --identity <self> [--until checks|merged]
#                   [--interval <seconds>] [--cap <seconds>] [--foreground]
# --interval is at least and by default 180 s (plus 0-30 s jitter); --cap is
# at most and by default 7200 s.
#
# Final states, the first one wins:
# - `--until checks` (the default): at least one workflow run exists for the
#   head and every one has completed, so early checks or a matrix that adds jobs
#   late cannot read as done; every check run is completed and no commit status
#   is pending. The outcome is `green (N checks)`, or `failed: <names>` for a
#   check concluded failure, cancelled, timed_out or action_required, or a
#   status failure or error.
# - `--until merged`: the PR merged.
# - Either mode: the PR merged or closed, its head changed, or the cap.
# The log (under ${TMPDIR:-/tmp}/ci-wake, owner-only) is removed after a
# delivered wake and kept when the send fails.
# Exit codes: 0 started (detached) or completed (foreground); 2 usage;
# 3 unsafe detached context, unresolved identity, or failed wake delivery.
# Codex tool calls must use --foreground in a provider-native retained task;
# detached children of a fast-completing exec call may be killed before startup.
# Foreground mode does not return until the wait ends. Other shells keep the
# detached default. Launch, waiter startup, exit and caught signals are logged.
# GH, TMT, CI_WAKE_SLEEP and CI_WAKE_CLOCK override the executables, for isolated tests.
set -eu

GH=${GH:-gh}
TMT=${TMT:-tmt}
SLEEP=${CI_WAKE_SLEEP:-sleep}
CLOCK=${CI_WAKE_CLOCK:-date}
MIN_INTERVAL=180
MAX_CAP=7200

usage() {
  printf '%s\n' 'usage: ci-wake.sh <pr> --identity <self> [--until checks|merged] [--interval <seconds>] [--cap <seconds>] [--foreground]' >&2
  exit 2
}
number() {
  case $1 in '' | *[!0-9]*) usage ;; esac
}

run=
foreground=
if [ "${1:-}" = __run ]; then
  run=1
  shift
fi
[ "$#" -ge 1 ] || usage
pr=$1
shift
number "$pr"
self=
until=checks
interval=$MIN_INTERVAL
cap=$MAX_CAP
while [ "$#" -gt 0 ]; do
  if [ "$1" = --foreground ]; then
    foreground=1
    shift
    continue
  fi
  [ "$#" -ge 2 ] || usage
  case $1 in
    --identity) self=$2 ;;
    --until) until=$2 ;;
    --interval) interval=$2 ;;
    --cap) cap=$2 ;;
    *) usage ;;
  esac
  shift 2
done
[ -n "$self" ] || usage
case $until in checks | merged) ;; *) usage ;; esac
number "$interval"
number "$cap"
if [ "$interval" -lt "$MIN_INTERVAL" ] || [ "$cap" -gt "$MAX_CAP" ] || [ "$cap" -lt 1 ]; then
  printf 'ci-wake: the interval is at least %s s and the cap at most %s s.\n' "$MIN_INTERVAL" "$MAX_CAP" >&2
  exit 2
fi

# The wake is anonymous, so route rules and talk limits that bind an attributed
# sender cannot hold it, and urgent, so Digest cannot batch it.
anonymous() {
  env -i PATH="$PATH" HOME="$HOME" ${TMT_HOME:+TMT_HOME="$TMT_HOME"} \
    ${XDG_CONFIG_HOME:+XDG_CONFIG_HOME="$XDG_CONFIG_HOME"} "$@"
}

if [ -z "$run" ]; then
  if [ -z "$foreground" ] && [ -n "${CODEX_TOOL_CALL_ID:-}" ]; then
    printf '%s\n' 'ci-wake: detached launch is unsafe in Codex tool calls; start with --foreground in a provider-native retained background task.' >&2
    exit 3
  fi
  # Refuse at once, in the seat's own turn, when there is nobody to wake.
  if ! anonymous "$TMT" identity show "$self" --json >/dev/null 2>&1; then
    printf 'ci-wake: identity %s cannot be resolved; nothing started.\n' "$self" >&2
    exit 3
  fi
  umask 077
  logs=${TMPDIR:-/tmp}
  logs=${logs%/}/ci-wake
  mkdir -p "$logs"
  chmod 700 "$logs"
  log=$logs/$pr-$$.log
  launch_mode=detached
  [ -z "$foreground" ] || launch_mode=foreground
  printf '%s launcher pid=%s requested %s mode\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "$launch_mode" >"$log"
  if [ -n "$foreground" ]; then
    printf 'ci-wake: foreground pid %s waiting on #%s (%s); log %s\n' "$$" "$pr" "$until" "$log"
    CI_WAKE_LOG=$log exec /bin/sh "$0" __run "$pr" --identity "$self" \
      --until "$until" --interval "$interval" --cap "$cap" >>"$log" 2>&1
  fi
  # A new session, so the seat's process group ending does not end the wait.
  # macOS has no setsid(1); perl's POSIX module is on both hosts.
  if command -v setsid >/dev/null 2>&1; then
    set -- setsid
  else
    set -- perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die "exec: $!\n"'
  fi
  CI_WAKE_LOG=$log nohup "$@" /bin/sh "$0" __run "$pr" --identity "$self" \
    --until "$until" --interval "$interval" --cap "$cap" </dev/null >>"$log" 2>&1 &
  printf 'ci-wake: pid %s waiting on #%s (%s); log %s\n' "$!" "$pr" "$until" "$log"
  exit 0
fi

log=${CI_WAKE_LOG:-}
note() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

phase=starting
exit_reason=exit
trap 'exit_code=$?; trap - 0; note "waiter exit status=$exit_code phase=$phase reason=$exit_reason"' 0
trap 'exit_reason=signal:HUP; exit 129' HUP
trap 'exit_reason=signal:INT; exit 130' INT
trap 'exit_reason=signal:TERM; exit 143' TERM
note "waiter started pid=$$"

wake() {
  phase=notification
  text="ci-wake #$pr ${head%"${head#????????????}"}: $1"
  note "$text"
  if anonymous "$TMT" talk "$self" "$text" --detach --urgent --kind fyi >/dev/null 2>&1; then
    # Delivered: the log has nothing left to explain.
    exit_reason=delivered
    [ -z "$log" ] || rm -f "$log"
    exit 0
  fi
  note "wake could not be sent to $self; not retried"
  exit 3
}

# One REST read of the PR: state, merged and head SHA.
pull() {
  "$GH" api "repos/{owner}/{repo}/pulls/$pr" \
    --jq '[.state, (.merged | tostring), .head.sha] | join(" ")'
}

phase=initial-read
read -r state merged head <<EOF
$(pull)
EOF
[ -n "${head:-}" ] || {
  note "cannot read #$pr"
  exit 3
}
start_head=$head
started=$("$CLOCK" +%s)
while :; do
  phase=read-state
  read -r state merged now_head <<EOF
$(pull || echo "unknown unknown $head")
EOF
  if [ "$merged" = true ]; then
    wake merged
  fi
  if [ "$state" = closed ]; then
    wake "closed without merging"
  fi
  if [ "$now_head" != "$start_head" ]; then
    wake "head changed to ${now_head%"${now_head#????????????}"}; this wait ended"
  fi
  if [ "$until" = checks ]; then
    # A rerun or a re-triggered workflow adds a newer run under the same name;
    # only the newest (highest ID) run of each name counts.
    runs=$("$GH" api --paginate "repos/{owner}/{repo}/commits/$head/check-runs?per_page=100" \
      --jq '.check_runs[] | [.name, .id, .status, (.conclusion // "")] | @tsv' |
      sort -t "$(printf '\t')" -k1,1 -k2,2nr | awk -F '\t' '$1 != seen { seen = $1; print $3 "\t" $4 "\t" $1 }' || true)
    statuses=$("$GH" api "repos/{owner}/{repo}/commits/$head/status" \
      --jq '.statuses[] | [.state, .context] | @tsv' || true)
    workflows=$("$GH" api --paginate "repos/{owner}/{repo}/actions/runs?head_sha=$head&per_page=100" \
      --jq '.workflow_runs[] | .status' || true)
    total=$(printf '%s\n%s\n' "$runs" "$statuses" | grep -c . || true)
    pending=$(
      {
        printf '%s\n' "$workflows" | awk 'NF && $1 != "completed"'
        printf '%s\n' "$runs" | awk -F '\t' 'NF && $1 != "completed"'
        printf '%s\n' "$statuses" | awk -F '\t' 'NF && $1 == "pending"'
      } | grep -c . || true
    )
    started_runs=$(printf '%s\n' "$workflows" | grep -c . || true)
    if [ "$started_runs" -gt 0 ] && [ "$total" -gt 0 ] && [ "$pending" -eq 0 ]; then
      failed=$(
        {
          printf '%s\n' "$runs" | awk -F '\t' '$2 ~ /^(failure|cancelled|timed_out|action_required)$/ { print $3 }'
          printf '%s\n' "$statuses" | awk -F '\t' '$1 ~ /^(failure|error)$/ { print $2 }'
        } | sort -u | paste -sd ',' - | sed 's/,/, /g'
      )
      if [ -n "$failed" ]; then
        wake "failed: $failed"
      fi
      wake "green ($total checks)"
    fi
    note "pending $pending; $started_runs workflow runs, $total checks"
  else
    note "waiting for merge"
  fi
  elapsed=$(($("$CLOCK" +%s) - started))
  if [ "$elapsed" -ge "$cap" ]; then
    wake "no final state after $((cap / 60)) min; this wait ended"
  fi
  phase=interval
  jitter=$(awk 'BEGIN { srand(); print int(rand() * 31) }')
  "$SLEEP" $((interval + jitter))
done
