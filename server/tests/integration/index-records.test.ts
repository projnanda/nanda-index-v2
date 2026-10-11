import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';

async function seedOrg(
  orgId: string,
  domain: string | null,
  displayName: string,
  opts: { status?: string; emailVerified?: boolean; verifyToken?: string } = {},
): Promise<void> {
  const sql = getSql();
  const token = opts.verifyToken ?? randomBytes(16).toString('hex');
  const contactEmail = domain ? `admin@${domain}` : `${orgId}@example.com`;
  const registryUrl = domain ? `https://${domain}/registry` : `https://host39.org/personal/${orgId}`;
  const identifier = domain ? `urn:air:${domain}:catalog:root` : `urn:air:host39.org:personal:${orgId}`;
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url,
       verify_token, verify_token_expires_at, email_verified, status, identifier)
    VALUES
      (${orgId}, ${displayName}, ${domain}, ${contactEmail},
       ${registryUrl}, ${token}, NOW() + INTERVAL '24 hours',
       ${opts.emailVerified ?? true}, ${opts.status ?? 'active'}, ${identifier})
    ON CONFLICT (org_id) DO NOTHING
  `;
}

describe('NANDA Index — public read routes', () => {
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
    await sql`DELETE FROM organizations WHERE org_id LIKE 'idx-%'`;
  });

  // ── GET /api/v1/index ───────────────────────────────────────────────────────

  it('returns 200 with empty array when no active orgs', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('returns only active orgs', async () => {
    await seedOrg('idx-active', 'active.example.com', 'Active Org');
    await seedOrg('idx-pending', 'pending.example.com', 'Pending Org', { status: 'pending' });

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index' });
    expect(res.statusCode).toBe(200);
    const results = res.json() as Array<{ identifier: string }>;
    const ids = results.map(r => r.identifier);
    expect(ids).toContain('urn:air:active.example.com:catalog:root');
    expect(ids).not.toContain('urn:air:pending.example.com:catalog:root');
  });

  it('returns records in the paper\'s AI Catalog entry shape, operational fields under the NANDA extension', async () => {
    await seedOrg('idx-shape', 'shape.example.com', 'Shape Org');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index' });
    const record = (res.json() as Array<Record<string, unknown>>)
      .find(r => r['identifier'] === 'urn:air:shape.example.com:catalog:root');

    expect(record).toEqual({
      identifier:  'urn:air:shape.example.com:catalog:root',
      displayName: 'Shape Org',
      type:        'application/ai-catalog+json',
      url:         'https://shape.example.com/registry',
      tags:        [],
      updatedAt:   expect.any(String),
      extensions: {
        'org.projectnanda': {
          orgId: 'idx-shape',
          status: 'active',
          ttlSeconds: 86400,
          emailVerified: true,
          domainVerified: false,
          createdAt: expect.any(String),
          domain: 'shape.example.com',
          representativeQueries: [],
        },
      },
    });
    // NANDA-native field names are gone from this surface.
    for (const legacy of ['org_id', 'display_name', 'media_type', 'registry_url', 'metadata', 'domain']) {
      expect(record).not.toHaveProperty(legacy);
    }
  });

  // ── GET /api/v1/index/:org_id ───────────────────────────────────────────────

  it('reports domain as null for a personal (no-domain) entry', async () => {
    await seedOrg('idx-solo', null, 'Solo Agent');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index/idx-solo' });

    expect(res.json().extensions['org.projectnanda'].domain).toBeNull();
  });

  it('returns a single paper-shaped record by org_id', async () => {
    await seedOrg('idx-single', 'single.example.com', 'Single Org');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index/idx-single' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      identifier: 'urn:air:single.example.com:catalog:root',
      displayName: 'Single Org',
      extensions: { 'org.projectnanda': { orgId: 'idx-single' } },
    });
  });

  it('returns 404 for unknown org_id', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index/idx-notexist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  // ── GET /api/v1/verify-email ────────────────────────────────────────────────

  it('marks email verified via valid token but does NOT activate (domain gate)', async () => {
    const token = randomBytes(16).toString('hex');
    await seedOrg('idx-verify', 'verify.example.com', 'Verify Org', {
      status: 'pending',
      emailVerified: false,
      verifyToken: token,
    });

    const res = await fastify.inject({
      method: 'GET',
      url: `/api/v1/verify-email?token=${token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email_verified).toBe(true);
    // Activation is gated on domain ownership — email alone must not activate.
    expect(res.json().status).toBe('pending');
    expect(res.json().domain_verified).toBe(false);
  });

  it('activates a personal (no-domain) org on email verification alone', async () => {
    const token = randomBytes(16).toString('hex');
    await seedOrg('idx-personal-verify', null, 'Personal Org', {
      status: 'pending',
      emailVerified: false,
      verifyToken: token,
    });

    const res = await fastify.inject({
      method: 'GET',
      url: `/api/v1/verify-email?token=${token}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email_verified).toBe(true);
    // No domain to verify — email verification is the only activation gate.
    expect(res.json().status).toBe('active');
    expect(res.json().domain).toBe(null);
  });

  it('returns 400 when token query param is missing', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/v1/verify-email' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for invalid verify token', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/v1/verify-email?token=totally-invalid-token-xyz',
    });
    expect(res.statusCode).toBe(404);
  });
});
