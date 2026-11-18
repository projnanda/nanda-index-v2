"""Mint the host's delegated authority grant. Run by an operator, never by the agent.

Why this is a separate tool and not something the service does at boot
----------------------------------------------------------------------
The DAT spec says it plainly (§8): *"A valid signature proves only that whoever
holds grantor_did's key signed the grant — not that grantor_did is the human
principal rather than the agent."*

So an agent that can mint its own authority has demonstrated nothing. The host's
key is used here, once, and never reaches the running service: the deployment
carries only the two signed artifacts, which it cannot forge and cannot widen.

Run it as::

    python3 tools/mint_grant.py --generate-seed > host.seed   # once, kept offline
    AGENT_DID='did:key:z6Mk...' python3 tools/mint_grant.py --seed-file host.seed

or, inside the container, with the material on stdin rather than in a command::

    docker compose exec -T -e AGENT_DID='did:key:z6Mk...' demo \
        python tools/mint_grant.py --seed-file - < host.seed

The host's key material belongs to the operator. It is read from a file
(``--seed-file``, ``-`` for stdin, or ``HOST_SEED_FILE``) or typed at a prompt
(``--prompt``), and never taken as an argument: a command line lands in shell
history and the process list. ``HOST_SEED`` in the environment still works, for
the deployments that already use it, and warns.

Why the material must be strong
-------------------------------
The host key is one SHA-256 of the material, and its public half is published as
the grant's ``grantor_did``. Anyone can therefore test guesses offline, at GPU
speed. So the material must be at least 32 random bytes, written as hex; anything
else is refused unless ``--allow-weak`` is given. That escape exists only so a
host key minted before this check can still renew its grant until it is rotated.
The derivation itself is unchanged, so an existing host key stays derivable.

With no material at all a fresh key is generated and **discarded** — the grant is
still valid and unforgeable, but nobody can ever mint a replacement or a
revocation for that host identity, which the output says out loud.

Why no revocation source
------------------------
A DAT may declare where its revocation list lives, and sm-dat then refuses to
guess: without a checker the verdict is INDETERMINATE rather than a silent pass.
That is the right design, and it is why this grant declares none. The only place
this demo could serve such a list from is the agent itself — and an agent that
publishes its own revocation list can simply decline to revoke itself. A control
that cannot work is worse than an absent one, because it reads as a control.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import secrets
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sm_arp import Identity, build_action, dat_grant_payload, issue_receipt
from sm_dat import build_grant, sign_grant

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from concierge.authority import CATEGORIES, COUNTERPARTIES, authority_dir  # noqa: E402

DEFAULT_DAYS = 90

#: 32 random bytes, as hex: the least material that cannot be guessed against the
#: published host key.
SEED_BYTES = 32
_STRONG = re.compile(rf"[0-9a-fA-F]{{{SEED_BYTES * 2},}}")


class SeedError(Exception):
    """The host's key material could not be read, or is not fit to use."""


def is_strong(material: str) -> bool:
    """Whether ``material`` is at least 32 bytes of hex."""
    return _STRONG.fullmatch(material) is not None


def _parser() -> argparse.ArgumentParser:
    # No abbreviations: ``--seed <material>`` must be an error, not a prefix of
    # --seed-file that quietly reads a file named after the secret.
    parser = argparse.ArgumentParser(
        description="Mint the host's delegated authority grant.", allow_abbrev=False
    )
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--seed-file", help="read the host's key material from this file; '-' for stdin")
    source.add_argument("--prompt", action="store_true", help="type the host's key material at a prompt")
    source.add_argument("--generate-seed", action="store_true", help="print fresh strong key material and exit")
    parser.add_argument(
        "--allow-weak",
        action="store_true",
        help="accept material shorter than 32 hex bytes (only to renew a host key minted before this check)",
    )
    return parser


def _read_material(args: argparse.Namespace) -> str | None:
    """The host's key material, or None when there is none to read."""
    path = args.seed_file or os.environ.get("HOST_SEED_FILE", "").strip()
    if path == "-":
        material = sys.stdin.readline().strip()
    elif path:
        try:
            material = Path(path).read_text(encoding="utf-8").strip()
        except OSError as exc:
            raise SeedError(f"could not read the seed file: {exc.strerror or exc}") from exc
    elif args.prompt:
        material = getpass.getpass("Host key material: ").strip()
    else:
        material = os.environ.get("HOST_SEED", "").strip()
        if material:
            print(
                "warning: HOST_SEED in the environment is visible to the process list and shell "
                "history; prefer --seed-file or --prompt.",
                file=sys.stderr,
            )
        return material or None
    if not material:
        raise SeedError("the host's key material is empty")
    return material


def _host_seed(args: argparse.Namespace) -> bytes | None:
    """The host's Ed25519 seed, or None for a disposable host."""
    material = _read_material(args)
    if material is None:
        return None
    if not is_strong(material):
        if not args.allow_weak:
            raise SeedError(
                "the host's key material is weak: its public key is published, so it can be guessed "
                f"offline. Use at least {SEED_BYTES} random bytes as hex (--generate-seed), or pass "
                "--allow-weak to renew under a host key that predates this check, then rotate it."
            )
        print("warning: minting under weak host key material (--allow-weak); rotate it.", file=sys.stderr)
    # Unchanged since the first grant, so an existing host key stays derivable.
    return hashlib.sha256(material.encode("utf-8")).digest()


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.generate_seed:
        print(secrets.token_hex(SEED_BYTES))
        return 0

    agent_did = os.environ.get("AGENT_DID", "").strip()
    if not agent_did.startswith("did:key:z"):
        print("AGENT_DID must be the running agent's did:key. Read it from /healthz.", file=sys.stderr)
        return 2

    try:
        seed = _host_seed(args)
    except SeedError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    disposable = seed is None
    if seed is None:
        seed = os.urandom(32)

    host = Identity.from_seed(seed)
    now = datetime.now(UTC)
    not_after = (now + timedelta(days=DEFAULT_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")

    dat = sign_grant(
        host,
        build_grant(
            grantee_did=agent_did,
            action_categories=CATEGORIES,
            stateless={"counterparty_allowlist": COUNTERPARTIES},
            not_before=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            not_after=not_after,
            human_summary=(
                "Arrange one lunch: find the guests, ask them, and book a table at the "
                "named restaurant. No payments. Expires in 90 days."
            ),
        ),
    )

    # The cheap on-network half: an ARP receipt the host signs, committing to the
    # DAT's digest. A verifier holding only this can still check scope and expiry;
    # one holding the DAT too can check the rest.
    grant_receipt = issue_receipt(
        host,
        principal_did=host.did,
        action=build_action(
            category="authority_granted",
            human_summary=dat["human_summary"],
            outcome="completed",
            counterparty_label="agent:concierge",
            machine_payload=dat_grant_payload(dat),
        ),
    )

    # The SAME directory the running agent reads, so minting and loading cannot
    # disagree: ``CONCIERGE_AUTHORITY`` moves both or neither. A second
    # deployment sets it and writes its own grant there, instead of overwriting
    # the artifacts committed for the reference deployment.
    out = authority_dir()
    out.mkdir(parents=True, exist_ok=True)
    (out / "grant.json").write_text(json.dumps(dat, indent=2) + "\n")
    (out / "grant-receipt.json").write_text(json.dumps(grant_receipt, indent=2) + "\n")

    print(f"host        {host.did}")
    print(f"grantee     {agent_did}")
    print(f"grant_id    {dat['grant_id']}")
    print(f"receipt_id  {grant_receipt['receipt_id']}")
    print(f"expires     {not_after}")
    print(f"written     {out}")
    if disposable:
        print(
            "\nNo host key material was given, so a host key was generated and discarded. "
            "The grant is valid and unforgeable; nobody can mint a replacement or a "
            "revocation for this host identity. Pass --seed-file to keep that option."
        )
    if out == Path(__file__).resolve().parent.parent / "src" / "concierge" / "authority":
        print(
            "\nThis wrote into the tracked directory, which is where the reference "
            "deployment's own grant lives. If this is a second deployment, set "
            "CONCIERGE_AUTHORITY to a path of its own (a persistent volume, beside "
            "CONCIERGE_HOME) and mint again — then `git checkout` the tracked files."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
