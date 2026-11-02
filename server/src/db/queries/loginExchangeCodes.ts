import { randomBytes, createHash } from 'node:crypto';
import { getSql } from '../client.js';
import type { User } from './users.js';

/** How long the web app has to swap an OAuth sign-in code for a session. */
export const LOGIN_EXCHANGE_CODE_TTL_SECONDS = 60;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Mints a single-use code for a finished OAuth sign-in, plus the nonce that
 * must accompany it (sent to the browser as an HttpOnly cookie). Returns both
 * RAW; only their hashes are stored. Expired codes are swept on the way.
 */
export async function createLoginExchangeCode(
  user: Pick<User, 'id' | 'tokenVersion'>,
): Promise<{ code: string; nonce: string }> {
  const code = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');
  const sql = getSql();
  await sql`DELETE FROM login_exchange_codes WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO login_exchange_codes (code_hash, nonce_hash, user_id, token_version, expires_at)
    VALUES (${hash(code)}, ${hash(nonce)}, ${user.id}, ${user.tokenVersion},
            NOW() + make_interval(secs => ${LOGIN_EXCHANGE_CODE_TTL_SECONDS}))
  `;
  return { code, nonce };
}

/**
 * Consumes a code presented with its nonce and returns the signed-in user.
 * Null for an unknown, used or expired code, a nonce from another browser, or
 * an account whose sessions were revoked since the code was issued.
 */
export async function consumeLoginExchangeCode(code: string, nonce: string): Promise<User | null> {
  const rows = await getSql()<User[]>`
    DELETE FROM login_exchange_codes c
    USING users u
    WHERE c.code_hash = ${hash(code)}
      AND c.nonce_hash = ${hash(nonce)}
      AND c.expires_at > NOW()
      AND u.id = c.user_id
      AND u.token_version = c.token_version
    RETURNING u.*
  `;
  return rows[0] ?? null;
}
