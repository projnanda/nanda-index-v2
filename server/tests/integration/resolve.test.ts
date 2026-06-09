import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';

async function seedOrg(orgId: string, domain: string, registryUrl: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM organizations WHERE org_id = ${orgId} OR domain = ${domain}`;
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token, email_verified, status)
    VALUES
      (${orgId}, ${orgId}, ${domain}, ${`admin@${domain}`},
       ${registryUrl}, 'tok', true, 'active')
  `;
}

describe('GET /api/v1/resolve — NANDA Index lookup', () => {
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
    await sql`DELETE FROM organizations WHERE org_id LIKE 'res-%'`;
  });

  it('resolves a URN locator and returns identifier + IndexRecord', async () => {
    await seedOrg('res-nasiko', 'nasiko.com', 'https://registry.nasiko.com');

    const locator = encodeURIComponent('urn:ai:nasiko.com:ankit');
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/v1/resolve?locator=${locator}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.locator).toBe('urn:ai:nasiko.com:ankit');
    expect(body.identifier).toBe('ankit');
    expect(body.index_record.org_id).toBe('res-nasiko');
    expect(body.index_record.registry_url).toBe('https://registry.nasiko.com');
  });

  it('resolves by org_id slug when no domain match', async () => {
    await seedOrg('res-slug', 'slug.example.com', 'https://registry.slug.example.com');

    const locator = encodeURIComponent('urn:ai:res-slug:bot');
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/v1/resolve?locator=${locator}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.identifier).toBe('bot');
    expect(body.index_record.org_id).toBe('res-slug');
  });

  it('returns 404 when org is not in the index', async () => {
    const locator = encodeURIComponent('urn:ai:unknown.example.com:agent');
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/v1/resolve?locator=${locator}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('returns 400 when locator query param is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/resolve' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when locator format is invalid (old @ format)', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/resolve?locator=ankit%40nasiko.com%3Aglobal',
    });
    expect(res.statusCode).toBe(400);
  });
});
