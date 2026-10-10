"""Call another organisation's agent over A2A."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from .signing import SCHEME_V02, AgentSignature
from .transport import Answer, data_message, send

__all__ = ["DETERMINISTIC_TOOLS", "Peer", "llm_exhausted", "tool_result"]

#: Tools measured to answer without consulting a model. The scenario is built
#: only from these, because a peer's model budget is not this agent's to spend
#: and a step that needs one is a step that fails on somebody else's schedule.
DETERMINISTIC_TOOLS = frozenset(
    {
        "start_conversation",
        "send_to_peer",
        "submit_intent",
        "respond_to_intent",
        "save_note",
        "find_peer",
        "list_conversations",
        "my_trust",
        "list_installed_skills",
    }
)


def tool_result(answer: Answer) -> dict[str, Any] | None:
    """The tool's own output, out of the A2A task that carried it."""
    if not answer.ok or not answer.result:
        return None
    for artifact in answer.result.get("artifacts") or []:
        for part in artifact.get("parts") or []:
            data = part.get("data")
            if isinstance(data, dict) and "result" in data:
                raw = data["result"]
                if not isinstance(raw, str):
                    return raw if isinstance(raw, dict) else {"value": raw}
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    return {"text": raw}
                return parsed if isinstance(parsed, dict) else {"value": parsed}
    return None


def llm_exhausted(payload: dict[str, Any] | None) -> bool:
    """Whether a successful call in fact carried a spent model budget."""
    if not payload:
        return False
    text = payload.get("response")
    return isinstance(text, str) and text.startswith("LLM error")


@dataclass
class Peer:
    """One Orrery agent service, reachable at its root as an attributable stranger."""

    label: str
    url: str
    _client: httpx.Client | None = None

    def open(self, *, agent_id: str, private_key: bytes, did: str) -> Peer:
        """Bind this agent's identity to the connection."""
        self._client = httpx.Client(
            auth=AgentSignature(agent_id=agent_id, private_key=private_key, did=did, scheme=SCHEME_V02),
            follow_redirects=False,
        )
        return self

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def __enter__(self) -> Peer:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def invoke(self, tool: str, args: dict[str, Any], *, timeout: float = 90.0) -> tuple[Answer, dict | None]:
        """Invoke ``tool`` on this peer. Returns the envelope answer and the payload."""
        if self._client is None:
            raise RuntimeError(
                f"peer {self.label!r} has no open connection — call open() first. "
                "Refusing to send unsigned: an unsigned request is refused anyway, "
                "and refusing here says why."
            )
        answer = send(self._client, self.url.rstrip("/") + "/", data_message(tool, args), timeout=timeout)
        return answer, tool_result(answer)
