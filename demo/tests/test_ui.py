"""The page, in a browser.

Everything here drives the real HTML, CSS and JavaScript against a real server.
The estate behind it is stubbed — see ``ui_harness`` — because the page is what
is under test.

These exist because three defects shipped that every other test passed through:
a replay route reading fields the envelope no longer had, a receipts panel
reading a digest the receipt never carried, and a References tab that loaded once
and then showed a stale address forever. None of those are visible from Python.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.ui


def _run_once(page):
    """Complete one run, so there is something to replay.

    Written as a helper rather than assumed: /ui/last is empty until a run has
    happened, so a replay test that relied on an earlier test having run would
    pass or fail on collection order.
    """
    page.click("#run")
    page.wait_for_function("() => document.querySelectorAll('#p-plain li.step').length >= 8", timeout=25000)
    page.wait_for_function("() => !document.getElementById('run').disabled", timeout=25000)


# ── it loads at all ─────────────────────────────────────────────────────────


def test_the_page_loads_without_errors(page):
    assert page.title()
    assert not page.errors, page.errors


def test_no_element_id_is_used_twice(page):
    """Two elements with one id means every $() after the first reads the wrong
    one, and nothing throws."""
    dupes = page.evaluate(
        "() => { const i=[...document.querySelectorAll('[id]')].map(e=>e.id);"
        "return i.filter((v,n)=>i.indexOf(v)!==n); }"
    )
    assert dupes == [], dupes


def test_every_id_the_script_reaches_for_exists_once_rendered(page):
    """A $() that returns null throws on the next property access, which in a
    handler means a dead button and a silent page."""
    _run_once(page)
    page.reload(wait_until="networkidle")
    page.click("#replay")
    page.wait_for_selector("#p-plain li.step", timeout=15000)
    page.click("#t-tech")
    page.wait_for_selector("#receipts .rcpt", timeout=15000)
    missing = page.evaluate(
        """() => {
      const src = [...document.querySelectorAll('script')].map(s=>s.textContent).join('\\n');
      const ids = new Set([...src.matchAll(/\\$\\(['"]([^'"]+)['"]\\)/g)].map(m=>m[1]));
      return [...ids].filter(id => !document.getElementById(id));
    }"""
    )
    assert missing == [], missing


# ── tabs ────────────────────────────────────────────────────────────────────


def test_one_tab_is_selected_and_only_its_panel_is_shown(page):
    state = page.evaluate(
        """() => ({
      selected: [...document.querySelectorAll('[role=tab]')]
        .filter(t => t.getAttribute('aria-selected') === 'true').length,
      shown: [...document.querySelectorAll('[role=tabpanel]')]
        .filter(p => getComputedStyle(p).display !== 'none').length,
    })"""
    )
    assert state == {"selected": 1, "shown": 1}


def test_choosing_a_tab_shows_its_panel_and_hides_the_others(page):
    page.click("#t-tech")
    assert page.evaluate("() => getComputedStyle(document.getElementById('p-tech')).display") != "none"
    assert page.evaluate("() => getComputedStyle(document.getElementById('p-plain')).display") == "none"
    assert page.get_attribute("#t-tech", "aria-selected") == "true"
    assert page.get_attribute("#t-plain", "aria-selected") == "false"


def test_the_tablist_is_named_and_navigable_by_arrow_keys(page):
    """The ARIA tab pattern: one stop in the tab order, arrows move between.

    Without it every tab is a separate tab stop and a keyboard user walks through
    all of them to reach the content.
    """
    assert page.get_attribute("[role=tablist]", "aria-label"), "the tablist has no accessible name"

    page.focus("#t-plain")
    page.keyboard.press("ArrowRight")
    assert page.evaluate("() => document.activeElement.id") == "t-tech"
    page.keyboard.press("ArrowRight")
    assert page.evaluate("() => document.activeElement.id") == "t-refs"
    # and it wraps, so the last tab is not a dead end
    page.keyboard.press("ArrowRight")
    assert page.evaluate("() => document.activeElement.id") == "t-plain"
    page.keyboard.press("ArrowLeft")
    assert page.evaluate("() => document.activeElement.id") == "t-refs"


def test_only_the_selected_tab_is_in_the_tab_order(page):
    order = page.evaluate("() => [...document.querySelectorAll('[role=tab]')].map(t => t.tabIndex)")
    assert order.count(0) == 1, f"expected one tab stop, got tabIndex values {order}"
    assert order.count(-1) == 2


# ── a run ───────────────────────────────────────────────────────────────────


def test_running_streams_steps_onto_the_page(page):
    page.click("#run")
    page.wait_for_selector("#p-plain li.step", timeout=20000)
    page.wait_for_function("() => document.querySelectorAll('#p-plain li.step').length >= 8", timeout=20000)
    assert not page.errors, page.errors


def test_the_run_button_is_disabled_while_a_run_is_in_flight(page):
    page.click("#run")
    assert page.is_disabled("#run"), "a second click would start a second booking"
    page.wait_for_function("() => !document.getElementById('run').disabled", timeout=20000)


def test_the_refusal_step_is_rendered_and_marked_as_refused(page):
    """The step the demonstration exists to show. A page that rendered it like
    every other step would hide the only thing that failed."""
    _run_once(page)
    text = page.inner_text("#p-plain")
    assert "Refused, as it should be" in text
    assert page.locator("#p-plain li.step.refused").count() >= 1, (
        "the refused step carries no marker distinguishing it from the others"
    )


def test_a_replay_renders_without_running_again(page):
    """A reload must show the evidence without booking a second table."""
    _run_once(page)
    page.reload(wait_until="networkidle")
    assert page.locator("#p-plain li.step").count() == 0, "a fresh load should be empty"
    page.click("#replay")
    page.wait_for_selector("#p-plain li.step", timeout=15000)
    assert page.locator("#p-plain li.step").count() >= 8
    assert not page.errors, page.errors


def test_the_receipts_panel_and_the_grant_both_render(page):
    _run_once(page)
    page.reload(wait_until="networkidle")
    page.click("#replay")
    page.wait_for_selector("#p-plain li.step", timeout=15000)
    page.click("#t-tech")
    page.wait_for_selector("#receipts .rcpt", timeout=15000)
    receipts = page.inner_text("#receipts")
    assert "checked afterwards" in receipts.lower()
    assert "sha256:" in receipts, "the chain link is not shown"
    page.wait_for_selector("#authority", timeout=10000)
    page.wait_for_function(
        "() => !document.getElementById('authority').innerText.includes('Checking')", timeout=10000
    )
    authority = page.inner_text("#authority")
    assert "granted by" in authority.lower()


# ── capability search ───────────────────────────────────────────────────────


def test_searching_a_capability_renders_matches_grouped_by_organisation(page):
    page.click("#t-refs")
    page.fill("#cap-q", "leadership")
    page.click("#cap-go")
    page.wait_for_selector(".caprow", timeout=15000)
    assert page.locator(".caporg").count() >= 1
    assert "regentix-ceo" in page.inner_text("#cap-results")
    assert page.locator(".captags em.hit").count() >= 1, "the matched tag is not highlighted"


def test_a_suggestion_chip_runs_the_search(page):
    page.click("#t-refs")
    page.click(".chips button[data-cap='leadership']")
    page.wait_for_selector(".caprow", timeout=15000)
    assert page.input_value("#cap-q") == "leadership"


def test_an_empty_search_does_nothing_rather_than_erroring(page):
    page.click("#t-refs")
    page.fill("#cap-q", "   ")
    page.click("#cap-go")
    page.wait_for_timeout(600)
    assert page.locator(".caprow").count() == 0
    assert not page.errors, page.errors


# ── references ──────────────────────────────────────────────────────────────


def test_the_references_tab_reports_each_service_and_its_state(page):
    page.click("#t-refs")
    page.wait_for_selector(".ref", timeout=20000)
    assert page.locator(".ref .dot.online").count() >= 1
    assert page.locator(".ref .dot.offline").count() >= 1, "an offline service is not distinguishable"


def test_the_recheck_control_survives_the_load_it_triggers(page):
    """It did not. The button was a child of the status line, and every
    successful load did ``status.textContent = ...`` — deleting its own refresh
    control. Present, correct, and gone before anyone could press it."""
    page.click("#t-refs")
    page.wait_for_selector(".ref", timeout=20000)
    assert page.locator("#refs-again").count() == 1, "the load destroyed the refresh button"
    assert page.is_visible("#refs-again")


def test_the_references_can_be_rechecked_on_demand(page):
    """A status light that cannot be refreshed is a claim about page-load time."""
    page.click("#t-refs")
    page.wait_for_selector(".ref", timeout=20000)
    page.click("#refs-again")
    page.wait_for_function("() => !document.getElementById('refs-again').disabled", timeout=20000)
    page.wait_for_selector(".ref", timeout=20000)
    assert page.locator(".ref").count() >= 2
    assert not page.errors, page.errors


# ── layout and semantics ────────────────────────────────────────────────────


@pytest.mark.parametrize("width,height", [(390, 844), (768, 1024), (1280, 900)])
def test_the_page_does_not_scroll_sideways(browser, ui_server, width, height):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    pg = ctx.new_page()
    pg.goto(f"{ui_server}/ui", wait_until="networkidle", timeout=30000)
    pg.click("#run")
    pg.wait_for_function("() => document.querySelectorAll('#p-plain li.step').length >= 8", timeout=25000)
    over = pg.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    ctx.close()
    assert over <= 1, f"{width}px viewport scrolls sideways by {over}px"


def test_status_messages_are_announced(page):
    """Every status line changes while a person is watching. Without a live
    region a screen-reader user is told none of it."""
    ids = page.evaluate("() => [...document.querySelectorAll('[id^=status-]')].map(e=>e.id)")
    assert ids, "no status elements found"
    not_live = page.evaluate(
        """() => [...document.querySelectorAll('[id^=status-]')]
             .filter(e => !e.getAttribute('aria-live') && !e.closest('[aria-live]'))
             .map(e => e.id)"""
    )
    assert not_live == [], f"status elements with no live region: {not_live}"


def test_headings_describe_the_structure_they_are_in(page):
    """A step sits inside a phase, so its heading has to sit below the phase's.
    Flat headings make the document outline say every step is a section."""
    page.click("#replay")
    page.wait_for_selector("#p-plain li.step", timeout=15000)
    levels = page.evaluate(
        "() => [...document.querySelectorAll('#p-plain h1,#p-plain h2,#p-plain h3,#p-plain h4,#p-plain h5')]"
        ".map(h => ({level:+h.tagName[1], text:h.innerText.trim().slice(0,40)}))"
    )
    phases = [h for h in levels if h["text"] in ("Finding the right people", "Asking each guest")]
    steps = [h for h in levels if h["text"] in ("Find the company", "Hold the table", "Book the table")]
    assert phases and steps
    assert max(p["level"] for p in phases) < min(s["level"] for s in steps), (
        "phase and step headings are at the same level"
    )


def test_the_search_box_shows_where_the_keyboard_is(page):
    """The stylesheet removes the focus outline; something has to replace it."""
    page.click("#t-refs")
    page.focus("#cap-q")
    styles = page.evaluate(
        """() => { const s = getComputedStyle(document.getElementById('cap-q'));
             return {outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow}; }"""
    )
    visible = styles["outline"] not in ("none", "") or styles["shadow"] not in ("none", "")
    assert visible, f"focused input has no visible focus indicator: {styles}"


def test_the_technical_tab_shows_each_entry_s_chain_link(page):
    """It showed an empty column for the length of the ARP port.

    The summary line read ``s.entry.digest``, and an ARP receipt carries no
    digest — a receipt committing to a hash of itself is not a thing. The chain
    link is computed and sent alongside, and nothing said the column had gone
    blank because a blank column throws no error.
    """
    _run_once(page)
    page.click("#t-tech")
    page.wait_for_selector("#p-tech details.blk", timeout=15000)
    ids = page.evaluate(
        "() => [...document.querySelectorAll('#p-tech details.blk .id')].map(e => e.textContent.trim())"
    )
    assert ids, "no entries rendered"
    assert all(i.startswith("sha256:") for i in ids), f"chain links missing or malformed: {ids[:3]}"


def test_a_step_shows_who_it_was_about(page):
    """Same cause: the subject was read from a flat path the envelope no longer
    has, so every step rendered without one and no test noticed."""
    _run_once(page)
    subjects = page.evaluate(
        "() => [...document.querySelectorAll('#p-plain .subj')].map(e => e.textContent.trim())"
    )
    assert subjects, "no step names the person or company it concerned"
    assert any(s for s in subjects), f"subject lines are present but empty: {subjects[:3]}"


def test_a_match_says_whether_the_agent_or_its_organisation_claimed_it(page):
    """A capability the organisation asserted and the agent never did is a
    weaker claim, and the page must not draw the two the same way."""
    page.click("#t-refs")
    page.click(".chips button[data-cap='leadership']")
    page.wait_for_selector(".caprow", timeout=15000)
    assert "Published by the agent itself" in page.inner_text("#cap-results")
    link = page.get_attribute(".caprow a", "href")
    assert link.endswith("/agentfacts.json"), f"should link to the agent's own facts, got {link}"


def test_the_page_reports_where_an_organisation_over_claims(page):
    """Six agents on the live estate have capabilities their organisation lists
    and they do not. Resolving that silently would hide it."""
    page.click("#t-refs")
    page.click(".chips button[data-cap='leadership']")
    page.wait_for_selector(".caprow", timeout=15000)
    text = page.inner_text("#cap-results")
    assert "disagree" in text.lower()
    assert "positioning" in text


def test_a_held_table_is_not_reported_as_a_failure(page):
    """The result block said "nothing booked" directly above a note saying the
    table was held. The rows were written for a flow that always booked."""
    _run_once(page)
    text = page.inner_text("#summary")
    assert "nothing booked" not in text.lower(), "a held table is not a failed one"
    assert "Table held" in text
    assert "Hold reference" in text
    assert "hold-stub-1" in text
    assert "Still to agree" in text


def test_the_absence_of_a_restaurant_receipt_is_explained_not_left_blank(page):
    """There is no receipt because nothing was confirmed. "Not fetched on this
    run" reads as a gap in the evidence rather than the state of the booking."""
    _run_once(page)
    page.click("#t-tech")
    page.wait_for_selector("#receipts .rcpt", timeout=15000)
    text = page.inner_text("#receipts")
    assert "Not fetched on this run" not in text
    assert "every named person has" in text
