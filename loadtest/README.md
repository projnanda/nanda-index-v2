# Load testing

Stress tests for the NANDA Index API, run locally against a stack capped to
roughly the production Droplet's size. Nothing here touches production or
the dev stack in `../docker-compose.yml`.

## Quick start

Needs Docker (Desktop) running. k6 runs in a container; nothing to install.

```bash
cd loadtest
./run.sh up                  # build and start db + API + stub registry
./run.sh seed 100 200        # 100 orgs (about today's index), 200 users
./run.sh test reads          # one scenario; see below for knobs
./run.sh seed 50000 200      # re-seed bigger to see how the index scales
./run.sh down                # stop and delete the load-test volume
```

Each `test` prints a summary and writes `results/<time>-<scenario>-<orgs>orgs/`:

| File | What it is |
|---|---|
| `summary.md` | Read this first: per-10s table and per-endpoint table |
| `report.html` | k6's dashboard, open in a browser for graphs |
| `top-queries.txt` | Postgres queries by total time (`pg_stat_statements`) |
| `stats.csv` | Container CPU and memory, sampled every ~2s |
| `k6.csv.gz`, `summary.json` | Raw k6 output |

## Scenarios

Pass knobs as `-e NAME=value`, e.g. `./run.sh test reads -e MAX_RATE=2000`.

| Scenario | What it does | Knobs (default) |
|---|---|---|
| `reads` | Public read mix (lookup, resolve, search, listing, ARD) on a rising staircase | `MAX_RATE` (500), `STEPS` (10), `STEP_SECONDS` (30) |
| `auth` | Logins on a staircase, plus a steady trickle of cheap reads to show the effect on other users | `LOGIN_MAX_RATE` (40), `STEPS` (8), `STEP_SECONDS` (20), `PROBE_RATE` (20) |
| `agentic` | Agentic + ARD search, each fanning out to the stub registry | `MAX_RATE` (60), `STEPS` (6), `STEP_SECONDS` (30) |
| `spike` | Steady reads, a burst, then steady again: does it recover? | `BASE_RATE` (20), `SPIKE_RATE` (300), `SPIKE_SECONDS` (60) |
| `soak` | A realistic blend held for a long time: leaks, drift | `SOAK_RATE` (50), `SOAK_MINUTES` (30) |

All scenarios use k6's arrival-rate executors (an open model). Requests keep
arriving at the set rate however slow the server gets, as real visitors do.
That is what makes the knee visible.

Stack-level knobs go in the environment of `./run.sh up`: `LT_SERVER_CPUS`
(1), `LT_DB_CPUS` (1), `LT_SERVER_MEM` (512m), `LT_DB_MEM` (1g),
`LT_DB_MAX_CONNECTIONS` (10), `LT_STUB_LATENCY_MS` (150), `LT_API_PORT` (3101).

## Reading `summary.md`

- **offered/s vs done/s.** While they match, the server keeps up. When done/s
  stops rising and offered/s keeps going, you have found the ceiling.
- **dropped.** Requests k6 could not even start because every virtual user
  was waiting on the server. Any non-zero value means overload.
- **CPU% server / db / stub / k6.** 100 = one full core. Whichever of server
  and db reaches 100 first is the bottleneck. If k6 itself nears its limit,
  the numbers are not trustworthy.
- **Percentiles** include timeouts (k6 gives up at 60s). Requests that never
  connected count as errors only.

## How this differs from production

Treat the numbers as an upper bound for the Droplet, not a promise.

- **Shared core.** Here the server and Postgres get a core each. On a 1-vCPU
  Droplet they share one, along with Next.js, Caddy and the demo. Rough
  production ceiling: the load at which server CPU% + db CPU% reaches 100.
- **Faster cores.** Apple-silicon cores are faster than a Droplet's shared vCPU.
- **No Caddy or TLS** in front, so no HTTPS cost per request.
- **Cheaper fan-out.** The stub registry is plain HTTP on reused connections.
  In production each fan-out call does DNS + a TLS handshake
  (`OUTBOUND_ALLOW_PRIVATE_HOSTS` swaps the pinned fetch for the global one).
- **Rate limits raised.** All load comes from one IP, so production limits
  would answer 429 within seconds.

## Safety

- **Isolated stack.** Separate Compose project (`-p nanda-loadtest`) with its
  own volume, so `down -v` cannot reach the dev stack.
- **No traffic leaves the machine.** Emails are logged, OpenAI enrichment is
  off, federation is pinned to `none`, and fan-out goes only to the local stub.
- **Throwaway secrets.** The JWT and cookie secrets in `docker-compose.yml`
  are for this stack only.
- **Seed rows are marked.** They use `org_id` `lt-*` and `@loadtest.example`
  emails, and re-seeding replaces only those.

## Baseline: 2026-10-19

Taken on an M1 Pro (server and db capped at one core each), `origin/main` at
`dadea66`. Use these to compare after a change.

| Test | Ceiling | First bottleneck |
|---|---|---|
| reads, 100 orgs | ~1,100–1,200 req/s | server CPU (db ~50%) |
| reads, 50,000 orgs | ~15 req/s | db CPU: full-table scans in keyword search, listing + `COUNT(*)`, ARD facets |
| logins | ~13 logins/s | server CPU: bcryptjs (cost 10) on the main thread; other requests stall with it |
| agentic search, 100 orgs | ~115 searches/s (~1,150 fan-out calls/s) | server CPU |
| spike 100 → 1,500 → 100 req/s | recovered within 10s | n/a |
| soak, 100 req/s blend, 10 min | 0 errors, server memory flat (~60 MiB) | n/a; read p95 ~100 ms (vs ~5 ms in pure reads) from logins interleaving |
