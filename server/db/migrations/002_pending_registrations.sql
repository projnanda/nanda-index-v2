-- 002_pending_registrations: in-flight registration challenges (Stream A, §5.1).
-- One row per owner_id in flight. UNIQUE on owner_id so re-registering an
-- owner_id replaces the stale challenge rather than accumulating rows.

CREATE TABLE pending_registrations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              VARCHAR(64)  UNIQUE NOT NULL,
  display_name          VARCHAR(255) NOT NULL,
  domain                VARCHAR(255) NOT NULL,
  contact_email         VARCHAR(255) NOT NULL,
  rap_url               VARCHAR(512) NOT NULL,
  rap_fallback          VARCHAR(512),
  algorithm             VARCHAR(20)  NOT NULL,
  public_key            TEXT         NOT NULL,
  key_id                VARCHAR(128) NOT NULL,
  ttl_seconds           INTEGER      NOT NULL DEFAULT 86400,
  dmarc_policy          TEXT         NOT NULL,
  challenge_nonce       VARCHAR(64)  NOT NULL,
  challenge_expires_at  TIMESTAMPTZ  NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_registrations_owner_id ON pending_registrations(owner_id);
CREATE INDEX idx_pending_registrations_expires_at ON pending_registrations(challenge_expires_at);
