"""HTTP server: the agent card, the page, and the run endpoint."""

from __future__ import annotations

import contextlib
import json
import queue
import threading
import threading as _threading
import time
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.routing import Route

from . import authority, capabilities, config, renewal
from .card import AGENT_CARD_MEDIA_TYPE, build_card
from .identity import Identity, ensure_registered, load_or_create
from .lunch import VIA_INDEX_V2, arrange
from .narration import PHASES, caption_for, phase_for
from .receipts import chain_link
from .references import probe_all

__all__ = ["build_app"]

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
    state: dict[str, Any] = {"last": None, "refs": None, "vocab": None}
    #: Created here, not in the lifespan, so ``started_at`` is the process's
    #: own clock and /healthz can answer before the first tick is due.
    heartbeat = renewal.Heartbeat()
    lock = threading.Lock()

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
        state["last"] = payload
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
            if not lock.acquire(blocking=False):
                return _error(rpc_id, INTERNAL_ERROR, "a run is already in progress; try concierge.last_run")
            try:
                result = {"skill": skill, "kind": "receipt-chain", **_arrange()}
            except Exception as exc:  # noqa: BLE001 - reported in the envelope, never as a 500
                return _error(rpc_id, INTERNAL_ERROR, f"{type(exc).__name__}: {exc}"[:400])
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

    async def ui_stream(_: Request) -> StreamingResponse:
        """Server-sent events: one per step, as it completes."""

        def generate():
            if not lock.acquire(blocking=False):
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
                    state["last"] = payload
                    outcome["summary"] = plan.summary()
                except Exception as exc:  # noqa: BLE001 - reported to the page, not a 500
                    outcome["error"] = f"{type(exc).__name__}: {exc}"[:400]
                finally:
                    events.put(None)

            worker = _threading.Thread(target=run, daemon=True)
            worker.start()
            try:
                yield _sse(
                    "start",
                    {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "agent": me.did, "urn": me.urn},
                )
                while True:
                    entry = events.get()
                    if entry is None:
                        break
                    yield _sse("step", _step_payload(entry.to_dict()))
                if "error" in outcome:
                    yield _sse("error", {"message": outcome["error"]})
                else:
                    yield _sse("done", outcome.get("summary") or {})
            finally:
                worker.join(timeout=1)
                lock.release()

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
        term = (request.query_params.get("q") or "").strip()
        if not term:
            return JSONResponse(
                {"error": "bad_request", "detail": 'a capability is required, as "q"'}, status_code=400
            )
        result = await run_in_threadpool(capabilities.search, term)
        return JSONResponse(result.to_dict())

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
