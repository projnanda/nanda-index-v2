-- 018: indexes for the public listing and keyword search.
--
-- At 50,000 entries the public read mix topped out at ~15 req/s with
-- Postgres at 100% CPU (loadtest/README.md): GET /api/v1/index sorted every
-- listed row to return one page, and keyword search pattern-matched four
-- columns of every row, because a LIKE '%q%' with a leading wildcard cannot
-- use a btree index.
--
-- All indexes here are partial on the "listed" predicate that every listing
-- and search applies (status = 'active' AND moderation = 'none', see
-- listListedEntries / searchOrganizations). The planner uses a partial index
-- only when the query repeats that predicate literally, so keep them in step.

-- Index page order: GET /api/v1/index walks this in order and stops after
-- offset + limit, and COUNT(*) of listed entries becomes an index-only scan.
CREATE INDEX IF NOT EXISTS idx_organizations_listed_order
  ON organizations (created_at, org_id)
  WHERE status = 'active' AND moderation = 'none';

-- Keyword search substring matches. pg_trgm's GIN operator class answers
-- LIKE '%q%' from trigrams, so a search that matches nothing reads almost
-- nothing. Each expression must match searchOrganizations() exactly, or the
-- index is ignored. pg_trgm ships with Postgres (contrib) and is a trusted
-- extension, so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_organizations_listed_org_id_trgm
  ON organizations USING GIN (LOWER(org_id) gin_trgm_ops)
  WHERE status = 'active' AND moderation = 'none';

CREATE INDEX IF NOT EXISTS idx_organizations_listed_domain_trgm
  ON organizations USING GIN (LOWER(COALESCE(domain, '')) gin_trgm_ops)
  WHERE status = 'active' AND moderation = 'none';

CREATE INDEX IF NOT EXISTS idx_organizations_listed_display_name_trgm
  ON organizations USING GIN (LOWER(display_name) gin_trgm_ops)
  WHERE status = 'active' AND moderation = 'none';

CREATE INDEX IF NOT EXISTS idx_organizations_listed_identifier_trgm
  ON organizations USING GIN (LOWER(COALESCE(identifier, '')) gin_trgm_ops)
  WHERE status = 'active' AND moderation = 'none';
