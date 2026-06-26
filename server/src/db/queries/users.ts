import { getSql } from '../client.js';

/** Domain type — camelCase (postgres.camel maps snake_case columns). */
export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  provider: 'google' | 'github' | 'email';
  providerId: string;
  passwordHash: string | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertUserParams {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  provider: 'google' | 'github';
  providerId: string;
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
 * Inserts a new user or updates display_name and avatar_url on conflict.
 * Returns the upserted user.
 */
export async function upsertUser(params: UpsertUserParams): Promise<User> {
  const sql = getSql();
  const rows = await sql<User[]>`
    INSERT INTO users (email, display_name, avatar_url, provider, provider_id)
    VALUES (${params.email}, ${params.displayName}, ${params.avatarUrl}, ${params.provider}, ${params.providerId})
    ON CONFLICT (provider, provider_id)
      DO UPDATE SET
        email        = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        avatar_url   = EXCLUDED.avatar_url,
        updated_at   = NOW()
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Finds a user by email address (used for password login).
 * Returns null if not found.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const sql = getSql();
  const rows = await sql<User[]>`
    SELECT * FROM users WHERE email = ${email} LIMIT 1
  `;
  return rows[0] ?? null;
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
  const rows = await sql<User[]>`
    INSERT INTO users (email, display_name, provider, provider_id, password_hash)
    VALUES (${email}, ${displayName}, 'email', ${email}, ${passwordHash})
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Records a failed login attempt. Increments the counter and, once it reaches
 * `maxAttempts`, sets a temporary `locked_until` window. Returns the fresh row.
 */
export async function recordFailedLogin(
  userId: string,
  maxAttempts: number,
  lockoutMinutes: number,
): Promise<User> {
  // SET expressions read the OLD row values, so the nested CASE computes the
  // "effective" attempt count: an expired lock resets the streak to 1, giving
  // the user a fresh window rather than re-locking on a single later typo.
  const sql = getSql();
  const rows = await sql<User[]>`
    UPDATE users
    SET failed_login_attempts =
          CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW()
               THEN 1
               ELSE failed_login_attempts + 1 END,
        locked_until =
          CASE
            WHEN (CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW()
                       THEN 1 ELSE failed_login_attempts + 1 END) >= ${maxAttempts}
            THEN NOW() + make_interval(mins => ${lockoutMinutes})
            ELSE NULL
          END,
        updated_at = NOW()
    WHERE id = ${userId}
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Clears the failed-login counter and any active lock (called on a successful
 * login or a completed password reset). Returns the fresh row.
 */
export async function clearLoginFailures(userId: string): Promise<User> {
  const sql = getSql();
  const rows = await sql<User[]>`
    UPDATE users
    SET failed_login_attempts = 0,
        locked_until = NULL,
        updated_at = NOW()
    WHERE id = ${userId}
    RETURNING *
  `;
  return rows[0]!;
}

/**
 * Sets a new password hash for a user (used by the reset-password flow).
 * Returns the fresh row.
 */
export async function updateUserPassword(
  userId: string,
  passwordHash: string,
): Promise<User> {
  const sql = getSql();
  const rows = await sql<User[]>`
    UPDATE users
    SET password_hash = ${passwordHash},
        updated_at = NOW()
    WHERE id = ${userId}
    RETURNING *
  `;
  return rows[0]!;
}
