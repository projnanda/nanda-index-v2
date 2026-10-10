"""Load and check the delegated authority grant this agent acts under."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

__all__ = [
    "CATEGORIES",
    "COUNTERPARTIES",
    "AuthorityError",
    "check_grant_covers",
    "grant",
    "grant_receipt",
    "grant_receipt_id",
    "host_did",
    "summary",
]

_HERE = Path(__file__).resolve().parent / "authority"

#: What the host permits. Exactly the categories the scenario emits — a grant
#: wider than the work it authorises is an authority nobody audited.
CATEGORIES = [
    "appointment_booked",
    "commitment_entered",
    "message_sent",
    "record_filed",
    "attestation_received",
    "other",
]

#: Who the agent may deal with, as stable labels rather than DIDs, so the
#: allowlist is checkable by someone holding only the grant. sm-dat fails this
#: closed: an action naming no counterparty is VIOLATED, so every receipt must
#: say where it went. Imported by both the minting tool and the scenario.
COUNTERPARTIES = [
    "index:public",
    "index:second",
    "org:regentix",
    "org:astrocity",
    "org:rocketbrain",
    "agent:regentix-ceo",
    "agent:astrocity-chief-scientist",
    "venue:nanda-demo",
]


class AuthorityError(RuntimeError):
    """This agent holds no grant covering what it was asked to do."""


def _load(name: str) -> dict[str, Any]:
    path = _HERE / name
    if not path.is_file():
        raise AuthorityError(
            f"{path} is missing. This agent runs under a delegated grant it cannot "
            "mint for itself; see tools/mint_grant.py."
        )
    return json.loads(path.read_text())


@lru_cache(maxsize=1)
def grant() -> dict[str, Any]:
    """The signed Delegated Authority Token."""
    return _load("grant.json")


@lru_cache(maxsize=1)
def grant_receipt() -> dict[str, Any]:
    """The host's ``authority_granted`` ARP receipt, committing to the DAT."""
    return _load("grant-receipt.json")


def host_did() -> str:
    """The principal. Read from the signed grant, never from a seed this process
    holds — a host key inside the agent is not a host."""
    return str(grant_receipt()["principal_did"])


def grant_receipt_id() -> str:
    """What every working receipt points at as its authority."""
    return str(grant_receipt()["receipt_id"])


def check_grant_covers(agent_did: str) -> None:
    """Refuse to start a run this agent is not authorised to make."""
    dat = grant()
    granted_to = dat.get("grantee_did")
    if granted_to != agent_did:
        raise AuthorityError(
            f"the grant authorises {granted_to}, but this agent is {agent_did}. "
            "Re-mint the grant for this key rather than running unauthorised."
        )
    payload = grant_receipt()["action"].get("machine_payload") or {}
    if payload.get("granted_to_did") != agent_did:
        raise AuthorityError(
            "the host's authority_granted receipt names a different grantee than the "
            "grant it commits to; one of the two artifacts is stale."
        )


def summary() -> dict[str, Any]:
    """What the page shows about the authority behind a run."""
    dat = grant()
    scope = dat.get("scope") or {}
    return {
        "grant_id": dat.get("grant_id"),
        "host": host_did(),
        "agent": dat.get("grantee_did"),
        "human_summary": dat.get("human_summary"),
        "categories": list(scope.get("action_categories") or []),
        "counterparties": list((scope.get("stateless") or {}).get("counterparty_allowlist") or []),
        "not_before": dat.get("not_before"),
        "not_after": dat.get("not_after"),
        "receipt_id": grant_receipt_id(),
        # Said out loud rather than left to be noticed: this grant names no
        # revocation source, so nothing here can be withdrawn before it expires.
        "revocable": bool(dat.get("revocation")),
    }
