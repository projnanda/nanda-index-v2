"""The two dialects, and a refusal staying a number."""

from __future__ import annotations

import json

import httpx

from concierge.transport import (
    NEEDS_CREDENTIAL,
    Answer,
    data_message,
    json_text_message,
    send,
)


def _params(message):
    from a2a.compat.v0_3 import types as a2a

    return a2a.MessageSendParams(message=message).model_dump(by_alias=True, exclude_none=True, mode="json")


def test_the_orrery_dialect_is_a_kind_data_part():
    part = _params(data_message("submit_intent", {"intent_text": "lunch"}))["message"]["parts"][0]
    assert part["kind"] == "data"
    assert part["data"] == {"tool": "submit_intent", "args": {"intent_text": "lunch"}}


def test_the_venue_dialect_is_a_kind_text_part_carrying_json():
    part = _params(json_text_message({"skill": "venue.hold", "resource": "table-4"}))["message"]["parts"][0]
    assert part["kind"] == "text"
    assert json.loads(part["text"]) == {"skill": "venue.hold", "resource": "table-4"}


def _client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_a_result_comes_back_as_a_result():
    def handler(_):
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": "1", "result": {"artifacts": []}})

    answer = send(_client(handler), "https://x.test/", json_text_message({"skill": "s"}))
    assert answer.ok and answer.result == {"artifacts": []}


def test_a_refusal_keeps_its_numeric_code():
    # The reason this module owns the envelope: a2a-sdk's own transport raises an
    # exception with the code flattened into prose, and -32004 and -32002 need
    # different responses.
    def handler(_):
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": "1", "error": {"code": NEEDS_CREDENTIAL, "message": "sign it"}},
        )

    answer = send(_client(handler), "https://x.test/", json_text_message({"skill": "s"}))
    assert not answer.ok
    assert answer.refused and not answer.unreachable
    assert answer.code == NEEDS_CREDENTIAL
    assert answer.detail == "sign it"


def test_an_unreachable_counterparty_is_distinguishable_from_a_refusal():
    def handler(_):
        raise httpx.ConnectError("no route")

    answer = send(_client(handler), "https://x.test/", json_text_message({"skill": "s"}))
    assert answer.unreachable and not answer.refused
    assert answer.code is None


def test_a_non_200_reports_the_status_rather_than_pretending_to_be_json_rpc():
    def handler(_):
        return httpx.Response(401, text="auth_required")

    answer = send(_client(handler), "https://x.test/", json_text_message({"skill": "s"}))
    assert not answer.ok and "HTTP 401" in answer.detail


def test_an_envelope_with_neither_result_nor_error_is_not_a_success():
    def handler(_):
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": "1"})

    assert not send(_client(handler), "https://x.test/", json_text_message({"skill": "s"})).ok


def test_the_summary_records_a_refusal_as_data():
    assert Answer(ok=False, code=-32002, detail="Unknown tool: x").summary() == {
        "ok": False,
        "code": -32002,
        "detail": "Unknown tool: x",
    }
