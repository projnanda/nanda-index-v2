"""Command-line entry points: register, run, serve."""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time

from . import config
from .identity import ensure_registered, load_or_create
from .lunch import arrange


def _register(me) -> None:
    result = ensure_registered(me, index_url=config.index_url(), card_url=config.card_url())
    print(f"[concierge] did   {me.did}")
    print(f"[concierge] urn   {me.urn}")
    print(f"[concierge] index {result.get('action')} seq={result.get('seq')} {config.index_url()}")
    if result.get("action") in ("unreachable", "failed"):
        # Not fatal. An agent that cannot reach discovery should still serve the
        # peers that already know where it is; turning someone else's outage into
        # ours is the worse failure. It WILL be refused by the venue until this
        # succeeds, so it is said loudly rather than logged quietly.
        print(
            f"[concierge] ⚠️  not registered ({result.get('detail', '')[:160]}) — the venue will refuse writes"
        )


def main(argv: list[str]) -> int:
    command = (argv[1] if len(argv) > 1 else "run").lower()
    me = load_or_create("concierge")

    if command == "serve":
        import uvicorn

        from .server import build_app

        _register(me)
        print(f"[concierge] card  {config.card_url()}")
        uvicorn.run(build_app(me), host="0.0.0.0", port=int(os.environ.get("PORT", "8080")), log_level="info")
        return 0

    if command == "register":
        _register(me)
        return 0

    if command == "run":
        _register(me)
        plan = arrange(
            me,
            guests=config.DEFAULT_GUESTS,
            venue_url=config.venue_url(),
            date=config.lunch_date(),
            candidate_starts=config.candidate_starts(),
            index_url=config.public_index_url(),
            index_v3_url=config.index_v3_url(),
        )
        # Written before printing. A chain that exists only in a terminal
        # buffer is not evidence of anything — and the run that produced it made
        # real bookings, so it must outlive the shell that watched it.
        out = pathlib.Path(os.environ.get("CONCIERGE_RECEIPTS", "receipts"))
        out.mkdir(parents=True, exist_ok=True)
        path = out / f"run-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}.json"
        path.write_text(
            json.dumps(
                {"summary": plan.summary(), "entries": [e.to_dict() for e in plan.chain.entries]},
                indent=2,
                ensure_ascii=False,
            )
        )
        print(json.dumps(plan.summary(), indent=2))
        print(f"[concierge] chain {path} ({len(plan.chain.entries)} entries)")
        for entry in plan.chain.entries:
            print(f"  {entry.seq:>2}  {entry.step:26s} {entry.outcome[:96]}")
        return 0

    print(f"unknown command {command!r}; expected serve | register | run", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
