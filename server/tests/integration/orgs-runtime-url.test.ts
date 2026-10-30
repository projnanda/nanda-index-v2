import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { getSql, closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

const NANDA = 'org.projectnanda';
const orgId = 'runtime-url-test';
const registration = {
  org_id: orgId,
  display_name: 'Runtime URL Test',
  domain: 'runtime-url.example.com',
  contact_email: 'owner@runtime-url.example.com',
  registry_url: 'https://runtime-url.example.com/catalog.json',
};
const invalidUrls = [
  { label: 'JavaScript scheme', value: 'javascript:alert(1)' },
  { label: 'data scheme', value: 'data:text/html,test' },
  { label: 'file scheme', value: 'file:///etc/passwd' },
  { label: 'FTP scheme', value: 'ftp://runtime.example.com/run' },
  { label: 'protocol-relative URL', value: '//runtime.example.com/run' },
  { label: 'relative URL', value: '/run' },
  { label: 'missing scheme', value: 'runtime.example.com/run' },
  { label: 'missing authority separator', value: 'https:runtime.example.com/run' },
  { label: 'single authority slash', value: 'https:/runtime.example.com/run' },
  { label: 'empty authority', value: 'https:///runtime.example.com/run' },
  { label: 'missing host', value: 'https://' },
  { label: 'invalid hostname', value: 'https://invalid host.example/run' },
  { label: 'invalid port', value: 'https://runtime.example.com:99999/run' },
  { label: 'backslash authority', value: 'https://\\runtime.example.com/run' },
  { label: 'embedded control character', value: 'https://runtime.exam\nple.com/run' },
  { label: 'empty string', value: '' },
  { label: 'whitespace', value: '   ' },
  { label: 'null', value: null },
  { label: 'number', value: 42 },
  { label: 'boolean', value: true },
  { label: 'object', value: { url: 'https://runtime.example.com/run' } },
  { label: 'array', value: ['https://runtime.example.com/run'] },
];

describe('Organization runtime URL validation', () => {
  let fastify: FastifyInstance;
  let token: string;

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
    SELECT display_name, description, extensions, updated_at, domain, domain_verified
    FROM organizations WHERE org_id = ${orgId}
  `;

  beforeAll(async () => {
    ({ fastify } = await buildServer({ logger: false }));
    await fastify.ready();
    const user = await upsertUser({
      email: 'runtime-url-test@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'runtime-url-test-provider', emailVerified: true,
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

  it.each(invalidUrls)('POST rejects $label without creating an organization', async ({ value }) => {
    const res = await create({ extensions: { [NANDA]: { 'runtime.url': value } } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION', detail: expect.stringContaining('runtime.url') });
    expect(await stored()).toHaveLength(0);
  });

  it.each(invalidUrls)('PUT rejects $label without changing the stored organization', async ({ value }) => {
    expect((await create({
      extensions: { [NANDA]: { 'runtime.url': 'https://runtime.example.com/original' } },
    })).statusCode).toBe(201);
    const before = await stored();

    const res = await update({
      display_name: 'Changed name', description: 'Changed description', domain: 'changed.example.com',
      extensions: { [NANDA]: { 'runtime.url': value } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'VALIDATION', detail: expect.stringContaining('runtime.url') });
    expect(await stored()).toEqual(before);
  });

  it.each(['registry', 'dns-svcb', 'smb', 'personal'])('validates the hint for the %s hosting path', async (path) => {
    const res = await create({
      hosting_path: path, domain: path === 'personal' ? '' : registration.domain,
      extensions: { [NANDA]: { 'runtime.url': 'javascript:alert(1)' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('runtime.url');
    expect(await stored()).toHaveLength(0);
  });

  it.each([
    'http://runtime.example.com:8080/run?mode=test#status',
    'https://runtime.example.com/run',
    'HTTPS://runtime.example.com/run',
  ])('stores and returns the valid URL %s on POST and PUT', async (url) => {
    const extensions = {
      [NANDA]: {
        'runtime.url': url, 'runtime.provider': { custom: 'Legacy provider' },
        'auth.execution': 'custom-auth', unknownHint: ['kept'],
      },
      'com.example': { 'runtime.url': 'custom:foreign-hint', tier: 'gold' },
    };
    const created = await create({ extensions });
    expect(created.statusCode).toBe(201);
    expect(created.json().extensions).toMatchObject(extensions);
    expect((await stored())[0]?.extensions).toMatchObject(extensions);

    const replacement = { ...extensions, [NANDA]: { ...extensions[NANDA], 'runtime.url': `${url}/next` } };
    const updated = await update({ extensions: replacement });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().extensions).toMatchObject(replacement);
    expect((await stored())[0]?.extensions).toMatchObject(replacement);
  });

  it('clears the runtime URL by omitting its key while preserving other supplied hints', async () => {
    expect((await create({
      extensions: { [NANDA]: { 'runtime.url': 'https://runtime.example.com/run', 'runtime.provider': 'Custom cloud' } },
    })).statusCode).toBe(201);

    const res = await update({
      extensions: { [NANDA]: { 'runtime.provider': 'Custom cloud', unknownHint: 'kept' }, 'com.example': { tier: 'gold' } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().extensions).toEqual({
      [NANDA]: {
        resolutionRole: 'nested-ai-catalog', preferredDiscovery: 'ai-catalog',
        'runtime.provider': 'Custom cloud', unknownHint: 'kept',
      },
      'com.example': { tier: 'gold' },
    });
    expect((await stored())[0]?.extensions).toEqual(res.json().extensions);
  });

  it.each([{}, { [NANDA]: {} }])('clears all client hints with an empty extension replacement %j', async (extensions) => {
    expect((await create({
      extensions: { [NANDA]: { 'runtime.url': 'https://runtime.example.com/run' } },
    })).statusCode).toBe(201);

    const res = await update({ extensions });

    expect(res.statusCode).toBe(200);
    expect(res.json().extensions).toEqual({
      [NANDA]: { resolutionRole: 'nested-ai-catalog', preferredDiscovery: 'ai-catalog' },
    });
    expect((await stored())[0]?.extensions).toEqual(res.json().extensions);
  });

  it('does not reject unrelated edits to a legacy URL when extensions are omitted', async () => {
    expect((await create()).statusCode).toBe(201);
    await getSql()`UPDATE organizations SET extensions = jsonb_set(
      extensions, '{org.projectnanda,runtime.url}', '"legacy:runtime"'::jsonb
    ) WHERE org_id = ${orgId}`;
    const before = (await stored())[0]?.extensions;

    const res = await update({ display_name: 'Updated legacy entry' });

    expect(res.statusCode).toBe(200);
    expect(res.json().display_name).toBe('Updated legacy entry');
    expect((await stored())[0]?.extensions).toEqual(before);
  });
});
