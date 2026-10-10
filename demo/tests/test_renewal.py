"""The clock that keeps this agent's name resolvable.

The defect: an index v3 record lives three days and registration happened once,
at startup. Nothing renewed it, so the agent stayed resolvable for exactly as
long as it had been running — and then the venue refused it, because the venue
requires a caller whose key an index resolves.

Measured on the live estate: every record expired within 61 hours of being read,
and the only reason nothing had broken was that deploys kept restarting the
clock. A demo that works because somebody deploys it often is not working.
"""

from __future__ import annotations

import asyncio

import pytest

from concierge import renewal


class _Clock:
    """A sleep that runs the loop a fixed number of times, then stops it."""

    def __init__(self, ticks: int):
        self.remaining = ticks
        self.slept: list[float] = []

    async def __call__(self, seconds: float) -> None:
        # Cancel BEFORE recording, so a run of N ticks records exactly N sleeps
        # and the cancelling one is not counted as work the loop did.
        if self.remaining <= 0:
            raise asyncio.CancelledError
        self.remaining -= 1
        self.slept.append(seconds)


async def _run(renew, *, ticks: int = 3, interval: float = 3600.0, heartbeat=None):
    clock = _Clock(ticks)

    async def to_thread(fn, *a, **k):
        return fn(*a, **k)

    with pytest.raises(asyncio.CancelledError):
        await renewal.renew_forever(
            renew, interval=interval, sleep=clock, to_thread=to_thread, heartbeat=heartbeat
        )
    return clock


def test_it_checks_on_a_clock_rather_than_only_at_startup():
    calls = []
    clock = asyncio.run(_run(lambda: calls.append(1) or {"action": "current"}, ticks=3))
    assert len(calls) == 3
    assert clock.slept == [3600.0, 3600.0, 3600.0]


def test_it_sleeps_before_the_first_check():
    """Registration already happened at startup. Checking immediately would
    resolve a record written seconds earlier."""
    calls = []
    asyncio.run(_run(lambda: calls.append(1) or {"action": "current"}, ticks=0))
    assert calls == []


def test_an_unreachable_index_does_not_stop_the_loop():
    """An index that is down is somebody else's outage. Turning it into this
    agent's crash would take the agent off the air for the one reason renewal
    exists to prevent."""
    attempts = []

    def flaky():
        attempts.append(1)
        if len(attempts) < 3:
            raise OSError("connection refused")
        return {"action": "renewed", "seq": 9}

    asyncio.run(_run(flaky, ticks=4))
    assert len(attempts) == 4, "the loop gave up after a failure"


def test_a_refusal_is_logged_and_the_loop_continues(caplog):
    asyncio.run(_run(lambda: {"action": "failed", "detail": "index said no"}, ticks=2))
    assert "index said no" in caplog.text


def test_a_renewal_is_announced(caplog):
    """The moment the agent would otherwise have lapsed. An operator reading
    logs should be able to see that it did not."""
    import logging

    caplog.set_level(logging.INFO)
    asyncio.run(_run(lambda: {"action": "renewed", "seq": 4, "expires_at": "2026-10-06T00:00:00Z"}, ticks=1))
    assert "renewed" in caplog.text and "seq=4" in caplog.text


def test_a_current_record_is_not_announced(caplog):
    """Nothing happened. A line every hour saying nothing happened is a log
    nobody reads."""
    import logging

    caplog.set_level(logging.INFO)
    asyncio.run(_run(lambda: {"action": "current", "seq": 1}, ticks=3))
    assert "current" not in caplog.text


def test_the_interval_leaves_margin_for_an_index_being_down():
    """A record lives three days and is renewed inside the last twelve hours. A
    tick that only just keeps up has no margin for the hours an index is
    unreachable."""
    assert renewal.DEFAULT_INTERVAL_SECONDS <= 12 * 3600 / 4


def test_cancelling_the_task_stops_it_cleanly():
    async def scenario():
        task = renewal.start(lambda: {"action": "current"}, interval=0.01)
        await asyncio.sleep(0.05)
        await renewal.stop(task)
        return task.cancelled() or task.done()

    assert asyncio.run(scenario())


def test_stopping_a_task_that_was_never_started_is_harmless():
    asyncio.run(renewal.stop(None))


# ── being able to tell a living loop from a dead one ────────────────────────


def _at(offset_seconds: float):
    """A clock reading ``offset_seconds`` after now."""
    from datetime import timedelta

    from concierge.renewal import _now

    moment = _now() + timedelta(seconds=offset_seconds)
    return lambda: moment


def test_a_tick_that_finds_the_record_current_is_still_recorded():
    """The case that used to be invisible, and the common one.

    ``current`` is not logged — correctly, it would be an hourly line saying
    nothing happened. But it was also not recorded anywhere, so a loop doing its
    job and a loop that died at startup both produced silence.
    """
    beat = renewal.Heartbeat(interval_seconds=3600.0)
    asyncio.run(_run(lambda: {"action": "current", "seq": 9}, ticks=3, heartbeat=beat))
    assert beat.ticks == 3
    assert beat.last_action == "current"
    assert beat.seq == 9
    assert beat.last_tick_at is not None


def test_a_loop_that_has_not_ticked_yet_still_reads_as_alive():
    """The first tick is one interval away; until then zero ticks is correct."""
    beat = renewal.Heartbeat(interval_seconds=3600.0)
    assert beat.ticks == 0
    assert not beat.overdue()
    assert beat.to_dict()["alive"] is True


def test_a_loop_that_has_gone_quiet_reads_as_dead():
    beat = renewal.Heartbeat(interval_seconds=3600.0)
    # Just under two intervals: slow is not dead.
    assert not beat.overdue(now=_at(3600.0 * 2 - 60))
    # Past two: nothing has happened that should have.
    assert beat.overdue(now=_at(3600.0 * 2 + 60))


def test_a_tick_moves_the_deadline_forward():
    beat = renewal.Heartbeat(interval_seconds=3600.0)
    beat.record("current", {"seq": 1}, now=_at(3600.0))
    # Measured from the last tick, not from boot — otherwise a long-lived
    # process reads as dead however well the loop is working.
    assert not beat.overdue(now=_at(3600.0 * 2 + 60))
    assert beat.overdue(now=_at(3600.0 * 4))


def test_an_index_outage_counts_as_a_tick_so_trouble_is_not_read_as_death():
    """A loop failing every hour is alive and in trouble. That reads differently
    from a loop that is gone, and an operator has to be able to tell."""

    def boom():
        raise OSError("index unreachable")

    beat = renewal.Heartbeat(interval_seconds=3600.0)
    asyncio.run(_run(boom, ticks=2, heartbeat=beat))
    assert beat.ticks == 2
    assert beat.last_action == "error"
    assert "unreachable" in beat.last_detail
    assert beat.to_dict()["alive"] is True


def test_the_heartbeat_serialises_what_an_operator_needs():
    beat = renewal.Heartbeat(interval_seconds=3600.0)
    beat.record("renewed", {"seq": 10, "expires_at": "2026-10-03T18:56:36Z"})
    out = beat.to_dict()
    assert out["ticks"] == 1
    assert out["last_action"] == "renewed"
    assert out["seq"] == 10
    assert out["expires_at"] == "2026-10-03T18:56:36Z"
    assert out["started_at"] and out["last_tick_at"]
    assert out["interval_seconds"] == 3600.0


def test_a_later_tick_does_not_erase_the_sequence_it_did_not_report():
    """``current`` carries a seq; an error carries none. The last known value is
    more useful than a null that means "this tick did not say"."""
    beat = renewal.Heartbeat()
    beat.record("renewed", {"seq": 10, "expires_at": "2026-10-03T00:00:00Z"})
    beat.record("error", {"detail": "index unreachable"})
    assert beat.seq == 10 and beat.expires_at == "2026-10-03T00:00:00Z"
