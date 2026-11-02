import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { closeSql } from '../../src/db/client.js';
import { upsertUser } from '../../src/db/queries/users.js';

/**
 * Authentication runs before body validation, so a caller with no credentials
 * learns nothing about a route's shape. With the checks in preHandler, Fastify
 * validated the body first and answered an anonymous request with the field
 * names and allowed values of routes it had no right to call.
 */
describe('authentication answers before the body is validated', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    ({ fastify } = await buildServer({ logger: false }));
    await fastify.ready();
  });

  afterAll(async () => {
    await fastify.close();
    await closeSql();
  });

  const anonymous = (method: 'POST' | 'PUT' | 'PATCH', url: string, payload: Record<string, unknown> = {}) =>
    fastify.inject({ method, url, payload });

  it.each([
    { label: 'admin single moderation', method: 'POST' as const, url: '/api/v1/admin/orgs/any-org/moderation' },
    { label: 'admin bulk moderation', method: 'POST' as const, url: '/api/v1/admin/orgs/moderation-bulk' },
    { label: 'create organization', method: 'POST' as const, url: '/api/v1/orgs' },
    { label: 'update organization', method: 'PUT' as const, url: '/api/v1/orgs/any-org' },
    { label: 'update account', method: 'PATCH' as const, url: '/api/v1/me' },
  ])('$label answers 401 for an empty body, not a schema error', async ({ method, url }) => {
    const res = await anonymous(method, url, {});

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it.each([
    { label: 'admin single moderation', method: 'POST' as const, url: '/api/v1/admin/orgs/any-org/moderation' },
    { label: 'admin bulk moderation', method: 'POST' as const, url: '/api/v1/admin/orgs/moderation-bulk' },
  ])('$label does not reveal its allowed values to an anonymous caller', async ({ method, url }) => {
    const res = await anonymous(method, url, { moderation: 'not-a-real-value' });

    expect(res.statusCode).toBe(401);
    // The schema error named the valid enum, which is a map of the operator
    // API for anyone who asks.
    expect(res.body).not.toContain('allowed values');
    expect(res.body).not.toContain('moderation');
    expect(res.body).not.toContain('org_id_prefix');
  });

  it('still validates the body once the caller is authenticated', async () => {
    // The ordering change must not stop schema errors reaching real callers.
    const user = await upsertUser({
      email: 'auth-ordering@example.com', displayName: null, avatarUrl: null,
      provider: 'google', providerId: 'auth-ordering-provider', emailVerified: true,
    });
    const token = fastify.jwt.sign({ userId: user.id, email: user.email, displayName: null });
    const res = await fastify.inject({
      method: 'POST', url: '/api/v1/orgs',
      headers: { authorization: `Bearer ${token}` },
      payload: { org_id: 'x' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'FST_ERR_VALIDATION' });
  });
});
