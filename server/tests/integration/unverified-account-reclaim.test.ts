import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

/**
 * An unverified email/password account holds its email only for a grace
 * window (AUTH_UNVERIFIED_RECLAIM_HOURS, default 48). After that, registering
 * the same email replaces the stale account, so a squatter cannot keep the
 * real owner out forever.
 */

const PREFIX = 'reclaim-';
const SQUATTER_PW = 'squatter-password-1';
const OWNER_PW = 'real-owner-password-2';
const DEFAULT_WINDOW_HOURS = 48;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function register(app: FastifyInstance, email: string, password: string, ip = '127.0.0.1') {
  return app.inject({ method: 'POST', url: '/auth/register', payload: { email, password }, remoteAddress: ip });
}

function login(app: FastifyInstance, email: string, password: string) {
  return app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
}

function me(app: FastifyInstance, token: string) {
  return app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(token) });
}

/** Moves an account's creation time back, as if it had been registered `hours` ago. */
async function ageAccount(email: string, hours: number): Promise<void> {
  await getSql()`
    UPDATE users SET created_at = NOW() - make_interval(hours => ${hours})
    WHERE email = ${email}
  `;
}

async function accountRows(email: string) {
  return getSql()<{ id: string; emailVerified: boolean }[]>`
    SELECT id, email_verified FROM users WHERE lower(email) = ${email}
  `;
}

/** Registers the squatter's account and captures its session and emailed verify link. */
async function squat(app: FastifyInstance, email: string) {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const res = await register(app, email, SQUATTER_PW);
  const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('/verify-account?token='));
  logSpy.mockRestore();
  expect(res.statusCode).toBe(201);
  return { session: res.json().token as string, verifyToken: line?.match(/token=([a-f0-9]+)/)?.[1] };
}

describe('reclaiming stale unverified accounts at registration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
    delete process.env.AUTH_UNVERIFIED_RECLAIM_HOURS;
    app = (await buildServer({ logger: false })).fastify;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE ${PREFIX + '%'}`;
    await sql`DELETE FROM users WHERE email LIKE ${PREFIX + '%'}`;
  });

  it('still refuses an unverified account inside the grace window', async () => {
    const email = `${PREFIX}fresh@example.com`;
    await squat(app, email);
    await ageAccount(email, DEFAULT_WINDOW_HOURS - 1);

    const res = await register(app, email, OWNER_PW);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('CONFLICT');
  });

  it('replaces a stale unverified account and issues a working session to the new registrant', async () => {
    const email = `${PREFIX}stale@example.com`;
    await squat(app, email);
    const [before] = await accountRows(email);
    await ageAccount(email, DEFAULT_WINDOW_HOURS + 1);

    const res = await register(app, email, OWNER_PW);
    expect(res.statusCode).toBe(201);
    const newSession = res.json().token as string;

    const rows = await accountRows(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(before!.id);
    expect(rows[0]!.emailVerified).toBe(false);
    expect((await me(app, newSession)).statusCode).toBe(200);
  });

  it("revokes the stale account's sessions, password and verification link", async () => {
    const email = `${PREFIX}revoke@example.com`;
    const { session: oldSession, verifyToken } = await squat(app, email);
    expect(verifyToken).toBeTruthy();
    await ageAccount(email, DEFAULT_WINDOW_HOURS + 1);

    expect((await register(app, email, OWNER_PW)).statusCode).toBe(201);

    expect((await me(app, oldSession)).statusCode).toBe(401);
    expect((await login(app, email, SQUATTER_PW)).statusCode).toBe(401);
    expect((await login(app, email, OWNER_PW)).statusCode).toBe(200);
    const verify = await app.inject({ method: 'POST', url: '/auth/verify-account', payload: { token: verifyToken } });
    expect(verify.statusCode).toBe(400);
    expect((await accountRows(email))[0]!.emailVerified).toBe(false);
  });

  it('never reclaims a verified account, however old', async () => {
    const email = `${PREFIX}verified@example.com`;
    await squat(app, email);
    await getSql()`UPDATE users SET email_verified = true WHERE email = ${email}`;
    await ageAccount(email, DEFAULT_WINDOW_HOURS * 10);

    expect((await register(app, email, OWNER_PW)).statusCode).toBe(409);
    expect((await login(app, email, SQUATTER_PW)).statusCode).toBe(200);
  });

  it('never reclaims an account that belongs to an org', async () => {
    const email = `${PREFIX}member@example.com`;
    const orgId = `${PREFIX}org`;
    const { session } = await squat(app, email);
    // Org writes need a verified account; verify, register, then drop the flag
    // to model an account whose verification state changed later.
    await getSql()`UPDATE users SET email_verified = true WHERE email = ${email}`;
    const org = await app.inject({
      method: 'POST', url: '/api/v1/orgs', headers: auth(session),
      payload: {
        org_id: orgId, display_name: 'Reclaim Org', domain: `${orgId}.example.com`,
        contact_email: email, registry_url: `https://${orgId}.example.com/registry`,
      },
    });
    expect(org.statusCode).toBe(201);
    await getSql()`UPDATE users SET email_verified = false WHERE email = ${email}`;
    await ageAccount(email, DEFAULT_WINDOW_HOURS + 1);

    expect((await register(app, email, OWNER_PW)).statusCode).toBe(409);
    const memberships = await getSql()`SELECT 1 FROM org_memberships WHERE org_id = ${orgId}`;
    expect(memberships).toHaveLength(1);
  });

  it('never reclaims an OAuth account with an unverified email', async () => {
    const email = `${PREFIX}oauth@example.com`;
    await upsertUser({
      email, displayName: null, avatarUrl: null, provider: 'github',
      providerId: `${PREFIX}gh-1`, emailVerified: false,
    });
    await ageAccount(email, DEFAULT_WINDOW_HOURS + 1);

    expect((await register(app, email, OWNER_PW)).statusCode).toBe(409);
  });

  it('lets exactly one of two concurrent reclaims win', async () => {
    const email = `${PREFIX}race@example.com`;
    await squat(app, email);
    await ageAccount(email, DEFAULT_WINDOW_HOURS + 1);

    const [a, b] = await Promise.all([
      register(app, email, OWNER_PW),
      register(app, email, 'competing-password-3'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await accountRows(email)).toHaveLength(1);

    const winner = a.statusCode === 201 ? a : b;
    expect((await me(app, winner.json().token as string)).statusCode).toBe(200);
  });

  it('answers two concurrent first registrations with 201 and 409, never a 500', async () => {
    const email = `${PREFIX}first-race@example.com`;
    const [a, b] = await Promise.all([
      register(app, email, OWNER_PW),
      register(app, email, 'competing-password-3'),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect(await accountRows(email)).toHaveLength(1);
  });

  describe('configurable window', () => {
    let shortApp: FastifyInstance;

    beforeAll(async () => {
      process.env.AUTH_UNVERIFIED_RECLAIM_HOURS = '1';
      shortApp = (await buildServer({ logger: false })).fastify;
      await shortApp.ready();
      delete process.env.AUTH_UNVERIFIED_RECLAIM_HOURS;
    });

    afterAll(async () => {
      await shortApp.close();
    });

    it('reclaims after AUTH_UNVERIFIED_RECLAIM_HOURS', async () => {
      const email = `${PREFIX}short@example.com`;
      await squat(shortApp, email);
      await ageAccount(email, 2);

      expect((await register(shortApp, email, OWNER_PW)).statusCode).toBe(201);
    });
  });
});

describe('registration conflict responses', () => {
  let rlApp: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '2';
    rlApp = (await buildServer({ logger: false })).fastify;
    await rlApp.ready();
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
  });

  afterAll(async () => {
    await rlApp.close();
    await closeSql();
  });

  it('throttles repeated 409 probes under the per-IP auth rate limit', async () => {
    const email = `${PREFIX}probe@example.com`;
    await getSql()`DELETE FROM users WHERE email = ${email}`;
    await upsertUser({
      email, displayName: null, avatarUrl: null, provider: 'google',
      providerId: `${PREFIX}google-probe`, emailVerified: true,
    });
    const ip = '203.0.113.90';

    expect((await register(rlApp, email, OWNER_PW, ip)).statusCode).toBe(409);
    expect((await register(rlApp, email, OWNER_PW, ip)).statusCode).toBe(409);
    expect((await register(rlApp, email, OWNER_PW, ip)).statusCode).toBe(429);
  });
});
