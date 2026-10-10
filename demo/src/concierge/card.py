"""This agent's own A2A agent card."""

from __future__ import annotations

from typing import Any

__all__ = ["AGENT_CARD_MEDIA_TYPE", "SKILL_ID", "build_card"]

AGENT_CARD_MEDIA_TYPE = "application/a2a-agent-card+json"

#: One skill, because this agent does one thing. A card listing capabilities an
#: agent does not have is the same defect as a pointer to a 404, one layer up.
SKILL_ID = "concierge.arrange_meal"


def build_card(*, name: str, url: str, did: str, urn: str, version: str = "0.1.0") -> dict[str, Any]:
    """The card served at ``/.well-known/agent-card.json``."""
    return {
        "protocolVersion": "0.3.0",
        "name": name,
        "description": (
            "Arranges a meal between parties whose organisations each run their own agents: "
            "asks each side, agrees a time, books a venue that can refuse, and keeps a receipt "
            "chain of what was asked and what was answered."
        ),
        "url": url,
        "preferredTransport": "JSONRPC",
        "version": version,
        "capabilities": {"streaming": False, "pushNotifications": False, "stateTransitionHistory": False},
        "defaultInputModes": ["application/json"],
        "defaultOutputModes": ["application/json"],
        "skills": [
            {
                "id": SKILL_ID,
                "name": "Arrange a meal",
                "description": (
                    "Given two parties and a date, ask each party's organisation, agree an hour "
                    "both accepted, hold a table at a venue, and return the receipt chain."
                ),
                "tags": ["scheduling", "hospitality", "booking", "negotiation", "multi-party"],
                "examples": [
                    "Invite the CEO of Regentix and the programme director of AstroCity to lunch on 2 October."
                ],
            }
        ],
        # Not part of the A2A schema. Published because a reader who has this card
        # should be able to check the index record independently rather than
        # trusting the card's own account of who it is.
        "x-nanda": {"didKey": did, "indexUrn": urn},
    }
