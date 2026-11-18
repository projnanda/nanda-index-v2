import { getSql } from '../client.js';

/**
 * Records a signed-out session id until `expiresAt`, after which no token
 * carrying it is valid anyway. Expired rows are swept on the way.
 */
export async function revokeSession(jti: string, userId: string, expiresAt: Date): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM revoked_sessions WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO revoked_sessions (jti, user_id, expires_at)
    VALUES (${jti}, ${userId}, ${expiresAt})
    ON CONFLICT (jti) DO UPDATE SET expires_at = GREATEST(revoked_sessions.expires_at, EXCLUDED.expires_at)
  `;
}

/** True when the session with this id was signed out. */
export async function isSessionRevoked(jti: string): Promise<boolean> {
  const rows = await getSql()`SELECT 1 FROM revoked_sessions WHERE jti = ${jti}`;
  return rows.length > 0;
}
