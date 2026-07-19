import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { randomBytes } from 'node:crypto';

async function seedOrg(opts: {
  orgId: string;
  domain: string;
  displayName: string;
  description?: string;
  tags?: string[];
  mediaType?: string;
  registryUrl?: string;
}): Promise<void> {
  const sql = getSql();
  const verifyToken = randomBytes(16).toString('hex');
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token, email_verified, status,
       identifier, media_type, description, tags)
    VALUES
      (${opts.orgId}, ${opts.displayName}, ${opts.domain}, ${`admin@${opts.domain}`},
       ${opts.registryUrl ?? `https://${opts.domain}/registry`}, ${verifyToken}, true, 'active',
       ${`urn:ai:domain:${opts.domain}`},
       ${opts.mediaType ?? 'application/ai-catalog+json'},
       ${opts.description ?? null},
       ${sql.array(opts.tags ?? [])})
    ON CONFLICT (org_id) DO NOTHING
  `;
}

describe('ARD-compliant surface (/api/ard/*)', () => {
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
    await sql`DELETE FROM organizations WHERE org_id LIKE 'ard-%'`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('GET /api/ard', () => {
    it('returns a registry descriptor matching the ARD shape', async () => {
      const res = await fastify.inject({ method: 'GET', url: '/api/ard' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.specVersion).toBe('1.0');
      expect(body.endpoints.search.method).toBe('POST');
      expect(body.endpoints.search.url).toMatch(/\/api\/ard\/search$/);
      expect(body.endpoints.explore.url).toMatch(/\/api\/ard\/explore$/);
      expect(body.endpoints.agents.url).toMatch(/\/api\/ard\/agents$/);
      expect(Array.isArray(body.mediaTypes)).toBe(true);
      expect(body.capabilities.federation.modes).toEqual(['none', 'referrals', 'auto']);
      expect(body.capabilities.federation.upstreams).toEqual([]); // default mode is 'none'
    });
  });

  describe('POST /api/ard/search', () => {
    it('returns camelCase ARD-shaped results for a matching org', async () => {
      await seedOrg({
        orgId: 'ard-bakery',
        domain: 'ard-bakery.example.com',
        displayName: 'ARD Bakery',
        description: 'Order fresh sourdough bread for pickup',
        tags: ['bakery', 'bread'],
        mediaType: 'application/a2a-agent-card+json',
        registryUrl: 'https://host39.org/cards/ard-bakery',
      });

      const res = await fastify.inject({
        method: 'POST',
        url: '/api/ard/search',
        payload: { query: { text: 'sourdough bread' } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ours = body.results.find((r: { provenance: { orgId: string } }) => r.provenance.orgId === 'ard-bakery');
      expect(ours).toMatchObject({
        displayName: 'ARD Bakery',
        type: 'application/a2a-agent-card+json',
        url: 'https://host39.org/cards/ard-bakery',
      });
      expect(body.referrals).toEqual([]);
      expect(body.pageToken).toBeNull();
    });

    it('applies query.filter.type as a post-filter', async () => {
      await seedOrg({
        orgId: 'ard-bakery2',
        domain: 'ard-bakery2.example.com',
        displayName: 'ARD Bakery Two',
        description: 'Order fresh sourdough bread for pickup',
        tags: ['bakery', 'bread'],
        mediaType: 'application/a2a-agent-card+json',
      });

      const res = await fastify.inject({
        method: 'POST',
        url: '/api/ard/search',
        payload: { query: { text: 'sourdough bread', filter: { type: ['application/mcp-server-card+json'] } } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.results.some((r: { provenance: { orgId: string } }) => r.provenance.orgId === 'ard-bakery2')).toBe(false);
    });

    it('returns 400 when query.text is missing', async () => {
      const res = await fastify.inject({ method: 'POST', url: '/api/ard/search', payload: { query: {} } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/ard/explore', () => {
    it('returns org-scoped facet counts for type and tags', async () => {
      await seedOrg({
        orgId: 'ard-facet-a',
        domain: 'ard-facet-a.example.com',
        displayName: 'Facet A',
        tags: ['unique-facet-tag-a'],
      });

      const res = await fastify.inject({
        method: 'POST',
        url: '/api/ard/explore',
        payload: { resultType: { facets: [{ field: 'type' }, { field: 'tags' }] } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.resultType).toBe('facets');
      expect(body.scope).toBe('organizations');
      expect(body.facets.type.buckets.length).toBeGreaterThan(0);
      const tagBucket = body.facets.tags.buckets.find((b: { value: string }) => b.value === 'unique-facet-tag-a');
      expect(tagBucket).toMatchObject({ value: 'unique-facet-tag-a', count: 1 });
    });
  });

  describe('GET /api/ard/agents', () => {
    it('lists active orgs org-scoped, with a working tags filter', async () => {
      await seedOrg({
        orgId: 'ard-list-a',
        domain: 'ard-list-a.example.com',
        displayName: 'List A',
        tags: ['unique-list-tag'],
      });
      await seedOrg({
        orgId: 'ard-list-b',
        domain: 'ard-list-b.example.com',
        displayName: 'List B',
        tags: ['something-else'],
      });

      const res = await fastify.inject({
        method: 'GET',
        url: `/api/ard/agents?filter=${encodeURIComponent('tags:"unique-list-tag"')}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].provenance.orgId).toBe('ard-list-a');
    });

    it('paginates with pageToken, scoped by a shared tag filter to avoid cross-test interleaving', async () => {
      await seedOrg({ orgId: 'ard-page-a', domain: 'ard-page-a.example.com', displayName: 'Page A', tags: ['unique-page-tag'] });
      await seedOrg({ orgId: 'ard-page-b', domain: 'ard-page-b.example.com', displayName: 'Page B', tags: ['unique-page-tag'] });

      const filter = `filter=${encodeURIComponent('tags:"unique-page-tag"')}`;
      const first = await fastify.inject({ method: 'GET', url: `/api/ard/agents?pageSize=1&${filter}` });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json();
      expect(firstBody.items).toHaveLength(1);
      expect(firstBody.items[0].provenance.orgId).toBe('ard-page-a');
      expect(firstBody.pageToken).toBe('ard-page-a');

      const second = await fastify.inject({
        method: 'GET',
        url: `/api/ard/agents?pageSize=1&pageToken=${firstBody.pageToken}&${filter}`,
      });
      expect(second.statusCode).toBe(200);
      const secondBody = second.json();
      expect(secondBody.items).toHaveLength(1);
      expect(secondBody.items[0].provenance.orgId).toBe('ard-page-b');
      expect(secondBody.pageToken).toBeNull();
    });
  });
});
