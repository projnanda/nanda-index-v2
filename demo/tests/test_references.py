"""What the References tab shows, and what a green light is allowed to mean."""

from __future__ import annotations

import urllib.error

import pytest

from concierge import references
from concierge.references import Reference, catalogue, probe_all


def _ref(url: str = "https://x.test", path: str = "/health") -> Reference:
    return Reference(name="x", kind="Test", url=url, health_path=path)


class _Resp:
    def __init__(self, status: int = 200, body: bytes = b"{}"):
        self.status = status
        self._b = body

    def read(self, _n=None):
        return self._b

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def test_the_catalogue_covers_every_party_the_run_touches():
    kinds = {r.kind for r in catalogue()}
    assert kinds == {"Directory", "Organisation", "Agent", "Venue", "Concierge"}
    urls = [r.url for r in catalogue()]
    assert all(u.startswith("http") for u in urls), "a reference with no address is not a reference"


def test_an_entry_with_no_url_is_dropped_rather_than_shown_as_offline(monkeypatch):
    """An unconfigured service is not a broken one, and a red light would say it was."""
    monkeypatch.setattr(references.config, "venue_url", lambda: "")
    assert not [r for r in catalogue() if r.kind == "Venue"]


def test_a_service_that_answers_is_online(monkeypatch):
    monkeypatch.setattr(references.urllib.request, "urlopen", lambda *_a, **_k: _Resp(200, b'{"status":"ok"}'))
    [result] = probe_all([_ref()])
    assert result.status == "online" and result.detail == "HTTP 200"


def test_a_service_that_refuses_is_distinguished_from_one_that_is_gone(monkeypatch):
    """A 401 on a gated path is not the same fact as a connection refused, and a
    light that shows them alike hides which one an operator must act on."""
    monkeypatch.setattr(
        references.urllib.request,
        "urlopen",
        lambda *_a, **_k: (_ for _ in ()).throw(urllib.error.HTTPError("u", 401, "no", {}, None)),
    )
    assert probe_all([_ref()])[0].status == "degraded"

    def refused(*_a, **_k):
        raise OSError("connection refused")

    monkeypatch.setattr(references.urllib.request, "urlopen", refused)
    gone = probe_all([_ref()])[0]
    assert gone.status == "offline" and "connection refused" in gone.detail


def test_the_status_code_travels_so_a_reader_can_see_what_up_meant(monkeypatch):
    monkeypatch.setattr(references.urllib.request, "urlopen", lambda *_a, **_k: _Resp(204, b""))
    assert probe_all([_ref()])[0].detail == "HTTP 204"


def test_useful_counts_are_carried_through_when_the_service_reports_them(monkeypatch):
    monkeypatch.setattr(
        references.urllib.request,
        "urlopen",
        lambda *_a, **_k: _Resp(200, b'{"status":"ok","tree_size":28,"secret":"nope"}'),
    )
    extra = probe_all([_ref()])[0].extra
    assert extra["tree_size"] == 28
    # Only the named fields. A probe that echoed whatever a service returned
    # would publish whatever a service returned.
    assert "secret" not in extra


def test_a_non_json_answer_does_not_break_the_probe(monkeypatch):
    monkeypatch.setattr(references.urllib.request, "urlopen", lambda *_a, **_k: _Resp(200, b"<html>"))
    assert probe_all([_ref()])[0].status == "online"


def test_probing_nothing_is_not_an_error():
    assert probe_all([]) == []


def test_each_service_is_probed_on_its_own_health_path():
    """An agent has no /health and an index has no agent card; probing the wrong
    one reports a healthy service as down."""
    by_kind = {r.kind: r.health_path for r in catalogue()}
    assert by_kind["Agent"] == "/.well-known/agent-card.json"
    assert by_kind["Concierge"] == "/healthz"
    assert by_kind["Organisation"] == "/health"


@pytest.mark.parametrize("status", ["online", "degraded", "offline"])
def test_a_reference_serialises_for_the_page(status):
    d = Reference(name="n", kind="k", url="https://u.test", health_path="/h", status=status).to_dict()
    assert d["status"] == status
    # health_path is how the check is made, not something the page renders.
    assert "health_path" not in d
