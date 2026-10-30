import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { closeSql, getSql } from '../../src/db/client.js';
import {
  deleteOrganization,
  markDomainVerified,
  updateOrganization,
} from '../../src/db/queries/organizations.js';

const orgId = 'trust-contract-catalog';
const domain = 'trust-contract.example.test';
const identifier = `urn:air:${domain}:catalog:root`;

describe('ownership changes across public resolution paths', () => {
  let server: FastifyInstance;

  const read = (locator: string) => server.inject({
    method: 'GET', url: `/api/v1/resolve?locator=${encodeURIComponent(locator)}`,
  });

  async function expectVisibility(status: number): Promise<void> {
    const direct = await server.inject({ method: 'GET', url: `/api/v1/index/${orgId}` });
    const exact = await read(identifier);
    const publisher = await read(`urn:air:${domain}:agent:orders`);
    for (const response of [direct, exact, publisher]) expect(response.statusCode).toBe(status);
    if (status === 200) {
      expect(exact.json()).toMatchObject({ locator: identifier, match: 'exact', entry: { identifier } });
      expect(publisher.json()).toMatchObject({
        locator: `urn:air:${domain}:agent:orders`, match: 'publisher', entry: { identifier },
      });
    }
  }

  beforeAll(async () => {
    server = (await buildServer({ logger: false })).fastify;
    await server.ready();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id = ${orgId}`;
    await sql`
      INSERT INTO organizations
        (org_id, display_name, domain, contact_email, registry_url, verify_token,
         email_verified, domain_verified, ever_proven, status, identifier, media_type)
      VALUES
        (${orgId}, 'Trust contract fixture', ${domain}, 'admin@example.test',
         'https://trust-contract.example.test/catalog.json', 'test-only',
         true, true, true, 'active', ${identifier}, 'application/ai-catalog+json')
    `;
  });

  afterAll(async () => {
    try {
      await getSql()`DELETE FROM organizations WHERE org_id = ${orgId}`;
    } finally {
      await server.close();
      await closeSql();
    }
  });

  it('stops direct, exact and publisher reads after proof loss; restores them after reproof', async () => {
    await expectVisibility(200);
    await getSql()`UPDATE organizations SET domain_verified = false WHERE org_id = ${orgId}`;
    await expectVisibility(404);
    await markDomainVerified(orgId);
    await expectVisibility(200);
  });

  it.each(['suspended', 'takedown'] as const)('reproof preserves %s across every read path', async (restriction) => {
    const sql = getSql();
    if (restriction === 'suspended') {
      await sql`UPDATE organizations SET status = 'suspended', domain_verified = false WHERE org_id = ${orgId}`;
    } else {
      await sql`UPDATE organizations SET moderation = 'takedown', domain_verified = false WHERE org_id = ${orgId}`;
    }
    await expectVisibility(404);
    const verified = await markDomainVerified(orgId);
    expect(verified?.domainVerified).toBe(true);
    if (restriction === 'suspended') expect(verified?.status).toBe('suspended');
    else expect(verified?.moderation).toBe('takedown');
    await expectVisibility(404);
  });

  it('keeps a hidden but proven entry resolvable after reproof', async () => {
    await getSql()`UPDATE organizations SET moderation = 'hidden', domain_verified = false WHERE org_id = ${orgId}`;
    await expectVisibility(404);
    await markDomainVerified(orgId);
    await expectVisibility(200);
  });

  it('domain replacement invalidates the previous proof before either domain resolves', async () => {
    await expectVisibility(200);
    const nextDomain = 'trust-contract-new.example.test';
    const nextIdentifier = `urn:air:${nextDomain}:catalog:root`;
    const updated = await updateOrganization(orgId, { domain: nextDomain, identifier: nextIdentifier });
    expect(updated).toMatchObject({ domainVerified: false, status: 'pending', domainVerifiedAt: null });
    await expectVisibility(404);
    expect((await read(nextIdentifier)).statusCode).toBe(404);
    expect((await read(`urn:air:${nextDomain}:agent:orders`)).statusCode).toBe(404);
  });

  it('deletion removes an already resolved registration from every live read path', async () => {
    await expectVisibility(200);
    expect(await deleteOrganization(orgId)).toBe(true);
    await expectVisibility(404);
  });
});
