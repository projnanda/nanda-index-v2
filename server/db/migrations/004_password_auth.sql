-- Add password_hash to users for email/password auth.
-- Nullable: OAuth-only users have no password; password users have no provider_id.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
