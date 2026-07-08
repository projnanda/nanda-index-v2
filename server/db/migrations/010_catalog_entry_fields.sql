-- 010_catalog_entry_fields: bring the index record to parity with the AI Catalog
-- CatalogEntry schema (agent-card.github.io/ai-catalog; dir catalog/v1/models.proto).
--
-- Two fields were missing from our record vs a CatalogEntry:
--   version        — SemVer of the artifact (e.g. "v1.0.0").
--   trust_manifest — structured, signable trust metadata: identity, attestations,
--                    provenance, and a detached signature. This is the portable
--                    trust representation; the existing email_verified/domain_verified
--                    booleans remain as NANDA-internal operational flags.
--
-- Both nullable so existing rows are unaffected.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS version        VARCHAR(64),
  ADD COLUMN IF NOT EXISTS trust_manifest JSONB;
