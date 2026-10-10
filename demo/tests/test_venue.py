"""Telling one -32004 from another, and folding the slot the venue's way."""

from __future__ import annotations

import json

import httpx

from concierge.folds import slot_ref
from concierge.transport import NEEDS_CREDENTIAL, Answer
from concierge.venue import Venue


def _text_task(payload: dict) -> Answer:
    return Answer(ok=True, result={"artifacts": [{"parts": [{"kind": "text", "text": json.dumps(payload)}]}]})


def test_the_venues_payload_is_decoded_from_its_text_artifact():
    assert Venue.payload(_text_task({"open": ["12:00"]})) == {"open": ["12:00"]}


def test_a_non_json_text_artifact_does_not_masquerade_as_a_payload():
    answer = Answer(ok=True, result={"artifacts": [{"parts": [{"kind": "text", "text": "hello"}]}]})
    assert Venue.payload(answer) is None


def test_not_registered_is_distinguished_from_every_other_missing_credential():
    # Only one of these is fixed by registering; the other is fixed by signing.
    # An agent that cannot tell them apart retries the wrong remedy.
    not_in_index = Answer(
        ok=False,
        code=NEEDS_CREDENTIAL,
        detail=(
            "signature verifies, but no index record resolves for this key "
            "— possession of a key is not authorisation"
        ),
    )
    wrong_party = Answer(
        ok=False, code=NEEDS_CREDENTIAL, detail="authenticated as did:key:zA, cannot act as did:key:zB"
    )
    assert Venue.needs_identity(not_in_index)
    assert not Venue.needs_identity(wrong_party)
    assert not Venue.needs_identity(Answer(ok=False, code=-32602, detail="no index record resolves"))


def test_a_hold_is_folded_with_the_same_function_the_receipts_use():
    def handler(_):
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": "1",
                "result": {
                    "artifacts": [{"parts": [{"kind": "text", "text": json.dumps({"hold_id": "hold-1"})}]}]
                },
            },
        )

    venue = Venue(
        "https://v.test", client=httpx.Client(transport=httpx.MockTransport(handler)), credential="token"
    )
    _, claim = venue.hold(resource="table-4", start="2026-10-02T12:30:00Z", party="p", principals=["p"])
    assert claim is not None
    assert claim.hold_id == "hold-1"
    assert claim.slot == slot_ref("table-4", "2026-10-02T12:30:00Z")


def test_the_credential_used_is_recorded_and_the_two_are_separate_constructors():
    signed = Venue.identified("https://v.test", agent_id="c", private_key=bytes(range(32)), did="did:key:zA")
    tokened = Venue.with_token("https://v.test", "s3cret")
    assert signed.credential == "identified"
    assert tokened.credential == "token"
    signed.close()
    tokened.close()


def test_availability_asks_without_claiming_a_credential():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": "1", "result": {"artifacts": []}})

    venue = Venue(
        "https://v.test", client=httpx.Client(transport=httpx.MockTransport(handler)), credential="token"
    )
    venue.availability("table-4", ["12:00"])
    intent = json.loads(seen["body"]["params"]["message"]["parts"][0]["text"])
    assert intent == {"skill": "venue.availability", "resource": "table-4", "start": ["12:00"]}


# ── the counterparty's own signed record ────────────────────────────────────


class _Resp:
    def __init__(self, payload):
        self._b = json.dumps(payload).encode()

    def read(self, _n=None):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _log(*receipts):
    return _Resp({"receipts": list(receipts)})


def test_the_receipt_the_booking_named_is_fetched_not_assumed(monkeypatch):
    """A run that reports an id and never fetches what it names has produced a
    reference, not evidence."""
    import urllib.request

    from concierge import venue as mod

    wanted = {"receipt_id": "r-2", "action": {"human_summary": "Confirmed table-7"}}
    seen = {}

    def fake(request, timeout=None):
        seen["url"] = request.full_url
        seen["headers"] = dict(getattr(request, "headers", {}))
        return _log({"receipt_id": "r-1"}, wanted)

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    assert mod.fetch_receipt("https://v.test", "r-2") == wanted
    assert seen["url"] == "https://v.test/receipts"


def test_the_log_is_read_with_no_credential(monkeypatch):
    """Read the way a third party auditing this booking would. Fetching it over a
    privileged route would prove something only the booking party can see."""
    import urllib.request

    from concierge import venue as mod

    seen = {}

    def fake(request, timeout=None):
        seen["headers"] = {k.lower(): v for k, v in dict(request.headers).items()}
        return _log({"receipt_id": "r-1"})

    monkeypatch.setattr(urllib.request, "urlopen", fake)
    mod.fetch_receipt("https://v.test", "r-1")
    assert not [h for h in seen["headers"] if h.startswith("x-agent-")]
    assert "authorization" not in seen["headers"]


def test_a_receipt_the_log_does_not_carry_is_a_finding_not_an_error(monkeypatch):
    import urllib.request

    from concierge import venue as mod

    monkeypatch.setattr(urllib.request, "urlopen", lambda *_a, **_k: _log({"receipt_id": "other"}))
    # The venue said it issued one. Its absence is worth reporting, not raising.
    assert mod.fetch_receipt("https://v.test", "r-missing") is None


def test_an_empty_log_does_not_crash_the_lookup(monkeypatch):
    import urllib.request

    from concierge import venue as mod

    monkeypatch.setattr(urllib.request, "urlopen", lambda *_a, **_k: _Resp({}))
    assert mod.fetch_receipt("https://v.test", "r-1") is None
