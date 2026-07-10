import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

const ANS_MEDIA_TYPE = 'application/vnd.ans-agent+json';
const TL_URL = 'https://tl.ansorg.example.com';

/** Minimal valid `ans` registration payload; override/delete fields per test. */
function ansPayload(orgId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    org_id:        orgId,
    display_name:  'ANS Org',
    hosting_path:  'ans',
    domain:        `${orgId}.example.com`,
    contact_email: `admin@${orgId}.example.com`,
    registry_url:  TL_URL,
    ...overrides,
  };
}

describe('POST /api/v1/orgs — ans hosting path', () => {
  let fastify: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    const built = await buildServer({ logger: false });
    fastify = built.fastify;
    await fastify.ready();

    // Seed a real user row so the membership FK passes
    const user = await upsertUser({
      email:       'orgs-ans-test@example.com',
      displayName: 'Orgs ANS Test',
      avatarUrl:   null,
      provider:    'google',
      providerId:  'orgs-ans-test-provider-id',
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
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
              AND organizations.org_id LIKE 'ansorg-%'`;
    await sql`DELETE FROM organizations WHERE org_id LIKE 'ansorg-%'`;
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  it('creates an ans org: 201, defaulted media_type, entry_data passed through verbatim', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: ansPayload('ansorg-happy', {
        entry_data: {
          ans:   { ra_url: 'https://ra.ansorg.example.com' },
          other: 'kept',
        },
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.org_id).toBe('ansorg-happy');
    expect(body.media_type).toBe(ANS_MEDIA_TYPE);
    expect(body.registry_url).toBe(TL_URL);

    // entry_data is stored and returned verbatim — exact equality pins the
    // passthrough contract (nothing server-injected). Keys arrive camelCased
    // on the wire: the shared postgres client (transform: postgres.camel)
    // deep-transforms JSONB keys on read, so the stored ra_url surfaces
    // as raUrl.
    expect(body.data).toEqual({
      ans:   { raUrl: 'https://ra.ansorg.example.com' },
      other: 'kept',
    });
  });

  it('creates an ans org with no entry_data: 201 and no data field at all', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: ansPayload('ansorg-nodata'),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.media_type).toBe(ANS_MEDIA_TYPE);
    expect(body).not.toHaveProperty('data');
  });

  it('accepts an explicitly supplied ans media_type', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: ansPayload('ansorg-explicit-mt', { media_type: ANS_MEDIA_TYPE }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().media_type).toBe(ANS_MEDIA_TYPE);
  });

  // ── Validation failures ──────────────────────────────────────────────────────

  it('rejects a missing registry_url (400, names the ANS Transparency Log)', async () => {
    const payload = ansPayload('ansorg-no-reg');
    delete payload.registry_url;

    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION');
    expect(body.detail).toMatch(/ANS Transparency Log/);
  });

  it('rejects an http:// registry_url (400 — strict https for ans)', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: ansPayload('ansorg-http-reg', { registry_url: 'http://tl.insecure.example.com' }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION');
    expect(body.detail).toMatch(/https/);
  });

  it('rejects a non-ans media_type on an ans registration (400 VALIDATION)', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: ansPayload('ansorg-wrong-mt', { media_type: 'application/ai-catalog+json' }),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION');
    expect(body.detail).toMatch(/application\/vnd\.ans-agent\+json/);
  });

  it('rejects a missing domain (400 — ans orgs are domain-anchored)', async () => {
    const payload = ansPayload('ansorg-no-domain');
    delete payload.domain;

    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION');
    expect(body.detail).toMatch(/domain is required/);
  });

  // ── Discriminator binding: the ans media_type is unobtainable off-path ──────
  // (media_type is the persisted marker resolution/clients key on; hosting_path
  // is request-time only. Without this guard, a registry- or dns-aid-path
  // registration could mint an "ans" org that skipped the strict-https regime.)

  it('rejects the ans media_type on the default registry path (400, even with https)', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id:        'ansorg-mt-registry',
        display_name:  'Sneaky Registry Org',
        // hosting_path omitted → defaults to 'registry'
        domain:        'sneaky.example.com',
        contact_email: 'admin@sneaky.example.com',
        registry_url:  'https://sneaky.example.com/registry',
        media_type:    ANS_MEDIA_TYPE,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION');
    expect(body.detail).toMatch(/requires hosting_path "ans"/);
  });

  it('rejects the ans media_type on the dns-aid path (400 — no null-registry_url ans orgs)', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id:        'ansorg-mt-dnsaid',
        display_name:  'Sneaky DNS-AID Org',
        hosting_path:  'dns-aid',
        domain:        'sneaky-aid.example.com',
        contact_email: 'admin@sneaky-aid.example.com',
        media_type:    ANS_MEDIA_TYPE,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION');
    expect(body.detail).toMatch(/requires hosting_path "ans"/);
  });

  // ── PUT: the https invariant survives updates ────────────────────────────────

  it('rejects a PUT that downgrades an ans org registry_url to http (400)', async () => {
    const created = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: ansPayload('ansorg-put-downgrade'),
    });
    expect(created.statusCode).toBe(201);

    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/ansorg-put-downgrade',
      headers: { authorization: `Bearer ${token}` },
      payload: { registry_url: 'http://tl.downgraded.example.com' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('VALIDATION');
    expect(body.detail).toMatch(/https/);
  });

  it('accepts a PUT that moves an ans org registry_url to another https URL', async () => {
    const created = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: ansPayload('ansorg-put-https'),
    });
    expect(created.statusCode).toBe(201);

    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/ansorg-put-https',
      headers: { authorization: `Bearer ${token}` },
      payload: { registry_url: 'https://tl2.ansorg.example.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().registry_url).toBe('https://tl2.ansorg.example.com');
  });

  it('still accepts an http registry_url via PUT on a non-ans org (guard is ans-scoped)', async () => {
    const created = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id:        'ansorg-put-plain',
        display_name:  'Plain Org',
        domain:        'putplain.example.com',
        contact_email: 'admin@putplain.example.com',
        registry_url:  'https://putplain.example.com/registry',
      },
    });
    expect(created.statusCode).toBe(201);

    const res = await fastify.inject({
      method: 'PUT', url: '/api/v1/orgs/ansorg-put-plain',
      headers: { authorization: `Bearer ${token}` },
      payload: { registry_url: 'http://putplain.example.com/registry' },
    });

    // Pre-existing generic behavior (http accepted) — unchanged by the
    // ans-scoped guard. Tightening it is a separate, deliberate change.
    expect(res.statusCode).toBe(200);
  });

  // ── Non-ans paths untouched ──────────────────────────────────────────────────

  it('creates a plain registry org with the default catalog media_type', async () => {
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id:        'ansorg-plain',
        display_name:  'Plain Registry Org',
        domain:        'plain.example.com',
        contact_email: 'admin@plain.example.com',
        registry_url:  'https://plain.example.com/registry',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().media_type).toBe('application/ai-catalog+json');
  });
});
