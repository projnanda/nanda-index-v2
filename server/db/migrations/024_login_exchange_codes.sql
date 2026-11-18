-- OAuth sign-in used to redirect to the web app with the session JWT in the
-- URL (/auth/callback?token=…), where it reached browser history and access
-- logs, and where any JWT an attacker put in a link was accepted (login CSRF).
-- The callback now sends a short-lived, single-use code instead, and the web
-- app swaps it for the JWT with a POST. The code only works together with the
-- login nonce cookie set on the browser that finished the OAuth flow.
-- Only hashes are stored.
CREATE TABLE login_exchange_codes (
  code_hash     CHAR(64)    PRIMARY KEY,
  nonce_hash    CHAR(64)    NOT NULL,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_version INT         NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_login_exchange_codes_expires_at ON login_exchange_codes(expires_at);
