"""HTTP server: the agent card, the page, and the run endpoint."""

from __future__ import annotations

import contextlib
import json
import logging
import math
import queue
import threading
import threading as _threading
import time
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.routing import Route

from . import authority, capabilities, config, lastrun, renewal
from .card import AGENT_CARD_MEDIA_TYPE, build_card
from .identity import Identity, ensure_registered, load_or_create
from .lunch import VIA_INDEX_V2, arrange
from .narration import PHASES, caption_for, phase_for
from .ratelimit import RunLimiter, client_key
from .receipts import chain_link
from .references import probe_all
from .security import SecurityHeaders, content_security_policy

__all__ = ["build_app"]

log = logging.getLogger(__name__)

#: The window the per-visitor and global run limits count over.
RUN_LIMIT_WINDOW_SECONDS = 3600.0

#: The one key the global run budget is counted under.
EVERYONE = "*"

#: How long a visitor's stream waits for a run before giving up on it. The run
#: itself carries on to the end and holds the lock until then (every request it
#: makes has its own timeout); this bounds what one visitor's connection holds.
RUN_STREAM_TIMEOUT_SECONDS = 300.0

#: Said instead of the exception, which can name internal hosts and libraries.
#: The detail goes to the log.
RUN_FAILED_MESSAGE = "The run failed before it finished. The cause has been logged for the operator."

#: A capability search is about 3 + 2N requests to other organisations'
#: servers, so an answer is reused for a minute rather than re-fetched.
CAPABILITY_CACHE_SECONDS = 60.0
CAPABILITY_CACHE_MAX_ENTRIES = 256
CAPABILITY_LIMIT_WINDOW_SECONDS = 60.0
#: Searches running at once. Each holds a worker thread for up to ~16s against
#: a slow organisation, and the pool is shared with the run's event stream.
CAPABILITY_MAX_CONCURRENT = 4
#: Longer than any capability name the estate publishes; anything longer is not
#: a search, and is refused before anything is fetched.
CAPABILITY_MAX_LENGTH = 64
#: What a busy server suggests to a caller as a wait, in seconds.
BUSY_RETRY_SECONDS = 5

#: The capability cache's clock. Monotonic, and a name of its own so a test can
#: move it without moving every other clock in the process.
_clock = time.monotonic

#: JSON-RPC codes, reused from the estate's vocabulary rather than invented, so a
#: client that already talks to the venue reads these without a second table.
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

#: How long a probe result may be reused. Long enough that switching tabs does
#: not re-probe eleven hosts, short enough that the answer is still about now.
REFERENCES_CACHE_SECONDS = 15.0

#: The published vocabulary changes when an organisation redeploys, not between
#: keystrokes, so it is cached for much longer than a health probe.
VOCABULARY_CACHE_SECONDS = 300.0


def _error(rpc_id: Any, code: int, message: str) -> JSONResponse:
    # Always HTTP 200 with the error inside the envelope: a JSON-RPC client looks
    # for it there, and a transport-level failure tells it nothing about which of
    # its request, its credential or this agent was at fault.
    return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}})


def _text_part(message: Any) -> str | None:
    if not isinstance(message, dict):
        return None
    for part in message.get("parts") or []:
        if isinstance(part, dict) and part.get("kind") == "text" and isinstance(part.get("text"), str):
            return part["text"]
    return None


def build_app(identity: Identity | None = None) -> Starlette:
    me = identity or load_or_create("concierge")
    card = build_card(name="NANDA Demo Concierge", url=config.service_url(), did=me.did, urn=me.urn)

    # The last run's chain, guarded because a scenario takes ~a minute and two
    # callers can overlap. The lock is around the *run*, not just the write: two
    # concurrent runs would race for the same venue slot and one would get a
    # refusal caused by the other, which is a confusing thing to put in a receipt.
    # The last run is also kept on disk, beside the key, so a redeploy does not
    # leave the next visitor nothing to watch but a live run.
    last_path = lastrun.default_path()
    state: dict[str, Any] = {"last": lastrun.load(last_path), "refs": None, "vocab": None}
    limiter = RunLimiter(config.run_limit_per_hour(), RUN_LIMIT_WINDOW_SECONDS)
    everyone = RunLimiter(config.run_limit_global_per_hour(), RUN_LIMIT_WINDOW_SECONDS)
    searches = RunLimiter(config.capability_limit_per_minute(), CAPABILITY_LIMIT_WINDOW_SECONDS)
    search_slots = threading.BoundedSemaphore(CAPABILITY_MAX_CONCURRENT)
    found: dict[str, tuple[float, dict[str, Any]]] = {}
    proxied = config.behind_proxy()
    #: Created here, not in the lifespan, so ``started_at`` is the process's
    #: own clock and /healthz can answer before the first tick is due.
    heartbeat = renewal.Heartbeat()
    lock = threading.Lock()

    def _remember(payload: dict[str, Any]) -> None:
        state["last"] = payload
        try:
            lastrun.save(payload, last_path)
        except OSError as exc:
            # The run happened and its chain is in memory; losing the replay on
            # the next restart is worth a warning, not a failed run.
            log.warning("could not save the last run to %s: %s", last_path, exc)

    def _visitor(request: Request) -> str:
        peer = request.client.host if request.client else "unknown"
        return client_key(peer, request.headers.get("x-forwarded-for"), behind_proxy=proxied)

    def _limit_message(wait: float) -> str:
        n = limiter.max_runs
        minutes = max(1, math.ceil(wait / 60))
        return (
            f"You have used your {n} live run{'s' if n != 1 else ''} for this hour. Each one sends "
            "real messages to two companies' agents and holds a real table, so they are rationed. "
            f"Try again in {minutes} minute{'s' if minutes != 1 else ''} — or watch the last run."
        )

    def _global_message(wait: float) -> str:
        n = everyone.max_runs
        minutes = max(1, math.ceil(wait / 60))
        return (
            f"The demo has used its {n} live run{'s' if n != 1 else ''} for this hour, across all visitors. "
            f"Try again in {minutes} minute{'s' if minutes != 1 else ''} — or watch the last run."
        )

    def _refusal(visitor: str) -> str | None:
        """Why ``visitor`` may not start a run now, or None. Counts nothing."""
        wait = limiter.wait(visitor)
        if wait:
            return _limit_message(wait)
        wait = everyone.wait(EVERYONE)
        return _global_message(wait) if wait else None

    def _admit(visitor: str) -> tuple[str, str]:
        """Take the run lock and count the run, or say why not.

        Returns ``("ok", "")`` with the lock held, ``("limited", why)`` or
        ``("busy", "")``. Over-limit visitors are turned away before the lock, so
        retrying cannot make a run look "in progress" to anyone else; a run is
        counted only once it can actually start, so a visitor who found another
        run in progress has not used anything.
        """
        refusal = _refusal(visitor)
        if refusal:
            return "limited", refusal
        if not lock.acquire(blocking=False):
            return "busy", ""
        # Checked again under the lock: only one admission happens at a time, so
        # what is checked here is what is counted.
        refusal = _refusal(visitor)
        if refusal:
            lock.release()
            return "limited", refusal
        limiter.try_acquire(visitor)
        everyone.try_acquire(EVERYONE)
        return "ok", ""

    async def agent_card(_: Request) -> JSONResponse:
        return JSONResponse(card, media_type=AGENT_CARD_MEDIA_TYPE)

    async def healthz(_: Request) -> JSONResponse:
        return JSONResponse(
            {
                "ok": True,
                "did": me.did,
                "urn": me.urn,
                "last_run_steps": len(state["last"]["entries"]) if state["last"] else 0,
                # The renewal loop used to log only when it renewed, so a healthy
                # loop and a dead one both produced silence. This is the only way
                # to tell them apart from outside the process.
                "renewal": heartbeat.to_dict(),
            }
        )

    def _arrange() -> dict[str, Any]:
        plan = arrange(
            me,
            guests=config.DEFAULT_GUESTS,
            venue_url=config.venue_url(),
            date=config.lunch_date(),
            candidate_starts=config.candidate_starts(),
            index_url=config.public_index_url(),
            index_v3_url=config.index_v3_url(),
        )
        payload = {"summary": plan.summary(), "entries": [e.to_dict() for e in plan.chain.entries]}
        _remember(payload)
        return payload

    async def a2a(request: Request) -> JSONResponse:
        try:
            payload = json.loads(await request.body() or b"null")
        except json.JSONDecodeError as exc:
            return _error(None, INVALID_REQUEST, f"invalid JSON: {exc}")
        if not isinstance(payload, dict):
            return _error(None, INVALID_REQUEST, "a JSON-RPC request must be an object")

        rpc_id = payload.get("id")
        if payload.get("jsonrpc") != "2.0":
            return _error(rpc_id, INVALID_REQUEST, "jsonrpc must be '2.0'")
        if payload.get("method") != "message/send":
            return _error(
                rpc_id,
                METHOD_NOT_FOUND,
                f"unsupported method {payload.get('method')!r}; this agent serves message/send",
            )

        params = payload.get("params")
        text = _text_part(params.get("message") if isinstance(params, dict) else None)
        if text is None:
            return _error(rpc_id, INVALID_PARAMS, "params.message must carry a text part")
        try:
            intent = json.loads(text)
        except json.JSONDecodeError as exc:
            return _error(rpc_id, INVALID_PARAMS, f"the text part is not JSON: {exc}")
        if not isinstance(intent, dict):
            return _error(rpc_id, INVALID_PARAMS, "the text part must be a JSON object")

        skill = intent.get("skill")
        if skill == "concierge.last_run":
            result = state["last"] or {"summary": None, "entries": [], "note": "no run yet"}
            result = {"skill": skill, "kind": "receipt-chain", **result}
        elif skill == "concierge.arrange_meal":
            admitted, why = _admit(_visitor(request))
            if admitted == "limited":
                return _error(rpc_id, INTERNAL_ERROR, why)
            if admitted == "busy":
                return _error(rpc_id, INTERNAL_ERROR, "a run is already in progress; try concierge.last_run")
            try:
                result = {"skill": skill, "kind": "receipt-chain", **_arrange()}
            except Exception:  # noqa: BLE001 - reported in the envelope, never as a 500
                log.exception("concierge.arrange_meal failed")
                return _error(rpc_id, INTERNAL_ERROR, RUN_FAILED_MESSAGE)
            finally:
                lock.release()
        else:
            return _error(
                rpc_id,
                INVALID_PARAMS,
                f"unknown skill {skill!r}; this agent serves concierge.arrange_meal, concierge.last_run",
            )

        # ⚠️ THE CALLER'S OWN REQUEST ID, ECHOED BACK.
        #
        # Without it a caller with two requests in flight cannot tell which
        # answer belongs to which — the same reason the venue echoes it, in its
        # own words. It is also what makes this agent testable from outside: a
        # conformance harness sends one logical request twice and matches the
        # answers by this field, and refuses the result when it is absent.
        #
        # Measured: nandatown's path evaluator failed this agent at the semantic
        # boundary for want of it, while the venue passed.
        if isinstance(intent.get("request_id"), str):
            result = {**result, "request_id": intent["request_id"]}

        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {
                    "kind": "task",
                    "id": f"task-{me.subject_key[1:13]}",
                    "contextId": "concierge",
                    "status": {"state": "completed"},
                    "artifacts": [
                        {
                            "name": str(skill),
                            "parts": [{"kind": "text", "text": json.dumps(result, ensure_ascii=False)}],
                        }
                    ],
                },
            }
        )

    # ── the demo page ───────────────────────────────────────────────────────
    #
    # At /ui, never at /. `POST /` is the A2A endpoint the agent card
    # advertises, and mounting a page at the root is how that gets quietly
    # broken by something that looks unrelated.

    page = Path(__file__).parent / "ui" / "index.html"

    async def ui(_: Request) -> FileResponse:
        return FileResponse(page, media_type="text/html; charset=utf-8")

    def _sse(event: str, payload: Any) -> bytes:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()

    def _step_payload(raw: dict[str, Any]) -> dict[str, Any]:
        """The page's view of one ARP receipt."""
        action = raw.get("action") or {}
        payload = action.get("machine_payload") or {}
        step = str(payload.get("action_type_label", ""))
        heading, plain, _ = caption_for(step)
        phase = phase_for(step)
        return {
            "phase": phase["id"] if phase else None,
            "seq": payload.get("seq", 0),
            "step": step,
            "heading": heading,
            "plain": plain,
            # The sentence as recorded, not ARP's five-value enum: the enum is
            # what a verifier reads, this is what a person reads.
            "outcome": payload.get("outcome_prose", ""),
            "arp_outcome": action.get("outcome", ""),
            "human_summary": action.get("human_summary", ""),
            "not_claimed": list(payload.get("not_claimed") or []),
            # Computed, never stored: a receipt that carried its own chain link
            # would be signing a value derived from itself.
            "digest": chain_link(raw) if raw.get("signature") else "",
            # The whole signed receipt, for the technical view. Sent once and used
            # by both tabs rather than fetched twice, so the two views cannot
            # disagree about what happened.
            "entry": raw,
        }

    async def ui_stream(request: Request) -> StreamingResponse:
        """Server-sent events: one per step, as it completes."""
        visitor = _visitor(request)

        def generate():
            admitted, why = _admit(visitor)
            if admitted == "limited":
                yield _sse("error", {"message": why, "limited": True})
                return
            if admitted == "busy":
                yield _sse("error", {"message": "A run is already in progress. Open the replay instead."})
                return

            events: queue.Queue = queue.Queue()
            outcome: dict[str, Any] = {}

            def run() -> None:
                try:
                    plan = arrange(
                        me,
                        guests=config.DEFAULT_GUESTS,
                        venue_url=config.venue_url(),
                        date=config.lunch_date(),
                        candidate_starts=config.candidate_starts(),
                        index_url=config.public_index_url(),
                        index_v3_url=config.index_v3_url(),
                        on_step=events.put,
                    )
                    payload = {
                        "summary": plan.summary(),
                        "entries": [e.to_dict() for e in plan.chain.entries],
                    }
                    _remember(payload)
                    outcome["summary"] = plan.summary()
                except Exception:  # noqa: BLE001 - reported to the page, not a 500
                    log.exception("the live run failed")
                    outcome["error"] = RUN_FAILED_MESSAGE
                finally:
                    events.put(None)
                    # Released by the run, not by the stream: a visitor who
                    # disconnects or times out must not free the lock while the
                    # run is still booking, or two runs race for one slot.
                    lock.release()

            worker = _threading.Thread(target=run, daemon=True)
            try:
                worker.start()
            except BaseException:
                lock.release()
                raise
            deadline = time.monotonic() + RUN_STREAM_TIMEOUT_SECONDS
            yield _sse(
                "start",
                {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "agent": me.did, "urn": me.urn},
            )
            while True:
                try:
                    entry = events.get(timeout=max(deadline - time.monotonic(), 0.0))
                except queue.Empty:
                    yield _sse(
                        "error",
                        {
                            "message": "The run is taking longer than expected. It will finish on its own; "
                            "open the replay in a few minutes."
                        },
                    )
                    return
                if entry is None:
                    break
                yield _sse("step", _step_payload(entry.to_dict()))
            if "error" in outcome:
                yield _sse("error", {"message": outcome["error"]})
            else:
                yield _sse("done", outcome.get("summary") or {})

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def ui_config(_: Request) -> JSONResponse:
        """What this run will ask for, in the page's own words."""
        return JSONResponse(
            {
                "request": config.request_sentence(),
                "date": config.lunch_date(),
                "date_readable": config.readable_date(),
                "guests": [
                    {
                        "who": g.who,
                        "company": g.company,
                        "agent": g.agent_label,
                        "via": g.via,
                        "found_by": (
                            f"searching the company's listings for '{g.capability}'"
                            if g.via == VIA_INDEX_V2
                            else "looking the agent up by name"
                        ),
                    }
                    for g in config.DEFAULT_GUESTS
                ],
                "venue": config.venue_url(),
                "index": config.public_index_url(),
                "candidates": len(config.candidate_starts()),
                # The phases are sent up front so the page can show the shape of a
                # run, and what each phase demonstrates, before a single step has
                # landed. A reader should know what to watch for.
                "phases": [
                    {
                        "id": p["id"],
                        "number": p["number"],
                        "title": p["title"],
                        "summary": p["summary"],
                        "validation": p["validation"],
                    }
                    for p in PHASES
                ],
                "agent": {"did": me.did, "urn": me.urn},
                "run_limit": {"per_hour": limiter.max_runs, "global_per_hour": everyone.max_runs},
            }
        )

    async def ui_references(_: Request) -> JSONResponse:
        """Every service the demo depends on, probed now."""
        now = time.time()
        cached = state.get("refs")
        if cached and now - cached[0] < REFERENCES_CACHE_SECONDS:
            return JSONResponse(cached[1])
        payload = {
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "references": [r.to_dict() for r in await run_in_threadpool(probe_all)],
        }
        state["refs"] = (now, payload)
        return JSONResponse(payload)

    async def ui_capability(request: Request) -> JSONResponse:
        """Which agent, in any organisation, claims a capability."""
        term = (request.query_params.get("q") or "").strip().casefold()
        if not term:
            return JSONResponse(
                {"error": "bad_request", "detail": 'a capability is required, as "q"'}, status_code=400
            )
        if len(term) > CAPABILITY_MAX_LENGTH:
            return JSONResponse(
                {
                    "error": "bad_request",
                    "detail": f"a capability is at most {CAPABILITY_MAX_LENGTH} characters",
                },
                status_code=400,
            )
        now = _clock()
        cached = found.get(term)
        if cached and now - cached[0] < CAPABILITY_CACHE_SECONDS:
            return JSONResponse(cached[1])

        # Only a search that will actually go out is counted or bounded: a
        # cached answer costs nobody anything.
        if not search_slots.acquire(blocking=False):
            return JSONResponse(
                {"error": "busy", "detail": "Too many searches are running. Try again in a few seconds."},
                status_code=503,
                headers={"Retry-After": str(BUSY_RETRY_SECONDS)},
            )
        try:
            allowed, wait = searches.try_acquire(_visitor(request))
            if not allowed:
                return JSONResponse(
                    {"error": "rate_limited", "detail": "Too many searches. Try again in a minute."},
                    status_code=429,
                    headers={"Retry-After": str(max(1, math.ceil(wait)))},
                )
            result = await run_in_threadpool(capabilities.search, term)
        finally:
            search_slots.release()
        payload = result.to_dict()
        _remember_search(term, payload, now)
        return JSONResponse(payload)

    def _remember_search(term: str, payload: dict[str, Any], now: float) -> None:
        """Keep an answer, dropping expired ones and then the oldest past the cap."""
        for key in [k for k, (at, _) in found.items() if now - at >= CAPABILITY_CACHE_SECONDS]:
            del found[key]
        while len(found) >= CAPABILITY_CACHE_MAX_ENTRIES:
            del found[next(iter(found))]
        found[term] = (now, payload)

    async def ui_vocabulary(_: Request) -> JSONResponse:
        """Every capability the three organisations publish, and who publishes it."""
        now = time.time()
        cached = state.get("vocab")
        if cached and now - cached[0] < VOCABULARY_CACHE_SECONDS:
            return JSONResponse(cached[1])
        vocab = await run_in_threadpool(capabilities.vocabulary)
        payload = {
            "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "capabilities": [{"name": k, "orgs": v} for k, v in vocab.items()],
        }
        state["vocab"] = (now, payload)
        return JSONResponse(payload)

    async def ui_authority(_: Request) -> JSONResponse:
        """The grant this agent runs under, for anyone who wants to check it."""
        try:
            return JSONResponse(
                {
                    "summary": authority.summary(),
                    "grant": authority.grant(),
                    "grant_receipt": authority.grant_receipt(),
                }
            )
        except authority.AuthorityError as exc:
            return JSONResponse({"error": "no_authority", "detail": str(exc)}, status_code=503)

    async def ui_last(_: Request) -> JSONResponse:
        """The most recent run, so a reload shows evidence without booking again."""
        last = state["last"]
        if not last:
            return JSONResponse({"summary": None, "steps": [], "note": "no run yet"})
        steps = [_step_payload(raw) for raw in last["entries"]]
        return JSONResponse({"summary": last["summary"], "steps": steps})

    def _renew() -> dict[str, Any]:
        return ensure_registered(me, index_url=config.index_url(), card_url=config.card_url())

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        # A record lives three days and registration happened once, at startup.
        # Without this the agent stayed resolvable for exactly as long as it had
        # been running, and then the venue refused it — because the venue
        # requires a caller whose key an index resolves.
        task = renewal.start(_renew, heartbeat=heartbeat)
        try:
            yield
        finally:
            await renewal.stop(task)

    return Starlette(
        lifespan=lifespan,
        middleware=[Middleware(SecurityHeaders, csp=content_security_policy(page.read_text(encoding="utf-8")))],
        routes=[
            Route("/.well-known/agent-card.json", agent_card),
            Route("/.well-known/agent.json", agent_card),
            Route("/healthz", healthz),
            Route("/ui", ui),
            Route("/ui/", ui),
            Route("/ui/config", ui_config),
            Route("/ui/references", ui_references),
            Route("/ui/authority", ui_authority),
            Route("/ui/capability", ui_capability),
            Route("/ui/vocabulary", ui_vocabulary),
            Route("/ui/stream", ui_stream),
            Route("/ui/last", ui_last),
            Route("/", a2a, methods=["POST"]),
        ],
    )
