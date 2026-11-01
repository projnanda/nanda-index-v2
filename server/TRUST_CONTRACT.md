# Ownership and signed resolution contract

**Status: proposed acceptance criteria for [#61](https://github.com/projnanda/nanda-index-v2/issues/61)
and [#92](https://github.com/projnanda/nanda-index-v2/issues/92), both assigned to Skyrider3.**
This document and its fixtures do not introduce response signing, proof expiry,
revocation checking, or a new public API. Field names below are draft names for
review with those implementations; neither issue is completed by these tests.

## Purpose and boundary

NANDA resolves an identifier to a discovery destination. Its assertion should
mean: this index observed ownership proof and issued this particular pointer
within a bounded validity period. It does not certify agent behavior, sign the
remote card's contents, or grant permission to invoke an agent. Clients must
authenticate and authorize runtime actions separately.

The contract prevents three failures: permanent trust after proof becomes stale;
replay or substitution of a formerly valid pointer; and background verification
overwriting a newer ownership change or operator restriction.

```text
ownership proof + current registration state
                  |
          resolution eligibility
                  |
     signed, time-bounded pointer
                  |
 client checks issuer/key, binding, time and required revocation freshness
                  |
       follow discovery destination
```

## Ownership lifecycle — #61

- Store proof method, subject, generation, last successful verification time,
  last check time, and an explicit proof expiry. Domain proof and personal email
  proof are different methods; #61's DNS worker must not reclassify personal
  entries or infer email ownership from a card's availability.
- Decide whether DNS renewal retains a persistent proof record or requires a
  fresh challenge. Current `markDomainVerified` clears the challenge. A worker
  cannot compare a later TXT lookup against a discarded expected value. A
  persistent record demonstrates continuing publication, not a fresh action by
  the current owner; stronger transfer assurance requires fresh challenges.
- Keep ownership validity separate from endpoint health. A card timeout does
  not revoke domain proof. DNS timeout/SERVFAIL is an inconclusive check;
  missing or mismatched proof is a negative observation. Neither extends expiry.
- Configure check interval, retry/backoff, failure threshold, and maximum proof
  lifetime. Grace must fit inside that lifetime. Reads enforce expiry even if
  the worker stops; expired proof cannot produce a new verified resolution.
- Bind a check to the registration generation, subject and proof revision it
  read. Commit its result only if those values still match. Concurrent renewal
  and domain change must not apply results from the previous subject/revision.
- Reproof preserves suspension and takedown. `hidden` continues to mean omitted
  from listings, not forbidden to resolve. Apply eligibility consistently to
  direct index reads, exact resolution and publisher-catalog fallback.
- Proof loss must not silently delete an established registration. Review claim
  cleanup/recovery: `markDomainVerified` currently deletes other unverified
  claims on the same domain. A formerly proven, now expired claim requires an
  explicit ownership-transfer policy, not treatment as an abandoned signup.

## Signed assertion — #92

Use an index-issued assertion distinct from publisher-signed card metadata.
Sign the complete payload, including the following meanings:

| Draft field | Required meaning |
| --- | --- |
| `schemaVersion`, `issuer`, `keyId`, `algorithm` | Versioned assertion purpose and signing identity |
| `locator`, `entryIdentifier`, `match` | Canonical requested identifier, returned entry, and exact/publisher match |
| `url`, `mediaType` | Destination and interpretation of the pointer |
| `generation`, `revision` | Opaque registration generation and increasing trust-relevant record revision |
| `ownershipVerifiedAt`, `ownershipExpiresAt` | Last successful ownership check and its validity limit |
| `issuedAt`, `expiresAt` | Assertion validity, independent of signature validity |

Bind the proof method/subject as well when the final schema supports multiple
proof methods. The fixture is the domain-proof case, not a personal-entry schema.
An index-entry assertion without a requested locator needs a separate explicit
schema/purpose; do not synthesize an exact resolution for listing entries.
Federated results must retain their issuer/provenance, not acquire local proof
claims simply because they appear in an index response.

Clients select keys from a trusted issuer's authenticated key set, constrain
the algorithm, and check the requested locator and every pointer field against
the signed payload. A response-provided key or issuer is not itself trusted.
Version the canonical byte encoding; reject malformed/duplicate-key payloads
before verification. Specify timestamp format, allowed clock skew, unknown-key
handling, key-set cache bounds, planned rotation and emergency revocation.

```text
ownershipVerifiedAt <= issuedAt < expiresAt <= ownershipExpiresAt
expiresAt - issuedAt <= configured maximum assertion lifetime
cache lifetime <= expiresAt - current time
```

For the proposed client policy, clock tolerance may accommodate a slightly
future `issuedAt` but must not extend expiry. Reject at `now >= expiresAt`.
Offline consumers require a sufficiently accurate clock. Fresh assertions must
use one coherent registration/proof revision; a revoke/update racing issuance
must not produce a mixture of old eligibility and new pointer fields.

## Revocation, reuse and rollout — shared acceptance criteria

- Takedown, expiry or deletion stops new valid resolutions after the change
  commits. Endpoint/identity/proof changes advance the trust revision. A new
  registration or ownership transfer receives a new generation; it cannot
  inherit the previous owner's proof or assertion authority.
- Revision/generation fields prevent silent conflation only when consumers
  compare them with trusted current or previously observed state. They do not
  let a first-time offline consumer detect an unseen revocation.
- Document the maximum stale-trust window. Offline clients can accept a prior
  assertion until expiry. Earlier rejection requires a bounded-freshness online
  status/revocation check; a client requiring that check must reject when it is
  unavailable. Key compromise requires the same explicit freshness policy.
- Existing verified rows need a defined migration/renewal deadline; do not
  invent a recent verification timestamp. Define compatibility for unsigned
  clients and prevent silent unsigned fallback for clients requiring signatures.
- Owners must choose the concrete renewal, grace, assertion lifetime, clock and
  revocation-cache values before release. Test their boundaries with a fake clock;
  the fixture's five-minute validity is illustrative, not a production default.

## Evidence and remaining integration work

| Coverage | Evidence / implementation dependency |
| --- | --- |
| Proof loss/reproof across direct, exact and publisher reads | `tests/integration/ownership-resolution-contract.test.ts` |
| Suspension/takedown survives reproof; hidden remains resolvable | Same integration suite, actual DB mutation helpers and HTTP injection |
| Domain replacement invalidates proof; deletion removes live resolution | Same integration suite; no assertion about cached responses |
| Fixed canonical bytes, independent Ed25519 verification, every draft field altered/deleted, wrong key, corrupt signature, appended claims | `tests/unit/index-attestation-contract.test.ts` |
| Timeout vs negative proof, renewal/grace/expiry, stopped worker, stale check race, formerly proven claim transfer | Pending #61 implementation; use fake DNS/clock and controlled transaction barriers |
| Route-issued assertions, expiry/skew rejection, key rotation/revocation, concurrent issuance, cache limits and unsigned downgrade | Pending #92 implementation; test the real issuer and consumer verifier |
| Delete/re-register then replay; endpoint revision replay; direct/fallback parity | Pending both; test online rejection and the documented offline acceptance window |

The cryptographic suite verifies byte integrity only. A green result does not
establish semantic validity, a trusted issuer, freshness or revocation handling.
The JSON fixture contains public key, payload, canonical bytes and signature;
it was generated with Node's crypto API independently of repository signing
helpers. No private key is retained. Consumers can reuse it for compatibility.

Run with Node 20 and a disposable migrated PostgreSQL database:

```sh
# Set DATABASE_URL for the disposable database; from server/:
npx tsx src/db/migrate.ts
npm test -- tests/unit/index-attestation-contract.test.ts tests/integration/ownership-resolution-contract.test.ts --maxWorkers=1 --minWorkers=1
npm run typecheck
```

Keep implementation in #61/#92 and add the pending integration cases as those
interfaces land. This contribution changes no production behavior or migrations.
Audit history is a separate follow-up, not a prerequisite silently added here.
