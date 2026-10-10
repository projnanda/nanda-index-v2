"""Finding counterparties, and saying how each was found."""

from __future__ import annotations

import json

import pytest

from concierge import discovery
from concierge.discovery import CONFIGURED, SEARCHED, Counterparty, org_catalog, search_capability


class _Response:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def read(self, _n=None):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture
def fake_index(monkeypatch):
    """Replaces urlopen only — the function under test still builds its own URL.

    Deliberately not an autouse fixture: stubbing broadly is how a test in a
    sibling repo ended up stubbing the function it was written to exercise.
    """
    calls: list[str] = []

    def fake(request, timeout=None):
        url = request.full_url if hasattr(request, "full_url") else str(request)
        calls.append(url)
        if "/api/v1/search" in url:
            return _Response(
                {
                    "results": [
                        {
                            "org_id": "orrery-demo",
                            "registry_url": "https://a.test",
                            "identifier": "urn:ai:domain:a.test",
                            "tags": ["general ai"],
                        },
                        {
                            "org_id": "regentix",
                            "registry_url": "https://a.test",
                            "identifier": "urn:ai:domain:regentix.ai",
                            "tags": ["general ai"],
                        },
                        {"org_id": "other", "registry_url": "https://b.test", "tags": []},
                    ]
                }
            )
        return _Response(
            {
                "specVersion": "1.0",
                "entries": [{"identifier": "regentix"}],
                "withheldMembers": 5,
                "omittedMembers": 0,
            }
        )

    monkeypatch.setattr(discovery.urllib.request, "urlopen", fake)
    return calls


def test_several_records_for_one_server_are_one_counterparty(fake_index):
    found = search_capability("regentix")
    # The index holds one record per verified domain; three identical addresses
    # are not three counterparties.
    assert [c.url for c in found] == ["https://a.test", "https://b.test"]
    assert all(c.how == SEARCHED for c in found)


def test_a_searched_counterparty_records_the_index_identifier(fake_index):
    assert search_capability("regentix")[0].urn == "urn:ai:domain:a.test"


def test_no_match_is_a_finding_not_an_error(monkeypatch):
    monkeypatch.setattr(discovery.urllib.request, "urlopen", lambda *_a, **_k: _Response({"results": []}))
    assert search_capability("nothing") == []


def test_the_catalog_reports_what_it_is_hiding(fake_index):
    catalog = org_catalog("https://a.test")
    # A catalog with one entry and 5 withheld is a different document from a
    # catalog with one entry, and a caller that cannot tell concludes the
    # organisation has one agent.
    assert catalog["visible"] == 1
    assert catalog["withheld"] == 5


def test_provenance_travels_with_the_address():
    configured = Counterparty(label="regentix-ceo", url="https://ceo.test", how=CONFIGURED)
    assert configured.provenance() == {
        "label": "regentix-ceo",
        "url": "https://ceo.test",
        "how": CONFIGURED,
        "urn": None,
        "tags": [],
    }
    # None, not "" — an empty string would suggest an index answered and said
    # nothing, rather than that none was asked.
    assert configured.urn is None


# ── following a hop to the agent behind it ──────────────────────────────────


def test_a_capability_is_matched_against_published_tags_not_free_text():
    """A substring search over descriptions would match an agent that merely
    mentions a capability."""
    catalog = {
        "entries": [
            {"identifier": "a", "tags": ["Leadership", "Strategy"], "url": "https://a.test/c.json"},
            {"identifier": "b", "tags": ["operations"], "url": "https://b.test/c.json"},
        ]
    }
    assert discovery.find_agent_by_capability(catalog, "leadership")["identifier"] == "a"
    assert discovery.find_agent_by_capability(catalog, " OPERATIONS ")["identifier"] == "b"
    assert discovery.find_agent_by_capability(catalog, "plumbing") is None


def test_an_entry_with_no_url_is_not_a_place_to_send_anything():
    catalog = {"entries": [{"identifier": "a", "tags": ["leadership"]}]}
    assert discovery.find_agent_by_capability(catalog, "leadership") is None


def test_resolving_a_name_that_is_not_registered_is_a_finding_not_an_absence(monkeypatch):
    import urllib.error

    def gone(*_a, **_k):
        raise urllib.error.HTTPError("u", 404, "nope", {}, None)

    monkeypatch.setattr(discovery.urllib.request, "urlopen", gone)
    with pytest.raises(discovery.DiscoveryError, match="resolves to nothing"):
        discovery.resolve_pointer("urn:ai:key:uX/agent", index_url="https://ix.test")


def test_a_record_with_no_next_hop_is_refused(monkeypatch):
    monkeypatch.setattr(
        discovery.urllib.request, "urlopen", lambda *_a, **_k: _Response({"record": {"seq": 1}})
    )
    with pytest.raises(discovery.DiscoveryError, match="no next hop"):
        discovery.resolve_pointer("urn:ai:key:uX/agent", index_url="https://ix.test")


def test_a_card_gives_the_address_the_agent_answers_on_not_where_the_card_lives(monkeypatch):
    """A card can be hosted anywhere — this estate serves some from a separate
    host39 server — and the hosting address is not where the agent listens."""
    monkeypatch.setattr(
        discovery.urllib.request,
        "urlopen",
        lambda *_a, **_k: _Response({"name": "CTO", "url": "https://cto.example/"}),
    )
    endpoint, card = discovery.endpoint_from_card("https://cards.elsewhere.test/cto.json")
    assert endpoint == "https://cto.example"
    assert card["name"] == "CTO"


def test_a_card_advertising_http_is_upgraded_rather_than_followed(monkeypatch):
    """A signed request that follows a redirect is one somebody else chose the
    destination for."""
    monkeypatch.setattr(
        discovery.urllib.request,
        "urlopen",
        lambda *_a, **_k: _Response({"name": "x", "url": "http://agent.example"}),
    )
    assert discovery.endpoint_from_card("https://c.test/x.json")[0] == "https://agent.example"


def test_a_card_with_no_url_names_no_address_to_call(monkeypatch):
    monkeypatch.setattr(
        discovery.urllib.request, "urlopen", lambda *_a, **_k: _Response({"name": "stub", "url": None})
    )
    # Measured on a real published card: name and description set, url null.
    with pytest.raises(discovery.DiscoveryError, match="names no address"):
        discovery.endpoint_from_card("https://c.test/stub.json")
