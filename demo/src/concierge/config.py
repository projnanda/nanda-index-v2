"""Environment configuration and the default counterparty addresses."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

from .lunch import VIA_INDEX_V2, VIA_INDEX_V3, Guest

__all__ = [
    "DEFAULT_GUESTS",
    "ORG_SERVERS",
    "candidate_starts",
    "host_did",
    "host_label",
    "index_url",
    "venue_url",
]

#: The three organisation servers, by the name the index knows them under.
#: Configured, not discovered: the public index returns a ``registry_url`` only
#: for a record asked for by name, so every receipt using these says
#: ``configured``. Read by the reference probes, the capability search and the
#: scenario, so it is defined once here. The scenario also uses it to decide
#: which search hit is the company meant: only one pointing at this server.
ORG_SERVERS: dict[str, str] = {
    "regentix": os.environ.get("REGENTIX_SERVER_URL", "https://server-production-c4d4.up.railway.app"),
    "astrocity": os.environ.get("ASTROCITY_SERVER_URL", "https://server-production-9ec7.up.railway.app"),
    "rocketbrain": os.environ.get("ROCKETBRAIN_SERVER_URL", "https://server-production-c3f5.up.railway.app"),
}


#: The two invitees, one found through each index so the demo shows both routes.
#:
#: Regentix's CEO comes from index v2: search the org by name, read its catalog,
#: pick the agent whose tags claim `leadership`, follow its card to the address
#: it answers on. AstroCity's chief scientist comes from a second index that
#: binds a name to a key: resolve the name to its current pointer. That index
#: holds no capability metadata, so it answers "where is this agent" and not
#: "which agent does X".
DEFAULT_GUESTS = [
    Guest(
        who="the CEO of Regentix",
        company="Regentix AI",
        org_query="regentix",
        agent_label="regentix-ceo",
        via=VIA_INDEX_V2,
        capability=os.environ.get("REGENTIX_CAPABILITY", "leadership"),
        agent_url=os.environ.get("REGENTIX_CEO_URL", "https://ceo-production-b906.up.railway.app"),
        registry_url=ORG_SERVERS["regentix"],
    ),
    Guest(
        who="the chief scientist of AstroCity",
        company="AstroCity",
        org_query="astrocity",
        agent_label="astrocity-chief-scientist",
        via=VIA_INDEX_V3,
        urn=os.environ.get(
            "ASTROCITY_SCIENCE_URN",
            "urn:ai:key:ujkaiuq3MALCoJKUeAK8ugnLdi0FNLLC1lBSbG3e9KYE/agent",
        ),
        agent_url=os.environ.get("ASTROCITY_SCIENCE_URL", "https://chief-scientist-production.up.railway.app"),
        registry_url=ORG_SERVERS["astrocity"],
    ),
]


def host_did() -> str:
    """The principal this agent acts for, read from the signed grant it holds."""
    from . import authority

    return authority.host_did()


def host_label() -> str:
    """What the page calls the principal. A role, never an invented person."""
    return os.environ.get("HOST_LABEL", "the host")


def index_v3_url() -> str:
    """The second index, which binds a name to a key. Same one the venue uses."""
    return index_url()


#: Live runs all visitors together may start per hour, unless configured. Each
#: run messages two companies' agents and holds a table under the host's grant;
#: a per-visitor limit alone lets enough visitors spend that without end.
DEFAULT_RUN_LIMIT_GLOBAL_PER_HOUR = 20

#: Capability searches one visitor may start per minute, unless configured. Each
#: uncached search is about 3 + 2N requests to other organisations' servers.
DEFAULT_CAPABILITY_LIMIT_PER_MINUTE = 20


def _limit(name: str, default: int) -> int:
    """A non-negative count from the environment; 0 means no limit."""
    raw = os.environ.get(name, "").strip()
    try:
        return max(int(raw), 0) if raw else default
    except ValueError:
        return default


def run_limit_per_hour() -> int:
    """Live runs one visitor may start per hour. Unset or 0 means no limit, which
    suits a workstation; a public deployment sets it (see docker-compose)."""
    return _limit("RUN_LIMIT_PER_HOUR", 0)


def run_limit_global_per_hour() -> int:
    """Live runs all visitors together may start per hour. 0 switches it off."""
    return _limit("RUN_LIMIT_GLOBAL_PER_HOUR", DEFAULT_RUN_LIMIT_GLOBAL_PER_HOUR)


def capability_limit_per_minute() -> int:
    """Uncached capability searches one visitor may start per minute. 0 switches it off."""
    return _limit("CAPABILITY_LIMIT_PER_MINUTE", DEFAULT_CAPABILITY_LIMIT_PER_MINUTE)


def behind_proxy() -> bool:
    """Whether a proxy we run sits in front and appends X-Forwarded-For."""
    return os.environ.get("CONCIERGE_BEHIND_PROXY", "").strip().lower() in ("1", "true", "yes")


def venue_url() -> str:
    return os.environ.get("VENUE_URL", "https://nanda-demo-venue-production.up.railway.app")


def index_url() -> str:
    """The second index: the one the venue resolves callers against.

    Registering in a different one means being refused for not being registered
    while holding a perfectly good entry, so this defaults to the index the
    hosted demo uses.
    """
    return os.environ.get("CONCIERGE_INDEX_URL", "https://nanda-index-v3-production.up.railway.app")


def public_index_url() -> str:
    return os.environ.get("PUBLIC_INDEX_URL", "https://api.nandaindex.org")


def card_url() -> str:
    """Where this agent's card is served, and what gets registered as ``next_hop``."""
    base = os.environ.get("CONCIERGE_BASE_URL", "").strip().rstrip("/")
    if not base:
        domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
        base = f"https://{domain}" if domain else "http://localhost:8080"
    return f"{base}/.well-known/agent-card.json"


def service_url() -> str:
    """Where this agent answers A2A — the ``url`` field of its own card."""
    return card_url().removesuffix("/.well-known/agent-card.json") + "/"


def lunch_date() -> str:
    """The date to book. Defaults to tomorrow."""
    pinned = os.environ.get("LUNCH_DATE", "").strip()
    if pinned:
        return pinned
    return (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%d")


def candidate_starts() -> list[str]:
    """Every half hour of lunch service, not three guessed times."""
    raw = os.environ.get("LUNCH_STARTS", "").strip()
    if raw:
        return [s.strip() for s in raw.split(",") if s.strip()]
    date = lunch_date()
    return [f"{date}T{hour:02d}:{minute:02d}:00Z" for hour in (11, 12, 13, 14) for minute in (0, 30)]


def request_sentence() -> str:
    """The enquiry, in the words the page shows."""
    who = " and ".join(guest.who for guest in DEFAULT_GUESTS)
    return (
        f"Invite {who} to lunch on {readable_date()}. "
        "Find a time that works, book a restaurant, and keep a record."
    )


def readable_date() -> str:
    """``2026-10-01`` as ``Wednesday 1 October`` — how a person writes a date."""
    try:
        day = datetime.strptime(lunch_date(), "%Y-%m-%d")
    except ValueError:
        # A pinned LUNCH_DATE this cannot parse is shown as given rather than
        # replaced: the operator typed it, and hiding it would hide the mistake.
        return lunch_date()
    return f"{day:%A} {day.day} {day:%B}"
