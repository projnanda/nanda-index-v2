"""ARP receipts, hash-chained."""

from __future__ import annotations

import contextlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sm_arp import (
    Identity,
    build_action,
    chain_link,
    issue_receipt,
    verify_receipt,
)
from sm_arp import (
    canonical_bytes as arp_canonical_bytes,
)

__all__ = [
    "CATEGORIES",
    "OUTCOME_FAILED",
    "OUTCOME_OK",
    "SUMMARY_MAX",
    "Receipt",
    "ReceiptChain",
    "canonical_bytes",
    "category_for",
    "chain_link",
    "outcome_for",
    "verify",
]

#: ARP caps a human_summary at tweet length. Composed within it rather than
#: discovered at signing time, which is what the venue does and for the same
#: reason: a live run is a bad place to meet a schema boundary.
SUMMARY_MAX = 280

OUTCOME_OK = "completed"
OUTCOME_FAILED = "failed"
#: Used only when the prose matches no rule below. Deliberately not ``completed``:
#: an outcome nobody classified must never read as success, which is the defect
#: this estate keeps producing in other forms. A test asserts a real run never
#: reaches it.
OUTCOME_UNCLASSIFIED = "partial"

#: This scenario's steps, mapped to ARP's fixed category vocabulary.
#: ``venue.book`` is ``appointment_booked`` to match what the venue issues for
#: the same event, so the two receipts pair. Discovery has no ARP category and
#: gets ``other``; the precise step stays in ``machine_payload.step``.
CATEGORIES: dict[str, str] = {
    "discover.organisation": "other",
    "discover.catalog": "other",
    "discover.agent": "other",
    "ask.intent": "message_sent",
    "ask.note": "record_filed",
    "venue.availability": "other",
    # A hold is a commitment that is not yet a booking, and ARP has a word for
    # exactly that. Calling it appointment_booked would claim the table twice.
    "venue.hold.multiparty": "commitment_entered",
    "venue.consent.as_guest": "other",
    "venue.book": "appointment_booked",
    "venue.receipt": "attestation_received",
}

#: Phrases this scenario uses when something did not happen. Matched against the
#: recorded prose, lowercased. Kept here rather than inferred from a flag because
#: the prose is what a reader sees, and the two must not be able to disagree.
_FAILED_MARKERS = (
    "could not",
    "refused",
    "unreachable",
    "failed",
    "no reply",
    "did not",
    "nothing open",
    "taken",
    "run out of thinking time",
)


def canonical_bytes(payload: dict[str, Any], *, include_signature: bool = True) -> bytes:
    """ARP's canonicalisation (RFC 8785), re-exported."""
    return arp_canonical_bytes(payload, include_signature=include_signature)


def category_for(step: str) -> str:
    """The ARP category for a scenario step."""
    return CATEGORIES.get(step, "other")


def outcome_for(prose: str) -> str:
    """ARP's five-value outcome, derived from the sentence actually recorded."""
    text = (prose or "").lower()
    if any(marker in text for marker in _FAILED_MARKERS):
        return OUTCOME_FAILED
    if text.strip():
        return OUTCOME_OK
    return OUTCOME_UNCLASSIFIED


def _summary(text: str) -> str:
    return text if len(text) <= SUMMARY_MAX else text[: SUMMARY_MAX - 1] + "…"


@dataclass(frozen=True)
class Receipt:
    """One ARP receipt, with the scenario's own names kept readable."""

    arp: dict[str, Any] = field(default_factory=dict)
    seq: int = 0

    @property
    def _payload(self) -> dict[str, Any]:
        return (self.arp.get("action") or {}).get("machine_payload") or {}

    @property
    def step(self) -> str:
        return str(self._payload.get("action_type_label", ""))

    @property
    def at(self) -> str:
        return str(self.arp.get("issued_at", ""))

    @property
    def human_summary(self) -> str:
        return str((self.arp.get("action") or {}).get("human_summary", ""))

    @property
    def outcome(self) -> str:
        """The recorded sentence, not ARP's enum."""
        return str(self._payload.get("outcome_prose", ""))

    @property
    def arp_outcome(self) -> str:
        return str((self.arp.get("action") or {}).get("outcome", ""))

    @property
    def not_claimed(self) -> tuple[str, ...]:
        return tuple(self._payload.get("not_claimed") or ())

    @property
    def request(self) -> dict[str, Any]:
        return self._payload.get("request") or {}

    @property
    def answer(self) -> dict[str, Any]:
        return self._payload.get("answer") or {}

    @property
    def issuer(self) -> str:
        return str(self.arp.get("issuer_did", ""))

    @property
    def principal(self) -> str:
        return str(self.arp.get("principal_did", ""))

    @property
    def prev(self) -> str:
        return str(self.arp.get("previous_receipt_hash", "") or "")

    @property
    def digest(self) -> str:
        """This receipt's ``chain_link`` — what the next entry commits to."""
        return chain_link(self.arp)

    @property
    def signature(self) -> str:
        return str(self.arp.get("signature", ""))

    def to_dict(self) -> dict[str, Any]:
        """The ARP receipt itself. What gets written out and shown."""
        return dict(self.arp)


class ReceiptChain:
    """Append-only, hash-linked ARP receipts signed by one key."""

    def __init__(
        self,
        *,
        private_key: bytes,
        principal_did: str,
        granted_by: str | None = None,
        on_append: Callable[[Receipt], None] | None = None,
        summarise: Callable[[str, str], str] | None = None,
    ) -> None:
        if len(private_key) != 32:
            raise ValueError(
                f"an Ed25519 seed is 32 bytes; got {len(private_key)}. A chain this agent "
                "cannot sign is a chain nobody can attribute to it."
            )
        # The issuer DID is derived from the key rather than passed alongside it.
        # Two places to state one identity is two places for them to disagree,
        # and a receipt whose issuer_did is not the key that signed it verifies
        # in-process and fails the moment anybody else checks it.
        self._identity = Identity.from_seed(private_key)
        self._principal = principal_did
        # Every receipt points at the host's authority_granted receipt. Absent, ARP
        # reads the action as *standing* authority — an explicit claim, not a
        # default — so a step that forgot it would quietly assert more than a
        # step that has it.
        self._granted_by = granted_by
        self._entries: list[Receipt] = []
        self._summarise = summarise
        self._on_append = on_append

    @property
    def issuer(self) -> str:
        return self._identity.did

    @property
    def principal(self) -> str:
        return self._principal

    @property
    def entries(self) -> tuple[Receipt, ...]:
        return tuple(self._entries)

    @property
    def tip(self) -> str | None:
        """What the next entry commits to, or ``None`` at the start of a chain."""
        return self._entries[-1].digest if self._entries else None

    def append(
        self,
        *,
        step: str,
        request: dict[str, Any],
        answer: dict[str, Any],
        outcome: str,
        counterparty_label: str,
        not_claimed: tuple[str, ...] = (),
        counterparty_did: str | None = None,
    ) -> Receipt:
        """Record one step. ``outcome`` is free text including refusals."""
        summary = self._summarise(step, outcome) if self._summarise else outcome
        action = build_action(
            category=category_for(step),
            human_summary=_summary(summary),
            outcome=outcome_for(outcome),
            counterparty_did=counterparty_did,
            counterparty_label=counterparty_label,
            granted_by_receipt_id=self._granted_by,
            machine_payload={
                # The spec's own name for "what this really was". REQUIRED when
                # the category is `other`, and set always so the scenario's step
                # lives under a spec'd key rather than one this repo invented.
                # sm_arp.verify_receipt does not enforce it; `arp verify` does —
                # so omitting it passes in-process and fails the published tool.
                "action_type_label": step,
                "seq": len(self._entries),
                # The sentence as written. ARP's outcome is five values; this is
                # the one a person reads, and it is signed with the rest.
                "outcome_prose": outcome,
                "request": request,
                "answer": answer,
                "not_claimed": list(not_claimed),
            },
        )
        receipt = issue_receipt(
            self._identity,
            principal_did=self._principal,
            action=action,
            previous_receipt_hash=self.tip,
        )
        entry = Receipt(arp=receipt, seq=len(self._entries))
        self._entries.append(entry)
        if self._on_append is not None:
            # A browser that disconnected mid-run, a slow queue, a bug in a view:
            # none of those are reasons to abandon a booking already in progress
            # with a real counterparty. The watcher is told, not obeyed.
            with contextlib.suppress(Exception):
                self._on_append(entry)
        return entry

    def to_json(self) -> str:
        return json.dumps({"entries": [e.to_dict() for e in self._entries]}, indent=2, ensure_ascii=False)


def verify(entries: list[dict[str, Any]], *, public_key_b64: str | None = None) -> tuple[bool, str]:
    """Check every receipt and the links between them, with ARP's own verifier."""
    prior: dict[str, Any] | None = None
    for index, raw in enumerate(entries):
        result = verify_receipt(raw, prior=prior, mode="strict", check_chain=True)
        if not result.ok:
            return False, f"entry {index}: {result.stage}: {result.detail}"
        prior = raw
    return True, f"{len(entries)} receipts verify, and each links to the one before it"
