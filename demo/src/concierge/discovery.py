"""Find counterparties through the NANDA index, and record how each was found."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any

__all__ = [
    "CONFIGURED",
    "PUBLIC_INDEX",
    "RESOLVED",
    "SEARCHED",
    "Counterparty",
    "entry_claims",
    "org_catalog",
    "search_capability",
]

PUBLIC_INDEX = "https://api.nandaindex.org"

#: How a counterparty's address came to be known. These are not decorations: a
#: claim is only as strong as its weakest hop, and a reader cannot tell them
#: apart from the transcript of a successful run.
SEARCHED = "searched"  # a capability query returned it
RESOLVED = "resolved"  # an index pointer bound its name to its key
CONFIGURED = "configured"  # an operator supplied it; nothing vouched for it


@dataclass(frozen=True)
class Counterparty:
    """Somewhere to send a request, and the provenance of that address."""

    label: str
    url: str
    how: str
    #: Present only when an index record was actually read. ``None`` means no
    #: index vouched for this address — distinct from an empty string, which
    #: would suggest one did and said nothing.
    urn: str | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)

    def provenance(self) -> dict[str, Any]:
        """What a receipt records about how this address was obtained."""
        return {"label": self.label, "url": self.url, "how": self.how, "urn": self.urn, "tags": list(self.tags)}


def _get_json(url: str, *, timeout: float) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read(500_000).decode())


def search_capability(term: str, *, index_url: str = PUBLIC_INDEX, timeout: float = 20.0) -> list[Counterparty]:
    """Organisations the public index says match ``term``."""
    query = urllib.parse.urlencode({"q": term})
    payload = _get_json(f"{index_url.rstrip('/')}/api/v1/search?{query}", timeout=timeout)

    found: list[Counterparty] = []
    seen: set[str] = set()
    for record in payload.get("results") or []:
        url = (record.get("registry_url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        found.append(
            Counterparty(
                label=record.get("org_id") or record.get("display_name") or url,
                url=url,
                how=SEARCHED,
                urn=record.get("identifier"),
                tags=tuple(record.get("tags") or ()),
            )
        )
    return found


def org_catalog(registry_url: str, *, timeout: float = 20.0) -> dict[str, Any]:
    """The org's catalog document, and what it admits it is not showing."""
    url = f"{registry_url.rstrip('/')}/.well-known/ai-catalog.json"
    payload = _get_json(url, timeout=timeout)
    entries = payload.get("entries") or []
    return {
        "url": url,
        "entries": entries,
        "visible": len(entries),
        "withheld": payload.get("withheldMembers", 0),
        "omitted": payload.get("omittedMembers", 0),
    }


# ── following a hop to the agent behind it ──────────────────────────────────


class DiscoveryError(RuntimeError):
    """A hop answered, and what it answered cannot be followed."""


def find_agent_by_capability(catalog: dict[str, Any], capability: str) -> dict[str, Any] | None:
    """The first catalog entry whose published tags claim ``capability``."""
    for entry in catalog.get("entries") or []:
        if entry_claims(entry, capability) and entry.get("url"):
            return entry
    return None


def entry_claims(entry: dict[str, Any], capability: str) -> bool:
    """Whether a catalog entry publishes ``capability`` among its tags."""
    wanted = capability.strip().lower()
    if not wanted:
        return False
    return wanted in [str(t).strip().lower() for t in (entry.get("tags") or [])]


def resolve_pointer(urn: str, *, index_url: str, timeout: float = 20.0) -> dict[str, Any]:
    """The index-v3 record for ``urn``: where this key says it can be reached."""
    query = urllib.parse.urlencode({"id": urn})
    try:
        payload = _get_json(f"{index_url.rstrip('/')}/v1/resolve?{query}", timeout=timeout)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise DiscoveryError(f"{urn} resolves to nothing — never registered, or lapsed") from exc
        raise
    record = payload.get("record")
    if not isinstance(record, dict) or not record.get("next_hop"):
        raise DiscoveryError(f"{urn} resolved to a record with no next hop: {str(payload)[:200]}")
    return record


def endpoint_from_card(card_url: str, *, timeout: float = 20.0) -> tuple[str, dict[str, Any]]:
    """Follow a card URL to the address the agent actually answers on."""
    card = _get_json(card_url, timeout=timeout)
    endpoint = (card.get("url") or "").strip()
    if not endpoint:
        raise DiscoveryError(f"{card_url} is a card with no url — it names no address to call")
    # Cards in this estate are published with http:// even where the service is
    # https-only. Upgraded rather than trusted: the counterparty redirects, and a
    # signed request that follows a redirect is a signed request somebody else
    # chose the destination for.
    if endpoint.startswith("http://"):
        endpoint = "https://" + endpoint[len("http://") :]
    return endpoint.rstrip("/"), card
