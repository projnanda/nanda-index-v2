import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { upsertUser } from '../../src/db/queries/users.js';
import { getSql } from '../../src/db/client.js';

describe('GET /api/v1/me', () => {
  let fastify: FastifyInstance;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    const user = await upsertUser({
      email:       'me-test@example.com',
      displayName: 'Me Test',
      avatarUrl:   'https://example.com/avatar.png',
      provider:    'google',
      providerId:  'me-test-provider-id',
    });
    userId = user.id;
    token  = fastify.jwt.sign({ userId, email: user.email, displayName: user.displayName });
  });

  afterAll(async () => {
    await fastify.close();
    const { closeSql } = await import('../../src/db/client.js');
    await closeSql();
  });

  it('returns user profile and empty orgs array', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user_id).toBe(userId);
    expect(body.email).toBe('me-test@example.com');
    expect(body.display_name).toBe('Me Test');
    expect(Array.isArray(body.orgs)).toBe(true);
  });

  it('includes each org domain so the dashboard can tell personal entries apart', async () => {
    const sql = getSql();
    await sql`DELETE FROM organizations WHERE org_id IN ('me-domain-org', 'me-personal-org')`;
    await sql`
      INSERT INTO organizations
        (org_id, display_name, domain, contact_email, registry_url, identifier, status)
      VALUES
        ('me-domain-org', 'Domain Org', 'me-domain.example.com', 'admin@me-domain.example.com',
         'https://me-domain.example.com/registry', 'urn:air:me-domain.example.com:catalog:root', 'pending'),
        ('me-personal-org', 'Personal Org', NULL, 'me-test@example.com',
         'https://host39.org/personal/me-personal-org', 'urn:air:host39.org:personal:me-personal-org', 'pending')
    `;
    await sql`
      INSERT INTO org_memberships (user_id, org_id, role)
      VALUES (${userId}, 'me-domain-org', 'admin'), (${userId}, 'me-personal-org', 'admin')
    `;

    try {
      const res = await fastify.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const byId = new Map(res.json().orgs.map((o: { org_id: string }) => [o.org_id, o]));
      expect(byId.get('me-domain-org')).toMatchObject({ domain: 'me-domain.example.com', domain_verified: false });
      expect(byId.get('me-personal-org')).toMatchObject({ domain: null, domain_verified: false });
    } finally {
      await sql`DELETE FROM organizations WHERE org_id IN ('me-domain-org', 'me-personal-org')`;
    }
  });

  it('returns 401 without token', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with malformed token', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});
