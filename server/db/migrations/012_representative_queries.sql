-- 012: representative_queries — LLM-generated natural-language task phrasings
-- for an org (e.g. "help me send a transactional email" for an email API),
-- generated once at registration/update time and folded into search_vector.
-- This closes a real gap found in agentic search: keyword/stemmed full-text
-- search can't bridge a phrasing gap ("bake" vs "bakery" don't share a stem),
-- only a spelling one. Nullable-safe default '{}' — orgs without an LLM key
-- configured, or predating this migration, just don't get the extra signal.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS representative_queries TEXT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION organizations_search_vector(
  tags TEXT[], display_name TEXT, description TEXT, representative_queries TEXT[]
) RETURNS tsvector AS $$
  SELECT
    setweight(to_tsvector('pg_catalog.english', array_to_string(coalesce(tags, '{}'), ' ')), 'A') ||
    setweight(to_tsvector('pg_catalog.english', coalesce(display_name, '')), 'B') ||
    setweight(to_tsvector('pg_catalog.english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('pg_catalog.english', array_to_string(coalesce(representative_queries, '{}'), ' ')), 'B')
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Generated columns can't have their expression altered in place — drop and
-- re-add against the new 4-arg function. Existing rows recompute automatically.
ALTER TABLE organizations DROP COLUMN IF EXISTS search_vector;

ALTER TABLE organizations
  ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (organizations_search_vector(tags, display_name, description, representative_queries)) STORED;

CREATE INDEX IF NOT EXISTS idx_organizations_search_vector
  ON organizations USING GIN (search_vector);
