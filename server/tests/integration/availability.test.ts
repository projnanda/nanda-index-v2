import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

/** Registers a domain-based org via the API (it stays pending). */
async function register(fastify: FastifyInstance, token: string, orgId: string, domain: string) {
  return fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      org_id:        orgId,
      display_name:  'Availability Test',
      domain,
      contact_email: `admin@${domain}`,
      registry_url:  `https://${domain}/registry`,
    },
  });
}

/** Marks a registered org's domain proven, as a passed DNS check would. */
async function prove(orgId: string): Promise<void> {
  await getSql()`
    UPDATE organizations SET domain_verified = TRUE, ever_proven = TRUE, status = 'active'
    WHERE org_id = ${orgId}
  `;
}

async function signedInUser(fastify: FastifyInstance, name: string): Promise<string> {
  const user = await upsertUser({
    email:       `${name}@example.com`,
    displayName: name,
    avatarUrl:   null,
    provider:    'google',
    providerId:  `${name}-provider-id`,
    emailVerified: true,
  });
  return fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
}

describe('GET /api/v1/availability — step-1 conflict check', () => {
  let fastify: FastifyInstance;
  let rlApp: FastifyInstance; // tiny rate limit
  let token: string;
  let otherToken: string;

  const check = (query: string, auth = true) => fastify.inject({
    method: 'GET', url: `/api/v1/availability?${query}`,
    headers: auth ? { authorization: `Bearer ${token}` } : {},
  });

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '1000';
    fastify = (await buildServer({ logger: false })).fastify;
    await fastify.ready();

    process.env.AUTH_RATE_LIMIT_MAX = '2';
    rlApp = (await buildServer({ logger: false })).fastify;
    await rlApp.ready();

    token      = await signedInUser(fastify, 'availability-test');
    otherToken = await signedInUser(fastify, 'availability-other');
  });

  afterAll(async () => {
    await fastify.close();
    await rlApp.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM org_memberships WHERE org_id LIKE 'avail-%'`;
    await sql`DELETE FROM organizations WHERE org_id LIKE 'avail-%'`;
  });

  it('requires authentication', async () => {
    const res = await check('domain=free.example.com', false);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when neither org_id nor domain is given', async () => {
    const res = await check('');
    expect(res.statusCode).toBe(400);
  });

  it('reports a free org_id and domain as available', async () => {
    const res = await check('org_id=avail-free&domain=avail-free.example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ org_id_available: true, domain_available: true });
  });

  it('reports only the fields that were asked about', async () => {
    const res = await check('domain=avail-only.example.com');
    expect(res.json()).toEqual({ domain_available: true });
  });

  // Unproven claims reserve nothing (#30): a pending registration keeps its
  // org_id slug for the hold period, but does not block its domain.
  it('reports a pending holder\'s org_id as taken but its unproven domain as free', async () => {
    await register(fastify, token, 'avail-held', 'avail-held.example.com');

    const res = await check('org_id=avail-held&domain=avail-held.example.com');
    expect(res.json()).toEqual({ org_id_available: false, domain_available: true });
  });

  it('reports a domain held by a proven org as taken', async () => {
    await register(fastify, token, 'avail-proven', 'avail-proven.example.com');
    await prove('avail-proven');

    const res = await check('domain=avail-proven.example.com');
    expect(res.json()).toEqual({ domain_available: false });
  });

  it('matches domains case-insensitively, as registration does', async () => {
    await register(fastify, token, 'avail-case', 'avail-case.example.com');
    await prove('avail-case');

    const res = await check('domain=AVAIL-Case.Example.com');
    expect(res.json()).toEqual({ domain_available: false });
  });

  it('reports an org_id held by an abandoned unproven claim as free, as registration does', async () => {
    await register(fastify, token, 'avail-stale', 'avail-stale.example.com');
    await getSql()`UPDATE organizations SET created_at = NOW() - INTERVAL '30 days' WHERE org_id = 'avail-stale'`;

    expect((await check('org_id=avail-stale')).json()).toEqual({ org_id_available: true });
    expect((await register(fastify, otherToken, 'avail-stale', 'avail-stale2.example.com')).statusCode).toBe(201);
  });

  it('reports a reserved org_id as unavailable', async () => {
    const res = await check('org_id=openai');
    expect(res.json()).toEqual({ org_id_available: false });
  });

  it('agrees with registration: a domain reported taken is rejected with 409, a free one is accepted', async () => {
    await register(fastify, token, 'avail-first', 'avail-agree.example.com');
    expect((await check('domain=avail-agree.example.com')).json().domain_available).toBe(true);
    expect((await register(fastify, otherToken, 'avail-rival', 'avail-agree.example.com')).statusCode).toBe(201);

    await prove('avail-first');
    expect((await check('domain=avail-agree.example.com')).json().domain_available).toBe(false);
    expect((await register(fastify, token, 'avail-second', 'avail-agree.example.com')).statusCode).toBe(409);

    expect((await check('domain=agents.avail-agree.example.com')).json().domain_available).toBe(true);
    expect((await register(fastify, token, 'avail-third', 'agents.avail-agree.example.com')).statusCode).toBe(201);
  });

  // Behind the reverse proxy every request shares one IP, so an IP-keyed
  // limit would be a single site-wide budget.
  it('throttles per signed-in user, not per IP', async () => {
    const as = (t: string) => rlApp.inject({
      method: 'GET', url: '/api/v1/availability?domain=avail-rl.example.com',
      headers: { authorization: `Bearer ${t}` },
    });

    expect((await as(token)).statusCode).toBe(200);
    expect((await as(token)).statusCode).toBe(200);
    expect((await as(token)).statusCode).toBe(429);
    expect((await as(otherToken)).statusCode).toBe(200);
  });
});
