"""This agent's Ed25519 key, its did:key, and its index registration."""

from __future__ import annotations

import base64
import json
import os
import socket
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import base58
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

__all__ = [
    "Identity",
    "RegistrationError",
    "ensure_registered",
    "host_exists",
    "load_or_create",
    "register",
    "resolve",
    "sign_intent",
    "subject_key_of",
    "SEED_ENV",
    "urn_for",
]

_MULTICODEC_ED25519 = b"\xed\x01"
#: Matches the path the estate's counterparties query. The venue resolves
#: `urn:ai:key:<subject_key>/agent`; registering under any other path is a record
#: nobody looks for.
DEFAULT_PATH = "agent"

#: Renew with half a day to spare. Enough slack that one failed boot does not
#: cost the record, short enough that the record is never nearly-expired in the
#: window a counterparty is likely to resolve it.
DEFAULT_RENEW_WITHIN_SECONDS = 12 * 60 * 60


def _home() -> Path:
    return Path(os.environ.get("CONCIERGE_HOME", ".concierge")).expanduser()


@dataclass(frozen=True)
class Identity:
    """One Ed25519 key, in the three encodings the estate uses for it."""

    agent_id: str
    seed: bytes
    did: str
    subject_key: str

    @property
    def urn(self) -> str:
        return urn_for(self.subject_key)


def subject_key_of(seed: bytes) -> str:
    """The index's spelling of a public key: ``u`` + base64url, unpadded."""
    public = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw()
    return "u" + base64.urlsafe_b64encode(public).decode().rstrip("=")


def did_of(seed: bytes) -> str:
    public = Ed25519PrivateKey.from_private_bytes(seed).public_key().public_bytes_raw()
    return "did:key:z" + base58.b58encode(_MULTICODEC_ED25519 + public).decode()


def urn_for(subject_key: str, path: str = DEFAULT_PATH) -> str:
    return f"urn:ai:key:{subject_key}/{path}"


SEED_ENV = "CONCIERGE_SEED"


def load_or_create(agent_id: str = "concierge") -> Identity:
    """This agent's identity: from the platform's secret store, else from disk."""
    supplied = os.environ.get(SEED_ENV, "").strip()
    if supplied:
        try:
            seed = base64.b64decode(supplied, validate=True)
        except Exception as exc:  # noqa: BLE001 - a bad seed must not be replaced silently
            raise ValueError(
                f"{SEED_ENV} is not valid base64 ({exc}). Refusing to mint a replacement: "
                "this agent would start under a different name and every receipt it "
                "ever signed would belong to an identity nobody can find."
            ) from exc
        if len(seed) != 32:
            raise ValueError(
                f"{SEED_ENV} decodes to {len(seed)} bytes; an Ed25519 seed is 32. "
                "Refusing to mint a replacement, for the same reason."
            )
        return Identity(agent_id=agent_id, seed=seed, did=did_of(seed), subject_key=subject_key_of(seed))

    home = _home()
    home.mkdir(parents=True, exist_ok=True)
    key_path = home / "agent.key"

    if key_path.exists():
        seed = base64.b64decode(key_path.read_text().strip())
        if len(seed) != 32:
            raise ValueError(
                f"{key_path} does not hold a 32-byte Ed25519 seed. Refusing to mint a "
                "replacement: that would silently change this agent's identity."
            )
    else:
        seed = Ed25519PrivateKey.generate().private_bytes_raw()
        key_path.write_text(base64.b64encode(seed).decode())
        key_path.chmod(0o600)

    return Identity(agent_id=agent_id, seed=seed, did=did_of(seed), subject_key=subject_key_of(seed))


# ── claiming the name ───────────────────────────────────────────────────────
#
# Two round trips, not one: ask for a challenge, then prove control of the key.
# Reimplemented here rather than imported from Orrery, because this repo exists to
# show two independent implementations agreeing over a wire — importing the other
# side's client would prove a function equals itself.
#
# The one thing that MUST match byte-for-byte is what gets signed: the context
# prefix, the JCS canonicalisation, and which challenge fields are covered. A
# test pins all three.

#: Domain separator. A signature without one can be replayed into any other
#: protocol that happens to sign JCS objects with the same key.
INTENT_CONTEXT = b"nanda-index-v3/intent-v2:"

#: Covered by the signature, in this order, and only when the challenge carries
#: them. Under JCS an absent key and a null one canonicalise differently, so
#: inventing a null signs something the index never issued.
INTENT_FIELDS = ("id", "subject_key", "next_hop", "media_type", "nonce", "audience", "not_after", "prev")


def sign_intent(seed: bytes, challenge: dict[str, Any]) -> str:
    """Sign the intent the challenge names — the whole intent, not the nonce."""
    import jcs

    body = {k: challenge[k] for k in INTENT_FIELDS if k in challenge}
    signature = Ed25519PrivateKey.from_private_bytes(seed).sign(INTENT_CONTEXT + jcs.canonicalize(body))
    return base64.b64encode(signature).decode("ascii")


class RegistrationError(RuntimeError):
    """The index refused, or answered something this client cannot use."""


def resolve(index_url: str, urn: str, *, timeout: float = 20.0) -> dict[str, Any] | None:
    """The current record for ``urn``, or None when the index carries none."""
    query = urllib.parse.urlencode({"id": urn})
    try:
        with urllib.request.urlopen(f"{index_url.rstrip('/')}/v1/resolve?{query}", timeout=timeout) as response:
            return json.loads(response.read(200_000).decode()).get("record")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


def _post(url: str, payload: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read(200_000).decode())
    except urllib.error.HTTPError as exc:
        raise RegistrationError(
            f"{url} refused ({exc.code}): {exc.read(400).decode(errors='replace')}"
        ) from exc


def register(
    identity: Identity,
    *,
    index_url: str,
    card_url: str,
    media_type: str = "application/a2a-agent-card+json",
    path: str = DEFAULT_PATH,
    timeout: float = 20.0,
) -> dict[str, Any]:
    """Claim the name, proving control of the key that names it."""
    base = index_url.rstrip("/")
    started = _post(
        f"{base}/v1/register",
        {
            "id": urn_for(identity.subject_key, path),
            "subject_key": identity.subject_key,
            "next_hop": card_url,
            "media_type": media_type,
            "anchor_type": "key",
        },
        timeout=timeout,
    )
    challenge = started.get("challenge")
    if not challenge:
        raise RegistrationError(f"/v1/register returned no challenge: {started}")

    proved = _post(
        f"{base}/v1/prove",
        {
            "challenge_id": challenge["challenge_id"],
            "response": {"subject_sig": sign_intent(identity.seed, challenge)},
        },
        timeout=timeout,
    )
    if "record" not in proved:
        raise RegistrationError(f"/v1/prove returned no record: {proved}")
    return proved


#: Hosts a pointer must never be registered against. An index record is a public
#: statement about where an agent answers; a loopback address is a statement no
#: reader outside this machine can act on.
_PRIVATE_HOSTS = ("localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]")


def is_publicly_resolvable(url: str) -> bool:
    """Whether ``url`` is an address somebody else could actually follow."""
    host = urllib.parse.urlsplit(url).hostname or ""
    return bool(host) and host.lower() not in _PRIVATE_HOSTS and not host.endswith(".local")


def host_exists(url: str, *, lookup: Callable[[str], object] | None = None) -> bool:
    """Whether this hostname exists in DNS at all."""
    host = urllib.parse.urlsplit(url).hostname or ""
    if not host:
        return False
    probe = lookup or (lambda h: socket.getaddrinfo(h, None))
    try:
        probe(host)
    except socket.gaierror as exc:
        # EAI_NONAME is the authoritative answer; EAI_AGAIN and friends are not.
        return exc.errno not in (socket.EAI_NONAME, socket.EAI_NODATA)
    except Exception:  # noqa: BLE001 - never let a resolver quirk unregister an agent
        return True
    return True


def ensure_registered(
    identity: Identity,
    *,
    index_url: str,
    card_url: str,
    media_type: str = "application/a2a-agent-card+json",
    path: str = DEFAULT_PATH,
    renew_within: float = DEFAULT_RENEW_WITHIN_SECONDS,
    now: Callable[[], datetime] | None = None,
) -> dict[str, Any]:
    """Claim the name, renew it if it is close to lapsing, else leave it alone."""
    clock = now or (lambda: datetime.now(UTC))
    urn = urn_for(identity.subject_key, path)

    # ⚠️ A DEVELOPMENT RUN MUST NOT REPOINT THE LIVE AGENT.
    #
    # Measured, and caused by this repo: running `python -m concierge run` on a
    # workstation with no CONCIERGE_BASE_URL falls back to http://localhost:8080,
    # and registering that overwrote the deployed agent's pointer. The index log
    # shows the record flip-flopping between the Railway address and localhost
    # across seven registrations. While it pointed at localhost the agent was
    # unresolvable to everyone — including the venue, which refuses a caller no
    # index resolves.
    #
    # Checked before the resolve, not after: an append-only log cannot be edited,
    # so this has to be refused rather than cleaned up afterwards.
    if not is_publicly_resolvable(card_url):
        return {
            "action": "skipped",
            "id": urn,
            "detail": (
                f"{card_url} is not an address another agent could follow, so nothing was "
                "registered. Set CONCIERGE_BASE_URL to this agent's public address."
            ),
        }

    if not host_exists(card_url):
        return {
            "action": "skipped",
            "id": urn,
            "detail": (
                f"{card_url} does not resolve, so nothing was registered. The log is "
                "append-only: a pointer written now to a hostname that does not exist "
                "cannot be withdrawn. Check the DNS record for this domain."
            ),
        }

    try:
        existing = resolve(index_url, urn)
    except Exception as exc:  # noqa: BLE001 - someone else's outage, reported not raised
        return {"action": "unreachable", "id": urn, "detail": str(exc)[:200]}

    if existing is not None:
        raw = existing.get("expires_at", "")
        try:
            expires = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            expires = None
        fresh = expires is not None and (expires - clock()).total_seconds() > renew_within
        if fresh and existing.get("next_hop") == card_url:
            return {"action": "current", "id": urn, "seq": existing.get("seq"), "expires_at": raw}

    try:
        result = register(identity, index_url=index_url, card_url=card_url, media_type=media_type, path=path)
    except RegistrationError as exc:
        return {"action": "failed", "id": urn, "detail": str(exc)[:300]}

    record = result.get("record") or {}
    return {
        "action": "renewed" if existing is not None else "registered",
        "id": urn,
        "seq": record.get("seq"),
        "expires_at": record.get("expires_at"),
    }
