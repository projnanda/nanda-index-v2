import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { getSql, closeSql } from '../../src/db/client.js';

const migration = readFileSync(new URL('../../db/migrations/023_bind_account_verify_email.sql', import.meta.url), 'utf8');

describe('account verification email binding migration', () => {
  afterAll(closeSql);

  it('drops every pending link, however recently it was sent, and leaves other rows alone', async () => {
    await getSql().begin(async (transaction) => {
      // A pre-023 users table, shadowing the real one for this transaction.
      await transaction`CREATE TEMPORARY TABLE users (LIKE public.users INCLUDING ALL) ON COMMIT DROP`;
      await transaction`ALTER TABLE users DROP COLUMN email_verify_token_email`;
      await transaction`
        INSERT INTO users (email, provider, provider_id, email_verify_token, email_verify_token_expires_at,
                           email_verify_sent_at, updated_at)
        VALUES
          ('untouched@example.org', 'github', 'm-untouched', ${'a'.repeat(64)}, NOW() + INTERVAL '1 day', NOW(), NOW()),
          ('changed@example.org',   'github', 'm-changed',   ${'b'.repeat(64)}, NOW() + INTERVAL '1 day', NOW() - INTERVAL '1 hour', NOW()),
          ('no-link@example.org',   'github', 'm-no-link',   NULL, NULL, NULL, NOW())`;

      await transaction.unsafe(migration);

      const rows = await transaction<{ email: string; emailVerifyToken: string | null; emailVerifyTokenExpiresAt: Date | null; emailVerifySentAt: Date | null; emailVerifyTokenEmail: string | null }[]>`
        SELECT email, email_verify_token, email_verify_token_expires_at, email_verify_sent_at, email_verify_token_email
        FROM users ORDER BY email`;
      expect(rows.map((row) => row.email)).toEqual(['changed@example.org', 'no-link@example.org', 'untouched@example.org']);
      for (const row of rows) {
        expect(row.emailVerifyToken).toBeNull();
        expect(row.emailVerifyTokenExpiresAt).toBeNull();
        expect(row.emailVerifySentAt).toBeNull();
        expect(row.emailVerifyTokenEmail).toBeNull();
      }
    });
  });
});
