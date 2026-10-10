"""Plain-English narration of each step, for the page."""

from __future__ import annotations

__all__ = ["CAPTIONS", "PHASES", "caption_for", "human_summary", "phase_for"]

#: The stages of a run, in order. ``steps`` lists the step ids that belong to each.
#:
#: Each phase names the security property it demonstrates, because that is the
#: part a reader would otherwise have to infer — and the most important one (a
#: venue refusing to let a caller agree on somebody else's behalf) looks like a
#: failure unless it is labelled.
PHASES: tuple[dict[str, object], ...] = (
    {
        "id": "discovery",
        "number": 1,
        "title": "Finding the right people",
        "summary": (
            "The concierge looks both companies up in a public directory of AI agents, then "
            "works out which agent to contact at each one."
        ),
        "validation": (
            "Each guest is found a different way, so neither result depends on the other "
            "working. One is found by searching for what they handle; the other by looking up a "
            "name directly. Companies list what each agent handles and never a person's own "
            "profile text, so the right agent can be found without learning anything personal "
            "about them."
        ),
        "steps": ("discover.organisation", "discover.catalog", "discover.agent"),
    },
    {
        "id": "outreach",
        "number": 2,
        "title": "Asking each guest",
        "summary": (
            "The concierge sends the lunch request to each guest's own agent. Every request is "
            "signed, so each company can tell exactly who asked."
        ),
        "validation": (
            "The concierge also writes a note onto each agent's own file. Both companies keep "
            "their own record of the request, rather than having to take the concierge's word "
            "for it later."
        ),
        "steps": ("ask.intent", "ask.note"),
    },
    {
        "id": "coordination",
        "number": 3,
        "title": "Checking the restaurant",
        "summary": (
            "The concierge asks the restaurant which sittings are free, across its tables. "
            "Anyone can ask this — no credentials needed, the same as telephoning."
        ),
        "validation": (
            "The restaurant answers without the concierge having to say who it is or who it is "
            "booking for. Nothing is given away before it needs to be."
        ),
        "steps": ("venue.availability",),
    },
    {
        "id": "consensus",
        "number": 4,
        "title": "Agreeing and booking",
        "summary": (
            "The concierge puts a table on hold, naming everyone whose agreement the booking "
            "needs, records the agreements it can actually prove, and reports where that leaves "
            "the table."
        ),
        "validation": (
            "The concierge asks the restaurant to record two agreements. For the host it "
            "presents the host's signed authorisation and is accepted; for a guest it presents "
            "nothing and is refused. The difference between those two calls is a signature, and "
            "it is what stops a booking claiming an agreement that never happened."
        ),
        "steps": (
            "venue.hold.multiparty",
            "venue.consent.host",
            "venue.consent.as_guest",
            "venue.book",
            "venue.receipt",
        ),
    },
)

_PHASE_BY_STEP: dict[str, dict[str, object]] = {
    step: phase
    for phase in PHASES
    for step in phase["steps"]  # type: ignore[union-attr]
}

#: step id -> (heading, what it means, past-tense phrase for the summary line)
CAPTIONS: dict[str, tuple[str, str, str]] = {
    "discover.organisation": (
        "Find the company",
        "Search a public directory of AI agents for the company by name. It gives back the "
        "address of that company's own listings. None of this was known in advance.",
        "Searched the public directory for the company",
    ),
    "discover.catalog": (
        "Read the company's listings",
        "Fetch what the company publishes about itself and its agents: what each one handles, "
        "and where to reach it. Any agents the company chooses not to list are counted, so the "
        "listing can never look shorter than it really is.",
        "Read the company's public listings",
    ),
    "discover.agent": (
        "Find the guest's agent",
        "Work out which agent to contact, and where it answers. For one guest that means "
        "searching the company's listings for the right skill; for the other, looking the agent "
        "up by name in a second directory. Either way the concierge ends up at the address that "
        "agent actually answers on.",
        "Found the guest's agent",
    ),
    "ask.intent": (
        "Send the invitation",
        "Deliver the lunch request to the guest's own agent, signed so the company can tell who "
        "sent it. The company records it as an open request its agents can respond to.",
        "Sent the signed lunch request to the guest's agent",
    ),
    "ask.note": (
        "Leave a note on file",
        "Write a short note onto the guest agent's own file, so the company has its own copy of "
        "the request rather than having to take the concierge's word for it.",
        "Wrote a note onto the guest agent's own file",
    ),
    "venue.availability": (
        "Check the restaurant",
        "Ask the restaurant which sittings are free. Anyone can ask — no credentials are offered "
        "and none are needed, the same as telephoning.",
        "Asked the restaurant which sittings were free",
    ),
    "venue.hold.multiparty": (
        "Hold the table",
        "Put a table on hold, naming everyone whose agreement the booking needs. A hold is not a "
        "booking — it expires unless everyone named agrees in time.",
        "Put a table on hold, naming everyone needed",
    ),
    "venue.consent.host": (
        "Agree on the host's behalf",
        "The host signed this agent a grant: a document saying what it may do for them, "
        "until when, and with whom. The concierge presents it, and the restaurant checks "
        "that signature itself rather than taking this agent's word for it.",
        "Recorded the host's agreement, on the host's own signature.",
    ),
    "venue.consent.as_guest": (
        "Try to agree for a guest",
        "The same request as the one before, for a guest instead of the host — and with no "
        "grant to present, because the guest never signed one. The restaurant refuses. An agent "
        "may act for someone who has said in writing that it may, and for nobody else.",
        "Tried to accept for a guest",
    ),
    "venue.receipt": (
        "Fetch the restaurant's own receipt",
        "Read the restaurant's signed record of the booking back out of its public log — the "
        "same way an outsider checking this booking would. The booking returned a reference; "
        "this is the document that reference names, signed by the restaurant rather than by us.",
        "Read the restaurant's own signed receipt from its public log",
    ),
    "venue.book": (
        "Where the booking stands",
        "Report the state of the hold. It becomes a booking when everyone named on it has "
        "agreed, and the restaurant signs a receipt only then. Until the guests answer, a "
        "held table is the honest answer and this step says so.",
        "Reported where the booking stands",
    ),
}

_FALLBACK = ("Step", "This step ran but has no description yet.", "Ran a step")


def caption_for(step: str) -> tuple[str, str, str]:
    """Heading, explanation and past-tense phrase for ``step``."""
    return CAPTIONS.get(step, _FALLBACK)


def phase_for(step: str) -> dict[str, object] | None:
    """The phase ``step`` belongs to, or None if it belongs to none."""
    return _PHASE_BY_STEP.get(step)


def human_summary(step: str, outcome: str) -> str:
    """One sentence, written into the signed receipt."""
    _, _, did = caption_for(step)
    tail = outcome.strip()
    if not tail:
        return f"{did}."
    if not tail.endswith((".", "!", "?")):
        tail += "."
    return f"{did}. {tail}"
