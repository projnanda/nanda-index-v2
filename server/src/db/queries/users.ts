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
