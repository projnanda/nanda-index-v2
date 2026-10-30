import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';
import {
  listCatalogsToProbe,
  listOrganizationsPaged,
  rankOrganizationsForQuery,
  searchOrganizations,
} from '../../src/db/queries/organizations.js';
import { ENTERPRISE_MEDIA_TYPE as ENTERPRISE } from '../../src/lib/mediaTypes.js';

const OPERATOR_EMAIL = 'mod-operator@example.com';
const PASSWORD_OPERATOR_EMAIL = 'mod-pw-operator@example.com';
const UNVERIFIED_OAUTH_OPERATOR_EMAIL = 'mod-unverified-operator@example.com';

async function seedOrg(
  orgId: string,
  opts: { moderation?: 'none' | 'hidden' | 'takedown'; mediaType?: string; tags?: string[]; status?: string } = {},
): Promise<string> {
  const sql = getSql();
  const domain = `${orgId}.example.com`;
  const identifier = `urn:air:${domain}:catalog:root`;
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url, verify_token,
       email_verified, domain_verified, status, identifier, media_type, description, tags, moderation)
    VALUES
      (${orgId}, ${`Moderated ${orgId}`}, ${domain}, ${`admin@${domain}`},
       ${`https://${domain}/registry`}, ${randomBytes(16).toString('hex')},
       true, true, ${opts.status ?? 'active'}, ${identifier},
       ${opts.mediaType ?? 'application/ai-catalog+json'},
       'zanzibarmoderation widgets', ${sql.array(opts.tags ?? ['zanzibarmod'])},
       ${opts.moderation ?? 'none'})
  `;
  return identifier;
}

async function addAdmin(orgId: string, userId: string): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${userId}, ${orgId}, 'admin')`;
}

describe('Operator moderation (hidden / takedown)', () => {
  let fastify: FastifyInstance;
  let operatorToken: string;
  let ownerToken: string;
  let ownerId: string;
  let passwordOperatorToken: string;
  let unverifiedOAuthOperatorToken: string;

  beforeAll(async () => {
    process.env['ADMIN_EMAILS'] = `someone-else@example.com, ${OPERATOR_EMAIL.toUpperCase()},${PASSWORD_OPERATOR_EMAIL},${UNVERIFIED_OAUTH_OPERATOR_EMAIL}`;
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    const operator = await upsertUser({
      email: OPERATOR_EMAIL, displayName: 'Op', avatarUrl: null, provider: 'google', providerId: 'mod-operator-pid',
      emailVerified: true,
    });
    operatorToken = fastify.jwt.sign({ userId: operator.id, email: operator.email, displayName: null });

    const owner = await upsertUser({
      email: 'mod-owner@example.com', displayName: 'Owner', avatarUrl: null, provider: 'github', providerId: 'mod-owner-pid',
      emailVerified: true,
    });
    ownerId = owner.id;
    ownerToken = fastify.jwt.sign({ userId: owner.id, email: owner.email, displayName: null });

    // A password account on an operator email: password sign-up never proves
    // the address, so such an account must not count as an operator.
    const sql = getSql();
    await sql`DELETE FROM users WHERE email = ${PASSWORD_OPERATOR_EMAIL}`;
    const [pw] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, provider, provider_id, password_hash)
      VALUES (${PASSWORD_OPERATOR_EMAIL}, 'Pw', 'email', ${PASSWORD_OPERATOR_EMAIL}, 'x')
      RETURNING id
    `;
    passwordOperatorToken = fastify.jwt.sign({ userId: pw!.id, email: PASSWORD_OPERATOR_EMAIL, displayName: null });

    // An OAuth account whose provider did not verify the address (#36): it
    // proves nothing about the email either, so it is not an operator.
    const unverified = await upsertUser({
      email: UNVERIFIED_OAUTH_OPERATOR_EMAIL, displayName: null, avatarUrl: null,
      provider: 'github', providerId: 'mod-unverified-operator-pid', emailVerified: false,
    });
    unverifiedOAuthOperatorToken = fastify.jwt.sign({ userId: unverified.id, email: unverified.email, displayName: null });
  });

  afterAll(async () => {
    delete process.env['ADMIN_EMAILS'];
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id LIKE 'mod-%'`;
  });

  // ── hidden ────────────────────────────────────────────────────────────────

  it('hidden entries are left out of every listing and search', async () => {
    await seedOrg('mod-visible', { mediaType: ENTERPRISE });
    await seedOrg('mod-hidden', { moderation: 'hidden', mediaType: ENTERPRISE });

    const list = await fastify.inject({ method: 'GET', url: '/api/v1/index?limit=500' });
    const listed = (list.json() as Array<{ extensions: Record<string, { orgId?: string }> }>)
      .map((e) => e.extensions['org.projectnanda']?.orgId);
    expect(listed).toContain('mod-visible');
    expect(listed).not.toContain('mod-hidden');

    const search = await fastify.inject({ method: 'GET', url: '/api/v1/search?q=mod-hidden' });
    expect(search.json().count).toBe(0);
    expect((await searchOrganizations('mod-')).map((o) => o.orgId)).not.toContain('mod-hidden');

    const ranked = await rankOrganizationsForQuery('zanzibarmoderation', 50);
    expect(ranked.map((o) => o.orgId)).toContain('mod-visible');
    expect(ranked.map((o) => o.orgId)).not.toContain('mod-hidden');

    const probed = await listCatalogsToProbe([], 500);
    expect(probed.map((o) => o.orgId)).not.toContain('mod-hidden');

    const paged = await listOrganizationsPaged(500, null, { field: 'tags', values: ['zanzibarmod'] });
    expect(paged.rows.map((o) => o.orgId)).toEqual(['mod-visible']);

    const explore = await fastify.inject({
      method: 'POST', url: '/api/ard/explore',
      payload: { resultType: { facets: [{ field: 'tags' }] } },
    });
    const bucket = explore.json().facets.tags.buckets.find((b: { value: string }) => b.value === 'zanzibarmod');
    expect(bucket.count).toBe(1);
  });

  it('hidden entries still resolve by exact identifier and are readable by org_id', async () => {
    const identifier = await seedOrg('mod-hidden', { moderation: 'hidden' });

    const resolved = await fastify.inject({
      method: 'GET', url: `/api/v1/resolve?locator=${encodeURIComponent(identifier)}`,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().entry.identifier).toBe(identifier);

    const read = await fastify.inject({ method: 'GET', url: '/api/v1/index/mod-hidden' });
    expect(read.statusCode).toBe(200);
  });

  // ── takedown ──────────────────────────────────────────────────────────────

  it('takedown entries are neither resolvable nor readable publicly', async () => {
    const identifier = await seedOrg('mod-gone', { moderation: 'takedown' });

    const resolved = await fastify.inject({
      method: 'GET', url: `/api/v1/resolve?locator=${encodeURIComponent(identifier)}`,
    });
    expect(resolved.statusCode).toBe(404);

    const read = await fastify.inject({ method: 'GET', url: '/api/v1/index/mod-gone' });
    expect(read.statusCode).toBe(404);

    const urnSearch = await fastify.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(identifier)}` });
    expect(urnSearch.json().count).toBe(0);
  });

  it('the owner still sees a taken-down org, with its moderation state', async () => {
    await seedOrg('mod-gone', { moderation: 'takedown' });
    await addAdmin('mod-gone', ownerId);

    const res = await fastify.inject({
      method: 'GET', url: '/api/v1/orgs/mod-gone', headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().moderation).toBe('takedown');
  });

  it('the owner cannot reactivate or suspend-toggle a taken-down org', async () => {
    await seedOrg('mod-gone', { moderation: 'takedown', status: 'suspended' });
    await addAdmin('mod-gone', ownerId);
    const headers = { authorization: `Bearer ${ownerToken}` };

    const reactivate = await fastify.inject({ method: 'POST', url: '/api/v1/orgs/mod-gone/reactivate', headers });
    expect(reactivate.statusCode).toBe(403);
    expect(reactivate.json().error).toBe('MODERATED');

    const suspend = await fastify.inject({ method: 'DELETE', url: '/api/v1/orgs/mod-gone/suspend', headers });
    expect(suspend.statusCode).toBe(403);
    expect(suspend.json().error).toBe('MODERATED');

    const sql = getSql();
    const [row] = await sql<{ status: string }[]>`SELECT status FROM organizations WHERE org_id = 'mod-gone'`;
    expect(row!.status).toBe('suspended');
  });

  // ── admin routes ──────────────────────────────────────────────────────────

  it('an operator can set moderation on a single org', async () => {
    await seedOrg('mod-one');

    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/admin/orgs/mod-one/moderation',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { moderation: 'hidden' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ org_id: 'mod-one', moderation: 'hidden' });

    const missing = await fastify.inject({
      method: 'POST', url: '/api/v1/admin/orgs/mod-nope/moderation',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { moderation: 'hidden' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects an unknown moderation value', async () => {
    await seedOrg('mod-one');
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/admin/orgs/mod-one/moderation',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { moderation: 'deleted' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bulk moderation hits exactly the org_id prefix', async () => {
    await seedOrg('mod-mbox-1');
    await seedOrg('mod-mbox-2');
    await seedOrg('mod-mboxer');

    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/admin/orgs/moderation-bulk',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { org_id_prefix: 'mod-mbox-', moderation: 'hidden' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);
    expect([...res.json().org_ids].sort()).toEqual(['mod-mbox-1', 'mod-mbox-2']);

    const sql = getSql();
    const rows = await sql<{ orgId: string; moderation: string }[]>`
      SELECT org_id, moderation FROM organizations WHERE org_id LIKE 'mod-mbox%' ORDER BY org_id
    `;
    expect(rows.map((r) => [r.orgId, r.moderation])).toEqual([
      ['mod-mbox-1', 'hidden'], ['mod-mbox-2', 'hidden'], ['mod-mboxer', 'none'],
    ]);
  });

  it('bulk moderation refuses a too-short prefix', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/admin/orgs/moderation-bulk',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { org_id_prefix: 'm', moderation: 'hidden' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('non-operators get 403 on admin routes, anonymous callers 401', async () => {
    await seedOrg('mod-one');
    await addAdmin('mod-one', ownerId);

    for (const token of [ownerToken, passwordOperatorToken, unverifiedOAuthOperatorToken]) {
      const single = await fastify.inject({
        method: 'POST', url: '/api/v1/admin/orgs/mod-one/moderation',
        headers: { authorization: `Bearer ${token}` },
        payload: { moderation: 'none' },
      });
      expect(single.statusCode).toBe(403);
      const bulk = await fastify.inject({
        method: 'POST', url: '/api/v1/admin/orgs/moderation-bulk',
        headers: { authorization: `Bearer ${token}` },
        payload: { org_id_prefix: 'mod-', moderation: 'none' },
      });
      expect(bulk.statusCode).toBe(403);
    }

    const anon = await fastify.inject({
      method: 'POST', url: '/api/v1/admin/orgs/mod-one/moderation', payload: { moderation: 'none' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('owners cannot clear moderation through PUT', async () => {
    await seedOrg('mod-one', { moderation: 'hidden' });
    await addAdmin('mod-one', ownerId);
    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/mod-one',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { moderation: 'none' },
    });
    expect(res.statusCode).toBe(400);
  });
});
