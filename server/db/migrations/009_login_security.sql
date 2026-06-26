-- Migration 009: login security hardening
--   1. Soft account lockout — track consecutive failed logins and a temporary
--      lock window. The lock auto-expires (no permanent lockout), so a failed
--      attempt by an attacker cannot deny service to the real account owner.
--   2. Password reset tokens — single-use, expiring. Only a SHA-256 *hash* of
--      the token is stored; the raw token lives only in the email link.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until          TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64)  NOT NULL,
  expires_at TIMESTAMPTZ  NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_user_id    ON password_reset_tokens(user_id);
