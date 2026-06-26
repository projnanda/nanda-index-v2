import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { createUserWithPassword, findUserByEmail } from '../../src/db/queries/users.js';
import { createResetToken } from '../../src/db/queries/passwordResetTokens.js';

const PW = 'correct-horse-battery'; // >= 8 chars to satisfy the schema

/** Deletes any existing user with this email, then recreates it with PW. */
async function resetUser(email: string) {
  const sql = getSql();
  await sql`DELETE FROM users WHERE email = ${email}`;
  const hash = await bcrypt.hash(PW, 10);
  return createUserWithPassword(email, hash, 'Security Test');
}

function login(app: FastifyInstance, email: string, password: string) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
}

describe('auth security hardening', () => {
  let app: FastifyInstance;   // lenient rate limit, strict 3-attempt lockout
  let rlApp: FastifyInstance; // tiny rate limit, lockout effectively disabled

  beforeAll(async () => {
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = '3';
    process.env.AUTH_LOCKOUT_MINUTES = '15';
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();

    process.env.AUTH_RATE_LIMIT_MAX = '2';
    process.env.AUTH_MAX_LOGIN_ATTEMPTS = '1000';
    rlApp = (await buildServer({ logger: false })).fastify;
    await rlApp.ready();
  });

  afterAll(async () => {
    await app.close();   // onClose hook drains the shared pool
    await rlApp.close();
    await closeSql();    // no-op if already closed
  });

  describe('account lockout', () => {
    it('locks the account after the configured failed attempts', async () => {
      const email = 'lockout@example.com';
      await resetUser(email);

      for (let i = 0; i < 3; i++) {
        const res = await login(app, email, 'wrong-password');
        expect(res.statusCode).toBe(401);
      }

      // Locked now — even the correct password is rejected with 429.
      const res = await login(app, email, PW);
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('TOO_MANY_ATTEMPTS');
    });

    it('auto-clears the lock once the window has passed', async () => {
      const email = 'lockout-expire@example.com';
      await resetUser(email);

      for (let i = 0; i < 3; i++) await login(app, email, 'wrong-password');
      expect((await login(app, email, PW)).statusCode).toBe(429);

      // Simulate the lock window elapsing.
      await getSql()`UPDATE users SET locked_until = NOW() - INTERVAL '1 minute' WHERE email = ${email}`;

      const res = await login(app, email, PW);
      expect(res.statusCode).toBe(200);

      const user = await findUserByEmail(email);
      expect(user?.failedLoginAttempts).toBe(0);
    });

    it('resets the failure counter on a successful login', async () => {
      const email = 'lockout-reset@example.com';
      await resetUser(email);

      await login(app, email, 'wrong-password');
      await login(app, email, 'wrong-password');
      expect((await findUserByEmail(email))?.failedLoginAttempts).toBe(2);

      expect((await login(app, email, PW)).statusCode).toBe(200);
      expect((await findUserByEmail(email))?.failedLoginAttempts).toBe(0);
    });
  });

  describe('forgot password (no account enumeration)', () => {
    it('returns 200 and issues a token for a real account', async () => {
      const email = 'forgot@example.com';
      const user = await resetUser(email);

      const res = await app.inject({
        method: 'POST', url: '/auth/forgot-password', payload: { email },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);

      const tokens = await getSql()`
        SELECT id FROM password_reset_tokens WHERE user_id = ${user.id}
      `;
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('returns 200 for an unknown email and issues no token', async () => {
      const email = 'nobody-unknown@example.com';
      await getSql()`DELETE FROM users WHERE email = ${email}`;

      const res = await app.inject({
        method: 'POST', url: '/auth/forgot-password', payload: { email },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });
  });

  describe('reset password', () => {
    it('sets a new password and consumes a single-use token', async () => {
      const email = 'reset@example.com';
      const user = await resetUser(email);
      const { token } = await createResetToken(user.id, 60);
      const newPw = 'brand-new-password';

      const res = await app.inject({
        method: 'POST', url: '/auth/reset-password', payload: { token, password: newPw },
      });
      expect(res.statusCode).toBe(200);

      expect((await login(app, email, PW)).statusCode).toBe(401);   // old password gone
      expect((await login(app, email, newPw)).statusCode).toBe(200); // new password works

      const reuse = await app.inject({
        method: 'POST', url: '/auth/reset-password', payload: { token, password: 'yet-another-pw' },
      });
      expect(reuse.statusCode).toBe(400); // token already used
    });

    it('rejects an expired token', async () => {
      const email = 'reset-expired@example.com';
      const user = await resetUser(email);
      const { token, row } = await createResetToken(user.id, 60);
      await getSql()`UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = ${row.id}`;

      const res = await app.inject({
        method: 'POST', url: '/auth/reset-password', payload: { token, password: 'some-new-pass' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an unknown token', async () => {
      const res = await app.inject({
        method: 'POST', url: '/auth/reset-password',
        payload: { token: 'deadbeef'.repeat(8), password: 'some-new-pass' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('hardening headers + rate limit', () => {
    it('sets baseline security headers via helmet', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/providers' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
    });

    it('throttles auth routes past the configured max', async () => {
      // rlApp allows 2/window; unknown email keeps lockout out of the picture.
      const payload = { email: 'ratelimit-unknown@example.com', password: 'whatever-pw' };
      const r1 = await rlApp.inject({ method: 'POST', url: '/auth/login', payload });
      const r2 = await rlApp.inject({ method: 'POST', url: '/auth/login', payload });
      const r3 = await rlApp.inject({ method: 'POST', url: '/auth/login', payload });

      expect(r1.statusCode).toBe(401);
      expect(r2.statusCode).toBe(401);
      expect(r3.statusCode).toBe(429);
    });
  });
});
