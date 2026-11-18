UPDATE organizations
SET verify_token = NULL, verify_token_expires_at = NULL
WHERE verify_token IS NOT NULL OR verify_token_expires_at IS NOT NULL;

COMMENT ON COLUMN organizations.verify_token IS 'SHA-256 hex digest of the organization contact-email verification token; never the raw token';
