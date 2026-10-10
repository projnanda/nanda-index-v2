"""Cross-organisation capability search.

No autouse network stub, per this repo's convention: each test says which
collaborator it replaces, in the test, where a reader can see it.
"""

from __future__ import annotations

import pytest

from concierge import capabilities
from concierge.discovery import entry_claims, find_agent_by_capability


def _catalog(org: str, *entries: dict) -> dict:
    return {
        "url": f"https://{org}.test/.well-known/ai-catalog.json",
        "entries": list(entries),
        "visible": len(entries),
        "withheld": 0,
        "omitted": 0,
    }


def _entry(identifier: str, tags: list[str], *, url: str | None = None) -> dict:
    """One catalog entry.

    The address is derived from the identifier rather than shared, because every
    agent having the same card URL made the AgentFacts stub resolve all of them
    to whichever entry it found first — and the tests passed anyway.
    """
    payload: dict = {"identifier": identifier, "displayName": identifier.title(), "tags": tags}
    if url != "":
        payload["url"] = url or f"https://{identifier}.test/card.json"
    return payload


@pytest.fixture
def three_orgs(monkeypatch):
    """Three catalogs, served without a network.

    ``leadership`` is deliberately claimed twice and ``orbital-analysis`` once,
    because the interesting behaviours differ between those two cases.
    """
    catalogs = {
        "https://regentix.test": _catalog(
            "regentix",
            _entry("regentix-ceo", ["leadership", "strategy"]),
            _entry("regentix-cto", ["engineering"]),
        ),
        "https://astrocity.test": _catalog(
            "astrocity",
            _entry("astrocity-chief-scientist", ["orbital-analysis", "peer-review"]),
        ),
        "https://rocketbrain.test": _catalog(
            "rocketbrain",
            _entry("rocketbrain-ceo", ["leadership", "vision"]),
        ),
    }
    down: dict[str, str] = {}

    def fake(url, *, timeout=20.0):
        if url in down:
            raise OSError(down[url])
        return catalogs[url]

    monkeypatch.setattr(capabilities, "org_catalog", fake)

    # Agents publish their own skills. By default they agree with the catalog, so
    # a test that does not care about divergence need not arrange one — but they
    # are served from AgentFacts, because without this every test would exercise
    # the catalog fallback instead of the path the code takes for real.
    from concierge.agentfacts import Facts

    def fake_facts(card_url, *, timeout=20.0):
        for catalog in catalogs.values():
            for entry in catalog["entries"]:
                if entry.get("url") == card_url:
                    skills = entry.get("skills")
                    if skills is None:
                        skills = entry.get("tags") or []
                    return Facts(
                        url=f"{card_url}#facts",
                        did="did:key:zStub",
                        label=str(entry.get("identifier") or ""),
                        skills=tuple(str(x).strip().lower() for x in skills),
                    )
        raise capabilities.AgentFactsError(f"no agent at {card_url}")

    monkeypatch.setattr(capabilities, "facts_for", fake_facts)
    return {
        "regentix": "https://regentix.test",
        "astrocity": "https://astrocity.test",
        "rocketbrain": "https://rocketbrain.test",
    }, down


def test_a_capability_only_one_organisation_claims_finds_that_one(three_orgs):
    orgs, _ = three_orgs
    result = capabilities.search("orbital-analysis", orgs=orgs)
    assert [(m.org, m.identifier) for m in result.matches] == [("astrocity", "astrocity-chief-scientist")]
    assert result.complete


def test_two_organisations_claiming_the_same_capability_both_come_back(three_orgs):
    """The whole point of searching across organisations rather than inside one.

    Returning the first match would make this look like a single answer, and the
    demo's booking hop would then be picking between two candidates it never
    showed anyone.
    """
    orgs, _ = three_orgs
    result = capabilities.search("leadership", orgs=orgs)
    assert [(m.org, m.identifier) for m in result.matches] == [
        ("regentix", "regentix-ceo"),
        ("rocketbrain", "rocketbrain-ceo"),
    ]
    assert result.orgs_claiming == ("regentix", "rocketbrain")


def test_an_organisation_that_does_not_answer_is_reported_not_dropped(three_orgs):
    """ "Nobody claims this" and "the organisation that does was down" differ."""
    orgs, down = three_orgs
    down["https://astrocity.test"] = "connection refused"

    result = capabilities.search("orbital-analysis", orgs=orgs)
    assert result.matches == ()
    assert not result.complete
    assert "astrocity" in result.unreachable
    assert "connection refused" in result.unreachable["astrocity"]
    # The two that did answer are still named, so a reader can see what was asked.
    assert set(result.searched) == {"regentix", "rocketbrain"}


def test_a_complete_empty_result_is_distinguishable_from_a_partial_one(three_orgs):
    orgs, down = three_orgs
    whole = capabilities.search("plumbing", orgs=orgs)
    assert whole.matches == () and whole.complete

    down["https://regentix.test"] = "timed out"
    partial = capabilities.search("plumbing", orgs=orgs)
    assert partial.matches == () and not partial.complete


def test_an_entry_with_no_address_is_not_offered_as_somewhere_to_send_a_request(monkeypatch):
    monkeypatch.setattr(
        capabilities,
        "org_catalog",
        lambda url, *, timeout=20.0: _catalog("x", _entry("ghost", ["leadership"], url="")),
    )
    result = capabilities.search("leadership", orgs={"x": "https://x.test"})
    assert result.matches == ()


def test_the_search_and_the_single_org_hop_use_the_same_matching_rule(three_orgs):
    """Two copies of this rule is the defect the slot fold already cost us once.

    If these ever disagree, an agent is findable through the page and invisible
    to the booking run, or the reverse — and both look correct in isolation.
    """
    orgs, _ = three_orgs
    catalog = _catalog("regentix", _entry("regentix-ceo", ["leadership", "strategy"]))
    for term in ("leadership", "LEADERSHIP", " strategy ", "plumbing", "lead"):
        by_hop = find_agent_by_capability(catalog, term)
        by_search = capabilities.search(term, orgs={"regentix": "https://regentix.test"})
        found_by_search = any(m.identifier == "regentix-ceo" for m in by_search.matches)
        assert (by_hop is not None) == found_by_search, f"the two disagree on {term!r}"


# ── the matching rule itself ────────────────────────────────────────────────


def test_a_capability_is_matched_whole_not_as_a_substring():
    """``leadership`` must not match ``thought-leadership``: a different claim."""
    entry = _entry("x", ["thought-leadership"])
    assert not entry_claims(entry, "leadership")
    assert entry_claims(_entry("x", ["leadership"]), "leadership")


def test_matching_ignores_case_and_surrounding_space():
    entry = _entry("x", ["  Orbital-Analysis "])
    assert entry_claims(entry, "orbital-analysis")
    assert entry_claims(entry, " ORBITAL-ANALYSIS ")


def test_an_empty_capability_matches_nothing_even_against_an_empty_tag():
    """The guard earns its place only here, which is why the test says so.

    Against ordinary tags an empty query cannot match anyway — list membership
    of "" is false. It matches when a catalog publishes an empty tag, which is
    real enough that ``vocabulary`` skips them. Without the guard, a blank
    search box would then return that agent.
    """
    assert not entry_claims(_entry("x", ["", "leadership"]), "")
    assert not entry_claims(_entry("x", ["leadership", " "]), "   ")
    assert not entry_claims(_entry("x", ["leadership"]), "")


def test_an_entry_with_no_tags_claims_nothing():
    assert not entry_claims({"identifier": "x"}, "leadership")


# ── the published vocabulary ────────────────────────────────────────────────


def test_the_vocabulary_names_every_organisation_that_claims_a_term(three_orgs):
    orgs, _ = three_orgs
    vocab = capabilities.vocabulary(orgs=orgs)
    assert vocab["leadership"] == ["regentix", "rocketbrain"]
    assert vocab["orbital-analysis"] == ["astrocity"]


def test_the_vocabulary_is_sorted_so_the_suggestion_list_is_stable(three_orgs):
    orgs, _ = three_orgs
    names = list(capabilities.vocabulary(orgs=orgs))
    assert names == sorted(names)


def test_an_organisation_that_is_down_does_not_take_the_vocabulary_with_it(three_orgs):
    orgs, down = three_orgs
    down["https://regentix.test"] = "timed out"
    vocab = capabilities.vocabulary(orgs=orgs)
    assert "orbital-analysis" in vocab
    assert "leadership" in vocab and vocab["leadership"] == ["rocketbrain"]


def test_an_empty_skill_is_not_offered_as_a_searchable_capability(monkeypatch):
    """An agent may publish one; a blank entry in the suggestion list is noise."""
    from concierge.agentfacts import Facts

    monkeypatch.setattr(
        capabilities,
        "org_catalog",
        lambda url, *, timeout=20.0: _catalog("x", _entry("a", ["leadership"])),
    )
    monkeypatch.setattr(
        capabilities,
        "facts_for",
        lambda card_url, *, timeout=20.0: Facts(url=card_url, skills=("", "  ", "leadership")),
    )
    vocab = capabilities.vocabulary(orgs={"x": "https://x.test"})
    assert list(vocab) == ["leadership"]


def test_searching_no_organisations_at_all_is_an_empty_result_not_a_crash():
    """Reachable if the roster is ever configured empty; it must not throw."""
    result = capabilities.search("leadership", orgs={})
    assert result.matches == () and result.searched == ()
    assert result.complete, "nothing was unreachable — there was nothing to reach"
    assert capabilities.vocabulary(orgs={}) == {}


# ── what the page is handed ─────────────────────────────────────────────────


def test_a_result_serialises_everything_a_reader_needs_to_check_it(three_orgs):
    """Including the catalog URL: a claim nobody can go and read is not evidence."""
    orgs, down = three_orgs
    down["https://rocketbrain.test"] = "timed out"
    payload = capabilities.search("leadership", orgs=orgs).to_dict()

    assert payload["capability"] == "leadership"
    assert payload["complete"] is False
    assert payload["unreachable"]["rocketbrain"] == "OSError: timed out"
    assert payload["orgs_claiming"] == ["regentix"]

    match = payload["matches"][0]
    assert match["org"] == "regentix"
    assert match["identifier"] == "regentix-ceo"
    assert match["display_name"] == "Regentix-Ceo"
    assert match["url"].startswith("https://")
    assert "leadership" in match["tags"]
    assert match["catalog_url"].endswith("/.well-known/ai-catalog.json")


# ── against the documents the organisations actually serve ──────────────────
#
# The fixtures above are hand-written, which is right for testing the search's
# behaviour — refusals, outages, multiple claimants — but they are a shape this
# file invented. The real entries carry mediaType, description and version as
# well, and a test that only ever sees the invented shape keeps passing after
# the real one changes.
#
# tests/fixtures/catalog-*.json are the live documents, captured verbatim.


def _live(org: str) -> dict:
    import json
    from pathlib import Path

    raw = json.loads((Path(__file__).parent / "fixtures" / f"catalog-{org}.json").read_text())
    entries = raw.get("entries") or []
    return {
        "url": f"https://{org}.invalid/.well-known/ai-catalog.json",
        "entries": entries,
        "visible": len(entries),
        "withheld": raw.get("withheldMembers", 0),
        "omitted": raw.get("omittedMembers", 0),
    }


@pytest.fixture
def live_orgs(monkeypatch):
    served = {f"https://{o}.test": _live(o) for o in ("regentix", "astrocity", "rocketbrain")}
    monkeypatch.setattr(capabilities, "org_catalog", lambda url, *, timeout=20.0: served[url])
    return {o: f"https://{o}.test" for o in ("regentix", "astrocity", "rocketbrain")}


def test_the_real_catalogs_carry_fields_the_handwritten_fixtures_do_not():
    """If this fails, the fixtures are stale and every test above proves less."""
    entry = _live("astrocity")["entries"][0]
    for field_name in ("identifier", "displayName", "mediaType", "url", "description", "tags", "version"):
        assert field_name in entry, f"the live catalog no longer carries {field_name!r}"


def test_the_lunch_guest_is_findable_by_capability_in_the_real_catalog(live_orgs):
    """The demo's actual contract: the scientist is found by what they do.

    Pinned deliberately. If AstroCity stops publishing orbital-analysis for this
    agent, the walkthrough's discovery step stops meaning what it says, and that
    should fail here rather than in front of an audience.
    """
    result = capabilities.search("orbital-analysis", orgs=live_orgs)
    assert [(m.org, m.identifier) for m in result.matches] == [("astrocity", "astrocity-chief-scientist")]
    assert result.matches[0].display_name == "Chief Scientist"
    assert result.matches[0].url.startswith("https://")


def test_two_real_organisations_claim_leadership(live_orgs):
    """Measured, not arranged: both chief executives publish the same tag."""
    result = capabilities.search("leadership", orgs=live_orgs)
    assert result.orgs_claiming == ("regentix", "rocketbrain")
    assert {m.identifier for m in result.matches} == {"regentix-ceo", "rocketbrain-ceo"}


def test_every_real_entry_the_search_returns_has_somewhere_to_send_a_request(live_orgs):
    for term in ("strategy", "engineering", "leadership", "orbital-analysis"):
        for match in capabilities.search(term, orgs=live_orgs).matches:
            assert match.url.startswith("https://"), f"{match.identifier} has no usable address"
            assert match.identifier and match.display_name


def test_the_real_vocabulary_is_large_enough_to_be_worth_searching(live_orgs):
    """A loose floor, not a pinned count: the roster changes, the point does not."""
    vocab = capabilities.vocabulary(orgs=live_orgs)
    assert len(vocab) > 30, "the organisations have stopped publishing capability tags"
    assert vocab["orbital-analysis"] == ["astrocity"]
    assert len(vocab["strategy"]) == 3, "strategy is the term all three publish"


# ── the agent is the authority on what the agent does ───────────────────────


def _diverging(monkeypatch, *, tags, skills):
    """One organisation whose catalog and whose agent disagree."""
    entry = _entry("someone", tags)
    entry["skills"] = skills
    monkeypatch.setattr(capabilities, "org_catalog", lambda url, *, timeout=20.0: _catalog("x", entry))
    from concierge.agentfacts import Facts

    monkeypatch.setattr(
        capabilities,
        "facts_for",
        lambda card_url, *, timeout=20.0: Facts(url=f"{card_url}#facts", skills=tuple(skills)),
    )
    return {"x": "https://x.test"}


def test_a_capability_only_the_organisation_claims_is_not_a_match(monkeypatch):
    """Measured on the live estate: Regentix attributes ``positioning`` to two
    agents and neither claims it. Searching it used to return both."""
    orgs = _diverging(monkeypatch, tags=["leadership", "positioning"], skills=["leadership"])
    assert capabilities.search("positioning", orgs=orgs).matches == ()
    assert len(capabilities.search("leadership", orgs=orgs).matches) == 1


def test_a_match_says_the_agent_claimed_it(monkeypatch):
    orgs = _diverging(monkeypatch, tags=["leadership"], skills=["leadership"])
    match = capabilities.search("leadership", orgs=orgs).matches[0]
    assert match.source == capabilities.BY_AGENT
    assert match.facts_url.endswith("#facts"), "a reader must be able to go and check"


def test_the_disagreement_is_reported_rather_than_quietly_resolved(monkeypatch):
    """An organisation claiming more for an agent than the agent claims for
    itself is a finding. Preferring one source silently would hide it."""
    orgs = _diverging(monkeypatch, tags=["leadership", "positioning"], skills=["leadership", "mentoring"])
    result = capabilities.search("leadership", orgs=orgs)
    assert len(result.divergences) == 1
    d = result.divergences[0]
    assert d.org_only == ("positioning",)
    assert d.agent_only == ("mentoring",)
    assert result.to_dict()["divergences"][0]["claimed_by_org_only"] == ["positioning"]


def test_agreement_produces_no_divergence(monkeypatch):
    orgs = _diverging(monkeypatch, tags=["leadership"], skills=["leadership"])
    assert capabilities.search("leadership", orgs=orgs).divergences == ()


def test_an_agent_that_cannot_be_asked_falls_back_but_says_so(monkeypatch):
    """The catalog is better than nothing, and must not read like the agent's
    own word. A match sourced from the organisation says ``org``."""
    monkeypatch.setattr(
        capabilities,
        "org_catalog",
        lambda url, *, timeout=20.0: _catalog("x", _entry("someone", ["leadership"])),
    )

    def unreachable(card_url, *, timeout=20.0):
        raise capabilities.AgentFactsError("connection refused")

    monkeypatch.setattr(capabilities, "facts_for", unreachable)
    result = capabilities.search("leadership", orgs={"x": "https://x.test"})

    assert len(result.matches) == 1
    assert result.matches[0].source == capabilities.BY_ORG
    assert result.matches[0].skills == (), "no skills were read, so none are claimed"
    assert "someone" in result.unverified
    assert "refused" in result.unverified["someone"]


def test_an_unreachable_agent_contributes_nothing_to_the_vocabulary(monkeypatch):
    """A suggestion list is a promise that searching a term finds something. A
    term only the catalog carries breaks that promise."""
    monkeypatch.setattr(
        capabilities,
        "org_catalog",
        lambda url, *, timeout=20.0: _catalog("x", _entry("someone", ["leadership"])),
    )

    def unreachable(card_url, *, timeout=20.0):
        raise capabilities.AgentFactsError("down")

    monkeypatch.setattr(capabilities, "facts_for", unreachable)
    assert capabilities.vocabulary(orgs={"x": "https://x.test"}) == {}
