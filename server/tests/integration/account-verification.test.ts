import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser, findUserByEmail } from '../../src/db/queries/users.js';
import { issueAccountVerifyToken, consumeAccountVerifyToken } from '../../src/db/queries/accountVerification.js';
import { isOperator } from '../../src/services/operators.js';

const PW = 'correct-horse-battery';
const ORG_PREFIX = 'acctv-';

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function orgPayload(orgId: string) {
  return {
    org_id:        orgId,
    display_name:  'Account Verification Org',
    domain:        `${orgId}.example.com`,
    contact_email: `admin@${orgId}.example.com`,
    registry_url:  `https://${orgId}.example.com/registry`,
  };
}

/**
 * Registers an email/password account and captures the verification link
 * that log-mode email prints, so the test can complete the flow end to end.
 */
async function registerAndCaptureToken(app: FastifyInstance, email: string) {
  await getSql()`DELETE FROM users WHERE email = ${email}`;
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const res = await app.inject({
    method: 'POST', url: '/auth/register', payload: { email, password: PW },
  });
  const line = logSpy.mock.calls.map(c => String(c[0])).find(l => l.includes('/verify-account?token='));
  logSpy.mockRestore();
  const verifyToken = line?.match(/token=([a-f0-9]+)/)?.[1];
  return { res, sessionToken: res.json().token as string, verifyToken };
}

function verifyAccount(app: FastifyInstance, token: string) {
  return app.inject({ method: 'POST', url: '/auth/verify-account', payload: { token } });
}

describe('account email verification', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM org_memberships WHERE org_id LIKE ${ORG_PREFIX + '%'}`;
    await sql`DELETE FROM organizations WHERE org_id LIKE ${ORG_PREFIX + '%'}`;
  });

  describe('registration', () => {
    it('creates an unverified account, returns a session, and emails a verify link', async () => {
      const { res, verifyToken } = await registerAndCaptureToken(app, 'acctv-register@example.com');

      expect(res.statusCode).toBe(201);
      expect(res.json().token).toEqual(expect.any(String));
      expect(verifyToken).toMatch(/^[a-f0-9]{64}$/);

      const user = await findUserByEmail('acctv-register@example.com');
      expect(user?.emailVerified).toBe(false);
      // Only a hash is stored, never the raw emailed token.
      expect(user?.emailVerifyToken).not.toBe(verifyToken);
    });

    it('reports email_verified=false on GET /api/v1/me', async () => {
      const { sessionToken } = await registerAndCaptureToken(app, 'acctv-me@example.com');

      const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(sessionToken) });
      expect(me.statusCode).toBe(200);
      expect(me.json().email_verified).toBe(false);
    });
  });

  describe('gate on org writes', () => {
    it('returns 403 ACCOUNT_NOT_VERIFIED when an unverified account creates an org', async () => {
      const { sessionToken } = await registerAndCaptureToken(app, 'acctv-gate@example.com');

      const res = await app.inject({
        method: 'POST', url: '/api/v1/orgs', headers: auth(sessionToken), payload: orgPayload('acctv-gate'),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'ACCOUNT_NOT_VERIFIED', detail: 'verify your account email first' });
    });

    it('lets the account create an org once the email is verified', async () => {
      const { sessionToken, verifyToken } = await registerAndCaptureToken(app, 'acctv-flow@example.com');

      const verified = await verifyAccount(app, verifyToken!);
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toEqual({ ok: true });

      const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(sessionToken) });
      expect(me.json().email_verified).toBe(true);

      const res = await app.inject({
        method: 'POST', url: '/api/v1/orgs', headers: auth(sessionToken), payload: orgPayload('acctv-flow'),
      });
      expect(res.statusCode).toBe(201);
    });

    it('blocks every admin write route for an admin whose account is unverified, but not reads', async () => {
      const admin = await upsertUser({
        email: 'acctv-admin@example.com', displayName: null, avatarUrl: null,
        provider: 'google', providerId: 'acctv-admin-provider-id', emailVerified: true,
      });
      const token = app.jwt.sign({ userId: admin.id, email: admin.email, displayName: null });
      const created = await app.inject({
        method: 'POST', url: '/api/v1/orgs', headers: auth(token), payload: orgPayload('acctv-admin'),
      });
      expect(created.statusCode).toBe(201);

      await getSql()`UPDATE users SET email_verified = FALSE WHERE id = ${admin.id}`;

      const writes = [
        { method: 'PUT' as const,    url: '/api/v1/orgs/acctv-admin', payload: { display_name: 'Renamed' } },
        { method: 'POST' as const,   url: '/api/v1/orgs/acctv-admin/domain-challenge' },
        { method: 'POST' as const,   url: '/api/v1/orgs/acctv-admin/verify-domain' },
        { method: 'POST' as const,   url: '/api/v1/orgs/acctv-admin/resend-verification' },
        { method: 'DELETE' as const, url: '/api/v1/orgs/acctv-admin/suspend' },
        { method: 'POST' as const,   url: '/api/v1/orgs/acctv-admin/reactivate' },
        { method: 'DELETE' as const, url: '/api/v1/orgs/acctv-admin' },
      ];
      for (const w of writes) {
        const res = await app.inject({ ...w, headers: auth(token) });
        expect(res.statusCode, `${w.method} ${w.url}`).toBe(403);
        expect(res.json().error, `${w.method} ${w.url}`).toBe('ACCOUNT_NOT_VERIFIED');
      }

      const read = await app.inject({ method: 'GET', url: '/api/v1/orgs/acctv-admin', headers: auth(token) });
      expect(read.statusCode).toBe(200);
    });
  });

  describe('POST /auth/verify-account', () => {
    it('is single-use', async () => {
      const { verifyToken } = await registerAndCaptureToken(app, 'acctv-single@example.com');

      expect((await verifyAccount(app, verifyToken!)).statusCode).toBe(200);
      const reuse = await verifyAccount(app, verifyToken!);
      expect(reuse.statusCode).toBe(400);
      expect(reuse.json().error).toBe('INVALID_TOKEN');
    });

    it('rejects an expired token', async () => {
      const email = 'acctv-expired@example.com';
      const { verifyToken } = await registerAndCaptureToken(app, email);
      await getSql()`
        UPDATE users SET email_verify_token_expires_at = NOW() - INTERVAL '1 minute' WHERE email = ${email}
      `;

      expect((await verifyAccount(app, verifyToken!)).statusCode).toBe(400);
      expect((await findUserByEmail(email))?.emailVerified).toBe(false);
    });

    it('rejects an unknown token', async () => {
      expect((await verifyAccount(app, 'ab'.repeat(32))).statusCode).toBe(400);
    });
  });

  describe('POST /auth/resend-account-verification', () => {
    it('requires authentication', async () => {
      const res = await app.inject({ method: 'POST', url: '/auth/resend-account-verification' });
      expect(res.statusCode).toBe(401);
    });

    it('enforces a cooldown, then issues a fresh token that replaces the old one', async () => {
      const email = 'acctv-resend@example.com';
      const { sessionToken, verifyToken: firstToken } = await registerAndCaptureToken(app, email);

      // Immediately after registration the cooldown is still running.
      const tooSoon = await app.inject({
        method: 'POST', url: '/auth/resend-account-verification', headers: auth(sessionToken),
      });
      expect(tooSoon.statusCode).toBe(429);
      expect(tooSoon.json().error).toBe('RESEND_COOLDOWN');

      await getSql()`
        UPDATE users SET email_verify_sent_at = NOW() - INTERVAL '2 minutes' WHERE email = ${email}
      `;
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const resent = await app.inject({
        method: 'POST', url: '/auth/resend-account-verification', headers: auth(sessionToken),
      });
      const line = logSpy.mock.calls.map(c => String(c[0])).find(l => l.includes('/verify-account?token='));
      logSpy.mockRestore();
      expect(resent.statusCode).toBe(200);
      const secondToken = line?.match(/token=([a-f0-9]+)/)?.[1];
      expect(secondToken).toBeDefined();
      expect(secondToken).not.toBe(firstToken);

      expect((await verifyAccount(app, firstToken!)).statusCode).toBe(400);
      expect((await verifyAccount(app, secondToken!)).statusCode).toBe(200);
    });

    it('is a no-op for an already-verified account', async () => {
      const user = await upsertUser({
        email: 'acctv-oauth@example.com', displayName: null, avatarUrl: null,
        provider: 'github', providerId: 'acctv-oauth-provider-id', emailVerified: true,
      });
      const token = app.jwt.sign({ userId: user.id, email: user.email, displayName: null });

      const res = await app.inject({
        method: 'POST', url: '/auth/resend-account-verification', headers: auth(token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, already_verified: true });
    });
  });

  describe('OAuth accounts', () => {
    it('marks an OAuth user verified when the provider verified the email', async () => {
      const user = await upsertUser({
        email: 'acctv-google@example.com', displayName: null, avatarUrl: null,
        provider: 'google', providerId: 'acctv-google-provider-id', emailVerified: true,
      });
      expect(user.emailVerified).toBe(true);
    });

    it('keeps an OAuth user unverified when the provider did not verify the email', async () => {
      await getSql()`DELETE FROM users WHERE provider_id = 'acctv-gh-unverified-id'`;
      const user = await upsertUser({
        email: 'acctv-gh-unverified@example.com', displayName: null, avatarUrl: null,
        provider: 'github', providerId: 'acctv-gh-unverified-id', emailVerified: false,
      });
      expect(user.emailVerified).toBe(false);
    });
  });

  // A link proves the mailbox it was sent to, and nothing else. An OAuth sign-in
  // that changes the account's email must not let the old link verify the new one.
  describe('link bound to the address it was sent to', () => {
    const PROVIDER_ID = 'acctv-email-change-id';
    const ADMIN = 'acctv-operator@example.com';

    async function signInWith(email: string) {
      return upsertUser({
        email, displayName: null, avatarUrl: null,
        provider: 'github', providerId: PROVIDER_ID, emailVerified: false,
      });
    }

    async function cleanup() {
      await getSql()`DELETE FROM users WHERE provider_id = ${PROVIDER_ID}`;
    }

    beforeEach(cleanup);
    afterAll(cleanup);

    it('does not verify (or make an operator of) an address the link was never sent to', async () => {
      const previousAdmins = process.env.ADMIN_EMAILS;
      process.env.ADMIN_EMAILS = ADMIN;
      try {
        const user = await signInWith('acctv-attacker@example.com');
        const token = await issueAccountVerifyToken(user.id);
        expect(token).toEqual(expect.any(String));

        // Same GitHub identity, now reporting an unverified admin address.
        const changed = await signInWith(ADMIN);
        expect(changed.email).toBe(ADMIN);
        expect(changed.emailVerifyToken).toBeNull();

        const res = await verifyAccount(app, token!);
        expect(res.statusCode).toBe(400);
        const after = await findUserByEmail(ADMIN);
        expect(after?.emailVerified).toBe(false);
        expect(await isOperator(user.id)).toBe(false);
      } finally {
        if (previousAdmins === undefined) delete process.env.ADMIN_EMAILS;
        else process.env.ADMIN_EMAILS = previousAdmins;
      }
    });

    it('refuses a token whose recorded address no longer matches the account', async () => {
      // Defence in depth: even if a path changed the email without clearing
      // the token, consuming it must check the address it was issued for.
      const user = await signInWith('acctv-before@example.com');
      const token = await issueAccountVerifyToken(user.id);
      await getSql()`UPDATE users SET email = 'acctv-after@example.com' WHERE id = ${user.id}`;

      expect(await consumeAccountVerifyToken(token!)).toBeNull();
      expect((await findUserByEmail('acctv-after@example.com'))?.emailVerified).toBe(false);
    });

    it('keeps the pending link when a sign-in reports the same address', async () => {
      const user = await signInWith('acctv-same@example.com');
      const token = await issueAccountVerifyToken(user.id);
      await signInWith('ACCTV-same@example.com');

      const res = await verifyAccount(app, token!);
      expect(res.statusCode).toBe(200);
      expect((await findUserByEmail('acctv-same@example.com'))?.emailVerified).toBe(true);
    });

    it('lets the account resend straight away after the address changes', async () => {
      const user = await signInWith('acctv-resend-a@example.com');
      await issueAccountVerifyToken(user.id);
      await signInWith('acctv-resend-b@example.com');

      expect(await issueAccountVerifyToken(user.id)).toEqual(expect.any(String));
    });
  });
});
