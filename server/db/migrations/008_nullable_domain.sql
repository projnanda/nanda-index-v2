-- 008: Make domain nullable to support personal (email-identity) users who have no domain.
-- UNIQUE constraint stays — Postgres allows multiple NULLs in a UNIQUE column.

ALTER TABLE organizations
  ALTER COLUMN domain DROP NOT NULL;
