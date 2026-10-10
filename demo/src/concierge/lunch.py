"""The lunch scenario, step by step."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from . import authority
from .discovery import (
    CONFIGURED,
    RESOLVED,
    SEARCHED,
    Counterparty,
    endpoint_from_card,
    find_agent_by_capability,
    org_catalog,
    resolve_pointer,
    search_capability,
)
from .identity import Identity
from .narration import human_summary
from .peer import Peer, llm_exhausted
from .receipts import Receipt, ReceiptChain
from .venue import Venue, fetch_receipt

__all__ = ["DEFAULT_RESOURCES", "Guest", "Plan", "arrange"]

#: What a receipt must never be read as saying. Attached at the step that earns
#: them rather than kept in documentation, because a chain read later arrives
#: without the documentation.
_NOT_CLAIMED_ASK = (
    "That the guest agreed. Only that their company's agent recorded the request.",
    "That the agent is authorised to speak for the person named.",
)
_NOT_CLAIMED_BOOK = (
    "That anyone will attend.",
    "That the guests agreed. Only the host has, and only on a grant it signed itself.",
    "That the restaurant is who its public listing says it is.",
)


#: Tables tried in order. More than one because a demo that books the same
#: table at the same hour works exactly once, and a system that works once is
#: not a working system — the second run reports "no slot open" and looks broken.
DEFAULT_RESOURCES = ("table-4", "table-7", "table-2", "table-9")


#: How a guest's agent is located. Two live mechanisms, deliberately one each,
#: because a run that used the same hop twice would demonstrate it once.
VIA_INDEX_V2 = "index-v2"  # search the org, read its catalog, match a capability
VIA_INDEX_V3 = "index-v3"  # resolve a key-anchored name to its current pointer


@dataclass(frozen=True)
class Guest:
    """Somebody to invite, and how their agent is to be found."""

    who: str
    #: The company, as a person would name it. Used in every line a reader sees,
    #: because "Found 1 company" twice in a row tells them nothing about which
    #: company either step was about.
    company: str
    org_query: str
    agent_label: str
    #: The hop used to locate them.
    via: str = VIA_INDEX_V2
    #: For ``index-v2``: the capability to match against the org's catalog tags.
    capability: str = ""
    #: For the second-index route: the key-anchored name to resolve.
    urn: str = ""
    #: Used only when discovery fails, and recorded as ``configured`` when it is.
    agent_url: str = ""


@dataclass
class Plan:
    """What the run did, in the order it did it."""

    date: str
    resource: str
    candidate_starts: list[str]
    chain: ReceiptChain
    booked_start: str | None = None
    #: The sitting that was held, whether or not it became a booking.
    held_start: str | None = None
    hold_id: str | None = None
    notes: list[str] = field(default_factory=list)

    #: Where the table stands. ``confirmed`` only when every principal agreed;
    #: ``held`` while some have not; ``none`` when nothing was held at all.
    state: str = "none"
    #: How many people the table is for. Not how many must agree, and never
    #: the number of agents involved.
    covers: int = 0
    #: Principals who have not agreed yet.
    pending: tuple[str, ...] = ()

    def summary(self) -> dict[str, Any]:
        return {
            "date": self.date,
            "resource": self.resource,
            "booked_start": self.booked_start,
            "hold_id": self.hold_id,
            "steps": len(self.chain.entries),
            "notes": self.notes,
            # Said, not inferred. A page that reads a null booked_start as
            # "nothing booked" reports a held table as a failure.
            "state": self.state,
            "covers": self.covers,
            "pending": list(self.pending),
            "start": self.booked_start or self.held_start,
        }


def _locate(
    guest: Guest,
    chain: ReceiptChain,
    *,
    index_v3: str,
    catalogs: dict[str, dict[str, Any]],
) -> Counterparty:
    """Find the address of one guest's agent, and record how it was found."""
    if guest.via == VIA_INDEX_V3:
        try:
            record = resolve_pointer(guest.urn, index_url=index_v3)
            endpoint, card = endpoint_from_card(record["next_hop"])
            found = Counterparty(label=guest.agent_label, url=endpoint, how=RESOLVED, urn=guest.urn)
            chain.append(
                step="discover.agent",
                counterparty_label=_found_via(guest),
                request={"subject": guest.who, "via": VIA_INDEX_V3, "urn": guest.urn, "index": index_v3},
                answer={"next_hop": record["next_hop"], "card_name": card.get("name"), "endpoint": endpoint},
                outcome=f"Looked {guest.who} up by name and got {endpoint}",
                not_claimed=(
                    "That the key belongs to the person named. A directory records that a key "
                    "claimed an address, not who holds the key.",
                ),
            )
            return found
        except Exception as exc:  # noqa: BLE001 - a failed hop is a result
            detail = f"{type(exc).__name__}: {exc}"[:300]
    else:
        catalog = catalogs.get(guest.agent_label) or {}
        entry = find_agent_by_capability(catalog, guest.capability)
        if entry is not None:
            try:
                endpoint, card = endpoint_from_card(entry["url"])
                found = Counterparty(
                    label=guest.agent_label,
                    url=endpoint,
                    how=SEARCHED,
                    tags=tuple(str(t) for t in (entry.get("tags") or ())),
                )
                chain.append(
                    step="discover.agent",
                    counterparty_label=_found_via(guest),
                    request={
                        "subject": guest.who,
                        "via": VIA_INDEX_V2,
                        "capability": guest.capability,
                        "catalog": catalog.get("url"),
                    },
                    answer={
                        "identifier": entry.get("identifier"),
                        "tags": entry.get("tags"),
                        "card": entry["url"],
                        "endpoint": endpoint,
                        "card_name": card.get("name"),
                    },
                    outcome=(
                        f"Found {guest.who} in {guest.company}'s listings by searching for "
                        f"'{guest.capability}', and followed it to {endpoint}"
                    ),
                    not_claimed=(
                        "That the agent can do what its listing claims. A company describes its own agents.",
                    ),
                )
                return found
            except Exception as exc:  # noqa: BLE001
                detail = f"{type(exc).__name__}: {exc}"[:300]
        else:
            detail = f"no catalog entry claims '{guest.capability}'"

    fallback = Counterparty(label=guest.agent_label, url=guest.agent_url, how=CONFIGURED)
    chain.append(
        step="discover.agent",
        counterparty_label=_found_via(guest),
        request={"subject": guest.who, "via": guest.via, "capability": guest.capability, "urn": guest.urn},
        answer={"error": detail, "fell_back_to": guest.agent_url},
        outcome=f"Could not find the agent ({detail}); using the address it was given instead",
        not_claimed=("That this address was discovered. It was supplied.",),
    )
    return fallback


#: The counterparty labels the host's grant allow-lists. Built from the same
#: names the roster uses, so a guest added to config cannot end up with a label
#: nothing authorises — the run refuses instead of booking unauthorised.
VENUE_LABEL = "venue:nanda-demo"


def _org_label(guest: Guest) -> str:
    return f"org:{guest.org_query}"


def _agent_label(guest: Guest) -> str:
    return f"agent:{guest.agent_label}"


def _found_via(guest: Guest) -> str:
    """Where the address came from: the second index, or the org's own catalog."""
    return "index:second" if guest.via == VIA_INDEX_V3 else _org_label(guest)


def arrange(
    identity: Identity,
    *,
    guests: list[Guest],
    venue_url: str,
    date: str,
    candidate_starts: list[str],
    resources: list[str] | None = None,
    index_url: str | None = None,
    index_v3_url: str = "",
    on_step: Callable[[Receipt], None] | None = None,
    principal_did: str | None = None,
) -> Plan:
    """Run the scenario once, returning the plan and its receipt chain."""
    tables = list(resources or DEFAULT_RESOURCES)
    # Refused here, not at the verifier: a mismatch found afterwards means a real
    # table was booked on authority this agent did not hold.
    authority.check_grant_covers(identity.did)

    chain = ReceiptChain(
        private_key=identity.seed,
        granted_by=authority.grant_receipt_id(),
        # Who this agent acts for. The issuer DID comes from the key itself, so
        # there is no second place to state the signer and no way for the two to
        # disagree.
        principal_did=principal_did or authority.host_did(),
        on_append=on_step,
        summarise=human_summary,
    )
    plan = Plan(date=date, resource=tables[0], candidate_starts=list(candidate_starts), chain=chain)
    kwargs = {"index_url": index_url} if index_url else {}

    # ── 1 & 2: who are these organisations, publicly ────────────────────────
    catalogs: dict[str, dict[str, Any]] = {}
    for guest in guests:
        try:
            found = search_capability(guest.org_query, **kwargs)
        except Exception as exc:  # noqa: BLE001 - an index outage is a result
            chain.append(
                step="discover.organisation",
                counterparty_label="index:public",
                request={"subject": guest.company, "query": guest.org_query},
                answer={"error": f"{type(exc).__name__}: {exc}"[:300]},
                outcome="Could not reach the public directory",
            )
            continue

        chain.append(
            step="discover.organisation",
            counterparty_label="index:public",
            request={"subject": guest.company, "query": guest.org_query, "index": "api.nandaindex.org"},
            answer={"matches": [c.provenance() for c in found]},
            outcome=(
                f"Found {guest.company} in the public directory"
                if found
                else f"No company matched '{guest.org_query}'"
            ),
            not_claimed=("That the company found is the one meant. A listing describes itself.",),
        )

        for org in found[:1]:
            try:
                catalog = org_catalog(org.url)
            except Exception as exc:  # noqa: BLE001
                chain.append(
                    step="discover.catalog",
                    counterparty_label=_org_label(guest),
                    request={"subject": guest.company, "org": org.url},
                    answer={"error": f"{type(exc).__name__}: {exc}"[:300]},
                    outcome="Could not read the company's listings",
                )
                continue
            catalogs[guest.agent_label] = catalog
            chain.append(
                step="discover.catalog",
                counterparty_label=_org_label(guest),
                request={"subject": guest.company, "org": org.url, "how": SEARCHED},
                answer=catalog,
                outcome=(
                    # The sentence has to follow the document. An org that has
                    # opted in publishes its agents; one that has not withholds
                    # them, and a caption that describes the wrong one makes a
                    # closed directory look open or the reverse.
                    (
                        f"{guest.company} publishes {catalog['visible']} listings — itself and "
                        f"{max(catalog['visible'] - 1, 0)} agents, each with what it handles"
                    )
                    if not catalog["withheld"]
                    else (
                        f"{guest.company} publishes {catalog['visible']} listing; "
                        f"{catalog['withheld']} agents are not listed publicly"
                    )
                ),
                not_claimed=("That the company has only the agents shown.",),
            )

    # ── 2b: locate each guest's agent, by the hop that guest is found through ─
    located: dict[str, Counterparty] = {}
    for guest in guests:
        located[guest.agent_label] = _locate(guest, chain, index_v3=index_v3_url, catalogs=catalogs)

    # ── 3: ask each side, on their own agent, with deterministic tools ───────
    accepted: list[str] = []
    for guest in guests:
        target = located[guest.agent_label]
        if not target.url:
            chain.append(
                step="ask.intent",
                counterparty_label=_agent_label(guest),
                request={"subject": guest.who, "peer": target.provenance()},
                answer={},
                outcome="Skipped \u2014 the agent could not be found, so there was nothing to call.",
                not_claimed=_NOT_CLAIMED_ASK,
            )
            continue
        invitation = (
            f"Lunch invitation for {guest.who} on {date}. Candidate times: "
            f"{', '.join(candidate_starts)}. Asked by an external concierge agent; "
            "reply through your organisation's intent matching."
        )
        with Peer(label=guest.agent_label, url=target.url).open(
            agent_id=identity.agent_id, private_key=identity.seed, did=identity.did
        ) as peer:
            answer, payload = peer.invoke(
                "submit_intent", {"intent_text": invitation, "tags": ["lunch", "external", "concierge"]}
            )
            spent = llm_exhausted(payload)
            chain.append(
                step="ask.intent",
                counterparty_label=_agent_label(guest),
                request={"subject": guest.who, "peer": target.provenance(), "tool": "submit_intent"},
                answer={"envelope": answer.summary(), "payload": payload},
                outcome=(
                    "Delivered, but the agent had run out of thinking time for now — recorded, not yet answered"
                    if spent
                    else ("Recorded as an open request" if answer.ok else f"Refused: {answer.detail[:160]}")
                ),
                not_claimed=_NOT_CLAIMED_ASK,
            )
            if answer.ok and not spent:
                accepted.append(guest.agent_label)

            note, note_payload = peer.invoke(
                "save_note",
                {"text": f"External concierge asked about lunch on {date} for {guest.who}."},
            )
            chain.append(
                step="ask.note",
                counterparty_label=_agent_label(guest),
                request={"subject": guest.who, "peer": target.provenance(), "tool": "save_note"},
                answer={"envelope": note.summary(), "payload": note_payload},
                outcome="Written to the agent's own record" if note.ok else f"Refused: {note.detail[:160]}",
                not_claimed=_NOT_CLAIMED_ASK,
            )

    plan.notes.append(f"{len(accepted)} of {len(guests)} organisations recorded the invitation.")

    # ── 4: what is free, asked openly ───────────────────────────────────────
    with Venue.identified(
        venue_url, agent_id=identity.agent_id, private_key=identity.seed, did=identity.did
    ) as venue:
        # Asked table by table, stopping at the first with a free slot. A venue
        # whose every table is full at one hour is not a venue that cannot seat
        # anyone, and a run that gave up after one table would report the wrong
        # fact. Each full table is its own entry: "table-4 was full" is a finding.
        resource, start, open_slots = "", "", []
        for table in tables:
            avail = venue.availability(table, candidate_starts)
            payload = Venue.payload(avail)
            free = list((payload or {}).get("open") or [])
            chain.append(
                step="venue.availability",
                counterparty_label=VENUE_LABEL,
                request={"venue": venue_url, "resource": table, "start": candidate_starts},
                answer={"envelope": avail.summary(), "open": free},
                outcome=(
                    f"{len(free)} of {len(candidate_starts)} sittings free at {table}"
                    if avail.ok
                    else f"Refused: {avail.detail[:160]}"
                ),
                not_claimed=("That a free sitting will still be free when it is claimed.",),
            )
            if free:
                resource, start, open_slots = table, free[0], free
                break

        if not open_slots:
            plan.notes.append(f"Every sitting at {len(tables)} tables was taken. Nothing was held.")
            return plan

        plan.resource = resource

        # ── 5: a hold naming the people, and the refusal that matters ──
        #
        # The concierge is the caller, NOT a principal and NOT a cover. It books
        # for the host and the guests; it does not eat. Until the venue allowed
        # that, the only way to book honestly was to name itself among the
        # principals, discover it could not get the guests' consent, abandon the
        # hold, and take a second one naming nobody else — two holds on one slot,
        # and the cancellation of the first recorded nowhere.
        principals = [authority.host_did(), *(g.agent_label for g in guests)]
        held, claim = venue.hold(
            resource=resource,
            start=start,
            party=identity.did,
            principals=principals,
            covers=len(principals),
        )
        chain.append(
            step="venue.hold.multiparty",
            counterparty_label=VENUE_LABEL,
            request={"resource": resource, "start": start, "principals": principals},
            answer={"envelope": held.summary(), "slot": claim.slot if claim else None},
            outcome=(
                f"Table held. It needs all {len(principals)} people to agree before it becomes a booking."
                if held.ok
                else f"Refused: {held.detail[:200]}"
            ),
            not_claimed=("That a hold is a booking. A hold expires unless every party agrees.",),
        )

        hold_id = claim.hold_id if claim else ""
        host = authority.host_did()

        # ── 5b: the host's agreement, on the grant the host signed ──────────
        #
        # Not impersonation. The host's own key says, in a document the venue
        # checks for itself, that this agent may book on their behalf. That is
        # what the grant is for, and until now it was carried and never used.
        agreed = None
        if hold_id:
            agreed = venue.consent(hold_id=hold_id, principal=host, grant=authority.grant())
            chain.append(
                step="venue.consent.host",
                counterparty_label=VENUE_LABEL,
                request={"hold_id": hold_id, "principal": host, "presented": "the host's grant"},
                answer={"envelope": agreed.summary()},
                outcome=(
                    "Recorded. The host authorised this agent in writing, and the restaurant "
                    "checked that signature rather than taking this agent's word for it."
                    if agreed.ok
                    else f"Refused: {agreed.detail[:200]}"
                ),
                not_claimed=(
                    "That the guests agreed. Only the host did, and only because the host "
                    "signed a grant saying this agent may act for them.",
                ),
            )

        # ── 5c: the refusal that matters ────────────────────────────────────
        if hold_id:
            as_guest = venue.consent(hold_id=hold_id, principal=guests[0].agent_label)
            chain.append(
                step="venue.consent.as_guest",
                counterparty_label=VENUE_LABEL,
                request={"hold_id": hold_id, "principal": guests[0].agent_label},
                answer={"envelope": as_guest.summary()},
                outcome=(
                    "Refused, as it should be. This agent holds no grant from the guest, so "
                    "it cannot record their agreement — only they can give it."
                    if not as_guest.ok
                    else "Accepted — the restaurant let the concierge agree for someone else"
                ),
                not_claimed=("That the guests cannot agree. Only that this agent cannot agree for them.",),
            )

        # ── 6: where the booking stands ─────────────────────────────────────
        #
        # One hold, not two. The first version held a table naming this agent
        # among the diners, failed to get the guests' consent, cancelled that
        # hold without recording it, and took a second one naming nobody else —
        # which read as a confirmed booking and was a booking for software.
        # The venue has no read skill for a hold, and does not need one: every
        # consent returns the hold as it now stands, so the last successful write
        # is also the current state. Reading it from a separate call would be a
        # second answer that could disagree with the first.
        booked = agreed if (agreed is not None and agreed.ok) else held
        own = claim
        own_payload = Venue.payload(booked)
        state = (own_payload or {}).get("state", "unknown")
        pending = (own_payload or {}).get("pending") or []
        chain.append(
            step="venue.book",
            counterparty_label=VENUE_LABEL,
            request={"hold_id": hold_id},
            answer={"envelope": booked.summary()},
            outcome=(
                f"Confirmed: a table for {(own_payload or {}).get('covers', len(principals))}."
                if state == "confirmed"
                else (
                    f"Held for {(own_payload or {}).get('covers', len(principals))}, "
                    f"waiting on {len(pending)} of {len(principals)} to agree. "
                    "It becomes a booking when they do."
                )
            ),
            not_claimed=_NOT_CLAIMED_BOOK,
        )

        # The outcome, in the words the page shows under the result. A run that
        # held a table and said nothing about it left a reader to infer the
        # ending from the absence of one.
        covers = (own_payload or {}).get("covers", len(principals))
        plan.state = state if (booked.ok or held.ok) else "none"
        plan.covers = int(covers)
        plan.pending = tuple(pending)
        if held.ok or booked.ok:
            plan.held_start = start
            plan.hold_id = claim.hold_id if claim else None
        if state == "confirmed":
            plan.notes.append(f"Confirmed: a table for {covers} at {start}.")
        elif booked.ok or held.ok:
            plan.notes.append(
                f"A table for {covers} is held at {start}. The host has agreed; it becomes "
                f"a booking when the {len(pending)} guests do."
            )
        else:
            plan.notes.append("No table was held.")

        if booked.ok and own and state == "confirmed":
            plan.booked_start = start
            plan.hold_id = own.hold_id
            # ── 7: fetch the counterparty's own signed record of it ─────────
            #
            # The booking returned a receipt id. An id is the venue's word that a
            # receipt exists; the receipt is the artifact somebody else can
            # check. Fetched from the venue's PUBLIC log with no credential,
            # because that is what a third party auditing this booking would do.
            receipt_id = (own_payload or {}).get("receipt_id")
            try:
                receipt = fetch_receipt(venue_url, str(receipt_id)) if receipt_id else None
                found_it = receipt is not None
            except Exception as exc:  # noqa: BLE001 - an unreachable log is a result
                receipt, found_it = None, False
                detail = f"{type(exc).__name__}: {exc}"[:200]
            else:
                detail = ""
            chain.append(
                step="venue.receipt",
                counterparty_label=VENUE_LABEL,
                request={"venue": venue_url, "receipt_id": receipt_id, "read_as": "anonymous"},
                answer={"receipt": receipt, "error": detail},
                outcome=(
                    (
                        "The restaurant's own signed receipt: "
                        + str((receipt.get("action") or {}).get("human_summary", ""))
                    )
                    if found_it
                    else f"The restaurant issued {receipt_id} but its public log does not carry it"
                    if not detail
                    else f"Could not read the restaurant's public log ({detail})"
                ),
                not_claimed=(
                    "That the restaurant will honour it. A receipt records what was agreed, "
                    "not what will happen.",
                    "That this is the restaurant's latest word on the table. A receipt shows "
                    "what was recorded, not that nothing was recorded afterwards.",
                ),
            )
            # "Slot fold" is the internal name for the digest both sides use to
            # identify one sitting. It belongs in the receipt, not in a line a
            # guest reads, so the note carries the reference a person would quote
            # to the restaurant.
            plan.notes.append(f"Restaurant confirmation {(own_payload or {}).get('receipt_id')}.")

    return plan
