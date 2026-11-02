"""How many live runs one visitor may start.

A live run sends real messages to two companies' agents and holds a real table
under the host's grant, so a public page cannot let one visitor start them
without end. The limit is per visitor and per window, and a refused visitor is
told when they may run again.
"""

from __future__ import annotations

from concierge.ratelimit import RunLimiter, client_key


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_refuses_with_a_wait():
    clock = _Clock()
    limiter = RunLimiter(max_runs=2, window_seconds=3600, clock=clock)

    assert limiter.try_acquire("a") == (True, 0.0)
    clock.now += 10
    assert limiter.try_acquire("a") == (True, 0.0)

    allowed, wait = limiter.try_acquire("a")
    assert not allowed
    assert wait == 3600 - 10


def test_each_visitor_has_their_own_allowance():
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=_Clock())

    assert limiter.try_acquire("a")[0]
    assert not limiter.try_acquire("a")[0]
    assert limiter.try_acquire("b")[0]


def test_a_run_ages_out_of_the_window():
    clock = _Clock()
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=clock)

    assert limiter.try_acquire("a")[0]
    clock.now += 60
    assert limiter.try_acquire("a")[0]


def test_a_refused_attempt_is_not_counted_against_the_visitor():
    clock = _Clock()
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=clock)

    limiter.try_acquire("a")
    clock.now += 30
    limiter.try_acquire("a")  # refused
    clock.now += 30
    assert limiter.try_acquire("a")[0], "the refused attempt extended the wait"


def test_zero_means_unlimited():
    limiter = RunLimiter(max_runs=0, window_seconds=60, clock=_Clock())

    assert all(limiter.try_acquire("a")[0] for _ in range(50))


def test_the_visitor_is_the_peer_unless_told_a_proxy_is_in_front():
    # Directly reachable, X-Forwarded-For is whatever the caller typed, so
    # trusting it would let anyone pick a fresh identity per request.
    assert client_key("203.0.113.9", "198.51.100.1", behind_proxy=False) == "203.0.113.9"


def test_behind_a_proxy_the_visitor_is_the_address_the_proxy_appended():
    # The proxy appends the address it saw; anything to the left came from the
    # caller and is not evidence of anything.
    assert client_key("172.18.0.5", "1.2.3.4, 198.51.100.7", behind_proxy=True) == "198.51.100.7"


def test_behind_a_proxy_with_no_forwarded_header_falls_back_to_the_peer():
    assert client_key("172.18.0.5", "", behind_proxy=True) == "172.18.0.5"
    assert client_key("172.18.0.5", None, behind_proxy=True) == "172.18.0.5"


def test_peeking_says_whether_a_run_would_be_allowed_without_counting_one():
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=_Clock())

    assert limiter.would_allow("a")
    assert limiter.would_allow("a"), "peeking used up the allowance"
    limiter.try_acquire("a")
    assert not limiter.would_allow("a")
    assert RunLimiter(max_runs=0, window_seconds=60).would_allow("a")


# ── which visitor ───────────────────────────────────────────────────────────


def test_every_address_in_one_ipv6_64_is_one_visitor():
    """An IPv6 subscriber is handed a whole /64. Counted per address, one
    visitor had 2^64 allowances."""
    a = client_key("2001:db8:1:2::1", None, behind_proxy=False)
    b = client_key("2001:db8:1:2:ffff:ffff:ffff:ffff", None, behind_proxy=False)
    assert a == b


def test_a_different_ipv6_64_is_a_different_visitor():
    assert client_key("2001:db8:1:2::1", None, behind_proxy=False) != client_key(
        "2001:db8:1:3::1", None, behind_proxy=False
    )


def test_the_64_applies_to_the_forwarded_address_too():
    a = client_key("10.0.0.1", "2001:db8:1:2::1", behind_proxy=True)
    b = client_key("10.0.0.1", "2001:db8:1:2::abcd", behind_proxy=True)
    assert a == b


def test_ipv4_is_counted_per_address():
    assert client_key("198.51.100.1", None, behind_proxy=False) == "198.51.100.1"
    assert client_key("198.51.100.1", None, behind_proxy=False) != client_key(
        "198.51.100.2", None, behind_proxy=False
    )


def test_an_ipv4_mapped_ipv6_address_is_the_ipv4_visitor():
    assert client_key("::ffff:198.51.100.1", None, behind_proxy=False) == "198.51.100.1"


def test_a_peer_that_is_not_an_address_is_kept_as_is():
    """The test client's peer is ``testclient``: not an address, still a key."""
    assert client_key("testclient", None, behind_proxy=False) == "testclient"


def test_fifty_addresses_from_one_64_get_one_allowance():
    """The audit's measurement, inverted: 50 of 50 runs used to be allowed."""
    limiter = RunLimiter(max_runs=3, window_seconds=3600, clock=_Clock())
    allowed = sum(
        limiter.try_acquire(client_key(f"2001:db8:1:2::{n:x}", None, behind_proxy=False))[0] for n in range(50)
    )
    assert allowed == 3


# ── memory ──────────────────────────────────────────────────────────────────


def test_asking_whether_a_run_would_be_allowed_tracks_nobody():
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=_Clock())
    for n in range(100):
        limiter.would_allow(f"visitor-{n}")
    assert limiter.tracked == 0


def test_visitors_whose_runs_have_aged_out_are_forgotten():
    """Every new address used to add an entry that was never removed."""
    clock = _Clock()
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=clock)
    for n in range(100):
        limiter.try_acquire(f"visitor-{n}")
    assert limiter.tracked == 100

    clock.now += 61
    limiter.try_acquire("someone-new")
    assert limiter.tracked == 1


def test_forgetting_a_visitor_does_not_reset_one_still_in_the_window():
    clock = _Clock()
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=clock)
    limiter.try_acquire("old")
    clock.now += 30
    limiter.try_acquire("recent")
    clock.now += 31
    limiter.try_acquire("trigger")
    assert not limiter.try_acquire("recent")[0], "a visitor still inside the window was forgotten"


def test_wait_says_how_long_without_counting():
    clock = _Clock()
    limiter = RunLimiter(max_runs=1, window_seconds=60, clock=clock)
    assert limiter.wait("a") == 0.0
    limiter.try_acquire("a")
    clock.now += 10
    assert limiter.wait("a") == 50
    assert limiter.wait("a") == 50, "asking counted a run"
    assert RunLimiter(max_runs=0, window_seconds=60).wait("a") == 0.0
