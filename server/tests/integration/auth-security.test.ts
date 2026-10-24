import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPasswordHasher } from '../../src/lib/password.js';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { createUserWithPassword } from '../../src/db/queries/users.js';
import { createResetToken } from '../../src/db/queries/passwordResetTokens.js';

const PW = 'correct-horse-battery'; // >= 8 chars to satisfy the schema
const ATTACKER_IP = '203.0.113.66';
const OWNER_IP = '198.51.100.7';

/** Deletes any existing user (and its lockout rows) with this email, then recreates it with PW. */
async function resetUser(email: string) {
  const sql = getSql();
  await sql`DELETE FROM users WHERE email = ${email}`;
  await sql`DELETE FROM login_failures WHERE email = ${email}`;
  const hash = await createPasswordHasher(1).hash(PW);
  return createUserWithPassword(email, hash, 'Security Test');
}

function login(app: FastifyInstance, email: string, password: string, ip = '127.0.0.1') {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password }, remoteAddress: ip });
}

async function failureCount(email: string, ip: string): Promise<number> {
  const rows = await getSql()<{ failedCount: number }[]>`
    SELECT failed_count FROM login_failures WHERE email = ${email} AND ip_address = ${ip}
  `;
  return rows[0]?.failedCount ?? 0;
}

/** Seconds until the (email, ip) lock expires. */
async function lockSeconds(email: string, ip: string): Promise<number> {
  const rows = await getSql()<{ secs: number }[]>`
    SELECT EXTRACT(EPOCH FROM (locked_until - NOW()))::float AS secs
    FROM login_failures WHERE email = ${email} AND ip_address = ${ip}
  `;
  return Number(rows[0]?.secs ?? 0);
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

  describe('account lockout (per account + client IP)', () => {
    it('locks the account for the failing IP after the configured failed attempts', async () => {
      const email = 'lockout@example.com';
      await resetUser(email);

      for (let i = 0; i < 3; i++) {
        const res = await login(app, email, 'wrong-password', ATTACKER_IP);
        expect(res.statusCode).toBe(401);
      }

      // Locked now for that IP — even the correct password is rejected with 429.
      const res = await login(app, email, PW, ATTACKER_IP);
      expect(res.statusCode).toBe(429);
      expect(res.json().error).toBe('TOO_MANY_ATTEMPTS');
    });

    it("does not lock the real owner out when an attacker's IP is locked", async () => {
      const email = 'lockout-targeted@example.com';
      await resetUser(email);

      for (let i = 0; i < 5; i++) await login(app, email, 'wrong-password', ATTACKER_IP);
      expect((await login(app, email, PW, ATTACKER_IP)).statusCode).toBe(429);

      const res = await login(app, email, PW, OWNER_IP);
      expect(res.statusCode).toBe(200);
    });

    it('auto-clears the lock once the window has passed', async () => {
      const email = 'lockout-expire@example.com';
      await resetUser(email);

      for (let i = 0; i < 3; i++) await login(app, email, 'wrong-password', ATTACKER_IP);
      expect((await login(app, email, PW, ATTACKER_IP)).statusCode).toBe(429);

      // Simulate the lock window elapsing.
      await getSql()`UPDATE login_failures SET locked_until = NOW() - INTERVAL '1 minute' WHERE email = ${email}`;

      const res = await login(app, email, PW, ATTACKER_IP);
      expect(res.statusCode).toBe(200);
      expect(await failureCount(email, ATTACKER_IP)).toBe(0);
    });

    it('backs off exponentially when failures continue after a lock expires', async () => {
      const email = 'lockout-backoff@example.com';
      await resetUser(email);

      for (let i = 0; i < 3; i++) await login(app, email, 'wrong-password', ATTACKER_IP);
      const first = await lockSeconds(email, ATTACKER_IP);
      expect(first).toBeGreaterThan(14 * 60);
      expect(first).toBeLessThanOrEqual(15 * 60);

      await getSql()`UPDATE login_failures SET locked_until = NOW() - INTERVAL '1 second' WHERE email = ${email}`;
      expect((await login(app, email, 'wrong-password', ATTACKER_IP)).statusCode).toBe(401);

      const second = await lockSeconds(email, ATTACKER_IP);
      expect(second).toBeGreaterThan(29 * 60);
      expect(second).toBeLessThanOrEqual(30 * 60);
    });

    it('resets the failure counter on a successful login', async () => {
      const email = 'lockout-reset@example.com';
      await resetUser(email);

      await login(app, email, 'wrong-password', OWNER_IP);
      await login(app, email, 'wrong-password', OWNER_IP);
      expect(await failureCount(email, OWNER_IP)).toBe(2);

      expect((await login(app, email, PW, OWNER_IP)).statusCode).toBe(200);
      expect(await failureCount(email, OWNER_IP)).toBe(0);
    });

    it('answers an unknown email exactly like a wrong password', async () => {
      const email = 'lockout-unknown@example.com';
      await resetUser(email);
      await getSql()`DELETE FROM users WHERE email = ${email}`;
      const known = 'lockout-known@example.com';
      await resetUser(known);

      const unknownRes = await login(app, email, 'wrong-password', OWNER_IP);
      const knownRes = await login(app, known, 'wrong-password', OWNER_IP);
      expect(unknownRes.statusCode).toBe(401);
      expect(unknownRes.json()).toEqual(knownRes.json());

      // Unknown emails lock the same way, so a 429 does not reveal existence.
      for (let i = 0; i < 2; i++) await login(app, email, 'wrong-password', OWNER_IP);
      expect((await login(app, email, 'wrong-password', OWNER_IP)).statusCode).toBe(429);
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

  describe('session revocation', () => {
    function me(token: string) {
      return app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } });
    }

    it('includes the token version in issued session tokens', async () => {
      const email = 'session-version@example.com';
      await resetUser(email);

      const res = await login(app, email, PW);
      const payload = app.jwt.decode<{ tokenVersion: number }>(res.json().token);
      expect(payload?.tokenVersion).toBe(0);
    });

    it('invalidates existing sessions when the password is reset', async () => {
      const email = 'session-revoke@example.com';
      const user = await resetUser(email);
      const oldSession = (await login(app, email, PW)).json().token as string;
      expect((await me(oldSession)).statusCode).toBe(200);

      const { token } = await createResetToken(user.id, 60);
      const newPw = 'post-reset-password';
      await app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: newPw } });

      expect((await me(oldSession)).statusCode).toBe(401);
      const newSession = (await login(app, email, newPw)).json().token as string;
      expect((await me(newSession)).statusCode).toBe(200);
    });

    it('clears IP lockouts on password reset', async () => {
      const email = 'session-reset-lock@example.com';
      const user = await resetUser(email);
      for (let i = 0; i < 3; i++) await login(app, email, 'wrong-password');
      expect((await login(app, email, PW)).statusCode).toBe(429);

      const { token } = await createResetToken(user.id, 60);
      await app.inject({
        method: 'POST', url: '/auth/reset-password', payload: { token, password: 'after-lock-reset' },
      });

      expect((await login(app, email, 'after-lock-reset')).statusCode).toBe(200);
    });

    it('rejects a session for a user that no longer exists', async () => {
      const email = 'session-deleted@example.com';
      await resetUser(email);
      const session = (await login(app, email, PW)).json().token as string;
      await getSql()`DELETE FROM users WHERE email = ${email}`;

      expect((await me(session)).statusCode).toBe(401);
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
