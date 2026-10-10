"""Send one A2A message/send request and normalise the answer."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from a2a.compat.v0_3 import types as a2a

__all__ = [
    "NEEDS_CREDENTIAL",
    "Answer",
    "data_message",
    "json_text_message",
    "send",
]

#: The estate's code for "you must authenticate", on both the venue and the
#: Orrery agent services. Named because a bare -32004 at a call site is a number
#: somebody has to look up, and looking it up is where it gets confused with
#: -32002.
NEEDS_CREDENTIAL = -32004


@dataclass(frozen=True)
class Answer:
    """What came back: a result, or a refusal, or a transport failure."""

    ok: bool
    result: dict[str, Any] | None = None
    code: int | None = None
    detail: str = ""

    @property
    def refused(self) -> bool:
        """The counterparty answered, and its answer was no."""
        return not self.ok and self.code is not None

    @property
    def unreachable(self) -> bool:
        """No answer at all — the counterparty never spoke."""
        return not self.ok and self.code is None

    def summary(self) -> dict[str, Any]:
        """The form a receipt records."""
        if self.ok:
            return {"ok": True, "result": self.result}
        return {"ok": False, "code": self.code, "detail": self.detail[:500]}


def data_message(tool: str, args: dict[str, Any]) -> a2a.Message:
    """The Orrery agent dialect: a ``DataPart`` naming a tool and its arguments."""
    return a2a.Message(
        messageId=uuid.uuid4().hex,
        role=a2a.Role.user,
        parts=[a2a.Part(root=a2a.DataPart(data={"tool": tool, "args": args}))],
    )


def json_text_message(intent: dict[str, Any]) -> a2a.Message:
    """The venue dialect: a ``TextPart`` whose text is a JSON object."""
    return a2a.Message(
        messageId=uuid.uuid4().hex,
        role=a2a.Role.user,
        parts=[a2a.Part(root=a2a.TextPart(text=json.dumps(intent, separators=(",", ":"))))],
    )


def send(
    client: httpx.Client,
    url: str,
    message: a2a.Message,
    *,
    timeout: float = 90.0,
) -> Answer:
    """One ``message/send``, with every failure mode returned rather than raised."""
    params = a2a.MessageSendParams(message=message)
    payload = {
        "jsonrpc": "2.0",
        "id": uuid.uuid4().hex[:12],
        "method": "message/send",
        "params": params.model_dump(by_alias=True, exclude_none=True, mode="json"),
    }
    body = json.dumps(payload).encode()

    try:
        response = client.post(url, content=body, headers={"Content-Type": "application/json"}, timeout=timeout)
    except httpx.HTTPError as exc:
        return Answer(ok=False, detail=f"{type(exc).__name__}: {exc}")

    # A non-200 is not a JSON-RPC answer at all. Reported with the status, because
    # a 401 from a layer above the protocol and a -32004 inside it mean the same
    # thing to a human and different things to a client.
    if response.status_code != 200:
        return Answer(ok=False, detail=f"HTTP {response.status_code}: {response.text[:400]}")

    try:
        envelope = response.json()
    except ValueError as exc:
        return Answer(ok=False, detail=f"answer was not JSON: {exc}")

    error = envelope.get("error")
    if isinstance(error, dict):
        return Answer(ok=False, code=error.get("code"), detail=str(error.get("message", "")))

    result = envelope.get("result")
    if not isinstance(result, dict):
        return Answer(ok=False, detail=f"no result and no error in the envelope: {str(envelope)[:300]}")
    return Answer(ok=True, result=result)
