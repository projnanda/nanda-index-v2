import { randomBytes, createHash } from 'node:crypto';
import { getSql } from '../client.js';
import type { User } from './users.js';

/** How long an emailed account-verification link stays valid. */
export const ACCOUNT_VERIFY_TTL_HOURS = 24;
/** Minimum gap between verification emails for one account. */
export const ACCOUNT_VERIFY_RESEND_COOLDOWN_SECONDS = 60;

/**
 * SHA-256 of a raw verification token. Only the hash is stored, so a database
 * leak does not expose usable links; the raw token lives only in the email.
 */
export function hashAccountVerifyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mints a fresh verification token for an unverified account, replacing any
 * outstanding one, and returns the RAW token to email. The token is bound to
 * the address it is mailed to (the account's current email). Returns null when the
 * resend cooldown is still running (or the account is already verified) — the
 * check and the write are one UPDATE so concurrent requests cannot both send.
 */
export async function issueAccountVerifyToken(userId: string): Promise<string | null> {
  const token = randomBytes(32).toString('hex');
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    UPDATE users
    SET email_verify_token            = ${hashAccountVerifyToken(token)},
        email_verify_token_email      = email,
        email_verify_token_expires_at = NOW() + make_interval(hours => ${ACCOUNT_VERIFY_TTL_HOURS}),
        email_verify_sent_at          = NOW(),
        updated_at                    = NOW()
    WHERE id = ${userId}
      AND email_verified = FALSE
      AND (email_verify_sent_at IS NULL
           OR email_verify_sent_at <= NOW() - make_interval(secs => ${ACCOUNT_VERIFY_RESEND_COOLDOWN_SECONDS}))
    RETURNING id
  `;
  return rows.length > 0 ? token : null;
}

/**
 * Marks the account owning an unexpired token as verified and clears the
 * token (single use). The account's email must still be the address the token
 * was mailed to, so a link never verifies a different address. Returns the
 * verified user, or null for an unknown, used, expired or rebound token.
 */
export async function consumeAccountVerifyToken(token: string): Promise<User | null> {
  const sql = getSql();
  const rows = await sql<User[]>`
    UPDATE users
    SET email_verified                = TRUE,
        email_verify_token            = NULL,
        email_verify_token_email      = NULL,
        email_verify_token_expires_at = NULL,
        updated_at                    = NOW()
    WHERE email_verify_token = ${hashAccountVerifyToken(token)}
      AND email_verify_token_expires_at > NOW()
      AND email_verify_token_email = email
    RETURNING *
  `;
  return rows[0] ?? null;
}
