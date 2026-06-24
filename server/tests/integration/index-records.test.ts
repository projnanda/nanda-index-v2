import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';

async function seedOrg(
  orgId: string,
  domain: string,
  displayName: string,
  opts: { status?: string; emailVerified?: boolean; verifyToken?: string } = {},
): Promise<void> {
  const sql = getSql();
  const token = opts.verifyToken ?? randomBytes(16).toString('hex');
  await sql`
    INSERT INTO organizations
      (org_id, display_name, domain, contact_email, registry_url,
       verify_token, verify_token_expires_at, email_verified, status)
    VALUES
      (${orgId}, ${displayName}, ${domain}, ${`admin@${domain}`},
       ${`https://${domain}/registry`}, ${token}, NOW() + INTERVAL '24 hours',
       ${opts.emailVerified ?? true}, ${opts.status ?? 'active'})
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
    const results = res.json() as Array<{ org_id: string }>;
    const ids = results.map(r => r.org_id);
    expect(ids).toContain('idx-active');
    expect(ids).not.toContain('idx-pending');
  });

  it('IndexRecord shape is correct', async () => {
    await seedOrg('idx-shape', 'shape.example.com', 'Shape Org');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index' });
    const record = (res.json() as Array<Record<string, unknown>>)
      .find(r => r['org_id'] === 'idx-shape');
    expect(record).toMatchObject({
      org_id:         'idx-shape',
      domain:         'shape.example.com',
      registry_url:   'https://shape.example.com/registry',
      status:         'active',
      email_verified: true,
    });
    expect(typeof record!['created_at']).toBe('string');
    expect(typeof record!['updated_at']).toBe('string');
  });

  // ── GET /api/v1/index/:org_id ───────────────────────────────────────────────

  it('returns a single IndexRecord by org_id', async () => {
    await seedOrg('idx-single', 'single.example.com', 'Single Org');

    const res = await fastify.inject({ method: 'GET', url: '/api/v1/index/idx-single' });
    expect(res.statusCode).toBe(200);
    expect(res.json().org_id).toBe('idx-single');
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
