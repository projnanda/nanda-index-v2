import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';

const TAG = 'wombatstats';

async function seedOrg(orgId: string): Promise<void> {
  const sql = getSql();
  const domain = `${orgId}.example.com`;
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token,
       email_verified, domain_verified, status, identifier, media_type, tags)
    VALUES
      (${orgId}, ${`Stats ${orgId}`}, ${domain}, ${`admin@${domain}`},
       ${`https://${domain}/card`}, ${randomBytes(16).toString('hex')},
       true, true, 'active', ${`urn:air:${domain}:agent:main`},
       'application/a2a-agent-card+json', ${sql.array([TAG])})
  `;
}

// Every other suite runs with INDEX_STATS_CACHE_SECONDS=0 (tests/setup.ts) so
// counts reflect rows they just inserted. This one turns the cache on.
describe('Index total and ARD facets with the stats cache on', () => {
  let fastify: FastifyInstance;
  const originalTtl = process.env['INDEX_STATS_CACHE_SECONDS'];

  beforeAll(async () => {
    process.env['INDEX_STATS_CACHE_SECONDS'] = '60';
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();
  });

  afterAll(async () => {
    process.env['INDEX_STATS_CACHE_SECONDS'] = originalTtl;
    await fastify.close();
    await getSql()`DELETE FROM organizations WHERE org_id LIKE 'stats-%'`;
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    await getSql()`DELETE FROM organizations WHERE org_id LIKE 'stats-%'`;
  });

  it('reuses X-Total-Count within the TTL while the page itself stays live', async () => {
    await seedOrg('stats-a');
    const before = await fastify.inject({ method: 'GET', url: '/api/v1/index?limit=500' });

    await seedOrg('stats-b');
    const after = await fastify.inject({ method: 'GET', url: '/api/v1/index?limit=500' });

    expect(after.headers['x-total-count']).toBe(before.headers['x-total-count']);
    const orgIds = (after.json() as Array<{ extensions: Record<string, { orgId: string }> }>)
      .map((e) => e.extensions['org.projectnanda']!.orgId);
    expect(orgIds).toContain('stats-b');
  });

  it('reuses ARD facet counts within the TTL', async () => {
    const explore = () => fastify.inject({
      method: 'POST', url: '/api/ard/explore',
      payload: { resultType: { facets: [{ field: 'type' }, { field: 'tags' }] } },
    });
    const tagCount = (res: Awaited<ReturnType<typeof explore>>) =>
      res.json().facets.tags.buckets.find((b: { value: string }) => b.value === TAG)?.count;

    await seedOrg('stats-a');
    const before = await explore();
    expect(tagCount(before)).toBe(1);

    await seedOrg('stats-b');
    const after = await explore();
    expect(tagCount(after)).toBe(1);
    expect(after.json().facets.type).toEqual(before.json().facets.type);
  });
});
