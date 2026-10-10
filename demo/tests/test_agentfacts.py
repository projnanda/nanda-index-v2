"""Reading what an agent says about itself.

The two hops matter: this estate's catalog points sometimes at the live agent and
sometimes at a static card host, so ``agentfacts.json`` cannot be derived from the
catalog URL. Deriving it is how this was first written, and it 404'd on half the
agents while the search quietly fell back to the organisation's claims.
"""

from __future__ import annotations

import json

import pytest

from concierge import agentfacts
from concierge.agentfacts import AgentFactsError, Facts, facts_for, skill_name


def _serve(monkeypatch, pages: dict[str, object]):
    def fake(url, timeout):
        if url not in pages:
            raise OSError(f"404 {url}")
        value = pages[url]
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(agentfacts, "_get", fake)


def test_a_nanda_skill_urn_reduces_to_the_term_a_person_searches():
    assert skill_name("urn:nanda:skill:orbital-analysis") == "orbital-analysis"
    assert skill_name("URN:NANDA:SKILL:Leadership") == "leadership"


def test_a_bare_term_is_accepted_as_the_same_claim():
    """An agent publishing ``leadership`` rather than the URN is making the same
    claim; refusing to read it would be pedantry rather than rigour."""
    assert skill_name("leadership") == "leadership"
    assert skill_name("  Strategy ") == "strategy"


def test_facts_are_read_through_the_card_not_guessed_from_the_catalog_url(monkeypatch):
    """The catalog entry names a card host; the card names the agent."""
    _serve(
        monkeypatch,
        {
            "https://cards.test/regentix.ai/cto.json": {"url": "https://cto.test"},
            "https://cto.test/agentfacts.json": {
                "id": "did:key:zCTO",
                "label": "Regentix AI CTO",
                "capabilities": {
                    "skills": ["urn:nanda:skill:engineering", "urn:nanda:skill:security"],
                    "authentication": {"methods": ["ed25519"]},
                },
            },
        },
    )
    facts = facts_for("https://cards.test/regentix.ai/cto.json")
    assert facts.skills == ("engineering", "security")
    assert facts.did == "did:key:zCTO"
    assert facts.auth_methods == ("ed25519",)
    assert facts.url == "https://cto.test/agentfacts.json"


def test_a_card_advertising_http_is_followed_over_https(monkeypatch):
    """Cards in this estate still say http:// for hosts that serve https, and a
    plain-text fetch to a TLS-only host is a failure that reads as 'no facts'."""
    _serve(
        monkeypatch,
        {
            "https://card.test/a.json": {"url": "http://agent.test"},
            "https://agent.test/agentfacts.json": {"capabilities": {"skills": ["leadership"]}},
        },
    )
    assert facts_for("https://card.test/a.json").skills == ("leadership",)


def test_an_unreadable_card_is_a_refusal_naming_the_card(monkeypatch):
    _serve(monkeypatch, {})
    with pytest.raises(AgentFactsError, match="card .* unreadable"):
        facts_for("https://gone.test/a.json")


def test_a_card_with_no_address_cannot_lead_anywhere(monkeypatch):
    _serve(monkeypatch, {"https://card.test/a.json": {"name": "nameless"}})
    with pytest.raises(AgentFactsError, match="names no address"):
        facts_for("https://card.test/a.json")


def test_facts_that_cannot_be_fetched_name_the_facts_url(monkeypatch):
    _serve(monkeypatch, {"https://card.test/a.json": {"url": "https://agent.test"}})
    with pytest.raises(AgentFactsError, match="agentfacts.json unreadable"):
        facts_for("https://card.test/a.json")


def test_an_agent_publishing_no_skills_claims_none(monkeypatch):
    _serve(
        monkeypatch,
        {
            "https://card.test/a.json": {"url": "https://agent.test"},
            "https://agent.test/agentfacts.json": {"id": "did:key:zX"},
        },
    )
    assert facts_for("https://card.test/a.json").skills == ()


def test_skills_are_normalised_however_the_facts_were_built():
    """``skill_name`` was applied on the wire and nowhere else, so a blank skill
    survived into the suggestion list: empty, truthy, and offered to a person."""
    assert Facts(url="x", skills=("  ", "", "urn:nanda:skill:Leadership")).skills == ("leadership",)


def test_facts_serialise_for_the_page(monkeypatch):
    facts = Facts(url="https://a.test/agentfacts.json", did="did:key:zA", label="A", skills=("x",))
    assert json.loads(json.dumps(facts.to_dict()))["skills"] == ["x"]
