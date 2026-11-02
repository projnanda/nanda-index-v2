-- An account-verification link proves the mailbox it was sent to, so record
-- that address with the token. Consuming the token now requires the account's
-- current email to match it: an OAuth sign-in that changes the email can no
-- longer let an old link verify an address it was never sent to.
ALTER TABLE users ADD COLUMN email_verify_token_email VARCHAR(255);

-- Keep outstanding links working when the row has not been written since the
-- link was sent (issuing one sets updated_at and email_verify_sent_at to the
-- same NOW(), and any later write, such as an email change, moves updated_at
-- on). Any other pending link is dropped; the user can resend it.
UPDATE users
SET email_verify_token_email = email
WHERE email_verify_token IS NOT NULL
  AND email_verify_sent_at >= updated_at;

UPDATE users
SET email_verify_token            = NULL,
    email_verify_token_expires_at = NULL,
    email_verify_sent_at          = NULL
WHERE email_verify_token IS NOT NULL
  AND email_verify_token_email IS NULL;
