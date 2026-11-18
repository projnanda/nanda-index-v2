-- Single-session sign-out. Session JWTs now carry a random id (jti); signing
-- out records it here and authenticate refuses it. A row is kept until every
-- token that can carry its jti has expired (a profile update re-issues the
-- session under the same jti), then swept. Bumping users.token_version still
-- revokes every session at once (/auth/logout-all, password changes).
CREATE TABLE revoked_sessions (
  jti        UUID        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_revoked_sessions_expires_at ON revoked_sessions(expires_at);
