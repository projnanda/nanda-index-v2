"""How many live runs one visitor may start, per window.

A live run is not free for anyone else: it sends two companies' agents a real
invitation and a note, and holds a real table under the host's grant. On a
public page that has to be bounded per visitor, or one visitor can spend the
host's authority and the guests' patience on their own.
"""

from __future__ import annotations

import ipaddress
import threading
import time
from collections import deque
from collections.abc import Callable

__all__ = ["RunLimiter", "client_key"]

#: How much of an IPv6 address names one visitor. A subscriber is routinely
#: handed a whole /64, so counting each address gave one visitor 2^64 allowances.
IPV6_VISITOR_PREFIX = 64


class RunLimiter:
    """At most ``max_runs`` per visitor in any ``window_seconds``. Zero disables it."""

    def __init__(
        self, max_runs: int, window_seconds: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._max = max_runs
        self._window = window_seconds
        self._clock = clock
        self._runs: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._swept_at = clock()

    @property
    def max_runs(self) -> int:
        return self._max

    @property
    def window_seconds(self) -> float:
        return self._window

    @property
    def tracked(self) -> int:
        """How many visitors are being remembered. Bounded by the window."""
        with self._lock:
            return len(self._runs)

    def _live(self, key: str, now: float) -> deque[float]:
        runs = self._runs.get(key) or deque()
        while runs and now - runs[0] >= self._window:
            runs.popleft()
        return runs

    def _sweep(self, now: float) -> None:
        """Forget every visitor whose runs have all aged out.

        At most once a window, so a request costs O(1) amortised. Without it each
        new address added an entry that was never removed.
        """
        if now - self._swept_at < self._window:
            return
        self._swept_at = now
        stale = [key for key, runs in self._runs.items() if not runs or now - runs[-1] >= self._window]
        for key in stale:
            del self._runs[key]

    def would_allow(self, key: str) -> bool:
        """Whether ``try_acquire`` would succeed now, without counting a run.

        Checked before taking the run lock, so a visitor already over the limit
        is turned away without holding the lock, even for an instant, against a
        visitor who is not.
        """
        if self._max <= 0:
            return True
        with self._lock:
            return len(self._live(key, self._clock())) < self._max

    def wait(self, key: str) -> float:
        """Seconds until ``key`` may run again; 0 when it may run now. Counts nothing."""
        if self._max <= 0:
            return 0.0
        now = self._clock()
        with self._lock:
            runs = self._live(key, now)
            return self._window - (now - runs[0]) if len(runs) >= self._max else 0.0

    def try_acquire(self, key: str) -> tuple[bool, float]:
        """Count a run for ``key`` if it is allowed; else say how long until it is.

        A refused attempt is not counted, so asking again does not push the wait
        further out.
        """
        if self._max <= 0:
            return True, 0.0
        now = self._clock()
        with self._lock:
            self._sweep(now)
            runs = self._live(key, now)
            if len(runs) >= self._max:
                return False, self._window - (now - runs[0])
            runs.append(now)
            self._runs[key] = runs
            return True, 0.0


def client_key(peer: str, forwarded_for: str | None, *, behind_proxy: bool) -> str:
    """Which visitor a request came from.

    ``X-Forwarded-For`` is only evidence when a proxy we run is in front: that
    proxy appends the address it saw, so the last entry is the one to trust and
    everything left of it is whatever the caller sent. Reachable directly, the
    header is the caller's to invent, and trusting it would hand every request a
    fresh allowance.
    """
    address = peer
    if behind_proxy and forwarded_for:
        last = forwarded_for.split(",")[-1].strip()
        if last:
            address = last
    return _visitor_of(address)


def _visitor_of(address: str) -> str:
    """An IPv4 address as itself; an IPv6 address as its /64.

    Anything that is not an address (the test client's ``testclient``) is kept
    as given: still a key, just not one that can be widened.
    """
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return address
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return str(ip.ipv4_mapped)
        return str(ipaddress.IPv6Network((ip, IPV6_VISITOR_PREFIX), strict=False))
    return str(ip)
