-- 007: Add entry_data JSONB column for DNS-AID and other method-specific discovery data.
-- Separate from catalog_metadata (which holds NANDA role flags).

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS entry_data JSONB;
