"""Live status of every service this demo depends on."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from . import config

__all__ = ["Reference", "catalogue", "probe_all"]

#: How long a probe may take before it is reported as unreachable. Short, because
#: this runs while somebody is looking at a tab: a slow answer and no answer are
#: the same thing to them, and the entry says which it was.
TIMEOUT_SECONDS = 6.0


@dataclass(frozen=True)
class Reference:
    """One service, and the path that tells you it is alive."""

    name: str
    kind: str
    url: str
    #: Appended to ``url`` for the liveness probe. Different per service on
    #: purpose — an agent has no /health and an index has no agent card, and
    #: probing the wrong one reports a healthy service as down.
    health_path: str
    note: str = ""
    status: str = "unknown"
    detail: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "kind": self.kind,
            "url": self.url,
            "note": self.note,
            "status": self.status,
            "detail": self.detail,
            **({"extra": self.extra} if self.extra else {}),
        }


def catalogue() -> list[Reference]:
    """Everything the demo touches, in the order a reader meets it."""
    guests = config.DEFAULT_GUESTS
    refs = [
        Reference(
            name="Public Index",
            kind="Directory",
            url=config.public_index_url(),
            health_path="/api/v1/search?q=regentix",
            note="Lists companies. Searched by name.",
        ),
        Reference(
            # Named for what it is to this demo rather than for its software
            # version: a reader does not need to know there was a v2 of it, and
            # calling it "NANDA Index v3" alongside the public NANDA Index made
            # two different services look like two releases of one.
            name="Second Index",
            kind="Directory",
            url=config.index_v3_url(),
            health_path="/health",
            note="Maps an agent's name to where it answers. Agents register themselves here.",
        ),
    ]
    for guest in guests:
        org = {"regentix": "Regentix AI", "astrocity": "AstroCity"}.get(guest.org_query, guest.company)
        refs.append(
            Reference(
                name=f"{org} — organisation server",
                kind="Organisation",
                url=_ORG_SERVERS.get(guest.org_query, ""),
                health_path="/health",
                note="Publishes the company's listings.",
            )
        )
    refs.append(
        Reference(
            name="RocketBrain — organisation server",
            kind="Organisation",
            url=_ORG_SERVERS["rocketbrain"],
            health_path="/health",
            note="A third organisation in the estate, not used by this run.",
        )
    )
    for guest in guests:
        refs.append(
            Reference(
                # Only the first letter: `.capitalize()` lowercases the rest and
                # turned "the CEO of Regentix" into "The ceo of regentix".
                name=guest.who[:1].upper() + guest.who[1:],
                kind="Agent",
                url=guest.agent_url,
                health_path="/.well-known/agent-card.json",
                note=f"{guest.company}. Guest on this run.",
            )
        )
    refs.append(
        Reference(
            name="The restaurant",
            kind="Venue",
            url=config.venue_url(),
            health_path="/health",
            note="Independent. Keeps its own diary and signs its own receipts.",
        )
    )
    refs.append(
        Reference(
            name="This agent",
            kind="Concierge",
            url=config.service_url().rstrip("/"),
            health_path="/healthz",
            note="Runs the scenario. Built on a different stack from the rest.",
        )
    )
    return [r for r in refs if r.url]


#: The three organisation servers. Configured rather than discovered: an outsider
#: cannot learn these from the index, which returns them only as a `registry_url`
#: on a record it has already been asked for by name.
#: The organisation servers, from the one place they are defined.
_ORG_SERVERS = config.ORG_SERVERS


def _probe(ref: Reference) -> Reference:
    url = ref.url.rstrip("/") + ref.health_path
    request = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read(4000)
            code = response.status
    except urllib.error.HTTPError as exc:
        # An HTTP error is an answer: the service is running and said no. A 401
        # on a gated path is not the same fact as a connection refused, and a
        # light that shows them alike hides which one an operator must act on.
        return _with(ref, "degraded", f"HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001 - anything else is "did not answer"
        return _with(ref, "offline", f"{type(exc).__name__}: {exc}"[:160])

    extra: dict[str, Any] = {}
    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            for field_name in ("tree_size", "members", "count", "status"):
                if field_name in parsed:
                    extra[field_name] = parsed[field_name]
    except ValueError:
        pass
    return _with(ref, "online" if code < 400 else "degraded", f"HTTP {code}", extra)


def _with(ref: Reference, status: str, detail: str, extra: dict[str, Any] | None = None) -> Reference:
    return Reference(
        name=ref.name,
        kind=ref.kind,
        url=ref.url,
        health_path=ref.health_path,
        note=ref.note,
        status=status,
        detail=detail,
        extra=extra or {},
    )


def probe_all(refs: list[Reference] | None = None) -> list[Reference]:
    """Probe every reference at once."""
    entries = refs if refs is not None else catalogue()
    if not entries:
        return []
    with ThreadPoolExecutor(max_workers=min(12, len(entries))) as pool:
        return list(pool.map(_probe, entries))
