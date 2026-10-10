"""Keep this agent's index registration current."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger(__name__)

__all__ = ["DEFAULT_INTERVAL_SECONDS", "Heartbeat", "renew_forever", "start"]

#: How often to check. A record lives three days and is renewed inside the last
#: twelve hours, so hourly is far more often than strictly needed — and that is
#: the point: a tick that only just keeps up has no margin for the hours an index
#: is unreachable, and the check costs one resolve when nothing is due.
DEFAULT_INTERVAL_SECONDS = 3600.0


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class Heartbeat:
    """What the loop has actually done, so an operator can tell it is alive."""

    interval_seconds: float = DEFAULT_INTERVAL_SECONDS
    started_at: datetime | None = field(default_factory=_now)
    ticks: int = 0
    last_tick_at: datetime | None = None
    last_action: str | None = None
    last_detail: str = ""
    seq: int | None = None
    expires_at: str | None = None

    def record(self, action: str | None, result: dict[str, Any] | None = None, *, now=None) -> None:
        payload = result or {}
        self.ticks += 1
        self.last_tick_at = (now or _now)()
        self.last_action = action
        self.last_detail = str(payload.get("detail", ""))[:200]
        if payload.get("seq") is not None:
            self.seq = payload.get("seq")
        if payload.get("expires_at"):
            self.expires_at = payload.get("expires_at")

    def overdue(self, *, now=None) -> bool:
        """Whether a tick should have happened by now and did not."""
        since = self.last_tick_at or self.started_at
        if since is None:
            return True
        return ((now or _now)() - since).total_seconds() > self.interval_seconds * 2

    def to_dict(self) -> dict[str, Any]:
        def stamp(value: datetime | None) -> str | None:
            return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None

        return {
            "alive": not self.overdue(),
            "ticks": self.ticks,
            "interval_seconds": self.interval_seconds,
            "started_at": stamp(self.started_at),
            "last_tick_at": stamp(self.last_tick_at),
            "last_action": self.last_action,
            "last_detail": self.last_detail,
            "seq": self.seq,
            "expires_at": self.expires_at,
        }


async def renew_forever(
    renew: Callable[[], dict[str, Any]],
    *,
    interval: float = DEFAULT_INTERVAL_SECONDS,
    heartbeat: Heartbeat | None = None,
    sleep: Callable[[float], Awaitable[None]] | None = None,
    to_thread: Callable[..., Awaitable[Any]] | None = None,
) -> None:
    """Check the registration on a clock, forever."""
    nap = sleep or asyncio.sleep
    run = to_thread or asyncio.to_thread
    while True:
        await nap(interval)
        try:
            result = await run(renew)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - an outage is not a crash
            log.warning("[renewal] could not reach the index: %s", exc)
            # Recorded, not skipped: a loop failing every tick is alive and in
            # trouble, which reads very differently from a loop that is gone.
            if heartbeat is not None:
                heartbeat.record("error", {"detail": str(exc)})
            continue
        action = (result or {}).get("action")
        if heartbeat is not None:
            heartbeat.record(action, result)
        if action in ("renewed", "registered"):
            # Worth a line: this is the moment the agent would otherwise have
            # lapsed, and an operator reading logs should be able to see it did
            # not.
            log.info(
                "[renewal] %s seq=%s expires=%s",
                action,
                (result or {}).get("seq"),
                (result or {}).get("expires_at"),
            )
        elif action not in ("current",):
            log.warning("[renewal] %s: %s", action, (result or {}).get("detail", "")[:200])


def start(
    renew: Callable[[], dict[str, Any]],
    *,
    interval: float = DEFAULT_INTERVAL_SECONDS,
    heartbeat: Heartbeat | None = None,
):
    """Launch the loop as a background task and return it."""
    return asyncio.ensure_future(renew_forever(renew, interval=interval, heartbeat=heartbeat))


async def stop(task) -> None:
    """Cancel the loop and wait for it to finish."""
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
