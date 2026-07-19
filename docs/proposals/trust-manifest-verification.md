# Proposal: honest verification status for `trust_manifest.signature`

No code changes in this PR — this is a design proposal, opened for feedback before
implementation.

## Problem

`IndexRecord.trust_manifest` (added in #10, migration `010_catalog_entry_fields.sql`)
accepts an optional `signature: string` field. Today it is accepted verbatim on
`POST`/`PUT /api/v1/orgs`, stored in the `trust_manifest` JSONB column, and echoed back
unchanged on read (`toIndexRecord()`, `organizations.ts:78-101`). Nothing in the server
ever checks that signature against anything. A caller who submits a `trust_manifest`
with a `signature` field currently gets it stored and returned exactly as if it had been
verified — there is no signal in the response distinguishing "we checked this" from
"we didn't."

`server/src/services/signing.ts` already implements the relevant primitives
(`canonicalize`, `signCanonical`, `verifyCanonical`, `verifyAgentCardSignature`,
`derivePublicKey`) and is unit-tested (`tests/unit/signing.test.ts`). It is not, however,
called from any live route or service:

```
$ grep -rn "verifyCanonical\|verifyAgentCardSignature\|verifySignature(" server/src/ \
    --include="*.ts" | grep -v "signing.ts:" | grep -v "\.test\."
# (no output)
```

`verifyAgentCardSignature`'s own docstring says it verifies against "the EntityOwner
public key (PEM) from the GARR registry." That table, `entity_owners`, was dropped in
migration `003_nanda_v2.sql` when the project moved to the current OAuth-users +
domain-verification model. So `signing.ts` isn't merely unwired from `trust_manifest`
specifically — the key-registry concept it was built against no longer exists anywhere
in the v2 schema. It's correct, tested code left over from a superseded identity model.

This also means "just call the existing verify function on `trust_manifest.signature`"
isn't actually a small task: it requires deciding **whose key verifies a
`TrustManifest.signature`**, which the codebase has no current answer for. The one real
example in the test suite (`orgs.test.ts:210`) has `identity: 'urn:ai:domain:trusted.example.com'`
— a domain URN, not a `did:key` with a self-contained public key, so there's no
zero-lookup answer either.

## Options considered

1. **DNS-anchored key** — reuse the domain-verification trust anchor the Index already
   has (`domainVerification.ts`, the DNS TXT challenge flow behind `domain_verified`):
   publish a key at a well-known DNS location for the org's domain, fetch and check it
   against `signature`. Real verification, no new tables — but it's a new convention,
   and a design decision for whoever owns that trust model, not something to land as a
   surprise in a PR.
2. **Format-only check** — confirm `signature` is a structurally valid detached
   signature over `canonicalize(manifest minus signature)`, without claiming to verify
   *authenticity* against any identity. Cheap, but weak: it doesn't actually answer "is
   this real."
3. **Honest gap, not a guessed answer** — surface the current state explicitly instead
   of silently echoing an unchecked field. No new tables, no new external calls, no
   invented trust-anchor convention.

## Proposed (option 3)

Add a computed, read-time-only field. No migration.

**`server/src/types/api/index-record.ts`**
```typescript
export interface TrustManifestVerification {
  verified: false; // literal, not boolean — no code path to true exists yet
  reason: string;
}
```
`trust_manifest_verification?: TrustManifestVerification` added to `IndexRecord`, with
a matching addition to `INDEX_RECORD_SCHEMA`.

**`server/src/db/queries/organizations.ts`** — one pure helper, one line in the existing
`toIndexRecord()`:
```typescript
function verifyTrustManifest(manifest: TrustManifest | null | undefined): TrustManifestVerification | undefined {
  if (!manifest?.signature) return undefined; // nothing claimed → nothing to say
  return {
    verified: false,
    reason: "trust_manifest carries a signature, but no verification key source is defined for its identity type yet",
  };
}
```
```typescript
trust_manifest_verification: verifyTrustManifest(org.trustManifest),
```

**`server/tests/integration/orgs.test.ts`** — extends the existing `trust_manifest`
block (`orgs.test.ts:207-294`): a manifest with `signature` gets the field; a manifest
without one, or no manifest at all, gets nothing; `PUT` with `trust_manifest: null`
clears it along with the manifest.

Both `POST` and `PUT /api/v1/orgs/:org_id` pick this up automatically — they already
return `toIndexRecord()` through the shared schema.

## Not in scope here

Option 1 (real DNS-anchored verification) is a reasonable follow-up once this lands and
the maintainers have weighed in on the key-sourcing question — opening as a separate
proposal rather than bundling a new trust-anchor convention into this PR.

`signing.ts` being unused outside its own tests is worth its own issue, independent of
this — reintroducing a key registry is a materially bigger decision than anything
proposed here.

## Ask

Feedback on the option 3 shape above (field name, `reason` wording, whether this
belongs on `IndexRecord` at all vs. somewhere else) before a follow-up PR implements it.
