#!/usr/bin/env python3
"""Turn one load-test run into a Markdown summary.

    python3 summarize.py results/<run>            (run.sh does this)
    WINDOW=15 python3 summarize.py results/<run>  (seconds per row, default 10)

Reads k6.csv.gz (every k6 sample) and stats.csv (container CPU/memory) and
prints two tables: one row per time window — load offered vs. served, latency
percentiles, errors, and container CPU side by side, which is where a knee
shows — and one row per endpoint over the whole run.
"""

import csv
import gzip
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path

WINDOW = int(os.environ.get("WINDOW", "10"))
CONTAINERS = ("server", "db", "stub-registry", "k6")
K6_METRICS = ("http_req_duration", "http_req_failed", "dropped_iterations", "offered")


def new_bucket():
    return {"durations": [], "failed": 0, "dropped": 0, "offered": 0, "unconnected": 0,
            "by_scenario": defaultdict(list)}


def percentile(values, pct):
    """Nearest-rank percentile of an unsorted list (None when empty)."""
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(pct / 100 * len(ordered)) - 1)]


def fmt_ms(value):
    if value is None:
        return "-"
    return f"{value / 1000:.1f}s" if value >= 10_000 else f"{value:.0f}"


def read_k6(path):
    """Per-second buckets and per-endpoint samples from k6's CSV output.

    Durations are timestamped when a request completes; `offered` when it is
    sent. Timeouts stay in the percentiles (a timeout is a real wait), but a
    request that never connected records 0 ms, so it counts only as an error.
    """
    seconds = defaultdict(new_bucket)
    endpoints = defaultdict(lambda: {"durations": [], "failed": 0, "unconnected": 0})
    with gzip.open(path, "rt", newline="") as handle:
        for row in csv.DictReader(handle):
            metric = row["metric_name"]
            if metric not in K6_METRICS:
                continue
            bucket = seconds[int(float(row["timestamp"]))]
            value = float(row["metric_value"])
            if metric == "http_req_duration":
                if row["status"] == "0" and value < 1:
                    # Never connected (e.g. dial timeout): an error, no latency.
                    bucket["unconnected"] += 1
                    endpoints[row["name"]]["unconnected"] += 1
                    continue
                bucket["durations"].append(value)
                bucket["by_scenario"][row["scenario"]].append(value)
                endpoints[row["name"]]["durations"].append(value)
            elif metric == "http_req_failed":
                bucket["failed"] += int(value)
                endpoints[row["name"]]["failed"] += int(value)
            else:
                bucket["dropped" if metric == "dropped_iterations" else "offered"] += int(value)
    return seconds, endpoints


def regroup(seconds):
    """Per-second buckets -> WINDOW-second buckets, keyed by offset from the
    first sample, with every window present (a stall shows as an empty row)."""
    t0, last = min(seconds), max(seconds)
    grouped = {offset: new_bucket() for offset in range(0, last - t0 + 1, WINDOW)}
    for ts, bucket in seconds.items():
        target = grouped[(ts - t0) // WINDOW * WINDOW]
        target["durations"].extend(bucket["durations"])
        for key in ("failed", "dropped", "offered", "unconnected"):
            target[key] += bucket[key]
        for scenario, values in bucket["by_scenario"].items():
            target["by_scenario"][scenario].extend(values)
    return t0, last - t0 + 1, grouped


def container_kind(name):
    return next((kind for kind in CONTAINERS if f"-{kind}-" in name), None)


def mem_mib(usage):
    """'123.4MiB / 512MiB' -> 123.4"""
    used = usage.split("/")[0].strip()
    units = {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024, "B": 1 / 1024 / 1024}
    for unit, factor in units.items():
        if used.endswith(unit):
            return float(used[: -len(unit)]) * factor
    return 0.0


def read_stats(path, t0):
    """Mean CPU% and max memory per container kind per window."""
    cpu = defaultdict(lambda: defaultdict(list))
    mem = defaultdict(lambda: defaultdict(float))
    if not path.exists():
        return cpu, mem
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            kind = container_kind(row["container"])
            if kind is None:
                continue
            offset = (int(row["ts"]) - t0) // WINDOW * WINDOW
            cpu[offset][kind].append(float(row["cpu_pct"].rstrip("%") or 0))
            mem[offset][kind] = max(mem[offset][kind], mem_mib(row["mem_usage"]))
    return cpu, mem


def cpu_cell(samples):
    means = [sum(samples[k]) / len(samples[k]) if samples[k] else None for k in CONTAINERS]
    return " / ".join("-" if m is None else f"{m:.0f}" for m in means)


def window_table(grouped, span, cpu, mem):
    scenarios = sorted({s for b in grouped.values() for s in b["by_scenario"]})
    split = len(scenarios) > 1
    head = ["t (s)", "offered/s", "done/s", "p50 ms", "p95 ms", "p99 ms", "errors",
            "dropped", "CPU% server / db / stub / k6", "server MiB"]
    head += [f"p95 {s}" for s in scenarios] if split else []
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for offset, b in sorted(grouped.items()):
        covered = min(WINDOW, span - offset)  # the last window may be partial
        n = len(b["durations"])
        attempts = n + b["unconnected"]
        cells = [
            str(offset),
            f"{(b['offered'] + b['dropped']) / covered:.0f}",
            f"{n / covered:.0f}",
            fmt_ms(percentile(b["durations"], 50)),
            fmt_ms(percentile(b["durations"], 95)),
            fmt_ms(percentile(b["durations"], 99)),
            f"{100 * b['failed'] / attempts:.1f}%" if attempts else "-",
            str(b["dropped"]),
            cpu_cell(cpu[offset]),
            f"{mem[offset]['server']:.0f}" if mem[offset]["server"] else "-",
        ]
        cells += [fmt_ms(percentile(b["by_scenario"].get(s, []), 95)) for s in scenarios] if split else []
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def endpoint_table(endpoints):
    head = ["endpoint", "requests", "p50 ms", "p95 ms", "p99 ms", "max ms", "errors"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for name, e in sorted(endpoints.items(), key=lambda kv: -(percentile(kv[1]["durations"], 95) or 0)):
        n = len(e["durations"])
        attempts = n + e["unconnected"]
        lines.append("| " + " | ".join([
            name or "(untagged)", str(attempts),
            fmt_ms(percentile(e["durations"], 50)),
            fmt_ms(percentile(e["durations"], 95)),
            fmt_ms(percentile(e["durations"], 99)),
            fmt_ms(max(e["durations"]) if n else None),
            f"{100 * e['failed'] / attempts:.1f}%" if attempts else "-",
        ]) + " |")
    return "\n".join(lines)


def stub_calls(run_dir):
    """Fan-out calls the stub registry answered during the run, or None."""
    try:
        before = json.loads((run_dir / "stub-calls-before.txt").read_text())["searchCalls"]
        after = json.loads((run_dir / "stub-calls.txt").read_text())["searchCalls"]
        return after - before
    except (OSError, ValueError, KeyError, TypeError):
        return None


def main(argv):
    if len(argv) != 2:
        sys.exit("usage: summarize.py <results/run-dir>")
    run_dir = Path(argv[1])
    k6_csv = run_dir / "k6.csv.gz"
    if not k6_csv.exists():
        sys.exit(f"summarize.py: no k6 output at {k6_csv} (did k6 start?)")

    seconds, endpoints = read_k6(k6_csv)
    if not seconds:
        sys.exit("summarize.py: k6 output has no samples")
    t0, span, grouped = regroup(seconds)
    cpu, mem = read_stats(run_dir / "stats.csv", t0)

    print(f"# {run_dir.name}\n")
    print(f"## Over time ({WINDOW}s windows)\n")
    print("offered/s = requests k6 tried to start (incl. dropped); done/s = responses back.")
    print("CPU% is per container, 100 = one full core. 'dropped' = requests k6 could not")
    print("start because every virtual user was stuck waiting. Percentiles include timeouts")
    print("(a timeout is the wait it was) but not requests that never connected.\n")
    print(window_table(grouped, span, cpu, mem))
    print("\n## By endpoint (whole run, slowest p95 first)\n")
    print(endpoint_table(endpoints))
    calls = stub_calls(run_dir)
    if calls is not None:
        print(f"\nStub registry answered {calls} fan-out calls during this run.")
    top = run_dir / "top-queries.txt"
    if top.exists():
        print("\n## Postgres: most total time\n\n```\n" + top.read_text().strip() + "\n```")


if __name__ == "__main__":
    main(sys.argv)
