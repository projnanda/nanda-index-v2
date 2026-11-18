import type { TransactionSql } from 'postgres';
import { getSql } from '../client.js';
import { normalizeEmail, type User } from './users.js';

/** Postgres unique_violation: another registration for the email won. */
const UNIQUE_VIOLATION = '23505';

export interface PasswordRegistration {
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string | null;
  /** An unverified password account older than this no longer holds its email. */
  readonly reclaimAfterHours: number;
}

/**
 * Creates an email/password account, or returns null when the email is taken.
 *
 * Registering does not need a verified email, so anyone can register someone
 * else's address. To stop that holding the address forever, an existing
 * account is replaced when it is *stale*: a password account whose email was
 * never verified, created more than `reclaimAfterHours` ago, with no org
 * membership and no org recovery in flight (see isReclaimable). Replacing
 * deletes the row, so every session, reset link, verification link and other
 * proof tied to the old account id goes with it (ON DELETE CASCADE), and the
 * new account gets a fresh id.
 *
 * The check is lazy (at register time), so no timer or cron is needed under
 * multiple PM2 workers. The existing row is locked FOR UPDATE: a concurrent
 * verification or a second reclaim waits for it. When two reclaims race, the
 * loser finds the row gone and its insert hits the unique email index, which
 * is reported as taken (null), the same as two racing first registrations.
 */
export async function registerPasswordAccount(params: PasswordRegistration): Promise<User | null> {
  const email = normalizeEmail(params.email);
  try {
    return await getSql().begin(async (tx) => {
      const holders = await tx<{ id: string }[]>`
        SELECT id FROM users WHERE lower(email) = ${email} FOR UPDATE
      `;
      // Legacy case-only duplicates (migration 015) are left to an operator.
      if (holders.length > 1) return null;
      const holder = holders[0];
      if (holder) {
        if (!(await isReclaimable(tx, holder.id, params.reclaimAfterHours))) return null;
        await tx`DELETE FROM users WHERE id = ${holder.id}`;
      }
      return insertPasswordUser(tx, email, params.passwordHash, params.displayName);
    });
  } catch (err) {
    if ((err as { code?: unknown }).code === UNIQUE_VIOLATION) return null;
    throw err;
  }
}

/**
 * True when the locked account is a stale, unverified password account that
 * owns nothing. Runs as a fresh statement after the row lock, so it sees a
 * verification or membership committed while we waited.
 */
async function isReclaimable(tx: TransactionSql, userId: string, reclaimAfterHours: number): Promise<boolean> {
  const rows = await tx`
    SELECT 1 FROM users u
    WHERE u.id = ${userId}
      AND u.provider = 'email'
      AND u.password_hash IS NOT NULL
      AND NOT u.email_verified
      AND u.created_at <= NOW() - make_interval(hours => ${reclaimAfterHours})
      AND NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id = u.id)
      AND NOT EXISTS (SELECT 1 FROM org_recovery_challenges c WHERE c.user_id = u.id)
  `;
  return rows.length > 0;
}

async function insertPasswordUser(
  tx: TransactionSql,
  email: string,
  passwordHash: string,
  displayName: string | null,
): Promise<User> {
  const [user] = await tx<User[]>`
    INSERT INTO users (email, display_name, provider, provider_id, password_hash)
    VALUES (${email}, ${displayName}, 'email', ${email}, ${passwordHash})
    RETURNING *
  `;
  return user!;
}
