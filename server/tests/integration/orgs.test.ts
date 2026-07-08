import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

async function makeToken(fastify: FastifyInstance, userId: string, email: string): Promise<string> {
  return fastify.jwt.sign({ userId, email, displayName: null });
}

/** Creates an org via the API as `token` (the creator becomes an admin member). */
async function createOrg(fastify: FastifyInstance, token: string, orgId: string): Promise<void> {
  await fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      org_id:        orgId,
      display_name:  'Role Test',
      domain:        `${orgId}.example.com`,
      contact_email: `a@${orgId}.com`,
      registry_url:  `https://${orgId}.example.com/r`,
    },
  });
}

/** Seeds a membership row directly (the API has no member-invite path yet). */
async function addMember(orgId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
  const sql = getSql();
  await sql`INSERT INTO org_memberships (user_id, org_id, role) VALUES (${userId}, ${orgId}, ${role})`;
}

describe('Org management routes — protected CRUD', () => {
  let fastify: FastifyInstance;
  let userId: string;
  let token: string;
  let memberUserId: string;
  let memberToken: string;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    // Seed a real user row so membership FK passes
    const user = await upsertUser({
      email:       'orgs-test@example.com',
      displayName: 'Orgs Test',
      avatarUrl:   null,
      provider:    'google',
      providerId:  'orgs-test-provider-id',
    });
    userId = user.id;
    token  = await makeToken(fastify, userId, user.email);

    // Seed a second user used to test non-admin (member-role) access
    const member = await upsertUser({
      email:       'orgs-member-test@example.com',
      displayName: 'Orgs Member Test',
      avatarUrl:   null,
      provider:    'github',
      providerId:  'orgs-member-test-provider-id',
    });
    memberUserId = member.id;
    memberToken  = await makeToken(fastify, memberUserId, member.email);
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  beforeEach(async () => {
    const sql = getSql();
    await sql`DELETE FROM org_memberships USING organizations
              WHERE org_memberships.org_id = organizations.org_id
              AND organizations.org_id LIKE 'org-%'`;
    await sql`DELETE FROM organizations WHERE org_id LIKE 'org-%'`;
  });

  // ── POST /api/v1/orgs ────────────────────────────────────────────────────────

  it('creates an org and returns 201 IndexRecord', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id:        'org-create',
        display_name:  'Create Org',
        domain:        'create.example.com',
        contact_email: 'admin@create.example.com',
        registry_url:  'https://create.example.com/registry',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.org_id).toBe('org-create');
    expect(body.status).toBe('pending');
    expect(body.email_verified).toBe(false);
  });

  it('returns 409 on duplicate org_id', async () => {
    const payload = {
      org_id:        'org-dup',
      display_name:  'Dup Org',
      domain:        'dup.example.com',
      contact_email: 'admin@dup.example.com',
      registry_url:  'https://dup.example.com/registry',
    };

    await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('CONFLICT');
  });

  it('returns 401 without token', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs',
      payload: {
        org_id: 'org-noauth', display_name: 'No Auth', domain: 'noauth.example.com',
        contact_email: 'a@b.com', registry_url: 'https://noauth.example.com',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── GET /api/v1/orgs/:org_id ─────────────────────────────────────────────────

  it('returns org to its member', async () => {
    await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'org-getme', display_name: 'Get Me', domain: 'getme.example.com',
        contact_email: 'a@getme.com', registry_url: 'https://getme.example.com',
      },
    });

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/orgs/org-getme',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().org_id).toBe('org-getme');
  });

  it('returns 403 to non-member', async () => {
    // Seed an org with a different user's membership
    const sql = getSql();
    const otherUser = await upsertUser({
      email: 'other@example.com', displayName: null, avatarUrl: null,
      provider: 'github', providerId: 'other-provider',
    });
    await sql`
      INSERT INTO organizations (org_id, display_name, domain, contact_email, registry_url, verify_token)
      VALUES ('org-other','Other','other.example.com','a@other.com','https://other.example.com/r', 'tok')
    `;
    await sql`
      INSERT INTO org_memberships (user_id, org_id) VALUES (${otherUser.id}, 'org-other')
    `;

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/orgs/org-other',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── PUT /api/v1/orgs/:org_id ─────────────────────────────────────────────────

  it('updates registry_url for org member', async () => {
    await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'org-update', display_name: 'Update Org', domain: 'update.example.com',
        contact_email: 'a@update.com', registry_url: 'https://update.example.com',
      },
    });

    const res = await fastify.inject({
      method: 'PUT',
      url: '/api/v1/orgs/org-update',
      headers: { authorization: `Bearer ${token}` },
      payload: { registry_url: 'https://updated.example.com/registry' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().registry_url).toBe('https://updated.example.com/registry');
  });

  // ── version + trust_manifest (AI Catalog parity fields) ─────────────────────

  const TRUST_MANIFEST = {
    identity:     'urn:ai:domain:trusted.example.com',
    identityType: 'domain',
    attestations: [
      { type: 'soc2', uri: 'https://trusted.example.com/soc2.pdf', mediaType: 'application/pdf' },
    ],
    signature: 'MEUCIQDexample',
  };

  it('creates an org with version and trust_manifest and returns both', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'org-trust-create', display_name: 'Trust Create', domain: 'trustcreate.example.com',
        contact_email: 'a@trustcreate.com', registry_url: 'https://trustcreate.example.com/r',
        version: 'v1.2.3',
        trust_manifest: TRUST_MANIFEST,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.version).toBe('v1.2.3');
    expect(body.trust_manifest).toEqual(TRUST_MANIFEST);
  });

  it('sets trust_manifest and version via PUT', async () => {
    await createOrg(fastify, token, 'org-trust-set');

    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/org-trust-set',
      headers: { authorization: `Bearer ${token}` },
      payload: { version: 'v2.0.0', trust_manifest: TRUST_MANIFEST },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe('v2.0.0');
    expect(res.json().trust_manifest).toEqual(TRUST_MANIFEST);

    // Persisted, not just echoed
    const fetched = await fastify.inject({
      method: 'GET', url: '/api/v1/orgs/org-trust-set',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fetched.json().version).toBe('v2.0.0');
    expect(fetched.json().trust_manifest).toEqual(TRUST_MANIFEST);
  });

  it('preserves trust_manifest when a PUT omits it', async () => {
    await createOrg(fastify, token, 'org-trust-keep');
    await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/org-trust-keep',
      headers: { authorization: `Bearer ${token}` },
      payload: { trust_manifest: TRUST_MANIFEST },
    });

    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/org-trust-keep',
      headers: { authorization: `Bearer ${token}` },
      payload: { description: 'unrelated change' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().trust_manifest).toEqual(TRUST_MANIFEST);
  });

  it('clears trust_manifest when a PUT sends null', async () => {
    await createOrg(fastify, token, 'org-trust-clear');
    await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/org-trust-clear',
      headers: { authorization: `Bearer ${token}` },
      payload: { trust_manifest: TRUST_MANIFEST },
    });

    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/org-trust-clear',
      headers: { authorization: `Bearer ${token}` },
      payload: { trust_manifest: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().trust_manifest).toBeUndefined();

    const fetched = await fastify.inject({
      method: 'GET', url: '/api/v1/orgs/org-trust-clear',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(fetched.json().trust_manifest).toBeUndefined();
  });

  // ── DELETE /api/v1/orgs/:org_id ──────────────────────────────────────────────

  it('suspends org and returns status=suspended', async () => {
    await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: 'org-delete', display_name: 'Delete Org', domain: 'delete.example.com',
        contact_email: 'a@delete.com', registry_url: 'https://delete.example.com',
      },
    });

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-delete/suspend',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('suspended');
  });

  // ── Role enforcement: admin vs member ────────────────────────────────────────

  it('forbids a non-admin member from updating an org (PUT → 403)', async () => {
    await createOrg(fastify, token, 'org-role-put');
    await addMember('org-role-put', memberUserId, 'member');

    const res = await fastify.inject({
      method: 'PUT',
      url: '/api/v1/orgs/org-role-put',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { registry_url: 'https://hacked.example.com/r' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toMatch(/admin/i);
  });

  it('forbids a non-admin member from suspending an org (DELETE /suspend → 403)', async () => {
    await createOrg(fastify, token, 'org-role-suspend');
    await addMember('org-role-suspend', memberUserId, 'member');

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-role-suspend/suspend',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toMatch(/admin/i);
  });

  it('forbids a non-admin member from reactivating an org (POST /reactivate → 403)', async () => {
    await createOrg(fastify, token, 'org-role-react');
    await addMember('org-role-react', memberUserId, 'member');

    const res = await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs/org-role-react/reactivate',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toMatch(/admin/i);
  });

  it('forbids a non-admin member from deleting an org (DELETE → 403)', async () => {
    await createOrg(fastify, token, 'org-role-del');
    await addMember('org-role-del', memberUserId, 'member');

    const res = await fastify.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-role-del',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toMatch(/admin/i);
  });

  it('forbids a non-member from mutating an org (PUT → 403, not a member)', async () => {
    await createOrg(fastify, token, 'org-nonmember');
    // memberUser is deliberately NOT added to this org

    const res = await fastify.inject({
      method: 'PUT',
      url: '/api/v1/orgs/org-nonmember',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { registry_url: 'https://nope.example.com/r' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toMatch(/not a member/i);
  });

  it('allows a non-admin member to read an org (GET → 200)', async () => {
    await createOrg(fastify, token, 'org-role-read');
    await addMember('org-role-read', memberUserId, 'member');

    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/orgs/org-role-read',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().org_id).toBe('org-role-read');
  });

  it('allows an admin to suspend → reactivate → hard-delete the full lifecycle', async () => {
    await createOrg(fastify, token, 'org-admin-lifecycle');

    const suspended = await fastify.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-admin-lifecycle/suspend',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(suspended.statusCode).toBe(200);
    expect(suspended.json().status).toBe('suspended');

    const reactivated = await fastify.inject({
      method: 'POST',
      url: '/api/v1/orgs/org-admin-lifecycle/reactivate',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json().status).toBe('active');

    const deleted = await fastify.inject({
      method: 'DELETE',
      url: '/api/v1/orgs/org-admin-lifecycle',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.statusCode).toBe(204);
  });
});
