-- 011: Generated tsvector for agentic org-level pre-filtering (full-text ranking
-- over tags/display_name/description). Additive, no new extensions, existing
-- rows are unaffected — the column is computed from data already present.
-- Weighted: tags (A) > display_name (B) > description (C).
--
-- to_tsvector(regconfig, text) is STABLE, not IMMUTABLE (the config name is
-- resolved via catalog lookup), so Postgres rejects it directly inside a
-- GENERATED ALWAYS AS expression. Wrapping it in a SQL function explicitly
-- marked IMMUTABLE is the standard workaround — safe here since 'english' is
-- a built-in text search config that is never redefined.

CREATE OR REPLACE FUNCTION organizations_search_vector(
  tags TEXT[], display_name TEXT, description TEXT
) RETURNS tsvector AS $$
  SELECT
    setweight(to_tsvector('pg_catalog.english', array_to_string(coalesce(tags, '{}'), ' ')), 'A') ||
    setweight(to_tsvector('pg_catalog.english', coalesce(display_name, '')), 'B') ||
    setweight(to_tsvector('pg_catalog.english', coalesce(description, '')), 'C')
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (organizations_search_vector(tags, display_name, description)) STORED;

CREATE INDEX IF NOT EXISTS idx_organizations_search_vector
  ON organizations USING GIN (search_vector);
