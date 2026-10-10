"""The grant, and the three ways of holding the wrong one.

The autouse ``granted`` fixture supplies a real signed DAT for the test key, so
these exercise the loader and the checks rather than a stub.
"""

from __future__ import annotations

import json

import pytest

from concierge import authority


def test_the_committed_artifacts_load_and_agree_with_each_other(granted):
    """The two files that actually ship in the container, read off disk.

    Not the fixture's grant: these are the artifacts a deployment runs under, and
    a pair that disagreed would refuse every run in production while every test
    passed against a freshly minted one.
    """
    dat = granted["shipped"]["grant"]()
    receipt = granted["shipped"]["grant_receipt"]()
    payload = receipt["action"]["machine_payload"]

    assert receipt["action"]["category"] == "authority_granted"
    assert payload["granted_to_did"] == dat["grantee_did"]
    assert payload["grant_expires_at"] == dat["not_after"]
    assert set(payload["granted_scope"]) == set(dat["scope"]["action_categories"])
    # The receipt commits to the DAT, so the two cannot be separated or swapped.
    from sm_arp import dat_digest

    assert payload["dat_digest"] == dat_digest(dat)


def test_the_host_is_read_from_the_grant_not_from_a_seed(granted):
    """A host key this process could reach is not a host."""
    assert authority.host_did() == granted["receipt"]["principal_did"]
    assert authority.host_did() == granted["host"].did


def test_a_grant_for_another_key_is_refused(granted, monkeypatch):
    other = dict(granted["dat"], grantee_did="did:key:z6MkNotThisAgent")
    monkeypatch.setattr(authority, "grant", lambda: other)
    with pytest.raises(authority.AuthorityError, match="authorises"):
        authority.check_grant_covers(granted["dat"]["grantee_did"])


def test_artifacts_that_disagree_with_each_other_are_refused(granted, monkeypatch):
    """The DAT and the receipt committing to it must name the same grantee; a
    stale pair is a grant nobody actually issued for this key."""
    stale = json.loads(json.dumps(granted["receipt"]))
    stale["action"]["machine_payload"]["granted_to_did"] = "did:key:z6MkSomeoneElse"
    monkeypatch.setattr(authority, "grant_receipt", lambda: stale)
    with pytest.raises(authority.AuthorityError, match="stale"):
        authority.check_grant_covers(granted["dat"]["grantee_did"])


def test_a_missing_grant_is_a_refusal_with_somewhere_to_go(monkeypatch, tmp_path):
    """An agent with no grant refuses and says where one comes from."""
    monkeypatch.setattr(authority, "_HERE", tmp_path)
    with pytest.raises(authority.AuthorityError, match="mint_grant"):
        authority._load("grant.json")


def test_the_grant_is_no_wider_than_the_work_it_authorises(granted):
    """A grant covering categories the scenario never emits is authority nobody
    audited. Checked against a real run's categories, not against the list."""
    from concierge.receipts import CATEGORIES

    emitted = set(CATEGORIES.values())
    assert emitted <= set(authority.CATEGORIES), "a step emits a category the host did not grant"
    assert set(authority.CATEGORIES) == emitted, (
        f"the grant is wider than the scenario: {set(authority.CATEGORIES) - emitted}"
    )


def test_the_summary_says_the_grant_cannot_be_revoked(granted):
    """Stated, not left to be noticed. A grant with no revocation source can only
    expire, and a reader must not have to infer that from its absence."""
    assert authority.summary()["revocable"] is False
