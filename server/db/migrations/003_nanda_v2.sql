-- Migration 003: GARR v2 — replace v1 entity_owners schema with users/organizations/org_memberships
-- Drops all v1 tables and creates the v2 schema for the NANDA Index Server.

DROP TABLE IF EXISTS pending_registrations;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS entity_owners;

-- OAuth-authenticated user accounts
CREATE TABLE IF NOT EXISTS users (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  avatar_url   VARCHAR(512),
  provider     VARCHAR(20)  NOT NULL,
  provider_id  VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id),
  CONSTRAINT provider_values CHECK (provider IN ('google', 'github'))
);

-- Index records: one per org, points to their Registry Server
CREATE TABLE IF NOT EXISTS organizations (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         VARCHAR(64)  UNIQUE NOT NULL,
  display_name   VARCHAR(255) NOT NULL,
  domain         VARCHAR(255) UNIQUE NOT NULL,
  contact_email  VARCHAR(255) NOT NULL,
  registry_url   VARCHAR(512) NOT NULL,
  email_verified BOOLEAN      NOT NULL DEFAULT FALSE,
  verify_token   VARCHAR(64),
  ttl_seconds    INTEGER      NOT NULL DEFAULT 86400,
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT org_id_format CHECK (org_id ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'),
  CONSTRAINT status_values CHECK (status IN ('pending', 'active', 'suspended'))
);

-- Which users can manage which orgs
CREATE TABLE IF NOT EXISTS org_memberships (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     VARCHAR(64) NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  role       VARCHAR(20) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, org_id),
  CONSTRAINT role_values CHECK (role IN ('admin', 'member'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_domain   ON organizations(domain);
CREATE INDEX IF NOT EXISTS idx_organizations_status   ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON org_memberships(user_id);
