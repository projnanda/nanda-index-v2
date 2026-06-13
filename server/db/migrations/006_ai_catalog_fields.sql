-- 006: Add AI Catalog schema fields to the organizations table.
-- All new columns are nullable (or have defaults) so existing rows are unaffected.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS identifier       VARCHAR(512),
  ADD COLUMN IF NOT EXISTS media_type       VARCHAR(128) NOT NULL DEFAULT 'application/ai-catalog+json',
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS tags             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS publisher        JSONB,
  ADD COLUMN IF NOT EXISTS catalog_metadata JSONB;

ALTER TABLE organizations
  ALTER COLUMN registry_url DROP NOT NULL;

-- Back-fill identifier for existing rows
UPDATE organizations
   SET identifier = 'urn:ai:domain:' || domain
 WHERE identifier IS NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_media_type ON organizations(media_type);
