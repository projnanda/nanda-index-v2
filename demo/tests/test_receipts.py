"""ARP receipts, and the three ways of breaking a chain that signatures alone miss.

These receipts are the published Agency Receipt Protocol, not a format this repo
invented — so the assertions here are about ARP's own verifier accepting and
rejecting them, and the field paths are ARP's.
"""

from __future__ import annotations

import json

import pytest

from concierge.receipts import ReceiptChain, canonical_bytes, category_for, outcome_for, verify

#: The principal every receipt is issued for. A real did:key, because ARP's
#: schema rejects a readable label and the venue validates the same thing.
HOST = "did:key:z6MktMyEoA64WSk5WuaxZvKyobsaHhL3rJQS8uxkV3ixvHqQ"


@pytest.fixture
def chain(seed) -> ReceiptChain:
    c = ReceiptChain(private_key=seed, principal_did=HOST)
    c.append(
        step="ask.intent",
        counterparty_label="venue:nanda-demo",
        request={"to": "ceo"},
        answer={"ok": True},
        outcome="recorded",
        not_claimed=("that the guest agreed",),
    )
    c.append(
        step="venue.book",
        counterparty_label="venue:nanda-demo",
        request={"to": "venue"},
        answer={"code": -32004},
        outcome="Could not book: register first",
    )
    c.append(
        step="venue.book",
        counterparty_label="venue:nanda-demo",
        request={"slot": "x"},
        answer={"ok": True},
        outcome="booked",
    )
    return c


def _entries(chain: ReceiptChain) -> list[dict]:
    return json.loads(chain.to_json())["entries"]


def test_a_clean_chain_verifies(chain):
    ok, why = verify(_entries(chain))
    assert ok, why


def test_the_receipts_are_what_arp_says_a_receipt_is(chain):
    """Against the library, not against this repo's idea of the shape."""
    import sm_arp

    for raw in _entries(chain):
        result = sm_arp.verify_receipt(raw, mode="strict")
        assert result.ok, f"{result.stage}: {result.detail}"
        assert raw["version"] == sm_arp.ARP_VERSION
        assert raw["principal_did"] == HOST
        assert raw["action"]["category"] in sm_arp.KNOWN_CATEGORIES
        assert raw["action"]["outcome"] in sm_arp.OUTCOMES


def test_the_issuer_is_the_key_that_signed_and_is_not_stated_twice(seed, chain):
    """A receipt whose issuer_did is not its signing key verifies in-process and
    fails the moment anyone else checks it. There is one source for it."""
    import sm_arp

    expected = sm_arp.did_from_sk(seed)
    assert chain.issuer == expected
    assert {e["issuer_did"] for e in _entries(chain)} == {expected}


def test_a_first_receipt_has_no_previous_hash_at_all(chain):
    """ "Chain start" and "the entry before this was deleted" must not look alike.

    ARP omits the field entirely rather than carrying an empty one, so the two
    cannot share a representation.
    """
    first, *rest = _entries(chain)
    assert "previous_receipt_hash" not in first
    assert all(e["previous_receipt_hash"].startswith("sha256:") for e in rest)


def test_editing_a_recorded_sentence_is_caught(chain):
    entries = _entries(chain)
    entries[1]["action"]["machine_payload"]["outcome_prose"] = "accepted"
    ok, why = verify(entries)
    assert not ok and "signature" in why.lower()


def test_deleting_the_refusal_is_caught(chain):
    # The point of the links. Every surviving signature still verifies, so
    # signatures alone would call this chain clean.
    entries = _entries(chain)
    ok, why = verify([entries[0], entries[2]])
    assert not ok


def test_reordering_is_caught(chain):
    entries = _entries(chain)
    ok, why = verify([entries[1], entries[0], entries[2]])
    assert not ok


def test_a_receipt_signed_by_another_key_is_caught(chain, seed):
    """ARP takes the key from issuer_did, so forging means changing both."""
    import sm_arp

    other = sm_arp.Identity.from_seed(bytes(range(31, -1, -1)))
    entries = _entries(chain)
    entries[1]["issuer_did"] = other.did
    ok, why = verify(entries)
    assert not ok and "signature" in why.lower()


def test_canonical_bytes_are_arps_own(chain):
    """One canonicaliser. A second that agrees today is what produced two
    unpairable receipts for one booking once already."""
    import sm_arp

    payload = {"b": 1, "a": 2}
    assert canonical_bytes(payload) == sm_arp.canonical_bytes(payload, include_signature=True)
    assert canonical_bytes({"b": 1, "a": 2}) == canonical_bytes({"a": 2, "b": 1})


def test_a_chain_cannot_be_signed_with_a_wrong_length_key():
    with pytest.raises(ValueError, match="32 bytes"):
        ReceiptChain(private_key=b"short", principal_did=HOST)


def test_every_entry_carries_what_it_does_not_claim(chain):
    first = _entries(chain)[0]
    assert first["action"]["machine_payload"]["not_claimed"] == ["that the guest agreed"]


def test_the_scenario_step_survives_the_mapping(chain):
    """``other`` is a real ARP category and loses the detail, so the step it came
    from has to be recoverable — under the spec's own key, which `arp verify`
    requires whenever the category is ``other``."""
    steps = [e["action"]["machine_payload"]["action_type_label"] for e in _entries(chain)]
    assert steps == ["ask.intent", "venue.book", "venue.book"]


# ── the two mappings, which are judgement and therefore pinned ──────────────


def test_booking_uses_the_same_category_the_venue_issues():
    """Two receipts for one booking that disagree about what happened prove
    nothing when paired.

    Pinned as a literal because the venue is a separate service, not an import.
    Its constant is ``CATEGORY_BOOKED`` in ``nanda-demo-venue``'s
    ``src/venue/receipts.py``; if that moves, this is the test that should say so.
    """
    assert category_for("venue.book") == "appointment_booked"


def test_a_hold_is_not_recorded_as_a_booking():
    """A hold is a commitment that is not yet a booking; calling it
    appointment_booked would claim the table twice in one chain."""
    assert category_for("venue.hold.multiparty") == "commitment_entered"
    assert category_for("venue.book") == "appointment_booked"


def test_an_unmapped_step_falls_back_rather_than_raising():
    assert category_for("does.not.exist") == "other"


def test_a_refusal_never_reads_as_success():
    for prose in (
        "Refused, as it should be. You can only speak for yourself.",
        "Could not find the agent",
        "Could not reach the index",
        "every table is taken",
        "the agent has run out of thinking time",
    ):
        assert outcome_for(prose) == "failed", prose


def test_a_plain_result_reads_as_completed():
    assert outcome_for("Booked table-4 at 12:00") == "completed"
    assert outcome_for("Table held. It needs all 3 people to agree.") == "completed"


def test_an_unclassifiable_outcome_is_not_called_completed():
    """The fallback must never assert success for something nobody classified."""
    assert outcome_for("") != "completed"
    assert outcome_for("   ") != "completed"


# ── the observation point the live view reads ───────────────────────────────


def test_every_appended_entry_is_offered_to_the_watcher(seed):
    seen = []
    chain = ReceiptChain(private_key=seed, principal_did=HOST, on_append=seen.append)
    chain.append(step="a", counterparty_label="venue:nanda-demo", request={}, answer={}, outcome="ok")
    chain.append(step="b", counterparty_label="venue:nanda-demo", request={}, answer={}, outcome="ok")

    # One observation point rather than a callback threaded through every call
    # site, so a step added to the scenario cannot be missed by the live view.
    assert [e.step for e in seen] == ["a", "b"]
    assert seen[0].digest.startswith("sha256:") and seen[0].signature


def test_the_watcher_sees_the_finished_entry_not_a_draft(seed):
    seen = []
    chain = ReceiptChain(private_key=seed, principal_did=HOST, on_append=seen.append)
    entry = chain.append(
        step="a", counterparty_label="venue:nanda-demo", request={"x": 1}, answer={}, outcome="ok"
    )

    # The page renders the digest and the link, so a draft would render a step
    # that cannot be verified against the chain it claims to belong to.
    assert seen[0] is entry
    assert seen[0].prev == ""


def test_a_watcher_that_raises_does_not_abandon_the_run(seed):
    """A disconnected browser must not stop a booking already in progress."""
    calls = []

    def hostile(entry):
        calls.append(entry.step)
        raise RuntimeError("the browser went away")

    chain = ReceiptChain(private_key=seed, principal_did=HOST, on_append=hostile)
    chain.append(
        step="venue.hold.multiparty",
        counterparty_label="venue:nanda-demo",
        request={},
        answer={},
        outcome="held",
    )
    chain.append(
        step="venue.book", counterparty_label="venue:nanda-demo", request={}, answer={}, outcome="booked"
    )

    assert calls == ["venue.hold.multiparty", "venue.book"], "the watcher stopped after it raised"
    ok, why = verify(json.loads(chain.to_json())["entries"])
    assert ok, why


def test_no_watcher_is_the_normal_case(seed):
    chain = ReceiptChain(private_key=seed, principal_did=HOST)
    chain.append(step="a", counterparty_label="venue:nanda-demo", request={}, answer={}, outcome="ok")
    assert len(chain.entries) == 1


# ── the rules the library does not enforce, and the CLI does ────────────────


def test_an_other_category_always_says_what_it_really_was(chain):
    """spec.md §4.3: category ``other`` **MUST** carry
    ``machine_payload.action_type_label``.

    ``sm_arp.verify_receipt`` does not check this; ``arp verify`` does. So a
    receipt missing it passes every in-process test and is rejected the moment
    anybody checks it with the published tool — which is the only check that
    matters, because it is the one a third party runs. This repo shipped exactly
    that for the length of one commit.
    """
    for raw in _entries(chain):
        action = raw["action"]
        label = (action.get("machine_payload") or {}).get("action_type_label")
        assert label, f"{action['category']} receipt has no action_type_label"
        if action["category"] == "other":
            assert isinstance(label, str) and label.strip(), "spec requires a non-empty string"


def test_no_category_this_scenario_uses_has_unmet_payload_requirements():
    """The other two conditional rules in the action schema, named so that using
    one of those categories later fails here rather than at a verifier."""
    from concierge.receipts import CATEGORIES

    needs_more = {"authority_granted", "authority_revoked"}
    used = set(CATEGORIES.values())
    assert not (used & needs_more), (
        f"{used & needs_more} require extra machine_payload fields "
        "(granted_scope/granted_to_did/grant_expires_at, revokes_receipt_id)"
    )


def test_the_readable_view_never_disagrees_with_what_was_signed(seed):
    """Every field the page shows is read back out of the signed receipt.

    The alternative — storing them alongside — is the shape that produced a
    receipt whose issuer_did was not the key that signed it. A view that can
    drift from its own evidence is not a view of the evidence.
    """
    chain = ReceiptChain(private_key=seed, principal_did=HOST)
    entry = chain.append(
        step="venue.consent.as_guest",
        counterparty_label="venue:nanda-demo",
        request={"hold_id": "h-1"},
        answer={"code": -32004},
        outcome="Refused, as it should be.",
        not_claimed=("that the guest agreed",),
    )
    raw = entry.to_dict()
    action = raw["action"]
    payload = action["machine_payload"]

    assert entry.at == raw["issued_at"]
    assert entry.human_summary == action["human_summary"]
    assert entry.arp_outcome == action["outcome"] == "failed"
    assert entry.outcome == payload["outcome_prose"] == "Refused, as it should be."
    assert entry.issuer == raw["issuer_did"] == chain.issuer
    assert entry.principal == raw["principal_did"] == chain.principal == HOST
    assert entry.step == payload["action_type_label"] == "venue.consent.as_guest"
    assert entry.request == payload["request"]
    assert entry.answer == payload["answer"]
    assert entry.not_claimed == ("that the guest agreed",)
    assert entry.signature == raw["signature"]
