import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { randomBytes } from 'node:crypto';

async function seedOrg(orgId: string, domain: string, displayName: string): Promise<void> {
  const sql = getSql();
  const verifyToken = randomBytes(16).toString('hex');
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token, email_verified, status)
    VALUES
      (${orgId}, ${displayName}, ${domain}, ${`admin@${domain}`},
       ${`https://${domain}/registry`}, ${verifyToken}, true, 'active')
    ON CONFLICT (org_id) DO NOTHING
  `;
}

describe('GET /api/v1/search', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'srch-%'`;
  });

  it('returns 400 when q is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 when q is a single character', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=a' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('query_too_short');
  });

  it('returns 200 with empty results when nothing matches', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=zzznomatch' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(0);
    expect(body.results).toEqual([]);
  });

  it('finds an org by org_id prefix', async () => {
    await seedOrg('srch-alpha', 'alpha.example.com', 'Alpha Corp');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=srch-al' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].org_id).toBe('srch-alpha');
  });

  it('finds an org by domain substring', async () => {
    await seedOrg('srch-beta', 'beta.example.com', 'Beta Corp');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=beta.example' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].domain).toBe('beta.example.com');
  });

  it('finds an org by display_name substring', async () => {
    await seedOrg('srch-gamma', 'gamma.example.com', 'Gamma Industries');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=gamma ind' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.results[0].display_name).toBe('Gamma Industries');
  });

  it('response shape matches IndexRecord schema', async () => {
    await seedOrg('srch-delta', 'delta.example.com', 'Delta Org');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=srch-delta' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.query).toBe('string');
    expect(typeof body.count).toBe('number');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results[0]).toMatchObject({
      org_id: 'srch-delta',
      domain: 'delta.example.com',
      status: 'active',
      email_verified: true,
    });
  });
});
