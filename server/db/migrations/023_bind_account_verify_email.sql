-- An account-verification link proves the mailbox it was sent to, so record
-- that address with the token. Consuming the token now requires the account's
-- current email to match it: an OAuth sign-in that changes the email can no
-- longer let an old link verify an address it was never sent to.
ALTER TABLE users ADD COLUMN email_verify_token_email VARCHAR(255);

-- Links issued before this column existed are not bound to any address, and
-- which address each was mailed to cannot be reconstructed safely. Drop them
-- all (they live 24 hours at most) and clear the resend cooldown, so users
-- can request a new link straight away.
UPDATE users
SET email_verify_token            = NULL,
    email_verify_token_expires_at = NULL,
    email_verify_sent_at          = NULL
WHERE email_verify_token IS NOT NULL;
