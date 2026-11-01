-- Preserve names edited in Account settings when an OAuth provider signs in again.
ALTER TABLE users ADD COLUMN display_name_customized BOOLEAN NOT NULL DEFAULT FALSE;

-- Purpose-specific, single-use deletion proofs for accounts without a password.
-- Only a hash is stored. Revoking sessions also invalidates outstanding proofs.
CREATE TABLE account_deletion_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  token_version INT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
