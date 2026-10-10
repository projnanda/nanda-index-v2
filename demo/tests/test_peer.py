"""Reading an Orrery agent's answer, including the answers that look like successes."""

from __future__ import annotations

import pytest

from concierge.peer import DETERMINISTIC_TOOLS, Peer, llm_exhausted, tool_result
from concierge.transport import Answer


def _task(result_value):
    return Answer(ok=True, result={"artifacts": [{"parts": [{"data": {"tool": "t", "result": result_value}}]}]})


def test_a_json_string_result_is_decoded():
    # Orrery returns the tool's output as a JSON *string*, not an object.
    assert tool_result(_task('{"intent_id":"abc","status":"matching"}')) == {
        "intent_id": "abc",
        "status": "matching",
    }


def test_a_prose_result_is_kept_rather_than_dropped():
    # An agent that answers in prose has answered; discarding it would make a
    # reply indistinguishable from silence.
    assert tool_result(_task("could not parse that")) == {"text": "could not parse that"}


def test_a_refusal_has_no_tool_result():
    assert tool_result(Answer(ok=False, code=-32002, detail="Unknown tool")) is None


def test_an_artifactless_task_has_no_tool_result():
    assert tool_result(Answer(ok=True, result={"artifacts": []})) is None


def test_a_spent_model_budget_inside_a_successful_call_is_recognised():
    # Measured on every live agent: a perfectly successful JSON-RPC result whose
    # payload says the cycle's LLM budget is gone. Treating this as an answer
    # would record "the peer said: LLM error" as a fact about lunch.
    payload = tool_result(_task('{"response":"LLM error: this cycle has made 60 LLM calls, its limit"}'))
    assert llm_exhausted(payload)


def test_a_real_answer_is_not_mistaken_for_a_spent_budget():
    assert not llm_exhausted({"response": "Thursday at 12:30 suits."})
    assert not llm_exhausted({"saved": True})
    assert not llm_exhausted(None)


def test_the_scenarios_tools_are_all_deterministic():
    # The scenario may only use tools that never consult a model, because a
    # peer's budget is not this agent's to spend.
    for tool in ("submit_intent", "save_note", "respond_to_intent", "start_conversation"):
        assert tool in DETERMINISTIC_TOOLS
    # search_chapter is LLM-mediated and must NOT be in the set.
    assert "search_chapter" not in DETERMINISTIC_TOOLS


def test_an_unopened_peer_refuses_rather_than_sending_unsigned():
    with pytest.raises(RuntimeError, match="no open connection"):
        Peer(label="ceo", url="https://x.test").invoke("save_note", {})


def test_an_opened_peer_signs_with_v02_and_reaches_the_root(seed):
    import json

    import httpx

    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": "1",
                "result": {
                    "artifacts": [{"parts": [{"data": {"tool": "save_note", "result": '{"saved":true}'}}]}]
                },
            },
        )

    peer = Peer(label="ceo", url="https://ceo.test").open(
        agent_id="concierge", private_key=seed, did="did:key:zA"
    )
    peer._client = httpx.Client(transport=httpx.MockTransport(handler), auth=peer._client.auth)
    with peer:
        answer, payload = peer.invoke("save_note", {"text": "hello"})

    assert answer.ok and payload == {"saved": True}
    # The per-agent services verify v0.2; a v0.3 signature is refused there.
    assert seen["headers"]["x-agent-sig-scheme"] == "ed25519"
    assert "x-agent-nonce" not in seen["headers"]
    # Root, not /a2a — on an agent service /a2a is the operator's endpoint.
    assert seen["url"] == "https://ceo.test/"
    assert seen["body"]["params"]["message"]["parts"][0]["data"]["tool"] == "save_note"


def test_closing_a_peer_twice_is_harmless():
    peer = Peer(label="ceo", url="https://ceo.test").open(
        agent_id="c", private_key=bytes(range(32)), did="did:key:zA"
    )
    peer.close()
    peer.close()
