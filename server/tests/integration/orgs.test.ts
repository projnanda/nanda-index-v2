import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

async function makeToken(fastify: FastifyInstance, userId: string, email: string): Promise<string> {
  return fastify.jwt.sign({ userId, email, displayName: null });
}

describe('Org management routes — protected CRUD', () => {
  let fastify: FastifyInstance;
  let userId: string;
  let token: string;

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
      url: '/api/v1/orgs/org-delete',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('suspended');
  });
});
