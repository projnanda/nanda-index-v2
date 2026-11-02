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

/**
 * Review on #135: the first version checked the scheme on every PUT, and the
 * dashboard resends registry_url on every save. An owner whose entry was
 * registered before the rule — stored http:// — could no longer edit their
 * description, and the error named a field they had not touched.
 */
describe('registry_url on an entry that predates the https rule', () => {
  let fastify: FastifyInstance;
  let token: string;
  const legacyId = 'registry-url-legacy-test';
  const legacyUrl = 'http://registry-url-legacy.example.com/catalog.json';
  const privateHosts = process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'];

  const update = (payload: Record<string, unknown>) => fastify.inject({
    method: 'PUT', url: `/api/v1/orgs/${legacyId}`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });

  beforeAll(async () => {
    ({ fastify } = await buildServer({ logger: false }));
    await fastify.ready();
    const user = await upsertUser({
      email: 'registry-url-legacy@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'registry-url-legacy-provider', emailVerified: true,
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });

  beforeEach(async () => {
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'true';
    await getSql()`DELETE FROM organizations WHERE org_id = ${legacyId}`;
    await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        org_id: legacyId, display_name: 'Legacy', domain: 'registry-url-legacy.example.com',
        contact_email: 'owner@registry-url-legacy.example.com', registry_url: legacyUrl,
      },
    });
    // From here on the server behaves as production does.
    process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = 'false';
  });

  afterAll(async () => {
    if (privateHosts === undefined) delete process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'];
    else process.env['OUTBOUND_ALLOW_PRIVATE_HOSTS'] = privateHosts;
    await fastify.close();
    await closeSql();
  });

  it('lets the owner edit other fields without touching the URL', async () => {
    expect((await update({ description: 'Changed description' })).statusCode).toBe(200);
  });

  it('lets the owner resend the stored http:// value unchanged', async () => {
    // This is what the dashboard actually sends on every save.
    const res = await update({ description: 'Changed again', registry_url: legacyUrl });

    expect(res.statusCode).toBe(200);
  });

  it('still refuses a change to a different http:// URL', async () => {
    const res = await update({ registry_url: 'http://registry-url-legacy.example.com/moved.json' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ detail: 'registry_url must start with https://' });
  });

  it('accepts a change to https://', async () => {
    const res = await update({ registry_url: 'https://registry-url-legacy.example.com/catalog.json' });

    expect(res.statusCode).toBe(200);
  });
});

describe('registry_url shapes the prefix test used to let through', () => {
  let fastify: FastifyInstance;
  let token: string;
  const orgId = 'registry-url-shape-test';

  const create = (registryUrl: string) => fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      org_id: orgId, display_name: 'Shape', domain: 'registry-url-shape.example.com',
      contact_email: 'owner@registry-url-shape.example.com', registry_url: registryUrl,
    },
  });

  beforeAll(async () => {
    ({ fastify } = await buildServer({ logger: false }));
    await fastify.ready();
    const user = await upsertUser({
      email: 'registry-url-shape@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'registry-url-shape-provider', emailVerified: true,
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });

  beforeEach(async () => {
    await getSql()`DELETE FROM organizations WHERE org_id = ${orgId}`;
  });

  afterAll(async () => {
    await fastify.close();
    await closeSql();
  });

  it.each([
    { label: 'no authority', value: 'https://' },
    { label: 'an empty authority', value: 'https:///evil.example.com/x' },
    { label: 'a space in the host', value: 'https://exa mple.com/x' },
    { label: 'a backslash authority', value: 'https://\\evil.example.com/x' },
  ])('refuses $label', async ({ value }) => {
    expect((await create(value)).statusCode).toBe(400);
  });

  it('accepts an uppercase scheme, matching the web form', async () => {
    // The web regex is /i; the server used to be case-sensitive and 400 here.
    expect((await create('HTTPS://registry-url-shape.example.com/catalog.json')).statusCode).toBe(201);
  });
});

describe('registry_url must not carry credentials', () => {
  let fastify: FastifyInstance;
  let token: string;
  const orgId = 'registry-url-userinfo-test';

  const create = (registryUrl: string) => fastify.inject({
    method: 'POST', url: '/api/v1/orgs',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      org_id: orgId, display_name: 'Userinfo', domain: 'registry-url-userinfo.example.com',
      contact_email: 'userinfo@example.com', registry_url: registryUrl,
    },
  });

  beforeAll(async () => {
    ({ fastify } = await buildServer({ logger: false }));
    await fastify.ready();
    const user = await upsertUser({
      email: 'userinfo@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'userinfo-provider', emailVerified: true,
    });
    token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
  });

  beforeEach(async () => {
    await getSql()`DELETE FROM organizations WHERE org_id = ${orgId}`;
  });

  afterAll(async () => {
    await fastify.close();
    await closeSql();
  });

  it.each([
    { label: 'a username and password', value: 'https://user:pass@example.com/catalog.json' },
    { label: 'a username only', value: 'https://user@example.com/catalog.json' },
    // The one that matters: reads as good.com to anyone skimming the record.
    { label: 'a lookalike host before the @', value: 'https://good.com@evil.invalid/catalog.json' },
  ])('refuses $label', async ({ value }) => {
    const res = await create(value);

    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('username or password');
  });

  it('still accepts an ordinary URL', async () => {
    expect((await create('https://registry-url-userinfo.example.com/catalog.json')).statusCode).toBe(201);
  });
});
