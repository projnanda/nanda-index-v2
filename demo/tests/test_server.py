"""What answers at the address this agent registered."""

from __future__ import annotations

import json
import threading
import time

import pytest
from starlette.testclient import TestClient

from concierge import server as server_mod
from concierge.card import SKILL_ID
from concierge.identity import Identity, did_of, subject_key_of
from concierge.server import build_app


@pytest.fixture
def client(seed, monkeypatch, tmp_path):
    # The last run is kept on disk now; each test gets its own file, so one
    # test's run cannot appear as another's "last run".
    monkeypatch.setenv("CONCIERGE_LAST_RUN", str(tmp_path / "last-run.json"))
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
    assert response.json()["error"]["message"] == server_mod.RUN_FAILED_MESSAGE


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
    assert events[-1][1]["message"] == server_mod.RUN_FAILED_MESSAGE


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


# ── what a public deployment needs: a replay that survives, a bounded run ────


def _stub_run(monkeypatch, me):
    entries = _real_entries(me.seed, [("discover.organisation", "Matched 1 organisation", ())])

    def fake_arrange(*_a, on_step=None, **_k):
        plan = _FakePlan(entries)
        for entry in plan.chain.entries:
            if on_step:
                on_step(entry)
        return plan

    monkeypatch.setattr(server_mod, "arrange", fake_arrange)


def test_the_last_run_survives_a_restart(client, monkeypatch):
    """The page opens on the last run. Kept only in memory, every redeploy left
    the first visitor nothing to watch but a live run."""
    c, me = client
    _stub_run(monkeypatch, me)
    _events(c.get("/ui/stream").text)

    restarted = TestClient(build_app(me))
    steps = restarted.get("/ui/last").json()["steps"]
    assert [s["step"] for s in steps] == ["discover.organisation"]


def test_the_stream_refuses_a_visitor_over_the_limit_and_says_so(client, monkeypatch):
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_PER_HOUR", "1")
    _stub_run(monkeypatch, me)
    limited = TestClient(build_app(me))

    assert _events(limited.get("/ui/stream").text)[-1][0] == "done"
    refused = _events(limited.get("/ui/stream").text)
    assert [k for k, _ in refused] == ["error"]
    assert refused[0][1]["limited"] is True
    assert "1 live run" in refused[0][1]["message"]


def test_a_refused_stream_does_not_hold_the_run_lock(client, monkeypatch):
    """A visitor turned away must not leave the next visitor locked out."""
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_PER_HOUR", "1")
    monkeypatch.setenv("CONCIERGE_BEHIND_PROXY", "1")
    _stub_run(monkeypatch, me)
    limited = TestClient(build_app(me))
    first = {"X-Forwarded-For": "198.51.100.1"}

    limited.get("/ui/stream", headers=first)
    limited.get("/ui/stream", headers=first)  # refused
    other = _events(limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.2"}).text)
    assert other[-1][0] == "done"


def test_the_a2a_run_is_limited_the_same_way(client, monkeypatch):
    """The page is not the only way in: arrange_meal over A2A books the same table."""
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_PER_HOUR", "1")
    _stub_run(monkeypatch, me)
    limited = TestClient(build_app(me))

    assert "result" in _rpc(limited, {"skill": "concierge.arrange_meal"}).json()
    body = _rpc(limited, {"skill": "concierge.arrange_meal"}).json()
    assert body["error"]["code"] == -32603
    assert "live run" in body["error"]["message"]


def test_forwarded_for_is_ignored_unless_a_proxy_is_declared(client, monkeypatch):
    """Directly reachable, the header is the caller's to invent: rotating it must
    not buy a fresh allowance."""
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_PER_HOUR", "1")
    monkeypatch.delenv("CONCIERGE_BEHIND_PROXY", raising=False)
    _stub_run(monkeypatch, me)
    limited = TestClient(build_app(me))

    limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.1"})
    again = _events(limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.2"}).text)
    assert again[0][0] == "error"


def test_the_page_is_told_the_limit_it_will_meet(client, monkeypatch):
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_PER_HOUR", "3")
    assert TestClient(build_app(me)).get("/ui/config").json()["run_limit"]["per_hour"] == 3


# ── security headers ────────────────────────────────────────────────────────
#
# The demo is served at nandaindex.org/demo, the origin whose localStorage holds
# the web app's session. Caddy routes /demo before Next, so Next's headers never
# reached it; the demo sends its own.


def _directives(csp: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in csp.split(";"):
        words = part.split()
        if words:
            out[words[0]] = words[1:]
    return out


@pytest.mark.parametrize("path", ["/ui", "/ui/", "/ui/config", "/healthz", "/.well-known/agent-card.json"])
def test_every_response_carries_the_security_headers(client, path):
    c, _ = client
    headers = c.get(path).headers
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["referrer-policy"] == "no-referrer"
    assert headers["x-frame-options"] == "DENY"
    csp = _directives(headers["content-security-policy"])
    assert csp["default-src"] == ["'self'"]
    assert csp["frame-ancestors"] == ["'none'"]
    assert csp["base-uri"] == ["'none'"]
    assert csp["form-action"] == ["'self'"]


def test_the_a2a_endpoint_and_the_stream_carry_them_too(client, monkeypatch):
    c, me = client
    _stub_run(monkeypatch, me)
    assert _rpc(c, {"skill": "concierge.last_run"}).headers["x-frame-options"] == "DENY"
    assert c.get("/ui/stream").headers["x-content-type-options"] == "nosniff"


def test_the_page_script_and_style_are_allowed_by_hash_not_by_unsafe_inline(client):
    """A hash admits exactly the page's own inline script. ``unsafe-inline``
    would admit an injected one as well, which is the case the CSP is for."""
    import base64
    import hashlib
    import re

    c, _ = client
    response = c.get("/ui")
    csp = _directives(response.headers["content-security-policy"])
    assert "'unsafe-inline'" not in csp["script-src"]
    assert "'unsafe-inline'" not in csp.get("style-src", [])
    assert "'unsafe-eval'" not in csp["script-src"]

    def digest(block: str) -> str:
        return "'sha256-" + base64.b64encode(hashlib.sha256(block.encode()).digest()).decode() + "'"

    scripts = re.findall(r"<script>(.*?)</script>", response.text, re.S)
    styles = re.findall(r"<style>(.*?)</style>", response.text, re.S)
    assert scripts and styles
    for block in scripts:
        assert digest(block) in csp["script-src"]
    for block in styles:
        assert digest(block) in csp["style-src"]


# ── the global run budget ───────────────────────────────────────────────────


def test_the_demo_has_a_global_run_budget_by_default(monkeypatch):
    monkeypatch.delenv("RUN_LIMIT_GLOBAL_PER_HOUR", raising=False)
    assert server_mod.config.run_limit_global_per_hour() > 0


def test_the_global_budget_can_be_configured_or_switched_off(monkeypatch):
    monkeypatch.setenv("RUN_LIMIT_GLOBAL_PER_HOUR", "7")
    assert server_mod.config.run_limit_global_per_hour() == 7
    monkeypatch.setenv("RUN_LIMIT_GLOBAL_PER_HOUR", "0")
    assert server_mod.config.run_limit_global_per_hour() == 0


def test_the_global_budget_refuses_a_fresh_visitor_once_it_is_spent(client, monkeypatch):
    """Per-visitor limits alone let enough visitors (or one with enough
    addresses) spend the host's authority without end."""
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_PER_HOUR", "5")
    monkeypatch.setenv("RUN_LIMIT_GLOBAL_PER_HOUR", "1")
    monkeypatch.setenv("CONCIERGE_BEHIND_PROXY", "1")
    _stub_run(monkeypatch, me)
    limited = TestClient(build_app(me))

    assert _events(limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.1"}).text)[-1][0] == "done"
    refused = _events(limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.2"}).text)
    assert [k for k, _ in refused] == ["error"]
    assert refused[0][1]["limited"] is True
    assert "all visitors" in refused[0][1]["message"]

    body = _rpc(limited, {"skill": "concierge.arrange_meal"}).json()
    assert "all visitors" in body["error"]["message"]


def test_a_visitor_refused_by_the_global_budget_is_not_charged(client, monkeypatch):
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_PER_HOUR", "1")
    monkeypatch.setenv("RUN_LIMIT_GLOBAL_PER_HOUR", "1")
    monkeypatch.setenv("CONCIERGE_BEHIND_PROXY", "1")
    _stub_run(monkeypatch, me)
    app = build_app(me)
    limited = TestClient(app)

    limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.1"})
    limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.2"})  # global refusal
    message = _events(limited.get("/ui/stream", headers={"X-Forwarded-For": "198.51.100.2"}).text)[0][1][
        "message"
    ]
    assert "all visitors" in message, "the global refusal was counted against the visitor"


def test_the_page_is_told_the_global_budget(client, monkeypatch):
    c, me = client
    monkeypatch.setenv("RUN_LIMIT_GLOBAL_PER_HOUR", "9")
    assert TestClient(build_app(me)).get("/ui/config").json()["run_limit"]["global_per_hour"] == 9


# ── one run cannot hold the lock for ever ───────────────────────────────────


def test_a_stream_stops_waiting_for_a_run_that_overruns(client, monkeypatch):
    """A visitor's stream gives up after the deadline; the lock is held only
    while the run itself is actually going, and released when it ends — never
    while it is still running, which would let two runs race for one slot."""
    c, me = client
    monkeypatch.setattr(server_mod, "RUN_STREAM_TIMEOUT_SECONDS", 0.2)
    started, release = threading.Event(), threading.Event()
    finished = threading.Event()

    def slow(*_a, **_k):
        started.set()
        release.wait(timeout=5)
        finished.set()
        return _FakePlan([])

    monkeypatch.setattr(server_mod, "arrange", slow)
    events = _events(c.get("/ui/stream").text)
    assert events[-1][0] == "error"
    assert "taking longer" in events[-1][1]["message"]

    assert started.is_set()
    busy = _events(c.get("/ui/stream").text)
    assert "already in progress" in busy[0][1]["message"], "the lock was released while the run still ran"

    release.set()
    assert finished.wait(timeout=5)
    monkeypatch.setattr(server_mod, "arrange", lambda *a, **k: _FakePlan([]))
    # The worker releases the lock a moment after arrange() returns.
    for _ in range(50):
        last = _events(c.get("/ui/stream").text)
        if last[-1][0] == "done":
            break
        time.sleep(0.05)
    assert last[-1][0] == "done", "the lock was never released"


# ── internal errors stay internal ───────────────────────────────────────────


def test_a_failed_a2a_run_does_not_echo_the_exception(client, monkeypatch, caplog):
    c, _ = client

    def boom(*_a, **_k):
        raise RuntimeError("connect to internal-host.railway.internal:5432 refused")

    monkeypatch.setattr(server_mod, "arrange", boom)
    with caplog.at_level("ERROR"):
        message = _rpc(c, {"skill": "concierge.arrange_meal"}).json()["error"]["message"]
    assert "internal-host" not in message
    assert "RuntimeError" not in message
    assert "internal-host" in caplog.text, "the detail must still reach the log"


def test_a_failed_stream_run_does_not_echo_the_exception(client, monkeypatch, caplog):
    c, _ = client

    def boom(*_a, **_k):
        raise RuntimeError("connect to internal-host.railway.internal:5432 refused")

    monkeypatch.setattr(server_mod, "arrange", boom)
    with caplog.at_level("ERROR"):
        events = _events(c.get("/ui/stream").text)
    assert events[-1][0] == "error"
    assert "internal-host" not in events[-1][1]["message"]
    assert "internal-host" in caplog.text


# ── the capability search ───────────────────────────────────────────────────


class _Found:
    def __init__(self, term):
        self.term = term

    def to_dict(self):
        return {"capability": self.term, "matches": []}


def _counting_search(monkeypatch):
    calls: list[str] = []

    def search(term, **_):
        calls.append(term)
        return _Found(term)

    monkeypatch.setattr(server_mod.capabilities, "search", search)
    return calls


def test_a_repeated_capability_search_is_served_from_the_cache(client, monkeypatch):
    """Each search is about 3 + 2N requests to other organisations' servers."""
    c, _ = client
    calls = _counting_search(monkeypatch)
    for term in ("leadership", "leadership", " Leadership ", "LEADERSHIP"):
        assert c.get("/ui/capability", params={"q": term}).status_code == 200
    assert calls == ["leadership"]


def test_the_capability_cache_expires(client, monkeypatch):
    c, _ = client
    calls = _counting_search(monkeypatch)
    clock = {"now": 1000.0}
    monkeypatch.setattr(server_mod, "_clock", lambda: clock["now"])
    c.get("/ui/capability", params={"q": "leadership"})
    clock["now"] += server_mod.CAPABILITY_CACHE_SECONDS + 1
    c.get("/ui/capability", params={"q": "leadership"})
    assert calls == ["leadership", "leadership"]


def test_capability_searches_are_rate_limited_per_visitor(client, monkeypatch):
    c, me = client
    monkeypatch.setenv("CAPABILITY_LIMIT_PER_MINUTE", "2")
    monkeypatch.setenv("CONCIERGE_BEHIND_PROXY", "1")
    calls = _counting_search(monkeypatch)
    limited = TestClient(build_app(me))
    one = {"X-Forwarded-For": "198.51.100.1"}

    assert limited.get("/ui/capability", params={"q": "a"}, headers=one).status_code == 200
    assert limited.get("/ui/capability", params={"q": "b"}, headers=one).status_code == 200
    refused = limited.get("/ui/capability", params={"q": "c"}, headers=one)
    assert refused.status_code == 429
    assert "retry-after" in refused.headers
    assert calls == ["a", "b"]
    # A cached answer costs nobody anything, so it is still served.
    assert limited.get("/ui/capability", params={"q": "a"}, headers=one).status_code == 200
    # And another visitor has their own allowance.
    other = {"X-Forwarded-For": "198.51.100.2"}
    assert limited.get("/ui/capability", params={"q": "c"}, headers=other).status_code == 200


def test_the_capability_limit_has_a_default(monkeypatch):
    monkeypatch.delenv("CAPABILITY_LIMIT_PER_MINUTE", raising=False)
    assert server_mod.config.capability_limit_per_minute() > 0


def test_an_overlong_capability_is_refused_before_anything_is_fetched(client, monkeypatch):
    c, _ = client
    calls = _counting_search(monkeypatch)
    response = c.get("/ui/capability", params={"q": "x" * (server_mod.CAPABILITY_MAX_LENGTH + 1)})
    assert response.status_code == 400
    assert calls == []


def test_concurrent_capability_searches_are_bounded(client, monkeypatch):
    """Each search holds a worker thread for up to ~16s against a slow
    organisation; unbounded, 40 of them stop the whole demo answering."""
    c, me = client
    monkeypatch.setattr(server_mod, "CAPABILITY_MAX_CONCURRENT", 1)
    started, release = threading.Event(), threading.Event()

    def slow(term, **_):
        started.set()
        release.wait(timeout=5)
        return _Found(term)

    monkeypatch.setattr(server_mod.capabilities, "search", slow)
    bounded = TestClient(build_app(me))
    first = threading.Thread(target=lambda: bounded.get("/ui/capability", params={"q": "a"}))
    first.start()
    try:
        assert started.wait(timeout=5)
        busy = bounded.get("/ui/capability", params={"q": "b"})
        assert busy.status_code == 503
        assert "retry-after" in busy.headers
    finally:
        release.set()
        first.join(timeout=5)
    assert bounded.get("/ui/capability", params={"q": "b"}).status_code == 200
