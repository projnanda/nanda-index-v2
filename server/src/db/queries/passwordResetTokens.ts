import { randomBytes, createHash } from 'node:crypto';
import { getSql } from '../client.js';

/** Domain type — camelCase (postgres.camel maps snake_case columns). */
export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/**
 * SHA-256 of a raw reset token. We store only this hash, so a database leak
 * does not expose usable reset tokens. The raw token lives only in the email.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mints a new single-use reset token for a user. Returns the RAW token (to be
 * emailed) alongside the stored row. Only the hash is persisted.
 */
export async function createResetToken(
  userId: string,
  ttlMinutes: number,
): Promise<{ token: string; row: PasswordResetToken }> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashResetToken(token);

  const sql = getSql();
  const rows = await sql<PasswordResetToken[]>`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (${userId}, ${tokenHash}, NOW() + make_interval(mins => ${ttlMinutes}))
    RETURNING *
  `;
  return { token, row: rows[0]! };
}

/**
 * Looks up an unused, unexpired token by its hash. Returns null if no such
 * token exists, it has already been used, or it has expired.
 */
export async function findValidResetToken(
  tokenHash: string,
): Promise<PasswordResetToken | null> {
  const sql = getSql();
  const rows = await sql<PasswordResetToken[]>`
    SELECT * FROM password_reset_tokens
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Marks a reset token as consumed so it cannot be reused. */
export async function markResetTokenUsed(id: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ${id}
  `;
}
