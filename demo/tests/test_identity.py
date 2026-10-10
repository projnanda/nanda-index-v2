"""The name, and the signature that claims it."""

from __future__ import annotations

import base64
import socket
from datetime import UTC

import jcs
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from concierge.identity import (
    DEFAULT_PATH,
    INTENT_CONTEXT,
    INTENT_FIELDS,
    did_of,
    sign_intent,
    subject_key_of,
    urn_for,
)


def test_the_subject_key_is_multibase_u_not_did_key(seed):
    subject = subject_key_of(seed)
    assert subject.startswith("u") and "=" not in subject
    # Easy to confuse with did:key, which is base58 with a multicodec prefix. A
    # record registered under the wrong encoding resolves for nobody and looks
    # exactly like not having registered.
    assert did_of(seed).startswith("did:key:z")
    assert subject[1:] != did_of(seed).removeprefix("did:key:z")


def test_the_urn_is_the_path_the_venue_resolves():
    # The venue asks for urn:ai:key:<subject_key>/agent. Any other path is a
    # record nobody looks for.
    assert DEFAULT_PATH == "agent"
    assert urn_for("uABC") == "urn:ai:key:uABC/agent"


def test_the_intent_signature_covers_the_whole_intent_not_the_nonce(seed):
    challenge = {
        "id": "urn:ai:key:uABC/agent",
        "subject_key": "uABC",
        "next_hop": "https://example.test/card.json",
        "media_type": "application/a2a-agent-card+json",
        "nonce": "n-1",
        "challenge_id": "c-1",
    }
    signature = base64.b64decode(sign_intent(seed, challenge))
    covered = {k: challenge[k] for k in INTENT_FIELDS if k in challenge}
    Ed25519PrivateKey.from_private_bytes(seed).public_key().verify(
        signature, INTENT_CONTEXT + jcs.canonicalize(covered)
    )
    # next_hop is covered, so the index cannot substitute the pointer target.
    assert "next_hop" in covered
    # challenge_id is NOT covered — it is routing, not intent.
    assert "challenge_id" not in covered


def test_a_field_the_challenge_omits_is_omitted_not_nulled(seed):
    # Under JCS an absent key and a null one canonicalise differently, so
    # inventing a null signs something the index never issued.
    short = {"id": "urn:ai:key:uABC/agent", "subject_key": "uABC", "nonce": "n"}
    with_null = {**short, "audience": None}
    assert sign_intent(seed, short) != sign_intent(seed, with_null)


def test_the_context_prefix_is_the_v2_one(seed):
    # A v1 signature uses a different context string and will not verify against
    # a v2 challenge. Pinned so a bump is a deliberate edit.
    assert INTENT_CONTEXT == b"nanda-index-v3/intent-v2:"


# ── claiming the name over the wire ─────────────────────────────────────────


class _Resp:
    def __init__(self, payload):
        import json as _json

        self._b = _json.dumps(payload).encode()

    def read(self, _n=None):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def _resolves(*_a, **_k):
    """One answer shaped the way getaddrinfo really answers.

    The shape matters even though this code only checks whether the call raised:
    a stub that returns something no resolver produces is a stub that keeps
    passing after the code starts reading the result.
    """
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("185.158.133.1", 0))]


def _http(monkeypatch, *, resolve=None, resolve_status=200, challenge=None, record=None):
    """Stubs the network this module touches; the URLs are still built for real.

    That includes DNS. ``ensure_registered`` refuses to write a pointer to a
    hostname that does not exist, and the addresses these tests use
    (``agent.example``) deliberately do not — so without this the guard fires and
    every test about the *decision* fails for a reason that is not the decision.
    Stubbed here rather than per-test so the gate stays offline: a test suite that
    reaches a resolver fails on a train.
    """
    import urllib.error

    from concierge import identity as mod

    monkeypatch.setattr(mod.socket, "getaddrinfo", _resolves)

    seen: list[tuple[str, dict | None]] = []

    def fake(request, timeout=None):
        url = request.full_url if hasattr(request, "full_url") else str(request)
        body = None
        if getattr(request, "data", None):
            import json as _json

            body = _json.loads(request.data)
        seen.append((url, body))
        if "/v1/resolve" in url:
            if resolve_status != 200:
                raise urllib.error.HTTPError(url, resolve_status, "nope", {}, None)
            return _Resp({"record": resolve})
        if "/v1/register" in url:
            return _Resp({"challenge": challenge})
        if "/v1/prove" in url:
            return _Resp({"record": record} if record is not None else {})
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(mod.urllib.request, "urlopen", fake)
    return seen


CHALLENGE = {
    "challenge_id": "c-1",
    "id": "urn:ai:key:uX/agent",
    "subject_key": "uX",
    "next_hop": "https://card.test/c.json",
    "media_type": "application/a2a-agent-card+json",
    "nonce": "n-1",
}


def _identity(seed):
    from concierge.identity import Identity

    return Identity(agent_id="concierge", seed=seed, did=did_of(seed), subject_key=subject_key_of(seed))


def test_registering_is_two_round_trips_challenge_then_proof(seed, monkeypatch):
    from concierge.identity import register

    seen = _http(monkeypatch, challenge=CHALLENGE, record={"seq": 1, "expires_at": "2026-10-03T00:00:00Z"})
    result = register(_identity(seed), index_url="https://ix.test", card_url="https://card.test/c.json")

    assert [u for u, _ in seen] == ["https://ix.test/v1/register", "https://ix.test/v1/prove"]
    # The registration names the key-derived urn and declares a key anchor — the
    # only id space a key anchor may claim.
    assert seen[0][1]["anchor_type"] == "key"
    assert seen[0][1]["id"].startswith("urn:ai:key:")
    assert seen[1][1]["challenge_id"] == "c-1"
    assert "subject_sig" in seen[1][1]["response"]
    assert result["record"]["seq"] == 1


def test_a_register_that_returns_no_challenge_is_an_error_not_a_silent_pass(seed, monkeypatch):
    import pytest as _pytest

    from concierge.identity import RegistrationError, register

    _http(monkeypatch, challenge=None)
    with _pytest.raises(RegistrationError, match="no challenge"):
        register(_identity(seed), index_url="https://ix.test", card_url="https://card.test/c.json")


def test_a_prove_that_returns_no_record_is_an_error(seed, monkeypatch):
    import pytest as _pytest

    from concierge.identity import RegistrationError, register

    _http(monkeypatch, challenge=CHALLENGE, record=None)
    with _pytest.raises(RegistrationError, match="no record"):
        register(_identity(seed), index_url="https://ix.test", card_url="https://card.test/c.json")


def test_a_current_record_is_left_alone(seed, monkeypatch):
    from datetime import datetime, timedelta

    from concierge.identity import ensure_registered

    far = (datetime.now(UTC) + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    seen = _http(monkeypatch, resolve={"next_hop": "https://card.test/c.json", "seq": 3, "expires_at": far})
    result = ensure_registered(
        _identity(seed), index_url="https://ix.test", card_url="https://card.test/c.json"
    )

    assert result["action"] == "current"
    # The log is append-only; an agent that re-registers every boot writes a run
    # of identical entries into a history nobody can edit.
    assert [u for u, _ in seen] == [
        "https://ix.test/v1/resolve?id=" + result["id"].replace(":", "%3A").replace("/", "%2F")
    ]


def test_a_record_close_to_lapsing_is_renewed(seed, monkeypatch):
    from datetime import datetime, timedelta

    from concierge.identity import ensure_registered

    soon = (datetime.now(UTC) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    _http(
        monkeypatch,
        resolve={"next_hop": "https://card.test/c.json", "seq": 3, "expires_at": soon},
        challenge=CHALLENGE,
        record={"seq": 4},
    )
    # Renewing only on a changed pointer would report "current" for a record with
    # an hour to live, and revocation here is non-renewal.
    assert (
        ensure_registered(_identity(seed), index_url="https://ix.test", card_url="https://card.test/c.json")[
            "action"
        ]
        == "renewed"
    )


def test_a_missing_record_is_registered(seed, monkeypatch):
    from concierge.identity import ensure_registered

    _http(monkeypatch, resolve_status=404, challenge=CHALLENGE, record={"seq": 1})
    assert (
        ensure_registered(_identity(seed), index_url="https://ix.test", card_url="https://card.test/c.json")[
            "action"
        ]
        == "registered"
    )


def test_an_unreachable_index_is_reported_not_raised(seed, monkeypatch):
    from concierge import identity as mod
    from concierge.identity import ensure_registered

    def boom(*_a, **_k):
        raise OSError("no route to host")

    # DNS answers; it is the index that is unreachable, and the two must not be
    # reported as the same thing.
    monkeypatch.setattr(mod.socket, "getaddrinfo", _resolves)
    monkeypatch.setattr(mod.urllib.request, "urlopen", boom)
    # An agent that cannot reach discovery should still serve the peers that
    # already know where it is; turning someone else's outage into ours is worse.
    result = ensure_registered(_identity(seed), index_url="https://ix.test", card_url="https://c.test/c.json")
    assert result["action"] == "unreachable" and "no route" in result["detail"]


def test_a_refusing_index_is_reported_not_raised(seed, monkeypatch):
    from concierge.identity import ensure_registered

    _http(monkeypatch, resolve_status=404, challenge=None)
    assert (
        ensure_registered(_identity(seed), index_url="https://ix.test", card_url="https://c.test/c.json")[
            "action"
        ]
        == "failed"
    )


def test_a_key_file_that_is_not_a_seed_is_refused_rather_than_replaced(tmp_path, monkeypatch):
    import pytest as _pytest

    from concierge.identity import load_or_create

    monkeypatch.setenv("CONCIERGE_HOME", str(tmp_path))
    (tmp_path / "agent.key").write_text("dG9vIHNob3J0")
    # Minting a replacement would not be a fresh start — it would make this agent
    # somebody else, and orphan every receipt it ever signed.
    with _pytest.raises(ValueError, match="32-byte"):
        load_or_create()


def test_a_key_is_minted_once_and_reused(tmp_path, monkeypatch):
    from concierge.identity import load_or_create

    monkeypatch.setenv("CONCIERGE_HOME", str(tmp_path))
    first = load_or_create()
    assert load_or_create().did == first.did
    assert (tmp_path / "agent.key").stat().st_mode & 0o077 == 0


def test_a_supplied_seed_wins_over_disk_and_is_not_copied_there(tmp_path, monkeypatch, seed):
    import base64 as _b64

    from concierge.identity import SEED_ENV, load_or_create

    monkeypatch.setenv("CONCIERGE_HOME", str(tmp_path))
    monkeypatch.setenv(SEED_ENV, _b64.b64encode(seed).decode())
    identity = load_or_create()

    assert identity.seed == seed
    # Never written to disk: a copy on a volume the environment is authoritative
    # over is a second source of truth for the one value that must have only one.
    assert not (tmp_path / "agent.key").exists()


def test_a_malformed_supplied_seed_is_refused_rather_than_replaced(tmp_path, monkeypatch):
    import pytest as _pytest

    from concierge.identity import SEED_ENV, load_or_create

    monkeypatch.setenv("CONCIERGE_HOME", str(tmp_path))
    for bad, match in (("not base64!!", "valid base64"), ("dG9vc2hvcnQ=", "32")):
        monkeypatch.setenv(SEED_ENV, bad)
        with _pytest.raises(ValueError, match=match):
            load_or_create()
    # And nothing was minted in its place.
    assert not (tmp_path / "agent.key").exists()


# ── a development run must not repoint the live agent ───────────────────────


def test_a_loopback_address_is_never_registered(seed, monkeypatch):
    """The defect this repo caused, as a property.

    Running the scenario on a workstation with no CONCIERGE_BASE_URL falls back
    to http://localhost:8080. Registering that overwrote the deployed agent's
    pointer, and while it pointed at localhost the agent was unresolvable to
    everyone — including the venue, which refuses a caller no index resolves.
    """
    from concierge import identity as mod
    from concierge.identity import ensure_registered

    def must_not_be_called(*_a, **_k):
        raise AssertionError("a loopback pointer reached the network")

    monkeypatch.setattr(mod.urllib.request, "urlopen", must_not_be_called)

    for bad in ("http://localhost:8080/c.json", "http://127.0.0.1:9/c.json", "http://[::1]/c.json"):
        result = ensure_registered(_identity(seed), index_url="https://ix.test", card_url=bad)
        assert result["action"] == "skipped"
        assert "CONCIERGE_BASE_URL" in result["detail"]


def test_a_public_address_still_registers(seed, monkeypatch):
    from concierge.identity import ensure_registered

    _http(monkeypatch, resolve_status=404, challenge=CHALLENGE, record={"seq": 1})
    result = ensure_registered(
        _identity(seed), index_url="https://ix.test", card_url="https://agent.example/c.json"
    )
    assert result["action"] == "registered"


def test_publicly_resolvable_is_about_reachability_not_scheme(seed):
    from concierge.identity import is_publicly_resolvable

    assert is_publicly_resolvable("https://agent.example/c.json")
    assert is_publicly_resolvable("http://agent.example/c.json")
    assert not is_publicly_resolvable("https://localhost/c.json")
    assert not is_publicly_resolvable("https://my-box.local/c.json")
    assert not is_publicly_resolvable("not a url")


# ── the pointer must lead somewhere that exists ─────────────────────────────


def _dns(monkeypatch, errno):
    """Make every lookup fail with ``errno``."""
    from concierge import identity as mod

    def fail(*_a, **_k):
        raise socket.gaierror(errno, "stubbed")

    monkeypatch.setattr(mod.socket, "getaddrinfo", fail)


def test_a_hostname_that_does_not_exist_is_never_registered(seed, monkeypatch):
    """The defect this guard exists for, as a property.

    This agent registered ``indexdemo3.sellarminds.ai`` — a typo for
    ``stellarminds`` — as its index pointer. It is public-looking, so the
    loopback check passed it, and the record went into an append-only log that
    cannot be edited. Everything resolving that name got an address nobody could
    reach.
    """
    from concierge import identity as mod
    from concierge.identity import ensure_registered

    _dns(monkeypatch, socket.EAI_NONAME)
    monkeypatch.setattr(
        mod.urllib.request,
        "urlopen",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("a dead pointer reached the network")),
    )

    result = ensure_registered(
        _identity(seed), index_url="https://ix.test", card_url="https://typo.example/c.json"
    )
    assert result["action"] == "skipped"
    assert "does not resolve" in result["detail"]
    assert "append-only" in result["detail"], "the detail should say why this cannot be undone"


def test_a_resolver_that_is_merely_unwell_does_not_unregister_an_agent(seed, monkeypatch):
    """Ambiguity resolves to "register".

    A wrong refusal costs the agent its name every hour until a human notices; a
    wrong acceptance costs one stale record. Only a definitive "no such host"
    is treated as an answer.
    """
    from concierge.identity import ensure_registered

    # _http stubs DNS too, so it must go first — the later setattr wins, and a
    # test whose stub is overwritten passes while proving nothing. This one did.
    _http(monkeypatch, resolve_status=404, challenge=CHALLENGE, record={"seq": 1})
    _dns(monkeypatch, socket.EAI_AGAIN)
    result = ensure_registered(
        _identity(seed), index_url="https://ix.test", card_url="https://agent.example/c.json"
    )
    assert result["action"] == "registered"


def test_host_exists_treats_an_unexpected_resolver_error_as_yes():
    """Not every resolver raises gaierror; none of them may take the name down."""
    from concierge.identity import host_exists

    def explode(_host):
        raise RuntimeError("resolver in a state nobody predicted")

    assert host_exists("https://agent.example/c.json", lookup=explode)


def test_host_exists_needs_a_hostname_at_all():
    from concierge.identity import host_exists

    assert not host_exists("not-a-url")
    assert not host_exists("")


def test_host_exists_against_real_dns():
    """No stub. The only test here that asks a resolver what is actually true.

    Every other DNS answer in this file is one this file wrote, which is right
    for testing the *decision* and proves nothing about whether host_exists can
    tell a real name from a missing one — the thing it exists to do, and the
    thing that failed in production.

    Both answers are guaranteed by standard rather than by this test:

    * ``example.com`` is reserved by RFC 2606 §3 and operated by IANA.
    * ``.invalid`` is reserved by RFC 2606 §2 and "guaranteed not to be
      installed", so no resolver may ever return an address for it.

    Skipped, not failed, with no resolver: a suite that cannot run on a train is
    a suite people stop running.
    """
    from concierge.identity import host_exists

    try:
        socket.getaddrinfo("example.com", None)
    except OSError:
        pytest.skip("no DNS resolver available")

    assert host_exists("https://example.com/c.json"), "a name IANA operates must read as existing"
    assert not host_exists("https://nanda-demo-concierge.invalid/c.json"), (
        "an RFC 2606 .invalid name must read as missing"
    )
