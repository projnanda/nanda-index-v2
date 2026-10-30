import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Deterministic DNS for the domain-verification step (see domain-verification.test.ts).
const { resolveTxtMock } = vi.hoisted(() => ({ resolveTxtMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({
  resolveTxt: resolveTxtMock,
  Resolver: class {
    setServers(): void {}
    resolveTxt(name: string) { return resolveTxtMock(name); }
  },
}));

import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser, wasJustCreated } from '../../src/db/queries/users.js';
import { issueAccountVerifyToken } from '../../src/db/queries/accountVerification.js';
import { captureOrgVerificationEmails } from '../helpers/orgVerificationEmails.js';

const EMAIL_PREFIX = 'analytics-events-';
const ORG_ID = 'ae-org';

async function cleanUp(): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM org_memberships WHERE org_id LIKE 'ae-%'`;
  await sql`DELETE FROM organizations WHERE org_id LIKE 'ae-%'`;
  await sql`DELETE FROM users WHERE email LIKE ${EMAIL_PREFIX + '%'}`;
}

describe('Analytics events from account and entry routes', () => {
  let fastify: FastifyInstance;
  let capture: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
    await cleanUp();
  });

  afterAll(async () => {
    await cleanUp();
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(() => {
    capture = vi.spyOn(fastify.analytics, 'capture');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every property sent so far, flattened, for the "no personal data" checks. */
  function sentPayloads(): string {
    return JSON.stringify(capture.mock.calls);
  }

  it('counts an email sign-up, but not a rejected duplicate', async () => {
    const payload = { email: `${EMAIL_PREFIX}signup@example.com`, password: 'correct-horse-battery' };

    const first = await fastify.inject({ method: 'POST', url: '/auth/register', payload });
    const duplicate = await fastify.inject({ method: 'POST', url: '/auth/register', payload });

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(capture.mock.calls).toEqual([['user_signed_up', { method: 'email' }]]);
    expect(sentPayloads()).not.toContain('example.com');
  });

  it('tells a fresh OAuth upsert from a returning sign-in', async () => {
    const params = {
      email: `${EMAIL_PREFIX}oauth@example.com`,
      displayName: null,
      avatarUrl: null,
      provider: 'github' as const,
      providerId: 'analytics-events-oauth',
    };

    expect(wasJustCreated(await upsertUser(params))).toBe(true);
    expect(wasJustCreated(await upsertUser(params))).toBe(false);
  });

  it('counts an account verification, but not a bad token', async () => {
    const user = await upsertUser({
      email: `${EMAIL_PREFIX}verify@example.com`, displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'analytics-events-verify', emailVerified: false,
    });
    const token = await issueAccountVerifyToken(user.id);

    const bad = await fastify.inject({ method: 'POST', url: '/auth/verify-account', payload: { token: 'nope' } });
    const good = await fastify.inject({ method: 'POST', url: '/auth/verify-account', payload: { token } });

    expect(bad.statusCode).toBe(400);
    expect(good.statusCode).toBe(200);
    expect(capture.mock.calls).toEqual([['account_verified']]);
  });

  it('counts an entry through registration, both verifications and deletion', async () => {
    const emails = captureOrgVerificationEmails();
    const owner = await upsertUser({
      email: `${EMAIL_PREFIX}owner@example.com`, displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'analytics-events-owner',
    });
    const headers = { authorization: `Bearer ${fastify.jwt.sign({ userId: owner.id, email: owner.email, displayName: null })}` };
    const sql = getSql();

    const created = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs', headers,
      payload: {
        org_id: ORG_ID,
        display_name: 'Analytics Events',
        domain: `${ORG_ID}.example.com`,
        contact_email: `${EMAIL_PREFIX}contact@example.com`,
        registry_url: `https://${ORG_ID}.example.com/r`,
      },
    });
    expect(created.statusCode).toBe(201);

    const [row] = await sql<{ token: string }[]>`
      SELECT verify_token AS token FROM organizations WHERE org_id = ${ORG_ID}
    `;
    const token = emails.tokenFor(ORG_ID);
    expect(row?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(row?.token).not.toBe(token);
    const emailVerified = await fastify.inject({ method: 'POST', url: '/api/v1/verify-email', payload: { token } });
    expect(emailVerified.statusCode).toBe(200);

    const challenge = await fastify.inject({ method: 'POST', url: `/api/v1/orgs/${ORG_ID}/domain-challenge`, headers });
    resolveTxtMock.mockResolvedValue([[challenge.json().record_value]]);
    const domainVerified = await fastify.inject({ method: 'POST', url: `/api/v1/orgs/${ORG_ID}/verify-domain`, headers });
    expect(domainVerified.statusCode).toBe(200);

    const deleted = await fastify.inject({ method: 'DELETE', url: `/api/v1/orgs/${ORG_ID}`, headers });
    expect(deleted.statusCode).toBe(204);

    expect(capture.mock.calls).toEqual([
      ['entry_registered', { hosting_path: 'registry', has_domain: true, media_type: expect.any(String) }],
      ['entry_email_verified', { has_domain: true }],
      ['entry_domain_verified'],
      ['entry_deleted'],
    ]);
    expect(sentPayloads()).not.toContain(ORG_ID);
    expect(sentPayloads()).not.toContain('example.com');
  });
});
