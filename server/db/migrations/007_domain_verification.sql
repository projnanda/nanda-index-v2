-- 007_domain_verification: prove domain ownership via a DNS TXT challenge.
--
-- The contact-email step (verify_token) only proves the registrant can read a
-- mailbox; it never proved they control the claimed `domain` — yet `domain` is
-- the locator namespace the whole index is keyed on. Domain ownership is now
-- the activation gate: an org becomes `active` only after a TXT record proving
-- control of the zone is observed. Email verification remains an independent
-- contact-reachability flag and no longer changes status.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS domain_verified             BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS domain_challenge            VARCHAR(64),
  ADD COLUMN IF NOT EXISTS domain_challenge_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS domain_verified_at          TIMESTAMPTZ;

-- Preserve the invariant "active ⇒ domain_verified" for rows that were already
-- activated under the old email-only rule. New orgs must pass the DNS challenge.
-- (A stricter production migration would force re-verification instead.)
UPDATE organizations
  SET domain_verified    = TRUE,
      domain_verified_at = updated_at
  WHERE status = 'active'
    AND domain_verified = FALSE;
