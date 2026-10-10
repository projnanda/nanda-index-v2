"""Ed25519 request signing, as an httpx.Auth."""

from __future__ import annotations

import base64
import os
import time
from collections.abc import Generator

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

__all__ = [
    "SCHEME_V02",
    "SCHEME_V03",
    "AgentSignature",
    "BearerToken",
    "canonical_v02",
    "canonical_v03",
]

SCHEME_V02 = "ed25519"
SCHEME_V03 = "ed25519+nonce"

#: 32 bytes, base64'd, per request. The server keeps a bounded replay store keyed
#: on ``(agent_id, nonce)`` with a 600s TTL, so a nonce only has to be unique
#: within that window — but it is drawn from the OS CSPRNG, because a predictable
#: nonce lets somebody else's request be prepared before this one sends it.
_NONCE_BYTES = 32


def canonical_v02(body: bytes, agent_id: str, timestamp: str) -> bytes:
    """``{body}:{agent_id}:{timestamp}``."""
    return b"%s:%s:%s" % (body, agent_id.encode(), timestamp.encode())


def canonical_v03(method: str, url_path: str, body: bytes, agent_id: str, timestamp: str, nonce: str) -> bytes:
    """``{METHOD}:{url_path}:{body}:{agent_id}:{timestamp}:{nonce}``."""
    return b"%s:%s:%s:%s:%s:%s" % (
        method.upper().encode(),
        url_path.encode(),
        body,
        agent_id.encode(),
        timestamp.encode(),
        nonce.encode(),
    )


class AgentSignature(httpx.Auth):
    """Signs every request as this agent, over the bytes actually sent."""

    requires_request_body = True

    def __init__(self, *, agent_id: str, private_key: bytes, did: str, scheme: str = SCHEME_V02) -> None:
        if len(private_key) != 32:
            raise ValueError(
                f"an Ed25519 seed is 32 bytes; got {len(private_key)}. "
                "A key this agent cannot sign with is a key it must not claim to have."
            )
        if scheme not in (SCHEME_V02, SCHEME_V03):
            raise ValueError(
                f"unknown signing scheme {scheme!r}; this estate speaks {SCHEME_V02!r} "
                f"(per-agent services) and {SCHEME_V03!r} (org servers). Naming the wrong one "
                "produces a signature the counterparty will not verify, so there is no default."
            )
        self._agent_id = agent_id
        self._key = Ed25519PrivateKey.from_private_bytes(private_key)
        self._did = did
        self._scheme = scheme

    @property
    def scheme(self) -> str:
        """The scheme this signer emits. Read by receipts, which record it."""
        return self._scheme

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        timestamp = str(int(time.time()))
        headers = {
            "X-Agent-ID": self._agent_id,
            "X-Agent-Timestamp": timestamp,
            "X-Agent-DID-Key": self._did,
            # Named explicitly rather than left to the verifier to guess: an
            # earlier version of the estate's client inferred the scheme from key
            # length, and a 32-byte Ed25519 seed is the same 44 base64 characters
            # as an HMAC key, so it silently picked HMAC for genuine Ed25519
            # credentials.
            "X-Agent-Sig-Scheme": self._scheme,
        }

        if self._scheme == SCHEME_V03:
            nonce = base64.b64encode(os.urandom(_NONCE_BYTES)).decode()
            message = canonical_v03(
                request.method, request.url.path, request.content, self._agent_id, timestamp, nonce
            )
            headers["X-Agent-Nonce"] = nonce
        else:
            message = canonical_v02(request.content, self._agent_id, timestamp)

        headers["X-Agent-Signature"] = base64.b64encode(self._key.sign(message)).decode()
        request.headers.update(headers)
        yield request


class BearerToken(httpx.Auth):
    """A shared secret. Authorisation without identity, and it says so."""

    def __init__(self, token: str) -> None:
        self._token = token

    def auth_flow(self, request: httpx.Request) -> Generator[httpx.Request, httpx.Response, None]:
        request.headers["Authorization"] = f"Bearer {self._token}"
        yield request
