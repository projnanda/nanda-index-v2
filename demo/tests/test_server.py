"""What answers at the address this agent registered."""

from __future__ import annotations

import json
import threading

import pytest
from starlette.testclient import TestClient

from concierge import server as server_mod
from concierge.card import SKILL_ID
from concierge.identity import Identity, did_of, subject_key_of
from concierge.server import build_app


@pytest.fixture
def client(seed, monkeypatch):
    me = Identity(agent_id="concierge", seed=seed, did=did_of(seed), subject_key=subject_key_of(seed))
    monkeypatch.setattr(server_mod.config, "service_url", lambda: "https://concierge.test/")
    monkeypatch.setattr(
        server_mod.config, "card_url", lambda: "https://concierge.test/.well-known/agent-card.json"
    )
    return TestClient(build_app(me)), me


def _rpc(client, intent, rpc_id="1"):
    return client.post(
        "/",
        json={
            "jsonrpc": "2.0",
            "id": rpc_id,
            "method": "message/send",
            "params": {
                "message": {
                    "kind": "message",
                    "messageId": "m",
                    "role": "user",
                    "parts": [{"kind": "text", "text": json.dumps(intent)}],
                }
            },
        },
    )


def test_the_registered_pointer_resolves_to_a_real_card(client):
    c, me = client
    response = c.get("/.well-known/agent-card.json")
    assert response.status_code == 200
    card = response.json()
    # The defect this exists to avoid: a card promising A2A at a url that 404s.
    assert card["url"] == "https://concierge.test/"
    assert [s["id"] for s in card["skills"]] == [SKILL_ID]
    assert card["x-nanda"]["didKey"] == me.did
    assert card["x-nanda"]["indexUrn"] == me.urn


def test_the_card_declares_the_transport_it_actually_serves(client):
    c, _ = client
    assert c.get("/.well-known/agent-card.json").json()["preferredTransport"] == "JSONRPC"
    # And that transport answers.
    assert _rpc(c, {"skill": "concierge.last_run"}).json()["result"]["status"]["state"] == "completed"


def test_a_run_that_has_not_happened_says_so_rather_than_inventing_one(client):
    c, _ = client
    body = _rpc(c, {"skill": "concierge.last_run"}).json()
    payload = json.loads(body["result"]["artifacts"][0]["parts"][0]["text"])
    assert payload["entries"] == [] and payload["note"] == "no run yet"


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({"jsonrpc": "1.0", "id": 1, "method": "message/send"}, -32600),
        ({"jsonrpc": "2.0", "id": 1, "method": "tasks/send"}, -32601),
        ({"jsonrpc": "2.0", "id": 1, "method": "message/send", "params": {}}, -32602),
    ],
)
def test_a_malformed_request_is_an_error_object_not_an_http_failure(client, payload, code):
    c, _ = client
    response = c.post("/", json=payload)
    # Always 200 with the error inside: a transport-level failure tells a client
    # nothing about which of its request, its credential or this agent was wrong.
    assert response.status_code == 200
    assert response.json()["error"]["code"] == code


def test_a_text_part_that_is_not_json_is_named_as_such(client):
    c, _ = client
    response = c.post(
        "/",
        json={
            "jsonrpc": "2.0",
            "id": "1",
            "method": "message/send",
            "params": {"message": {"parts": [{"kind": "text", "text": "not json"}]}},
        },
    )
    assert response.json()["error"]["code"] == -32602
    assert "not JSON" in response.json()["error"]["message"]


def test_an_unknown_skill_lists_the_ones_that_exist(client):
    c, _ = client
    message = _rpc(c, {"skill": "concierge.teleport"}).json()["error"]["message"]
    assert "concierge.arrange_meal" in message and "concierge.last_run" in message


def test_a_run_in_progress_is_refused_rather_than_racing_for_the_same_slot(client, monkeypatch):
    c, _ = client
    # Two concurrent runs would race for one venue slot and one would get a
    # refusal caused by the other — a confusing thing to put in a receipt. Tested
    # against the real lock by holding a run open, rather than by patching the
    # lock away: patching it would assert that this test can patch.
    started, release = threading.Event(), threading.Event()

    def slow(*_a, **_k):
        started.set()
        release.wait(timeout=5)
        raise RuntimeError("released")

    monkeypatch.setattr(server_mod, "arrange", slow)
    first = threading.Thread(target=lambda: _rpc(c, {"skill": "concierge.arrange_meal"}, "first"))
    first.start()
    try:
        assert started.wait(timeout=5), "the first run never entered arrange()"
        body = _rpc(c, {"skill": "concierge.arrange_meal"}, "second").json()
        assert body["error"]["code"] == -32603
        assert "already in progress" in body["error"]["message"]
        # And the read-only skill still answers while a run holds the lock.
        assert _rpc(c, {"skill": "concierge.last_run"}, "third").json()["result"]
    finally:
        release.set()
        first.join(timeout=5)


def test_a_failing_run_is_reported_in_the_envelope_not_as_a_500(client, monkeypatch):
    c, _ = client

    def boom(*_a, **_k):
        raise RuntimeError("the estate is down")

    monkeypatch.setattr(server_mod, "arrange", boom)
    response = _rpc(c, {"skill": "concierge.arrange_meal"})
    assert response.status_code == 200
    assert "the estate is down" in response.json()["error"]["message"]


def test_healthz_reports_identity_without_needing_a_run(client):
    c, me = client
    body = c.get("/healthz").json()
    assert body["ok"] and body["did"] == me.did and body["last_run_steps"] == 0


# ── the demo page ───────────────────────────────────────────────────────────


def test_the_page_is_served_at_ui_and_not_at_the_root(client):
    c, _ = client
    assert c.get("/ui").status_code == 200
    assert c.get("/ui/").status_code == 200
    # `POST /` is the A2A endpoint the card advertises. Mounting a page at the
    # root is how that gets quietly broken by something that looks unrelated.
    assert "text/html" in c.get("/ui").headers["content-type"]


def test_the_page_ships_inside_the_package(client):
    """Guards the packaging, not the markup.

    The HTML is data, so setuptools will not include it without explicit
    package-data. Installed without it, /ui fails in the container and nothing at
    build time says so.
    """
    from pathlib import Path

    import concierge

    assert (Path(concierge.__file__).parent / "ui" / "index.html").is_file()


def test_the_replay_says_no_run_rather_than_inventing_one(client):
    c, _ = client
    body = c.get("/ui/last").json()
    assert body["steps"] == [] and body["summary"] is None
    assert body["note"] == "no run yet"


def test_the_replay_carries_captions_alongside_the_signed_entry(client, monkeypatch):
    """The two tabs read one payload, so they cannot disagree about a step."""
    c, me = client
    from concierge.narration import CAPTIONS

    entry = _real_entries(me.seed, [("venue.book", "booked", ("that anyone will arrive",))])[0]
    monkeypatch.setattr(server_mod, "arrange", lambda *a, **k: _FakePlan([entry]))
    _rpc(c, {"skill": "concierge.arrange_meal"})

    step = c.get("/ui/last").json()["steps"][0]
    heading, plain, _ = CAPTIONS["venue.book"]
    assert step["heading"] == heading
    assert step["plain"] == plain
    # The signed entry travels with the caption rather than being fetched again.
    assert step["digest"].startswith("sha256:")
    assert step["not_claimed"] == ["that anyone will arrive"]


HOST = "did:key:z6MktMyEoA64WSk5WuaxZvKyobsaHhL3rJQS8uxkV3ixvHqQ"


def _real_entries(seed, steps):
    """Real ARP receipts, not hand-written dicts.

    The previous version of this file built entries by hand in the shape the
    server happened to read. When the envelope changed to ARP the fakes kept the
    old shape, so the tests passed against a payload the real code could no
    longer produce. Signing them for real means the shape cannot drift from what
    ships.
    """
    from concierge.receipts import ReceiptChain

    chain = ReceiptChain(private_key=seed, principal_did=HOST)
    for step, outcome, not_claimed in steps:
        chain.append(
            step=step,
            counterparty_label="venue:nanda-demo",
            request={},
            answer={},
            outcome=outcome,
            not_claimed=not_claimed,
        )
    return list(chain.entries)


class _FakePlan:
    def __init__(self, entries):
        self._entries = entries
        self.chain = self

    @property
    def entries(self):
        return self._entries

    def summary(self):
        return {
            "date": "2026-10-02",
            "resource": "table-4",
            "booked_start": "12:00",
            "hold_id": "hold-1",
            "steps": len(self._entries),
            "notes": [],
        }


# ── the live stream ─────────────────────────────────────────────────────────


def _events(body: str) -> list[tuple[str, dict]]:
    """Parse an SSE body into (event, data) pairs."""
    out, event = [], None
    for line in body.splitlines():
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: ") and event:
            out.append((event, json.loads(line[6:])))
            event = None
    return out


def test_the_stream_emits_one_event_per_step_as_it_completes(client, monkeypatch):
    """A run takes about a minute. Returning only at the end shows a blank page
    for that minute and then everything at once, which hides what is worth
    watching — so the steps are pushed as they land."""
    c, me = client
    entries = _real_entries(
        me.seed,
        [
            ("discover.organisation", "Matched 1 organisation", ()),
            ("venue.book", "Booked", ("That anyone will attend.",)),
        ],
    )

    def fake_arrange(*_a, on_step=None, **_k):
        plan = _FakePlan(entries)
        for entry in plan.chain.entries:
            on_step(entry)
        return plan

    monkeypatch.setattr(server_mod, "arrange", fake_arrange)
    events = _events(c.get("/ui/stream").text)

    kinds = [k for k, _ in events]
    assert kinds == ["start", "step", "step", "done"]
    assert events[0][1]["agent"] == me.did
    first = events[1][1]
    assert first["heading"] == "Find the company"
    # The chain link is computed from the receipt, never stored inside it.
    assert first["digest"].startswith("sha256:")
    assert "digest" not in first["entry"], "a receipt must not carry a hash of itself"
    assert events[3][1]["steps"] == 2


def test_the_stream_carries_the_caption_and_the_signed_entry_together(client, monkeypatch):
    """One payload for both tabs, so they cannot disagree about a step."""
    c, me = client
    entry = _real_entries(me.seed, [("venue.consent.as_guest", "Refused, as it should be.", ("x",))])[0]

    def fake_arrange(*_a, on_step=None, **_k):
        plan = _FakePlan([entry])
        on_step(plan.chain.entries[0])
        return plan

    monkeypatch.setattr(server_mod, "arrange", fake_arrange)
    step = [d for k, d in _events(c.get("/ui/stream").text) if k == "step"][0]
    # The caption, not a prefix of it: the wording changed when the host began
    # consenting on a grant, and a prefix assertion made that read as a bug.
    from concierge.narration import CAPTIONS

    assert step["plain"] == CAPTIONS["venue.consent.as_guest"][1]
    assert step["entry"]["signature"], "the signed receipt travels with the caption"
    assert step["entry"]["action"]["outcome"] == "failed", "a refusal must not read as success"
    assert step["not_claimed"] == ["x"]


def test_a_run_that_fails_midway_reports_it_on_the_stream(client, monkeypatch):
    c, _ = client

    def boom(*_a, **_k):
        raise RuntimeError("the restaurant is down")

    monkeypatch.setattr(server_mod, "arrange", boom)
    events = _events(c.get("/ui/stream").text)
    assert events[-1][0] == "error"
    assert "the restaurant is down" in events[-1][1]["message"]


def test_the_stream_refuses_to_start_a_second_concurrent_run(client, monkeypatch):
    c, _ = client
    started, release = threading.Event(), threading.Event()

    def slow(*_a, **_k):
        started.set()
        release.wait(timeout=5)
        return _FakePlan([])

    monkeypatch.setattr(server_mod, "arrange", slow)
    first = threading.Thread(target=lambda: c.get("/ui/stream"))
    first.start()
    try:
        assert started.wait(timeout=5)
        events = _events(c.get("/ui/stream").text)
        assert events[0][0] == "error"
        assert "already in progress" in events[0][1]["message"]
    finally:
        release.set()
        first.join(timeout=5)


# ── what the page is told to say ────────────────────────────────────────────


def test_the_page_gets_its_request_sentence_from_the_server(client):
    """The page must not hold its own copy of the date or the guests.

    A caption reading 2 October while the run books the 3rd describes a
    different run.
    """
    c, me = client
    cfg = c.get("/ui/config").json()
    assert cfg["date"] in cfg["request"] or cfg["date_readable"] in cfg["request"]
    assert [g["agent"] for g in cfg["guests"]] == ["regentix-ceo", "astrocity-chief-scientist"]
    assert cfg["agent"]["did"] == me.did
    assert cfg["candidates"] > 0


# ── the references tab ──────────────────────────────────────────────────────


def test_the_references_endpoint_probes_and_reports(client, monkeypatch):
    from concierge.references import Reference

    probed = [
        Reference(
            name="Index",
            kind="Directory",
            url="https://i.test",
            health_path="/health",
            status="online",
            detail="HTTP 200",
        ),
        Reference(
            name="Venue",
            kind="Venue",
            url="https://v.test",
            health_path="/health",
            status="offline",
            detail="OSError: refused",
        ),
    ]
    monkeypatch.setattr(server_mod, "probe_all", lambda *_a, **_k: probed)

    c, _ = client
    body = c.get("/ui/references").json()
    assert [r["status"] for r in body["references"]] == ["online", "offline"]
    assert body["checked_at"].endswith("Z")


def test_the_probe_result_is_cached_so_switching_tabs_does_not_reprobe(client, monkeypatch):
    """Eleven hosts is not a cost to pay every time somebody clicks a tab."""
    from concierge.references import Reference

    calls = []

    def counted(*_a, **_k):
        calls.append(1)
        return [
            Reference(
                name="x",
                kind="Directory",
                url="https://x.test",
                health_path="/h",
                status="online",
                detail="HTTP 200",
            )
        ]

    monkeypatch.setattr(server_mod, "probe_all", counted)
    c, _ = client
    c.get("/ui/references")
    c.get("/ui/references")
    assert len(calls) == 1, "the second read re-probed instead of using the cache"


def test_a_stale_cache_is_re_probed(client, monkeypatch):
    from concierge.references import Reference

    calls = []

    def counted(*_a, **_k):
        calls.append(1)
        return [
            Reference(
                name="x",
                kind="Directory",
                url="https://x.test",
                health_path="/h",
                status="online",
                detail="HTTP 200",
            )
        ]

    monkeypatch.setattr(server_mod, "probe_all", counted)
    monkeypatch.setattr(server_mod, "REFERENCES_CACHE_SECONDS", 0.0)
    c, _ = client
    c.get("/ui/references")
    c.get("/ui/references")
    assert len(calls) == 2, "a cache with no lifetime still served a stale answer"


def test_the_page_offers_three_tabs(client):
    c, _ = client
    page = c.get("/ui").text
    for tab in ("What happens", "Technical detail", "References"):
        assert tab in page, f"the page does not offer the {tab!r} tab"


# ── what a conformance harness needs from this surface ──────────────────────


def test_the_callers_request_id_is_echoed(client):
    """Without it a caller with two requests in flight cannot tell which answer
    belongs to which — and a conformance harness refuses the result outright.

    Measured: nandatown's path evaluator failed this agent at the semantic
    boundary for want of it, while the venue (which echoes) passed.
    """
    c, _ = client
    body = _rpc(c, {"skill": "concierge.last_run", "request_id": "order-abc123"}).json()
    payload = json.loads(body["result"]["artifacts"][0]["parts"][0]["text"])
    assert payload["request_id"] == "order-abc123"


def test_a_request_with_no_id_does_not_invent_one(client):
    c, _ = client
    payload = json.loads(
        _rpc(c, {"skill": "concierge.last_run"}).json()["result"]["artifacts"][0]["parts"][0]["text"]
    )
    # Echoing an id the caller never sent would let a harness match an answer to
    # a request that was never made.
    assert "request_id" not in payload


def test_a_non_string_id_is_not_echoed(client):
    c, _ = client
    payload = json.loads(
        _rpc(c, {"skill": "concierge.last_run", "request_id": 12345}).json()["result"]["artifacts"][0]["parts"][
            0
        ]["text"]
    )
    assert "request_id" not in payload


def test_the_answer_names_what_it_is(client):
    """A harness compares declared fields; a payload that says nothing about
    itself can only be matched by its shape."""
    c, _ = client
    payload = json.loads(
        _rpc(c, {"skill": "concierge.last_run"}).json()["result"]["artifacts"][0]["parts"][0]["text"]
    )
    assert payload["skill"] == "concierge.last_run"
    assert payload["kind"] == "receipt-chain"


def test_asking_twice_returns_the_same_document(client):
    """`last_run` is a read. A harness sends one logical request twice and
    passes only when both answers are byte-identical, so this must not vary."""
    c, _ = client
    intent = {"skill": "concierge.last_run", "request_id": "order-same"}
    first = _rpc(c, intent, "1").json()["result"]["artifacts"][0]["parts"][0]["text"]
    second = _rpc(c, intent, "2").json()["result"]["artifacts"][0]["parts"][0]["text"]
    assert first == second


def test_the_task_is_completed_with_exactly_one_text_part(client):
    """The contract a strict path evaluator checks: a completed task carrying
    exactly one text output. Two parts, or a task still working, is a fail."""
    c, _ = client
    result = _rpc(c, {"skill": "concierge.last_run"}).json()["result"]
    assert result["kind"] == "task"
    assert result["status"]["state"] == "completed"
    parts = result["artifacts"][0]["parts"]
    assert len([p for p in parts if p.get("kind") == "text"]) == 1


def test_healthz_says_whether_the_renewal_loop_is_alive(client):
    """The wiring, not the dataclass.

    Heartbeat can be perfect and reported nowhere — which is this estate's
    commonest defect, and was exactly the state the renewal loop shipped in: a
    correct loop that logged nothing on a healthy tick, so an operator could not
    distinguish it from one that died at startup.
    """
    c, _ = client
    body = c.get("/healthz").json()
    assert "renewal" in body, "/healthz does not expose the renewal loop at all"

    beat = body["renewal"]
    assert beat["alive"] is True
    assert beat["ticks"] == 0, "no tick is due yet — the first is one interval after boot"
    assert beat["started_at"], "without a start time, zero ticks cannot be told from a dead loop"
    assert beat["interval_seconds"] > 0
    assert beat["last_tick_at"] is None


def test_the_authority_route_serves_both_artifacts_whole(client):
    """A reader given only this agent's summary of its own authority is taking
    its word for it, so the signed grant and the host's receipt are served too."""
    c, _ = client
    body = c.get("/ui/authority").json()
    assert body["grant"]["signature"], "the DAT is served, not just described"
    assert body["grant_receipt"]["signature"], "the host's receipt is served too"
    assert body["summary"]["grant_id"] == body["grant"]["grant_id"]
    assert body["summary"]["revocable"] is False
