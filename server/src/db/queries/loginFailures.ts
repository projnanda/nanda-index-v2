import { getSql } from '../client.js';
import { normalizeEmail } from './users.js';
import type { Config } from '../../config/index.js';

/**
 * Failed-login tracking keyed by (email, client network).
 *
 * The network is `clientNetworkKey(request.ip)`: an IPv4 address, or an IPv6
 * client's /64, so one host cannot dodge the limit by rotating addresses.
 *
 * Why not only per account: a per-account counter lets anyone lock any user
 * out just by sending bad passwords for their email. Keying by network as
 * well means an attacker only ever locks themselves. Keying by the *submitted
 * email* (rather than user_id) means unknown emails lock exactly like real
 * ones, so a 429 never confirms that an account exists.
 *
 * A second, account-wide row (network ACCOUNT_WIDE) counts failures from
 * every network together. Once it is locked, it refuses only networks that
 * have themselves failed for the email in the current streak: each attacker
 * network gets at most one more guess per lock period, while a clean network
 * (the owner's) can still sign in, so the lock cannot shut the owner out.
 * It never grows past lockoutMinutes, and a password reset clears it. The
 * signed-in password re-check in account settings ignores it entirely.
 */

/** login_failures.ip_address of the row counting every network together. */
const ACCOUNT_WIDE = '*';
/** Longest a single lock may last, however long the failure streak gets. */
const MAX_LOCKOUT_MINUTES = 24 * 60;
/** A streak with no new failure for this long starts over from zero. */
const STREAK_RESET_HOURS = 24;

export interface LockoutPolicy {
  /** Failures (per email+network) before the first lock. */
  readonly maxAttempts: number;
  /** Length of the first lock; each further failure doubles it. */
  readonly lockoutMinutes: number;
  /** Failures (per email, all networks) before each attempt waits out a
   *  lock of lockoutMinutes. */
  readonly maxAccountAttempts: number;
}

/**
 * Lock length after `failedCount` failures: none below the threshold, then
 * lockoutMinutes doubling with every failure past it, capped at a day.
 */
export function lockoutMinutesFor(
  failedCount: number,
  policy: Pick<LockoutPolicy, 'maxAttempts' | 'lockoutMinutes'>,
): number {
  if (failedCount < policy.maxAttempts) return 0;
  const doublings = failedCount - policy.maxAttempts;
  return Math.min(policy.lockoutMinutes * 2 ** doublings, MAX_LOCKOUT_MINUTES);
}

/** The lockout policy configured for password checks (AUTH_* env). */
export function lockoutPolicy(config: Pick<Config, 'auth'>): LockoutPolicy {
  return {
    maxAttempts:        config.auth.maxLoginAttempts,
    lockoutMinutes:     config.auth.lockoutMinutes,
    maxAccountAttempts: config.auth.maxAccountLoginAttempts,
  };
}

/** Account-wide lock length: a flat lockoutMinutes once past the threshold. */
export function accountLockoutMinutesFor(failedCount: number, policy: LockoutPolicy): number {
  return failedCount < policy.maxAccountAttempts ? 0 : policy.lockoutMinutes;
}

/** Which lock refuses a sign-in attempt, if any. */
export type LoginLock = 'network' | 'account' | null;

/**
 * The lock that applies to this email from this network:
 *   'network' — this network's own streak is locked;
 *   'account' — the account-wide streak is locked AND this network has itself
 *               failed for the email in the current streak window;
 *   null      — neither. A clean network, such as the owner's, is never
 *               refused by the account-wide lock.
 * Pass `accountWide: false` to check only the network lock.
 */
export async function loginLock(
  email: string,
  network: string,
  { accountWide = true }: { accountWide?: boolean } = {},
): Promise<LoginLock> {
  const sql = getSql();
  const [row] = await sql<{ networkLocked: boolean | null; accountLocked: boolean | null; networkFailed: boolean | null }[]>`
    SELECT
      bool_or(ip_address = ${network} AND locked_until > NOW()) AS network_locked,
      bool_or(ip_address = ${ACCOUNT_WIDE} AND locked_until > NOW()) AS account_locked,
      bool_or(ip_address = ${network}
              AND last_failed_at > NOW() - make_interval(hours => ${STREAK_RESET_HOURS})) AS network_failed
    FROM login_failures
    WHERE email = ${normalizeEmail(email)} AND ip_address IN (${network}, ${ACCOUNT_WIDE})
  `;
  if (row?.networkLocked) return 'network';
  if (accountWide && row?.accountLocked && row.networkFailed) return 'account';
  return null;
}

/**
 * Records one failed attempt against the network counter and (unless
 * `accountWide: false`) the account-wide counter, and past their thresholds
 * sets their locks. Callers reject while locked, so the counts only grow
 * between locks — each per-network lock that expires and is followed by
 * another failure doubles.
 */
export async function recordLoginFailure(
  email: string,
  network: string,
  policy: LockoutPolicy,
  { accountWide = true }: { accountWide?: boolean } = {},
): Promise<void> {
  const key = normalizeEmail(email);
  const perNetwork = await countFailure(key, network);
  await lockFor(key, network, lockoutMinutesFor(perNetwork, policy));
  if (!accountWide) return;
  const accountTotal = await countFailure(key, ACCOUNT_WIDE);
  await lockFor(key, ACCOUNT_WIDE, accountLockoutMinutesFor(accountTotal, policy));
}

/** Adds one failure to a streak (restarting a stale one) and returns its length. */
async function countFailure(email: string, network: string): Promise<number> {
  const [row] = await getSql()<{ failedCount: number }[]>`
    INSERT INTO login_failures (email, ip_address, failed_count, last_failed_at)
    VALUES (${email}, ${network}, 1, NOW())
    ON CONFLICT (email, ip_address) DO UPDATE SET
      failed_count = CASE
        WHEN login_failures.last_failed_at < NOW() - make_interval(hours => ${STREAK_RESET_HOURS})
        THEN 1
        ELSE login_failures.failed_count + 1
      END,
      last_failed_at = NOW()
    RETURNING failed_count
  `;
  return row!.failedCount;
}

async function lockFor(email: string, network: string, minutes: number): Promise<void> {
  if (minutes === 0) return;
  await getSql()`
    UPDATE login_failures
    SET locked_until = NOW() + make_interval(mins => ${minutes})
    WHERE email = ${email} AND ip_address = ${network}
  `;
}

/**
 * Clears the streak for one email+network (successful login from that
 * network). The account-wide streak stays: one good sign-in must not hand an
 * attacker on other networks a fresh allowance. It lapses after a quiet day.
 */
export async function clearLoginFailures(email: string, network: string): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM login_failures WHERE email = ${normalizeEmail(email)} AND ip_address = ${network}
  `;
}

/** Clears every streak for an email, account-wide included (completed password reset). */
export async function clearAllLoginFailures(email: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM login_failures WHERE email = ${normalizeEmail(email)}`;
}
