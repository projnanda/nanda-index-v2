import { getSql } from '../client.js';
import type { TransactionSql } from 'postgres';

/** Domain type — camelCase (postgres.camel maps snake_case columns). */
export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  provider: 'google' | 'github' | 'email';
  providerId: string;
  passwordHash: string | null;
  emailVerified: boolean;
  /** SHA-256 of the outstanding account-verification token (never the raw token). */
  emailVerifyToken: string | null;
  emailVerifyTokenExpiresAt: Date | null;
  emailVerifySentAt: Date | null;
  /** Embedded in session JWTs; bumping it revokes every older session. */
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertUserParams {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  provider: 'google' | 'github';
  providerId: string;
  /** Whether the provider vouches for the email. Required, with no default:
   *  each callback must read the provider's own verified flag, so a caller
   *  that forgets it fails to compile instead of trusting the address. */
  emailVerified: boolean;
}

/**
 * Finds a user by OAuth provider + provider-specific ID.
 * Returns null if not found.
 */
export async function findUserByProvider(
  provider: 'google' | 'github',
  providerId: string,
): Promise<User | null> {
  const sql = getSql();
  const rows = await sql<User[]>`
    SELECT * FROM users
    WHERE provider = ${provider} AND provider_id = ${providerId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Finds a user by internal UUID.
 * Returns null if not found.
 */
export async function findUserById(id: string): Promise<User | null> {
  const sql = getSql();
  const rows = await sql<User[]>`
    SELECT * FROM users WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Recheck account control in the transaction granting entry ownership.
 * Writing the row also makes a SERIALIZABLE account deletion with an older
 * snapshot retry after this grant commits, so it sees the new membership.
 * A row lock alone would not refresh that deletion's snapshot.
 */
export async function lockVerifiedUserForOwnership(
  tx: TransactionSql, userId: string, tokenVersion: number,
): Promise<boolean> {
  const rows = await tx`UPDATE users SET updated_at = clock_timestamp()
    WHERE id = ${userId} AND email_verified AND token_version = ${tokenVersion}
    RETURNING id`;
  return rows.length > 0;
}

/**
 * Inserts a new user or refreshes their provider profile on conflict.
 * A name edited in Account settings is retained, including a deliberately cleared name.
 * Returns the upserted user.
 *
 * On conflict the account stays verified if the provider verifies the email
 * now, or if it was already verified for this same address (e.g. via our own
 * verification link). A changed, unverified address drops the flag.
 */
export async function upsertUser(params: UpsertUserParams): Promise<User> {
  const sql = getSql();
  const rows = await sql<User[]>`
    INSERT INTO users (email, display_name, avatar_url, provider, provider_id, email_verified)
    VALUES (${normalizeEmail(params.email)}, ${params.displayName}, ${params.avatarUrl}, ${params.provider}, ${params.providerId}, ${params.emailVerified})
    ON CONFLICT (provider, provider_id)
      DO UPDATE SET
        email          = EXCLUDED.email,
        display_name   = CASE WHEN users.display_name_customized THEN users.display_name ELSE EXCLUDED.display_name END,
        avatar_url     = EXCLUDED.avatar_url,
        email_verified = EXCLUDED.email_verified
                         OR (users.email_verified AND users.email = EXCLUDED.email),
        updated_at     = NOW()
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * True when `upsertUser` inserted the row rather than updating an existing
 * one: on insert both timestamps default to the same NOW(), while the
 * ON CONFLICT update moves updated_at to a later transaction's NOW().
 */
export function wasJustCreated(user: User): boolean {
  return user.createdAt.getTime() === user.updatedAt.getTime();
}

/**
 * Finds a user by email address (used for password login).
 * Returns null if not found.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const sql = getSql();
  const rows = await sql<User[]>`
    SELECT * FROM users WHERE lower(email) = ${normalizeEmail(email)}
    ORDER BY created_at ASC  -- deterministic if legacy case-only duplicates exist (see migration 015)
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Email addresses are compared and stored trimmed and lowercased (migration 015). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Creates a new email/password user.
 * Uses provider='email', provider_id=email so the existing unique constraint holds.
 * Throws on duplicate email.
 */
export async function createUserWithPassword(
  email: string,
  passwordHash: string,
  displayName: string | null,
): Promise<User> {
  const sql = getSql();
  const normalized = normalizeEmail(email);
  const rows = await sql<User[]>`
    INSERT INTO users (email, display_name, provider, provider_id, password_hash)
    VALUES (${normalized}, ${displayName}, 'email', ${normalized}, ${passwordHash})
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Sets a new password hash for a user (used by the reset-password flow) and
 * bumps token_version so every session issued before the change stops working
 * — whoever knew the old password may hold one. Returns the fresh row.
 */
export async function updateUserPassword(
  userId: string,
  passwordHash: string,
): Promise<User> {
  const sql = getSql();
  const rows = await sql<User[]>`
    UPDATE users
    SET password_hash = ${passwordHash},
        token_version = token_version + 1,
        updated_at = NOW()
    WHERE id = ${userId}
    RETURNING *
  `;
  return rows[0]!;
}
