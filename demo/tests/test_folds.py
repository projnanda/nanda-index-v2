"""The fold, pinned against the counterparty's bytes rather than its own.

A test that recomputes the expected digest the way the code computes it passes on
two implementations that agree only with each other — which is exactly the defect
that once produced two valid receipts for one booking that could not be paired.

So :data:`VENUE_DIGEST` is a literal, produced by executing the VENUE's own
``venue.calendar.slot_ref`` in the venue's repository and pasting the result. It
is not this module's output. If the venue ever changes its fold, this test fails
and that is the entire point — a silent divergence here is invisible from both
ends.
"""

from __future__ import annotations

from concierge.folds import SLOT_SEPARATOR, slot_ref

#: venue.calendar.slot_ref("table-4", "2026-10-02T12:30:00Z")
VENUE_DIGEST = "90c7b7ac3991a6b2124f30e4af8b98567909db2bb46d4b7900568ce9b0148788"

#: venue.calendar.slot_ref("a:b", "c") — pinned so the separator's behaviour is
#: checked against the counterparty too, not only against this module's idea of it.
VENUE_DIGEST_COLON = "f1bb0ca6c7ffab359b80aba12b97054db77fc18693cdc3cd2b0b58afc2a6ebb3"


def test_the_fold_equals_the_venues_fold():
    assert slot_ref("table-4", "2026-10-02T12:30:00Z") == VENUE_DIGEST


def test_the_fold_equals_the_venues_fold_for_a_field_containing_a_colon():
    assert slot_ref("a:b", "c") == VENUE_DIGEST_COLON


def test_the_separator_cannot_be_forged_from_the_fields():
    # With a printable separator these two different bookings collide. The NUL
    # cannot appear in either field, so the collision is unreachable rather than
    # merely unlikely.
    assert slot_ref("a:b", "c") != slot_ref("a", "b:c")
    assert SLOT_SEPARATOR == b"\x00"


def test_the_start_is_not_normalised():
    # Trimming or reformatting would produce a digest the venue never computes,
    # so this passes the counterparty's spelling through untouched.
    assert slot_ref("t", " 12:30 ") != slot_ref("t", "12:30")
