"""Every step a run emits has a caption, and the fallback stays unused."""

from __future__ import annotations

from datetime import UTC

from concierge.lunch import arrange
from concierge.narration import _FALLBACK as FALLBACK
from concierge.narration import CAPTIONS, caption_for


def test_every_step_a_real_run_emits_has_a_caption(me, wired, guests):
    """Drives the scenario rather than reading the caption table.

    A test that asserted the table is non-empty would pass while a newly added
    step showed up in the walkthrough as a bare identifier.
    """
    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    emitted = {e.step for e in plan.chain.entries}
    assert emitted, "the run produced no steps"

    missing = sorted(s for s in emitted if s not in CAPTIONS)
    assert not missing, f"steps with no plain-English caption: {missing}"


def test_a_caption_is_a_heading_and_an_explanation():
    for step, value in CAPTIONS.items():
        heading, plain, did = value
        assert heading and not heading.endswith("."), f"{step}: heading should be a short label"
        assert len(plain) > 40, f"{step}: explanation is too short to explain anything"
        assert did and did[0].isupper(), f"{step}: summary phrase should start a sentence"


def test_an_unknown_step_falls_back_rather_than_raising():
    # A live demo must not break because a step was renamed.
    assert caption_for("does.not.exist") == FALLBACK


# ── the copy the page shows for the request itself ──────────────────────────


def test_the_date_is_written_the_way_a_person_writes_one(monkeypatch):
    from concierge import config

    monkeypatch.setenv("LUNCH_DATE", "2026-10-02")
    # A page that shows a human an ISO timestamp is showing them the protocol.
    assert config.readable_date() == "Friday 2 October"
    assert "Friday 2 October" in config.request_sentence()


def test_an_unparseable_pinned_date_is_shown_as_given(monkeypatch):
    from concierge import config

    # The operator typed it; hiding it would hide the mistake.
    monkeypatch.setenv("LUNCH_DATE", "next tuesday")
    assert config.readable_date() == "next tuesday"


def test_the_date_rolls_forward_when_nothing_is_pinned(monkeypatch):
    from datetime import datetime, timedelta

    from concierge import config

    monkeypatch.delenv("LUNCH_DATE", raising=False)
    # A fixed date runs out: four tables times eight sittings is thirty-two real
    # bookings, after which every run reports "nothing open" and reads as broken.
    expected = (datetime.now(UTC) + timedelta(days=1)).strftime("%Y-%m-%d")
    assert config.lunch_date() == expected
    assert all(s.startswith(expected) for s in config.candidate_starts())


# ── the page cannot drift from the run ──────────────────────────────────────
#
# Three times now the scenario changed and the page did not: a replay route
# reading fields the envelope no longer had, a chain-link column that went blank,
# and a result block reporting "nothing booked" above a note saying the table was
# held. Each shipped because the browser tests drive a stub, and the stub still
# described the old flow. These two tests make the stub, and the page's idea of a
# result, fail when the run changes.


def test_the_browser_stub_emits_the_steps_a_real_run_emits(me, wired, guests):
    """Otherwise the browser suite proves the page renders *something*.

    It cannot prove the page renders *this* flow, which is the only claim worth
    having — and that gap is how a self-contradicting result block reached
    production with twenty-eight browser tests passing.
    """
    # Loaded by path: "tests.conftest" resolves to whichever repo is first on
    # sys.path, and on this machine that is a different project entirely.
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("_concierge_conftest", Path(__file__).parent / "conftest.py")
    conftest = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(conftest)
    STUB_STEPS = conftest.STUB_STEPS

    plan = arrange(
        me,
        guests=guests,
        venue_url="https://v.test",
        date="2026-10-02",
        candidate_starts=["12:00"],
        resources=["table-4"],
    )
    real = {e.step for e in plan.chain.entries}
    stubbed = {step for step, *_ in STUB_STEPS}

    assert stubbed <= real, f"the browser stub emits steps a real run does not: {sorted(stubbed - real)}"
    missing = real - stubbed
    assert not missing, (
        f"a real run emits steps the browser stub never renders: {sorted(missing)}. "
        "Add them to STUB_STEPS or the page is untested for them."
    )


def test_every_summary_field_the_page_reads_is_one_the_run_produces():
    """A page reading a field the plan never sets renders ``undefined`` silently.

    ``sum.booked_start || 'nothing booked'`` was correct until the run stopped
    always booking, at which point a held table reported a failure. The fix was
    for the plan to state its own state; this keeps the two in step.
    """
    import re
    from pathlib import Path

    from concierge.lunch import Plan
    from concierge.receipts import ReceiptChain

    page = (Path(__file__).parent.parent / "src" / "concierge" / "ui" / "index.html").read_text()
    body = page[page.index("function showSummary") :]
    body = body[: body.index("\nfunction ")]
    read = set(re.findall(r"\bsum\.([a-z_]+)", body))

    produced = set(
        Plan(
            date="d",
            resource="r",
            candidate_starts=[],
            chain=ReceiptChain(private_key=bytes(range(32)), principal_did="did:key:zX"),
        ).summary()
    )
    assert read <= produced, f"the result block reads fields the run never produces: {sorted(read - produced)}"
