"""Negotiate and book with the restaurant over A2A."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from .folds import slot_ref
from .signing import SCHEME_V02, AgentSignature, BearerToken
from .transport import NEEDS_CREDENTIAL, Answer, json_text_message, send

__all__ = ["NOT_IN_INDEX", "Venue", "VenueClaim"]

#: The venue's words when a signature verifies but no index record resolves.
#: Matched as a substring because the venue's message is prose and its exact
#: wording is not a contract — but the distinction it draws is: this is the one
#: refusal a *different credential* fixes, and every other -32004 it is not.
NOT_IN_INDEX = "no index record resolves"


@dataclass(frozen=True)
class VenueClaim:
    """What the venue said, folded the way the venue folds it."""

    resource: str
    start: str
    hold_id: str | None
    slot: str
    detail: dict[str, Any]


class Venue:
    """One venue, reached over A2A, with exactly one credential attached."""

    def __init__(self, url: str, *, client: httpx.Client, credential: str) -> None:
        self.url = url.rstrip("/") + "/"
        self._client = client
        #: ``identified`` or ``token``. Recorded on every receipt, because the two
        #: attest different things and a reader cannot tell them apart afterwards.
        self.credential = credential

    @classmethod
    def identified(cls, url: str, *, agent_id: str, private_key: bytes, did: str) -> Venue:
        """Signed as this agent. Requires a live index record for this key."""
        return cls(
            url,
            client=httpx.Client(
                auth=AgentSignature(agent_id=agent_id, private_key=private_key, did=did, scheme=SCHEME_V02)
            ),
            credential="identified",
        )

    @classmethod
    def with_token(cls, url: str, token: str) -> Venue:
        """A shared secret. Authorisation without identity, and the receipt says so."""
        return cls(url, client=httpx.Client(auth=BearerToken(token)), credential="token")

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Venue:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _call(self, skill: str, params: dict[str, Any]) -> Answer:
        return send(self._client, self.url, json_text_message({"skill": skill, **params}))

    # ── the four skills ─────────────────────────────────────────────────────

    def availability(self, resource: str, starts: list[str]) -> Answer:
        """Which of ``starts`` are open. No credential required, and none is claimed."""
        return self._call("venue.availability", {"resource": resource, "start": starts})

    def hold(
        self,
        *,
        resource: str,
        start: str,
        party: str,
        principals: list[str],
        covers: int = 1,
        ttl_seconds: float = 900.0,
    ) -> tuple[Answer, VenueClaim | None]:
        """Claim one slot provisionally, naming everyone whose consent it needs."""
        answer = self._call(
            "venue.hold",
            {
                "resource": resource,
                "start": start,
                "party": party,
                "principals": principals,
                "covers": covers,
                "ttl_seconds": ttl_seconds,
            },
        )
        return answer, self._claim(answer, resource, start)

    def consent(self, *, hold_id: str, principal: str, grant: dict[str, Any] | None = None) -> Answer:
        """One principal agreeing."""
        body: dict[str, Any] = {"hold_id": hold_id, "principal": principal}
        if grant is not None:
            body["grant"] = grant
        return self._call("venue.consent", body)

    def cancel(self, *, hold_id: str, by: str) -> Answer:
        """Release a hold."""
        return self._call("venue.cancel", {"hold_id": hold_id, "by": by})

    # ── reading the answer ──────────────────────────────────────────────────

    def _claim(self, answer: Answer, resource: str, start: str) -> VenueClaim | None:
        payload = self.payload(answer)
        if payload is None:
            return None
        return VenueClaim(
            resource=resource,
            start=start,
            hold_id=payload.get("hold_id") or payload.get("id"),
            slot=slot_ref(resource, start),
            detail=payload,
        )

    @staticmethod
    def payload(answer: Answer) -> dict[str, Any] | None:
        """The venue's JSON answer, out of the text artifact it travels in."""
        if not answer.ok or not answer.result:
            return None
        import json

        for artifact in answer.result.get("artifacts") or []:
            for part in artifact.get("parts") or []:
                text = part.get("text")
                if isinstance(text, str):
                    try:
                        parsed = json.loads(text)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(parsed, dict):
                        return parsed
        return None

    @staticmethod
    def needs_identity(answer: Answer) -> bool:
        """Whether the refusal was specifically "this key is in no index"."""
        return answer.code == NEEDS_CREDENTIAL and NOT_IN_INDEX in (answer.detail or "")


def fetch_receipt(venue_url: str, receipt_id: str, *, timeout: float = 25.0) -> dict[str, Any] | None:
    """The venue's own signed receipt for a booking, from its public log."""
    import json
    import urllib.request

    request = urllib.request.Request(
        venue_url.rstrip("/") + "/receipts", headers={"Accept": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read(2_000_000).decode())
    entries = payload.get("receipts") if isinstance(payload, dict) else payload
    for entry in entries or []:
        if isinstance(entry, dict) and entry.get("receipt_id") == receipt_id:
            return entry
    return None
