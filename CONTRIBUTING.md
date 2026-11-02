# Contributing

Three suites, one per part of the repo. Each has a CI job that runs on pull
requests touching that path, so a change is checked by the same commands you
can run locally.

| Path | Workflow | What it runs |
|------|----------|--------------|
| `server/**` | `.github/workflows/server.yml` | migrations, `npm test`, `npm run typecheck` against a real Postgres 16 |
| `web/**` | `.github/workflows/resolve-examples.yml` | `npm test`, `npm run build`, `npm run typecheck`, then every Resolve preset over HTTP |
| `demo/**` | `.github/workflows/demo.yml` | `tools/ci.py` — ruff lint and format, the offline suite with its coverage floors, and the browser suite |

CI runs **Node 20**, matching `server/package.json` engines and both
Dockerfiles. Versions are pinned rather than floating so a runner or Node
release cannot change the result of a run without a commit that says so.

## Running the suites locally

Bring the database up first — the server's integration tests assert on
constraints, advisory locks, full-text search and concurrent transactions
against a real Postgres, so there is nothing to run without one.

```bash
cp .env.example .env
docker compose up -d db
```

### server

```bash
cd server
npm ci
npm run migrate       # the tests run against the schema, they do not create it
npm test
npm run typecheck
```

`docker compose` publishes Postgres on **5433**, not 5432, so `DATABASE_URL`
in `server/.env` needs `localhost:5433` when you run the tests from the host.
Port 5432 is the address *inside* the compose network, which is what the
server container uses.

Two things worth knowing before you read a failure:

- **Run the migrations first.** The suites do not create the schema. Against a
  database missing a migration the failures are confusing rather than
  obviously schema-related — a batch of `expected 403 to be 200` rather than
  anything mentioning a column.
- The suites clean up their own rows, each prefixed per file, so running them
  against your development database is safe.

### web

```bash
cd web
npm ci
npm test
npm run build
npm run typecheck
```

**`rm -rf .next` after switching branches.** Next generates route types into
`.next/types` and `tsconfig.json` includes them. A clean checkout is fine —
the include tolerates their absence, so `npm run typecheck` passes on its own.
But a `.next` left over from a different branch makes `tsc` check *that*
branch's routes and report missing modules with nothing to do with your
change. Building before typechecking, as CI does, regenerates them and gets
the generated route types checked too.

`npm run lint` is not yet a CI gate: `src/app/explore/page.tsx` has a
pre-existing `react-hooks/set-state-in-effect` error. It is left alone here
because several open pull requests touch that file, and fixing it in passing
would conflict with all of them. Treat the lint output as "no *new* errors"
until that one is cleared, then add it to the web workflow.

### demo

```bash
cd demo
pip install -e .
pip install ruff pytest pytest-cov playwright
python -m playwright install --with-deps chromium
PYTHONPATH=src python tools/ci.py
```

`tools/ci.py` is the gate, not a convenience wrapper — it carries the global
and per-module coverage floors, and CI runs that same script so the two cannot
drift. Without chromium the browser tests skip themselves and the gate still
passes, which means nobody rendered the page; install the browser.

## Testing a pull request against current `main`

A clean `git merge` is not evidence a branch still works. Two of the defects
found in this repo merged without a conflict and then failed the build,
because `main` had changed a signature the branch's tests still called the old
way. Before approving, merge `main` into the branch locally and run the suites
its diff touches — which is what the per-path workflows above now do for you
on every push.

## Writing tests

Write the test so it fails when someone adds the *next* instance of the bug,
not only the one in front of you. Where a rule is a list — parameters safe to
log, URL schemes allowed, roles the server emits — prefer an allowlist and add
a case proving an unknown value is handled safely, so the list fails closed
when it is next forgotten.
