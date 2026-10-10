#!/usr/bin/env python3
"""The local gate. Runs offline; a failure here is a failure anywhere.

Why the per-module floors, on top of a global one
-------------------------------------------------
A global average hides exactly the gap that matters. This repo's weakest module
when it was first measured was ``identity`` at 47% — the module that claims this
agent's *name*, whose uncovered branches were the whole registration protocol —
while the total read a comfortable 85%. An average cannot tell a well-tested
helper from an untested credential path.

So the modules where a coverage gap is a security gap carry an explicit floor,
set from the measurement on the day they landed and rounded down a couple of
points so unrelated churn does not flake the gate. **When a module's coverage
rises, raise its floor.** Never lower one without writing down why.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Baseline measured 2026-09-30, floored ~2 points under.
FLOORS: dict[str, float] = {
    # Signs every outbound request. An uncovered branch here is a branch that can
    # sign the wrong bytes or name the wrong scheme — and a signature that does
    # not verify is indistinguishable from not having a credential at all.
    "src/concierge/signing.py": 96.0,
    # Claims this agent's name. Its uncovered branches WERE the registration
    # protocol, found by reading coverage rather than by anything failing, which
    # is the case this floor exists to stop recurring.
    "src/concierge/identity.py": 93.0,
    # The evidence. A gap here is a gap in the check that says whether a chain
    # has been edited, and a chain nobody can check is decoration.
    "src/concierge/receipts.py": 97.0,
    # The fold. Two implementations that agree only with each other produce two
    # valid receipts for one booking that cannot be paired — invisible from both
    # ends, which is why this is pinned at 100.
    "src/concierge/folds.py": 100.0,
    # Turns a counterparty's refusal into data. An uncovered branch is a refusal
    # read as a success, or a -32004 confused with a -32002.
    "src/concierge/transport.py": 94.0,
    # Distinguishes "register first" from "you may not act as them".
    "src/concierge/venue.py": 90.0,
    # Cross-organisation search. An uncovered branch here is an organisation
    # silently skipped, which returns "nobody claims this" for "we did not ask"
    # — the one wrong answer this module can give that looks like a right one.
    "src/concierge/capabilities.py": 95.0,
    # Keeps the agent's name resolvable, and is the only thing that says whether
    # it is still doing so. An uncovered branch is a loop that looks alive in
    # /healthz while having stopped, which is worse than no health field.
    "src/concierge/renewal.py": 95.0,
    # What an agent says about itself. An uncovered branch is a silent fall back
    # to the organisation's claim about it, which is the thing this module exists
    # to stop being invisible.
    "src/concierge/agentfacts.py": 95.0,
    # The grant this agent runs under. An uncovered branch is a run that
    # proceeds on authority it does not hold — found, if at all, by whoever
    # verifies the chain after a real table was booked.
    "src/concierge/authority.py": 95.0,
}

GLOBAL_FLOOR = 90.0


def run(label: str, *command: str) -> bool:
    print(f"\n── {label} " + "─" * max(0, 60 - len(label)))
    result = subprocess.run(command, cwd=ROOT)
    return result.returncode == 0


def main() -> int:
    failed: list[str] = []

    if not run("ruff (lint)", sys.executable, "-m", "ruff", "check", "src", "tests", "tools"):
        failed.append("ruff check")
    if not run("ruff (format)", sys.executable, "-m", "ruff", "format", "--check", "src", "tests", "tools"):
        failed.append("ruff format")

    # The offline suite carries the coverage floors. The browser suite is measured
    # separately so a machine without chromium still gets a meaningful number
    # rather than a quietly smaller one.
    if not run(
        "pytest (offline)",
        sys.executable,
        "-m",
        "pytest",
        "tests",
        "-q",
        "-m",
        "not ui",
        "--cov=concierge",
        "--cov-report=json:coverage.json",
        "--cov-report=term:skip-covered",
        f"--cov-fail-under={GLOBAL_FLOOR}",
    ):
        failed.append(f"pytest / global coverage < {GLOBAL_FLOOR}%")

    # Drives the real page in a real browser. Skips itself, loudly, where
    # playwright or the browser binary is absent — a page nobody rendered is not
    # a page anybody tested, and the gate should say which it did.
    if not run("pytest (browser)", sys.executable, "-m", "pytest", "tests", "-q", "-m", "ui"):
        failed.append("pytest / browser suite")

    print("\n── per-module coverage floors " + "─" * 32)
    report = ROOT / "coverage.json"
    if not report.is_file():
        print("FAIL no coverage.json — the test run did not produce one")
        failed.append("coverage report missing")
    else:
        files = json.loads(report.read_text())["files"]
        for module, floor in FLOORS.items():
            entry = files.get(module)
            if entry is None:
                print(f"FAIL {module}: missing from coverage data — renamed or moved? update FLOORS")
                failed.append(module)
                continue
            pct = entry["summary"]["percent_covered"]
            ok = pct >= floor
            print(f"{'ok  ' if ok else 'FAIL'} {module}: {pct:.1f}% (floor {floor:.0f}%)")
            if not ok:
                failed.append(module)

    print()
    if failed:
        print("GATE FAILED: " + ", ".join(failed))
        return 1
    print("GATE PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
