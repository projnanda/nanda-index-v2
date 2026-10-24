#!/usr/bin/env bash
# Load-test driver. See README.md.
#
#   ./run.sh up                         build and start the stack
#   ./run.sh seed [orgs] [users]        (re)seed; default 100 orgs, 200 users
#   ./run.sh test <scenario> [-e K=V]   run k6/<scenario>.js, collect results
#   ./run.sh down                       stop the stack and delete its volume
#
# Each test writes results/<time>-<scenario>-<orgs>orgs/: summary.md (read
# this first), report.html (k6 dashboard), stats.csv (container CPU/memory),
# top-queries.txt (Postgres), stub-calls.txt, k6.csv.gz (every sample),
# summary.json. Exits with k6's status, except 99 (thresholds crossed), which
# a stress test is expected to hit.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RESULTS="$HERE/results"
# -p pins the project even if COMPOSE_PROJECT_NAME is set in the shell, so
# `down -v` can never reach the dev stack (project nanda-index-v2).
COMPOSE=(docker compose -p nanda-loadtest -f "$HERE/docker-compose.yml")
PSQL=("${COMPOSE[@]}" exec -T db psql -U nanda -d nanda_index -q)
API_PORT="${LT_API_PORT:-3101}"
K6_THRESHOLDS_CROSSED=99
IDLE_CPU_PCT=15
WATCHED=(nanda-loadtest-server-1 nanda-loadtest-db-1)

die() { printf 'run.sh: %s\n' "$*" >&2; exit 1; }

wait_for_api() {
  for _ in $(seq 1 60); do
    curl -fs "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "API did not become healthy on :$API_PORT (see: docker compose -p nanda-loadtest logs server)"
}

# An overloaded run leaves work queued in the server and Postgres that keeps
# running after k6 exits (nothing cancels a query whose client gave up).
# Starting the next test before it drains would blame that work on it.
wait_for_idle() {
  local quiet=0 busy
  for _ in $(seq 1 120); do
    busy="$(docker stats --no-stream --format '{{.CPUPerc}}' "${WATCHED[@]}" 2>/dev/null \
      | tr -d '%' | awk -v max="$IDLE_CPU_PCT" '$1 > max { n++ } END { print n + 0 }')"
    if [[ "$busy" -eq 0 ]]; then quiet=$((quiet + 1)); else quiet=0; fi
    [[ "$quiet" -ge 3 ]] && return 0
  done
  printf 'run.sh: warning: stack still busy; this run may include leftover load\n' >&2
}

cmd_up() {
  "${COMPOSE[@]}" up -d --build db server stub-registry
  wait_for_api
  printf 'API up on http://127.0.0.1:%s\n' "$API_PORT"
}

cmd_seed() {
  local orgs="${1:-100}" users="${2:-200}"
  [[ "$orgs" =~ ^[1-9][0-9]*$ && "$users" =~ ^[1-9][0-9]*$ ]] || die "seed takes two positive integers"
  "${PSQL[@]}" -v orgs="$orgs" -v users="$users" -f /seed/seed.sql
}

# Seed sizes come from the database itself, so they can never go stale.
seeded_count() {
  "${PSQL[@]}" -At -c "$1" 2>/dev/null || echo 0
}

# Samples every load-test container's CPU (100% = one core) and memory until
# killed. `docker stats --no-stream` takes ~1-2s itself, which sets the pace.
# No errexit here: one failed `docker ps` must not end sampling for the run.
sample_stats() {
  set +e
  local out="$1"
  printf 'ts,container,cpu_pct,mem_usage\n' > "$out"
  while true; do
    local ts ids
    ts="$(date +%s)"
    ids="$(docker ps -q --filter name=nanda-loadtest)"
    [[ -n "$ids" ]] || { sleep 1; continue; }
    # shellcheck disable=SC2086  # ids is a whitespace-separated list
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' $ids 2>/dev/null \
      | sed "s/^/$ts,/" >> "$out"
  done
}

dump_top_queries() {
  "${PSQL[@]}" -c "
    SELECT calls,
           round(total_exec_time)::bigint        AS total_ms,
           round(mean_exec_time::numeric, 2)     AS mean_ms,
           left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query
    FROM pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY total_exec_time DESC
    LIMIT 10;"
}

# The stub's call counter: proof that agentic search really fanned out.
stub_calls() {
  "${COMPOSE[@]}" exec -T stub-registry wget -qO- http://127.0.0.1:8090/stats
}

cmd_test() {
  local scenario="${1:-}"
  [[ -n "$scenario" ]] || die "usage: ./run.sh test <reads|auth|agentic|spike|soak> [-e K=V ...]"
  shift
  [[ -f "$HERE/k6/$scenario.js" ]] || die "no such scenario: k6/$scenario.js"
  wait_for_api

  local orgs users
  orgs="$(seeded_count "SELECT count(*) FROM organizations WHERE org_id LIKE 'lt-%'")"
  users="$(seeded_count "SELECT count(*) FROM users WHERE email LIKE 'lt-user-%@loadtest.example'")"
  [[ "$orgs" -gt 0 && "$users" -gt 0 ]] || die "seed first: ./run.sh seed [orgs] [users]"
  printf 'Waiting for the stack to go idle...\n'
  wait_for_idle

  local name run_dir k6_dir sampler status=0
  name="$(date +%Y%m%d-%H%M%S)-$scenario-${orgs}orgs"
  run_dir="$RESULTS/$name"
  k6_dir="/results/$name"
  mkdir -p "$run_dir"
  chmod a+rwx "$run_dir"  # k6's image writes as uid 12345 (matters on Linux hosts)

  "${PSQL[@]}" -c 'SELECT pg_stat_statements_reset();' >/dev/null
  stub_calls > "$run_dir/stub-calls-before.txt" 2>/dev/null || echo unavailable > "$run_dir/stub-calls-before.txt"
  sample_stats "$run_dir/stats.csv" &
  sampler=$!
  disown "$sampler"  # no "Terminated" job notice when it is killed below
  # shellcheck disable=SC2064  # expand $sampler now: it is local to this function
  trap "kill $sampler 2>/dev/null || true" EXIT

  "${COMPOSE[@]}" --profile tools run --rm --no-deps \
    -e K6_WEB_DASHBOARD_EXPORT="$k6_dir/report.html" \
    k6 run \
      --out "csv=$k6_dir/k6.csv.gz" \
      --summary-export "$k6_dir/summary.json" \
      -e ORG_COUNT="$orgs" -e USER_COUNT="$users" \
      "$@" "/scripts/$scenario.js" 2>&1 | tee "$run_dir/k6-output.txt" || status=$?

  kill "$sampler" 2>/dev/null || true
  # Collected even if a container died mid-run: that run is the one to read.
  dump_top_queries > "$run_dir/top-queries.txt" 2>&1 || echo "unavailable (db down?)" > "$run_dir/top-queries.txt"
  stub_calls > "$run_dir/stub-calls.txt" 2>/dev/null || echo unavailable > "$run_dir/stub-calls.txt"
  python3 "$HERE/summarize.py" "$run_dir" > "$run_dir/summary.md" || true
  cat "$run_dir/summary.md"
  printf '\nResults: %s (k6 exit %s)\n' "$run_dir" "$status"
  [[ "$status" -eq 0 || "$status" -eq "$K6_THRESHOLDS_CROSSED" ]] || exit "$status"
}

cmd_down() {
  "${COMPOSE[@]}" --profile tools down -v
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    up)   cmd_up "$@" ;;
    seed) cmd_seed "$@" ;;
    test) cmd_test "$@" ;;
    down) cmd_down "$@" ;;
    *)    die "usage: ./run.sh <up|seed|test|down> (see README.md)" ;;
  esac
}

main "$@"
