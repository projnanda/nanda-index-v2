"""The scenario, and the promise that a refusal never takes the run with it."""

from __future__ import annotations

import pytest

from concierge import discovery, lunch
from concierge.lunch import arrange
from concierge.receipts import ReceiptChain, verify
from concierge.transport import Answer

#: The principal every receipt is issued for. A real did:key, because ARP
#: rejects a readable label and the venue validates the same thing.
HOST = "did:key:z6MktMyEoA64WSk5WuaxZvKyobsaHhL3rJQS8uxkV3ixvHqQ"


def test_a_whole_run_produces_a_chain_that_verifies(me, wired, guests, public_key_b64):
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    entries = [e.to_dict() for e in plan.chain.entries]
    ok, why = verify(entries, public_key_b64=public_key_b64)
    assert ok, why
    # The table is HELD, not booked: the host has agreed and the guests have not.
    # It used to report a booking, because the concierge abandoned the joint hold
    # and took a second one naming only itself.
    assert plan.booked_start is None
    held = [e for e in plan.chain.entries if e.step == "venue.book"][0]
    assert "waiting on" in held.outcome


def test_the_attempt_to_consent_as_a_guest_is_recorded_as_a_refusal_that_should_happen(
    me, wired, guests, fake_venue
):
    peers, state = wired
    venue = fake_venue(open_slots={"table-4": ["12:00"]})
    state["venue"] = venue
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    step = [e for e in plan.chain.entries if e.step == "venue.consent.as_guest"][0]
    assert step.outcome.lower().startswith("refused, as it should be")
    # Two consents are attempted: the host's, on a grant the host signed, and a
    # guest's, on nothing. Only the first is recorded by the venue.
    host, guest = venue.consent_calls
    assert host.startswith("did:key:"), "the host consents under its own key"
    assert guest == "regentix-ceo"
    assert venue.consented == [host], "only the grant-backed consent was accepted"


def test_a_venue_that_refuses_everything_still_produces_a_chain(me, wired, guests, fake_venue):
    _, state = wired
    state["venue"] = fake_venue(open_slots={"table-4": ["12:00"]}, hold_ok=False)
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    assert plan.booked_start is None
    assert any("refused" in e.outcome.lower() for e in plan.chain.entries)
    # The run finished. A scenario that aborted on the first refusal would
    # produce no evidence about the refusal.
    assert [e.step for e in plan.chain.entries][-1] == "venue.book"


def test_every_table_being_full_is_reported_rather_than_read_as_a_broken_venue(me, wired, guests, fake_venue):
    _, state = wired
    state["venue"] = fake_venue(open_slots={})
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4", "table-7"],
    )
    assert plan.booked_start is None
    assert "2 tables" in plan.notes[-1] and "taken" in plan.notes[-1]
    # Each full table is its own entry.
    assert len([e for e in plan.chain.entries if e.step == "venue.availability"]) == 2


def test_a_spent_peer_budget_is_not_counted_as_the_org_having_answered(me, wired, guests):
    peers, state = wired
    state["answers"] = {
        "submit_intent": (
            Answer(ok=True, result={}),
            {"response": "LLM error: this cycle has made 60 LLM calls"},
        )
    }
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    assert plan.notes[0].startswith("0 of 2 organisations recorded")
    step = [e for e in plan.chain.entries if e.step == "ask.intent"][0]
    assert "run out of thinking time" in step.outcome


def test_an_index_outage_does_not_stop_the_run(me, wired, guests, monkeypatch):
    def boom(*_a, **_k):
        raise OSError("index unreachable")

    monkeypatch.setattr(lunch, "search_capability", boom)
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    assert any("could not reach" in e.outcome.lower() for e in plan.chain.entries)
    # The run finished and still reached the restaurant.
    assert any("held" in n.lower() for n in plan.notes)


def test_the_guests_addresses_are_marked_configured_not_discovered(me, wired, guests):
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    ask = [e for e in plan.chain.entries if e.step == "ask.intent"][0]
    assert ask.request["peer"]["how"] == "configured"
    org = [e for e in plan.chain.entries if e.step == "discover.organisation"][0]
    assert org.answer["matches"][0]["how"] == "searched"


def test_the_result_notes_are_written_for_a_person_not_a_protocol(me, wired, guests):
    """The notes render on the demo page, under the booking.

    "Slot fold" is the internal name for the digest both sides use to identify a
    sitting. It belongs in the receipt, where it is checkable, not in a line
    somebody reads to find out whether lunch is booked.
    """
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    joined = " ".join(plan.notes).lower()
    for jargon in ("slot fold", "principal", "did:key", "urn:", "-32004"):
        assert jargon not in joined, f"{jargon!r} leaked into a note shown to a person"
    assert any("table for" in n.lower() for n in plan.notes), (
        "the notes must say where the table stands, not leave it to be inferred"
    )


# ── locating a guest's agent: one hop each ──────────────────────────────────


def _catalog_with(identifier: str, tags: list[str], url: str) -> dict:
    return {
        "url": "https://org.test/.well-known/ai-catalog.json",
        "entries": [{"identifier": identifier, "tags": tags, "url": url}],
        "visible": 2,
        "withheld": 0,
        "omitted": 0,
    }


def test_the_v2_guest_is_found_by_capability_in_the_org_catalog(me, monkeypatch):
    """The four-hop walk, which is the only one that answers 'which agent does X'."""
    guest = lunch.Guest(
        who="the CEO",
        company="Test Co",
        org_query="regentix",
        agent_label="regentix-ceo",
        via=lunch.VIA_INDEX_V2,
        capability="leadership",
        agent_url="https://configured.test",
    )
    chain = ReceiptChain(private_key=me.seed, principal_did=HOST)
    monkeypatch.setattr(
        lunch,
        "endpoint_from_card",
        lambda url, **_: ("https://ceo.test", {"name": "CEO", "url": "https://ceo.test"}),
    )

    found = lunch._locate(
        guest,
        chain,
        index_v3="https://ix.test",
        catalogs={
            "regentix-ceo": _catalog_with(
                "regentix-ceo", ["leadership", "strategy"], "https://cards.test/ceo.json"
            )
        },
    )
    assert found.url == "https://ceo.test"
    assert found.how == "searched", "a discovered address must not be recorded as configured"
    step = chain.entries[-1]
    assert step.request["via"] == lunch.VIA_INDEX_V2
    assert "leadership" in step.outcome


def test_the_v3_guest_is_found_by_resolving_its_key_anchored_name(me, monkeypatch):
    """One hop, and it answers only 'where is this agent' — all that index undertakes."""
    urn = "urn:ai:key:uABC/agent"
    guest = lunch.Guest(
        who="the scientist",
        company="Test Co",
        org_query="astrocity",
        agent_label="astrocity-chief-scientist",
        via=lunch.VIA_INDEX_V3,
        urn=urn,
        agent_url="https://configured.test",
    )
    chain = ReceiptChain(private_key=me.seed, principal_did=HOST)
    monkeypatch.setattr(
        lunch, "resolve_pointer", lambda u, **_: {"next_hop": "https://cards.test/sci.json", "seq": 1}
    )
    monkeypatch.setattr(
        lunch, "endpoint_from_card", lambda url, **_: ("https://sci.test", {"name": "Chief Scientist"})
    )

    found = lunch._locate(guest, chain, index_v3="https://ix.test", catalogs={})
    assert found.url == "https://sci.test"
    assert found.how == "resolved" and found.urn == urn
    assert chain.entries[-1].request["via"] == lunch.VIA_INDEX_V3


def test_each_guest_uses_a_different_index(guests):
    """A run that used the same mechanism twice would demonstrate it once."""
    from concierge import config

    assert {g.via for g in config.DEFAULT_GUESTS} == {lunch.VIA_INDEX_V2, lunch.VIA_INDEX_V3}


def test_a_failed_hop_falls_back_and_says_it_was_configured(me, monkeypatch):
    """The fallback is not a rescue. A weaker claim has to read as weaker."""
    guest = lunch.Guest(
        who="x",
        company="Test Co",
        org_query="o",
        agent_label="a",
        via=lunch.VIA_INDEX_V3,
        urn="urn:ai:key:uNOPE/agent",
        agent_url="https://configured.test",
    )
    chain = ReceiptChain(private_key=me.seed, principal_did=HOST)

    def gone(*_a, **_k):
        # Raised from the discovery module, which is where it is defined; lunch
        # catches broadly and does not re-export it.
        raise discovery.DiscoveryError("resolves to nothing")

    monkeypatch.setattr(lunch, "resolve_pointer", gone)
    found = lunch._locate(guest, chain, index_v3="https://ix.test", catalogs={})

    assert found.url == "https://configured.test"
    assert found.how == "configured"
    assert "Could not find" in chain.entries[-1].outcome
    assert chain.entries[-1].not_claimed == ("That this address was discovered. It was supplied.",)


def test_a_capability_no_agent_claims_is_not_silently_matched(me):
    guest = lunch.Guest(
        who="x",
        company="Test Co",
        org_query="o",
        agent_label="a",
        via=lunch.VIA_INDEX_V2,
        capability="plumbing",
        agent_url="https://configured.test",
    )
    chain = ReceiptChain(private_key=me.seed, principal_did=HOST)
    found = lunch._locate(
        guest,
        chain,
        index_v3="https://ix.test",
        catalogs={"a": _catalog_with("a", ["leadership"], "https://cards.test/a.json")},
    )
    assert found.how == "configured"
    assert "plumbing" in chain.entries[-1].outcome


def test_the_catalog_caption_describes_the_document_it_read(me, wired, guests, monkeypatch):
    """A caption that describes the wrong one makes a closed directory look open."""
    monkeypatch.setattr(
        lunch,
        "org_catalog",
        lambda url, **_: {
            "url": url,
            "entries": [{"identifier": "org"}, {"identifier": "a"}, {"identifier": "b"}],
            "visible": 3,
            "withheld": 0,
            "omitted": 0,
        },
    )
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    out = [e.outcome for e in plan.chain.entries if e.step == "discover.catalog"][0]
    assert "publishes 3 listings" in out and "not listed publicly" not in out

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
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    out = [e.outcome for e in plan.chain.entries if e.step == "discover.catalog"][0]
    assert "5 agents are not listed publicly" in out


# ── was the agent allowed to do any of this? ────────────────────────────────


def _authorised(entries, granted, *, dat_aware=True):
    """Run each receipt through ARP's authority check against the host's grant."""
    from sm_arp import verify_authority_chain
    from sm_dat import make_dat_verifier

    grants = {granted["receipt"]["receipt_id"]: granted["receipt"]}
    kwargs = {}
    if dat_aware:
        kwargs = {
            "dats": {granted["dat"]["grant_id"]: granted["dat"]},
            "dat_verifier": make_dat_verifier(),
        }
    for index, raw in enumerate(entries):
        result = verify_authority_chain(raw, grants, **kwargs)
        if not result.ok:
            label = (raw["action"].get("machine_payload") or {}).get("action_type_label")
            return False, f"entry {index} ({label}): {result.detail}"
    return True, f"{len(entries)} receipts are covered by the grant"


def test_every_receipt_in_a_real_run_is_covered_by_the_hosts_grant(me, wired, guests, granted):
    """The whole point of the DAT, exercised against a run rather than a fixture.

    This checks the rich path: sm-dat evaluates the counterparty allowlist, which
    fails **closed**. A step that names nobody, or names somebody the host did not
    authorise, is VIOLATED — so this is also the test that a new step cannot be
    added without saying where it went.
    """
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    entries = [e.to_dict() for e in plan.chain.entries]
    ok, why = _authorised(entries, granted)
    assert ok, why


def test_every_receipt_points_at_the_grant_rather_than_claiming_standing_authority(me, wired, guests, granted):
    """An absent ``granted_by_receipt_id`` is not a gap ARP complains about — it
    reads as standing authority, which is a *stronger* claim than the truth. A
    step that forgot it would quietly assert more than one that has it."""
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    expected = granted["receipt"]["receipt_id"]
    for entry in plan.chain.entries:
        gid = entry.to_dict()["action"].get("granted_by_receipt_id")
        assert gid == expected, f"{entry.step} does not point at the grant"


def test_a_run_is_refused_when_the_grant_names_a_different_agent(me, wired, guests, monkeypatch):
    """Refused before booking, not discovered by a verifier afterwards."""
    from concierge import authority

    other = dict(authority.grant())
    other["grantee_did"] = "did:key:z6MkSomebodyElseEntirely"
    monkeypatch.setattr(authority, "grant", lambda: other)

    with pytest.raises(authority.AuthorityError, match="authorises"):
        arrange(
            me,
            guests=guests,
            venue_url="https://v.test",
            date="2026-10-02",
            candidate_starts=["12:00"],
            resources=["table-4"],
        )
