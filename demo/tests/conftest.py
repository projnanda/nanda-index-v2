"""Shared fixtures.

Deliberately NO autouse network stub. An earlier repo in this demo added one and
it silently stubbed the very function a test was written to exercise, so the test
passed while proving nothing. Here each test that needs a transport says which
one, in the test, where a reader can see it.
"""

from __future__ import annotations

import base64
import json
import socket
import threading
import time

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from concierge import lunch
from concierge.identity import Identity, did_of, subject_key_of
from concierge.lunch import Guest
from concierge.transport import NEEDS_CREDENTIAL, Answer
from concierge.venue import VenueClaim


@pytest.fixture
def seed() -> bytes:
    """A real 32-byte Ed25519 seed. Fixed, so failures are reproducible."""
    return bytes(range(32))


@pytest.fixture
def public_key_b64(seed: bytes) -> str:
    raw = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw()
    return base64.b64encode(raw).decode()


# ── the scenario's counterparties, stubbed ──────────────────────────────────
#
# In conftest so both the scenario tests and the caption tests can drive a real
# run without importing each other's fixtures — importing a fixture by name and
# then taking it as a parameter is the shape ruff flags as a redefinition.


@pytest.fixture
def me(seed) -> Identity:
    return Identity(agent_id="concierge", seed=seed, did=did_of(seed), subject_key=subject_key_of(seed))


GUESTS = [
    Guest(
        who="the CEO",
        company="Regentix AI",
        org_query="regentix",
        agent_label="regentix-ceo",
        agent_url="https://ceo.test",
    ),
    Guest(
        who="the chief scientist",
        company="AstroCity",
        org_query="astrocity",
        agent_label="astrocity-chief-scientist",
        agent_url="https://sci.test",
    ),
]


@pytest.fixture
def guests() -> list[Guest]:
    """The two invitees, as a fixture so tests take them rather than import them.

    A module-level name imported into a test file and then taken as a parameter
    is the shape ruff reads as a redefinition, and silencing that per-file hides
    real shadowing later.
    """
    return GUESTS


class _FakePeer:
    """Records what it was asked; answers however the test says."""

    def __init__(self, label, url, answers=None):
        self.label, self.url = label, url
        self._answers = answers or {}
        self.calls: list[tuple[str, dict]] = []

    def open(self, **_):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def invoke(self, tool, args, **_):
        self.calls.append((tool, args))
        return self._answers.get(tool, (Answer(ok=True, result={}), {"ok": True}))


class _FakeVenue:
    def __init__(self, *, open_slots, hold_ok=True):
        self._open, self._hold_ok = open_slots, hold_ok
        self.consent_calls: list[str] = []
        self.consented: list[str] = []
        self.credential = "identified"

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def availability(self, resource, starts):
        free = [s for s in starts if s in self._open.get(resource, [])]
        return Answer(
            ok=True, result={"artifacts": [{"parts": [{"kind": "text", "text": json.dumps({"open": free})}]}]}
        )

    def hold(self, *, resource, start, party, principals, covers=1, ttl_seconds=900.0):
        if not self._hold_ok:
            return Answer(ok=False, code=NEEDS_CREDENTIAL, detail="no index record resolves"), None
        from concierge.folds import slot_ref

        payload = {
            "hold_id": f"hold-{len(principals)}",
            "receipt_id": "r-1",
            "covers": covers,
            "state": "held",
            "pending": list(principals),
        }
        answer = Answer(
            ok=True, result={"artifacts": [{"parts": [{"kind": "text", "text": json.dumps(payload)}]}]}
        )
        return answer, VenueClaim(
            resource=resource,
            start=start,
            hold_id=payload["hold_id"],
            slot=slot_ref(resource, start),
            detail=payload,
        )

    def consent(self, *, hold_id, principal, grant=None):
        """Agreeing as yourself, or for a principal that signed you a grant.

        The stand-in mirrors the venue's actual rule rather than always refusing:
        a test that could only ever see the refusal would not notice the host's
        consent silently failing to be recorded.
        """
        self.consent_calls.append(principal)
        if grant is None:
            return Answer(
                ok=False, code=NEEDS_CREDENTIAL, detail=f"authenticated as X, cannot act as {principal}"
            )
        self.consented.append(principal)
        payload = {
            "hold_id": hold_id,
            "state": "held",
            "covers": 3,
            "consented": list(self.consented),
            "pending": ["guest-a", "guest-b"],
        }
        return Answer(
            ok=True, result={"artifacts": [{"parts": [{"kind": "text", "text": json.dumps(payload)}]}]}
        )

    def cancel(self, *, hold_id, by):
        return Answer(ok=True, result={})

    @staticmethod
    def payload(answer):
        from concierge.venue import Venue

        return Venue.payload(answer)


@pytest.fixture
def wired(monkeypatch):
    """Stubs the three collaborators by name, in lunch's own namespace."""
    peers: dict[str, _FakePeer] = {}
    state: dict = {}

    monkeypatch.setattr(
        lunch,
        "search_capability",
        lambda q, **_: [
            lunch.Counterparty(label=q, url=f"https://{q}.test", how="searched", urn=f"urn:ai:domain:{q}.test")
        ],
    )
    monkeypatch.setattr(
        lunch,
        "org_catalog",
        lambda url, **_: {
            "url": url,
            "entries": [{"identifier": "org"}],
            "visible": 1,
            "withheld": 5,
            "omitted": 0,
        },
    )

    def make_peer(label, url):
        peer = _FakePeer(label, url, state.get("answers"))
        peers[label] = peer
        return peer

    monkeypatch.setattr(lunch, "Peer", make_peer)
    monkeypatch.setattr(
        lunch.Venue,
        "identified",
        classmethod(lambda cls, url, **_: state.get("venue") or _FakeVenue(open_slots={"table-4": ["12:00"]})),
    )
    return peers, state


@pytest.fixture
def fake_venue():
    """Factory for a stand-in restaurant, so tests need no class import.

    Returned as a callable rather than an instance because the tests differ in
    what the restaurant does — full, refusing, or cooperative — and that is the
    variable under test.
    """
    return _FakeVenue


@pytest.fixture(autouse=True)
def granted(monkeypatch, seed):
    """A real signed grant for the test identity.

    Autouse, which this file otherwise avoids — but this is the opposite of the
    stub it warns about. It does not bypass the authority check; it gives the
    test agent an actual DAT signed by an actual host, so ``check_grant_covers``
    runs for real in every test that arranges a run. Patching the check out would
    leave the guard unexercised, and the guard is the thing standing between a
    key mismatch and seventeen unauthorised receipts.

    The host key here is generated per-session and thrown away, which is what a
    host key should be from the agent's side: unreachable.
    """
    from sm_arp import Identity, build_action, dat_grant_payload, issue_receipt
    from sm_dat import build_grant, sign_grant

    from concierge import authority

    agent = Identity.from_seed(seed)
    host = Identity.generate()
    dat = sign_grant(
        host,
        build_grant(
            grantee_did=agent.did,
            action_categories=authority.CATEGORIES,
            stateless={"counterparty_allowlist": authority.COUNTERPARTIES},
            not_before="2020-01-01T00:00:00Z",
            not_after="2099-01-01T00:00:00Z",
            human_summary="Test grant: arrange one lunch.",
        ),
    )
    receipt = issue_receipt(
        host,
        principal_did=host.did,
        action=build_action(
            category="authority_granted",
            human_summary=dat["human_summary"],
            outcome="completed",
            counterparty_label="agent:concierge",
            machine_payload=dat_grant_payload(dat),
        ),
    )
    # The real loaders stay reachable: a test still has to prove the artifacts
    # that actually ship load and agree, or a broken pair would refuse every run
    # in production while every test passed against a freshly minted one.
    shipped = {"grant": authority.grant, "grant_receipt": authority.grant_receipt}
    monkeypatch.setattr(authority, "grant", lambda: dat)
    monkeypatch.setattr(authority, "grant_receipt", lambda: receipt)
    return {"dat": dat, "receipt": receipt, "host": host, "shipped": shipped}


# ── the page, in a browser ──────────────────────────────────────────────────
#
# A real browser against a real server, with the network stubbed out.
#
# Why a live server and not the TestClient
# ---------------------------------------
# The page is HTML, CSS and JavaScript. A TestClient can prove the server sends the
# right JSON; it cannot prove the page renders it, that a tab switches, or that a
# handler is wired to a button that exists. Those are the defects this file is for,
# and they need a browser.
#
# Why the counterparties are stubbed
# ----------------------------------
# The page fetches live reference probes, the capability vocabulary and a run.
# Against the real estate those touch nine hosts, take a minute, and book a real
# table. So the scenario, the probes and the catalogs are replaced here — the
# *page* is what is under test, not the organisations.


HOST = "did:key:z6MktMyEoA64WSk5WuaxZvKyobsaHhL3rJQS8uxkV3ixvHqQ"

#: The steps a stubbed run emits. Deliberately includes the refusal, because the
#: page styles it differently and a suite that only ever renders successes would
#: not notice if that stopped working.
STUB_STEPS = [
    ("discover.organisation", "index:public", "Found Regentix AI in the public directory.", ()),
    ("discover.catalog", "org:regentix", "Regentix AI publishes 6 listings.", ()),
    ("discover.agent", "org:regentix", "Found the CEO of Regentix by searching for 'leadership'.", ()),
    ("ask.intent", "agent:regentix-ceo", "Recorded as an open request.", ("That the guest agreed.",)),
    ("ask.note", "agent:regentix-ceo", "Written to the agent's own record.", ()),
    ("venue.availability", "venue:nanda-demo", "3 of 8 sittings free at table-4.", ()),
    ("venue.hold.multiparty", "venue:nanda-demo", "Table held. It needs all 3 people to agree.", ()),
    (
        "venue.consent.host",
        "venue:nanda-demo",
        "Recorded. The host authorised this agent in writing.",
        ("That the guests agreed.",),
    ),
    (
        "venue.consent.as_guest",
        "venue:nanda-demo",
        "Refused, as it should be. You can only speak for yourself.",
        ("That the guest agreed.",),
    ),
    ("venue.book", "venue:nanda-demo", "Booked in the concierge's own name.", ("That anyone will arrive.",)),
]


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _Plan:
    def __init__(self, chain):
        self.chain = chain

    def summary(self):
        # Held, not booked — the state a real run reaches while the guests have
        # not answered, and the one the result block used to report as "nothing
        # booked" directly above a note saying the table was held.
        return {
            "date": "2026-10-02",
            "resource": "table-4",
            "booked_start": None,
            "start": "2026-10-02T12:00:00Z",
            "hold_id": "hold-stub-1",
            "steps": len(self.chain.entries),
            "state": "held",
            "covers": 3,
            "pending": ["regentix-ceo", "astrocity-chief-scientist"],
            "notes": ["A table for 3 is held. The host has agreed; it becomes a booking when the 2 guests do."],
        }


@pytest.fixture(scope="module")
def ui_server(request):
    """Serve the real app on a loopback port, with the estate stubbed out."""
    pytest.importorskip("playwright", reason="playwright is not installed")
    import uvicorn

    from concierge import capabilities
    from concierge import server as server_mod
    from concierge.identity import Identity, did_of, subject_key_of
    from concierge.receipts import ReceiptChain
    from concierge.references import Reference

    seed = bytes(range(32))
    me = Identity(agent_id="concierge", seed=seed, did=did_of(seed), subject_key=subject_key_of(seed))

    def fake_arrange(*_a, on_step=None, **_k):
        chain = ReceiptChain(private_key=seed, principal_did=HOST, granted_by=None)
        for step, label, outcome, not_claimed in STUB_STEPS:
            entry = chain.append(
                step=step,
                counterparty_label=label,
                # A real step records who it was about, and the page renders it.
                # A stub without one made the page look broken in a way only the
                # stub was.
                request={"stub": True, "subject": "the CEO of Regentix"},
                answer={"stub": True},
                outcome=outcome,
                not_claimed=not_claimed,
            )
            if on_step:
                on_step(entry)
        return _Plan(chain)

    refs = [
        Reference(
            name="Public Index",
            kind="Directory",
            url="https://ix.test",
            health_path="/",
            note="",
            status="online",
            detail="HTTP 200",
        ),
        Reference(
            name="The restaurant",
            kind="Venue",
            url="https://v.test",
            health_path="/",
            note="",
            status="offline",
            detail="URLError: refused",
        ),
    ]

    matches = {
        "capability": "leadership",
        "matches": [
            {
                "org": "regentix",
                "identifier": "regentix-ceo",
                "display_name": "Regentix AI CEO",
                "url": "https://ceo.test/card.json",
                "skills": ["leadership", "strategy"],
                "tags": ["leadership", "strategy", "positioning"],
                "source": "agent",
                "catalog_url": "https://regentix.test/.well-known/ai-catalog.json",
                "facts_url": "https://ceo.test/agentfacts.json",
            },
        ],
        "searched": ["regentix", "astrocity", "rocketbrain"],
        "unreachable": {},
        "complete": True,
        "orgs_claiming": ["regentix"],
        # The live estate has six of these; the page has to render one.
        "divergences": [
            {
                "org": "regentix",
                "identifier": "regentix-ceo",
                "claimed_by_org_only": ["positioning"],
                "claimed_by_agent_only": [],
            }
        ],
        "unverified": {},
    }

    class _Result:
        def to_dict(self):
            return matches

    mp = pytest.MonkeyPatch()
    mp.setattr(server_mod, "arrange", fake_arrange)
    mp.setattr(server_mod, "probe_all", lambda *a, **k: refs)
    mp.setattr(capabilities, "search", lambda *a, **k: _Result())
    mp.setattr(
        capabilities,
        "vocabulary",
        lambda *a, **k: {"leadership": ["regentix", "rocketbrain"], "orbital-analysis": ["astrocity"]},
    )

    port = _free_port()
    config = uvicorn.Config(server_mod.build_app(me), host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    else:  # pragma: no cover - only on a machine that cannot bind loopback
        pytest.fail("the test server did not start")

    yield base

    server.should_exit = True
    thread.join(timeout=5)
    mp.undo()


@pytest.fixture(scope="module")
def browser():
    pytest.importorskip("playwright", reason="playwright is not installed")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as exc:  # pragma: no cover - no browser binary installed
            pytest.skip(f"chromium is not available: {str(exc)[:80]}")
        yield b
        b.close()


@pytest.fixture
def page(browser, ui_server):
    """A page with the demo loaded, and console errors recorded as they happen."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    pg.on(
        "console",
        lambda m: pg.errors.append(f"console {m.type}: {m.text[:160]}") if m.type == "error" else None,
    )
    pg.goto(f"{ui_server}/ui", wait_until="networkidle", timeout=30000)
    yield pg
    ctx.close()
