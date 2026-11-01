import { createHash, randomBytes } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import { getSql } from '../client.js';
import type { User } from './users.js';

export interface DeletionBlocker {
  orgId: string;
  displayName: string;
}
export class AccountSettingsError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public organizations?: DeletionBlocker[],
  ) {
    super(message);
  }
}
const expiredSession = () =>
  new AccountSettingsError(401, 'UNAUTHORIZED', 'session expired; please sign in again');
const codeHash = (code: string) => createHash('sha256').update(code).digest('hex');

async function lockAccount(
  tx: TransactionSql,
  userId: string,
  tokenVersion: number,
): Promise<User> {
  const [user] = await tx<User[]>`SELECT * FROM users WHERE id = ${userId} FOR UPDATE`;
  if (!user || user.tokenVersion !== tokenVersion) throw expiredSession();
  return user;
}

export async function findDeletionBlockers(
  userId: string,
  sql: Sql | TransactionSql = getSql(),
): Promise<DeletionBlocker[]> {
  return sql<DeletionBlocker[]>`
    SELECT o.org_id, o.display_name FROM organizations o
    JOIN org_memberships m ON m.org_id = o.org_id
    WHERE m.user_id = ${userId} AND m.role = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM org_memberships other
        WHERE other.org_id = m.org_id AND other.role = 'admin' AND other.user_id <> ${userId}
      )
    ORDER BY o.org_id
  `;
}

export async function updateAccountProfile(
  userId: string,
  tokenVersion: number,
  displayName: string | null,
): Promise<User> {
  const [user] = await getSql()<User[]>`
    UPDATE users SET display_name = ${displayName?.trim() || null}, display_name_customized = true, updated_at = NOW()
    WHERE id = ${userId} AND token_version = ${tokenVersion} RETURNING *
  `;
  if (!user) throw expiredSession();
  return user;
}

/** Password verification is expensive and happens first; recheck its exact hash under the lock. */
export async function changeAccountPassword(
  userId: string,
  tokenVersion: number,
  verifiedHash: string,
  newHash: string,
): Promise<void> {
  await getSql().begin(async (tx) => {
    const user = await lockAccount(tx, userId, tokenVersion);
    if (user.passwordHash !== verifiedHash) throw expiredSession();
    await tx`UPDATE users SET password_hash = ${newHash}, token_version = token_version + 1, updated_at = NOW() WHERE id = ${userId}`;
    await tx`DELETE FROM password_reset_tokens WHERE user_id = ${userId}`;
    await tx`DELETE FROM account_deletion_tokens WHERE user_id = ${userId}`;
    await tx`DELETE FROM login_failures WHERE email = ${user.email}`;
  });
}

export async function revokeAccountSessions(userId: string, tokenVersion: number): Promise<void> {
  const rows = await getSql()`UPDATE users SET token_version = token_version + 1, updated_at = NOW()
    WHERE id = ${userId} AND token_version = ${tokenVersion} RETURNING id`;
  if (!rows.length) throw expiredSession();
}

export async function issueDeletionCode(
  userId: string,
  tokenVersion: number,
): Promise<{ email: string; code: string }> {
  return getSql().begin(async (tx) => {
    const user = await lockAccount(tx, userId, tokenVersion);
    if (user.passwordHash)
      throw new AccountSettingsError(
        409,
        'PASSWORD_REQUIRED',
        'confirm deletion with your current password',
      );
    if (!user.emailVerified)
      throw new AccountSettingsError(
        403,
        'ACCOUNT_NOT_VERIFIED',
        'verify your account email before requesting a deletion code',
      );
    const [recent] = await tx`SELECT 1 FROM account_deletion_tokens WHERE user_id = ${userId}
      AND sent_at > clock_timestamp() - INTERVAL '1 minute'`;
    if (recent)
      throw new AccountSettingsError(
        429,
        'DELETION_CODE_COOLDOWN',
        'wait one minute before requesting another deletion code',
      );
    const code = randomBytes(32).toString('hex');
    await tx`INSERT INTO account_deletion_tokens (user_id, token_hash, email, token_version, expires_at, sent_at)
      VALUES (${userId}, ${codeHash(code)}, ${user.email}, ${tokenVersion}, clock_timestamp() + INTERVAL '15 minutes', clock_timestamp())
      ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, email = EXCLUDED.email, token_version = EXCLUDED.token_version,
        expires_at = EXCLUDED.expires_at, sent_at = EXCLUDED.sent_at`;
    return { email: user.email, code };
  });
}

export async function discardDeletionCode(userId: string, code: string): Promise<void> {
  await getSql()`DELETE FROM account_deletion_tokens WHERE user_id = ${userId} AND token_hash = ${codeHash(code)}`;
}

export async function deleteAccount(
  userId: string,
  tokenVersion: number,
  proof: { verifiedPasswordHash?: string; deletionCode?: string },
): Promise<void> {
  // SERIALIZABLE detects write skew when two different users are the remaining
  // admins of the same entry. A retry sees the surviving admin as the sole owner.
  // No org row locks are needed, so recovery's org-before-user lock order cannot deadlock us.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await getSql().begin('isolation level serializable', async (tx) => {
        const user = await lockAccount(tx, userId, tokenVersion);
        if (user.passwordHash) {
          if (user.passwordHash !== proof.verifiedPasswordHash) throw expiredSession();
        } else {
          const [valid] = await tx`SELECT 1 FROM account_deletion_tokens
            WHERE user_id = ${userId} AND token_hash = ${codeHash(proof.deletionCode ?? '')}
              AND email = ${user.email} AND token_version = ${tokenVersion} AND expires_at > clock_timestamp() FOR UPDATE`;
          if (!user.emailVerified || !valid)
            throw new AccountSettingsError(
              403,
              'INVALID_DELETION_CODE',
              'request a new deletion code and enter it here',
            );
        }
        const blockers = await findDeletionBlockers(userId, tx);
        if (blockers.length)
          throw new AccountSettingsError(
            409,
            'SOLE_ADMIN',
            'delete these entries or arrange another administrator before deleting your account',
            blockers,
          );
        // Memberships and all account verification/reset/recovery proofs cascade.
        // Shared organizations and their published/contact data are intentionally retained.
        await tx`DELETE FROM login_failures WHERE email = ${user.email}`;
        await tx`DELETE FROM users WHERE id = ${userId}`;
      });
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== '40001') throw error;
      if (attempt === 2)
        throw new AccountSettingsError(
          409,
          'ACCOUNT_CHANGED',
          'account ownership changed; refresh and try again',
        );
    }
  }
}
