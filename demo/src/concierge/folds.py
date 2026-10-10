"""The slot fold: sha256(resource + NUL + start). Both ends of a booking use it."""

from __future__ import annotations

import hashlib

__all__ = ["SLOT_SEPARATOR", "slot_ref"]

#: The byte between the two fields. Not configurable: a fold is only useful if
#: both sides compute it identically, and an option is a way for them not to.
SLOT_SEPARATOR = b"\x00"


def slot_ref(resource: str, start: str) -> str:
    """The venue's name for one bookable slot: ``sha256(resource \x00 start)``."""
    digest = hashlib.sha256()
    digest.update(resource.encode("utf-8"))
    digest.update(SLOT_SEPARATOR)
    digest.update(start.encode("utf-8"))
    return digest.hexdigest()
