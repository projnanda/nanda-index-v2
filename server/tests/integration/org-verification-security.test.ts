import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';
import { captureOrgVerificationEmails } from '../helpers/orgVerificationEmails.js';

const PREFIX = 'ovs-';
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

describe('organization verification security', () => {
  let app: FastifyInstance;
  let headers: { authorization: string };
  let emails: ReturnType<typeof captureOrgVerificationEmails>;
  const apps: FastifyInstance[] = [];

  async function makeApp(max = '1000', proxyHops = '0', window = '1 minute') {
    vi.stubEnv('AUTH_RATE_LIMIT_MAX', max);
    vi.stubEnv('AUTH_RATE_LIMIT_WINDOW', window);
    vi.stubEnv('TRUST_PROXY_HOPS', proxyHops);
    const server = (await buildServer({ logger: false })).fastify;
    apps.push(server);
    await server.ready();
    return server;
  }

  const verify = (token: unknown, server = app, ip = '198.51.100.10', extraHeaders = {}) =>
    server.inject({ method: 'POST', url: '/api/v1/verify-email', remoteAddress: ip,
      headers: extraHeaders, payload: { token } });

  async function create(name: string, domain?: string, contactEmail = `${PREFIX + name}@example.org`) {
    const orgId = PREFIX + name;
    const response = await app.inject({ method: 'POST', url: '/api/v1/orgs', headers,
      payload: { org_id: orgId, display_name: name, hosting_path: domain ? 'registry' : 'personal',
        ...(domain ? { domain } : {}), contact_email: contactEmail,
        registry_url: 'https://cards.example.org/card.json' } });
    expect(response.statusCode).toBe(201);
    return { orgId, token: emails.tokenFor(orgId), response };
  }

  async function row(orgId: string) {
    const [record] = await getSql()`SELECT * FROM organizations WHERE org_id = ${orgId}`;
    return record!;
  }

  beforeEach(async () => {
    vi.stubEnv('SMTP_URL', 'log');
    emails = captureOrgVerificationEmails();
    app = await makeApp();
    await getSql()`DELETE FROM organizations WHERE org_id LIKE ${PREFIX + '%'}`;
    const owner = await upsertUser({ email: 'ovs-owner@example.org', displayName: 'Owner',
      avatarUrl: null, provider: 'google', providerId: 'ovs-owner', emailVerified: true });
    headers = { authorization: `Bearer ${app.jwt.sign({ userId: owner.id, email: owner.email, displayName: null })}` };
  });

  afterEach(async () => {
    await getSql()`DELETE FROM organizations WHERE org_id LIKE ${PREFIX + '%'}`;
    await getSql()`DELETE FROM users WHERE email = 'ovs-owner@example.org'`;
    emails.restore();
    for (const server of apps.splice(0)) await server.close();
    await closeSql();
    vi.unstubAllEnvs();
  });

  it('stores only a digest, verifies the emailed token, and resolves the published entry', async () => {
    const entry = await create('lifecycle');
    const stored = await row(entry.orgId);
    expect(stored.verifyToken).toBe(digest(entry.token));
    expect(stored.verifyToken).not.toBe(entry.token);
    const privateRecord = await app.inject({ method: 'GET', url: `/api/v1/orgs/${entry.orgId}`, headers });
    for (const response of [entry.response, privateRecord]) {
      expect(response.body).not.toContain(entry.token);
      expect(response.body).not.toContain(stored.verifyToken);
    }
    expect((await verify(stored.verifyToken)).statusCode).toBe(404);
    const confirmed = await verify(entry.token);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: 'active', email_verified: true });
    expect(confirmed.body).not.toContain(entry.token);
    expect(confirmed.body).not.toContain(stored.verifyToken);
    expect(await row(entry.orgId)).toMatchObject({ verifyToken: null, verifyTokenExpiresAt: null });
    const resolved = await app.inject({ method: 'GET',
      url: `/api/v1/resolve?locator=${encodeURIComponent(stored.identifier)}` });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().entry.extensions['org.projectnanda'].emailVerified).toBe(true);
    expect((await verify(entry.token)).statusCode).toBe(404);
  });

  it('keeps domain verification as the activation gate', async () => {
    const entry = await create('domain', 'ovs-domain.example.org');
    const response = await verify(entry.token);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'pending', email_verified: true, domain_verified: false });
  });

  it('does not reactivate a suspended entry when email is verified', async () => {
    const entry = await create('suspended');
    await getSql()`UPDATE organizations SET status = 'suspended' WHERE org_id = ${entry.orgId}`;
    expect((await verify(entry.token)).json().status).toBe('suspended');
  });

  it('rejects an expired token without changing ownership or publication', async () => {
    const entry = await create('expired');
    await getSql()`UPDATE organizations SET verify_token_expires_at = NOW() - INTERVAL '1 second' WHERE org_id = ${entry.orgId}`;
    expect((await verify(entry.token)).statusCode).toBe(404);
    expect(await row(entry.orgId)).toMatchObject({ emailVerified: false, status: 'pending', verifyToken: digest(entry.token) });
  });

  it('replaces the hash on resend, rejects the old link, and preserves the cooldown', async () => {
    const entry = await create('resend');
    await getSql()`UPDATE organizations SET verify_token_expires_at = NOW() + INTERVAL '23 hours' WHERE org_id = ${entry.orgId}`;
    const resend = () => app.inject({ method: 'POST', url: `/api/v1/orgs/${entry.orgId}/resend-verification`, headers });
    expect((await resend()).statusCode).toBe(200);
    const replacement = emails.tokenFor(entry.orgId);
    expect(replacement).not.toBe(entry.token);
    expect((await row(entry.orgId)).verifyToken).toBe(digest(replacement));
    expect((await resend()).statusCode).toBe(429);
    expect((await verify(entry.token)).statusCode).toBe(404);
    expect((await verify(digest(replacement))).statusCode).toBe(404);
    expect((await verify(replacement)).statusCode).toBe(200);
    expect((await resend()).statusCode).toBe(409);
  });

  it('consumes one token exactly once under concurrent submissions', async () => {
    const entry = await create('concurrent');
    const responses = await Promise.all(Array.from({ length: 8 }, () => verify(entry.token)));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 404)).toHaveLength(7);
  });

  it('allows only one competing personal identity claim to win concurrently', async () => {
    const first = await create('claim-one', undefined, 'ovs-shared@example.org');
    const second = await create('claim-two', undefined, 'ovs-shared@example.org');
    const responses = await Promise.all([verify(first.token), verify(second.token)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 404]);
    const survivors = await getSql()`SELECT * FROM organizations WHERE contact_email = 'ovs-shared@example.org'`;
    expect(survivors).toHaveLength(1);
    expect(survivors[0]).toMatchObject({ status: 'active', emailVerified: true, verifyToken: null });
  });

  it('permits immediate resend after migration clears an outstanding legacy link', async () => {
    const entry = await create('migrated');
    await getSql()`UPDATE organizations SET verify_token = NULL, verify_token_expires_at = NULL WHERE org_id = ${entry.orgId}`;
    expect((await verify(entry.token)).statusCode).toBe(404);
    const resent = await app.inject({ method: 'POST', url: `/api/v1/orgs/${entry.orgId}/resend-verification`, headers });
    expect(resent.statusCode).toBe(200);
    const replacement = emails.tokenFor(entry.orgId);
    expect((await row(entry.orgId)).verifyToken).toBe(digest(replacement));
    expect((await verify(replacement)).statusCode).toBe(200);
  });

  it('allows only one concurrent resend and invalidates the original link', async () => {
    const entry = await create('resend-race');
    await getSql()`UPDATE organizations SET verify_token_expires_at = NOW() + INTERVAL '23 hours' WHERE org_id = ${entry.orgId}`;
    const responses = await Promise.all(Array.from({ length: 4 }, () => app.inject({
      method: 'POST', url: `/api/v1/orgs/${entry.orgId}/resend-verification`, headers,
    })));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(3);
    expect((await verify(entry.token)).statusCode).toBe(404);
    expect((await verify(emails.tokenFor(entry.orgId))).statusCode).toBe(200);
  });

  it('rejects injected, altered, truncated and foreign tokens without verifying another entry', async () => {
    const first = await create('first');
    const second = await create('second');
    for (const token of ["' OR 1=1 --", first.token.slice(1), first.token + '00', first.token.toUpperCase(), ' ' + first.token]) {
      expect((await verify(token)).statusCode).toBe(404);
    }
    expect((await verify(first.token)).statusCode).toBe(200);
    expect(await row(second.orgId)).toMatchObject({ emailVerified: false, status: 'pending', verifyToken: digest(second.token) });
  });

  it.each([null, {}, [], '', 'a'.repeat(129)])('rejects malformed token %j', async (token) => {
    expect((await verify(token)).statusCode).toBe(400);
  });

  it('GET and HEAD link scanners do not consume a token', async () => {
    const entry = await create('scanner');
    for (const method of ['GET', 'HEAD'] as const) {
      expect((await app.inject({ method, url: `/api/v1/verify-email?token=${entry.token}` })).statusCode).toBe(302);
    }
    expect((await row(entry.orgId)).verifyToken).toBe(digest(entry.token));
    expect((await verify(entry.token)).statusCode).toBe(200);
  });

  it('throttles rotating tokens and spoofed forwarding headers without consuming a valid token', async () => {
    const entry = await create('throttled');
    const limited = await makeApp('2');
    expect((await verify('bad-one', limited, '198.51.100.1', { 'x-forwarded-for': '203.0.113.1' })).statusCode).toBe(404);
    expect((await verify('bad-two', limited, '198.51.100.1', { 'x-forwarded-for': '203.0.113.2' })).statusCode).toBe(404);
    const blocked = await verify(entry.token, limited, '198.51.100.1', { 'x-forwarded-for': '203.0.113.3' });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json().error).toMatch(/rate limit exceeded/i);
    expect(blocked.body).not.toContain(entry.token);
    expect(await row(entry.orgId)).toMatchObject({ verifyToken: digest(entry.token), emailVerified: false });
    expect((await verify(entry.token, limited, '198.51.100.2')).statusCode).toBe(200);
  });

  it('counts malformed requests against the same IP allowance', async () => {
    const limited = await makeApp('2');
    expect((await verify({}, limited)).statusCode).toBe(400);
    expect((await verify('', limited)).statusCode).toBe(400);
    expect((await verify('another-token', limited)).statusCode).toBe(429);
  });

  it('isolates visitors behind the configured proxy and ignores attacker-prepended IPs', async () => {
    const limited = await makeApp('2', '1');
    const hit = (forwarded: string) => verify('invalid', limited, '172.18.0.2', { 'x-forwarded-for': forwarded });
    expect((await hit('203.0.113.1, 198.51.100.1')).statusCode).toBe(404);
    expect((await hit('203.0.113.2, 198.51.100.1')).statusCode).toBe(404);
    expect((await hit('203.0.113.3, 198.51.100.1')).statusCode).toBe(429);
    expect((await hit('198.51.100.2')).statusCode).toBe(404);
  });

  it('accepts a previously throttled valid token after the configured window expires', async () => {
    const entry = await create('window');
    const limited = await makeApp('1', '0', '100 milliseconds');
    expect((await verify('invalid', limited)).statusCode).toBe(404);
    expect((await verify(entry.token, limited)).statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await verify(entry.token, limited)).statusCode).toBe(200);
  });

  it('does not let GET requests consume the POST allowance', async () => {
    const entry = await create('get-budget');
    const limited = await makeApp('1');
    await limited.inject({ method: 'GET', url: `/api/v1/verify-email?token=${entry.token}`, remoteAddress: '198.51.100.10' });
    expect((await verify(entry.token, limited)).statusCode).toBe(200);
  });
});
