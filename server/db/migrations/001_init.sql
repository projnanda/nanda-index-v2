-- 001_init: entity_owners + audit_log tables per GARR spec §6.1.
-- audit_log is append-only by convention; no UPDATE or DELETE permitted.

CREATE TABLE entity_owners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        VARCHAR(64)  UNIQUE NOT NULL,
  display_name    VARCHAR(255) NOT NULL,
  domain          VARCHAR(255) UNIQUE NOT NULL,
  contact_email   VARCHAR(255) NOT NULL,
  rap_url         VARCHAR(512) NOT NULL,
  rap_fallback    VARCHAR(512),
  algorithm       VARCHAR(20)  NOT NULL,
  public_key      TEXT         NOT NULL,
  key_id          VARCHAR(128) NOT NULL,
  dmarc_policy    TEXT         NOT NULL,
  ttl_seconds     INTEGER      NOT NULL DEFAULT 86400,
  serial          VARCHAR(12)  NOT NULL,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active',
  issued_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ  NOT NULL,
  signature_value TEXT         NOT NULL,
  signed_by       VARCHAR(128) NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_entity_owners_owner_id ON entity_owners(owner_id);
CREATE INDEX idx_entity_owners_domain   ON entity_owners(domain);
CREATE INDEX idx_entity_owners_status   ON entity_owners(status);

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    VARCHAR(64)  NOT NULL,
  action      VARCHAR(32)  NOT NULL,
  actor       VARCHAR(255) NOT NULL,
  serial_old  VARCHAR(12),
  serial_new  VARCHAR(12),
  diff        JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
