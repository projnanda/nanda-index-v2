"""Search every organisation's catalog and each agent's AgentFacts for a
capability, and report where the two disagree.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from . import config
from .agentfacts import AgentFactsError, Facts, facts_for
from .discovery import entry_claims, org_catalog

__all__ = ["Divergence", "Match", "Result", "search", "vocabulary"]

#: Short, because a person is waiting on the answer. An organisation that has not
#: replied in this long is reported as unreachable rather than as having nothing.
TIMEOUT_SECONDS = 8.0


#: Which document the capability was claimed in. The agent's own AgentFacts is
#: authoritative; the organisation's catalog is a directory, and a match found
#: only there is a weaker claim that must not read like the stronger one.
BY_AGENT = "agent"
BY_ORG = "org"


@dataclass(frozen=True)
class Divergence:
    """The organisation and the agent disagree about what the agent does."""

    org: str
    identifier: str
    org_only: tuple[str, ...] = field(default_factory=tuple)
    agent_only: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "org": self.org,
            "identifier": self.identifier,
            "claimed_by_org_only": list(self.org_only),
            "claimed_by_agent_only": list(self.agent_only),
        }


@dataclass(frozen=True)
class Match:
    """One agent that claims the capability, and who says so."""

    org: str
    identifier: str
    display_name: str
    url: str
    #: What the agent publishes about itself, from its AgentFacts.
    skills: tuple[str, ...] = field(default_factory=tuple)
    #: What its organisation publishes about it, from the catalog.
    tags: tuple[str, ...] = field(default_factory=tuple)
    #: ``agent`` when the agent's own facts carried the capability, ``org`` when
    #: only the catalog did — which happens when AgentFacts is unreachable.
    source: str = BY_AGENT
    catalog_url: str = ""
    facts_url: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "org": self.org,
            "identifier": self.identifier,
            "display_name": self.display_name,
            "url": self.url,
            "skills": list(self.skills),
            "tags": list(self.tags),
            "source": self.source,
            "catalog_url": self.catalog_url,
            "facts_url": self.facts_url,
        }


@dataclass(frozen=True)
class Result:
    """What the search found, and what it could not see."""

    capability: str
    matches: tuple[Match, ...] = field(default_factory=tuple)
    #: Organisations whose catalog was read successfully.
    searched: tuple[str, ...] = field(default_factory=tuple)
    #: Organisation -> why its catalog could not be read.
    unreachable: dict[str, str] = field(default_factory=dict)
    #: Where an organisation and one of its agents disagree about what the agent
    #: does. Reported, never resolved silently: an organisation claiming more for
    #: an agent than the agent claims for itself is a finding, not a detail.
    divergences: tuple[Divergence, ...] = field(default_factory=tuple)
    #: Agents whose own AgentFacts could not be read, so only the catalog's claim
    #: was available. identifier -> why.
    unverified: dict[str, str] = field(default_factory=dict)

    @property
    def orgs_claiming(self) -> tuple[str, ...]:
        """Distinct organisations with at least one match, in match order."""
        seen: list[str] = []
        for match in self.matches:
            if match.org not in seen:
                seen.append(match.org)
        return tuple(seen)

    @property
    def complete(self) -> bool:
        """Whether every organisation was actually consulted."""
        return not self.unreachable

    def to_dict(self) -> dict[str, Any]:
        return {
            "capability": self.capability,
            "matches": [m.to_dict() for m in self.matches],
            "searched": list(self.searched),
            "unreachable": dict(self.unreachable),
            "complete": self.complete,
            "orgs_claiming": list(self.orgs_claiming),
            "divergences": [d.to_dict() for d in self.divergences],
            "unverified": dict(self.unverified),
        }


def _read(org: str, url: str, timeout: float) -> tuple[str, dict[str, Any] | None, str]:
    """One organisation's catalog, or why it could not be read."""
    try:
        return org, org_catalog(url, timeout=timeout), ""
    except Exception as exc:  # noqa: BLE001 — a refusal is data, not a stop
        return org, None, f"{type(exc).__name__}: {exc}"


def _catalogs(orgs: dict[str, str], timeout: float) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    """Every organisation's catalog, fetched at once."""
    if not orgs:
        return {}, {}
    good: dict[str, dict[str, Any]] = {}
    bad: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(8, len(orgs))) as pool:
        for org, catalog, why in pool.map(lambda item: _read(item[0], item[1], timeout), list(orgs.items())):
            if catalog is None:
                bad[org] = why
            else:
                good[org] = catalog
    return good, bad


def _facts(entries: list[dict[str, Any]], timeout: float) -> list[Facts | str]:
    """Each entry's AgentFacts, or a reason it could not be read."""
    if not entries:
        return []

    def one(entry: dict[str, Any]) -> Facts | str:
        try:
            return facts_for(str(entry["url"]), timeout=timeout)
        except AgentFactsError as exc:
            return str(exc)
        except Exception as exc:  # noqa: BLE001 - a counterparty's outage is data
            return f"{type(exc).__name__}: {exc}"

    with ThreadPoolExecutor(max_workers=min(8, len(entries))) as pool:
        return list(pool.map(one, entries))


def search(
    capability: str,
    *,
    orgs: dict[str, str] | None = None,
    timeout: float = TIMEOUT_SECONDS,
) -> Result:
    """Every agent whose **own** AgentFacts claims ``capability``."""
    roster = config.ORG_SERVERS if orgs is None else orgs
    catalogs, unreachable = _catalogs(roster, timeout)

    wanted = capability.strip().lower()
    matches: list[Match] = []
    divergences: list[Divergence] = []
    unverified: dict[str, str] = {}

    for org in roster:
        catalog = catalogs.get(org)
        if catalog is None:
            continue
        entries = [e for e in (catalog.get("entries") or []) if e.get("url")]
        for entry, facts in zip(entries, _facts(entries, timeout), strict=True):
            identifier = str(entry.get("identifier") or "")
            tags = tuple(str(t).strip().lower() for t in (entry.get("tags") or []))

            if isinstance(facts, str):
                # The agent could not be asked, so only its organisation's claim
                # is available. Recorded as the weaker thing it is.
                unverified[identifier] = facts
                if not entry_claims(entry, capability):
                    continue
                source, skills, facts_url = BY_ORG, (), ""
            else:
                skills = facts.skills
                facts_url = facts.url
                org_only = tuple(t for t in tags if t not in skills)
                agent_only = tuple(s for s in skills if s not in tags)
                if org_only or agent_only:
                    divergences.append(
                        Divergence(org=org, identifier=identifier, org_only=org_only, agent_only=agent_only)
                    )
                if wanted not in skills:
                    continue
                source, facts_url = BY_AGENT, facts.url

            matches.append(
                Match(
                    org=org,
                    identifier=identifier,
                    display_name=str(entry.get("displayName") or identifier),
                    url=str(entry["url"]),
                    skills=tuple(skills),
                    tags=tags,
                    source=source,
                    catalog_url=str(catalog.get("url") or ""),
                    facts_url=facts_url,
                )
            )

    return Result(
        capability=capability.strip(),
        matches=tuple(matches),
        searched=tuple(catalogs),
        unreachable=unreachable,
        divergences=tuple(divergences),
        unverified=unverified,
    )


def vocabulary(*, orgs: dict[str, str] | None = None, timeout: float = TIMEOUT_SECONDS) -> dict[str, list[str]]:
    """Every capability the **agents** publish, and which organisations host them."""
    roster = config.ORG_SERVERS if orgs is None else orgs
    catalogs, _ = _catalogs(roster, timeout)

    found: dict[str, list[str]] = {}
    for org in roster:
        entries = [e for e in ((catalogs.get(org) or {}).get("entries") or []) if e.get("url")]
        for facts in _facts(entries, timeout):
            # An agent whose facts cannot be read contributes nothing rather than
            # falling back to its organisation's tags: a vocabulary is a promise
            # that searching a term finds something, and a term only the catalog
            # carries breaks that promise.
            if isinstance(facts, str):
                continue
            for name in facts.skills:
                if name and org not in found.setdefault(name, []):
                    found[name].append(org)
    return dict(sorted(found.items()))
