-- Historical proof times and card checks are unknown; never backfill invented evidence.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS card_validation JSONB;
