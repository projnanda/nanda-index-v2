"""Both signing schemes, pinned to the strings the live estate verifies."""

from __future__ import annotations

import base64

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from concierge.signing import (
    SCHEME_V02,
    SCHEME_V03,
    AgentSignature,
    BearerToken,
    canonical_v02,
    canonical_v03,
)


def test_v02_canonical_is_body_agent_timestamp():
    # The counterparty's own agent card documents this string:
    # "Detached Ed25519 signature over '{body}:{agent_id}:{timestamp}'".
    assert canonical_v02(b'{"a":1}', "concierge", "1700000000") == b'{"a":1}:concierge:1700000000'


def test_v03_canonical_binds_method_and_path_and_upper_cases_the_verb():
    assert canonical_v03("post", "/a2a", b"{}", "c", "17", "N") == b"POST:/a2a:{}:c:17:N"


def test_an_unknown_scheme_is_refused_rather_than_defaulted(seed):
    with pytest.raises(ValueError, match="unknown signing scheme"):
        AgentSignature(agent_id="c", private_key=seed, did="d", scheme="ed25519+magic")


def test_a_wrong_length_key_is_refused(seed):
    with pytest.raises(ValueError, match="32 bytes"):
        AgentSignature(agent_id="c", private_key=seed[:16], did="d")


def _sent(auth: httpx.Auth, method: str = "POST", url: str = "https://x.test/a2a", body: bytes = b"{}"):
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        captured["content"] = request.content
        return httpx.Response(200, json={"ok": True})

    with httpx.Client(transport=httpx.MockTransport(handler), auth=auth) as client:
        client.request(method, url, content=body)
    return captured


def test_v02_signs_the_bytes_actually_sent(seed):
    auth = AgentSignature(agent_id="concierge", private_key=seed, did="did:key:zA", scheme=SCHEME_V02)
    sent = _sent(auth, body=b'{"hello":"world"}')

    assert sent["headers"]["x-agent-sig-scheme"] == SCHEME_V02
    assert "x-agent-nonce" not in sent["headers"]

    Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
        base64.b64decode(sent["headers"]["x-agent-signature"]),
        canonical_v02(sent["content"], "concierge", sent["headers"]["x-agent-timestamp"]),
    )


def test_v03_signs_the_method_and_path_of_the_real_request(seed):
    auth = AgentSignature(agent_id="concierge", private_key=seed, did="did:key:zA", scheme=SCHEME_V03)
    sent = _sent(auth, method="POST", url="https://x.test/a2a/@ceo?q=1", body=b'{"x":1}')

    assert sent["headers"]["x-agent-sig-scheme"] == SCHEME_V03
    nonce = sent["headers"]["x-agent-nonce"]
    assert len(base64.b64decode(nonce)) == 32

    # The PATH only — no query. A signature over the query would not verify,
    # because the verifier reconstructs the path from its own routing.
    Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
        base64.b64decode(sent["headers"]["x-agent-signature"]),
        canonical_v03(
            "POST", "/a2a/@ceo", sent["content"], "concierge", sent["headers"]["x-agent-timestamp"], nonce
        ),
    )


def test_two_v03_requests_never_reuse_a_nonce(seed):
    auth = AgentSignature(agent_id="c", private_key=seed, did="d", scheme=SCHEME_V03)
    first = _sent(auth)["headers"]["x-agent-nonce"]
    second = _sent(auth)["headers"]["x-agent-nonce"]
    assert first != second


def test_a_token_carries_no_signature_headers():
    sent = _sent(BearerToken("s3cret"))
    assert sent["headers"]["authorization"] == "Bearer s3cret"
    assert not [h for h in sent["headers"] if h.startswith("x-agent-")]
