import { randomBytes, createHash } from 'node:crypto';
import { getSql } from '../client.js';
import type { User } from './users.js';

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

/** Consume a reset and invalidate all competing resets in the password transaction. */
export async function completePasswordReset(tokenHash: string, passwordHash: string): Promise<User | null> {
  return getSql().begin(async (tx) => {
    const [candidate] = await tx<PasswordResetToken[]>`SELECT * FROM password_reset_tokens
      WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > clock_timestamp() LIMIT 1`;
    if (!candidate) return null;
    // All password mutations lock the account before its tokens. Recheck the
    // token afterward: another reset or a signed-in change may have consumed it.
    const [account] = await tx`SELECT id FROM users WHERE id = ${candidate.userId} FOR UPDATE`;
    if (!account) return null;
    const [valid] = await tx`SELECT id FROM password_reset_tokens WHERE id = ${candidate.id}
      AND used_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE`;
    if (!valid) return null;
    const [user] = await tx<User[]>`UPDATE users SET password_hash = ${passwordHash},
      token_version = token_version + 1, updated_at = NOW() WHERE id = ${candidate.userId} RETURNING *`;
    await tx`DELETE FROM password_reset_tokens WHERE user_id = ${candidate.userId}`;
    await tx`DELETE FROM account_deletion_tokens WHERE user_id = ${candidate.userId}`;
    return user ?? null;
  });
}
