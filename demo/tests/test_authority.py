"""The grant, and the three ways of holding the wrong one.

The autouse ``granted`` fixture supplies a real signed DAT for the test key, so
these exercise the loader and the checks rather than a stub.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib

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
    monkeypatch.setenv("CONCIERGE_AUTHORITY", str(tmp_path))
    with pytest.raises(authority.AuthorityError, match="mint_grant"):
        authority._load("grant.json")


# ── a second deployment is a second agent, and can be one ───────────────────
#
# The gap these close: a copy of this repo generates its own key, so it is its
# own agent, and the grant committed here names the reference deployment. The
# run refused — correctly — and nothing said how to get a grant of its own, so
# the second deployment of this repo stopped there.


def test_the_grant_directory_defaults_to_the_committed_artifacts():
    """The reference deployment keeps working with nothing set, which is the
    whole reason the committed artifacts stay committed."""
    monkeypatch_free = authority.authority_dir()
    assert monkeypatch_free == pathlib.Path(authority.__file__).resolve().parent / "authority"
    assert (monkeypatch_free / "grant.json").is_file()


def test_a_second_deployment_reads_its_own_grant_not_the_committed_one(granted, monkeypatch, tmp_path):
    """CONCIERGE_AUTHORITY moves the grant off the tracked path, so a second
    deployment mints its own instead of overwriting an artifact that belongs to
    another agent.

    Through ``granted["shipped"]`` — the REAL cached loader, not the fixture's
    lambda. Loading the fixture's grant would prove nothing about where a
    deployment reads from.
    """
    real_grant = granted["shipped"]["grant"]
    mine = {"grantee_did": "did:key:z6MkMine", "scope": {"action_categories": []}}
    (tmp_path / "grant.json").write_text(json.dumps(mine))
    monkeypatch.setenv("CONCIERGE_AUTHORITY", str(tmp_path))
    real_grant.cache_clear()
    try:
        assert authority.authority_dir() == tmp_path
        assert real_grant()["grantee_did"] == "did:key:z6MkMine"
    finally:
        real_grant.cache_clear()


def test_the_mismatch_refusal_names_the_command_that_fixes_it(granted, monkeypatch):
    """A refusal that names the problem and not the remedy is where someone
    holding a copy of this repo stops. The message has to carry the way out, and
    say that this is a different agent rather than a broken one."""
    monkeypatch.setattr(authority, "grant", lambda: {"grantee_did": "did:key:z6MkTheReferenceDeployment"})
    with pytest.raises(authority.AuthorityError) as caught:
        authority.check_grant_covers("did:key:z6MkThisCopy")

    message = str(caught.value)
    assert "mint_grant.py" in message, "the refusal must name the tool that mints a grant"
    assert "AGENT_DID" in message, "and how to tell it which key to mint for"
    assert "different agent" in message
    # No escape hatch is advertised, because none exists: running on a grant
    # addressed to somebody else is the one thing this check is for.
    assert "skip" in message and "no flag" in message


def test_minting_and_loading_cannot_disagree_about_where_the_grant_lives(granted, monkeypatch, tmp_path):
    """The tool writes where the agent reads. Two paths would be the "one
    contract in two places" defect: minted into one directory, loaded from
    another, and both look right alone."""
    monkeypatch.setenv("CONCIERGE_AUTHORITY", str(tmp_path))
    spec = importlib.util.spec_from_file_location(
        "_mint_grant", pathlib.Path(__file__).resolve().parent.parent / "tools" / "mint_grant.py"
    )
    mint = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mint)

    agent_did = "did:key:z6MkiHzPvgJZL8Dp4UwV7PUGQJVPCJX8DZxMhx1Fj1JwDQKe"
    monkeypatch.setenv("AGENT_DID", agent_did)
    monkeypatch.delenv("HOST_SEED", raising=False)
    assert mint.main([]) == 0

    assert (tmp_path / "grant.json").is_file(), "minted outside the directory the agent reads"
    assert (tmp_path / "grant-receipt.json").is_file()

    # The round trip: what the tool wrote is what the check accepts. Against the
    # real loaders, with the fixture's lambdas put back for the rest of the run.
    real_grant, real_receipt = granted["shipped"]["grant"], granted["shipped"]["grant_receipt"]
    real_grant.cache_clear()
    real_receipt.cache_clear()
    monkeypatch.setattr(authority, "grant", real_grant)
    monkeypatch.setattr(authority, "grant_receipt", real_receipt)
    try:
        authority.check_grant_covers(agent_did)
    finally:
        real_grant.cache_clear()
        real_receipt.cache_clear()


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
