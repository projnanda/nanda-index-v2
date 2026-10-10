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

    HOST_SEED='...' AGENT_DID='did:key:z6Mk...' python3 tools/mint_grant.py

``HOST_SEED`` is the host's key material and belongs to the operator. With none
supplied a fresh one is generated and **discarded** — the grant is still valid
and unforgeable, but nobody can ever mint a replacement or a revocation for that
host identity, which the output says out loud.

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

import hashlib
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sm_arp import Identity, build_action, dat_grant_payload, issue_receipt
from sm_dat import build_grant, sign_grant

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from concierge.authority import CATEGORIES, COUNTERPARTIES  # noqa: E402

HERE = Path(__file__).resolve().parent.parent / "src" / "concierge" / "authority"

DEFAULT_DAYS = 90


def main() -> int:
    agent_did = os.environ.get("AGENT_DID", "").strip()
    if not agent_did.startswith("did:key:z"):
        print("AGENT_DID must be the running agent's did:key. Read it from /healthz.", file=sys.stderr)
        return 2

    raw = os.environ.get("HOST_SEED", "").strip()
    if raw:
        seed = hashlib.sha256(raw.encode("utf-8")).digest()
        disposable = False
    else:
        seed = os.urandom(32)
        disposable = True

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

    HERE.mkdir(parents=True, exist_ok=True)
    (HERE / "grant.json").write_text(json.dumps(dat, indent=2) + "\n")
    (HERE / "grant-receipt.json").write_text(json.dumps(grant_receipt, indent=2) + "\n")

    print(f"host        {host.did}")
    print(f"grantee     {agent_did}")
    print(f"grant_id    {dat['grant_id']}")
    print(f"receipt_id  {grant_receipt['receipt_id']}")
    print(f"expires     {not_after}")
    print(f"written     {HERE}")
    if disposable:
        print(
            "\nNo HOST_SEED was given, so a host key was generated and discarded. "
            "The grant is valid and unforgeable; nobody can mint a replacement or a "
            "revocation for this host identity. Set HOST_SEED to keep that option."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
