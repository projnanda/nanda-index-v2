import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

const orgId = 'registry-url-scheme-test';
const registration = {
  org_id: orgId,
  display_name: 'Registry URL Scheme Test',
  domain: 'registry-url-scheme.example.com',
  contact_email: 'owner@registry-url-scheme.example.com',
  registry_url: 'https://registry-url-scheme.example.com/catalog.json',
};

/**
 * The validation message has always said https://, but the guard accepted
 * http:// too. Plaintext is allowed only behind OUTBOUND_ALLOW_PRIVATE_HOSTS,
 * for a registry on localhost; tests/setup.ts turns that on, so the cases that
 * assert the production posture turn it back off.
 */
describe('registry_url scheme validation', () => {
  let fastify: FastifyInstance;
  let token: string;
  const privateHosts = process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'];

  const create = (payload: Record<string, unknown> = {}) => fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: { ...registration, ...payload },
  });
  const update = (payload: Record<string, unknown>) => fastify.inject({
    method: 'PUT', url: `/api/v1/orgs/${orgId}`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  const stored = () => getSql()`
    SELECT registry_url FROM organizations WHERE org_id = ${orgId}
  `;

  beforeAll(async () => {
    ({ fastify } = await buildServer({ logger: false }));
    await fastify.ready();
    const user = await upsertUser({
      email: 'registry-url-scheme-test@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'registry-url-scheme-provider', emailVerified: true,
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });

  beforeEach(async () => {
    await getSql()`DELETE FROM organizations WHERE org_id = ${orgId}`;
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = privateHosts ?? 'true';
  });

  afterAll(async () => {
    if (privateHosts === undefined) delete process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'];
    else process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = privateHosts;
    await fastify.close();
    await closeSql();
  });

  describe('with private hosts disallowed, as in production', () => {
    beforeEach(() => {
      process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'false';
    });

    it('POST rejects http:// without creating an organization', async () => {
      const res = await create({ registry_url: 'http://registry-url-scheme.example.com/catalog.json' });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'VALIDATION', detail: 'registry_url must start with https://',
      });
      expect(await stored()).toHaveLength(0);
    });

    it('PUT rejects http:// without changing the stored registry_url', async () => {
      process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'true';
      expect((await create()).statusCode).toBe(201);
      const before = await stored();
      process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'false';

      const res = await update({ registry_url: 'http://registry-url-scheme.example.com/moved.json' });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: 'VALIDATION', detail: 'registry_url must start with https://',
      });
      expect(await stored()).toEqual(before);
    });

    it('POST still accepts https://', async () => {
      expect((await create()).statusCode).toBe(201);
    });
  });

  it('allows http:// for a local registry when private hosts are permitted', async () => {
    const res = await create({ registry_url: 'http://localhost:9/catalog.json' });

    expect(res.statusCode).toBe(201);
  });

  it.each([
    { label: 'FTP scheme', value: 'ftp://registry-url-scheme.example.com/catalog.json' },
    { label: 'JavaScript scheme', value: 'javascript:alert(1)' },
    { label: 'protocol-relative URL', value: '//registry-url-scheme.example.com/catalog.json' },
    { label: 'missing scheme', value: 'registry-url-scheme.example.com/catalog.json' },
  ])('rejects $label whatever the host policy', async ({ value }) => {
    const res = await create({ registry_url: value });

    expect(res.statusCode).toBe(400);
    expect(await stored()).toHaveLength(0);
  });
});
