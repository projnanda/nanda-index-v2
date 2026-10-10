"""Read an agent's AgentFacts document for the skills it claims for itself."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

__all__ = ["SKILL_PREFIX", "AgentFactsError", "Facts", "facts_for", "skill_name"]

#: NANDA skills are URNs. The last segment is the term a person searches for.
SKILL_PREFIX = "urn:nanda:skill:"

TIMEOUT_SECONDS = 8.0


class AgentFactsError(RuntimeError):
    """This agent's own description could not be read."""


def skill_name(urn: str) -> str:
    """``urn:nanda:skill:leadership`` -> ``leadership``."""
    text = str(urn).strip()
    if text.lower().startswith(SKILL_PREFIX):
        text = text[len(SKILL_PREFIX) :]
    elif ":" in text:
        text = text.rsplit(":", 1)[-1]
    return text.strip().lower()


@dataclass(frozen=True)
class Facts:
    """One agent's self-description."""

    url: str
    did: str = ""
    label: str = ""
    skills: tuple[str, ...] = field(default_factory=tuple)
    auth_methods: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        """Normalise skills once, here, rather than in every consumer."""
        object.__setattr__(self, "skills", tuple(n for n in map(skill_name, self.skills) if n))

    def to_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "did": self.did,
            "label": self.label,
            "skills": list(self.skills),
            "auth_methods": list(self.auth_methods),
        }


def _get(url: str, timeout: float) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def facts_for(card_url: str, *, timeout: float = TIMEOUT_SECONDS) -> Facts:
    """Read an agent's AgentFacts, starting from wherever its card is published."""
    try:
        card = _get(card_url, timeout)
    except Exception as exc:  # noqa: BLE001 - a counterparty's outage is data
        raise AgentFactsError(f"card {card_url} unreadable: {type(exc).__name__}") from exc

    base = str(card.get("url") or "").strip().rstrip("/")
    if not base:
        raise AgentFactsError(f"card {card_url} names no address for its agent")
    # Cards in this estate still advertise http:// for hosts that serve https.
    if base.startswith("http://"):
        base = "https://" + base[len("http://") :]

    try:
        payload = _get(f"{base}/agentfacts.json", timeout)
    except Exception as exc:  # noqa: BLE001
        raise AgentFactsError(f"{base}/agentfacts.json unreadable: {type(exc).__name__}") from exc

    caps = payload.get("capabilities") or {}
    auth = caps.get("authentication") or {}
    return Facts(
        url=f"{base}/agentfacts.json",
        did=str(payload.get("id") or ""),
        label=str(payload.get("label") or payload.get("agent_name") or ""),
        skills=tuple(skill_name(s) for s in (caps.get("skills") or []) if skill_name(s)),
        auth_methods=tuple(str(m) for m in (auth.get("methods") or [])),
    )
